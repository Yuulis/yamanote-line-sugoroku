"""Regression fixtures for the S3b review's ownership and expansion findings."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from time import perf_counter

import pytest
from pyproj import Transformer
from shapely.geometry import LineString, Point

from scripts.data_pipeline import config, export
from scripts.data_pipeline.build import platform_points
from scripts.data_pipeline.composition import (
    check_recipe_anchors,
    check_recipes,
    dependency_order,
    flatten_recipe,
)
from scripts.data_pipeline.constraints import RouteRecipe
from scripts.data_pipeline.n02 import TrackSection
from scripts.data_pipeline.overrides import LineRange, Overrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.topology import station_pairs
from scripts.data_pipeline.validate import load_dataset, validate_dataset
from tests.data_pipeline.composition_support import (
    SyntheticSource,
    composition_overrides,
    recipe,
    synthetic_build,
)


def replace_service(
    overrides: Overrides, identifier: str, **changes: object
) -> Overrides:
    changed = replace(overrides.service(identifier), **changes)
    return replace(
        overrides,
        services=tuple(
            changed if item.id == identifier else item for item in overrides.services
        ),
    )


def write_bundle(files: dict[str, str], directory: Path) -> None:
    for name, payload in files.items():
        (directory / name).write_text(payload, encoding="utf-8")


def refresh_bundle(
    files: dict[str, str], segments: list[dict], geojson: dict, overrides: Overrides
) -> None:
    files[config.SEGMENTS_FILE] = export.dumps_segments(segments)
    files[config.SEGMENTS_GEOJSON_FILE] = export.dumps_feature_collection(geojson)
    files[config.MANIFEST_FILE] = export.dumps_pretty(
        export.build_manifest(
            export.manifest_inputs(files), overrides.dataset.updated_at
        )
    )


@pytest.mark.parametrize("direction", ["forward", "reverse"])
def test_validator_rejects_routed_pair_switched_to_other_line_owner(
    committed_overrides: Overrides, tmp_path: Path, direction: str
) -> None:
    overrides = composition_overrides(committed_overrides)
    rapid = overrides.service("rapid")
    overrides = replace_service(
        overrides,
        "rapid",
        line_ranges=(rapid.line_ranges[0], LineRange("c", "d", "L2")),
    )
    source = SyntheticSource()
    source.members["L2"] = ("c", "d")
    original = source.track_sections

    def bowed_track(lines: object, around: object) -> dict:
        sections = original(lines, around)
        if "L2" in sections:
            c, d = source.points["c"], source.points["d"]
            sections["L2"] = [
                TrackSection(
                    "key",
                    LineString([c.coords[0], ((c.x + d.x) / 2, c.y + 30), d.coords[0]]),
                )
            ]
        return sections

    source.track_sections = bowed_track
    files, _ = synthetic_build(overrides, source)
    write_bundle(files, tmp_path)
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []
    segments, geojson = (
        json.loads(files[config.SEGMENTS_FILE]),
        json.loads(files[config.SEGMENTS_GEOJSON_FILE]),
    )
    for segment in segments:
        if segment["id"] in ("rapid:c:d", "rapid:d:c"):
            segment["geometryFeatureIds"] = ["owner-b:c~d"]
    geojson["features"] = [
        feature for feature in geojson["features"] if feature["id"] != "rapid:c~d"
    ]
    refresh_bundle(files, segments, geojson, overrides)
    write_bundle(files, tmp_path)
    report = validate_dataset(load_dataset(tmp_path), overrides)
    identifier = "rapid:c:d" if direction == "forward" else "rapid:d:c"
    assert f"{identifier}: route chain differs from reviewed recipe" in report.errors
    assert (
        "routed primitive id set differs from reviewed recipes: missing ['rapid:c~d'], extra []"
        in report.errors
    )
    assert not any(
        "stale" in error or "serialization" in error for error in report.errors
    )


@pytest.mark.parametrize("fault", ["missing", "extra"])
def test_validator_requires_exact_routed_primitive_ids(
    committed_overrides: Overrides, tmp_path: Path, fault: str
) -> None:
    overrides = composition_overrides(committed_overrides)
    files, _ = synthetic_build(overrides)
    segments = json.loads(files[config.SEGMENTS_FILE])
    geojson = json.loads(files[config.SEGMENTS_GEOJSON_FILE])
    if fault == "missing":
        geojson["features"] = [
            feature for feature in geojson["features"] if feature["id"] != "rapid:c~d"
        ]
    else:
        geojson["features"].append({**geojson["features"][-1], "id": "unreviewed:a~b"})
    refresh_bundle(files, segments, geojson, overrides)
    write_bundle(files, tmp_path)
    report = validate_dataset(load_dataset(tmp_path), overrides)
    assert any(
        error.startswith("routed primitive id set differs from reviewed recipes")
        for error in report.errors
    )


def test_composition_adjacent_to_explicit_multi_n02_route_inherits_endpoints(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    overrides = composition_overrides(committed_overrides)
    source = SyntheticSource()
    c, d = source.points["c"], source.points["d"]
    source.points["joint"] = Point((c.x + d.x) / 2, c.y + 20)
    source.members.update({"L1": ("b", "c", "joint", "d"), "L2": ("joint", "d")})
    transformer = Transformer.from_crs(
        config.METRIC_CRS, config.OUTPUT_CRS, always_xy=True
    )
    joint = transformer.transform(*source.points["joint"].coords[0])
    rapid = overrides.service("rapid")
    overrides = replace_service(
        overrides,
        "rapid",
        line_ranges=(
            rapid.line_ranges[0],
            LineRange(
                "c",
                "d",
                "",
                route=RouteRecipe(("L1", "L2"), (joint,), "Reviewed transition"),
            ),
        ),
    )
    files, builds = synthetic_build(overrides, source)
    platforms = platform_points(builds)
    assert platforms[("rapid", "c")].coords[0] == platforms[("owner-b", "c")].coords[0]
    assert builds["rapid"].routed.chosen[1].n02_line == "L1"
    assert builds["rapid"].routed.chosen[2].n02_line == "L2"
    assert builds["rapid"].segment_lines == ("", "L1 -> L2")
    path = builds["rapid"].routed.paths[1].geometry
    assert path.coords[0] == platforms[("rapid", "c")].coords[0]
    assert path.coords[-1] == platforms[("rapid", "d")].coords[0]
    assert path.distance(source.points["joint"]) < config.ROUTE_JOINT_TOLERANCE_M
    features = {
        feature["id"]: feature
        for feature in json.loads(files[config.SEGMENTS_GEOJSON_FILE])["features"]
    }
    assert (
        features["owner-b:b~c"]["geometry"]["coordinates"][-1]
        == features["rapid:c~d"]["geometry"]["coordinates"][0]
    )
    segments = {
        segment["id"]: segment["geometryFeatureIds"]
        for segment in json.loads(files[config.SEGMENTS_FILE])
    }
    assert segments["rapid:a:c"] == ["owner-a:a~b", "owner-b:b~c"]
    assert segments["rapid:c:a"] == ["owner-b:b~c", "owner-a:a~b"]
    assert segments["rapid:c:d"] == segments["rapid:d:c"] == ["rapid:c~d"]
    write_bundle(files, tmp_path)
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def repeated_expansion(template: Overrides, depth: int) -> Overrides:
    owner = composition_overrides(template).service("owner-a")
    owner = replace(
        owner, stops=owner.stops[2:], line_ranges=(LineRange("a", "b", "L0"),)
    )
    services = [owner]
    for index in range(depth):
        previous = services[-1].id
        identifier = f"repeat-{index}"
        repeated = recipe((previous, "a", "b", ("L0",)), (previous, "a", "b", ("L0",)))
        services.append(
            replace(
                owner,
                definition=replace(owner.definition, id=identifier),
                line_ranges=(LineRange("a", "b", "", compose=repeated),),
            )
        )
    return replace(template, services=tuple(services))


def test_repeated_nested_expansion_is_bounded_before_backtracking(
    committed_overrides: Overrides,
) -> None:
    overrides = repeated_expansion(committed_overrides, 13)
    overrides = replace(overrides, services=tuple(reversed(overrides.services)))
    # All dependencies form a DAG, but flattened size doubles at every level.
    assert len(dependency_order(overrides.services)) == 14
    with pytest.raises(
        OverrideError,
        match=f"expansion exceeds primitive limit {config.MAX_COMPOSE_PRIMITIVES}",
    ):
        check_recipes(overrides)


def test_configured_expansion_limit_accepts_boundary_and_rejects_next_level(
    committed_overrides: Overrides,
) -> None:
    overrides = repeated_expansion(committed_overrides, 5)
    at_limit = overrides.services[-2].line_ranges[0].compose
    beyond_limit = overrides.services[-1].line_ranges[0].compose
    assert at_limit is not None and beyond_limit is not None
    assert len(flatten_recipe(overrides, at_limit, max_primitives=16)) == 16
    with pytest.raises(OverrideError, match="expansion exceeds primitive limit 16"):
        flatten_recipe(overrides, beyond_limit, max_primitives=16)


def test_regional_size_dag_flattening_has_generous_time_bound(
    committed_overrides: Overrides, record_property: Callable[[str, object], None]
) -> None:
    template = committed_overrides.services[0]
    ids = tuple(f"s{index}" for index in range(17))
    services = []
    for index in range(40):
        stops = ids[:4] if index == 39 else ids
        ranges = tuple(
            LineRange(a, b, "L0")
            if index == 0
            else LineRange(
                a, b, "", compose=recipe((f"regional-{index - 1}", a, b, ("L0",)))
            )
            for a, b in station_pairs(stops, False)
        )
        services.append(
            replace(
                template,
                definition=replace(
                    template.definition, id=f"regional-{index}", circular=False
                ),
                stops=tuple(
                    replace(template.stops[0], order=i, station_id=station)
                    for i, station in enumerate(stops)
                ),
                line_ranges=ranges,
                section_filters={},
            )
        )
    overrides = replace(committed_overrides, services=tuple(services))
    assert sum(len(service.segment_ranges()) for service in services) == 627
    assert len(dependency_order(services)) == 40
    start = perf_counter()
    check_recipes(overrides)
    flattened = flatten_recipe(overrides, recipe(("regional-38", "s0", "s16", ("L0",))))
    check_recipe_anchors("s0", "s16", flattened)
    duration = perf_counter() - start
    record_property("flattening_seconds", duration)
    record_property("service_count", 40)
    record_property("canonical_pairs", 627)
    record_property("dependency_depth", 39)
    print(f"Regional DAG: 40 services, 627 pairs, depth 39, flattening {duration:.6f}s")
    assert flattened == tuple(
        ("regional-0", a, b, False) for a, b in station_pairs(ids, False)
    )
    assert duration < 30.0


def test_direct_flattening_rejects_cycle(committed_overrides: Overrides) -> None:
    overrides = composition_overrides(committed_overrides)
    cyclic = recipe(("nested", "a", "c", ("L0", "L1")))
    overrides = replace_service(
        overrides, "nested", line_ranges=(LineRange("a", "c", "", compose=cyclic),)
    )
    with pytest.raises(OverrideError, match="dependency cycle"):
        flatten_recipe(overrides, cyclic)
