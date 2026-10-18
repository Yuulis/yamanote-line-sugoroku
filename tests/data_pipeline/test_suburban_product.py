"""Product preparation and frozen S4 provenance checks."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from scripts.data_pipeline import export
from scripts.data_pipeline import product_suburban as product
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    hash_tree,
    read_csv,
    write_csv,
    write_json,
)

ROOT = Path(__file__).resolve().parents[2]
ASSEMBLED = ROOT / "data/staging/tokyo-suburban-assembled"


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def test_verify_inputs_accepts_frozen_assembly() -> None:
    report = product.verify_inputs(root=ROOT)

    assert report["status"] == "verified"
    assert report["counts"] == {
        "services": 135,
        "stationGroups": 1586,
        "serviceStopRows": 2142,
        "serviceRoutePairRows": 2009,
        "directedSegments": 3988,
    }
    assert report["evidenceBatches"] == 10


def test_identity_sidecar_rejects_endpoint_identity_tampering(tmp_path: Path) -> None:
    source = ASSEMBLED / "identity-map.csv"
    fields, rows = read_csv(source)
    changed = [dict(row) for row in rows]
    changed[-1]["station_id_proposed"] = "wrong-endpoint-id"
    path = tmp_path / "identity-map.csv"
    write_csv(path, fields, changed)
    expected = product.expected_identity_rows(root=ROOT)

    with pytest.raises(StageError, match="identity-map"):
        product.check_identity_sidecar(path, expected)


def test_metadata_sidecar_rejects_frozen_original_name_tampering(
    tmp_path: Path,
) -> None:
    source = ASSEMBLED / "service-stop-metadata.csv"
    fields, rows = read_csv(source)
    changed = [dict(row) for row in rows]
    changed[0]["station_name_original"] = "fabricated name"
    path = tmp_path / "service-stop-metadata.csv"
    write_csv(path, fields, changed)

    with pytest.raises(StageError, match="service-stop-metadata"):
        product.check_metadata_sidecar(path, product.expected_metadata_rows(root=ROOT))


def test_ui_group_sidecar_rejects_unfrozen_group(tmp_path: Path) -> None:
    expected = product.expected_ui_groups(root=ROOT)
    changed = [dict(expected[0])]
    changed[0]["displayName"] = "別の表示名"
    path = tmp_path / "ui-line-groups.json"
    _write_json(path, changed)

    with pytest.raises(StageError, match="ui-line-groups"):
        product.check_ui_groups_sidecar(path, expected)


def test_shared_track_sidecar_rejects_candidate_endpoint_tampering(
    tmp_path: Path,
) -> None:
    expected = product.expected_shared_track_review(root=ROOT)
    changed = json.loads(json.dumps(expected, ensure_ascii=False))
    changed["candidates"][0]["pairs"][0]["from"] = "wrong-station-id"
    path = tmp_path / "shared-track-review.json"
    _write_json(path, changed)

    with pytest.raises(StageError, match="shared-track-review"):
        product.check_shared_track_sidecar(path, expected)


def test_assembly_report_rejects_composition_endpoint_tampering(
    tmp_path: Path,
) -> None:
    expected_review = product.expected_shared_track_review(root=ROOT)
    report = product.read_json(ASSEMBLED / "assembly-report.json")
    report["compositions"][0]["pairs"][0]["from"] = "wrong-station-id"
    path = tmp_path / "assembly-report.json"
    _write_json(path, report)

    with pytest.raises(StageError, match="assembly composition"):
        product.check_composition_report(path, expected_review)


def test_mileage_arithmetic_rejects_airport_subtraction_tampering() -> None:
    references = read_csv(ASSEMBLED / "length-refs.csv")[1]
    components = read_csv(ASSEMBLED / "length-ref-components.csv")[1]
    changed = [dict(row) for row in components]
    subtraction = next(
        row
        for row in changed
        if row["service_id"] == "keisei-narita-airport-access"
        and row["operation"] == "-"
    )
    subtraction["km"] = "30.0"

    with pytest.raises(StageError, match="mileage breakdown"):
        product.validate_mileage_arithmetic(references, changed)


def test_mileage_arithmetic_accepts_frozen_airport_subtraction() -> None:
    references = read_csv(ASSEMBLED / "length-refs.csv")[1]
    components = read_csv(ASSEMBLED / "length-ref-components.csv")[1]

    product.validate_mileage_arithmetic(references, components)


def test_product_dataset_changes_only_frozen_gameplay_fields() -> None:
    freeze = product.read_json(ROOT / product.FREEZE_PATH)
    source = product.read_json(ASSEMBLED / "overrides/dataset.json")

    transformed, changes = product.product_dataset(source, freeze)

    assert transformed["validationProfile"] == "gameplay"
    assert "stageStartStationId" not in transformed
    assert transformed["startStationId"] == "shimbashi"
    assert transformed["targetServiceId"] == "jr-yamanote"
    assert transformed["operator"] == "Tokyo suburban rail operators"
    assert transformed["areaName"] == "Tokyo suburban rail"
    assert transformed["updatedAt"] == source["updatedAt"]
    assert transformed["expectedCatalogSha256"] == source["expectedCatalogSha256"]
    assert {item["field"] for item in changes} == {
        "validationProfile",
        "stageStartStationId",
        "startStationId",
        "targetServiceId",
        "operator",
        "areaName",
    }


def _copy_product_files(source: Path, destination: Path) -> None:
    destination.mkdir()
    for name in product.PRODUCT_FILES:
        shutil.copy2(source / name, destination / name)


def test_compare_requires_identical_five_file_builds(tmp_path: Path) -> None:
    first = tmp_path / "a"
    second = tmp_path / "b"
    _copy_product_files(ROOT / ".claude/logs/s4/gate/a", first)
    _copy_product_files(ROOT / ".claude/logs/s4/gate/b", second)
    payloads = {
        name: (first / name).read_text(encoding="utf-8")
        for name in product.PAYLOAD_FILES
    }
    updated_at = product.read_json(ASSEMBLED / "overrides/dataset.json")["updatedAt"]
    manifest = export.build_manifest(export.manifest_inputs(payloads), updated_at)
    _write_json(first / "manifest.json", manifest)
    shutil.copy2(first / "manifest.json", second / "manifest.json")

    result = product.compare_builds(first, second, root=ROOT)

    assert result["byteIdentical"] is True
    assert set(result["hashes"]["a"]) == set(product.PRODUCT_FILES)
    assert result["dataVersion"] == export.data_version(
        [
            (first / name).read_text(encoding="utf-8")
            for name in sorted(export.GAME_DATA_FILES)
        ]
    )


def test_history_resolver_selects_live_before_cutover_and_archive_after(
    tmp_path: Path,
) -> None:
    public = tmp_path / "public/data"
    overrides = tmp_path / "data/overrides"
    public.mkdir(parents=True)
    overrides.mkdir(parents=True)
    (public / "manifest.json").write_text("historical manifest\n", encoding="utf-8")
    (overrides / "dataset.json").write_text(
        json.dumps({"areaName": "old edition", "operator": "old operator"}) + "\n",
        encoding="utf-8",
    )

    baseline = {
        "publicData": hash_tree(public),
        "liveOverrides": hash_tree(overrides),
    }
    jr_baseline = (
        tmp_path / "data/staging/tokyo-suburban-jr/combined/baseline-sha256.json"
    )
    nonjr_baseline = (
        tmp_path / "data/staging/tokyo-suburban-nonjr/metro/baseline-sha256.json"
    )
    jr_baseline.parent.mkdir(parents=True)
    nonjr_baseline.parent.mkdir(parents=True)
    write_json(jr_baseline, baseline["publicData"])
    write_json(nonjr_baseline, baseline)

    from scripts.data_pipeline.stage_suburban_support import resolve_historical_baseline

    assert resolve_historical_baseline(tmp_path, "public/data") == public
    assert resolve_historical_baseline(tmp_path, "data/overrides") == overrides

    archive = tmp_path / "data/baselines/jr-east-capital-region"
    shutil.copytree(public, archive / "public/data")
    shutil.copytree(overrides, archive / "data/overrides")
    (public / "manifest.json").write_text("product manifest\n", encoding="utf-8")
    (overrides / "dataset.json").write_text(
        json.dumps(
            {
                "areaName": "Tokyo suburban rail",
                "operator": "Tokyo suburban rail operators",
                "validationProfile": "gameplay",
                "startStationId": "shimbashi",
                "targetServiceId": "jr-yamanote",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    assert (
        resolve_historical_baseline(tmp_path, "public/data") == archive / "public/data"
    )
    assert (
        resolve_historical_baseline(tmp_path, "data/overrides")
        == archive / "data/overrides"
    )
