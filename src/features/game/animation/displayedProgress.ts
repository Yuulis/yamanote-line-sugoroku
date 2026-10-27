// What the map and the panel show: the committed state, or, while a move is
// animating, the part of it the marker has covered so far. Saving always
// uses the committed state, never this view.

import type { Position } from "../../../types/data";
import type { DeepReadonly, ItemTurnRecord, MoveRecord, StationId } from "../../../types/network";
import { isItemSave, platformPosition, type RailwayNetwork } from "../engine";
import type { GameSession } from "../gameSession";
import type { StepPath } from "./movePath";
import { type AnimationFrame, visibleCompletedSegmentIds } from "./timeline";

export interface DisplayedProgress {
  /** The last station the marker has reached. */
  stationId: StationId;
  position: Position | null;
  completedSegmentIds: readonly string[];
  /** Hops of the current move already shown (0 when idle). */
  stepsCompleted: number;
}

export interface AnimationView {
  fromStationId: StationId;
  steps: readonly StepPath[];
  /** Null until the first frame has been drawn. */
  frame: AnimationFrame | null;
}

/** Only position, progress and the actual riding service are needed by the view. */
export interface ProgressState {
  readonly currentStationId: string;
  readonly currentServiceId: string;
  readonly completedSegmentIds: readonly string[];
  readonly movementHistory?: readonly (Pick<MoveRecord, "serviceId"> | DeepReadonly<ItemTurnRecord>)[];
}

export function sessionProgress(session: GameSession): ProgressState {
  const { game, item, phase } = session;
  if (phase === "resolving" && item?.beforeMove) return item.beforeMove;
  if (!isItemSave(game) || game.pending?.kind !== "discard") return game;
  return { ...game.pending.position, movementHistory: [...game.movementHistory, game.pending.record] };
}

export function displayedProgress(
  game: ProgressState,
  network: RailwayNetwork,
  animation: AnimationView | null,
): DisplayedProgress {
  if (!animation) {
    return {
      stationId: game.currentStationId,
      position: platformPosition(network, game.currentServiceId, game.currentStationId),
      completedSegmentIds: game.completedSegmentIds,
      stepsCompleted: 0,
    };
  }
  const { steps, frame, fromStationId } = animation;
  const stepsCompleted = Math.min(frame?.stepsCompleted ?? 0, steps.length);
  const stationId = steps[stepsCompleted - 1]?.toStationId ?? fromStationId;
  const record = game.movementHistory?.at(-1);
  const ridingServiceId = record && "kind" in record
    ? record.kind === "item-ride" ? record.resolvedRide.serviceId : record.relocation.serviceId
    : record?.serviceId ?? game.currentServiceId;
  return {
    stationId,
    position: frame?.position ?? platformPosition(network, ridingServiceId, stationId),
    completedSegmentIds: visibleCompletedSegmentIds(
      game.completedSegmentIds,
      steps,
      stepsCompleted,
    ),
    stepsCompleted,
  };
}
