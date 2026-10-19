"""Choose one platform per stop and route every adjacent stop pair of a service.

Stop *order* is fixed by ``data/overrides``; geometry is only used to pick
which N02 platform feature represents a stop (several features can share a
name) and to trace the track between adjacent stops.

- :func:`route_loop`: closed loop (n pairs, the last closes to the first stop).
- :func:`route_path`: open chain (n - 1 pairs, both ends free).

Both minimise the summed pair cost by dynamic programming and break ties by the
lexicographically smallest candidate index tuple, so the choice is
deterministic. Pairs whose snap offset exceeds ``max_snap_offset_m`` are
rejected before the DP (a platform that far from the track is not on it).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from shapely.geometry import Point

from scripts.data_pipeline import config
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.network import (
    NoPathError,
    TrackNetwork,
    TrackPath,
    concat_lines,
    concat_route_legs,
)


class RoutingError(RuntimeError):
    """Raised when a stop has no candidate or a pair cannot be routed."""


@dataclass(frozen=True)
class PairRoute:
    """How to route one adjacent stop pair: its track graph and via points."""

    network: TrackNetwork
    via: tuple[Point, ...] = ()  # metric CRS, visited in order
    networks: tuple[TrackNetwork, ...] = ()  # explicit multi-line order
    joints: tuple[Point, ...] = ()
    line_order: tuple[str, ...] = ()
    operator_order: tuple[str, ...] = ()
    fixed_path: TrackPath | None = None


@dataclass(frozen=True)
class RoutedService:
    # One platform per stop in stop order; at a reviewed platform transfer this
    # is the arrival platform of the +1 order (the published platform point).
    chosen: tuple[PlatformCandidate, ...]
    paths: tuple[TrackPath, ...]  # paths[i] runs stop i -> stop i+1 (+1 order)
    total_cost_mm: int
    circular: bool
    departures: tuple[PlatformCandidate, ...] = ()  # per stop; () = same as chosen

    def arrival(self, stop: int) -> PlatformCandidate:
        """Platform where the +1 pair ending at ``stop`` arrives."""
        return self.chosen[stop % len(self.chosen)]

    def departure(self, stop: int) -> PlatformCandidate:
        """Platform where the +1 pair starting at ``stop`` departs."""
        platforms = self.departures or self.chosen
        return platforms[stop % len(platforms)]


COST_RESOLUTION_M = 0.001  # compare costs as integer millimetres
MAX_REJECTION_REASONS = 3

# (cost, (arrival, departure) candidate indexes per stop so far); both indexes
# are equal except at a reviewed platform transfer.
State = tuple[int, tuple[tuple[int, int], ...]]


def segment_cost(path: TrackPath) -> int:
    """Track length plus the snap offsets at both ends, in integer millimetres.

    Quantising keeps the choice independent of last-bit floating point noise.
    """
    metres = path.length + path.start_offset + path.end_offset
    return round(metres / COST_RESOLUTION_M)


def routed_path(
    route: PairRoute,
    origin: Point,
    destination: Point,
    max_snap_offset_m: float = config.MAX_SNAP_OFFSET_M,
) -> TrackPath:
    """Shortest track path ``origin`` -> via points -> ``destination``."""
    if route.fixed_path is not None:
        path = route.fixed_path
        if (
            origin.coords[0] != path.geometry.coords[0]
            or destination.coords[0] != path.geometry.coords[-1]
        ):
            raise NoPathError("compose platforms differ from exact primitive anchors")
        return path
    if route.networks:
        if (
            route.via
            or len(route.networks) < 2
            or len(route.joints) != len(route.networks) - 1
        ):
            raise RoutingError(
                "multi-line route needs one joint per line transition and no via"
            )
        stops = [origin, *route.joints, destination]
        legs: list[TrackPath] = []
        for index, (network, start, end) in enumerate(
            zip(route.networks, stops, stops[1:], strict=False)
        ):
            try:
                legs.append(network.shortest_path(start, end))
            except NoPathError as error:
                raise NoPathError(
                    f"multi-line route leg {index + 1}: {error}"
                ) from error
        if any(leg.length <= config.ROUTE_JOINT_TOLERANCE_M for leg in legs):
            raise NoPathError("multi-line route has an unused or zero-length line leg")
        for index, joint in enumerate(route.joints):
            if (
                max(legs[index].end_offset, legs[index + 1].start_offset)
                > config.ROUTE_JOINT_TOLERANCE_M
            ):
                raise NoPathError(
                    f"multi-line route joint {index + 1} is not on both declared lines"
                )
            if (
                Point(legs[index].geometry.coords[-1]).distance(joint)
                > config.ROUTE_JOINT_TOLERANCE_M
            ):
                raise NoPathError(
                    f"multi-line route misses its declared joint {index + 1}"
                )
        return TrackPath(
            geometry=concat_route_legs([leg.geometry for leg in legs]),
            length=sum(leg.length for leg in legs),
            start_offset=legs[0].start_offset,
            end_offset=legs[-1].end_offset,
        )
    if route.joints:
        raise RoutingError("route joints require explicit networks")
    if not route.via:
        return route.network.shortest_path(origin, destination)
    stops = [origin, *route.via, destination]
    legs = [
        route.network.shortest_path(start, end)
        for start, end in zip(stops, stops[1:], strict=False)
    ]
    for leg in legs[:-1]:
        if leg.end_offset > max_snap_offset_m:
            raise RoutingError(
                f"via point is {leg.end_offset:.1f} m from the constrained track"
            )
    return TrackPath(
        geometry=concat_lines([leg.geometry for leg in legs]),
        length=sum(leg.length for leg in legs),
        start_offset=legs[0].start_offset,
        end_offset=legs[-1].end_offset,
    )


def _pair_paths(
    origins: Sequence[PlatformCandidate],
    destinations: Sequence[PlatformCandidate],
    route: PairRoute,
    max_snap_offset_m: float,
) -> dict[tuple[int, int], TrackPath]:
    """Paths between every connected, on-track (origin, destination) pair."""
    paths: dict[tuple[int, int], TrackPath] = {}
    rejections: dict[str, None] = {}

    def reject(reason: str) -> None:
        if route.networks and len(rejections) < MAX_REJECTION_REASONS:
            rejections.setdefault(reason, None)

    for a, origin in enumerate(origins):
        for b, destination in enumerate(destinations):
            if route.line_order and (
                origin.n02_line != route.line_order[0]
                or destination.n02_line != route.line_order[-1]
            ):
                reject(
                    f"endpoint lines {origin.n02_line} -> {destination.n02_line} "
                    "differ from the declared first/last lines"
                )
                continue
            if route.operator_order and (
                (origin.operator and origin.operator != route.operator_order[0])
                or (
                    destination.operator
                    and destination.operator != route.operator_order[-1]
                )
            ):
                reject(
                    f"endpoint operators {origin.operator} -> {destination.operator} "
                    "differ from the declared first/last operators"
                )
                continue
            try:
                path = routed_path(
                    route, origin.midpoint, destination.midpoint, max_snap_offset_m
                )
            except NoPathError as error:
                reject(str(error))
                continue  # this platform pair is on disconnected track pieces
            if max(path.start_offset, path.end_offset) > max_snap_offset_m:
                reject(
                    f"platform snap offsets {path.start_offset:.1f}/{path.end_offset:.1f} m "
                    f"exceed {max_snap_offset_m} m"
                )
                continue  # a platform this far away is not on this track
            paths[(a, b)] = path
    if not paths:
        details = ""
        if route.networks:
            order = route.line_order or tuple(
                f"line {index + 1}" for index in range(len(route.networks))
            )
            joints = ", ".join(
                f"{index + 1}: {left} -> {right}"
                for index, (left, right) in enumerate(
                    zip(order, order[1:], strict=False)
                )
            )
            details = (
                f"; multi-line order {' -> '.join(order)}; joints [{joints}]; "
                f"rejections: {'; '.join(rejections)}"
            )
        raise RoutingError(
            f"no track path from {origins[0].station_name} "
            f"to {destinations[0].station_name} (platforms farther than "
            f"{max_snap_offset_m} m from the track are rejected){details}"
        )
    return paths


def _check_inputs(
    candidates: Sequence[Sequence[PlatformCandidate]],
    routes: Sequence[PairRoute],
    pair_count: int,
) -> None:
    if len(routes) != pair_count:
        raise RoutingError(
            f"need exactly one pair route per stop pair ({pair_count}), "
            f"got {len(routes)}"
        )
    for index, options in enumerate(candidates):
        if not options:
            raise RoutingError(f"station S[{index}] has no platform candidate")


def _advance(
    states: dict[int, State],
    pair_paths: dict[tuple[int, int], TrackPath],
    next_count: int,
) -> dict[int, State]:
    """One DP step: cheapest (cost, choice) reaching each next candidate."""
    next_states: dict[int, State] = {}
    for a, (cost, choice) in sorted(states.items()):
        for b in range(next_count):
            path = pair_paths.get((a, b))
            if path is None:
                continue
            entry = (cost + segment_cost(path), (*choice, (b, b)))
            if b not in next_states or entry < next_states[b]:
                next_states[b] = entry
    return next_states


def _transfer(
    states: dict[int, State], options: Sequence[PlatformCandidate], limit_m: float
) -> dict[int, State]:
    """Re-key arrival states by departure platform at a reviewed transfer stop.

    The departure may be another platform of the same stop within ``limit_m``;
    the straight transfer distance is added to the cost, so the closest
    connected pair wins and staying on the arrival platform costs nothing.
    """
    departures: dict[int, State] = {}
    for arrival, (cost, choice) in sorted(states.items()):
        for departure, platform in enumerate(options):
            gap = options[arrival].midpoint.distance(platform.midpoint)
            if gap > limit_m:
                continue
            entry = (
                cost + round(gap / COST_RESOLUTION_M),
                (*choice[:-1], (arrival, departure)),
            )
            if departure not in departures or entry < departures[departure]:
                departures[departure] = entry
    return departures


def route_loop(
    candidates: Sequence[Sequence[PlatformCandidate]],
    routes: Sequence[PairRoute],
    max_snap_offset_m: float = config.MAX_SNAP_OFFSET_M,
) -> RoutedService:
    """Pick the platform combination minimising the closed-loop track length.

    For each choice at S[0], propagate the cheapest cost to every candidate of
    S[1..N-1], then close back to S[0].
    """
    count = len(candidates)
    _check_inputs(candidates, routes, count)
    pair_paths = [
        _pair_paths(
            candidates[i], candidates[(i + 1) % count], routes[i], max_snap_offset_m
        )
        for i in range(count)
    ]

    best: State | None = None
    for first in range(len(candidates[0])):
        states: dict[int, State] = {first: (0, ((first, first),))}
        for i in range(count - 1):
            states = _advance(states, pair_paths[i], len(candidates[i + 1]))
        for last, (cost, choice) in sorted(states.items()):
            path = pair_paths[count - 1].get((last, first))
            if path is None:
                continue
            closed = (cost + segment_cost(path), choice)
            if best is None or closed < best:
                best = closed

    if best is None:
        raise RoutingError("no closed loop found")
    total, choice = best
    chosen = tuple(candidates[i][choice[i][0]] for i in range(count))
    paths = tuple(
        pair_paths[i][(choice[i][0], choice[(i + 1) % count][0])] for i in range(count)
    )
    return RoutedService(chosen=chosen, paths=paths, total_cost_mm=total, circular=True)


def route_path(
    candidates: Sequence[Sequence[PlatformCandidate]],
    routes: Sequence[PairRoute],
    max_snap_offset_m: float = config.MAX_SNAP_OFFSET_M,
    transfers: Mapping[int, float] | None = None,
) -> RoutedService:
    """Pick the platform combination minimising an open chain's track length.

    Every candidate of the first stop starts at cost 0; the n - 1 pairs are
    propagated in stop order and the cheapest final state wins. ``transfers``
    maps a reviewed interior stop index to its maximum platform transfer: the
    pair leaving that stop may start from another platform of the stop.
    """
    count = len(candidates)
    if count < 2:
        raise RoutingError("an open chain needs at least two stops")
    transfers = transfers or {}
    if any(not 0 < stop < count - 1 for stop in transfers):
        raise RoutingError("a platform transfer needs an interior stop")
    _check_inputs(candidates, routes, count - 1)
    pair_paths = [
        _pair_paths(candidates[i], candidates[i + 1], routes[i], max_snap_offset_m)
        for i in range(count - 1)
    ]

    states: dict[int, State] = {
        first: (0, ((first, first),)) for first in range(len(candidates[0]))
    }
    for i in range(count - 1):
        states = _advance(states, pair_paths[i], len(candidates[i + 1]))
        if not states:
            raise RoutingError(f"no connected path reaches S[{i + 1}]")
        if i + 1 in transfers:
            states = _transfer(states, candidates[i + 1], transfers[i + 1])
    total, choice = min(states.values())
    stale = [
        stop
        for stop in sorted(transfers)
        if candidates[stop][choice[stop][0]].midpoint.coords[0]
        == candidates[stop][choice[stop][1]].midpoint.coords[0]
    ]
    if stale:
        raise RoutingError(f"reviewed platform transfer is unused at S{stale}")
    chosen = tuple(candidates[i][choice[i][0]] for i in range(count))
    departures = tuple(candidates[i][choice[i][1]] for i in range(count))
    paths = tuple(
        pair_paths[i][(choice[i][1], choice[i + 1][0])] for i in range(count - 1)
    )
    return RoutedService(
        chosen=chosen,
        paths=paths,
        total_cost_mm=total,
        circular=False,
        departures=departures if transfers else (),
    )
