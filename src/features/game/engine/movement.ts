// Station-by-station advance for one rolled move (spec 3.2, 3.3, 4.1 step 1;
// design §1). Private to the engine: game.ts wraps it with the landing
// resolution and the move record.

import type {
  GameState,
  SegmentId,
  StationId,
  StopReason,
} from "../../../types/network";
import { GameEngineError } from "./errors";
import { stopsAtGoal, targetSegmentIds } from "./goal";
import { findSegment, nextStationId, type RailwayNetwork } from "./network";
import type { MoveEvent } from "./types";

/** A game state without its history: all a turn needs to read. */
export type GamePosition = Omit<GameState, "movementHistory">;

/** Where a move ends, before the landing is resolved. */
export interface Advance {
  stationId: StationId;
  completedSegmentIds: SegmentId[];
  traversedSegmentIds: SegmentId[];
  /** Hop events, then a goal or endpoint event when the move stopped early. */
  events: MoveEvent[];
  cleared: boolean;
  stopReason: StopReason;
  unusedPips: number;
}

function invalidState(message: string): never {
  throw new GameEngineError("INVALID_STATE", message);
}

/**
 * Reject a playing state that is not "settled": the station must be on the
 * current service, the target service may only be ridden in the target
 * direction, and the current direction must have a next stop (a landing
 * never leaves the player facing off an end).
 */
export function assertSettledPosition(state: GamePosition, network: RailwayNetwork): void {
  const { config, currentServiceId, currentStationId, direction } = state;
  const service = network.servicesById.get(currentServiceId);
  if (!service?.stationIds.includes(currentStationId)) {
    invalidState(`Station ${currentStationId} is not on service ${currentServiceId}`);
  }
  if (direction !== 1 && direction !== -1) invalidState("Direction must be 1 or -1");
  if (currentServiceId === config.targetServiceId && direction !== config.targetDirection) {
    invalidState("The target service is only ridden in the target direction");
  }
  if (nextStationId(network, currentServiceId, currentStationId, direction) === undefined) {
    invalidState(`No next stop from ${currentStationId} on ${currentServiceId}`);
  }
}

/**
 * Move up to `roll` stations along the current service and direction.
 * Stops early when (a) the goal is reached and the arrival policy allows
 * truncation, or (b) there is no next station (terminus or area boundary),
 * discarding the remaining pips. Precedence: goal > endpoint > roll, where
 * `goal` means the move cleared the game (with or without unused pips) and
 * `endpoint` is reported only when pips were discarded: landing exactly on
 * a terminus is an ordinary `roll` stop.
 *
 * The goal predicate's "last step" means the final rolled step
 * (`step === roll`), never "the move ended here": an endpoint truncation at
 * the start station is not an exact stop.
 */
export function advance(state: GamePosition, roll: number, network: RailwayNetwork): Advance {
  const { config, currentServiceId: serviceId, direction } = state;
  const required = targetSegmentIds(config, network);
  const completed = new Set<SegmentId>(state.completedSegmentIds);
  const completedSegmentIds = [...state.completedSegmentIds];
  const traversedSegmentIds: SegmentId[] = [];
  const events: MoveEvent[] = [];
  let stationId: StationId = state.currentStationId;

  for (let step = 1; step <= roll; step += 1) {
    const toStationId = nextStationId(network, serviceId, stationId, direction);
    if (toStationId === undefined) {
      const discardedPips = roll - traversedSegmentIds.length;
      events.push({ type: "endpoint-reached", step: step - 1, stationId, discardedPips });
      return {
        stationId,
        completedSegmentIds,
        traversedSegmentIds,
        events,
        cleared: false,
        stopReason: "endpoint",
        unusedPips: discardedPips,
      };
    }
    const segment = findSegment(network, serviceId, stationId, toStationId);
    if (!segment) invalidState(`No segment ${stationId} -> ${toStationId}`);
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
      events.push({ type: "goal-reached", step, stationId });
      return {
        stationId,
        completedSegmentIds,
        traversedSegmentIds,
        events,
        cleared: true,
        stopReason: "goal",
        unusedPips: roll - step,
      };
    }
  }

  return {
    stationId,
    completedSegmentIds,
    traversedSegmentIds,
    events,
    cleared: false,
    stopReason: "roll",
    unusedPips: 0,
  };
}
