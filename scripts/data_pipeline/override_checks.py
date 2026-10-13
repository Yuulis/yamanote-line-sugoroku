"""Reviewed override checks."""

from __future__ import annotations

from collections.abc import Sequence

from scripts.data_pipeline.constraints import (
    ConstraintError,
    check_station_number_order,
)
from scripts.data_pipeline.override_models import (
    LineRange,
    Overrides,
    ServiceDefinition,
    Stop,
)
from scripts.data_pipeline.registry import (
    OverrideError,
    check_scope,
)


def check_stops(definition: ServiceDefinition, stops: tuple[Stop, ...]) -> None:
    """Order 0..n-1, no repeats, the reviewed count, and station-number order."""
    where = f"service {definition.id}"
    if len(stops) != definition.expected_stop_count:
        raise OverrideError(
            f"{where}: expected {definition.expected_stop_count} stations, "
            f"got {len(stops)}"
        )
    if [stop.order for stop in stops] != list(range(len(stops))):
        raise OverrideError(f"{where}: stop 'order' must be 0..N-1 in file order")
    station_ids = [stop.station_id for stop in stops]
    if len(set(station_ids)) != len(station_ids):
        raise OverrideError(f"{where}: a station is listed twice")
    check_station_numbers(
        stops, definition.circular, where, definition.station_number_sequence
    )


def check_station_numbers(
    stops: Sequence[Stop],
    circular: bool,
    where: str = "service",
    expected_sequence: tuple[str, ...] | None = None,
) -> None:
    """Compare configured numbering evidence or the legacy consecutive rule."""
    try:
        check_station_number_order(
            [stop.station_number for stop in stops],
            [stop.station_id for stop in stops],
            circular,
            where,
            expected_sequence,
        )
    except ConstraintError as error:
        raise OverrideError(str(error)) from error


def expand_ranges(
    station_ids: Sequence[str], ranges: Sequence[LineRange], circular: bool = True
) -> tuple[LineRange, ...]:
    """Map every +1 stop pair to exactly one line range.

    Loops have ``n`` pairs (the last one closes to the first stop) and ranges
    may wrap; open chains have ``n - 1`` pairs and ranges never wrap.
    """
    count = len(station_ids)
    pairs = count if circular else count - 1
    index_of = {station_id: index for index, station_id in enumerate(station_ids)}
    assigned: list[LineRange | None] = [None] * pairs
    for line_range in ranges:
        for endpoint in (line_range.from_id, line_range.to_id):
            if endpoint not in index_of:
                raise OverrideError(f"unknown station in line mapping: {endpoint!r}")
        start = index_of[line_range.from_id]
        end = index_of[line_range.to_id]
        span = (end - start) % count if circular else end - start
        if span <= 0:
            reason = "empty" if span == 0 else "backward (open chains never wrap)"
            raise OverrideError(f"{reason} line range: {line_range}")
        if (line_range.via or line_range.route or line_range.compose) and span != 1:
            raise OverrideError(
                f"via points need a single-pair range: {line_range.from_id} -> "
                f"{line_range.to_id}"
            )
        for offset in range(span):
            pair = (start + offset) % count
            previous = assigned[pair]
            if previous is not None:
                raise OverrideError(
                    f"segment E[{pair}] mapped twice "
                    f"({previous.n02_line} and {line_range.n02_line})"
                )
            assigned[pair] = line_range
    missing = [index for index, item in enumerate(assigned) if item is None]
    if missing:
        raise OverrideError(f"segments without an N02 line mapping: {missing}")
    return tuple(item for item in assigned if item is not None)


def expand_line_ranges(
    station_ids: Sequence[str], ranges: Sequence[LineRange], circular: bool = True
) -> tuple[str, ...]:
    """The N02 line of every +1 stop pair (see :func:`expand_ranges`)."""
    return tuple(
        " -> ".join(item.route_lines)
        for item in expand_ranges(station_ids, ranges, circular)
    )


def check_consistency(overrides: Overrides) -> None:
    """Catalogue, registry references, area membership, start and target."""
    dataset = overrides.dataset
    services = overrides.services
    service_ids = tuple(service.id for service in services)
    if service_ids != dataset.service_ids:
        raise OverrideError(
            f"services.json ids {list(service_ids)} differ from the reviewed "
            f"catalogue {list(dataset.service_ids)} in dataset.json"
        )
    unknown_disconnected = set(dataset.reviewed_disconnected_service_ids) - set(
        service_ids
    )
    if unknown_disconnected:
        raise OverrideError(
            f"unknown disconnected services {sorted(unknown_disconnected)}"
        )

    registry = overrides.registry.by_id()
    served: dict[str, list[str]] = {station_id: [] for station_id in registry}
    known_lines = {line.id for line in overrides.lines}
    for service in services:
        if not set(service.definition.line_ids) <= known_lines:
            raise OverrideError(f"{service.id}: unknown lineIds")
        for station_id in service.station_ids:
            if station_id not in registry:
                raise OverrideError(
                    f"service {service.id} stops at {station_id!r}, which is not an "
                    "in-area registry station"
                )
            served[station_id].append(service.id)
    unserved = sorted(station_id for station_id, ids in served.items() if not ids)
    if unserved:
        raise OverrideError(f"registry stations served by no service: {unserved}")
    for station in overrides.registry.stations:
        if not dataset.area.contains(station.prefecture, station.municipality):
            raise OverrideError(f"station {station.id} is outside the configured area")
        if station.representative_service_id not in served[station.id]:
            raise OverrideError(
                f"station {station.id}: representative service "
                f"{station.representative_service_id!r} does not stop there"
            )

    if dataset.target_service_id not in service_ids:
        raise OverrideError(f"target service {dataset.target_service_id!r} is unknown")
    target = overrides.target
    if not target.circular:
        raise OverrideError("the target service must be circular")
    if target.station_ids[0] != dataset.start_station_id:
        raise OverrideError(
            f"S[0] of {target.id} must be the start station {dataset.start_station_id!r}"
        )
    for service in services:
        if service.circular:
            continue
        ends = (service.station_ids[0], service.station_ids[-1])
        if dataset.start_station_id in ends:
            raise OverrideError(
                f"start station {dataset.start_station_id} is an endpoint of {service.id}"
            )
    from scripts.data_pipeline.composition import check_recipes

    check_recipes(overrides)
    check_offset_exception_references(overrides)
    for service in services:
        ends = service.definition.endpoints
        check_scope(
            service.id,
            service.station_ids,
            service.scope_stops,
            overrides.registry,
            dataset.area,
            (ends.first, ends.last) if ends else None,
        )
    seen_detours: set[tuple[str, str, str]] = set()
    for exception in overrides.detour_exceptions:
        key = (exception.service_id, exception.from_id, exception.to_id)
        if key in seen_detours:
            raise OverrideError(f"duplicate detour exception {key}")
        seen_detours.add(key)
        try:
            service = overrides.service(exception.service_id)
        except KeyError:
            raise OverrideError(
                f"detour exception for unknown service {exception.service_id}"
            ) from None
        pairs = tuple(
            zip(
                service.station_ids,
                (*service.station_ids[1:], service.station_ids[0]),
                strict=True,
            )
        )
        if not service.circular:
            pairs = pairs[:-1]
        if (exception.from_id, exception.to_id) not in pairs:
            raise OverrideError(f"detour exception is not a forward stop pair: {key}")


def check_offset_exception_references(overrides: Overrides) -> None:
    seen: set[tuple[str, str]] = set()
    for exception in overrides.offset_exceptions:
        key = (exception.service_id, exception.station_id)
        if key in seen:
            raise OverrideError(f"duplicate offset exception {key}")
        seen.add(key)
        try:
            service = overrides.service(exception.service_id)
        except KeyError:
            raise OverrideError(
                f"offset exception for unknown service {exception.service_id!r}"
            ) from None
        if exception.station_id not in service.station_ids:
            raise OverrideError(
                f"offset exception: {exception.service_id} does not stop at "
                f"{exception.station_id!r}"
            )
