import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { CLASSIC_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  createGame,
  landingOptions,
  nextStationId,
  playTurn,
  targetHopDistances,
} from "../../src/features/game/engine";
import type { GameState } from "../../src/types/network";
import { loadShippedBundle } from "./inputs";
import { gameSeed } from "./harness";

const BASE_SEED = 20261012;
const TURN_CAP = 20000;
const OBSERVER_SOURCE = "tests/simulation/suburban-observations.ts";
const ENGINE_SOURCES = [
  "src/features/game/gameConfig.ts",
  "src/features/game/engine/game.ts",
  "src/features/game/engine/landing.ts",
  "src/features/game/engine/movement.ts",
  "src/features/game/engine/network.ts",
  "src/features/game/engine/proximity.ts",
  "src/features/game/engine/rng.ts",
];
const BUNDLE_FILES = [
  "manifest.json",
  "stations.json",
  "services.json",
  "segments.json",
  "segments.geojson",
];
const GOLDEN_DIR = ".claude/logs/s6/simulation/s6-fix";

const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

export interface ObservationGame {
  seed: string;
  turns: number;
  hops: number;
  completed: boolean;
  errors: number;
  errorMessages: string[];
  zeroHopPlayingTurns: number;
  invalidChoices: number;
  unreachableStations: number;
  invalidTransitions: number;
  weightViolations: number;
  capHit: boolean;
  targetDraws: number;
  targetSelections: number;
  targetExpectedSelections: number;
  towardDraws: number;
  towardSelections: number;
  towardExpectedSelections: number;
  equalDistanceDraws: number;
  equalDistanceForwardSelections: number;
}

export interface ObservationSummary {
  games: number;
  completedGames: number;
  capSeeds: string[];
  totalHops: number;
  errors: number;
  zeroHopPlayingTurns: number;
  invalidChoices: number;
  unreachableStations: number;
  invalidTransitions: number;
  weightViolations: number;
  targetDraws: number;
  targetSelections: number;
  targetExpectedSelections: number;
  towardDraws: number;
  towardSelections: number;
  towardExpectedSelections: number;
  equalDistanceDraws: number;
  equalDistanceForwardSelections: number;
  turns: ReturnType<typeof distribution>;
  hops: ReturnType<typeof distribution>;
  hopsPerTurn: number;
  lotteries: Record<string, LotterySummary>;
}

export interface LotteryEligibility {
  targetService: boolean;
  towardTarget: boolean;
  equalDistance: boolean;
}

interface LotterySummary {
  numerator: number;
  denominator: number;
  observed: number | null;
  expected: number | null;
  deviation: number | null;
  wilson95: { low: number; high: number } | null;
  threshold: number | null;
  passesDiagnostic: boolean | null;
}

function quantile(values: readonly number[], p: number): number {
  return [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] ?? 0;
}

function distribution(values: readonly number[]) {
  return {
    min: Math.min(...values),
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    p99: quantile(values, 0.99),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
  };
}

export function lotteryEligibility(input: {
  serviceCandidates: readonly string[];
  serviceDrawRequired: boolean;
  selectedService: string;
  targetService: string;
  directionDrawRequired: boolean;
  nextDistances: readonly number[];
}): LotteryEligibility {
  const targetService =
    input.serviceDrawRequired && input.serviceCandidates.includes(input.targetService);
  const directionLottery =
    input.directionDrawRequired && input.selectedService !== input.targetService;
  const equalDistance =
    directionLottery &&
    input.nextDistances.length === 2 &&
    input.nextDistances[0] === input.nextDistances[1];
  return {
    targetService,
    towardTarget:
      directionLottery &&
      input.nextDistances.length === 2 &&
      input.nextDistances[0] !== input.nextDistances[1],
    equalDistance,
  };
}

export function wilsonInterval(
  successes: number,
  trials: number,
): { low: number; high: number } {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(trials) ||
    trials <= 0 ||
    successes < 0 ||
    successes > trials
  ) {
    throw new Error("Invalid Wilson counts");
  }
  const z = 1.959963984540054;
  const p = successes / trials;
  const d = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / d;
  const margin =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) / d;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function lotterySummary(
  numerator: number,
  denominator: number,
  expectedNumerator: number,
): LotterySummary {
  if (denominator === 0) {
    return {
      numerator,
      denominator,
      observed: null,
      expected: null,
      deviation: null,
      wilson95: null,
      threshold: null,
      passesDiagnostic: null,
    };
  }
  const observed = numerator / denominator;
  const expected = expectedNumerator / denominator;
  const threshold = Math.max(
    0.01,
    5 * Math.sqrt((expected * (1 - expected)) / denominator),
  );
  return {
    numerator,
    denominator,
    observed,
    expected,
    deviation: observed - expected,
    wilson95: wilsonInterval(numerator, denominator),
    threshold,
    passesDiagnostic: Math.abs(observed - expected) <= threshold,
  };
}

export function summarizeObservations(
  games: readonly ObservationGame[],
): ObservationSummary {
  if (!games.length) throw new Error("Cannot summarize zero games");
  const seen = new Set<string>();
  for (const game of games) {
    if (!/^s1m-20261012-\d+$/.test(game.seed)) {
      throw new Error(`Invalid seed: ${game.seed}`);
    }
    if (seen.has(game.seed)) throw new Error(`Duplicate seed: ${game.seed}`);
    seen.add(game.seed);
  }
  const sum = (key: keyof ObservationGame): number =>
    games.reduce((total, game) => total + Number(game[key]), 0);
  const draws = {
    target: sum("targetDraws"),
    toward: sum("towardDraws"),
    equal: sum("equalDistanceDraws"),
  };
  return {
    games: games.length,
    completedGames: games.filter((game) => game.completed).length,
    capSeeds: games.filter((game) => game.capHit).map((game) => game.seed),
    totalHops: sum("hops"),
    errors: sum("errors"),
    zeroHopPlayingTurns: sum("zeroHopPlayingTurns"),
    invalidChoices: sum("invalidChoices"),
    unreachableStations: sum("unreachableStations"),
    invalidTransitions: sum("invalidTransitions"),
    weightViolations: sum("weightViolations"),
    targetDraws: draws.target,
    targetSelections: sum("targetSelections"),
    targetExpectedSelections: sum("targetExpectedSelections"),
    towardDraws: draws.toward,
    towardSelections: sum("towardSelections"),
    towardExpectedSelections: sum("towardExpectedSelections"),
    equalDistanceDraws: draws.equal,
    equalDistanceForwardSelections: sum("equalDistanceForwardSelections"),
    turns: distribution(games.map((game) => game.turns)),
    hops: distribution(games.map((game) => game.hops)),
    hopsPerTurn: sum("hops") / games.reduce((total, game) => total + game.turns, 0),
    lotteries: {
      targetService: lotterySummary(
        sum("targetSelections"), draws.target, sum("targetExpectedSelections"),
      ),
      towardTarget: lotterySummary(
        sum("towardSelections"), draws.toward, sum("towardExpectedSelections"),
      ),
      equalDistanceForward: lotterySummary(
        sum("equalDistanceForwardSelections"), draws.equal,
        draws.equal / 2,
      ),
    },
  };
}

function envInt(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${name} must be a safe integer >= ${min}`);
  }
  return value;
}

function independentServiceWeights(
  serviceIds: readonly string[],
  network: ReturnType<typeof loadShippedBundle>["network"],
): number[] {
  const policy = CLASSIC_GAME_CONFIG.serviceLottery;
  const base = serviceIds.map((serviceId) => {
    const service = network.servicesById.get(serviceId);
    if (!service) throw new Error(`Unknown service candidate ${serviceId}`);
    return policy.kindWeights[service.kind];
  });
  const targetIndex = serviceIds.indexOf(CLASSIC_GAME_CONFIG.targetServiceId);
  if (targetIndex < 0 || serviceIds.length === 1) return base;
  const targetPolicy = policy.target;
  if (targetPolicy.kind === "weight") {
    return base.map((weight, index) =>
      index === targetIndex ? weight * targetPolicy.weight : weight,
    );
  }
  const otherTotal = base.reduce(
    (total, weight, index) => total + (index === targetIndex ? 0 : weight),
    0,
  );
  return base.map((weight, index) =>
    index === targetIndex
      ? targetPolicy.numerator * otherTotal
      : (targetPolicy.denominator - targetPolicy.numerator) * weight,
  );
}

function independentDirectionWeights(
  serviceId: string,
  stationId: string,
  directions: readonly number[],
  network: ReturnType<typeof loadShippedBundle>["network"],
  distances: ReadonlyMap<string, number>,
): number[] {
  if (serviceId === CLASSIC_GAME_CONFIG.targetServiceId || directions.length < 2) {
    return directions.map(() => 1);
  }
  const nextDistances = directions.map((direction) => {
    const next = nextStationId(network, serviceId, stationId, direction as 1 | -1);
    return next === undefined ? Number.POSITIVE_INFINITY : distances.get(next) ?? Number.POSITIVE_INFINITY;
  });
  if (nextDistances[0] === nextDistances[1]) return [1, 1];
  const toward = nextDistances[0]! < nextDistances[1]! ? 0 : 1;
  return directions.map((_, index) =>
    index === toward ? CLASSIC_GAME_CONFIG.directionLottery.towardTargetWeight : 1,
  );
}

const independentDistanceCache = new WeakMap<
  ReturnType<typeof loadShippedBundle>["network"],
  ReadonlyMap<string, number>
>();

// Relaxes every directed segment to a fixpoint (a different algorithm from the
// engine's reverse BFS) and fails the run if the two distance maps disagree.
function independentTargetDistances(
  network: ReturnType<typeof loadShippedBundle>["network"],
): ReadonlyMap<string, number> {
  const cached = independentDistanceCache.get(network);
  if (cached) return cached;
  const target = network.servicesById.get(CLASSIC_GAME_CONFIG.targetServiceId);
  if (!target) throw new Error("Target service missing from the shipped bundle");
  const distances = new Map<string, number>(target.stationIds.map((id) => [id, 0]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const segment of network.segmentsById.values()) {
      const toDistance = distances.get(segment.to);
      if (toDistance === undefined) continue;
      const fromDistance = distances.get(segment.from) ?? Number.POSITIVE_INFINITY;
      if (toDistance + 1 < fromDistance) {
        distances.set(segment.from, toDistance + 1);
        changed = true;
      }
    }
  }
  const engine = targetHopDistances(network, CLASSIC_GAME_CONFIG.targetServiceId);
  const sameSize = engine.size === distances.size;
  if (!sameSize || [...distances].some(([id, value]) => engine.get(id) !== value)) {
    throw new Error("Independent target distances disagree with the engine");
  }
  independentDistanceCache.set(network, distances);
  return distances;
}

function observeGame(
  network: ReturnType<typeof loadShippedBundle>["network"],
  seed: string,
  goldenTurns: ReadonlyMap<string, number>,
): ObservationGame {
  const game: ObservationGame = {
    seed,
    turns: 0,
    hops: 0,
    completed: false,
    errors: 0,
    errorMessages: [],
    zeroHopPlayingTurns: 0,
    invalidChoices: 0,
    unreachableStations: 0,
    invalidTransitions: 0,
    weightViolations: 0,
    capHit: false,
    targetDraws: 0,
    targetSelections: 0,
    targetExpectedSelections: 0,
    towardDraws: 0,
    towardSelections: 0,
    towardExpectedSelections: 0,
    equalDistanceDraws: 0,
    equalDistanceForwardSelections: 0,
  };
  const distances = independentTargetDistances(network);
  let state: GameState = createGame(CLASSIC_GAME_CONFIG, seed, network);
  while (state.status === "playing" && state.turn < TURN_CAP) {
    try {
      if (!network.stationsById.has(state.currentStationId)) {
        game.unreachableStations++;
      }
      const result = playTurn(state, network);
      const traversed = result.events.filter((event) => event.type === "segment-traversed");
      const landing = result.events.find((event) => event.type === "landing-resolved");
      if (traversed.length === 0 && result.state.status === "playing") {
        game.zeroHopPlayingTurns++;
      }
      game.hops += traversed.length;
      for (const hop of traversed) {
        if (
          !network.segmentsById.has(hop.segmentId) ||
          !network.stationsById.has(hop.fromStationId) ||
          !network.stationsById.has(hop.toStationId)
        ) {
          game.invalidTransitions++;
        }
      }
      if (landing?.type === "landing-resolved") {
        const lastHop = traversed.at(-1);
        if (!lastHop || !network.stationsById.has(landing.stationId)) {
          game.invalidChoices++;
        } else {
          const options = landingOptions(
            {
              config: state.config,
              currentStationId: landing.stationId,
              currentServiceId: lastHop.serviceId,
              direction: lastHop.direction,
            },
            network,
          );
          const serviceWeights = independentServiceWeights(options.services, network);
          if (
            JSON.stringify(options.services) !== JSON.stringify(landing.serviceCandidates) ||
            options.serviceDrawRequired !== landing.serviceDrawRequired ||
            JSON.stringify(options.serviceWeights) !== JSON.stringify(serviceWeights)
          ) {
            game.weightViolations++;
          }
          const nextDistances = landing.directionCandidates.map((direction) => {
            const next = nextStationId(
              network,
              landing.serviceId,
              landing.stationId,
              direction,
            );
            return next === undefined
              ? Number.POSITIVE_INFINITY
              : (distances.get(next) ?? Number.POSITIVE_INFINITY);
          });
          const eligibility = lotteryEligibility({
            serviceCandidates: landing.serviceCandidates,
            serviceDrawRequired: landing.serviceDrawRequired,
            selectedService: landing.serviceId,
            targetService: CLASSIC_GAME_CONFIG.targetServiceId,
            directionDrawRequired: landing.directionDrawRequired,
            nextDistances,
          });
          if (eligibility.targetService) {
            const targetIndex = options.services.indexOf(CLASSIC_GAME_CONFIG.targetServiceId);
            const totalWeight = serviceWeights.reduce((total, weight) => total + weight, 0);
            game.targetDraws++;
            game.targetExpectedSelections += serviceWeights[targetIndex]! / totalWeight;
            if (landing.serviceId === CLASSIC_GAME_CONFIG.targetServiceId) game.targetSelections++;
          }
          const expectedDirectionWeights = independentDirectionWeights(
            landing.serviceId,
            landing.stationId,
            landing.directionCandidates,
            network,
            distances,
          );
          const actualDirectionWeights = options.directionWeightsByService.get(landing.serviceId);
          if (
            !actualDirectionWeights ||
            JSON.stringify(actualDirectionWeights) !== JSON.stringify(expectedDirectionWeights) ||
            !landing.directionCandidates.includes(landing.direction)
          ) {
            game.weightViolations++;
          }
          if (eligibility.towardTarget) {
              const towardIndex = nextDistances[0]! < nextDistances[1]! ? 0 : 1;
              game.towardDraws++;
              game.towardExpectedSelections +=
                expectedDirectionWeights[towardIndex]! /
                expectedDirectionWeights.reduce((total, weight) => total + weight, 0);
              if (landing.directionCandidates[towardIndex] === landing.direction) {
                game.towardSelections++;
              }
          } else if (eligibility.equalDistance) {
              game.equalDistanceDraws++;
              if (landing.direction === 1) game.equalDistanceForwardSelections++;
          }
        }
      }
      state = { ...result.state, movementHistory: [] };
      game.turns++;
    } catch (error) {
      game.errors++;
      game.errorMessages.push(error instanceof Error ? error.message : String(error));
      break;
    }
  }
  game.completed = state.status === "completed";
  game.capHit = !game.completed && game.errors === 0 && state.turn >= TURN_CAP;
  const expectedTurns = goldenTurns.get(seed);
  if (expectedTurns === undefined || expectedTurns !== game.turns) {
    game.invalidTransitions++;
    game.errorMessages.push(`Frozen turn mismatch: expected ${expectedTurns}, got ${game.turns}`);
  }
  return game;
}

function frozenTurns(): Map<string, number> {
  const turns = new Map<string, number>();
  for (const file of readdirSync(GOLDEN_DIR).filter((name) => /^sim-\d+\.json$/.test(name))) {
    const shard = JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as {
      seeds: string[];
      turns: number[];
    };
    shard.seeds.forEach((seed, index) => {
      const turnCount = shard.turns[index];
      if (turnCount === undefined || turns.has(seed)) {
        throw new Error(`Malformed frozen S6 shard: ${file}`);
      }
      turns.set(seed, turnCount);
    });
  }
  return turns;
}

it.skipIf(process.env.S7_OBSERVE !== "1")(
  "S7 product observations preserve frozen turns and measure lottery behavior",
  () => {
    const offset = envInt("S7_OFFSET", 0, 0);
    const count = envInt("S7_GAMES", 1250, 1);
    const output = resolve(
      process.env.S7_OUTPUT ?? `.claude/logs/s7/simulation/observe-${offset}.json`,
    );
    const allowedRoot = `${resolve(".claude/logs/s7/simulation")}/`;
    if (!output.startsWith(allowedRoot)) {
      throw new Error("S7_OUTPUT must be below .claude/logs/s7/simulation");
    }
    const input = loadShippedBundle(
      "public/data",
      CLASSIC_GAME_CONFIG.targetServiceId,
      CLASSIC_GAME_CONFIG.startStationId,
    );
    const seeds = Array.from({ length: count }, (_, index) =>
      gameSeed(BASE_SEED, offset + index),
    );
    const golden = frozenTurns();
    const started = performance.now();
    const games = seeds.map((seed) => observeGame(input.network, seed, golden));
    const bundleHashes = Object.fromEntries(
      BUNDLE_FILES.map((file) => [file, hash(readFileSync(`public/data/${file}`))]),
    );
    const sourceHashes = Object.fromEntries(
      [OBSERVER_SOURCE, ...ENGINE_SOURCES].map((file) => [file, hash(readFileSync(file))]),
    );
    const statistics = summarizeObservations(games);
    const report = {
      schemaVersion: 1,
      measurement: "s7-observations",
      shard: { offset, games: count, baseSeed: BASE_SEED, turnCap: TURN_CAP },
      seeds,
      seedSetSha256: hash(`${seeds.join("\n")}\n`),
      config: CLASSIC_GAME_CONFIG,
      bundleHashes,
      sourceHashes,
      turns: games.map((game) => game.turns),
      games,
      statistics,
      runtimeSeconds: (performance.now() - started) / 1000,
    };
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report));

    expect(statistics.completedGames).toBe(count);
    expect(statistics.errors).toBe(0);
    expect(statistics.zeroHopPlayingTurns).toBe(0);
    expect(statistics.invalidChoices).toBe(0);
    expect(statistics.unreachableStations).toBe(0);
    expect(statistics.invalidTransitions).toBe(0);
    expect(statistics.weightViolations).toBe(0);
    expect(statistics.capSeeds).toEqual([]);
  },
  3_600_000,
);
