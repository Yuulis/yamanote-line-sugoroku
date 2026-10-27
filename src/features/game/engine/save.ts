// Save format (spec 3.4, 8.1). restoreGame never fills in defaults: a save
// is either fully valid for this network or rejected with a typed error.

import type {
  Direction,
  GameConfig,
  GameState,
  ItemGameState,
  ItemPosition,
  ItemPolicy,
  LandingChoice,
  MoveRecord,
  StopReason,
} from "../../../types/network";
import { GOAL_ARRIVAL_POLICIES, parseItemPolicy, parseLotteryPolicies } from "./config";
import { SERVICE_KINDS } from "../../../types/network";
import { GameEngineError } from "./errors";
import { type ComputedTurn, computeTurn, createGame, SAVE_VERSION, seededTurn } from "./game";
import type { GamePosition } from "./movement";
import type { RailwayNetwork } from "./network";
import { isValidRngState } from "./rng";
import { exactKeys, ITEM_KEYS, POSITION_KEYS, itemFieldsShape, itemRecordShape, pendingShape, sameJson } from "./saveSchema";
import { replayItemSave } from "./saveItemReplay";
import { deepFreeze } from "./itemTurnPreparation";

export type SavedGameState = GameState | ItemGameState;

const STOP_REASONS: readonly StopReason[] = ["roll", "goal", "endpoint"];

type UnknownRecord = Record<string, unknown>;
type SavedStatus = Extract<GameState["status"], "playing" | "completed">;

/** Serialise a committed position, including a pending item decision (never a UI phase). */
export function serializeGame(state: SavedGameState): string {
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
  exactKeys(raw, ["rulesetVersion", "targetServiceId", "startStationId", "targetDirection", "goalArrivalPolicy", "serviceLottery", "directionLottery"], ["itemPolicy"]);
  const policy = raw.goalArrivalPolicy;
  if (!GOAL_ARRIVAL_POLICIES.some((known) => known === policy)) {
    invalid("config.goalArrivalPolicy is unknown");
  }
  let lotteries: Pick<GameConfig, "serviceLottery" | "directionLottery">;
  try {
    lotteries = parseLotteryPolicies(raw.serviceLottery, raw.directionLottery);
  } catch (error) {
    if (error instanceof GameEngineError) invalid(`config lottery policies are invalid: ${error.message}`);
    throw error;
  }
  return {
    rulesetVersion: asString(raw.rulesetVersion, "config.rulesetVersion"),
    targetServiceId: asString(raw.targetServiceId, "config.targetServiceId"),
    startStationId: asString(raw.startStationId, "config.startStationId"),
    targetDirection: asDirection(raw.targetDirection, "config.targetDirection"),
    goalArrivalPolicy: policy as GameConfig["goalArrivalPolicy"],
    ...lotteries,
    ...(Object.hasOwn(raw, "itemPolicy") ? { itemPolicy: (() => {
      try { return parseItemPolicy(raw.itemPolicy); }
      catch (error) {
        if (error instanceof GameEngineError) invalid(`config item policy is invalid: ${error.message}`);
        throw error;
      }
    })() } : {}),
  };
}

function asStopReason(value: unknown, path: string): StopReason {
  const reason = STOP_REASONS.find((known) => known === value);
  if (reason === undefined) invalid(`${path} must be one of ${STOP_REASONS.join(", ")}`);
  return reason;
}

/** `null` (the move cleared) or a choice; a missing key is not accepted. */
function asLanding(value: unknown, path: string): LandingChoice | null {
  if (value === null) return null;
  const raw = asRecord(value, path);
  exactKeys(raw, ["serviceId", "direction"]);
  return {
    serviceId: asString(raw.serviceId, `${path}.serviceId`),
    direction: asDirection(raw.direction, `${path}.direction`),
  };
}

function parseMoveRecord(value: unknown, path: string): MoveRecord {
  const raw = asRecord(value, path);
  exactKeys(raw, ["turn", "roll", "serviceId", "direction", "fromStationId", "toStationId", "traversedSegmentIds", "stopReason", "landing"]);
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
    stopReason: asStopReason(raw.stopReason, `${path}.stopReason`),
    landing: asLanding(raw.landing, `${path}.landing`),
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
function parsePosition(raw: UnknownRecord): Omit<GameState, "movementHistory"> {
  if (raw.saveVersion !== SAVE_VERSION) invalid("Position saveVersion must match the v4 envelope");
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
    rngSeed: asString(raw.rngSeed, "rngSeed"),
    rngState,
  };
}

function parseItemPosition(raw: UnknownRecord, network: RailwayNetwork): ItemPosition {
  const base = parsePosition(raw);
  if (!base.config.itemPolicy) invalid("Item position requires itemPolicy");
  itemFieldsShape(Object.fromEntries(ITEM_KEYS.map((key) => [key, raw[key]])), "items");
  const fields = Object.fromEntries(ITEM_KEYS.map((key) => [key, raw[key]])) as unknown as Pick<ItemPosition, typeof ITEM_KEYS[number]>;
  const policy = base.config.itemPolicy;
  if (fields.inventory.length > policy.inventoryCapacity ||
      new Set(fields.inventory.map((item) => item.id)).size !== fields.inventory.length ||
      fields.inventory.some((item) => Number(item.id.slice(5)) > base.turn || !policy.beneficialKinds.includes(item.kind as typeof policy.beneficialKinds[number]))) {
    invalid("Inventory capacity, instance ids or kinds are invalid");
  }
  const { delayDueTurns, suspensions } = fields.effects;
  if (delayDueTurns.some((due, index) => due <= base.turn || due > base.turn + policy.delayTurns ||
      (index > 0 && delayDueTurns[index - 1]! >= due))) invalid("Delay timers are invalid");
  if (suspensions.some((entry, index) => !network.servicesById.has(entry.serviceId) ||
      entry.expiresTurn < base.turn || entry.expiresTurn > base.turn + policy.suspensionTurns ||
      (index > 0 && suspensions[index - 1]!.serviceId >= entry.serviceId))) invalid("Suspension timers or services are invalid");
  return { ...base, config: { ...base.config, itemPolicy: policy }, ...fields };
}

function parseState(raw: UnknownRecord, network: RailwayNetwork): SavedGameState {
  const base = parsePosition(raw);
  if (!Array.isArray(raw.movementHistory)) invalid("movementHistory must be an array");
  if (!base.config.itemPolicy) {
    exactKeys(raw, [...POSITION_KEYS, "movementHistory"]);
    return { ...base, movementHistory: raw.movementHistory.map((record, index) => parseMoveRecord(record, `movementHistory[${index}]`)) };
  }
  exactKeys(raw, [...POSITION_KEYS, ...ITEM_KEYS, "movementHistory", "pending"]);
  raw.movementHistory.forEach((record, index) => itemRecordShape(record, `movementHistory[${index}]`));
  pendingShape(raw.pending, "pending");
  const position = parseItemPosition(raw, network);
  const state = { ...position, movementHistory: raw.movementHistory, pending: raw.pending } as ItemGameState;
  if (state.turn !== state.movementHistory.length) invalid("turn does not match completed history");
  if (state.pending !== null) {
    if (state.status !== "playing" || state.pending.turn !== state.turn + 1) invalid("Illegal pending decision");
    if (state.pending.kind === "discard") {
      const pendingPosition = parseItemPosition(asRecord(state.pending.position, "pending.position"), network);
      if (!sameJson(pendingPosition.config, state.config) || pendingPosition.rngSeed !== state.rngSeed ||
          pendingPosition.dataVersion !== state.dataVersion || pendingPosition.saveVersion !== SAVE_VERSION ||
          pendingPosition.turn !== state.pending.turn || pendingPosition.status !== "playing" ||
          state.pending.record.discardedInstanceId !== null) invalid("Illegal pending discard position");
    }
  }
  return state;
}

export function isItemSave(state: SavedGameState): state is ItemGameState {
  return Object.hasOwn(state, "pending");
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameLanding(left: LandingChoice | null, right: LandingChoice | null): boolean {
  if (left === null || right === null) return left === right;
  return left.serviceId === right.serviceId && left.direction === right.direction;
}

function sameRecord(left: MoveRecord, right: MoveRecord): boolean {
  return (
    left.turn === right.turn &&
    left.roll === right.roll &&
    left.serviceId === right.serviceId &&
    left.direction === right.direction &&
    left.fromStationId === right.fromStationId &&
    left.toStationId === right.toStationId &&
    sameList(left.traversedSegmentIds, right.traversedSegmentIds) &&
    left.stopReason === right.stopReason &&
    sameLanding(left.landing, right.landing)
  );
}

/**
 * Replay `history` from a new game, one {@link ComputedTurn} per record,
 * requiring each produced record to equal the saved one (`onMismatch`
 * decides the error). Linear in the history length for a fixed network:
 * the accumulator is a history-free position, so the growing history array
 * is never rebuilt; each saved record is read once.
 */
function replayHistory(
  initial: GamePosition,
  history: readonly MoveRecord[],
  playRecord: (position: GamePosition, record: MoveRecord, index: number) => ComputedTurn,
  onMismatch: (message: string) => never,
): GamePosition {
  let replayed = initial;
  history.forEach((record, index) => {
    if (replayed.status !== "playing") {
      onMismatch(`movementHistory[${index}] follows a finished game`);
    }
    const turn = playRecord(replayed, record, index);
    if (!sameRecord(turn.record, record)) {
      onMismatch(`movementHistory[${index}] differs from its replay`);
    }
    replayed = turn.position;
  });
  return replayed;
}

/** Replay one recorded move with its recorded landing, any engine error -> INVALID_SAVE. */
function replayRecordedMove(
  state: GamePosition,
  record: MoveRecord,
  index: number,
  network: RailwayNetwork,
): ComputedTurn {
  try {
    return computeTurn(state, record.roll, state.rngState, network, {
      kind: "supplied",
      choice: record.landing,
    });
  } catch (error) {
    if (error instanceof GameEngineError) {
      invalid(`movementHistory[${index}] cannot be replayed: ${error.code}`);
    }
    throw error;
  }
}

/**
 * Check the saved state is exactly what the engine produces when replaying
 * its history (rolls and recorded landings) from a new game. This covers
 * the route, endpoint and goal truncation, landing legality, segment
 * completion order and status in one pass.
 *
 * Rolls and landings may come from moveByRoll (no randomness consumed) or
 * playTurn, so only a turn-0 rngState is tied to the seed here; the
 * production path adds {@link verifySeededHistory}.
 */
function assertReplayMatches(
  saved: GameState,
  network: RailwayNetwork,
  checkInitialRng: boolean,
): void {
  let initial: GameState;
  try {
    initial = createGame(saved.config, saved.rngSeed, network);
  } catch (error) {
    if (error instanceof GameEngineError) invalid(`config is not playable: ${error.code}`);
    throw error;
  }
  const replayed = replayHistory(
    initial,
    saved.movementHistory,
    (state, record, index) => replayRecordedMove(state, record, index, network),
    invalid,
  );
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
  const leftTarget = left.serviceLottery.target;
  const rightTarget = right.serviceLottery.target;
  const sameTarget = leftTarget.kind === "weight"
    ? rightTarget.kind === "weight" && leftTarget.weight === rightTarget.weight
    : rightTarget.kind === "share" && leftTarget.numerator === rightTarget.numerator &&
      leftTarget.denominator === rightTarget.denominator;
  const leftItems = left.itemPolicy;
  const rightItems = right.itemPolicy;
  const sameItems = leftItems === undefined || rightItems === undefined
    ? leftItems === rightItems
    : leftItems.dropChancePerMille === rightItems.dropChancePerMille &&
      leftItems.harmfulChancePercent === rightItems.harmfulChancePercent &&
      leftItems.inventoryCapacity === rightItems.inventoryCapacity &&
      leftItems.maxActiveItemsPerTurn === rightItems.maxActiveItemsPerTurn &&
      leftItems.delayTurns === rightItems.delayTurns &&
      leftItems.suspensionTurns === rightItems.suspensionTurns &&
      leftItems.fullInventoryPolicy === rightItems.fullInventoryPolicy &&
      sameList(leftItems.beneficialKinds, rightItems.beneficialKinds) &&
      sameList(leftItems.harmfulKinds, rightItems.harmfulKinds);
  return (
    left.rulesetVersion === right.rulesetVersion &&
    left.targetServiceId === right.targetServiceId &&
    left.startStationId === right.startStationId &&
    left.targetDirection === right.targetDirection &&
    left.goalArrivalPolicy === right.goalArrivalPolicy &&
    SERVICE_KINDS.every((kind) => left.serviceLottery.kindWeights[kind] === right.serviceLottery.kindWeights[kind]) &&
    sameTarget &&
    left.directionLottery.towardTargetWeight === right.directionLottery.towardTargetWeight &&
    left.directionLottery.awayFromTargetWeight === right.directionLottery.awayFromTargetWeight &&
    sameItems
  );
}

function rngMismatch(message: string): never {
  throw new GameEngineError("RNG_MISMATCH", message);
}

/**
 * Production check that every recorded move came from the seeded RNG:
 * replay the game from `rngSeed` with the same draws playTurn makes (die,
 * then service and direction lotteries when required) and require every
 * whole record (roll, route, stop reason, landing) and the final `rngState`
 * to match. Expects a state that already passed `restoreGame`'s replay, so a
 * legal history that the seed did not produce (e.g. another direction with
 * the same roll) is reported as `RNG_MISMATCH`.
 *
 * This proves reproducibility from the seed, not authenticity: a save forged
 * from another seed together with its own consistent history still passes.
 *
 * @throws GameEngineError `RNG_MISMATCH`
 */
export function verifySeededHistory(state: SavedGameState, network: RailwayNetwork): void {
  if (isItemSave(state)) {
    replayItemSave(state, network, true);
    return;
  }
  const replayed = replayHistory(
    createGame(state.config, state.rngSeed, network),
    state.movementHistory,
    (current) => seededTurn(current, network),
    rngMismatch,
  );
  if (replayed.rngState !== state.rngState) {
    rngMismatch("rngState does not follow from rngSeed and the recorded moves");
  }
}

export interface RestoreOptions {
  /** Reject a save made under different rules (checked before the replay). */
  expectedConfig?: GameConfig;
  /**
   * Require every move to come from the seeded die ({@link verifySeededHistory}).
   * Item saves always require both passes. The app always sets this; classic
   * tests that build games with arbitrary `moveByRoll` rolls leave it off.
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
export function restoreGame(json: string, network: RailwayNetwork, options: RestoreOptions & {
  expectedConfig: GameConfig & { itemPolicy: ItemPolicy };
}): ItemGameState;
export function restoreGame(json: string, network: RailwayNetwork, options: RestoreOptions & { expectedConfig: GameConfig }): GameState;
export function restoreGame(json: string, network: RailwayNetwork, options?: RestoreOptions): SavedGameState;
export function restoreGame(
  json: string,
  network: RailwayNetwork,
  options: RestoreOptions = {},
): SavedGameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("Save is not valid JSON");
  }
  const raw = asRecord(parsed, "save");
  parseSaveVersion(raw);
  const state = parseState(raw, network);
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
  if (isItemSave(state)) {
    replayItemSave(state, network, false);
    verifySeededHistory(state, network);
    // Re-freeze the parsed transcript, whose complete contents both passes verified.
    if (state.pending) deepFreeze(state.pending);
    return state;
  }
  assertReplayMatches(state, network, !requireSeededRolls);
  if (requireSeededRolls) verifySeededHistory(state, network);
  return state;
}
