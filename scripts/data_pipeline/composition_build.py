"""Build exact metric paths and inherited platforms for composed pairs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from typing import TYPE_CHECKING

from shapely.geometry import LineString, Point

from scripts.data_pipeline.composition import check_recipe_anchors, flatten_recipe
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.network import TrackPath
from scripts.data_pipeline.override_models import Overrides, ServiceOverrides
from scripts.data_pipeline.registry import OverrideError
from scripts.data_pipeline.topology import station_pairs

if TYPE_CHECKING:
    from scripts.data_pipeline.build import ServiceBuild


def composed_pairs(
    service: ServiceOverrides, overrides: Overrides, builds: Mapping[str, ServiceBuild]
) -> dict[int, tuple[TrackPath, PlatformCandidate, PlatformCandidate]]:
    result = {}
    for index, ((a, b), item) in enumerate(
        zip(
            station_pairs(service.station_ids, service.circular),
            service.segment_ranges(),
            strict=True,
        )
    ):
        if not item.compose:
            continue
        primitives = flatten_recipe(overrides, item.compose)
        check_recipe_anchors(a, b, primitives)
        coordinates = []
        anchors = []
        for owner, x, y, reverse in primitives:
            built = builds[owner]
            pair_index = station_pairs(
                built.service.station_ids, built.service.circular
            ).index((x, y))
            points = list(built.routed.paths[pair_index].geometry.coords)
            start_index, end_index = (
                pair_index,
                (pair_index + 1) % len(built.routed.chosen),
            )
            if reverse:
                points.reverse()
                start_index, end_index = end_index, start_index
            if coordinates and coordinates[-1] != points[0]:
                raise OverrideError(
                    "compose platform-gap joint is not exact in metric primitives"
                )
            coordinates.extend(points[1:] if coordinates else points)
            anchors.append(
                (built.routed.chosen[start_index], built.routed.chosen[end_index])
            )
        geometry = LineString(coordinates)
        result[index] = (
            TrackPath(geometry, geometry.length, 0.0, 0.0),
            replace(anchors[0][0], midpoint=Point(coordinates[0])),
            replace(anchors[-1][1], midpoint=Point(coordinates[-1])),
        )
    return result


def inherited_candidates(
    pair_builds: Mapping[int, tuple[TrackPath, PlatformCandidate, PlatformCandidate]],
    count: int,
) -> dict[int, PlatformCandidate]:
    anchors: dict[int, PlatformCandidate] = {}
    for index, (_, first, last) in pair_builds.items():
        for stop, candidate in ((index, first), ((index + 1) % count, last)):
            previous = anchors.get(stop)
            if previous and previous.midpoint.coords[0] != candidate.midpoint.coords[0]:
                raise OverrideError("compose platform-gap between adjacent hops")
            anchors[stop] = candidate
    return anchors


def check_inherited_route_anchors(
    paths: tuple[TrackPath, ...], inherited: Mapping[int, PlatformCandidate], count: int
) -> None:
    """A routed neighbour may not snap away from an inherited primitive anchor."""
    for index, path in enumerate(paths):
        for stop, coordinate in (
            (index, path.geometry.coords[0]),
            ((index + 1) % count, path.geometry.coords[-1]),
        ):
            if stop in inherited and inherited[stop].midpoint.coords[0] != coordinate:
                raise OverrideError(
                    "compose platform-gap: route leaves an inherited primitive anchor"
                )
