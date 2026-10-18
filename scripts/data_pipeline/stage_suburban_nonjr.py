"""Seed, measure, gate and audit isolated non-JR operator-group stages."""

from __future__ import annotations

import argparse
import json
import math
import shutil
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

from scripts.data_pipeline import build, export, validate
from scripts.data_pipeline import stage_suburban_jr as jr
from scripts.data_pipeline.composition_build import check_inherited_route_sources
from scripts.data_pipeline.constraints import PlatformSelector
from scripts.data_pipeline.n02 import N02SourceProvider, PlatformCandidate
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.registry import (
    OverrideError,
    Registry,
    normalize_station_name,
)
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    _stable_repr,
    hash_tree,
    hash_value,
    read_csv,
    read_json,
    research_rows,
    resolve_historical_baseline,
    sha256_file,
    verify_freeze,
    write_csv,
    write_json,
)
from scripts.data_pipeline.topology import directed_pairs, station_pairs

ROOT = jr.ROOT
STAGING = ROOT / "data/staging/tokyo-suburban-nonjr"
GROUPS = (
    "metro",
    "toei-yokohama",
    "tobu",
    "seibu",
    "keisei-hokuso-tx",
    "tokyu-mm",
    "keio-odakyu",
    "keikyu-sotetsu",
)
GROUP_OPERATORS: dict[str, tuple[str, ...]] = {
    "metro": ("東京地下鉄",),
    "toei-yokohama": ("東京都交通局", "横浜市交通局"),
    "tobu": ("東武鉄道",),
    "seibu": ("西武鉄道",),
    "keisei-hokuso-tx": ("京成電鉄", "北総鉄道", "首都圏新都市鉄道"),
    "tokyu-mm": ("東急電鉄", "横浜高速鉄道"),
    "keio-odakyu": ("京王電鉄", "小田急電鉄"),
    "keikyu-sotetsu": ("京浜急行電鉄", "相模鉄道"),
}
GROUP_PREFIXES = {
    "metro": ("metro-",),
    "toei-yokohama": ("toei-", "yokohama-"),
    "tobu": ("tobu-",),
    "seibu": ("seibu-",),
    "keisei-hokuso-tx": ("keisei-", "hokuso-", "tx"),
    "tokyu-mm": ("tokyu-", "mm-"),
    "keio-odakyu": ("keio-", "odakyu-"),
    "keikyu-sotetsu": ("keikyu-", "sotetsu-"),
}
IDENTITY_FIELDS = ("service_id", "station_id_original", "station_id_proposed")
LENGTH_FIELDS = (
    "service_id",
    "from",
    "to",
    "km",
    "source_url",
    "n02_pair_sum_km",
    "notes",
)
COMPONENT_FIELDS = (
    "service_id",
    "from",
    "to",
    "km",
    "source_url",
    "document",
    "page_or_table",
    "operation",
    "source_class",
    "notes",
)
EVIDENCE_FIELDS = (
    "service_id",
    "from_id",
    "to_id",
    "n02_operator",
    "n02_line",
    "from_platform_code",
    "from_group_code",
    "from_track_platform_code",
    "to_platform_code",
    "to_group_code",
    "to_track_platform_code",
    "path_length_km",
    "start_snap_m",
    "end_snap_m",
    "route_legs_json",
    "filter_recipe_sha256",
    "override_sha256",
    "raw_station_sha256",
    "raw_section_sha256",
    "status",
    "notes",
)
BASELINE_FILE = "baseline-sha256.json"
GATE_FILE = "gate-report.json"
RAW_FILES = (
    "N02-25_Station.geojson",
    "N02-25_RailroadSection.geojson",
)
LENGTH_TOLERANCE_KM = 1.5


def component_assignments(
    service_stops: dict[str, list[str]], service_operators: dict[str, str]
) -> dict[str, str]:
    """Return stable per-operator connected-component ids for whole services."""
    if set(service_stops) != set(service_operators):
        raise StageError("service stop and operator inventories disagree")
    by_operator: dict[str, list[str]] = {}
    for service_id, operator in service_operators.items():
        by_operator.setdefault(operator, []).append(service_id)
    assignments: dict[str, str] = {}
    for service_ids in by_operator.values():
        remaining = set(service_ids)
        while remaining:
            seed_id = min(remaining)
            pending = [seed_id]
            component: set[str] = set()
            while pending:
                service_id = pending.pop()
                if service_id in component:
                    continue
                component.add(service_id)
                stop_ids = set(service_stops[service_id])
                pending.extend(
                    other_id
                    for other_id in remaining - component
                    if stop_ids.intersection(service_stops[other_id])
                )
            remaining.difference_update(component)
            component_id = min(component)
            assignments.update({service_id: component_id for service_id in component})
    return assignments


def service_pair_indexes(stop_ids: list[str], circular: bool) -> list[int]:
    """Return pair indexes, including the final-to-first pair for loops."""
    return list(range(len(station_pairs(stop_ids, circular))))


def _tree_hashes(path: Path) -> dict[str, str]:
    return hash_tree(path)


def _raw_hashes(root: Path) -> dict[str, str]:
    raw_root = root / "N02-25_GML/UTF-8"
    hashes = _tree_hashes(raw_root)
    return {
        f"N02-25_GML/UTF-8/{name}": hashes[name] for name in RAW_FILES if name in hashes
    }


def _baseline_snapshot(root: Path) -> dict[str, Any]:
    freeze_path = root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
    return {
        "schemaVersion": 1,
        "publicData": _tree_hashes(resolve_historical_baseline(root, "public/data")),
        "liveOverrides": _tree_hashes(
            resolve_historical_baseline(root, "data/overrides")
        ),
        "jrStaging": _tree_hashes(root / "data/staging/tokyo-suburban-jr"),
        "freezeManifestSha256": sha256_file(freeze_path)
        if freeze_path.is_file()
        else "",
        "rawManifestSha256": sha256_file(root / "data/n02-2025.sha256")
        if (root / "data/n02-2025.sha256").is_file()
        else "",
        "rawFiles": _raw_hashes(root),
    }


def _protected_changes(root: Path, snapshot: dict[str, Any]) -> list[str]:
    actual = _baseline_snapshot(root)
    keys = (
        "publicData",
        "liveOverrides",
        "jrStaging",
        "freezeManifestSha256",
        "rawManifestSha256",
        "rawFiles",
    )
    return [key for key in keys if actual.get(key) != snapshot.get(key)]


def _frozen_catalog_by_service(
    root: Path, service_ids: set[str]
) -> dict[str, list[dict[str, str]]]:
    catalog = research_rows(root, "tokyo-suburban-research-catalog.csv")
    result: dict[str, list[dict[str, str]]] = {
        service_id: [] for service_id in service_ids
    }
    for row in catalog:
        if row["service_id"] in result:
            result[row["service_id"]].append(row)
    for rows in result.values():
        rows.sort(key=lambda row: int(row["order"]))
    missing = [service_id for service_id, rows in result.items() if not rows]
    if missing:
        raise StageError(f"frozen catalog lacks services: {sorted(missing)}")
    return result


def _component_file_hash(overrides_dir: Path) -> str:
    return hash_value(_tree_hashes(overrides_dir))


def _evidence_hash(rows: list[dict[str, str]]) -> str:
    return hash_value(rows)


def _source_hashes(root: Path) -> tuple[str, str]:
    hashes = _raw_hashes(root)
    station = hashes.get("N02-25_GML/UTF-8/N02-25_Station.geojson", "")
    section = hashes.get("N02-25_GML/UTF-8/N02-25_RailroadSection.geojson", "")
    if not station or not section:
        raise StageError("raw N02 station and railroad-section files are required")
    return station, section


def _check_raw_checksums(root: Path) -> None:
    manifest = root / "data/n02-2025.sha256"
    if not manifest.is_file():
        raise StageError("raw N02 checksum manifest is missing")
    expected: dict[str, str] = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        digest, relative = line.split(maxsplit=1)
        expected[relative.strip().lstrip("*")] = digest
    for name in RAW_FILES:
        relative = f"N02-25_GML/UTF-8/{name}"
        path = root / relative
        if relative not in expected or not path.is_file():
            raise StageError(f"raw N02 checksum entry or file is missing: {relative}")
        if sha256_file(path) != expected[relative]:
            raise StageError(f"raw N02 checksum mismatch: {relative}")


def _component_overrides(root: Path, group: str, component_id: str) -> Path:
    return (
        root
        / "data/staging/tokyo-suburban-nonjr"
        / group
        / "components"
        / component_id
        / "overrides"
    )


def _validate_component_layout(
    group_root: Path,
    inventory: dict[str, Any],
    catalog_by_service: dict[str, list[dict[str, str]]],
) -> None:
    service_ids = list(inventory["serviceIds"])
    service_rows = {row["service_id"]: row for row in inventory["services"]}
    expected = component_assignments(
        {
            service_id: [
                row["station_id_original"] for row in catalog_by_service[service_id]
            ]
            for service_id in service_ids
        },
        {
            service_id: catalog_by_service[service_id][0]["operator"]
            for service_id in service_ids
        },
    )
    actual: dict[str, str] = {}
    for component in inventory.get("components", []):
        component_id = component.get("componentId", "")
        overrides_dir = group_root / "components" / component_id / "overrides"
        if not overrides_dir.is_dir():
            raise StageError(f"component overrides are missing: {component_id}")
        for service_id in component.get("serviceIds", []):
            if service_id in actual:
                raise StageError(
                    f"service is assigned to multiple components: {service_id}"
                )
            actual[service_id] = component_id
    if actual != expected:
        raise StageError(
            "component split differs from frozen per-operator connectivity"
        )
    if set(service_rows) != set(service_ids):
        raise StageError("group service inventory is inconsistent")
    for component in inventory["components"]:
        component_id = component["componentId"]
        overrides = load_overrides(
            group_root / "components" / component_id / "overrides"
        )
        expected_ids = [sid for sid in service_ids if expected[sid] == component_id]
        if list(overrides.dataset.service_ids) != expected_ids:
            raise StageError(
                f"component service order differs from frozen group order: {component_id}"
            )
        operators = {catalog_by_service[sid][0]["operator"] for sid in expected_ids}
        if len(operators) != 1:
            raise StageError(f"component contains multiple operators: {component_id}")


def _group_root(root: Path, group: str) -> Path:
    if group not in GROUPS:
        raise StageError(f"unknown non-JR operator group: {group}")
    return root / "data/staging/tokyo-suburban-nonjr" / group


def _length_reference_hashes(group_root: Path) -> dict[str, str]:
    """Hash both editable mileage evidence files for gate/audit freshness."""
    return {
        filename: sha256_file(group_root / filename)
        for filename in ("length-refs.csv", "length-ref-components.csv")
    }


def _length_source_label(breakdown: list[dict[str, str]]) -> str:
    """Describe the primary/secondary class represented by a mileage breakdown."""
    classes = {row["source_class"] for row in breakdown}
    if classes == {"primary"}:
        return "Official primary-source"
    if classes == {"secondary"}:
        return "Secondary-source"
    if classes == {"primary", "secondary"}:
        return "Mixed primary/secondary-source"
    raise StageError("length breakdown has no recognized source class")


def _length_measurement_note(breakdown: list[dict[str, str]]) -> str:
    """Return a measured-pair note that preserves its mileage source class."""
    return (
        f"{_length_source_label(breakdown)} mileage breakdown agrees "
        "with raw N02 pair sum within 1.5 km."
    )


def _length_reference_freshness_findings(
    group: str,
    group_root: Path,
    gate_report: dict[str, Any],
    verification: dict[str, Any],
) -> list[str]:
    """Compare current mileage evidence with both gate and successful audit records."""
    try:
        current_hashes = _length_reference_hashes(group_root)
    except OSError as error:
        return [f"{group}: length reference CSV is missing: {error}"]
    findings: list[str] = []
    if gate_report.get("lengthReferenceHashes") != current_hashes:
        findings.append(f"{group}: gate length reference CSV hashes are stale")
    if verification.get("lengthReferenceHashes") != current_hashes:
        findings.append(f"{group}: audit length reference CSV hashes are stale")
    return findings


def _write_group_readme(group_root: Path, group: str) -> None:
    (group_root / "README.md").write_text(
        f"""# {group} non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`.

Enter source-classified operating-mileage evidence in `length-refs.csv` and `length-ref-components.csv`, then complete the reviewed stop selectors and route mappings before running `measure-pairs`. Each mileage component records whether its source is primary or secondary. Verification status belongs in the group verification log under `.claude/logs/s3/{group}/`; this README records only the log pointer.
""",
        encoding="utf-8",
    )


def _seed_component(
    group_root: Path,
    component_id: str,
    service_ids: list[str],
    group_services: list[dict[str, str]],
    catalog_by_service: dict[str, list[dict[str, str]]],
    root: Path,
) -> None:
    component_root = group_root / "components" / component_id
    overrides_root = component_root / "overrides"
    overrides_root.mkdir(parents=True)
    service_rows = {row["service_id"]: row for row in group_services}
    component_services = [service_rows[service_id] for service_id in service_ids]
    first_catalog = catalog_by_service[service_ids[0]][0]
    operator = first_catalog["operator"]
    n02_operator = first_catalog["n02_operator"]
    all_rows = [
        row for service_id in service_ids for row in catalog_by_service[service_id]
    ]
    prefectures = list(dict.fromkeys(row["prefecture"] for row in all_rows))
    live_dataset = read_json(root / "data/overrides/dataset.json")
    dataset = {
        "operator": operator,
        "n02Operator": n02_operator,
        "updatedAt": live_dataset["updatedAt"],
        "areaName": f"{operator} non-JR staging component",
        "areaPrefectures": prefectures,
        "serviceIds": service_ids,
        "reviewedDisconnectedServiceIds": [],
        "outputBbox": jr.OUTPUT_BBOX,
        "candidateSearchBbox": jr.SEARCH_BBOX,
        "validationProfile": "stage",
        "stageStartStationId": catalog_by_service[service_ids[0]][0][
            "station_id_original"
        ],
        "expectedCatalogFile": "expected-catalog.json",
        "expectedCatalogSha256": "pending",
        "budgetProfile": "capital-region",
        "simplifyToleranceM": 1,
    }
    write_json(overrides_root / "dataset.json", dataset)

    definitions: list[dict[str, Any]] = []
    line_metadata: list[dict[str, str]] = []
    expected_services: list[dict[str, Any]] = []
    registry_by_id: dict[str, dict[str, str]] = {}
    for service_id, service_row in zip(service_ids, component_services, strict=True):
        rows = catalog_by_service[service_id]
        circular = service_row["circular"] == "true"
        stops = [
            {
                "order": str(index),
                "station_id": row["station_id_original"],
                "station_number": row["station_code"],
                "platform_selector": "",
                "original_name": normalize_station_name(row["station_name_original"]),
                "n02_name": row["station_name_original"],
                "n02_operator": row["n02_operator"],
                "source_reason": "Hash-verified frozen S0 catalog; selector and route evidence pending.",
            }
            for index, row in enumerate(rows)
        ]
        for row in rows:
            station_id = row["station_id_original"]
            registry_by_id.setdefault(
                station_id,
                {
                    "id": station_id,
                    "name": normalize_station_name(row["station_name_original"]),
                    "n02_name": row["station_name_original"],
                    "prefecture": row["prefecture"],
                    "municipality": row["municipality"],
                    "representative_service_id": service_id,
                    "n02_selector": "",
                },
            )
        name = rows[0]["service_name_ja"]
        definition: dict[str, Any] = {
            "id": service_id,
            "name": name,
            "kind": service_row["service_type"],
            "lineIds": [service_id],
            "color": "#808080",
            "circular": circular,
            "directionLabels": {
                "forward": f"{rows[-1]['station_name_original']}方面",
                "backward": f"{rows[0]['station_name_original']}方面",
            },
            "expectedStopCount": len(rows),
            "lengthRef": {},
            "scopeSource": "Hash-verified frozen S0 catalog; scope evidence pending group review.",
            "operator": rows[0]["operator"],
            "n02Operator": rows[0]["n02_operator"],
            "areaPrefectures": list(dict.fromkeys(item["prefecture"] for item in rows)),
            "stationNumberRules": {
                "sequence": [item["station_code"] for item in rows],
                "reason": "Frozen S0 stop order and station-code sequence.",
            },
        }
        if not circular:
            definition["endpoints"] = {
                "first": jr._endpoint_kind(service_row["first_end_kind"]),
                "last": jr._endpoint_kind(service_row["last_end_kind"]),
            }
        definitions.append(definition)
        line_metadata.append({"id": service_id, "name": name, "color": "#808080"})
        expected_services.append(
            {
                "id": service_id,
                "stationIds": [row["station_id_original"] for row in rows],
            }
        )
        service_dir = overrides_root / "services" / service_id
        service_dir.mkdir(parents=True)
        write_csv(service_dir / "stops.csv", list(jr.STOPS_FIELDS), stops)
        write_csv(
            service_dir / "scope.csv",
            list(jr.SCOPE_FIELDS),
            [
                {
                    "station_id": row["station_id_original"],
                    "prefecture": row["prefecture"],
                    "municipality": row["municipality"],
                    "in_area": "true",
                }
                for row in rows
            ],
        )
        pairs = station_pairs([row["station_id_original"] for row in rows], circular)
        line_rows = []
        for index, (from_id, to_id) in enumerate(pairs):
            source_row = rows[index]
            line_rows.append(
                {
                    "from_id": from_id,
                    "to_id": to_id,
                    "n02_line": source_row["n02_line"],
                    "via": "",
                    "route": "",
                    "compose": "",
                }
            )
        write_csv(service_dir / "line_mapping.csv", list(jr.LINE_FIELDS), line_rows)
        write_csv(
            service_dir / "sections.csv",
            [
                "n02_operator",
                "n02_line",
                "action",
                "section_key",
                "reason",
                "from_id",
                "to_id",
            ],
            [],
        )

    expected = {
        "services": expected_services,
        "stationIds": list(
            jr.station_order(item["stationIds"] for item in expected_services)
        ),
    }
    write_json(overrides_root / "expected-catalog.json", expected)
    dataset["expectedCatalogSha256"] = sha256_file(
        overrides_root / "expected-catalog.json"
    )
    write_json(overrides_root / "dataset.json", dataset)
    write_csv(
        overrides_root / "stations.csv",
        [
            "id",
            "name",
            "n02_name",
            "prefecture",
            "municipality",
            "representative_service_id",
            "n02_selector",
        ],
        list(registry_by_id.values()),
    )
    write_json(
        overrides_root / "services.json",
        {"lines": line_metadata, "services": definitions},
    )
    write_csv(
        overrides_root / "offset_exceptions.csv",
        ["service_id", "station_id", "max_platform_offset_m", "reason"],
        [],
    )


def _group_services(
    root: Path, group: str
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    if group not in GROUPS:
        raise StageError(f"unknown non-JR operator group: {group}")
    catalog = research_rows(root, "tokyo-suburban-research-catalog.csv")
    service_rows = research_rows(root, "tokyo-suburban-research-services.csv")
    operators = set(GROUP_OPERATORS[group])
    prefixes = GROUP_PREFIXES[group]
    selected = {
        row["service_id"]
        for row in catalog
        if row["operator"] in operators and row["service_id"].startswith(prefixes)
    }
    ordered = [row for row in service_rows if row["service_id"] in selected]
    if selected != {row["service_id"] for row in ordered}:
        raise StageError(f"frozen catalog/service inventory mismatch for {group}")
    return catalog, ordered


def seed(group: str, *, root: Path = ROOT) -> Path:
    """Create a non-JR group staging copy based only on frozen source rows."""
    verify_freeze(root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json", root)
    catalog, service_rows = _group_services(root, group)
    assigned = {row["service_id"] for row in service_rows}
    target = root / "data/staging/tokyo-suburban-nonjr" / group
    if target.exists():
        raise StageError(f"refusing to overwrite existing operator group: {group}")
    rows_by_service: dict[str, list[dict[str, str]]] = {
        row["service_id"]: [] for row in service_rows
    }
    for row in catalog:
        if row["service_id"] in assigned:
            rows_by_service[row["service_id"]].append(row)
    for service_rows_in_catalog in rows_by_service.values():
        service_rows_in_catalog.sort(key=lambda item: int(item["order"]))
    all_stops = [
        row
        for service_rows_in_catalog in rows_by_service.values()
        for row in service_rows_in_catalog
    ]
    target.mkdir(parents=True)
    catalog_by_service = _frozen_catalog_by_service(root, assigned)
    catalog_operator_by_service = {
        service_id: catalog_by_service[service_id][0]["operator"]
        for service_id in assigned
    }
    assignments = component_assignments(
        {
            service_id: [row["station_id_original"] for row in rows]
            for service_id, rows in rows_by_service.items()
        },
        catalog_operator_by_service,
    )
    component_services: dict[str, list[str]] = defaultdict(list)
    for service_id in (row["service_id"] for row in service_rows):
        component_services[assignments[service_id]].append(service_id)
    write_json(
        target / "inventory.json",
        {
            "group": group,
            "serviceIds": [row["service_id"] for row in service_rows],
            "services": service_rows,
            "components": [
                {"componentId": component_id, "serviceIds": service_ids}
                for component_id, service_ids in component_services.items()
            ],
            "counts": {
                "services": len(service_rows),
                "stops": len(all_stops),
                "pairs": sum(
                    len(rows_by_service[row["service_id"]])
                    if row["circular"] == "true"
                    else max(0, len(rows_by_service[row["service_id"]]) - 1)
                    for row in service_rows
                ),
            },
        },
    )
    write_csv(
        target / "identity-map.csv",
        list(IDENTITY_FIELDS),
        [
            {
                "service_id": row["service_id"],
                "station_id_original": row["station_id_original"],
                "station_id_proposed": row["station_id_proposed"],
            }
            for row in all_stops
        ],
    )
    write_csv(target / "pair-evidence.csv", list(EVIDENCE_FIELDS), [])
    write_csv(target / "length-refs.csv", list(LENGTH_FIELDS), [])
    write_csv(target / "length-ref-components.csv", list(COMPONENT_FIELDS), [])
    write_json(target / "verification.json", {"status": "seeded", "checks": []})
    for component_id, service_ids in component_services.items():
        _seed_component(
            target,
            component_id,
            service_ids,
            service_rows,
            catalog_by_service,
            root,
        )
    write_csv(
        target / "length-refs.csv",
        list(LENGTH_FIELDS),
        [
            {
                "service_id": service_id,
                "from": catalog_by_service[service_id][0]["station_name_original"],
                "to": catalog_by_service[service_id][-1]["station_name_original"],
                "km": "",
                "source_url": "",
                "n02_pair_sum_km": "",
                "notes": "Primary-source operating mileage and breakdown pending.",
            }
            for service_id in (row["service_id"] for row in service_rows)
        ],
    )
    write_csv(target / "length-ref-components.csv", list(COMPONENT_FIELDS), [])
    snapshot = _baseline_snapshot(root)
    write_json(target / BASELINE_FILE, snapshot)
    _write_group_readme(target, group)
    return target


def _parse_length_refs(
    group_root: Path, service_ids: list[str]
) -> tuple[list[dict[str, str]], dict[str, list[dict[str, str]]]]:
    fields, references = read_csv(group_root / "length-refs.csv")
    if tuple(fields) != LENGTH_FIELDS:
        raise StageError(f"length-refs.csv must use columns {list(LENGTH_FIELDS)}")
    component_fields, components = read_csv(group_root / "length-ref-components.csv")
    if tuple(component_fields) != COMPONENT_FIELDS:
        raise StageError(
            f"length-ref-components.csv must use columns {list(COMPONENT_FIELDS)}"
        )
    by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in components:
        service_id = row.get("service_id", "")
        if service_id not in service_ids:
            raise StageError(
                f"length-ref-components.csv has unknown service {service_id}"
            )
        if not all(row.get(field, "").strip() for field in COMPONENT_FIELDS):
            raise StageError(
                f"length-ref-components.csv has an incomplete row: {service_id}"
            )
        if not row["source_url"].startswith("https://"):
            raise StageError(f"length reference source must be HTTPS: {service_id}")
        if row["operation"] not in ("+", "-"):
            raise StageError(f"length breakdown operation must be + or -: {service_id}")
        if row["source_class"] not in ("primary", "secondary"):
            raise StageError(
                f"length reference source class must be primary or secondary: {service_id}"
            )
        try:
            km = float(row["km"])
        except ValueError as error:
            raise StageError(
                f"length breakdown has a nonnumeric distance: {service_id}"
            ) from error
        if not math.isfinite(km) or km <= 0:
            raise StageError(
                f"length breakdown distance must be positive: {service_id}"
            )
        by_service[service_id].append(row)
    seen: set[str] = set()
    for row in references:
        service_id = row.get("service_id", "")
        if service_id not in service_ids or service_id in seen:
            raise StageError(
                f"length-refs.csv has unknown or repeated service {service_id}"
            )
        seen.add(service_id)
        if not all(
            row.get(field, "").strip() for field in ("from", "to", "km", "source_url")
        ):
            raise StageError(f"length-refs.csv lacks operating mileage: {service_id}")
        if not row["source_url"].startswith("https://"):
            raise StageError(f"length reference source must be HTTPS: {service_id}")
        try:
            official_km = float(row["km"])
        except ValueError as error:
            raise StageError(
                f"length-refs.csv has a nonnumeric distance: {service_id}"
            ) from error
        if not math.isfinite(official_km) or official_km <= 0:
            raise StageError(f"official mileage must be positive: {service_id}")
        breakdown = by_service.get(service_id, [])
        if not breakdown:
            raise StageError(f"length reference has no source breakdown: {service_id}")
        if not any(item["source_url"] == row["source_url"] for item in breakdown):
            raise StageError(
                f"length reference URL is absent from its breakdown: {service_id}"
            )
        if breakdown[0]["from"] != row["from"] or breakdown[-1]["to"] != row["to"]:
            raise StageError(
                f"length breakdown endpoints differ from service range: {service_id}"
            )
        signed_km = sum(
            (1 if item["operation"] == "+" else -1) * float(item["km"])
            for item in breakdown
        )
        if round(signed_km, 3) != round(official_km, 3):
            raise StageError(
                f"length breakdown totals {signed_km:.3f} km, not {official_km:.3f} km: {service_id}"
            )
    if seen != set(service_ids) or set(by_service) != set(service_ids):
        raise StageError("length references do not cover every service exactly once")
    return references, by_service


def _length_reference_findings(
    references: list[dict[str, str]],
    evidence_rows: list[dict[str, str]],
    service_ids: set[str],
) -> list[str]:
    refs = {row["service_id"]: row for row in references}
    pair_sums: dict[str, float] = defaultdict(float)
    for row in evidence_rows:
        if row.get("service_id") not in service_ids or row.get("status") != "pass":
            continue
        try:
            pair_sums[row["service_id"]] += float(row["path_length_km"])
        except (KeyError, ValueError):
            return [
                f"pair evidence has an invalid distance: {row.get('service_id', '')}"
            ]
    problems: list[str] = []
    for service_id in sorted(service_ids):
        reference = refs.get(service_id)
        if reference is None:
            problems.append(f"length reference is missing: {service_id}")
            continue
        try:
            official_km = float(reference["km"])
            stored_sum = float(reference["n02_pair_sum_km"])
        except (KeyError, ValueError):
            problems.append(f"length reference lacks measured N02 sum: {service_id}")
            continue
        measured_sum = pair_sums.get(service_id, 0.0)
        if round(stored_sum, 3) != round(measured_sum, 3):
            problems.append(
                f"length reference N02 sum differs from pair evidence: {service_id}"
            )
        try:
            jr.check_length_tolerance(official_km, measured_sum)
        except StageError as error:
            problems.append(f"{service_id}: {error}")
    return problems


def _apply_length_refs(
    group_root: Path, service_ids: list[str], component_ids: list[str]
) -> dict[str, dict[str, str]]:
    references, breakdowns = _parse_length_refs(group_root, service_ids)
    by_id = {row["service_id"]: row for row in references}
    for component_id in component_ids:
        overrides_dir = group_root / "components" / component_id / "overrides"
        payload = read_json(overrides_dir / "services.json")
        for definition in payload["services"]:
            reference = by_id[definition["id"]]
            citations = "; ".join(
                f"{item['document']} {item['page_or_table']} ({item['source_url']})"
                for item in breakdowns[definition["id"]]
            )
            source_label = _length_source_label(breakdowns[definition["id"]])
            definition["lengthRef"] = {
                "km": float(reference["km"]),
                "toleranceKm": LENGTH_TOLERANCE_KM,
                "source": (
                    f"{source_label} operating mileage "
                    f"{reference['from']}–{reference['to']}: "
                    f"{float(reference['km']):.3f} km; {citations}."
                ),
            }
        write_json(overrides_dir / "services.json", payload)
    return by_id


class _CircularPairService:
    """Expose a loop's closing pair to the existing single-pair measurer."""

    def __init__(self, service: Any, pair_index: int) -> None:
        self._service = service
        self.circular = False
        self.stops = (*service.stops, service.stops[0])
        self.station_ids = (
            (*service.station_ids, service.station_ids[0])
            if pair_index == len(service.station_ids) - 1
            else service.station_ids
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._service, name)

    def segment_ranges(self) -> tuple[Any, ...]:
        return self._service.segment_ranges()


class _PairOverrides:
    def __init__(
        self,
        overrides: Any,
        service_id: str,
        pair_index: int,
        endpoint_candidates: dict[str, list[PlatformCandidate]] | None = None,
    ) -> None:
        self._overrides = overrides
        self._service_id = service_id
        self._pair_index = pair_index
        self._endpoint_candidates = endpoint_candidates or {}
        self.dataset = overrides.dataset
        self.registry = overrides.registry
        if self._endpoint_candidates:
            self.registry = Registry(
                tuple(
                    replace(station, n02_selector=PlatformSelector())
                    if station.id in self._endpoint_candidates
                    else station
                    for station in overrides.registry.stations
                )
            )

    def service(self, service_id: str) -> Any:
        service = self._overrides.service(service_id)
        if service_id == self._service_id and self._endpoint_candidates:
            stops = tuple(
                replace(
                    stop,
                    platform_selector=PlatformSelector(
                        lines=frozenset(
                            candidate.n02_line
                            for candidate in self._endpoint_candidates[stop.station_id]
                        ),
                        groups=frozenset(
                            candidate.group_code
                            for candidate in self._endpoint_candidates[stop.station_id]
                        ),
                        codes=frozenset(
                            candidate.station_code
                            for candidate in self._endpoint_candidates[stop.station_id]
                        ),
                    ),
                )
                if stop.station_id in self._endpoint_candidates
                else stop
                for stop in service.stops
            )
            service = replace(service, stops=stops)
        if service_id == self._service_id and service.circular:
            return _CircularPairService(service, self._pair_index)
        return service


def _filter_recipe_hash(
    service: Any, pair_index: int, item: Any, operators: tuple[str, ...]
) -> str:
    indexes = {
        station_id: index for index, station_id in enumerate(service.station_ids)
    }
    scoped = []
    for rule in service.scoped_section_filters:
        start, finish = indexes.get(rule.from_id), indexes.get(rule.to_id)
        if start is not None and finish is not None and start <= pair_index < finish:
            scoped.append(
                {
                    "operator": rule.n02_operator,
                    "line": rule.n02_line,
                    "action": rule.action,
                    "sectionKey": rule.section_key,
                    "from": rule.from_id,
                    "to": rule.to_id,
                }
            )
    payload = {
        "operators": operators,
        "lines": item.route_lines,
        "via": item.via,
        "route": _stable_repr(item.route),
        "compose": _stable_repr(item.compose),
        "filters": sorted(
            (str(key), _stable_repr(value))
            for key, value in service.section_filters.items()
        ),
        "scopedFilters": scoped,
        "junctions": [_stable_repr(rule) for rule in service.junction_rules],
    }
    return hash_value(payload)


def _pair_stops(stops: Sequence[Any], pair_index: int) -> tuple[Any, Any]:
    """Origin and destination stops of a pair; a loop's closing pair wraps."""
    return stops[pair_index], stops[(pair_index + 1) % len(stops)]


def _endpoint_stop_lines(service: Any, pair_index: int, side: str) -> frozenset[str]:
    """N02 lines the build may take this endpoint stop's platform from.

    Reuses ``build.stop_lines``: the stop's adjacent pair lines, wrapping on a
    loop, with none past an open chain's ends and none from a compose pair.
    """
    per_stop = build.stop_lines(service.segment_ranges(), service.circular)
    stop_index = pair_index if side == "from" else (pair_index + 1) % len(per_stop)
    return frozenset(per_stop[stop_index])


def _pair_endpoint_options(
    stop: Any,
    resolution: Any,
    station: Any,
    source: Any,
    pair_line: str,
    side: str,
    *,
    stop_lines: frozenset[str] = frozenset(),
) -> tuple[
    list[PlatformCandidate],
    dict[tuple[str, str], tuple[PlatformCandidate, PlatformCandidate]],
]:
    """Resolve a pair endpoint, retaining exact shared-line anchor evidence.

    A stop pinned on another line is looked up on its selector's lines; a pin
    by code or group alone names no line, so its pinned platform is looked up
    on the lines the build offers that stop (``stop_lines``).
    """
    if side not in ("from", "to"):
        raise ValueError(f"unknown pair endpoint side: {side}")
    try:
        options = jr._candidate_options(stop, resolution, station, source, {pair_line})
        return options, {
            (candidate.station_code, candidate.group_code): (candidate, candidate)
            for candidate in options
        }
    except jr.RoutingError as direct_error:
        selector_lines = (stop.platform_selector.lines or stop_lines) - {pair_line}
        if not selector_lines or not stop.platform_selector.pins_group:
            raise

        # The selected build platform is pinned on another line. Ask the same
        # build-side invariant whether a feature on this pair's line is the
        # exact same N02 source feature before reusing that pinned platform.
        anchors = jr._candidate_options(
            stop, resolution, station, source, set(selector_lines)
        )
        track_candidates = [
            candidate
            for candidate in source.platform_candidates(
                [resolution.match_name], {pair_line}
            )
            if candidate.match_name == resolution.match_name
            and candidate.operator == resolution.source_operator
            and candidate.n02_line == pair_line
        ]
        valid: dict[tuple[str, str], tuple[PlatformCandidate, PlatformCandidate]] = {}
        for anchor in anchors:
            arrivals = {1: anchor} if side == "to" else {}
            departures = {0: anchor} if side == "from" else {}
            try:
                check_inherited_route_sources(
                    {(0, side): (pair_line, resolution.source_operator)},
                    arrivals,
                    departures,
                    (),
                    2,
                    track_candidates,
                )
            except OverrideError:
                continue
            matching_track = next(
                candidate
                for candidate in track_candidates
                if candidate.group_code == anchor.group_code
                and candidate.midpoint.coords[0] == anchor.midpoint.coords[0]
            )
            valid.setdefault(
                (matching_track.station_code, matching_track.group_code),
                (anchor, matching_track),
            )
        if not valid:
            raise direct_error
        return (
            [pair[1] for pair in valid.values()],
            {key: pair for key, pair in valid.items()},
        )


def _measure_group(
    group: str, *, root: Path = ROOT, component_ids: list[str] | None = None
) -> Path:
    verify_freeze(root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json", root)
    group_root = _group_root(root, group)
    inventory = read_json(group_root / "inventory.json")
    service_ids = inventory["serviceIds"]
    selected_components = _selected_components(inventory, component_ids)
    selected_ids = {item["componentId"] for item in selected_components}
    catalog_by_service = _frozen_catalog_by_service(root, set(service_ids))
    _apply_length_refs(
        group_root,
        service_ids,
        [item["componentId"] for item in inventory["components"]],
    )
    _, length_breakdowns = _parse_length_refs(group_root, service_ids)
    _validate_component_layout(group_root, inventory, catalog_by_service)
    _check_raw_checksums(root)
    raw_station_hash, raw_section_hash = _source_hashes(root)
    evidence: list[dict[str, str]] = []
    failures: list[str] = []
    pair_totals: dict[str, float] = defaultdict(float)
    selected_service_ids = {
        service_id
        for component in selected_components
        for service_id in component["serviceIds"]
    }
    for component_id in sorted(selected_ids):
        overrides_dir = group_root / "components" / component_id / "overrides"
        overrides = load_overrides(overrides_dir)
        provider = N02SourceProvider(
            root / "N02-25_GML/UTF-8", overrides.dataset.candidate_search_bbox
        )
        component_hash = _component_file_hash(overrides_dir)
        for service_id in overrides.dataset.service_ids:
            service = overrides.service(service_id)
            catalog_rows = catalog_by_service[service_id]
            constraints = jr.added_range_constraints(
                service,
                overrides_dir,
                root / "data/overrides",
                service.effective_n02_operator(overrides.dataset),
            )
            for pair_index in service_pair_indexes(
                list(service.station_ids), service.circular
            ):
                from_id, to_id = station_pairs(service.station_ids, service.circular)[
                    pair_index
                ]
                try:
                    item = service.segment_ranges()[pair_index]
                    lines = item.route_lines or (catalog_rows[pair_index]["n02_line"],)
                    if not lines or any(not line for line in lines):
                        raise StageError(
                            f"no frozen N02 line for {service_id} pair {pair_index}"
                        )
                    origin_stop, destination_stop = _pair_stops(
                        service.stops, pair_index
                    )
                    origin_resolution, origin_station = jr._stop_resolution(
                        overrides, service, origin_stop
                    )
                    destination_resolution, destination_station = jr._stop_resolution(
                        overrides, service, destination_stop
                    )
                    origin_options, origin_pairs = _pair_endpoint_options(
                        origin_stop,
                        origin_resolution,
                        origin_station,
                        provider.for_operator(origin_resolution.source_operator),
                        lines[0],
                        "from",
                        stop_lines=_endpoint_stop_lines(service, pair_index, "from"),
                    )
                    destination_options, destination_pairs = _pair_endpoint_options(
                        destination_stop,
                        destination_resolution,
                        destination_station,
                        provider.for_operator(destination_resolution.source_operator),
                        lines[-1],
                        "to",
                        stop_lines=_endpoint_stop_lines(service, pair_index, "to"),
                    )
                    endpoint_candidates = {
                        stop.station_id: options
                        for stop, options, pairs in (
                            (origin_stop, origin_options, origin_pairs),
                            (destination_stop, destination_options, destination_pairs),
                        )
                        if any(
                            anchor.n02_line != track.n02_line
                            for anchor, track in pairs.values()
                        )
                    }
                    pair_overrides = _PairOverrides(
                        overrides,
                        service_id,
                        pair_index,
                        endpoint_candidates,
                    )
                    row, window = jr._measure_pair(
                        cast(Overrides, pair_overrides),
                        service_id,
                        pair_index,
                        provider,
                        catalog_rows,
                        constraints,
                    )
                    from_anchor, from_track = origin_pairs[
                        (row["from_platform_code"], row["from_group_code"])
                    ]
                    to_anchor, to_track = destination_pairs[
                        (row["to_platform_code"], row["to_group_code"])
                    ]
                    row.update(
                        {
                            "from_platform_code": from_anchor.station_code,
                            "from_group_code": from_anchor.group_code,
                            "from_track_platform_code": from_track.station_code,
                            "to_platform_code": to_anchor.station_code,
                            "to_group_code": to_anchor.group_code,
                            "to_track_platform_code": to_track.station_code,
                        }
                    )
                    operators = service.range_operators(item, overrides.dataset)
                    legs = [
                        {
                            "operator": operator,
                            "line": line,
                            "sectionKeys": sorted(
                                window.get((operator, line), frozenset())
                            ),
                        }
                        for operator, line in zip(
                            operators, item.route_lines, strict=True
                        )
                    ]
                    row.update(
                        {
                            "route_legs_json": json.dumps(
                                legs, ensure_ascii=False, sort_keys=True
                            ),
                            "filter_recipe_sha256": _filter_recipe_hash(
                                service, pair_index, item, operators
                            ),
                            "override_sha256": component_hash,
                            "raw_station_sha256": raw_station_hash,
                            "raw_section_sha256": raw_section_hash,
                        }
                    )
                    row = {field: row.get(field, "") for field in EVIDENCE_FIELDS}
                    pair_totals[service_id] += float(row["path_length_km"])
                except (OSError, KeyError, ValueError, RuntimeError) as error:
                    failures.append(f"{service_id}:{from_id}~{to_id}: {error}")
                    item = service.segment_ranges()[pair_index]
                    operators = service.range_operators(item, overrides.dataset)
                    row = {
                        "service_id": service_id,
                        "from_id": from_id,
                        "to_id": to_id,
                        "n02_operator": " -> ".join(operators),
                        "n02_line": " -> ".join(item.route_lines),
                        "status": "failed",
                        "notes": str(error),
                    }
                    row = {field: row.get(field, "") for field in EVIDENCE_FIELDS}
                evidence.append(row)
    write_csv(group_root / "pair-evidence.csv", list(EVIDENCE_FIELDS), evidence)
    refs = read_csv(group_root / "length-refs.csv")[1]
    for row in refs:
        service_id = row["service_id"]
        if service_id not in selected_service_ids:
            row["n02_pair_sum_km"] = ""
            continue
        pair_sum = pair_totals.get(service_id, 0.0)
        row["n02_pair_sum_km"] = f"{pair_sum:.3f}" if pair_sum else ""
        if pair_sum:
            try:
                jr.check_length_tolerance(float(row["km"]), pair_sum)
            except StageError as error:
                row["notes"] = f"Distance mismatch: {error}"
                failures.append(f"{service_id}: {error}")
            else:
                row["notes"] = _length_measurement_note(length_breakdowns[service_id])
    write_csv(group_root / "length-refs.csv", list(LENGTH_FIELDS), refs)
    if failures:
        raise StageError("pair measurement failed: " + " | ".join(failures))
    write_json(
        group_root / "verification.json",
        {
            "status": "pairs-measured",
            "componentIds": [item["componentId"] for item in selected_components],
        },
    )
    return group_root / "pair-evidence.csv"


def _actual_track_platform_code(
    overrides: Overrides,
    service: Any,
    pair_index: int,
    side: str,
    anchor: PlatformCandidate,
    provider: N02SourceProvider,
) -> str:
    item = service.segment_ranges()[pair_index]
    lines = item.route_lines
    if not lines:
        return anchor.station_code
    operators = service.range_operators(item, overrides.dataset)
    if side == "from":
        line, operator = lines[0], operators[0]
        stop = service.stops[pair_index]
        anchor_index = 0
    else:
        line, operator = lines[-1], operators[-1]
        stop = service.stops[(pair_index + 1) % len(service.stops)]
        anchor_index = 1
    if anchor.n02_line == line:
        return anchor.station_code
    resolution, _ = jr._stop_resolution(overrides, service, stop)
    candidates = [
        candidate
        for candidate in provider.for_operator(operator).platform_candidates(
            [resolution.match_name], {line}
        )
        if candidate.match_name == resolution.match_name
        and candidate.operator == operator
        and candidate.n02_line == line
    ]
    arrivals = {anchor_index: anchor} if side == "to" else {}
    departures = {anchor_index: anchor} if side == "from" else {}
    try:
        check_inherited_route_sources(
            {(0, side): (line, operator)},
            arrivals,
            departures,
            (),
            2,
            candidates,
        )
    except OverrideError:
        return ""
    matching_track = next(
        candidate
        for candidate in candidates
        if candidate.group_code == anchor.group_code
        and candidate.midpoint.coords[0] == anchor.midpoint.coords[0]
    )
    return matching_track.station_code


def _actual_pair_metrics(
    result: Any, overrides: Overrides, provider: N02SourceProvider
) -> dict[str, dict[str, str]]:
    actual: dict[str, dict[str, str]] = {}
    for service_id, service_build in result.services.items():
        service = service_build.service
        pairs = station_pairs(service.station_ids, service.circular)
        for index, (from_id, to_id) in enumerate(pairs):
            path = service_build.routed.paths[index]
            departure = service_build.routed.departure(index)
            arrival = service_build.routed.arrival(index + 1)
            actual[f"{service_id}|{from_id}|{to_id}"] = {
                "service_id": service_id,
                "from_id": from_id,
                "to_id": to_id,
                "n02_line": service_build.segment_lines[index],
                "from_platform_code": departure.station_code,
                "from_group_code": departure.group_code,
                "from_track_platform_code": _actual_track_platform_code(
                    overrides, service, index, "from", departure, provider
                ),
                "to_platform_code": arrival.station_code,
                "to_group_code": arrival.group_code,
                "to_track_platform_code": _actual_track_platform_code(
                    overrides, service, index, "to", arrival, provider
                ),
                "path_length_km": f"{path.length / 1000:.6f}",
                "start_snap_m": f"{path.start_offset:.3f}",
                "end_snap_m": f"{path.end_offset:.3f}",
            }
    return actual


def _compare_measurements(
    evidence_rows: list[dict[str, str]], actual: dict[str, dict[str, str]]
) -> list[str]:
    problems: list[str] = []
    fields = (
        "n02_line",
        "from_platform_code",
        "from_group_code",
        "from_track_platform_code",
        "to_platform_code",
        "to_group_code",
        "to_track_platform_code",
        "path_length_km",
        "start_snap_m",
        "end_snap_m",
    )
    numeric_fields = {"path_length_km", "start_snap_m", "end_snap_m"}
    for row in evidence_rows:
        key = f"{row['service_id']}|{row['from_id']}|{row['to_id']}"
        measured = actual.get(key)
        if measured is None:
            problems.append(f"actual build lacks pair {key}")
            continue
        for field in fields:
            if field in numeric_fields:
                try:
                    matches = math.isclose(
                        float(row.get(field, "")),
                        float(measured.get(field, "")),
                        abs_tol=0.001,
                    )
                except ValueError:
                    matches = row.get(field, "") == measured.get(field, "")
            else:
                matches = row.get(field, "") == measured.get(field, "")
            if not matches:
                problems.append(f"evidence differs from actual build for {key} {field}")
    return problems


def _expected_pair_keys(
    inventory: dict[str, Any],
    catalog_by_service: dict[str, list[dict[str, str]]],
    component_ids: set[str] | None = None,
) -> set[str]:
    service_rows = {row["service_id"]: row for row in inventory["services"]}
    selected_services = {
        service_id
        for component in inventory["components"]
        if component_ids is None or component["componentId"] in component_ids
        for service_id in component["serviceIds"]
    }
    return {
        f"{service_id}|{from_id}|{to_id}"
        for service_id in selected_services
        for from_id, to_id in station_pairs(
            [row["station_id_original"] for row in catalog_by_service[service_id]],
            service_rows[service_id]["circular"] == "true",
        )
    }


def _selected_components(
    inventory: dict[str, Any], requested: list[str] | None
) -> list[dict[str, Any]]:
    components = inventory["components"]
    if not requested:
        return components
    by_id = {item["componentId"]: item for item in components}
    unknown = set(requested) - set(by_id)
    if unknown:
        raise StageError(f"unknown component id(s): {', '.join(sorted(unknown))}")
    if len(requested) != len(set(requested)):
        raise StageError("component id was selected more than once")
    return [by_id[component_id] for component_id in requested]


def gate(
    group: str,
    out_dir: Path,
    *,
    root: Path = ROOT,
    component_ids: list[str] | None = None,
) -> Path:
    """Build each component twice, validate both, and compare measured evidence."""
    verify_freeze(root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json", root)
    group_root = _group_root(root, group)
    inventory = read_json(group_root / "inventory.json")
    selected_components = _selected_components(inventory, component_ids)
    selected_ids = {item["componentId"] for item in selected_components}
    catalog_by_service = _frozen_catalog_by_service(root, set(inventory["serviceIds"]))
    _validate_component_layout(group_root, inventory, catalog_by_service)
    baseline = read_json(group_root / BASELINE_FILE)
    changed_baseline = _protected_changes(root, baseline)
    if changed_baseline:
        raise StageError(f"protected baseline changed: {', '.join(changed_baseline)}")
    _check_raw_checksums(root)
    evidence_fields, evidence_rows = read_csv(group_root / "pair-evidence.csv")
    if tuple(evidence_fields) != EVIDENCE_FIELDS or not evidence_rows:
        raise StageError("pair-evidence.csv is missing or has an invalid schema")
    expected_pairs = _expected_pair_keys(inventory, catalog_by_service, selected_ids)
    evidence_keys = [
        f"{row['service_id']}|{row['from_id']}|{row['to_id']}" for row in evidence_rows
    ]
    if (
        len(evidence_keys) != len(set(evidence_keys))
        or set(evidence_keys) != expected_pairs
    ):
        raise StageError(
            "pair evidence is duplicated or does not cover every service pair"
        )
    if any(row.get("status") != "pass" for row in evidence_rows):
        raise StageError("pair evidence contains an unmeasured or failed pair")
    references, length_breakdowns = _parse_length_refs(
        group_root, inventory["serviceIds"]
    )
    selected_service_ids = {
        service_id
        for component in selected_components
        for service_id in component["serviceIds"]
    }
    length_problems = _length_reference_findings(
        references, evidence_rows, selected_service_ids
    )
    if length_problems:
        raise StageError(
            "length-reference audit failed: " + " | ".join(length_problems)
        )
    output_root = out_dir.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "group": group,
        "lengthReferenceHashes": _length_reference_hashes(group_root),
        "components": {},
    }
    failures: list[str] = []
    for component in selected_components:
        component_id = component["componentId"]
        overrides_dir = _component_overrides(root, group, component_id)
        overrides = load_overrides(overrides_dir)
        reference_by_id = {
            row["service_id"]: row
            for row in references
            if row["service_id"] in overrides.dataset.service_ids
        }
        for service in overrides.services:
            reference = reference_by_id[service.id]
            length_ref = service.definition.length_ref
            if (
                round(length_ref.km, 3) != round(float(reference["km"]), 3)
                or length_ref.tolerance_km != LENGTH_TOLERANCE_KM
                or reference["source_url"] not in length_ref.source
                or _length_source_label(length_breakdowns[service.id])
                not in length_ref.source
            ):
                raise StageError(
                    f"lengthRef differs from mileage source data: {service.id}"
                )
        component_evidence = [
            row
            for row in evidence_rows
            if row["service_id"] in overrides.dataset.service_ids
        ]
        pair_metrics: dict[str, dict[str, str]] = {}
        output_hashes: dict[str, dict[str, str]] = {}
        for label in ("a", "b"):
            destination = output_root / component_id / label
            if destination.exists():
                shutil.rmtree(destination)
            result = build.build(root / "N02-25_GML/UTF-8", overrides_dir)
            export.write_outputs(destination, result.files)
            validation_report = validate.validate_dataset(
                validate.load_dataset(destination), overrides
            )
            if validation_report.errors:
                failures.extend(
                    f"{component_id}/{label}: {problem}"
                    for problem in validation_report.errors
                )
            output_hashes[label] = _tree_hashes(destination)
            provider = N02SourceProvider(
                root / "N02-25_GML/UTF-8",
                overrides.dataset.candidate_search_bbox,
            )
            actual = _actual_pair_metrics(result, overrides, provider)
            pair_metrics = actual
            failures.extend(
                f"{component_id}: {problem}"
                for problem in _compare_measurements(component_evidence, actual)
            )
        if output_hashes["a"] != output_hashes["b"]:
            failures.append(f"{component_id}: deterministic A/B output differs")
        report["components"][component_id] = {
            "serviceIds": list(overrides.dataset.service_ids),
            "outputs": output_hashes,
            "evidenceSha256": _evidence_hash(component_evidence),
            "actualPairs": {
                key: value
                for key, value in pair_metrics.items()
                if value["service_id"] in overrides.dataset.service_ids
            },
            "overrideSha256": _component_file_hash(overrides_dir),
        }
    if failures:
        raise StageError("gate failed: " + " | ".join(failures))
    write_json(group_root / GATE_FILE, report)
    write_json(
        group_root / "verification.json",
        {
            "status": "gate-passed"
            if len(selected_components) == len(inventory["components"])
            else "gate-partial",
            "componentIds": [item["componentId"] for item in selected_components],
            "gateReport": GATE_FILE,
            "outDir": str(output_root),
        },
    )
    return group_root / GATE_FILE


def audit(
    group: str,
    data_dir: Path,
    *,
    root: Path = ROOT,
    component_ids: list[str] | None = None,
) -> list[str]:
    """Audit protected baselines, complete evidence, hashes and gated artifacts."""
    verify_freeze(root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json", root)
    group_root = _group_root(root, group)
    problems: list[str] = []
    try:
        snapshot = read_json(group_root / BASELINE_FILE)
        changed = _protected_changes(root, snapshot)
        problems.extend(f"protected baseline changed: {item}" for item in changed)
    except (OSError, KeyError, json.JSONDecodeError) as error:
        return [f"baseline snapshot is missing or invalid: {error}"]
    inventory = read_json(group_root / "inventory.json")
    selected_components = _selected_components(inventory, component_ids)
    selected_ids = {item["componentId"] for item in selected_components}
    service_ids = list(inventory["serviceIds"])
    catalog_by_service = _frozen_catalog_by_service(root, set(service_ids))
    try:
        _validate_component_layout(group_root, inventory, catalog_by_service)
        _parse_length_refs(group_root, service_ids)
        _check_raw_checksums(root)
    except (OSError, KeyError, StageError, ValueError) as error:
        problems.append(str(error))
        return problems
    try:
        fields, evidence = read_csv(group_root / "pair-evidence.csv")
    except OSError as error:
        return [f"pair evidence is missing: {error}"]
    if tuple(fields) != EVIDENCE_FIELDS:
        problems.append("pair-evidence.csv schema differs")
    expected_pairs = _expected_pair_keys(inventory, catalog_by_service, selected_ids)
    actual_pairs = [
        f"{row.get('service_id')}|{row.get('from_id')}|{row.get('to_id')}"
        for row in evidence
    ]
    if len(actual_pairs) != len(set(actual_pairs)):
        problems.append("pair evidence contains duplicate rows")
    if set(actual_pairs) != expected_pairs:
        problems.append(
            f"pair evidence coverage differs: missing={sorted(expected_pairs - set(actual_pairs))[:5]} "
            f"unexpected={sorted(set(actual_pairs) - expected_pairs)[:5]}"
        )
    failed_rows = [row for row in evidence if row.get("status") != "pass"]
    if failed_rows:
        problems.append(f"pair evidence has {len(failed_rows)} failed measurements")
    selected_service_ids = {
        service_id
        for component in selected_components
        for service_id in component["serviceIds"]
    }
    try:
        references, _ = _parse_length_refs(group_root, service_ids)
        problems.extend(
            _length_reference_findings(references, evidence, selected_service_ids)
        )
    except (OSError, KeyError, StageError, ValueError) as error:
        problems.append(str(error))
    gate_path = group_root / GATE_FILE
    try:
        gate_report = read_json(gate_path)
    except (OSError, json.JSONDecodeError) as error:
        return [*problems, f"gate report is missing or invalid: {error}"]
    current_length_hashes = _length_reference_hashes(group_root)
    if gate_report.get("lengthReferenceHashes") != current_length_hashes:
        problems.append("gate length reference CSV hashes are stale")
    current_raw_station, current_raw_section = _source_hashes(root)
    for row in evidence:
        component_id = next(
            (
                component["componentId"]
                for component in inventory["components"]
                if row["service_id"] in component["serviceIds"]
            ),
            "",
        )
        overrides_dir = _component_overrides(root, group, component_id)
        if row.get("override_sha256") != _component_file_hash(overrides_dir):
            problems.append(f"evidence override hash is stale: {row.get('service_id')}")
        if (
            row.get("raw_station_sha256") != current_raw_station
            or row.get("raw_section_sha256") != current_raw_section
        ):
            problems.append(f"evidence raw N02 hash is stale: {row.get('service_id')}")
    by_key = {
        f"{row['service_id']}|{row['from_id']}|{row['to_id']}": row for row in evidence
    }
    for component in selected_components:
        component_id = component["componentId"]
        component_report = gate_report.get("components", {}).get(component_id)
        if component_report is None:
            problems.append(f"gate report lacks component {component_id}")
            continue
        overrides_dir = _component_overrides(root, group, component_id)
        if component_report.get("overrideSha256") != _component_file_hash(
            overrides_dir
        ):
            problems.append(f"gate report override hash is stale: {component_id}")
        component_evidence = [
            row for row in evidence if row["service_id"] in component["serviceIds"]
        ]
        if component_report.get("evidenceSha256") != _evidence_hash(component_evidence):
            problems.append(
                f"pair evidence differs from gated evidence snapshot: {component_id}"
            )
        for label in ("a", "b"):
            artifact_dir = data_dir / component_id / label
            expected_hashes = component_report.get("outputs", {}).get(label)
            if not artifact_dir.is_dir():
                problems.append(f"gated output is missing: {artifact_dir}")
                continue
            if _tree_hashes(artifact_dir) != expected_hashes:
                problems.append(f"gated output hash differs: {component_id}/{label}")
            try:
                overrides = load_overrides(overrides_dir)
                report = validate.validate_dataset(
                    validate.load_dataset(artifact_dir), overrides
                )
                problems.extend(
                    f"{component_id}/{label}: {item}" for item in report.errors
                )
            except (OSError, ValueError, KeyError) as error:
                problems.append(f"could not validate {component_id}/{label}: {error}")
        for key, measured in component_report.get("actualPairs", {}).items():
            row = by_key.get(key)
            if row is None:
                problems.append(f"actual output has no evidence row: {key}")
                continue
            for field in (
                "n02_line",
                "from_platform_code",
                "from_group_code",
                "from_track_platform_code",
                "to_platform_code",
                "to_group_code",
                "to_track_platform_code",
                "path_length_km",
                "start_snap_m",
                "end_snap_m",
            ):
                if row.get(field) != measured.get(field):
                    problems.append(
                        f"evidence differs from gated output: {key} {field}"
                    )
    selected_services = selected_service_ids
    reference_rows = [
        row
        for row in read_csv(group_root / "length-refs.csv")[1]
        if row["service_id"] in selected_services
    ]
    for reference in reference_rows:
        try:
            official_km = float(reference["km"])
            pair_sum_km = float(reference["n02_pair_sum_km"])
        except ValueError:
            problems.append(
                f"length reference lacks measured N02 sum: {reference['service_id']}"
            )
            continue
        try:
            jr.check_length_tolerance(official_km, pair_sum_km)
        except StageError as error:
            problems.append(f"{reference['service_id']}: {error}")
    if not problems:
        write_json(
            group_root / "verification.json",
            {
                "status": "audited"
                if len(selected_components) == len(inventory["components"])
                else "audit-partial",
                "componentIds": [item["componentId"] for item in selected_components],
                "gateReport": GATE_FILE,
                "dataDir": str(data_dir.resolve()),
                "lengthReferenceHashes": current_length_hashes,
            },
        )
    return problems


def build_handoff_report(*, root: Path = ROOT) -> dict[str, Any]:
    """Validate and return the complete non-JR staging handoff index without writing."""
    freeze_path = root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
    verify_freeze(freeze_path, root)
    target_service_id = read_json(freeze_path)["ruleset"]["targetServiceId"]
    catalog = research_rows(root, "tokyo-suburban-research-catalog.csv")
    service_rows = research_rows(root, "tokyo-suburban-research-services.csv")
    statuses: dict[str, Any] = {}
    covered_services: list[str] = []
    covered_stops = 0
    covered_pairs = 0
    identity_findings: list[str] = []
    freshness_findings: list[str] = []
    for group in GROUPS:
        group_root = _group_root(root, group)
        try:
            inventory = read_json(group_root / "inventory.json")
            verification = read_json(group_root / "verification.json")
            _, frozen_services = _group_services(root, group)
            frozen_ids = [row["service_id"] for row in frozen_services]
            if inventory["serviceIds"] != frozen_ids:
                identity_findings.append(f"{group}: frozen service inventory differs")
            catalog_by_service = _frozen_catalog_by_service(root, set(frozen_ids))
            expected_identity = [
                {
                    "service_id": service_id,
                    "station_id_original": row["station_id_original"],
                    "station_id_proposed": row["station_id_proposed"],
                }
                for service_id in frozen_ids
                for row in catalog_by_service[service_id]
            ]
            identity_fields, identity_rows = read_csv(group_root / "identity-map.csv")
            if (
                tuple(identity_fields) != IDENTITY_FIELDS
                or identity_rows != expected_identity
            ):
                identity_findings.append(
                    f"{group}: S4 identity map is incomplete or changed"
                )
            statuses[group] = {
                "status": verification.get("status", "unknown"),
                "services": inventory["counts"]["services"],
                "stops": inventory["counts"]["stops"],
                "pairs": inventory["counts"]["pairs"],
                "serviceIds": frozen_ids,
            }
            baseline = read_json(group_root / BASELINE_FILE)
            freshness_findings.extend(
                f"{group}: {item}" for item in _protected_changes(root, baseline)
            )
            gate_report = read_json(group_root / GATE_FILE)
            freshness_findings.extend(
                _length_reference_freshness_findings(
                    group, group_root, gate_report, verification
                )
            )
            evidence_fields, evidence_rows = read_csv(group_root / "pair-evidence.csv")
            if tuple(evidence_fields) != EVIDENCE_FIELDS:
                freshness_findings.append(f"{group}: pair-evidence schema differs")
            current_raw_hashes = _source_hashes(root)
            for row in evidence_rows:
                component = next(
                    item
                    for item in inventory["components"]
                    if row["service_id"] in item["serviceIds"]
                )
                overrides_dir = _component_overrides(
                    root, group, component["componentId"]
                )
                if row.get("override_sha256") != _component_file_hash(overrides_dir):
                    freshness_findings.append(
                        f"{group}: evidence override hash is stale for {row['service_id']}"
                    )
                if (
                    row.get("raw_station_sha256") != current_raw_hashes[0]
                    or row.get("raw_section_sha256") != current_raw_hashes[1]
                ):
                    freshness_findings.append(
                        f"{group}: evidence raw N02 hash is stale for {row['service_id']}"
                    )
            for component in inventory["components"]:
                component_id = component["componentId"]
                component_report = gate_report.get("components", {}).get(component_id)
                if component_report is None:
                    freshness_findings.append(
                        f"{group}: gate report lacks {component_id}"
                    )
                    continue
                overrides_dir = _component_overrides(root, group, component_id)
                if component_report.get("overrideSha256") != _component_file_hash(
                    overrides_dir
                ):
                    freshness_findings.append(
                        f"{group}: gate override hash is stale for {component_id}"
                    )
                component_evidence = [
                    row
                    for row in evidence_rows
                    if row["service_id"] in component["serviceIds"]
                ]
                if component_report.get("evidenceSha256") != _evidence_hash(
                    component_evidence
                ):
                    freshness_findings.append(
                        f"{group}: gate evidence hash is stale for {component_id}"
                    )
                data_dir = Path(verification["dataDir"])
                for label in ("a", "b"):
                    artifact_dir = data_dir / component_id / label
                    expected_hashes = component_report.get("outputs", {}).get(label)
                    if (
                        not artifact_dir.is_dir()
                        or _tree_hashes(artifact_dir) != expected_hashes
                    ):
                        freshness_findings.append(
                            f"{group}: audited output hash is stale for {component_id}/{label}"
                        )
            if verification.get("gateReport") != GATE_FILE:
                freshness_findings.append(
                    f"{group}: audit names a different gate report"
                )
            covered_services.extend(inventory["serviceIds"])
            covered_stops += inventory["counts"]["stops"]
            covered_pairs += inventory["counts"]["pairs"]
        except (OSError, KeyError, json.JSONDecodeError):
            statuses[group] = {"status": "missing"}
    expected_ids = {
        row["service_id"]
        for row in catalog
        if row["operator"]
        in {operator for values in GROUP_OPERATORS.values() for operator in values}
    }
    expected_stops = sum(1 for row in catalog if row["service_id"] in expected_ids)
    expected_pairs = sum(
        len(row["stop_ids"].split("|"))
        if row["circular"] == "true"
        else len(row["stop_ids"].split("|")) - 1
        for row in service_rows
        if row["service_id"] in expected_ids
    )
    services_by_id = {row["service_id"]: row for row in service_rows}

    def directed_segment_count(service_ids: Iterable[str]) -> int:
        return sum(
            len(
                directed_pairs(
                    services_by_id[service_id]["stop_ids"].split("|"),
                    services_by_id[service_id]["circular"] == "true",
                    service_id=service_id,
                    target_service_id=target_service_id,
                )
            )
            for service_id in service_ids
        )

    actual_ids = set(covered_services)
    report = {
        "groups": statuses,
        "counts": {
            "services": len(set(covered_services)),
            "stops": covered_stops,
            "pairs": covered_pairs,
            "directedSegments": directed_segment_count(covered_services),
        },
        "expected": {
            "services": len(expected_ids),
            "stops": expected_stops,
            "pairs": expected_pairs,
            "directedSegments": directed_segment_count(expected_ids),
        },
        "duplicateServices": sorted(
            service_id
            for service_id in set(covered_services)
            if covered_services.count(service_id) > 1
        ),
        "missingServices": sorted(expected_ids - actual_ids),
        "unexpectedServices": sorted(actual_ids - expected_ids),
        "identityMapFindings": identity_findings,
        "freshnessFindings": freshness_findings,
        "exceptions": _reviewed_exceptions(root),
    }
    if (
        set(statuses[group]["status"] for group in GROUPS) != {"audited"}
        or report["counts"] != report["expected"]
        or report["duplicateServices"]
        or report["missingServices"]
        or report["unexpectedServices"]
        or report["identityMapFindings"]
        or report["freshnessFindings"]
    ):
        raise StageError(
            "handoff is incomplete: "
            + json.dumps(report, ensure_ascii=False, sort_keys=True)
        )
    return report


def handoff(*, root: Path = ROOT) -> dict[str, Any]:
    """Validate and write the complete non-JR staging handoff index."""
    report = build_handoff_report(root=root)
    write_json(root / "data/staging/tokyo-suburban-nonjr/handoff-index.json", report)
    write_text(
        root / "data/staging/tokyo-suburban-nonjr/README.md",
        _handoff_readme(report),
    )
    return report


def _reviewed_exceptions(root: Path) -> list[dict[str, str]]:
    """Collect reviewed geometry exceptions for the S4 handoff record."""
    exceptions: list[dict[str, str]] = []
    for group in GROUPS:
        group_root = _group_root(root, group)
        for component_dir in sorted((group_root / "components").iterdir()):
            overrides_dir = component_dir / "overrides"
            for kind, filename, limit_field in (
                ("offset", "offset_exceptions.csv", "max_platform_offset_m"),
                ("detour", "detour_exceptions.csv", "max_detour_ratio"),
            ):
                path = overrides_dir / filename
                if not path.exists():
                    continue
                _, rows = read_csv(path)
                for row in rows:
                    exceptions.append(
                        {
                            "group": group,
                            "componentId": component_dir.name,
                            "kind": kind,
                            "serviceId": row["service_id"],
                            "fromId": row.get("from_id", ""),
                            "toId": row.get("to_id", ""),
                            "stationId": row.get("station_id", ""),
                            "limit": row[limit_field],
                            "reason": row["reason"],
                        }
                    )
            for path in sorted((overrides_dir / "services").glob("*/junctions.csv")):
                _, rows = read_csv(path)
                for row in rows:
                    exceptions.append(
                        {
                            "group": group,
                            "componentId": component_dir.name,
                            "kind": "junction",
                            "serviceId": path.parent.name,
                            "fromId": "",
                            "toId": "",
                            "stationId": "",
                            "limit": f"{row['lon']},{row['lat']}",
                            "reason": row["reason"],
                        }
                    )
    return exceptions


def _handoff_readme(report: dict[str, Any]) -> str:
    counts = report["counts"]
    lines = [
        "# Non-JR suburban staging handoff",
        "",
        "This index records the completed S3 non-JR staging inventory. Group overrides remain isolated for S4 assembly.",
        "",
        f"Inventory: {counts['services']} services, {counts['stops']} stop rows, {counts['pairs']} forward pairs, and {counts['directedSegments']} directed segments.",
        "",
        "The machine-readable inventory, group assignments, audit status, and reviewed geometry exceptions are in `handoff-index.json`.",
        "",
        "Rfinal command: `uv run python -m scripts.data_pipeline.stage_suburban_nonjr handoff`.",
        "",
        "All group verification records report audited status; their gate report and pair evidence hashes were checked against the files on disk when this index was generated.",
        "",
        "## Groups",
        "",
        "| Group | Services | Stops | Forward pairs | Audit |",
        "|---|---:|---:|---:|---|",
    ]
    for group, values in report["groups"].items():
        lines.append(
            f"| {group} | {values['services']} | {values['stops']} | {values['pairs']} | {values['status']} |"
        )
    return "\n".join(lines) + "\n"


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("seed", "measure-pairs", "gate", "audit", "handoff"):
        subparser = commands.add_parser(command)
        subparser.add_argument("--operator-group", choices=GROUPS)
        subparser.add_argument("--root", type=Path, default=ROOT)
        if command in ("measure-pairs", "gate", "audit"):
            subparser.add_argument("--component-id", action="append")
        if command == "gate":
            subparser.add_argument("--out-dir", type=Path, required=True)
        if command == "audit":
            subparser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args(arguments)
    try:
        if args.command == "handoff":
            print(json.dumps(handoff(root=args.root), ensure_ascii=False, indent=2))
            return 0
        if not args.operator_group:
            parser.error(f"{args.command} requires --operator-group")
        if args.command == "seed":
            print(f"PASS seeded {seed(args.operator_group, root=args.root)}")
        elif args.command == "measure-pairs":
            print(
                "PASS measured "
                f"{_measure_group(args.operator_group, root=args.root, component_ids=args.component_id)}"
            )
        elif args.command == "gate":
            print(
                "PASS gate "
                f"{gate(args.operator_group, args.out_dir, root=args.root, component_ids=args.component_id)}"
            )
        else:
            findings = audit(
                args.operator_group,
                args.data_dir,
                root=args.root,
                component_ids=args.component_id,
            )
            if findings:
                for problem in findings:
                    print(f"FAIL {problem}")
                return 2
            print(f"PASS audit {args.operator_group}")
    except (OSError, KeyError, StageError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL {error}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
