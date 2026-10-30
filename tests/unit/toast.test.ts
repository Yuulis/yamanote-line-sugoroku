import { createRequire } from "node:module";
import { act, createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReadingClock, createToastQueue, INITIAL_TOAST_QUEUE, MAX_VISIBLE_TOASTS, pauseReadingClock,
  readingRemainingMs, resumeReadingClock, saveFailureToast, toastQueueReducer, TOAST_READING_MS,
  turnToasts, visibleToasts, type ToastInput, type ToastQueueAction, type ToastQueueState,
} from "../../src/features/game/toastQueue";
import { lastMoveOf } from "../../src/features/game/gameSession";
import { itemLastMove } from "../../src/features/game/itemSession";
import { createGame, moveByRoll, playItemTurn, resolveItemDiscard } from "../../src/features/game/engine";
import type { ItemEvent, ItemGameState, ItemKind, ItemTurnRecord } from "../../src/types/network";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";
import { mountReact, type MountedReact } from "./helpers/reactDom";
import { ToastHost, type ToastHostProps } from "../../src/features/game/components/ToastHost";

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

function expectedEngineToastText(event: ItemEvent): string {
  switch (event.type) {
    case "pickup-retained":
    case "pickup-pending-discard": return `${ITEM_DESCRIPTIONS[event.item.kind].name}を手に入れた！`;
    case "consumed": return `${ITEM_DESCRIPTIONS[event.item.kind].name}を使った`;
    case "discarded": return `${ITEM_DESCRIPTIONS[event.item.kind].name}を捨てた`;
    case "cancelled-by-certificate": return `${ITEM_DESCRIPTIONS[event.certificate.kind].name}で${ITEM_DESCRIPTIONS[event.item].name}を打ち消した`;
    case "harmful-scheduled": return event.effect === "suspension"
      ? `${network.servicesById.get(event.serviceId)?.name ?? "路線"}が運休！`
      : `${ITEM_DESCRIPTIONS[event.item].name}を拾ってしまった！`;
    case "effect-activated": return `${ITEM_DESCRIPTIONS[event.effect].name}が発動！`;
    case "effect-expired": return `${network.servicesById.get(event.serviceId)?.name ?? "路線"}の運休が終わった`;
    default: return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected event: ${JSON.stringify(value)}`);
}

describe("canonical item event toast conversion", () => {
  it("returns no toasts for a null move or a classic move without an item record", () => {
    const classicGame = moveByRoll(createGame(LEGACY_CAPITAL_REGION_CONFIG, "toast-classic", network), 3, network).state;
    const classic = lastMoveOf(classicGame, network);
    expect(turnToasts(1, null, network)).toEqual([]);
    expect(turnToasts(1, classic, network)).toEqual([]);
  });

  it("uses short outcome wording and keeps original indexes when duplicate pickups are deduped", () => {
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
    expect(output.map((entry) => entry.text)).toEqual(["倍速券を手に入れた！", "倍速券を使った", "快速券を捨てた"]);
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
  });

  it.each([
    [{ type: "pickup-retained", item: { id: "a", kind: "rapid" } }, "快速券を手に入れた！"],
    [{ type: "pickup-pending-discard", item: { id: "a", kind: "delay-certificate" }, candidates: [] }, "遅延証明書を手に入れた！"],
    [{ type: "consumed", item: { id: "a", kind: "double" } }, "倍速券を使った"],
    [{ type: "discarded", item: { id: "a", kind: "deadhead" } }, "回送列車を捨てた"],
    [{ type: "cancelled-by-certificate", item: "delay", certificate: { id: "c", kind: "delay-certificate" } }, "遅延証明書で遅延を打ち消した"],
    [{ type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 4 }, "遅延を拾ってしまった！"],
    [{ type: "harmful-scheduled", item: "suspension", effect: "suspension", serviceId: "jr-yamanote", expiresTurn: 4 }, "山手線が運休！"],
    [{ type: "harmful-scheduled", item: "detour", effect: "detour" }, "寄り道を拾ってしまった！"],
    [{ type: "harmful-scheduled", item: "oversleep", effect: "oversleep" }, "寝過ごしを拾ってしまった！"],
    [{ type: "effect-activated", effect: "delay" }, "遅延が発動！"],
    [{ type: "effect-activated", effect: "detour" }, "寄り道が発動！"],
    [{ type: "effect-activated", effect: "oversleep" }, "寝過ごしが発動！"],
    [{ type: "effect-expired", effect: "suspension", serviceId: "jr-yamanote" }, "山手線の運休が終わった"],
  ] as const)("uses short toast wording for %s", (event, expected) => {
    expect(convert([event as ItemEvent])[0]?.text).toBe(expected);
  });

  it.each([
    ["route", "pickup-retained", "good", "rapid", "快速券を手に入れた！"],
    ["discard", "pickup-pending-discard", "good", "delay-certificate", "遅延証明書を手に入れた！"],
    ["certificate", "cancelled-by-certificate", "good", "delay-certificate", "遅延証明書で寝過ごしを打ち消した"],
    ["delay", "harmful-scheduled", "bad", "delay", "遅延を拾ってしまった！"],
    ["adjust", "harmful-scheduled", "bad", "oversleep", "寝過ごしを拾ってしまった！"],
    ["oversleep", "effect-activated", "bad", "oversleep", "寝過ごしが発動！"],
  ] as const)("converts the engine-generated %s turn into a %s toast", (name, type, tone, itemKind, expectedText) => {
    const record = arrivedRecord(playItemTurn(itemScenario(name, network), {}, network).state);
    const eventIndex = record.itemEvents.findIndex((event) => event.type === type);
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    const converted = turnToasts(5, itemLastMove(record, network), network);
    expect(converted.find((entry) => entry.eventIndex === eventIndex)).toEqual({
      key: `5:${record.turn}:${eventIndex}`, sessionId: 5, turn: record.turn, eventIndex,
      text: expectedText,
      tone, itemKind, sticky: false,
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
      key: `5:${record.turn}:${eventIndex}`, tone: "good", itemKind: "double", text: "倍速券を使った",
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
      expect(converted.map((entry) => entry.text)).toEqual(record.itemEvents.map(expectedEngineToastText));
    }
    const pinnedRecords = ["delay", "certificate", "discard", "double", "oversleep", "rapid"]
      .flatMap((name) => replayRecords(name as Parameters<typeof itemScenario>[0]));
    const eventTypes = new Set(pinnedRecords.flatMap((record) => record.itemEvents.map((event) => event.type)));
    expect(eventTypes).toContain("harmful-scheduled");
    expect(eventTypes).toContain("cancelled-by-certificate");
    expect(eventTypes).toContain("effect-activated");
    for (const record of pinnedRecords) {
      const converted = turnToasts(42, itemLastMove(record, network), network);
      const seenPickupIds = new Set<string>();
      const expected = record.itemEvents.flatMap((event, eventIndex) => {
        if (event.type === "pickup-retained" || event.type === "pickup-pending-discard") {
          if (seenPickupIds.has(event.item.id)) return [];
          seenPickupIds.add(event.item.id);
        }
        return [{ eventIndex, text: expectedEngineToastText(event) }];
      });
      expect(converted.map(({ eventIndex, text }) => ({ eventIndex, text }))).toEqual(expected);
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
    expect(state.items.map((entry) => entry.text)).toEqual(["遅延証明書を手に入れた！", "遅延証明書を捨てた"]);
    expect(enqueue(state, secondList)).toBe(state);
  });

  it("uses the short caught-item wording without exposing scheduled turn details", () => {
    const event: ItemEvent = { type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 5 };
    const record = recordWithEvents([event], 2);
    const first = turnToasts(3, itemLastMove(record, network), network);
    const second = turnToasts(3, itemLastMove(record, network), network);
    expect(second).toEqual(first);
    expect(first[0]?.text).toBe("遅延を拾ってしまった！");
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
    expect(saveFailureToast(7).text).toBe("保存に失敗しました");
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

describe("ToastHost", () => {
  interface TestDom {
    window: Window & typeof globalThis & { close: () => void };
  }
  const JSDOM = createRequire(import.meta.url)("jsdom").JSDOM as new (
    html: string,
    options: { url: string },
  ) => TestDom;
  let dom: TestDom;
  let mounted: MountedReact | null = null;
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const globalNames: string[] = ["window", "document", "HTMLElement", "Element", "Node", "navigator", "MutationObserver"];

  function Harness(props: ToastHostProps): React.JSX.Element {
    return createElement(ToastHost, props);
  }

  function props(overrides: Partial<ToastHostProps> = {}): ToastHostProps {
    return {
      sessionId: 7,
      inputs: [],
      saveFailed: false,
      obscured: false,
      reducedMotion: false,
      ...overrides,
    };
  }

  function render(next: ToastHostProps): void {
    if (!mounted) {
      mounted = mountReact(createElement(Harness, next));
      return;
    }
    act(() => mounted?.root.render(createElement(Harness, next)));
  }

  function toastHost(): HTMLElement {
    const host = mounted?.container.querySelector(".toast-host");
    if (!(host instanceof HTMLElement)) throw new Error("Expected the toast host");
    return host;
  }

  beforeAll(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/" });
    for (const name of globalNames) {
      originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: name === "window" ? dom.window
          : name === "document" ? dom.window.document
            : name === "navigator" ? dom.window.navigator
              : (dom.window as unknown as Record<string, unknown>)[name],
      });
    }
  });

  afterAll(() => {
    dom.window.close();
    for (const name of globalNames) {
      const descriptor = originalGlobals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    (mounted as MountedReact | null)?.cleanup();
    mounted = null;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("expires each visible toast after exactly 4,000 ms", () => {
    render(props({ inputs: [toast("visible", 1, 0)] }));
    expect(toastHost().textContent).toContain("visible");
    act(() => vi.advanceTimersByTime(3999));
    expect(toastHost().textContent).toContain("visible");
    act(() => vi.advanceTimersByTime(1));
    expect(toastHost().textContent).not.toContain("visible");
  });

  it("starts a queued third toast's full reading time when it becomes visible", () => {
    render(props({ inputs: [toast("first", 1, 0), toast("second", 1, 1), toast("third", 1, 2)] }));
    expect(toastHost().textContent).toContain("first");
    expect(toastHost().textContent).not.toContain("third");
    act(() => vi.advanceTimersByTime(4000));
    expect(toastHost().textContent).toContain("third");
    act(() => vi.advanceTimersByTime(3999));
    expect(toastHost().textContent).toContain("third");
    act(() => vi.advanceTimersByTime(1));
    expect(toastHost().textContent).not.toContain("third");
  });

  it("defers reading while obscured and pauses with the exact remaining time", () => {
    render(props({ inputs: [toast("paused", 1, 0)], obscured: true }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(toastHost().textContent).toContain("paused");
    render(props({ inputs: [toast("paused", 1, 0)], obscured: false }));
    act(() => vi.advanceTimersByTime(1500));
    render(props({ inputs: [toast("paused", 1, 0)], obscured: true }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(toastHost().textContent).toContain("paused");
    render(props({ inputs: [toast("paused", 1, 0)], obscured: false }));
    act(() => vi.advanceTimersByTime(2499));
    expect(toastHost().textContent).toContain("paused");
    act(() => vi.advanceTimersByTime(1));
    expect(toastHost().textContent).not.toContain("paused");
  });

  it("ignores cancelled timer callbacks after a pause and after a resume", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const inputs = [toast("guarded", 1, 0)];
    render(props({ inputs }));
    const firstCallback = setTimeoutSpy.mock.calls.at(-1)?.[0] as () => void;
    act(() => vi.advanceTimersByTime(1000));
    render(props({ inputs, obscured: true }));
    act(() => firstCallback());
    expect(toastHost().textContent).toContain("guarded");
    render(props({ inputs, obscured: false }));
    act(() => firstCallback());
    expect(toastHost().textContent).toContain("guarded");
    act(() => vi.advanceTimersByTime(2999));
    expect(toastHost().textContent).toContain("guarded");
    act(() => vi.advanceTimersByTime(1));
    expect(toastHost().textContent).not.toContain("guarded");
    setTimeoutSpy.mockRestore();
  });

  it("keeps reading time under reduced motion without applying a motion class", () => {
    render(props({ inputs: [toast("still reads", 1, 0)], reducedMotion: true }));
    expect(toastHost().querySelector(".toast-host__toast--motion")).toBeNull();
    act(() => vi.advanceTimersByTime(3999));
    expect(toastHost().textContent).toContain("still reads");
    act(() => vi.advanceTimersByTime(1));
    expect(toastHost().textContent).not.toContain("still reads");
  });

  it("clears timers on unmount and session replacement without stale toasts", () => {
    render(props({ inputs: [toast("old", 1, 0)] }));
    expect(vi.getTimerCount()).toBe(1);
    (mounted as MountedReact | null)?.cleanup();
    mounted = null;
    expect(vi.getTimerCount()).toBe(0);

    render(props({ inputs: [toast("session 7", 1, 0)] }));
    render(props({ sessionId: 8, inputs: [toast("session 8", 1, 0, 8)] }));
    expect(toastHost().textContent).not.toContain("session 7");
    expect(toastHost().textContent).toContain("session 8");
    expect(vi.getTimerCount()).toBe(1);
    (mounted as MountedReact | null)?.cleanup();
    mounted = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the sticky failure in the reserved third slot until save succeeds", () => {
    render(props({ inputs: [toast("ordinary one", 1, 0), toast("ordinary two", 1, 1), toast("waiting", 1, 2)], saveFailed: true }));
    expect(Array.from(toastHost().querySelectorAll(".toast-host__toast"))).toHaveLength(3);
    expect(toastHost().textContent).toContain("ordinary one");
    expect(toastHost().textContent).toContain("ordinary two");
    expect(toastHost().textContent).toContain("保存に失敗しました");
    expect(toastHost().textContent).not.toContain("waiting");
    act(() => vi.advanceTimersByTime(100_000));
    expect(toastHost().textContent).toContain("保存に失敗しました");
    render(props({ inputs: [toast("ordinary one", 1, 0), toast("ordinary two", 1, 1), toast("waiting", 1, 2)], saveFailed: false }));
    expect(toastHost().textContent).not.toContain("保存に失敗しました");
    render(props({ sessionId: 8, inputs: [], saveFailed: false }));
    expect(toastHost().textContent).not.toContain("保存に失敗しました");
  });

  it("clears the sticky failure on session change and raises it again only on a new failure", () => {
    render(props({ saveFailed: true }));
    expect(toastHost().textContent).toContain("保存に失敗しました");
    render(props({ sessionId: 8, saveFailed: true }));
    expect(toastHost().textContent).not.toContain("保存に失敗しました");
    render(props({ sessionId: 8, saveFailed: false }));
    render(props({ sessionId: 8, saveFailed: true }));
    expect(toastHost().textContent).toContain("保存に失敗しました");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs no reading timer while obscured and applies the motion class only with motion enabled", () => {
    render(props({ inputs: [toast("hidden reader", 1, 0)], obscured: true }));
    expect(vi.getTimerCount()).toBe(0);
    expect(toastHost().querySelector(".toast-host__toast--motion")).not.toBeNull();
    render(props({ inputs: [toast("hidden reader", 1, 0)], obscured: false }));
    expect(vi.getTimerCount()).toBe(1);
  });

  it("is visual-only, preserves focus, renders item icons, and applies tone classes", () => {
    const focusTarget = document.createElement("button");
    document.body.append(focusTarget);
    focusTarget.focus();
    const activeElement = document.activeElement;
    render(props({ inputs: [
      { ...toast("icon good", 1, 0), tone: "good", itemKind: "double" },
      { ...toast("plain bad", 1, 1), tone: "bad" },
    ] }));
    expect(toastHost().getAttribute("aria-hidden")).toBe("true");
    expect(toastHost().querySelector("[role], [aria-live], button, a, input, [tabindex]")).toBeNull();
    expect(toastHost().querySelectorAll(".item-icon")).toHaveLength(1);
    expect(toastHost().querySelector(".toast-host__toast--good")).not.toBeNull();
    expect(toastHost().querySelector(".toast-host__toast--bad")).not.toBeNull();
    expect(document.activeElement).toBe(activeElement);
  });
});
