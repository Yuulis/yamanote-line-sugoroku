// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { describe, expect, it } from "vitest";
import { GameHud, type GameHudProps } from "../../src/features/game/components/GameHud";
import { TargetProgressBar } from "../../src/features/game/components/TargetProgressBar";
import type { MilestoneFlash } from "../../src/features/game/progressMilestones";
import { mountReact } from "./helpers/reactDom";

const FLASH: MilestoneFlash = { key: "session:turn:10", threshold: 10 };
const PROXIMITY = { hops: 7, trend: "closer", text: "山手線まで あと7駅（近づく）" } as const;
const COLLECTION = {
  visitedStations: 4, totalStations: 1_586, riddenLines: 2, totalLines: 134,
  stationsText: "訪れた駅 4/1,586", linesText: "乗った路線 2/134",
} as const;

function hudProps(overrides: Partial<GameHudProps> = {}): GameHudProps {
  return {
    title: "山手線すごろく", subtitle: "東京近郊版", headingRef: createRef<HTMLHeadingElement>(),
    station: "東京", ride: "山手線", lineBadge: { groupId: "jr-yamanote", code: "JY", color: "#80c241", name: "山手線", textColor: "#000000" },
    direction: "外回り", turn: 5, completed: 10, required: 30, compactRoll: "3マス", saveStatus: null,
    saveStatusMessage: "未保存", canRoll: true, canSkip: false, autoRollEnabled: false, animating: false,
    draftSelected: false, rollButtonRef: createRef<HTMLButtonElement>(), onRoll: () => undefined,
    onSkip: () => undefined, onToggleAutoRoll: () => undefined, effects: [], ...overrides,
  };
}

describe("HUD progress components", () => {
  it("renders proximity as two lines and both collection counters", () => {
    const mount = mountReact(createElement(GameHud, hudProps({ proximity: PROXIMITY, collection: COLLECTION })));
    try {
      const row = mount.container.querySelector<HTMLElement>(".hud-progress");
      const proximity = row?.querySelector(".hud-progress__proximity");
      const proximityLines = proximity?.querySelectorAll("span");
      expect(row).not.toBeNull();
      expect(proximityLines?.[0]?.textContent).toBe("山手線まで あと7駅");
      expect(proximityLines?.[1]?.textContent).toBe("（近づく）");
      expect(row?.querySelector(".hud-progress__stations")?.textContent).toBe(COLLECTION.stationsText);
      expect(row?.querySelector(".hud-progress__lines")?.textContent).toBe(COLLECTION.linesText);
    } finally {
      mount.cleanup();
    }
  });

  it("keeps the row and collection counters when proximity is absent", () => {
    const mount = mountReact(createElement(GameHud, hudProps({ proximity: null, collection: COLLECTION })));
    try {
      const row = mount.container.querySelector<HTMLElement>(".hud-progress");
      expect(row).not.toBeNull();
      expect(row?.querySelector(".hud-progress__proximity")?.textContent).toBe("");
      expect(row?.querySelector(".hud-progress__stations")?.textContent).toBe(COLLECTION.stationsText);
      expect(row?.querySelector(".hud-progress__lines")?.textContent).toBe(COLLECTION.linesText);
    } finally {
      mount.cleanup();
    }
  });

  it("keeps the progressbar mounted while keyed flash nodes follow the milestone key", () => {
    const mount = mountReact(createElement(TargetProgressBar, { completed: 10, required: 30, milestoneFlash: FLASH }));
    try {
      const progressbar = mount.container.querySelector<HTMLElement>("[role=progressbar]");
      const firstFlash = mount.container.querySelector<HTMLElement>(".target-progress__flash");
      expect(firstFlash?.getAttribute("aria-hidden")).toBe("true");

      act(() => mount.root.render(createElement(TargetProgressBar, {
        completed: 10, required: 30, milestoneFlash: { ...FLASH },
      })));
      expect(mount.container.querySelector(".target-progress__flash")).toBe(firstFlash);
      expect(mount.container.querySelector("[role=progressbar]")).toBe(progressbar);
      expect(progressbar?.getAttribute("aria-valuenow")).toBe("10");

      act(() => mount.root.render(createElement(TargetProgressBar, {
        completed: 11, required: 30, milestoneFlash: { key: "session:turn:20", threshold: 20 },
      })));
      expect(mount.container.querySelector(".target-progress__flash")).not.toBe(firstFlash);
      expect(mount.container.querySelector("[role=progressbar]")).toBe(progressbar);
      expect(progressbar?.getAttribute("aria-valuenow")).toBe("11");
    } finally {
      mount.cleanup();
    }
  });

  it("omits a null flash and uses guidance instead of the bar at 30", () => {
    const mount = mountReact(createElement(GameHud, hudProps({ milestoneFlash: null })));
    try {
      expect(mount.container.querySelector(".target-progress__flash")).toBeNull();
      act(() => mount.root.render(createElement(GameHud, hudProps({ milestoneFlash: FLASH }))));
      expect(mount.container.querySelector(".target-progress__flash")).not.toBeNull();
      act(() => mount.root.render(createElement(GameHud, hudProps({
        completed: 30, milestoneFlash: FLASH, goalGuidanceText: "山手線を一周しました。",
      }))));
      expect(mount.container.querySelector(".target-progress--guidance")).not.toBeNull();
      expect(mount.container.querySelector("[role=progressbar]")).toBeNull();
      expect(mount.container.querySelector(".target-progress__flash")).toBeNull();
    } finally {
      mount.cleanup();
    }
  });
});
