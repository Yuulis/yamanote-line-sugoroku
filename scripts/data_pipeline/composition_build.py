"""Build exact metric paths and inherited platforms for composed pairs."""

from __future__ import annotations

from collections.abc import Collection, Mapping
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
            lines = built.service.segment_ranges()[pair_index].route_lines
            # The anchor is a point on the owner's track, so it carries the N02
            # line the primitive ends on, not the owner's chosen platform line.
            start = (built.routed.departure(pair_index), lines[0])
            end = (built.routed.arrival(pair_index + 1), lines[-1])
            if reverse:
                points.reverse()
                start, end = end, start
            if coordinates and coordinates[-1] != points[0]:
                raise OverrideError(
                    "compose platform-gap joint is not exact in metric primitives"
                )
            coordinates.extend(points[1:] if coordinates else points)
            anchors.append((start, end))
        geometry = LineString(coordinates)
        (first, first_line), (last, last_line) = anchors[0][0], anchors[-1][1]
        result[index] = (
            TrackPath(geometry, geometry.length, 0.0, 0.0),
            replace(first, n02_line=first_line, midpoint=Point(coordinates[0])),
            replace(last, n02_line=last_line, midpoint=Point(coordinates[-1])),
        )
    return result


Anchors = dict[int, PlatformCandidate]


def inherited_candidates(
    pair_builds: Mapping[int, tuple[TrackPath, PlatformCandidate, PlatformCandidate]],
    count: int,
    transfer_stops: Collection[int] = (),
) -> tuple[Anchors, Anchors]:
    """Inherited (arrival, departure) anchors per stop.

    Outside a reviewed platform transfer both sides of a stop are one exact
    point, reported on both sides (a lone composed side also binds the other).
    """
    arrivals: Anchors = {}
    departures: Anchors = {}
    for index, (_, first, last) in pair_builds.items():
        departures[index] = first
        arrivals[(index + 1) % count] = last
    for stop in sorted(set(arrivals) | set(departures)):
        if stop in transfer_stops:
            continue
        arrival, departure = arrivals.get(stop), departures.get(stop)
        if (
            arrival
            and departure
            and arrival.midpoint.coords[0] != departure.midpoint.coords[0]
        ):
            raise OverrideError("compose platform-gap between adjacent hops")
        anchor = departure or arrival
        if anchor is not None:
            arrivals[stop] = departures[stop] = anchor
    return arrivals, departures


def check_inherited_route_anchors(
    paths: tuple[TrackPath, ...], arrivals: Anchors, departures: Anchors, count: int
) -> None:
    """A routed neighbour may not snap away from an inherited primitive anchor."""
    for index, path in enumerate(paths):
        for anchors, stop, coordinate in (
            (departures, index, path.geometry.coords[0]),
            (arrivals, (index + 1) % count, path.geometry.coords[-1]),
        ):
            if stop in anchors and anchors[stop].midpoint.coords[0] != coordinate:
                raise OverrideError(
                    "compose platform-gap: route leaves an inherited primitive anchor"
                )
