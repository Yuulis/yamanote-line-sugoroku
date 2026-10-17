"""Gate, audit and handoff checks for the assembled S4 staging dataset."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from scripts.data_pipeline import stage_suburban_assembly_gate as gate
from scripts.data_pipeline.stage_suburban_support import StageError


def _oracle() -> dict[str, Any]:
    return {
        "counts": {
            "services": 2,
            "stationGroups": 3,
            "serviceStopRows": 4,
            "serviceRoutePairRows": 2,
            "directedSegments": 4,
        },
        "services": [
            {"id": "service-a", "stationIds": ["shimbashi", "b"]},
            {"id": "service-b", "stationIds": ["b", "c"]},
        ],
        "stationIds": ["shimbashi", "b", "c"],
        "circularByService": {"service-a": False, "service-b": False},
        "targetServiceId": "frozen-loop",
    }


def _artifact() -> dict[str, Any]:
    return {
        "stations": [
            {"id": "shimbashi"},
            {"id": "b"},
            {"id": "c"},
        ],
        "services": [
            {
                "id": "service-a",
                "stationIds": ["shimbashi", "b"],
                "platformCoordinates": {"shimbashi": [1, 1], "b": [2, 2]},
            },
            {
                "id": "service-b",
                "stationIds": ["b", "c"],
                "platformCoordinates": {"b": [2, 2], "c": [3, 3]},
            },
        ],
        "segments": [
            {"serviceId": "service-a", "from": "shimbashi", "to": "b"},
            {"serviceId": "service-a", "from": "b", "to": "shimbashi"},
            {"serviceId": "service-b", "from": "b", "to": "c"},
            {"serviceId": "service-b", "from": "c", "to": "b"},
        ],
        "manifest": {
            "validationProfile": "stage",
            "stageStartStationId": "shimbashi",
        },
    }


def _audit_files(root: Path) -> tuple[Path, dict[str, Any], list[dict[str, str]]]:
    data_dir = root / "runs"
    hashes: dict[str, dict[str, str]] = {}
    for label in ("a", "b"):
        build_dir = data_dir / label
        build_dir.mkdir(parents=True)
        (build_dir / "artifact.json").write_text("{}\n", encoding="utf-8")
        hashes[label] = gate.hash_tree(build_dir)
    evidence = [{"batch": batch, "status": "verified"} for batch in gate.BATCHES]
    report = {
        "status": "passed",
        "inputHashesSha256": "input-hash",
        "assembledOverridesSha256": "override-hash",
        "pipelineHashes": gate._pipeline_hashes(),
        "frozenCounts": _oracle()["counts"],
        "builds": {"a": {"status": "validated"}, "b": {"status": "validated"}},
        "buildHashes": hashes,
        "evidence": evidence,
    }
    (data_dir / gate.GATE_FILE).write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return data_dir, report, evidence


def test_gate_builds_and_validates_two_outputs_then_checks_every_batch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    oracle = _oracle()

    monkeypatch.setattr(
        gate,
        "_require_current_assembly",
        lambda root: {
            "oracle": oracle,
            "inputHashesSha256": "input-hash",
            "assembledOverridesSha256": "override-hash",
        },
    )
    monkeypatch.setattr(gate, "_frozen_oracle", lambda root: oracle)
    monkeypatch.setattr(
        gate,
        "_build_once",
        lambda root, overrides_dir, out_dir: calls.append(out_dir.name),
    )
    monkeypatch.setattr(
        gate,
        "_validate_artifact",
        lambda root, data_dir, oracle: {"status": "validated"},
    )
    checked: list[str] = []
    monkeypatch.setattr(
        gate,
        "_check_all_evidence",
        lambda root: (
            checked.extend(gate.BATCHES)
            or [{"batch": name, "status": "verified"} for name in gate.BATCHES]
        ),
    )

    report = gate.gate(root=tmp_path, out_dir=tmp_path / "runs")

    assert calls == ["a", "b"]
    assert checked == list(gate.BATCHES)
    assert report["status"] == "passed"
    assert report["builds"]["a"]["status"] == "validated"
    assert report["builds"]["b"]["status"] == "validated"


def test_audit_rejects_service_platform_keys_missing_from_frozen_stops() -> None:
    artifact = _artifact()
    artifact["services"][0]["platformCoordinates"].pop("b")

    with pytest.raises(StageError, match="platform keys differ for service-a"):
        gate._check_artifact_contract(artifact, _oracle())


def test_artifact_contract_matches_frozen_counts_and_directed_routes() -> None:
    assert gate._check_artifact_contract(_artifact(), _oracle()) == _oracle()["counts"]


def test_current_assembly_accepts_frozen_expected_catalog_station_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assembled = tmp_path / gate.assembly.ASSEMBLED_PATH
    overrides = assembled / "overrides"
    overrides.mkdir(parents=True)
    saved_inputs = {"freeze": "frozen"}
    (assembled / "inputs-sha256.json").write_text(
        json.dumps(saved_inputs), encoding="utf-8"
    )
    oracle = _oracle()
    (assembled / "inventory.json").write_text(
        json.dumps(
            {
                "counts": oracle["counts"],
                "serviceIds": [row["id"] for row in oracle["services"]],
                "stationIds": oracle["stationIds"],
            }
        ),
        encoding="utf-8",
    )
    (assembled / "verification.json").write_text(
        json.dumps(
            {
                "status": "verified",
                "oracle": {
                    "counts": oracle["counts"],
                    "expectedCatalog": oracle["services"],
                },
            }
        ),
        encoding="utf-8",
    )
    (assembled / "assembly-report.json").write_text(
        json.dumps(
            {
                "status": "assembled",
                "counts": oracle["counts"],
                "inputHashesSha256": gate.hash_value(saved_inputs),
            }
        ),
        encoding="utf-8",
    )
    (overrides / "expected-catalog.json").write_text(
        json.dumps(
            {"services": oracle["services"], "stationIds": oracle["stationIds"]}
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(gate.assembly, "preflight", lambda root: {"status": "ready"})
    monkeypatch.setattr(
        gate.assembly,
        "_build_inputs_report",
        lambda root, report: saved_inputs,
    )
    monkeypatch.setattr(gate, "_frozen_oracle", lambda root: oracle)
    monkeypatch.setattr(
        gate,
        "load_overrides",
        lambda path: SimpleNamespace(
            dataset=SimpleNamespace(
                validation_profile="stage",
                stage_start_station_id="shimbashi",
                reviewed_disconnected_service_ids=[],
                expected_catalogue_file="expected-catalog.json",
            )
        ),
    )
    monkeypatch.setattr(
        gate.assembly.nonjr, "_component_file_hash", lambda path: "override-hash"
    )

    result = gate._require_current_assembly(tmp_path)

    assert result["oracle"]["stationIds"] == oracle["stationIds"]


def test_audit_is_read_only_after_validating_current_outputs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir, _, evidence = _audit_files(tmp_path)
    monkeypatch.setattr(
        gate,
        "_require_current_assembly",
        lambda root: {
            "oracle": _oracle(),
            "inputHashesSha256": "input-hash",
            "assembledOverridesSha256": "override-hash",
        },
    )
    monkeypatch.setattr(gate, "_check_all_evidence", lambda root: evidence)
    monkeypatch.setattr(gate, "_audit_built_preservation", lambda *args: [])
    before = gate.hash_tree(tmp_path)

    result = gate.audit(root=tmp_path, data_dir=data_dir)

    assert result["status"] == "audited"
    assert gate.hash_tree(tmp_path) == before


def test_audit_rejects_tampered_build_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir, _, _ = _audit_files(tmp_path)
    (data_dir / "a/artifact.json").write_text('{"changed":true}\n', encoding="utf-8")
    monkeypatch.setattr(
        gate,
        "_require_current_assembly",
        lambda root: {
            "oracle": _oracle(),
            "inputHashesSha256": "input-hash",
            "assembledOverridesSha256": "override-hash",
        },
    )

    with pytest.raises(StageError, match="stale or tampered"):
        gate.audit(root=tmp_path, data_dir=data_dir)


def test_handoff_uses_frozen_inventory_and_writes_audit_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assembled = tmp_path / gate.assembly.ASSEMBLED_PATH
    assembled.mkdir(parents=True)
    catalog = tmp_path / gate.assembly.CATALOG_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("catalog\n", encoding="utf-8")
    services = tmp_path / gate.assembly.SERVICES_PATH
    services.write_text("services\n", encoding="utf-8")
    report = {
        "status": "audited",
        "gateReportSha256": "c",
        "buildHashes": {"a": "a", "b": "b"},
    }
    oracle = _oracle()
    monkeypatch.setattr(gate, "audit", lambda **kwargs: report)
    monkeypatch.setattr(gate, "_frozen_oracle", lambda root: oracle)
    monkeypatch.setattr(gate, "_handoff_inputs", lambda root, data_dir: {"gate": "c"})

    result = gate.handoff(root=tmp_path, data_dir=tmp_path / "runs")

    assert result["status"] == "handed-off"
    assert json.loads((assembled / "inventory.json").read_text()) == {
        "counts": oracle["counts"],
        "serviceIds": ["service-a", "service-b"],
        "stationIds": oracle["stationIds"],
    }
    verification = json.loads((assembled / "verification.json").read_text())
    assert verification["status"] == "verified"
    assert verification["gate"]["status"] == "audited"
    readme = (assembled / "README.md").read_text(encoding="utf-8")
    assert "gate --out-dir .claude/logs/s4/gate" in readme
    assert "audit --data-dir .claude/logs/s4/gate" in readme
    assert "handoff --data-dir .claude/logs/s4/gate" in readme
