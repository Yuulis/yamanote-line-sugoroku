// @vitest-environment jsdom
import { act, createElement, createRef, memo, useEffect, useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "../../src/features/game/store/settings";
import { GameHud } from "../../src/features/game/components/GameHud";
import type { GameHudProps } from "../../src/features/game/components/GameHud";
import { GameMenu } from "../../src/features/game/components/GameMenu";
import type { GameMenuProps } from "../../src/features/game/components/GameMenu";
import { GamePanel } from "../../src/features/game/components/GamePanel";
import { buildRailwayNetwork, createItemGame, playItemTurn, resolveItemDiscard, serializeGame, platformPosition } from "../../src/features/game/engine";
import { resumeSession } from "../../src/features/game/gameSession";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { itemLastMove, itemSessionView } from "../../src/features/game/itemSession";
import { landingText, lastRollText } from "../../src/features/game/presentation";
import { compactRollFor, compactRollText } from "../../src/features/game/hudPresentation";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { dispatchReactEvent, mountReact } from "./helpers/reactDom";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { networkFromData } from "../../src/features/game/networkFromData";
import { turnToasts } from "../../src/features/game/toastQueue";
import { deriveTurnMomentDisplay } from "../../src/features/game/turnMomentPresentation";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";

beforeEach(() => { localStorage.removeItem(SETTINGS_STORAGE_KEY); });

const renderCounts = vi.hoisted(() => ({ hud: 0, legend: 0 }));

function displayFor(session: Parameters<typeof deriveTurnMomentDisplay>[0]["session"], network: Parameters<typeof deriveTurnMomentDisplay>[0]["network"],
  stationId = session.game.currentStationId, completedSegmentIds = session.game.completedSegmentIds, view: ReturnType<typeof itemSessionView> = itemSessionView(session, network)) {
  return deriveTurnMomentDisplay({ session, network, presentation: createPresentationResolver(network),
    progress: { stationId, position: platformPosition(network, session.game.currentServiceId, stationId), completedSegmentIds, stepsCompleted: 0 },
    attempt: null, revealStage: "done", restoredOrOmitted: true, itemView: view });
}
vi.mock("../../src/features/map/RailwayMap", () => ({
  RailwayMap: function RailwayMapStub(): React.JSX.Element { return createElement("div"); },
}));
vi.mock("../../src/features/game/components/GameHud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/game/components/GameHud")>();
  return { ...actual, GameHud: function CountedGameHud(value: GameHudProps): React.JSX.Element {
    renderCounts.hud += 1;
    return createElement(actual.GameHud, value);
  } };
});
vi.mock("../../src/features/game/components/GameLegend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/game/components/GameLegend")>();
  // Preserve the production memo boundary while counting renders of the real legend implementation.
  const RealLegend = actual.GameLegend.type;
  return { ...actual, GameLegend: memo(function CountedGameLegend(value: React.ComponentProps<typeof RealLegend>): React.JSX.Element {
    renderCounts.legend += 1;
    return createElement(RealLegend, value);
  }) };
});

function ProductionAppHarness(value: React.ComponentProps<typeof GameApp>): React.JSX.Element {
  return createElement(GameApp, value);
}

function props(overrides: Partial<GameHudProps> = {}): GameHudProps {
  return {
    title: "山手線すごろく", subtitle: "東京近郊版", headingRef: createRef<HTMLHeadingElement>(),
    station: "東京", ride: "山手線", lineBadge: { groupId: "jr-yamanote", code: "JY", color: "#80c241", name: "山手線", textColor: "#000000" },
    direction: "外回り", turn: 5, completed: 3, required: 30, compactRoll: "3マス", saveStatus: null,
    saveStatusMessage: "未保存", canRoll: true, canSkip: false, animating: false, draftSelected: false,
    rollButtonRef: createRef<HTMLButtonElement>(), onRoll: vi.fn(), onSkip: vi.fn(), effects: [], ...overrides,
  };
}

function Harness({ value }: { value: GameHudProps }): React.JSX.Element {
  return createElement(GameHud, value);
}

/** Menu props without the open state, which `MenuHarness` owns (in the app, `GamePanel` does). */
type MenuValue = Omit<GameMenuProps, "expanded" | "onExpandedChange">;

function menuProps(overrides: Partial<MenuValue> = {}): MenuValue {
  return {
    follow: true, reducedMotion: false, speedLabel: "ふつう", presentationLevel: "all" as const, onCyclePresentation: vi.fn(), lines: [
      { id: "jr-yamanote", name: "山手線", color: "#80c241", operatorId: "JR東日本", serviceIds: ["jr-yamanote"] },
    ], targetColor: "#80c241", selectedGroupIds: null,
    onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn(),
    onToggleGroup: vi.fn(), onSetOperator: vi.fn(), onShowAll: vi.fn(), ...overrides,
  };
}

function MenuHarness({ value }: { value: MenuValue }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return createElement(GameMenu, { ...value, expanded, onExpandedChange: setExpanded });
}

function DraftEscapeHarness({ value }: { value: MenuValue }): React.JSX.Element {
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
  it("keeps the full roll only in the closed log and separates item arrival from lottery text", async () => {
    const fixtureNetwork = buildRailwayNetwork(multiServiceInput());
    const base = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "log-arrival", fixtureNetwork);
    const result = playItemTurn(base, {}, fixtureNetwork);
    const settled = resumeSession(result.state, fixtureNetwork);
    if (!settled.lastMove) throw new Error("Expected a settled item move");
    for (const scenario of ["route", "deadhead"] as const) {
      const session = scenario === "route" ? settled : { ...settled, lastMove: {
        ...settled.lastMove, roll: null, stopReason: "relocation" as const, landing: null,
      } };
      const itemView = itemSessionView(session, fixtureNetwork);
      if (!itemView) throw new Error("Expected item session view");
      const value: Parameters<typeof GamePanel>[0] = {
        session, network: fixtureNetwork, lines: [], turnDisplay: displayFor(session, fixtureNetwork, session.game.currentStationId,
          session.game.completedSegmentIds, itemView), requiredCount: 30,
        saveStatus: null, follow: true, speedLabel: "標準", presentationLevel: "all" as const, onCyclePresentation: vi.fn(), reducedMotion: false,
        onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(),
        onNewGame: vi.fn(), onShowTitle: vi.fn() ,
      };
      const mount = mountReact(createElement(GamePanel, value));
      try {
        const log = mount.container.querySelector<HTMLElement>(".game-panel__log")!;
        const roll = mount.container.querySelector<HTMLElement>('[data-stat="roll"]')!;
        const compactRoll = mount.container.querySelector<HTMLElement>('[data-stat="roll-compact"]')!;
        expect(mount.container.querySelectorAll('[data-stat="roll"]')).toHaveLength(1);
        expect(log.contains(roll)).toBe(true);
        expect(roll.textContent).toBe(lastRollText(session.lastMove, fixtureNetwork));
        expect(compactRoll.textContent).toBe(compactRollText(compactRollFor(session.lastMove)));
        const logText = log.textContent ?? "";
        if (scenario === "route") {
          const lottery = landingText(session.lastMove, fixtureNetwork);
          expect(lottery).not.toBe("—");
          expect(logText.split(lottery).length - 1).toBe(1);
          expect(mount.container.querySelector(".item-arrival")?.textContent).not.toContain(lottery);
        } else {
          expect(session.lastMove?.stopReason).toBe("relocation");
          expect(logText.split("回送列車で").length - 1).toBe(1);
        }
      } finally {
        mount.cleanup();
      }
    }
  });

  it("renders six labelled stats, a separate badge and straight progress bar", () => {
    const mount = mountReact(createElement(GameHud, props()));
    try {
      expect([...mount.container.querySelectorAll(".game-panel__stats dt")].map((label) => label.textContent)).toEqual([
        "現在駅", "乗車中", "進行方向", "ターン数", "踏破区間", "出目",
      ]);
      expect(mount.container.querySelector("[data-stat=ride]")?.textContent).toBe("山手線");
      expect(mount.container.querySelector("[data-stat=ride]")?.getAttribute("title")).toBe("山手線");
      expect(mount.container.querySelector("[data-stat=roll-compact]")?.getAttribute("title")).toBe("3マス");
      expect(mount.container.querySelector("[data-stat=roll]")).toBeNull();
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

  it("enables Skip from canSkip alone and keeps the locked dice focusable with a guarded handler", () => {
    const onRoll = vi.fn();
    const onSkip = vi.fn();
    const initial = props({ onRoll, onSkip, canRoll: false, canSkip: true, animating: false });
    const mount = mountReact(createElement(Harness, { value: initial }));
    try {
      const dice = mount.container.querySelector<HTMLButtonElement>(".game-panel__roll")!;
      const skip = [...mount.container.querySelectorAll("button")].find((button) => button.textContent === "スキップ")!;
      expect(skip.disabled).toBe(false);
      expect(dice.disabled).toBe(false);
      expect(dice.getAttribute("aria-disabled")).toBe("true");
      expect(dice.textContent).toMatch(/サイコロを振る|移動中…/);
      dice.focus();
      expect(document.activeElement).toBe(dice);
      dispatchReactEvent(dice, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).not.toHaveBeenCalled();
      dispatchReactEvent(skip, new MouseEvent("click", { bubbles: true }));
      expect(onSkip).toHaveBeenCalledTimes(1);
      act(() => mount.root.render(createElement(Harness, { value: { ...initial, canSkip: false, animating: true } })));
      expect(skip.disabled).toBe(true);
      expect(dice.textContent).toBe("移動中…");
      act(() => mount.root.render(createElement(Harness, { value: { ...initial, canRoll: true, canSkip: false } })));
      expect(dice.getAttribute("aria-disabled")).toBe("false");
      expect(skip.disabled).toBe(true);
      dispatchReactEvent(dice, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).toHaveBeenCalledTimes(1);
    } finally {
      mount.cleanup();
    }
  });

  it("locks dice and draft clearing in the panel when the display forbids actions although the engine is idle", () => {
    const network = buildRailwayNetwork(multiServiceInput());
    const game = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "panel-lock", network);
    const session = resumeSession(game, network);
    expect(session.phase).toBe("idle");
    const itemView = { ...itemSessionView(session, network)!, draft: { items: [{ kind: "double" as const, instanceId: "double-1" }] } };
    const idle = displayFor(session, network, game.currentStationId, [], itemView);
    const onRoll = vi.fn();
    const onSkip = vi.fn();
    const onEditItemDraft = vi.fn();
    const value: Parameters<typeof GamePanel>[0] = {
      network, lines: [], session, turnDisplay: idle, onEditItemDraft, requiredCount: 4, saveStatus: "saved", follow: true,
      speedLabel: "標準", presentationLevel: "all" as const, onCyclePresentation: vi.fn(), reducedMotion: false, onRoll, onSkip, onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(),
      onNewGame: vi.fn(), onShowTitle: vi.fn(),
    };
    function PanelHarness({ panel }: { panel: Parameters<typeof GamePanel>[0] }): React.JSX.Element {
      return createElement(GamePanel, panel);
    }
    const mount = mountReact(createElement(PanelHarness, { panel: value }));
    try {
      const clear = (): HTMLButtonElement => [...mount.container.querySelectorAll("button")].find((button) => button.textContent === "選択を解除")!;
      const dice = mount.container.querySelector<HTMLButtonElement>(".game-panel__roll")!;
      const skip = (): HTMLButtonElement => [...mount.container.querySelectorAll("button")].find((button) => button.textContent === "スキップ")!;
      expect([dice.getAttribute("aria-disabled"), clear().disabled, skip().disabled]).toEqual(["false", false, true]);
      act(() => mount.root.render(createElement(PanelHarness, { panel: { ...value,
        turnDisplay: { ...idle, canRoll: false, canSkip: true, itemUseLocked: true } } })));
      expect([dice.getAttribute("aria-disabled"), dice.disabled, clear().disabled, skip().disabled]).toEqual(["true", false, true, false]);
      dispatchReactEvent(dice, new MouseEvent("click", { bubbles: true }));
      expect(onRoll).not.toHaveBeenCalled();
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => window.dispatchEvent(escape));
      expect(escape.defaultPrevented).toBe(false);
      expect(onEditItemDraft).not.toHaveBeenCalled();
      dispatchReactEvent(skip(), new MouseEvent("click", { bubbles: true }));
      expect(onSkip).toHaveBeenCalledTimes(1);
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
  it("starts closed with a labelled mounted section, five actions, and the legend inside", () => {
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
        "追尾: ON", "速度: ふつう", "演出: すべて", "新規", "タイトル",
      ]);
      expect(region.querySelectorAll(".game-panel__options button")).toHaveLength(5);
      expect(region.querySelector(".game-panel__legend-section")).not.toBeNull();
    } finally {
      mount.cleanup();
    }
  });

  it("labels the presentation cycle and disables it under OS reduction", () => {
    const onCyclePresentation = vi.fn();
    const value = menuProps({ presentationLevel: "important", onCyclePresentation });
    const mount = mountReact(createElement(MenuHarness, { value }));
    try {
      const control = mount.container.querySelector<HTMLButtonElement>('[aria-label="演出: 重要なときだけ（押すと切り替え）"]')!;
      expect(control.textContent?.trim()).toBe("演出: 重要なときだけ");
      dispatchReactEvent(control, new MouseEvent("click", { bubbles: true }));
      expect(onCyclePresentation).toHaveBeenCalledOnce();
      act(() => mount.root.render(createElement(MenuHarness, { value: { ...value, reducedMotion: true } })));
      expect(control.textContent?.trim()).toBe("演出: 省略");
      expect(control.getAttribute("aria-label")).toBe("演出: 省略（押すと切り替え）");
      expect(control.disabled).toBe(true);
      dispatchReactEvent(control, new MouseEvent("click", { bubbles: true }));
      expect(onCyclePresentation).toHaveBeenCalledOnce();
    } finally { mount.cleanup(); }
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
      dispatchReactEvent(mount.container.querySelector(".game-panel__options button:nth-child(4)")!, new MouseEvent("click", { bubbles: true }));
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
      network, lines: [], session , turnDisplay: displayFor(session, network, game.currentStationId, [], itemView), onEditItemDraft, requiredCount: 4, saveStatus: "saved", follow: true, speedLabel: "標準", presentationLevel: "all" as const, onCyclePresentation: vi.fn(), reducedMotion: false,
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

it("keeps the turn log mounted, mutually exclusive, keyboard closable, and retains route details", () => {
  const network = buildRailwayNetwork(multiServiceInput());
  const game = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "log-disclosure", network);
  const session = resumeSession(game, network);
  const common = { network, lines: [], turnDisplay: displayFor(session, network, "a", []), requiredCount: 4,
    saveStatus: "saved" as const, follow: true, speedLabel: "標準", presentationLevel: "all" as const, onCyclePresentation: vi.fn(), reducedMotion: false,
    onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn() };
  type PanelProps = Parameters<typeof GamePanel>[0];
  function Harness({ value }: { value: PanelProps }): React.JSX.Element {
    return createElement(GamePanel, value);
  }
  const mount = mountReact(createElement(Harness, { value: { ...common, session } }));
  try {
    const logTrigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__log-trigger")!;
    const menuTrigger = mount.container.querySelector<HTMLButtonElement>(".game-panel__menu-trigger")!;
    const log = mount.container.querySelector<HTMLElement>(".game-panel__log")!;
    const menu = mount.container.querySelector<HTMLElement>(".game-panel__menu")!;
    expect(logTrigger.textContent).toBe("ログ");
    expect(logTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(logTrigger.getAttribute("aria-controls")).toBe(log.id);
    expect(log.getAttribute("aria-label")).toBe("ターンのログ");
    expect(log.hidden).toBe(true);
    dispatchReactEvent(logTrigger, new MouseEvent("click", { bubbles: true }));
    expect(logTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(log.hidden).toBe(false);
    expect(mount.container.querySelectorAll("[data-stat=roll]")).toHaveLength(1);
    expect(log.querySelector("[data-stat=roll]")?.textContent).toBe("—");
    expect(log.querySelector(".game-panel__lottery")).not.toBeNull();
    expect(log.querySelector(".game-panel__route-summary")).not.toBeNull();
    expect(log.querySelector("[role=status], [aria-live]")).toBeNull();
    expect(mount.container.querySelectorAll(".game-panel [role=status]")).toHaveLength(1);
    expect(logTrigger.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(2);
    expect(logTrigger.querySelector("svg title, svg text")).toBeNull();

    const routeSummary = log.querySelector<HTMLDetailsElement>(".game-panel__route-summary")!;
    routeSummary.open = true;
    dispatchReactEvent(menuTrigger, new MouseEvent("click", { bubbles: true }));
    expect(menuTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.hidden).toBe(false);
    expect(logTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(log.hidden).toBe(true);
    dispatchReactEvent(logTrigger, new MouseEvent("click", { bubbles: true }));
    expect(menuTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.hidden).toBe(true);
    expect(log.hidden).toBe(false);
    expect(routeSummary.open).toBe(true);

    logTrigger.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(log.hidden).toBe(true);
    expect(document.activeElement).toBe(logTrigger);

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    try {
      dispatchReactEvent(logTrigger, new MouseEvent("click", { bubbles: true }));
      const modalEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => dialog.dispatchEvent(modalEscape));
      expect(modalEscape.defaultPrevented).toBe(false);
      expect(log.hidden).toBe(false);
    } finally {
      dialog.remove();
    }
  } finally {
    mount.cleanup();
  }
});


it("expires an ordinary toast in production GameApp without rendering HUD or legend again", async () => {
  const data = await loadRailwayData("", async (file) =>
    JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
  const result = networkFromData(data);
  if (!result.ok) throw new Error(result.reason);
  const network = result.network;
  const edition = EDITIONS[0];
  let game = createItemGame(edition.config, "production-toast-render-count", network);
  let expectedToast: string | undefined;
  for (let turn = 0; turn < 48 && !expectedToast; turn += 1) {
    const next = playItemTurn(game, {}, network).state;
    const record = next.movementHistory.at(-1);
    const toasts = next.pending === null && record ? turnToasts(1, itemLastMove(record, network), network) : [];
    if (toasts.length === 1) expectedToast = toasts[0]?.text;
    else game = next.pending?.kind === "discard" ? resolveItemDiscard(next, next.pending.item.id).state : next;
  }
  expect(expectedToast).toBeTruthy();
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.setItem(edition.saveKey, serializeGame(game));
  const mount = mountReact(createElement(ProductionAppHarness, {
    data, network, edition, picker: {
      editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
      focusPicker: false, onPickerFocusRestored: vi.fn(),
    },
  }));
  const click = (label: string): void => {
    const button = [...mount.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
    if (!button) throw new Error(`Missing production button: ${label}`);
    dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
  };
  try {
    const beforeResume = { ...renderCounts };
    click("つづきから");
    expect(renderCounts.hud).toBeGreaterThan(beforeResume.hud);
    expect(renderCounts.legend).toBeGreaterThan(beforeResume.legend);
    expect(mount.container.querySelector(".game-panel__stats")).not.toBeNull();
    expect(mount.container.querySelector(".game-panel__legend")).not.toBeNull();
    expect(mount.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
    const resumedHudCount = renderCounts.hud;
    click("サイコロを振る");
    click("スキップ");
    const toast = mount.container.querySelector(".toast-host__toast");
    expect(toast?.textContent).toBe(expectedToast);
    const settledCounts = { ...renderCounts };
    expect(settledCounts.hud).toBeGreaterThan(resumedHudCount);
    expect(settledCounts.legend).toBeGreaterThan(beforeResume.legend);
    act(() => vi.advanceTimersByTime(3999));
    expect(mount.container.querySelector(".toast-host__toast")).toBe(toast);
    act(() => vi.advanceTimersByTime(1));
    expect(mount.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
    expect(renderCounts).toEqual(settledCounts);
  } finally {
    mount.cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  }
});

// Mounted trees are cleaned up by their tests before clearing shared preferences.
afterEach(() => { localStorage.removeItem(SETTINGS_STORAGE_KEY); });
