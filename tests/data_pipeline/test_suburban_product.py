"""Product preparation and frozen S4 provenance checks."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest

from scripts.data_pipeline import export
from scripts.data_pipeline import product_suburban as product
from scripts.data_pipeline.overrides import OverrideError, parse_dataset
from scripts.data_pipeline.product_suburban_presentation import (
    build_ui_presentation,
    compact_json,
    load_line_colors,
    load_ui_presentation,
    require_same_presentation,
    validate_ui_presentation,
)
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


def test_dataset_parses_optional_ui_presentation_file_settings() -> None:
    source = product.read_json(ASSEMBLED / "overrides/dataset.json")
    source["uiPresentationFile"] = "ui-presentation.json"
    source["uiPresentationSha256"] = "a" * 64

    parsed = parse_dataset(source)

    assert parsed.ui_presentation_file == "ui-presentation.json"
    assert parsed.ui_presentation_sha256 == "a" * 64
    assert parsed.ui_presentation is None


def test_dataset_rejects_incomplete_or_unsafe_ui_presentation_settings() -> None:
    source = product.read_json(ASSEMBLED / "overrides/dataset.json")
    source["uiPresentationFile"] = "ui-presentation.json"
    with pytest.raises(OverrideError, match="must be set together"):
        parse_dataset(source)

    source["uiPresentationSha256"] = "a" * 64
    source["uiPresentationFile"] = "../outside.json"
    with pytest.raises(OverrideError, match="safe relative path"):
        parse_dataset(source)


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
    services_document = json.loads(
        (first / "services.json").read_text(encoding="utf-8")
    )
    stations_document = json.loads(
        (first / "stations.json").read_text(encoding="utf-8")
    )
    manifest["uiPresentation"] = build_ui_presentation(
        root=ROOT,
        lines=services_document["lines"],
        services=services_document["services"],
        stations=stations_document,
    )
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


def _presentation_fixture() -> tuple[
    dict[str, object],
    list[dict[str, str]],
    list[dict[str, object]],
    list[dict[str, str]],
]:
    lines = [
        {"id": "line-a", "name": "Line A", "color": "#112233"},
        {"id": "line-b", "name": "Line B", "color": "#445566"},
    ]
    services = [
        {
            "id": "service-a",
            "operator": "Operator A",
            "lineIds": ["line-a"],
            "stationIds": ["station-a"],
        },
        {
            "id": "service-b",
            "operator": "Operator B",
            "lineIds": ["line-b"],
            "stationIds": ["station-b"],
        },
    ]
    stations = [
        {"id": "station-a", "name": "Canonical A"},
        {"id": "station-b", "name": "Canonical B"},
    ]
    presentation: dict[str, object] = {
        "version": 1,
        "operators": [
            {"id": "Operator A", "name": "Operator A"},
            {"id": "Operator B", "name": "Operator B"},
        ],
        "lineGroups": [
            {
                "id": "line-a",
                "name": "Line A",
                "operatorId": "Operator A",
                "color": "#112233",
                "serviceIds": ["service-a"],
            },
            {
                "id": "line-b",
                "name": "Line B",
                "operatorId": "Operator B",
                "color": "#445566",
                "serviceIds": ["service-b"],
            },
        ],
        "stations": [{"id": "station-a", "aliases": ["Alias A"]}],
        "serviceStopNames": [
            {"serviceId": "service-a", "stationId": "station-a", "name": "Alias A"}
        ],
    }
    return presentation, lines, services, stations


def test_ui_presentation_uses_verified_aliases_and_oedo_grouping() -> None:
    services_document = product.read_json(ROOT / ".claude/logs/s4/gate/a/services.json")
    stations_document = product.read_json(ROOT / ".claude/logs/s4/gate/a/stations.json")

    presentation = build_ui_presentation(
        root=ROOT,
        lines=services_document["lines"],
        services=services_document["services"],
        stations=stations_document,
    )

    assert presentation["version"] == 1
    assert len(presentation["operators"]) == 15
    oedo = next(
        group for group in presentation["lineGroups"] if group["id"] == "toei-oedo"
    )
    assert oedo["name"] == "大江戸線"
    assert oedo["serviceIds"] == ["toei-oedo-loop", "toei-oedo-radial"]
    hamamatsucho = next(
        station
        for station in presentation["stations"]
        if station["id"] == "hamamatsucho"
    )
    assert hamamatsucho["aliases"] == ["大門"]
    assert compact_json(presentation).endswith("\n")
    assert "source_url" not in compact_json(presentation)
    assert all(group["color"] != "#808080" for group in presentation["lineGroups"])
    assert all(
        set(entry) == {"id", "color", "status", "source"}
        for entry in load_line_colors(ROOT / "data/presentation/line-colors.json")
    )


def test_ui_presentation_rejects_unknown_service_id() -> None:
    presentation, lines, services, stations = _presentation_fixture()
    presentation["serviceStopNames"][0]["serviceId"] = "unknown-service"

    with pytest.raises(ValueError, match="unknown service"):
        validate_ui_presentation(
            presentation, lines=lines, services=services, stations=stations
        )


def test_ui_presentation_rejects_duplicate_service_group_membership() -> None:
    presentation, lines, services, stations = _presentation_fixture()
    presentation["lineGroups"][1]["serviceIds"].append("service-a")

    with pytest.raises(ValueError, match="multiple UI groups"):
        validate_ui_presentation(
            presentation, lines=lines, services=services, stations=stations
        )


def test_ui_presentation_rejects_checksum_mismatch(tmp_path: Path) -> None:
    presentation, lines, services, stations = _presentation_fixture()
    path = tmp_path / "ui-presentation.json"
    path.write_text(compact_json(presentation), encoding="utf-8")
    expected_hash = hashlib.sha256(path.read_bytes()).hexdigest()

    with pytest.raises(ValueError, match="does not match"):
        load_ui_presentation(
            tmp_path,
            path.name,
            "0" * 64 if expected_hash != "0" * 64 else "1" * 64,
            lines=lines,
            services=services,
            stations=stations,
        )


def test_ui_presentation_rejects_altered_aliases() -> None:
    presentation, _, _, _ = _presentation_fixture()
    altered = json.loads(json.dumps(presentation))
    altered["stations"][0]["aliases"] = ["Unreviewed alias"]

    with pytest.raises(ValueError, match="differs from audited"):
        require_same_presentation(altered, presentation)


def test_line_color_table_rejects_checksum_tampering(tmp_path: Path) -> None:
    source = ROOT / "data/presentation/line-colors.json"
    altered = tmp_path / source.name
    altered.write_bytes(source.read_bytes() + b" ")

    with pytest.raises(ValueError, match="checksum"):
        load_line_colors(altered)


def test_line_color_rows_have_direct_sources_or_absence_evidence() -> None:
    document = json.loads(
        (ROOT / "data/presentation/line-colors.json").read_text(encoding="utf-8")
    )
    rows = document["lineGroups"]
    by_id = {row["id"]: row for row in rows}

    assert len(by_id) == len(rows)
    for row in rows:
        source = urlsplit(row["source"])
        assert source.scheme == "https"
        assert source.netloc
        assert source.path.rstrip("/").rsplit("/", maxsplit=1)[-1].lower() not in {
            "index",
            "index.html",
            "index.php",
        }
        if row["status"] == "official":
            assert row.get("method")
            assert not source.path.endswith("/")
        else:
            assert row["status"] == "unofficial"
            assert row.get("evidence")
        for parent_id in row.get("sharedWith", []):
            assert parent_id in by_id
            assert by_id[parent_id]["color"] == row["color"]


def test_ui_presentation_preserves_non_grey_jr_colors() -> None:
    services_document = product.read_json(ROOT / ".claude/logs/s4/gate/a/services.json")
    stations_document = product.read_json(ROOT / ".claude/logs/s4/gate/a/stations.json")
    original_colors = {
        line["id"]: line["color"]
        for line in services_document["lines"]
        if line["id"].startswith("jr-") and line["color"] != "#808080"
    }
    presentation = build_ui_presentation(
        root=ROOT,
        lines=services_document["lines"],
        services=services_document["services"],
        stations=stations_document,
    )
    actual_colors = {
        group["id"]: group["color"] for group in presentation["lineGroups"]
    }

    assert {key: actual_colors[key] for key in original_colors} == original_colors


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
