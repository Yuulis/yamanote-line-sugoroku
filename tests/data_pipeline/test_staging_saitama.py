"""S6P Saitama stage input and product-oracle checks, without raw N02."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.catalogue import check_expected_catalogue
from scripts.data_pipeline.override_loading import load_overrides
from scripts.data_pipeline.registry import OverrideError, check_scope
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.topology import directed_pairs

STAGE = config.REPO_ROOT / "data/staging/jr-east-capital-region/saitama"
OVERRIDES = STAGE / "overrides"
RESEARCH = config.REPO_ROOT / ".claude/docs/research"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_saitama_oracle_equals_frozen_product_subset_in_exact_order() -> None:
    rows = read_csv(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    order = read_csv(RESEARCH / "jr-east-capital-region-product-services.csv")
    expected = []
    for service in order:
        sid = service["service_id"]
        all_stops = sorted(
            (r for r in rows if r["service_id"] == sid), key=lambda r: int(r["order"])
        )
        positions = [
            i for i, row in enumerate(all_stops) if row["prefecture"] == "埼玉県"
        ]
        if not positions:
            continue
        assert service["circular"] == "false"
        assert positions == list(range(positions[0], positions[-1] + 1))
        expected.append(
            {"id": sid, "stationIds": [all_stops[i]["station_id"] for i in positions]}
        )
    station_ids = list(dict.fromkeys(s for r in expected for s in r["stationIds"]))
    oracle = json.loads((OVERRIDES / "expected-catalog.json").read_text())

    assert oracle == {"services": expected, "stationIds": station_ids}
    assert len(expected) == 9
    assert len(station_ids) == 75
    assert sum(len(s["stationIds"]) for s in expected) == 113


def test_saitama_stage_loads_profile_and_pinned_oracle() -> None:
    overrides = load_overrides(OVERRIDES)
    dataset = overrides.dataset
    payload = (OVERRIDES / dataset.expected_catalogue_file).read_bytes()

    assert hashlib.sha256(payload).hexdigest() == dataset.expected_catalogue_sha256
    assert dataset.area.prefectures == ("埼玉県",)
    assert dataset.budget_profile == "capital-region"
    assert dataset.simplify_tolerance_m == 1.0
    assert dataset.validation_profile == "stage"
    assert dataset.stage_start_station_id == "musashi-urawa"
    assert dataset.start_station_id == ""
    assert dataset.target_service_id == ""
    check_expected_catalogue(overrides, OVERRIDES)


def test_saitama_stage_scopes_match_product_extent_and_boundaries() -> None:
    overrides = load_overrides(OVERRIDES)
    product = read_csv(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    for service in overrides.services:
        ends = service.definition.endpoints
        assert ends is not None
        boundaries = check_scope(
            service.id,
            service.station_ids,
            service.scope_stops,
            overrides.registry,
            overrides.dataset.area,
            (ends.first, ends.last),
        )
        expected = sorted(
            (r for r in product if r["service_id"] == service.id),
            key=lambda r: int(r["order"]),
        )
        positions = [i for i, r in enumerate(expected) if r["prefecture"] == "埼玉県"]
        excerpt = expected[max(0, positions[0] - 1) : positions[-1] + 2]
        scope_in_product = [
            (row.station_id, row.prefecture)
            for row in service.scope_stops
            if row.prefecture in config.CAPITAL_REGION_PREFECTURES
        ]
        assert scope_in_product == [(r["station_id"], r["prefecture"]) for r in excerpt]
        assert len(boundaries) == (ends.first == "area-boundary") + (
            ends.last == "area-boundary"
        )


def test_saitama_stage_start_is_interior_and_reaches_every_station_both_ways() -> None:
    overrides = load_overrides(OVERRIDES)
    report = Report()
    start = overrides.dataset.stage_start_station_id
    assert start in overrides.registry.ids
    serving = [
        service for service in overrides.services if start in service.station_ids
    ]
    assert {service.id for service in serving} == {"jr-saikyo", "jr-musashino"}
    assert all(
        start not in (service.station_ids[0], service.station_ids[-1])
        for service in serving
    )

    check_two_way_reachability(
        overrides.registry.ids,
        (
            pair
            for service in overrides.services
            for pair in directed_pairs(service.station_ids, service.circular)
        ),
        start,
        report,
    )

    assert report.errors == []


def test_saitama_stage_rejects_edited_oracle(tmp_path: Path) -> None:
    overrides = load_overrides(OVERRIDES)
    target = tmp_path / "overrides"
    shutil.copytree(OVERRIDES, target)
    oracle_path = target / "expected-catalog.json"
    oracle = json.loads(oracle_path.read_text())
    oracle["services"][-1]["stationIds"].pop()
    oracle_path.write_text(json.dumps(oracle, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(OverrideError, match="SHA-256 mismatch"):
        check_expected_catalogue(overrides, target)


def test_saitama_cross_border_inventory_covers_product_and_external_neighbours() -> (
    None
):
    overrides = load_overrides(OVERRIDES)
    product = read_csv(RESEARCH / "jr-east-capital-region-product-catalog.csv")
    expected = set()
    for service in overrides.services:
        stops = sorted(
            (r for r in product if r["service_id"] == service.id),
            key=lambda r: int(r["order"]),
        )
        for a, b in zip(stops, stops[1:], strict=False):
            if (a["prefecture"] == "埼玉県") != (b["prefecture"] == "埼玉県"):
                expected.add((service.id, a["station_id"], b["station_id"]))
    expected |= {
        ("jr-hachiko", "tansho", "gumma-fujioka"),
        ("jr-utsunomiya", "kurihashi", "koga"),
        ("jr-takasaki", "jimbohara", "shimmachi"),
        ("jr-shonan-shinjuku-local", "koga", "kurihashi"),
        ("jr-shonan-shinjuku-rapid-takasaki", "shimmachi", "jimbohara"),
    }
    inventory = read_csv(STAGE / "cross-border-pairs.csv")
    assert len(inventory) == 14
    assert {(r["service_id"], r["from_id"], r["to_id"]) for r in inventory} == expected
    for row in inventory:
        assert row["proposed_n02_line_or_recipe"]
        assert (row["from_prefecture"] == "埼玉県") != (
            row["to_prefecture"] == "埼玉県"
        )
    scoped = {
        (service.id, a.station_id, b.station_id)
        for service in overrides.services
        for a, b in zip(service.scope_stops, service.scope_stops[1:], strict=False)
        if (a.prefecture == "埼玉県") != (b.prefecture == "埼玉県")
    }
    assert scoped == expected
