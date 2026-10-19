"""Independently reconcile R2 shard evidence and the standard npm simulation smoke."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from measure_additional import additional_cases
from run_matrix import cases, fingerprint


def verify() -> None:
    path = Path(".claude/docs/research/tokyo-suburban-r2-results.json")
    results = json.loads(path.read_text())["cases"]
    expected_cases = cases() + additional_cases()
    assert set(results) == {c["name"] for c in expected_cases}
    for expected in expected_cases:
        name = expected["name"]
        result = results[name]
        assert result["case"] == expected
        seen, turns, capped = [], [], []
        played = 0
        for shard_ref in result["shards"]:
            shard = json.loads(Path(shard_ref["output"]).read_text())
            task = shard["task"]
            assert task["fingerprint"] == fingerprint(task) == shard_ref["fingerprint"]
            indices = list(range(task["offset"], task["offset"] + task["games"]))
            seen.extend(indices)
            assert len(shard["turns"]) == len(indices)
            assert all(isinstance(t, int) and 1 <= t <= 20001 for t in shard["turns"])
            assert shard["config"] == result["config"]
            assert shard["input"] == result["input"]
            turns.extend(shard["turns"])
            capped.extend(shard["censored"])
            played += shard["statistics"]["totalPlayedTurns"]
            for source, digest in shard["input"]["sha256"].items():
                normalized = (
                    Path(source).read_text().replace("\r\n", "\n").replace("\r", "\n")
                )
                assert hashlib.sha256(normalized.encode()).hexdigest() == digest
        assert seen == list(range(expected["games"])), name
        assert len(set(seen)) == expected["games"]
        ordered = sorted(turns)
        stats = result["statistics"]
        for field, q in [("median", 0.5), ("p90", 0.9), ("p99", 0.99)]:
            assert stats[field] == ordered[math.ceil(q * len(ordered)) - 1], (
                name,
                field,
            )
        assert stats["games"] == len(turns) == expected["games"]
        assert stats["mean"] == sum(turns) / len(turns)
        assert stats["max"] == max(turns)
        assert stats["over500Count"] == sum(t > 500 for t in turns)
        assert stats["totalPlayedTurns"] == played
        assert stats["cappedGameIndices"] == capped
        assert stats["capHits"] == len(capped)
        assert stats["completedGames"] == len(turns) - len(capped)
        seeds = "".join(f"s1m-20261012-{i}\n" for i in seen)
        assert result["seedSetSha256"] == hashlib.sha256(seeds.encode()).hexdigest()
        print(
            f"PASS {name}: {len(turns)} seeds, hashes, raw-turn statistics; capHits={len(capped)}"
        )
    # Compare the standard npm run sim path against the exact same first 200 shard seeds.
    smoke = json.loads(Path(".claude/logs/r2/npm-smoke-final.json").read_text())
    first = json.loads(Path(results["decided"]["shards"][0]["output"]).read_text())
    turns = sorted(first["turns"][:200])
    assert smoke["config"] == first["config"]
    assert smoke["input"] == first["input"]
    assert smoke["games"] == 200 and smoke["statistics"]["capHits"] == 0
    for key, q in [("median", 0.5), ("p90", 0.9), ("p99", 0.99)]:
        assert smoke["statistics"][key] == turns[math.ceil(q * 200) - 1]
    assert smoke["statistics"]["mean"] == sum(turns) / 200
    assert smoke["statistics"]["totalPlayedTurns"] == sum(turns)
    print(
        "PASS standard npm run sim: exact first-200-seed statistics agree with matrix"
    )


if __name__ == "__main__":
    verify()
