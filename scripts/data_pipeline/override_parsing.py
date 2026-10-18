"""Reviewed override parsing."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Any, TypeGuard

from scripts.data_pipeline import config
from scripts.data_pipeline.budgets import parse_budgets
from scripts.data_pipeline.composition import parse_compose
from scripts.data_pipeline.constraints import (
    STATION_NUMBER_EVIDENCE_PATTERN,
    BBox,
    ConstraintError,
    OffsetException,
    ScopedSectionFilter,
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
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ENDPOINT_KINDS = ("terminus", "area-boundary", "service-boundary")
SERVICE_KINDS = ("local", "rapid")
MIN_LOOP_STOPS = 3
MIN_LINEAR_STOPS = 2

STOP_COLUMNS = ("order", "station_id", "station_number", "platform_selector")
LINE_MAPPING_COLUMNS = ("from_id", "to_id", "n02_line", "via")
SECTION_COLUMNS = ("n02_line", "action", "section_key", "reason")
OFFSET_COLUMNS = ("service_id", "station_id", "max_platform_offset_m", "reason")
SCOPE_COLUMNS = ("station_id", "prefecture", "municipality")
JUNCTIONS_OVERRIDE_FILE = "junctions.csv"
JUNCTION_COLUMNS = (
    "n02_operator",
    "n02_line",
    "section_key",
    "peer_section_key",
    "lon",
    "lat",
    "reason",
)
DETOUR_COLUMNS = ("service_id", "from_id", "to_id", "max_detour_ratio", "reason")
TRANSFER_COLUMNS = ("service_id", "station_id", "max_transfer_m", "reason")


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
        config.ALLOWED_RAILWAY_PREFECTURES
    ):
        raise OverrideError(
            "dataset areaPrefectures must select supported railway prefectures"
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
    ui_presentation_file = raw.get("uiPresentationFile")
    ui_presentation_sha256 = raw.get("uiPresentationSha256")
    if (ui_presentation_file is None) != (ui_presentation_sha256 is None):
        raise OverrideError(
            "uiPresentationFile and uiPresentationSha256 must be set together"
        )
    if ui_presentation_file is not None:
        if (
            not isinstance(ui_presentation_file, str)
            or not ui_presentation_file.strip()
            or Path(ui_presentation_file).is_absolute()
            or ".." in Path(ui_presentation_file).parts
        ):
            raise OverrideError("uiPresentationFile must be a safe relative path")
        if not isinstance(ui_presentation_sha256, str) or not SHA256_PATTERN.fullmatch(
            ui_presentation_sha256
        ):
            raise OverrideError(
                "uiPresentationSha256 must be a lowercase SHA-256 digest"
            )
    validation_profile = raw.get("validationProfile", "gameplay")
    if validation_profile not in ("gameplay", "stage"):
        raise OverrideError("validationProfile must be 'gameplay' or 'stage'")
    stage_start = ""
    start = ""
    target = ""
    if validation_profile == "stage":
        if "startStationId" in raw or "targetServiceId" in raw:
            raise OverrideError("stage profile must omit gameplay start/target fields")
        stage_start = _text(raw, "stageStartStationId", where)
    else:
        if "stageStartStationId" in raw:
            raise OverrideError(
                "stageStartStationId requires validationProfile 'stage'"
            )
        start = _text(raw, "startStationId", where)
        target = _text(raw, "targetServiceId", where)
    return DatasetOverride(
        operator=_text(raw, "operator", where),
        n02_operator=_text(raw, "n02Operator", where),
        updated_at=updated_at,
        area_name=_text(raw, "areaName", where),
        start_station_id=start,
        target_service_id=target,
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
        validation_profile=validation_profile,
        stage_start_station_id=stage_start,
        ui_presentation_file=ui_presentation_file,
        ui_presentation_sha256=ui_presentation_sha256,
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
                isinstance(v, str)
                and (not v or STATION_NUMBER_EVIDENCE_PATTERN.fullmatch(v))
                for v in sequence
            )
        ):
            raise OverrideError(f"{where}: invalid station-number evidence sequence")
        number_sequence = tuple(sequence)
    operator = _optional_json_text(raw, "operator", where)
    n02_operator = _optional_json_text(raw, "n02Operator", where)
    area_prefectures = None
    if "areaPrefectures" in raw:
        values = _id_list(raw, "areaPrefectures", where)
        if not values or not set(values) <= set(config.ALLOWED_RAILWAY_PREFECTURES):
            raise OverrideError(
                f"{where}: areaPrefectures must be a non-empty supported subset"
            )
        area_prefectures = values
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
        operator=operator,
        n02_operator=n02_operator,
        area_prefectures=area_prefectures,
    )


def _optional_json_text(raw: Mapping[str, Any], key: str, where: str) -> str | None:
    if key not in raw:
        return None
    value = raw[key]
    if not isinstance(value, str) or not value.strip():
        raise OverrideError(
            f"{where}: '{key}' must be a non-empty string when specified"
        )
    return value


def parse_stops(rows: Sequence[Mapping[str, str]], service_id: str) -> tuple[Stop, ...]:
    stops: list[Stop] = []
    for index, row in enumerate(rows):
        try:
            order = int(row["order"])
            selector = parse_platform_selector(row["platform_selector"])
        except (ValueError, ConstraintError) as error:
            raise OverrideError(f"{service_id} stops row {index}: {error}") from error
        original_name = row.get("original_name", "")
        n02_name = row.get("n02_name", "")
        n02_operator = row.get("n02_operator", "")
        source_reason = row.get("source_reason", "")
        for key, value in (
            ("original_name", original_name),
            ("n02_name", n02_name),
            ("n02_operator", n02_operator),
        ):
            if value and not value.strip():
                raise OverrideError(
                    f"{service_id} stops row {index}: {key} must not be blank"
                )
        if n02_operator and not source_reason:
            raise OverrideError(
                f"{service_id} stops row {index}: source_reason required for n02_operator"
            )
        if source_reason and not n02_operator:
            raise OverrideError(
                f"{service_id} stops row {index}: source_reason requires n02_operator"
            )
        stops.append(
            Stop(
                order=order,
                station_id=row["station_id"],
                station_number=row["station_number"],
                platform_selector=selector,
                original_name=original_name,
                n02_name=n02_name,
                n02_operator=n02_operator,
                source_reason=source_reason,
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
        n02_operator = row.get("n02_operator", "")
        source_reason = row.get("source_reason", "")
        if n02_operator and not source_reason:
            raise OverrideError(
                f"{service_id} line mapping row {index}: source_reason required for n02_operator"
            )
        if source_reason and not n02_operator:
            raise OverrideError(
                f"{service_id} line mapping row {index}: source_reason requires n02_operator"
            )
        if route and n02_operator:
            raise OverrideError(
                f"{service_id} line mapping row {index}: route.operators cannot be combined with row-level n02_operator"
            )
        if compose and (route or row["n02_line"] or via or n02_operator):
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
                n02_operator=n02_operator,
                source_reason=source_reason,
            )
        )
    return tuple(ranges)


def parse_section_filters(
    rows: Sequence[Mapping[str, str]], service_id: str, default_operator: str = ""
) -> dict[tuple[str, str], SectionFilter]:
    by_line: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for index, row in enumerate(rows):
        if not row["reason"]:
            raise OverrideError(f"{service_id} sections row {index}: reason required")
        operator = row.get("n02_operator", "") or default_operator
        if row.get("source_reason"):
            raise OverrideError(
                f"{service_id} sections row {index}: source_reason is unsupported; use reason"
            )
        by_line.setdefault((operator, row["n02_line"]), []).append(
            (row["action"], row["section_key"])
        )
    try:
        return {key: build_section_filter(rules) for key, rules in by_line.items()}
    except ConstraintError as error:
        raise OverrideError(f"{service_id} sections: {error}") from error


def parse_scoped_section_filters(
    rows: Sequence[Mapping[str, str]], service_id: str, default_operator: str = ""
) -> tuple[dict[tuple[str, str], SectionFilter], tuple[ScopedSectionFilter, ...]]:
    """Parse legacy service-wide and optional stop-range section rules."""
    has_from = any("from_id" in row for row in rows)
    has_to = any("to_id" in row for row in rows)
    if has_from != has_to:
        raise OverrideError(
            f"{service_id} sections.csv needs both from_id and to_id columns"
        )
    global_rows: dict[tuple[str, str], list[tuple[str, str]]] = {}
    scoped: list[ScopedSectionFilter] = []
    seen_scoped: set[tuple[str, str, str, str, str]] = set()
    for index, row in enumerate(rows):
        if not row.get("reason", ""):
            raise OverrideError(f"{service_id} sections row {index}: reason required")
        if row.get("source_reason"):
            raise OverrideError(
                f"{service_id} sections row {index}: source_reason is unsupported; use reason"
            )
        operator = row.get("n02_operator", "") or default_operator
        line = row.get("n02_line", "")
        action = row.get("action", "")
        key = row.get("section_key", "")
        if not line or not key:
            raise OverrideError(
                f"{service_id} sections row {index}: line and key required"
            )
        from_id = row.get("from_id", "")
        to_id = row.get("to_id", "")
        if not from_id and not to_id:
            global_rows.setdefault((operator, line), []).append((action, key))
            continue
        if not from_id or not to_id:
            raise OverrideError(
                f"{service_id} sections row {index}: from_id and to_id must both be set"
            )
        if action not in {"allow", "deny"}:
            raise OverrideError(
                f"{service_id} sections row {index}: action must be allow or deny"
            )
        identity = (operator, line, from_id, to_id, key)
        if identity in seen_scoped:
            raise OverrideError(
                f"{service_id} sections row {index}: duplicate scoped key"
            )
        seen_scoped.add(identity)
        scoped.append(ScopedSectionFilter(operator, line, from_id, to_id, action, key))
    try:
        filters = {
            identity: build_section_filter(rules)
            for identity, rules in global_rows.items()
        }
    except ConstraintError as error:
        raise OverrideError(f"{service_id} sections: {error}") from error
    return filters, tuple(scoped)


def parse_offset_exceptions(
    rows: Sequence[Mapping[str, str]],
) -> tuple[OffsetException, ...]:
    try:
        return parse_offset_rows(rows)
    except ConstraintError as error:
        raise OverrideError(str(error)) from error
