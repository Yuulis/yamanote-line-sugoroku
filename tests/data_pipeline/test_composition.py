"""DAG, mixed recipes, shared track and exact composition build invariants."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from scripts.data_pipeline.build import RoutingError, platform_points, route_service
from scripts.data_pipeline.composition import (
    ComposeLeg,
    ComposeRecipe,
    SharedTrackEvidence,
    check_recipes,
    dependency_order,
    flatten_recipe,
    parse_compose,
)
from scripts.data_pipeline.composition_build import (
    check_inherited_route_sources,
    composed_pairs,
)
from scripts.data_pipeline.constraints import SectionFilter
from scripts.data_pipeline.override_checks import check_consistency
from scripts.data_pipeline.overrides import LineRange, Overrides, parse_line_ranges
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.validate import load_dataset, validate_dataset
from tests.data_pipeline.composition_support import (
    SyntheticSource,
    composition_overrides,
    recipe,
    synthetic_build,
)
from tests.data_pipeline.support import candidate


def test_nested_mixed_recipes_build_in_both_directions_and_preserve_output_order(
    committed_overrides: Overrides, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    overrides = composition_overrides(committed_overrides)
    check_consistency(overrides)
    assert dependency_order(overrides.services) != overrides.dataset.service_ids
    files, builds = synthetic_build(overrides)
    assert tuple(builds) == overrides.dataset.service_ids
    assert [
        service["id"] for service in json.loads(files["services.json"])["services"]
    ] == list(overrides.dataset.service_ids)
    segments = {
        segment["id"]: segment["geometryFeatureIds"]
        for segment in json.loads(files["segments.json"])
    }
    assert segments["rapid:a:c"] == ["owner-a:a~b", "owner-b:b~c"]
    assert segments["rapid:c:a"] == ["owner-b:b~c", "owner-a:a~b"]
    assert segments["reverse:c:a"] == segments["rapid:c:a"]
    assert segments["reverse:a:c"] == segments["rapid:a:c"]
    assert segments["rapid:c:d"] == ["rapid:c~d"]
    # Reordering traversal roots changes DAG iteration, never serialization order.
    assert dependency_order(tuple(reversed(overrides.services))) != dependency_order(
        overrides.services
    )
    import scripts.data_pipeline.build as build_module
    import scripts.data_pipeline.composition as composition_module

    def other_order(services: object) -> tuple[str, ...]:
        return dependency_order(tuple(reversed(services)))

    monkeypatch.setattr(build_module, "dependency_order", other_order)
    monkeypatch.setattr(composition_module, "dependency_order", other_order)
    assert files == synthetic_build(overrides)[0]
    for name, payload in files.items():
        (tmp_path / name).write_text(payload, encoding="utf-8")
    report = validate_dataset(load_dataset(tmp_path), overrides)
    assert report.errors == []
    assert report.metrics["max_geometry_chain_length"] == 2
    platforms = platform_points(builds)
    assert platforms[("rapid", "a")].equals(platforms[("owner-a", "a")])


def changed_recipe(
    overrides: Overrides, identifier: str, composed: object
) -> Overrides:
    service = overrides.service(identifier)
    first = replace(service.line_ranges[0], compose=composed)
    updated = replace(service, line_ranges=(first, *service.line_ranges[1:]))
    return replace(
        overrides,
        services=tuple(
            updated if item.id == identifier else item for item in overrides.services
        ),
    )


@pytest.mark.parametrize(
    "problem,message",
    [
        ("forward", "misordered multi-owner"),
        ("reverse", "misordered multi-owner"),
        ("cycle", "dependency cycle"),
        ("wrong line", "wrong-track sharing: N02 lines"),
        ("wrong filter", "wrong-track sharing: section filter"),
        ("backtracking", "backtracking"),
        ("last", "wrong last station"),
        ("unknown", "unknown source service"),
    ],
)
def test_composition_guard_rejects_its_specific_fault(
    committed_overrides: Overrides, problem: str, message: str
) -> None:
    overrides = composition_overrides(committed_overrides)
    if problem == "forward":
        overrides = changed_recipe(
            overrides,
            "rapid",
            recipe(("owner-b", "b", "c", ("L1",))),
        )
    elif problem == "reverse":
        overrides = changed_recipe(
            overrides,
            "reverse",
            recipe(("owner-a", "b", "a", ("L0",))),
        )
    elif problem == "cycle":
        overrides = changed_recipe(
            overrides, "nested", recipe(("rapid", "a", "c", ("L0", "L1")))
        )
    elif problem == "wrong line":
        overrides = changed_recipe(
            overrides,
            "nested",
            recipe(("owner-a", "a", "b", ("L1",)), ("owner-b", "b", "c", ("L1",))),
        )
    elif problem == "wrong filter":
        owner = replace(
            overrides.service("owner-a"),
            section_filters={
                "L0": SectionFilter(frozenset({"other-track"}), frozenset())
            },
        )
        overrides = replace(
            overrides,
            services=tuple(
                owner if item.id == owner.id else item for item in overrides.services
            ),
        )
    elif problem == "backtracking":
        overrides = changed_recipe(
            overrides,
            "nested",
            recipe(
                ("owner-a", "a", "b", ("L0",)),
                ("owner-a", "b", "a", ("L0",)),
                ("owner-a", "a", "b", ("L0",)),
                ("owner-b", "b", "c", ("L1",)),
            ),
        )
    elif problem == "last":
        overrides = changed_recipe(
            overrides, "reverse", recipe(("owner-b", "c", "b", ("L1",)))
        )
    elif problem == "unknown":
        overrides = changed_recipe(
            overrides, "nested", recipe(("missing", "a", "c", ("L0",)))
        )
    with pytest.raises(OverrideError, match=message):
        if problem == "cycle":
            dependency_order(overrides.services)
        else:
            check_recipes(overrides)


def test_metric_platform_gap_cannot_be_bridged(committed_overrides: Overrides) -> None:
    from shapely.geometry import LineString

    overrides = composition_overrides(committed_overrides)
    _, builds = synthetic_build(overrides)
    owner = builds["owner-b"]
    path = owner.routed.paths[0]
    coordinates = list(path.geometry.coords)
    coordinates[0] = (coordinates[0][0], coordinates[0][1] + 0.001)
    changed = replace(path, geometry=LineString(coordinates))
    builds["owner-b"] = replace(
        owner, routed=replace(owner.routed, paths=(changed, *owner.routed.paths[1:]))
    )
    with pytest.raises(OverrideError, match="platform-gap joint is not exact"):
        composed_pairs(overrides.service("nested"), overrides, builds)


def test_compose_csv_schema_and_exclusive_recipe_fields() -> None:
    raw = {
        "legs": [{"source_service": "owner", "from": "a", "to": "b"}],
        "shared_track_evidence": [
            {"lines": ["L"], "allow": [], "deny": [], "reason": "Reviewed"}
        ],
    }
    cell = json.dumps(raw)
    row = {"from_id": "a", "to_id": "b", "n02_line": "", "via": "", "compose": cell}
    assert parse_line_ranges([row], "rapid")[0].compose == parse_compose(cell)
    with pytest.raises(OverrideError, match="cannot also"):
        parse_line_ranges([{**row, "n02_line": "L"}], "rapid")
    with pytest.raises(OverrideError, match="single-pair"):
        from scripts.data_pipeline.overrides import expand_ranges

        expand_ranges(
            ("a", "b", "c"),
            (LineRange("a", "c", "", compose=parse_compose(cell)),),
            False,
        )


def test_compose_requires_owner_operator_evidence(
    committed_overrides: Overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    owner = overrides.service("owner-a")
    first = replace(owner.line_ranges[0], n02_operator="Alternate N02")
    owner = replace(owner, line_ranges=(first, *owner.line_ranges[1:]))
    overrides = replace(
        overrides,
        services=tuple(
            owner if service.id == owner.id else service
            for service in overrides.services
        ),
    )
    recipe_without_operator = recipe(("owner-a", "a", "b", ("L0",)))
    with pytest.raises(OverrideError, match="differs from consumer evidence"):
        flatten_recipe(overrides, recipe_without_operator, overrides.service("nested"))

    raw = {
        "legs": [{"source_service": "owner-a", "from": "a", "to": "b"}],
        "shared_track_evidence": [
            {
                "lines": ["L0"],
                "allow": [],
                "deny": [],
                "reason": "Reviewed source ownership",
                "n02Operator": "Alternate N02",
            }
        ],
    }
    named_recipe = parse_compose(json.dumps(raw))
    assert named_recipe is not None
    assert flatten_recipe(overrides, named_recipe, overrides.service("nested")) == (
        ("owner-a", "a", "b", False),
    )


def test_compose_omitted_operator_resolves_to_consumer(
    committed_overrides: Overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    owner = overrides.service("owner-a")
    owner = replace(
        owner,
        definition=replace(owner.definition, n02_operator="Owner operator"),
    )
    consumer = replace(
        overrides.service("nested"),
        definition=replace(
            overrides.service("nested").definition,
            n02_operator="Consumer operator",
        ),
    )
    overrides = replace(
        overrides,
        services=tuple(
            owner
            if item.id == owner.id
            else consumer
            if item.id == consumer.id
            else item
            for item in overrides.services
        ),
    )

    with pytest.raises(OverrideError, match="differs from consumer evidence"):
        flatten_recipe(
            overrides,
            recipe(("owner-a", "a", "b", ("L0",))),
            consumer,
        )


def test_compose_rejects_one_leg_with_multiple_primitive_operators(
    committed_overrides: Overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    owner_a = replace(
        overrides.service("owner-a"),
        definition=replace(overrides.service("owner-a").definition, n02_operator="A"),
    )
    owner_b = replace(
        overrides.service("owner-b"),
        definition=replace(overrides.service("owner-b").definition, n02_operator="B"),
    )
    nested = overrides.service("nested")
    inner = ComposeRecipe(
        (
            ComposeLeg(
                "owner-a",
                "a",
                "b",
                SharedTrackEvidence(("L0",), SectionFilter(), "Reviewed"),
            ),
            ComposeLeg(
                "owner-b",
                "b",
                "c",
                SharedTrackEvidence(
                    ("L1",), SectionFilter(), "Reviewed", n02_operator="B"
                ),
            ),
        )
    )
    nested = replace(
        nested,
        definition=replace(nested.definition, n02_operator="A"),
        line_ranges=(replace(nested.line_ranges[0], compose=inner),),
    )
    consumer = replace(
        overrides.service("rapid"),
        definition=replace(overrides.service("rapid").definition, n02_operator="A"),
    )
    outer = ComposeRecipe(
        (
            ComposeLeg(
                "nested",
                "a",
                "c",
                SharedTrackEvidence(("L0", "L1"), SectionFilter(), "Reviewed"),
            ),
        )
    )
    overrides = replace(
        overrides,
        services=tuple(
            owner_a
            if item.id == owner_a.id
            else owner_b
            if item.id == owner_b.id
            else nested
            if item.id == nested.id
            else consumer
            if item.id == consumer.id
            else item
            for item in overrides.services
        ),
    )

    with pytest.raises(OverrideError, match="spans multiple N02 operators"):
        flatten_recipe(overrides, outer, consumer)


def test_nested_compose_uses_nested_consumer_operator(
    committed_overrides: Overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    owner = overrides.service("owner-a")
    owner = replace(
        owner,
        definition=replace(owner.definition, n02_operator="Owner"),
        line_ranges=(
            replace(
                owner.line_ranges[0],
                n02_operator="Nested",
                source_reason="Reviewed nested track owner",
            ),
            *owner.line_ranges[1:],
        ),
    )
    nested = overrides.service("nested")
    nested = replace(
        nested,
        definition=replace(nested.definition, n02_operator="Nested"),
    )
    owner_b = overrides.service("owner-b")
    owner_b = replace(
        owner_b,
        line_ranges=(
            replace(
                owner_b.line_ranges[0],
                n02_operator="Nested",
                source_reason="Reviewed nested track owner",
            ),
            *owner_b.line_ranges[1:],
        ),
    )
    top = replace(
        overrides.service("rapid"),
        definition=replace(overrides.service("rapid").definition, n02_operator="Top"),
    )
    inner = recipe(
        ("owner-a", "a", "b", ("L0",)),
        ("owner-b", "b", "c", ("L1",)),
    )
    nested = replace(
        nested,
        line_ranges=(replace(nested.line_ranges[0], compose=inner),),
    )
    outer = ComposeRecipe(
        (
            ComposeLeg(
                "nested",
                "a",
                "c",
                SharedTrackEvidence(
                    ("L0", "L1"),
                    SectionFilter(),
                    "Reviewed top-level sharing",
                    n02_operator="Nested",
                ),
            ),
        )
    )
    overrides = replace(
        overrides,
        services=tuple(
            owner
            if item.id == owner.id
            else owner_b
            if item.id == owner_b.id
            else nested
            if item.id == nested.id
            else top
            if item.id == top.id
            else item
            for item in overrides.services
        ),
    )

    assert flatten_recipe(overrides, outer, top) == (
        ("owner-a", "a", "b", False),
        ("owner-b", "b", "c", False),
    )


def test_neighbour_route_rejects_inherited_anchor_from_another_operator(
    committed_overrides: Overrides,
) -> None:
    overrides = composition_overrides(committed_overrides)
    _, builds = synthetic_build(overrides)
    consumer = overrides.service("rapid")
    ranges = (
        consumer.line_ranges[0],
        replace(
            consumer.line_ranges[1],
            n02_operator="Other operator",
            source_reason="Reviewed source boundary",
        ),
    )
    consumer = replace(consumer, line_ranges=ranges)
    overrides = replace(
        overrides,
        services=tuple(
            consumer if item.id == consumer.id else item for item in overrides.services
        ),
    )

    with pytest.raises(RoutingError, match="no track path"):
        route_service(
            SyntheticSource(), consumer, overrides.registry, overrides, builds
        )


def test_inherited_anchor_rejects_a_neighbouring_operator_mismatch() -> None:
    anchor = replace(candidate("Hub", 0, 0), n02_line="L", operator="Operator A")

    with pytest.raises(OverrideError, match="wrong-source anchor"):
        check_inherited_route_sources(
            {(0, "from"): ("L", "Operator B")},
            {},
            {0: anchor},
            (),
            2,
        )


def test_inherited_anchor_accepts_exact_same_operator_group_midpoint_on_other_line() -> (
    None
):
    anchor = replace(
        candidate("Hub", 100, 200, code="anchor", line="Inherited line"),
        operator="JR East",
    )
    same_feature_other_line = replace(
        candidate("Hub", 100, 200, code="peer", line="Neighbour line", group="anchor"),
        operator="JR East",
    )

    check_inherited_route_sources(
        {(0, "from"): ("Neighbour line", "JR East")},
        {},
        {0: anchor},
        (),
        2,
        (same_feature_other_line,),
    )


@pytest.mark.parametrize(
    ("x", "group", "operator"),
    [
        (100.0, "different-group", "JR East"),
        (100.000001, "anchor", "JR East"),
        (100.0, "anchor", "Other operator"),
    ],
    ids=["different-group", "midpoint-offset", "different-operator"],
)
def test_inherited_anchor_rejects_near_but_not_identical_peer_feature(
    x: float,
    group: str,
    operator: str,
) -> None:
    anchor = replace(
        candidate("Hub", 100, 200, code="anchor", line="Inherited line"),
        operator="JR East",
    )
    peer = replace(
        candidate(
            "Hub",
            x,
            200,
            code="peer",
            line="Neighbour line",
            group=group,
        ),
        operator=operator,
    )

    with pytest.raises(OverrideError, match="wrong-source anchor"):
        check_inherited_route_sources(
            {(0, "from"): ("Neighbour line", "JR East")},
            {},
            {0: anchor},
            (),
            2,
            (peer,),
        )


@pytest.mark.parametrize(
    "raw",
    [
        "{",
        "[]",
        "{}",
        '{"legs":[],"shared_track_evidence":[]}',
        '{"legs":[{}],"shared_track_evidence":[{}]}',
    ],
)
def test_malformed_compose_is_rejected(raw: str) -> None:
    with pytest.raises(OverrideError):
        parse_compose(raw)


def artifact_inputs(overrides: Overrides) -> tuple[list[dict], list[dict], dict]:
    from shapely.geometry import Point

    from scripts.data_pipeline.validate import to_metric

    files, _ = synthetic_build(overrides)
    platforms = {
        (service["id"], station): Point(to_metric(point))
        for service in json.loads(files["services.json"])["services"]
        for station, point in service["platformCoordinates"].items()
    }
    return (
        json.loads(files["segments.json"]),
        json.loads(files["segments.geojson"])["features"],
        platforms,
    )


@pytest.mark.parametrize("direction", ["forward", "reverse"])
def test_artifact_compose_chain_must_equal_reviewed_recipe(
    committed_overrides: Overrides, direction: str
) -> None:
    from scripts.data_pipeline.composition_validate import check_composed_artifacts
    from scripts.data_pipeline.rules import Report

    overrides = composition_overrides(committed_overrides)
    segments, features, platforms = artifact_inputs(overrides)
    identifier = "rapid:a:c" if direction == "forward" else "rapid:c:a"
    for segment in segments:
        if segment["id"] == identifier:
            segment["geometryFeatureIds"] = ["owner-b:b~c"]
    report = Report()
    check_composed_artifacts(segments, features, overrides, platforms, report)
    assert report.errors == [
        f"{identifier}: compose chain differs from reviewed recipe"
    ]


def test_artifact_platform_must_equal_primitive_anchor(
    committed_overrides: Overrides,
) -> None:
    from shapely.geometry import Point

    from scripts.data_pipeline.composition_validate import check_composed_artifacts
    from scripts.data_pipeline.rules import Report

    overrides = composition_overrides(committed_overrides)
    segments, features, platforms = artifact_inputs(overrides)
    original = platforms[("rapid", "a")]
    platforms[("rapid", "a")] = Point(original.x, original.y + 0.001)
    report = Report()
    check_composed_artifacts(segments, features, overrides, platforms, report)
    assert (
        report.errors
        == ["rapid: compose platform is not exact primitive anchor at a"] * 2
    )


def test_artifact_joint_has_no_platform_snap_tolerance(
    committed_overrides: Overrides,
) -> None:
    from scripts.data_pipeline.composition import exact_chain_coordinates

    overrides = composition_overrides(committed_overrides)
    _, features, _ = artifact_inputs(overrides)
    by_id = {feature["id"]: feature for feature in features}
    by_id["owner-b:b~c"]["geometry"]["coordinates"][0][0] += 0.00000001
    with pytest.raises(OverrideError, match="platform-gap joint is not exact"):
        exact_chain_coordinates(["owner-a:a~b", "owner-b:b~c"], by_id, "a")


def test_mixed_route_cannot_snap_away_from_inherited_platform(
    committed_overrides: Overrides,
) -> None:
    from shapely.affinity import translate

    from scripts.data_pipeline.build import route_service
    from scripts.data_pipeline.n02 import TrackSection
    from tests.data_pipeline.composition_support import SyntheticSource

    overrides = composition_overrides(committed_overrides)
    _, builds = synthetic_build(overrides)
    rapid = overrides.service("rapid")
    rapid = replace(
        rapid, line_ranges=(rapid.line_ranges[0], LineRange("c", "d", "L2"))
    )
    source = SyntheticSource()
    source.members["L2"] = ("c", "d")
    original = source.track_sections

    def different_track(lines: object, around: object) -> dict:
        sections = original(lines, around)
        if "L2" in sections:
            sections["L2"] = [
                TrackSection("key", translate(sections["L2"][0].geometry, yoff=5))
            ]
        return sections

    source.track_sections = different_track
    with pytest.raises(
        OverrideError, match="route leaves an inherited primitive anchor"
    ):
        route_service(source, rapid, overrides.registry, overrides, builds)


@pytest.mark.parametrize(
    "coordinates",
    [
        None,
        [],
        [[139.7, 35.6]],
        [[139.7, float("nan")], [139.8, 35.6]],
        [[139.7, True], [139.8, 35.6]],
    ],
)
def test_composed_artifact_malformed_primitive_reports_error(
    committed_overrides: Overrides, coordinates: object
) -> None:
    from scripts.data_pipeline.composition_validate import check_composed_artifacts
    from scripts.data_pipeline.rules import Report

    overrides = composition_overrides(committed_overrides)
    segments, features, platforms = artifact_inputs(overrides)
    for feature in features:
        if feature["id"] == "owner-a:a~b":
            feature["geometry"]["coordinates"] = coordinates
    report = Report()
    check_composed_artifacts(segments, features, overrides, platforms, report)
    assert report.errors
    assert all("invalid primitive coordinates" in error for error in report.errors)


def test_shared_evidence_supports_different_filters_on_each_n02_line(
    committed_overrides: Overrides,
) -> None:
    from scripts.data_pipeline.composition import flatten_recipe

    overrides = composition_overrides(committed_overrides)
    owner = overrides.service("owner-a")
    owner = replace(
        owner,
        stops=(*owner.stops, overrides.service("owner-b").stops[1]),
        line_ranges=(LineRange("lead", "b", "L0"), LineRange("b", "c", "L1")),
        section_filters={
            "L0": SectionFilter(frozenset({"reviewed-a"}), frozenset()),
            "L1": SectionFilter(frozenset(), frozenset({"excluded-b"})),
        },
    )
    overrides = replace(
        overrides,
        services=tuple(
            owner if service.id == owner.id else service
            for service in overrides.services
        ),
    )
    # One source leg traverses two owned hops on independently constrained lines.
    raw = {
        "legs": [{"source_service": "owner-a", "from": "a", "to": "c"}],
        "shared_track_evidence": [
            {
                "lines": ["L0", "L1"],
                "allow": [],
                "deny": [],
                "reason": "Reviewed",
                "line_filters": {
                    "L0": {"allow": ["reviewed-a"], "deny": []},
                    "L1": {"allow": [], "deny": ["excluded-b"]},
                },
            }
        ],
    }
    composed = parse_compose(json.dumps(raw))
    assert composed is not None
    consumer = overrides.service("nested")
    assert flatten_recipe(overrides, composed, consumer) == (
        ("owner-a", "a", "b", False),
        ("owner-a", "b", "c", False),
    )
    raw["legs"][0].update({"from": "c", "to": "a"})
    reversed_recipe = parse_compose(json.dumps(raw))
    assert reversed_recipe is not None
    assert flatten_recipe(overrides, reversed_recipe, consumer) == (
        ("owner-a", "b", "c", True),
        ("owner-a", "a", "b", True),
    )
    # Matching the line set alone cannot permit swapped per-line constraints.
    raw["shared_track_evidence"][0]["line_filters"]["L1"]["deny"] = []
    invalid = parse_compose(json.dumps(raw))
    assert invalid is not None
    with pytest.raises(OverrideError, match="section filter differs"):
        flatten_recipe(overrides, invalid, consumer)
    raw["shared_track_evidence"][0]["line_filters"] = {
        "other-line": {"allow": [], "deny": []}
    }
    with pytest.raises(OverrideError, match="cover exactly"):
        parse_compose(json.dumps(raw))
