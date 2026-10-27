import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { gameSeed, summarizeTurns } from "../harness";
import { loadShippedBundle, sha256 } from "../inputs";
import type { Policy } from "./policy";
import { envInteger, parityVerdict, REFERENCE } from "./report";
import { firstDivergence, loadReference } from "./reference";
import { runProductionGame, type GameMeasurement } from "./runner";

function fingerprints(paths: readonly string[]): { files: Record<string, string>; sha256: string } {
  const files = Object.fromEntries(paths.map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  return { files, sha256: sha256(JSON.stringify(files)) };
}

it.skipIf(process.env.ITEM_ENGINE_SIM !== "1")("S7 production phased API, round-3 parity and deterministic replay", async () => {
  const games = envInteger("ITEM_ENGINE_GAMES", 20);
  const offset = envInteger("ITEM_ENGINE_OFFSET", 0, 0);
  const cap = 20000;
  const output = resolve(process.env.ITEM_ENGINE_OUTPUT ?? `.claude/logs/item-engine/run-${offset}-${games}.json`);
  if (!output.startsWith(`${resolve(".claude/logs/item-engine")}/`)) throw new Error("ITEM_ENGINE_OUTPUT must be below .claude/logs/item-engine");
  const { network, provenance } = loadShippedBundle(resolve("public/data"), ITEM_GAME_CONFIG.targetServiceId, ITEM_GAME_CONFIG.startStationId);
  const seeds = Array.from({ length: games }, (_, index) => gameSeed(20261012, offset + index));
  const reference = await loadReference(network);
  const referenceTurns: number[] = [];
  const divergences: { seed: string; evidence: NonNullable<ReturnType<typeof firstDivergence>> }[] = [];
  const started = performance.now();
  const rows: {
    policy: Policy; statistics: ReturnType<typeof summarizeTurns>;
    parity: ReturnType<typeof parityVerdict>; reference: typeof REFERENCE[Policy];
    turns: number[]; counters: Record<string, number>; saveChecks: Record<string, number>;
    errors: { seed: string; error: string | null }[];
    determinism: { seeds: string[]; identical: boolean; sha256: string };
    measurements: GameMeasurement[]; runtimeSeconds: number;
  }[] = [];
  for (const policy of ["greedy", "random"] as const) {
    const measurements: GameMeasurement[] = [];
    const policyStarted = performance.now();
    for (const [index, seed] of seeds.entries()) {
      const measured = runProductionGame(network, seed, policy, cap, index < 20, policy === "greedy");
      if (policy === "greedy") {
        const frozen = reference.run(seed, cap);
        referenceTurns.push(frozen.completed ? frozen.turns : cap + 1);
        const divergence = firstDivergence(frozen.trace, measured.trace);
        if (divergence) divergences.push({ seed, evidence: divergence });
      }
      // Full histories are sampled, not written for every Monte Carlo game.
      measurements.push({ ...measured, trace: [] });
    }
    const errors = measurements.filter((m) => m.error !== null).map((m) => ({ seed: m.seed, error: m.error }));
    const capped = measurements.flatMap((m, index) => m.completed ? [] : [index]);
    const turns = measurements.map((m) => m.completed ? m.turns : cap + 1);
    const statistics = summarizeTurns(turns, capped, measurements.reduce((sum, m) => sum + m.turns, 0));
    const totals = (key: "counters" | "saveChecks"): Record<string, number> => measurements.reduce((all, m) => {
      for (const [name, count] of Object.entries(m[key])) all[name] = (all[name] ?? 0) + count;
      return all;
    }, {} as Record<string, number>);
    const repeatSeeds = seeds.slice(0, 10);
    const repeats = repeatSeeds.map((seed) => ({ ...runProductionGame(network, seed, policy, cap, true), trace: [] }));
    const deterministic = JSON.stringify(repeats) === JSON.stringify(measurements.slice(0, repeatSeeds.length));
    rows.push({ policy, statistics, parity: parityVerdict(policy, statistics), reference: REFERENCE[policy],
      turns, counters: totals("counters"), saveChecks: totals("saveChecks"), errors,
      determinism: { seeds: repeatSeeds, identical: deterministic, sha256: sha256(JSON.stringify(repeats)) },
      measurements, runtimeSeconds: (performance.now() - policyStarted) / 1000 });
  }
  const divergenceCounts: Record<string, number> = {};
  for (const d of divergences) divergenceCounts[d.evidence.classification] = (divergenceCounts[d.evidence.classification] ?? 0) + 1;
  const engineFiles = readdirSync("src/features/game/engine").filter((name) => name.endsWith(".ts")).sort().map((name) => `src/features/game/engine/${name}`);
  const result = { schemaVersion: 1, measurement: "item-engine-round4", config: ITEM_GAME_CONFIG,
    shard: { offset, games, baseSeed: 20261012, turnCap: cap }, seeds, seedSetSha256: sha256(`${seeds.join("\n")}\n`),
    input: provenance,
    bundleHashes: fingerprints(["manifest.json", "stations.json", "services.json", "segments.json", "segments.geojson"].map((name) => `public/data/${name}`)),
    engineHashes: fingerprints([...engineFiles, "src/features/game/gameConfig.ts", "src/types/network.ts"]),
    policyHashes: fingerprints(["tests/simulation/item-engine/policy.ts"]),
    harnessHashes: fingerprints(["tests/simulation/item-engine/runner.ts", "tests/simulation/item-engine/report.ts", "tests/simulation/item-engine/reference.ts", "tests/simulation/item-engine/item-engine.test.ts", "tests/simulation/harness.ts", "tests/simulation/inputs.ts"]),
    referenceHashes: fingerprints(["tests/simulation/item-spike/sim.ts", "tests/simulation/item-spike/moves.ts"]),
    quantileConvention: "nearest-rank: ceil(p * games) - 1", rows,
    greedyReference: { statistics: summarizeTurns(referenceTurns, [], referenceTurns.reduce((a, b) => a + b, 0)), turns: referenceTurns,
      equalTurnCounts: referenceTurns.filter((value, index) => value === rows[0]!.turns[index]).length,
      firstDivergenceCounts: divergenceCounts, divergences },
    runtimeSeconds: (performance.now() - started) / 1000 };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output, rows: rows.map(({ measurements: _measurements, turns: _turns, ...row }) => row), divergenceCounts, runtimeSeconds: result.runtimeSeconds }));
  expect(Object.keys(divergenceCounts).filter((kind) => !["oedo-oversleep-hop-limit", "singleton-route-eligibility"].includes(kind)), "Unexplained greedy divergence classes").toEqual([]);
  if (games === 5000 && offset === 0) {
    expect(result.greedyReference.statistics, "Observation hooks must reproduce frozen round-3 greedy statistics").toMatchObject({ median: 65, p90: 143, p99: 241, max: 433, mean: 75.4938, capHits: 0, completedGames: 5000, over500Count: 0 });
  }
  for (const row of rows) {
    expect(row.errors).toEqual([]);
    expect(row.statistics.capHits).toBe(0);
    expect(row.determinism.identical).toBe(true);
    expect(row.saveChecks.completed).toBe(Math.min(20, games));
    expect(row.saveChecks["pending-roll"]).toBeGreaterThan(0);
    if (games >= 100) expect(row.saveChecks["pending-discard"]).toBeGreaterThan(0);
    if (games === 5000 && offset === 0) expect(row.parity, `${row.policy}: round-3 distribution`).toMatchObject({ pass: true });
  }
}, 3_600_000);
