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

from collections.abc import Sequence
from dataclasses import dataclass

from shapely.geometry import Point

from scripts.data_pipeline import config
from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.network import (
    NoPathError,
    TrackNetwork,
    TrackPath,
    concat_lines,
)


class RoutingError(RuntimeError):
    """Raised when a stop has no candidate or a pair cannot be routed."""


@dataclass(frozen=True)
class PairRoute:
    """How to route one adjacent stop pair: its track graph and via points."""

    network: TrackNetwork
    via: tuple[Point, ...] = ()  # metric CRS, visited in order


@dataclass(frozen=True)
class RoutedService:
    chosen: tuple[PlatformCandidate, ...]  # one per stop, in stop order
    paths: tuple[TrackPath, ...]  # paths[i] runs stop i -> stop i+1 (+1 order)
    total_cost_mm: int
    circular: bool


COST_RESOLUTION_M = 0.001  # compare costs as integer millimetres

State = tuple[int, tuple[int, ...]]  # (cost, candidate index per stop so far)


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
    for a, origin in enumerate(origins):
        for b, destination in enumerate(destinations):
            try:
                path = routed_path(
                    route, origin.midpoint, destination.midpoint, max_snap_offset_m
                )
            except NoPathError:
                continue  # this platform pair is on disconnected track pieces
            if max(path.start_offset, path.end_offset) > max_snap_offset_m:
                continue  # a platform this far away is not on this track
            paths[(a, b)] = path
    if not paths:
        raise RoutingError(
            f"no track path from {origins[0].station_name} "
            f"to {destinations[0].station_name} (platforms farther than "
            f"{max_snap_offset_m} m from the track are rejected)"
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
            entry = (cost + segment_cost(path), (*choice, b))
            if b not in next_states or entry < next_states[b]:
                next_states[b] = entry
    return next_states


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
        states: dict[int, State] = {first: (0, (first,))}
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
    chosen = tuple(candidates[i][choice[i]] for i in range(count))
    paths = tuple(
        pair_paths[i][(choice[i], choice[(i + 1) % count])] for i in range(count)
    )
    return RoutedService(chosen=chosen, paths=paths, total_cost_mm=total, circular=True)


def route_path(
    candidates: Sequence[Sequence[PlatformCandidate]],
    routes: Sequence[PairRoute],
    max_snap_offset_m: float = config.MAX_SNAP_OFFSET_M,
) -> RoutedService:
    """Pick the platform combination minimising an open chain's track length.

    Every candidate of the first stop starts at cost 0; the n - 1 pairs are
    propagated in stop order and the cheapest final state wins.
    """
    count = len(candidates)
    if count < 2:
        raise RoutingError("an open chain needs at least two stops")
    _check_inputs(candidates, routes, count - 1)
    pair_paths = [
        _pair_paths(candidates[i], candidates[i + 1], routes[i], max_snap_offset_m)
        for i in range(count - 1)
    ]

    states: dict[int, State] = {
        first: (0, (first,)) for first in range(len(candidates[0]))
    }
    for i in range(count - 1):
        states = _advance(states, pair_paths[i], len(candidates[i + 1]))
        if not states:
            raise RoutingError(f"no connected path reaches S[{i + 1}]")
    total, choice = min(states.values())
    chosen = tuple(candidates[i][choice[i]] for i in range(count))
    paths = tuple(pair_paths[i][(choice[i], choice[i + 1])] for i in range(count - 1))
    return RoutedService(
        chosen=chosen, paths=paths, total_cost_mm=total, circular=False
    )
