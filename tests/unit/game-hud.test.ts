// @vitest-environment jsdom
import { act, createElement, createRef, useEffect, useState } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GameHud } from "../../src/features/game/components/GameHud";
import type { GameHudProps } from "../../src/features/game/components/GameHud";
import { GameMenu } from "../../src/features/game/components/GameMenu";
import type { GameMenuProps } from "../../src/features/game/components/GameMenu";
import { GamePanel } from "../../src/features/game/components/GamePanel";
import { buildRailwayNetwork, createItemGame } from "../../src/features/game/engine";
import { resumeSession } from "../../src/features/game/gameSession";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { itemSessionView } from "../../src/features/game/itemSession";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";

function props(overrides: Partial<GameHudProps> = {}): GameHudProps {
  return {
    title: "山手線すごろく", subtitle: "東京近郊版", headingRef: createRef<HTMLHeadingElement>(),
    station: "東京", ride: "山手線", lineBadge: { groupId: "jr-yamanote", code: "JY", color: "#80c241", name: "山手線", textColor: "#000000" },
    direction: "外回り", turn: 5, completed: 3, required: 30, roll: "3マス", saveStatus: null,
    saveStatusMessage: "未保存", canRoll: true, animating: false, draftSelected: false,
    rollButtonRef: createRef<HTMLButtonElement>(), onRoll: vi.fn(), onSkip: vi.fn(), effects: [], ...overrides,
  };
}

function Harness({ value }: { value: GameHudProps }): React.JSX.Element {
  return createElement(GameHud, value);
}

function menuProps(overrides: Partial<GameMenuProps> = {}): GameMenuProps {
  return {
    follow: true, reducedMotion: false, speedLabel: "ふつう", lines: [
      { id: "jr-yamanote", name: "山手線", color: "#80c241", operatorId: "JR東日本", serviceIds: ["jr-yamanote"] },
    ], targetColor: "#80c241", selectedGroupIds: null,
    onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn(),
    onToggleGroup: vi.fn(), onSetOperator: vi.fn(), onShowAll: vi.fn(), ...overrides,
  };
}

function MenuHarness({ value }: { value: GameMenuProps }): React.JSX.Element {
  return createElement(GameMenu, value);
}

function DraftEscapeHarness({ value }: { value: GameMenuProps }): React.JSX.Element {
  const [draft, setDraft] = useState(true);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) setDraft(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return createElement("div", null, createElement(MenuHarness, { value }), createElement("span", { "data-testid": "draft" }, String(draft)));
}

describe("GameHud", () => {
  it("renders six labelled stats, a separate badge and straight progress bar", () => {
    const mount = mountReact(createElement(GameHud, props()));
    try {
      expect(mount.container.querySelectorAll(".game-panel__stats dt")).toHaveLength(6);
      expect(mount.container.querySelector("[data-stat=ride]")?.textContent).toBe("山手線");
      expect(mount.container.querySelector("[data-stat=ride]")?.getAttribute("title")).toBe("山手線");
      expect(mount.container.querySelector("[data-stat=roll]")?.getAttribute("title")).toBe("3マス");
      expect([...mount.container.querySelectorAll(".hud-stat__value")].every((value) => value.hasAttribute("title"))).toBe(true);
      expect(mount.container.querySelector("[data-stat=ride]")?.previousElementSibling?.classList.contains("line-badge")).toBe(true);
      expect(mount.container.querySelector("[data-stat=progress]")?.nextElementSibling?.getAttribute("role")).toBe("progressbar");
      expect(mount.container.querySelector("[role=progressbar]")?.getAttribute("aria-valuemax")).toBe("30");
      expect(mount.container.querySelectorAll("[role=status]")).toHaveLength(0);
    } finally {
      mount.cleanup();
    }
  });

  it("keeps the three dice labels exact and suppresses clicks while moving", () => {
    const onRoll = vi.fn();
    const initial = props({ onRoll });
    const mount = mountReact(createElement(Harness, { value: initial }));
    try {
      const button = mount.container.querySelector<HTMLButtonElement>(".game-panel__roll")!;
      expect(initial.rollButtonRef.current).toBe(button);
      expect(button.textContent).toBe("サイコロを振る");
      expect(button.classList.contains("button-cta")).toBe(true);
      dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).toHaveBeenCalledTimes(1);
      act(() => mount.root.render(createElement(Harness, { value: { ...initial, canRoll: false, animating: true } })));
      expect(button.textContent).toBe("移動中…");
      expect(button.getAttribute("aria-disabled")).toBe("true");
      dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).toHaveBeenCalledTimes(1);
      act(() => mount.root.render(createElement(Harness, { value: { ...initial, canRoll: false, draftSelected: true } })));
      expect(button.textContent).toBe("この内容でサイコロを振る");
    } finally {
      mount.cleanup();
    }
  });

  it("shows full save text, hiding only the successful indicator label", () => {
    const saved = mountReact(createElement(GameHud, props({ saveStatus: "saved", saveStatusMessage: "自動保存済み" })));
    const failed = mountReact(createElement(GameHud, props({ saveStatus: "failed", saveStatusMessage: "保存に失敗しました（この進行は未保存です）" })));
    const unavailable = mountReact(createElement(GameHud, props({ saveStatus: "unavailable", saveStatusMessage: "この環境では保存できません" })));
    const empty = mountReact(createElement(GameHud, props({ saveStatus: null, saveStatusMessage: "未保存" })));
    try {
      expect(saved.container.querySelector(".game-panel__save")?.querySelector(".visually-hidden")?.textContent).toBe("セーブ: 自動保存済み");
      expect(saved.container.querySelector(".game-panel__save")?.getAttribute("title")).toBe("セーブ: 自動保存済み");
      expect(saved.container.querySelector(".game-panel__save svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(saved.container.querySelector(".game-panel__header .game-panel__save")).not.toBeNull();
      expect(failed.container.querySelector(".game-panel__save")?.textContent).toContain("セーブ: 保存に失敗しました");
      expect(failed.container.querySelector(".game-panel__header .game-panel__save")).toBeNull();
      expect(failed.container.querySelector(".game-panel__actions")!.compareDocumentPosition(failed.container.querySelector(".game-panel__save")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(failed.container.querySelector(".game-panel__save--warning")).not.toBeNull();
      expect(unavailable.container.querySelector(".game-panel__save")?.textContent).toContain("この環境では保存できません");
      expect(empty.container.querySelector(".game-panel__save")?.textContent).toBe("セーブ: 未保存");
      for (const mount of [failed, unavailable, empty]) {
        const actions: Element = mount.container.querySelector(".game-panel__actions")!;
        const save: Element = mount.container.querySelector(".game-panel__save")!;
        expect(actions.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(mount.container.querySelector(".game-panel__header .game-panel__save")).toBeNull();
      }
      for (const mount of [saved, failed, unavailable, empty]) {
        expect(mount.container.querySelector(".game-panel__save")?.hasAttribute("role")).toBe(false);
      }
    } finally {
      for (const mount of [saved, failed, unavailable, empty]) mount.cleanup();
    }
  });
});

describe("GameMenu", () => {
  it("starts closed with a labelled mounted section, four actions, and the legend inside", () => {
    const mount = mountReact(createElement(MenuHarness, { value: menuProps() }));
    try {
      const trigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
      const region = mount.container.querySelector("section.game-panel__menu")!;
      expect(trigger.textContent).toBe("メニュー");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-controls")).toBe(region.id);
      expect(region.getAttribute("aria-label")).toBe("メニュー");
      expect((region as HTMLElement).hidden).toBe(true);
      expect(region.hasAttribute("role")).toBe(false);
      expect(region.querySelectorAll('[role="menu"]')).toHaveLength(0);
      expect([...region.querySelectorAll(".game-panel__options button")].map((button) => button.textContent?.trim())).toEqual([
        "追尾: ON", "速度: ふつう", "新規", "タイトル",
      ]);
      expect(region.querySelectorAll(".game-panel__options button")).toHaveLength(4);
      expect(region.querySelector(".game-panel__legend-section")).not.toBeNull();
    } finally {
      mount.cleanup();
    }
  });

  it("closes and reopens while restoring focus and retaining legend expansion", () => {
    const mount = mountReact(createElement(MenuHarness, { value: menuProps() }));
    try {
      const trigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
      const region = mount.container.querySelector<HTMLElement>(".game-panel__menu")!;
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const legendToggle = mount.container.querySelector<HTMLButtonElement>(".game-panel__legend-toggle")!;
      const initialLegend = legendToggle.getAttribute("aria-expanded");
      dispatchReactEvent(legendToggle, new MouseEvent("click", { bubbles: true }));
      const wasExpanded = legendToggle.getAttribute("aria-expanded");
      expect(wasExpanded).not.toBe(initialLegend);
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(region.hidden).toBe(true);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(region.hidden).toBe(false);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(legendToggle.getAttribute("aria-expanded")).toBe(wasExpanded);
    } finally {
      mount.cleanup();
    }
  });

  it("focuses its trigger before starting a new game and closes the region", () => {
    const triggerSeenAtRequest: boolean[] = [];
    let mount: ReturnType<typeof mountReact>;
    const onNewGame = vi.fn(() => {
      triggerSeenAtRequest.push(document.activeElement === mount.container.querySelector(".game-panel__menu-trigger"));
    });
    mount = mountReact(createElement(MenuHarness, { value: menuProps({ onNewGame }) }));
    try {
      dispatchReactEvent(mount.container.querySelector(".game-panel__menu-trigger")!, new MouseEvent("click", { bubbles: true }));
      expect(mount.container.querySelector(".game-panel__menu")?.hasAttribute("hidden")).toBe(false);
      dispatchReactEvent(mount.container.querySelector(".game-panel__options button:nth-child(3)")!, new MouseEvent("click", { bubbles: true }));
      expect(onNewGame).toHaveBeenCalledOnce();
      expect(triggerSeenAtRequest).toEqual([true]);
      expect(mount.container.querySelector(".game-panel__menu")?.hasAttribute("hidden")).toBe(true);
      expect(mount.container.querySelector(".game-panel__menu-trigger")?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      mount.cleanup();
    }
  });

  it("closes on Escape before draft handling, then lets a second Escape clear the draft", () => {
    const mount = mountReact(createElement(DraftEscapeHarness, { value: menuProps() }));
    try {
      const trigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const firstEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => window.dispatchEvent(firstEscape));
      expect(firstEscape.defaultPrevented).toBe(true);
      expect(mount.container.querySelector("[data-testid=draft]")?.textContent).toBe("true");
      expect(mount.container.querySelector(".game-panel__menu")?.hasAttribute("hidden")).toBe(true);
      expect(document.activeElement).toBe(trigger);
      const secondEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => window.dispatchEvent(secondEscape));
      expect(secondEscape.defaultPrevented).toBe(false);
      expect(mount.container.querySelector("[data-testid=draft]")?.textContent).toBe("false");
    } finally {
      mount.cleanup();
    }
  });

  it("leaves Escape to an open native modal dialog and stays expanded", () => {
    const mount = mountReact(createElement(MenuHarness, { value: menuProps() }));
    dispatchReactEvent(mount.container.querySelector(".game-panel__menu-trigger")!, new MouseEvent("click", { bubbles: true }));
    expect(mount.container.querySelector(".game-panel__menu-trigger")?.getAttribute("aria-expanded")).toBe("true");
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    try {
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => dialog.dispatchEvent(escape));
      expect(escape.defaultPrevented).toBe(false);
      expect(mount.container.querySelector(".game-panel__menu")?.hasAttribute("hidden")).toBe(false);
      expect(mount.container.querySelector(".game-panel__menu-trigger")?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      dialog.remove();
      mount.cleanup();
    }
  });

  it("in the panel, Escape closes the menu, then yields to an open modal, then clears the staged draft", () => {
    const network = buildRailwayNetwork(multiServiceInput());
    const game = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "menu-escape", network);
    const session = resumeSession(game, network);
    const itemView = { ...itemSessionView(session, network)!, draft: { items: [{ kind: "double" as const, instanceId: "double-1" }] } };
    const onEditItemDraft = vi.fn();
    const mount = mountReact(createElement(GamePanel, {
      network, lines: [], session, itemView, onEditItemDraft, displayedStationId: game.currentStationId,
      displayedCompletedCount: 0, requiredCount: 4, saveStatus: "saved", follow: true, speedLabel: "標準", reducedMotion: false,
      onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn(),
    }));
    const dialog = document.createElement("dialog");
    try {
      const escape = (): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        act(() => window.dispatchEvent(event));
        return event;
      };
      const trigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(escape().defaultPrevented).toBe(true);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
      expect(onEditItemDraft).not.toHaveBeenCalled();

      dialog.setAttribute("open", "");
      document.body.append(dialog);
      expect(escape().defaultPrevented).toBe(false);
      expect(onEditItemDraft).not.toHaveBeenCalled();

      dialog.remove();
      expect(escape().defaultPrevented).toBe(true);
      expect(onEditItemDraft).toHaveBeenCalledExactlyOnceWith({ items: [] });
    } finally {
      dialog.remove();
      mount.cleanup();
    }
  });

  it("renders decorative menu and state chevrons without changing the trigger name", () => {
    const mount = mountReact(createElement(MenuHarness, { value: menuProps() }));
    try {
      const trigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
      const icon = trigger.querySelector(".game-panel__menu-icon")!;
      const chevron = trigger.querySelector(".game-panel__menu-chevron path")!;
      const closedPath = chevron.getAttribute("d");
      expect(trigger.textContent).toBe("メニュー");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(chevron.closest("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(trigger.querySelectorAll("title, text")).toHaveLength(0);
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(trigger.querySelector(".game-panel__menu-chevron path")?.getAttribute("d")).not.toBe(closedPath);
      expect(trigger.textContent).toBe("メニュー");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    } finally {
      mount.cleanup();
    }
  });

  it("opens by activation while focus stays on the trigger", () => {
    const mount = mountReact(createElement(MenuHarness, { value: menuProps() }));
    try {
      const trigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
      act(() => trigger.focus());
      dispatchReactEvent(trigger, new MouseEvent("click", { bubbles: true }));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(mount.container.querySelector<HTMLElement>(".game-panel__menu")?.hidden).toBe(false);
      expect(document.activeElement).toBe(trigger);
    } finally {
      mount.cleanup();
    }
  });

  it("keeps hidden precedence and legend targets at least 44 pixels", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.game-panel__menu\[hidden\]\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.game-panel__legend-toggle\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.game-panel__legend-reset\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.game-panel__legend-operator label\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.game-panel summary\s*\{[^}]*min-height:\s*44px/s);
    expect(css).not.toMatch(/\.game-panel__legend-toggle\s*\{[^}]*min-height:\s*32px/s);
    expect(css).not.toMatch(/\.game-panel__legend-reset\s*\{[^}]*min-height:\s*32px/s);
    expect(css).not.toMatch(/\.game-panel__legend-operator label\s*\{[^}]*min-height:\s*32px/s);
  });
});
