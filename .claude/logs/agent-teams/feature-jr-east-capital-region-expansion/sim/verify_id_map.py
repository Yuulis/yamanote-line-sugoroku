"""Check the frozen S0 research-to-product map without network access.

Station spelling evidence is stored in the CSV with a JR English source URL.
New service IDs are D7 namespace labels, so their station-only id_source is empty.
"""

import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
RESEARCH = ROOT / ".claude/docs/research"
EXPECTED_SERVICES = 40
EXPECTED_STATIONS = 472
EXPECTED_SHIPPED_SERVICES = 5
EXPECTED_SHIPPED_STATIONS = 67
SHIPPED_SERVICE_MAP = {
    "yamanote": "jr-yamanote",
    "keihin_tohoku_negishi": "jr-keihin-tohoku",
    "chuo_sobu_local": "jr-chuo-sobu-local",
    "saikyo_kawagoe": "jr-saikyo",
    "keiyo": "jr-keiyo",
}
ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*", re.ASCII)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def official_slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.decode().lower()).strip("-")


def n02_name(row: dict[str, str]) -> str:
    return row["n02_name"] or row["station_name_ja"]


def main() -> None:
    catalog = read_csv(RESEARCH / "jr-east-capital-region-catalog-v2.csv")
    services = read_csv(RESEARCH / "jr-east-capital-region-services-v2.csv")
    mapping_path = RESEARCH / "jr-east-capital-region-id-map.csv"
    require(b"\r" not in mapping_path.read_bytes(), "Map must use LF bytes")
    mapping = read_csv(mapping_path)
    require(
        all(r["entity_type"] in {"station", "service"} for r in mapping),
        "Unknown map entity type",
    )
    maps: dict[str, dict[str, dict[str, str]]] = {}
    for entity, expected in [
        ("service", EXPECTED_SERVICES),
        ("station", EXPECTED_STATIONS),
    ]:
        entries = [r for r in mapping if r["entity_type"] == entity]
        require(len(entries) == expected, f"Wrong {entity} count")
        require(
            len({r["research_id"] for r in entries}) == expected,
            f"Duplicate {entity} research ID",
        )
        require(
            len({r["product_id"] for r in entries}) == expected,
            f"Duplicate {entity} product ID",
        )
        require(
            all(ID_PATTERN.fullmatch(r["product_id"]) for r in entries),
            f"Invalid {entity} ID",
        )
        maps[entity] = {r["research_id"]: r for r in entries}
    require(
        len({r["product_id"] for r in mapping}) == len(mapping),
        "Product IDs collide across entity types",
    )
    service_map, station_map = maps["service"], maps["station"]
    require(
        set(service_map) == {s["service_id"] for s in services},
        "Service view coverage differs",
    )
    require(
        set(service_map) == {r["service_id"] for r in catalog},
        "Catalog service coverage differs",
    )
    require(
        set(station_map) == {r["station_id_proposed"] for r in catalog},
        "Catalog station coverage differs",
    )
    require(
        set(station_map) == {sid for s in services for sid in s["stop_ids"].split("|")},
        "Service stop-list coverage differs",
    )
    for sid, row in service_map.items():
        expected_id = SHIPPED_SERVICE_MAP.get(sid, "jr-" + sid.replace("_", "-"))
        require(row["product_id"] == expected_id, f"D7 service mapping changed: {sid}")
        require(
            row["id_source"] == ("shipped" if sid in SHIPPED_SERVICE_MAP else ""),
            f"Wrong service provenance: {sid}",
        )

    by_station: dict[str, list[dict[str, str]]] = defaultdict(list)
    by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in catalog:
        by_station[row["station_id_proposed"]].append(row)
        by_service[row["service_id"]].append(row)
    for sid, occurrences in by_station.items():
        mapped = station_map[sid]
        for row in occurrences:
            for key in ["prefecture", "jr_station_code", "n02_lines"]:
                require(
                    mapped[key] == row[key], f"Identity metadata differs: {sid}/{key}"
                )
            require(mapped["name_ja"] == row["station_name_ja"], f"Name differs: {sid}")
            require(mapped["n02_name"] == n02_name(row), f"N02 alias differs: {sid}")
        require(
            mapped["id_source"] in {"shipped", "jr-official", "hepburn-review-needed"},
            f"Unknown station provenance: {sid}",
        )
        require(bool(mapped["identity_evidence"]), f"Missing identity evidence: {sid}")
        if mapped["id_source"] == "jr-official":
            require(
                bool(mapped["official_name_en"]), f"Missing official spelling: {sid}"
            )
            require(
                mapped["product_id"] == official_slug(mapped["official_name_en"]),
                f"Official spelling differs: {sid}",
            )
            require(
                mapped["source_url"]
                == f"https://timetables.jreast.co.jp/en/timetable/list{mapped['jr_station_code']}.html",
                f"Wrong spelling source: {sid}",
            )
    require(
        len({r["jr_station_code"] for r in station_map.values()}) == EXPECTED_STATIONS,
        "JR station codes collide",
    )

    registry = read_csv(ROOT / "data/overrides/stations.csv")
    shipped_services = json.loads((ROOT / "public/data/services.json").read_text())
    require(
        len(registry) == EXPECTED_SHIPPED_STATIONS, "Shipped station baseline changed"
    )
    require(
        len(shipped_services) == EXPECTED_SHIPPED_SERVICES,
        "Shipped service baseline changed",
    )
    require(
        {s["id"] for s in shipped_services} == set(SHIPPED_SERVICE_MAP.values()),
        "Shipped service IDs changed",
    )
    matched: dict[str, str] = {}
    for station in registry:
        candidates = [
            sid
            for sid, occurrences in by_station.items()
            if any(
                n02_name(row) == (station["n02_name"] or station["name"])
                and row["prefecture"] == "東京都"
                and service_map[row["service_id"]]["product_id"]
                == station["representative_service_id"]
                for row in occurrences
            )
        ]
        require(len(candidates) == 1, f"Ambiguous registry identity: {station['id']}")
        sid = candidates[0]
        matched[sid] = station["id"]
        require(
            station_map[sid]["product_id"] == station["id"],
            f"Shipped ID changed: {station['id']}",
        )
        require(
            station_map[sid]["id_source"] == "shipped",
            f"Shipped provenance lost: {sid}",
        )
        require(
            station_map[sid]["representative_service_id"]
            == station["representative_service_id"],
            f"Registry service differs: {sid}",
        )
    require(len(matched) == EXPECTED_SHIPPED_STATIONS, "Registry identities collapsed")
    require(
        {sid for sid, r in station_map.items() if r["id_source"] == "shipped"}
        == set(matched),
        "Unexpected shipped station claim",
    )
    inverse_services = {pid: sid for sid, pid in SHIPPED_SERVICE_MAP.items()}
    for service in shipped_services:
        pid = service["id"]
        research_rows = by_service[inverse_services[pid]]
        stops_path = ROOT / f"data/overrides/services/{pid}/stops.csv"
        shipped_stops = [r["station_id"] for r in read_csv(stops_path)]
        require(
            shipped_stops == service["stationIds"],
            f"Shipped override/public order differs: {pid}",
        )
        product_stops = [
            station_map[r["station_id_proposed"]]["product_id"] for r in research_rows
        ]
        require(
            [s for s in product_stops if s in shipped_stops] == shipped_stops,
            f"Shipped stop order changed: {pid}",
        )
        # Identity also requires the actual ordered corridor and its N02 selectors.
        line_path = ROOT / f"data/overrides/services/{pid}/line_mapping.csv"
        for selector in read_csv(line_path):
            first = product_stops.index(selector["from_id"])
            last = product_stops.index(selector["to_id"])
            indices = (
                list(range(first, last + 1))
                if first <= last
                else [*range(first, len(product_stops)), *range(last + 1)]
            )
            require(
                all(
                    selector["n02_line"] in research_rows[i]["n02_lines"].split("|")
                    for i in indices
                ),
                f"Registry N02 corridor differs: {pid}/{selector['n02_line']}",
            )
    for sid, code, required_services in [
        ("tokyo", "1039", {"yamanote", "keiyo"}),
        ("musashi-kosugi", "1527", {"nambu", "yokosuka"}),
        ("hamakawasaki", "1246", {"nambu_branch", "tsurumi"}),
    ]:
        require(
            station_map[sid]["jr_station_code"] == code,
            f"Shared station code differs: {sid}",
        )
        require(
            required_services <= {r["service_id"] for r in by_station[sid]},
            f"Shared station split: {sid}",
        )
    counts = dict(sorted(Counter(r["id_source"] for r in station_map.values()).items()))
    review_needed = sorted(
        r["product_id"]
        for r in station_map.values()
        if r["id_source"] == "hepburn-review-needed"
    )
    print(
        json.dumps(
            {
                "ok": True,
                "services": len(service_map),
                "stations": len(station_map),
                "shipped_services_preserved": len(shipped_services),
                "shipped_stations_preserved": len(matched),
                "station_id_source": counts,
                "hepburn_review_needed": review_needed,
                "new_service_namespace_ids": EXPECTED_SERVICES - len(shipped_services),
                "shipped_order_and_n02_corridors": "verified",
                "shared_station_identities": 3,
            }
        )
    )


if __name__ == "__main__":
    main()
