"""Reviewed override loading."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scripts.data_pipeline import config
from scripts.data_pipeline.catalogue import check_expected_catalogue
from scripts.data_pipeline.constraints import (
    BBox,
    ConstraintError,
    DetourException,
    parse_detour_rows,
)
from scripts.data_pipeline.override_checks import check_consistency, check_stops
from scripts.data_pipeline.override_models import (
    Overrides,
    ServiceDefinition,
    ServiceOverrides,
)
from scripts.data_pipeline.override_parsing import (
    DETOUR_COLUMNS,
    LINE_MAPPING_COLUMNS,
    OFFSET_COLUMNS,
    SCOPE_COLUMNS,
    SECTION_COLUMNS,
    STOP_COLUMNS,
    parse_dataset,
    parse_line_metadata,
    parse_line_ranges,
    parse_offset_exceptions,
    parse_section_filters,
    parse_service_definition,
    parse_stops,
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
