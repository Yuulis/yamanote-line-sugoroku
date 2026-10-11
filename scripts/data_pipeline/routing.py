"""Choose one platform per station and route every outer-loop segment.

Station *order* is fixed by ``data/overrides``; geometry is only used to pick
which N02 platform feature represents a station (several features can share a
name) and to trace the track between adjacent stations.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from scripts.data_pipeline.n02 import PlatformCandidate
from scripts.data_pipeline.network import NoPathError, TrackNetwork, TrackPath


class RoutingError(RuntimeError):
    """Raised when a station has no candidate or a segment cannot be routed."""


@dataclass(frozen=True)
class RoutedLoop:
    chosen: tuple[PlatformCandidate, ...]  # one per station, in loop order
    paths: tuple[TrackPath, ...]  # paths[i] runs S[i] -> S[i+1]
    total_cost_mm: int


COST_RESOLUTION_M = 0.001  # compare costs as integer millimetres


def segment_cost(path: TrackPath) -> int:
    """Track length plus the snap offsets at both ends, in integer millimetres.

    Quantising keeps the choice independent of last-bit floating point noise.
    """
    metres = path.length + path.start_offset + path.end_offset
    return round(metres / COST_RESOLUTION_M)


def _pair_paths(
    origins: Sequence[PlatformCandidate],
    destinations: Sequence[PlatformCandidate],
    network: TrackNetwork,
) -> dict[tuple[int, int], TrackPath]:
    """Paths between every connected (origin, destination) candidate pair."""
    paths: dict[tuple[int, int], TrackPath] = {}
    for a, origin in enumerate(origins):
        for b, destination in enumerate(destinations):
            try:
                path = network.shortest_path(origin.midpoint, destination.midpoint)
            except NoPathError:
                continue  # this platform pair is on disconnected track pieces
            paths[(a, b)] = path
    if not paths:
        raise RoutingError(
            f"no track path from {origins[0].station_name} "
            f"to {destinations[0].station_name}"
        )
    return paths


def route_loop(
    candidates: Sequence[Sequence[PlatformCandidate]],
    segment_lines: Sequence[str],
    networks: Mapping[str, TrackNetwork],
) -> RoutedLoop:
    """Pick the platform combination minimising the closed-loop track length.

    Dynamic programming over the cycle: for each choice at S[0], propagate the
    cheapest cost to every candidate of S[1..N-1], then close back to S[0].
    Ties are broken by the lexicographically smallest candidate index tuple.
    """
    count = len(candidates)
    if count != len(segment_lines):
        raise RoutingError("need exactly one N02 line per segment")
    for index, options in enumerate(candidates):
        if not options:
            raise RoutingError(f"station S[{index}] has no platform candidate")

    pair_paths = [
        _pair_paths(
            candidates[i], candidates[(i + 1) % count], networks[segment_lines[i]]
        )
        for i in range(count)
    ]

    best: tuple[int, tuple[int, ...]] | None = None
    for first in range(len(candidates[0])):
        # states: candidate index at S[i] -> (cost, choice tuple)
        states: dict[int, tuple[int, tuple[int, ...]]] = {first: (0, (first,))}
        for i in range(count - 1):
            next_states: dict[int, tuple[int, tuple[int, ...]]] = {}
            for a, (cost, choice) in sorted(states.items()):
                for b in range(len(candidates[i + 1])):
                    path = pair_paths[i].get((a, b))
                    if path is None:
                        continue
                    entry = (cost + segment_cost(path), (*choice, b))
                    if b not in next_states or entry < next_states[b]:
                        next_states[b] = entry
            states = next_states
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
    return RoutedLoop(chosen=chosen, paths=paths, total_cost_mm=total)
