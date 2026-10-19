"""Independent coverage, actual directed reachability and per-dataset budgets."""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from scripts.data_pipeline.budgets import (
    BUDGET_PROFILES,
    budget_errors,
    check_file_budgets,
    file_size_report,
)
from scripts.data_pipeline.catalogue import check_expected_catalogue
from scripts.data_pipeline.overrides import Overrides, load_overrides, parse_dataset
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.validate import Dataset, validate_dataset
from tests.data_pipeline.support import historical_baseline

HISTORICAL_OVERRIDES_DIR = historical_baseline("data/overrides")


def test_expected_catalogue_pins_exact_order_and_station_union(
    committed_overrides: Overrides,
) -> None:
    check_expected_catalogue(committed_overrides, HISTORICAL_OVERRIDES_DIR)
    # Dropping a service from both the configured and built catalogue cannot pass.
    dropped = replace(
        committed_overrides,
        dataset=replace(
            committed_overrides.dataset,
            service_ids=committed_overrides.dataset.service_ids[:-1],
        ),
        services=committed_overrides.services[:-1],
    )
    with pytest.raises(OverrideError, match="expected catalogue mismatch"):
        check_expected_catalogue(dropped, HISTORICAL_OVERRIDES_DIR)
    reversed_order = replace(
        committed_overrides, services=tuple(reversed(committed_overrides.services))
    )
    with pytest.raises(OverrideError, match="expected catalogue mismatch"):
        check_expected_catalogue(reversed_order, HISTORICAL_OVERRIDES_DIR)


def test_hash_pinned_oracle_and_exact_stop_list(overrides_copy: Path) -> None:
    path = overrides_copy / "expected-catalog.json"
    original = path.read_text()
    path.write_text(original + "\n")
    with pytest.raises(OverrideError, match="SHA-256 mismatch"):
        load_overrides(overrides_copy)
    raw = json.loads(original)
    raw["services"][0]["stationIds"].reverse()
    payload = json.dumps(raw, ensure_ascii=False, indent=2) + "\n"
    path.write_text(payload)
    dataset_path = overrides_copy / "dataset.json"
    dataset = json.loads(dataset_path.read_text())
    dataset["expectedCatalogSha256"] = hashlib.sha256(payload.encode()).hexdigest()
    dataset_path.write_text(json.dumps(dataset))
    with pytest.raises(OverrideError, match="expected catalogue mismatch"):
        load_overrides(overrides_copy)


@pytest.mark.parametrize(
    "pairs,message",
    [
        ([("a", "b")], "back to start"),
        ([("b", "a")], "from start"),
        ([], "unreachable stations"),
    ],
)
def test_every_station_must_be_reachable_in_both_directions(
    pairs: list[tuple[str, str]], message: str
) -> None:
    report = Report()
    check_two_way_reachability(("a", "b"), pairs, "a", report)
    assert message in "\n".join(report.errors)
    assert "b" in "\n".join(report.errors)


def test_connected_directed_cycle_can_return_to_start() -> None:
    report = Report()
    check_two_way_reachability(
        ("a", "b", "c"), [("a", "b"), ("b", "c"), ("c", "a")], "a", report
    )
    assert report.errors == []


@pytest.mark.parametrize(
    "budget,key",
    [
        ("geojsonRaw", "bytes[segments.geojson]"),
        ("geojsonGzip", "gzip_bytes[segments.geojson]"),
        ("totalRaw", "total_raw_bytes"),
        ("totalGzip", "total_gzip_bytes"),
        ("references", "geometry_reference_count"),
        ("maxChainLength", "max_geometry_chain_length"),
    ],
)
def test_each_budget_rejects_only_its_own_overrun(budget: str, key: str) -> None:
    limits = BUDGET_PROFILES["23ku"]
    metrics = {key: limits[budget]}
    assert budget_errors(metrics, limits) == []
    metrics[key] += 1
    errors = budget_errors(metrics, limits)
    assert len(errors) == 1
    assert f"budget overrun {budget}" in errors[0]


def test_size_report_includes_all_five_files_gzip_and_flattened_references(
    published_dataset: Dataset, committed_overrides: Overrides
) -> None:
    files = {
        **published_dataset.payloads,
        "manifest.json": published_dataset.manifest_payload or "",
    }
    report = file_size_report(files)
    assert len([key for key in report if key.startswith("gzip_bytes[")]) == 5
    assert report["geometry_reference_count"] == 1_230
    assert report["max_geometry_chain_length"] == 3
    assert report["total_raw_bytes"] == sum(
        len(payload.encode()) for payload in files.values()
    )
    assert report == file_size_report(files)
    check_file_budgets(files, committed_overrides.dataset.budgets)
    with pytest.raises(OverrideError, match="budget overrun maxChainLength"):
        check_file_budgets(
            files, {**committed_overrides.dataset.budgets, "maxChainLength": 0}
        )


def test_regional_profile_and_configured_simplification(
    committed_overrides: Overrides,
) -> None:
    raw = json.loads((HISTORICAL_OVERRIDES_DIR / "dataset.json").read_text())
    parsed = parse_dataset(
        {
            **raw,
            "budgetProfile": "capital-region",
            "simplifyToleranceM": 3,
            "budgets": {"references": 10_000},
        }
    )
    assert parsed.budgets["geojsonRaw"] == 1_572_864
    assert parsed.budgets["geojsonGzip"] == 460_800
    assert parsed.budgets["totalRaw"] == 3_145_728
    assert parsed.budgets["totalGzip"] == 921_600
    assert parsed.budgets["references"] == 10_000
    assert parsed.simplify_tolerance_m == 3
    assert (
        committed_overrides.dataset.budgets["geojsonRaw"]
        == BUDGET_PROFILES["capital-region"]["geojsonRaw"]
    )


@pytest.mark.parametrize(
    "change",
    [
        {"budgetProfile": "unknown"},
        {"budgets": {"references": True}},
        {"budgets": {"references": 0}},
        {"budgets": {"unknown": 1}},
        {"simplifyToleranceM": 0},
        {"simplifyToleranceM": float("nan")},
        {"simplifyToleranceM": True},
    ],
)
def test_invalid_budget_or_simplification_config_is_rejected(
    change: dict[str, object],
) -> None:
    raw = json.loads((HISTORICAL_OVERRIDES_DIR / "dataset.json").read_text())
    with pytest.raises(OverrideError):
        parse_dataset({**raw, **change})


def test_validator_honours_dataset_chain_budget(
    dataset: Dataset, committed_overrides: Overrides
) -> None:
    limits = {**committed_overrides.dataset.budgets, "references": 1_229}
    overrides = replace(
        committed_overrides,
        dataset=replace(committed_overrides.dataset, budgets=limits),
    )
    report = validate_dataset(dataset, overrides)
    assert report.errors == ["budget overrun references: 1230 > 1229"]


@pytest.mark.parametrize(
    "pairs,expected",
    [
        (
            [("a", "b")],
            ["two-way reachability back to start: unreachable stations ['b']"],
        ),
        ([("a", "b"), ("b", "a")], []),
    ],
)
def test_generator_and_tuple_station_inputs_have_identical_reachability(
    pairs: list[tuple[str, str]], expected: list[str]
) -> None:
    tuple_report, generator_report = Report(), Report()
    check_two_way_reachability(("a", "b"), pairs, "a", tuple_report)
    check_two_way_reachability(
        (station for station in ("a", "b")), iter(pairs), "a", generator_report
    )
    assert tuple_report.errors == generator_report.errors == expected


def test_simplification_reports_every_tolerance_when_default_exceeds_budget(
    committed_overrides: Overrides, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from shapely.geometry import LineString

    import scripts.data_pipeline.build as build_module
    import scripts.data_pipeline.simplification as simplification_module
    from scripts.data_pipeline.n02 import TrackSection
    from tests.data_pipeline.composition_support import (
        SyntheticSource,
        composition_overrides,
    )

    overrides = composition_overrides(committed_overrides)
    source = SyntheticSource()
    original = source.track_sections

    def wavy_track(lines: object, around: object) -> dict:
        sections = original(lines, around)
        if "L0" in sections:
            points = []
            stations = source.members["L0"]
            for a, b in zip(stations, stations[1:], strict=False):
                first, last = source.points[a], source.points[b]
                points.extend([first.coords[0], ((first.x + last.x) / 2, first.y + 2)])
            points.append(source.points[stations[-1]].coords[0])
            sections["L0"] = [TrackSection("key", LineString(points))]
        return sections

    source.track_sections = wavy_track
    monkeypatch.setattr(build_module, "N02Source", lambda *args, **kwargs: source)
    default_files = build_module.generate_build(tmp_path, overrides).files
    default_bytes = file_size_report(default_files)["bytes[segments.geojson]"]
    overrides = replace(
        overrides,
        dataset=replace(
            overrides.dataset,
            budgets={**overrides.dataset.budgets, "geojsonRaw": default_bytes - 1},
        ),
    )
    monkeypatch.setattr(build_module, "load_overrides", lambda _: overrides)
    monkeypatch.setattr(simplification_module, "load_overrides", lambda _: overrides)
    with pytest.raises(OverrideError, match="budget overrun geojsonRaw"):
        build_module.build(tmp_path, tmp_path)
    report = simplification_module.compare(tmp_path, tmp_path)
    rows = report["comparisons"]
    assert [row["tolerance_m"] for row in rows] == [1.0, 3.0, 5.0]
    assert rows[0]["equals_default_output"]
    assert rows[0]["budget_errors"][0].startswith("budget overrun geojsonRaw")
    assert rows[1]["budget_errors"] == rows[2]["budget_errors"] == []
    assert rows[0]["coordinate_count"] > rows[1]["coordinate_count"]
    assert all(row["metrics"]["geometry_reference_count"] > 0 for row in rows)
