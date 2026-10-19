"""Operator-qualified platform and track selection regressions."""

from __future__ import annotations

from dataclasses import replace

import pytest
from shapely.geometry import LineString

from scripts.data_pipeline.build import (
    RoutingError,
    group_candidates,
    route_service,
    to_metric_point,
)
from scripts.data_pipeline.constraints import (
    ANY_PLATFORM,
    RouteRecipe,
    SectionFilter,
    parse_platform_selector,
)
from scripts.data_pipeline.n02 import N02SourceProvider, PlatformCandidate, TrackSection
from scripts.data_pipeline.override_checks import check_consistency
from scripts.data_pipeline.overrides import LineRange, OverrideError, Overrides, Stop
from scripts.data_pipeline.registry import Registry, RegistryStation
from tests.data_pipeline.support import candidate


def _service_and_registry(overrides: Overrides):
    base = overrides.service("jr-keiyo")
    service = replace(
        base,
        stops=(Stop(0, "a", "", ANY_PLATFORM), Stop(1, "b", "", ANY_PLATFORM)),
        line_ranges=(LineRange("a", "b", "L"),),
    )
    registry = Registry(
        (
            RegistryStation("a", "Same", "Same", "東京都", "市", service.id),
            RegistryStation("b", "Other", "Other", "東京都", "市", service.id),
        )
    )
    return service, registry


def test_same_name_platform_candidates_keep_operator_membership(
    committed_overrides: Overrides,
) -> None:
    service, registry = _service_and_registry(committed_overrides)
    wanted = replace(candidate("Same", 0, 0), operator="Metro")
    foreign = replace(candidate("Same", 0, 0), operator="Other operator")
    other_stop = replace(candidate("Other", 100, 0), operator="Metro")

    groups = group_candidates(
        service,
        registry,
        [foreign, other_stop, wanted],
        [{"L"}, {"L"}],
        operators_per_stop=["Metro", "Metro"],
    )

    assert [item.operator for item in groups[0]] == ["Metro"]
    assert groups[0][0].station_code == wanted.station_code


def test_empty_operator_candidates_do_not_fall_back_to_other_operator(
    committed_overrides: Overrides,
) -> None:
    service, registry = _service_and_registry(committed_overrides)
    foreign = replace(candidate("Same", 0, 0), operator="Other operator")
    other_stop = replace(candidate("Other", 100, 0), operator="Metro")

    with pytest.raises(RoutingError, match="no N02 platform"):
        group_candidates(
            service,
            registry,
            [foreign, other_stop],
            [{"L"}, {"L"}],
            operators_per_stop=["Metro", "Metro"],
        )


def test_omitted_stop_operator_uses_service_operator_not_registry(
    committed_overrides: Overrides,
) -> None:
    template = committed_overrides.service("jr-keiyo")
    service = replace(
        template,
        definition=replace(template.definition, n02_operator="Operator A"),
        stops=(
            Stop(0, "a", "", ANY_PLATFORM),
            Stop(1, "b", "", ANY_PLATFORM),
        ),
        line_ranges=(LineRange("a", "b", "L"),),
        section_filters={},
    )
    registry = Registry(
        (
            RegistryStation(
                "a",
                "Same",
                "Same",
                "東京都",
                "市",
                service.id,
                parse_platform_selector("code=registry-only"),
                n02_operator="Operator B",
            ),
            RegistryStation(
                "b",
                "Other",
                "Other",
                "東京都",
                "市",
                service.id,
                n02_operator="Operator B",
            ),
        )
    )
    overrides = replace(
        committed_overrides,
        registry=registry,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )
    platforms = [
        replace(candidate("Same", 10, 0), operator="Operator A"),
        replace(candidate("Other", 90, 0), operator="Operator A"),
    ]
    source = _TrackSource("Operator A", platforms, 0)

    result = route_service(source, service, registry, overrides)

    assert [item.operator for item in result.routed.chosen] == [
        "Operator A",
        "Operator A",
    ]
    assert result.routed.chosen[0].station_code == platforms[0].station_code


def test_registry_selector_is_skipped_for_an_alternate_stop_match(
    committed_overrides: Overrides,
) -> None:
    service, _ = _service_and_registry(committed_overrides)
    stop = replace(service.stops[0], original_name="Alias", n02_name="Alternate")
    service = replace(service, stops=(stop, service.stops[1]))
    registry = Registry(
        (
            RegistryStation(
                "a",
                "Display",
                "Registry",
                "東京都",
                "市",
                service.id,
                parse_platform_selector("code=registry-only"),
                aliases=("Alias",),
                n02_operator="Operator A",
            ),
            RegistryStation(
                "b",
                "Other",
                "Other",
                "東京都",
                "市",
                service.id,
                n02_operator="Operator A",
            ),
        )
    )
    alternate = replace(
        candidate("Alternate", 0, 0, code="alternate-code"), operator="Operator A"
    )
    other = replace(candidate("Other", 100, 0), operator="Operator A")

    groups = group_candidates(
        service,
        registry,
        [alternate, other],
        [{"L"}, {"L"}],
        operators_per_stop=["Operator A", "Operator A"],
    )

    assert groups[0] == [alternate]


def test_identity_collision_checks_resolved_stop_targets_and_selectors(
    committed_overrides: Overrides,
) -> None:
    original = committed_overrides.service("jr-yamanote")
    registry = committed_overrides.registry.by_id()
    collision_stops = tuple(
        replace(
            stop,
            original_name=registry[stop.station_id].name,
            n02_name="Shared N02 target",
        )
        if index < 2
        else stop
        for index, stop in enumerate(original.stops)
    )
    service = replace(original, stops=collision_stops)
    overrides = replace(
        committed_overrides,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )

    with pytest.raises(
        OverrideError, match="homonym identity.*without disjoint selectors"
    ):
        check_consistency(overrides)


def test_candidate_sort_key_qualifies_otherwise_identical_platforms() -> None:
    left = replace(candidate("Same", 0, 0), operator="A")
    right = replace(candidate("Same", 0, 0), operator="B")

    assert sorted([right, left], key=lambda item: item.sort_key) == [left, right]


class _TrackSource:
    def __init__(
        self, operator: str, platforms: list[PlatformCandidate], offset: float
    ) -> None:
        self.operator = operator
        self.platforms = platforms
        self.offset = offset
        self.track_calls = 0

    def platform_candidates(self, names, lines):
        return [item for item in self.platforms if item.station_name in names]

    def track_sections(self, lines, around):
        self.track_calls += 1
        geometry = LineString([(0, self.offset), (100, self.offset)])
        return {
            line: [TrackSection(f"{self.operator}-section", geometry)] for line in lines
        }


class _NamedTrackSource:
    def __init__(
        self,
        operator: str,
        platforms: list[PlatformCandidate],
        tracks: dict[str, list[TrackSection]],
    ) -> None:
        self.operator = operator
        self.platforms = platforms
        self.tracks = tracks
        self.track_calls = 0

    def platform_candidates(self, names, lines):
        return [
            item
            for item in self.platforms
            if item.station_name in names and item.n02_line in lines
        ]

    def track_sections(self, lines, around):
        self.track_calls += 1
        return {line: self.tracks[line] for line in lines}


def _provider(sources: dict[str, _NamedTrackSource]) -> N02SourceProvider:
    provider = object.__new__(N02SourceProvider)
    provider._sources = sources
    return provider


def test_different_name_shared_station_routes_through_two_operators(
    committed_overrides: Overrides,
) -> None:
    template = committed_overrides.service("jr-keiyo")
    service_a = replace(
        template,
        definition=replace(
            template.definition,
            id="jr-keiyo",
            name="Operator A service",
            circular=False,
            expected_stop_count=2,
            operator="Operator A",
            n02_operator="Operator A",
        ),
        stops=(
            Stop(0, "left", "", ANY_PLATFORM),
            Stop(
                1,
                "shared",
                "",
                ANY_PLATFORM,
                original_name="A Hub",
                n02_name="A Hub",
            ),
        ),
        line_ranges=(LineRange("left", "shared", "line-a"),),
        section_filters={},
    )
    service_b = replace(
        template,
        definition=replace(
            template.definition,
            id="jr-yamanote",
            name="Operator B service",
            circular=False,
            expected_stop_count=2,
            operator="Operator B",
            n02_operator="Operator B",
        ),
        stops=(
            Stop(
                0,
                "shared",
                "",
                ANY_PLATFORM,
                original_name="B Hub",
                n02_name="B Hub",
            ),
            Stop(1, "right", "", ANY_PLATFORM),
        ),
        line_ranges=(LineRange("shared", "right", "line-b"),),
        section_filters={},
    )
    registry = Registry(
        (
            RegistryStation(
                "left",
                "A Left",
                "A Left",
                "東京都",
                "市",
                service_a.id,
                n02_operator="Operator A",
            ),
            RegistryStation(
                "shared",
                "Shared Display",
                "A Hub",
                "東京都",
                "市",
                service_a.id,
                parse_platform_selector("code=a-hub"),
                aliases=("A Hub", "B Hub"),
                n02_operator="Operator A",
            ),
            RegistryStation(
                "right",
                "B Right",
                "B Right",
                "東京都",
                "市",
                service_b.id,
                n02_operator="Operator B",
            ),
        )
    )
    overrides = replace(
        committed_overrides,
        registry=registry,
        services=tuple(
            service_a
            if item.id == service_a.id
            else service_b
            if item.id == service_b.id
            else item
            for item in committed_overrides.services
        ),
    )
    source_a = _NamedTrackSource(
        "Operator A",
        [
            replace(
                candidate("A Left", 10, 0, code="a-left", line="line-a"),
                operator="Operator A",
            ),
            replace(
                candidate("A Hub", 100, 0, code="a-hub", line="line-a"),
                operator="Operator A",
            ),
        ],
        {"line-a": [TrackSection("a-track", LineString([(0, 0), (100, 0)]))]},
    )
    source_b = _NamedTrackSource(
        "Operator B",
        [
            replace(
                candidate("B Hub", 100, 0, code="b-hub", line="line-b"),
                operator="Operator B",
            ),
            replace(
                candidate("B Right", 190, 0, code="b-right", line="line-b"),
                operator="Operator B",
            ),
        ],
        {"line-b": [TrackSection("b-track", LineString([(100, 0), (200, 0)]))]},
    )
    provider = _provider({"Operator A": source_a, "Operator B": source_b})

    routed_a = route_service(provider, service_a, registry, overrides)
    routed_b = route_service(provider, service_b, registry, overrides)

    assert routed_a.routed.chosen[-1].station_name == "A Hub"
    assert routed_b.routed.chosen[0].station_name == "B Hub"
    assert routed_a.routed.chosen[-1].operator == "Operator A"
    assert routed_b.routed.chosen[0].operator == "Operator B"
    assert routed_a.routed.paths[0].geometry.coords[-1] == (100.0, 0.0)
    assert routed_b.routed.paths[0].geometry.coords[0] == (100.0, 0.0)


def test_source_qualified_tracks_do_not_mix(
    committed_overrides: Overrides,
) -> None:
    base, registry = _service_and_registry(committed_overrides)
    service = replace(
        base,
        stops=(
            Stop(0, "a", "", ANY_PLATFORM, n02_operator="Operator A"),
            Stop(1, "b", "", ANY_PLATFORM, n02_operator="Operator A"),
        ),
        line_ranges=(
            LineRange(
                "a",
                "b",
                "L",
                n02_operator="Operator A",
                source_reason="Reviewed owner of this track source",
            ),
        ),
    )
    overrides = replace(
        committed_overrides,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )
    platforms = [
        replace(candidate("Same", 10, 0), operator="Operator A"),
        replace(candidate("Other", 90, 0), operator="Operator A"),
    ]
    owner = _TrackSource("Operator A", platforms, 0)
    foreign = _TrackSource("Operator B", platforms, 0)
    provider = object.__new__(N02SourceProvider)
    provider._sources = {"Operator A": owner, "Operator B": foreign}

    result = route_service(provider, service, registry, overrides)

    assert result.routed.paths[0].length == pytest.approx(80)
    assert owner.track_calls == 1
    assert foreign.track_calls == 0


def test_operator_qualified_section_deny_filters_only_its_graph(
    committed_overrides: Overrides,
) -> None:
    base, registry = _service_and_registry(committed_overrides)
    service = replace(
        base,
        definition=replace(base.definition, n02_operator="Operator A"),
        section_filters={
            ("Operator A", "L"): SectionFilter(deny=frozenset({"A-shortcut"}))
        },
    )
    platforms_a = [
        replace(candidate("Same", 0, 0), operator="Operator A"),
        replace(candidate("Other", 100, 0), operator="Operator A"),
    ]
    platforms_b = [
        replace(candidate("Same", 0, 0), operator="Operator B"),
        replace(candidate("Other", 100, 0), operator="Operator B"),
    ]
    source_a = _NamedTrackSource(
        "Operator A",
        platforms_a,
        {
            "L": [
                TrackSection("A-shortcut", LineString([(0, 0), (100, 0)])),
                TrackSection(
                    "A-reviewed",
                    LineString([(0, 0), (0, 100), (100, 100), (100, 0)]),
                ),
            ]
        },
    )
    source_b = _NamedTrackSource(
        "Operator B",
        platforms_b,
        {"L": [TrackSection("B-shortcut", LineString([(0, 0), (100, 0)]))]},
    )
    provider = _provider({"Operator A": source_a, "Operator B": source_b})
    overrides = replace(
        committed_overrides,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )

    result = route_service(provider, service, registry, overrides)

    assert result.routed.paths[0].length == pytest.approx(300)
    assert source_a.track_calls == 1
    assert source_b.track_calls == 0


def test_operator_source_does_not_expand_the_30m_snap_limit_or_fall_back(
    committed_overrides: Overrides,
) -> None:
    service, registry = _service_and_registry(committed_overrides)
    service = replace(
        service,
        definition=replace(service.definition, n02_operator="Operator A"),
    )
    source_a = _TrackSource(
        "Operator A",
        [
            replace(candidate("Same", 10, 50), operator="Operator A"),
            replace(candidate("Other", 90, 0), operator="Operator A"),
        ],
        0,
    )
    source_b = _TrackSource(
        "Operator B",
        [
            replace(candidate("Same", 10, 0), operator="Operator B"),
            replace(candidate("Other", 90, 0), operator="Operator B"),
        ],
        0,
    )
    provider = object.__new__(N02SourceProvider)
    provider._sources = {"Operator A": source_a, "Operator B": source_b}
    overrides = replace(
        committed_overrides,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )

    with pytest.raises(RoutingError, match="farther than 30.0 m"):
        route_service(provider, service, registry, overrides)

    assert source_b.track_calls == 0


def test_operator_route_rejects_a_missing_cross_source_joint(
    committed_overrides: Overrides,
) -> None:
    template = committed_overrides.service("jr-keiyo")
    joint_lonlat = (139.7, 35.7)
    joint = to_metric_point(joint_lonlat)
    y = joint.y
    service = replace(
        template,
        definition=replace(template.definition, n02_operator="Operator A"),
        stops=(
            Stop(0, "start", "", ANY_PLATFORM),
            Stop(
                1,
                "end",
                "",
                ANY_PLATFORM,
                original_name="End",
                n02_name="End",
                n02_operator="Operator B",
                source_reason="Reviewed operator boundary",
            ),
        ),
        line_ranges=(
            LineRange(
                "start",
                "end",
                "",
                route=RouteRecipe(
                    ("L1", "L2"),
                    (joint_lonlat,),
                    "Reviewed operator transition",
                    ("Operator A", "Operator B"),
                ),
            ),
        ),
        section_filters={},
    )
    registry = Registry(
        (
            RegistryStation(
                "start",
                "Start",
                "Start",
                "東京都",
                "市",
                service.id,
                n02_operator="Operator A",
            ),
            RegistryStation(
                "end",
                "End",
                "End",
                "東京都",
                "市",
                service.id,
                n02_operator="Operator A",
            ),
        )
    )
    source_a = _NamedTrackSource(
        "Operator A",
        [
            replace(
                candidate("Start", joint.x - 250, y, line="L1"), operator="Operator A"
            )
        ],
        {
            "L1": [
                TrackSection("a", LineString([(joint.x - 300, y), (joint.x - 200, y)]))
            ]
        },
    )
    source_b = _NamedTrackSource(
        "Operator B",
        [replace(candidate("End", joint.x + 250, y, line="L2"), operator="Operator B")],
        {
            "L2": [
                TrackSection("b", LineString([(joint.x + 200, y), (joint.x + 300, y)]))
            ]
        },
    )
    provider = _provider({"Operator A": source_a, "Operator B": source_b})
    overrides = replace(
        committed_overrides,
        registry=registry,
        services=tuple(
            service if item.id == service.id else item
            for item in committed_overrides.services
        ),
    )

    with pytest.raises(RoutingError, match="joint 1 is not on both declared lines"):
        route_service(provider, service, registry, overrides)
