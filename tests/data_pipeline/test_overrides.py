from __future__ import annotations

from pathlib import Path

import pytest

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import ANY_PLATFORM, parse_platform_selector
from scripts.data_pipeline.overrides import (
    LineRange,
    OverrideError,
    Overrides,
    Stop,
    check_station_numbers,
    expand_line_ranges,
    expand_ranges,
    is_iso_date,
    load_overrides,
)
from tests.data_pipeline.support import CORE_FIXTURE_DIR, append_line, rewrite

EXPECTED_OUTER_LOOP = (
    "新橋 浜松町 田町 高輪ゲートウェイ 品川 大崎 五反田 目黒 恵比寿 渋谷 原宿 代々木 "
    "新宿 新大久保 高田馬場 目白 池袋 大塚 巣鴨 駒込 田端 西日暮里 日暮里 鶯谷 上野 "
    "御徒町 秋葉原 神田 東京 有楽町"
).split()

YAMANOTE_DIR = Path(config.SERVICES_OVERRIDE_DIR) / "jr-yamanote"
KEIYO_DIR = Path(config.SERVICES_OVERRIDE_DIR) / "jr-keiyo"


def _stops(*numbers: str) -> tuple[Stop, ...]:
    return tuple(
        Stop(
            order=index,
            station_id=f"s{index}",
            station_number=number,
            platform_selector=ANY_PLATFORM,
        )
        for index, number in enumerate(numbers)
    )


# --- committed tables ------------------------------------------------------


def test_load_overrides_with_committed_tables_returns_outer_loop(
    committed_overrides: Overrides,
) -> None:
    registry = committed_overrides.registry.by_id()
    target = committed_overrides.target

    assert [registry[i].name for i in target.station_ids] == EXPECTED_OUTER_LOOP
    assert target.station_ids[0] == "shimbashi"
    assert target.id == "jr-yamanote"
    assert target.definition.direction_labels.forward == "外回り"
    assert committed_overrides.dataset.updated_at == "2026-10-12"
    assert committed_overrides.dataset.service_ids == (
        "jr-yamanote",
        "jr-keihin-tohoku",
        "jr-chuo-sobu-local",
        "jr-saikyo",
        "jr-keiyo",
    )


def test_segment_lines_with_committed_mapping_covers_each_segment_once(
    committed_overrides: Overrides,
) -> None:
    lines = committed_overrides.target.segment_lines()

    assert len(lines) == 30
    assert lines[0] == "東海道線"  # 新橋 -> 浜松町
    assert lines[4] == "山手線"  # 品川 -> 大崎
    assert lines[19] == "山手線"  # 駒込 -> 田端
    assert lines[20] == "東北線"  # 田端 -> 西日暮里
    assert lines[27] == "東北線"  # 神田 -> 東京
    assert lines[28] == "東海道線"  # 東京 -> 有楽町
    assert lines[29] == "東海道線"  # 有楽町 -> 新橋


def test_load_overrides_with_core_fixture_returns_five_services() -> None:
    overrides = load_overrides(CORE_FIXTURE_DIR)
    registry = overrides.registry.by_id()

    assert len(overrides.registry.stations) == 67
    assert [s.id for s in overrides.services] == list(overrides.dataset.service_ids)
    assert [len(s.stops) for s in overrides.services] == [30, 22, 24, 10, 6]
    assert registry["asagaya"].name == "阿佐ケ谷"
    assert registry["asagaya"].n02_name == "阿佐ヶ谷"
    keihin = overrides.service("jr-keihin-tohoku")
    assert keihin.circular is False
    assert len(keihin.segment_lines()) == 21
    assert keihin.definition.endpoints is not None
    assert keihin.definition.endpoints.first == "area-boundary"


# --- line ranges -------------------------------------------------------------


def test_expand_line_ranges_with_wrapping_range_assigns_across_start() -> None:
    ids = ("a", "b", "c", "d")
    ranges = (LineRange("a", "c", "X"), LineRange("c", "a", "Y"))

    assert expand_line_ranges(ids, ranges) == ("X", "X", "Y", "Y")


def test_expand_line_ranges_with_open_chain_maps_n_minus_one_pairs() -> None:
    ids = ("a", "b", "c", "d")
    ranges = (LineRange("a", "b", "X"), LineRange("b", "d", "Y"))

    assert expand_line_ranges(ids, ranges, circular=False) == ("X", "Y", "Y")


def test_expand_line_ranges_with_backward_range_on_open_chain_raises() -> None:
    ids = ("a", "b", "c")

    with pytest.raises(OverrideError, match="backward"):
        expand_line_ranges(ids, (LineRange("c", "a", "X"),), circular=False)


def test_expand_line_ranges_with_gap_raises() -> None:
    ids = ("a", "b", "c", "d")

    with pytest.raises(OverrideError, match="without an N02 line"):
        expand_line_ranges(ids, (LineRange("a", "c", "X"),))


def test_expand_line_ranges_with_gap_on_open_chain_raises() -> None:
    with pytest.raises(OverrideError, match=r"without an N02 line mapping: \[1\]"):
        expand_line_ranges(("a", "b", "c"), (LineRange("a", "b", "X"),), False)


def test_expand_line_ranges_with_overlap_raises() -> None:
    ids = ("a", "b", "c")
    ranges = (LineRange("a", "c", "X"), LineRange("b", "a", "Y"))

    with pytest.raises(OverrideError, match="mapped twice"):
        expand_line_ranges(ids, ranges)


def test_expand_line_ranges_with_unknown_station_raises() -> None:
    with pytest.raises(OverrideError, match="unknown station"):
        expand_line_ranges(("a", "b"), (LineRange("a", "zzz", "X"),))


def test_expand_ranges_with_via_on_single_pair_keeps_hints() -> None:
    via = ((139.7, 35.6),)
    ranges = (LineRange("a", "b", "X", via), LineRange("b", "c", "X"))

    expanded = expand_ranges(("a", "b", "c"), ranges, circular=False)

    assert expanded[0].via == via
    assert expanded[1].via == ()


def test_expand_ranges_with_via_on_multi_pair_range_raises() -> None:
    ranges = (LineRange("a", "c", "X", ((139.7, 35.6),)),)

    with pytest.raises(OverrideError, match="single-pair range"):
        expand_ranges(("a", "b", "c"), ranges, circular=False)


# --- station numbers (per-service ordering evidence) ------------------------


@pytest.mark.parametrize(
    "numbers, circular",
    [
        (("JK38", "JK37", "JK36"), False),
        (("JB03", "JB04", "JB05"), False),
        (("JY02", "JY01", "JY03"), True),
        (("", "", ""), False),
    ],
)
def test_check_station_numbers_with_consecutive_numbers_passes(
    numbers: tuple[str, ...], circular: bool
) -> None:
    check_station_numbers(_stops(*numbers), circular)


@pytest.mark.parametrize(
    "numbers, circular, message",
    [
        (("JB03", "JB05", "JB06"), False, "order broken after s0"),
        (("JB03", "JB04", "JB03"), False, "order broken after s1"),
        (("JY01", "JY02", "JY04"), True, "consecutive"),
        (("JB03", "JK04"), False, "mix prefixes"),
        (("JB03", ""), False, "invalid station number"),
        (("JB3", "JB4"), False, "invalid station number"),
    ],
)
def test_check_station_numbers_with_broken_order_raises(
    numbers: tuple[str, ...], circular: bool, message: str
) -> None:
    with pytest.raises(OverrideError, match=message):
        check_station_numbers(_stops(*numbers), circular)


def test_load_overrides_with_swapped_stations_raises(overrides_copy: Path) -> None:
    path = overrides_copy / YAMANOTE_DIR / config.STOPS_OVERRIDE_FILE
    rewrite(path, "5,osaki,JY24", "5,gotanda,JY23")
    rewrite(path, "6,gotanda,JY23", "6,osaki,JY24")

    with pytest.raises(OverrideError, match="station-number order broken"):
        load_overrides(overrides_copy)


def test_load_overrides_with_swapped_linear_stops_raises(core_copy: Path) -> None:
    path = core_copy / KEIYO_DIR / config.STOPS_OVERRIDE_FILE
    rewrite(path, "2,etchujima,JE03", "2,shiomi,JE04")
    rewrite(path, "3,shiomi,JE04", "3,etchujima,JE03")

    with pytest.raises(OverrideError, match="station-number order broken"):
        load_overrides(core_copy)


# --- registry / per-service tables -------------------------------------------


def test_load_overrides_with_non_kebab_id_raises(overrides_copy: Path) -> None:
    rewrite(
        overrides_copy / config.REGISTRY_OVERRIDE_FILE,
        "takanawa-gateway",
        "Takanawa_Gateway",
    )

    with pytest.raises(OverrideError, match="kebab-case"):
        load_overrides(overrides_copy)


def test_load_overrides_with_missing_station_raises(overrides_copy: Path) -> None:
    path = overrides_copy / YAMANOTE_DIR / config.STOPS_OVERRIDE_FILE
    lines = path.read_text(encoding="utf-8").splitlines()
    path.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")

    with pytest.raises(OverrideError, match="expected 30 stations"):
        load_overrides(overrides_copy)


def test_load_overrides_with_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(OverrideError, match="not found"):
        load_overrides(tmp_path)


def test_load_overrides_with_missing_column_raises(overrides_copy: Path) -> None:
    rewrite(
        overrides_copy / YAMANOTE_DIR / config.STOPS_OVERRIDE_FILE,
        ",platform_selector",
        "",
    )

    with pytest.raises(OverrideError, match="missing columns"):
        load_overrides(overrides_copy)


def test_load_overrides_with_unknown_stop_station_raises(core_copy: Path) -> None:
    rewrite(core_copy / KEIYO_DIR / config.STOPS_OVERRIDE_FILE, "shiomi", "nowhere")

    with pytest.raises(OverrideError, match="not an in-area registry station"):
        load_overrides(core_copy)


def test_load_overrides_with_unserved_registry_station_raises(
    overrides_copy: Path,
) -> None:
    append_line(
        overrides_copy / config.REGISTRY_OVERRIDE_FILE,
        "unserved,未収録駅,,品川区,jr-yamanote",
    )

    with pytest.raises(OverrideError, match="served by no service"):
        load_overrides(overrides_copy)


def test_load_overrides_with_foreign_representative_raises(core_copy: Path) -> None:
    rewrite(
        core_copy / config.REGISTRY_OVERRIDE_FILE,
        "shiomi,潮見,,江東区,jr-keiyo",
        "shiomi,潮見,,江東区,jr-yamanote",
    )

    with pytest.raises(OverrideError, match="does not stop there"):
        load_overrides(core_copy)


def test_load_overrides_with_catalogue_mismatch_raises(core_copy: Path) -> None:
    rewrite(core_copy / config.DATASET_OVERRIDE_FILE, '    "jr-keiyo"\n', "")
    rewrite(core_copy / config.DATASET_OVERRIDE_FILE, '"jr-saikyo",', '"jr-saikyo"')

    with pytest.raises(OverrideError, match="reviewed catalogue"):
        load_overrides(core_copy)


def test_load_overrides_with_start_at_linear_endpoint_raises(core_copy: Path) -> None:
    rewrite(
        core_copy / KEIYO_DIR / config.STOPS_OVERRIDE_FILE, "0,tokyo,", "0,shimbashi,"
    )
    rewrite(
        core_copy / KEIYO_DIR / config.LINE_MAPPING_OVERRIDE_FILE,
        "tokyo,kasai",
        "shimbashi,kasai",
    )

    with pytest.raises(OverrideError, match="is an endpoint of jr-keiyo"):
        load_overrides(core_copy)


def test_load_overrides_with_linear_service_without_endpoints_raises(
    core_copy: Path,
) -> None:
    rewrite(
        core_copy / config.SERVICES_OVERRIDE_FILE,
        '"endpoints": {\n        "first": "terminus",\n        "last": "area-boundary"\n      },',
        "",
    )

    with pytest.raises(OverrideError, match="needs 'endpoints'"):
        load_overrides(core_copy)


def test_load_overrides_with_unknown_endpoint_kind_raises(core_copy: Path) -> None:
    rewrite(
        core_copy / config.SERVICES_OVERRIDE_FILE,
        '"first": "terminus"',
        '"first": "dead-end"',
    )

    with pytest.raises(OverrideError, match="endpoint kind"):
        load_overrides(core_copy)


def test_load_overrides_with_duplicate_offset_exception_raises(core_copy: Path) -> None:
    path = core_copy / config.OFFSET_EXCEPTIONS_OVERRIDE_FILE
    append_line(path, "jr-keiyo,tokyo,600,duplicate row")

    with pytest.raises(OverrideError, match="duplicate offset exception"):
        load_overrides(core_copy)


def test_load_overrides_with_offset_exception_for_unserved_stop_raises(
    core_copy: Path,
) -> None:
    append_line(
        core_copy / config.OFFSET_EXCEPTIONS_OVERRIDE_FILE,
        "jr-keiyo,shimbashi,600,not a keiyo stop",
    )

    with pytest.raises(OverrideError, match="does not stop at"):
        load_overrides(core_copy)


def test_load_overrides_with_platform_selector_parses_it(core_copy: Path) -> None:
    path = core_copy / Path(config.SERVICES_OVERRIDE_DIR) / "jr-chuo-sobu-local"
    rewrite(
        path / config.STOPS_OVERRIDE_FILE, "6,okubo,JB09,", "6,okubo,JB09,group=003604"
    )

    service = load_overrides(core_copy).service("jr-chuo-sobu-local")

    assert service.stops[6].platform_selector == parse_platform_selector("group=003604")


def test_load_overrides_with_bad_platform_selector_raises(core_copy: Path) -> None:
    path = core_copy / Path(config.SERVICES_OVERRIDE_DIR) / "jr-chuo-sobu-local"
    rewrite(
        path / config.STOPS_OVERRIDE_FILE, "6,okubo,JB09,", "6,okubo,JB09,colour=red"
    )

    with pytest.raises(OverrideError, match="bad platform selector"):
        load_overrides(core_copy)


def test_load_overrides_with_section_constraints_builds_filter(core_copy: Path) -> None:
    key = "139.70000 35.60000~139.70100 35.60100#0123abcd"
    (core_copy / KEIYO_DIR / config.SECTION_CONSTRAINTS_OVERRIDE_FILE).write_text(
        f"n02_line,action,section_key,reason\n京葉線,deny,{key},test\n",
        encoding="utf-8",
    )

    service = load_overrides(core_copy).service("jr-keiyo")

    assert service.section_filter("京葉線").deny == frozenset({key})
    assert service.section_filter("東北線").is_open


def test_load_overrides_with_section_constraint_on_unmapped_line_raises(
    core_copy: Path,
) -> None:
    (core_copy / KEIYO_DIR / config.SECTION_CONSTRAINTS_OVERRIDE_FILE).write_text(
        "n02_line,action,section_key,reason\n東北線,deny,1.0 2.0~3.0 4.0,test\n",
        encoding="utf-8",
    )

    with pytest.raises(OverrideError, match="unmapped lines"):
        load_overrides(core_copy)


# --- dates -----------------------------------------------------------------


@pytest.mark.parametrize("value", ["2026-10-11", "2024-02-29", "2000-01-01"])
def test_is_iso_date_with_valid_date_returns_true(value: str) -> None:
    assert is_iso_date(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "2026-13-01",
        "2026-02-30",
        "2026/10/11",
        "20261011",
        "2026-1-1",
        "",
        None,
        20261011,
    ],
)
def test_is_iso_date_with_malformed_value_returns_false(value: object) -> None:
    assert is_iso_date(value) is False


@pytest.mark.parametrize("value", ["2026-13-01", "2026/10/11", ""])
def test_load_overrides_with_malformed_updated_at_raises(
    overrides_copy: Path, value: str
) -> None:
    rewrite(
        overrides_copy / config.DATASET_OVERRIDE_FILE,
        '"updatedAt": "2026-10-12"',
        f'"updatedAt": "{value}"',
    )

    with pytest.raises(OverrideError, match="updatedAt"):
        load_overrides(overrides_copy)


def test_load_overrides_without_updated_at_raises(overrides_copy: Path) -> None:
    rewrite(
        overrides_copy / config.DATASET_OVERRIDE_FILE,
        '  "updatedAt": "2026-10-12",\n',
        "",
    )

    with pytest.raises(OverrideError, match="updatedAt"):
        load_overrides(overrides_copy)
