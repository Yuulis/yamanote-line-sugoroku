"""End-to-end build checks; need the raw N02 download (see data/README.md)."""

from __future__ import annotations

import pytest

from scripts.data_pipeline import config, rules
from scripts.data_pipeline.build import (
    BuildResult,
    ServiceBuild,
    build,
    platform_points,
    representative_points,
    route_network,
)
from scripts.data_pipeline.n02 import N02Source
from scripts.data_pipeline.overrides import Overrides, load_overrides
from tests.data_pipeline.support import CORE_FIXTURE_DIR

RAW_AVAILABLE = (config.DEFAULT_RAW_DIR / config.RAW_SECTION_FILE).is_file()

pytestmark = pytest.mark.skipif(
    not RAW_AVAILABLE, reason="raw N02 data not downloaded (see data/README.md)"
)

YAMANOTE = "jr-yamanote"


@pytest.fixture(scope="module")
def result() -> BuildResult:
    return build(config.DEFAULT_RAW_DIR, config.DEFAULT_OVERRIDES_DIR)


@pytest.fixture(scope="module")
def core_overrides() -> Overrides:
    return load_overrides(CORE_FIXTURE_DIR)


@pytest.fixture(scope="module")
def core_builds(core_overrides: Overrides) -> dict[str, ServiceBuild]:
    source = N02Source(config.DEFAULT_RAW_DIR, core_overrides.dataset.n02_operator)
    return route_network(source, core_overrides)


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
    loop = result.services[YAMANOTE].routed

    assert loop.circular is True
    assert len(loop.paths) == 30
    assert max(path.start_offset for path in loop.paths) < 1.0
    assert max(path.end_offset for path in loop.paths) < 1.0


def test_build_uses_expected_n02_line_per_corridor(result: BuildResult) -> None:
    chosen_lines = [c.n02_line for c in result.services[YAMANOTE].routed.chosen]

    assert set(chosen_lines[5:20]) == {"山手線"}  # 大崎 .. 駒込
    assert set(chosen_lines[21:28]) == {"東北線"}  # 西日暮里 .. 神田
    assert set(chosen_lines[0:4]) == {"東海道線"}  # 新橋 .. 高輪ゲートウェイ


def test_route_network_on_core_fixture_routes_every_service(
    core_overrides: Overrides, core_builds: dict[str, ServiceBuild]
) -> None:
    report = rules.Report()

    for service_id, item in core_builds.items():
        routed = item.routed
        expected_pairs = len(item.service.stops) - (0 if routed.circular else 1)
        length = sum(path.length for path in routed.paths)
        rules.check_service_length(
            service_id, length, item.service.definition.length_ref, report
        )
        assert len(routed.paths) == expected_pairs, service_id
        assert routed.circular is item.service.circular
        assert max(p.end_offset for p in routed.paths) <= config.MAX_SNAP_OFFSET_M
    rules.check_platform_offsets(
        platform_points(core_builds),
        representative_points(core_overrides, core_builds),
        core_overrides.offset_exceptions,
        report,
    )

    assert report.errors == []
    assert list(core_builds) == list(core_overrides.dataset.service_ids)


def test_route_network_on_core_fixture_keeps_yamanote_choice(
    result: BuildResult, core_builds: dict[str, ServiceBuild]
) -> None:
    published = [c.station_code for c in result.services[YAMANOTE].routed.chosen]
    fixture = [c.station_code for c in core_builds[YAMANOTE].routed.chosen]

    assert fixture == published


def test_route_network_on_core_fixture_resolves_n02_pitfalls(
    core_builds: dict[str, ServiceBuild],
) -> None:
    def chosen(service_id: str, station_id: str) -> tuple[str, str, str]:
        item = core_builds[service_id]
        candidate = item.routed.chosen[item.service.station_ids.index(station_id)]
        return (candidate.station_name, candidate.n02_line, candidate.group_code)

    # 東京 京葉線 platforms carry their own N02 group code (003785).
    assert chosen("jr-keiyo", "tokyo") == ("東京", "京葉線", "003785")
    # 大久保: the Tokyo 中央線 platform, not the 奥羽線 homonym (000759).
    assert chosen("jr-chuo-sobu-local", "okubo") == ("大久保", "中央線", "003604")
    # 阿佐ケ谷 (registry) matches the N02 spelling 阿佐ヶ谷.
    assert chosen("jr-chuo-sobu-local", "asagaya")[0] == "阿佐ヶ谷"


def test_raw_n02_source_matches_pinned_checksums() -> None:
    import hashlib

    records = (config.REPO_ROOT / "data" / "n02-2025.sha256").read_text().splitlines()
    assert len(records) == 2
    for record in records:
        expected, name = record.split(maxsplit=1)
        with (config.REPO_ROOT / name).open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        assert actual == expected, f"N02 source changed: {name}"
