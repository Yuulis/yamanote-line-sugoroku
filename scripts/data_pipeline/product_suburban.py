"""Prepare and verify the frozen Tokyo suburban product bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
from pathlib import Path
from typing import Any

from scripts.data_pipeline import budgets, config, export, validate
from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline import stage_suburban_assembly_gate as assembly_gate
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.product_suburban_inputs import (
    ASSEMBLED_PATH,
    FREEZE_PATH,
    PAYLOAD_FILES,
    PRODUCT_FILES,
    ROOT,
    _check_s4_payload_hashes,
    check_composition_report,
    check_identity_sidecar,
    check_metadata_sidecar,
    check_shared_track_sidecar,
    check_ui_groups_sidecar,
    expected_identity_rows,
    expected_metadata_rows,
    expected_shared_track_review,
    expected_ui_groups,
    read_json,
    validate_mileage_arithmetic,
    verify_history,
    verify_inputs,
)
from scripts.data_pipeline.product_suburban_presentation import (
    PRESENTATION_FILE,
    build_ui_presentation,
    compact_json,
    require_same_presentation,
)
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    hash_tree,
    sha256_file,
    write_json,
)

S5_LOGS_PATH = Path(".claude/logs/s5")
SIMULATION_CODE_FILES = (
    "src/data/guards.ts",
    "src/features/game/engine/config.ts",
    "src/features/game/engine/errors.ts",
    "src/features/game/engine/game.ts",
    "src/features/game/engine/goal.ts",
    "src/features/game/engine/index.ts",
    "src/features/game/engine/landing.ts",
    "src/features/game/engine/movement.ts",
    "src/features/game/engine/network.ts",
    "src/features/game/engine/proximity.ts",
    "src/features/game/engine/rng.ts",
    "src/features/game/engine/types.ts",
    "src/features/game/gameConfig.ts",
    "src/types/network.ts",
    "tests/simulation/harness.ts",
    "tests/simulation/inputs.ts",
    "tests/simulation/measurement.test.ts",
    "tests/simulation/suburban-product.test.ts",
)
SIMULATION_OFFSETS = (0, 1250, 2500, 3750)
SIMULATION_GAMES_PER_SHARD = 1250
SIMULATION_BASE_SEED = 20261012
SIMULATION_TURN_CAP = 20000
__all__ = [
    "ASSEMBLED_PATH",
    "FREEZE_PATH",
    "PAYLOAD_FILES",
    "PRODUCT_FILES",
    "ROOT",
    "check_composition_report",
    "check_identity_sidecar",
    "check_metadata_sidecar",
    "check_shared_track_sidecar",
    "check_ui_groups_sidecar",
    "expected_identity_rows",
    "expected_metadata_rows",
    "expected_shared_track_review",
    "expected_ui_groups",
    "read_json",
    "validate_mileage_arithmetic",
    "verify_history",
    "verify_inputs",
]


def _rooted(root: Path, relative: str | Path) -> Path:
    path = Path(relative)
    return path if path.is_absolute() else root / path


def product_dataset(
    source: dict[str, Any], freeze: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Apply only the frozen S5 gameplay and product metadata changes."""
    if source.get("validationProfile") != "stage":
        raise StageError("S4 source overrides do not use the stage profile")
    if source.get("stageStartStationId") != "shimbashi":
        raise StageError("S4 stage start differs from the frozen start station")
    ruleset = freeze["ruleset"]
    replacements = {
        "validationProfile": "gameplay",
        "startStationId": ruleset["startStationId"],
        "targetServiceId": ruleset["targetServiceId"],
        "operator": "Tokyo suburban rail operators",
        "areaName": "Tokyo suburban rail",
    }
    result = dict(source)
    changes: list[dict[str, Any]] = []
    for field, value in replacements.items():
        old = result.get(field)
        if old != value:
            result[field] = value
            changes.append({"field": field, "from": old, "to": value})
    old_stage_start = result.pop("stageStartStationId")
    changes.append(
        {"field": "stageStartStationId", "from": old_stage_start, "to": None}
    )
    if len(changes) != 6:
        raise StageError(f"unexpected number of transformed dataset fields: {changes}")
    return result, changes


def _require_s5_log_path(root: Path, out_dir: Path) -> Path:
    destination = _rooted(root, out_dir).resolve()
    allowed = (root / S5_LOGS_PATH).resolve()
    if not destination.is_relative_to(allowed) or destination == allowed:
        raise StageError(f"prepare output must be below {S5_LOGS_PATH}")
    return destination


def _presentation_sources(overrides: Any) -> tuple[list[dict[str, Any]], ...]:
    """Project loaded override records into the exported UI metadata shape."""
    lines = [
        {"id": line.id, "name": line.name, "color": line.color}
        for line in overrides.lines
    ]
    services = [
        {
            "id": service.id,
            "operator": service.effective_operator(overrides.dataset),
            "lineIds": list(service.definition.line_ids),
            "stationIds": list(service.station_ids),
        }
        for service in overrides.services
    ]
    stations = [
        {"id": station.id, "name": station.name}
        for station in overrides.registry.stations
    ]
    return lines, services, stations


def prepare(*, root: Path = ROOT, out_dir: Path) -> dict[str, Any]:
    """Verify and copy the S4 overrides, then restore frozen product settings."""
    inputs_report = verify_inputs(root=root)
    source_dir = root / ASSEMBLED_PATH / "overrides"
    destination = _require_s5_log_path(root, out_dir)
    if destination.exists():
        if not destination.is_dir() or destination.is_symlink():
            raise StageError(
                f"prepare output exists and is not a safe directory: {destination}"
            )
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_dataset_path = source_dir / "dataset.json"
    dataset, changes = product_dataset(
        read_json(source_dataset_path), read_json(root / FREEZE_PATH)
    )
    shutil.copytree(source_dir, destination)
    write_json(destination / "dataset.json", dataset)
    prepared = load_overrides(destination)
    lines, services, stations = _presentation_sources(prepared)
    presentation = build_ui_presentation(
        root=root, lines=lines, services=services, stations=stations
    )
    presentation_payload = compact_json(presentation)
    (destination / PRESENTATION_FILE).write_bytes(presentation_payload.encode("utf-8"))
    dataset = {
        **dataset,
        "uiPresentationFile": PRESENTATION_FILE,
        "uiPresentationSha256": hashlib.sha256(
            presentation_payload.encode("utf-8")
        ).hexdigest(),
    }
    write_json(destination / "dataset.json", dataset)
    prepared = load_overrides(destination)
    freeze = read_json(root / FREEZE_PATH)
    if (
        prepared.dataset.validation_profile != "gameplay"
        or prepared.dataset.stage_start_station_id
        or prepared.dataset.start_station_id != freeze["ruleset"]["startStationId"]
        or prepared.dataset.directed_segment_target_service_id
        != freeze["ruleset"]["targetServiceId"]
    ):
        raise StageError(
            "prepared overrides do not load as the frozen gameplay product"
        )
    for path in sorted(destination.rglob("*")):
        if path.is_file() and b"\r" in path.read_bytes():
            raise StageError(f"prepared product override is not LF-only: {path}")
    derived = _check_derived_override_tree(root, destination)
    report = {
        "status": "prepared",
        "source": ASSEMBLED_PATH + "/overrides",
        "sourceDatasetSha256": sha256_file(source_dataset_path),
        "preparedOverridesSha256": hash_tree(destination),
        "transformedFields": changes,
        "presentation": {
            "file": PRESENTATION_FILE,
            "sha256": dataset["uiPresentationSha256"],
            "operators": len(presentation["operators"]),
            "lineGroups": len(presentation["lineGroups"]),
            "stationsWithAliases": len(presentation["stations"]),
            "serviceStopNames": len(presentation["serviceStopNames"]),
        },
        "derivedOverrideTree": derived["status"],
        "frozenCounts": inputs_report["counts"],
    }
    report_path = destination.parent / "prepare-provenance.json"
    write_json(report_path, report)
    return {
        **report,
        "outDir": destination.as_posix(),
        "report": report_path.as_posix(),
    }


def _read_product_files(directory: Path) -> dict[str, str]:
    if not directory.is_dir():
        raise StageError(f"product build directory is missing: {directory}")
    actual_names = {path.name for path in directory.iterdir() if path.is_file()}
    if actual_names != set(PRODUCT_FILES) or any(
        path.is_dir() for path in directory.iterdir()
    ):
        raise StageError(
            f"product build must contain exactly the five v3 files: {directory}"
        )
    return {
        name: (directory / name).read_text(encoding="utf-8") for name in PRODUCT_FILES
    }


def compare_builds(a: Path, b: Path, *, root: Path = ROOT) -> dict[str, Any]:
    """Compare five files byte-for-byte and check manifest content identity."""
    first = _read_product_files(_rooted(root, a))
    _read_product_files(_rooted(root, b))
    hashes = {
        label: {
            name: sha256_file(_rooted(root, directory) / name) for name in PRODUCT_FILES
        }
        for label, directory in (("a", a), ("b", b))
    }
    if hashes["a"] != hashes["b"]:
        raise StageError("product A/B builds differ byte-for-byte")
    manifest = json.loads(first[config.MANIFEST_FILE])
    expected_version = export.data_version(export.manifest_inputs(first))
    if (
        manifest.get("schemaVersion") != 3
        or manifest.get("dataVersion") != expected_version
    ):
        raise StageError("product manifest schema or content hash is invalid")
    if "validationProfile" in manifest or "stageStartStationId" in manifest:
        raise StageError("product manifest contains stage-only fields")
    verify_inputs(root=root)
    services_document = json.loads(first[config.SERVICES_FILE])
    stations_document = json.loads(first[config.STATIONS_FILE])
    expected_presentation = build_ui_presentation(
        root=root,
        lines=services_document.get("lines", []),
        services=services_document.get("services", []),
        stations=stations_document,
    )
    try:
        require_same_presentation(manifest.get("uiPresentation"), expected_presentation)
    except ValueError as error:
        raise StageError(
            "product manifest UI presentation differs from audited source expectations"
        ) from error
    s4_hashes = _check_s4_payload_hashes(root)
    for name in PAYLOAD_FILES:
        if hashes["a"][name] != s4_hashes[name]:
            raise StageError(f"product payload differs from accepted S4 build: {name}")
    return {
        "status": "identical",
        "byteIdentical": True,
        "hashes": hashes,
        "dataVersion": manifest["dataVersion"],
        "updatedAt": manifest.get("updatedAt"),
    }


def _check_derived_override_tree(root: Path, overrides_dir: Path) -> dict[str, Any]:
    """Require derived S6 metadata and frozen S5 settings over the S4 inputs."""
    source = root / ASSEMBLED_PATH / "overrides"
    if not overrides_dir.is_dir():
        raise StageError(f"prepared product overrides are missing: {overrides_dir}")
    source_hashes, product_hashes = hash_tree(source), hash_tree(overrides_dir)
    expected_files = {*source_hashes, PRESENTATION_FILE}
    if set(expected_files) != set(product_hashes):
        raise StageError(
            "prepared product override files differ from S4 plus UI metadata"
        )
    for relative, digest in source_hashes.items():
        if relative != "dataset.json" and product_hashes[relative] != digest:
            raise StageError(
                f"prepared override changed outside dataset.json: {relative}"
            )
    freeze = read_json(root / FREEZE_PATH)
    expected_dataset, changes = product_dataset(
        read_json(source / "dataset.json"), freeze
    )
    prepared = load_overrides(overrides_dir)
    lines, services, stations = _presentation_sources(prepared)
    expected_presentation = build_ui_presentation(
        root=root, lines=lines, services=services, stations=stations
    )
    expected_presentation_payload = compact_json(expected_presentation)
    expected_dataset.update(
        uiPresentationFile=PRESENTATION_FILE,
        uiPresentationSha256=hashlib.sha256(
            expected_presentation_payload.encode("utf-8")
        ).hexdigest(),
    )
    if read_json(overrides_dir / "dataset.json") != expected_dataset:
        raise StageError("prepared product dataset differs from frozen S5/S6 settings")
    if (overrides_dir / PRESENTATION_FILE).read_text(
        encoding="utf-8"
    ) != expected_presentation_payload:
        raise StageError(
            "prepared UI presentation differs from audited source expectations"
        )
    return {
        "dataset": expected_dataset,
        "transformedFields": changes,
        "presentation": expected_presentation,
        "status": "verified",
    }


def _check_product_artifact(
    root: Path, data_dir: Path, overrides_dir: Path
) -> dict[str, Any]:
    """Validate runtime artifacts against product overrides and the frozen oracle."""
    overrides = load_overrides(overrides_dir)
    dataset = validate.load_dataset(data_dir)
    findings = validate.validate_dataset(dataset, overrides)
    if not findings.ok:
        raise StageError("product validation failed: " + "; ".join(findings.errors))
    expected_presentation = build_ui_presentation(
        root=root,
        lines=dataset.services.get("lines", []),
        services=dataset.service_patterns,
        stations=dataset.stations,
    )
    try:
        require_same_presentation(
            dataset.manifest.get("uiPresentation"), expected_presentation
        )
    except ValueError as error:
        raise StageError(
            "product manifest UI presentation differs from audited source expectations"
        ) from error
    freeze, catalog, services = assembly._load_frozen_catalog(root)
    oracle = assembly._oracle(freeze, catalog, services)
    station_ids = [row.get("id") for row in dataset.stations]
    if station_ids != oracle["stationIds"]:
        raise StageError("product station order differs from the frozen catalogue")
    actual_services = dataset.service_patterns
    if [row.get("id") for row in actual_services] != [
        row["id"] for row in oracle["services"]
    ]:
        raise StageError("product service order differs from the frozen catalogue")
    for actual, expected in zip(actual_services, oracle["services"], strict=True):
        if actual.get("stationIds") != expected["stationIds"]:
            raise StageError(f"product stop order differs for {expected['id']}")
    expected_segments = assembly_gate._expected_segment_keys(
        {**oracle, "targetServiceId": freeze["ruleset"]["targetServiceId"]}
    )
    actual_segments = [
        (row.get("serviceId"), row.get("from"), row.get("to"))
        for row in dataset.segments
    ]
    if actual_segments != expected_segments:
        raise StageError("product directed segments differ from the frozen topology")
    target_segments = [
        row
        for row in dataset.segments
        if row.get("serviceId") == freeze["ruleset"]["targetServiceId"]
    ]
    if len(target_segments) != 30:
        raise StageError(
            f"product target must contain 30 directed segments, got {len(target_segments)}"
        )
    if dataset.manifest.get("schemaVersion") != 3:
        raise StageError("product manifest must use schema version 3")
    report = Report()
    check_two_way_reachability(
        oracle["stationIds"],
        ((str(row.get("from")), str(row.get("to"))) for row in dataset.segments),
        freeze["ruleset"]["startStationId"],
        report,
    )
    if report.errors:
        raise StageError("product reachability failed: " + "; ".join(report.errors))
    payloads = {
        name: (data_dir / name).read_text(encoding="utf-8") for name in PRODUCT_FILES
    }
    for name, payload in payloads.items():
        if "\r" in payload:
            raise StageError(f"product file is not LF-only: {name}")
    metrics = budgets.file_size_report(payloads)
    limits = overrides.dataset.budgets
    errors = budgets.budget_errors(metrics, limits)
    if errors:
        raise StageError("product budget overrun: " + "; ".join(errors))
    return {
        "counts": oracle["counts"],
        "metrics": metrics,
        "validation": findings.metrics,
    }


def verify(*, root: Path = ROOT) -> dict[str, Any]:
    """Verify the installed product overrides and public files after cutover."""
    inputs = verify_inputs(root=root)
    verify_history(root=root)
    live_overrides = root / "data/overrides"
    live_data = root / "public/data"
    derived = _check_derived_override_tree(root, live_overrides)
    product_report = _check_product_artifact(root, live_data, live_overrides)
    hashes = {name: sha256_file(live_data / name) for name in PRODUCT_FILES}
    expected_s4 = _check_s4_payload_hashes(root)
    for name in PAYLOAD_FILES:
        if hashes[name] != expected_s4[name]:
            raise StageError(
                f"installed product payload differs from accepted S4: {name}"
            )
    return {
        "status": "verified",
        "inputs": inputs,
        "transformedFields": derived["transformedFields"],
        "hashes": hashes,
        **product_report,
    }


def simulation_code_fingerprint(*, root: Path = ROOT) -> dict[str, Any]:
    """Hash the source files that determine S5 simulation inputs and turns."""
    files = {
        relative: sha256_file(root / relative) for relative in SIMULATION_CODE_FILES
    }
    payload = json.dumps(files, separators=(",", ":")).encode("utf-8")
    return {"files": files, "sha256": hashlib.sha256(payload).hexdigest()}


def _simulation_bundle_hashes(root: Path) -> dict[str, str]:
    return {
        name: sha256_file(root / "public/data" / name)
        for name in (
            "manifest.json",
            "stations.json",
            "services.json",
            "segments.json",
            "segments.geojson",
        )
    }


def _simulation_gameplay_signature_sha256(root: Path) -> str:
    services_data = read_json(root / "public/data/services.json")
    segments = read_json(root / "public/data/segments.json")
    services: list[dict[str, Any]] = []
    for service in services_data["services"]:
        signature: dict[str, Any] = {
            "id": service["id"],
            "kind": service["kind"],
            "stationIds": service["stationIds"],
            "circular": service["circular"],
        }
        if not service["circular"]:
            signature["endpoints"] = service["endpoints"]
        services.append(signature)
    signature = {
        "services": services,
        "directedSegments": [
            {
                "serviceId": segment["serviceId"],
                "from": segment["from"],
                "to": segment["to"],
            }
            for segment in segments
        ],
    }
    payload = json.dumps(signature, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(payload).hexdigest()


def _simulation_config(root: Path) -> dict[str, Any]:
    ruleset = read_json(root / FREEZE_PATH)["ruleset"]
    return {
        "rulesetVersion": ruleset["id"],
        "targetServiceId": ruleset["targetServiceId"],
        "startStationId": ruleset["startStationId"],
        "targetDirection": ruleset["targetDirection"],
        # This is the existing engine policy matching the freeze's prose goal.
        "goalArrivalPolicy": "truncate-on-target-service",
        "serviceLottery": ruleset["serviceLottery"],
        "directionLottery": ruleset["directionLottery"],
    }


def _simulation_seed_set(offset: int, games: int) -> tuple[list[str], str]:
    seeds = [
        f"s1m-{SIMULATION_BASE_SEED}-{index}" for index in range(offset, offset + games)
    ]
    digest = hashlib.sha256(("\n".join(seeds) + "\n").encode("utf-8")).hexdigest()
    return seeds, digest


def _nearest_rank(turns: list[int], numerator: int, denominator: int) -> int:
    rank = (len(turns) * numerator + denominator - 1) // denominator
    return sorted(turns)[rank - 1]


def _simulation_statistics(turns: list[int]) -> dict[str, Any]:
    ordered = sorted(turns)
    return {
        "games": len(turns),
        "completedGames": len(turns),
        "capHits": 0,
        "cappedGameIndices": [],
        "median": _nearest_rank(turns, 1, 2),
        "p90": _nearest_rank(turns, 9, 10),
        "p99": _nearest_rank(turns, 99, 100),
        "mean": sum(turns) / len(turns),
        "max": ordered[-1],
        "over500Count": sum(turn > 500 for turn in turns),
        "totalPlayedTurns": sum(turns),
    }


def _simulation_lf_sha256(path: Path) -> str:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _reference_simulation(root: Path) -> tuple[list[int], dict[str, Any]]:
    """Validate and aggregate the frozen R2 shards and distribution evidence."""
    results = read_json(root / ".claude/docs/research/tokyo-suburban-r2-results.json")
    frozen = results["cases"]["target-two-thirds"]
    expected_config = frozen["config"]
    expected_hashes = frozen["input"]["sha256"]
    for relative, expected_hash in expected_hashes.items():
        source = root / relative
        if not source.is_file() or _simulation_lf_sha256(source) != expected_hash:
            raise StageError(f"frozen simulation input is missing or stale: {relative}")

    turns: list[int] = []
    for offset in SIMULATION_OFFSETS:
        path = root / ".claude/logs/r2" / f"target-two-thirds-{offset}.json"
        shard = read_json(path)
        task = shard.get("task", {})
        expected_seeds, expected_seed_hash = _simulation_seed_set(
            offset, SIMULATION_GAMES_PER_SHARD
        )
        if (
            task.get("name") != "target-two-thirds"
            or task.get("input") != "official"
            or task.get("targetShare") != [2, 3]
            or task.get("offset") != offset
            or task.get("games") != SIMULATION_GAMES_PER_SHARD
            or shard.get("config") != expected_config
            or shard.get("seedSetSha256") != expected_seed_hash
            or shard.get("statistics", {}).get("games") != SIMULATION_GAMES_PER_SHARD
            or shard.get("statistics", {}).get("capHits") != 0
        ):
            raise StageError(
                f"frozen R2 simulation shard is stale or malformed: {path}"
            )
        shard_turns = shard.get("turns")
        if not isinstance(shard_turns, list) or len(shard_turns) != len(expected_seeds):
            raise StageError(
                f"frozen R2 simulation shard has the wrong turn count: {path}"
            )
        if any(not isinstance(turn, int) or turn < 1 for turn in shard_turns):
            raise StageError(f"frozen R2 simulation shard has invalid turns: {path}")
        if shard.get("statistics") != _simulation_statistics(shard_turns):
            raise StageError(
                f"frozen R2 simulation shard summary differs from turns: {path}"
            )
        turns.extend(shard_turns)

    frozen_seed_count = frozen["case"]["games"]
    frozen_seed_hash = frozen["seedSetSha256"]
    if (
        frozen_seed_count != len(turns)
        or frozen_seed_hash != _simulation_seed_set(0, len(turns))[1]
    ):
        raise StageError("frozen R2 simulation seed set differs from its shards")

    expected_distribution = frozen["statistics"]
    aggregate = _simulation_statistics(turns)
    expected_keys = (
        "games",
        "completedGames",
        "capHits",
        "median",
        "p90",
        "p99",
        "mean",
        "max",
        "over500Count",
        "totalPlayedTurns",
    )
    for key in expected_keys:
        if aggregate[key] != expected_distribution[key]:
            raise StageError(
                f"frozen R2 shards do not match accepted distribution at {key}: "
                f"{aggregate[key]} != {expected_distribution[key]}"
            )
    freeze_statistics = read_json(root / FREEZE_PATH)["ruleset"]["statistics"]
    for key in ("games", "median", "p90", "p99", "max"):
        if aggregate[key] != freeze_statistics[key]:
            raise StageError(
                f"frozen R2 shards differ from S0 freeze at {key}: "
                f"{aggregate[key]} != {freeze_statistics[key]}"
            )
    return turns, expected_distribution


def _load_simulation_shard(path: Path) -> dict[str, Any]:
    shard = read_json(path)
    if not isinstance(shard, dict):
        raise StageError(f"simulation shard must be a JSON object: {path}")
    return shard


def _check_simulation_shard(
    *,
    root: Path,
    path: Path,
    offset: int,
    bundle_hashes: dict[str, str],
    gameplay_signature_hash: str,
    code_fingerprint: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    shard = _load_simulation_shard(path)
    filename_match = re.fullmatch(r"sim-(\d+)\.json", path.name)
    if filename_match is None or int(filename_match.group(1)) != offset:
        raise StageError(f"simulation shard filename does not match its offset: {path}")
    expected_seeds, expected_seed_hash = _simulation_seed_set(
        offset, SIMULATION_GAMES_PER_SHARD
    )
    if shard.get("schemaVersion") != 1 or shard.get("measurement") != "s5-product":
        raise StageError(f"unsupported or stale simulation shard schema: {path}")
    expected_shard = {
        "offset": offset,
        "games": SIMULATION_GAMES_PER_SHARD,
        "baseSeed": SIMULATION_BASE_SEED,
        "turnCap": SIMULATION_TURN_CAP,
    }
    if shard.get("shard") != expected_shard:
        raise StageError(f"simulation shard range is stale or overlaps: {path}")
    if (
        shard.get("seeds") != expected_seeds
        or shard.get("seedSetSha256") != expected_seed_hash
    ):
        raise StageError(f"simulation shard seed range is stale or overlaps: {path}")
    if shard.get("config") != config:
        raise StageError(
            f"simulation shard does not use the frozen product rules: {path}"
        )
    if shard.get("bundleHashes") != bundle_hashes:
        raise StageError(f"simulation shard has stale bundle hashes: {path}")
    if shard.get("gameplaySignatureSha256") != gameplay_signature_hash:
        raise StageError(f"simulation shard has a stale gameplay signature: {path}")
    if shard.get("codeFingerprint") != code_fingerprint:
        raise StageError(
            f"simulation shard has a stale simulation code fingerprint: {path}"
        )
    if shard.get("quantileConvention") != "nearest-rank: ceil(p * games) - 1":
        raise StageError(
            f"simulation shard uses a different quantile convention: {path}"
        )
    runtime = shard.get("runtimeSeconds")
    if (
        not isinstance(runtime, (int, float))
        or not math.isfinite(runtime)
        or runtime < 0
    ):
        raise StageError(f"simulation shard has invalid runtime metadata: {path}")
    turns = shard.get("turns")
    if (
        not isinstance(turns, list)
        or len(turns) != SIMULATION_GAMES_PER_SHARD
        or any(not isinstance(turn, int) or turn < 1 for turn in turns)
    ):
        raise StageError(f"simulation shard has invalid raw turns: {path}")
    if any(turn > SIMULATION_TURN_CAP for turn in turns):
        raise StageError(f"simulation shard contains capped games: {path}")
    if shard.get("statistics") != _simulation_statistics(turns):
        raise StageError(f"simulation shard statistics do not match raw turns: {path}")
    return shard


def verify_simulation(
    *, root: Path = ROOT, shard_dir: Path | None = None
) -> dict[str, Any]:
    """Independently verify exact S5 product shards against frozen R2 evidence."""
    output_dir = shard_dir or (root / S5_LOGS_PATH)
    if not output_dir.is_dir():
        raise StageError(f"S5 simulation output directory is missing: {output_dir}")
    output_dir = output_dir.resolve()
    paths = sorted(output_dir.glob("sim-*.json"))
    allowed_names = {f"sim-{offset}.json" for offset in SIMULATION_OFFSETS} | {
        "sim-repeat.json"
    }
    if {path.name for path in paths} != allowed_names:
        raise StageError(
            "expected exactly the S5 shard offsets "
            f"{list(SIMULATION_OFFSETS)} plus sim-repeat.json; "
            f"found {[path.name for path in paths]}"
        )

    references, expected_distribution = _reference_simulation(root)
    expected_bundle_hashes = _simulation_bundle_hashes(root)
    expected_signature_hash = _simulation_gameplay_signature_sha256(root)
    expected_code_fingerprint = simulation_code_fingerprint(root=root)
    expected_config = _simulation_config(root)
    actual_turns: list[int] = []
    checked_shards: dict[int, dict[str, Any]] = {}
    for offset in SIMULATION_OFFSETS:
        path = output_dir / f"sim-{offset}.json"
        shard = _check_simulation_shard(
            root=root,
            path=path,
            offset=offset,
            bundle_hashes=expected_bundle_hashes,
            gameplay_signature_hash=expected_signature_hash,
            code_fingerprint=expected_code_fingerprint,
            config=expected_config,
        )
        checked_shards[offset] = shard
        actual_turns.extend(shard["turns"])

    repeat_path = output_dir / "sim-repeat.json"
    repeat = _load_simulation_shard(repeat_path)
    repeat_range = repeat.get("shard")
    if not isinstance(repeat_range, dict) or repeat_range.get("offset") != 0:
        raise StageError("repeat simulation must use offset 0")
    repeat_runtime = repeat.get("runtimeSeconds")
    if (
        not isinstance(repeat_runtime, (int, float))
        or not math.isfinite(repeat_runtime)
        or repeat_runtime < 0
    ):
        raise StageError("repeat simulation has invalid runtime metadata")
    repeat_checked = _check_simulation_shard(
        root=root,
        path=output_dir / "sim-0.json",
        offset=0,
        bundle_hashes=expected_bundle_hashes,
        gameplay_signature_hash=expected_signature_hash,
        code_fingerprint=expected_code_fingerprint,
        config=expected_config,
    )
    deterministic_repeat = {
        key: value for key, value in repeat.items() if key != "runtimeSeconds"
    }
    deterministic_first = {
        key: value for key, value in repeat_checked.items() if key != "runtimeSeconds"
    }
    if deterministic_repeat != deterministic_first:
        raise StageError("repeat offset-0 shard differs beyond runtimeSeconds")

    statistics = _simulation_statistics(actual_turns)
    per_seed_mismatches: list[dict[str, Any]] = []
    for offset in SIMULATION_OFFSETS:
        actual_shard = checked_shards[offset]["turns"]
        expected_shard = references[offset : offset + SIMULATION_GAMES_PER_SHARD]
        for index, (expected_turns, actual_count) in enumerate(
            zip(expected_shard, actual_shard, strict=True)
        ):
            if expected_turns != actual_count:
                absolute_index = offset + index
                per_seed_mismatches.append(
                    {
                        "seed": f"s1m-{SIMULATION_BASE_SEED}-{absolute_index}",
                        "expectedTurns": expected_turns,
                        "actualTurns": actual_count,
                    }
                )

    distribution_mismatches = {
        key: {"expected": expected_distribution[key], "actual": statistics[key]}
        for key in (
            "games",
            "completedGames",
            "capHits",
            "median",
            "p90",
            "p99",
            "mean",
            "max",
            "over500Count",
            "totalPlayedTurns",
        )
        if expected_distribution[key] != statistics[key]
    }
    return {
        "status": "verified"
        if not per_seed_mismatches and not distribution_mismatches
        else "failed",
        "games": len(actual_turns),
        "offsets": list(SIMULATION_OFFSETS),
        "statistics": statistics,
        "perSeedMismatchCount": len(per_seed_mismatches),
        "firstPerSeedMismatches": per_seed_mismatches[:20],
        "distributionMismatches": distribution_mismatches,
        "seedSetSha256": _simulation_seed_set(0, len(actual_turns))[1],
        "bundleHashes": expected_bundle_hashes,
        "gameplaySignatureSha256": expected_signature_hash,
        "codeFingerprint": expected_code_fingerprint,
    }


def install(
    *, root: Path = ROOT, overrides_dir: Path, data_dir: Path
) -> dict[str, Any]:
    """Install already generated product files after all read-only gates pass."""
    verify_inputs(root=root)
    verify_history(root=root)
    overrides_source = _rooted(root, overrides_dir).resolve()
    data_source = _rooted(root, data_dir).resolve()
    if not overrides_source.is_relative_to((root / S5_LOGS_PATH).resolve()):
        raise StageError("install overrides must come from .claude/logs/s5")
    if not data_source.is_relative_to((root / S5_LOGS_PATH).resolve()):
        raise StageError("install build must come from .claude/logs/s5")
    _check_derived_override_tree(root, overrides_source)
    _check_product_artifact(root, data_source, overrides_source)
    s4_hashes = _check_s4_payload_hashes(root)
    data_hashes = {name: sha256_file(data_source / name) for name in PRODUCT_FILES}
    for name in PAYLOAD_FILES:
        if data_hashes[name] != s4_hashes[name]:
            raise StageError(f"install payload differs from accepted S4: {name}")

    live_overrides = root / "data/overrides"
    live_data = root / "public/data"
    staged_root = root / S5_LOGS_PATH / "install-staged"
    if staged_root.exists():
        if staged_root.is_symlink() or not staged_root.is_dir():
            raise StageError(f"unsafe install staging path: {staged_root}")
        shutil.rmtree(staged_root)
    staged_root.mkdir(parents=True)
    shutil.copytree(overrides_source, staged_root / "overrides")
    shutil.copytree(data_source, staged_root / "public-data")
    for target in (live_overrides, live_data):
        if target.is_symlink():
            raise StageError(f"refusing to install through symlink: {target}")
    for target in (live_overrides, live_data):
        if target.exists():
            if not target.is_dir():
                raise StageError(f"install target is not a directory: {target}")
            shutil.rmtree(target)
    shutil.move(str(staged_root / "overrides"), str(live_overrides))
    shutil.move(str(staged_root / "public-data"), str(live_data))
    shutil.rmtree(staged_root)
    return {
        "status": "installed",
        "overrides": str(live_overrides),
        "data": str(live_data),
    }


def _emit(result: dict[str, Any]) -> None:
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("verify-history", "verify-inputs", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--root", type=Path, default=ROOT)
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("--root", type=Path, default=ROOT)
    prepare_parser.add_argument("--out-dir", type=Path, required=True)
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("--root", type=Path, default=ROOT)
    compare_parser.add_argument("--a", type=Path, required=True)
    compare_parser.add_argument("--b", type=Path, required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--root", type=Path, default=ROOT)
    install_parser.add_argument("--overrides-dir", type=Path, required=True)
    install_parser.add_argument("--data-dir", type=Path, required=True)
    simulation_parser = commands.add_parser("verify-simulation")
    simulation_parser.add_argument("--root", type=Path, default=ROOT)
    simulation_parser.add_argument("--shard-dir", type=Path)
    args = parser.parse_args(arguments)
    exit_code = 0
    try:
        if args.command == "verify-history":
            result = verify_history(root=args.root)
        elif args.command == "verify-inputs":
            result = verify_inputs(root=args.root)
        elif args.command == "prepare":
            result = prepare(root=args.root, out_dir=args.out_dir)
        elif args.command == "compare":
            result = compare_builds(args.a, args.b, root=args.root)
        elif args.command == "verify":
            result = verify(root=args.root)
        elif args.command == "install":
            result = install(
                root=args.root,
                overrides_dir=args.overrides_dir,
                data_dir=args.data_dir,
            )
        else:
            result = verify_simulation(root=args.root, shard_dir=args.shard_dir)
            if result["status"] != "verified":
                exit_code = 2
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"FAIL {error}")
        return 2
    _emit(result)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
