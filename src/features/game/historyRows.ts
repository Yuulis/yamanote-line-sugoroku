// Presentation-only formatter: one structured row per saved turn. The clear screen's history dialog renders it
// and the replay captions reuse the same typed rows. It reads saved records only and never re-resolves a turn.
import type { Direction, GameState, ItemGameState, ItemKind } from "../../types/network";
import { endpointKindAt, endpointKindLabel } from "./gameSummary";
import { itemLastMove } from "./itemSession";
import {
  directionLabel, itemEventTexts, landingText, landingTransitionText, serviceName,
} from "./presentation";
import { ITEM_SHORT_NAMES } from "./itemPresentation";
import { isRollAdjustKind } from "./itemRollAdjust";
import type { PresentationResolver } from "./presentationResolver";
import type { RailwayNetwork } from "./engine";

export type HistoryRecord = (GameState | ItemGameState)["movementHistory"][number];

export type HistoryNoteKind = "transfer" | "truncation" | "landing" | "goal" | "item" | "suspension";

export interface HistoryNote {
  readonly kind: HistoryNoteKind;
  /** Short heading shown before the text, or null when the text reads on its own. */
  readonly label: string | null;
  readonly text: string;
}

export interface HistoryRow {
  readonly kind: "ride" | "item-ride" | "deadhead";
  /** Index in the saved movement history; captions and map turn spans use the same index. */
  readonly recordIndex: number;
  /** Saved turn number; unique within one history. */
  readonly turn: number;
  /** `12ターン目` */
  readonly turnText: string;
  readonly rawRoll: number | null;
  readonly effectiveRoll: number | null;
  readonly adjusted: boolean;
  /** Item kinds consumed on this turn; roll-adjust is also exposed by `adjusted`. */
  readonly effectKinds: readonly ItemKind[];
  readonly effectText: string;
  readonly fromStationName: string;
  readonly toStationName: string;
  readonly hopCount: number;
  readonly lineName: string | null;
  readonly directionText: string | null;
  /** Short roll form shared by the dialog and map caption. */
  readonly rollText: string;
  /** `永田町 → 半蔵門（3駅）`, resolved for the line that was ridden. */
  readonly moveText: string;
  /** `半蔵門線・押上方面`; null for a deadhead, which rides no line. */
  readonly lineText: string | null;
  /** Transfer, truncation, landing, goal and item remarks, in the order they happened. */
  readonly notes: readonly HistoryNote[];
}

const ITEM_LABEL = "アイテム";
const TRUNCATION_LABEL = "途中停止";
const LANDING_LABEL = "到着";
const GOAL_TEXT = "ゴールに到着しました";
const SUSPENSION_IGNORED_TEXT = "この駅では候補がすべて運休のため、運休を無視して抽選しました";

function endpointNames(
  serviceId: string, fromStationId: string, toStationId: string, presentation: PresentationResolver,
): string {
  return `${presentation.serviceStationName(serviceId, fromStationId)} → ${presentation.serviceStationName(serviceId, toStationId)}`;
}

function consumedEffectKinds(record: Extract<HistoryRecord, { kind: string }>): ItemKind[] {
  const seen = new Set<string>();
  return record.itemEvents.flatMap((event) => {
    if (event.type !== "consumed" || seen.has(event.item.id)) return [];
    seen.add(event.item.id);
    return [event.item.kind];
  });
}

function shortRollText(
  kind: HistoryRow["kind"], rawRoll: number | null, effectiveRoll: number | null,
  adjusted: boolean, effects: readonly ItemKind[],
): string {
  if (kind === "deadhead") return "回送";
  const roll = rawRoll === null || effectiveRoll === null
    ? "—"
    : adjusted ? `出目${rawRoll}→${effectiveRoll}` : `出目${rawRoll}`;
  const names = effects.filter((effect) => !isRollAdjustKind(effect)).map((effect) => ITEM_SHORT_NAMES[effect]);
  return names.length > 0 ? `${roll}・${names.join("・")}` : roll;
}

function truncationText(
  stationName: string, unusedPips: number, stopReason: "roll" | "goal" | "endpoint", endpoint: string | null,
): string | null {
  if (unusedPips <= 0 || stopReason === "roll") return null;
  const endpointText = stopReason === "endpoint" && endpoint !== null ? `〔${endpoint}〕` : "";
  return `${stationName}で終了${endpointText}、残り${unusedPips}を使わず`;
}

function lineFields(
  network: RailwayNetwork, serviceId: string, direction: Direction, presentation: PresentationResolver,
): { lineName: string; directionText: string; lineText: string } {
  const lineName = serviceName(network, serviceId, presentation);
  const directionText = directionLabel(network, serviceId, direction);
  return { lineName, directionText, lineText: `${lineName}・${directionText}` };
}

function classicRow(
  record: Extract<HistoryRecord, { roll: number }>, recordIndex: number,
  network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow {
  const notes: HistoryNote[] = [];
  const transition = landingTransitionText(record, network, presentation);
  if (transition) notes.push({ kind: "transfer", label: null, text: transition });
  const station = presentation.serviceStationName(record.serviceId, record.toStationId);
  const endpointKind = endpointKindAt(network, record.serviceId, record.toStationId);
  const truncation = truncationText(station, record.roll - record.traversedSegmentIds.length, record.stopReason,
    endpointKind === null ? null : endpointKindLabel(endpointKind));
  if (truncation !== null) notes.push({ kind: "truncation", label: TRUNCATION_LABEL, text: truncation });
  const line = lineFields(network, record.serviceId, record.direction, presentation);
  const fromStationName = presentation.serviceStationName(record.serviceId, record.fromStationId);
  const toStationName = presentation.serviceStationName(record.serviceId, record.toStationId);
  const effectKinds: ItemKind[] = [];
  return {
    kind: "ride",
    recordIndex,
    turn: record.turn,
    turnText: `${record.turn}ターン目`,
    rawRoll: record.roll,
    effectiveRoll: record.roll,
    adjusted: false,
    effectKinds,
    effectText: "",
    fromStationName,
    toStationName,
    hopCount: record.traversedSegmentIds.length,
    lineName: line.lineName,
    directionText: line.directionText,
    rollText: shortRollText("ride", record.roll, record.roll, false, effectKinds),
    moveText: `${endpointNames(record.serviceId, record.fromStationId, record.toStationId, presentation)}（${record.traversedSegmentIds.length}駅）`,
    lineText: line.lineText,
    notes,
  };
}

function itemRow(
  record: Extract<HistoryRecord, { kind: string }>, recordIndex: number,
  network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow {
  const move = itemLastMove(record, network);
  if (move === null) throw new Error(`Saved item record for turn ${record.turn} has no movement`);
  const isDeadhead = record.kind === "deadhead";
  const effectKinds = consumedEffectKinds(record);
  const toStationName = presentation.serviceStationName(move.serviceId, record.toStationId);
  const notes: HistoryNote[] = [];
  if (isDeadhead) {
    notes.push({ kind: "landing", label: null, text: landingText(move, network, presentation) });
  } else if (record.landing) {
    notes.push({ kind: "landing", label: LANDING_LABEL, text: landingText(move, network, presentation) });
  }
  if (!isDeadhead) {
    const endpointKind = endpointKindAt(network, move.serviceId, record.toStationId);
    const truncation = truncationText(toStationName, record.unusedPips, record.stopReason,
      endpointKind === null ? null : endpointKindLabel(endpointKind));
    if (truncation !== null) notes.push({ kind: "truncation", label: TRUNCATION_LABEL, text: truncation });
  }
  if (!record.landing && record.stopReason === "goal") notes.push({ kind: "goal", label: null, text: GOAL_TEXT });
  for (const text of itemEventTexts(record.itemEvents, record.turn, network, presentation)) {
    notes.push({ kind: "item", label: ITEM_LABEL, text });
  }
  if (record.landingSnapshot?.suspensionIgnored) {
    notes.push({ kind: "suspension", label: null, text: SUSPENSION_IGNORED_TEXT });
  }
  const line = isDeadhead ? null : lineFields(network, move.serviceId, move.direction, presentation);
  const fromStationName = presentation.serviceStationName(move.serviceId, record.fromStationId);
  const rawRoll = isDeadhead ? null : record.rawRoll;
  const effectiveRoll = isDeadhead ? null : record.effectiveFace;
  const adjusted = !isDeadhead && record.adjustment !== null;
  const effectText = effectKinds.filter((effect) => !isRollAdjustKind(effect)).map((effect) => ITEM_SHORT_NAMES[effect]).join("・");
  return {
    kind: isDeadhead ? "deadhead" : "item-ride",
    recordIndex,
    turn: record.turn,
    turnText: `${record.turn}ターン目`,
    rawRoll,
    effectiveRoll,
    adjusted,
    effectKinds,
    effectText,
    fromStationName,
    toStationName,
    hopCount: record.traversedSegmentIds.length,
    lineName: line?.lineName ?? null,
    directionText: line?.directionText ?? null,
    rollText: shortRollText(isDeadhead ? "deadhead" : "item-ride", rawRoll, effectiveRoll, adjusted, effectKinds),
    moveText: `${endpointNames(move.serviceId, record.fromStationId, record.toStationId, presentation)}（${record.traversedSegmentIds.length}駅）`,
    lineText: line?.lineText ?? null,
    notes,
  };
}

/** Build the structured row for one saved turn (classic and item saves). */
export function buildHistoryRow(
  record: HistoryRecord, network: RailwayNetwork, presentation: PresentationResolver, recordIndex = 0,
): HistoryRow {
  return "kind" in record
    ? itemRow(record, recordIndex, network, presentation)
    : classicRow(record, recordIndex, network, presentation);
}

/** One row per saved turn, in saved order. */
export function buildHistoryRows(
  records: readonly HistoryRecord[], network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow[] {
  return records.map((record, recordIndex) => buildHistoryRow(record, network, presentation, recordIndex));
}
