// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { describe, expect, it } from "vitest";
import { GameHud, type GameHudProps } from "../../src/features/game/components/GameHud";
import { TargetProgressBar } from "../../src/features/game/components/TargetProgressBar";
import type { MilestoneFlash } from "../../src/features/game/progressMilestones";
import { mountReact } from "./helpers/reactDom";

const FLASH: MilestoneFlash = { key: "session:turn:10", threshold: 10 };

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
