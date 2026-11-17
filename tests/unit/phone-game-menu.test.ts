// @vitest-environment jsdom
import { createElement, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { translateSurfaceForLayout } from "../../src/features/game/components/GamePanel";
import { GameMenu, type GameMenuProps } from "../../src/features/game/components/GameMenu";
import { PhoneGameMenu, type PhoneGameMenuProps } from "../../src/features/game/components/PhoneGameMenu";
import { TurnLogDrawer, type TurnLogDrawerProps } from "../../src/features/game/components/TurnLogDrawer";
import type { CollectionProgress } from "../../src/features/game/collectionProgress";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";

const COLLECTION: CollectionProgress = {
  visitedStations: 2, totalStations: 1586, riddenLines: 1, totalLines: 134,
  stationsText: "訪れた駅 2/1,586", linesText: "乗った路線 1/134",
};

function phoneMenuProps(overrides: Partial<PhoneGameMenuProps> = {}): PhoneGameMenuProps {
  return {
    expanded: true, section: "log", collection: COLLECTION,
    openerRef: createRef<HTMLElement | null>(), triggerRef: createRef<HTMLButtonElement | null>(),
    onExpandedChange: vi.fn(), onSectionChange: vi.fn(),
    log: createElement("section", { "aria-label": "ターンのログ" }, createElement("button", null, "ログ操作")),
    settings: createElement("section", { "aria-label": "メニュー" }, createElement("button", null, "設定操作")),
    ...overrides,
  };
}

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

  it("switches sections and keeps the unselected content hidden", () => {
    const props = phoneMenuProps();
    props.openerRef.current = document.createElement("button");
    const mount = mountReact(createElement(PhoneGameMenu, props));
    try {
      const settingsButton = [...mount.container.querySelectorAll(".phone-menu__section-button")].find((button) => button.textContent === "設定");
      if (!settingsButton) throw new Error("Missing settings section button");
      dispatchReactEvent(settingsButton, new MouseEvent("click", { bubbles: true }));
      expect(props.onSectionChange).toHaveBeenCalledWith("settings");
      expect(props.openerRef.current).toBeNull();
      mount.render(createElement(PhoneGameMenu, { ...props, section: "settings" }));
      const sections = [...mount.container.querySelectorAll<HTMLElement>(".phone-menu__section")];
      if (sections.length !== 2) throw new Error(`Expected two phone menu sections, got ${sections.length}`);
      expect(sections[0]?.hidden).toBe(true);
      expect(sections[0]?.querySelector("button")?.closest("[hidden]")).toBe(sections[0]);
      expect(sections[1]?.hidden).toBe(false);
    } finally { mount.cleanup(); }
  });

  it("owns Escape, yields to a native dialog, and returns focus to the visible opener or trigger", () => {
    const openerRef = createRef<HTMLElement | null>();
    const triggerRef = createRef<HTMLButtonElement | null>();
    const onExpandedChange = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    Object.defineProperty(opener, "getClientRects", { value: () => [new DOMRect()] });
    openerRef.current = opener;
    const mount = mountReact(createElement(PhoneGameMenu, phoneMenuProps({ openerRef, triggerRef, onExpandedChange })));
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    try {
      const modalEscape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      window.dispatchEvent(modalEscape);
      expect(modalEscape.defaultPrevented).toBe(false);
      expect(onExpandedChange).not.toHaveBeenCalled();

      dialog.remove();
      const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      window.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(onExpandedChange).toHaveBeenCalledWith(false);
      expect(document.activeElement).toBe(opener);

      opener.remove();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      expect(document.activeElement).toBe(triggerRef.current);
    } finally { mount.cleanup(); opener.remove(); dialog.remove(); }
  });
});

describe("breakpoint translation of the open disclosure", () => {
  it.each([
    ["log", true, "log", { surface: "phone-menu", section: "log" }],
    ["menu", true, "log", { surface: "phone-menu", section: "settings" }],
    ["phone-menu", false, "log", { surface: "log", section: "log" }],
    ["phone-menu", false, "settings", { surface: "menu", section: "settings" }],
    ["card", true, "log", { surface: "card", section: "log" }],
    ["card", false, "settings", { surface: "card", section: "settings" }],
    [null, true, "log", { surface: null, section: "log" }],
  ] as const)("maps %s (phone=%s, section=%s) to the equivalent surface", (current, phone, section, expected) => {
    expect(translateSurfaceForLayout(current, phone, section)).toEqual(expected);
  });
});
