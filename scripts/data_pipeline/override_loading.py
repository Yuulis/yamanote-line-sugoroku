"""Reviewed override loading."""

from __future__ import annotations

import csv
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from scripts.data_pipeline import config
from scripts.data_pipeline.catalogue import check_expected_catalogue
from scripts.data_pipeline.constraints import (
    BBox,
    ConstraintError,
    DetourException,
    PlatformTransfer,
    parse_detour_rows,
    parse_junction_rows,
    parse_platform_transfer_rows,
)
from scripts.data_pipeline.override_checks import check_consistency, check_stops
from scripts.data_pipeline.override_models import (
    Overrides,
    ServiceDefinition,
    ServiceOverrides,
)
from scripts.data_pipeline.override_parsing import (
    DETOUR_COLUMNS,
    JUNCTION_COLUMNS,
    JUNCTIONS_OVERRIDE_FILE,
    LINE_MAPPING_COLUMNS,
    OFFSET_COLUMNS,
    SCOPE_COLUMNS,
    SECTION_COLUMNS,
    STOP_COLUMNS,
    TRANSFER_COLUMNS,
    parse_dataset,
    parse_line_metadata,
    parse_line_ranges,
    parse_offset_exceptions,
    parse_scoped_section_filters,
    parse_service_definition,
    parse_stops,
)
from scripts.data_pipeline.product_suburban_presentation import (
    load_ui_presentation,
)
from scripts.data_pipeline.registry import (
    OverrideError,
    load_registry,
    parse_scope,
    read_csv,
)


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise OverrideError(f"override file not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise OverrideError(f"{path.name} is not valid JSON: {error}") from error


def load_service(
    services_dir: Path,
    definition: ServiceDefinition,
    dataset: Any,
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
    section_filters, scoped_section_filters = {}, ()
    if sections_path.is_file():
        with sections_path.open(encoding="utf-8", newline="") as handle:
            header = csv.DictReader(handle).fieldnames or []
        if ("from_id" in header) != ("to_id" in header):
            raise OverrideError(
                f"{definition.id} sections.csv needs both from_id and to_id columns"
            )
        section_filters, scoped_section_filters = parse_scoped_section_filters(
            read_csv(sections_path, SECTION_COLUMNS),
            definition.id,
            definition.n02_operator or dataset.n02_operator,
        )
    junctions_path = directory / JUNCTIONS_OVERRIDE_FILE
    junction_rules = ()
    if junctions_path.is_file():
        try:
            junction_rules = parse_junction_rows(
                read_csv(junctions_path, JUNCTION_COLUMNS)
            )
        except ConstraintError as error:
            raise OverrideError(f"{definition.id}: {error}") from error
        expected_operator = definition.n02_operator or dataset.n02_operator
        if any(rule.n02_operator != expected_operator for rule in junction_rules):
            raise OverrideError(
                f"{definition.id}: junction rules must use the service N02 operator"
            )
    service = ServiceOverrides(
        definition=definition,
        stops=stops,
        line_ranges=line_ranges,
        section_filters=section_filters,
        scoped_section_filters=scoped_section_filters,
        scope_stops=parse_scope(
            read_csv(directory / config.SCOPE_OVERRIDE_FILE, SCOPE_COLUMNS)
        ),
        junction_rules=junction_rules,
    )
    mapped_keys = {
        (operator, line)
        for item in service.segment_ranges()
        for line, operator in zip(
            item.route_lines, service.range_operators(item, dataset), strict=True
        )
    }
    unused_junctions = [
        (rule.n02_operator, rule.n02_line)
        for rule in junction_rules
        if (rule.n02_operator, rule.n02_line) not in mapped_keys
    ]
    if unused_junctions:
        raise OverrideError(
            f"{definition.id}: junction rules name unmapped lines {unused_junctions}"
        )
    unused = sorted(set(section_filters) - mapped_keys)
    if unused:
        raise OverrideError(
            f"{definition.id} sections.csv names unmapped lines {unused}"
        )
    if scoped_section_filters:
        if service.circular:
            raise OverrideError(
                f"{definition.id} scoped section filters require a linear service"
            )
        indexes = {
            station_id: index for index, station_id in enumerate(service.station_ids)
        }
        for rule in scoped_section_filters:
            if rule.from_id not in indexes or rule.to_id not in indexes:
                raise OverrideError(
                    f"{definition.id} scoped section range names an unknown station"
                )
            first, last = indexes[rule.from_id], indexes[rule.to_id]
            if first >= last:
                raise OverrideError(
                    f"{definition.id} scoped section range must follow forward stop order"
                )
            applicable = False
            for pair_index in range(first, last):
                item = service.segment_ranges()[pair_index]
                operators = service.range_operators(item, dataset)
                if any(
                    line == rule.n02_line and operator == rule.n02_operator
                    for line, operator in zip(item.route_lines, operators, strict=True)
                ):
                    applicable = True
            if not applicable:
                raise OverrideError(
                    f"{definition.id} scoped section range has no matching direct route"
                )
        for pair_index, item in enumerate(service.segment_ranges()):
            operators = service.range_operators(item, dataset)
            from_id, to_id = service.station_ids[pair_index : pair_index + 2]
            for line, operator in zip(item.route_lines, operators, strict=True):
                service.section_filter_for_pair(line, operator, from_id, to_id)
    return service


def load_overrides(overrides_dir: Path) -> Overrides:
    dataset = parse_dataset(_read_json(overrides_dir / config.DATASET_OVERRIDE_FILE))
    if (
        dataset.validation_profile == "stage"
        and overrides_dir.resolve() == config.DEFAULT_OVERRIDES_DIR.resolve()
    ):
        raise OverrideError("stage profile is forbidden for live data/overrides")
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
    loaded_services = tuple(
        load_service(services_dir, item, dataset, dataset.candidate_search_bbox)
        for item in definitions
    )
    if dataset.ui_presentation_file is not None:
        presentation_services = [
            {
                "id": service.id,
                "operator": service.effective_operator(dataset),
                "lineIds": list(service.definition.line_ids),
                "stationIds": list(service.station_ids),
            }
            for service in loaded_services
        ]
        presentation_lines = [
            {"id": line.id, "name": line.name, "color": line.color} for line in lines
        ]
        presentation_stations = [
            {"id": station.id, "name": station.name} for station in registry.stations
        ]
        try:
            presentation = load_ui_presentation(
                overrides_dir,
                dataset.ui_presentation_file,
                dataset.ui_presentation_sha256 or "",
                lines=presentation_lines,
                services=presentation_services,
                stations=presentation_stations,
            )
        except ValueError as error:
            raise OverrideError(str(error)) from error
        dataset = replace(dataset, ui_presentation=presentation)
    overrides = Overrides(
        dataset=dataset,
        registry=registry,
        lines=lines,
        services=loaded_services,
        offset_exceptions=parse_offset_exceptions(
            read_csv(
                overrides_dir / config.OFFSET_EXCEPTIONS_OVERRIDE_FILE, OFFSET_COLUMNS
            )
        ),
        detour_exceptions=load_detour_exceptions(overrides_dir),
        platform_transfers=load_platform_transfers(overrides_dir),
    )
    check_consistency(overrides)
    check_expected_catalogue(overrides, overrides_dir)
    return overrides


def load_detour_exceptions(directory: Path) -> tuple[DetourException, ...]:
    path = directory / config.DETOUR_EXCEPTIONS_OVERRIDE_FILE
    if not path.is_file():
        return ()
    try:
        return parse_detour_rows(read_csv(path, DETOUR_COLUMNS))
    except ConstraintError as error:
        raise OverrideError(str(error)) from error


def load_platform_transfers(directory: Path) -> tuple[PlatformTransfer, ...]:
    path = directory / config.PLATFORM_TRANSFERS_OVERRIDE_FILE
    if not path.is_file():
        return ()
    try:
        return parse_platform_transfer_rows(read_csv(path, TRANSFER_COLUMNS))
    except ConstraintError as error:
        raise OverrideError(str(error)) from error
