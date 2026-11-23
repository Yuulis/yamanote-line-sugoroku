// Presentation-only formatter: one structured row per saved turn. The clear screen's history dialog renders it
// and the replay captions reuse the same typed rows. It reads saved records only and never re-resolves a turn.
import type { GameState, ItemGameState } from "../../types/network";
import { earlyStopNote, endpointKindAt } from "./gameSummary";
import { itemLastMove } from "./itemSession";
import {
  directionLabel, itemEventTexts, landingText, landingTransitionText, lastRollText, serviceName,
} from "./presentation";
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
  /** Saved turn number; unique within one history. */
  readonly turn: number;
  /** `12ターン目` */
  readonly turnText: string;
  /** `出目4`, an item roll with its pips and hops, or `回送（サイコロなし）`. */
  readonly rollText: string;
  /** `永田町 → 半蔵門`, resolved for the line that was ridden. */
  readonly moveText: string;
  /** `半蔵門線・押上方面`; null for a deadhead, which rides no line. */
  readonly lineText: string | null;
  /** Transfer, truncation, landing, goal and item remarks, in the order they happened. */
  readonly notes: readonly HistoryNote[];
}

const ITEM_LABEL = "アイテム";
const TRUNCATION_LABEL = "途中で停止";
const LANDING_LABEL = "到着";
const GOAL_TEXT = "ゴールに到着しました";
const SUSPENSION_IGNORED_TEXT = "この駅では候補がすべて運休のため、運休を無視して抽選しました";

function endpointNames(
  serviceId: string, fromStationId: string, toStationId: string, presentation: PresentationResolver,
): string {
  return `${presentation.serviceStationName(serviceId, fromStationId)} → ${presentation.serviceStationName(serviceId, toStationId)}`;
}

function classicRow(
  record: Extract<HistoryRecord, { roll: number }>, network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow {
  const notes: HistoryNote[] = [];
  const transition = landingTransitionText(record, network, presentation);
  if (transition) notes.push({ kind: "transfer", label: null, text: transition });
  const truncation = earlyStopNote(
    record,
    (id) => presentation.serviceStationName(record.serviceId, id),
    endpointKindAt(network, record.serviceId, record.toStationId),
  );
  if (truncation !== null) notes.push({ kind: "truncation", label: TRUNCATION_LABEL, text: truncation });
  return {
    turn: record.turn,
    turnText: `${record.turn}ターン目`,
    rollText: `出目${record.roll}`,
    moveText: endpointNames(record.serviceId, record.fromStationId, record.toStationId, presentation),
    lineText: `${serviceName(network, record.serviceId, presentation)}・${directionLabel(network, record.serviceId, record.direction)}`,
    notes,
  };
}

function itemRow(
  record: Extract<HistoryRecord, { kind: string }>, network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow {
  const move = itemLastMove(record, network);
  if (move === null) throw new Error(`Saved item record for turn ${record.turn} has no movement`);
  const isDeadhead = record.kind === "deadhead";
  const notes: HistoryNote[] = [];
  if (isDeadhead) {
    notes.push({ kind: "landing", label: null, text: landingText(move, network, presentation) });
  } else if (record.landing) {
    notes.push({ kind: "landing", label: LANDING_LABEL, text: landingText(move, network, presentation) });
  }
  if (!record.landing && record.stopReason === "goal") notes.push({ kind: "goal", label: null, text: GOAL_TEXT });
  for (const text of itemEventTexts(record.itemEvents, record.turn, network, presentation)) {
    notes.push({ kind: "item", label: ITEM_LABEL, text });
  }
  if (record.landingSnapshot?.suspensionIgnored) {
    notes.push({ kind: "suspension", label: null, text: SUSPENSION_IGNORED_TEXT });
  }
  return {
    turn: record.turn,
    turnText: `${record.turn}ターン目`,
    rollText: isDeadhead ? lastRollText(move, network, presentation) : `出目${lastRollText(move, network, presentation)}`,
    moveText: endpointNames(move.serviceId, record.fromStationId, record.toStationId, presentation),
    lineText: isDeadhead
      ? null
      : `${serviceName(network, move.serviceId, presentation)}・${directionLabel(network, move.serviceId, move.direction)}`,
    notes,
  };
}

/** Build the structured row for one saved turn (classic and item saves). */
export function buildHistoryRow(
  record: HistoryRecord, network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow {
  return "kind" in record ? itemRow(record, network, presentation) : classicRow(record, network, presentation);
}

/** One row per saved turn, in saved order. */
export function buildHistoryRows(
  records: readonly HistoryRecord[], network: RailwayNetwork, presentation: PresentationResolver,
): HistoryRow[] {
  return records.map((record) => buildHistoryRow(record, network, presentation));
}
