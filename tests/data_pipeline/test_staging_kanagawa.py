"""S6P Kanagawa stage profile: product oracle, scope, and recipe validation."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from itertools import pairwise
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.catalogue import check_expected_catalogue
from scripts.data_pipeline.composition import check_recipes
from scripts.data_pipeline.override_checks import (
    check_offset_exception_references,
    check_platform_transfer_references,
)
from scripts.data_pipeline.override_models import Overrides
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.registry import (
    Area,
    OverrideError,
    check_scope,
)
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.topology import directed_pairs

STAGE_DIR = (
    config.REPO_ROOT
    / "data"
    / "staging"
    / "jr-east-capital-region"
    / "kanagawa"
    / "overrides"
)
RESEARCH = config.REPO_ROOT / ".claude" / "docs" / "research"
DEFERRED_KANAGAWA_STATIONS = {
    "sagamiko",
    "fujino",
    "kobuchi",
    "fuchinobe",
    "yabe",
    "sagamihara",
}


def read_table(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


@pytest.fixture
def stage_inputs() -> Overrides:
    """Load and validate the complete stage override set without raw N02."""
    return load_overrides(STAGE_DIR)


def test_kanagawa_stage_inputs_match_product_catalogue_and_pinned_oracle(
    stage_inputs: Overrides,
) -> None:
    rows = read_table(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    product_services = read_table(
        RESEARCH / "jr-east-capital-region-product-services.csv"
    )
    touching = {row["service_id"] for row in rows if row["prefecture"] == "神奈川県"}
    assert len(touching) == 14
    assert len(stage_inputs.services) == 13
    assert stage_inputs.dataset.service_ids == tuple(
        row["service_id"]
        for row in product_services
        if row["service_id"] in touching and row["service_id"] != "jr-chuo-takao-fujino"
    )
    for service in stage_inputs.services:
        assert not service.circular
        full = sorted(
            (row for row in rows if row["service_id"] == service.id),
            key=lambda row: int(row["order"]),
        )
        selected = [row for row in full if row["prefecture"] == "神奈川県"]
        if service.id == "jr-yokohama":
            selected = [row for row in selected if int(row["order"]) <= 8]
        assert service.station_ids == tuple(row["station_id"] for row in selected)
        positions = [full.index(row) for row in selected]
        assert positions == list(range(positions[0], positions[-1] + 1))

    expected_station_ids = tuple(
        dict.fromkeys(
            sid for service in stage_inputs.services for sid in service.station_ids
        )
    )
    assert stage_inputs.registry.ids == expected_station_ids
    kanagawa_ids = {
        row["station_id"] for row in rows if row["prefecture"] == "神奈川県"
    }
    assert len(kanagawa_ids) == 103
    assert len(expected_station_ids) == 97
    assert kanagawa_ids - set(expected_station_ids) == DEFERRED_KANAGAWA_STATIONS
    check_expected_catalogue(stage_inputs, STAGE_DIR)
    payload = (STAGE_DIR / "expected-catalog.json").read_bytes()
    assert (
        hashlib.sha256(payload).hexdigest()
        == stage_inputs.dataset.expected_catalogue_sha256
    )


def test_kanagawa_stage_scope_registry_and_recipes_are_consistent(
    stage_inputs: Overrides,
) -> None:
    dataset = stage_inputs.dataset
    assert dataset.area == Area(("神奈川県",))
    assert dataset.budget_profile == "capital-region"
    assert dataset.simplify_tolerance_m == 1.0
    registry = stage_inputs.registry.by_id()
    for station in registry.values():
        assert dataset.area.contains(station.prefecture, station.municipality)
        assert (
            station.id
            in stage_inputs.service(station.representative_service_id).station_ids
        )
    for service in stage_inputs.services:
        ends = service.definition.endpoints
        assert ends is not None
        check_scope(
            service.id,
            service.station_ids,
            service.scope_stops,
            stage_inputs.registry,
            dataset.area,
            (ends.first, ends.last),
        )
        assert len(service.segment_ranges()) == len(service.stops) - 1
    check_recipes(stage_inputs)
    check_offset_exception_references(stage_inputs)
    check_platform_transfer_references(stage_inputs)
    assert stage_inputs.platform_transfers == ()
    assert stage_inputs.detour_exceptions == ()
    assert len(stage_inputs.dataset.service_ids) == 13
    assert len(stage_inputs.services) == 13
    assert (
        sum(
            bool(item.compose)
            for service in stage_inputs.services
            for item in service.line_ranges
        )
        == 18
    )


def test_kanagawa_stage_stop_lists_reach_every_selected_station_both_ways(
    stage_inputs: Overrides,
) -> None:
    report = Report()
    start = stage_inputs.dataset.validation_start_station_id
    assert start == "yokohama"
    for service in stage_inputs.services:
        assert start not in (service.station_ids[0], service.station_ids[-1])
    check_two_way_reachability(
        stage_inputs.registry.ids,
        (
            pair
            for service in stage_inputs.services
            for pair in directed_pairs(
                service.station_ids,
                service.circular,
                service_id=service.id,
                target_service_id=stage_inputs.dataset.directed_segment_target_service_id,
            )
        ),
        start,
        report,
    )
    assert report.errors == []


def test_kanagawa_stage_inputs_reject_an_edited_oracle(
    stage_inputs: Overrides, tmp_path: Path
) -> None:
    target = tmp_path / "overrides"
    shutil.copytree(STAGE_DIR, target)
    oracle_path = target / "expected-catalog.json"
    oracle = json.loads(oracle_path.read_text(encoding="utf-8"))
    oracle["services"][-1]["stationIds"].pop()
    oracle_path.write_text(json.dumps(oracle, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(OverrideError, match="SHA-256 mismatch"):
        check_expected_catalogue(stage_inputs, target)


def test_kanagawa_full_loader_accepts_stage_profile_and_interior_seed(
    stage_inputs: Overrides,
) -> None:
    assert stage_inputs.dataset.validation_profile == "stage"
    assert stage_inputs.dataset.stage_start_station_id == "yokohama"
    assert stage_inputs.dataset.start_station_id == ""
    assert stage_inputs.dataset.target_service_id == ""
    assert stage_inputs.dataset.expected_catalogue_sha256 == (
        "dea41cf1274218c44ca59326d4a2645b80c419bfa4f2c72b60592a077a81de9e"
    )


def test_kanagawa_area_cannot_add_tokyo_enclaves_by_municipality() -> None:
    area = Area(("神奈川県",), ("町田市", "八王子市"))
    assert not area.contains("東京都", "町田市")
    assert not area.contains("東京都", "八王子市")


def test_kanagawa_cross_border_inventory_covers_product_without_routing_it(
    stage_inputs: Overrides,
) -> None:
    product = read_table(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    expected = set()
    for service_id in dict.fromkeys(row["service_id"] for row in product):
        stops = sorted(
            (row for row in product if row["service_id"] == service_id),
            key=lambda row: int(row["order"]),
        )
        for a, b in pairwise(stops):
            if a["prefecture"] != b["prefecture"] and "神奈川県" in (
                a["prefecture"],
                b["prefecture"],
            ):
                expected.add((service_id, a["station_id"], b["station_id"]))
    inventory = read_table(STAGE_DIR.parent / "cross-border-pairs.csv")
    pairs = {(row["service_id"], row["from_id"], row["to_id"]) for row in inventory}
    assert len(expected) == 11
    assert pairs == expected | {
        ("jr-chuo-takao-fujino", "fujino", "uenohara"),
        ("jr-tokaido", "yugawara", "atami"),
    }
    assert len(inventory) == len(pairs) == 13
    routed_input_pairs = {
        (service.id, a, b)
        for service in stage_inputs.services
        for a, b in pairwise(service.station_ids)
    }
    assert not pairs & routed_input_pairs
