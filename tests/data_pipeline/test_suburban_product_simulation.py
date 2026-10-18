"""Independent acceptance checks for the S5 product simulation shards."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from scripts.data_pipeline.product_suburban import (
    SIMULATION_CODE_FILES,
    StageError,
    simulation_code_fingerprint,
    verify_simulation,
)

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_OFFSETS = (0, 1250, 2500, 3750)
GAMES_PER_SHARD = 1250
BASE_SEED = 20261012


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bundle_hashes(root: Path) -> dict[str, str]:
    return {
        name: _sha256((root / "public/data" / name).read_bytes())
        for name in (
            "manifest.json",
            "stations.json",
            "services.json",
            "segments.json",
            "segments.geojson",
        )
    }


def _gameplay_signature_sha256(root: Path) -> str:
    services_data = json.loads((root / "public/data/services.json").read_text())
    segments = json.loads((root / "public/data/segments.json").read_text())
    services: list[dict[str, Any]] = []
    for service in services_data["services"]:
        item = {
            "id": service["id"],
            "kind": service["kind"],
            "stationIds": service["stationIds"],
            "circular": service["circular"],
        }
        if not service["circular"]:
            item["endpoints"] = service["endpoints"]
        services.append(item)
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
    payload = json.dumps(signature, ensure_ascii=False, separators=(",", ":"))
    return _sha256(payload.encode("utf-8"))


def _expected_config(root: Path) -> dict[str, Any]:
    freeze = json.loads(
        (root / ".claude/docs/plans/tokyo-suburban-s0-freeze.json").read_text()
    )
    ruleset = freeze["ruleset"]
    return {
        "rulesetVersion": ruleset["id"],
        "targetServiceId": ruleset["targetServiceId"],
        "startStationId": ruleset["startStationId"],
        "targetDirection": ruleset["targetDirection"],
        "goalArrivalPolicy": "truncate-on-target-service",
        "serviceLottery": ruleset["serviceLottery"],
        "directionLottery": ruleset["directionLottery"],
    }


def _statistics(turns: list[int]) -> dict[str, Any]:
    ordered = sorted(turns)

    def nearest_rank(percentile: float) -> int:
        return ordered[(len(ordered) * int(percentile * 100) + 99) // 100 - 1]

    return {
        "games": len(turns),
        "completedGames": len(turns),
        "capHits": 0,
        "cappedGameIndices": [],
        "median": nearest_rank(0.5),
        "p90": nearest_rank(0.9),
        "p99": nearest_rank(0.99),
        "mean": sum(turns) / len(turns),
        "max": ordered[-1],
        "over500Count": sum(turn > 500 for turn in turns),
        "totalPlayedTurns": sum(turns),
    }


def _read_reference_turns(root: Path, offset: int) -> list[int]:
    source = root / ".claude/logs/r2" / f"target-two-thirds-{offset}.json"
    return json.loads(source.read_text())["turns"]


def _write_shard(
    root: Path,
    out_dir: Path,
    offset: int,
    turns: list[int],
    *,
    filename: str | None = None,
    runtime_seconds: float = 1.0,
) -> Path:
    seeds = [f"s1m-{BASE_SEED}-{index}" for index in range(offset, offset + len(turns))]
    payload = {
        "schemaVersion": 1,
        "measurement": "s5-product",
        "shard": {
            "offset": offset,
            "games": len(turns),
            "baseSeed": BASE_SEED,
            "turnCap": 20000,
        },
        "seeds": seeds,
        "seedSetSha256": _sha256(("\n".join(seeds) + "\n").encode("utf-8")),
        "config": _expected_config(root),
        "bundleHashes": _bundle_hashes(root),
        "gameplaySignatureSha256": _gameplay_signature_sha256(root),
        "codeFingerprint": simulation_code_fingerprint(root=root),
        "quantileConvention": "nearest-rank: ceil(p * games) - 1",
        "turns": turns,
        "statistics": _statistics(turns),
        "runtimeSeconds": runtime_seconds,
    }
    path = out_dir / (filename or f"sim-{offset}.json")
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return path


@pytest.fixture
def complete_simulation(tmp_path: Path) -> Path:
    for offset in EXPECTED_OFFSETS:
        _write_shard(ROOT, tmp_path, offset, _read_reference_turns(ROOT, offset))
    _write_shard(
        ROOT,
        tmp_path,
        0,
        _read_reference_turns(ROOT, 0),
        filename="sim-repeat.json",
        runtime_seconds=2.5,
    )
    return tmp_path


def test_verify_simulation_accepts_exact_complete_shards(
    complete_simulation: Path,
) -> None:
    report = verify_simulation(root=ROOT, shard_dir=complete_simulation)

    assert report["status"] == "verified"
    assert report["games"] == 5000
    assert report["perSeedMismatchCount"] == 0
    assert report["statistics"] == {
        "games": 5000,
        "completedGames": 5000,
        "capHits": 0,
        "cappedGameIndices": [],
        "median": 55,
        "p90": 146,
        "p99": 261,
        "mean": 69.3858,
        "max": 446,
        "over500Count": 0,
        "totalPlayedTurns": 346929,
    }


def test_verify_simulation_rejects_missing_shard(
    complete_simulation: Path,
) -> None:
    (complete_simulation / "sim-2500.json").unlink()

    with pytest.raises(StageError, match="expected exactly the S5 shard offsets"):
        verify_simulation(root=ROOT, shard_dir=complete_simulation)


def test_verify_simulation_rejects_overlap_and_stale_bundle(
    complete_simulation: Path,
) -> None:
    shard_path = complete_simulation / "sim-1250.json"
    shard = json.loads(shard_path.read_text())
    shard["shard"]["offset"] = 0
    shard_path.write_text(json.dumps(shard))

    with pytest.raises(StageError, match="range is stale or overlaps"):
        verify_simulation(root=ROOT, shard_dir=complete_simulation)

    shard["shard"]["offset"] = 1250
    shard["bundleHashes"]["segments.json"] = "0" * 64
    shard_path.write_text(json.dumps(shard))
    with pytest.raises(StageError, match="stale bundle hashes"):
        verify_simulation(root=ROOT, shard_dir=complete_simulation)


def test_verify_simulation_reports_first_per_seed_differences(
    complete_simulation: Path,
) -> None:
    shard_path = complete_simulation / "sim-0.json"
    shard = json.loads(shard_path.read_text())
    shard["turns"][17] += 1
    shard["statistics"] = _statistics(shard["turns"])
    shard_path.write_text(json.dumps(shard))
    repeat_path = complete_simulation / "sim-repeat.json"
    repeat = json.loads(repeat_path.read_text())
    repeat["turns"][17] += 1
    repeat["statistics"] = _statistics(repeat["turns"])
    repeat_path.write_text(json.dumps(repeat))

    report = verify_simulation(root=ROOT, shard_dir=complete_simulation)

    assert report["status"] == "failed"
    assert report["perSeedMismatchCount"] == 1
    assert report["firstPerSeedMismatches"] == [
        {
            "seed": "s1m-20261012-17",
            "expectedTurns": _read_reference_turns(ROOT, 0)[17],
            "actualTurns": _read_reference_turns(ROOT, 0)[17] + 1,
        }
    ]


def test_verify_simulation_rejects_nondeterministic_repeat(
    complete_simulation: Path,
) -> None:
    repeat_path = complete_simulation / "sim-repeat.json"
    repeat = json.loads(repeat_path.read_text())
    repeat["turns"][3] += 1
    repeat["statistics"] = _statistics(repeat["turns"])
    repeat_path.write_text(json.dumps(repeat))

    with pytest.raises(StageError, match="repeat offset-0 shard differs"):
        verify_simulation(root=ROOT, shard_dir=complete_simulation)


def test_verify_simulation_rejects_stale_implementation_fingerprint(
    complete_simulation: Path,
) -> None:
    shard_path = complete_simulation / "sim-3750.json"
    shard = json.loads(shard_path.read_text())
    first_code_file = next(iter(SIMULATION_CODE_FILES))
    shard["codeFingerprint"]["files"][first_code_file] = "0" * 64
    shard_path.write_text(json.dumps(shard))

    with pytest.raises(StageError, match="stale simulation code fingerprint"):
        verify_simulation(root=ROOT, shard_dir=complete_simulation)
