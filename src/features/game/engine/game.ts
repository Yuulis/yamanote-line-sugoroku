// Core game transitions (spec 3.2-3.4, 4.1, 8.1). Pure: no I/O, no clock, no
// global randomness; every function returns new objects.
//
// Turns are atomic: every exported GameState is settled (the service and
// direction of the next move are already decided), so there is no pending
// landing state to save or restore.

import type {
  GameConfig,
  GameState,
  LandingChoice,
  MoveRecord,
  StopReason,
} from "../../../types/network";
import { validateConfig } from "./config";
import { GameEngineError } from "./errors";
import { drawLanding, landingOptions, resolveLandingEvent } from "./landing";
import { advance, assertSettledPosition, type GamePosition } from "./movement";
import type { RailwayNetwork } from "./network";
import { type DieFace, rollDie, seedRng } from "./rng";
import type { MoveEvent, MoveResult } from "./types";

export const SAVE_VERSION = 2;
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

function assertPlaying(state: GamePosition): void {
  if (state.status !== "playing") {
    throw new GameEngineError("GAME_NOT_PLAYING", `Game is ${state.status}`);
  }
}

/** How the landing of a turn is decided. */
export type LandingSource =
  /** Injected (moveByRoll, structural replay); `undefined` = forced outcome only. */
  | { kind: "supplied"; choice: LandingChoice | null | undefined }
  /** Drawn from the RNG (playTurn, seeded replay). */
  | { kind: "seeded" };

/**
 * One computed turn. The kernel neither reads nor returns a history: callers
 * append `record` themselves, so replaying a long history never rebuilds the
 * growing array on every turn.
 */
export interface ComputedTurn {
  position: GamePosition;
  record: MoveRecord;
  events: MoveEvent[];
  roll: DieFace;
  stopReason: StopReason;
  unusedPips: number;
}

function invalidState(message: string): never {
  throw new GameEngineError("INVALID_STATE", message);
}

/**
 * Shared turn core for moveByRoll, playTurn and save replay: advance, then
 * (unless the move cleared) resolve the landing, then settle the state.
 * `rngState` is the generator state after the roll; only a seeded landing
 * advances it further.
 *
 * @internal Not part of the public engine surface (see index.ts).
 */
export function computeTurn(
  state: GamePosition,
  roll: number,
  rngState: string,
  network: RailwayNetwork,
  source: LandingSource,
): ComputedTurn {
  assertValidRoll(roll);
  assertPlaying(state);
  assertSettledPosition(state, network);

  const moved = advance(state, roll, network);
  const events = [...moved.events];
  let nextRngState = rngState;
  let landing: LandingChoice | null = null;

  if (moved.cleared) {
    if (source.kind === "supplied" && source.choice != null) {
      invalidState("A move that clears the game has no landing");
    }
  } else {
    const options = landingOptions({ ...state, currentStationId: moved.stationId }, network);
    let choice: LandingChoice | undefined;
    if (source.kind === "seeded") {
      const drawn = drawLanding(options, nextRngState);
      choice = drawn.choice;
      nextRngState = drawn.nextRngState;
    } else {
      if (source.choice === null) invalidState("A move that does not clear needs a landing");
      choice = source.choice;
    }
    const resolved = resolveLandingEvent(options, state.currentServiceId, choice);
    landing = resolved.choice;
    events.push(resolved.event);
  }

  const turn = state.turn + 1;
  const record: MoveRecord = {
    turn,
    roll,
    serviceId: state.currentServiceId,
    direction: state.direction,
    fromStationId: state.currentStationId,
    toStationId: moved.stationId,
    traversedSegmentIds: moved.traversedSegmentIds,
    stopReason: moved.stopReason,
    landing,
  };
  return {
    // Field by field (no spread), so a caller's history can never ride along.
    position: {
      saveVersion: state.saveVersion,
      dataVersion: state.dataVersion,
      status: moved.cleared ? "completed" : "playing",
      config: state.config,
      currentStationId: moved.stationId,
      currentServiceId: landing?.serviceId ?? state.currentServiceId,
      direction: landing?.direction ?? state.direction,
      turn,
      completedSegmentIds: moved.completedSegmentIds,
      rngSeed: state.rngSeed,
      rngState: nextRngState,
    },
    record,
    events,
    roll,
    stopReason: moved.stopReason,
    unusedPips: moved.unusedPips,
  };
}

function toMoveResult(turn: ComputedTurn, history: readonly MoveRecord[]): MoveResult {
  return {
    state: { ...turn.position, movementHistory: [...history, turn.record] },
    events: turn.events,
    roll: turn.roll,
    stopReason: turn.stopReason,
    unusedPips: turn.unusedPips,
  };
}

/**
 * Move `roll` stations along the current service and direction (stopping
 * early at the goal or an endpoint), then settle the landing with the
 * supplied choice. Does not touch `rngState`.
 *
 * `landing`: omit it (or pass `undefined`) when the outcome is forced or the
 * move clears the game; pass a choice for a real lottery; pass `null` only
 * for a clearing move (as recorded in history).
 *
 * @throws GameEngineError `INVALID_ROLL`, `GAME_NOT_PLAYING`, `INVALID_STATE`
 *   (unsettled position, missing segment, missing/illegal landing choice)
 */
export function moveByRoll(
  state: GameState,
  roll: number,
  network: RailwayNetwork,
  landing?: LandingChoice | null,
): MoveResult {
  const turn = computeTurn(state, roll, state.rngState, network, {
    kind: "supplied",
    choice: landing,
  });
  return toMoveResult(turn, state.movementHistory);
}

/**
 * Seeded turn: roll the die, advance, draw the landing (service draw iff
 * k >= 2, then direction draw iff two movable directions), settle. The RNG
 * advances only when a turn is actually played.
 *
 * @throws GameEngineError `GAME_NOT_PLAYING`, `INVALID_RNG_STATE`, `INVALID_STATE`
 */
export function playTurn(state: GameState, network: RailwayNetwork): MoveResult {
  return toMoveResult(seededTurn(state, network), state.movementHistory);
}

/** @internal playTurn without appending history (seeded replay). */
export function seededTurn(state: GamePosition, network: RailwayNetwork): ComputedTurn {
  assertPlaying(state);
  const { value, nextRngState } = rollDie(state.rngState);
  return computeTurn(state, value, nextRngState, network, { kind: "seeded" });
}
