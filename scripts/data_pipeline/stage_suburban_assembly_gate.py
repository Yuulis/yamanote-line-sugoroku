"""Build, audit and hand off the frozen cross-operator S4 stage."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from scripts.data_pipeline import build, export, validate
from scripts.data_pipeline import stage_suburban_assembly as assembly
from scripts.data_pipeline import stage_suburban_assembly_evidence as evidence
from scripts.data_pipeline import stage_suburban_assembly_offsets as offsets
from scripts.data_pipeline import stage_suburban_jr as jr
from scripts.data_pipeline.overrides import load_overrides
from scripts.data_pipeline.rules import Report, check_two_way_reachability
from scripts.data_pipeline.stage_suburban_support import (
    StageError,
    hash_tree,
    hash_value,
    read_json,
    resolve_historical_baseline,
    sha256_file,
    write_json,
)
from scripts.data_pipeline.topology import directed_pairs, station_pairs

ROOT = assembly.ROOT
GATE_FILE = "gate-report.json"
BATCHES = ("jr-core", "jr-new", *assembly.nonjr.GROUPS)
SHIPPED_DATA_DIR = "public/data"


def _frozen_oracle(root: Path) -> dict[str, Any]:
    freeze, catalog, services = assembly._load_frozen_catalog(root)
    return {
        **assembly._oracle(freeze, catalog, services),
        "targetServiceId": freeze["ruleset"]["targetServiceId"],
    }


def _expected_segment_keys(oracle: dict[str, Any]) -> list[tuple[str, str, str]]:
    expected: list[tuple[str, str, str]] = []
    target_service = oracle["targetServiceId"]
    for service in oracle["services"]:
        service_id = service["id"]
        circular = oracle["circularByService"][service_id]
        expected.extend(
            (service_id, origin, destination)
            for origin, destination in directed_pairs(
                service["stationIds"],
                circular,
                service_id=service_id,
                target_service_id=target_service,
            )
        )
    return expected


def _check_artifact_contract(
    artifact: dict[str, Any], oracle: dict[str, Any]
) -> dict[str, int]:
    """Compare a built artifact to frozen IDs and exact service stop ownership."""
    expected_counts = oracle["counts"]
    stations = artifact["stations"]
    services = artifact["services"]
    segments = artifact["segments"]
    actual_station_ids = [row.get("id") for row in stations]
    if actual_station_ids != oracle["stationIds"]:
        raise StageError("built station order or IDs differ from the frozen oracle")
    expected_services = oracle["services"]
    if [row.get("id") for row in services] != [row["id"] for row in expected_services]:
        raise StageError("built service inventory differs from the frozen oracle")
    for actual, expected in zip(services, expected_services, strict=True):
        service_id = expected["id"]
        expected_stops = expected["stationIds"]
        if actual.get("stationIds") != expected_stops:
            raise StageError(f"built stop order differs for {service_id}")
        platform_keys = set(actual.get("platformCoordinates", {}))
        if platform_keys != set(expected_stops):
            raise StageError(f"platform keys differ for {service_id}")

    actual_segment_keys = [
        (row.get("serviceId"), row.get("from"), row.get("to")) for row in segments
    ]
    expected_segment_keys = _expected_segment_keys(oracle)
    if actual_segment_keys != expected_segment_keys:
        raise StageError("built directed segments differ from the frozen oracle")
    if artifact["manifest"].get("validationProfile") != "stage":
        raise StageError("built manifest does not use the stage validation profile")
    if artifact["manifest"].get("stageStartStationId") != "shimbashi":
        raise StageError("built manifest does not start the stage at shimbashi")

    actual_counts = {
        "services": len(services),
        "stationGroups": len(stations),
        "serviceStopRows": sum(len(row["stationIds"]) for row in services),
        "serviceRoutePairRows": sum(
            len(
                station_pairs(row["stationIds"], oracle["circularByService"][row["id"]])
            )
            for row in services
        ),
        "directedSegments": len(segments),
    }
    if actual_counts != expected_counts:
        raise StageError(
            f"built counts differ from the frozen oracle: {actual_counts} != "
            f"{expected_counts}"
        )
    return actual_counts


def _load_artifact(data_dir: Path) -> dict[str, Any]:
    dataset = validate.load_dataset(data_dir)
    return {
        "stations": dataset.stations,
        "services": dataset.service_patterns,
        "segments": dataset.segments,
        "manifest": dataset.manifest,
        "dataset": dataset,
    }


def _validate_artifact(
    root: Path, data_dir: Path, oracle: dict[str, Any]
) -> dict[str, Any]:
    overrides_dir = root / assembly.ASSEMBLED_PATH / "overrides"
    overrides = load_overrides(overrides_dir)
    artifact = _load_artifact(data_dir)
    findings = validate.validate_dataset(artifact["dataset"], overrides)
    if not findings.ok:
        raise StageError(
            f"stage validation failed for {data_dir}: " + "; ".join(findings.errors)
        )
    counts = _check_artifact_contract(artifact, oracle)
    offsets.audit_artifact(root, artifact["stations"], artifact["services"])
    report = Report()
    check_two_way_reachability(
        oracle["stationIds"],
        ((row["from"], row["to"]) for row in artifact["segments"]),
        "shimbashi",
        report,
    )
    if report.errors:
        raise StageError("stage reachability failed: " + "; ".join(report.errors))
    _check_lf(data_dir)
    return {"status": "validated", "counts": counts, "metrics": findings.metrics}


def _check_lf(directory: Path) -> None:
    for path in sorted(directory.rglob("*")):
        if path.is_file() and b"\r" in path.read_bytes():
            raise StageError(f"stage output is not LF-only: {path}")


def _require_current_assembly(root: Path) -> dict[str, Any]:
    """Reject stale assembly inputs, oracle metadata or edited overrides."""
    preflight_report = assembly.preflight(root=root)
    assembled = root / assembly.ASSEMBLED_PATH
    overrides_dir = assembled / "overrides"
    if not overrides_dir.is_dir():
        raise StageError(f"assembled overrides are missing: {overrides_dir}")
    saved_inputs = read_json(assembled / "inputs-sha256.json")
    expected_inputs = assembly._build_inputs_report(root, preflight_report)
    if saved_inputs != expected_inputs:
        raise StageError("assembled inputs are stale; rerun S4 assemble")
    oracle = _frozen_oracle(root)
    inventory = read_json(assembled / "inventory.json")
    expected_inventory = {
        "counts": oracle["counts"],
        "serviceIds": [row["id"] for row in oracle["services"]],
        "stationIds": oracle["stationIds"],
    }
    if inventory != expected_inventory:
        raise StageError("assembled inventory differs from the frozen oracle")
    verification = read_json(assembled / "verification.json")
    if (
        verification.get("status") != "verified"
        or verification.get("oracle", {}).get("counts") != oracle["counts"]
        or verification.get("oracle", {}).get("expectedCatalog") != oracle["services"]
    ):
        raise StageError("assembled verification is missing or stale")
    report = read_json(assembled / "assembly-report.json")
    if (
        report.get("status") != "assembled"
        or report.get("counts") != oracle["counts"]
        or report.get("inputHashesSha256") != hash_value(saved_inputs)
    ):
        raise StageError("assembled report is missing or stale")
    overrides = load_overrides(overrides_dir)
    if (
        overrides.dataset.validation_profile != "stage"
        or overrides.dataset.stage_start_station_id != "shimbashi"
        or overrides.dataset.reviewed_disconnected_service_ids
    ):
        raise StageError("assembled dataset has an invalid stage profile")
    expected_catalog_path = overrides_dir / overrides.dataset.expected_catalogue_file
    expected_catalog = read_json(expected_catalog_path)
    if expected_catalog != {
        "services": oracle["services"],
        "stationIds": oracle["stationIds"],
    }:
        raise StageError("assembled expected catalog differs from the frozen oracle")
    return {
        "inputs": saved_inputs,
        "inputHashesSha256": hash_value(saved_inputs),
        "assembledOverridesSha256": assembly.nonjr._component_file_hash(overrides_dir),
        "oracle": oracle,
    }


def _build_once(root: Path, overrides_dir: Path, out_dir: Path) -> None:
    result = build.build(root / "N02-25_GML/UTF-8", overrides_dir)
    export.write_outputs(out_dir, result.files)


def _check_all_evidence(root: Path) -> list[dict[str, Any]]:
    return [evidence.check_evidence(batch, root=root) for batch in BATCHES]


def _resolve(root: Path, path: Path) -> Path:
    return (path if path.is_absolute() else root / path).resolve()


def _pipeline_hashes() -> dict[str, str]:
    module_dir = Path(build.__file__).parent
    return {path.name: sha256_file(path) for path in sorted(module_dir.glob("*.py"))}


def gate(*, root: Path = ROOT, out_dir: Path) -> dict[str, Any]:
    """Build and validate A/B, compare bytes, and check all ten evidence batches."""
    current = _require_current_assembly(root)
    oracle = current["oracle"]
    output_root = _resolve(root, out_dir)
    builds: dict[str, dict[str, Any]] = {}
    hashes: dict[str, dict[str, str]] = {}
    for label in ("a", "b"):
        destination = output_root / label
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        _build_once(root, root / assembly.ASSEMBLED_PATH / "overrides", destination)
        builds[label] = _validate_artifact(root, destination, oracle)
        hashes[label] = hash_tree(destination)
    if hashes["a"] != hashes["b"]:
        raise StageError("A/B stage builds differ byte-for-byte")
    evidence_results = _check_all_evidence(root)
    report = {
        "status": "passed",
        "inputHashesSha256": current["inputHashesSha256"],
        "assembledOverridesSha256": current["assembledOverridesSha256"],
        "pipelineHashes": _pipeline_hashes(),
        "frozenCounts": oracle["counts"],
        "builds": builds,
        "buildHashes": hashes,
        "evidence": evidence_results,
    }
    write_json(output_root / GATE_FILE, report)
    return report


def _read_gate_report(data_dir: Path) -> dict[str, Any]:
    path = data_dir / GATE_FILE
    if not path.is_file():
        raise StageError(f"gate report is missing: {path}")
    report = read_json(path)
    if report.get("status") != "passed":
        raise StageError("gate report is not passed")
    return report


def _audit_built_preservation(
    root: Path, data_dir: Path, oracle: dict[str, Any]
) -> list[str]:
    findings: list[str] = []
    stage_overrides = root / assembly.ASSEMBLED_PATH / "overrides"
    baseline = resolve_historical_baseline(root, SHIPPED_DATA_DIR)
    baseline_overrides = resolve_historical_baseline(root, "data/overrides")
    for label in ("a", "b"):
        output = data_dir / label
        try:
            _validate_artifact(root, output, oracle)
            findings.extend(
                jr._check_old_pair_records(
                    stage_overrides,
                    output,
                    baseline,
                    baseline_overrides,
                )
            )
        except (OSError, KeyError, TypeError, ValueError) as error:
            findings.append(f"could not audit {label} build: {error}")
    return findings


def audit(*, root: Path = ROOT, data_dir: Path) -> dict[str, Any]:
    """Read-only audit of gate outputs, current evidence and shipped retention."""
    data_root = _resolve(root, data_dir)
    current = _require_current_assembly(root)
    oracle = current["oracle"]
    report = _read_gate_report(data_root)
    if report.get("inputHashesSha256") != current["inputHashesSha256"]:
        raise StageError("gate report has stale assembly inputs")
    if report.get("assembledOverridesSha256") != current["assembledOverridesSha256"]:
        raise StageError("gate report has stale assembled overrides")
    if report.get("pipelineHashes") != _pipeline_hashes():
        raise StageError("gate report has stale build or validation code")
    if report.get("frozenCounts") != oracle["counts"]:
        raise StageError("gate report counts differ from the frozen oracle")
    actual_hashes = {label: hash_tree(data_root / label) for label in ("a", "b")}
    if actual_hashes != report.get("buildHashes"):
        raise StageError("gate build outputs are stale or tampered")
    if actual_hashes["a"] != actual_hashes["b"]:
        raise StageError("A/B stage builds differ byte-for-byte")
    evidence_results = _check_all_evidence(root)
    if report.get("evidence") != evidence_results:
        raise StageError("gate evidence verification is stale")
    findings = _audit_built_preservation(root, data_root, oracle)
    if findings:
        raise StageError("stage preservation audit failed: " + "; ".join(findings))
    return {
        "status": "audited",
        "gateReportSha256": sha256_file(data_root / GATE_FILE),
        "buildHashes": actual_hashes,
        "evidence": evidence_results,
        "frozenCounts": oracle["counts"],
        "preservation": "passed",
    }


def _handoff_inputs(root: Path, data_dir: Path) -> dict[str, Any]:
    return {
        "gateReportSha256": sha256_file(data_dir / GATE_FILE),
        "buildHashes": {label: hash_tree(data_dir / label) for label in ("a", "b")},
        "assembledOverridesSha256": assembly.nonjr._component_file_hash(
            root / assembly.ASSEMBLED_PATH / "overrides"
        ),
    }


def _handoff_readme(oracle: dict[str, Any], verification: dict[str, Any]) -> str:
    counts = oracle["counts"]
    return "\n".join(
        [
            "# Tokyo suburban assembled stage",
            "",
            "This handoff contains the frozen S4 cross-operator stage. Its expected catalogue and counts come from the verified frozen research catalog and freeze manifest.",
            "",
            f"- Services: {counts['services']}",
            f"- Station groups: {counts['stationGroups']}",
            f"- Service stop rows: {counts['serviceStopRows']}",
            f"- Service route pairs: {counts['serviceRoutePairRows']}",
            f"- Directed segments: {counts['directedSegments']}",
            f"- Gate report SHA-256: {verification['gate']['gateReportSha256']}",
            "",
            "## Verification commands",
            "",
            "```bash",
            "uv run python -m scripts.data_pipeline.stage_suburban_assembly gate --out-dir .claude/logs/s4/gate",
            "uv run python -m scripts.data_pipeline.stage_suburban_assembly audit --data-dir .claude/logs/s4/gate",
            "uv run python -m scripts.data_pipeline.stage_suburban_assembly handoff --data-dir .claude/logs/s4/gate",
            "```",
            "",
            "S5 must merge these staged overrides into a fresh product build and restore approved gameplay settings. Do not publish a stage artifact or relabel its manifest.",
            "",
        ]
    )


def handoff(*, root: Path = ROOT, data_dir: Path) -> dict[str, Any]:
    """Audit gate results, then save frozen inventory and S4 handoff metadata."""
    data_root = _resolve(root, data_dir)
    audit_report = audit(root=root, data_dir=data_root)
    oracle = _frozen_oracle(root)
    handoff_inputs = _handoff_inputs(root, data_root)
    assembled = root / assembly.ASSEMBLED_PATH
    inventory = {
        "counts": oracle["counts"],
        "serviceIds": [row["id"] for row in oracle["services"]],
        "stationIds": oracle["stationIds"],
    }
    verification = {
        "status": "verified",
        "oracleSource": {
            assembly.CATALOG_PATH: sha256_file(root / assembly.CATALOG_PATH),
            assembly.SERVICES_PATH: sha256_file(root / assembly.SERVICES_PATH),
        },
        "oracle": {"counts": oracle["counts"], "expectedCatalog": oracle["services"]},
        "checks": {
            "aAndBByteIdentical": True,
            "bothBuildsValidated": True,
            "allEvidenceBatchesVerified": True,
            "bidirectionalReachability": True,
            "shippedGeometryAndPlatformsRetained": True,
            "servicePlatformKeysRetained": True,
        },
        "gate": audit_report,
        "handoffInputs": handoff_inputs,
    }
    write_json(assembled / "inventory.json", inventory)
    write_json(assembled / "verification.json", verification)
    (assembled / "README.md").write_text(
        _handoff_readme(oracle, verification), encoding="utf-8", newline="\n"
    )
    return {
        "status": "handed-off",
        "inventory": inventory,
        "verification": verification,
    }


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    gate_parser = commands.add_parser("gate")
    gate_parser.add_argument("--root", type=Path, default=ROOT)
    gate_parser.add_argument("--out-dir", required=True, type=Path)
    audit_parser = commands.add_parser("audit")
    audit_parser.add_argument("--root", type=Path, default=ROOT)
    audit_parser.add_argument("--data-dir", required=True, type=Path)
    handoff_parser = commands.add_parser("handoff")
    handoff_parser.add_argument("--root", type=Path, default=ROOT)
    handoff_parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args(arguments)
    try:
        if args.command == "gate":
            result = gate(root=args.root, out_dir=args.out_dir)
        elif args.command == "audit":
            result = audit(root=args.root, data_dir=args.data_dir)
        else:
            result = handoff(root=args.root, data_dir=args.data_dir)
    except (OSError, KeyError, StageError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL {error}")
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
