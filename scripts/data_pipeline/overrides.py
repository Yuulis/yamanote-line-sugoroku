"""Load and cross-check the reviewed tables in ``data/overrides/``.

Layout (see ``data/README.md``)::

    dataset.json                     dataset-level metadata and catalogue oracle
    stations.csv                     curated station registry (registry.py)
    services.json                    service definitions, in lottery order
    services/<id>/stops.csv          in-area stop order of one service
    services/<id>/line_mapping.csv   N02 line (and via hints) per stop run
    services/<id>/sections.csv       optional allow/deny section keys
    offset_exceptions.csv            reviewed platform -> station offsets
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, TypeGuard

from scripts.data_pipeline import config
from scripts.data_pipeline.constraints import (
    ConstraintError,
    LonLat,
    PlatformSelector,
    SectionFilter,
    build_section_filter,
    parse_platform_selector,
    parse_via,
)
from scripts.data_pipeline.registry import (
    STATION_ID_PATTERN,
    OverrideError,
    Registry,
    load_registry,
    read_csv,
)

STATION_NUMBER_PATTERN = re.compile(r"^([A-Z]{2})(\d{2})$")
ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ENDPOINT_KINDS = ("terminus", "area-boundary")
MIN_LOOP_STOPS = 3
MIN_LINEAR_STOPS = 2

STOP_COLUMNS = ("order", "station_id", "station_number", "platform_selector")
LINE_MAPPING_COLUMNS = ("from_id", "to_id", "n02_line", "via")
SECTION_COLUMNS = ("n02_line", "action", "section_key", "reason")
OFFSET_COLUMNS = ("service_id", "station_id", "max_platform_offset_m", "reason")


@dataclass(frozen=True)
class DatasetOverride:
    operator: str  # published operator name
    n02_operator: str  # N02_004 value to filter on
    updated_at: str  # YYYY-MM-DD, copied to manifest.updatedAt
    area_name: str
    start_station_id: str
    target_service_id: str  # the service whose segments form the goal
    service_ids: tuple[str, ...]  # reviewed catalogue, in lottery order
    reviewed_disconnected_service_ids: tuple[str, ...]


@dataclass(frozen=True)
class DirectionLabels:
    forward: str  # label of the +1 stop order
    backward: str


@dataclass(frozen=True)
class Endpoints:
    first: str  # "terminus" | "area-boundary"
    last: str


@dataclass(frozen=True)
class LengthRef:
    km: float
    tolerance_km: float
    source: str


@dataclass(frozen=True)
class ServiceDefinition:
    id: str
    name: str
    color: str
    circular: bool
    direction_labels: DirectionLabels
    endpoints: Endpoints | None  # None iff circular
    expected_stop_count: int
    length_ref: LengthRef


@dataclass(frozen=True)
class Stop:
    order: int
    station_id: str
    station_number: str  # JR East number (JY29, JK38 ...), may be empty
    platform_selector: PlatformSelector


@dataclass(frozen=True)
class LineRange:
    from_id: str
    to_id: str
    n02_line: str
    via: tuple[LonLat, ...] = ()  # only for a range of exactly one stop pair


@dataclass(frozen=True)
class ServiceOverrides:
    definition: ServiceDefinition
    stops: tuple[Stop, ...]
    line_ranges: tuple[LineRange, ...]
    section_filters: Mapping[str, SectionFilter]  # N02 line -> filter

    @property
    def id(self) -> str:
        return self.definition.id

    @property
    def circular(self) -> bool:
        return self.definition.circular

    @property
    def station_ids(self) -> tuple[str, ...]:
        return tuple(stop.station_id for stop in self.stops)

    def segment_ranges(self) -> tuple[LineRange, ...]:
        """The line range that covers each adjacent stop pair, in +1 order."""
        return expand_ranges(self.station_ids, self.line_ranges, self.circular)

    def segment_lines(self) -> tuple[str, ...]:
        return tuple(item.n02_line for item in self.segment_ranges())

    def section_filter(self, n02_line: str) -> SectionFilter:
        return self.section_filters.get(n02_line, SectionFilter())


@dataclass(frozen=True)
class OffsetException:
    service_id: str
    station_id: str
    max_platform_offset_m: float
    reason: str


@dataclass(frozen=True)
class Overrides:
    dataset: DatasetOverride
    registry: Registry
    services: tuple[ServiceOverrides, ...]  # services.json order
    offset_exceptions: tuple[OffsetException, ...]

    def service(self, service_id: str) -> ServiceOverrides:
        for service in self.services:
            if service.id == service_id:
                return service
        raise KeyError(service_id)

    @property
    def target(self) -> ServiceOverrides:
        return self.service(self.dataset.target_service_id)


# --- generic helpers -------------------------------------------------------


def is_iso_date(value: object) -> TypeGuard[str]:
    """True for a strict ``YYYY-MM-DD`` string that is a real calendar date."""
    if not isinstance(value, str) or not ISO_DATE_PATTERN.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise OverrideError(f"override file not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise OverrideError(f"{path.name} is not valid JSON: {error}") from error


def _text(raw: Mapping[str, Any], key: str, where: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise OverrideError(f"{where}: '{key}' must be a non-empty string")
    return value


def _id_list(raw: Mapping[str, Any], key: str, where: str) -> tuple[str, ...]:
    value = raw.get(key)
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise OverrideError(f"{where}: '{key}' must be an array of strings")
    if len(set(value)) != len(value):
        raise OverrideError(f"{where}: '{key}' must not repeat ids")
    return tuple(value)


def _number(raw: Mapping[str, Any], key: str, where: str) -> float:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise OverrideError(f"{where}: '{key}' must be a number")
    if not math.isfinite(value) or value <= 0:
        raise OverrideError(f"{where}: '{key}' must be positive")
    return float(value)


# --- dataset.json / services.json -----------------------------------------


def parse_dataset(raw: Any) -> DatasetOverride:
    where = config.DATASET_OVERRIDE_FILE
    if not isinstance(raw, dict):
        raise OverrideError(f"{where} must be a JSON object")
    updated_at = raw.get("updatedAt")
    if not is_iso_date(updated_at):
        raise OverrideError(
            f"dataset 'updatedAt' must be a YYYY-MM-DD date, got {updated_at!r}"
        )
    return DatasetOverride(
        operator=_text(raw, "operator", where),
        n02_operator=_text(raw, "n02Operator", where),
        updated_at=updated_at,
        area_name=_text(raw, "areaName", where),
        start_station_id=_text(raw, "startStationId", where),
        target_service_id=_text(raw, "targetServiceId", where),
        service_ids=_id_list(raw, "serviceIds", where),
        reviewed_disconnected_service_ids=_id_list(
            raw, "reviewedDisconnectedServiceIds", where
        ),
    )


def _parse_labels(raw: Any, where: str) -> DirectionLabels:
    if not isinstance(raw, dict):
        raise OverrideError(f"{where}: 'directionLabels' must be an object")
    return DirectionLabels(
        forward=_text(raw, "forward", where), backward=_text(raw, "backward", where)
    )


def _parse_endpoints(raw: Any, circular: bool, where: str) -> Endpoints | None:
    if circular:
        if raw is not None:
            raise OverrideError(f"{where}: a circular service has no 'endpoints'")
        return None
    if not isinstance(raw, dict):
        raise OverrideError(f"{where}: a linear service needs 'endpoints'")
    endpoints = Endpoints(first=raw.get("first", ""), last=raw.get("last", ""))
    for kind in (endpoints.first, endpoints.last):
        if kind not in ENDPOINT_KINDS:
            raise OverrideError(
                f"{where}: endpoint kind must be one of {ENDPOINT_KINDS}"
            )
    return endpoints


def _parse_length_ref(raw: Any, where: str) -> LengthRef:
    if not isinstance(raw, dict):
        raise OverrideError(f"{where}: 'lengthRef' must be an object")
    return LengthRef(
        km=_number(raw, "km", where),
        tolerance_km=_number(raw, "toleranceKm", where),
        source=_text(raw, "source", where),
    )


def parse_service_definition(raw: Any) -> ServiceDefinition:
    if not isinstance(raw, dict):
        raise OverrideError("services.json entries must be objects")
    service_id = _text(raw, "id", "services.json")
    where = f"services.json {service_id}"
    if not STATION_ID_PATTERN.match(service_id):
        raise OverrideError(f"{where}: id is not kebab-case")
    circular = raw.get("circular")
    if not isinstance(circular, bool):
        raise OverrideError(f"{where}: 'circular' must be a boolean")
    count = raw.get("expectedStopCount")
    if isinstance(count, bool) or not isinstance(count, int):
        raise OverrideError(f"{where}: 'expectedStopCount' must be an integer")
    minimum = MIN_LOOP_STOPS if circular else MIN_LINEAR_STOPS
    if count < minimum:
        raise OverrideError(f"{where}: needs at least {minimum} stops")
    return ServiceDefinition(
        id=service_id,
        name=_text(raw, "name", where),
        color=_text(raw, "color", where),
        circular=circular,
        direction_labels=_parse_labels(raw.get("directionLabels"), where),
        endpoints=_parse_endpoints(raw.get("endpoints"), circular, where),
        expected_stop_count=count,
        length_ref=_parse_length_ref(raw.get("lengthRef"), where),
    )


# --- per-service tables ----------------------------------------------------


def parse_stops(rows: Sequence[Mapping[str, str]], service_id: str) -> tuple[Stop, ...]:
    stops: list[Stop] = []
    for index, row in enumerate(rows):
        try:
            order = int(row["order"])
            selector = parse_platform_selector(row["platform_selector"])
        except (ValueError, ConstraintError) as error:
            raise OverrideError(f"{service_id} stops row {index}: {error}") from error
        stops.append(
            Stop(
                order=order,
                station_id=row["station_id"],
                station_number=row["station_number"],
                platform_selector=selector,
            )
        )
    return tuple(stops)


def parse_line_ranges(
    rows: Sequence[Mapping[str, str]], service_id: str
) -> tuple[LineRange, ...]:
    ranges: list[LineRange] = []
    for index, row in enumerate(rows):
        try:
            via = parse_via(row["via"])
        except ConstraintError as error:
            raise OverrideError(
                f"{service_id} line mapping row {index}: {error}"
            ) from error
        if not row["n02_line"]:
            raise OverrideError(f"{service_id} line mapping row {index}: no n02_line")
        ranges.append(
            LineRange(
                from_id=row["from_id"],
                to_id=row["to_id"],
                n02_line=row["n02_line"],
                via=via,
            )
        )
    return tuple(ranges)


def parse_section_filters(
    rows: Sequence[Mapping[str, str]], service_id: str
) -> dict[str, SectionFilter]:
    by_line: dict[str, list[tuple[str, str]]] = {}
    for index, row in enumerate(rows):
        if not row["reason"]:
            raise OverrideError(f"{service_id} sections row {index}: reason required")
        by_line.setdefault(row["n02_line"], []).append(
            (row["action"], row["section_key"])
        )
    try:
        return {line: build_section_filter(rules) for line, rules in by_line.items()}
    except ConstraintError as error:
        raise OverrideError(f"{service_id} sections: {error}") from error


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
    check_station_numbers(stops, definition.circular, where)


def check_station_numbers(
    stops: Sequence[Stop], circular: bool, where: str = "service"
) -> None:
    """Evidence check: JR East station numbers step by exactly one along the
    stop order (one prefix, one direction; loops wrap once, JY01 -> JY30).

    Stop order is never inferred from numbers; this only catches swapped or
    missing rows. A service without numbers (every cell empty) is skipped.
    """
    numbers = [stop.station_number for stop in stops]
    if not any(numbers):
        return
    parsed: list[tuple[str, int]] = []
    for number in numbers:
        match = STATION_NUMBER_PATTERN.match(number)
        if match is None:
            raise OverrideError(f"{where}: invalid station number {number!r}")
        parsed.append((match.group(1), int(match.group(2))))
    if len({prefix for prefix, _ in parsed}) != 1:
        raise OverrideError(f"{where}: station numbers mix prefixes")
    values = [value for _, value in parsed]
    count = len(values)
    low = min(values)
    if circular and sorted(values) != list(range(low, low + count)):
        raise OverrideError(f"{where}: loop station numbers must be consecutive")
    step = values[1] - values[0]
    if step not in (1, -1):
        step = 0  # reported below at the first pair
    pairs = count if circular else count - 1
    for index in range(pairs):
        current = values[index]
        following = values[(index + 1) % count]
        expected = current + step
        if circular:
            expected = low + (current - low + step) % count
        if step == 0 or following != expected:
            raise OverrideError(
                f"{where}: station-number order broken after "
                f"{stops[index].station_id} ({numbers[index]} -> "
                f"{numbers[(index + 1) % count]})"
            )


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
        if line_range.via and span != 1:
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
    return tuple(item.n02_line for item in expand_ranges(station_ids, ranges, circular))


def load_service(services_dir: Path, definition: ServiceDefinition) -> ServiceOverrides:
    directory = services_dir / definition.id
    stops = parse_stops(
        read_csv(directory / config.STOPS_OVERRIDE_FILE, STOP_COLUMNS), definition.id
    )
    check_stops(definition, stops)
    line_ranges = parse_line_ranges(
        read_csv(directory / config.LINE_MAPPING_OVERRIDE_FILE, LINE_MAPPING_COLUMNS),
        definition.id,
    )
    sections_path = directory / config.SECTION_CONSTRAINTS_OVERRIDE_FILE
    section_filters = (
        parse_section_filters(read_csv(sections_path, SECTION_COLUMNS), definition.id)
        if sections_path.is_file()
        else {}
    )
    service = ServiceOverrides(
        definition=definition,
        stops=stops,
        line_ranges=line_ranges,
        section_filters=section_filters,
    )
    mapped_lines = set(service.segment_lines())  # fails fast on a bad mapping
    unused = sorted(set(section_filters) - mapped_lines)
    if unused:
        raise OverrideError(
            f"{definition.id} sections.csv names unmapped lines {unused}"
        )
    return service


def parse_offset_exceptions(
    rows: Sequence[Mapping[str, str]],
) -> tuple[OffsetException, ...]:
    exceptions: list[OffsetException] = []
    for index, row in enumerate(rows):
        try:
            limit = float(row["max_platform_offset_m"])
        except ValueError as error:
            raise OverrideError(f"offset exception row {index}: {error}") from error
        if not math.isfinite(limit) or limit <= 0 or not row["reason"]:
            raise OverrideError(
                f"offset exception row {index} needs a positive limit and a reason"
            )
        exceptions.append(
            OffsetException(
                service_id=row["service_id"],
                station_id=row["station_id"],
                max_platform_offset_m=limit,
                reason=row["reason"],
            )
        )
    return tuple(exceptions)


# --- cross-table checks ----------------------------------------------------


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
    for service in services:
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
    check_offset_exception_references(overrides)


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


def load_overrides(overrides_dir: Path) -> Overrides:
    dataset = parse_dataset(_read_json(overrides_dir / config.DATASET_OVERRIDE_FILE))
    registry = load_registry(overrides_dir / config.REGISTRY_OVERRIDE_FILE)
    raw_services = _read_json(overrides_dir / config.SERVICES_OVERRIDE_FILE)
    if not isinstance(raw_services, list) or not raw_services:
        raise OverrideError("services.json must be a non-empty JSON array")
    definitions = [parse_service_definition(raw) for raw in raw_services]
    services_dir = overrides_dir / config.SERVICES_OVERRIDE_DIR
    overrides = Overrides(
        dataset=dataset,
        registry=registry,
        services=tuple(load_service(services_dir, item) for item in definitions),
        offset_exceptions=parse_offset_exceptions(
            read_csv(
                overrides_dir / config.OFFSET_EXCEPTIONS_OVERRIDE_FILE, OFFSET_COLUMNS
            )
        ),
    )
    check_consistency(overrides)
    return overrides
