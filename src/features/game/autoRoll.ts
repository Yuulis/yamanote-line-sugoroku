import type { DeepReadonly, ItemTurnRecord } from "../../types/network";
import type { GameSession, LastMove } from "./gameSession";
import type { TurnMomentDisplay } from "./turnMomentPresentation";

export const AUTO_ROLL_GAP_MS = 1_200;

export type AutoRollPickupOutcome = "none" | "stop" | "await-discard" | "discarded-new";

export interface AutoRollSnapshot {
  readonly readyKey: string;
  readonly visible: boolean;
  readonly canRoll: boolean;
  readonly phase: TurnMomentDisplay["phase"];
  readonly decision: TurnMomentDisplay["decision"];
  readonly publishedMove: LastMove | null;
  readonly surfaceOpen: boolean;
  readonly itemDialogOpen: boolean;
  readonly confirmationOpen: boolean;
  readonly draftSelected: boolean;
}

export type AutoRollDisposition =
  | { readonly kind: "off" }
  | { readonly kind: "wait"; readonly reason: "adjust" | "discard" }
  | { readonly kind: "stop"; readonly reason: "hidden" | "pickup" }
  | { readonly kind: "pause"; readonly reason: "presentation" | "surface" | "dialog" | "draft" }
  | { readonly kind: "ready" };

export function autoRollReadyKey(session: GameSession): string {
  return `${session.sessionId}:${session.game.turn}:${session.item?.decisionRevision ?? 0}`;
}

export function autoRollPickupOutcome(
  record: DeepReadonly<ItemTurnRecord> | null | undefined,
): AutoRollPickupOutcome {
  if (!record) return "none";

  const pendingDiscard = record.itemEvents.find((event) => event.type === "pickup-pending-discard");
  if (pendingDiscard) {
    if (record.discardedInstanceId === null) return "await-discard";
    if (record.discardedInstanceId === pendingDiscard.item.id) return "discarded-new";
    return "stop";
  }

  const stopsAutoRoll = record.itemEvents.some((event) =>
    event.type === "pickup-retained" || event.type === "harmful-scheduled" || event.type === "cancelled-by-certificate");
  return stopsAutoRoll ? "stop" : "none";
}

export function autoRollBaseline(publishedMove: LastMove | null): number {
  const record = publishedMove?.itemRecord;
  if (!record) return 0;
  if (autoRollPickupOutcome(record) === "await-discard") return record.turn - 1;
  return record.turn;
}

export function autoRollDisposition(
  snapshot: AutoRollSnapshot,
  enabled: boolean,
  baselinePublishedTurn: number,
): AutoRollDisposition {
  if (!enabled) return { kind: "off" };
  if (!snapshot.visible) return { kind: "stop", reason: "hidden" };

  if (snapshot.decision) return { kind: "wait", reason: snapshot.decision.kind };

  const publishedRecord = snapshot.phase === "published" ? snapshot.publishedMove?.itemRecord : undefined;
  const pickupOutcome = snapshot.phase === "published" ? autoRollPickupOutcome(publishedRecord) : "none";
  if (pickupOutcome === "await-discard") return { kind: "wait", reason: "discard" };
  if (publishedRecord && publishedRecord.turn > baselinePublishedTurn && pickupOutcome === "stop") {
    return { kind: "stop", reason: "pickup" };
  }

  if (!snapshot.canRoll) return { kind: "pause", reason: "presentation" };
  if (snapshot.surfaceOpen) return { kind: "pause", reason: "surface" };
  if (snapshot.itemDialogOpen || snapshot.confirmationOpen) return { kind: "pause", reason: "dialog" };
  if (snapshot.draftSelected) return { kind: "pause", reason: "draft" };
  return { kind: "ready" };
}
