"""Pure stop-list topology shared by export and validation (no geometry).

A service is an ordered stop list plus ``circular``. Only the target loop is
restricted to +1; non-target loops and open chains are ridden in both
directions. These helpers fix the deterministic orders of the data contract.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

Pair = tuple[str, str]


def station_pairs(station_ids: Sequence[str], circular: bool) -> list[Pair]:
    """Adjacent stop pairs in +1 order (loops close back to the first stop)."""
    count = len(station_ids)
    pairs = count if circular else count - 1
    return [
        (station_ids[i], station_ids[(i + 1) % count]) for i in range(max(pairs, 0))
    ]


def directed_pairs(
    station_ids: Sequence[str],
    circular: bool,
    *,
    service_id: str,
    target_service_id: str,
) -> list[Pair]:
    """Ridable pairs; only the target loop runs +1, otherwise both ways per pair."""
    pairs = station_pairs(station_ids, circular)
    if circular and service_id == target_service_id:
        return pairs
    return [directed for a, b in pairs for directed in ((a, b), (b, a))]


def endpoints(station_ids: Sequence[str], circular: bool) -> tuple[str, ...]:
    """The two end stops of an open chain; a loop has none."""
    if circular or not station_ids:
        return ()
    return (station_ids[0], station_ids[-1])


def station_order(stop_lists: Iterable[Sequence[str]]) -> list[str]:
    """Stations by first appearance across services (services in given order)."""
    seen: dict[str, None] = {}
    for station_ids in stop_lists:
        for station_id in station_ids:
            seen.setdefault(station_id, None)
    return list(seen)


def walk(
    start: str,
    successor: dict[str, str],
    max_steps: int,
) -> list[str]:
    """Follow ``successor`` from ``start`` for at most ``max_steps`` hops.

    Returns the visited stations including ``start``; stops early at a station
    without a successor (an open chain's end).
    """
    visited = [start]
    current = start
    for _ in range(max_steps):
        following = successor.get(current)
        if following is None:
            break
        visited.append(following)
        current = following
    return visited
