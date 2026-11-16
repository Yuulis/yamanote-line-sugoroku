// @vitest-environment jsdom
import { createElement, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { GameMenu, type GameMenuProps } from "../../src/features/game/components/GameMenu";
import { TurnLogDrawer, type TurnLogDrawerProps } from "../../src/features/game/components/TurnLogDrawer";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";

function menuProps(overrides: Partial<GameMenuProps> = {}): GameMenuProps {
  return {
    expanded: true, onExpandedChange: vi.fn(), follow: true, reducedMotion: false, speedLabel: "ふつう",
    presentationLevel: "all", lines: [], targetColor: undefined, selectedGroupIds: null,
    onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onCyclePresentation: vi.fn(), onNewGame: vi.fn(),
    onShowTitle: vi.fn(), onToggleGroup: vi.fn(), onSetOperator: vi.fn(), onShowAll: vi.fn(), ...overrides,
  };
}

function logProps(overrides: Partial<TurnLogDrawerProps> = {}): TurnLogDrawerProps {
  return {
    expanded: true, onExpandedChange: vi.fn(), logRegionId: "turn-log", logOpenerRef: createRef<HTMLElement>(),
    arrival: null, roll: "1マス", lottery: null, notice: null, routeSummary: null, candidates: null, effectTexts: [],
    ...overrides,
  };
}

describe("embedded phone disclosures", () => {
  it("omit their triggers and Escape listeners when embedded", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const mount = mountReact(createElement("div", null,
      createElement(TurnLogDrawer, {
        ...logProps({ progress: createElement("p", { "data-testid": "progress" }, "progress") }), embedded: true,
      }),
      createElement(GameMenu, { ...menuProps(), embedded: true }),
    ));
    try {
      expect(mount.container.querySelectorAll(".game-panel__log-trigger, .game-panel__menu-trigger")).toHaveLength(0);
      expect(addEventListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
      const log = mount.container.querySelector<HTMLElement>("#turn-log")!;
      expect(log.getAttribute("aria-label")).toBe("ターンのログ");
      expect(log.querySelector('[data-stat="roll"]')?.textContent).toBe("1マス");
      expect(log.lastElementChild?.getAttribute("data-testid")).toBe("progress");
      expect(mount.container.querySelector(".game-panel__menu")?.getAttribute("aria-label")).toBe("メニュー");
    } finally {
      mount.cleanup();
      addEventListener.mockRestore();
    }
  });

  it("keeps both legacy triggers when not embedded", () => {
    const mount = mountReact(createElement("div", null,
      createElement(TurnLogDrawer, logProps()),
      createElement(GameMenu, menuProps()),
    ));
    try {
      expect(mount.container.querySelectorAll(".game-panel__log-trigger")).toHaveLength(1);
      expect(mount.container.querySelectorAll(".game-panel__menu-trigger")).toHaveLength(1);
      expect(mount.container.querySelector("#turn-log")?.getAttribute("aria-label")).toBe("ターンのログ");
      expect(mount.container.querySelector(".game-panel__menu")?.getAttribute("aria-label")).toBe("メニュー");
    } finally { mount.cleanup(); }
  });

  it.each(["新規", "タイトル"] as const)("returns focus to the parent trigger for %s", (label) => {
    const parentTriggerRef = createRef<HTMLElement>();
    const mount = mountReact(createElement("div", null,
      createElement("button", { ref: parentTriggerRef, type: "button" }, "親メニュー"),
      createElement(GameMenu, { ...menuProps(), embedded: true, parentTriggerRef }),
    ));
    try {
      const action = [...mount.container.querySelectorAll(".game-panel__options button")]
        .find((button) => button.textContent === label);
      if (!action) throw new Error(`Missing embedded menu action: ${label}`);
      dispatchReactEvent(action, new MouseEvent("click", { bubbles: true }));
      expect(document.activeElement).toBe(parentTriggerRef.current);
    } finally { mount.cleanup(); }
  });
});
