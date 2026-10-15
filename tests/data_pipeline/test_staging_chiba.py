"""Chiba stage inputs load and validate structurally without raw N02."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.catalogue import check_expected_catalogue
from scripts.data_pipeline.composition import check_recipes, dependency_order
from scripts.data_pipeline.override_checks import (
    check_offset_exception_references,
    check_platform_transfer_references,
)
from scripts.data_pipeline.override_loading import load_overrides
from scripts.data_pipeline.registry import OverrideError, check_scope
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.topology import directed_pairs

STAGE_DIR = config.REPO_ROOT / "data/staging/jr-east-capital-region/chiba/overrides"
RESEARCH_DIR = config.REPO_ROOT / ".claude/docs/research"


@pytest.fixture
def overrides():
    return load_overrides(STAGE_DIR)


def test_chiba_stage_loads_and_matches_pinned_oracle(overrides) -> None:
    check_expected_catalogue(overrides, STAGE_DIR)
    dataset = overrides.dataset
    assert dataset.validation_profile == "stage"
    assert dataset.stage_start_station_id == "funabashi"
    assert dataset.start_station_id == ""
    assert dataset.target_service_id == ""
    assert dataset.area.prefectures == ("千葉県",)
    assert dataset.budget_profile == "capital-region"
    assert dataset.simplify_tolerance_m == 1.0
    assert tuple(service.id for service in overrides.services) == dataset.service_ids
    assert len(overrides.services) == 17
    assert len(overrides.registry.stations) == 152
    oracle_path = STAGE_DIR / "expected-catalog.json"
    assert hashlib.sha256(oracle_path.read_bytes()).hexdigest() == (
        dataset.expected_catalogue_sha256
    )


def test_chiba_oracle_is_the_complete_contiguous_product_catalogue() -> None:
    with (RESEARCH_DIR / "jr-east-capital-region-product-catalog.csv").open() as f:
        rows = list(csv.DictReader(f))
    with (RESEARCH_DIR / "jr-east-capital-region-product-services.csv").open() as f:
        order = [row["service_id"] for row in csv.DictReader(f)]
    expected = []
    for service_id in order:
        full = sorted(
            (row for row in rows if row["service_id"] == service_id),
            key=lambda row: int(row["order"]),
        )
        positions = [i for i, row in enumerate(full) if row["prefecture"] == "千葉県"]
        if not positions:
            continue
        assert positions == list(range(positions[0], positions[-1] + 1))
        expected.append(
            {
                "id": service_id,
                "stationIds": [full[i]["station_id"] for i in positions],
            }
        )
    oracle = json.loads((STAGE_DIR / "expected-catalog.json").read_text())
    assert oracle["services"] == expected
    assert oracle["stationIds"] == list(
        dict.fromkeys(
            station for service in expected for station in service["stationIds"]
        )
    )


def test_chiba_services_have_valid_scopes_and_owned_composition(overrides) -> None:
    check_recipes(overrides)
    assert set(dependency_order(overrides.services)) == set(
        overrides.dataset.service_ids
    )
    check_offset_exception_references(overrides)
    check_platform_transfer_references(overrides)
    for service in overrides.services:
        ends = service.definition.endpoints
        assert ends is not None
        check_scope(
            service.id,
            service.station_ids,
            service.scope_stops,
            overrides.registry,
            overrides.dataset.area,
            (ends.first, ends.last),
        )
    assert overrides.registry.ids == tuple(
        json.loads((STAGE_DIR / "expected-catalog.json").read_text())["stationIds"]
    )
    for station in overrides.registry.stations:
        assert overrides.dataset.area.contains(station.prefecture, station.municipality)
        assert (
            station.id
            in overrides.service(station.representative_service_id).station_ids
        )


def test_chiba_stop_topology_reaches_all_stations_both_ways(overrides) -> None:
    report = Report()
    check_two_way_reachability(
        overrides.registry.ids,
        (
            pair
            for service in overrides.services
            for pair in directed_pairs(service.station_ids, service.circular)
        ),
        overrides.dataset.stage_start_station_id,
        report,
    )
    assert report.errors == []


def test_chiba_oracle_check_rejects_edited_bytes(tmp_path: Path) -> None:
    target = tmp_path / "overrides"
    shutil.copytree(STAGE_DIR, target)
    oracle_path = target / "expected-catalog.json"
    oracle = json.loads(oracle_path.read_text())
    oracle["services"][-1]["stationIds"].pop()
    oracle_path.write_text(json.dumps(oracle, ensure_ascii=False))
    with pytest.raises(OverrideError, match="expected catalogue SHA-256 mismatch"):
        load_overrides(target)


def test_chiba_tokyo_enclave_is_deferred_to_combined_s6(overrides) -> None:
    assert not {"ayase", "kameari", "kanamachi"} & set(overrides.registry.ids)
    assert not overrides.dataset.area.contains("東京都", "足立区")
    assert not overrides.dataset.area.contains("東京都", "葛飾区")
    local = overrides.service("jr-joban-local")
    assert local.scope_stops[0].station_id == "kanamachi"
    assert local.station_ids[0] == "matsudo"
