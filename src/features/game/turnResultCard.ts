import type { DeepReadonly, ItemKind, ItemTurnRecord, MoveRecord } from "../../types/network";
import type { LastMove } from "./gameSession";
import { directionLabel, serviceName } from "./presentation";
import { lineBadgeFor, type LineBadgeModel } from "./lineBadge";
import type { RailwayNetwork } from "./engine";
import type { PresentationResolver } from "./presentationResolver";
export type TurnResultRecord = DeepReadonly<MoveRecord | ItemTurnRecord>;

interface TurnResultChipBase {
  readonly key: string;
  readonly label: string;
  readonly text: string;
}

export type TurnResultChip =
  | (TurnResultChipBase & { readonly kind: "segments"; readonly count: number })
  | (TurnResultChipBase & { readonly kind: "transfer"; readonly count: number })
  | (TurnResultChipBase & { readonly kind: "pickup"; readonly itemKind: ItemKind; readonly outcome: "retained" | "pending-discard" | "harmful" | "cancelled" })
  | (TurnResultChipBase & { readonly kind: "effect"; readonly itemKind: ItemKind; readonly outcome: "consumed" | "activated" });

export interface TurnResultRide {
  readonly prefix: "抽選" | "乗車"; readonly serviceName: string;
  readonly directionText: string; readonly lineBadge: LineBadgeModel; readonly text: string;
}

export interface TurnResultCompact {
  readonly faceText: string; readonly stationText: string; readonly segmentsText: string | null;
  readonly text: string; readonly accessibleName: string;
}

export interface TurnResultModel {
  readonly key: string; readonly turn: number; readonly heading: string; readonly rollText: string;
  readonly arrivalStation: string; readonly moveText: string; readonly ride: TurnResultRide;
  readonly chips: readonly TurnResultChip[]; readonly compact: TurnResultCompact;
}

export interface TurnResultInput {
  readonly sessionId: number; readonly turn: number; readonly move: LastMove | null;
  readonly records: readonly TurnResultRecord[]; readonly targetSegmentIds: readonly string[];
  readonly initialServiceId: string; readonly itemsPublished: boolean;
  readonly network: RailwayNetwork; readonly presentation: PresentationResolver;
}

export interface TurnResultHistoryFacts { readonly newTargetSegmentCount: number; readonly transferCount: number }

const UNKNOWN_SERVICE = "路線不明";
const UNKNOWN_DIRECTION = "方向不明";
export function turnResultRollText(move: LastMove): string {
  return move.roll === null ? "回送" : `出目${move.roll}`;
}

export function turnResultFaceText(move: LastMove): string {
  return move.roll === null ? "回送" : String(move.roll);
}
export function shortTurnResultRide(
  move: LastMove,
  network: RailwayNetwork,
  presentation: PresentationResolver,
): TurnResultRide {
  const landing = move.landing;
  const serviceId = landing?.serviceId ?? move.serviceId;
  const direction = landing?.direction ?? move.direction;
  const service = network.servicesById.get(serviceId);
  const resolvedServiceName = service ? serviceName(network, serviceId, presentation) : UNKNOWN_SERVICE;
  const directionMetadata = direction === 1 ? service?.directionLabels?.forward : service?.directionLabels?.backward;
  const resolvedDirection = directionMetadata && directionMetadata !== String(direction)
    ? directionLabel(network, serviceId, direction) : UNKNOWN_DIRECTION;
  const prefix = landing?.serviceDrawRequired || landing?.directionDrawRequired ? "抽選" : "乗車";
  const lineBadge = service
    ? lineBadgeFor(serviceId, presentation, service.color)
    : { groupId: "", code: null, color: null, name: UNKNOWN_SERVICE, textColor: null };
  const text = `${prefix}: ${resolvedServiceName}・${resolvedDirection}`;
  return { prefix, serviceName: resolvedServiceName, directionText: resolvedDirection, lineBadge, text };
}
