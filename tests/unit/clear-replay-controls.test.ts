// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ClearRoute } from "../../src/features/game/clearResult";
import { createClearReplayStore, type ClearReplayStore } from "../../src/features/game/clearReplayStore";
import type { HistoryRow } from "../../src/features/game/historyRows";
import { ClearReplayControls, ClearReplayMapCaption } from "../../src/features/game/components/ClearReplayControls";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const route: ClearRoute = {
  steps: [{
    segmentId: "segment-1", fromStationId: "a", toStationId: "b", newlyCompleted: false,
    points: [[139, 35], [139.1, 35.1]], cumulative: [0, 1], total: 1,
  }],
  legs: [{ firstStepIndex: 0, endStepIndexExclusive: 1, serviceId: "line", lineGroupId: "group", color: "#0088cc" }],
  turnSpans: [0, 1, 2].map((recordIndex) => ({ recordIndex, firstStepIndex: 0, endStepIndexExclusive: 1 })),
  bounds: [[139, 35], [139.1, 35.1]],
};

const row: HistoryRow = {
  kind: "item-ride", recordIndex: 0, turn: 12, turnText: "12ターン目", rawRoll: 3, effectiveRoll: 4,
  adjusted: true, effectKinds: ["rapid"], effectText: "快速", fromStationName: "東京", toStationName: "南町田グランベリーパーク",
  hopCount: 13, lineName: "東急田園都市線", directionText: "中央林間方面", rollText: "出目3→4・快速",
  moveText: "東京 → 南町田グランベリーパーク（13駅）", lineText: "東急田園都市線・中央林間方面", notes: [],
};

let mounted: MountedReact | undefined;
let store: ClearReplayStore | undefined;
afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  store?.dispose();
  store = undefined;
});

function createStore(): ClearReplayStore {
  store = createClearReplayStore({ route, scheduler: { request: () => 1, cancel: () => {}, now: () => 0 } });
  return store;
}

function changeRangeValue(range: HTMLInputElement, value: number): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setValue) throw new Error("The native range value setter is unavailable");
  setValue.call(range, String(value));
  range.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("clear replay controls and caption", () => {
  it("renders the full structured caption with a dedicated station ellipsis span", () => {
    const replay = createStore();
    replay.start();
    mounted = mountReact(createElement(ClearReplayMapCaption, { store: replay, rows: [row] }));
    const caption = mounted.container.querySelector(".clear-replay-caption")!;
    expect(caption.textContent).toBe("12ターン目：出目3→4・快速→南町田グランベリーパーク");
    expect(caption.getAttribute("aria-label")).toBe("12ターン目：出目3→4・快速 → 南町田グランベリーパーク");
    expect(mounted.container.querySelector(".clear-replay-caption__roll")?.textContent).toBe("出目3→4・快速");
    expect(caption.querySelector(".clear-replay-caption__station")?.textContent).toBe("南町田グランベリーパーク");
    expect(caption.querySelector(".clear-replay-caption__station")?.className).toBe("clear-replay-caption__station");
    expect(caption.hasAttribute("aria-live")).toBe(false);
  });

  it("uses full-route wording for reduced motion and exposes all speed presets", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: true, onAnnounce: () => {},
    }));
    expect(mounted.container.querySelector(".clear-replay-controls__start")?.textContent).toBe("全経路を表示");
    act(() => replay.start());
    expect(replay.getSnapshot().phase).toBe("done");
    expect(mounted.container.querySelector(".clear-replay-controls__turn")).toBeNull();

    act(() => {
      replay.setReducedMotion(false);
      mounted!.root.render(createElement(ClearReplayControls, { store: replay, reducedMotion: false, onAnnounce: () => {} }));
      replay.start();
    });
    expect(mounted.container.querySelector(".clear-replay-controls__speeds")?.textContent).toBe("ゆっくりふつうはやい");
  });

  it("marks normal speed by default and updates the pressed speed on click", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.start());
    const speeds = mounted.container.querySelectorAll<HTMLButtonElement>(".clear-replay-controls__speed");
    expect(speeds[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(speeds[1]?.getAttribute("aria-pressed")).toBe("true");
    act(() => speeds[2]?.click());
    expect(speeds[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(speeds[2]?.getAttribute("aria-pressed")).toBe("true");
    expect(replay.getSpeed()).toBe("fast");
  });

  it("shows the playing, paused, done, and expanded result control sets", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));

    act(() => replay.start());
    expect(mounted.container.querySelector(".clear-replay-controls__start")).toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__active")?.textContent)
      .toContain("一時停止");
    expect(mounted.container.querySelector(".clear-replay-controls__turn")).not.toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__active")?.textContent)
      .toContain("全経路を表示");
    expect(mounted.container.querySelector(".clear-replay-controls__results")).toBeNull();

    act(() => replay.pause());
    expect(mounted.container.querySelector(".clear-replay-controls__active")?.textContent)
      .toContain("再開");
    expect(mounted.container.querySelector(".clear-replay-controls__turn")).not.toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__results")?.textContent)
      .toBe("結果を表示");

    act(() => replay.finish());
    expect(mounted.container.querySelector(".clear-replay-controls__active")).toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__start")).toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__turn")).not.toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__results")?.textContent)
      .toBe("結果を表示");

    act(() => replay.showResults());
    expect(mounted.container.querySelector(".clear-replay-controls__results")).toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__turn")).toBeNull();
    expect(mounted.container.querySelector(".clear-replay-controls__start")?.textContent)
      .toBe("軌跡を再生");
  });

  it("labels the one-based range and reflects the first and last saved turns", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.start());

    const range = mounted.container.querySelector<HTMLInputElement>("input[type='range']")!;
    const label = mounted.container.querySelector<HTMLLabelElement>(".clear-replay-controls__turn-label")!;
    const previous = mounted.container.querySelector<HTMLButtonElement>(".clear-replay-controls__step[aria-label='前のターン']")!;
    const next = mounted.container.querySelector<HTMLButtonElement>(".clear-replay-controls__step[aria-label='次のターン']")!;
    expect(label.textContent).toBe("ターン");
    expect(label.htmlFor).toBe(range.id);
    expect([range.min, range.max, range.step, range.value]).toEqual(["1", "3", "1", "1"]);
    expect(range.getAttribute("aria-valuetext")).toBe("1 / 3 ターン");
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    act(() => replay.seek(2));
    expect(range.value).toBe("3");
    expect(range.getAttribute("aria-valuetext")).toBe("3 / 3 ターン");
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);

    act(() => replay.pause());
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  it("keeps both step buttons available in done and routes either one to the first turn", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.finish());

    const range = mounted.container.querySelector<HTMLInputElement>("input[type='range']")!;
    const label = mounted.container.querySelector<HTMLLabelElement>(".clear-replay-controls__turn-label")!;
    const previous = mounted.container.querySelector<HTMLButtonElement>(".clear-replay-controls__step[aria-label='前のターン']")!;
    const next = mounted.container.querySelector<HTMLButtonElement>(".clear-replay-controls__step[aria-label='次のターン']")!;
    expect(label.textContent).toBe("全経路");
    expect([range.min, range.max, range.value]).toEqual(["1", "3", "3"]);
    expect(range.getAttribute("aria-valuetext")).toBe("全経路（3ターン完了）");
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(false);

    act(() => previous.click());
    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    act(() => replay.finish());
    act(() => mounted!.container.querySelector<HTMLButtonElement>(".clear-replay-controls__step[aria-label='次のターン']")!.click());
    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
  });

  it("keeps the same range element when the first input seeks away from done", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.finish());
    const range = mounted.container.querySelector<HTMLInputElement>("input[type='range']")!;

    act(() => changeRangeValue(range, 2));

    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
    expect(mounted.container.querySelector("input[type='range']")).toBe(range);
  });

  it("hands focus to the range only when a focused step button becomes disabled", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.start());
    act(() => replay.seek(2));
    act(() => replay.pause());
    const range = mounted.container.querySelector<HTMLInputElement>("input[type='range']")!;
    const previous = mounted.container.querySelector<HTMLButtonElement>("button[aria-label='前のターン']")!;

    previous.focus();
    act(() => previous.click());
    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
    expect(document.activeElement).toBe(previous);

    act(() => previous.click());
    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    expect(previous.disabled).toBe(true);
    expect(document.activeElement).toBe(range);
  });

  it("hands focus from the previous button to the range when stepping from done", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.finish());
    const range = mounted.container.querySelector<HTMLInputElement>("input[type='range']")!;
    const previous = mounted.container.querySelector<HTMLButtonElement>("button[aria-label='前のターン']")!;

    previous.focus();
    act(() => previous.click());

    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    expect(previous.disabled).toBe(true);
    expect(document.activeElement).toBe(range);
  });

  it("passes a zero-based seek index and preserves playing or paused state", () => {
    const replay = createStore();
    mounted = mountReact(createElement(ClearReplayControls, {
      store: replay, reducedMotion: false, onAnnounce: () => {},
    }));
    act(() => replay.start());
    const range = mounted.container.querySelector<HTMLInputElement>("input[type='range']")!;

    act(() => {
      changeRangeValue(range, 2);
    });
    expect(replay.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 1 });

    act(() => replay.pause());
    act(() => {
      changeRangeValue(range, 3);
    });
    expect(replay.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 2 });
  });
});
