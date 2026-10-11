from __future__ import annotations

from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import (
    LineRange,
    OverrideError,
    expand_line_ranges,
    load_overrides,
)

EXPECTED_OUTER_LOOP = (
    "新橋 浜松町 田町 高輪ゲートウェイ 品川 大崎 五反田 目黒 恵比寿 渋谷 原宿 代々木 "
    "新宿 新大久保 高田馬場 目白 池袋 大塚 巣鴨 駒込 田端 西日暮里 日暮里 鶯谷 上野 "
    "御徒町 秋葉原 神田 東京 有楽町"
).split()


def _rewrite(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    assert old in text
    path.write_text(text.replace(old, new), encoding="utf-8")


def test_load_overrides_with_committed_tables_returns_outer_loop() -> None:
    overrides = load_overrides(config.DEFAULT_OVERRIDES_DIR)

    assert [station.name for station in overrides.stations] == EXPECTED_OUTER_LOOP
    assert overrides.station_ids[0] == "shimbashi"
    assert overrides.service.id == "jr-yamanote"


def test_segment_lines_with_committed_mapping_covers_each_segment_once() -> None:
    overrides = load_overrides(config.DEFAULT_OVERRIDES_DIR)

    lines = overrides.segment_lines()

    assert len(lines) == 30
    assert lines[0] == "東海道線"  # 新橋 -> 浜松町
    assert lines[4] == "山手線"  # 品川 -> 大崎
    assert lines[19] == "山手線"  # 駒込 -> 田端
    assert lines[20] == "東北線"  # 田端 -> 西日暮里
    assert lines[27] == "東北線"  # 神田 -> 東京
    assert lines[28] == "東海道線"  # 東京 -> 有楽町
    assert lines[29] == "東海道線"  # 有楽町 -> 新橋


def test_expand_line_ranges_with_wrapping_range_assigns_across_start() -> None:
    ids = ("a", "b", "c", "d")
    ranges = (LineRange("a", "c", "X"), LineRange("c", "a", "Y"))

    assert expand_line_ranges(ids, ranges) == ("X", "X", "Y", "Y")


def test_expand_line_ranges_with_gap_raises() -> None:
    ids = ("a", "b", "c", "d")

    with pytest.raises(OverrideError, match="without an N02 line"):
        expand_line_ranges(ids, (LineRange("a", "c", "X"),))


def test_expand_line_ranges_with_overlap_raises() -> None:
    ids = ("a", "b", "c")
    ranges = (LineRange("a", "c", "X"), LineRange("b", "a", "Y"))

    with pytest.raises(OverrideError, match="mapped twice"):
        expand_line_ranges(ids, ranges)


def test_expand_line_ranges_with_unknown_station_raises() -> None:
    with pytest.raises(OverrideError, match="unknown station"):
        expand_line_ranges(("a", "b"), (LineRange("a", "zzz", "X"),))


def test_load_overrides_with_swapped_stations_raises(overrides_copy: Path) -> None:
    path = overrides_copy / config.STATIONS_OVERRIDE_FILE
    _rewrite(path, "5,osaki,大崎,JY24", "5,gotanda,五反田,JY23")
    _rewrite(path, "6,gotanda,五反田,JY23", "6,osaki,大崎,JY24")

    with pytest.raises(OverrideError, match="outer-loop order broken"):
        load_overrides(overrides_copy)


def test_load_overrides_with_non_kebab_id_raises(overrides_copy: Path) -> None:
    _rewrite(
        overrides_copy / config.STATIONS_OVERRIDE_FILE,
        "takanawa-gateway",
        "Takanawa_Gateway",
    )

    with pytest.raises(OverrideError, match="kebab-case"):
        load_overrides(overrides_copy)


def test_load_overrides_with_missing_station_raises(overrides_copy: Path) -> None:
    path = overrides_copy / config.STATIONS_OVERRIDE_FILE
    lines = path.read_text(encoding="utf-8").splitlines()
    path.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")

    with pytest.raises(OverrideError, match="expected 30 stations"):
        load_overrides(overrides_copy)


def test_load_overrides_with_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(OverrideError, match="not found"):
        load_overrides(tmp_path)
