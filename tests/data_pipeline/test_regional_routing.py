"""Builder integration for ordered and consecutive regional route recipes."""

from __future__ import annotations

from dataclasses import replace

import pytest
from shapely.geometry import LineString

from scripts.data_pipeline.build import route_service, stop_lines, to_metric_point
from scripts.data_pipeline.constraints import ANY_PLATFORM, RouteRecipe, SectionFilter
from scripts.data_pipeline.n02 import N02Source, PlatformCandidate, TrackSection
from scripts.data_pipeline.overrides import LineRange, Overrides, ServiceOverrides, Stop
from scripts.data_pipeline.registry import Registry, RegistryStation
from tests.data_pipeline.support import candidate


def synthetic_builder(
    overrides: Overrides,
    monkeypatch: pytest.MonkeyPatch,
    names: tuple[str, ...],
    ranges: tuple[LineRange, ...],
    platforms: list[PlatformCandidate],
    tracks: dict[str, list[TrackSection]],
    filters: dict[str, SectionFilter],
) -> tuple[N02Source, ServiceOverrides, Registry]:
    service = replace(
        overrides.service("jr-keiyo"),
        stops=tuple(
            Stop(index, name.lower(), "", ANY_PLATFORM)
            for index, name in enumerate(names)
        ),
        line_ranges=ranges,
        section_filters=filters,
    )
    registry = Registry(
        tuple(
            RegistryStation(name.lower(), name, name, "東京都", "市", service.id)
            for name in names
        )
    )

    def sections(
        self: N02Source, lines: set[str], around: list[object]
    ) -> dict[str, list[TrackSection]]:
        assert lines == set(tracks)
        for row in ranges:
            assert row.route is not None
            for joint in row.route.joints:
                assert any(to_metric_point(joint).equals(point) for point in around)
        return tracks

    monkeypatch.setattr(
        N02Source, "platform_candidates", lambda self, names, lines: platforms
    )
    monkeypatch.setattr(N02Source, "track_sections", sections)
    return object.__new__(N02Source), service, registry


def test_three_line_builder_filters_intermediate_line_and_orders_joints(
    committed_overrides: Overrides,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lonlats = ((139.7, 35.7), (139.71, 35.7))
    first, last = (to_metric_point(point) for point in lonlats)
    start = (first.x - 100, first.y)
    end = (last.x + 100, last.y)
    joints = ((first.x, first.y), (last.x, last.y))
    bend = ((first.x + last.x) / 2, first.y + 300)
    tracks = {
        "X": [TrackSection("x", LineString([start, joints[0]]))],
        "Y": [
            TrackSection("reviewed", LineString([joints[0], bend, joints[1]])),
            TrackSection("shortcut", LineString(joints)),
        ],
        "Z": [TrackSection("z", LineString([joints[1], end]))],
    }
    platforms = [candidate("A", *start, line="X"), candidate("B", *end, line="Z")]
    ranges = (
        LineRange(
            "a",
            "b",
            "",
            route=RouteRecipe(("X", "Y", "Z"), lonlats, "Reviewed intermediate track"),
        ),
    )
    source, service, registry = synthetic_builder(
        committed_overrides,
        monkeypatch,
        ("A", "B"),
        ranges,
        platforms,
        tracks,
        {"Y": SectionFilter(deny=frozenset({"shortcut"}))},
    )
    result = route_service(source, service, registry)
    assert result.segment_lines == ("X -> Y -> Z",)
    assert list(result.routed.paths[0].geometry.coords) == [
        start,
        joints[0],
        bend,
        joints[1],
        end,
    ]
    unfiltered = route_service(source, replace(service, section_filters={}), registry)
    assert unfiltered.routed.paths[0].length < result.routed.paths[0].length


def test_consecutive_recipes_fix_one_intermediate_candidate_and_endpoint_lines(
    committed_overrides: Overrides,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lonlats = ((139.7, 35.7), (139.71, 35.7))
    first, last = (to_metric_point(point) for point in lonlats)
    dx, dy = last.x - first.x, last.y - first.y

    def point(fraction: float) -> tuple[float, float]:
        return first.x + fraction * dx, first.y + fraction * dy

    geometry = LineString([point(-0.5), point(1.5)])
    tracks = {line: [TrackSection(line, geometry)] for line in ("X", "Y", "Z")}
    platforms = [
        candidate("A", *point(-0.4), line="Y"),
        candidate("A", *point(-0.5), line="X"),
        candidate("B", *point(0.2), line="X"),
        candidate("B", *point(0.25), line="Y"),
        candidate("B", *point(0.75), line="Y"),
        candidate("B", *point(0.8), line="Z"),
        candidate("C", *point(1.4), line="Y"),
        candidate("C", *point(1.5), line="Z"),
    ]
    ranges = tuple(
        LineRange(a, b, "", route=RouteRecipe(lines, (joint,), "Reviewed shared joint"))
        for a, b, lines, joint in [
            ("a", "b", ("X", "Y"), lonlats[0]),
            ("b", "c", ("Y", "Z"), lonlats[1]),
        ]
    )
    source, service, registry = synthetic_builder(
        committed_overrides,
        monkeypatch,
        ("A", "B", "C"),
        ranges,
        platforms,
        tracks,
        {},
    )
    assert stop_lines(ranges, False) == [{"X"}, {"Y"}, {"Z"}]
    result = route_service(source, service, registry)
    assert result.segment_lines == ("X -> Y", "Y -> Z")
    assert result.routed.chosen == (platforms[1], platforms[3], platforms[7])
    assert [platform.n02_line for platform in result.routed.chosen] == ["X", "Y", "Z"]
    incoming, outgoing = result.routed.paths
    assert incoming.geometry.coords[-1] == pytest.approx(point(0.25))
    assert outgoing.geometry.coords[0] == pytest.approx(point(0.25))
    assert incoming.length + outgoing.length == pytest.approx(2 * first.distance(last))
