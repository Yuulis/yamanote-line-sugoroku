// What the map and the panel show: the committed state, or, while a move is
// animating, the part of it the marker has covered so far. Saving always
// uses the committed state, never this view.

import type { Position } from "../../../types/data";
import type { GameState, StationId } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
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

function stationPosition(network: RailwayNetwork, stationId: StationId): Position | null {
  const coordinates = network.stationsById.get(stationId)?.coordinates;
  return coordinates ? [coordinates[0], coordinates[1]] : null;
}

export function displayedProgress(
  game: GameState,
  network: RailwayNetwork,
  animation: AnimationView | null,
): DisplayedProgress {
  if (!animation) {
    return {
      stationId: game.currentStationId,
      position: stationPosition(network, game.currentStationId),
      completedSegmentIds: game.completedSegmentIds,
      stepsCompleted: 0,
    };
  }
  const { steps, frame, fromStationId } = animation;
  const stepsCompleted = Math.min(frame?.stepsCompleted ?? 0, steps.length);
  const stationId = steps[stepsCompleted - 1]?.toStationId ?? fromStationId;
  return {
    stationId,
    position: frame?.position ?? stationPosition(network, stationId),
    completedSegmentIds: visibleCompletedSegmentIds(
      game.completedSegmentIds,
      steps,
      stepsCompleted,
    ),
    stepsCompleted,
  };
}
