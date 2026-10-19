"""Validate and aggregate S7 simulation observation shards."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

EXPECTED_BASE_SEED = 20261012
EXPECTED_TURN_CAP = 20000
EXPECTED_GAMES = 5000
EXPECTED_CONFIG = {
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
COUNTERS = (
    "hops",
    "errors",
    "zeroHopPlayingTurns",
    "invalidChoices",
    "unreachableStations",
    "invalidTransitions",
    "weightViolations",
    "targetDraws",
    "targetSelections",
    "towardDraws",
    "towardSelections",
    "equalDistanceDraws",
    "equalDistanceForwardSelections",
)
EXPECTED_COUNTERS = ("targetExpectedSelections", "towardExpectedSelections")
BUNDLE_FILES = (
    "manifest.json",
    "stations.json",
    "services.json",
    "segments.json",
    "segments.geojson",
)
SOURCE_FILES = (
    "tests/simulation/suburban-observations.ts",
    "src/features/game/gameConfig.ts",
    "src/features/game/engine/game.ts",
    "src/features/game/engine/landing.ts",
    "src/features/game/engine/movement.ts",
    "src/features/game/engine/network.ts",
    "src/features/game/engine/proximity.ts",
    "src/features/game/engine/rng.ts",
)
BUNDLE_DIR = Path("public/data")
SOURCE_HASHES: dict[str, str] = {}
GOLDEN_DIR = Path(".claude/logs/s6/simulation/s6-fix")


def _is_count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def validate_report(report: Any) -> None:
    if (
        not isinstance(report, dict)
        or report.get("schemaVersion") != 1
        or report.get("measurement") != "s7-observations"
    ):
        raise ValueError("unsupported observation report schema")
    shard = report.get("shard")
    if (
        not isinstance(shard, dict)
        or shard.get("baseSeed") != EXPECTED_BASE_SEED
        or shard.get("turnCap") != EXPECTED_TURN_CAP
    ):
        raise ValueError("invalid shard seed or turn cap")
    seeds, turns, games = report.get("seeds"), report.get("turns"), report.get("games")
    if (
        not isinstance(seeds, list)
        or not isinstance(turns, list)
        or not isinstance(games, list)
    ):
        raise ValueError("seeds, turns and games must be arrays")
    if (
        shard.get("games") != len(seeds)
        or len(turns) != len(seeds)
        or len(games) != len(seeds)
    ):
        raise ValueError("games count does not match seeds/turns/games")
    offset = shard.get("offset")
    if not _is_count(offset) or not seeds:
        raise ValueError("invalid shard offset or empty shard")
    if offset + len(seeds) > EXPECTED_GAMES:
        raise ValueError("seed range exceeds frozen 5,000-game range")
    expected = [
        f"s1m-{EXPECTED_BASE_SEED}-{index}"
        for index in range(offset, offset + len(seeds))
    ]
    if seeds != expected or turns != [
        game.get("turns") for game in games if isinstance(game, dict)
    ]:
        raise ValueError("invalid seeds or turns do not match games")
    for seed, game in zip(seeds, games, strict=True):
        if (
            not isinstance(game, dict)
            or game.get("seed") != seed
            or not isinstance(game.get("completed"), bool)
            or not isinstance(game.get("capHit"), bool)
        ):
            raise ValueError("malformed game record")
        if not _is_count(game.get("turns")) or game["turns"] < 1:
            raise ValueError("malformed game turns")
        if any(not _is_count(game.get(key)) for key in COUNTERS):
            raise ValueError("malformed game counters")
        if any(
            not isinstance(game.get(key), (int, float))
            or isinstance(game.get(key), bool)
            or not math.isfinite(game[key])
            or game[key] < 0
            for key in EXPECTED_COUNTERS
        ):
            raise ValueError("malformed expected lottery counters")
        if game["targetSelections"] > game["targetDraws"]:
            raise ValueError("target selections exceed eligible draws")
        if game["towardSelections"] > game["towardDraws"]:
            raise ValueError("toward selections exceed eligible draws")
        if game["equalDistanceForwardSelections"] > game["equalDistanceDraws"]:
            raise ValueError("equal-distance selections exceed eligible draws")
    for key in ("bundleHashes", "sourceHashes"):
        hashes = report.get(key)
        if (
            not isinstance(hashes, dict)
            or not hashes
            or any(
                not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
                for value in hashes.values()
            )
        ):
            raise ValueError(f"missing or malformed {key}")
    if report.get("config") != EXPECTED_CONFIG:
        raise ValueError("stale config")
    seed_hash = report.get("seedSetSha256")
    if not isinstance(seed_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", seed_hash):
        raise ValueError("missing or malformed seed set hash")
    if seed_hash != hashlib.sha256(("\n".join(seeds) + "\n").encode()).hexdigest():
        raise ValueError("seed set hash does not match seeds")


def _quantiles(values: list[int]) -> dict[str, float | int]:
    ordered = sorted(values)

    def nearest(p: float) -> int:
        return ordered[math.ceil(p * len(ordered)) - 1]

    return {
        "min": ordered[0],
        "median": nearest(0.5),
        "p90": nearest(0.9),
        "p99": nearest(0.99),
        "mean": sum(values) / len(values),
        "max": ordered[-1],
    }


def _wilson(successes: int, trials: int) -> dict[str, float] | None:
    if trials == 0:
        return None
    z = 1.959963984540054
    proportion = successes / trials
    divisor = 1 + z * z / trials
    center = (proportion + z * z / (2 * trials)) / divisor
    margin = (
        z
        * math.sqrt((proportion * (1 - proportion) + z * z / (4 * trials)) / trials)
        / divisor
    )
    return {"low": max(0.0, center - margin), "high": min(1.0, center + margin)}


def _lottery_summary(
    numerator: int,
    denominator: int,
    expected_numerator: float,
) -> dict[str, Any]:
    if denominator == 0:
        return {
            "numerator": numerator,
            "denominator": denominator,
            "observed": None,
            "expected": None,
            "deviation": None,
            "wilson95": None,
            "threshold": None,
            "passesDiagnostic": None,
        }
    observed = numerator / denominator
    expected = expected_numerator / denominator
    threshold = max(0.01, 5 * math.sqrt(expected * (1 - expected) / denominator))
    return {
        "numerator": numerator,
        "denominator": denominator,
        "observed": observed,
        "expected": expected,
        "deviation": observed - expected,
        "wilson95": _wilson(numerator, denominator),
        "threshold": threshold,
        "passesDiagnostic": abs(observed - expected) <= threshold,
    }


def aggregate_reports(
    reports: list[dict[str, Any]], *, require_complete: bool = False
) -> dict[str, Any]:
    if not reports:
        raise ValueError("no observation reports")
    for report in reports:
        validate_report(report)
    # Offset zero is the first primary shard; a second offset-zero shard is its repeat.
    zero_reports = [report for report in reports if report["shard"]["offset"] == 0]
    if len(zero_reports) > 2:
        raise ValueError("multiple offset-zero repeats")
    repeat = zero_reports[1] if len(zero_reports) == 2 else None
    primary = [report for report in reports if report is not repeat]
    if (
        any(report["shard"]["offset"] == 0 for report in primary)
        and len(zero_reports) == 2
    ):
        primary = [report for report in primary if report is not zero_reports[1]]
    hashes = primary[0]["bundleHashes"]
    config = primary[0]["config"]
    if any(report["bundleHashes"] != hashes for report in reports) or any(
        report["config"] != config for report in reports
    ):
        raise ValueError("stale or differing bundle hashes/config")
    source_hashes = primary[0]["sourceHashes"]
    if any(report["sourceHashes"] != source_hashes for report in reports):
        raise ValueError("differing source fingerprints")
    games = [game for report in primary for game in report["games"]]
    seeds = [game["seed"] for game in games]
    if len(set(seeds)) != len(seeds):
        raise ValueError("overlapping seed ranges")
    games.sort(key=lambda game: int(game["seed"].rsplit("-", 1)[1]))
    expected_seeds = [
        f"s1m-{EXPECTED_BASE_SEED}-{index}" for index in range(len(games))
    ]
    if sorted(seeds, key=lambda seed: int(seed.rsplit("-", 1)[1])) != expected_seeds:
        raise ValueError("missing or noncontiguous seed ranges")
    if require_complete:
        if len(games) != EXPECTED_GAMES:
            raise ValueError(
                f"expected {EXPECTED_GAMES} unique observations, found {len(games)}"
            )
        expected_shards = [(offset, 1250) for offset in (0, 1250, 2500, 3750)]
        actual_shards = sorted(
            (report["shard"]["offset"], report["shard"]["games"]) for report in primary
        )
        if actual_shards != expected_shards:
            raise ValueError("expected four nonoverlapping 1,250-game primary shards")
        if repeat is None or repeat["shard"]["games"] != 1250:
            raise ValueError("missing offset-zero 1,250-game repeat")
    if repeat is not None:
        first = next(report for report in primary if report["shard"]["offset"] == 0)
        comparable = (
            "seed",
            "turns",
            *COUNTERS,
            *EXPECTED_COUNTERS,
            "completed",
            "capHit",
        )
        if [{key: game[key] for key in comparable} for game in first["games"]] != [
            {key: game[key] for key in comparable} for game in repeat["games"]
        ]:
            raise ValueError("offset-zero repeat metrics do not match")
        if repeat["seeds"] != first["seeds"]:
            raise ValueError("offset-zero repeat seed range does not match")
    values = {key: sum(game[key] for game in games) for key in COUNTERS}
    expected_values = {
        key: sum(game[key] for game in games) for key in EXPECTED_COUNTERS
    }
    return {
        "schemaVersion": 1,
        "measurement": "s7-observations-aggregate",
        "games": len(games),
        "seeds": [game["seed"] for game in games],
        "bundleHashes": hashes,
        "sourceHashes": source_hashes,
        "config": config,
        "turnStatistics": _quantiles([game["turns"] for game in games]),
        "hopStatistics": _quantiles([game["hops"] for game in games]),
        "hopsPerTurn": values["hops"] / sum(game["turns"] for game in games),
        "totalHops": values["hops"],
        "completedGames": sum(game["completed"] for game in games),
        "capSeeds": [game["seed"] for game in games if game["capHit"]],
        **{key: value for key, value in values.items() if key != "hops"},
        **expected_values,
        "targetShare": _lottery_summary(
            values["targetSelections"],
            values["targetDraws"],
            expected_values["targetExpectedSelections"],
        ),
        "towardShare": _lottery_summary(
            values["towardSelections"],
            values["towardDraws"],
            expected_values["towardExpectedSelections"],
        ),
        "equalDistanceForwardShare": _lottery_summary(
            values["equalDistanceForwardSelections"],
            values["equalDistanceDraws"],
            values["equalDistanceDraws"] / 2,
        ),
    }


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_current_bundle(bundle_dir: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for name in BUNDLE_FILES:
        path = bundle_dir / name
        if not path.is_file():
            raise ValueError(f"current bundle file is missing: {path}")
        hashes[name] = _sha256(path)
    return hashes


def _load_current_sources() -> dict[str, str]:
    return {name: _sha256(Path(name)) for name in SOURCE_FILES}


def _load_golden_turns(golden_dir: Path) -> dict[str, int]:
    goldens: dict[str, int] = {}
    paths = sorted(golden_dir.glob("sim-*.json"))
    if not paths:
        raise ValueError(f"no S6 golden shards found in {golden_dir}")
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        seeds, turns = payload.get("seeds"), payload.get("turns")
        if (
            not isinstance(seeds, list)
            or not isinstance(turns, list)
            or len(seeds) != len(turns)
        ):
            raise ValueError(f"malformed S6 golden shard: {path}")
        for seed, turns_count in zip(seeds, turns, strict=True):
            if not isinstance(seed, str) or not _is_count(turns_count):
                raise ValueError(f"invalid S6 golden seed in {path}")
            if seed in goldens and goldens[seed] != turns_count:
                raise ValueError(f"conflicting S6 golden turns for {seed} in {path}")
            goldens[seed] = turns_count
    return goldens


def _verify_external_inputs(
    reports: list[dict[str, Any]],
    input_dir: Path,
    bundle_dir: Path,
    golden_dir: Path,
    source_hashes: dict[str, str],
) -> None:
    expected_bundle = _load_current_bundle(bundle_dir)
    if set(reports[0]["bundleHashes"]) != set(BUNDLE_FILES):
        raise ValueError(
            "bundle hash inventory must contain exactly the five required files"
        )
    if reports[0]["bundleHashes"] != expected_bundle:
        raise ValueError("bundle hashes do not match current bundle files")
    if set(reports[0]["sourceHashes"]) != set(SOURCE_FILES):
        raise ValueError("source hash inventory does not match observer/engine sources")
    if reports[0]["sourceHashes"] != source_hashes:
        raise ValueError("source hashes do not match current observer/engine files")
    goldens = _load_golden_turns(golden_dir)
    observed: dict[str, int] = {}
    for report in reports:
        for game in report["games"]:
            seed = game["seed"]
            if seed in observed:
                continue  # repeat shard is checked separately by aggregate_reports
            observed[seed] = game["turns"]
    if set(observed) != set(goldens):
        missing = sorted(set(goldens) - set(observed))[:5]
        extra = sorted(set(observed) - set(goldens))[:5]
        raise ValueError(
            f"observation seeds differ from S6 golden inventory; missing={missing}, extra={extra}"
        )
    differences = [seed for seed, turns in observed.items() if goldens[seed] != turns]
    if differences:
        raise ValueError(
            f"observation turns differ from S6 golden for seeds: {differences[:5]}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--bundle-dir", type=Path, default=BUNDLE_DIR)
    parser.add_argument("--golden-dir", type=Path, default=GOLDEN_DIR)
    args = parser.parse_args()
    try:
        reports = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(args.input_dir.glob("observe-*.json"))
        ]
        source_hashes = _load_current_sources()
        result = aggregate_reports(reports, require_complete=True)
        _verify_external_inputs(
            reports, args.input_dir, args.bundle_dir, args.golden_dir, source_hashes
        )
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise SystemExit(f"invalid S7 observation evidence: {error}") from error
    if (
        result["completedGames"] != EXPECTED_GAMES
        or result["capSeeds"]
        or any(
            result[key]
            for key in (
                "errors",
                "zeroHopPlayingTurns",
                "invalidChoices",
                "unreachableStations",
                "invalidTransitions",
                "weightViolations",
            )
        )
    ):
        raise SystemExit(
            "observation shards contain incomplete games or invariant violations"
        )
    for key in ("targetShare", "towardShare"):
        if result[key]["denominator"] < 1000:
            raise SystemExit(
                f"insufficient eligible draws for {key}: {result[key]['denominator']}"
            )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for key in ("targetShare", "towardShare", "equalDistanceForwardShare"):
        diagnostic = result[key]
        if diagnostic["denominator"] == 0 and key == "equalDistanceForwardShare":
            continue
        if diagnostic["denominator"] < 1000 and key != "equalDistanceForwardShare":
            raise SystemExit(
                f"insufficient eligible draws for {key}: {diagnostic['denominator']}"
            )
        if diagnostic["passesDiagnostic"] is False:
            raise SystemExit(
                f"{key} failed its diagnostic; investigation required for observed lottery behavior"
            )


if __name__ == "__main__":
    main()
