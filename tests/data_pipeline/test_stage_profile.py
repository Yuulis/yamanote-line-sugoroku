"""Stage validation keeps data guarantees while removing gameplay goal rules."""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point

from scripts.data_pipeline import config
from scripts.data_pipeline.build import build, generate_build
from scripts.data_pipeline.export import build_files, dumps_pretty, write_outputs
from scripts.data_pipeline.override_parsing import parse_dataset
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.routing import RoutingError
from scripts.data_pipeline.validate import (
    Dataset,
    load_dataset,
    to_metric,
    validate_dataset,
)


def write_json(path: Path, raw: object) -> None:
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")


def enable_stage(directory: Path, start: str = "kasai-rinkai-koen") -> None:
    path = directory / "dataset.json"
    raw = json.loads(path.read_text())
    raw.pop("startStationId", None)
    raw.pop("targetServiceId", None)
    raw.update(validationProfile="stage", stageStartStationId=start)
    write_json(path, raw)


@pytest.fixture
def stage_dir(overrides_copy: Path) -> Path:
    """One real linear service; its last stop is the stage start (no circle)."""
    enable_stage(overrides_copy)
    ids = [
        "tokyo",
        "hatchobori",
        "etchujima",
        "shiomi",
        "shin-kiba",
        "kasai-rinkai-koen",
    ]
    path = overrides_copy / "dataset.json"
    raw = json.loads(path.read_text())
    oracle = {"services": [{"id": "jr-keiyo", "stationIds": ids}], "stationIds": ids}
    payload = dumps_pretty(oracle).encode()
    (overrides_copy / "expected-catalog.json").write_bytes(payload)
    raw.update(
        serviceIds=["jr-keiyo"],
        expectedCatalogSha256=hashlib.sha256(payload).hexdigest(),
    )
    write_json(path, raw)
    path = overrides_copy / "services.json"
    envelope = json.loads(path.read_text())
    write_json(
        path,
        {
            key: [item for item in items if item["id"] == "jr-keiyo"]
            for key, items in envelope.items()
        },
    )
    path = overrides_copy / "stations.csv"
    with path.open() as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        rows = [
            {**row, "representative_service_id": "jr-keiyo"}
            for row in reader
            if row["id"] in ids
        ]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields or [])
        writer.writeheader()
        writer.writerows(rows)
    (overrides_copy / "offset_exceptions.csv").write_text(
        "service_id,station_id,max_platform_offset_m,reason\n"
    )
    return overrides_copy


@pytest.fixture
def stage_artifact(
    stage_dir: Path, published_dataset: Dataset, tmp_path: Path
) -> tuple[Dataset, Overrides]:
    overrides = load_overrides(stage_dir)
    service = next(
        item for item in published_dataset.service_patterns if item["id"] == "jr-keiyo"
    )
    platforms = {
        station: Point(to_metric(coords))
        for station, coords in service["platformCoordinates"].items()
    }
    lines = [
        LineString([to_metric(xy) for xy in feature["geometry"]["coordinates"]])
        for feature in published_dataset.geojson["features"]
        if feature["properties"]["serviceId"] == "jr-keiyo"
    ]
    files = build_files(
        overrides,
        platforms,
        {("jr-keiyo", key): value for key, value in platforms.items()},
        {"jr-keiyo": lines},
    )
    output = tmp_path / "artifact"
    write_outputs(output, files)
    return load_dataset(output), overrides


def test_stage_linear_service_validates_without_target(
    stage_artifact: tuple[Dataset, Overrides],
) -> None:
    dataset, overrides = stage_artifact
    assert overrides.dataset.validation_profile == "stage"
    assert overrides.dataset.stage_start_station_id == "kasai-rinkai-koen"
    assert overrides.dataset.target_service_id == ""
    assert not any(service.circular for service in overrides.services)
    assert validate_dataset(dataset, overrides).errors == []
    assert dataset.manifest["schemaVersion"] == "3-stage"
    assert dataset.manifest["validationProfile"] == "stage"
    assert dataset.manifest["stageStartStationId"] == "kasai-rinkai-koen"


@pytest.mark.parametrize("value", [None, "", "typo", [], True])
def test_unknown_validation_profile_rejected(
    overrides_copy: Path, value: object
) -> None:
    path = overrides_copy / "dataset.json"
    raw = json.loads(path.read_text())
    raw["validationProfile"] = value
    with pytest.raises(OverrideError, match="validationProfile"):
        parse_dataset(raw)


@pytest.mark.parametrize("value", [None, "", [], True])
def test_stage_requires_explicit_start(stage_dir: Path, value: object) -> None:
    path = stage_dir / "dataset.json"
    raw = json.loads(path.read_text())
    raw["stageStartStationId"] = value
    with pytest.raises(OverrideError, match="stageStartStationId"):
        parse_dataset(raw)


@pytest.mark.parametrize("key", ["startStationId", "targetServiceId"])
def test_stage_rejects_gameplay_configuration(stage_dir: Path, key: str) -> None:
    raw = json.loads((stage_dir / "dataset.json").read_text())
    raw[key] = "ignored-value"
    with pytest.raises(OverrideError, match="gameplay"):
        parse_dataset(raw)


def test_gameplay_rejects_stage_start(overrides_copy: Path) -> None:
    raw = json.loads((overrides_copy / "dataset.json").read_text())
    raw["stageStartStationId"] = "tokyo"
    with pytest.raises(OverrideError, match="stageStartStationId"):
        parse_dataset(raw)


def test_explicit_gameplay_matches_default(overrides_copy: Path) -> None:
    raw = json.loads((overrides_copy / "dataset.json").read_text())
    assert parse_dataset(raw) == parse_dataset({**raw, "validationProfile": "gameplay"})


@pytest.mark.parametrize(
    "edit,message",
    [
        ({"targetServiceId": "unknown"}, "target service 'unknown' is unknown"),
        ({"targetServiceId": "jr-keiyo"}, "target service must be circular"),
        ({"startStationId": "tokyo"}, r"S\[0\].*must be the start station"),
    ],
)
def test_default_profile_keeps_gameplay_goal_checks(
    overrides_copy: Path, edit: dict[str, str], message: str
) -> None:
    path = overrides_copy / "dataset.json"
    write_json(path, {**json.loads(path.read_text()), **edit})
    with pytest.raises(OverrideError, match=message):
        load_overrides(overrides_copy)


def test_stage_start_must_be_registry_station(stage_dir: Path) -> None:
    enable_stage(stage_dir, "unknown")
    with pytest.raises(OverrideError, match="stage start.*registry"):
        load_overrides(stage_dir)


@pytest.mark.parametrize("command", ["build", "validate", "load"])
def test_live_overrides_reject_stage_profile(
    stage_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # A disposable directory stands in for live; never edit data/overrides.
    monkeypatch.setattr(config, "DEFAULT_OVERRIDES_DIR", stage_dir)
    alias = stage_dir.parent / "alias"
    alias.symlink_to(stage_dir, target_is_directory=True)
    if command == "validate":
        from scripts.data_pipeline.validate import main

        assert main(["--overrides-dir", str(alias), "--data-dir", "missing"]) == 1
        assert "stage profile is forbidden for live" in capsys.readouterr().out
    else:
        with pytest.raises(OverrideError, match="stage profile.*live"):
            if command == "build":
                build(Path("missing"), alias)
            else:
                load_overrides(alias)


def test_stage_output_cannot_be_written_to_public(
    stage_artifact: tuple[Dataset, Overrides],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, _ = stage_artifact
    public = tmp_path / "public"
    monkeypatch.setattr(config, "DEFAULT_OUT_DIR", public)
    with pytest.raises(ValueError, match="stage.*public"):
        write_outputs(
            public,
            {**dataset.payloads, "manifest.json": dumps_pretty(dataset.manifest)},
        )
    assert not public.exists()


def test_live_validation_rejects_stage_manifest(
    stage_artifact: tuple[Dataset, Overrides], committed_overrides: Overrides
) -> None:
    dataset, _ = stage_artifact
    errors = validate_dataset(dataset, committed_overrides).errors
    assert any("manifest.schemaVersion must be 3" in error for error in errors)


@pytest.mark.parametrize("remove", [False, True])
@pytest.mark.parametrize(
    "key,value",
    [
        ("schemaVersion", 3),
        ("validationProfile", "gameplay"),
        ("stageStartStationId", "tokyo"),
    ],
)
def test_stage_manifest_marker_cannot_be_removed_or_changed(
    stage_artifact: tuple[Dataset, Overrides], key: str, value: object, remove: bool
) -> None:
    dataset, overrides = stage_artifact
    if remove:
        del dataset.manifest[key]
    else:
        dataset.manifest[key] = value
    assert any(
        "manifest." + key in error
        for error in validate_dataset(dataset, overrides).errors
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_stage_validator_still_checks_two_way_reachability(
    stage_artifact: tuple[Dataset, Overrides], reverse: bool
) -> None:
    dataset, overrides = stage_artifact
    # Isolate only one direction at the last-stop start; other validators also fail.
    endpoint = "from" if reverse else "to"
    dataset.segments[:] = [
        segment
        for segment in dataset.segments
        if segment[endpoint] != "kasai-rinkai-koen"
    ]
    expected = "from start" if reverse else "back to start"
    assert any(
        "two-way reachability " + expected in error
        for error in validate_dataset(dataset, overrides).errors
    )


@pytest.mark.parametrize("repin", [False, True])
def test_stage_still_checks_expected_catalogue(stage_dir: Path, repin: bool) -> None:
    path = stage_dir / "expected-catalog.json"
    oracle = json.loads(path.read_text())
    oracle["services"][0]["stationIds"].reverse()
    write_json(path, oracle)
    if repin:
        dataset_path = stage_dir / "dataset.json"
        raw = json.loads(dataset_path.read_text())
        raw["expectedCatalogSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        write_json(dataset_path, raw)
    with pytest.raises(
        OverrideError, match="catalogue mismatch" if repin else "SHA-256 mismatch"
    ):
        load_overrides(stage_dir)


def test_stage_build_still_checks_reachability(
    stage_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from scripts.data_pipeline import build as builder

    overrides = load_overrides(stage_dir)
    # Feed an empty routed graph through the real post-export build check.
    monkeypatch.setattr(builder, "N02Source", lambda *args, **kwargs: None)
    monkeypatch.setattr(builder, "route_network", lambda *args: {})
    monkeypatch.setattr(builder, "representative_points", lambda *args: {})
    monkeypatch.setattr(
        builder.export, "build_files", lambda *args: {"segments.json": "[]"}
    )
    with pytest.raises(RoutingError, match="two-way reachability"):
        generate_build(Path("unused"), overrides)


@pytest.mark.skipif(
    not (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file(),
    reason="raw N02 data not downloaded",
)
def test_stage_linear_raw_build_and_validation(stage_dir: Path, tmp_path: Path) -> None:
    result = build(config.DEFAULT_RAW_DIR, stage_dir)
    output = tmp_path / "raw-stage"
    write_outputs(output, result.files)
    assert (
        validate_dataset(load_dataset(output), load_overrides(stage_dir)).errors == []
    )


def test_stage_keeps_budget_checks(stage_artifact: tuple[Dataset, Overrides]) -> None:
    dataset, overrides = stage_artifact
    overrides = replace(
        overrides,
        dataset=replace(
            overrides.dataset, budgets={**overrides.dataset.budgets, "totalRaw": 1}
        ),
    )
    assert any(
        "budget overrun totalRaw" in error
        for error in validate_dataset(dataset, overrides).errors
    )
