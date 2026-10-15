"""Regional preparation guards: negative fixtures precede implementation."""

from __future__ import annotations

import csv
import json
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point

from scripts.data_pipeline import config
from scripts.data_pipeline.build import (
    group_candidates,
    route_service,
    stop_lines,
    to_metric_point,
)
from scripts.data_pipeline.constraints import (
    ANY_PLATFORM,
    ConstraintError,
    RouteRecipe,
    parse_platform_selector,
    parse_via,
)
from scripts.data_pipeline.n02 import N02Source, TrackSection
from scripts.data_pipeline.network import NoPathError, TrackNetwork
from scripts.data_pipeline.overrides import (
    LineRange,
    OverrideError,
    Overrides,
    Stop,
    check_station_numbers,
    expand_ranges,
    load_overrides,
    parse_dataset,
    parse_line_ranges,
)
from scripts.data_pipeline.registry import (
    Area,
    Registry,
    RegistryStation,
    ScopeStop,
    check_scope,
    parse_registry,
)
from scripts.data_pipeline.routing import (
    PairRoute,
    RoutingError,
    route_path,
    routed_path,
)
from scripts.data_pipeline.rules import Report, check_detour, check_registry_membership
from scripts.data_pipeline.topology import station_pairs
from scripts.data_pipeline.validate import Dataset, validate_dataset
from tests.data_pipeline.support import candidate


def test_registry_selector_rejects_wrong_homonym(core_copy: Path) -> None:
    service = load_overrides(core_copy).service("jr-keiyo")
    registry = parse_registry(
        [
            {
                "id": stop.station_id,
                "name": stop.station_id,
                "n02_name": stop.station_id,
                "prefecture": "東京都",
                "municipality": "江東区",
                "representative_service_id": service.id,
                "n02_selector": "group=correct",
            }
            for stop in service.stops
        ]
    )
    wrong = [
        candidate(stop.station_id, 0, 0, line="京葉線", group="wrong")
        for stop in service.stops
    ]

    with pytest.raises(RoutingError, match="no N02 platform"):
        group_candidates(service, registry, wrong, [{"京葉線"}] * len(service.stops))


def test_stop_selector_cannot_override_registry_identity(core_copy: Path) -> None:
    service = load_overrides(core_copy).service("jr-keiyo")
    service = replace(service, stops=(Stop(0, "a", "", ANY_PLATFORM),))
    registry = Registry(
        (
            RegistryStation(
                "a",
                "同名",
                "同名",
                "東京都",
                "市",
                service.id,
                parse_platform_selector("group=correct"),
            ),
        )
    )
    platforms = [
        candidate("同名", 0, 0, line="X", group="correct"),
        candidate("同名", 100, 0, line="X", group="wrong"),
    ]
    unmodified = service
    service = replace(
        service,
        stops=(
            replace(
                service.stops[0],
                platform_selector=parse_platform_selector("group=wrong"),
            ),
        ),
    )
    with pytest.raises(RoutingError, match="no N02 platform for 同名"):
        group_candidates(service, registry, platforms, [{"X"}])
    assert group_candidates(unmodified, registry, platforms, [{"X"}]) == [
        [platforms[0]]
    ]


@pytest.mark.parametrize(
    ("outside", "message"),
    [
        (True, "out-of-area gap cannot be bridged"),
        (False, "served stop evidence differs from stops.csv"),
    ],
    ids=["outside-gap", "skipped-served-stop"],
)
def test_scope_evidence_rejects_bridge_or_missing_stop(
    core_copy: Path, outside: bool, message: str
) -> None:
    overrides = load_overrides(core_copy)
    service = overrides.service("jr-keiyo")
    extra = overrides.registry.by_id()["kameido"]
    rows = [
        {
            "station_id": stop.station_id,
            "prefecture": stop.prefecture,
            "municipality": stop.municipality,
        }
        for stop in service.scope_stops
    ]
    rows.insert(
        2,
        {
            "station_id": "missing" if outside else extra.id,
            "prefecture": "茨城県" if outside else extra.prefecture,
            "municipality": "市" if outside else extra.municipality,
        },
    )
    directory = core_copy / config.SERVICES_OVERRIDE_DIR / service.id
    with (directory / "scope.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["station_id", "prefecture", "municipality"]
        )
        writer.writeheader()
        writer.writerows(rows)

    with pytest.raises(OverrideError, match=message):
        load_overrides(core_copy)


def test_unmodified_scope_evidence_keeps_maihama_boundary(core_copy: Path) -> None:
    overrides = load_overrides(core_copy)
    service = overrides.service("jr-keiyo")
    assert service.scope_stops[-1].station_id == "maihama"
    boundaries = check_scope(
        service.id,
        service.station_ids,
        service.scope_stops,
        overrides.registry,
        overrides.dataset.area,
        ("terminus", "area-boundary"),
    )
    assert [(row.last_in_area, row.first_out_of_area) for row in boundaries] == [
        ("kasai-rinkai-koen", "maihama")
    ]


@pytest.mark.parametrize(
    "prefix_switch", [False, True], ids=["reversed", "prefix-switched"]
)
def test_explicit_number_rule_rejects_reversed_or_switched_prefix(
    core_copy: Path, prefix_switch: bool
) -> None:
    path = core_copy / config.SERVICES_OVERRIDE_FILE
    envelope = json.loads(path.read_text())
    service = next(item for item in envelope["services"] if item["id"] == "jr-keiyo")
    service["stationNumberRules"] = {
        "sequence": [f"JE{i:02d}" for i in range(1, 7)],
        "reason": "Reviewed served stop pattern",
    }
    path.write_text(json.dumps(envelope, ensure_ascii=False), encoding="utf-8")
    stops_path = (
        core_copy
        / config.SERVICES_OVERRIDE_DIR
        / "jr-keiyo"
        / config.STOPS_OVERRIDE_FILE
    )
    rows = list(csv.DictReader(stops_path.open(encoding="utf-8")))
    for index, row in enumerate(rows):
        row["station_number"] = (
            f"JK{index + 1:02d}" if prefix_switch else f"JE{6 - index:02d}"
        )
    with stops_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    with pytest.raises(
        OverrideError, match="station-number evidence differs from stops.csv"
    ):
        load_overrides(core_copy)


def test_multi_line_recipe_rejects_missing_joint() -> None:
    row = {
        "from_id": "a",
        "to_id": "b",
        "n02_line": "",
        "via": "",
        "route": json.dumps(
            {"lines": ["X", "Y"], "joints": [], "reason": "Reviewed junction"}
        ),
    }

    with pytest.raises(OverrideError, match="one joint per line transition"):
        parse_line_ranges([row], "synthetic")
    recipe = json.loads(row["route"])
    recipe["joints"] = [[139.7, 35.7]]
    row["route"] = json.dumps(recipe)
    assert parse_line_ranges([row], "synthetic")[0].route_lines == ("X", "Y")


@pytest.mark.parametrize("field,value", [("n02_line", "X"), ("via", "139.7 35.7")])
def test_multi_line_recipe_rejects_single_line_fields(field: str, value: str) -> None:
    row = {
        "from_id": "a",
        "to_id": "b",
        "n02_line": "",
        "via": "",
        "route": json.dumps(
            {
                "lines": ["X", "Y"],
                "joints": [[139.7, 35.7]],
                "reason": "Reviewed junction",
            }
        ),
    }
    assert parse_line_ranges([row], "synthetic")[0].route_lines == ("X", "Y")
    row[field] = value
    with pytest.raises(
        OverrideError, match="route cannot also specify n02_line or via"
    ):
        parse_line_ranges([row], "synthetic")


def test_homonyms_with_disjoint_registry_selectors_keep_distinct_ids() -> None:
    rows = [
        {
            "id": identifier,
            "name": "同名",
            "n02_name": "",
            "prefecture": prefecture,
            "municipality": "市",
            "representative_service_id": "service",
            "n02_selector": f"group={identifier}",
        }
        for identifier, prefecture in [("tokyo", "東京都"), ("chiba", "千葉県")]
    ]

    assert parse_registry(rows).ids == ("tokyo", "chiba")
    rows[1]["n02_selector"] = "group=tokyo|chiba"
    with pytest.raises(OverrideError, match="disjoint N02 selectors"):
        parse_registry(rows)


def test_shipped_registry_has_prefecture_and_municipality(
    committed_overrides: Overrides,
) -> None:
    assert len(committed_overrides.registry.stations) == 472
    assert {
        station.prefecture for station in committed_overrides.registry.stations
    } == {"東京都", "千葉県", "神奈川県", "埼玉県"}
    assert committed_overrides.registry.by_id()["tokyo"].municipality == "千代田区"
    assert (
        committed_overrides.registry.by_id()["kasai-rinkai-koen"].municipality
        == "江戸川区"
    )


def test_registry_membership_rule_honours_dataset_area(
    committed_overrides: Overrides,
) -> None:
    report = Report()
    check_registry_membership(
        [("tokyo", "東京")], committed_overrides.registry, report, Area(("千葉県",))
    )
    assert report.errors == ["station tokyo lies outside the configured area"]


def test_region_defaults_cover_four_prefectures_and_regional_coordinates(
    core_copy: Path,
) -> None:
    raw = json.loads((core_copy / config.DATASET_OVERRIDE_FILE).read_text())
    for key in (
        "areaPrefectures",
        "areaMunicipalities",
        "outputBbox",
        "candidateSearchBbox",
    ):
        del raw[key]
    dataset = parse_dataset(raw)

    assert dataset.area.prefectures == config.CAPITAL_REGION_PREFECTURES
    assert dataset.area.contains("千葉県", "銚子市")
    assert not dataset.area.contains("茨城県", "古河市")
    assert parse_via("138.9 36.2|140.8 35.7", dataset.candidate_search_bbox) == (
        (138.9, 36.2),
        (140.8, 35.7),
    )
    with pytest.raises(ConstraintError, match="outside the search area"):
        parse_via("140.8 35.7", (139.5, 35.5, 140.0, 36.0))


@pytest.mark.parametrize(
    "value,message",
    [
        ([140, 36, 139, 35], "invalid bbox bounds"),
        ([True, 35, 140, 36], "bbox must have four finite numbers"),
        ([139, 35, float("nan"), 36], "bbox must have four finite numbers"),
    ],
)
def test_dataset_rejects_invalid_bounds(
    core_copy: Path, value: list[object], message: str
) -> None:
    raw = json.loads((core_copy / config.DATASET_OVERRIDE_FILE).read_text())
    raw["outputBbox"] = value
    # Enclose the numeric interpretation of True too, isolating bbox validation
    # from the separate output/search enclosure check.
    raw["candidateSearchBbox"] = [-1, 34, 141, 37]
    with pytest.raises(OverrideError, match=message):
        parse_dataset(raw)


def test_validator_uses_dataset_output_bounds(
    published_dataset: Dataset, committed_overrides: Overrides
) -> None:
    overrides = replace(
        committed_overrides,
        dataset=replace(
            committed_overrides.dataset, output_bbox=(139.6, 35.5, 139.65, 35.55)
        ),
    )
    errors = "\n".join(validate_dataset(published_dataset, overrides).errors)
    assert "invalid coordinates" in errors
    assert "invalid platform coordinates" in errors
    assert "bad coordinate" in errors


def test_explicit_number_sequence_allows_reviewed_skip_and_prefix_transition() -> None:
    sequence = ("JJ02", "JJ04", "JL20", "")
    stops = tuple(
        Stop(index, f"s{index}", number, ANY_PLATFORM)
        for index, number in enumerate(sequence)
    )

    check_station_numbers(stops, False, expected_sequence=sequence)
    with pytest.raises(
        OverrideError, match="station-number evidence differs from stops.csv"
    ):
        check_station_numbers(tuple(reversed(stops)), False, expected_sequence=sequence)


def test_scope_boundary_records_last_in_and_first_out_without_expanding_registry() -> (
    None
):
    registry = Registry(
        (
            RegistryStation("a", "A", "A", "東京都", "市", "service"),
            RegistryStation("b", "B", "B", "埼玉県", "市", "service"),
        )
    )
    evidence = (
        ScopeStop("before", "山梨県", "市"),
        ScopeStop("a", "東京都", "市"),
        ScopeStop("b", "埼玉県", "市"),
        ScopeStop("after", "群馬県", "市"),
    )

    result = check_scope(
        "service",
        ("a", "b"),
        evidence,
        registry,
        Area(),
        ("area-boundary", "area-boundary"),
    )

    assert [
        (row.endpoint, row.last_in_area, row.first_out_of_area) for row in result
    ] == [("first", "a", "before"), ("last", "b", "after")]
    with pytest.raises(
        OverrideError,
        match="last boundary truncation evidence disagrees with endpoint kind",
    ):
        check_scope(
            "service",
            ("a", "b"),
            evidence[:-1],
            registry,
            Area(),
            ("area-boundary", "area-boundary"),
        )


def test_multi_line_route_follows_declared_order_at_an_interior_t_junction() -> None:
    first = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    second = TrackNetwork([LineString([(500, 0), (500, 500)])])
    route = PairRoute(
        first, networks=(first, second), joints=(Point(500, 0),), line_order=("X", "Y")
    )

    path = route_path(
        [[candidate("A", 100, 0, line="X")], [candidate("B", 500, 400, line="Y")]],
        [route],
    ).paths[0]

    assert list(path.geometry.coords) == [(100, 0), (500, 0), (500, 400)]
    assert path.length == pytest.approx(800)
    assert stop_lines(
        [
            LineRange(
                "a",
                "b",
                "",
                route=RouteRecipe(("X", "Y"), ((139.7, 35.7),), "Junction"),
            )
        ],
        False,
    ) == [{"X"}, {"Y"}]
    with pytest.raises(NoPathError, match="unused or zero-length line leg"):
        routed_path(
            PairRoute(first, networks=(second, first), joints=(Point(500, 0),)),
            Point(100, 0),
            Point(500, 400),
        )


def test_multi_line_route_does_not_bridge_a_nearby_track_gap() -> None:
    first = TrackNetwork([LineString([(0, 0), (500, 0)])])
    second = TrackNetwork([LineString([(500, 0.01), (1000, 0.01)])])

    with pytest.raises(NoPathError, match="joint 1 is not on both declared lines"):
        routed_path(
            PairRoute(first, networks=(first, second), joints=(Point(500, 0),)),
            Point(0, 0),
            Point(1000, 0.01),
        )


@pytest.mark.parametrize("endpoint", ["origin", "destination"])
def test_multi_line_route_rejects_wrong_endpoint_line_even_on_shared_geometry(
    endpoint: str,
) -> None:
    track = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    route = PairRoute(
        track, networks=(track, track), joints=(Point(500, 0),), line_order=("X", "Y")
    )

    origin_line = "Y" if endpoint == "origin" else "X"
    destination_line = "X" if endpoint == "destination" else "Y"
    with pytest.raises(RoutingError, match="endpoint lines .* differ"):
        route_path(
            [
                [candidate("A", 0, 0, line=origin_line)],
                [candidate("B", 1000, 0, line=destination_line)],
            ],
            [route],
        )


def test_consecutive_recipes_reject_incompatible_lines_at_shared_stop() -> None:
    track = TrackNetwork([LineString([(0, 0), (1000, 0)])])
    first = PairRoute(
        track, networks=(track, track), joints=(Point(200, 0),), line_order=("X", "Y")
    )
    second = PairRoute(
        track, networks=(track, track), joints=(Point(800, 0),), line_order=("Z", "W")
    )
    stops = [
        [candidate("A", 0, 0, line="X")],
        [candidate("B", 400, 0, line="Y"), candidate("B", 600, 0, line="Z")],
        [candidate("C", 1000, 0, line="W")],
    ]
    with pytest.raises(RoutingError, match=r"no connected path reaches S\[2\]"):
        route_path(stops, [first, second])
    # Each pair can route separately, but their choices for B disagree.
    assert route_path(stops[:2], [first]).chosen[-1] == stops[1][0]
    assert route_path(stops[1:], [second]).chosen[0] == stops[1][1]
    compatible = route_path(stops, [first, replace(second, line_order=("Y", "W"))])
    assert compatible.chosen[1] == stops[1][0]


def test_multi_line_recipe_parses_and_cannot_cover_multiple_stop_pairs() -> None:
    row = {
        "from_id": "a",
        "to_id": "b",
        "n02_line": "",
        "via": "",
        "route": json.dumps(
            {
                "lines": ["X", "Y"],
                "joints": [[139.7, 35.7]],
                "reason": "Reviewed shared track junction",
            }
        ),
    }
    ranges = parse_line_ranges([row], "service")
    assert ranges[0].route_lines == ("X", "Y")
    assert expand_ranges(("a", "b"), ranges, False) == ranges
    with pytest.raises(OverrideError, match="single-pair range"):
        expand_ranges(("a", "middle", "b"), ranges, False)


def test_detour_exception_is_pair_specific_and_preserves_default(
    core_copy: Path,
) -> None:
    path = core_copy / config.DETOUR_EXCEPTIONS_OVERRIDE_FILE
    path.write_text(
        "service_id,from_id,to_id,max_detour_ratio,reason\njr-keiyo,tokyo,hatchobori,3.0,Reviewed N02 detour evidence\n",
        encoding="utf-8",
    )
    overrides = load_overrides(core_copy)
    assert overrides.detour_limit("jr-keiyo", "tokyo", "hatchobori") == 3
    assert (
        overrides.detour_limit("jr-keiyo", "hatchobori", "etchujima")
        == config.MAX_DETOUR_RATIO
    )
    line = LineString([(0, 0), (100, 100), (200, 0)])
    report = Report()
    check_detour(
        "allowed",
        line,
        Point(0, 0),
        Point(100, 0),
        overrides.detour_limit("jr-keiyo", "tokyo", "hatchobori"),
        report,
    )
    assert report.ok
    check_detour(
        "default", line, Point(0, 0), Point(100, 0), config.MAX_DETOUR_RATIO, report
    )
    assert len(report.errors) == 1
    assert "detour ratio" in report.errors[0]
    path.write_text(path.read_text().replace("Reviewed N02 detour evidence", ""))
    with pytest.raises(OverrideError, match="increased finite limit and a reason"):
        load_overrides(core_copy)


@pytest.mark.parametrize("pair", ["hatchobori,tokyo", "tokyo,etchujima"])
def test_detour_exception_rejects_reverse_or_non_adjacent_pair(
    core_copy: Path, pair: str
) -> None:
    (core_copy / config.DETOUR_EXCEPTIONS_OVERRIDE_FILE).write_text(
        f"service_id,from_id,to_id,max_detour_ratio,reason\njr-keiyo,{pair},3,Reviewed\n",
        encoding="utf-8",
    )
    with pytest.raises(
        OverrideError, match="detour exception is not a forward stop pair"
    ):
        load_overrides(core_copy)


@pytest.mark.parametrize(
    "defect,message",
    [
        ("duplicate", "duplicate detour exception"),
        ("unknown", "detour exception for unknown service"),
        ("nan", "increased finite limit and a reason"),
        ("inf", "increased finite limit and a reason"),
        ("-inf", "increased finite limit and a reason"),
        ("1.8", "increased finite limit and a reason"),
        ("1.7", "increased finite limit and a reason"),
    ],
)
def test_detour_exception_rejects_invalid_rows(
    core_copy: Path, defect: str, message: str
) -> None:
    service_id = "unknown" if defect == "unknown" else "jr-keiyo"
    ratio = "3" if defect in {"duplicate", "unknown"} else defect
    row = f"{service_id},tokyo,hatchobori,{ratio},Reviewed N02 detour\n"
    (core_copy / config.DETOUR_EXCEPTIONS_OVERRIDE_FILE).write_text(
        "service_id,from_id,to_id,max_detour_ratio,reason\n"
        + row * (2 if defect == "duplicate" else 1),
        encoding="utf-8",
    )
    with pytest.raises(OverrideError, match=message):
        load_overrides(core_copy)


@pytest.mark.parametrize(
    "disconnected", [False, True], ids=["joint-gap", "disconnected-leg"]
)
def test_multi_line_failure_reports_order_joint_and_rejection(
    disconnected: bool,
) -> None:
    first = TrackNetwork([LineString([(0, 0), (500, 0)])])
    pieces = (
        [LineString([(500, 0), (700, 0)]), LineString([(800, 0), (1000, 0)])]
        if disconnected
        else [LineString([(500, 0.01), (1000, 0.01)])]
    )
    second = TrackNetwork(pieces)
    route = PairRoute(
        first, networks=(first, second), joints=(Point(500, 0),), line_order=("X", "Y")
    )
    reason = (
        "leg 2: origin and destination are not connected"
        if disconnected
        else "joint 1 is not on both declared lines"
    )
    with pytest.raises(RoutingError, match=reason) as error:
        route_path(
            [[candidate("A", 0, 0, line="X")], [candidate("B", 1000, 0, line="Y")]],
            [route],
        )
    message = str(error.value)
    assert "multi-line order X -> Y" in message
    assert "joints [1: X -> Y]" in message
    assert "rejections:" in message


def test_service_builder_uses_recipe_lines_and_joint(
    committed_overrides: Overrides, monkeypatch: pytest.MonkeyPatch
) -> None:
    lonlat = (139.7, 35.7)
    joint = to_metric_point(lonlat)
    platforms = [
        candidate("A", joint.x - 100, joint.y, line="X"),
        candidate("B", joint.x, joint.y + 100, line="Y"),
    ]
    tracks = {
        "X": [
            TrackSection(
                "x", LineString([(joint.x - 200, joint.y), (joint.x + 200, joint.y)])
            )
        ],
        "Y": [
            TrackSection(
                "y", LineString([(joint.x, joint.y), (joint.x, joint.y + 200)])
            )
        ],
    }
    monkeypatch.setattr(
        N02Source, "platform_candidates", lambda self, names, lines: platforms
    )
    monkeypatch.setattr(N02Source, "track_sections", lambda self, lines, around: tracks)
    source = object.__new__(N02Source)
    service = replace(
        committed_overrides.service("jr-keiyo"),
        stops=(Stop(0, "a", "", ANY_PLATFORM), Stop(1, "b", "", ANY_PLATFORM)),
        line_ranges=(
            LineRange(
                "a",
                "b",
                "",
                route=RouteRecipe(
                    ("X", "Y"), (lonlat,), "T-junction in source geometry"
                ),
            ),
        ),
        section_filters={},
    )
    registry = Registry(
        (
            RegistryStation("a", "A", "A", "東京都", "市", service.id),
            RegistryStation("b", "B", "B", "東京都", "市", service.id),
        )
    )

    result = route_service(source, service, registry)

    assert result.segment_lines == ("X -> Y",)
    assert result.routed.paths[0].length == pytest.approx(200)
    assert list(result.routed.paths[0].geometry.coords) == [
        (joint.x - 100, joint.y),
        (joint.x, joint.y),
        (joint.x, joint.y + 100),
    ]
    wrong = replace(
        service,
        line_ranges=(
            LineRange(
                "a", "b", "", route=RouteRecipe(("Y", "X"), (lonlat,), "Wrong order")
            ),
        ),
    )
    with pytest.raises(RoutingError, match="no N02 platform"):
        route_service(source, wrong, registry)


def test_validator_rejects_misordered_or_missing_route_joints(
    published_dataset: Dataset, committed_overrides: Overrides
) -> None:
    service = committed_overrides.target
    expanded = tuple(
        LineRange(a, b, hint.n02_line, hint.via)
        for (a, b), hint in zip(
            station_pairs(service.station_ids, True),
            service.segment_ranges(),
            strict=True,
        )
    )
    coordinates = published_dataset.geojson["features"][0]["geometry"]["coordinates"]
    joints = (tuple(coordinates[1]), tuple(coordinates[-2]))
    recipe = RouteRecipe(
        ("X", "Y", "Z"), joints, "Synthetic routing witness on the published geometry"
    )

    def with_recipe(value: RouteRecipe) -> Overrides:
        target = replace(
            service,
            line_ranges=(replace(expanded[0], n02_line="", route=value), *expanded[1:]),
        )
        return replace(
            committed_overrides, services=(target, *committed_overrides.services[1:])
        )

    assert validate_dataset(published_dataset, with_recipe(recipe)).ok
    errors = validate_dataset(
        published_dataset, with_recipe(replace(recipe, joints=tuple(reversed(joints))))
    ).errors
    assert any("route joints are out of order" in error for error in errors)
    errors = validate_dataset(
        published_dataset,
        with_recipe(replace(recipe, joints=((139.8, 35.7), joints[1]))),
    ).errors
    assert any("route misses a committed joint" in error for error in errors)
