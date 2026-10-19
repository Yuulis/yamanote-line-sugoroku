from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from scripts.s7_simulation_report import aggregate_reports, main, validate_report

CONFIG = {
    "rulesetVersion": "tokyo-suburban-1",
    "targetServiceId": "jr-yamanote",
    "startStationId": "shimbashi",
    "targetDirection": 1,
    "goalArrivalPolicy": "truncate-on-target-service",
    "serviceLottery": {
        "kindWeights": {"local": 1, "rapid": 1},
        "target": {"kind": "share", "numerator": 2, "denominator": 3},
    },
    "directionLottery": {"towardTargetWeight": 2},
}


def report(
    offset: int,
    seeds: list[str],
    turns: list[int],
    hashes: dict[str, str] | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "measurement": "s7-observations",
        "shard": {
            "offset": offset,
            "games": len(seeds),
            "baseSeed": 20261012,
            "turnCap": 20000,
        },
        "seeds": seeds,
        "seedSetSha256": hashlib.sha256(("\n".join(seeds) + "\n").encode()).hexdigest(),
        "turns": turns,
        "config": deepcopy(CONFIG),
        "bundleHashes": hashes
        or {
            name: "a" * 64
            for name in (
                "manifest.json",
                "stations.json",
                "services.json",
                "segments.json",
                "segments.geojson",
            )
        },
        "sourceHashes": {"observer": "c" * 64},
        "games": [
            {
                "seed": seed,
                "turns": turn,
                "hops": turn + 1,
                "completed": True,
                "errors": 0,
                "errorMessages": [],
                "zeroHopPlayingTurns": 0,
                "invalidChoices": 0,
                "unreachableStations": 0,
                "invalidTransitions": 0,
                "weightViolations": 0,
                "capHit": False,
                "targetDraws": 2,
                "targetSelections": 1,
                "targetExpectedSelections": 4 / 3,
                "towardDraws": 2,
                "towardSelections": 1,
                "towardExpectedSelections": 4 / 3,
                "equalDistanceDraws": 2,
                "equalDistanceForwardSelections": 1,
            }
            for seed, turn in zip(seeds, turns, strict=True)
        ],
    }


def test_aggregates_nonoverlapping_reports_and_lottery_diagnostics() -> None:
    result = aggregate_reports(
        [report(0, ["s1m-20261012-0"], [10]), report(1, ["s1m-20261012-1"], [12])]
    )
    assert result["games"] == 2
    assert result["totalHops"] == 24
    assert result["targetShare"]["numerator"] == 2
    assert result["targetShare"]["denominator"] == 4
    assert result["targetShare"]["expected"] == pytest.approx(2 / 3)
    assert result["targetShare"]["wilson95"]["low"] < 0.5
    assert result["towardShare"]["deviation"] == pytest.approx(-1 / 6)


def test_rejects_duplicate_seeds() -> None:
    with pytest.raises(ValueError, match="overlapping"):
        aggregate_reports(
            [
                report(1, ["s1m-20261012-1"], [10]),
                report(1, ["s1m-20261012-1"], [10]),
            ]
        )


def test_rejects_missing_or_noncontiguous_seed_ranges() -> None:
    with pytest.raises(ValueError, match="missing or noncontiguous"):
        aggregate_reports(
            [report(0, ["s1m-20261012-0"], [10]), report(2, ["s1m-20261012-2"], [12])]
        )


def test_rejects_seed_game_and_hash_mismatch() -> None:
    value = report(0, ["s1m-20261012-0"], [10])
    value["games"] = []
    with pytest.raises(ValueError, match="games count"):
        validate_report(value)
    value = report(0, ["s1m-20261012-0"], [10])
    value["seedSetSha256"] = "0" * 64
    with pytest.raises(ValueError, match="seed set hash"):
        validate_report(value)


def test_rejects_stale_bundle_hashes_and_config() -> None:
    with pytest.raises(ValueError, match="bundle hashes"):
        aggregate_reports(
            [
                report(0, ["s1m-20261012-0"], [10]),
                report(1, ["s1m-20261012-1"], [10], {"manifest": "b" * 64}),
            ]
        )
    stale = report(0, ["s1m-20261012-0"], [10])
    stale["config"]["rulesetVersion"] = "old-rules"  # type: ignore[index]
    with pytest.raises(ValueError, match="stale config"):
        validate_report(stale)


def test_rejects_malformed_counters_and_short_hashes() -> None:
    value = report(0, ["s1m-20261012-0"], [10])
    value["games"][0]["weightViolations"] = -1  # type: ignore[index]
    with pytest.raises(ValueError, match="counters"):
        validate_report(value)
    value = report(0, ["s1m-20261012-0"], [10])
    value["sourceHashes"]["observer"] = "bad"  # type: ignore[index]
    with pytest.raises(ValueError, match="sourceHashes"):
        validate_report(value)


def test_rejects_offset_zero_repeat_with_different_metrics() -> None:
    original = report(0, ["s1m-20261012-0"], [10])
    repeated = report(0, ["s1m-20261012-0"], [10])
    repeated["games"][0]["hops"] = 12  # type: ignore[index]
    with pytest.raises(ValueError, match="repeat metrics"):
        aggregate_reports([original, repeated])


def test_report_cli_authenticates_bundle_sources_and_golden_turns(
    tmp_path: Path,
) -> None:
    from scripts import s7_simulation_report as module

    bundle_dir = tmp_path / "bundle"
    bundle_dir.mkdir()
    bundle = {name: (name + "\n").encode() for name in module.BUNDLE_FILES}
    for name, content in bundle.items():
        (bundle_dir / name).write_bytes(content)
    source_hashes = {name: "c" * 64 for name in module.SOURCE_FILES}
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    golden_dir = tmp_path / "golden"
    golden_dir.mkdir()
    report_paths = []
    golden_seeds = [f"s1m-20261012-{i}" for i in range(5000)]
    (golden_dir / "sim-all.json").write_text(
        json.dumps({"seeds": golden_seeds, "turns": [10] * 5000}), encoding="utf-8"
    )
    for offset in range(0, 5000, 1250):
        seeds = [f"s1m-20261012-{i}" for i in range(offset, offset + 1250)]
        turns = [10] * len(seeds)
        value = report(
            offset,
            seeds,
            turns,
            {k: hashlib.sha256(v).hexdigest() for k, v in bundle.items()},
        )
        for game in value["games"]:
            game["targetDraws"] = 3
            game["targetSelections"] = 2
            game["targetExpectedSelections"] = 2
            game["towardDraws"] = 3
            game["towardSelections"] = 2
            game["towardExpectedSelections"] = 2
        value["sourceHashes"] = source_hashes.copy()
        path = reports_dir / f"observe-{offset}.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        report_paths.append(path)
    repeat = json.loads(report_paths[0].read_text())
    (reports_dir / "observe-repeat.json").write_text(
        json.dumps(repeat), encoding="utf-8"
    )
    common = ["--input-dir", str(reports_dir), "--output", str(tmp_path / "out.json")]

    def invoke() -> None:
        with (
            patch.object(module, "BUNDLE_DIR", bundle_dir),
            patch.object(module, "_load_current_sources", return_value=source_hashes),
            patch.object(module, "GOLDEN_DIR", golden_dir),
            patch("sys.argv", ["report", *common]),
        ):
            main()

    invoke()

    def edit_all_reports(edit: Callable[[dict[str, Any]], None]) -> None:
        for path in reports_dir.glob("observe-*.json"):
            value: dict[str, Any] = json.loads(path.read_text())
            edit(value)
            path.write_text(json.dumps(value), encoding="utf-8")

    edit_all_reports(
        lambda value: value["bundleHashes"].update({"manifest.json": "f" * 64})
    )
    with pytest.raises(SystemExit):
        invoke()
    edit_all_reports(lambda value: value["bundleHashes"].pop("services.json"))
    with pytest.raises(SystemExit):
        invoke()
    edit_all_reports(
        lambda value: value.update(
            bundleHashes={k: hashlib.sha256(v).hexdigest() for k, v in bundle.items()}
        )
    )

    def edit_one_report(path: Path) -> None:
        value = json.loads(path.read_text())
        value["sourceHashes"][module.SOURCE_FILES[0]] = "d" * 64
        path.write_text(json.dumps(value), encoding="utf-8")

    edit_one_report(reports_dir / "observe-1250.json")
    with pytest.raises(SystemExit):
        invoke()
    edit_all_reports(
        lambda value: value["sourceHashes"].update(
            {name: "d" * 64 for name in module.SOURCE_FILES}
        )
    )
    with pytest.raises(SystemExit):
        invoke()
    edit_all_reports(lambda value: value.update(sourceHashes=source_hashes.copy()))
    edit_all_reports(
        lambda value: value["bundleHashes"].update({"manifest.json": "e" * 64})
    )
    with pytest.raises(SystemExit):
        invoke()
    edit_all_reports(
        lambda value: value["bundleHashes"].update(
            {"manifest.json": hashlib.sha256(bundle["manifest.json"]).hexdigest()}
        )
    )
    value = json.loads(report_paths[0].read_text())
    value["turns"][0] = 11
    value["games"][0]["turns"] = 11
    report_paths[0].write_text(json.dumps(value), encoding="utf-8")
    repeat_value = json.loads((reports_dir / "observe-repeat.json").read_text())
    repeat_value["turns"][0] = 11
    repeat_value["games"][0]["turns"] = 11
    (reports_dir / "observe-repeat.json").write_text(
        json.dumps(repeat_value), encoding="utf-8"
    )
    with pytest.raises(SystemExit):
        invoke()


@pytest.mark.parametrize(
    "diagnostic", ["targetShare", "towardShare", "equalDistanceForwardShare"]
)
def test_cli_writes_report_then_fails_required_lottery_diagnostic(
    tmp_path: Path, diagnostic: str
) -> None:
    from scripts import s7_simulation_report as module

    # Exercise the CLI decision after aggregating a deliberately failing synthetic sample.
    result = {
        "completedGames": 5000,
        "capSeeds": [],
        "errors": 0,
        "zeroHopPlayingTurns": 0,
        "invalidChoices": 0,
        "unreachableStations": 0,
        "invalidTransitions": 0,
        "weightViolations": 0,
        "targetShare": {"denominator": 1000, "passesDiagnostic": True},
        "towardShare": {"denominator": 1000, "passesDiagnostic": True},
        "equalDistanceForwardShare": {"denominator": 10, "passesDiagnostic": True},
    }
    result[diagnostic]["passesDiagnostic"] = False
    report_dir = tmp_path / "reports"
    report_dir.mkdir()
    output = tmp_path / "summary.json"
    with (
        patch.object(module, "_load_current_sources", return_value={}),
        patch.object(module, "aggregate_reports", return_value=result),
        patch.object(module, "_verify_external_inputs", return_value=None),
        patch(
            "sys.argv",
            ["report", "--input-dir", str(report_dir), "--output", str(output)],
        ),
    ):
        with pytest.raises(SystemExit, match="investigation"):
            main()
    assert output.exists()
