"""End-to-end build check; needs the raw N02 download (see data/README.md)."""

from __future__ import annotations

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.build import BuildResult, build

RAW_AVAILABLE = (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file()

pytestmark = pytest.mark.skipif(
    not RAW_AVAILABLE, reason="raw N02 data not downloaded (see data/README.md)"
)


@pytest.fixture(scope="module")
def result() -> BuildResult:
    return build(config.DEFAULT_RAW_DIR, config.DEFAULT_OVERRIDES_DIR)


def test_build_reproduces_published_files_byte_for_byte(result: BuildResult) -> None:
    assert set(result.files) == {
        config.STATIONS_FILE,
        config.SERVICES_FILE,
        config.SEGMENTS_FILE,
        config.SEGMENTS_GEOJSON_FILE,
        config.MANIFEST_FILE,
    }
    for name, text in result.files.items():
        published = (config.DEFAULT_OUT_DIR / name).read_bytes()
        assert text.encode("utf-8") == published, f"{name} is stale; rebuild"


def test_build_routes_every_segment_on_snapped_track(result: BuildResult) -> None:
    assert len(result.loop.paths) == config.EXPECTED_STATION_COUNT
    assert max(path.start_offset for path in result.loop.paths) < 1.0
    assert max(path.end_offset for path in result.loop.paths) < 1.0


def test_build_uses_expected_n02_line_per_corridor(result: BuildResult) -> None:
    chosen_lines = [candidate.n02_line for candidate in result.loop.chosen]

    assert set(chosen_lines[5:20]) == {"山手線"}  # 大崎 .. 駒込
    assert set(chosen_lines[21:28]) == {"東北線"}  # 西日暮里 .. 神田
    assert set(chosen_lines[0:4]) == {"東海道線"}  # 新橋 .. 高輪ゲートウェイ
