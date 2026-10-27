// Types copied from railway_sugoroku_mvp_spec.md section 5.

/**
 * Records stored in a built RailwayNetwork are immutable by contract, including
 * nested arrays and objects. To edit railway data, build a new network; mutating
 * records in place would leave network indexes and identity-keyed caches stale.
 */

export type NonEmptyArray<T> = [T, ...T[]];
export type LineId = string;
export interface LineMetadata { id: LineId; name: string; color: string }
export interface ServicesData { lines: LineMetadata[]; services: ServicePattern[] }

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

export type EndpointKind = "terminus" | "area-boundary" | "service-boundary";

export const SERVICE_KINDS = ["local", "rapid"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

interface ServicePatternBase {
  id: ServiceId;
  name: string;
  operator: string;
  kind: ServiceKind;
  lineIds: NonEmptyArray<LineId>;
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
  geometryFeatureIds: NonEmptyArray<string>;
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
  awayFromTargetWeight?: number;
}

export const BENEFICIAL_ITEM_KINDS = [
  "route-ticket", "direction-ticket", "roll-adjust", "double", "rapid", "deadhead", "delay-certificate",
] as const;
export const HARMFUL_ITEM_KINDS = ["delay", "suspension", "detour", "oversleep"] as const;
export type BeneficialItemKind = (typeof BENEFICIAL_ITEM_KINDS)[number];
export type HarmfulItemKind = (typeof HARMFUL_ITEM_KINDS)[number];
export type ItemKind = BeneficialItemKind | HarmfulItemKind;

/** One inventory slot. IDs are deterministic within a turn history. */
export interface ItemInstance {
  id: string;
  kind: ItemKind;
}

/** JSON-safe harmful-effect state consumed by the item turn kernel. */
export interface ItemEffectsState {
  delayDueTurns: readonly number[];
  suspensions: readonly { serviceId: ServiceId; expiresTurn: number }[];
  detourPending: boolean;
  oversleepPending: boolean;
}

export type ItemEvent =
  | { type: "pickup-retained"; item: ItemInstance }
  | { type: "pickup-pending-discard"; item: ItemInstance; candidates: readonly ItemInstance[] }
  | { type: "discarded"; item: ItemInstance }
  | { type: "harmful-scheduled"; item: HarmfulItemKind; effect: "delay"; dueTurn: number }
  | { type: "harmful-scheduled"; item: HarmfulItemKind; effect: "suspension"; serviceId: ServiceId; expiresTurn: number }
  | { type: "harmful-scheduled"; item: HarmfulItemKind; effect: "detour" | "oversleep" }
  | { type: "cancelled-by-certificate"; item: HarmfulItemKind; certificate: ItemInstance }
  | { type: "consumed"; item: ItemInstance };

export interface ItemPolicy {
  dropChancePerMille: number;
  harmfulChancePercent: number;
  inventoryCapacity: number;
  maxActiveItemsPerTurn: number;
  delayTurns: number;
  suspensionTurns: number;
  fullInventoryPolicy: "player-chooses-discard";
  beneficialKinds: readonly BeneficialItemKind[];
  harmfulKinds: readonly HarmfulItemKind[];
}

export interface GameConfig {
  rulesetVersion: string;
  targetServiceId: ServiceId;
  startStationId: StationId;
  targetDirection: Direction;
  goalArrivalPolicy: "truncate-on-target-service" | "exact-stop" | "pass-through";
  serviceLottery: ServiceLotteryPolicy;
  directionLottery: DirectionLotteryPolicy;
  itemPolicy?: ItemPolicy;
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
