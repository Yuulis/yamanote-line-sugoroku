// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createToastQueue, MAX_VISIBLE_TOASTS, saveFailureToast, toastQueueReducer, visibleToasts,
  type NoticeToastInput, type ToastInput, type ToastQueueAction, type ToastQueueState,
} from "../../src/features/game/toastQueue";
import { FIRST_TURN_NOTICE_TEXT } from "../../src/features/game/saveNotice";
import { ToastHost, type ToastHostProps } from "../../src/features/game/components/ToastHost";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const NOTICE_KEY = "7:notice:auto-resume";

function toast(key: string, turn: number, eventIndex: number): ToastInput {
  return { key, sessionId: 7, turn, eventIndex, text: key, tone: "neutral", sticky: false };
}

function notice(overrides: Partial<NoticeToastInput> = {}): NoticeToastInput {
  return {
    kind: "notice", key: NOTICE_KEY, sessionId: 7, turn: null, eventIndex: null,
    text: FIRST_TURN_NOTICE_TEXT, tone: "neutral", sticky: false, ...overrides,
  };
}

function dispatch(state: ToastQueueState, action: ToastQueueAction): ToastQueueState {
  return toastQueueReducer(state, action);
}

function enqueue(state: ToastQueueState, inputs: readonly ToastInput[]): ToastQueueState {
  return dispatch(state, { type: "enqueue", scope: state.scope, inputs });
}

function enqueueNotice(state: ToastQueueState, input: NoticeToastInput, scope = state.scope): ToastQueueState {
  return dispatch(state, { type: "enqueueNotice", scope, notice: input });
}

function keys(items: readonly ToastInput[]): string[] {
  return items.map((item) => item.key);
}

describe("toast queue notice entries", () => {
  it("notice bypasses and does not advance the turn cursor", () => {
    let state = enqueue(createToastQueue(7), [toast("turn-5", 5, 0)]);
    const cursor = state.cursor;
    state = enqueueNotice(state, notice({ turn: 1, eventIndex: 0 }));
    state = enqueueNotice(state, notice({ key: "ahead", turn: 9, eventIndex: 0 }));
    expect(state.cursor).toBe(cursor);
    state = enqueue(state, [toast("turn-5-later", 5, 1)]);
    expect(keys(state.items)).toEqual(["turn-5", NOTICE_KEY, "ahead", "turn-5-later"]);
    expect(enqueue(state, [notice({ key: "ordinary-path", turn: 9, eventIndex: 5 })])).toBe(state);
  });

  it("notice deduplicates within its scope", () => {
    const original = createToastQueue(7);
    let state = enqueueNotice(original, notice());
    expect(enqueueNotice(state, notice())).toBe(state);
    state = dispatch(state, { type: "expire", key: NOTICE_KEY });
    expect(state.items).toEqual([]);
    expect(enqueueNotice(state, notice())).toBe(state);
    expect(enqueueNotice(original, notice(), 8)).toBe(original);
    expect(enqueueNotice(original, notice({ sessionId: 8 }))).toBe(original);
    expect(enqueueNotice(original, notice({ sticky: true }))).toBe(original);
  });

  it("scope reset permits a new delivery", () => {
    let state = dispatch(enqueueNotice(createToastQueue(7), notice()), { type: "expire", key: NOTICE_KEY });
    state = enqueueNotice(dispatch(state, { type: "resetScope", sessionId: 7 }), notice());
    expect(keys(visibleToasts(state))).toEqual([NOTICE_KEY]);
    const next = notice({ key: "8:notice", sessionId: 8 });
    state = enqueueNotice(dispatch(state, { type: "resetScope", sessionId: 8 }), next);
    expect(keys(visibleToasts(state))).toEqual(["8:notice"]);
  });

  it("old-turn pruning retains waiting notices", () => {
    let state = enqueue(createToastQueue(7), [toast("a", 1, 0), toast("b", 1, 1)]);
    state = enqueue(enqueueNotice(state, notice()), [toast("c", 1, 2)]);
    state = enqueue(state, [toast("d", 2, 0)]);
    expect(keys(state.items)).toEqual(["a", "b", NOTICE_KEY, "d"]);
  });

  it("notice shares FIFO and two ordinary slots", () => {
    let state = enqueue(createToastQueue(7), [toast("a", 1, 0), toast("b", 1, 1)]);
    state = enqueue(enqueueNotice(state, notice()), [toast("c", 1, 2)]);
    expect(keys(visibleToasts(state))).toEqual(["a", "b"]);
    state = dispatch(state, { type: "expire", key: "a" });
    expect(keys(visibleToasts(state))).toEqual(["b", NOTICE_KEY]);
    state = dispatch(state, { type: "expire", key: "b" });
    expect(keys(visibleToasts(state))).toEqual([NOTICE_KEY, "c"]);
  });

  it("save failure retains its reserved slot", () => {
    let state = enqueue(createToastQueue(7), [toast("a", 1, 0)]);
    state = enqueue(enqueueNotice(state, notice()), [toast("b", 1, 1)]);
    state = dispatch(state, { type: "saveFailed" });
    expect(keys(visibleToasts(state))).toEqual(["a", NOTICE_KEY, saveFailureToast(7).key]);
    expect(visibleToasts(state)).toHaveLength(MAX_VISIBLE_TOASTS);
  });
});

describe("ToastHost notice", () => {
  let mounted: MountedReact | null = null;
  let visibilityDescriptor: PropertyDescriptor | undefined;
  const shown = vi.fn<(key: string) => void>();

  function props(overrides: Partial<ToastHostProps> = {}): ToastHostProps {
    return {
      sessionId: 7, inputs: [], saveFailed: false, obscured: false, reducedMotion: false,
      notice: notice(), announceable: true, onNoticeShown: shown, ...overrides,
    };
  }

  function render(next: ToastHostProps): void {
    if (!mounted) {
      mounted = mountReact(createElement(ToastHost, next));
      return;
    }
    act(() => mounted?.root.render(createElement(ToastHost, next)));
  }

  function hostText(): string {
    return mounted?.container.querySelector(".toast-host")?.textContent ?? "";
  }

  function advance(ms: number): void {
    act(() => vi.advanceTimersByTime(ms));
  }

  function setVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    shown.mockReset();
    visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    mounted?.cleanup();
    mounted = null;
    if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
    else Reflect.deleteProperty(document, "visibilityState");
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("obscuring pauses notice clocks", () => {
    render(props());
    advance(1000);
    render(props({ obscured: true }));
    advance(10_000);
    expect(hostText()).toContain(FIRST_TURN_NOTICE_TEXT);
    render(props());
    advance(2999);
    expect(hostText()).toContain(FIRST_TURN_NOTICE_TEXT);
    advance(1);
    expect(hostText()).not.toContain(FIRST_TURN_NOTICE_TEXT);
  });

  it("shown acknowledgement waits for visible unobscured announceable display", () => {
    const inputs = [toast("a", 1, 0), toast("b", 1, 1)];
    render(props({ inputs, announceable: false }));
    expect(hostText()).not.toContain(FIRST_TURN_NOTICE_TEXT);
    advance(4000);
    advance(10_000);
    expect(hostText()).toContain(FIRST_TURN_NOTICE_TEXT);
    setVisibility("hidden");
    render(props({ inputs }));
    render(props({ inputs, obscured: true }));
    setVisibility("visible");
    expect(shown).not.toHaveBeenCalled();
    render(props({ inputs }));
    expect(shown).toHaveBeenCalledExactlyOnceWith(NOTICE_KEY);
    expect(mounted?.container.querySelector(".toast-host")?.getAttribute("aria-hidden")).toBe("true");
    advance(3999);
    expect(hostText()).toContain(FIRST_TURN_NOTICE_TEXT);
    advance(1);
    expect(hostText()).not.toContain(FIRST_TURN_NOTICE_TEXT);
  });

  it("hidden to visible restores reading time and acknowledges once", () => {
    render(props());
    advance(1500);
    setVisibility("hidden");
    advance(10_000);
    expect(hostText()).toContain(FIRST_TURN_NOTICE_TEXT);
    setVisibility("visible");
    advance(3999);
    expect(hostText()).toContain(FIRST_TURN_NOTICE_TEXT);
    advance(1);
    expect(hostText()).not.toContain(FIRST_TURN_NOTICE_TEXT);
    expect(shown).toHaveBeenCalledExactlyOnceWith(NOTICE_KEY);
  });

  it("repeated renders acknowledge once", () => {
    for (const reducedMotion of [false, true, false]) {
      render(props({ reducedMotion, onNoticeShown: (key) => shown(key) }));
    }
    render(props({ obscured: true }));
    render(props());
    render(props({ announceable: false }));
    render(props({ notice: notice({ text: "copy" }) }));
    expect(shown).toHaveBeenCalledExactlyOnceWith(NOTICE_KEY);
  });

  it("acknowledges through the latest callback", () => {
    const first = vi.fn<(key: string) => void>();
    const latest = vi.fn<(key: string) => void>();
    render(props({ obscured: true, onNoticeShown: first }));
    render(props({ obscured: true, onNoticeShown: latest }));
    render(props({ onNoticeShown: latest }));
    expect(latest).toHaveBeenCalledExactlyOnceWith(NOTICE_KEY);
    expect(first).not.toHaveBeenCalled();
  });

  it("session reset clears acknowledgements", () => {
    render(props());
    render(props({ sessionId: null, notice: null }));
    render(props({ sessionId: 8, notice: notice({ key: "8:notice", sessionId: 8 }) }));
    expect(shown.mock.calls).toEqual([[NOTICE_KEY], ["8:notice"]]);
    render(props({ sessionId: null, notice: null }));
    render(props());
    expect(shown.mock.calls).toEqual([[NOTICE_KEY], ["8:notice"], [NOTICE_KEY]]);
  });
});
