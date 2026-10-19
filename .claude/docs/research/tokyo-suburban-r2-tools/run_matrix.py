"""Generate and measure R2 variants with independent real-engine seed shards."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import subprocess
import sys
from pathlib import Path

TOOLS = Path(".claude/docs/research/tokyo-suburban-r2-tools")
RESEARCH = Path(".claude/docs/research")
LOGS = Path(".claude/logs/r2")


def cases() -> list[dict]:
    return [
        {"name": "decided", "input": "official", "preset": "decided", "games": 20000},
        {
            "name": "all-equal",
            "input": "official",
            "preset": "all-equal",
            "games": 20000,
        },
        {
            "name": "identity-shared",
            "input": "shared",
            "preset": "decided",
            "games": 5000,
        },
        {
            "name": "identity-same-name",
            "input": "same-name",
            "preset": "decided",
            "games": 5000,
        },
        {
            "name": "identity-300m",
            "input": "official-300",
            "preset": "decided",
            "games": 5000,
        },
        *[
            {"name": v, "input": v, "preset": "decided", "games": 5000}
            for v in (
                "split",
                "split-joban",
                "split-chuo",
                "split-utsunomiya",
                "merge-shinonoi",
                "mito-through",
            )
        ],
        {
            "name": "target-three-quarters",
            "input": "official",
            "preset": "decided",
            "games": 5000,
            "targetShare": [3, 4],
        },
        {
            "name": "direction-three",
            "input": "official",
            "preset": "decided",
            "games": 5000,
            "directionWeight": 3,
        },
        {
            "name": "pass-through",
            "input": "official",
            "preset": "decided",
            "games": 5000,
            "passThrough": True,
        },
        {
            "name": "three-quarters-direction-three",
            "input": "official",
            "preset": "decided",
            "games": 5000,
            "targetShare": [3, 4],
            "directionWeight": 3,
        },
    ]


def input_prefix(name: str) -> Path:
    return RESEARCH / "tokyo-suburban-research" if name == "official" else LOGS / name


def generate() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    variants = [
        ("official", "official", 600, "whole"),
        ("shared", "shared", 500, "whole"),
        ("same-name", "same-name", 600, "whole"),
        ("official-300", "official", 300, "whole"),
    ]
    variants += [
        (v, "official", 600, v)
        for v in (
            "split",
            "split-joban",
            "split-chuo",
            "split-utsunomiya",
            "merge-shinonoi",
            "mito-through",
        )
    ]
    for name, rule, threshold, variant in variants:
        subprocess.run(
            [
                sys.executable,
                str(TOOLS / "build_catalog.py"),
                "--rule",
                rule,
                "--threshold",
                str(threshold),
                "--variant",
                variant,
                "--out",
                str(input_prefix(name)),
            ],
            check=True,
        )


def fingerprint(task: dict) -> str:
    files = [
        Path(task["catalog"]),
        Path(task["services"]),
        TOOLS / "measure.test.ts",
        Path("tests/simulation/harness.ts"),
        Path("tests/simulation/inputs.ts"),
        Path("tests/simulation/csv.ts"),
        Path("src/data/guards.ts"),
        TOOLS / "run_matrix.py",
        Path("package-lock.json"),
    ]
    files += sorted(Path("src/features/game/engine").glob("*.ts"))
    files += [Path("src/types/network.ts")]
    h = hashlib.sha256()
    for p in files:
        h.update(str(p).encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def run_task(task: dict) -> dict:
    path = LOGS / f"task-{task['name']}-{task['offset']}.json"
    task["fingerprint"] = fingerprint(task)
    output = Path(task["output"])
    if output.exists():
        previous = json.loads(output.read_text())
        if previous["task"] == task:
            return previous
    path.write_text(json.dumps(task, indent=2) + "\n")
    with path.with_suffix(".log").open("w") as log:
        result = subprocess.run(
            ["npx", "vitest", "run", "--config", str(TOOLS / "vitest.config.ts")],
            check=False,
            env={**os.environ, "R2_TASK": str(path)},
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    if not output.exists():
        raise RuntimeError(
            f"No report for {path}; exit {result.returncode}; see {path.with_suffix('.log')}"
        )
    report = json.loads(output.read_text())
    if report["task"] != task or result.returncode:
        raise RuntimeError(f"Invalid/failed shard {path}; see log")
    return report


def combine(case: dict, shards: list[dict]) -> dict:
    shards.sort(key=lambda r: r["task"]["offset"])
    offset = 0
    turns = []
    censored = []
    played = 0
    for shard in shards:
        task = shard["task"]
        assert task["offset"] == offset
        assert len(shard["turns"]) == task["games"]
        assert shard["config"] == shards[0]["config"]
        assert shard["input"] == shards[0]["input"]
        assert task["fingerprint"] == shards[0]["task"]["fingerprint"]
        seeds = "".join(
            f"s1m-20261012-{i}\n" for i in range(offset, offset + task["games"])
        )
        assert hashlib.sha256(seeds.encode()).hexdigest() == shard["seedSetSha256"]
        offset += task["games"]
        turns += shard["turns"]
        censored += shard["censored"]
        played += shard["statistics"]["totalPlayedTurns"]
    assert offset == case["games"]
    ordered = sorted(turns)
    stats = {
        "games": offset,
        "completedGames": offset - len(censored),
        "capHits": len(censored),
        "cappedGameIndices": censored,
        "median": ordered[math.ceil(0.5 * offset) - 1],
        "p90": ordered[math.ceil(0.9 * offset) - 1],
        "p99": ordered[math.ceil(0.99 * offset) - 1],
        "mean": sum(turns) / offset,
        "max": max(turns),
        "over500Count": sum(t > 500 for t in turns),
        "totalPlayedTurns": played,
    }
    seeds = "".join(f"s1m-20261012-{i}\n" for i in range(offset))
    return {
        "case": case,
        "measurementStatus": "complete" if not censored else "censored",
        "engine": "createGame/playTurn via tests/simulation/harness.runGame",
        "baseSeed": 20261012,
        "turnCap": 20000,
        "seedSetSha256": hashlib.sha256(seeds.encode()).hexdigest(),
        "config": shards[0]["config"],
        "input": shards[0]["input"],
        "statistics": stats,
        "quantileConvention": "nearest-rank: ceil(p * games) - 1",
        "capConvention": "unfinished games counted as cap+1; not completed",
        "shards": [
            {
                "offset": s["task"]["offset"],
                "games": s["task"]["games"],
                "output": s["task"]["output"],
                "runtimeSeconds": s["runtimeSeconds"],
                "fingerprint": s["task"]["fingerprint"],
            }
            for s in shards
        ],
    }


def measure(selected: list[dict], jobs: int) -> None:
    tasks = []
    for case in selected:
        prefix = input_prefix(case["input"])
        shard_size = 2500 if case["games"] >= 20000 else 1250
        for offset in range(0, case["games"], shard_size):
            tasks.append(
                {
                    **case,
                    "catalog": str(prefix.with_name(prefix.name + "-catalog.csv")),
                    "services": str(prefix.with_name(prefix.name + "-services.csv")),
                    "games": min(shard_size, case["games"] - offset),
                    "offset": offset,
                    "output": str(LOGS / f"{case['name']}-{offset}.json"),
                }
            )
    by_case = {c["name"]: [] for c in selected}
    result_path = RESEARCH / "tokyo-suburban-r2-results.json"
    results = (
        json.loads(result_path.read_text())
        if result_path.exists()
        else {"schemaVersion": 1, "cases": {}}
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(run_task, t): t for t in tasks}
        for future in concurrent.futures.as_completed(futures):
            task = futures[future]
            report = future.result()
            name = task["name"]
            by_case[name].append(report)
            print(
                f"completed {name} seeds {task['offset']}..{task['offset'] + task['games'] - 1}",
                flush=True,
            )
            case = next(c for c in selected if c["name"] == name)
            if sum(s["task"]["games"] for s in by_case[name]) == case["games"]:
                combined = combine(case, by_case[name])
                results["cases"][name] = combined
                result_path.write_text(
                    json.dumps(results, ensure_ascii=False, indent=2) + "\n"
                )
                print(json.dumps({"case": name, **combined["statistics"]}), flush=True)
    if any(
        results["cases"][case["name"]]["statistics"]["capHits"] for case in selected
    ):
        raise SystemExit(
            "Censored measurements saved; do not treat as completed-game statistics"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--measure", action="store_true")
    parser.add_argument("--cases", default="all")
    parser.add_argument("--jobs", type=int, default=8)
    args = parser.parse_args()
    if args.generate:
        generate()
    if args.measure:
        selected = (
            cases()
            if args.cases == "all"
            else [c for c in cases() if c["name"] in args.cases.split(",")]
        )
        if not selected or args.jobs < 1:
            parser.error("select valid cases and a positive job count")
        measure(selected, args.jobs)
