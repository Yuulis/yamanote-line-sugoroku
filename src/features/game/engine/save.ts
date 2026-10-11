// Save format (spec 3.4, 8.1). restoreGame never fills in defaults: a save
// is either fully valid for this network or rejected with a typed error.

import type {
  Direction,
  GameConfig,
  GameState,
  MoveRecord,
} from "../../../types/network";
import { GOAL_ARRIVAL_POLICIES } from "./config";
import { GameEngineError } from "./errors";
import { createGame, moveByRoll, playTurn, SAVE_VERSION } from "./game";
import type { RailwayNetwork } from "./network";
import { isValidRngState } from "./rng";

type UnknownRecord = Record<string, unknown>;
type SavedStatus = Extract<GameState["status"], "playing" | "completed">;

/** Serialise a settled game state (never a mid-animation UI state). */
export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

function invalid(message: string): never {
  throw new GameEngineError("INVALID_SAVE", message);
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${path} must be a non-empty string`);
  }
  return value;
}

function asCount(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${path} must be a non-negative integer`);
  }
  return value as number;
}

function asDirection(value: unknown, path: string): Direction {
  if (value !== 1 && value !== -1) invalid(`${path} must be 1 or -1`);
  return value;
}

function asStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

function asStatus(value: unknown): SavedStatus {
  // `ready` and `moving` are UI phases and are never saved.
  if (value !== "playing" && value !== "completed") {
    invalid("status must be playing or completed");
  }
  return value;
}

function parseConfig(value: unknown): GameConfig {
  const raw = asRecord(value, "config");
  const policy = raw.goalArrivalPolicy;
  if (!GOAL_ARRIVAL_POLICIES.some((known) => known === policy)) {
    invalid("config.goalArrivalPolicy is unknown");
  }
  return {
    rulesetVersion: asString(raw.rulesetVersion, "config.rulesetVersion"),
    targetServiceId: asString(raw.targetServiceId, "config.targetServiceId"),
    startStationId: asString(raw.startStationId, "config.startStationId"),
    targetDirection: asDirection(raw.targetDirection, "config.targetDirection"),
    goalArrivalPolicy: policy as GameConfig["goalArrivalPolicy"],
  };
}

function parseMoveRecord(value: unknown, path: string): MoveRecord {
  const raw = asRecord(value, path);
  return {
    turn: asCount(raw.turn, `${path}.turn`),
    roll: asCount(raw.roll, `${path}.roll`),
    serviceId: asString(raw.serviceId, `${path}.serviceId`),
    direction: asDirection(raw.direction, `${path}.direction`),
    fromStationId: asString(raw.fromStationId, `${path}.fromStationId`),
    toStationId: asString(raw.toStationId, `${path}.toStationId`),
    traversedSegmentIds: asStringList(
      raw.traversedSegmentIds,
      `${path}.traversedSegmentIds`,
    ),
  };
}

function parseSaveVersion(raw: UnknownRecord): void {
  const version = raw.saveVersion;
  if (!Number.isSafeInteger(version)) invalid("saveVersion must be an integer");
  if (version !== SAVE_VERSION) {
    throw new GameEngineError(
      "UNSUPPORTED_SAVE_VERSION",
      `Unsupported saveVersion ${String(version)}`,
    );
  }
}

/** Shape-only parse into a fresh object holding just the known fields. */
function parseState(raw: UnknownRecord): GameState {
  const history = raw.movementHistory;
  if (!Array.isArray(history)) invalid("movementHistory must be an array");
  const rngState = raw.rngState;
  if (!isValidRngState(rngState)) invalid("rngState is malformed");
  return {
    saveVersion: SAVE_VERSION,
    dataVersion: asString(raw.dataVersion, "dataVersion"),
    status: asStatus(raw.status),
    config: parseConfig(raw.config),
    currentStationId: asString(raw.currentStationId, "currentStationId"),
    currentServiceId: asString(raw.currentServiceId, "currentServiceId"),
    direction: asDirection(raw.direction, "direction"),
    turn: asCount(raw.turn, "turn"),
    completedSegmentIds: asStringList(raw.completedSegmentIds, "completedSegmentIds"),
    movementHistory: history.map((record, index) =>
      parseMoveRecord(record, `movementHistory[${index}]`),
    ),
    rngSeed: asString(raw.rngSeed, "rngSeed"),
    rngState,
  };
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameRecord(left: MoveRecord, right: MoveRecord): boolean {
  return (
    left.turn === right.turn &&
    left.roll === right.roll &&
    left.serviceId === right.serviceId &&
    left.direction === right.direction &&
    left.fromStationId === right.fromStationId &&
    left.toStationId === right.toStationId &&
    sameList(left.traversedSegmentIds, right.traversedSegmentIds)
  );
}

/** Replay a single move, turning any engine error into INVALID_SAVE. */
function replayMove(
  state: GameState,
  record: MoveRecord,
  network: RailwayNetwork,
  index: number,
): GameState {
  try {
    return moveByRoll(state, record.roll, network).state;
  } catch (error) {
    if (error instanceof GameEngineError) {
      invalid(`movementHistory[${index}] cannot be replayed: ${error.code}`);
    }
    throw error;
  }
}

/**
 * Check the saved state is exactly what the engine produces when replaying
 * its history from a new game. This covers the route, segment completion
 * order, goal policy (including truncation) and status in one pass.
 *
 * Rolls may come from moveByRoll (no randomness consumed) or playTurn and
 * the history does not record which, so only a turn-0 rngState is tied to
 * the seed here; the production path adds {@link verifySeededHistory}.
 */
function assertReplayMatches(
  saved: GameState,
  network: RailwayNetwork,
  checkInitialRng: boolean,
): void {
  let replayed: GameState;
  try {
    replayed = createGame(saved.config, saved.rngSeed, network);
  } catch (error) {
    if (error instanceof GameEngineError) invalid(`config is not playable: ${error.code}`);
    throw error;
  }
  saved.movementHistory.forEach((record, index) => {
    replayed = replayMove(replayed, record, network, index);
    const produced = replayed.movementHistory[index];
    if (!produced || !sameRecord(produced, record)) {
      invalid(`movementHistory[${index}] does not match the rules`);
    }
  });
  const matches =
    replayed.status === saved.status &&
    replayed.turn === saved.turn &&
    replayed.currentStationId === saved.currentStationId &&
    replayed.currentServiceId === saved.currentServiceId &&
    replayed.direction === saved.direction &&
    sameList(replayed.completedSegmentIds, saved.completedSegmentIds);
  if (!matches) invalid("Saved position or progress does not match its history");
  if (checkInitialRng && saved.turn === 0 && saved.rngState !== replayed.rngState) {
    invalid("rngState does not belong to rngSeed");
  }
}

function sameConfig(left: GameConfig, right: GameConfig): boolean {
  return (
    left.rulesetVersion === right.rulesetVersion &&
    left.targetServiceId === right.targetServiceId &&
    left.startStationId === right.startStationId &&
    left.targetDirection === right.targetDirection &&
    left.goalArrivalPolicy === right.goalArrivalPolicy
  );
}

function rngMismatch(message: string): never {
  throw new GameEngineError("RNG_MISMATCH", message);
}

/**
 * Production check that every recorded roll came from the seeded die: replay
 * the game from `rngSeed` with `playTurn` (one draw sequence per turn, the
 * same calls the app makes) and require each roll and the final `rngState`
 * to match. Expects a state that already passed `restoreGame`'s replay.
 *
 * This proves reproducibility from the seed, not authenticity: a save forged
 * from another seed together with its own consistent history still passes.
 *
 * @throws GameEngineError `RNG_MISMATCH`
 */
export function verifySeededHistory(state: GameState, network: RailwayNetwork): void {
  let replayed = createGame(state.config, state.rngSeed, network);
  state.movementHistory.forEach((record, index) => {
    if (replayed.status !== "playing") {
      rngMismatch(`movementHistory[${index}] follows a finished game`);
    }
    const result = playTurn(replayed, network);
    if (result.roll !== record.roll) {
      rngMismatch(`movementHistory[${index}].roll was not produced by rngSeed`);
    }
    replayed = result.state;
  });
  if (replayed.rngState !== state.rngState) {
    rngMismatch("rngState does not follow from rngSeed and the recorded rolls");
  }
}

export interface RestoreOptions {
  /** Reject a save made under different rules (checked before the replay). */
  expectedConfig?: GameConfig;
  /**
   * Require every move to come from the seeded die ({@link verifySeededHistory}).
   * The app always sets this; tests that build games with arbitrary
   * `moveByRoll` rolls leave it off.
   */
  requireSeededRolls?: boolean;
}

/**
 * Parse and fully validate a save for `network`. Checks run in this order,
 * so the error names the most fundamental problem: version, shape, data
 * version, rules, history replay, then (optionally) the RNG.
 *
 * @throws GameEngineError `INVALID_SAVE` (malformed or inconsistent),
 *   `UNSUPPORTED_SAVE_VERSION`, `DATA_VERSION_MISMATCH`, `CONFIG_MISMATCH`,
 *   `RNG_MISMATCH`
 */
export function restoreGame(
  json: string,
  network: RailwayNetwork,
  options: RestoreOptions = {},
): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("Save is not valid JSON");
  }
  const raw = asRecord(parsed, "save");
  parseSaveVersion(raw);
  const state = parseState(raw);
  if (state.dataVersion !== network.dataVersion) {
    throw new GameEngineError(
      "DATA_VERSION_MISMATCH",
      "Save was made with different railway data",
    );
  }
  const { expectedConfig, requireSeededRolls = false } = options;
  if (expectedConfig && !sameConfig(state.config, expectedConfig)) {
    throw new GameEngineError("CONFIG_MISMATCH", "Save was made under different rules");
  }
  // With seeded rolls required, verifySeededHistory covers turn 0 as well and
  // reports it as RNG_MISMATCH like any other RNG inconsistency.
  assertReplayMatches(state, network, !requireSeededRolls);
  if (requireSeededRolls) verifySeededHistory(state, network);
  return state;
}
