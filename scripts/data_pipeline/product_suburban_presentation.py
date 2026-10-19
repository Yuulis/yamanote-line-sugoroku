"""Build and validate the audited S6 presentation metadata."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

PRESENTATION_FILE = "ui-presentation.json"
LINE_COLORS_SHA256 = "1b24f7b531f81b65bab4c6d090ff40852d89efc0c152d633dafefb9bd707afcb"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_ui_presentation(
    value: Any,
    *,
    lines: Sequence[Mapping[str, Any]],
    services: Sequence[Mapping[str, Any]],
    stations: Sequence[Mapping[str, Any]],
) -> None:
    """Validate IDs, group membership, aliases and stop references."""
    if not isinstance(value, dict) or set(value) != {
        "version",
        "operators",
        "lineGroups",
        "stations",
        "serviceStopNames",
    }:
        raise ValueError("uiPresentation must have the version 1 metadata fields")
    if value.get("version") != 1 or isinstance(value.get("version"), bool):
        raise ValueError("uiPresentation.version must be 1")

    line_by_id = _unique_records(lines, "id", "exported line")
    service_by_id = _unique_records(services, "id", "exported service")
    station_by_id = _unique_records(stations, "id", "exported station")
    _validate_operators(value.get("operators"), services)
    _validate_line_groups(value.get("lineGroups"), line_by_id, service_by_id)
    _validate_station_aliases(value.get("stations"), station_by_id)
    _validate_service_stop_names(
        value.get("serviceStopNames"), service_by_id, station_by_id
    )


def load_ui_presentation(
    overrides_dir: Path,
    relative_file: str,
    expected_sha256: str,
    *,
    lines: Sequence[Mapping[str, Any]],
    services: Sequence[Mapping[str, Any]],
    stations: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Load hash-pinned UI metadata and validate references to its source data."""
    if not SHA256_PATTERN.fullmatch(expected_sha256):
        raise ValueError("uiPresentationSha256 must be a lowercase SHA-256 digest")
    base = overrides_dir.resolve()
    path = overrides_dir / relative_file
    if path.is_symlink():
        raise ValueError("uiPresentationFile must not be a symlink")
    resolved = path.resolve()
    if not resolved.is_relative_to(base) or not resolved.is_file():
        raise ValueError("uiPresentationFile must name a file inside the overrides")
    raw = resolved.read_bytes()
    actual_sha256 = hashlib.sha256(raw).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError("uiPresentationSha256 does not match uiPresentationFile")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("uiPresentationFile is not valid UTF-8 JSON") from error
    validate_ui_presentation(value, lines=lines, services=services, stations=stations)
    return value


def compact_json(value: Mapping[str, Any]) -> str:
    """Serialize derived metadata with stable UTF-8 compact JSON and LF."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"


def require_same_presentation(actual: Any, expected: Mapping[str, Any]) -> None:
    """Reject presentation metadata that differs from its audited derivation."""
    if actual != expected:
        raise ValueError("UI presentation differs from audited source expectations")


def load_line_colors(path: Path) -> list[dict[str, str]]:
    """Load the pinned curated colour table and validate its row schema."""
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != LINE_COLORS_SHA256:
        raise ValueError("line colour table checksum mismatch")
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("line colour table is not valid UTF-8 JSON") from error
    if not isinstance(document, dict) or set(document) != {"version", "lineGroups"}:
        raise ValueError("line colour table has invalid fields")
    if document.get("version") != 1 or isinstance(document.get("version"), bool):
        raise ValueError("line colour table version must be 1")
    rows = document.get("lineGroups")
    if not isinstance(rows, list) or not rows:
        raise ValueError("line colour table lineGroups must be a non-empty array")
    seen: set[str] = set()
    shared_rows: list[tuple[str, list[str]]] = []
    result: list[dict[str, str]] = []
    for row in rows:
        required = {"id", "color", "status", "source"}
        optional = {"method", "evidence", "sharedWith"}
        if (
            not isinstance(row, dict)
            or not required <= set(row)
            or set(row) - required - optional
        ):
            raise ValueError("line colour table row has invalid fields")
        identifier = _nonempty(row.get("id"), "line colour id")
        color = _nonempty(row.get("color"), "line colour")
        status = row.get("status")
        source = _nonempty(row.get("source"), "line colour source")
        if not COLOR_PATTERN.fullmatch(color):
            raise ValueError(f"line colour table has invalid colour: {identifier}")
        if status not in {"official", "unofficial"}:
            raise ValueError(f"line colour table has invalid status: {identifier}")
        if not source.startswith("https://"):
            raise ValueError(
                f"line colour table source must be an HTTPS URL: {identifier}"
            )
        if status == "official" and not _nonempty(
            row.get("method"), "official line colour method"
        ):
            raise ValueError(f"official line colour requires a method: {identifier}")
        if status == "unofficial" and not _nonempty(
            row.get("evidence"), "unofficial line colour evidence"
        ):
            raise ValueError(f"unofficial line colour requires evidence: {identifier}")
        shared_with = row.get("sharedWith", [])
        if (
            not isinstance(shared_with, list)
            or any(not isinstance(parent, str) or not parent for parent in shared_with)
            or len(shared_with) != len(set(shared_with))
            or identifier in shared_with
        ):
            raise ValueError(f"line colour sharedWith is invalid: {identifier}")
        if identifier in seen:
            raise ValueError(f"line colour table repeats group: {identifier}")
        seen.add(identifier)
        if shared_with:
            shared_rows.append((identifier, shared_with))
        result.append(
            {"id": identifier, "color": color, "status": status, "source": source}
        )
    result_by_id = {row["id"]: row for row in result}
    for identifier, parents in shared_rows:
        if any(
            parent not in result_by_id
            or result_by_id[parent]["color"] != result_by_id[identifier]["color"]
            for parent in parents
        ):
            raise ValueError(
                f"line colour sharedWith references an unknown or differently coloured group: {identifier}"
            )
    return result


def build_ui_presentation(
    *,
    root: Path,
    lines: Sequence[Mapping[str, Any]],
    services: Sequence[Mapping[str, Any]],
    stations: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Derive UI metadata only from verified S4 sidecars and exported records."""
    from scripts.data_pipeline.product_suburban_inputs import (
        ASSEMBLED_PATH,
        check_metadata_sidecar,
        check_ui_groups_sidecar,
        expected_metadata_rows,
        expected_station_groups,
        expected_ui_groups,
        read_json,
    )
    from scripts.data_pipeline.stage_suburban_support import StageError, read_csv

    assembled = root / ASSEMBLED_PATH
    station_groups_path = assembled / "station-groups.json"
    station_groups_doc = read_json(station_groups_path)
    expected_stations, expected_groups = expected_station_groups(root=root)
    del expected_stations
    if station_groups_doc != {"stationGroups": expected_groups}:
        raise StageError("station-groups differs from frozen source expectations")

    metadata_path = assembled / "service-stop-metadata.csv"
    metadata_fields, metadata_rows = read_csv(metadata_path)
    check_metadata_sidecar(metadata_path, expected_metadata_rows(root=root))
    ui_groups_path = assembled / "ui-line-groups.json"
    ui_groups = read_json(ui_groups_path)
    check_ui_groups_sidecar(ui_groups_path, expected_ui_groups(root=root))

    line_by_id = _unique_records(lines, "id", "exported line")
    service_by_id = _unique_records(services, "id", "exported service")
    station_by_id = _unique_records(stations, "id", "exported station")
    station_group_rows = station_groups_doc["stationGroups"]
    if set(station_by_id) != {row["id"] for row in station_group_rows}:
        raise StageError("exported station IDs differ from audited station groups")
    for row in station_group_rows:
        if station_by_id[row["id"]].get("name") != row["name"]:
            raise StageError(
                f"exported station name differs from audited identity: {row['id']}"
            )

    line_groups = _build_line_groups(lines, services, ui_groups)
    colors = load_line_colors(root / "data/presentation/line-colors.json")
    colors_by_id = {row["id"]: row["color"] for row in colors}
    if set(colors_by_id) != {group["id"] for group in line_groups}:
        raise StageError("curated line colour table does not cover audited UI groups")
    line_groups = [
        {**group, "color": colors_by_id[group["id"]]} for group in line_groups
    ]
    presentation = {
        "version": 1,
        "operators": _build_operators(services),
        "lineGroups": line_groups,
        "stations": [
            {"id": row["id"], "aliases": list(row["aliases"])}
            for row in station_group_rows
            if row["aliases"]
        ],
        "serviceStopNames": _build_service_stop_names(
            metadata_fields, metadata_rows, station_group_rows, service_by_id
        ),
    }
    try:
        validate_ui_presentation(
            presentation, lines=lines, services=services, stations=stations
        )
    except ValueError as error:
        raise StageError(f"derived UI presentation is invalid: {error}") from error
    if len(line_by_id) != len(lines):
        raise StageError("exported line IDs are not unique")
    return presentation


def _unique_records(
    records: Sequence[Mapping[str, Any]], key: str, label: str
) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    for record in records:
        identifier = record.get(key)
        if not isinstance(identifier, str) or not identifier:
            raise ValueError(f"{label} must have a non-empty {key}")
        if identifier in result:
            raise ValueError(f"duplicate {label} id: {identifier}")
        result[identifier] = record
    return result


def _validate_operators(value: Any, services: Sequence[Mapping[str, Any]]) -> None:
    if not isinstance(value, list):
        raise ValueError("uiPresentation.operators must be an array")
    seen: set[str] = set()
    for record in value:
        if not isinstance(record, dict) or set(record) != {"id", "name"}:
            raise ValueError("uiPresentation operator records need id and name")
        identifier = _nonempty(record.get("id"), "operator id")
        name = _nonempty(record.get("name"), "operator name")
        if identifier != name:
            raise ValueError("operator IDs must use their audited operator names")
        if identifier in seen:
            raise ValueError(f"duplicate operator id: {identifier}")
        seen.add(identifier)
    expected = {
        _nonempty(service.get("operator"), "service operator") for service in services
    }
    if seen != expected:
        raise ValueError("uiPresentation operators differ from exported services")


def _validate_line_groups(
    value: Any,
    lines: Mapping[str, Mapping[str, Any]],
    services: Mapping[str, Mapping[str, Any]],
) -> None:
    if not isinstance(value, list) or not value:
        raise ValueError("uiPresentation.lineGroups must be a non-empty array")
    group_ids: set[str] = set()
    member_ids: set[str] = set()
    for record in value:
        expected_keys = {"id", "name", "operatorId", "color", "serviceIds"}
        if not isinstance(record, dict) or set(record) != expected_keys:
            raise ValueError("uiPresentation line groups have invalid fields")
        identifier = _nonempty(record.get("id"), "line group id")
        name = _nonempty(record.get("name"), "line group name")
        operator_id = _nonempty(record.get("operatorId"), "line group operatorId")
        color = _nonempty(record.get("color"), "line group color")
        if not COLOR_PATTERN.fullmatch(color):
            raise ValueError(f"line group has invalid color: {identifier}")
        if identifier in group_ids:
            raise ValueError(f"duplicate line group id: {identifier}")
        group_ids.add(identifier)
        service_ids = record.get("serviceIds")
        if not isinstance(service_ids, list) or not service_ids:
            raise ValueError(f"line group must reference services: {identifier}")
        if any(
            not isinstance(service_id, str) or not service_id
            for service_id in service_ids
        ):
            raise ValueError(f"line group has invalid service IDs: {identifier}")
        if len(set(service_ids)) != len(service_ids):
            raise ValueError(f"line group repeats a service ID: {identifier}")
        for service_id in service_ids:
            service = services.get(service_id)
            if service is None:
                raise ValueError(f"line group references unknown service: {service_id}")
            if service_id in member_ids:
                raise ValueError(f"service belongs to multiple UI groups: {service_id}")
            member_ids.add(service_id)
            if service.get("operator") != operator_id:
                raise ValueError(
                    f"line group operator differs for service: {service_id}"
                )
        source_line_ids: set[str] = set()
        for service_id in service_ids:
            service_line_ids = services[service_id].get("lineIds")
            if not isinstance(service_line_ids, list) or not service_line_ids:
                raise ValueError(f"service has no line IDs: {service_id}")
            source_line_ids.update(service_line_ids)
        source_lines = [lines.get(line_id) for line_id in source_line_ids]
        if any(source_line is None for source_line in source_lines):
            raise ValueError(
                f"line group references an unknown source line: {identifier}"
            )
        line = lines.get(identifier)
        if line is not None:
            if line.get("name") != name:
                raise ValueError(f"line group differs from exported line: {identifier}")
            for service_id in service_ids:
                service_line_ids = services[service_id].get("lineIds")
                if (
                    not isinstance(service_line_ids, list)
                    or identifier not in service_line_ids
                ):
                    raise ValueError(
                        f"line group has a service outside its line: {service_id}"
                    )
    if member_ids != set(services):
        raise ValueError(
            "uiPresentation line groups do not cover every service exactly once"
        )


def _validate_station_aliases(
    value: Any, stations: Mapping[str, Mapping[str, Any]]
) -> None:
    if not isinstance(value, list):
        raise ValueError("uiPresentation.stations must be an array")
    seen_ids: set[str] = set()
    for record in value:
        if not isinstance(record, dict) or set(record) != {"id", "aliases"}:
            raise ValueError("uiPresentation station records need id and aliases")
        station_id = _nonempty(record.get("id"), "station alias id")
        aliases = record.get("aliases")
        station = stations.get(station_id)
        if station is None:
            raise ValueError(f"station aliases reference unknown station: {station_id}")
        if station_id in seen_ids:
            raise ValueError(f"duplicate station aliases: {station_id}")
        seen_ids.add(station_id)
        if not isinstance(aliases, list) or not aliases:
            raise ValueError(f"station aliases must be non-empty: {station_id}")
        if any(not isinstance(alias, str) or not alias.strip() for alias in aliases):
            raise ValueError(f"station aliases contain an empty name: {station_id}")
        if len(set(aliases)) != len(aliases) or station.get("name") in aliases:
            raise ValueError(f"station aliases are not distinct: {station_id}")


def _validate_service_stop_names(
    value: Any,
    services: Mapping[str, Mapping[str, Any]],
    stations: Mapping[str, Mapping[str, Any]],
) -> None:
    if not isinstance(value, list):
        raise ValueError("uiPresentation.serviceStopNames must be an array")
    seen: set[tuple[str, str]] = set()
    for record in value:
        if not isinstance(record, dict) or set(record) != {
            "serviceId",
            "stationId",
            "name",
        }:
            raise ValueError("uiPresentation service-stop records have invalid fields")
        service_id = _nonempty(record.get("serviceId"), "service-stop serviceId")
        station_id = _nonempty(record.get("stationId"), "service-stop stationId")
        name = _nonempty(record.get("name"), "service-stop name")
        service = services.get(service_id)
        station = stations.get(station_id)
        if service is None:
            raise ValueError(
                f"service-stop record references unknown service: {service_id}"
            )
        if station is None:
            raise ValueError(
                f"service-stop record references unknown station: {station_id}"
            )
        station_ids = service.get("stationIds")
        if not isinstance(station_ids, list) or station_id not in station_ids:
            raise ValueError(
                f"service-stop station is not served: {service_id}/{station_id}"
            )
        if name == station.get("name"):
            raise ValueError(
                f"service-stop name equals canonical station: {service_id}/{station_id}"
            )
        key = (service_id, station_id)
        if key in seen:
            raise ValueError(f"duplicate service-stop name: {service_id}/{station_id}")
        seen.add(key)


def _build_operators(services: Sequence[Mapping[str, Any]]) -> list[dict[str, str]]:
    operators: list[dict[str, str]] = []
    seen: set[str] = set()
    for service in services:
        name = _nonempty(service.get("operator"), "service operator")
        if name not in seen:
            seen.add(name)
            operators.append({"id": name, "name": name})
    return operators


def _build_line_groups(
    lines: Sequence[Mapping[str, Any]],
    services: Sequence[Mapping[str, Any]],
    explicit_groups: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    service_by_id = _unique_records(services, "id", "exported service")
    line_order = {line["id"]: index for index, line in enumerate(lines)}
    explicit_by_service: dict[str, Mapping[str, Any]] = {}
    explicit_line_ids: set[str] = set()
    for group in explicit_groups:
        service_ids = group.get("serviceIds")
        if not isinstance(service_ids, list) or not service_ids:
            raise ValueError("audited UI group must include serviceIds")
        for service_id in service_ids:
            if service_id not in service_by_id:
                raise ValueError(
                    f"audited UI group references unknown service: {service_id}"
                )
            if service_id in explicit_by_service:
                raise ValueError(f"audited UI groups overlap at service: {service_id}")
            explicit_by_service[service_id] = group
            source_line_ids = service_by_id[service_id].get("lineIds")
            if not isinstance(source_line_ids, list) or len(source_line_ids) != 1:
                raise ValueError(
                    f"audited grouped service must have one line: {service_id}"
                )
            explicit_line_ids.update(source_line_ids)

    groups_by_id: dict[str, Mapping[str, Any]] = {}
    for group in explicit_groups:
        group_id = _nonempty(group.get("id"), "audited UI group id")
        if group_id in groups_by_id:
            raise ValueError(f"duplicate audited UI group id: {group_id}")
        groups_by_id[group_id] = group

    result: list[dict[str, Any]] = []
    emitted_explicit: set[str] = set()
    for line in lines:
        line_id = _nonempty(line.get("id"), "exported line id")
        if line_id in explicit_line_ids:
            associated = [
                group
                for group in explicit_groups
                if any(
                    line_id in service_by_id[service_id]["lineIds"]
                    for service_id in group["serviceIds"]
                )
            ]
            if len(associated) != 1:
                raise ValueError(
                    f"source line belongs to multiple explicit UI groups: {line_id}"
                )
            group = associated[0]
            group_id = _nonempty(group.get("id"), "audited UI group id")
            if group_id in emitted_explicit:
                continue
            group_service_ids = group["serviceIds"]
            component_lines = [
                service_by_id[service_id]["lineIds"][0]
                for service_id in group_service_ids
            ]
            component_records = [_line_by_id(lines, item) for item in component_lines]
            colors = {record.get("color") for record in component_records}
            operators = {
                _nonempty(
                    service_by_id[item].get("operator"), "grouped service operator"
                )
                for item in group_service_ids
            }
            if len(colors) != 1 or len(operators) != 1:
                raise ValueError(
                    f"audited UI group has inconsistent source metadata: {group_id}"
                )
            result.append(
                {
                    "id": group_id,
                    "name": _nonempty(
                        group.get("displayName"), "audited UI group displayName"
                    ),
                    "operatorId": next(iter(operators)),
                    "color": next(iter(colors)),
                    "serviceIds": list(group_service_ids),
                }
            )
            emitted_explicit.add(group_id)
            continue
        grouped_services = [
            service for service in services if line_id in service.get("lineIds", [])
        ]
        if not grouped_services:
            raise ValueError(f"exported line has no service: {line_id}")
        operators = {
            _nonempty(service.get("operator"), "line service operator")
            for service in grouped_services
        }
        if len(operators) != 1:
            raise ValueError(f"exported line has multiple operators: {line_id}")
        result.append(
            {
                "id": line_id,
                "name": _nonempty(line.get("name"), "exported line name"),
                "operatorId": next(iter(operators)),
                "color": _nonempty(line.get("color"), "exported line color"),
                "serviceIds": [service["id"] for service in grouped_services],
            }
        )

    if emitted_explicit != set(groups_by_id):
        raise ValueError("not every audited UI group was emitted")
    if set(line_order) != {line["id"] for line in lines}:
        raise ValueError("exported line IDs are not unique")
    return result


def _build_service_stop_names(
    fields: Sequence[str],
    rows: Sequence[Mapping[str, str]],
    station_groups: Sequence[Mapping[str, Any]],
    services: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, str]]:
    required = {
        "service_id",
        "station_id_proposed",
        "station_name_original",
    }
    if not required <= set(fields):
        raise ValueError("audited service-stop metadata schema is incomplete")
    station_by_id = {row["id"]: row for row in station_groups}
    result: list[dict[str, str]] = []
    for row in rows:
        service_id = row["service_id"]
        station_id = row["station_id_proposed"]
        name = row["station_name_original"]
        station = station_by_id.get(station_id)
        if station is None or service_id not in services:
            raise ValueError(
                f"audited service-stop metadata references unknown identity: {service_id}/{station_id}"
            )
        if name == station["name"]:
            continue
        result.append({"serviceId": service_id, "stationId": station_id, "name": name})
    return result


def _line_by_id(lines: Sequence[Mapping[str, Any]], line_id: str) -> Mapping[str, Any]:
    matches = [line for line in lines if line.get("id") == line_id]
    if len(matches) != 1:
        raise ValueError(
            f"audited UI group references unknown or duplicate line: {line_id}"
        )
    return matches[0]


def _nonempty(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value
