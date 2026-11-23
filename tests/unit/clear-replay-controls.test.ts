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
  turnSpans: [{ recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1 }],
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
});
