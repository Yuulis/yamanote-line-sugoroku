// Core game transitions (spec 3.2-3.4, 8.1). Pure: no I/O, no clock, no
// global randomness; every function returns new objects.

import type {
  GameConfig,
  GameState,
  MoveRecord,
  SegmentId,
  StationId,
} from "../../../types/network";
import { validateConfig } from "./config";
import { GameEngineError } from "./errors";
import { stopsAtGoal, targetSegmentIds } from "./goal";
import { findSegment, nextStationId, type RailwayNetwork } from "./network";
import { type DieFace, rollDie, seedRng } from "./rng";
import type { MoveEvent, MoveResult } from "./types";

export const SAVE_VERSION = 1;
const MIN_ROLL = 1;
const MAX_ROLL = 6;

/** A new game at the start station: turn 0, nothing completed, status playing. */
export function createGame(
  config: GameConfig,
  seed: string,
  network: RailwayNetwork,
): GameState {
  validateConfig(config, network);
  const rngState = seedRng(seed);
  return {
    saveVersion: SAVE_VERSION,
    dataVersion: network.dataVersion,
    status: "playing",
    config: { ...config },
    currentStationId: config.startStationId,
    currentServiceId: config.targetServiceId,
    direction: config.targetDirection,
    turn: 0,
    completedSegmentIds: [],
    movementHistory: [],
    rngSeed: seed,
    rngState,
  };
}

function assertValidRoll(roll: number): asserts roll is DieFace {
  if (!Number.isInteger(roll) || roll < MIN_ROLL || roll > MAX_ROLL) {
    throw new GameEngineError("INVALID_ROLL", `Roll must be an integer 1-6: ${roll}`);
  }
}

function assertPlaying(state: GameState): void {
  if (state.status !== "playing") {
    throw new GameEngineError("GAME_NOT_PLAYING", `Game is ${state.status}`);
  }
}

function assertOnCurrentService(state: GameState, network: RailwayNetwork): void {
  const service = network.servicesById.get(state.currentServiceId);
  if (!service?.stationIds.includes(state.currentStationId)) {
    throw new GameEngineError(
      "INVALID_STATE",
      `Station ${state.currentStationId} is not on service ${state.currentServiceId}`,
    );
  }
}

/**
 * Move `roll` stations along the current service and direction, completing
 * every traversed segment and applying the goal policy after each step.
 * Does not touch `rngState`: the roll is supplied by the caller (see playTurn).
 *
 * @throws GameEngineError `INVALID_ROLL`, `GAME_NOT_PLAYING`, `INVALID_STATE`
 */
export function moveByRoll(
  state: GameState,
  roll: number,
  network: RailwayNetwork,
): MoveResult {
  assertValidRoll(roll);
  assertPlaying(state);
  assertOnCurrentService(state, network);

  const { config, currentServiceId: serviceId, direction } = state;
  const required = targetSegmentIds(config, network);
  const completed = new Set<SegmentId>(state.completedSegmentIds);
  const completedSegmentIds = [...state.completedSegmentIds];
  const traversedSegmentIds: SegmentId[] = [];
  const events: MoveEvent[] = [];
  let stationId: StationId = state.currentStationId;
  let reachedGoal = false;

  for (let step = 1; step <= roll && !reachedGoal; step += 1) {
    const toStationId = nextStationId(network, serviceId, stationId, direction);
    if (toStationId === undefined) {
      throw new GameEngineError("INVALID_STATE", "Reached the end of a non-circular service");
    }
    const segment = findSegment(network, serviceId, stationId, toStationId);
    if (!segment) {
      throw new GameEngineError("INVALID_STATE", `No segment ${stationId} -> ${toStationId}`);
    }
    const newlyCompleted = !completed.has(segment.id);
    if (newlyCompleted) {
      completed.add(segment.id);
      completedSegmentIds.push(segment.id);
    }
    traversedSegmentIds.push(segment.id);
    events.push({
      type: "segment-traversed",
      step,
      serviceId,
      direction,
      segmentId: segment.id,
      fromStationId: stationId,
      toStationId,
      newlyCompleted,
    });
    stationId = toStationId;

    const atGoal =
      stationId === config.startStationId && required.every((id) => completed.has(id));
    if (atGoal && stopsAtGoal(config, serviceId, step === roll)) {
      reachedGoal = true;
      events.push({ type: "goal-reached", step, stationId });
    }
  }

  const turn = state.turn + 1;
  const record: MoveRecord = {
    turn,
    roll,
    serviceId,
    direction,
    fromStationId: state.currentStationId,
    toStationId: stationId,
    traversedSegmentIds,
  };
  return {
    state: {
      ...state,
      status: reachedGoal ? "completed" : "playing",
      currentStationId: stationId,
      turn,
      completedSegmentIds,
      movementHistory: [...state.movementHistory, record],
    },
    events,
    roll,
    unusedPips: roll - traversedSegmentIds.length,
  };
}

/**
 * Roll the seeded die and apply the move. The RNG advances only when a turn
 * is actually played, so a rejected call leaves the dice sequence intact.
 *
 * @throws GameEngineError `GAME_NOT_PLAYING`, `INVALID_RNG_STATE`, `INVALID_STATE`
 */
export function playTurn(state: GameState, network: RailwayNetwork): MoveResult {
  assertPlaying(state);
  const { value, nextRngState } = rollDie(state.rngState);
  return moveByRoll({ ...state, rngState: nextRngState }, value, network);
}
