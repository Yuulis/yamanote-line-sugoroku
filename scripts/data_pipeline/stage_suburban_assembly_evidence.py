"""Measure and validate pair evidence for the frozen S4 suburban assembly."""

from __future__ import annotations

import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any, cast

from scripts.data_pipeline import stage_suburban_jr as jr
from scripts.data_pipeline import stage_suburban_nonjr as nonjr
from scripts.data_pipeline.composition import check_recipe_anchors, flatten_recipe
from scripts.data_pipeline.n02 import N02SourceProvider
from scripts.data_pipeline.overrides import Overrides, load_overrides
from scripts.data_pipeline.stage_suburban_assembly import (
    ASSEMBLED_PATH,
    CATALOG_PATH,
    FREEZE_PATH,
    NONJR_STAGE_PATH,
    ROOT,
    SERVICES_PATH,
    _build_inputs_report,
    _load_frozen_catalog,
    _load_source_sets,
    _oracle,
    preflight,
)
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    _stable_repr,
    hash_value,
    read_csv,
    read_json,
    resolve_historical_baseline,
    sha256_file,
    write_csv,
    write_json,
)
from scripts.data_pipeline.topology import station_pairs

EVIDENCE_FIELDS = [
    "service_id",
    "from_id",
    "to_id",
    "route_kind",
    "n02_operator",
    "n02_line",
    "from_platform_code",
    "from_group_code",
    "from_track_platform_code",
    "to_platform_code",
    "to_group_code",
    "to_track_platform_code",
    "path_length_km",
    "start_snap_m",
    "end_snap_m",
    "route_legs_json",
    "recipe_sha256",
    "filter_sha256",
    "override_sha256",
    "raw_station_sha256",
    "raw_section_sha256",
    "distance_source_sha256",
    "status",
    "notes",
]
EVIDENCE_MANIFEST = "evidence-manifest.json"
EVIDENCE_FILE = "pair-evidence.csv"
JR_OPERATOR = "東日本旅客鉄道"


def _batch_service_ids(
    root: Path,
    batch: str,
    freeze: dict[str, Any],
    frozen_services: list[dict[str, str]],
    catalog_by_service: dict[str, list[dict[str, str]]],
) -> list[str]:
    """Resolve a frozen JR split or one complete S3 non-JR group."""
    service_order = [row["service_id"] for row in frozen_services]
    jr_services = {
        service_id
        for service_id, rows in catalog_by_service.items()
        if rows and rows[0]["operator"] == JR_OPERATOR
    }
    nonjr_services = set(service_order) - jr_services
    shipped = set(freeze["shipped"]["serviceIds"])
    if not shipped <= jr_services:
        raise StageError("frozen shipped services include a non-JR service")
    if batch == "jr-core":
        selected = shipped
    elif batch == "jr-new":
        selected = jr_services - shipped
    elif batch in nonjr.GROUPS:
        inventories: dict[str, list[str]] = {}
        for group in nonjr.GROUPS:
            inventory_path = root / NONJR_STAGE_PATH / group / "inventory.json"
            if not inventory_path.is_file():
                raise StageError(f"S3 group inventory is missing: {group}")
            inventory = read_json(inventory_path)
            service_ids = inventory.get("serviceIds")
            if not isinstance(service_ids, list) or not all(
                isinstance(service_id, str) for service_id in service_ids
            ):
                raise StageError(f"S3 group inventory is malformed: {group}")
            inventories[group] = service_ids
        all_group_ids = [
            service_id
            for service_ids in inventories.values()
            for service_id in service_ids
        ]
        if len(all_group_ids) != len(set(all_group_ids)):
            raise StageError("S3 group inventories assign a service more than once")
        if set(all_group_ids) != nonjr_services:
            raise StageError(
                "S3 group service inventory differs from the frozen non-JR catalog: "
                f"missing={sorted(nonjr_services - set(all_group_ids))}, "
                f"extra={sorted(set(all_group_ids) - nonjr_services)}"
            )
        selected = set(inventories[batch])
    else:
        raise StageError(
            f"unknown evidence batch {batch!r}; expected jr-core, jr-new, or an S3 group"
        )
    if not selected:
        raise StageError(f"evidence batch has no frozen services: {batch}")
    return [service_id for service_id in service_order if service_id in selected]


def _batch_pairs(
    batch: str,
    selected_service_ids: list[str],
    freeze: dict[str, Any],
    oracle: dict[str, Any],
) -> list[tuple[str, str, str]]:
    """Return every frozen route pair for the selected whole-service batch."""
    pairs: list[tuple[str, str, str]] = []
    for service_id in selected_service_ids:
        catalog_rows = oracle["catalogByService"][service_id]
        ordered_ids = [row["station_id_proposed"] for row in catalog_rows]
        is_circular = oracle["circularByService"][service_id]
        pairs.extend(
            (service_id, origin, destination)
            for origin, destination in station_pairs(ordered_ids, is_circular)
        )
    return pairs


def _pair_primitives(
    overrides: Overrides, service: Any, pair_index: int
) -> tuple[tuple[str, str, str, bool], ...]:
    """Expand a composed service pair to its ordered ultimate-owner chain."""
    pairs = station_pairs(list(service.station_ids), service.circular)
    if not 0 <= pair_index < len(pairs):
        raise StageError(f"invalid service pair index: {service.id}:{pair_index}")
    origin, destination = pairs[pair_index]
    item = service.segment_ranges()[pair_index]
    if item.compose:
        primitives = flatten_recipe(overrides, item.compose, service)
        check_recipe_anchors(origin, destination, primitives)
        return tuple(primitives)
    return ((service.id, origin, destination, False),)


def _pair_index(service: Any, origin: str, destination: str) -> int:
    pairs = station_pairs(list(service.station_ids), service.circular)
    try:
        return pairs.index((origin, destination))
    except ValueError as error:
        raise StageError(
            f"unknown owner pair {service.id}:{origin}->{destination}"
        ) from error


def _catalog_pair_row(
    catalog_rows: list[dict[str, str]], pair_index: int, service: Any
) -> dict[str, str]:
    if pair_index < len(catalog_rows):
        return catalog_rows[pair_index]
    if service.circular and pair_index == len(catalog_rows):
        return catalog_rows[0]
    raise StageError(f"frozen catalog pair is missing: {service.id}:{pair_index}")


def _pair_route_spec(
    overrides: Overrides,
    service: Any,
    item: Any,
    catalog_row: dict[str, str],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    lines = item.route_lines or (catalog_row["n02_line"],)
    if not lines or any(not line for line in lines):
        raise StageError(f"no frozen N02 line for {service.id}")
    if item.route_lines:
        operators = service.range_operators(item, overrides.dataset)
    else:
        operators = (
            item.n02_operator or service.effective_n02_operator(overrides.dataset),
        )
    if len(lines) != len(operators) or any(not operator for operator in operators):
        raise StageError(f"incomplete N02 route ownership for {service.id}")
    return tuple(lines), tuple(operators)


def _pair_fingerprints(
    overrides: Overrides,
    consumer: Any,
    pair_index: int,
    primitives: tuple[tuple[str, str, str, bool], ...],
    catalog_by_service: dict[str, list[dict[str, str]]],
) -> tuple[str, str]:
    pairs = station_pairs(list(consumer.station_ids), consumer.circular)
    origin, destination = pairs[pair_index]
    consumer_item = consumer.segment_ranges()[pair_index]
    recipe_payload: dict[str, Any] = {
        "serviceId": consumer.id,
        "from": origin,
        "to": destination,
        "routeLines": consumer_item.route_lines,
        "via": consumer_item.via,
        "route": _stable_repr(consumer_item.route),
        "compose": _stable_repr(consumer_item.compose),
        "ultimateOwners": primitives,
    }
    filter_payload: list[dict[str, Any]] = []
    for owner_id, start, finish, reverse in primitives:
        owner = overrides.service(owner_id)
        owner_index = _pair_index(owner, start, finish)
        owner_item = owner.segment_ranges()[owner_index]
        owner_catalog = _catalog_pair_row(
            catalog_by_service[owner_id], owner_index, owner
        )
        lines, operators = _pair_route_spec(overrides, owner, owner_item, owner_catalog)
        recipe_payload.setdefault("ownerRoutes", []).append(
            {
                "serviceId": owner_id,
                "from": start,
                "to": finish,
                "reverse": reverse,
                "lines": lines,
                "operators": operators,
                "via": owner_item.via,
                "route": _stable_repr(owner_item.route),
            }
        )
        for line, operator in zip(lines, operators, strict=True):
            section_filter = owner.section_filter_for_pair(
                line, operator, start, finish
            )
            filter_payload.append(
                {
                    "serviceId": owner_id,
                    "from": start,
                    "to": finish,
                    "reverse": reverse,
                    "operator": operator,
                    "line": line,
                    "allow": sorted(section_filter.allow),
                    "deny": sorted(section_filter.deny),
                }
            )
        if owner_item.compose:
            raise StageError(
                f"compose expansion retained a non-ultimate owner: {owner_id}:{start}->{finish}"
            )
    # The consumer witness includes per-line allow/deny filters and is part of
    # the filter fingerprint in addition to the ultimate owners' exact rules.
    if consumer_item.compose:
        filter_payload.append(
            {
                "serviceId": consumer.id,
                "sharedTrackEvidence": _stable_repr(consumer_item.compose),
            }
        )
    recipe_payload["operatorsAndLines"] = [
        {
            "owner": entry["serviceId"],
            "lines": entry["lines"],
            "operators": entry["operators"],
        }
        for entry in recipe_payload.get("ownerRoutes", [])
    ]
    return hash_value(recipe_payload), hash_value(filter_payload)


def _full_pair_constraints(
    overrides: Overrides, service: Any, catalog_rows: list[dict[str, str]]
) -> Any:
    """Expose each pair's effective S2/S3 filters to the shared JR measurer."""
    scoped: dict[tuple[str, str, str, str], Any] = {}
    for pair_index, (origin, destination) in enumerate(
        station_pairs(list(service.station_ids), service.circular)
    ):
        item = service.segment_ranges()[pair_index]
        if item.compose:
            continue
        catalog_row = _catalog_pair_row(catalog_rows, pair_index, service)
        lines, operators = _pair_route_spec(overrides, service, item, catalog_row)
        for line, operator in zip(lines, operators, strict=True):
            scoped[(operator, line, origin, destination)] = (
                service.section_filter_for_pair(line, operator, origin, destination)
            )
    return jr.AddedRangeConstraints(
        scoped_section_filters=scoped,
        junction_rules=service.junction_rules,
    )


def _distance_reference(
    root: Path, overrides_dir: Path, service_id: str
) -> dict[str, Any]:
    if overrides_dir.parent.name == "combined":
        artifact_root = overrides_dir.parent
    elif "components" in overrides_dir.parts:
        artifact_root = overrides_dir.parents[2]
    else:
        raise StageError(f"cannot locate distance references for {service_id}")
    references_path = artifact_root / "length-refs.csv"
    components_path = artifact_root / "length-ref-components.csv"
    if not references_path.is_file():
        raise StageError(f"distance references are missing for {service_id}")
    _, references = read_csv(references_path)
    matching_references = [
        row for row in references if row.get("service_id") == service_id
    ]
    if len(matching_references) > 1:
        raise StageError(f"distance reference is duplicated for {service_id}")
    matching_components: list[dict[str, str]] = []
    component_hash = ""
    if components_path.is_file():
        _, components = read_csv(components_path)
        matching_components = [
            row for row in components if row.get("service_id") == service_id
        ]
        component_hash = sha256_file(components_path)
    if matching_references:
        return {
            "sourceKind": "staging-length-reference",
            "sourceRoot": artifact_root.relative_to(root).as_posix(),
            "lengthRefsSha256": sha256_file(references_path),
            "lengthRefComponentsSha256": component_hash,
            "serviceReference": matching_references[0],
            "serviceComponents": matching_components,
            "km": matching_references[0]["km"],
            "source": matching_references[0]["source_url"],
        }
    if artifact_root.name != "combined":
        raise StageError(f"distance reference is missing for {service_id}")
    # The old-edition services.json is a historical input: after the S5 product
    # install replaces live overrides, read the verified archived copy instead.
    live_services_path = (
        resolve_historical_baseline(root, "data/overrides") / "services.json"
    )
    live_services = read_json(live_services_path)
    matches = [row for row in live_services["services"] if row.get("id") == service_id]
    if len(matches) != 1:
        raise StageError(f"live distance reference is missing for {service_id}")
    definition = matches[0]
    length_ref = definition.get("lengthRef")
    if not isinstance(length_ref, dict) or "km" not in length_ref:
        raise StageError(f"live distance reference is malformed for {service_id}")
    return {
        "sourceKind": "live-service-length-reference",
        "sourceRoot": "data/overrides/services.json",
        "liveServicesSha256": sha256_file(live_services_path),
        "serviceDefinition": definition,
        "km": str(length_ref["km"]),
        "source": str(length_ref.get("source", "")),
    }


def _check_batch_length_tolerances(
    root: Path,
    service_ids: list[str],
    source_directories: dict[str, dict[str, Any]],
    rows: list[dict[str, str]],
) -> None:
    sums: dict[str, float] = defaultdict(float)
    for row in rows:
        sums[row["service_id"]] += float(row["path_length_km"])
    failures: list[str] = []
    for service_id in service_ids:
        source = source_directories.get(service_id)
        if source is None:
            raise StageError(f"staging owner is missing for {service_id}")
        reference = _distance_reference(root, source["overrides"], service_id)
        try:
            jr.check_length_tolerance(float(reference["km"]), sums[service_id])
        except (StageError, ValueError) as error:
            failures.append(
                f"{service_id}: {error}; measured={sums[service_id]:.3f} km; "
                f"reference={reference['km']} km ({reference['source']})"
            )
    if failures:
        raise StageError("batch distance tolerance failed: " + " | ".join(failures))


def _measure_primitive(
    overrides: Overrides,
    owner_id: str,
    origin: str,
    destination: str,
    provider: N02SourceProvider,
    catalog_by_service: dict[str, list[dict[str, str]]],
    root: Path,
) -> dict[str, Any]:
    """Measure one ultimate-owner pair with the existing S2/S3 route logic."""
    service = overrides.service(owner_id)
    pair_index = _pair_index(service, origin, destination)
    item = service.segment_ranges()[pair_index]
    if item.compose:
        raise StageError(
            f"ultimate owner pair is composed: {owner_id}:{origin}->{destination}"
        )
    catalog_rows = catalog_by_service[owner_id]
    catalog_row = _catalog_pair_row(catalog_rows, pair_index, service)
    measurement_rows = (
        [*catalog_rows, catalog_rows[0]]
        if service.circular and pair_index == len(catalog_rows)
        else catalog_rows
    )
    lines, _ = _pair_route_spec(overrides, service, item, catalog_row)
    origin_stop, destination_stop = nonjr._pair_stops(service.stops, pair_index)
    origin_resolution, origin_station = jr._stop_resolution(
        overrides, service, origin_stop
    )
    destination_resolution, destination_station = jr._stop_resolution(
        overrides, service, destination_stop
    )
    origin_options, origin_pairs = nonjr._pair_endpoint_options(
        origin_stop,
        origin_resolution,
        origin_station,
        provider.for_operator(origin_resolution.source_operator),
        lines[0],
        "from",
        stop_lines=nonjr._endpoint_stop_lines(service, pair_index, "from"),
    )
    destination_options, destination_pairs = nonjr._pair_endpoint_options(
        destination_stop,
        destination_resolution,
        destination_station,
        provider.for_operator(destination_resolution.source_operator),
        lines[-1],
        "to",
        stop_lines=nonjr._endpoint_stop_lines(service, pair_index, "to"),
    )
    endpoint_candidates = {
        stop.station_id: options
        for stop, options, pairs in (
            (origin_stop, origin_options, origin_pairs),
            (destination_stop, destination_options, destination_pairs),
        )
        if any(anchor.n02_line != track.n02_line for anchor, track in pairs.values())
    }
    pair_overrides = nonjr._PairOverrides(
        overrides, owner_id, pair_index, endpoint_candidates
    )
    row, window = jr._measure_pair(
        cast(Overrides, pair_overrides),
        owner_id,
        pair_index,
        provider,
        measurement_rows,
        _full_pair_constraints(overrides, service, catalog_rows),
    )
    from_anchor, from_track = origin_pairs[
        (row["from_platform_code"], row["from_group_code"])
    ]
    to_anchor, to_track = destination_pairs[
        (row["to_platform_code"], row["to_group_code"])
    ]
    operators = service.range_operators(item, overrides.dataset)
    route_legs = [
        {
            "operator": operator,
            "line": line,
            "sectionKeys": sorted(window.get((operator, line), frozenset())),
        }
        for operator, line in zip(operators, item.route_lines, strict=True)
    ]
    if not item.route_lines:
        operators = (
            item.n02_operator or service.effective_n02_operator(overrides.dataset),
        )
        route_legs = [
            {
                "operator": operators[0],
                "line": lines[0],
                "sectionKeys": sorted(
                    window.get((operators[0], lines[0]), frozenset())
                ),
            }
        ]
    return {
        **row,
        "from_platform_code": from_anchor.station_code,
        "from_group_code": from_anchor.group_code,
        "from_track_platform_code": from_track.station_code,
        "to_platform_code": to_anchor.station_code,
        "to_group_code": to_anchor.group_code,
        "to_track_platform_code": to_track.station_code,
        "route_legs": route_legs,
    }


def _oriented_measurement(measured: dict[str, Any], reverse: bool) -> dict[str, Any]:
    if not reverse:
        return measured
    oriented = dict(measured)
    for prefix in ("platform", "track_platform", "group"):
        from_key = f"from_{prefix}_code" if prefix != "group" else "from_group_code"
        to_key = f"to_{prefix}_code" if prefix != "group" else "to_group_code"
        oriented[from_key], oriented[to_key] = measured[to_key], measured[from_key]
    oriented["start_snap_m"], oriented["end_snap_m"] = (
        measured["end_snap_m"],
        measured["start_snap_m"],
    )
    oriented["from_id"], oriented["to_id"] = measured["to_id"], measured["from_id"]
    return oriented


def _measure_batch_pair(
    overrides: Overrides,
    service_id: str,
    pair_index: int,
    provider: N02SourceProvider,
    catalog_by_service: dict[str, list[dict[str, str]]],
    root: Path,
    source_hashes: dict[str, Any],
) -> dict[str, str]:
    consumer = overrides.service(service_id)
    origin, destination = station_pairs(list(consumer.station_ids), consumer.circular)[
        pair_index
    ]
    primitives = _pair_primitives(overrides, consumer, pair_index)
    fingerprints = _pair_fingerprints(
        overrides, consumer, pair_index, primitives, catalog_by_service
    )
    measurements: list[tuple[dict[str, Any], tuple[str, str, str, bool]]] = []
    for primitive in primitives:
        owner_id, start, finish, reverse = primitive
        measured = _measure_primitive(
            overrides,
            owner_id,
            start,
            finish,
            provider,
            catalog_by_service,
            root,
        )
        measurements.append((_oriented_measurement(measured, reverse), primitive))
    if not measurements:
        raise StageError(
            f"service pair has no route primitives: {service_id}:{origin}->{destination}"
        )
    legs = [
        {
            "ownerServiceId": primitive[0],
            "fromId": primitive[1],
            "toId": primitive[2],
            "reversed": primitive[3],
            "route": measurement["route_legs"],
        }
        for measurement, primitive in measurements
    ]
    first, last = measurements[0][0], measurements[-1][0]
    path_length = sum(
        float(measurement["path_length_km"]) for measurement, _ in measurements
    )
    source_distance_hash = source_hashes["distanceSources"].get(service_id)
    if not source_distance_hash:
        raise StageError(f"distance source hash is missing for {service_id}")
    return {
        "service_id": service_id,
        "from_id": origin,
        "to_id": destination,
        "route_kind": "compose"
        if consumer.segment_ranges()[pair_index].compose
        else "route",
        "n02_operator": " -> ".join(
            leg["operator"]
            for measured, _ in measurements
            for leg in measured["route_legs"]
        ),
        "n02_line": " -> ".join(
            leg["line"]
            for measured, _ in measurements
            for leg in measured["route_legs"]
        ),
        "from_platform_code": first["from_platform_code"],
        "from_group_code": first["from_group_code"],
        "from_track_platform_code": first["from_track_platform_code"],
        "to_platform_code": last["to_platform_code"],
        "to_group_code": last["to_group_code"],
        "to_track_platform_code": last["to_track_platform_code"],
        "path_length_km": f"{path_length:.6f}",
        "start_snap_m": first["start_snap_m"],
        "end_snap_m": last["end_snap_m"],
        "route_legs_json": json.dumps(legs, ensure_ascii=False, sort_keys=True),
        "recipe_sha256": fingerprints[0],
        "filter_sha256": fingerprints[1],
        "override_sha256": source_hashes["assembledOverridesSha256"],
        "raw_station_sha256": source_hashes["rawStationSha256"],
        "raw_section_sha256": source_hashes["rawSectionSha256"],
        "distance_source_sha256": source_distance_hash,
        "status": "pass",
        "notes": "Raw N02 route measurement with frozen owner chain.",
    }


def _service_distance_source_hash(
    root: Path, overrides_dir: Path, service_id: str
) -> str:
    return hash_value(_distance_reference(root, overrides_dir, service_id))


def _evidence_source_hashes(
    root: Path,
    service_ids: list[str],
    preflight_report: dict[str, Any],
) -> dict[str, Any]:
    assembled = root / ASSEMBLED_PATH
    overrides_dir = assembled / "overrides"
    if not overrides_dir.is_dir():
        raise StageError(f"assembled overrides are missing: {overrides_dir}")
    expected_inputs = _build_inputs_report(root, preflight_report)
    saved_inputs = read_json(assembled / "inputs-sha256.json")
    if saved_inputs != expected_inputs:
        raise StageError(
            "assembled inputs are stale; rerun S4 assemble before measuring"
        )
    verification = read_json(assembled / "verification.json")
    if verification.get("status") != "verified":
        raise StageError("assembled verification is not complete")
    nonjr._check_raw_checksums(root)
    raw_station_hash, raw_section_hash = nonjr._source_hashes(root)
    source_directories, _ = _load_source_sets(
        root, [row["service_id"] for row in _load_frozen_catalog(root)[2]]
    )
    distance_sources: dict[str, str] = {}
    for service_id in service_ids:
        source = source_directories.get(service_id)
        if source is None:
            raise StageError(f"staging owner is missing for {service_id}")
        distance_sources[service_id] = _service_distance_source_hash(
            root, source["overrides"], service_id
        )
    return {
        "assembledOverridesSha256": nonjr._component_file_hash(overrides_dir),
        "rawStationSha256": raw_station_hash,
        "rawSectionSha256": raw_section_hash,
        "freezeManifestSha256": sha256_file(root / FREEZE_PATH),
        "catalogSha256": sha256_file(root / CATALOG_PATH),
        "servicesSha256": sha256_file(root / SERVICES_PATH),
        "assemblyInputsSha256": hash_value(saved_inputs),
        "distanceSources": distance_sources,
    }


def _validate_evidence_files(
    evidence_path: Path,
    manifest_path: Path,
    batch: str,
    expected_pairs: list[tuple[str, str, str]],
    current_sources: dict[str, Any],
) -> dict[str, Any]:
    if not evidence_path.is_file() or not manifest_path.is_file():
        raise StageError(f"evidence batch is incomplete: {batch}")
    raw_bytes = evidence_path.read_bytes()
    if b"\r" in raw_bytes:
        raise StageError(f"evidence CSV is not LF-only: {evidence_path}")
    manifest = read_json(manifest_path)
    if manifest.get("formatVersion") != 1 or manifest.get("batch") != batch:
        raise StageError(f"evidence manifest has an invalid batch identity: {batch}")
    if manifest.get("pairEvidenceSha256") != hashlib.sha256(raw_bytes).hexdigest():
        raise StageError(f"evidence CSV was tampered: {batch}")
    if manifest.get("sourceHashes") != current_sources:
        raise StageError(f"evidence batch has stale input hashes: {batch}")
    if manifest.get("expectedPairKeysSha256") != hash_value(expected_pairs):
        raise StageError(f"evidence manifest has stale expected pair coverage: {batch}")
    fields, rows = read_csv(evidence_path)
    if fields != EVIDENCE_FIELDS:
        raise StageError(f"evidence CSV schema differs: {batch}")
    if manifest.get("pairCount") != len(rows):
        raise StageError(f"evidence manifest row count differs: {batch}")
    expected_services = list(dict.fromkeys(key[0] for key in expected_pairs))
    if manifest.get("serviceIds") != expected_services:
        raise StageError(f"evidence manifest service inventory differs: {batch}")
    actual_pairs: list[tuple[str, str, str]] = []
    for row in rows:
        key = (row["service_id"], row["from_id"], row["to_id"])
        actual_pairs.append(key)
        if row["status"] != "pass":
            raise StageError(
                f"evidence contains an unsuccessful route: {key}: {row['notes']}"
            )
        if row["route_kind"] not in {"route", "compose"}:
            raise StageError(f"evidence route kind is invalid for {key}")
        if row["override_sha256"] != current_sources["assembledOverridesSha256"]:
            raise StageError(f"evidence override hash is stale for {key}")
        if row["raw_station_sha256"] != current_sources["rawStationSha256"]:
            raise StageError(f"evidence raw station hash is stale for {key}")
        if row["raw_section_sha256"] != current_sources["rawSectionSha256"]:
            raise StageError(f"evidence raw section hash is stale for {key}")
        if row["distance_source_sha256"] != current_sources["distanceSources"].get(
            row["service_id"]
        ):
            raise StageError(f"evidence distance source hash is stale for {key}")
    duplicates = sorted({key for key in actual_pairs if actual_pairs.count(key) > 1})
    if duplicates:
        raise StageError(f"evidence contains duplicated pairs: {duplicates}")
    expected_set = set(expected_pairs)
    actual_set = set(actual_pairs)
    missing = sorted(expected_set - actual_set)
    unexpected = sorted(actual_set - expected_set)
    if missing or unexpected:
        raise StageError(
            "evidence pair coverage differs: "
            f"missing={missing[:12]}, unexpected={unexpected[:12]}"
        )
    if actual_pairs != expected_pairs:
        raise StageError(f"evidence frozen pair order differs: {batch}")
    return {"status": "verified", "batch": batch, "pairs": len(rows)}


def _pair_route_identity(
    primitives: tuple[tuple[str, str, str, bool], ...],
) -> list[dict[str, Any]]:
    return [
        {
            "ownerServiceId": owner_id,
            "fromId": origin,
            "toId": destination,
            "reversed": reverse,
        }
        for owner_id, origin, destination, reverse in primitives
    ]


def _validate_route_fingerprints(
    rows: list[dict[str, str]],
    overrides: Overrides,
    oracle: dict[str, Any],
    catalog_by_service: dict[str, list[dict[str, str]]],
) -> None:
    pair_indexes = {
        (service_id, origin, destination): pair_index
        for service_id in catalog_by_service
        for pair_index, (origin, destination) in enumerate(
            station_pairs(
                [row["station_id_proposed"] for row in catalog_by_service[service_id]],
                oracle["circularByService"][service_id],
            )
        )
    }
    for row in rows:
        key = (row["service_id"], row["from_id"], row["to_id"])
        pair_index = pair_indexes[key]
        service = overrides.service(row["service_id"])
        primitives = _pair_primitives(overrides, service, pair_index)
        expected_recipe, expected_filter = _pair_fingerprints(
            overrides, service, pair_index, primitives, catalog_by_service
        )
        if row["recipe_sha256"] != expected_recipe:
            raise StageError(f"evidence recipe hash is stale for {key}")
        if row["filter_sha256"] != expected_filter:
            raise StageError(f"evidence filter hash is stale for {key}")
        try:
            recorded_legs = json.loads(row["route_legs_json"])
        except json.JSONDecodeError as error:
            raise StageError(f"evidence route chain is invalid for {key}") from error
        actual_identity = (
            [
                {
                    "ownerServiceId": leg.get("ownerServiceId"),
                    "fromId": leg.get("fromId"),
                    "toId": leg.get("toId"),
                    "reversed": leg.get("reversed"),
                }
                for leg in recorded_legs
                if isinstance(leg, dict)
            ]
            if isinstance(recorded_legs, list)
            else []
        )
        if actual_identity != _pair_route_identity(primitives):
            raise StageError(f"evidence exact route chain differs for {key}")


def _evidence_context(
    root: Path, batch: str
) -> tuple[
    dict[str, Any],
    dict[str, Any],
    list[dict[str, str]],
    list[str],
    list[tuple[str, str, str]],
    dict[str, Any],
    Overrides,
]:
    preflight_report = preflight(root=root)
    freeze, catalog, frozen_services = _load_frozen_catalog(root)
    oracle = _oracle(freeze, catalog, frozen_services)
    catalog_by_service = oracle["catalogByService"]
    service_ids = _batch_service_ids(
        root, batch, freeze, frozen_services, catalog_by_service
    )
    expected_pairs = _batch_pairs(batch, service_ids, freeze, oracle)
    evidence_service_ids = list(dict.fromkeys(pair[0] for pair in expected_pairs))
    if not expected_pairs:
        raise StageError(f"evidence batch has no frozen route pairs: {batch}")
    source_hashes = _evidence_source_hashes(
        root, evidence_service_ids, preflight_report
    )
    overrides = load_overrides(root / ASSEMBLED_PATH / "overrides")
    return (
        freeze,
        oracle,
        catalog,
        service_ids,
        expected_pairs,
        source_hashes,
        overrides,
    )


def measure_pairs(
    batch: str, *, root: Path = ROOT, out_dir: Path | None = None
) -> dict[str, Any]:
    """Measure one frozen batch and write only its evidence directory."""
    (
        _freeze,
        oracle,
        _catalog,
        service_ids,
        expected_pairs,
        source_hashes,
        overrides,
    ) = _evidence_context(root, batch)
    catalog_by_service = oracle["catalogByService"]
    destination = (
        out_dir if out_dir is not None else root / ASSEMBLED_PATH / "evidence" / batch
    )
    if not destination.is_absolute():
        destination = root / destination
    destination = destination.resolve()
    if destination.exists():
        return check_evidence(batch, root=root, evidence_dir=destination)
    if not expected_pairs:
        raise StageError(f"evidence batch has no route pairs: {batch}")
    provider = N02SourceProvider(
        root / "N02-25_GML/UTF-8", overrides.dataset.candidate_search_bbox
    )
    rows: list[dict[str, str]] = []
    pair_indexes = {
        (service_id, origin, destination): pair_index
        for service_id in service_ids
        for pair_index, (origin, destination) in enumerate(
            station_pairs(
                [row["station_id_proposed"] for row in catalog_by_service[service_id]],
                oracle["circularByService"][service_id],
            )
        )
    }
    try:
        for service_id, origin, destination_id in expected_pairs:
            pair_index = pair_indexes[(service_id, origin, destination_id)]
            row = _measure_batch_pair(
                overrides,
                service_id,
                pair_index,
                provider,
                catalog_by_service,
                root,
                source_hashes,
            )
            rows.append({field: str(row.get(field, "")) for field in EVIDENCE_FIELDS})
        _, _, frozen_services = _load_frozen_catalog(root)
        source_directories, _ = _load_source_sets(
            root, [row["service_id"] for row in frozen_services]
        )
        evidence_service_ids = list(dict.fromkeys(pair[0] for pair in expected_pairs))
        _check_batch_length_tolerances(
            root, evidence_service_ids, source_directories, rows
        )
        destination.mkdir(parents=True)
        temporary = destination / ".measurement.tmp"
        temporary.mkdir()
        evidence_path = temporary / EVIDENCE_FILE
        write_csv(evidence_path, EVIDENCE_FIELDS, rows)
        manifest = {
            "formatVersion": 1,
            "batch": batch,
            "serviceIds": list(dict.fromkeys(pair[0] for pair in expected_pairs)),
            "pairCount": len(rows),
            "expectedPairKeysSha256": hash_value(expected_pairs),
            "pairEvidenceSha256": sha256_file(evidence_path),
            "sourceHashes": source_hashes,
        }
        write_json(temporary / EVIDENCE_MANIFEST, manifest)
        _validate_evidence_files(
            evidence_path,
            temporary / EVIDENCE_MANIFEST,
            batch,
            expected_pairs,
            source_hashes,
        )
        _validate_route_fingerprints(rows, overrides, oracle, catalog_by_service)
        (temporary / EVIDENCE_FILE).rename(destination / EVIDENCE_FILE)
        (temporary / EVIDENCE_MANIFEST).rename(destination / EVIDENCE_MANIFEST)
        shutil.rmtree(temporary)
    except Exception:
        if destination.exists():
            shutil.rmtree(destination)
        raise
    return check_evidence(batch, root=root, evidence_dir=destination)


def check_evidence(
    batch: str, *, root: Path = ROOT, evidence_dir: Path | None = None
) -> dict[str, Any]:
    """Reject changed, stale, uncovered, duplicated or re-routed batch evidence."""
    (
        _freeze,
        oracle,
        _catalog,
        service_ids,
        expected_pairs,
        source_hashes,
        overrides,
    ) = _evidence_context(root, batch)
    destination = evidence_dir or root / ASSEMBLED_PATH / "evidence" / batch
    if not destination.is_absolute():
        destination = root / destination
    evidence_path = destination / EVIDENCE_FILE
    manifest_path = destination / EVIDENCE_MANIFEST
    result = _validate_evidence_files(
        evidence_path, manifest_path, batch, expected_pairs, source_hashes
    )
    _, rows = read_csv(evidence_path)
    _validate_route_fingerprints(rows, overrides, oracle, oracle["catalogByService"])
    expected_service_ids = set(pair[0] for pair in expected_pairs)
    if set(row["service_id"] for row in rows) != expected_service_ids:
        raise StageError(f"evidence batch service coverage differs: {batch}")
    return result
