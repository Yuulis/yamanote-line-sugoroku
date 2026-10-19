"""Typed station identity conversion for the S4 assembled overrides."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from scripts.data_pipeline.registry import normalize_station_name
from scripts.data_pipeline.stage_suburban_support import StageError, read_csv, write_csv

STOP_FIELDS = [
    "order",
    "station_id",
    "station_number",
    "platform_selector",
    "original_name",
    "n02_name",
    "n02_operator",
    "source_reason",
]
METADATA_FIELDS = [
    "service_id",
    "order",
    "station_id_original",
    "station_id_proposed",
    "station_name_original",
    "prefecture",
    "municipality",
    "n02_name",
    "n02_operator",
    "platform_selector",
    "source_url",
]
EXCEPTION_KEYS = {
    "detour_exceptions.csv": ("service_id", "from_id", "to_id"),
    "offset_exceptions.csv": ("service_id", "station_id"),
    "platform_transfers.csv": ("service_id", "station_id"),
}


def assert_unique_rows(
    service_id: str, filename: str, rows: list[dict[str, str]], keys: tuple[str, ...]
) -> None:
    """Reject rows that collide on their output natural key."""
    seen: set[tuple[str, ...]] = set()
    for row in rows:
        key = tuple(row.get(field, "") for field in keys)
        if key in seen:
            raise StageError(
                f"natural-key collision after identity merge in {service_id}/{filename}: {key}"
            )
        seen.add(key)


def convert_compose(
    value: str, by_service: dict[str, dict[str, str]], service_id: str
) -> str:
    """Convert only the typed station endpoints inside compose legs."""
    if not value:
        return value
    try:
        recipe = json.loads(value)
    except json.JSONDecodeError as error:
        raise StageError(f"invalid compose recipe for {service_id}: {error}") from error
    if not isinstance(recipe, dict) or not isinstance(recipe.get("legs"), list):
        raise StageError(f"invalid compose recipe shape for {service_id}")
    legs: list[Any] = []
    for leg in recipe["legs"]:
        if not isinstance(leg, dict):
            raise StageError(f"invalid compose leg for {service_id}")
        converted = dict(leg)
        owner = str(leg.get("source_service", ""))
        mapping = by_service.get(owner)
        if mapping is None:
            raise StageError(
                f"compose leg references unknown service {owner!r} in {service_id}"
            )
        for field in ("from", "to"):
            station_id = str(leg.get(field, ""))
            if station_id not in mapping:
                raise StageError(
                    f"compose leg references unknown station {owner}/{station_id} in {service_id}"
                )
            converted[field] = mapping[station_id]
        legs.append(converted)
    return json.dumps(
        {**recipe, "legs": legs}, ensure_ascii=False, separators=(",", ":")
    )


def convert_service(
    service_id: str,
    source: dict[str, Any],
    mapping: dict[str, str],
    target_registry: dict[str, dict[str, str]],
    catalog_rows: list[dict[str, str]],
    output_root: Path,
    metadata_rows: list[dict[str, str]],
    by_service: dict[str, dict[str, str]],
) -> None:
    """Convert a service's identity-bearing override CSV columns."""
    source_service = source["overrides"] / "services" / service_id
    output_service = output_root / "services" / service_id
    for required in ("stops.csv", "scope.csv", "line_mapping.csv"):
        if not (source_service / required).is_file():
            raise StageError(f"service override is missing: {service_id}/{required}")
    expected_rows = sorted(catalog_rows, key=lambda row: int(row["order"]))
    _, source_stops = read_csv(source_service / "stops.csv")
    if [int(row["order"]) for row in source_stops] != list(range(len(source_stops))):
        raise StageError(f"staged stop order is not contiguous: {service_id}")
    converted_stops: list[dict[str, str]] = []
    seen_stops: set[str] = set()
    for stop in source_stops:
        original = stop["station_id"]
        if original not in mapping:
            raise StageError(
                f"unknown station ID in {service_id}/stops.csv: {original}"
            )
        proposed = mapping[original]
        if proposed in seen_stops:
            raise StageError(
                f"same-service stop collision after identity merge: {service_id}/{proposed}"
            )
        seen_stops.add(proposed)
        frozen = expected_rows[int(stop["order"])]
        if frozen["station_id_original"] != original:
            raise StageError(
                f"staged stop identity differs from frozen catalog: {service_id}/{original}"
            )
        converted = {field: stop.get(field, "") for field in STOP_FIELDS}
        converted["station_id"] = proposed
        # original_name must equal the registry name or an alias, which are stored
        # normalized; the raw spelling stays in n02_name and the metadata CSV.
        converted["original_name"] = normalize_station_name(
            converted["original_name"] or frozen["station_name_original"]
        )
        converted["n02_name"] = converted["n02_name"] or frozen["station_name_original"]
        converted["n02_operator"] = converted["n02_operator"] or frozen["n02_operator"]
        converted["source_reason"] = converted["source_reason"] or (
            "Frozen S0 catalog identifies the stop's N02 operator."
        )
        converted_stops.append(converted)
        metadata_rows.append(
            {
                "service_id": service_id,
                "order": stop["order"],
                "station_id_original": original,
                "station_id_proposed": proposed,
                "station_name_original": frozen["station_name_original"],
                "prefecture": frozen["prefecture"],
                "municipality": frozen["municipality"],
                "n02_name": converted["n02_name"],
                "n02_operator": converted["n02_operator"],
                "platform_selector": converted["platform_selector"],
                "source_url": frozen["source_url"],
            }
        )
    expected_ids = [row["station_id_proposed"] for row in expected_rows]
    if [row["station_id"] for row in converted_stops] != expected_ids:
        raise StageError(f"staged route differs from frozen stop order: {service_id}")
    assert_unique_rows(service_id, "stops.csv", converted_stops, ("station_id",))
    output_service.mkdir(parents=True, exist_ok=True)
    write_csv(output_service / "stops.csv", STOP_FIELDS, converted_stops)

    scope_fields, scope_rows = read_csv(source_service / "scope.csv")
    if "station_id" not in scope_fields:
        raise StageError(f"scope CSV lacks station_id: {service_id}")
    converted_scope: list[dict[str, str]] = []
    for row in scope_rows:
        original = row["station_id"]
        if original not in mapping:
            converted_scope.append(dict(row))
            continue
        proposed = mapping[original]
        registry = target_registry[proposed]
        converted_scope.append(
            {
                **row,
                "station_id": proposed,
                "prefecture": registry["prefecture"],
                "municipality": registry["municipality"],
            }
        )
    assert_unique_rows(service_id, "scope.csv", converted_scope, ("station_id",))
    write_csv(output_service / "scope.csv", scope_fields, converted_scope)

    line_fields, line_rows = read_csv(source_service / "line_mapping.csv")
    converted_lines: list[dict[str, str]] = []
    for row in line_rows:
        converted = dict(row)
        for field in ("from_id", "to_id"):
            original = row[field]
            if original not in mapping:
                raise StageError(
                    f"unknown station ID in {service_id}/line_mapping.csv: {original}"
                )
            converted[field] = mapping[original]
        if "compose" in converted:
            converted["compose"] = convert_compose(
                converted["compose"], by_service, service_id
            )
        converted_lines.append(converted)
    assert_unique_rows(
        service_id, "line_mapping.csv", converted_lines, ("from_id", "to_id")
    )
    write_csv(output_service / "line_mapping.csv", line_fields, converted_lines)

    sections_path = source_service / "sections.csv"
    if sections_path.is_file():
        fields, rows = read_csv(sections_path)
        converted_sections: list[dict[str, str]] = []
        for row in rows:
            converted = dict(row)
            for field in ("from_id", "to_id"):
                original = row.get(field, "")
                if original:
                    if original not in mapping:
                        raise StageError(
                            f"unknown station ID in {service_id}/sections.csv: {original}"
                        )
                    converted[field] = mapping[original]
            converted_sections.append(converted)
        key = tuple(
            field
            for field in ("n02_line", "action", "section_key", "from_id", "to_id")
            if field in fields
        )
        assert_unique_rows(service_id, "sections.csv", converted_sections, key)
        write_csv(output_service / "sections.csv", fields, converted_sections)

    junctions_path = source_service / "junctions.csv"
    if junctions_path.is_file():
        (output_service / "junctions.csv").write_bytes(junctions_path.read_bytes())
    known_files = {
        "stops.csv",
        "scope.csv",
        "line_mapping.csv",
        "sections.csv",
        "junctions.csv",
    }
    unknown_files = sorted(
        path.name
        for path in source_service.glob("*.csv")
        if path.name not in known_files
    )
    if unknown_files:
        raise StageError(f"unsupported service CSVs in {service_id}: {unknown_files}")


def convert_exceptions(
    source_directories: list[Path],
    output_overrides: Path,
    by_service: dict[str, dict[str, str]],
) -> None:
    """Convert station and pair IDs in dataset-level exception tables."""
    for filename, key_fields in EXCEPTION_KEYS.items():
        fields, all_rows = collect_exception_rows(
            source_directories, by_service, filename, key_fields
        )
        if fields is None:
            continue
        write_csv(output_overrides / filename, fields, all_rows)


def collect_exception_rows(
    source_directories: list[Path],
    by_service: dict[str, dict[str, str]],
    filename: str,
    key_fields: tuple[str, ...],
) -> tuple[list[str] | None, list[dict[str, str]]]:
    """Return source exception rows with typed station IDs converted."""
    all_rows: list[dict[str, str]] = []
    fields: list[str] | None = None
    for overrides in source_directories:
        path = overrides / filename
        if not path.is_file():
            continue
        current_fields, rows = read_csv(path)
        if fields is None:
            fields = current_fields
        elif current_fields != fields:
            raise StageError(f"exception CSV schema differs: {filename}/{overrides}")
        for row in rows:
            service_id = row["service_id"]
            mapping = by_service.get(service_id)
            if mapping is None:
                raise StageError(
                    f"exception references unknown service {service_id}: {filename}"
                )
            converted = dict(row)
            for field in key_fields:
                if field in ("from_id", "to_id", "station_id"):
                    station_id = row[field]
                    if station_id not in mapping:
                        raise StageError(
                            f"unknown station ID in {filename} for {service_id}: {station_id}"
                        )
                    converted[field] = mapping[station_id]
            all_rows.append(converted)

    if fields is None:
        return None, []
    natural_key_fields = tuple(field for field in key_fields if field in fields)
    seen: set[tuple[str, ...]] = set()
    for row in all_rows:
        natural_key = tuple(row[field] for field in natural_key_fields)
        if natural_key in seen:
            raise StageError(
                f"natural-key collision after identity merge in {filename}: {natural_key}"
            )
        seen.add(natural_key)
    return fields, all_rows


def _group_aliases(canonical_name: str, original_names: list[str]) -> list[str]:
    """Distinct original names in normalized registry spelling, minus the name.

    Spelling-only variants (市ヶ谷 for 市ケ谷) normalize to the canonical name and
    are dropped; the raw spelling stays in service-stop-metadata.csv.
    """
    canonical = normalize_station_name(canonical_name)
    normalized = (normalize_station_name(name) for name in original_names)
    return list(dict.fromkeys(name for name in normalized if name != canonical))
