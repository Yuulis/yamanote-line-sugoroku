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
    STATION_NUMBER_PATTERN,
    BBox,
    ConstraintError,
    DetourException,
    LonLat,
    OffsetException,
    PlatformSelector,
    RouteRecipe,
    SectionFilter,
    build_section_filter,
    check_station_number_order,
    parse_bbox,
    parse_detour_rows,
    parse_offset_rows,
    parse_platform_selector,
    parse_route_recipe,
    parse_via,
)
from scripts.data_pipeline.registry import (
    STATION_ID_PATTERN,
    Area,
    OverrideError,
    Registry,
    ScopeStop,
    check_scope,
    load_registry,
    parse_scope,
    read_csv,
)

ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ENDPOINT_KINDS = ("terminus", "area-boundary", "service-boundary")
SERVICE_KINDS = ("local", "rapid")
MIN_LOOP_STOPS = 3
MIN_LINEAR_STOPS = 2

STOP_COLUMNS = ("order", "station_id", "station_number", "platform_selector")
LINE_MAPPING_COLUMNS = ("from_id", "to_id", "n02_line", "via")
SECTION_COLUMNS = ("n02_line", "action", "section_key", "reason")
OFFSET_COLUMNS = ("service_id", "station_id", "max_platform_offset_m", "reason")
SCOPE_COLUMNS = ("station_id", "prefecture", "municipality")
DETOUR_COLUMNS = ("service_id", "from_id", "to_id", "max_detour_ratio", "reason")


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
    area: Area = Area()
    output_bbox: BBox = config.DEFAULT_OUTPUT_BBOX
    candidate_search_bbox: BBox = config.DEFAULT_CANDIDATE_SEARCH_BBOX


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
class LineMetadata:
    id: str
    name: str
    color: str


@dataclass(frozen=True)
class ServiceDefinition:
    id: str
    kind: str
    line_ids: tuple[str, ...]
    name: str
    color: str
    circular: bool
    direction_labels: DirectionLabels
    endpoints: Endpoints | None  # None iff circular
    expected_stop_count: int
    length_ref: LengthRef
    station_number_sequence: tuple[str, ...] | None = None
    scope_source: str = ""


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
    route: RouteRecipe | None = None

    @property
    def route_lines(self) -> tuple[str, ...]:
        return self.route.lines if self.route else (self.n02_line,)


@dataclass(frozen=True)
class ServiceOverrides:
    definition: ServiceDefinition
    stops: tuple[Stop, ...]
    line_ranges: tuple[LineRange, ...]
    section_filters: Mapping[str, SectionFilter]  # N02 line -> filter
    scope_stops: tuple[ScopeStop, ...] = ()

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
        return tuple(" -> ".join(item.route_lines) for item in self.segment_ranges())

    def section_filter(self, n02_line: str) -> SectionFilter:
        return self.section_filters.get(n02_line, SectionFilter())


@dataclass(frozen=True)
class Overrides:
    dataset: DatasetOverride
    registry: Registry
    services: tuple[ServiceOverrides, ...]  # services.json order
    offset_exceptions: tuple[OffsetException, ...]
    lines: tuple[LineMetadata, ...]
    detour_exceptions: tuple[DetourException, ...] = ()

    def service(self, service_id: str) -> ServiceOverrides:
        for service in self.services:
            if service.id == service_id:
                return service
        raise KeyError(service_id)

    @property
    def target(self) -> ServiceOverrides:
        return self.service(self.dataset.target_service_id)

    def detour_limit(self, service_id: str, from_id: str, to_id: str) -> float:
        for exception in self.detour_exceptions:
            if (exception.service_id, exception.from_id, exception.to_id) == (
                service_id,
                from_id,
                to_id,
            ):
                return exception.max_detour_ratio
        return config.MAX_DETOUR_RATIO


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
    if not isinstance(value, str) or not value.strip():
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
    prefectures = (
        _id_list(raw, "areaPrefectures", where)
        if "areaPrefectures" in raw
        else config.CAPITAL_REGION_PREFECTURES
    )
    if not prefectures or not set(prefectures) <= set(
        config.CAPITAL_REGION_PREFECTURES
    ):
        raise OverrideError(
            "dataset areaPrefectures must select capital-region prefectures"
        )
    municipalities = (
        _id_list(raw, "areaMunicipalities", where)
        if "areaMunicipalities" in raw
        else ()
    )
    try:
        output_bbox = parse_bbox(
            raw.get("outputBbox", list(config.DEFAULT_OUTPUT_BBOX)), "outputBbox"
        )
        search_bbox = parse_bbox(
            raw.get("candidateSearchBbox", list(config.DEFAULT_CANDIDATE_SEARCH_BBOX)),
            "candidateSearchBbox",
        )
    except ConstraintError as error:
        raise OverrideError(str(error)) from error
    if (
        search_bbox[0] > output_bbox[0]
        or search_bbox[1] > output_bbox[1]
        or search_bbox[2] < output_bbox[2]
        or search_bbox[3] < output_bbox[3]
    ):
        raise OverrideError("candidateSearchBbox must enclose outputBbox")
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
        area=Area(prefectures, municipalities),
        output_bbox=output_bbox,
        candidate_search_bbox=search_bbox,
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


def parse_line_metadata(raw: Any) -> LineMetadata:
    if not isinstance(raw, dict) or set(raw) != {"id", "name", "color"}:
        raise OverrideError("line metadata must contain id, name and color")
    identifier = _text(raw, "id", "line metadata")
    if not STATION_ID_PATTERN.match(identifier):
        raise OverrideError("line id is not kebab-case")
    return LineMetadata(
        identifier, _text(raw, "name", identifier), _text(raw, "color", identifier)
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
    kind = _text(raw, "kind", where)
    if kind not in SERVICE_KINDS:
        raise OverrideError(f"{where}: kind must be one of {SERVICE_KINDS}")
    line_ids = _id_list(raw, "lineIds", where)
    if not line_ids:
        raise OverrideError(f"{where}: lineIds must not be empty")
    number_rules = raw.get("stationNumberRules")
    number_sequence = None
    if number_rules is not None:
        if not isinstance(number_rules, dict) or set(number_rules) != {
            "sequence",
            "reason",
        }:
            raise OverrideError(
                f"{where}: stationNumberRules needs sequence and reason"
            )
        _text(number_rules, "reason", where)
        sequence = number_rules["sequence"]
        if (
            not isinstance(sequence, list)
            or len(sequence) != count
            or not all(
                isinstance(v, str) and (not v or STATION_NUMBER_PATTERN.fullmatch(v))
                for v in sequence
            )
        ):
            raise OverrideError(f"{where}: invalid station-number evidence sequence")
        number_sequence = tuple(sequence)
    return ServiceDefinition(
        id=service_id,
        kind=kind,
        line_ids=line_ids,
        name=_text(raw, "name", where),
        color=_text(raw, "color", where),
        circular=circular,
        direction_labels=_parse_labels(raw.get("directionLabels"), where),
        endpoints=_parse_endpoints(raw.get("endpoints"), circular, where),
        expected_stop_count=count,
        length_ref=_parse_length_ref(raw.get("lengthRef"), where),
        station_number_sequence=number_sequence,
        scope_source=_text(raw, "scopeSource", where),
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
    rows: Sequence[Mapping[str, str]],
    service_id: str,
    bbox: BBox = config.DEFAULT_CANDIDATE_SEARCH_BBOX,
) -> tuple[LineRange, ...]:
    ranges: list[LineRange] = []
    for index, row in enumerate(rows):
        try:
            via = parse_via(row["via"], bbox)
        except ConstraintError as error:
            raise OverrideError(
                f"{service_id} line mapping row {index}: {error}"
            ) from error
        try:
            route = parse_route_recipe(row.get("route", ""), bbox)
        except ConstraintError as error:
            raise OverrideError(f"{service_id} route row {index}: {error}") from error
        if route and (row["n02_line"] or via):
            raise OverrideError(
                f"{service_id}: route cannot also specify n02_line or via"
            )
        if not route and not row["n02_line"]:
            raise OverrideError(f"{service_id} line mapping row {index}: no n02_line")
        ranges.append(
            LineRange(
                from_id=row["from_id"],
                to_id=row["to_id"],
                n02_line=row["n02_line"],
                via=via,
                route=route,
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
        if (line_range.via or line_range.route) and span != 1:
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


def load_service(
    services_dir: Path,
    definition: ServiceDefinition,
    bbox: BBox = config.DEFAULT_CANDIDATE_SEARCH_BBOX,
) -> ServiceOverrides:
    directory = services_dir / definition.id
    stops = parse_stops(
        read_csv(directory / config.STOPS_OVERRIDE_FILE, STOP_COLUMNS), definition.id
    )
    check_stops(definition, stops)
    line_ranges = parse_line_ranges(
        read_csv(directory / config.LINE_MAPPING_OVERRIDE_FILE, LINE_MAPPING_COLUMNS),
        definition.id,
        bbox,
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
        scope_stops=parse_scope(
            read_csv(directory / config.SCOPE_OVERRIDE_FILE, SCOPE_COLUMNS)
        ),
    )
    mapped_lines = {
        line for item in service.segment_ranges() for line in item.route_lines
    }
    unused = sorted(set(section_filters) - mapped_lines)
    if unused:
        raise OverrideError(
            f"{definition.id} sections.csv names unmapped lines {unused}"
        )
    return service


def parse_offset_exceptions(
    rows: Sequence[Mapping[str, str]],
) -> tuple[OffsetException, ...]:
    try:
        return parse_offset_rows(rows)
    except ConstraintError as error:
        raise OverrideError(str(error)) from error


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


def load_overrides(overrides_dir: Path) -> Overrides:
    dataset = parse_dataset(_read_json(overrides_dir / config.DATASET_OVERRIDE_FILE))
    registry = load_registry(overrides_dir / config.REGISTRY_OVERRIDE_FILE)
    envelope = _read_json(overrides_dir / config.SERVICES_OVERRIDE_FILE)
    if not isinstance(envelope, dict) or set(envelope) != {"lines", "services"}:
        raise OverrideError("services.json must be a v3 {lines, services} object")
    raw_lines = envelope["lines"]
    if not isinstance(raw_lines, list) or not raw_lines:
        raise OverrideError("services.json lines must be a non-empty array")
    lines = tuple(parse_line_metadata(raw) for raw in raw_lines)
    if len({line.id for line in lines}) != len(lines):
        raise OverrideError("services.json has duplicate line ids")
    raw_services = envelope["services"]
    if not isinstance(raw_services, list) or not raw_services:
        raise OverrideError("services.json must be a non-empty JSON array")
    definitions = [parse_service_definition(raw) for raw in raw_services]
    services_dir = overrides_dir / config.SERVICES_OVERRIDE_DIR
    overrides = Overrides(
        dataset=dataset,
        registry=registry,
        lines=lines,
        services=tuple(
            load_service(services_dir, item, dataset.candidate_search_bbox)
            for item in definitions
        ),
        offset_exceptions=parse_offset_exceptions(
            read_csv(
                overrides_dir / config.OFFSET_EXCEPTIONS_OVERRIDE_FILE, OFFSET_COLUMNS
            )
        ),
        detour_exceptions=load_detour_exceptions(overrides_dir),
    )
    check_consistency(overrides)
    return overrides


def load_detour_exceptions(directory: Path) -> tuple[DetourException, ...]:
    path = directory / config.DETOUR_EXCEPTIONS_OVERRIDE_FILE
    if not path.is_file():
        return ()
    try:
        return parse_detour_rows(read_csv(path, DETOUR_COLUMNS))
    except ConstraintError as error:
        raise OverrideError(str(error)) from error
