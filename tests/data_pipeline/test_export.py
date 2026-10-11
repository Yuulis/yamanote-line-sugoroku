from __future__ import annotations

import json
from pathlib import Path

import pytest
from shapely.geometry import LineString

from scripts.data_pipeline import config, export


def test_to_lon_lat_rounds_to_six_decimals() -> None:
    lon, lat = export.to_lon_lat(-5_000.123456, -40_000.987654)

    assert lon == round(lon, 6)
    assert lat == round(lat, 6)
    assert 139.6 < lon < 139.9  # zone IX origin is 139°50'E, 36°N
    assert 35.5 < lat < 35.8


def test_line_to_lon_lat_keeps_endpoints_and_drops_collinear_points() -> None:
    line = LineString([(0, 0), (50, 0.1), (100, 0)])

    coordinates = export.line_to_lon_lat(line)

    assert coordinates[0] == export.to_lon_lat(0, 0)
    assert coordinates[-1] == export.to_lon_lat(100, 0)
    assert len(coordinates) == 2


def test_build_segments_closes_loop_with_directed_ids() -> None:
    segments = export.build_segments("svc", ["a", "b", "c"])

    assert [segment["id"] for segment in segments] == [
        "svc:a:b",
        "svc:b:c",
        "svc:c:a",
    ]
    assert all(s["geometryFeatureId"] == s["id"] for s in segments)


def test_dumps_feature_collection_is_valid_json_without_crs() -> None:
    collection = export.build_segment_features(
        export.build_segments("svc", ["a", "b"]),
        [LineString([(0, 0), (10, 10)]), LineString([(10, 10), (0, 0)])],
    )

    parsed = json.loads(export.dumps_feature_collection(collection))

    assert parsed == collection
    assert "crs" not in parsed
    assert parsed["features"][0]["id"] == "svc:a:b"


def test_build_manifest_is_content_addressed() -> None:
    first = export.build_manifest(["x"], "2026-10-11")
    second = export.build_manifest(["x"], "2026-10-11")
    changed = export.build_manifest(["y"], "2026-10-11")

    assert first == second
    assert first["dataVersion"] != changed["dataVersion"]
    assert first["dataVersion"].startswith(config.DATA_VERSION_PREFIX)
    assert first["source"] == config.MANIFEST_SOURCE


def test_build_manifest_includes_updated_at_after_data_version() -> None:
    manifest = export.build_manifest(["x"], "2026-10-11")

    assert manifest["updatedAt"] == "2026-10-11"
    assert list(manifest)[:2] == ["dataVersion", "updatedAt"]


def test_build_manifest_data_version_ignores_updated_at() -> None:
    older = export.build_manifest(["x"], "2026-01-01")
    newer = export.build_manifest(["x"], "2026-10-11")

    assert older["dataVersion"] == newer["dataVersion"]


def test_write_outputs_writes_manifest_last(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    written: list[str] = []
    original = export.write_text

    def recording(path: Path, text: str) -> None:
        written.append(path.name)
        original(path, text)

    monkeypatch.setattr(export, "write_text", recording)
    files = {name: "{}\n" for name in [*export.GAME_DATA_FILES, config.MANIFEST_FILE]}

    export.write_outputs(tmp_path, files)

    assert written[-1] == config.MANIFEST_FILE
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(files)
