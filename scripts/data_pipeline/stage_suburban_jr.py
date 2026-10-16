"""Prepare and audit isolated JR East suburban staging datasets."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from scripts.data_pipeline.build import filtered_network, to_metric_point
from scripts.data_pipeline.constraints import (
    OPEN_SECTIONS,
    JunctionRule,
    SectionFilter,
    build_section_filter,
    parse_junction_rows,
)
from scripts.data_pipeline.n02 import (
    N02SourceProvider,
    PlatformCandidate,
)
from scripts.data_pipeline.override_models import ServiceOverrides, Stop, StopResolution
from scripts.data_pipeline.override_parsing import JUNCTIONS_OVERRIDE_FILE
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.registry import normalize_station_name
from scripts.data_pipeline.routing import PairRoute, RoutingError, route_path
from scripts.data_pipeline.topology import station_order, station_pairs

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "data/overrides"
STAGING = ROOT / "data/staging/tokyo-suburban-jr"
FREEZE = ROOT / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
RESEARCH = ROOT / ".claude/docs/research"
REGIONS = ("tohoku", "takasaki", "chuo", "tokaido")
DATASET_LEVEL_FILES = {
    "detour_exceptions.csv": ("service_id", "from_id", "to_id"),
    "offset_exceptions.csv": ("service_id", "station_id"),
    "platform_transfers.csv": ("service_id", "station_id"),
}
REGION_SERVICES = {
    "tohoku": (
        "jr-utsunomiya",
        "jr-shonan-shinjuku-local",
        "jr-joban-rapid",
        "jr-joban-local",
        "jr-kashima",
        "jr-mito",
        "jr-nikko",
        "jr-karasuyama",
        "jr-suigun",
        "jr-suigun-ota",
    ),
    "takasaki": (
        "jr-takasaki",
        "jr-shonan-shinjuku-rapid-takasaki",
        "jr-hachiko",
        "jr-joetsu",
        "jr-agatsuma",
        "jr-ryomo",
        "jr-shinetsu-yokokawa",
    ),
    "chuo": (
        "jr-chuo-takao-fujino",
        "jr-chuo-tatsuno",
        "jr-koumi",
        "jr-shinonoi",
        "jr-shinetsu-nagano",
        "jr-oito",
    ),
    "tokaido": ("jr-tokaido", "jr-ito"),
}
ALL_ASSIGNED_SERVICES = tuple(
    dict.fromkeys(
        service_id for region in REGIONS for service_id in REGION_SERVICES[region]
    )
)
STAGE_PREFECTURES = [
    "東京都",
    "千葉県",
    "神奈川県",
    "埼玉県",
    "山梨県",
    "栃木県",
    "福島県",
    "群馬県",
    "茨城県",
    "長野県",
    "静岡県",
]
OUTPUT_BBOX = [137.7, 34.8, 141.2, 37.7]
SEARCH_BBOX = [137.5, 34.6, 141.4, 37.9]
FOUR_PREFECTURES = ["東京都", "千葉県", "神奈川県", "埼玉県"]
STOPS_FIELDS = (
    "order",
    "station_id",
    "station_number",
    "platform_selector",
    "original_name",
    "n02_name",
    "n02_operator",
    "source_reason",
)
SCOPE_FIELDS = ("station_id", "prefecture", "municipality", "in_area")
LINE_FIELDS = ("from_id", "to_id", "n02_line", "via", "route", "compose")
PAIR_EVIDENCE_FIELDS = (
    "service_id",
    "from_id",
    "to_id",
    "n02_operator",
    "from_platform_code",
    "from_group_code",
    "to_platform_code",
    "to_group_code",
    "n02_line",
    "path_length_km",
    "start_snap_m",
    "end_snap_m",
    "status",
    "notes",
)
LENGTH_REF_FIELDS = (
    "service_id",
    "from",
    "to",
    "km",
    "source_url",
    "n02_pair_sum_km",
    "notes",
)
LENGTH_TOLERANCE_KM = 1.5
JR_OFFICIAL_MILEAGE_PDF = (
    "https://www.jreast.co.jp/youran/pdf/2017-2018/jre_youran_shogen_p86.pdf"
)
OFFICIAL_NEW_LENGTHS = {
    "jr-mito": (50.2, "小山", "友部", JR_OFFICIAL_MILEAGE_PDF),
    "jr-nikko": (40.5, "宇都宮", "日光", JR_OFFICIAL_MILEAGE_PDF),
    "jr-karasuyama": (20.4, "宝積寺", "烏山", JR_OFFICIAL_MILEAGE_PDF),
    "jr-suigun": (
        55.6,
        "水戸",
        "常陸大子",
        "https://ja.wikipedia.org/wiki/水郡線",
    ),
    "jr-suigun-ota": (9.5, "上菅谷", "常陸太田", JR_OFFICIAL_MILEAGE_PDF),
    "jr-joetsu": (
        59.1,
        "高崎",
        "水上",
        "https://ja.wikipedia.org/wiki/上越線",
    ),
    "jr-agatsuma": (55.3, "渋川", "大前", JR_OFFICIAL_MILEAGE_PDF),
    "jr-ryomo": (
        91.7,
        "高崎",
        "小山",
        f"{JR_OFFICIAL_MILEAGE_PDF} https://en.wikipedia.org/wiki/J%C5%8Cetsu_Line",
    ),
    "jr-shinetsu-yokokawa": (
        29.7,
        "高崎",
        "横川",
        JR_OFFICIAL_MILEAGE_PDF,
    ),
    "jr-chuo-tatsuno": (
        27.7,
        "岡谷",
        "塩尻",
        JR_OFFICIAL_MILEAGE_PDF,
    ),
    "jr-koumi": (
        23.4,
        "小淵沢",
        "野辺山",
        "https://www.jreast.co.jp/fr/nagano/trip/nobeyama/index.html",
    ),
    "jr-shinonoi": (66.7, "塩尻", "篠ノ井", JR_OFFICIAL_MILEAGE_PDF),
    "jr-shinetsu-nagano": (
        9.3,
        "篠ノ井",
        "長野",
        JR_OFFICIAL_MILEAGE_PDF,
    ),
    "jr-oito": (
        59.7,
        "松本",
        "白馬",
        "https://www.jreast.co.jp/th/nagano/trip/hakuba/",
    ),
    "jr-ito": (16.9, "熱海", "伊東", JR_OFFICIAL_MILEAGE_PDF),
}
KNOWN_STOP_OVERRIDES = {
    ("jr-ryomo", "oyama"): "line=両毛線;group=002407;code=002411",
    ("jr-mito", "oyama"): "line=水戸線;group=002407;code=002410",
    ("jr-suigun", "mito"): "line=水郡線;group=002319;code=002317",
}
N02_NAME_OVERRIDES = {("jr-nikko", "fubasami"): "文挟"}
JUNCTION_FIELDS = (
    "n02_operator",
    "n02_line",
    "section_key",
    "peer_section_key",
    "lon",
    "lat",
    "reason",
)
# Reviewed exact-vertex graph splits (S2 plan, "Known geometry problems"; R1
# raw regression in tests/data_pipeline/test_reviewed_junctions.py).
KNOWN_JUNCTIONS = {
    "jr-joban-rapid": (
        {
            "n02_operator": "東日本旅客鉄道",
            "n02_line": "常磐線",
            "section_key": "141.00748 37.24274~141.00776 37.24270#9d1f3f94",
            "peer_section_key": "140.99921 37.21210~141.00738 37.24077#de4dc6de",
            "lon": "141.0073806",
            "lat": "37.24077448",
            "reason": (
                "Jヴィレッジ station section: its internal source vertex 1 equals "
                "the exact end of the southern 常磐線 section (S2 plan, R1 review)."
            ),
        },
    ),
}
# Reviewed line-name boundaries (S2 plan, "Known geometry problems"): the frozen
# catalog labels each station, not the track between two stations.
PAIR_LINE_BOUNDARIES = {
    # 八高線 trains run 倉賀野–高崎 on 高崎線 track.
    ("jr-hachiko", "kuragano", "takasaki"): "高崎線",
    # 両毛線 trains run 高崎–新前橋 on 上越線 track.
    ("jr-ryomo", "ino", "shim-maebashi"): "上越線",
}
AREA_BOUNDARY_NEIGHBORS = {
    "jr-utsunomiya": ("last", "takaku", "高久", "栃木県", "那須塩原市"),
    "jr-joban-rapid": ("last", "momouchi", "桃内", "福島県", "南相馬市"),
    "jr-tokaido": ("last", "kannami", "函南", "静岡県", "田方郡函南町"),
    "jr-suigun": ("last", "shimonomiya", "下野宮", "茨城県", "久慈郡大子町"),
    "jr-joetsu": ("last", "yubiso", "湯檜曽", "群馬県", "利根郡みなかみ町"),
    "jr-koumi": (
        "last",
        "shinano-kawakami",
        "信濃川上",
        "長野県",
        "南佐久郡川上村",
    ),
    "jr-oito": (
        "last",
        "shinano-moriue",
        "信濃森上",
        "長野県",
        "北安曇郡白馬村",
    ),
}


class StageError(ValueError):
    """Invalid staging input or a failed preservation gate."""


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        return list(reader.fieldnames or []), list(reader)


def _write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _research_rows(root: Path, filename: str) -> list[dict[str, str]]:
    return _csv(root / ".claude/docs/research" / filename)[1]


def _frozen_jr_catalog(root: Path) -> tuple[list[str], dict[str, list[dict[str, str]]]]:
    catalog = _research_rows(root, "tokyo-suburban-research-catalog.csv")
    services = _research_rows(root, "tokyo-suburban-research-services.csv")
    jr_rows = [row for row in catalog if row["operator"] == "東日本旅客鉄道"]
    by_id: dict[str, list[dict[str, str]]] = {}
    for row in jr_rows:
        by_id.setdefault(row["service_id"], []).append(row)
    service_order = [
        row["service_id"] for row in services if row["service_id"] in by_id
    ]
    if len(service_order) != len(by_id):
        raise StageError("frozen JR catalog and service inventory disagree")
    return service_order, {
        service_id: sorted(rows, key=lambda row: int(row["order"]))
        for service_id, rows in by_id.items()
    }


def _endpoint_kind(value: str) -> str:
    if value == "through-split":
        return "service-boundary"
    if value not in ("terminus", "area-boundary", "service-boundary"):
        raise StageError(f"unsupported frozen endpoint kind: {value}")
    return value


def _catalog_service_metadata(root: Path) -> dict[str, dict[str, str]]:
    return {
        row["service_id"]: row
        for row in _research_rows(root, "tokyo-suburban-research-services.csv")
    }


def _make_stops(
    service_id: str,
    catalog_rows: list[dict[str, str]],
    existing_path: Path | None,
) -> list[dict[str, str]]:
    _, previous = (
        _csv(existing_path) if existing_path and existing_path.is_file() else ([], [])
    )
    old_by_id = {row["station_id"]: row for row in previous}
    stops: list[dict[str, str]] = []
    for order, item in enumerate(catalog_rows):
        station_id = item["station_id_proposed"]
        old = old_by_id.get(station_id, {})
        n02_name = N02_NAME_OVERRIDES.get((service_id, station_id), "")
        stops.append(
            {
                "order": str(order),
                "station_id": station_id,
                "station_number": old.get("station_number", ""),
                "platform_selector": KNOWN_STOP_OVERRIDES.get(
                    (service_id, station_id), old.get("platform_selector", "")
                ),
                "original_name": old.get("original_name", ""),
                "n02_name": n02_name or old.get("n02_name", ""),
                "n02_operator": old.get("n02_operator", ""),
                "source_reason": old.get("source_reason", ""),
            }
        )
    return stops


def _make_line_mapping(
    service_id: str,
    catalog_rows: list[dict[str, str]],
    existing_path: Path | None,
) -> list[dict[str, str]]:
    _, existing = (
        _csv(existing_path) if existing_path and existing_path.is_file() else ([], [])
    )
    by_pair = {(row["from_id"], row["to_id"]): row for row in existing}
    rows: list[dict[str, str]] = []
    for origin, destination in zip(catalog_rows, catalog_rows[1:], strict=False):
        pair = (origin["station_id_proposed"], destination["station_id_proposed"])
        old = by_pair.get(pair)
        if old is not None:
            rows.append(old)
            continue
        rows.append(
            {
                "from_id": pair[0],
                "to_id": pair[1],
                "n02_line": _new_pair_line(service_id, origin, destination),
                "via": "",
                "route": "",
                "compose": "",
            }
        )
    return rows


def _new_pair_line(
    service_id: str, origin: dict[str, str], destination: dict[str, str]
) -> str:
    """N02 line of one added pair; a line-name change needs a reviewed boundary."""
    pair = (
        service_id,
        origin["station_id_proposed"],
        destination["station_id_proposed"],
    )
    if pair in PAIR_LINE_BOUNDARIES:
        return PAIR_LINE_BOUNDARIES[pair]
    if origin["n02_line"] != destination["n02_line"]:
        raise StageError(
            f"unreviewed N02 line boundary for {service_id} {pair[1]}~{pair[2]}: "
            f"{origin['n02_line']} / {destination['n02_line']}"
        )
    return origin["n02_line"]


def _make_scope(
    service_id: str,
    catalog_rows: list[dict[str, str]],
    first_kind: str,
    last_kind: str,
    registry_by_id: dict[str, dict[str, str]],
) -> list[dict[str, str]]:
    rows = [
        {
            "station_id": row["station_id_proposed"],
            "prefecture": registry_by_id.get(row["station_id_proposed"], {}).get(
                "prefecture", row["prefecture"]
            ),
            "municipality": registry_by_id.get(row["station_id_proposed"], {}).get(
                "municipality", row["municipality"]
            ),
            "in_area": "true",
        }
        for row in catalog_rows
    ]
    neighbor = AREA_BOUNDARY_NEIGHBORS.get(service_id)
    positions = (first_kind, last_kind)
    area_endpoints = [
        side
        for side, kind in zip(("first", "last"), positions, strict=True)
        if kind == "area-boundary"
    ]
    if area_endpoints:
        if neighbor is None or neighbor[0] not in area_endpoints:
            raise StageError(
                f"missing frozen boundary-neighbour evidence: {service_id}"
            )
        _, station_id, _, prefecture, municipality = neighbor
        rows.insert(
            0 if neighbor[0] == "first" else len(rows),
            {
                "station_id": station_id,
                "prefecture": prefecture,
                "municipality": municipality,
                "in_area": "false",
            },
        )
    elif neighbor is not None:
        raise StageError(f"unexpected boundary-neighbour rule for {service_id}")
    return rows


def _make_registry(
    existing_rows: list[dict[str, str]],
    catalog_by_service: dict[str, list[dict[str, str]]],
    service_order: list[str],
) -> list[dict[str, str]]:
    existing_ids = {row["id"] for row in existing_rows}
    rows = list(existing_rows)
    representative: dict[str, dict[str, str]] = {}
    for service_id in service_order:
        for item in catalog_by_service[service_id]:
            representative.setdefault(item["station_id_proposed"], item)
    for station_id in station_order(
        [
            [item["station_id_proposed"] for item in catalog_by_service[sid]]
            for sid in service_order
        ]
    ):
        if station_id in existing_ids:
            continue
        item = representative[station_id]
        name = normalize_station_name(item["station_name_ja"])
        n02_name = N02_NAME_OVERRIDES.get((item["service_id"], station_id), "")
        rows.append(
            {
                "id": station_id,
                "name": name,
                "n02_name": n02_name,
                "prefecture": item["prefecture"],
                "municipality": item["municipality"],
                "representative_service_id": item["service_id"],
                "n02_selector": "",
            }
        )
    return rows


def _length_ref_rows(
    service_order: list[str],
    services: list[dict[str, Any]],
    catalog_by_service: dict[str, list[dict[str, str]]],
    assigned: set[str],
) -> list[dict[str, str]]:
    live_by_id = {item["id"]: item for item in services}
    rows: list[dict[str, str]] = []
    for service_id in service_order:
        if service_id not in assigned:
            continue
        catalog_rows = catalog_by_service[service_id]
        first, last = catalog_rows[0], catalog_rows[-1]
        if service_id in OFFICIAL_NEW_LENGTHS:
            km, _, _, source_url = OFFICIAL_NEW_LENGTHS[service_id]
            note = "Frozen-range official distance; raw N02 single-pair check pending."
            if service_id == "jr-ryomo":
                note = (
                    "Frozen 高崎–小山 range: 7.3 km 高崎–新前橋 (上越線) plus "
                    "84.4 km 新前橋–小山 (両毛線); raw N02 check pending."
                )
            rows.append(
                {
                    "service_id": service_id,
                    "from": first["station_name_ja"],
                    "to": last["station_name_ja"],
                    "km": f"{km:.3f}",
                    "source_url": source_url,
                    "n02_pair_sum_km": "",
                    "notes": note,
                }
            )
            continue
        live = live_by_id.get(service_id)
        if not live:
            continue
        source = live.get("lengthRef", {}).get("source", "")
        rows.append(
            {
                "service_id": service_id,
                "from": first["station_name_ja"],
                "to": last["station_name_ja"],
                "km": f"{live['lengthRef']['km']:.3f}",
                "source_url": JR_OFFICIAL_MILEAGE_PDF,
                "n02_pair_sum_km": "",
                "notes": f"Shipped baseline; added-pair formula pending measurement. Baseline source: {source}",
            }
        )
    return rows


def _write_baseline_hashes(region_root: Path, root: Path) -> None:
    baseline = root / "public/data"
    hashes = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(baseline.iterdir())
        if path.is_file()
    }
    _write_json(region_root / "baseline-sha256.json", hashes)


def _write_stage_readme(region_root: Path, region: str) -> None:
    (region_root / "README.md").write_text(
        f"""# {region} JR staging dataset

This stage starts from the shipped overrides and the hash-verified frozen JR catalog. It is isolated from `data/overrides` and `public/data`.

New stop pairs in `line_mapping.csv` carry the frozen catalog N02 line when it is unambiguous. Their `via`, `route`, and `compose` cells are intentionally empty: the region run must make those decisions from N02 route evidence. Existing shipped rows remain byte-for-byte unchanged.

Run `uv run python -m scripts.data_pipeline.stage_suburban_jr measure-pairs --region {region}` after the region has added its reviewed route and junction data. It writes `pair-evidence.csv` and `length-refs.csv`; new-service official distances are checked against raw N02 path sums with the fixed 1.5 km tolerance.

Added pairs are measured without shipped allow rows for an extended service: those rows enumerate the shipped route only. Shipped deny rows still apply. Rows first written in this stage apply either service-wide or to their declared `(from_id, to_id)` pair interval and must be found near an added pair. Limit an inherited allow list to the shipped stop interval before adding range-specific rules; the normal build and this measurement command resolve the same pair filter.
""",
        encoding="utf-8",
    )


def verify_freeze(freeze_path: Path | None = None, root: Path = ROOT) -> None:
    """Reject any staging operation if a frozen research input has drifted."""
    freeze = _json(
        freeze_path or root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
    )
    for name, expected in freeze["inputs"].items():
        path = root / name
        if (
            not path.is_file()
            or hashlib.sha256(path.read_bytes()).hexdigest() != expected
        ):
            raise StageError(f"frozen input hash mismatch: {name}")


def seed(region: str, *, root: Path = ROOT) -> Path:
    """Create a frozen, isolated region copy; refuse existing region output."""
    if region not in REGIONS:
        raise StageError(f"unknown region: {region}")
    verify_freeze(root=root)
    region_root = root / "data/staging/tokyo-suburban-jr" / region
    destination = region_root / "overrides"
    if region_root.exists():
        raise StageError(
            f"refusing to overwrite existing staging directory: {region_root}"
        )
    region_root.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(root / "data/overrides", destination)
        frozen_service_order, catalog_by_service = _frozen_jr_catalog(root)
        assigned = set(REGION_SERVICES[region])
        if not assigned <= set(frozen_service_order):
            raise StageError(
                f"frozen JR catalog lacks assigned services: {sorted(assigned - set(frozen_service_order))}"
            )
        live_services = _json(root / "data/overrides/services.json")["services"]
        live_by_id = {item["id"]: item for item in live_services}
        service_order = [
            service_id
            for service_id in frozen_service_order
            if service_id in live_by_id or service_id in assigned
        ]

        dataset_path = destination / "dataset.json"
        dataset = _json(dataset_path)
        dataset.update(
            {
                "areaName": "JR East suburban region (staging)",
                "areaPrefectures": STAGE_PREFECTURES,
                "outputBbox": OUTPUT_BBOX,
                "candidateSearchBbox": SEARCH_BBOX,
                "validationProfile": "stage",
                "stageStartStationId": "shimbashi",
                "serviceIds": service_order,
            }
        )
        dataset.pop("startStationId", None)
        dataset.pop("targetServiceId", None)

        services_path = destination / "services.json"
        services = _json(services_path)
        definitions = {item["id"]: item for item in services["services"]}
        frozen_metadata = _catalog_service_metadata(root)
        for service_id in service_order:
            if service_id not in definitions:
                catalog_rows = catalog_by_service[service_id]
                inventory = frozen_metadata[service_id]
                kind = inventory["service_type"]
                definitions[service_id] = {
                    "id": service_id,
                    "name": catalog_rows[0]["service_name_ja"],
                    "kind": kind,
                    "lineIds": [service_id],
                    "color": "#808080",
                    "circular": inventory["circular"] == "true",
                    "directionLabels": {},
                    "endpoints": {},
                    "expectedStopCount": len(catalog_rows),
                    "lengthRef": {},
                    "scopeSource": "Hash-verified frozen JR research catalog; boundary witnesses are pinned in R1 evidence.",
                    "areaPrefectures": STAGE_PREFECTURES,
                }
            definition = definitions[service_id]
            if service_id not in assigned:
                definition["areaPrefectures"] = FOUR_PREFECTURES
                continue
            catalog_rows = catalog_by_service[service_id]
            inventory = frozen_metadata[service_id]
            definition["name"] = catalog_rows[0]["service_name_ja"]
            definition["kind"] = inventory["service_type"]
            definition["circular"] = inventory["circular"] == "true"
            definition["directionLabels"] = {
                "forward": f"{catalog_rows[-1]['station_name_ja']}方面",
                "backward": f"{catalog_rows[0]['station_name_ja']}方面",
            }
            definition["endpoints"] = {
                "first": _endpoint_kind(inventory["first_end_kind"]),
                "last": _endpoint_kind(inventory["last_end_kind"]),
            }
            definition["expectedStopCount"] = len(catalog_rows)
            definition["areaPrefectures"] = STAGE_PREFECTURES
            definition["scopeSource"] = (
                "Hash-verified frozen JR research catalog; boundary witnesses are pinned in R1 evidence."
            )
            definition.setdefault("lengthRef", {})["toleranceKm"] = LENGTH_TOLERANCE_KM
            if service_id in OFFICIAL_NEW_LENGTHS:
                km, start_name, end_name, source_url = OFFICIAL_NEW_LENGTHS[service_id]
                definition["lengthRef"] = {
                    "km": km,
                    "toleranceKm": LENGTH_TOLERANCE_KM,
                    "source": f"Official operating distance {start_name}–{end_name}: {km:.1f} km ({source_url}); raw N02 comparison recorded by measure-pairs.",
                }
            stops_path = destination / "services" / service_id / "stops.csv"
            stops = _make_stops(
                service_id,
                catalog_rows,
                root / "data/overrides/services" / service_id / "stops.csv",
            )
            stops_path.parent.mkdir(parents=True, exist_ok=True)
            _write_csv(stops_path, list(STOPS_FIELDS), stops)
            existing_line_path = (
                root / "data/overrides/services" / service_id / "line_mapping.csv"
            )
            line_rows = _make_line_mapping(service_id, catalog_rows, existing_line_path)
            line_fields = (
                _csv(existing_line_path)[0]
                if existing_line_path.is_file()
                else list(LINE_FIELDS)
            )
            for field in LINE_FIELDS:
                if field not in line_fields:
                    line_fields.append(field)
            line_path = destination / "services" / service_id / "line_mapping.csv"
            _write_csv(line_path, line_fields, line_rows)
            if service_id in KNOWN_JUNCTIONS:
                junction_path = (
                    destination / "services" / service_id / JUNCTIONS_OVERRIDE_FILE
                )
                if junction_path.exists():
                    raise StageError(
                        f"shipped junction rules already exist: {service_id}"
                    )
                _write_csv(
                    junction_path,
                    list(JUNCTION_FIELDS),
                    list(KNOWN_JUNCTIONS[service_id]),
                )
            scope = _make_scope(
                service_id,
                catalog_rows,
                definition["endpoints"]["first"],
                definition["endpoints"]["last"],
                {row["id"]: row for row in _csv(destination / "stations.csv")[1]},
            )
            _write_csv(
                destination / "services" / service_id / "scope.csv",
                list(SCOPE_FIELDS),
                scope,
            )
            definition["stationNumberRules"] = {
                "sequence": [row["station_number"] for row in stops],
                "reason": "Frozen JR stop order; shipped station numbers are retained and added stops are intentionally blank.",
            }

        # New services need a line metadata entry; existing colors and line ids stay intact.
        line_entries = {item["id"]: item for item in services["lines"]}
        for service_id in service_order:
            if service_id in live_by_id:
                continue
            item = frozen_metadata[service_id]
            line_entries[service_id] = {
                "id": service_id,
                "name": item["line_name"],
                "color": "#808080",
            }
        services["lines"] = list(line_entries.values())
        services["services"] = [definitions[service_id] for service_id in service_order]
        _write_json(services_path, services)

        _, registry_rows = _csv(destination / "stations.csv")
        assigned_order = [sid for sid in frozen_service_order if sid in assigned]
        registry = _make_registry(registry_rows, catalog_by_service, assigned_order)
        registry_fields = _csv(destination / "stations.csv")[0]
        _write_csv(
            destination / "stations.csv",
            registry_fields,
            [
                {field: row.get(field, "") for field in registry_fields}
                for row in registry
            ],
        )

        for service_id in service_order:
            if service_id in assigned:
                continue
            service_dir = destination / "services" / service_id
            _, stops = _csv(service_dir / "stops.csv")
            scope_path = service_dir / "scope.csv"
            scope_fields, scope_rows = _csv(scope_path)
            stop_ids = {row["station_id"] for row in stops}
            if "in_area" not in scope_fields:
                scope_fields.append("in_area")
            for row in scope_rows:
                row["in_area"] = "true" if row["station_id"] in stop_ids else "false"
            _write_csv(scope_path, scope_fields, scope_rows)

        expected_services = []
        for service_id in service_order:
            catalog_rows = catalog_by_service[service_id]
            if service_id in assigned:
                station_ids = [row["station_id_proposed"] for row in catalog_rows]
            else:
                shipped_ids = {
                    row["station_id"]
                    for row in _csv(
                        root / "data/overrides/services" / service_id / "stops.csv"
                    )[1]
                }
                station_ids = [
                    row["station_id_proposed"]
                    for row in catalog_rows
                    if row["station_id_proposed"] in shipped_ids
                ]
                if set(station_ids) != shipped_ids:
                    raise StageError(
                        f"shipped stops are not represented in the frozen catalog: {service_id}"
                    )
            expected_services.append({"id": service_id, "stationIds": station_ids})
        expected = {
            "services": expected_services,
            "stationIds": list(
                station_order(row["stationIds"] for row in expected_services)
            ),
        }
        expected_path = destination / "expected-catalog.json"
        _write_json(expected_path, expected)
        dataset["expectedCatalogFile"] = expected_path.name
        dataset["expectedCatalogSha256"] = hashlib.sha256(
            expected_path.read_bytes()
        ).hexdigest()
        _write_json(dataset_path, dataset)

        _write_csv(
            region_root / "length-refs.csv",
            list(LENGTH_REF_FIELDS),
            _length_ref_rows(
                service_order, live_services, catalog_by_service, assigned
            ),
        )
        _write_csv(region_root / "pair-evidence.csv", list(PAIR_EVIDENCE_FIELDS), [])
        _write_baseline_hashes(region_root, root)
        _write_stage_readme(region_root, region)
        return destination
    except Exception:
        if region_root.exists():
            shutil.rmtree(region_root)
        raise


def parse_length_refs(path: Path) -> list[dict[str, str]]:
    """Read the exact staging mileage schema and reject malformed references."""
    fields, rows = _csv(path)
    if tuple(fields) != LENGTH_REF_FIELDS:
        raise StageError(f"{path.name} must use columns {list(LENGTH_REF_FIELDS)}")
    seen: set[str] = set()
    for row in rows:
        if not all(
            row.get(field, "") for field in ("service_id", "from", "to", "source_url")
        ):
            raise StageError(f"{path.name} has an incomplete service mileage row")
        if row["service_id"] in seen:
            raise StageError(f"{path.name} repeats service {row['service_id']}")
        seen.add(row["service_id"])
        try:
            km = float(row["km"])
            pair_sum = float(row["n02_pair_sum_km"]) if row["n02_pair_sum_km"] else None
        except ValueError as error:
            raise StageError(f"{path.name} has a nonnumeric distance") from error
        if (
            not math.isfinite(km)
            or km <= 0
            or (pair_sum is not None and (not math.isfinite(pair_sum) or pair_sum <= 0))
        ):
            raise StageError(f"{path.name} distances must be finite and positive")
    return rows


def check_length_tolerance(official_km: float, n02_pair_sum_km: float) -> None:
    """Enforce the fixed official-to-N02 validation band without adjustment."""
    difference = abs(official_km - n02_pair_sum_km)
    if difference > LENGTH_TOLERANCE_KM:
        raise StageError(
            f"official/N02 distance differs by {difference:.3f} km "
            f"(official {official_km:.3f}, N02 {n02_pair_sum_km:.3f}; "
            f"tolerance {LENGTH_TOLERANCE_KM:.1f} km)"
        )


def _stop_resolution(
    overrides: Overrides, service: ServiceOverrides, stop: Stop
) -> tuple[StopResolution, Any]:
    stations = overrides.registry.by_id()
    station = stations[stop.station_id]
    representative = overrides.service(station.representative_service_id)
    registry_operator = station.n02_operator or representative.effective_n02_operator(
        overrides.dataset
    )
    return (
        service.resolve_stop(stop, station, overrides.dataset, registry_operator),
        station,
    )


def _candidate_options(
    stop: Stop,
    resolution: StopResolution,
    station: Any,
    source: Any,
    lines: set[str],
) -> list[PlatformCandidate]:
    if not lines:
        return []
    candidates = source.platform_candidates([resolution.match_name], lines)
    options = [
        candidate
        for candidate in candidates
        if candidate.match_name == resolution.match_name
        and (not candidate.operator or candidate.operator == resolution.source_operator)
        and candidate.n02_line in lines
        and stop.platform_selector.matches(candidate)
        and (
            not resolution.registry_selector_applies
            or station.n02_selector.matches(candidate)
        )
    ]
    groups = {candidate.group_code for candidate in options}
    selector_pins = stop.platform_selector.pins_group or (
        resolution.registry_selector_applies and station.n02_selector.pins_group
    )
    if len(groups) > 1 and not selector_pins:
        raise RoutingError(
            f"ambiguous N02 platform groups for {stop.station_id}: {sorted(groups)}"
        )
    distinct: dict[tuple[str, str, float, float], PlatformCandidate] = {}
    for candidate in options:
        key = (
            candidate.operator,
            candidate.n02_line,
            round(candidate.midpoint.x, 3),
            round(candidate.midpoint.y, 3),
        )
        distinct.setdefault(key, candidate)
    if not distinct:
        raise RoutingError(f"no N02 platform for {stop.station_id} on {sorted(lines)}")
    return list(distinct.values())


WindowKeys = dict[tuple[str, str], frozenset[str]]


def _section_identity(row: Mapping[str, str], default_operator: str) -> tuple[str, ...]:
    return (
        row.get("n02_operator", "") or default_operator,
        row["n02_line"],
        row["action"],
        row["section_key"],
    )


def _junction_identity(rule: JunctionRule) -> tuple[str | float, ...]:
    return (
        rule.n02_operator,
        rule.n02_line,
        rule.section_key,
        rule.peer_section_key,
        rule.lon,
        rule.lat,
    )


@dataclass(frozen=True)
class AddedRangeConstraints:
    """Section and junction constraints for measuring one service's added pairs."""

    section_filters: Mapping[tuple[str, str], SectionFilter] = field(
        default_factory=dict
    )
    # Keys first written in staging; each must be found near some added pair.
    reviewed_keys: Mapping[tuple[str, str], frozenset[str]] = field(
        default_factory=dict
    )
    junction_rules: tuple[JunctionRule, ...] = ()
    scoped_section_filters: Mapping[tuple[str, str, str, str], SectionFilter] = field(
        default_factory=dict
    )
    scoped_reviewed_keys: Mapping[tuple[str, str, str, str], frozenset[str]] = field(
        default_factory=dict
    )


def added_range_constraints(
    service: ServiceOverrides,
    overrides_dir: Path,
    live_dir: Path,
    default_operator: str,
) -> AddedRangeConstraints:
    """Constraints that apply to pairs added to a shipped service in staging.

    The live build scopes ``sections.csv`` per (operator, line) for the whole
    service. A shipped allow list enumerates the shipped route, so added ranges
    do not inherit it. Shipped deny rows keep their service-wide meaning, as in
    the build. Rows and junction rules first written in staging apply in full.
    """
    staged_dir = overrides_dir / "services" / service.id
    shipped_dir = live_dir / "services" / service.id
    filters: dict[tuple[str, str], SectionFilter] = {}
    scoped_filters: dict[tuple[str, str, str, str], SectionFilter] = {}
    reviewed_keys: dict[tuple[str, str], frozenset[str]] = {}
    scoped_reviewed_keys: dict[tuple[str, str, str, str], frozenset[str]] = {}
    staged_sections = staged_dir / "sections.csv"
    if staged_sections.is_file():
        shipped_sections = shipped_dir / "sections.csv"
        inherited = {
            _section_identity(row, default_operator)
            for row in (_csv(shipped_sections)[1] if shipped_sections.is_file() else [])
        }
        staged_rows = _csv(staged_sections)[1]
        shipped_stops = shipped_dir / "stops.csv"
        old_stop_ids = (
            [row["station_id"] for row in _csv(shipped_stops)[1]]
            if shipped_stops.is_file()
            else []
        )
        old_window = (old_stop_ids[0], old_stop_ids[-1]) if old_stop_ids else None

        def is_inherited_rule(row: Mapping[str, str]) -> bool:
            if _section_identity(row, default_operator) not in inherited:
                return False
            from_id, to_id = row.get("from_id", ""), row.get("to_id", "")
            return not from_id and not to_id or (from_id, to_id) == old_window

        def is_inherited_allow(row: Mapping[str, str]) -> bool:
            return row["action"] == "allow" and is_inherited_rule(row)

        effective_rows = [row for row in staged_rows if not is_inherited_allow(row)]
        if effective_rows:
            global_rules: dict[tuple[str, str], list[tuple[str, str]]] = {}
            range_rules: dict[tuple[str, str, str, str], list[tuple[str, str]]] = {}
            for row in effective_rows:
                operator, line, action, key = _section_identity(row, default_operator)
                from_id, to_id = row.get("from_id", ""), row.get("to_id", "")
                if from_id or to_id:
                    if not from_id or not to_id:
                        raise StageError(
                            f"{service.id} section range needs both endpoint ids"
                        )
                    range_rules.setdefault((operator, line, from_id, to_id), []).append(
                        (action, key)
                    )
                else:
                    global_rules.setdefault((operator, line), []).append((action, key))
            try:
                filters = {
                    key: build_section_filter(rules)
                    for key, rules in global_rules.items()
                }
                scoped_filters = {
                    key: build_section_filter(rules)
                    for key, rules in range_rules.items()
                }
            except ValueError as error:
                raise StageError(
                    f"{service.id} staged section filters: {error}"
                ) from error
        reviewed: dict[tuple[str, str], set[str]] = {}
        scoped_reviewed: dict[tuple[str, str, str, str], set[str]] = {}
        for row in staged_rows:
            identity = _section_identity(row, default_operator)
            if not is_inherited_rule(row):
                from_id, to_id = row.get("from_id", ""), row.get("to_id", "")
                if from_id and to_id:
                    scoped_reviewed.setdefault(
                        (identity[0], identity[1], from_id, to_id), set()
                    ).add(row["section_key"])
                else:
                    reviewed.setdefault((identity[0], identity[1]), set()).add(
                        row["section_key"]
                    )
        reviewed_keys = {key: frozenset(value) for key, value in reviewed.items()}
        scoped_reviewed_keys = {
            key: frozenset(value) for key, value in scoped_reviewed.items()
        }
    shipped_junctions = shipped_dir / JUNCTIONS_OVERRIDE_FILE
    inherited_junctions = (
        {
            _junction_identity(rule)
            for rule in parse_junction_rows(_csv(shipped_junctions)[1])
        }
        if shipped_junctions.is_file()
        else set()
    )
    junctions = tuple(
        rule
        for rule in service.junction_rules
        if _junction_identity(rule) not in inherited_junctions
    )
    return AddedRangeConstraints(
        filters,
        reviewed_keys,
        junctions,
        scoped_section_filters=scoped_filters,
        scoped_reviewed_keys=scoped_reviewed_keys,
    )


def _window_filter(
    section_filter: SectionFilter, window_keys: frozenset[str], label: str
) -> SectionFilter:
    """The same admitted sections, restricted to the keys of one pair window."""
    allow = section_filter.allow & window_keys
    if section_filter.allow and not allow:
        raise RoutingError(f"{label}: the reviewed allow list admits no section here")
    return SectionFilter(allow=allow, deny=section_filter.deny & window_keys)


def _measure_pair(
    overrides: Overrides,
    service_id: str,
    pair_index: int,
    provider: N02SourceProvider,
    catalog_rows: list[dict[str, str]],
    constraints: AddedRangeConstraints,
) -> tuple[dict[str, str], WindowKeys]:
    service = overrides.service(service_id)
    ranges = service.segment_ranges()
    if service.circular or not 0 <= pair_index < len(ranges):
        raise StageError(f"invalid open-service pair index: {service_id}:{pair_index}")
    item = ranges[pair_index]
    lines = item.route_lines
    if not lines:
        fallback = catalog_rows[pair_index]["n02_line"]
        if not fallback:
            raise StageError(f"no frozen N02 line for {service_id} pair {pair_index}")
        lines = (fallback,)
        operators = (
            item.n02_operator or service.effective_n02_operator(overrides.dataset),
        )
    else:
        operators = service.range_operators(item, overrides.dataset)
    if len(lines) != len(operators) or any(not line for line in lines):
        raise StageError(
            f"incomplete N02 route mapping for {service_id} pair {pair_index}"
        )

    origin_stop, destination_stop = service.stops[pair_index : pair_index + 2]
    origin_resolution, origin_station = _stop_resolution(
        overrides, service, origin_stop
    )
    destination_resolution, destination_station = _stop_resolution(
        overrides, service, destination_stop
    )
    first_source = provider.for_operator(origin_resolution.source_operator)
    last_source = provider.for_operator(destination_resolution.source_operator)
    origin_options = _candidate_options(
        origin_stop,
        origin_resolution,
        origin_station,
        first_source,
        {lines[0]},
    )
    destination_options = _candidate_options(
        destination_stop,
        destination_resolution,
        destination_station,
        last_source,
        {lines[-1]},
    )
    route_points = [
        candidate.midpoint for candidate in (*origin_options, *destination_options)
    ]
    route_points.extend(to_metric_point(point) for point in item.via)
    joints = item.route.joints if item.route else ()
    route_points.extend(to_metric_point(point) for point in joints)

    sections_by_key: dict[tuple[str, str], Any] = {}
    window_keys: WindowKeys = {}
    station_indexes = {
        station_id: index for index, station_id in enumerate(service.station_ids)
    }
    for line, operator in zip(lines, operators, strict=True):
        source = provider.for_operator(operator)
        sections = source.track_sections([line], route_points)[line]
        keys = frozenset(section.key for section in sections)
        window_keys[(operator, line)] = keys
        label = f"{service_id}/{operator}/{line}"
        scoped_rules: list[tuple[str, str]] = []
        for (
            rule_operator,
            rule_line,
            rule_from,
            rule_to,
        ), rule_filter in constraints.scoped_section_filters.items():
            if (
                rule_operator != operator
                or rule_line != line
                or rule_from not in station_indexes
                or rule_to not in station_indexes
                or not station_indexes[rule_from]
                <= pair_index
                < station_indexes[rule_to]
            ):
                continue
            scoped_rules.extend(("allow", key) for key in rule_filter.allow)
            scoped_rules.extend(("deny", key) for key in rule_filter.deny)
        try:
            pair_scoped_filter = build_section_filter(scoped_rules)
        except ValueError as error:
            raise RoutingError(
                f"{label}: conflicting scoped filters: {error}"
            ) from error
        window_filter = _window_filter(
            _merge_section_filters(
                constraints.section_filters.get((operator, line), OPEN_SECTIONS),
                pair_scoped_filter,
                label,
            ),
            keys,
            label,
        )
        # A split only matters where its peer can attach, so a rule applies
        # when both sections are in this window and must then resolve exactly
        # as in the build; every rule must apply to some added pair (see
        # ``unresolved_reviewed_constraints``).
        junctions = tuple(
            rule
            for rule in constraints.junction_rules
            if rule.n02_operator == operator
            and rule.n02_line == line
            and {rule.section_key, rule.peer_section_key} <= keys
        )
        sections_by_key[(operator, line)] = filtered_network(
            sections, window_filter, label, junctions
        )
    networks = tuple(
        sections_by_key[(operator, line)]
        for line, operator in zip(lines, operators, strict=True)
    )
    route = PairRoute(
        network=networks[0],
        via=tuple(to_metric_point(point) for point in item.via),
        networks=networks if item.route else (),
        joints=tuple(to_metric_point(point) for point in joints),
        line_order=item.route.lines if item.route else (),
        operator_order=operators if item.route else (),
    )
    routed = route_path([origin_options, destination_options], [route])
    from_platform, to_platform = routed.chosen
    path = routed.paths[0]
    return {
        "service_id": service_id,
        "from_id": origin_stop.station_id,
        "to_id": destination_stop.station_id,
        "n02_operator": " -> ".join(operators),
        "from_platform_code": from_platform.station_code,
        "from_group_code": from_platform.group_code,
        "to_platform_code": to_platform.station_code,
        "to_group_code": to_platform.group_code,
        "n02_line": " -> ".join(lines),
        "path_length_km": f"{path.length / 1000:.6f}",
        "start_snap_m": f"{path.start_offset:.3f}",
        "end_snap_m": f"{path.end_offset:.3f}",
        "status": "pass",
        "notes": "Raw N02 constrained single-pair route.",
    }, window_keys


def _merge_section_filters(
    global_filter: SectionFilter, scoped_filter: SectionFilter, label: str
) -> SectionFilter:
    try:
        return build_section_filter(
            [
                *(("allow", key) for key in global_filter.allow),
                *(("deny", key) for key in global_filter.deny),
                *(("allow", key) for key in scoped_filter.allow),
                *(("deny", key) for key in scoped_filter.deny),
            ]
        )
    except ValueError as error:
        raise RoutingError(f"{label}: conflicting section filters: {error}") from error


def measure_single_pair(
    overrides: Overrides,
    service_id: str,
    pair_index: int,
    provider: N02SourceProvider,
    catalog_rows: list[dict[str, str]],
    *,
    constraints: AddedRangeConstraints | None = None,
) -> dict[str, str]:
    """Route one added stop pair on its declared raw N02 line(s).

    ``constraints`` comes from ``added_range_constraints``; shipped allow lists
    never apply to added pairs.
    """
    return _measure_pair(
        overrides,
        service_id,
        pair_index,
        provider,
        catalog_rows,
        constraints or AddedRangeConstraints(),
    )[0]


def unresolved_reviewed_constraints(
    constraints: AddedRangeConstraints,
    windows: list[WindowKeys],
    scoped_windows: Mapping[tuple[str, str], WindowKeys] | None = None,
    station_ids: Sequence[str] = (),
) -> list[str]:
    """Reviewed keys that no measured added-pair window contains (stale rules)."""
    seen: dict[tuple[str, str], set[str]] = {}
    for window in windows:
        for key, values in window.items():
            seen.setdefault(key, set()).update(values)
    problems = [
        f"{operator}/{line}: reviewed section keys not found near any added pair "
        f"{sorted(stale)}"
        for (operator, line), keys in sorted(constraints.reviewed_keys.items())
        if (stale := keys - seen.get((operator, line), set()))
    ]
    indexes = {station_id: index for index, station_id in enumerate(station_ids)}
    for (operator, line, from_id, to_id), keys in sorted(
        constraints.scoped_reviewed_keys.items()
    ):
        first, last = indexes.get(from_id), indexes.get(to_id)
        if first is None or last is None or first >= last:
            problems.append(
                f"{operator}/{line} {from_id}->{to_id}: reviewed range is invalid"
            )
            continue
        applicable = {
            section_key
            for pair_index in range(first, last)
            if (
                window := (scoped_windows or {}).get(
                    (station_ids[pair_index], station_ids[pair_index + 1])
                )
            )
            is not None
            for section_key in window.get((operator, line), frozenset())
        }
        if stale := keys - applicable:
            problems.append(
                f"{operator}/{line} {from_id}->{to_id}: reviewed section keys not found near covered pairs {sorted(stale)}"
            )
    problems.extend(
        f"{rule.n02_operator}/{rule.n02_line}: junction rule not near any added pair "
        f"{rule.section_key}"
        for rule in constraints.junction_rules
        if not any(
            {rule.section_key, rule.peer_section_key}
            <= window.get((rule.n02_operator, rule.n02_line), frozenset())
            for window in windows
        )
    )
    return problems


def _new_pair_indexes(
    service_id: str, service: ServiceOverrides, root: Path
) -> list[int]:
    live_stops = root / "data/overrides/services" / service_id / "stops.csv"
    if not live_stops.is_file():
        return list(range(len(service.stops) - 1))
    old_ids = [row["station_id"] for row in _csv(live_stops)[1]]
    old_pairs = set(zip(old_ids, old_ids[1:], strict=False))
    return [
        index
        for index, (origin, destination) in enumerate(
            zip(service.station_ids, service.station_ids[1:], strict=False)
        )
        if (origin, destination) not in old_pairs
    ]


def measure_pairs(region: str, *, root: Path = ROOT) -> Path:
    """Measure newly added region pairs and update independent length references."""
    if region not in REGIONS:
        raise StageError(f"unknown region: {region}")
    verify_freeze(root=root)
    region_root = root / "data/staging/tokyo-suburban-jr" / region
    overrides_dir = region_root / "overrides"
    if not overrides_dir.is_dir():
        raise StageError(f"region staging directory is missing: {overrides_dir}")
    overrides = load_overrides(overrides_dir)
    _, catalog_by_service = _frozen_jr_catalog(root)
    provider = N02SourceProvider(
        root / "N02-25_GML/UTF-8", overrides.dataset.candidate_search_bbox
    )
    evidence: list[dict[str, str]] = []
    failures: list[str] = []
    measurements: dict[str, list[tuple[int, dict[str, str]]]] = {}
    for service_id in REGION_SERVICES[region]:
        service = overrides.service(service_id)
        constraints = added_range_constraints(
            service,
            overrides_dir,
            root / "data/overrides",
            service.effective_n02_operator(overrides.dataset),
        )
        rows: list[tuple[int, dict[str, str]]] = []
        windows: list[WindowKeys] = []
        scoped_windows: dict[tuple[str, str], WindowKeys] = {}
        for pair_index in _new_pair_indexes(service_id, service, root):
            try:
                row, window = _measure_pair(
                    overrides,
                    service_id,
                    pair_index,
                    provider,
                    catalog_by_service[service_id],
                    constraints,
                )
                windows.append(window)
                scoped_windows[(row["from_id"], row["to_id"])] = window
            except (OSError, KeyError, ValueError, RuntimeError) as error:
                origin = service.station_ids[pair_index]
                destination = service.station_ids[pair_index + 1]
                row = {
                    "service_id": service_id,
                    "from_id": origin,
                    "to_id": destination,
                    "n02_operator": service.effective_n02_operator(overrides.dataset),
                    "from_platform_code": "",
                    "from_group_code": "",
                    "to_platform_code": "",
                    "to_group_code": "",
                    "n02_line": " -> ".join(
                        service.segment_ranges()[pair_index].route_lines
                    )
                    or catalog_by_service[service_id][pair_index]["n02_line"],
                    "path_length_km": "",
                    "start_snap_m": "",
                    "end_snap_m": "",
                    "status": "failed",
                    "notes": str(error),
                }
                failures.append(f"{service_id}:{origin}~{destination}: {error}")
            rows.append((pair_index, row))
            evidence.append(row)
        if all(row["status"] == "pass" for _, row in rows):
            failures.extend(
                f"{service_id}: {problem}"
                for problem in unresolved_reviewed_constraints(
                    constraints, windows, scoped_windows, service.station_ids
                )
            )
        measurements[service_id] = rows
    _write_csv(region_root / "pair-evidence.csv", list(PAIR_EVIDENCE_FIELDS), evidence)

    refs_path = region_root / "length-refs.csv"
    references = parse_length_refs(refs_path)
    reference_by_id = {row["service_id"]: row for row in references}
    staged_services_path = overrides_dir / "services.json"
    service_payload = _json(staged_services_path)
    definitions = {row["id"]: row for row in service_payload["services"]}
    live_definitions = {
        row["id"]: row
        for row in _json(root / "data/overrides/services.json")["services"]
    }
    for service_id in REGION_SERVICES[region]:
        if service_id not in reference_by_id:
            continue
        rows = measurements.get(service_id, [])
        if not rows or any(row["status"] != "pass" for _, row in rows):
            reference_by_id[service_id]["notes"] += (
                " Measurement incomplete; see pair-evidence.csv."
            )
            continue
        pair_sum = sum(float(row["path_length_km"]) for _, row in rows)
        reference = reference_by_id[service_id]
        reference["n02_pair_sum_km"] = f"{pair_sum:.3f}"
        if service_id in OFFICIAL_NEW_LENGTHS:
            official_km = float(reference["km"])
            try:
                check_length_tolerance(official_km, pair_sum)
            except StageError as error:
                reference["notes"] = f"Distance mismatch: {error}"
                failures.append(f"{service_id}: {error}")
            else:
                reference["notes"] = (
                    "Official frozen-range mileage agrees with the raw N02 single-pair sum within 1.5 km."
                )
                definitions[service_id]["lengthRef"]["source"] = (
                    f"Official operating distance {official_km:.1f} km ({reference['source_url']}); "
                    f"raw N02 single-pair paths sum to {pair_sum:.3f} km; see length-refs.csv."
                )
            continue
        baseline = live_definitions[service_id]["lengthRef"]
        extended_km = float(baseline["km"]) + pair_sum
        definitions[service_id]["lengthRef"] = {
            "km": round(extended_km, 3),
            "toleranceKm": LENGTH_TOLERANCE_KM,
            "source": (
                f"{baseline['source']} plus {pair_sum:.3f} km raw-N02 paths for "
                f"{len(rows)} added pairs; see length-refs.csv."
            ),
        }
        reference["km"] = f"{extended_km:.3f}"
        reference["notes"] = (
            f"Shipped lengthRef {float(baseline['km']):.3f} km plus {pair_sum:.3f} km "
            f"raw-N02 paths for {len(rows)} added pairs; baseline source: {baseline['source']}"
        )
    _write_csv(refs_path, list(LENGTH_REF_FIELDS), references)
    _write_json(staged_services_path, service_payload)
    if failures:
        raise StageError("pair measurement failed: " + " | ".join(failures))
    return region_root / "pair-evidence.csv"


def assemble(*, root: Path = ROOT) -> Path:
    """Merge all region-owned service edits into a new combined stage."""
    verify_freeze(root=root)
    combined_root = root / "data/staging/tokyo-suburban-jr/combined"
    destination = combined_root / "overrides"
    if combined_root.exists():
        raise StageError(
            f"refusing to overwrite existing staging directory: {combined_root}"
        )

    frozen_order, catalog_by_service = _frozen_jr_catalog(root)
    region_data: dict[str, dict[str, Any]] = {}
    service_owner: dict[str, str] = {}
    baseline_hashes: dict[str, str] | None = None
    pair_evidence: list[dict[str, str]] = []
    length_references: list[dict[str, str]] = []
    for region in REGIONS:
        region_root = root / "data/staging/tokyo-suburban-jr" / region
        overrides_dir = region_root / "overrides"
        if not overrides_dir.is_dir():
            raise StageError(f"region staging directory is missing: {overrides_dir}")
        services = _json(overrides_dir / "services.json")
        definitions = {row["id"]: row for row in services["services"]}
        for service_id in REGION_SERVICES[region]:
            if service_id in service_owner:
                raise StageError(
                    f"service assigned more than once: {service_id} ({service_owner[service_id]}, {region})"
                )
            if service_id not in definitions:
                raise StageError(f"assigned service is missing: {region}/{service_id}")
            service_owner[service_id] = region
        baseline = _json(region_root / "baseline-sha256.json")
        if baseline_hashes is None:
            baseline_hashes = baseline
        elif baseline != baseline_hashes:
            raise StageError(f"region baseline hashes differ: {region}")
        evidence_fields, evidence_rows = _csv(region_root / "pair-evidence.csv")
        if tuple(evidence_fields) != PAIR_EVIDENCE_FIELDS:
            raise StageError(f"invalid pair evidence schema: {region}")
        pair_evidence.extend(evidence_rows)
        length_references.extend(parse_length_refs(region_root / "length-refs.csv"))
        region_data[region] = {
            "root": region_root,
            "overrides": overrides_dir,
            "services": services,
            "definitions": definitions,
        }

    if set(service_owner) != set(ALL_ASSIGNED_SERVICES):
        missing = sorted(set(ALL_ASSIGNED_SERVICES) - set(service_owner))
        raise StageError(f"assigned service coverage is incomplete: {missing}")
    length_reference_ids = [row["service_id"] for row in length_references]
    if len(length_reference_ids) != len(set(length_reference_ids)) or set(
        length_reference_ids
    ) != set(ALL_ASSIGNED_SERVICES):
        raise StageError(
            "region length-reference inventory is incomplete or duplicated"
        )

    live_overrides = root / "data/overrides"
    merged_dataset_rows: dict[str, list[dict[str, str]]] = {}
    dataset_additions: dict[str, list[dict[str, str]]] = {}
    for filename, key_fields in DATASET_LEVEL_FILES.items():
        live_fields, live_rows = _csv(live_overrides / filename)
        live_by_key: dict[tuple[str, ...], dict[str, str]] = {}
        for row in live_rows:
            key = tuple(row[field] for field in key_fields)
            if key in live_by_key:
                raise StageError(f"duplicate live row in {filename}: {key}")
            live_by_key[key] = row

        added_by_key: dict[tuple[str, ...], dict[str, str]] = {}
        added_rows: list[dict[str, str]] = []
        for region in REGIONS:
            path = region_data[region]["overrides"] / filename
            fields, rows = _csv(path)
            if fields != live_fields:
                raise StageError(
                    f"dataset-level CSV schema differs: {region}/{filename}"
                )
            region_by_key: dict[tuple[str, ...], dict[str, str]] = {}
            for row in rows:
                key = tuple(row[field] for field in key_fields)
                if key in region_by_key:
                    raise StageError(f"duplicate row in {region}/{filename}: {key}")
                region_by_key[key] = row
            for key, live_row in live_by_key.items():
                if key not in region_by_key:
                    raise StageError(f"live row deleted in {region}/{filename}: {key}")
                if region_by_key[key] != live_row:
                    raise StageError(f"live row modified in {region}/{filename}: {key}")
            for key, row in region_by_key.items():
                if key in live_by_key:
                    continue
                previous = added_by_key.get(key)
                if previous is not None and previous != row:
                    raise StageError(
                        f"dataset-level row conflicts across regions in {filename}: {key}"
                    )
                if previous is None:
                    added_by_key[key] = row
                    added_rows.append(row)
        merged_dataset_rows[filename] = [*live_rows, *added_rows]
        dataset_additions[filename] = added_rows

    live_services = _json(live_overrides / "services.json")
    live_definitions = {row["id"]: row for row in live_services["services"]}
    if not set(live_definitions) <= set(frozen_order):
        raise StageError(
            "shipped service inventory is not contained in frozen JR catalog"
        )
    merged_definitions = dict(live_definitions)
    merged_lines = {row["id"]: row for row in live_services["lines"]}
    for region in REGIONS:
        payload = region_data[region]["services"]
        definitions = region_data[region]["definitions"]
        for service_id in REGION_SERVICES[region]:
            merged_definitions[service_id] = definitions[service_id]
        for line in payload["lines"]:
            existing = merged_lines.get(line["id"])
            if existing is not None and existing != line:
                raise StageError(
                    f"line metadata conflicts while assembling: {line['id']}"
                )
            merged_lines[line["id"]] = line
    if set(merged_definitions) != set(frozen_order):
        raise StageError("combined service inventory differs from frozen JR catalog")

    _, live_registry_rows = _csv(live_overrides / "stations.csv")
    live_registry = {row["id"]: row for row in live_registry_rows}
    new_registry: dict[str, dict[str, str]] = {}
    for region in REGIONS:
        fields, rows = _csv(region_data[region]["overrides"] / "stations.csv")
        live_fields = _csv(live_overrides / "stations.csv")[0]
        if fields != live_fields:
            raise StageError(f"station registry schema differs: {region}")
        for row in rows:
            station_id = row["id"]
            if station_id in live_registry:
                if row != live_registry[station_id]:
                    raise StageError(
                        f"shipped station changed in {region}: {station_id}"
                    )
                continue
            previous = new_registry.get(station_id)
            comparable = {
                key: value
                for key, value in row.items()
                if key != "representative_service_id"
            }
            if previous is not None:
                previous_comparable = {
                    key: value
                    for key, value in previous.items()
                    if key != "representative_service_id"
                }
                if comparable != previous_comparable:
                    raise StageError(
                        f"shared station registry values conflict: {station_id}"
                    )
            else:
                new_registry[station_id] = row

    global_representative: dict[str, str] = {}
    for service_id in frozen_order:
        for row in catalog_by_service[service_id]:
            global_representative.setdefault(row["station_id_proposed"], service_id)

    combined_root.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(live_overrides, destination)
        for filename, rows in merged_dataset_rows.items():
            fields = _csv(live_overrides / filename)[0]
            _write_csv(destination / filename, fields, rows)
        for service_id, region in service_owner.items():
            source = region_data[region]["overrides"] / "services" / service_id
            target = destination / "services" / service_id
            if not source.is_dir():
                raise StageError(
                    f"assigned service files are missing: {region}/{service_id}"
                )
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)

        registry_fields = _csv(live_overrides / "stations.csv")[0]
        new_station_order = station_order(
            [
                [row["station_id_proposed"] for row in catalog_by_service[sid]]
                for sid in frozen_order
                if sid in service_owner
            ]
        )
        registry_rows = list(live_registry_rows)
        for station_id in new_station_order:
            if station_id in live_registry:
                continue
            row = new_registry.get(station_id)
            representative = global_representative.get(station_id)
            if row is None or representative is None:
                raise StageError(
                    f"assigned station registry entry is missing: {station_id}"
                )
            merged = dict(row)
            merged["representative_service_id"] = representative
            n02_name = N02_NAME_OVERRIDES.get((representative, station_id))
            if n02_name:
                merged["n02_name"] = n02_name
            registry_rows.append(merged)
        _write_csv(destination / "stations.csv", registry_fields, registry_rows)

        combined_lines = dict(merged_lines)
        services_payload = {
            **live_services,
            "lines": list(combined_lines.values()),
            "services": [
                {
                    **merged_definitions[service_id],
                    **(
                        {}
                        if service_id in service_owner
                        else {"areaPrefectures": FOUR_PREFECTURES}
                    ),
                }
                for service_id in frozen_order
            ],
        }
        _write_json(destination / "services.json", services_payload)

        for service_id in frozen_order:
            if service_id in service_owner:
                continue
            definition = merged_definitions[service_id]
            definition["areaPrefectures"] = FOUR_PREFECTURES
            service_dir = destination / "services" / service_id
            stops = _csv(service_dir / "stops.csv")[1]
            scope_path = service_dir / "scope.csv"
            fields, scope = _csv(scope_path)
            if "in_area" not in fields:
                fields.append("in_area")
            stop_ids = {row["station_id"] for row in stops}
            for row in scope:
                row["in_area"] = "true" if row["station_id"] in stop_ids else "false"
            _write_csv(scope_path, fields, scope)

        expected_services = []
        for service_id in frozen_order:
            if service_id in service_owner:
                station_ids = [
                    row["station_id_proposed"] for row in catalog_by_service[service_id]
                ]
            else:
                shipped_stop_ids = {
                    row["station_id"]
                    for row in _csv(
                        live_overrides / "services" / service_id / "stops.csv"
                    )[1]
                }
                station_ids = [
                    row["station_id_proposed"]
                    for row in catalog_by_service[service_id]
                    if row["station_id_proposed"] in shipped_stop_ids
                ]
                if set(station_ids) != shipped_stop_ids:
                    raise StageError(
                        f"shipped stops are absent from frozen oracle source: {service_id}"
                    )
            expected_services.append({"id": service_id, "stationIds": station_ids})
        expected = {
            "services": expected_services,
            "stationIds": list(
                station_order(row["stationIds"] for row in expected_services)
            ),
        }
        expected_path = destination / "expected-catalog.json"
        _write_json(expected_path, expected)
        stage_dataset = _json(region_data[REGIONS[0]]["overrides"] / "dataset.json")
        dataset = stage_dataset
        dataset["serviceIds"] = frozen_order
        dataset["expectedCatalogFile"] = expected_path.name
        dataset["expectedCatalogSha256"] = hashlib.sha256(
            expected_path.read_bytes()
        ).hexdigest()
        _write_json(destination / "dataset.json", dataset)

        _write_json(combined_root / "baseline-sha256.json", baseline_hashes or {})
        _write_csv(
            combined_root / "pair-evidence.csv",
            list(PAIR_EVIDENCE_FIELDS),
            pair_evidence,
        )
        _write_csv(
            combined_root / "length-refs.csv",
            list(LENGTH_REF_FIELDS),
            length_references,
        )
        evidence_summary = []
        for region in REGIONS:
            evidence_count = (
                sum(1 for row in pair_evidence if row["region"] == region)
                if pair_evidence and "region" in pair_evidence[0]
                else sum(
                    1
                    for row in pair_evidence
                    if row.get("service_id") in REGION_SERVICES[region]
                )
            )
            reference_count = sum(
                1
                for row in length_references
                if row["service_id"] in REGION_SERVICES[region]
            )
            evidence_summary.append(
                f"- `{region}`: {len(REGION_SERVICES[region])} assigned services, "
                f"{evidence_count} pair-evidence rows, {reference_count} length references; "
                f"run `s2gate {region} 2>&1 | tee .claude/logs/s2/{region}-verification.log` "
                "to verify (tests, deterministic A/B, validate, preservation audit); "
                f"verification log: `.claude/logs/s2/{region}-verification.log`."
            )
        exception_summary = []
        for filename, rows in dataset_additions.items():
            keys = [
                "/".join(row[field] for field in DATASET_LEVEL_FILES[filename])
                for row in rows
            ]
            exception_summary.append(
                f"- `{filename}`: {len(rows)} added row(s)"
                + (f" — {', '.join(f'`{key}`' for key in keys)}" if keys else ".")
            )
        readme = "\n".join(
            [
                "# Combined JR suburban staging dataset",
                "",
                "This stage combines the four region-owned service edits over the shipped JR East overrides. Each assigned service is sourced from exactly one region; shared station records and the frozen catalogue are checked during assembly.",
                "",
                "## Regional evidence",
                "",
                *evidence_summary,
                "",
                "`pair-evidence.csv` retains reviewed raw N02 pair measurements and `length-refs.csv` retains source mileage references.",
                "",
                "## Dataset-level exception additions",
                "",
                *exception_summary,
                "",
                "Assembly keeps every live row byte-for-value, rejects a deleted or modified live row, and unions new rows by each file's natural key. Identical additions from multiple regions are retained once; conflicting values for one key stop assembly.",
                "",
                "## S5 merge procedure",
                "",
                "Start from the current live overrides, merge the reviewed combined `overrides/` contents with the S3/S4 decisions, and restore the approved gameplay settings. Run the full build and validation from those merged overrides to create a fresh product bundle. Do not publish this stage build or relabel its manifest.",
                "",
            ]
        )
        (combined_root / "README.md").write_text(readme, encoding="utf-8")
        return destination
    except Exception:
        if combined_root.exists():
            shutil.rmtree(combined_root)
        raise


def _load_artifact(data_dir: Path, filename: str) -> Any:
    path = data_dir / filename
    if not path.is_file():
        raise StageError(f"build artifact is missing: {path}")
    return _json(path)


def _check_old_pair_records(
    stage_dir: Path,
    data_dir: Path,
    baseline_dir: Path,
    live_overrides: Path = LIVE,
) -> list[str]:
    errors: list[str] = []
    baseline_services = _load_artifact(baseline_dir, "services.json")["services"]
    staged_services = _load_artifact(data_dir, "services.json")["services"]
    baseline_segments = {
        row["id"]: row for row in _load_artifact(baseline_dir, "segments.json")
    }
    staged_segments = {
        row["id"]: row for row in _load_artifact(data_dir, "segments.json")
    }
    baseline_geo = {
        feature["id"]: feature
        for feature in _load_artifact(baseline_dir, "segments.geojson")["features"]
    }
    staged_geo = {
        feature["id"]: feature
        for feature in _load_artifact(data_dir, "segments.geojson")["features"]
    }
    baseline_stations = {
        row["id"]: row for row in _load_artifact(baseline_dir, "stations.json")
    }
    staged_stations = {
        row["id"]: row for row in _load_artifact(data_dir, "stations.json")
    }
    for station_id, record in baseline_stations.items():
        if staged_stations.get(station_id) != record:
            errors.append(f"shipped station record changed: {station_id}")
    staged_by_id = {row["id"]: row for row in staged_services}
    for service in baseline_services:
        sid = service["id"]
        if staged_by_id.get(sid) is None:
            errors.append(f"shipped service missing: {sid}")
            continue
        # Extended services add platforms for their new stops; only the shipped
        # keys must keep their exact values.
        staged_platforms = staged_by_id[sid].get("platformCoordinates", {})
        shipped_platforms = service.get("platformCoordinates", {})
        if any(
            staged_platforms.get(station_id) != coordinates
            for station_id, coordinates in shipped_platforms.items()
        ):
            errors.append(f"shipped platform coordinates changed: {sid}")
    for segment_id, segment in baseline_segments.items():
        current = staged_segments.get(segment_id)
        if current is None:
            errors.append(f"shipped segment missing: {segment_id}")
            continue
        if current.get("geometryFeatureIds") != segment.get("geometryFeatureIds"):
            errors.append(f"shipped primitive references changed: {segment_id}")
            continue
        for feature_id in segment["geometryFeatureIds"]:
            if staged_geo.get(feature_id) != baseline_geo.get(feature_id):
                errors.append(f"shipped primitive geometry changed: {feature_id}")
    # Preserve reviewed recipes for every old pair, even when a service is extended.
    old_service_ids = {row["id"] for row in baseline_services}
    for service_id in old_service_ids:
        live_path = live_overrides / "services" / service_id / "line_mapping.csv"
        stage_path = stage_dir / "services" / service_id / "line_mapping.csv"
        if not live_path.is_file() or not stage_path.is_file():
            errors.append(f"line mapping missing for shipped service: {service_id}")
            continue
        live_fields, live_rows = _csv(live_path)
        stage_fields, stage_rows = _csv(stage_path)
        old_pairs = {(row["from_id"], row["to_id"]) for row in live_rows}
        staged_old = {
            (row["from_id"], row["to_id"]): row
            for row in stage_rows
            if (row["from_id"], row["to_id"]) in old_pairs
        }
        for row in live_rows:
            if staged_old.get((row["from_id"], row["to_id"])) != row:
                errors.append(
                    f"shipped route/composition recipe changed: {service_id}:{row['from_id']}:{row['to_id']}"
                )
        if not set(live_fields) <= set(stage_fields):
            errors.append(f"line mapping columns were removed: {service_id}")
    if (live_overrides / "dataset.json").is_file() and (
        stage_dir / "dataset.json"
    ).is_file():
        try:
            live_model = load_overrides(live_overrides)
            staged_model = load_overrides(stage_dir)
            staged_by_id = {service.id: service for service in staged_model.services}
            for live_service in live_model.services:
                staged_service = staged_by_id.get(live_service.id)
                if staged_service is None:
                    continue
                staged_pairs = {
                    (a, b): item
                    for (a, b), item in zip(
                        station_pairs(
                            staged_service.station_ids, staged_service.circular
                        ),
                        staged_service.segment_ranges(),
                        strict=True,
                    )
                }
                live_pairs = zip(
                    station_pairs(live_service.station_ids, live_service.circular),
                    live_service.segment_ranges(),
                    strict=True,
                )
                for (a, b), live_item in live_pairs:
                    staged_item = staged_pairs.get((a, b))
                    if staged_item is None:
                        continue
                    live_operators = live_service.range_operators(
                        live_item, live_model.dataset
                    )
                    staged_operators = staged_service.range_operators(
                        staged_item, staged_model.dataset
                    )
                    if (
                        live_item.route_lines != staged_item.route_lines
                        or live_operators != staged_operators
                    ):
                        errors.append(
                            f"shipped route ownership changed: {live_service.id}:{a}:{b}"
                        )
                        continue
                    for line, operator in zip(
                        live_item.route_lines, live_operators, strict=True
                    ):
                        old_filter = live_service.section_filter_for_pair(
                            line, operator, a, b
                        )
                        new_filter = staged_service.section_filter_for_pair(
                            line, operator, a, b
                        )
                        if old_filter != new_filter:
                            errors.append(
                                f"shipped section filter changed: {live_service.id}:{a}:{b}:{line}"
                            )
        except (OSError, KeyError, ValueError) as error:
            errors.append(f"could not compare shipped section filters: {error}")
    return errors


def _n02_station_identities(root: Path) -> set[tuple[str, str]]:
    """Load raw N02 source identities as (operator, normalized station name)."""
    import geopandas as gpd

    from scripts.data_pipeline import config
    from scripts.data_pipeline.registry import normalize_station_name

    source = root / "N02-25_GML/UTF-8" / config.RAW_STATION_FILE
    if not source.is_file():
        raise StageError(f"raw N02 station file is missing: {source}")
    frame = gpd.read_file(source)
    return {
        (
            str(row[config.ATTR_OPERATOR]),
            normalize_station_name(str(row[config.ATTR_STATION_NAME])),
        )
        for _, row in frame.iterrows()
    }


def audit(
    region: str, data_dir: Path, *, root: Path = ROOT, baseline_dir: Path | None = None
) -> list[str]:
    """Return every preservation finding for a region build; empty means pass."""
    if region not in (*REGIONS, "combined"):
        raise StageError(f"unknown region: {region}")
    verify_freeze(root=root)
    stage_dir = root / "data/staging/tokyo-suburban-jr" / region / "overrides"
    if not stage_dir.is_dir():
        raise StageError(f"region staging directory is missing: {stage_dir}")
    baseline_dir = baseline_dir or root / "public/data"
    errors: list[str] = []
    assigned_ids = (
        set(ALL_ASSIGNED_SERVICES)
        if region == "combined"
        else set(REGION_SERVICES[region])
    )
    services = _json(stage_dir / "services.json")["services"]
    service_ids = {row["id"] for row in services}
    shipped_services = _json(root / "data/overrides/services.json")["services"]
    shipped_by_id = {row["id"]: row for row in shipped_services}
    shipped_ids = set(shipped_by_id)
    expected_service_ids = shipped_ids | assigned_ids
    research_catalog = _research_rows(root, "tokyo-suburban-research-catalog.csv")
    frozen_order, catalog_by_service = _frozen_jr_catalog(root)
    if service_ids != expected_service_ids:
        errors.append(
            "staging service inventory differs from shipped JR services plus assigned frozen services"
        )
    expected_order = [sid for sid in frozen_order if sid in expected_service_ids]
    if [service["id"] for service in services] != expected_order:
        errors.append("staging service order differs from the frozen JR inventory")
    registry_fields, registry_rows = _csv(stage_dir / "stations.csv")
    registry = {row["id"]: row for row in registry_rows}
    definitions = {row["id"]: row for row in services}
    dataset = _json(stage_dir / "dataset.json")
    n02_identities = _n02_station_identities(root)
    oracle_name = dataset.get("expectedCatalogFile", "")
    oracle_path = stage_dir / oracle_name if oracle_name else stage_dir / "__missing__"
    if not oracle_path.is_file():
        errors.append("staging expected catalogue file is missing")
    elif hashlib.sha256(oracle_path.read_bytes()).hexdigest() != dataset.get(
        "expectedCatalogSha256"
    ):
        errors.append("staging expected catalogue hash does not match dataset.json")
    else:
        expected_catalogue = _json(oracle_path)
        oracle_services = []
        for service_id in expected_order:
            frozen_ids = [
                row["station_id_proposed"] for row in catalog_by_service[service_id]
            ]
            if service_id not in assigned_ids:
                shipped_stop_ids = {
                    row["station_id"]
                    for row in _csv(
                        root / "data/overrides/services" / service_id / "stops.csv"
                    )[1]
                }
                frozen_ids = [
                    station_id
                    for station_id in frozen_ids
                    if station_id in shipped_stop_ids
                ]
                if set(frozen_ids) != shipped_stop_ids:
                    errors.append(
                        f"shipped stops are absent from frozen oracle source: {service_id}"
                    )
            oracle_services.append({"id": service_id, "stationIds": frozen_ids})
        if expected_catalogue.get("services") != oracle_services:
            errors.append("staging expected catalogue differs from frozen JR oracle")
        expected_station_ids = list(
            station_order(row["stationIds"] for row in oracle_services)
        )
        if expected_catalogue.get("stationIds") != expected_station_ids:
            errors.append(
                "staging expected station inventory differs from frozen JR oracle"
            )
        actual_catalogue = [
            {
                "id": service["id"],
                "stationIds": [
                    row["station_id"]
                    for row in _csv(
                        stage_dir / "services" / service["id"] / "stops.csv"
                    )[1]
                ],
            }
            for service in services
        ]
        if expected_catalogue.get("services") != actual_catalogue:
            errors.append(
                "staging expected catalogue differs from explicit service stop sequences"
            )
    for service in services:
        sid = service["id"]
        stops_path = stage_dir / "services" / sid / "stops.csv"
        scope_path = stage_dir / "services" / sid / "scope.csv"
        if not stops_path.is_file() or not scope_path.is_file():
            errors.append(f"stops/scope missing for service: {sid}")
            continue
        stop_fields, stops = _csv(stops_path)
        scope_fields, scope = _csv(scope_path)
        if not {"order", "station_id", "station_number"} <= set(stop_fields):
            errors.append(f"invalid stops schema: {sid}")
        if not {
            "station_id",
            "prefecture",
            "municipality",
            "in_area",
        } <= set(scope_fields):
            errors.append(f"invalid scope schema: {sid}")
        stop_ids = [row["station_id"] for row in stops]
        if [row["order"] for row in stops] != [str(i) for i in range(len(stops))]:
            errors.append(f"stop order is not explicit and contiguous: {sid}")
        if len(stop_ids) != service.get("expectedStopCount"):
            errors.append(f"stop count differs from service metadata: {sid}")
        if sid in assigned_ids:
            frozen_ids = [
                row["station_id_proposed"]
                for row in sorted(
                    (item for item in research_catalog if item["service_id"] == sid),
                    key=lambda item: int(item["order"]),
                )
            ]
            if stop_ids != frozen_ids:
                errors.append(f"assigned stop order differs from frozen catalog: {sid}")
            if service.get("areaPrefectures") != STAGE_PREFECTURES:
                errors.append(
                    f"assigned service does not use frozen extended area: {sid}"
                )
        else:
            expected_definition = shipped_by_id.get(sid)
            if expected_definition is None:
                errors.append(f"unexpected staging service: {sid}")
            else:
                expected_definition = dict(expected_definition)
                expected_definition["areaPrefectures"] = FOUR_PREFECTURES
                if service != expected_definition:
                    errors.append(f"non-assigned service definition changed: {sid}")
            for filename in ("stops.csv", "line_mapping.csv"):
                live_path = root / "data/overrides/services" / sid / filename
                staged_path = stage_dir / "services" / sid / filename
                if not live_path.is_file() or not staged_path.is_file():
                    errors.append(
                        f"non-assigned service file missing: {sid}/{filename}"
                    )
                elif staged_path.read_bytes() != live_path.read_bytes():
                    errors.append(
                        f"non-assigned service file changed: {sid}/{filename}"
                    )
        scope_ids = [row["station_id"] for row in scope]
        if len(scope_ids) != len(set(scope_ids)) or not set(stop_ids) <= set(scope_ids):
            errors.append(
                f"scope does not contain exactly one row for every stop: {sid}"
            )
        if any(row.get("in_area") not in ("true", "false") for row in scope) or {
            row["station_id"] for row in scope if row.get("in_area") == "true"
        } != set(stop_ids):
            errors.append(f"explicit scope membership differs from stops: {sid}")
        if any(row["station_id"] not in registry for row in stops):
            errors.append(f"stop has no registry record: {sid}")
        if sid not in assigned_ids and service.get("areaPrefectures") != [
            "東京都",
            "千葉県",
            "神奈川県",
            "埼玉県",
        ]:
            errors.append(f"non-assigned service widened its prefecture scope: {sid}")
        for stop in stops:
            registry_row = registry.get(stop["station_id"])
            if registry_row is None:
                continue
            operator = (
                stop.get("n02_operator")
                or definitions[sid].get("n02Operator")
                or dataset["n02Operator"]
            )
            name = (
                stop.get("n02_name")
                or registry_row.get("n02_name")
                or registry_row["name"]
            )
            from scripts.data_pipeline.registry import normalize_station_name

            if (operator, normalize_station_name(name)) not in n02_identities:
                errors.append(
                    f"stop has no matching N02 station identity: {sid}:{stop['station_id']} ({operator}/{name})"
                )
            if stop.get("n02_operator") and (
                not stop.get("original_name") or not stop.get("source_reason")
            ):
                errors.append(
                    f"N02 source override lacks identity evidence: {sid}:{stop['station_id']}"
                )
    baseline_registry = {
        row["id"]: row for row in _csv(root / "data/overrides/stations.csv")[1]
    }
    for station_id, old in baseline_registry.items():
        if station_id not in registry:
            errors.append(f"shipped registry station missing: {station_id}")
        elif registry[station_id] != old:
            errors.append(f"shipped registry station record changed: {station_id}")
    for filename, key_fields in DATASET_LEVEL_FILES.items():
        live_fields, live_rows = _csv(root / "data/overrides" / filename)
        staged_path = stage_dir / filename
        if not staged_path.is_file():
            errors.append(f"dataset-level exception file missing: {filename}")
            continue
        staged_fields, staged_rows = _csv(staged_path)
        if staged_fields != live_fields:
            errors.append(f"dataset-level exception schema changed: {filename}")
            continue
        staged_by_key: dict[tuple[str, ...], dict[str, str]] = {}
        for row in staged_rows:
            key = tuple(row[field] for field in key_fields)
            if key in staged_by_key:
                errors.append(
                    f"duplicate dataset-level exception row: {filename} {key}"
                )
            staged_by_key[key] = row
        for row in live_rows:
            key = tuple(row[field] for field in key_fields)
            if staged_by_key.get(key) != row:
                errors.append(
                    f"shipped dataset-level exception changed: {filename} {key}"
                )
    try:
        errors.extend(
            _check_old_pair_records(
                stage_dir, data_dir, baseline_dir, root / "data/overrides"
            )
        )
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        errors.append(f"could not complete preservation comparison: {error}")
    return errors


def parse_args(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    seed_parser = commands.add_parser("seed", help="create a region staging copy")
    seed_parser.add_argument("--region", required=True, choices=REGIONS)
    measure_parser = commands.add_parser(
        "measure-pairs", help="measure added raw-N02 region pairs"
    )
    measure_parser.add_argument("--region", required=True, choices=REGIONS)
    commands.add_parser("assemble", help="merge all region-owned service edits")
    audit_parser = commands.add_parser(
        "audit", help="audit region staging preservation"
    )
    audit_parser.add_argument("--region", required=True, choices=(*REGIONS, "combined"))
    audit_parser.add_argument("--data-dir", required=True, type=Path)
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    args = parse_args(arguments)
    try:
        if args.command == "seed":
            print(f"PASS seeded {seed(args.region)}")
            return 0
        if args.command == "measure-pairs":
            print(f"PASS measured {measure_pairs(args.region)}")
            return 0
        if args.command == "assemble":
            print(f"PASS assembled {assemble()}")
            return 0
        findings = audit(args.region, args.data_dir)
    except (OSError, KeyError, StageError, json.JSONDecodeError) as error:
        print(f"FAIL {error}")
        return 2
    if findings:
        for finding in findings:
            print(f"FAIL {finding}")
        return 2
    if args.region == "combined":
        for filename, key_fields in DATASET_LEVEL_FILES.items():
            live_rows = _csv(ROOT / "data/overrides" / filename)[1]
            staged_rows = _csv(
                ROOT / "data/staging/tokyo-suburban-jr/combined/overrides" / filename
            )[1]
            live_keys = {tuple(row[field] for field in key_fields) for row in live_rows}
            added = [
                row
                for row in staged_rows
                if tuple(row[field] for field in key_fields) not in live_keys
            ]
            rendered = ["/".join(row[field] for field in key_fields) for row in added]
            print(
                f"INFO {filename} additions: {', '.join(rendered) if rendered else 'none'}"
            )
    print(f"PASS audit {args.region}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
