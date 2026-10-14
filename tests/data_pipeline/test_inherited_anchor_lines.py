"""G1: a composed anchor carries the N02 line its owner primitive ends on."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from pyproj import Transformer
from shapely.geometry import Point

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import PlatformTransfer, RouteRecipe
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.overrides import LineRange, Overrides
from scripts.data_pipeline.registry import ScopeStop
from scripts.data_pipeline.routing import RoutingError
from scripts.data_pipeline.validate import load_dataset, validate_dataset
from tests.data_pipeline.composition_support import (
    SyntheticSource,
    composition_overrides,
    recipe,
    synthetic_build,
)
from tests.data_pipeline.test_composition_review import replace_service, write_bundle


class OwnerOnOtherLineSource(SyntheticSource):
    """L2 duplicates L1 between c and d; the L1 platform at c is 10 m off-track.

    The owner therefore chooses its L2 platform at c, while its b -> c
    primitive still ends on L1.
    """

    def __init__(self) -> None:
        super().__init__()
        self.members["L2"] = ("c", "d")

    def platform_candidates(self, names: Any, lines: Any) -> list[PlatformCandidate]:
        result = []
        for item in super().platform_candidates(names, lines):
            shift = 10.0 if (item.station_name, item.n02_line) == ("c", "L1") else 0.0
            x, y = item.midpoint.coords[0]
            result.append(
                PlatformCandidate(
                    item.station_name,
                    item.n02_line,
                    item.station_code,
                    f"group-{item.station_name}",
                    item.platform,
                    Point(x, y + shift),
                )
            )
        return result


def _overrides(committed: Overrides, source: SyntheticSource) -> Overrides:
    overrides = composition_overrides(committed)
    overrides = replace_service(
        overrides,
        "owner-b",
        line_ranges=(LineRange("b", "c", "L1"), LineRange("c", "d", "L2")),
    )
    c, d = source.points["c"], source.points["d"]
    joint = Transformer.from_crs(
        config.METRIC_CRS, config.OUTPUT_CRS, always_xy=True
    ).transform((c.x + d.x) / 2, c.y)
    rapid = overrides.service("rapid")
    return replace_service(
        overrides,
        "rapid",
        line_ranges=(
            rapid.line_ranges[0],
            LineRange(
                "c", "d", "", route=RouteRecipe(("L1", "L2"), (joint,), "Reviewed")
            ),
        ),
    )


def test_composed_anchor_next_to_multi_line_route_uses_primitive_end_line(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    source = OwnerOnOtherLineSource()
    overrides = _overrides(committed_overrides, source)

    files, builds = synthetic_build(overrides, source)

    owner = builds["owner-b"].routed
    assert owner.chosen[1].n02_line == "L2"  # the owner's own platform at c
    rapid = builds["rapid"].routed
    assert rapid.chosen[1].n02_line == "L1"  # the anchor lies on the L1 primitive
    assert rapid.paths[1].geometry.coords[0] == owner.paths[0].geometry.coords[-1]
    write_bundle(files, tmp_path)
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def test_multi_line_route_into_a_composed_start_anchor_uses_primitive_end_line(
    committed_overrides: Overrides, tmp_path: Path
) -> None:
    source = OwnerOnOtherLineSource()
    overrides = _overrides(committed_overrides, source)
    c, d = source.points["c"], source.points["d"]
    joint = Transformer.from_crs(
        config.METRIC_CRS, config.OUTPUT_CRS, always_xy=True
    ).transform((c.x + d.x) / 2, c.y)
    reverse = overrides.service("reverse")
    stops = ("d", "c", "a")
    overrides = replace_service(
        overrides,
        "reverse",
        definition=replace(
            reverse.definition,
            expected_stop_count=len(stops),
            length_ref=replace(reverse.definition.length_ref, km=0.9),
        ),
        stops=tuple(
            replace(reverse.stops[0], order=i, station_id=station)
            for i, station in enumerate(stops)
        ),
        line_ranges=(
            LineRange(
                "d", "c", "", route=RouteRecipe(("L2", "L1"), (joint,), "Reviewed")
            ),
            reverse.line_ranges[0],
        ),
        scope_stops=tuple(ScopeStop(s, "東京都", "千代田区") for s in stops),
    )

    files, builds = synthetic_build(overrides, source)

    routed = builds["reverse"].routed
    assert builds["owner-b"].routed.chosen[1].n02_line == "L2"
    assert routed.chosen[1].n02_line == "L1"  # start of the reversed L1 primitive
    assert routed.paths[0].geometry.coords[-1] == routed.paths[1].geometry.coords[0]
    write_bundle(files, tmp_path)
    assert validate_dataset(load_dataset(tmp_path), overrides).errors == []


def _joint(source: SyntheticSource) -> tuple[float, float]:
    c, d = source.points["c"], source.points["d"]
    return Transformer.from_crs(
        config.METRIC_CRS, config.OUTPUT_CRS, always_xy=True
    ).transform((c.x + d.x) / 2, c.y)


def test_zero_distance_transfer_between_two_line_labels_is_stale(
    committed_overrides: Overrides,
) -> None:
    # The composed L1 anchor and the L2 platform at c share one coordinate, so
    # a transfer row there moves nothing even though the candidates differ.
    source = OwnerOnOtherLineSource()
    overrides = _overrides(committed_overrides, source)
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
                route=RouteRecipe(("L2", "L1"), (_joint(source),), "Reviewed"),
            ),
        ),
    )
    overrides = replace(
        overrides,
        platform_transfers=(PlatformTransfer("rapid", "c", 100.0, "Not a move"),),
    )

    with pytest.raises(RoutingError, match="transfer is unused"):
        synthetic_build(overrides, source)


def test_reversed_multi_line_owner_primitive_swaps_its_end_lines(
    committed_overrides: Overrides,
) -> None:
    source = OwnerOnOtherLineSource()
    overrides = composition_overrides(committed_overrides)
    joint = _joint(source)
    overrides = replace_service(
        overrides,
        "owner-b",
        line_ranges=(
            LineRange("b", "c", "L1"),
            LineRange(
                "c", "d", "", route=RouteRecipe(("L1", "L2"), (joint,), "Reviewed")
            ),
        ),
    )
    reverse = overrides.service("reverse")
    stops = ("d", "c", "a")
    overrides = replace_service(
        overrides,
        "reverse",
        definition=replace(
            reverse.definition,
            expected_stop_count=len(stops),
            length_ref=replace(reverse.definition.length_ref, km=0.9),
        ),
        stops=tuple(
            replace(reverse.stops[0], order=i, station_id=station)
            for i, station in enumerate(stops)
        ),
        line_ranges=(
            LineRange(
                "d", "c", "", compose=recipe(("owner-b", "d", "c", ("L1", "L2")))
            ),
            reverse.line_ranges[0],
        ),
        scope_stops=tuple(ScopeStop(s, "東京都", "千代田区") for s in stops),
    )

    _, builds = synthetic_build(overrides, source)

    routed = builds["reverse"].routed
    assert routed.chosen[0].n02_line == "L2"  # d: the L1 -> L2 primitive's end
    assert routed.chosen[1].n02_line == "L1"  # c: the same primitive's start
