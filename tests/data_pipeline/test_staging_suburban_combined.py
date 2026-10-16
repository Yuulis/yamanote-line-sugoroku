"""Integration regressions for the combined JR suburban staging dataset."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import generate_build
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.stage_suburban_jr import _frozen_jr_catalog, audit

STAGE_DIR = config.REPO_ROOT / "data/staging/tokyo-suburban-jr/combined/overrides"
LIVE_DIR = config.REPO_ROOT / "data/overrides"

pytestmark = pytest.mark.skipif(
    not (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file(),
    reason="raw N02 data not downloaded (see data/README.md)",
)


def _reachable(adjacency: dict[str, set[str]], start: str) -> set[str]:
    reached = {start}
    pending = [start]
    while pending:
        current = pending.pop()
        for neighbor in adjacency.get(current, set()) - reached:
            reached.add(neighbor)
            pending.append(neighbor)
    return reached


def test_combined_stage_matches_frozen_catalog_and_preserves_shipped_bundle(
    tmp_path: Path,
) -> None:
    overrides = load_overrides(STAGE_DIR)
    result = generate_build(config.DEFAULT_RAW_DIR, overrides)
    services = json.loads(result.files[config.SERVICES_FILE])
    stations = json.loads(result.files[config.STATIONS_FILE])
    segments = json.loads(result.files[config.SEGMENTS_FILE])
    geometry = json.loads(result.files[config.SEGMENTS_GEOJSON_FILE])["features"]
    service_rows = services["services"]
    frozen_order, frozen_by_service = _frozen_jr_catalog(config.REPO_ROOT)
    live = load_overrides(LIVE_DIR)
    live_stops = {service.id: list(service.station_ids) for service in live.services}
    live_station_ids = {station.id for station in live.registry.stations}

    assert len(service_rows) == 55
    assert len(stations) == 746
    assert len({station["id"] for station in stations} - live_station_ids) == 274
    assert sum(len(service["stationIds"]) for service in service_rows) == 976
    assert len(segments) == 1814
    assert [service["id"] for service in service_rows] == frozen_order
    for service in service_rows:
        service_id = service["id"]
        frozen_ids = [
            row["station_id_proposed"] for row in frozen_by_service[service_id]
        ]
        expected_ids = (
            frozen_ids
            if service_id in overrides.dataset.service_ids
            else [
                station_id
                for station_id in frozen_ids
                if station_id in live_stops[service_id]
            ]
        )
        assert service["stationIds"] == expected_ids

    forward: dict[str, set[str]] = {}
    backward: dict[str, set[str]] = {}
    for segment in segments:
        forward.setdefault(segment["from"], set()).add(segment["to"])
        backward.setdefault(segment["to"], set()).add(segment["from"])
    station_ids = {station["id"] for station in stations}
    assert _reachable(forward, "shimbashi") == station_ids
    assert _reachable(backward, "shimbashi") == station_ids

    baseline_services = json.loads(
        (config.REPO_ROOT / "public/data/services.json").read_bytes()
    )["services"]
    baseline_segments = {
        row["id"]: row
        for row in json.loads(
            (config.REPO_ROOT / "public/data/segments.json").read_bytes()
        )
    }
    baseline_geometry = {
        feature["id"]: feature
        for feature in json.loads(
            (config.REPO_ROOT / "public/data/segments.geojson").read_bytes()
        )["features"]
    }
    staged_services = {row["id"]: row for row in service_rows}
    staged_segments = {row["id"]: row for row in segments}
    staged_geometry = {feature["id"]: feature for feature in geometry}
    for baseline in baseline_services:
        staged = staged_services[baseline["id"]]
        assert all(
            staged["platformCoordinates"].get(station_id) == coordinates
            for station_id, coordinates in baseline["platformCoordinates"].items()
        )
    for segment_id, baseline in baseline_segments.items():
        staged = staged_segments[segment_id]
        assert staged["geometryFeatureIds"] == baseline["geometryFeatureIds"]
        for feature_id in baseline["geometryFeatureIds"]:
            assert staged_geometry[feature_id] == baseline_geometry[feature_id]

    for service_id in live_stops:
        live_path = LIVE_DIR / "services" / service_id / "line_mapping.csv"
        staged_path = STAGE_DIR / "services" / service_id / "line_mapping.csv"
        with live_path.open(newline="", encoding="utf-8") as source:
            live_rows = list(csv.DictReader(source))
        with staged_path.open(newline="", encoding="utf-8") as source:
            staged_rows = list(csv.DictReader(source))
        old_pairs = {(row["from_id"], row["to_id"]) for row in live_rows}
        staged_old_rows = {
            (row["from_id"], row["to_id"]): row
            for row in staged_rows
            if (row["from_id"], row["to_id"]) in old_pairs
        }
        assert all(
            staged_old_rows.get((row["from_id"], row["to_id"])) == row
            for row in live_rows
        )
        live_sections_path = LIVE_DIR / "services" / service_id / "sections.csv"
        staged_sections_path = STAGE_DIR / "services" / service_id / "sections.csv"
        if live_sections_path.exists():
            with live_sections_path.open(newline="", encoding="utf-8") as source:
                live_section_rows = list(csv.DictReader(source))
            with staged_sections_path.open(newline="", encoding="utf-8") as source:
                staged_section_rows = list(csv.DictReader(source))
            assert all(
                any(
                    all(staged_row.get(key) == value for key, value in row.items())
                    for staged_row in staged_section_rows
                )
                for row in live_section_rows
            )

    for filename, content in result.files.items():
        (tmp_path / filename).write_text(content, encoding="utf-8")
    assert audit("combined", tmp_path) == []
