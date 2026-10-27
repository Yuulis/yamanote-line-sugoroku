// Throwaway spike (2026-10-27): station-item Monte Carlo grid. See README.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { CLASSIC_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { gameSeed, runGame, summarizeTurns, type TurnStatistics } from "../harness";
import { loadShippedBundle } from "../inputs";
import * as engine from "../../../src/features/game/engine";
import { hopsToEndpoint, nearestTargetStation, rapidHops } from "./moves";
import {
  ABLATIONS, type GameResult, type ItemSet, makeContext, type Policy, type Round3Rules, runItemGame, type SimContext,
  type Variant, variantId, WEIGHTINGS,
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

function variant(
  weighting: Variant["weighting"], dropPerMille: number, harmfulPercent: number, policy: Policy,
  itemSet: ItemSet = "v1", r3?: Round3Rules,
): Variant {
  return {
    id: variantId(weighting, dropPerMille, harmfulPercent, policy, itemSet, r3),
    weighting, dropPerMille, harmfulPercent, policy, itemSet, ...(r3 === undefined ? {} : { r3 }),
  };
}

/**
 * Round 3: the chosen ruleset (mild, p 0.30, harmful 30%, v2 items) under the
 * one-item-per-turn rule and the choose-what-to-discard rule, each alone and
 * neither; mid as fallback; higher drop rates in case random p99 > 400.
 */
export function roundThreeVariants(): Variant[] {
  const both: Round3Rules = { singleItem: true, chooseDiscard: true };
  const variants: Variant[] = [];
  for (const policy of ["greedy", "random"] as const) {
    for (const r3 of [both, { singleItem: true, chooseDiscard: false }, { singleItem: false, chooseDiscard: true },
      { singleItem: false, chooseDiscard: false }]) {
      variants.push(variant("mild", 300, 30, policy, "v2", r3));
    }
    variants.push(variant("mid", 300, 30, policy, "v2", both));
    for (const drop of [350, 400]) variants.push(variant("mild", drop, 30, policy, "v2", both));
  }
  return variants;
}

/** Round 2: mild vs mid with the v2 item set, plus v1 comparison rows and baselines. */
export function roundTwoVariants(): Variant[] {
  const variants: Variant[] = [variant("current", 0, 0, "greedy")];
  for (const id of ["mild", "mid"] as const) {
    variants.push(variant(id, 0, 0, "greedy"), variant(id, 300, 30, "greedy"), variant(id, 300, 30, "random"));
    for (const drop of [200, 300]) {
      for (const harm of [30, 50]) for (const policy of ["greedy", "random"] as const) variants.push(variant(id, drop, harm, policy, "v2"));
    }
  }
  // Leave-one-out ablations at drop 0.30 / harmful 30%: deadhead on both weightings, the rest on mid.
  for (const policy of ["greedy", "random"] as const) {
    variants.push(variant("mild", 300, 30, policy, "v2-no-deadhead"));
    for (const ablated of ABLATIONS) variants.push(variant("mid", 300, 30, policy, `v2-no-${ablated}`));
  }
  return variants;
}

/** ITEM_SPIKE_ROUND=1 or 2 selects an earlier grid; the default is round 3. */
export function selectedVariants(): Variant[] {
  if (process.env.ITEM_SPIKE_ROUND === "1") return roundOneVariants();
  if (process.env.ITEM_SPIKE_ROUND === "2") return roundTwoVariants();
  return roundThreeVariants();
}

/** Round 1. Greedy: full grid plus no-item baselines. Random user: a subset to bound the skill gap. */
export function roundOneVariants(): Variant[] {
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
  perGame: {
    pickups: number; beneficial: number; harmful: number; used: number; discarded: number; decisionTurns: number;
    forcedOne: number; cancelledHarmful: number; oversleep: number; multiItemTurns: number;
  };
  itemSet: ItemSet;
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
    harmfulPercent: entry.harmfulPercent, policy: entry.policy, itemSet: entry.itemSet, statistics,
    over500Share: statistics.over500Count / games,
    perGame: {
      pickups: perGame((r) => r.pickups), beneficial: perGame((r) => r.beneficialPickups),
      harmful: perGame((r) => r.harmfulPickups), used: perGame((r) => r.used),
      discarded: perGame((r) => r.discarded), decisionTurns: perGame((r) => r.decisionTurns),
      forcedOne: perGame((r) => r.forcedOneTurns),
      cancelledHarmful: perGame((r) => r.cancelledHarmful), oversleep: perGame((r) => r.oversleepTurns),
      multiItemTurns: perGame((r) => r.multiItemTurns),
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

const KIND_COLUMNS = ["route", "direction", "adjust", "double", "rapid", "deadhead", "certificate"] as const;

/** Per-game uses by item kind, plus harmful events, cancellations and oversleep moves. */
export function renderItemTable(rows: readonly Row[]): string {
  const header = `| variant | ${KIND_COLUMNS.join(" | ")} | harmful/g | cancelled/g | oversleep moves/g | forced-1/g |`;
  const lines = [header, `|${"---|".repeat(KIND_COLUMNS.length + 5)}`];
  for (const row of rows) {
    const uses = KIND_COLUMNS.map((kind) => fixed(row.usedByKind[kind] ?? 0, 2));
    const p = row.perGame;
    lines.push(`| ${row.id} | ${uses.join(" | ")} | ${fixed(p.harmful, 2)} | ${fixed(p.cancelledHarmful ?? 0, 2)} | ${fixed(p.oversleep ?? 0, 2)} | ${fixed(p.forcedOne, 2)} |`);
  }
  return lines.join("\n");
}

function loadProduct(): ReturnType<typeof loadShippedBundle> {
  return loadShippedBundle(resolve("public/data"), CLASSIC_GAME_CONFIG.targetServiceId, CLASSIC_GAME_CONFIG.startStationId);
}

// Opt-in so `npm run sim` stays fast: set ITEM_SPIKE=1 to run the grid.
it.skipIf(!process.env.ITEM_SPIKE || Boolean(process.env.ITEM_SPIKE_MERGE))("item-spike grid (ITEM_SPIKE_GAMES, default 100)", () => {
  const games = envInteger("ITEM_SPIKE_GAMES", 100);
  const cap = envInteger("ITEM_SPIKE_CAP", 20000);
  const filter = new RegExp(process.env.ITEM_SPIKE_FILTER ?? ".");
  const { network } = loadProduct();
  const contexts = new Map(WEIGHTINGS.map((w) => [w.id, makeContext(network, CLASSIC_GAME_CONFIG, w)]));

  // The re-implemented landing must be draw-for-draw identical to the engine without items.
  const current = contexts.get("current") as SimContext;
  for (let index = 0; index < Math.min(games, EQUIVALENCE_GAMES); index += 1) {
    const seed = gameSeed(BASE_SEED, index);
    const engineGame = runGame(network, CLASSIC_GAME_CONFIG, seed, cap);
    const spikeGame = runItemGame(current, variant("current", 0, 0, "greedy"), seed, cap);
    expect(spikeGame.turns, seed).toBe(engineGame.turn);
  }

  // Round-2 movement helpers on the real network.
  for (const station of network.stationsById.keys()) {
    const nearest = nearestTargetStation(current.adjacency, current.targetStationIds, station);
    expect(nearest, station).toBeDefined();
  }
  for (const service of network.servicesById.values()) {
    const from = service.stationIds[0] as string;
    for (const direction of engine.movableDirections(network, service.id, from)) {
      const walk = (hops: number): string => {
        let station = from;
        for (let hop = 0; hop < hops; hop += 1) station = engine.nextStationId(network, service.id, station, direction) as string;
        return station;
      };
      const rapid = walk(rapidHops(network, current.transfers, service.id, from, direction, 1));
      const end = walk(hopsToEndpoint(network, service.id, from, direction));
      expect(current.transfers.has(rapid) || engine.nextStationId(network, service.id, rapid, direction) === undefined, service.id).toBe(true);
      if (!service.circular) expect(engine.nextStationId(network, service.id, end, direction), service.id).toBeUndefined();
    }
  }

  const rows = selectedVariants().filter((entry) => filter.test(entry.id))
    .map((entry) => measure(contexts.get(entry.weighting) as SimContext, entry, games, cap));
  console.log(`\n${renderTable(rows)}\n\n${renderItemTable(rows)}\n`);
  const output = process.env.ITEM_SPIKE_OUTPUT;
  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), `${JSON.stringify({ games, cap, baseSeed: BASE_SEED, rows }, null, 2)}\n`, "utf8");
  }
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.statistics.games === games)).toBe(true);
  // Rule 1 (round 3): never more than one active item in a turn.
  for (const row of rows.filter((r) => r.id.includes("-r3") && !r.id.includes("-discard") && !r.id.includes("-none"))) {
    expect(row.perGame.multiItemTurns, row.id).toBe(0);
  }
}, 86_400_000);

it.skipIf(!process.env.ITEM_SPIKE_MERGE)("item-spike merge shards (ITEM_SPIKE_MERGE=dir)", () => {
  const directory = resolve(process.env.ITEM_SPIKE_MERGE as string);
  const order = [...roundOneVariants(), ...roundTwoVariants(), ...roundThreeVariants()].map((entry) => entry.id);
  const rows = readdirSync(directory).filter((file) => file.endsWith(".json") && file !== "merged.json")
    .flatMap((file) => (JSON.parse(readFileSync(join(directory, file), "utf8")) as { rows: Row[] }).rows)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const table = `${renderTable(rows)}\n\n${renderItemTable(rows)}`;
  writeFileSync(join(directory, "merged.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  writeFileSync(join(directory, "table.md"), `${table}\n`, "utf8");
  console.log(`\n${table}\n`);
  expect(rows.length).toBeGreaterThan(0);
});
