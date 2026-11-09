import type { DeepReadonly, ItemTurnRecord } from "../../types/network";
import type { GameSession, LastMove } from "./gameSession";
import type { TurnMomentDisplay } from "./turnMomentPresentation";

export const AUTO_ROLL_GAP_MS = 1_200;
const AUTO_ROLL_DIALOG_RECHECK_MS = 100;
const AUTO_ROLL_MAX_DIALOG_RECHECKS = 12;

function modalDialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector("dialog[open]") !== null;
}

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

export type AutoRollStopReason = "manual" | "hidden" | "pickup";

export interface AutoRollAnnouncementState {
  readonly kind: "off" | "start" | "summary" | "draft" | "pickup-stop-pending" | "stop" | "released";
  readonly text: string;
  readonly publicationKey: string | null;
  readonly stopReason: AutoRollStopReason | null;
}

export interface AutoRollAnnouncementInput {
  readonly state: AutoRollAnnouncementState;
  readonly enabled: boolean;
  readonly disposition: AutoRollDisposition;
  readonly displayAnnouncement: string;
  readonly summaryTurn: number | null;
  readonly publicationKey: string | null;
}

export const AUTO_ROLL_ANNOUNCEMENTS = {
  started: "おまかせで進みます。",
  stopped: "おまかせを止めました。",
  hidden: "タブが非表示になったため、おまかせを止めました。",
  pickup: "アイテムを拾ったため、おまかせを止めました。",
  draft: "アイテムを選択中です。手動で振るか、選択を解除してください。",
} as const;

export function selectAutoRollAnnouncement(input: AutoRollAnnouncementInput): string {
  const { state, enabled, disposition, displayAnnouncement, summaryTurn, publicationKey } = input;
  const summaryReady = summaryTurn !== null && publicationKey !== null;

  if (state.kind === "off") return displayAnnouncement;
  if (state.kind === "released") return enabled ? "" : displayAnnouncement;
  if (state.kind === "stop") return state.text;
  if (state.kind === "pickup-stop-pending") {
    return summaryReady && publicationKey === state.publicationKey
      ? `${AUTO_ROLL_ANNOUNCEMENTS.pickup} ${displayAnnouncement}` : state.text;
  }
  if (enabled && disposition.kind === "stop" && disposition.reason === "pickup") {
    return summaryReady ? `${AUTO_ROLL_ANNOUNCEMENTS.pickup} ${displayAnnouncement}` : state.text;
  }
  if (enabled && summaryReady && publicationKey !== state.publicationKey) return displayAnnouncement;
  if (enabled && disposition.kind === "pause" && disposition.reason === "draft") return AUTO_ROLL_ANNOUNCEMENTS.draft;
  if (enabled && state.kind === "draft") return "";
  return state.text;
}

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

export interface AutoRollTimerOptions {
  readonly readyKey: string;
  readonly isMounted: () => boolean;
  readonly isEnabled: () => boolean;
  readonly latestSnapshot: () => AutoRollSnapshot | null;
  readonly baselinePublishedTurn: () => number;
  readonly requestRoll: () => void;
  readonly invalidateTimers: () => void;
}

export function scheduleAutoRollTimer(options: AutoRollTimerOptions): () => void {
  const { readyKey } = options;
  let active = true;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let dialogObserver: MutationObserver | undefined;
  let rechecksRemaining = AUTO_ROLL_MAX_DIALOG_RECHECKS;

  const stillReady = (): boolean => {
    if (!active || !options.isMounted() || !options.isEnabled()) return false;
    const latest = options.latestSnapshot();
    if (!latest || latest.readyKey !== readyKey || !latest.visible) return false;
    return autoRollDisposition(latest, true, options.baselinePublishedTurn()).kind === "ready";
  };

  const checkDialog = (): void => {
    if (!stillReady()) return;
    if (!modalDialogOpen()) {
      options.invalidateTimers();
      return;
    }
    rechecksRemaining -= 1;
    if (rechecksRemaining <= 0) {
      const root = document.documentElement;
      if (!root || typeof MutationObserver === "undefined") return;
      dialogObserver = new MutationObserver(() => {
        if (!stillReady()) {
          dialogObserver?.disconnect();
          return;
        }
        if (!modalDialogOpen()) {
          dialogObserver?.disconnect();
          options.invalidateTimers();
        }
      });
      dialogObserver.observe(root, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
      return;
    }
    timeoutId = setTimeout(checkDialog, AUTO_ROLL_DIALOG_RECHECK_MS);
  };

  const onTimer = (): void => {
    if (!stillReady()) return;
    if (modalDialogOpen()) {
      timeoutId = setTimeout(checkDialog, AUTO_ROLL_DIALOG_RECHECK_MS);
      return;
    }
    options.requestRoll();
  };

  timeoutId = setTimeout(onTimer, AUTO_ROLL_GAP_MS);
  return () => {
    active = false;
    dialogObserver?.disconnect();
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };
}
