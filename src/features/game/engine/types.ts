import type {
  Direction,
  GameState,
  SegmentId,
  ServiceId,
  StationId,
} from "../../../types/network";
import type { DieFace } from "./rng";

/** One station-to-station hop, in travel order (`step` starts at 1). */
export interface SegmentTraversedEvent {
  type: "segment-traversed";
  step: number;
  serviceId: ServiceId;
  direction: Direction;
  segmentId: SegmentId;
  fromStationId: StationId;
  toStationId: StationId;
  /** True the first time this segment enters the completed set. */
  newlyCompleted: boolean;
}

/** Emitted right after the segment event that reached the goal. */
export interface GoalReachedEvent {
  type: "goal-reached";
  step: number;
  stationId: StationId;
}

export type MoveEvent = SegmentTraversedEvent | GoalReachedEvent;

export interface MoveResult {
  state: GameState;
  /** Ordered per-step events, usable to drive a per-segment animation. */
  events: MoveEvent[];
  roll: DieFace;
  /** Pips discarded because the goal was reached mid-move (0 otherwise). */
  unusedPips: number;
}
