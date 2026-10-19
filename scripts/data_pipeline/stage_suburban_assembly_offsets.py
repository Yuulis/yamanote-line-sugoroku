"""Derive and audit D1-merge platform offset exceptions for S4 assembly."""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shapely.geometry import Point

from scripts.data_pipeline import build, config, rules, validate
from scripts.data_pipeline.constraints import OffsetException
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.rules import Report
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    hash_tree,
    read_csv,
    read_json,
    write_csv,
    write_json,
)

ROOT = Path(__file__).resolve().parents[2]
ASSEMBLED_PATH = "data/staging/tokyo-suburban-assembled"
OFFSET_FIELDS = [
    "service_id",
    "station_id",
    "max_platform_offset_m",
    "reason",
]
DEFAULT_LIMIT_M = config.DEFAULT_MAX_PLATFORM_OFFSET_M
D1_BOUND_M = 600.0
LIMIT_STEP_M = 10.0
LIMIT_MARGIN_M = 10.0
MEASUREMENT_DECIMALS = 6


@dataclass(frozen=True)
class OffsetObservation:
    """A's offset and its source service's verified pre-merge offset check."""

    service_id: str
    station_id: str
    member_original_id: str
    d1_group_id: str | None
    measured_a_offset_m: float
    pre_merge_offset_m: float
    pre_merge_limit_m: float
    pre_merge_passed: bool
    source_stage: str
    source_group: str
    source_component: str


@dataclass(frozen=True)
class PremergeSourceMetrics:
    """Typed measurements retained from one validated S2 or S3 source build."""

    stage: str
    group: str
    component: str
    representatives: dict[str, Point]
    platforms: dict[tuple[str, str], Point]
    exceptions: dict[tuple[str, str], OffsetException]


def _format_meters(value: float) -> str:
    return f"{value:.{MEASUREMENT_DECIMALS}f}"


def _format_limit(value: float) -> str:
    return f"{value:g}"


def _exception_key(row: dict[str, str]) -> tuple[str, str]:
    return row["service_id"], row["station_id"]


def _d1_reason(observation: OffsetObservation, previous_limit_m: float | None) -> str:
    previous = (
        f"; previous exception limit={_format_limit(previous_limit_m)} m"
        if previous_limit_m is not None
        else ""
    )
    return (
        "d1-merge: "
        f"frozen D1 group={observation.d1_group_id}; "
        f"member original id={observation.member_original_id}; "
        f"measured A offset={_format_meters(observation.measured_a_offset_m)} m; "
        f"pre-merge offset={_format_meters(observation.pre_merge_offset_m)} m "
        f"within limit={_format_limit(observation.pre_merge_limit_m)} m; "
        f"frozen D1 bound={_format_limit(D1_BOUND_M)} m; "
        "limit formula=measured offset rounded up to 10 m plus 10 m"
        f"{previous}."
    )


def _expected_limit(measured_offset_m: float) -> float:
    return math.ceil(measured_offset_m / LIMIT_STEP_M) * LIMIT_STEP_M + LIMIT_MARGIN_M


def derive_offset_exceptions(
    observations: list[OffsetObservation],
    existing_rows: list[dict[str, str]],
    service_order: list[str],
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Derive merge exceptions and a report of dropped or replaced source rows."""
    observation_by_key = {
        (item.service_id, item.station_id): item for item in observations
    }
    if len(observation_by_key) != len(observations):
        raise StageError("duplicate service/station offset observation")
    existing_by_key = {_exception_key(row): row for row in existing_rows}
    if len(existing_by_key) != len(existing_rows):
        raise StageError("duplicate source offset exception after identity merge")
    extra_keys = sorted(set(existing_by_key) - set(observation_by_key))
    if extra_keys:
        raise StageError(f"offset exceptions have no measured platform: {extra_keys}")

    service_rank = {service_id: index for index, service_id in enumerate(service_order)}
    ordered = sorted(
        observations,
        key=lambda item: (
            service_rank.get(item.service_id, len(service_rank)),
            item.station_id,
        ),
    )
    output_rows: list[dict[str, str]] = []
    d1_rows: list[dict[str, Any]] = []
    changed_rows: list[dict[str, Any]] = []
    preserved_rows: list[dict[str, Any]] = []
    for observation in ordered:
        key = (observation.service_id, observation.station_id)
        previous = existing_by_key.get(key)
        is_d1_group = observation.d1_group_id is not None
        if is_d1_group and observation.d1_group_id != observation.station_id:
            raise StageError(
                f"D1 group id differs from merged station id for {key}: "
                f"{observation.d1_group_id}"
            )

        measured = observation.measured_a_offset_m
        if measured > DEFAULT_LIMIT_M:
            if not is_d1_group:
                if previous is not None:
                    previous_limit = float(previous["max_platform_offset_m"])
                    if (
                        previous["reason"].startswith("d1-merge:")
                        or measured > previous_limit
                        or not observation.pre_merge_passed
                    ):
                        raise StageError(
                            "non-merge offset is not covered by its passing source "
                            f"exception: {observation.service_id}/{observation.station_id} "
                            f"({measured:.3f} m; source limit {previous_limit:g} m); "
                            "STOP for lead review"
                        )
                    output_rows.append(dict(previous))
                    preserved_rows.append(
                        {
                            "serviceId": observation.service_id,
                            "stationId": observation.station_id,
                            "sourceStage": observation.source_stage,
                            "sourceGroup": observation.source_group,
                            "sourceComponent": observation.source_component,
                            "limitM": previous_limit,
                            "measuredAOffsetM": round(measured, MEASUREMENT_DECIMALS),
                            "reason": previous["reason"],
                        }
                    )
                    continue
                raise StageError(
                    f"offset exceeds {DEFAULT_LIMIT_M:g} m outside a merged D1 group: "
                    f"{observation.service_id}/{observation.station_id} "
                    f"({measured:.3f} m); STOP for lead review"
                )
            if measured > D1_BOUND_M:
                raise StageError(
                    f"{observation.service_id}/{observation.station_id} offset "
                    f"{measured:.3f} m exceeds the frozen 600 m bound; "
                    "STOP for lead review"
                )
            if (
                not observation.pre_merge_passed
                or observation.pre_merge_offset_m > observation.pre_merge_limit_m
            ):
                raise StageError(
                    "pre-merge offset check did not pass for "
                    f"{observation.service_id}/{observation.member_original_id}: "
                    f"{observation.pre_merge_offset_m:.3f} m > "
                    f"{observation.pre_merge_limit_m:g} m; STOP for lead review"
                )
            if previous and math.isclose(
                measured, observation.pre_merge_offset_m, rel_tol=0.0, abs_tol=1e-6
            ):
                previous_limit = float(previous["max_platform_offset_m"])
                if measured > previous_limit:
                    raise StageError(
                        "unchanged pre-merge offset exceeds its saved exception: "
                        f"{observation.service_id}/{observation.station_id} "
                        f"({measured:.3f} m > {previous_limit:g} m)"
                    )
                output_rows.append(dict(previous))
                preserved_rows.append(
                    {
                        "serviceId": observation.service_id,
                        "stationId": observation.station_id,
                        "sourceStage": observation.source_stage,
                        "sourceGroup": observation.source_group,
                        "sourceComponent": observation.source_component,
                        "limitM": previous_limit,
                        "measuredAOffsetM": round(measured, MEASUREMENT_DECIMALS),
                        "reason": previous["reason"],
                    }
                )
                continue
            limit_m = _expected_limit(measured)
            reason = _d1_reason(
                observation,
                float(previous["max_platform_offset_m"]) if previous else None,
            )
            output_rows.append(
                {
                    "service_id": observation.service_id,
                    "station_id": observation.station_id,
                    "max_platform_offset_m": _format_limit(limit_m),
                    "reason": reason,
                }
            )
            d1_rows.append(
                {
                    "serviceId": observation.service_id,
                    "stationId": observation.station_id,
                    "d1GroupId": observation.d1_group_id,
                    "memberOriginalId": observation.member_original_id,
                    "measuredAOffsetM": round(measured, MEASUREMENT_DECIMALS),
                    "preMergeOffsetM": round(
                        observation.pre_merge_offset_m, MEASUREMENT_DECIMALS
                    ),
                    "preMergeLimitM": observation.pre_merge_limit_m,
                    "limitM": limit_m,
                    "previousExceptionLimitM": (
                        float(previous["max_platform_offset_m"]) if previous else None
                    ),
                    "sourceStage": observation.source_stage,
                    "sourceGroup": observation.source_group,
                    "sourceComponent": observation.source_component,
                }
            )
            if previous:
                changed_rows.append(
                    {
                        "action": "replaced",
                        "serviceId": observation.service_id,
                        "stationId": observation.station_id,
                        "sourceStage": observation.source_stage,
                        "sourceGroup": observation.source_group,
                        "sourceComponent": observation.source_component,
                        "previousLimitM": float(previous["max_platform_offset_m"]),
                        "previousReason": previous["reason"],
                        "measuredAOffsetM": round(measured, MEASUREMENT_DECIMALS),
                        "explanation": "Identity merge changed the measured station offset.",
                    }
                )
            continue

        if previous is None:
            continue
        if not is_d1_group:
            raise StageError(
                "unused offset exception is not explained by a D1 merge: "
                f"{observation.service_id}/{observation.station_id} "
                f"({measured:.3f} m); STOP for lead review"
            )
        changed_rows.append(
            {
                "action": "dropped",
                "serviceId": observation.service_id,
                "stationId": observation.station_id,
                "sourceStage": observation.source_stage,
                "sourceGroup": observation.source_group,
                "sourceComponent": observation.source_component,
                "previousLimitM": float(previous["max_platform_offset_m"]),
                "previousReason": previous["reason"],
                "measuredAOffsetM": round(measured, MEASUREMENT_DECIMALS),
                "explanation": (
                    "The merged A offset is within the global 250 m limit."
                ),
            }
        )

    review = {
        "status": "derived",
        "defaultLimitM": DEFAULT_LIMIT_M,
        "frozenD1BoundM": D1_BOUND_M,
        "limitFormula": "ceil(measuredOffsetM / 10) * 10 + 10",
        "d1MergeRows": d1_rows,
        "preservedExistingRows": preserved_rows,
        "droppedOrReplacedRows": changed_rows,
    }
    return output_rows, review


def audit_offset_exceptions(
    observations: list[OffsetObservation],
    existing_rows: list[dict[str, str]],
    service_order: list[str],
    actual_rows: list[dict[str, str]],
    actual_review: dict[str, Any],
) -> None:
    """Reject missing, stale, invalid or unrecorded D1-merge exception rows."""
    expected_rows, expected_review = derive_offset_exceptions(
        observations, existing_rows, service_order
    )
    if actual_rows != expected_rows:
        expected_by_key = {_exception_key(row): row for row in expected_rows}
        actual_by_key = {_exception_key(row): row for row in actual_rows}
        missing = sorted(set(expected_by_key) - set(actual_by_key))
        stale = sorted(
            key
            for key in set(expected_by_key) & set(actual_by_key)
            if expected_by_key[key] != actual_by_key[key]
        )
        extra = sorted(set(actual_by_key) - set(expected_by_key))
        raise StageError(
            "offset exception rows do not match the re-derived offsets: "
            f"missing={missing}, stale={stale}, extra={extra}"
        )
    if actual_review != expected_review:
        raise StageError(
            "offset-review.json is stale or differs from the re-derived offsets"
        )


def _metric_points(
    stations: list[dict[str, Any]], services: list[dict[str, Any]]
) -> tuple[dict[str, Point], dict[tuple[str, str], Point]]:
    representatives = {
        row["id"]: Point(validate.to_metric(row["coordinates"])) for row in stations
    }
    platforms = {
        (service["id"], station_id): Point(validate.to_metric(coordinate))
        for service in services
        for station_id, coordinate in service["platformCoordinates"].items()
    }
    return representatives, platforms


def _service_rows(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        rows = value.get("services")
        if isinstance(rows, list):
            return rows
    if isinstance(value, list):
        return value
    raise StageError("build output services.json has an invalid shape")


def _source_build_paths(
    root: Path, overrides_dir: Path
) -> tuple[Path, Path, str, str, str]:
    relative = overrides_dir.relative_to(root).parts
    if relative == (
        "data",
        "staging",
        "tokyo-suburban-jr",
        "combined",
        "overrides",
    ):
        base = root / ".claude/logs/s2"
        return (
            base / "combined-a",
            base / "combined-b",
            "S2",
            "jr",
            "combined",
        )
    try:
        nonjr_index = relative.index("tokyo-suburban-nonjr")
        group = relative[nonjr_index + 1]
        component_index = relative.index("components")
        component = relative[component_index + 1]
    except (ValueError, IndexError) as error:
        raise StageError(
            f"unsupported pre-merge source path: {overrides_dir}"
        ) from error
    base = root / ".claude/logs/s3" / group / component
    return base / "a", base / "b", "S3", group, component


def _verify_saved_source_build(
    root: Path,
    overrides_dir: Path,
    build_a: Path,
    build_b: Path,
    source_stage: str,
    source_group: str,
    source_component: str,
) -> None:
    if not build_a.is_dir() or not build_b.is_dir():
        raise StageError(
            f"pre-merge {source_stage} A/B builds are missing for "
            f"{source_group}/{source_component}"
        )
    hashes_a = hash_tree(build_a)
    hashes_b = hash_tree(build_b)
    if hashes_a != hashes_b:
        raise StageError(
            f"pre-merge {source_stage} A/B builds differ for "
            f"{source_group}/{source_component}"
        )
    if source_stage == "S3":
        handoff = read_json(
            root
            / "data/staging/tokyo-suburban-nonjr"
            / source_group
            / "gate-report.json"
        )
        component_report = handoff.get("components", {}).get(source_component)
        if not isinstance(component_report, dict):
            raise StageError(f"S3 gate report lacks {source_group}/{source_component}")
        outputs = component_report.get("outputs", {})
        if outputs.get("a") != hashes_a or outputs.get("b") != hashes_b:
            raise StageError(
                f"S3 saved build is stale for {source_group}/{source_component}"
            )
    else:
        result = build.build(root / "N02-25_GML/UTF-8", overrides_dir)
        if result.files != {
            path.name: path.read_text(encoding="utf-8")
            for path in sorted(build_a.iterdir())
            if path.is_file()
        }:
            raise StageError(
                "saved S2 combined build differs from its current overrides"
            )

    overrides = load_overrides(overrides_dir)
    dataset = validate.load_dataset(build_a)
    findings = validate.validate_dataset(dataset, overrides)
    if not findings.ok:
        raise StageError(
            f"pre-merge {source_stage} validation did not pass for "
            f"{source_group}/{source_component}: " + "; ".join(findings.errors)
        )


def _premerge_metrics(
    root: Path,
    overrides_dir: Path,
    service_id: str,
    station_id_original: str,
    source_cache: dict[Path, PremergeSourceMetrics],
) -> tuple[float, float, bool, str, str, str]:
    cached = source_cache.get(overrides_dir)
    if cached is None:
        build_a, build_b, stage, group, component = _source_build_paths(
            root, overrides_dir
        )
        _verify_saved_source_build(
            root, overrides_dir, build_a, build_b, stage, group, component
        )
        artifact = validate.load_dataset(build_a)
        overrides = load_overrides(overrides_dir)
        services = _service_rows(artifact.services)
        representatives, platforms = _metric_points(artifact.stations, services)
        report = Report()
        rules.check_platform_offsets(
            platforms,
            representatives,
            overrides.offset_exceptions,
            report,
        )
        if report.errors:
            raise StageError(
                f"pre-merge offset check did not pass for {group}/{component}: "
                + "; ".join(report.errors)
            )
        exceptions = {
            (item.service_id, item.station_id): item
            for item in overrides.offset_exceptions
        }
        cached = PremergeSourceMetrics(
            stage=stage,
            group=group,
            component=component,
            representatives=representatives,
            platforms=platforms,
            exceptions=exceptions,
        )
        source_cache[overrides_dir] = cached

    key = (service_id, station_id_original)
    platform = cached.platforms.get(key)
    representative = cached.representatives.get(station_id_original)
    if platform is None or representative is None:
        raise StageError(
            "pre-merge build lacks the service platform or representative: "
            f"{service_id}/{station_id_original}"
        )
    measured = platform.distance(representative)
    exception = cached.exceptions.get(key)
    limit = exception.max_platform_offset_m if exception else DEFAULT_LIMIT_M
    passed = measured <= limit and (exception is None or measured > DEFAULT_LIMIT_M)
    return (
        measured,
        limit,
        passed,
        cached.stage,
        cached.group,
        cached.component,
    )


def _make_observations(
    root: Path,
    stations: list[dict[str, Any]],
    services_value: Any,
) -> tuple[list[OffsetObservation], list[str]]:
    from scripts.data_pipeline import stage_suburban_assembly as assembly

    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    sources, _ = assembly._load_source_sets(
        root, [row["service_id"] for row in frozen_services]
    )
    services = _service_rows(services_value)
    representatives, platforms = _metric_points(stations, services)
    service_output = {row["id"]: row for row in services}
    frozen_by_service_station = {
        (row["service_id"], row["station_id_proposed"]): row
        for row in oracle["identityRows"]
    }
    source_cache: dict[Path, PremergeSourceMetrics] = {}
    observations: list[OffsetObservation] = []
    for service in services:
        service_id = service["id"]
        for station_id in service["stationIds"]:
            frozen = frozen_by_service_station.get((service_id, station_id))
            platform = platforms.get((service_id, station_id))
            representative = representatives.get(station_id)
            if frozen is None or platform is None or representative is None:
                raise StageError(
                    f"A build lacks a frozen platform offset input: {service_id}/{station_id}"
                )
            original_id = frozen["station_id_original"]
            members = oracle["catalogByTarget"][station_id]
            original_ids = {row["station_id_original"] for row in members}
            d1_group_id = station_id if len(original_ids) > 1 else None
            source = sources[service_id]
            premerge = _premerge_metrics(
                root,
                source["overrides"],
                service_id,
                original_id,
                source_cache,
            )
            pre_offset, pre_limit, pre_passed, stage, group, component = premerge
            observations.append(
                OffsetObservation(
                    service_id=service_id,
                    station_id=station_id,
                    member_original_id=original_id,
                    d1_group_id=d1_group_id,
                    measured_a_offset_m=platform.distance(representative),
                    pre_merge_offset_m=pre_offset,
                    pre_merge_limit_m=pre_limit,
                    pre_merge_passed=pre_passed,
                    source_stage=stage,
                    source_group=group,
                    source_component=component,
                )
            )
    service_order = [row["id"] for row in services]
    if service_order != [row["service_id"] for row in frozen_services]:
        raise StageError("A service order differs from the frozen S2/S3 inventory")
    if set(service_output) != set(service_order):
        raise StageError("A service inventory differs from the frozen S2/S3 inventory")
    return observations, service_order


def _derive_for_artifact(
    root: Path,
    stations: list[dict[str, Any]],
    services: Any,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    from scripts.data_pipeline import stage_suburban_assembly as assembly
    from scripts.data_pipeline.stage_suburban_assembly_identity import (
        EXCEPTION_KEYS,
        collect_exception_rows,
    )

    observations, service_order = _make_observations(root, stations, services)
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    fields, existing_rows = collect_exception_rows(
        assembly._source_directories(root),
        oracle["byService"],
        "offset_exceptions.csv",
        EXCEPTION_KEYS["offset_exceptions.csv"],
    )
    if fields != OFFSET_FIELDS:
        raise StageError("S2/S3 offset exception schema is missing or changed")
    return derive_offset_exceptions(observations, existing_rows, service_order)


def _payload_dataset(files: dict[str, str]) -> validate.Dataset:
    return validate.Dataset(
        stations=json.loads(files[config.STATIONS_FILE]),
        services=json.loads(files[config.SERVICES_FILE]),
        segments=json.loads(files[config.SEGMENTS_FILE]),
        geojson=json.loads(files[config.SEGMENTS_GEOJSON_FILE]),
        manifest=json.loads(files[config.MANIFEST_FILE]),
        payloads={name: files[name] for name in validate.GAME_DATA_FILES},
        manifest_payload=files[config.MANIFEST_FILE],
    )


def _is_offset_finding(message: str) -> bool:
    return message.startswith("unused offset exception ") or (
        " platform at " in message and " from the station point (limit " in message
    )


def generate_offsets(*, root: Path = ROOT) -> dict[str, Any]:
    """Build A in memory, validate non-offset rules, and write only offset outputs."""
    from scripts.data_pipeline import stage_suburban_assembly as assembly

    preflight_report = assembly.preflight(root=root)
    overrides_dir = root / ASSEMBLED_PATH / "overrides"
    if not overrides_dir.is_dir():
        raise StageError("assembled overrides are missing; run assemble first")
    saved_inputs = read_json(root / ASSEMBLED_PATH / "inputs-sha256.json")
    if saved_inputs != assembly._build_inputs_report(root, preflight_report):
        raise StageError("assembled inputs are stale; rerun assemble")
    result = build.build(root / "N02-25_GML/UTF-8", overrides_dir)
    dataset = _payload_dataset(result.files)
    findings = validate.validate_dataset(dataset, load_overrides(overrides_dir))
    non_offset = [item for item in findings.errors if not _is_offset_finding(item)]
    if non_offset:
        raise StageError(
            "non-offset validator findings block D1 offset generation: "
            + "; ".join(non_offset)
        )
    expected_rows, review = _derive_for_artifact(
        root, dataset.stations, dataset.services
    )
    write_csv(overrides_dir / "offset_exceptions.csv", OFFSET_FIELDS, expected_rows)
    write_json(root / ASSEMBLED_PATH / "offset-review.json", review)
    return {
        "status": "written",
        "d1MergeRows": review["d1MergeRows"],
        "droppedOrReplacedRows": review["droppedOrReplacedRows"],
    }


def audit_artifact(root: Path, stations: list[dict[str, Any]], services: Any) -> None:
    """Re-derive every offset row against a built artifact and saved S2/S3 checks."""
    from scripts.data_pipeline import stage_suburban_assembly as assembly
    from scripts.data_pipeline.stage_suburban_assembly_identity import (
        EXCEPTION_KEYS,
        collect_exception_rows,
    )

    overrides_dir = root / ASSEMBLED_PATH / "overrides"
    _, actual_rows = read_csv(overrides_dir / "offset_exceptions.csv")
    actual_review = read_json(root / ASSEMBLED_PATH / "offset-review.json")
    observations, service_order = _make_observations(root, stations, services)
    freeze, catalog, frozen_services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, frozen_services)
    fields, source_rows = collect_exception_rows(
        assembly._source_directories(root),
        oracle["byService"],
        "offset_exceptions.csv",
        EXCEPTION_KEYS["offset_exceptions.csv"],
    )
    if fields != OFFSET_FIELDS:
        raise StageError("S2/S3 offset exception schema is missing or changed")
    audit_offset_exceptions(
        observations,
        source_rows,
        service_order,
        actual_rows,
        actual_review,
    )


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(arguments)
    try:
        result = generate_offsets(root=args.root)
    except (OSError, KeyError, StageError, TypeError, ValueError) as error:
        print(f"FAIL {error}")
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
