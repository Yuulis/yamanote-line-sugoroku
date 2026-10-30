import { describe, expect, it } from "vitest";
import {
  createReadingClock, createToastQueue, INITIAL_TOAST_QUEUE, MAX_VISIBLE_TOASTS, pauseReadingClock,
  readingRemainingMs, resumeReadingClock, saveFailureToast, toastQueueReducer, TOAST_READING_MS,
  turnToasts, visibleToasts, type ToastInput, type ToastQueueAction, type ToastQueueState,
} from "../../src/features/game/toastQueue";
import { lastMoveOf } from "../../src/features/game/gameSession";
import { itemLastMove } from "../../src/features/game/itemSession";
import { itemEventTexts } from "../../src/features/game/presentation";
import { createGame, moveByRoll, playItemTurn, resolveItemDiscard } from "../../src/features/game/engine";
import type { ItemEvent, ItemGameState, ItemKind, ItemTurnRecord } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");

function arrivedRecord(state: ItemGameState): ItemTurnRecord {
  const record = state.pending?.kind === "discard" ? state.pending.record : state.movementHistory.at(-1);
  if (!record) throw new Error("Expected an engine-generated item record");
  return record as ItemTurnRecord;
}

function engineRecord(): ItemTurnRecord {
  const result = playItemTurn(itemScenario("route", network), {}, network);
  if (!result.record) throw new Error("Expected an engine-generated item record");
  return result.record;
}

function recordWithEvents(events: ItemEvent[], turn = 1): ItemTurnRecord {
  return { ...engineRecord(), turn, itemEvents: events };
}

function convert(events: ItemEvent[], turn = 1): ToastInput[] {
  return turnToasts(42, itemLastMove(recordWithEvents(events, turn), network), network);
}

function replayRecords(name: Parameters<typeof itemScenario>[0]): ItemTurnRecord[] {
  let state = itemScenario(name, network);
  const records: ItemTurnRecord[] = [];
  for (let index = 0; index < 20 && state.status === "playing"; index += 1) {
    const result = playItemTurn(state, {}, network);
    if (result.state.pending?.kind === "discard") {
      const resolved = resolveItemDiscard(result.state, result.state.pending.item.id);
      state = resolved.state;
      if (resolved.record) records.push(resolved.record);
      continue;
    }
    state = result.state;
    if (result.record) records.push(result.record);
  }
  return records;
}

function toast(key: string, turn: number, eventIndex: number, sessionId = 7): ToastInput {
  return { key, sessionId, turn, eventIndex, text: key, tone: "neutral", sticky: false };
}

function enqueue(state: ToastQueueState, inputs: readonly ToastInput[], scope = state.scope): ToastQueueState {
  return toastQueueReducer(state, { type: "enqueue", scope, inputs });
}

function dispatch(state: ToastQueueState, action: ToastQueueAction): ToastQueueState {
  return toastQueueReducer(state, action);
}

describe("canonical item event toast conversion", () => {
  it("returns no toasts for a null move or a classic move without an item record", () => {
    const classicGame = moveByRoll(createGame(LEGACY_CAPITAL_REGION_CONFIG, "toast-classic", network), 3, network).state;
    const classic = lastMoveOf(classicGame, network);
    expect(turnToasts(1, null, network)).toEqual([]);
    expect(turnToasts(1, classic, network)).toEqual([]);
  });

  it("reuses exact event wording and keeps original indexes when duplicate pickups are deduped", () => {
    const events: ItemEvent[] = [
      { type: "pickup-retained", item: { id: "same", kind: "double" } },
      { type: "consumed", item: { id: "used", kind: "double" } },
      { type: "pickup-pending-discard", item: { id: "same", kind: "double" }, candidates: [] },
      { type: "discarded", item: { id: "old", kind: "rapid" } },
    ];
    const record = recordWithEvents(events, 9);
    const output = turnToasts(42, itemLastMove(record, network), network);
    expect(output.map((entry) => entry.eventIndex)).toEqual([0, 1, 3]);
    expect(output.map((entry) => entry.key)).toEqual(["42:9:0", "42:9:1", "42:9:3"]);
    expect(output.map((entry) => entry.text)).toEqual(itemEventTexts(record.itemEvents, record.turn, network));
    expect(output.map((entry) => entry.text).join("|")).toBe(itemEventTexts(record.itemEvents, record.turn, network).join("|"));
    expect(output.every((entry) => entry.sessionId === 42 && entry.turn === 9 && !entry.sticky)).toBe(true);
  });

  it.each([
    [{ type: "pickup-retained", item: { id: "a", kind: "double" } }, "good", "double"],
    [{ type: "pickup-pending-discard", item: { id: "a", kind: "rapid" }, candidates: [] }, "good", "rapid"],
    [{ type: "consumed", item: { id: "a", kind: "double" } }, "good", "double"],
    [{ type: "discarded", item: { id: "a", kind: "rapid" } }, "neutral", "rapid"],
    [{ type: "cancelled-by-certificate", item: "delay", certificate: { id: "c", kind: "delay-certificate" } }, "good", "delay-certificate"],
    [{ type: "harmful-scheduled", item: "suspension", effect: "suspension", serviceId: "jr-yamanote", expiresTurn: 4 }, "bad", "suspension"],
    [{ type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 4 }, "bad", "delay"],
    [{ type: "harmful-scheduled", item: "detour", effect: "detour" }, "bad", "detour"],
    [{ type: "harmful-scheduled", item: "oversleep", effect: "oversleep" }, "bad", "oversleep"],
    [{ type: "effect-activated", effect: "delay" }, "bad", "delay"],
    [{ type: "effect-activated", effect: "detour" }, "bad", "detour"],
    [{ type: "effect-activated", effect: "oversleep" }, "bad", "oversleep"],
    [{ type: "effect-expired", effect: "suspension", serviceId: "jr-yamanote" }, "good", "suspension"],
  ] as const)("maps %s to its typed tone and icon kind", (event, tone, itemKind) => {
    const output = convert([event as ItemEvent]);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ tone, itemKind: itemKind as ItemKind, eventIndex: 0 });
    expect(output[0]?.text).toBe(itemEventTexts([event as ItemEvent], 1, network)[0]);
  });

  it.each([
    ["route", "pickup-retained", "good", "rapid"],
    ["discard", "pickup-pending-discard", "good", "delay-certificate"],
    ["certificate", "cancelled-by-certificate", "good", "delay-certificate"],
    ["delay", "harmful-scheduled", "bad", "delay"],
    ["adjust", "harmful-scheduled", "bad", "oversleep"],
    ["oversleep", "effect-activated", "bad", "oversleep"],
  ] as const)("converts the engine-generated %s turn into a %s toast", (name, type, tone, itemKind) => {
    const record = arrivedRecord(playItemTurn(itemScenario(name, network), {}, network).state);
    const eventIndex = record.itemEvents.findIndex((event) => event.type === type);
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    const event = record.itemEvents[eventIndex]!;
    const converted = turnToasts(5, itemLastMove(record, network), network);
    expect(converted.find((entry) => entry.eventIndex === eventIndex)).toEqual({
      key: `5:${record.turn}:${eventIndex}`, sessionId: 5, turn: record.turn, eventIndex,
      text: itemEventTexts([event], record.turn, network)[0], tone, itemKind, sticky: false,
    });
  });

  it("converts the engine-generated use of an owned item into a consumed toast", () => {
    const base = itemScenario("double", network);
    const owned = base.inventory.find((item) => item.kind === "double");
    if (!owned) throw new Error("Expected the pinned double scenario to hold a double item");
    const record = arrivedRecord(playItemTurn(base, {
      command: { items: [{ kind: "double", instanceId: owned.id }] },
    }, network).state);
    const eventIndex = record.itemEvents.findIndex((event) => event.type === "consumed");
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    const converted = turnToasts(5, itemLastMove(record, network), network);
    expect(converted.find((entry) => entry.eventIndex === eventIndex)).toMatchObject({
      key: `5:${record.turn}:${eventIndex}`, tone: "good", itemKind: "double", text: "倍速券を使いました",
    });
  });

  it("converts engine-generated activation, harmful scheduling, cancellation, and expiry", () => {
    const base = itemScenario("route", network);
    const activation = playItemTurn({ ...base, effects: { ...base.effects, delayDueTurns: [base.turn + 1] } }, {}, network).record;
    // No pinned seed naturally reaches suspension expiry; expire a real typed effect through the engine.
    const expiry = playItemTurn({ ...base, effects: { ...base.effects,
      suspensions: [{ serviceId: base.currentServiceId, expiresTurn: base.turn }],
    } }, {}, network).record;
    expect(activation?.itemEvents).toContainEqual({ type: "effect-activated", effect: "delay" });
    expect(expiry?.itemEvents).toContainEqual({ type: "effect-expired", effect: "suspension", serviceId: base.currentServiceId });
    for (const record of [activation, expiry]) {
      if (!record) throw new Error("Expected an engine-generated event record");
      const converted = turnToasts(42, itemLastMove(record, network), network);
      expect(converted.map((entry) => entry.text)).toEqual(itemEventTexts(record.itemEvents, record.turn, network));
    }
    const pinnedRecords = ["delay", "certificate", "discard", "double", "oversleep", "rapid"]
      .flatMap((name) => replayRecords(name as Parameters<typeof itemScenario>[0]));
    const eventTypes = new Set(pinnedRecords.flatMap((record) => record.itemEvents.map((event) => event.type)));
    expect(eventTypes).toContain("harmful-scheduled");
    expect(eventTypes).toContain("cancelled-by-certificate");
    expect(eventTypes).toContain("effect-activated");
    for (const record of pinnedRecords) {
      const converted = turnToasts(42, itemLastMove(record, network), network);
      expect(converted.map((entry) => entry.text)).toEqual(itemEventTexts(record.itemEvents, record.turn, network));
    }
  });

  it("appends only the resolved discard when the engine resolves a pending pickup", () => {
    const pendingState = playItemTurn(itemScenario("discard", network), {}, network).state;
    if (pendingState.pending?.kind !== "discard") throw new Error("Expected the pinned discard scenario to wait for a discard");
    const pendingRecord = pendingState.pending.record as ItemTurnRecord;
    const resolved = resolveItemDiscard(pendingState, pendingState.pending.item.id).record;
    if (!resolved) throw new Error("Expected the engine to commit the discard");
    expect(resolved.turn).toBe(pendingRecord.turn);
    const firstList = turnToasts(42, itemLastMove(pendingRecord, network), network);
    const secondList = turnToasts(42, itemLastMove(resolved, network), network);
    const discardIndex = resolved.itemEvents.findIndex((event) => event.type === "discarded");
    expect(firstList.map((entry) => entry.eventIndex)).toEqual([0]);
    expect(discardIndex).toBe(1);
    let state = enqueue(createToastQueue(42), firstList);
    const afterPickup = state;
    state = enqueue(state, secondList);
    expect(state.items.slice(0, afterPickup.items.length)).toEqual(afterPickup.items);
    expect(state.items.map((entry) => entry.key)).toEqual([`42:${resolved.turn}:0`, `42:${resolved.turn}:${discardIndex}`]);
    expect(state.items.at(-1)).toMatchObject({ tone: "neutral", itemKind: "delay-certificate" });
    expect(state.items.map((entry) => entry.text)).toEqual(itemEventTexts(resolved.itemEvents, resolved.turn, network));
    expect(enqueue(state, secondList)).toBe(state);
  });

  it("uses no synthesized wording or unstable values", () => {
    const event: ItemEvent = { type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 5 };
    const record = recordWithEvents([event], 2);
    const first = turnToasts(3, itemLastMove(record, network), network);
    const second = turnToasts(3, itemLastMove(record, network), network);
    expect(second).toEqual(first);
    expect(first[0]?.text).toBe("遅延：5ターン目に発動（あと3ターン）。出目が1になります");
  });
});

describe("bounded toast queue", () => {
  it("shows two ordinary toasts and promotes waiting items in arrival order", () => {
    const inputs = Array.from({ length: 5 }, (_entry, index) => toast(`k${index}`, 1, index));
    let state = enqueue(createToastQueue(7), inputs);
    expect(state.items).toHaveLength(5);
    expect(visibleToasts(state).map((item) => item.key)).toEqual(["k0", "k1"]);
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    state = dispatch(state, { type: "expire", key: "k0" });
    expect(visibleToasts(state).map((item) => item.key)).toEqual(["k1", "k2"]);
    state = dispatch(state, { type: "expire", key: "k1" });
    expect(visibleToasts(state).map((item) => item.key)).toEqual(["k2", "k3"]);
  });

  it("reserves the third slot for sticky save failure and clears it on success or reset", () => {
    let state = enqueue(createToastQueue(7), [toast("a", 1, 0), toast("b", 1, 1), toast("c", 1, 2)]);
    state = dispatch(state, { type: "saveFailed" });
    expect(visibleToasts(state).map((item) => item.key)).toEqual(["a", "b", "7:save-failed"]);
    expect(saveFailureToast(7)).toMatchObject({ tone: "bad", sticky: true, turn: null, eventIndex: null });
    expect(dispatch(state, { type: "expire", key: "7:save-failed" })).toBe(state);
    state = dispatch(state, { type: "saveSucceeded" });
    expect(state.saveFailed).toBe(false);
    expect(visibleToasts(state).map((item) => item.key)).toEqual(["a", "b"]);
    state = dispatch(state, { type: "saveFailed" });
    expect(dispatch(state, { type: "resetScope", sessionId: 8 })).toEqual(createToastQueue(8));
    expect(dispatch(INITIAL_TOAST_QUEUE, { type: "saveSucceeded" })).toBe(INITIAL_TOAST_QUEUE);
  });

  it("returns the same object for duplicate, stale, invalid, and unknown actions", () => {
    const original = createToastQueue(7);
    const accepted = enqueue(original, [toast("a", 4, 2)]);
    expect(enqueue(accepted, [toast("a", 4, 2)])).toBe(accepted);
    expect(enqueue(accepted, [toast("old", 3, 99)])).toBe(accepted);
    expect(enqueue(accepted, [toast("wrong-session", 5, 0, 9)])).toBe(accepted);
    expect(enqueue(accepted, [toast("wrong-scope", 5, 0)], 9)).toBe(accepted);
    expect(enqueue(accepted, [{ ...toast("sticky", 5, 0), sticky: true }])).toBe(accepted);
    expect(enqueue(accepted, [{ ...toast("no-index", 5, 0), eventIndex: null }])).toBe(accepted);
    expect(enqueue(accepted, [{ ...toast("no-turn", 5, 0), turn: null }])).toBe(accepted);
    expect(dispatch(accepted, { type: "expire", key: "missing" })).toBe(accepted);
    const failed = dispatch(accepted, { type: "saveFailed" });
    expect(failed).not.toBe(accepted);
    expect(dispatch(failed, { type: "saveFailed" })).toBe(failed);
    expect(dispatch(accepted, { type: "saveSucceeded" })).toBe(accepted);
  });

  it("never resurrects an expired current-turn event and rejects earlier turns", () => {
    let state = enqueue(createToastQueue(7), [toast("first", 3, 1)]);
    state = dispatch(state, { type: "expire", key: "first" });
    expect(enqueue(state, [toast("resurrected", 3, 1)])).toBe(state);
    expect(enqueue(state, [toast("prior", 2, 99)])).toBe(state);
  });

  it("drops never-shown prior-turn items while retaining visible items when a newer turn arrives", () => {
    let state = enqueue(createToastQueue(7), [toast("visible-1", 1, 0), toast("visible-2", 1, 1), toast("waiting", 1, 2)]);
    state = enqueue(state, [toast("new-turn", 2, 0)]);
    expect(state.items.map((item) => item.key)).toEqual(["visible-1", "visible-2", "new-turn"]);
    expect(visibleToasts(state).map((item) => item.key)).toEqual(["visible-1", "visible-2"]);
  });

  it("clears cursor and failure on session reset so a new session turn one is accepted", () => {
    let state = enqueue(createToastQueue(7), [toast("old", 9, 4)]);
    state = dispatch(state, { type: "saveFailed" });
    state = dispatch(state, { type: "resetScope", sessionId: 8 });
    expect(state).toEqual(createToastQueue(8));
    expect(enqueue(state, [toast("new-session", 1, 0, 8)]).items.map((item) => item.key)).toEqual(["new-session"]);
    expect(dispatch(state, { type: "resetScope", sessionId: 8 })).not.toBe(state);
    expect(dispatch(state, { type: "resetScope", sessionId: null })).toEqual(createToastQueue(null));
  });

  it("leaves each action's input state and payload unchanged", () => {
    const apply = (state: ToastQueueState, action: ToastQueueAction): ToastQueueState => {
      const before = JSON.stringify({ state, action });
      const next = toastQueueReducer(state, action);
      expect(JSON.stringify({ state, action })).toBe(before);
      return next;
    };
    let state = createToastQueue(7);
    state = apply(state, { type: "enqueue", scope: 7, inputs: [toast("a", 1, 0), toast("b", 1, 1), toast("c", 1, 2)] });
    state = apply(state, { type: "enqueue", scope: 7, inputs: [toast("d", 2, 0)] });
    expect(state.items.map((item) => item.key)).toEqual(["a", "b", "d"]);
    state = apply(state, { type: "saveFailed" });
    state = apply(state, { type: "expire", key: "a" });
    state = apply(state, { type: "saveSucceeded" });
    state = apply(state, { type: "resetScope", sessionId: 8 });
    expect(state).toEqual(createToastQueue(8));
  });
});

describe("toast reading clock", () => {
  it("preserves remaining reading time across multiple obscured intervals", () => {
    let clock = createReadingClock();
    expect(clock).toEqual({ remainingMs: TOAST_READING_MS, runningSinceMs: null });
    clock = resumeReadingClock(clock, 100);
    clock = pauseReadingClock(clock, 1100);
    expect(clock.remainingMs).toBe(3000);
    clock = resumeReadingClock(clock, 5000);
    clock = pauseReadingClock(clock, 6500);
    expect(clock.remainingMs).toBe(1500);
    clock = resumeReadingClock(clock, 8000);
    expect(readingRemainingMs(clock, 8500)).toBe(1000);
  });

  it("clamps elapsed time at zero and keeps resume and pause idempotent", () => {
    const paused = createReadingClock();
    const running = resumeReadingClock(paused, 20);
    expect(resumeReadingClock(running, 30)).toBe(running);
    expect(pauseReadingClock(paused, 10)).toBe(paused);
    const finished = pauseReadingClock(running, 9000);
    expect(finished.remainingMs).toBe(0);
    expect(readingRemainingMs(running, 9000)).toBe(0);
    expect(resumeReadingClock(finished, 10000)).toBe(finished);
    expect(pauseReadingClock(finished, 10000)).toBe(finished);
  });
});
