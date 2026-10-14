"""Reviewed override models."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from scripts.data_pipeline import config
from scripts.data_pipeline.composition import ComposeRecipe
from scripts.data_pipeline.constraints import (
    BBox,
    DetourException,
    LonLat,
    OffsetException,
    PlatformSelector,
    PlatformTransfer,
    RouteRecipe,
    SectionFilter,
)
from scripts.data_pipeline.registry import (
    Area,
    Registry,
    ScopeStop,
)


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
    expected_catalogue_file: str = ""
    expected_catalogue_sha256: str = ""
    budget_profile: str = "23ku"
    budgets: Mapping[str, int] = field(default_factory=dict)
    simplify_tolerance_m: float = config.SIMPLIFY_TOLERANCE_M


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
    compose: ComposeRecipe | None = None

    @property
    def route_lines(self) -> tuple[str, ...]:
        return (
            self.route.lines
            if self.route
            else (() if self.compose else (self.n02_line,))
        )


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
        from scripts.data_pipeline.override_checks import expand_ranges

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
    platform_transfers: tuple[PlatformTransfer, ...] = ()

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

    def transfer_limit(self, service_id: str, station_id: str) -> float | None:
        """Reviewed platform transfer limit at one stop of a service, if any."""
        for transfer in self.platform_transfers:
            if (transfer.service_id, transfer.station_id) == (service_id, station_id):
                return transfer.max_transfer_m
        return None
