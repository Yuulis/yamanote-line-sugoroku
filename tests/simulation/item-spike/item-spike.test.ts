// Throwaway spike (2026-10-27): station-item Monte Carlo grid. See README.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MVP_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { gameSeed, runGame, summarizeTurns, type TurnStatistics } from "../harness";
import { loadShippedBundle } from "../inputs";
import {
  type GameResult, makeContext, type Policy, runItemGame, type SimContext, type Variant, variantId, WEIGHTINGS,
} from "./sim";

const BASE_SEED = 20261012;
const DROPS = [100, 200, 300] as const;
const HARMS = [0, 30, 50] as const;
const EQUIVALENCE_GAMES = 100;

function envInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function variant(weighting: Variant["weighting"], dropPerMille: number, harmfulPercent: number, policy: Policy): Variant {
  return { id: variantId(weighting, dropPerMille, harmfulPercent, policy), weighting, dropPerMille, harmfulPercent, policy };
}

/** Greedy: full grid plus no-item baselines. Random user: a subset to bound the skill gap. */
export function allVariants(): Variant[] {
  const variants: Variant[] = [];
  for (const id of ["uniform", "mild", "current"] as const) {
    variants.push(variant(id, 0, 0, "greedy"));
    for (const drop of DROPS) for (const harm of HARMS) variants.push(variant(id, drop, harm, "greedy"));
  }
  for (const id of ["uniform", "mild"] as const) {
    for (const drop of DROPS) variants.push(variant(id, drop, 30, "random"));
    variants.push(variant(id, 200, 0, "random"));
  }
  variants.push(variant("current", 200, 0, "random"), variant("current", 200, 30, "random"));
  for (const id of ["direction-only", "share-only"] as const) {
    variants.push(variant(id, 0, 0, "greedy"), variant(id, 300, 30, "greedy"));
    for (const harm of HARMS) variants.push(variant(id, 200, harm, "greedy"));
  }
  variants.push(
    variant("mid", 0, 0, "greedy"), variant("mid", 200, 30, "greedy"), variant("mid", 300, 30, "greedy"),
    variant("mid", 300, 50, "greedy"), variant("mid", 200, 30, "random"), variant("mid", 300, 30, "random"),
  );
  return variants;
}

interface Row {
  id: string;
  weighting: string;
  dropPerMille: number;
  harmfulPercent: number;
  policy: Policy;
  statistics: TurnStatistics;
  over500Share: number;
  perGame: { pickups: number; beneficial: number; harmful: number; used: number; discarded: number; decisionTurns: number; forcedOne: number };
  usedByKind: Record<string, number>;
  harmfulByKind: Record<string, number>;
  targetTurnShare: number;
  runtimeSeconds: number;
}

function measure(context: SimContext, entry: Variant, games: number, cap: number): Row {
  const started = performance.now();
  const results: GameResult[] = [];
  for (let index = 0; index < games; index += 1) {
    results.push(runItemGame(context, entry, gameSeed(BASE_SEED, index), cap));
  }
  const capped = results.flatMap((result, index) => (result.completed ? [] : [index]));
  const turns = results.map((result) => (result.completed ? result.turns : cap + 1));
  const totalTurns = results.reduce((sum, result) => sum + result.turns, 0);
  const sum = (pick: (result: GameResult) => number): number => results.reduce((total, result) => total + pick(result), 0);
  const perGame = (pick: (result: GameResult) => number): number => sum(pick) / games;
  const kinds = (pick: (result: GameResult) => Record<string, number>): Record<string, number> => {
    const totals: Record<string, number> = {};
    for (const result of results) for (const [kind, count] of Object.entries(pick(result))) totals[kind] = (totals[kind] ?? 0) + count / games;
    return totals;
  };
  const statistics = summarizeTurns(turns, capped, totalTurns);
  return {
    id: entry.id, weighting: entry.weighting, dropPerMille: entry.dropPerMille,
    harmfulPercent: entry.harmfulPercent, policy: entry.policy, statistics,
    over500Share: statistics.over500Count / games,
    perGame: {
      pickups: perGame((r) => r.pickups), beneficial: perGame((r) => r.beneficialPickups),
      harmful: perGame((r) => r.harmfulPickups), used: perGame((r) => r.used),
      discarded: perGame((r) => r.discarded), decisionTurns: perGame((r) => r.decisionTurns),
      forcedOne: perGame((r) => r.forcedOneTurns),
    },
    usedByKind: kinds((r) => r.usedByKind), harmfulByKind: kinds((r) => r.harmfulByKind),
    targetTurnShare: sum((r) => r.targetTurns) / totalTurns,
    runtimeSeconds: (performance.now() - started) / 1000,
  };
}

const fixed = (value: number, digits: number = 1): string => value.toFixed(digits);

export function renderTable(rows: readonly Row[]): string {
  const header = "| variant | weighting | drop | harm% | policy | median | p90 | p99 | max | >500 | cap | pickups/g | used/g | discarded/g | decision turns/g | Yamanote turn share |";
  const lines = [header, `|${"---|".repeat(16)}`];
  for (const row of rows) {
    const s = row.statistics;
    lines.push(`| ${row.id} | ${row.weighting} | ${fixed(row.dropPerMille / 1000, 2)} | ${row.harmfulPercent} | ${row.policy} | ${s.median} | ${s.p90} | ${s.p99} | ${s.max} | ${fixed(row.over500Share * 100, 2)}% | ${s.capHits} | ${fixed(row.perGame.pickups)} | ${fixed(row.perGame.used)} | ${fixed(row.perGame.discarded)} | ${fixed(row.perGame.decisionTurns)} | ${fixed(row.targetTurnShare * 100)}% |`);
  }
  return lines.join("\n");
}

function loadProduct(): ReturnType<typeof loadShippedBundle> {
  return loadShippedBundle(resolve("public/data"), MVP_GAME_CONFIG.targetServiceId, MVP_GAME_CONFIG.startStationId);
}

// Opt-in so `npm run sim` stays fast: set ITEM_SPIKE=1 to run the grid.
it.skipIf(!process.env.ITEM_SPIKE || Boolean(process.env.ITEM_SPIKE_MERGE))("item-spike grid (ITEM_SPIKE_GAMES, default 100)", () => {
  const games = envInteger("ITEM_SPIKE_GAMES", 100);
  const cap = envInteger("ITEM_SPIKE_CAP", 20000);
  const filter = new RegExp(process.env.ITEM_SPIKE_FILTER ?? ".");
  const { network } = loadProduct();
  const contexts = new Map(WEIGHTINGS.map((w) => [w.id, makeContext(network, MVP_GAME_CONFIG, w)]));

  // The re-implemented landing must be draw-for-draw identical to the engine without items.
  const current = contexts.get("current") as SimContext;
  for (let index = 0; index < Math.min(games, EQUIVALENCE_GAMES); index += 1) {
    const seed = gameSeed(BASE_SEED, index);
    const engineGame = runGame(network, MVP_GAME_CONFIG, seed, cap);
    const spikeGame = runItemGame(current, variant("current", 0, 0, "greedy"), seed, cap);
    expect(spikeGame.turns, seed).toBe(engineGame.turn);
  }

  const rows = allVariants().filter((entry) => filter.test(entry.id))
    .map((entry) => measure(contexts.get(entry.weighting) as SimContext, entry, games, cap));
  console.log(`\n${renderTable(rows)}\n`);
  const output = process.env.ITEM_SPIKE_OUTPUT;
  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), `${JSON.stringify({ games, cap, baseSeed: BASE_SEED, rows }, null, 2)}\n`, "utf8");
  }
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.statistics.games === games)).toBe(true);
}, 86_400_000);

it.skipIf(!process.env.ITEM_SPIKE_MERGE)("item-spike merge shards (ITEM_SPIKE_MERGE=dir)", () => {
  const directory = resolve(process.env.ITEM_SPIKE_MERGE as string);
  const order = allVariants().map((entry) => entry.id);
  const rows = readdirSync(directory).filter((file) => file.endsWith(".json") && file !== "merged.json")
    .flatMap((file) => (JSON.parse(readFileSync(join(directory, file), "utf8")) as { rows: Row[] }).rows)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const table = renderTable(rows);
  writeFileSync(join(directory, "merged.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  writeFileSync(join(directory, "table.md"), `${table}\n`, "utf8");
  console.log(`\n${table}\n`);
  expect(rows.length).toBeGreaterThan(0);
});
