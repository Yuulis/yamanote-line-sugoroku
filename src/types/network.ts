// Types copied from railway_sugoroku_mvp_spec.md section 5.

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

export interface ServicePattern {
  id: ServiceId;
  name: string;
  operator: string;
  stationIds: StationId[]; // order for direction +1
  circular: boolean;
  color: string;
}

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

export interface GameConfig {
  rulesetVersion: string;
  targetServiceId: ServiceId;
  startStationId: StationId;
  targetDirection: Direction;
  goalArrivalPolicy: "truncate-on-target-service" | "exact-stop" | "pass-through";
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
