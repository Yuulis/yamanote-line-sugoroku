"""Range-scoped section-filter contract and composition regressions."""

from __future__ import annotations

import csv
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from scripts.data_pipeline.composition import flatten_recipe, parse_compose
from scripts.data_pipeline.constraints import ScopedSectionFilter, SectionFilter
from scripts.data_pipeline.override_parsing import parse_scoped_section_filters
from scripts.data_pipeline.overrides import LineRange
from scripts.data_pipeline.registry import OverrideError
from tests.data_pipeline.composition_support import composition_overrides
from tests.data_pipeline.support import historical_baseline


def _copy_overrides(root: Path) -> Path:
    target = root / "overrides"
    shutil.copytree(historical_baseline("data/overrides"), target)
    return target


def _write_sections(path: Path, rows: list[dict[str, str]]) -> None:
    columns = ["n02_line", "action", "section_key", "reason", "from_id", "to_id"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def _rule(
    action: str, key: str, from_id: str, to_id: str, *, line: str = "L0"
) -> dict[str, str]:
    return {
        "n02_line": line,
        "action": action,
        "section_key": key,
        "reason": "Reviewed range constraint",
        "from_id": from_id,
        "to_id": to_id,
    }


def test_old_and_new_ranges_resolve_independent_filters(committed_overrides) -> None:
    overrides = composition_overrides(committed_overrides)
    filters, scoped = parse_scoped_section_filters(
        [
            _rule("allow", "old-track", "a", "b"),
            _rule("allow", "new-track", "b", "c"),
        ],
        "owner-a",
        "JR",
    )
    assert filters == {}
    assert scoped == (
        ScopedSectionFilter("JR", "L0", "a", "b", "allow", "old-track"),
        ScopedSectionFilter("JR", "L0", "b", "c", "allow", "new-track"),
    )
    service = replace(
        overrides.service("owner-a"),
        stops=(
            *overrides.service("owner-a").stops,
            overrides.service("owner-b").stops[1],
        ),
        line_ranges=(LineRange("a", "b", "L0"), LineRange("b", "c", "L0")),
        scoped_section_filters=scoped,
    )
    assert service.section_filter_for_pair("L0", "JR", "a", "b").allow == frozenset(
        {"old-track"}
    )
    assert service.section_filter_for_pair("L0", "JR", "b", "c").allow == frozenset(
        {"new-track"}
    )


@pytest.mark.parametrize(
    "rows, message",
    [
        ([{**_rule("allow", "x", "a", "b"), "to_id": ""}], "both be set"),
        ([{**_rule("allow", "x", "a", "b"), "from_id": ""}], "both be set"),
        ([{**_rule("allow", "x", "a", "b"), "reason": ""}], "reason required"),
        (
            [_rule("allow", "x", "a", "b"), _rule("deny", "x", "a", "b")],
            "duplicate scoped key",
        ),
    ],
)
def test_invalid_scoped_section_rows_are_rejected(
    rows: list[dict[str, str]], message: str
) -> None:
    with pytest.raises(OverrideError, match=message):
        parse_scoped_section_filters(rows, "owner-a", "JR")


@pytest.mark.parametrize(
    "from_id, to_id, line, expected",
    [
        ("unknown", "yugawara", "東海道線", "unknown station"),
        ("yugawara", "tokyo", "東海道線", "forward stop order"),
        ("tokyo", "tokyo", "東海道線", "forward stop order"),
        ("tokyo", "yugawara", "not-a-route", "no matching direct route"),
    ],
)
def test_loader_rejects_invalid_range_station_order_and_unused_line(
    tmp_path: Path, from_id: str, to_id: str, line: str, expected: str
) -> None:
    from scripts.data_pipeline.overrides import load_overrides

    root = _copy_overrides(tmp_path)
    _write_sections(
        root / "services/jr-tokaido/sections.csv",
        [_rule("allow", "reviewed", from_id, to_id, line=line)],
    )
    with pytest.raises(OverrideError, match=expected):
        load_overrides(root)


def test_loader_rejects_scoped_filters_on_circular_services(tmp_path: Path) -> None:
    from scripts.data_pipeline.overrides import load_overrides

    root = _copy_overrides(tmp_path)
    _write_sections(
        root / "services/jr-yamanote/sections.csv",
        [_rule("deny", "reviewed", "tokyo", "shinjuku", line="山手線")],
    )
    with pytest.raises(OverrideError, match="linear service"):
        load_overrides(root)


def test_loader_rejects_unpaired_range_columns(tmp_path: Path) -> None:
    from scripts.data_pipeline.overrides import load_overrides

    root = _copy_overrides(tmp_path)
    path = root / "services/jr-yokohama/sections.csv"
    path.write_text("n02_line,action,section_key,reason,from_id\n", encoding="utf-8")
    with pytest.raises(OverrideError, match="both from_id and to_id columns"):
        load_overrides(root)


def test_loader_rejects_effective_allow_deny_conflict(tmp_path: Path) -> None:
    from scripts.data_pipeline.overrides import load_overrides

    root = _copy_overrides(tmp_path)
    baseline = load_overrides(root)
    service = baseline.service("jr-yokohama")
    first, second = service.station_ids[:2]
    line = service.segment_ranges()[0].n02_line
    _write_sections(
        root / "services/jr-yokohama/sections.csv",
        [
            {
                "n02_line": line,
                "action": "allow",
                "section_key": "same",
                "reason": "Global allowance",
                "from_id": "",
                "to_id": "",
            },
            _rule("deny", "same", first, second, line=line),
        ],
    )
    with pytest.raises(OverrideError, match="conflicting section filters"):
        load_overrides(root)


def test_staging_audit_rejects_old_pair_filter_change_with_identical_artifacts(
    tmp_path: Path,
) -> None:
    from scripts.data_pipeline import stage_suburban_jr as stage

    live = tmp_path / "data/overrides"
    shutil.copytree(historical_baseline("data/overrides"), live)
    stage_dir = tmp_path / "data/staging/tokyo-suburban-jr/tohoku/overrides"
    shutil.copytree(live, stage_dir)
    baseline = tmp_path / "baseline"
    output = tmp_path / "output"
    shutil.copytree(historical_baseline("public/data"), baseline)
    shutil.copytree(baseline, output)

    sections_path = stage_dir / "services/jr-yokohama/sections.csv"
    rows = list(csv.DictReader(sections_path.open(encoding="utf-8", newline="")))
    rows[0]["section_key"] = "changed-reviewed-key"
    _write_sections(sections_path, rows)

    errors = stage._check_old_pair_records(stage_dir, output, baseline, live)
    assert any(
        "shipped section filter changed: jr-yokohama" in error for error in errors
    ), errors


def test_composition_checks_each_owner_pair_filter_in_both_directions(
    committed_overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    owner = overrides.service("owner-a")
    operator = owner.effective_n02_operator(overrides.dataset)
    owner = replace(
        owner,
        stops=(*owner.stops, overrides.service("owner-b").stops[1]),
        scoped_section_filters=(
            ScopedSectionFilter(
                operator,
                "L0",
                "a",
                "b",
                "allow",
                "old-track",
            ),
            ScopedSectionFilter(
                operator,
                "L0",
                "b",
                "c",
                "allow",
                "new-track",
            ),
        ),
        line_ranges=(
            LineRange("lead", "a", "L0"),
            LineRange("a", "b", "L0"),
            LineRange("b", "c", "L0"),
        ),
    )
    overrides = replace(
        overrides,
        services=tuple(
            owner if item.id == owner.id else item for item in overrides.services
        ),
    )
    evidence = {
        "lines": ["L0"],
        "allow": ["old-track"],
        "deny": [],
        "reason": "Reviewed old pair geometry",
    }
    recipe = parse_compose(
        __import__("json").dumps(
            {
                "legs": [{"source_service": "owner-a", "from": "a", "to": "b"}],
                "shared_track_evidence": [evidence],
            }
        )
    )
    assert recipe is not None
    consumer = overrides.service("nested")
    assert flatten_recipe(overrides, recipe, consumer) == (
        ("owner-a", "a", "b", False),
    )

    spanning = parse_compose(
        __import__("json").dumps(
            {
                "legs": [{"source_service": "owner-a", "from": "a", "to": "c"}],
                "shared_track_evidence": [evidence],
            }
        )
    )
    assert spanning is not None
    with pytest.raises(OverrideError, match="section filter differs"):
        flatten_recipe(overrides, spanning, consumer)

    reverse = parse_compose(
        __import__("json").dumps(
            {
                "legs": [{"source_service": "owner-a", "from": "b", "to": "a"}],
                "shared_track_evidence": [evidence],
            }
        )
    )
    assert reverse is not None
    assert flatten_recipe(overrides, reverse, consumer) == (
        ("owner-a", "a", "b", True),
    )

    inner = parse_compose(
        __import__("json").dumps(
            {
                "legs": [{"source_service": "owner-a", "from": "a", "to": "b"}],
                "shared_track_evidence": [evidence],
            }
        )
    )
    assert inner is not None
    owner_b = replace(
        overrides.service("owner-b"),
        line_ranges=(
            LineRange("b", "c", "", compose=inner),
            LineRange("c", "d", "L1"),
        ),
    )
    nested_overrides = replace(
        overrides,
        services=tuple(
            owner_b if item.id == owner_b.id else item for item in overrides.services
        ),
    )
    outer = parse_compose(
        __import__("json").dumps(
            {
                "legs": [{"source_service": "owner-b", "from": "b", "to": "c"}],
                "shared_track_evidence": [evidence],
            }
        )
    )
    assert outer is not None
    assert flatten_recipe(nested_overrides, outer, consumer) == (
        ("owner-a", "a", "b", False),
    )

    altered = replace(
        owner,
        scoped_section_filters=(
            ScopedSectionFilter(operator, "L0", "a", "b", "allow", "changed-track"),
            owner.scoped_section_filters[1],
        ),
    )
    altered_overrides = replace(
        overrides,
        services=tuple(
            altered if item.id == altered.id else item for item in overrides.services
        ),
    )
    with pytest.raises(OverrideError, match="section filter differs"):
        flatten_recipe(altered_overrides, recipe, consumer)


def test_scoped_pair_filter_conflicts_are_rejected(committed_overrides) -> None:
    overrides = composition_overrides(committed_overrides)
    service = replace(
        overrides.service("owner-a"),
        section_filters={("JR", "L0"): SectionFilter(allow=frozenset({"same"}))},
        scoped_section_filters=(
            ScopedSectionFilter("JR", "L0", "a", "b", "deny", "same"),
        ),
    )
    with pytest.raises(OverrideError, match="listed twice"):
        service.section_filter_for_pair("L0", "JR", "a", "b")


def test_one_scoped_filter_covers_each_pair_inside_its_endpoint_range(
    committed_overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    owner = overrides.service("owner-a")
    operator = owner.effective_n02_operator(overrides.dataset)
    service = replace(
        owner,
        stops=(*owner.stops, overrides.service("owner-b").stops[1]),
        line_ranges=(
            LineRange("lead", "a", "L0"),
            LineRange("a", "b", "L0"),
            LineRange("b", "c", "L0"),
        ),
        scoped_section_filters=(
            ScopedSectionFilter(operator, "L0", "a", "c", "allow", "shared"),
        ),
    )

    assert service.section_filter_for_pair("L0", operator, "a", "b").allow == frozenset(
        {"shared"}
    )
    assert service.section_filter_for_pair("L0", operator, "b", "c").allow == frozenset(
        {"shared"}
    )
