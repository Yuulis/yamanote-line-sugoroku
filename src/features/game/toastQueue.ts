import type { ItemEvent, ItemKind } from "../../types/network";
import type { LastMove } from "./gameSession";
import { serviceName } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";
import type { RailwayNetwork } from "./engine";
import { ITEM_DESCRIPTIONS } from "./itemPresentation";
import type { ProgressCrossing, ProgressThreshold } from "./progressMilestones";

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_READING_MS = 4000;

export type ToastTone = "neutral" | "good" | "bad";

export interface ToastInput {
  key: string;
  sessionId: number | null;
  turn: number | null;
  eventIndex: number | null;
  text: string;
  detail?: string;
  tone: ToastTone;
  itemKind?: ItemKind;
  sticky: boolean;
  /** Absent means "turn": ordered by the `(turn, eventIndex)` cursor. */
  kind?: "turn" | "notice";
}

/** A one-off message outside turn order: it bypasses the cursor and is deduplicated by key per scope. */
export interface NoticeToastInput extends ToastInput {
  readonly kind: "notice";
}

interface ToastPresentation {
  tone: ToastTone;
  itemKind?: ItemKind;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported item event: ${JSON.stringify(value)}`);
}

function toastPresentation(event: ItemEvent): ToastPresentation {
  switch (event.type) {
    case "pickup-retained":
    case "pickup-pending-discard":
    case "consumed":
      return { tone: "good", itemKind: event.item.kind };
    case "discarded":
      return { tone: "neutral", itemKind: event.item.kind };
    case "cancelled-by-certificate":
      return { tone: "good", itemKind: event.certificate.kind };
    case "harmful-scheduled":
      return { tone: "bad", itemKind: event.item };
    case "effect-activated":
      return { tone: "bad", itemKind: event.effect };
    case "effect-expired":
      return { tone: "good", itemKind: "suspension" };
    default:
      return assertNever(event);
  }
}

/** Keep toast copy brief; the full canonical event wording remains in the log and live region. */
export function itemEventToastText(
  event: ItemEvent,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string {
  switch (event.type) {
    case "pickup-retained":
    case "pickup-pending-discard":
      return `${ITEM_DESCRIPTIONS[event.item.kind].name}を手に入れた！`;
    case "consumed":
      return `${ITEM_DESCRIPTIONS[event.item.kind].name}を使った`;
    case "discarded":
      return `${ITEM_DESCRIPTIONS[event.item.kind].name}を捨てた`;
    case "cancelled-by-certificate":
      return `${ITEM_DESCRIPTIONS[event.certificate.kind].name}で${ITEM_DESCRIPTIONS[event.item].name}を打ち消した`;
    case "harmful-scheduled":
      return event.effect === "suspension"
        ? `${serviceName(network, event.serviceId, presentation)}が運休！`
        : `${ITEM_DESCRIPTIONS[event.item].name}を拾ってしまった！`;
    case "effect-activated":
      return `${ITEM_DESCRIPTIONS[event.effect].name}が発動！`;
    case "effect-expired":
      return `${serviceName(network, event.serviceId, presentation)}の運休が終わった`;
    default:
      return assertNever(event);
  }
}

function itemEventToastDetail(event: ItemEvent, moveTurn: number): string | undefined {
  if (event.type !== "harmful-scheduled") return undefined;

  switch (event.effect) {
    case "delay":
      return `${event.dueTurn - moveTurn}ターン後の出目が1になります`;
    case "suspension":
      return `あと${event.expiresTurn - moveTurn}ターン、この路線に乗れません`;
    case "detour":
      return "次に乗り換えられる駅で、別の路線に移ります";
    case "oversleep":
      return "次のターンは終点まで進みます（環状線は6駅）";
    default:
      return assertNever(event);
  }
}

/** Convert canonical item events into deterministic, presentation-only toasts. */
export function turnToasts(
  sessionId: number,
  lastMove: LastMove | null,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): ToastInput[] {
  const record = lastMove?.itemRecord;
  if (!record) return [];

  const seenPickupIds = new Set<string>();
  const toasts: ToastInput[] = [];
  record.itemEvents.forEach((event, eventIndex) => {
    if (event.type === "pickup-retained" || event.type === "pickup-pending-discard") {
      if (seenPickupIds.has(event.item.id)) return;
      seenPickupIds.add(event.item.id);
    }
    const text = itemEventToastText(event, network, presentation);
    const detail = itemEventToastDetail(event, record.turn);
    const model = toastPresentation(event);
    toasts.push({
      key: `${sessionId}:${record.turn}:${eventIndex}`,
      sessionId,
      turn: record.turn,
      eventIndex,
      text,
      ...(detail === undefined ? {} : { detail }),
      ...model,
      sticky: false,
    });
  });
  return toasts;
}

/** Target-segment count whose completion is announced; #65 adds thresholds as further negative indexes. */
const TARGET_SEGMENTS_MILESTONE = 30;
/** Negative, so the milestone sorts before every item event (indexes start at zero) of its turn. */
const MILESTONE_EVENT_INDEX = -1;
type ProgressMilestoneToastDetails = Readonly<{ eventIndex: number; text: string }>;
const PROGRESS_MILESTONE_TOAST_DETAILS: Readonly<Record<Exclude<ProgressThreshold, 30>, ProgressMilestoneToastDetails>> = {
  10: { eventIndex: -5, text: "10区間突破！" },
  20: { eventIndex: -4, text: "20区間突破！あと10区間" },
  25: { eventIndex: -3, text: "あと5区間！" },
  29: { eventIndex: -2, text: "あと1区間！" },
};

export function progressMilestoneToast(sessionId: number, crossing: ProgressCrossing): ToastInput {
  if (crossing.threshold === TARGET_SEGMENTS_MILESTONE) {
    throw new RangeError("The 30-segment milestone uses targetSegmentsMilestoneToast");
  }
  const details = PROGRESS_MILESTONE_TOAST_DETAILS[crossing.threshold];
  return {
    key: `${sessionId}:milestone:target-segments:${crossing.threshold}`,
    sessionId,
    turn: crossing.turn,
    eventIndex: details.eventIndex,
    text: details.text,
    tone: "good",
    sticky: false,
  };
}

/**
 * One-time notice that every target segment is complete. Keyed by session, it is queued at the first completion
 * turn, so the cursor rejects it on every later turn and after it expired.
 */
export function targetSegmentsMilestoneToast(
  sessionId: number,
  completionTurn: number,
  goalStationName: string,
): ToastInput {
  return {
    key: `${sessionId}:milestone:target-segments:${TARGET_SEGMENTS_MILESTONE}`,
    sessionId,
    turn: completionTurn,
    eventIndex: MILESTONE_EVENT_INDEX,
    text: `${TARGET_SEGMENTS_MILESTONE}区間を踏破！あとは${goalStationName}に着けばクリア`,
    tone: "good",
    sticky: false,
  };
}

export function saveFailureToast(sessionId: number | null): ToastInput {
  return {
    key: `${sessionId}:save-failed`,
    sessionId,
    turn: null,
    eventIndex: null,
    text: "保存に失敗しました",
    tone: "bad",
    sticky: true,
  };
}

export interface ToastQueueState {
  readonly scope: number | null;
  readonly cursor: { readonly turn: number; readonly eventIndex: number } | null;
  readonly items: readonly ToastInput[];
  readonly saveFailed: boolean;
  /** Keys of notices accepted in this scope; a scope reset clears them. */
  readonly noticeKeys: readonly string[];
}

export const INITIAL_TOAST_QUEUE: ToastQueueState = {
  scope: null,
  cursor: null,
  items: [],
  saveFailed: false,
  noticeKeys: [],
};

export function createToastQueue(scope: number | null): ToastQueueState {
  return { scope, cursor: null, items: [], saveFailed: false, noticeKeys: [] };
}

export type ToastQueueAction =
  | { type: "enqueue"; scope: number | null; inputs: readonly ToastInput[] }
  | { type: "enqueueNotice"; scope: number | null; notice: NoticeToastInput }
  | { type: "withdrawNotice"; key: string }
  | { type: "expire"; key: string }
  | { type: "saveFailed" }
  | { type: "saveSucceeded" }
  | { type: "resetScope"; sessionId: number | null };

type ToastCursor = NonNullable<ToastQueueState["cursor"]>;

/** Ordinary toasts never use the slot reserved for the sticky save failure. */
const ORDINARY_TOAST_SLOTS = MAX_VISIBLE_TOASTS - 1;

/** The input's position when it is newer than the scope's seen cursor; null otherwise. */
function newerPosition(cursor: ToastQueueState["cursor"], input: ToastInput): ToastCursor | null {
  if (input.kind === "notice" || input.sticky || input.turn === null || input.eventIndex === null) return null;
  const position = { turn: input.turn, eventIndex: input.eventIndex };
  if (!cursor) return position;
  const newer = position.turn > cursor.turn
    || (position.turn === cursor.turn && position.eventIndex > cursor.eventIndex);
  return newer ? position : null;
}

/** Keep visible toasts and waiting notices; drop waiting turn toasts from turns before `turn` (never shown). */
function dropWaitingBefore(items: readonly ToastInput[], turn: number): readonly ToastInput[] {
  const waiting = items.slice(ORDINARY_TOAST_SLOTS);
  const kept = waiting.filter((item) => item.kind === "notice" || (item.turn !== null && item.turn >= turn));
  return kept.length === waiting.length ? items : [...items.slice(0, ORDINARY_TOAST_SLOTS), ...kept];
}

function enqueueToasts(state: ToastQueueState, scope: number | null, inputs: readonly ToastInput[]): ToastQueueState {
  if (scope !== state.scope) return state;
  let items = state.items;
  let cursor = state.cursor;
  for (const input of inputs) {
    if (input.sessionId !== state.scope) continue;
    const position = newerPosition(cursor, input);
    if (!position) continue;
    items = [...dropWaitingBefore(items, position.turn), input];
    cursor = position;
  }
  return cursor === state.cursor ? state : { ...state, items, cursor };
}

/** Appends a notice to the shared FIFO without reading or moving the turn cursor. */
function enqueueNotice(state: ToastQueueState, scope: number | null, notice: NoticeToastInput): ToastQueueState {
  if (scope !== state.scope || notice.sessionId !== state.scope || notice.sticky) return state;
  if (state.noticeKeys.includes(notice.key)) return state;
  return { ...state, items: [...state.items, notice], noticeKeys: [...state.noticeKeys, notice.key] };
}

function withdrawNotice(state: ToastQueueState, key: string): ToastQueueState {
  if (!state.noticeKeys.includes(key)) return state;
  const item = state.items.find((entry) => entry.key === key);
  if (item && item.kind !== "notice") return state;
  return {
    ...state,
    items: state.items.filter((entry) => entry.key !== key),
    noticeKeys: state.noticeKeys.filter((entry) => entry !== key),
  };
}

export function toastQueueReducer(state: ToastQueueState, action: ToastQueueAction): ToastQueueState {
  switch (action.type) {
    case "enqueue":
      return enqueueToasts(state, action.scope, action.inputs);
    case "enqueueNotice":
      return enqueueNotice(state, action.scope, action.notice);
    case "withdrawNotice":
      return withdrawNotice(state, action.key);
    case "expire": {
      if (action.key === saveFailureToast(state.scope).key || !state.items.some((item) => item.key === action.key)) return state;
      return { ...state, items: state.items.filter((item) => item.key !== action.key) };
    }
    case "saveFailed":
      return state.saveFailed ? state : { ...state, saveFailed: true };
    case "saveSucceeded":
      return state.saveFailed ? { ...state, saveFailed: false } : state;
    case "resetScope":
      return createToastQueue(action.sessionId);
    default:
      return assertNever(action);
  }
}

export function visibleToasts(state: ToastQueueState): readonly ToastInput[] {
  const visible = state.items.slice(0, ORDINARY_TOAST_SLOTS);
  return state.saveFailed ? [...visible, saveFailureToast(state.scope)] : visible;
}

export interface ToastReadingClock {
  remainingMs: number;
  runningSinceMs: number | null;
}

export function createReadingClock(): ToastReadingClock {
  return { remainingMs: TOAST_READING_MS, runningSinceMs: null };
}

export function resumeReadingClock(clock: ToastReadingClock, nowMs: number): ToastReadingClock {
  if (clock.runningSinceMs !== null || clock.remainingMs === 0) return clock;
  return { ...clock, runningSinceMs: nowMs };
}

export function pauseReadingClock(clock: ToastReadingClock, nowMs: number): ToastReadingClock {
  if (clock.runningSinceMs === null) return clock;
  const elapsedMs = Math.max(0, nowMs - clock.runningSinceMs);
  return { remainingMs: Math.max(0, clock.remainingMs - elapsedMs), runningSinceMs: null };
}

export function readingRemainingMs(clock: ToastReadingClock, nowMs: number): number {
  if (clock.runningSinceMs === null) return clock.remainingMs;
  return Math.max(0, clock.remainingMs - Math.max(0, nowMs - clock.runningSinceMs));
}
