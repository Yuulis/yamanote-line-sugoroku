"""Contract-independent validation rules (design §5.4), shared by v1 and v2.

Every rule works on plain values (stop lists, directed pairs, metric points)
rather than on a particular JSON shape, appends human-readable errors to a
:class:`Report`, and never raises on malformed input. ``validate.py`` adapts
the published files to these inputs.
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from scripts.data_pipeline import config
from scripts.data_pipeline.overrides import (
    LengthRef,
    OffsetException,
    ServiceDefinition,
)
from scripts.data_pipeline.registry import Registry
from scripts.data_pipeline.topology import Pair, directed_pairs, endpoints, walk


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class ServiceStops:
    """The topology of one published service."""

    id: str
    station_ids: tuple[str, ...]
    circular: bool


# --- registry, area, catalogue (rules 2-4) ---------------------------------


def check_registry_membership(
    published: Iterable[tuple[str, str]], registry: Registry, report: Report
) -> None:
    """Published (id, name) pairs are in-area registry stations, names agree."""
    stations = registry.by_id()
    for station_id, name in published:
        station = stations.get(station_id)
        if station is None:
            report.errors.append(
                f"station {station_id} is not an in-area registry station"
            )
            continue
        if name != station.name:
            report.errors.append(
                f"station {station_id} name {name!r} differs from the registry "
                f"({station.name!r})"
            )
        if station.ward not in config.TOKYO_23_WARDS:
            report.errors.append(f"station {station_id} lies outside the 23 wards")


def check_catalogue(
    published_ids: Sequence[str],
    catalogue: Sequence[str],
    excluded: Iterable[str],
    report: Report,
) -> None:
    """Published service ids equal the reviewed catalogue, in lottery order."""
    if list(published_ids) != list(catalogue):
        report.errors.append(
            f"service ids {list(published_ids)} differ from the reviewed catalogue "
            f"{list(catalogue)}"
        )
    present = sorted(set(published_ids) & set(excluded))
    if present:
        report.errors.append(f"explicitly excluded services are present: {present}")


def check_service_metadata(
    published: Mapping[str, object],
    definition: ServiceDefinition,
    operator: str,
    report: Report,
) -> None:
    """Fields shared by every contract version equal the override."""
    expected = {
        "id": definition.id,
        "name": definition.name,
        "operator": operator,
        "circular": definition.circular,
        "color": definition.color,
    }
    for key, value in expected.items():
        if published.get(key) != value:
            report.errors.append(
                f"service {definition.id} {key} differs from data/overrides"
            )


# --- stop lists and segments (rules 5, 6, 9, 10) ---------------------------


def check_stop_list(
    service: ServiceStops,
    expected: Sequence[str],
    known_station_ids: Iterable[str],
    report: Report,
) -> None:
    """Minimum length, no repeats, known references, override order."""
    ids = service.station_ids
    minimum = 3 if service.circular else 2
    if len(ids) < minimum:
        report.errors.append(f"service {service.id} needs at least {minimum} stops")
    if len(set(ids)) != len(ids):
        report.errors.append(f"service {service.id} lists a stop twice")
    unknown = sorted(set(ids) - set(known_station_ids))
    if unknown:
        report.errors.append(
            f"service {service.id} stops at unknown stations {unknown}"
        )
    if list(ids) != list(expected):
        report.errors.append(
            f"service {service.id} stop order differs from data/overrides"
        )


def check_contiguity(
    service: ServiceStops, pairs: Iterable[Pair], report: Report
) -> None:
    """Each segment joins two neighbours of one in-area run (no bridged gap)."""
    index = {station_id: i for i, station_id in enumerate(service.station_ids)}
    count = len(service.station_ids)
    for from_id, to_id in pairs:
        if from_id not in index or to_id not in index:
            report.errors.append(
                f"{service.id} segment {from_id} -> {to_id} leaves the stop list"
            )
            continue
        gap = abs(index[from_id] - index[to_id])
        adjacent = gap == 1 or (service.circular and gap == count - 1)
        if not adjacent:
            report.errors.append(
                f"{service.id} segment {from_id} -> {to_id} bridges omitted stops"
            )


def check_directed_pairs(
    service: ServiceStops, pairs: Sequence[Pair], report: Report
) -> None:
    """Exactly the ridable directed pairs: loops +1 only, chains both ways."""
    expected = directed_pairs(service.station_ids, service.circular)
    if len(set(pairs)) != len(pairs):
        report.errors.append(f"{service.id} has duplicate directed segments")
    missing = [pair for pair in expected if pair not in set(pairs)]
    extra = sorted(set(pairs) - set(expected))
    if missing:
        report.errors.append(f"{service.id} is missing directed segments {missing}")
    if extra:
        report.errors.append(f"{service.id} has unexpected directed segments {extra}")
    shape = "n" if service.circular else "2(n-1)"
    if len(pairs) != len(expected):
        report.errors.append(
            f"{service.id} must have {len(expected)} segments ({shape}), "
            f"got {len(pairs)}"
        )


def check_walks(service: ServiceStops, pairs: Sequence[Pair], report: Report) -> None:
    """Walk each supported direction end to end over the published pairs.

    Loop: n steps from the first stop return to it and use every segment once.
    Chain: forward from the first stop and backward from the last stop each
    reach the other end in n - 1 steps, with no outward segment at the end.
    """
    ids = service.station_ids
    count = len(ids)
    if count < 2:
        return
    index = {station_id: i for i, station_id in enumerate(ids)}
    forward: dict[str, str] = {}
    backward: dict[str, str] = {}
    for from_id, to_id in pairs:
        if from_id not in index or to_id not in index:
            continue
        step = index[to_id] - index[from_id]
        if service.circular:
            step = (step + 1) % count - 1  # wrap: n-1 -> 0 is +1, 0 -> n-1 is -1
        if step == 1:
            forward[from_id] = to_id
        elif step == -1:
            backward[from_id] = to_id
    if service.circular:
        visited = walk(ids[0], forward, count)
        if len(visited) != count + 1 or visited[-1] != ids[0]:
            report.errors.append(
                f"{service.id} {count}-step walk does not return to {ids[0]}"
            )
        elif len(set(visited[:-1])) != count:
            report.errors.append(f"{service.id} walk does not visit every stop once")
        return
    for label, start, end, successor in (
        ("forward", ids[0], ids[-1], forward),
        ("backward", ids[-1], ids[0], backward),
    ):
        visited = walk(start, successor, count)
        if visited[-1] != end or len(visited) != count:
            report.errors.append(
                f"{service.id} {label} walk from {start} stops at {visited[-1]}"
            )
        if end in successor:
            report.errors.append(
                f"{service.id} {label} walk continues past its end {end}"
            )


# --- platforms and offsets (rules 7, 8) ------------------------------------


def check_platform_keys(
    service: ServiceStops, platform_ids: Iterable[str], report: Report
) -> None:
    if set(platform_ids) != set(service.station_ids):
        report.errors.append(
            f"{service.id} platform coordinates must cover exactly its stops"
        )


def check_platform_offsets(
    platforms: Mapping[tuple[str, str], Point],
    representative: Mapping[str, Point],
    exceptions: Sequence[OffsetException],
    report: Report,
    default_limit_m: float = config.DEFAULT_MAX_PLATFORM_OFFSET_M,
) -> None:
    """Service platform -> station point within the default or a reviewed limit.

    An exception that is not needed (offset within the default) or that names
    an unknown (service, station) pair fails, so the table cannot go stale.
    """
    limits = {(item.service_id, item.station_id): item for item in exceptions}
    largest = 0.0
    for (service_id, station_id), point in platforms.items():
        station_point = representative.get(station_id)
        if station_point is None:
            report.errors.append(f"station {station_id} has no representative point")
            continue
        offset = point.distance(station_point)
        largest = max(largest, offset)
        exception = limits.get((service_id, station_id))
        limit = exception.max_platform_offset_m if exception else default_limit_m
        if offset > limit:
            report.errors.append(
                f"{service_id} platform at {station_id} is {offset:.0f} m from the "
                f"station point (limit {limit:.0f} m)"
            )
        elif exception is not None and offset <= default_limit_m:
            report.errors.append(
                f"unused offset exception {service_id}/{station_id} "
                f"({offset:.0f} m is within the default)"
            )
    for key in sorted(set(limits) - set(platforms)):
        report.errors.append(f"unused offset exception {key[0]}/{key[1]}")
    report.metrics["max_platform_offset_m"] = round(largest, 1)


# --- geometry sanity (rules 13, 14) ----------------------------------------


def check_skipped_stops(
    label: str,
    geometry: BaseGeometry,
    ends: Pair,
    service_points: Mapping[str, Point],
    report: Report,
) -> float:
    """No *same-service* stop other than the pair's ends near the track.

    A stop the service serves lying on the path means the stop order or the
    routing is wrong. Other services' stations are legitimately passed in
    shared corridors, so they are only counted by :func:`count_other_passes`.
    Returns the minimum distance seen (inf when there is none).
    """
    closest = math.inf
    for station_id, point in service_points.items():
        if station_id in ends:
            continue
        distance = float(geometry.distance(point))
        closest = min(closest, distance)
        if distance < config.FOREIGN_STATION_MIN_DISTANCE_M:
            report.errors.append(
                f"{label} passes {distance:.0f} m from {station_id} "
                "(station order or routing is wrong)"
            )
    return closest


def count_other_passes(
    geometry: BaseGeometry, other_points: Mapping[str, Point]
) -> int:
    """Diagnostic: other services' stations within the skipped-stop radius."""
    return sum(
        1
        for point in other_points.values()
        if geometry.distance(point) < config.FOREIGN_STATION_MIN_DISTANCE_M
    )


def check_service_length(
    service_id: str, length_m: float, reference: LengthRef, report: Report
) -> None:
    """Canonical features summed once per service vs the reviewed reference."""
    length_km = length_m / 1000
    report.metrics[f"length_km[{service_id}]"] = round(length_km, 3)
    if abs(length_km - reference.km) > reference.tolerance_km:
        report.errors.append(
            f"{service_id} length {length_km:.2f} km is far from the reference "
            f"{reference.km}±{reference.tolerance_km} km"
        )


# --- reachability (rules 15, 16) -------------------------------------------


def reachable_stations(services: Sequence[ServiceStops], start: str) -> set[str]:
    """Stations reachable from ``start`` by riding any service's directed pairs."""
    successors: dict[str, set[str]] = {}
    for service in services:
        for from_id, to_id in directed_pairs(service.station_ids, service.circular):
            successors.setdefault(from_id, set()).add(to_id)
    reached = {start}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for following in sorted(successors.get(current, ())):
            if following not in reached:
                reached.add(following)
                queue.append(following)
    return reached


def check_connectivity(
    services: Sequence[ServiceStops],
    start: str,
    target_id: str,
    reviewed_disconnected: Iterable[str],
    report: Report,
) -> None:
    """Every target segment is reachable; disconnected services are reviewed."""
    reached = reachable_stations(services, start)
    disconnected = sorted(
        service.id for service in services if not set(service.station_ids) & reached
    )
    if disconnected != sorted(reviewed_disconnected):
        report.errors.append(
            f"disconnected services {disconnected} differ from the reviewed list "
            f"{sorted(reviewed_disconnected)}"
        )
    for service in services:
        if service.id != target_id:
            continue
        unreachable = sorted(set(service.station_ids) - reached)
        if unreachable:
            report.errors.append(
                f"target segments from {unreachable} are unreachable from {start}"
            )


def check_start_not_endpoint(
    services: Sequence[ServiceStops], start: str, report: Report
) -> None:
    for service in services:
        if start in endpoints(service.station_ids, service.circular):
            report.errors.append(
                f"start station {start} is an endpoint of {service.id}"
            )
