import type { DeepReadonly, ItemEvent, ItemKind, ItemTurnRecord, MoveRecord, PendingItemTurn } from "../../types/network";
import type { LastMove } from "./gameSession";
import { directionLabel, itemEventTexts, serviceName } from "./presentation";
import { ITEM_DESCRIPTIONS } from "./itemPresentation";
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
  readonly pending?: DeepReadonly<PendingItemTurn> | null;
}

export interface TurnResultHistoryFacts { readonly newTargetSegmentCount: number; readonly transferCount: number }

const UNKNOWN_SERVICE = "路線不明";
const UNKNOWN_DIRECTION = "方向不明";
const UNKNOWN_STATION = "駅不明";
export function turnResultRollText(move: LastMove): string {
  return move.roll === null ? "回送" : `出目${move.roll}`;
}

export function turnResultFaceText(move: LastMove): string {
  return move.roll === null ? "回送" : String(move.roll);
}

export function normalizeTurnResultRecords(
  movementHistory: readonly TurnResultRecord[],
  pending: DeepReadonly<PendingItemTurn> | null = null,
): readonly TurnResultRecord[] {
  const records = [...movementHistory];
  if (pending?.kind === "discard" && !records.some((record) => record.turn === pending.record.turn)) records.push(pending.record);
  return records.sort((first, second) => first.turn - second.turn);
}

export function replayTurnResultHistory(
  records: readonly TurnResultRecord[],
  turn: number,
  targetSegmentIds: readonly string[],
  initialServiceId: string,
  presentation: PresentationResolver,
): TurnResultHistoryFacts {
  const targets = new Set(targetSegmentIds);
  const seen = new Set<string>();
  let newTargetSegmentCount = 0;
  let transferCount = 0;
  let previousServiceId = initialServiceId;
  const chronologicalRecords = [...records].sort((first, second) => first.turn - second.turn);

  for (const record of chronologicalRecords) {
    if (record.turn > turn) break;
    for (const segmentId of record.traversedSegmentIds) {
      const unseen = !seen.has(segmentId);
      seen.add(segmentId);
      if (record.turn === turn && unseen && targets.has(segmentId)) newTargetSegmentCount += 1;
    }

    const riddenServiceId = "kind" in record
      ? record.kind === "deadhead" ? record.relocation.serviceId : record.resolvedRide.serviceId
      : record.serviceId;
    if (record.turn === turn && previousServiceId !== riddenServiceId &&
      !presentation.sameLineGroup(previousServiceId, riddenServiceId)) transferCount += 1;
    const landingServiceId = record.landing?.serviceId;
    if (landingServiceId && record.turn === turn && riddenServiceId !== landingServiceId &&
      !presentation.sameLineGroup(riddenServiceId, landingServiceId)) transferCount += 1;
    previousServiceId = landingServiceId ?? riddenServiceId;
  }

  return { newTargetSegmentCount, transferCount };
}

/** Progress and transfer chips for the selected turn; zero counts are omitted. */
export function turnResultHistoryChips(turn: number, facts: TurnResultHistoryFacts): readonly TurnResultChip[] {
  const segments = facts.newTargetSegmentCount;
  const transfers = facts.transferCount;
  const segmentChips: TurnResultChip[] = segments > 0
    ? [{ kind: "segments", count: segments, key: `${turn}:segments`, label: `+${segments}区間`,
      text: `このターンで目標区間を${segments}区間はじめて通過` }]
    : [];
  const transferChips: TurnResultChip[] = transfers > 0
    ? [{ kind: "transfer", count: transfers, key: `${turn}:transfer`, label: "乗換",
      text: `このターンで${transfers}回乗り換え` }]
    : [];
  return [...segmentChips, ...transferChips];
}

const PENDING_PICKUP_SUFFIX = "（選択待ち）";
const CANCELLED_PICKUP_SUFFIX = "（打ち消し）";
const ROLL_ADJUST_LABEL = "出目調整";

interface ItemChipContext {
  readonly move: LastMove; readonly turn: number;
  readonly network: RailwayNetwork; readonly presentation: PresentationResolver;
}

/** `itemEventTexts` emits one text per single chip-producing event; the label is a visible, never-empty fallback. */
function verifiedEventText(event: DeepReadonly<ItemEvent>, label: string, context: ItemChipContext): string {
  return itemEventTexts([event], context.turn, context.network, context.presentation)[0] ?? label;
}

/** Signed label and raw → effective text; null when the record lacks adjustment metadata. */
function rollAdjustWording(move: LastMove): { readonly label: string; readonly text: string } | null {
  const record = move.itemRecord;
  if (record?.kind !== "item-ride" || !record.adjustment) return null;
  const sign = record.adjustment.delta > 0 ? "+" : "-";
  return {
    label: `${ROLL_ADJUST_LABEL} ${sign}${Math.abs(record.adjustment.delta)}`,
    text: `${ITEM_DESCRIPTIONS["roll-adjust"].name}を使いました（出目${record.rawRoll} → ${record.effectiveFace}）`,
  };
}

function itemEventChip(
  event: DeepReadonly<ItemEvent>, index: number, context: ItemChipContext, pickedIds: Set<string>,
): TurnResultChip | null {
  const key = `${context.turn}:${event.type}`;
  switch (event.type) {
    case "pickup-retained":
    case "pickup-pending-discard": {
      if (pickedIds.has(event.item.id)) return null;
      pickedIds.add(event.item.id);
      const pending = event.type === "pickup-pending-discard";
      const label = `${ITEM_DESCRIPTIONS[event.item.kind].name}${pending ? PENDING_PICKUP_SUFFIX : ""}`;
      return { kind: "pickup", outcome: pending ? "pending-discard" : "retained", itemKind: event.item.kind,
        key: `${key}:${event.item.id}`, label, text: verifiedEventText(event, label, context) };
    }
    case "harmful-scheduled": {
      const label = ITEM_DESCRIPTIONS[event.item].name;
      return { kind: "pickup", outcome: "harmful", itemKind: event.item,
        key: `${key}:${event.effect}:${index}`, label, text: verifiedEventText(event, label, context) };
    }
    case "cancelled-by-certificate": {
      const label = `${ITEM_DESCRIPTIONS[event.item].name}${CANCELLED_PICKUP_SUFFIX}`;
      return { kind: "pickup", outcome: "cancelled", itemKind: event.item,
        key: `${key}:${event.certificate.id}`, label, text: verifiedEventText(event, label, context) };
    }
    case "consumed": {
      const label = ITEM_DESCRIPTIONS[event.item.kind].name;
      const adjusted = event.item.kind === "roll-adjust" ? rollAdjustWording(context.move) : null;
      return { kind: "effect", outcome: "consumed", itemKind: event.item.kind, key: `${key}:${event.item.id}`,
        label: adjusted?.label ?? label, text: adjusted?.text ?? verifiedEventText(event, label, context) };
    }
    case "effect-activated": {
      const label = ITEM_DESCRIPTIONS[event.effect].name;
      return { kind: "effect", outcome: "activated", itemKind: event.effect,
        key: `${key}:${event.effect}:${index}`, label, text: verifiedEventText(event, label, context) };
    }
    case "discarded":
    case "effect-expired":
      return null;
  }
}

/** Item outcomes from this selected move only; inventory is never consulted. */
export function turnResultItemChips(
  move: LastMove, turn: number, network: RailwayNetwork, presentation: PresentationResolver,
): readonly TurnResultChip[] {
  if (!move.itemRecord) return [];
  const context: ItemChipContext = { move, turn, network, presentation };
  const pickedIds = new Set<string>();
  return move.itemRecord.itemEvents.flatMap((event, index) => itemEventChip(event, index, context, pickedIds) ?? []);
}

/** Phone pill / short-landscape content; never truncated in data. */
export function turnResultCompact(
  heading: string, faceText: string, stationText: string, newTargetSegmentCount: number,
): TurnResultCompact {
  const segmentsText = newTargetSegmentCount >= 1 ? `+${newTargetSegmentCount}区間` : null;
  const text = segmentsText ? `${faceText} → ${stationText} ${segmentsText}` : `${faceText} → ${stationText}`;
  return { faceText, stationText, segmentsText, text, accessibleName: `${heading}：${text}` };
}

export function deriveTurnResult(input: TurnResultInput): TurnResultModel | null {
  const { move, turn, network, presentation } = input;
  if (!move || turn <= 0) return null;
  const heading = `前のターン（${turn}ターン目）`;
  const arrivalStation = network.stationsById.has(move.stopStationId)
    ? presentation.stationName(move.stopStationId) : UNKNOWN_STATION;
  const records = normalizeTurnResultRecords(input.records, input.pending ?? null);
  const facts = replayTurnResultHistory(records, turn, input.targetSegmentIds, input.initialServiceId, presentation);
  const itemChips = input.itemsPublished ? turnResultItemChips(move, turn, network, presentation) : [];
  const rollText = turnResultRollText(move);
  return {
    key: `${input.sessionId}:turn:${turn}`, turn, heading, rollText, arrivalStation,
    moveText: `${rollText} → ${arrivalStation}`,
    ride: shortTurnResultRide(move, network, presentation),
    chips: [...turnResultHistoryChips(turn, facts), ...itemChips],
    compact: turnResultCompact(heading, turnResultFaceText(move), arrivalStation, facts.newTargetSegmentCount),
  };
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
