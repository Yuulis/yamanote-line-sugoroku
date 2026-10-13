// Types copied from railway_sugoroku_mvp_spec.md section 5.

/**
 * Records stored in a built RailwayNetwork are immutable by contract, including
 * nested arrays and objects. To edit railway data, build a new network; mutating
 * records in place would leave network indexes and identity-keyed caches stale.
 */

export type StationId = string;
export type ServiceId = string;
export type SegmentId = string;
export type Direction = 1 | -1;

export interface Station {
  id: StationId;
  name: string;
  coordinates: [longitude: number, latitude: number];
  groupId?: string;
}

export type EndpointKind = "terminus" | "area-boundary";

export const SERVICE_KINDS = ["local", "rapid", "special-rapid", "medium-distance"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

interface ServicePatternBase {
  id: ServiceId;
  name: string;
  operator: string;
  /** Shipped data v2 has no kind; the engine treats it as local until the S2 cutover. */
  kind?: ServiceKind;
  stationIds: StationId[]; // order for direction +1
  color: string;
  directionLabels: { forward: string; backward: string };
  platformCoordinates: Record<StationId, [longitude: number, latitude: number]>;
}

export type ServicePattern = ServicePatternBase & (
  | { circular: true; endpoints?: never }
  | { circular: false; endpoints: { first: EndpointKind; last: EndpointKind } }
);

export interface Segment {
  id: SegmentId;
  serviceId: ServiceId;
  from: StationId;
  to: StationId;
  // The map shape lives in a separate GeoJSON, referenced by feature.id
  geometryFeatureId: string;
}

/** Why a move ended: all pips used, goal truncation, or no next station (pips discarded). */
export type StopReason = "roll" | "goal" | "endpoint";

/** The service and direction the next move rides, decided on landing. */
export interface LandingChoice {
  serviceId: ServiceId;
  direction: Direction;
}

export interface MoveRecord {
  turn: number;
  roll: number;
  /** Service and direction ridden during this move (not the landing result). */
  serviceId: ServiceId;
  direction: Direction;
  fromStationId: StationId;
  toStationId: StationId;
  traversedSegmentIds: SegmentId[];
  stopReason: StopReason;
  /** The landing resolution at `toStationId` (forced ones included); null iff the move cleared. */
  landing: LandingChoice | null;
}

export interface ServiceLotteryPolicy {
  kindWeights: Readonly<Record<ServiceKind, number>>;
  target:
    | { kind: "weight"; weight: number }
    | { kind: "share"; numerator: number; denominator: number };
}

export interface DirectionLotteryPolicy {
  towardTargetWeight: number;
}

export interface GameConfig {
  rulesetVersion: string;
  targetServiceId: ServiceId;
  startStationId: StationId;
  targetDirection: Direction;
  goalArrivalPolicy: "truncate-on-target-service" | "exact-stop" | "pass-through";
  serviceLottery: ServiceLotteryPolicy;
  directionLottery: DirectionLotteryPolicy;
}

export interface GameState {
  saveVersion: number;
  dataVersion: string;
  status: "ready" | "playing" | "moving" | "completed";
  config: GameConfig;
  currentStationId: StationId;
  currentServiceId: ServiceId;
  direction: Direction;
  turn: number;
  completedSegmentIds: SegmentId[]; // serialized as an array on save
  movementHistory: MoveRecord[];
  rngSeed: string;
  rngState: string;
}
