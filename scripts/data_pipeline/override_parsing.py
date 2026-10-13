"""Reviewed override parsing."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any, TypeGuard

from scripts.data_pipeline import config
from scripts.data_pipeline.budgets import parse_budgets
from scripts.data_pipeline.composition import parse_compose
from scripts.data_pipeline.constraints import (
    STATION_NUMBER_PATTERN,
    BBox,
    ConstraintError,
    OffsetException,
    SectionFilter,
    build_section_filter,
    parse_bbox,
    parse_offset_rows,
    parse_platform_selector,
    parse_route_recipe,
    parse_via,
)
from scripts.data_pipeline.override_models import (
    DatasetOverride,
    DirectionLabels,
    Endpoints,
    LengthRef,
    LineMetadata,
    LineRange,
    ServiceDefinition,
    Stop,
)
from scripts.data_pipeline.registry import (
    STATION_ID_PATTERN,
    Area,
    OverrideError,
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


def is_iso_date(value: object) -> TypeGuard[str]:
    """True for a strict ``YYYY-MM-DD`` string that is a real calendar date."""
    if not isinstance(value, str) or not ISO_DATE_PATTERN.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


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
    profile, budgets = parse_budgets(raw)
    simplify = raw.get("simplifyToleranceM", config.SIMPLIFY_TOLERANCE_M)
    if (
        isinstance(simplify, bool)
        or not isinstance(simplify, int | float)
        or not math.isfinite(simplify)
        or simplify <= 0
    ):
        raise OverrideError("simplifyToleranceM must be finite and positive")
    for key in ("expectedCatalogFile", "expectedCatalogSha256"):
        if key in raw and (not isinstance(raw[key], str) or not raw[key]):
            raise OverrideError(f"{key} must be a non-empty string")
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
        expected_catalogue_file=raw.get("expectedCatalogFile", ""),
        expected_catalogue_sha256=raw.get("expectedCatalogSha256", ""),
        budget_profile=profile,
        budgets=budgets,
        simplify_tolerance_m=float(simplify),
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
        compose = parse_compose(row.get("compose", ""))
        if compose and (route or row["n02_line"] or via):
            raise OverrideError("compose cannot also specify route, n02_line or via")
        if route and (row["n02_line"] or via):
            raise OverrideError(
                f"{service_id}: route cannot also specify n02_line or via"
            )
        if not route and not compose and not row["n02_line"]:
            raise OverrideError(f"{service_id} line mapping row {index}: no n02_line")
        ranges.append(
            LineRange(
                from_id=row["from_id"],
                to_id=row["to_id"],
                n02_line=row["n02_line"],
                via=via,
                route=route,
                compose=compose,
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


def parse_offset_exceptions(
    rows: Sequence[Mapping[str, str]],
) -> tuple[OffsetException, ...]:
    try:
        return parse_offset_rows(rows)
    except ConstraintError as error:
        raise OverrideError(str(error)) from error
