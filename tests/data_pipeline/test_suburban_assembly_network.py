"""Pin the completed S4 assembly against frozen inputs and saved gate outputs."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from scripts.data_pipeline.stage_suburban_assembly import normalize_station_name
from scripts.data_pipeline.stage_suburban_assembly_evidence import hash_value

ROOT = Path(__file__).parents[2]
ASSEMBLED = ROOT / "data/staging/tokyo-suburban-assembled"
FREEZE = ROOT / ".claude/docs/plans/tokyo-suburban-s0-freeze.json"
CATALOG = ROOT / ".claude/docs/research/tokyo-suburban-research-catalog.csv"
SERVICE_CATALOG = ROOT / ".claude/docs/research/tokyo-suburban-research-services.csv"
SHIPPED_CATALOG = (
    ROOT / ".claude/docs/research/jr-east-capital-region-product-catalog.csv"
)
GATE_SERVICES = ROOT / ".claude/logs/s4/gate/a/services.json"


def _csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as source:
        return list(csv.DictReader(source))


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _frozen_inputs() -> tuple[
    dict[str, Any], list[dict[str, str]], list[dict[str, str]]
]:
    return _json(FREEZE), _csv_rows(CATALOG), _csv_rows(SERVICE_CATALOG)


def _frozen_pairs(
    catalog: list[dict[str, str]], services: list[dict[str, str]]
) -> dict[str, list[tuple[str, str, str]]]:
    rows_by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in catalog:
        rows_by_service[row["service_id"]].append(row)
    result: dict[str, list[tuple[str, str, str]]] = {}
    for service in services:
        service_id = service["service_id"]
        rows = sorted(rows_by_service[service_id], key=lambda row: int(row["order"]))
        ids = [row["station_id_proposed"] for row in rows]
        count = len(ids) if service["circular"] == "true" else len(ids) - 1
        result[service_id] = [
            (service_id, ids[index], ids[(index + 1) % len(ids)])
            for index in range(count)
        ]
    return result


def test_assembly_counts_and_identity_map_match_frozen_csvs() -> None:
    freeze, catalog, services = _frozen_inputs()
    expected_counts = freeze["counts"]
    service_pairs = _frozen_pairs(catalog, services)
    expected_directed_segments = sum(
        len(pairs) if service_id == "jr-yamanote" else len(pairs) * 2
        for service_id, pairs in service_pairs.items()
    )
    original_ids = {row["station_id_original"] for row in catalog}
    proposed_ids = {row["station_id_proposed"] for row in catalog}

    assert (
        (len(services), len(catalog), len(proposed_ids))
        == (
            expected_counts["services"],
            expected_counts["serviceStopRows"],
            expected_counts["stationGroups"],
        )
        == (135, 2142, 1586)
    )
    assert (len(original_ids), len(proposed_ids)) == (1794, 1586)
    assert sum(map(len, service_pairs.values())) == 2009
    assert expected_directed_segments == expected_counts["directedSegments"] == 3988

    expected_identity = [
        {
            "service_id": row["service_id"],
            "order": row["order"],
            "station_id_original": row["station_id_original"],
            "station_id_proposed": row["station_id_proposed"],
        }
        for row in catalog
    ]
    assert _csv_rows(ASSEMBLED / "identity-map.csv") == expected_identity
    assert _json(ASSEMBLED / "inventory.json")["counts"] == {
        "services": len(services),
        "stationGroups": len(proposed_ids),
        "serviceStopRows": len(catalog),
        "serviceRoutePairRows": sum(map(len, service_pairs.values())),
        "directedSegments": expected_directed_segments,
    }


def test_shipped_id_and_stop_order_retention_and_platform_keys() -> None:
    shipped_rows = _csv_rows(SHIPPED_CATALOG)
    shipped_ids = {row["station_id"] for row in shipped_rows}
    shipped_by_service: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in shipped_rows:
        shipped_by_service[row["service_id"]].append(row)
    assert len(shipped_ids) == 472
    assert len(shipped_by_service) == 40

    assembled_stations = {
        row["id"] for row in _csv_rows(ASSEMBLED / "overrides/stations.csv")
    }
    assert shipped_ids <= assembled_stations

    for service_id, rows in shipped_by_service.items():
        expected = [
            row["station_id"] for row in sorted(rows, key=lambda row: int(row["order"]))
        ]
        path = ASSEMBLED / "overrides/services" / service_id / "stops.csv"
        actual = [row["station_id"] for row in _csv_rows(path)]
        cursor = iter(actual)
        assert all(
            any(candidate == station_id for candidate in cursor)
            for station_id in expected
        )

    built_services = _json(GATE_SERVICES)["services"]
    assert len(built_services) == 135
    for service in built_services:
        station_ids = service["stationIds"]
        assert set(service["platformCoordinates"]) == set(station_ids)


def test_registry_aliases_use_frozen_names_and_normalized_spelling() -> None:
    _, catalog, _ = _frozen_inputs()
    names: dict[str, str] = {}
    originals: dict[str, list[str]] = defaultdict(list)
    for row in catalog:
        station_id = row["station_id_proposed"]
        names[station_id] = row["station_name_ja"]
        originals[station_id].append(row["station_name_original"])

    registry = _csv_rows(ASSEMBLED / "overrides/stations.csv")
    assert len(registry) == len(names)
    for row in registry:
        station_id = row["id"]
        expected_name = normalize_station_name(names[station_id])
        expected_aliases = list(
            dict.fromkeys(
                normalized
                for original in originals[station_id]
                if (normalized := normalize_station_name(original)) != expected_name
            )
        )
        assert row["name"] == expected_name
        assert json.loads(row["aliases"]) == expected_aliases
    ichigaya = next(row for row in registry if row["id"] == "ichigaya")
    assert json.loads(ichigaya["aliases"]) == []


def test_frozen_ui_groups_and_shared_track_review_are_complete() -> None:
    freeze, catalog, services = _frozen_inputs()
    ui_groups = _json(ASSEMBLED / "ui-line-groups.json")
    assert ui_groups == freeze["representations"]["uiLineGroups"]
    assert ui_groups == [
        {
            "id": "toei-oedo",
            "displayName": "大江戸線",
            "serviceIds": ["toei-oedo-loop", "toei-oedo-radial"],
        }
    ]

    review = _json(ASSEMBLED / "shared-track-review.json")
    assert review["status"] == "reviewed"
    assert review["openCandidates"] == []
    composed = [
        candidate
        for candidate in review["candidates"]
        if candidate["decision"] == "composed"
    ]
    assert len(composed) == 5
    assert all(
        candidate["services"] == ["metro-fukutoshin", "metro-yurakucho"]
        for candidate in composed
    )
    compositions = _json(ASSEMBLED / "assembly-report.json")["compositions"]
    assert len(compositions) == 1
    assert compositions[0]["consumerServiceId"] == "metro-fukutoshin"
    assert compositions[0]["ownerServiceId"] == "metro-yurakucho"
    assert len(compositions[0]["pairs"]) == 5

    gate_segments = _json(ROOT / ".claude/logs/s4/gate/a/segments.json")
    loop_segments = [
        segment for segment in gate_segments if segment["serviceId"] == "toei-oedo-loop"
    ]
    loop_stops = [
        row["station_id"]
        for row in _csv_rows(ASSEMBLED / "overrides/services/toei-oedo-loop/stops.csv")
    ]
    loop_pairs = {(segment["from"], segment["to"]) for segment in loop_segments}
    frozen_loop_pairs = _frozen_pairs(catalog, services)["toei-oedo-loop"]
    expected_loop_pairs = {
        (origin, destination) for _, origin, destination in frozen_loop_pairs
    }
    assert loop_stops == [
        row["station_id_proposed"]
        for row in sorted(
            (row for row in catalog if row["service_id"] == "toei-oedo-loop"),
            key=lambda row: int(row["order"]),
        )
    ]
    assert len(loop_segments) == len(expected_loop_pairs) * 2
    assert loop_pairs == expected_loop_pairs | {
        (destination, origin) for origin, destination in expected_loop_pairs
    }


def test_d1_merge_offsets_follow_reviewed_formula_and_source_exceptions() -> None:
    review = _json(ASSEMBLED / "offset-review.json")
    _, catalog, _ = _frozen_inputs()
    group_ids = {
        row["station_id_proposed"]
        for row in _csv_rows(CATALOG)
        if row["station_id_original"] != row["station_id_proposed"]
    }
    d1_rows = review["d1MergeRows"]
    assert len(d1_rows) == 50
    for row in d1_rows:
        measured = row["measuredAOffsetM"]
        assert row["d1GroupId"] == row["stationId"]
        assert row["stationId"] in group_ids
        assert measured <= 600
        assert row["limitM"] == math.ceil(measured / 10) * 10 + 10

    source_limits: dict[tuple[str, str], str] = {}
    source_paths = [
        ROOT
        / "data/staging/tokyo-suburban-jr/combined/overrides/offset_exceptions.csv",
        *sorted(
            (ROOT / "data/staging/tokyo-suburban-nonjr").rglob(
                "overrides/offset_exceptions.csv"
            )
        ),
    ]
    proposed_by_original = {
        (row["service_id"], row["station_id_original"]): row["station_id_proposed"]
        for row in catalog
    }
    for path in source_paths:
        if path.exists():
            for row in _csv_rows(path):
                proposed = proposed_by_original.get(
                    (row["service_id"], row["station_id"]), row["station_id"]
                )
                source_limits[(row["service_id"], proposed)] = row[
                    "max_platform_offset_m"
                ]
    assembled_offsets = _csv_rows(ASSEMBLED / "overrides/offset_exceptions.csv")
    d1_keys = {(row["serviceId"], row["stationId"]) for row in d1_rows}
    for row in assembled_offsets:
        key = (row["service_id"], row["station_id"])
        if key not in d1_keys:
            assert source_limits[key] == row["max_platform_offset_m"]
    assert review["droppedOrReplacedRows"]
    assert len(review["droppedOrReplacedRows"]) == 5
    assert sorted(row["action"] for row in review["droppedOrReplacedRows"]) == [
        "dropped",
        "dropped",
        "dropped",
        "replaced",
        "replaced",
    ]


def test_ten_verified_evidence_batches_partition_frozen_service_pairs() -> None:
    _, catalog, services = _frozen_inputs()
    expected_by_service = _frozen_pairs(catalog, services)
    batches = sorted((ASSEMBLED / "evidence").iterdir())
    assert len(batches) == 10
    observed: list[tuple[str, str, str]] = []
    for batch in batches:
        manifest = _json(batch / "evidence-manifest.json")
        batch_service_ids = set(manifest["serviceIds"])
        rows = _csv_rows(batch / "pair-evidence.csv")
        actual = [(row["service_id"], row["from_id"], row["to_id"]) for row in rows]
        expected = [
            pair
            for service_id, pairs in expected_by_service.items()
            if service_id in batch_service_ids
            for pair in pairs
        ]
        expected_service_ids = list(dict.fromkeys(pair[0] for pair in expected))
        evidence_bytes = (batch / "pair-evidence.csv").read_bytes()
        assert manifest["formatVersion"] == 1
        assert manifest["batch"] == batch.name
        assert manifest["serviceIds"] == expected_service_ids
        assert manifest["pairCount"] == len(expected)
        assert manifest["expectedPairKeysSha256"] == hash_value(expected)
        assert (
            manifest["pairEvidenceSha256"] == hashlib.sha256(evidence_bytes).hexdigest()
        )
        assert all(row["status"] == "pass" for row in rows)
        assert actual == expected
        observed.extend(actual)
    expected_all = [pair for pairs in expected_by_service.values() for pair in pairs]
    assert len(observed) == len(set(observed)) == len(expected_all) == 2009
    assert set(observed) == set(expected_all)
    assert (
        _json(ASSEMBLED / "verification.json")["checks"]["allEvidenceBatchesVerified"]
        is True
    )


def test_assembled_text_files_are_lf_and_handoff_is_verified() -> None:
    text_extensions = {".csv", ".json", ".md"}
    crlf_files = [
        path.relative_to(ASSEMBLED).as_posix()
        for path in sorted(ASSEMBLED.rglob("*"))
        if path.is_file()
        and path.suffix in text_extensions
        and b"\r" in path.read_bytes()
    ]
    assert crlf_files == []
    verification = _json(ASSEMBLED / "verification.json")
    assert verification["status"] == "verified"
