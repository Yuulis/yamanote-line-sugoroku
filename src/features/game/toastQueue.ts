import type { ItemEvent, ItemKind } from "../../types/network";
import type { LastMove } from "./gameSession";
import { itemEventTexts } from "./presentation";
import type { PresentationResolver } from "./presentationResolver";
import type { RailwayNetwork } from "./engine";
import { saveStatusMessage } from "./store/persistence";

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_READING_MS = 4000;

export type ToastTone = "neutral" | "good" | "bad";

export interface ToastInput {
  key: string;
  sessionId: number | null;
  turn: number | null;
  eventIndex: number | null;
  text: string;
  tone: ToastTone;
  itemKind?: ItemKind;
  sticky: boolean;
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
    const text = itemEventTexts([event], record.turn, network, presentation)[0];
    if (text === undefined) return;
    const model = toastPresentation(event);
    toasts.push({
      key: `${sessionId}:${record.turn}:${eventIndex}`,
      sessionId,
      turn: record.turn,
      eventIndex,
      text,
      ...model,
      sticky: false,
    });
  });
  return toasts;
}

export function saveFailureToast(sessionId: number | null): ToastInput {
  return {
    key: `${sessionId}:save-failed`,
    sessionId,
    turn: null,
    eventIndex: null,
    text: `セーブ: ${saveStatusMessage("failed")}`,
    tone: "bad",
    sticky: true,
  };
}

export interface ToastQueueState {
  readonly scope: number | null;
  readonly cursor: { readonly turn: number; readonly eventIndex: number } | null;
  readonly items: readonly ToastInput[];
  readonly saveFailed: boolean;
}

export const INITIAL_TOAST_QUEUE: ToastQueueState = {
  scope: null,
  cursor: null,
  items: [],
  saveFailed: false,
};

export function createToastQueue(scope: number | null): ToastQueueState {
  return { scope, cursor: null, items: [], saveFailed: false };
}

export type ToastQueueAction =
  | { type: "enqueue"; scope: number | null; inputs: readonly ToastInput[] }
  | { type: "expire"; key: string }
  | { type: "saveFailed" }
  | { type: "saveSucceeded" }
  | { type: "resetScope"; sessionId: number | null };

type ToastCursor = NonNullable<ToastQueueState["cursor"]>;

/** Ordinary toasts never use the slot reserved for the sticky save failure. */
const ORDINARY_TOAST_SLOTS = MAX_VISIBLE_TOASTS - 1;

/** The input's position when it is newer than the scope's seen cursor; null otherwise. */
function newerPosition(cursor: ToastQueueState["cursor"], input: ToastInput): ToastCursor | null {
  if (input.sticky || input.turn === null || input.eventIndex === null) return null;
  const position = { turn: input.turn, eventIndex: input.eventIndex };
  if (!cursor) return position;
  const newer = position.turn > cursor.turn
    || (position.turn === cursor.turn && position.eventIndex > cursor.eventIndex);
  return newer ? position : null;
}

/** Keep visible toasts reading; drop waiting ones from turns before `turn` (never shown). */
function dropWaitingBefore(items: readonly ToastInput[], turn: number): readonly ToastInput[] {
  const waiting = items.slice(ORDINARY_TOAST_SLOTS);
  const kept = waiting.filter((item) => item.turn !== null && item.turn >= turn);
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

export function toastQueueReducer(state: ToastQueueState, action: ToastQueueAction): ToastQueueState {
  switch (action.type) {
    case "enqueue":
      return enqueueToasts(state, action.scope, action.inputs);
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
