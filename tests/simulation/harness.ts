import * as engine from "../../src/features/game/engine";
import type { GameConfig, GameState } from "../../src/types/network";

export const PRESETS = ["all-equal", "decided", "decided-pass-through"] as const;
export type Preset = (typeof PRESETS)[number];

export interface RunOptions {
  baseSeed: number;
  games: number;
  turnCap: number;
}

export interface TurnStatistics {
  games: number;
  completedGames: number;
  capHits: number;
  cappedGameIndices: number[];
  median: number;
  p90: number;
  p99: number;
  mean: number;
  max: number;
  over500Count: number;
  totalPlayedTurns: number;
}

export function presetConfig(preset: Preset, targetServiceId: string, startStationId: string): GameConfig {
  return {
    rulesetVersion: `simulation-s1m-${preset}`,
    targetServiceId, startStationId, targetDirection: 1,
    goalArrivalPolicy: preset === "decided-pass-through" ? "pass-through" : "truncate-on-target-service",
    serviceLottery: {
      kindWeights: Object.fromEntries(engine.SERVICE_KINDS.map((kind) => [kind, 1])) as GameConfig["serviceLottery"]["kindWeights"],
      target: preset === "all-equal" ? { kind: "weight", weight: 1 } : { kind: "share", numerator: 1, denominator: 2 },
    },
    directionLottery: { towardTargetWeight: preset === "all-equal" ? 1 : 2 },
  };
}

export function validateRunOptions(options: RunOptions): void {
  for (const [name, value] of Object.entries(options)) {
    const minimum = name === "baseSeed" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || (name === "turnCap" && value >= Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${name} must be a safe integer >= ${minimum}`);
    }
  }
}

/** Independent engine string seeds; the same set is used by every preset. */
export function gameSeed(baseSeed: number, gameIndex: number): string {
  return `s1m-${baseSeed}-${gameIndex}`;
}

export function runGame(
  network: engine.RailwayNetwork,
  config: GameConfig,
  seed: string,
  turnCap: number,
  retainHistory: boolean = false,
): GameState {
  validateRunOptions({ baseSeed: 0, games: 1, turnCap });
  let game = engine.createGame(config, seed, network);
  while (game.status === "playing" && game.turn < turnCap) {
    const next = engine.playTurn(game, network).state;
    // History is observational, never read by playTurn. Avoid quadratic array
    // growth in measurements; agreement tests compare against retained history.
    game = retainHistory ? next : { ...next, movementHistory: [] };
  }
  return game;
}

/** Nearest-rank quantiles, matching the historical replica's convention. */
export function summarizeTurns(turns: readonly number[], cappedGameIndices: readonly number[], totalPlayedTurns: number): TurnStatistics {
  if (turns.length === 0) throw new Error("Cannot summarize zero games");
  const sorted = [...turns].sort((a, b) => a - b);
  const quantile = (p: number): number => sorted[Math.ceil(p * sorted.length) - 1] as number;
  return {
    games: turns.length, completedGames: turns.length - cappedGameIndices.length,
    capHits: cappedGameIndices.length, cappedGameIndices: [...cappedGameIndices],
    median: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99),
    mean: turns.reduce((sum, value) => sum + value, 0) / turns.length,
    max: sorted[sorted.length - 1] as number,
    over500Count: turns.filter((value) => value > 500).length, totalPlayedTurns,
  };
}

export function runSimulation(network: engine.RailwayNetwork, config: GameConfig, options: RunOptions): TurnStatistics {
  validateRunOptions(options);
  const turns: number[] = [];
  const cappedGameIndices: number[] = [];
  let totalPlayedTurns = 0;
  for (let index = 0; index < options.games; index += 1) {
    const game = runGame(network, config, gameSeed(options.baseSeed, index), options.turnCap);
    totalPlayedTurns += game.turn;
    const capped = game.status !== "completed";
    if (capped) cappedGameIndices.push(index);
    // A cap is censored, not a completion. Match the replica's cap+1 sentinel
    // in descriptive statistics and report the count and indices explicitly.
    turns.push(capped ? options.turnCap + 1 : game.turn);
  }
  return summarizeTurns(turns, cappedGameIndices, totalPlayedTurns);
}
