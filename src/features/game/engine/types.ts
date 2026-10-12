import type {
  Direction,
  GameState,
  SegmentId,
  ServiceId,
  StationId,
  StopReason,
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

/**
 * The ridden service has no next stop (terminus or area boundary) while pips
 * remain: the move stops at `stationId` and `discardedPips` are not used.
 * `step` is the number of hops made before stopping.
 */
export interface EndpointReachedEvent {
  type: "endpoint-reached";
  step: number;
  stationId: StationId;
  discardedPips: number;
}

/**
 * The landing resolution at the arrival station (spec 4.1). Emitted last,
 * and only when the move did not clear the game. The `…DrawRequired` flags
 * say whether the rules call for a lottery; an injected `moveByRoll` choice
 * consumes no RNG either way.
 */
export interface LandingResolvedEvent {
  type: "landing-resolved";
  stationId: StationId;
  serviceCandidates: readonly ServiceId[];
  serviceId: ServiceId;
  serviceDrawRequired: boolean;
  directionCandidates: readonly Direction[];
  direction: Direction;
  directionDrawRequired: boolean;
  /** The chosen service differs from the one ridden into the station. */
  changedService: boolean;
}

export type MoveEvent =
  | SegmentTraversedEvent
  | GoalReachedEvent
  | EndpointReachedEvent
  | LandingResolvedEvent;

export interface MoveResult {
  state: GameState;
  /** Ordered events: hops, then goal or endpoint, then the landing resolution. */
  events: MoveEvent[];
  roll: DieFace;
  stopReason: StopReason;
  /** Pips not used because the move stopped early (goal or endpoint; 0 for `roll`). */
  unusedPips: number;
}
