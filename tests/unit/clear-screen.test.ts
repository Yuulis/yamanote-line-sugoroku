// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClearHighlights } from "../../src/features/game/components/ClearHighlights";
import { ClearScreen } from "../../src/features/game/components/ClearScreen";
import type { ClearHighlights as ClearHighlightsModel } from "../../src/features/game/clearResult";
import type { ClearRoute } from "../../src/features/game/clearResult";
import { buildClearHighlightRows } from "../../src/features/game/clearHighlightsPresentation";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { createClearReplayStore } from "../../src/features/game/clearReplayStore";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { EDITIONS } from "../../src/features/editions/registry";
import type { GameState, ItemKind, HarmfulItemKind } from "../../src/types/network";
import { M_LINE, M_LOOP, M_START, multiServiceInput } from "./fixtures/multiService";
import { clearResultFor, buttonByName } from "./helpers/clearScreen";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const network = buildRailwayNetwork(multiServiceInput());
const presentation = createPresentationResolver(network, {
  version: 1,
  operators: [],
  lineGroups: [{ id: "group-line", name: "試験線", operatorId: "test", color: "#123456", serviceIds: [M_LINE] }],
  stations: [],
  serviceStopNames: [],
});
const display = EDITIONS[0]!.display;
const START_NAME = "駅start";
const REPLAY_ROUTE: ClearRoute = {
  steps: [{ segmentId: "replay-step", fromStationId: M_START, toStationId: "a", newlyCompleted: false,
    points: [[139.8, 35.7], [139.81, 35.71]], cumulative: [0, 1], total: 1 }],
  legs: [{ firstStepIndex: 0, endStepIndexExclusive: 1, serviceId: M_LOOP, lineGroupId: "loop", color: "#123456" }],
  turnSpans: [{ recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1 }],
  bounds: [[139.8, 35.7], [139.81, 35.71]],
};

const EMPTY_HIGHLIGHTS: ClearHighlightsModel = {
  longestRide: null,
  mostUsedLine: null,
  farthestStation: null,
  usedItems: new Map(),
  avoidedItems: new Map(),
};

const context = { network, presentation, startStationId: M_START, targetServiceId: M_LOOP };

function rowsByKey(highlights: ClearHighlightsModel): Record<string, string> {
  return Object.fromEntries(buildClearHighlightRows(highlights, context).map((row) => [row.key, row.value]));
}

describe("clear highlight rows", () => {
  it("formats every row from its value", () => {
    const rows = buildClearHighlightRows({
      longestRide: { groupId: "group-line", count: 4, fromStationId: "x", toStationId: "z" },
      mostUsedLine: { groupId: M_LINE, count: 7 },
      farthestStation: { stationId: "z", distanceKm: 12.349 },
      usedItems: new Map<ItemKind, number>([["double", 2], ["rapid", 1]]),
      avoidedItems: new Map<HarmfulItemKind, number>([["delay", 3]]),
    }, context);
    expect(rows).toEqual([
      { key: "longest-ride", label: "最長の乗車", value: "試験線 4駅（駅x→駅z）" },
      { key: "most-used-line", label: `最も使った路線（${M_LOOP}以外）`, value: "試験線 7区間" },
      { key: "farthest-station", label: "一番遠くまで行った駅", value: `駅z（${START_NAME}から 12.3km）` },
      { key: "used-items", label: "使ったアイテム", value: "倍速券×2、快速券×1" },
      { key: "avoided-items", label: "避けた不利なアイテム", value: "遅延×3" },
    ]);
  });

  it("omits rows without a value and shows なし for empty item rows", () => {
    expect(buildClearHighlightRows(EMPTY_HIGHLIGHTS, context).map((row) => [row.key, row.value])).toEqual([
      ["used-items", "なし"],
      ["avoided-items", "なし"],
    ]);
  });

  it("omits only the null rows", () => {
    const values = rowsByKey({ ...EMPTY_HIGHLIGHTS, farthestStation: { stationId: M_START, distanceKm: 0 } });
    expect(Object.keys(values)).toEqual(["farthest-station", "used-items", "avoided-items"]);
    expect(values["farthest-station"]).toBe(`${START_NAME}（${START_NAME}から 0.0km）`);
  });

  it("uses the service name for a group id the edition does not define", () => {
    const values = rowsByKey({ ...EMPTY_HIGHLIGHTS, mostUsedLine: { groupId: M_LOOP, count: 1 } });
    expect(values["most-used-line"]).toBe(`${M_LOOP} 1区間`);
  });

  it("renders the rows as a description list, not list items", () => {
    const mount = mountReact(createElement(ClearHighlights, {
      highlights: { ...EMPTY_HIGHLIGHTS, longestRide: { groupId: M_LINE, count: 2, fromStationId: "x", toStationId: "b" } },
      network, presentation, startStationId: M_START, targetServiceId: M_LOOP,
    }));
    try {
      expect(mount.container.querySelector("h2")?.textContent).toBe("ハイライト");
      expect(mount.container.querySelectorAll("li")).toHaveLength(0);
      const terms = [...mount.container.querySelectorAll("dt")].map((term) => term.textContent);
      expect(terms).toEqual(["最長の乗車", "使ったアイテム", "避けた不利なアイテム"]);
      expect(mount.container.querySelector('[data-highlight="longest-ride"] dd')?.textContent).toBe("試験線 2駅（駅x→駅b）");
    } finally {
      mount.cleanup();
    }
  });
});

const game = {
  turn: 61,
  movementHistory: Array.from({ length: 45 }, (_, index) => ({
    turn: index + 1, roll: 1, serviceId: M_LOOP, direction: 1, fromStationId: M_START, toStationId: M_START,
    traversedSegmentIds: [], landing: null,
  })),
  config: { startStationId: M_START, targetServiceId: M_LOOP },
} as unknown as GameState;

let mounted: MountedReact | undefined;
const originalInnerWidth = window.innerWidth;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
let phoneViewportWidth = originalInnerWidth;
const phoneMediaListeners = new Set<() => void>();
beforeAll(() => {
  // Native modal stub: `open` stays until close() or unmount, like the browser's.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
});
afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  phoneViewportWidth = originalInnerWidth;
  phoneMediaListeners.clear();
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  vi.restoreAllMocks();
});

function screenProps(overrides: Partial<ComponentProps<typeof ClearScreen>> = {}): ComponentProps<typeof ClearScreen> {
  return {
    game, network, presentation,
    result: clearResultFor(game, network, presentation, display),
    saveStatus: "saved", onPlayAgain: vi.fn(), onShowTitle: vi.fn(),
    ...overrides,
  };
}

function mountScreen(overrides: Partial<ComponentProps<typeof ClearScreen>> = {}): MountedReact {
  mounted = mountReact(createElement(ClearScreen, screenProps(overrides)));
  return mounted;
}

const liveTexts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="status"], [aria-live]')].map((region) => region.textContent ?? "");

const launcher = (container: HTMLElement): HTMLButtonElement => buttonByName(container, "移動履歴を見る")!;
const historyDialog = (container: HTMLElement): HTMLDialogElement | null => container.querySelector("dialog");
const openHistory = (container: HTMLElement): void => act(() => launcher(container).click());
const click = (button: HTMLButtonElement | undefined): void => act(() => button!.click());
const rowTurns = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".clear-screen__history li")].map((row) => row.querySelector(".clear-history__turn")!.textContent!);

describe("ClearScreen live region", () => {
  it("mounts one polite region and announces the completion text once it is published", () => {
    const { container } = mountScreen({ completionAnnouncement: "ゴールに到着しました。踏破 30/30" });
    const regions = container.querySelectorAll('[role="status"], [aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.getAttribute("aria-live")).toBe("polite");
    expect(regions[0]!.textContent).toBe("ゴールに到着しました。踏破 30/30");
  });

  it("stays empty and unique for a result without a completion message", () => {
    expect(liveTexts(mountScreen().container)).toEqual([""]);
  });

  it("shows the goal sentence once, in the live region only, never as a visible log line on the card", () => {
    const goal = "96ターン目：出目3（3マス、1駅移動）、新橋に到着。ゴールに到着しました。踏破 30/30";
    const { container } = mountScreen({ completionAnnouncement: goal });
    expect(liveTexts(container)).toEqual([goal]);
    expect(container.querySelector(".item-event-notice__completion")).toBeNull();
    expect(container.textContent!.split(goal)).toHaveLength(2);
  });

  it("keeps the completion announcement in the card's region while the history pages announce themselves", () => {
    const { container } = mountScreen({ completionAnnouncement: "ゴール" });
    const region = container.querySelector('[role="status"]');
    openHistory(container);
    click(buttonByName(container, "次のページ"));
    expect(container.querySelector(".clear-screen > [role=status]")).toBe(region);
    expect(region!.textContent).toBe("ゴール");
    const pageStatus = container.querySelector(".clear-screen__page-status")!;
    expect(pageStatus.textContent).toBe("2 / 3ページ");
    expect(pageStatus.getAttribute("role")).toBe("status");
    expect(pageStatus.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the save-failure alert next to the single polite region", () => {
    const { container } = mountScreen({ saveStatus: "failed" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("再読み込みするとこのクリアは残りません");
    expect(liveTexts(container)).toEqual([""]);
  });

  it("focuses the heading and scrolls the card to the top on mount", () => {
    const { container } = mountScreen();
    expect(document.activeElement).toBe(container.querySelector("#clear-title"));
  });
});

describe("ClearScreen layout order and history launcher", () => {
  function order(container: HTMLElement): string[] {
    const checks: [string, string][] = [
      ["heading", "#clear-title"], ["numbers", ".clear-screen__stats"], ["share", ".clear-screen__share"],
      ["actions", ".clear-screen__actions"], ["history", ".clear-screen__history-button"],
      ["highlights", ".clear-screen__highlights"],
    ];
    return checks
      .map(([name, selector]) => [name, container.querySelector(selector)] as const)
      .filter((entry): entry is readonly [string, Element] => entry[1] !== null)
      .sort(([, first], [, second]) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(([name]) => name);
  }

  it("puts the history button right after the main actions, before the highlights", () => {
    expect(order(mountScreen().container)).toEqual(["heading", "numbers", "share", "actions", "history", "highlights"]);
  });

  it("renders no history list, disclosure or history heading on the card itself", () => {
    const { container } = mountScreen();
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector(".clear-screen__history")).toBeNull();
    expect(container.querySelector("dialog")).toBeNull();
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["ハイライト"]);
    expect(launcher(container).textContent).toBe("移動履歴を見る");
  });

  it("explains missing route geometry without offering replay or adding a live announcement", () => {
    const { container } = mountScreen();
    expect(buttonByName(container, "軌跡を再生")).toBeUndefined();
    expect(container.querySelector(".clear-screen__replay-unavailable")?.textContent)
      .toBe("経路を描画できないため、軌跡を再生できません。");
    expect(container.querySelector(".clear-screen__replay-unavailable")?.getAttribute("aria-live")).toBeNull();
    expect(liveTexts(container)).toEqual([""]);
  });

  it("renders the highlights section on screen with a heading", () => {
    const { container } = mountScreen();
    expect(container.querySelector(".clear-screen__highlights h2")?.textContent).toBe("ハイライト");
    expect(container.querySelector(".clear-screen__highlights")?.textContent).toContain("使ったアイテム");
  });

  it("starts its fallback replay store after StrictMode replays the effect lifecycle", () => {
    const props = screenProps({ result: { ...screenProps().result, route: REPLAY_ROUTE } });
    mounted = mountReact(createElement(StrictMode, null, createElement(ClearScreen, props)));
    click(buttonByName(mounted.container, "軌跡を再生"));
    expect(buttonByName(mounted.container, "一時停止")).toBeDefined();
  });
});

describe("ClearScreen replay strip", () => {
  function setViewportWidth(width: number): void {
    phoneViewportWidth = width;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    act(() => { for (const listener of phoneMediaListeners) listener(); });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (media: string): MediaQueryList => ({
        media,
        matches: phoneViewportWidth <= 600,
        onchange: null,
        addListener: (listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void => {
          if (listener) phoneMediaListeners.add(listener as () => void);
        },
        removeListener: (listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void => {
          if (listener) phoneMediaListeners.delete(listener as () => void);
        },
        addEventListener: (_type: "change", listener: EventListenerOrEventListenerObject): void => {
          phoneMediaListeners.add(listener as () => void);
        },
        removeEventListener: (_type: "change", listener: EventListenerOrEventListenerObject): void => {
          phoneMediaListeners.delete(listener as () => void);
        },
        dispatchEvent: () => true,
      } as unknown as MediaQueryList),
    });
  }

  function replayProps(overrides: Partial<ComponentProps<typeof ClearScreen>> = {}): Partial<ComponentProps<typeof ClearScreen>> {
    const base = screenProps();
    return {
      result: { ...base.result, route: REPLAY_ROUTE },
      ...overrides,
    };
  }

  it("collapses both layouts, hides card content, and expands only through 結果を表示", () => {
    setViewportWidth(320);
    const { container } = mountScreen(replayProps());
    const card = container.querySelector<HTMLElement>(".clear-screen")!;
    const details = [...container.querySelectorAll<HTMLElement>(".clear-screen__content, .clear-screen__share-actions")];
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(false);

    click(buttonByName(container, "軌跡を再生"));
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(details.length).toBeGreaterThan(0);
    for (const content of details) {
      expect(content.hidden).toBe(true);
      expect(content.getAttribute("aria-hidden")).toBe("true");
      expect(content.hasAttribute("inert")).toBe(true);
    }
    expect(document.activeElement).toBe(buttonByName(container, "一時停止"));

    click(buttonByName(container, "一時停止"));
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(buttonByName(container, "再開")).toBe(document.activeElement);

    click(buttonByName(container, "全経路を表示"));
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(buttonByName(container, "結果を表示")).toBeDefined();
    expect(document.activeElement).toBe(buttonByName(container, "結果を表示"));
    expect(details.every((content) => content.hidden && content.hasAttribute("inert"))).toBe(true);

    click(buttonByName(container, "結果を表示"));
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(false);
    expect(details.every((content) => !content.hidden && !content.hasAttribute("inert"))).toBe(true);
    expect(document.activeElement).toBe(buttonByName(container, "軌跡を再生"));
    expect(card.scrollTop).toBe(0);
  });

  it("does not move focus into results when focus already left the strip before replay ends", async () => {
    setViewportWidth(320);
    const { container } = mountScreen(replayProps());
    click(buttonByName(container, "軌跡を再生"));
    const pause = buttonByName(container, "一時停止");
    if (!pause) throw new Error("The collapsed band shows 一時停止 while playing");
    expect(document.activeElement).toBe(pause);

    // Tap empty space: focus goes to nowhere (body), with no focusin to record it.
    act(() => { pause.blur(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(document.body);

    click(buttonByName(container, "全経路を表示"));
    const card = container.querySelector<HTMLElement>(".clear-screen")!;
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(buttonByName(container, "結果を表示"));
  });

  it("collapses the desktop card and explicitly restores the centred results card", () => {
    setViewportWidth(1280);
    const { container } = mountScreen(replayProps());
    const card = container.querySelector<HTMLElement>(".clear-screen")!;
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    card.scrollTop = 37;
    focus.mockClear();

    click(buttonByName(container, "軌跡を再生"));

    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(container.querySelector<HTMLElement>(".clear-screen__content")?.hidden).toBe(true);
    expect(document.activeElement).toBe(buttonByName(container, "一時停止"));
    expect(focus).toHaveBeenCalled();

    click(buttonByName(container, "一時停止"));
    click(buttonByName(container, "結果を表示"));
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(false);
    expect(container.querySelector<HTMLElement>(".clear-screen__content")?.hidden).toBe(false);
    expect(document.activeElement).toBe(buttonByName(container, "軌跡を再生"));
    expect(card.scrollTop).toBe(0);
  });

  it("keeps the strip and its focused control across the phone breakpoint", () => {
    setViewportWidth(601);
    const { container } = mountScreen(replayProps());
    click(buttonByName(container, "軌跡を再生"));
    const card = container.querySelector<HTMLElement>(".clear-screen")!;
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(document.activeElement).toBe(buttonByName(container, "一時停止"));

    setViewportWidth(600);
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(document.activeElement).toBe(buttonByName(container, "一時停止"));
    setViewportWidth(601);
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(document.activeElement).toBe(buttonByName(container, "一時停止"));
  });

  it("keeps focus outside the clear card when a breakpoint collapse hides its content", () => {
    setViewportWidth(601);
    const { container } = mountScreen(replayProps());
    const outsideButton = document.createElement("button");
    outsideButton.textContent = "外部操作";
    document.body.append(outsideButton);
    try {
      click(buttonByName(container, "軌跡を再生"));
      outsideButton.focus();
      setViewportWidth(390);

      expect(container.querySelector(".clear-screen")?.classList.contains("clear-screen--replay-collapsed")).toBe(true);
      expect(document.activeElement).toBe(outsideButton);
    } finally {
      outsideButton.remove();
    }
  });

  it("keeps the strip behind the history dialog through resize and returns focus to 再開", () => {
    setViewportWidth(1280);
    const { container } = mountScreen(replayProps());
    const card = container.querySelector<HTMLElement>(".clear-screen")!;
    click(buttonByName(container, "軌跡を再生"));
    click(buttonByName(container, "移動履歴を見る"));
    const dialog = container.querySelector<HTMLDialogElement>("dialog.clear-history")!;
    expect(dialog.open).toBe(true);

    setViewportWidth(390);
    expect(dialog.open).toBe(true);
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);

    // JSDOM does not load the phone CSS; mark both desktop history launchers hidden as that rule does.
    container.querySelectorAll<HTMLButtonElement>(".clear-screen__history-button, .clear-replay-controls__history")
      .forEach((button) => { button.hidden = true; });

    click(buttonByName(container, "閉じる"));
    expect(dialog.open).toBe(false);
    expect(card.classList.contains("clear-screen--replay-collapsed")).toBe(true);
    expect(document.activeElement).toBe(buttonByName(container, "再開"));
  });

  it("keeps the results card expanded when reduced motion completes replay immediately", () => {
    setViewportWidth(320);
    const { container } = mountScreen(replayProps({ reducedMotion: true }));
    click(buttonByName(container, "全経路を表示"));

    expect(container.querySelector(".clear-screen")?.classList.contains("clear-screen--replay-collapsed")).toBe(false);
    expect(container.querySelector<HTMLElement>(".clear-screen__content")?.hidden).toBe(false);
    const replayControls = container.querySelector(".clear-replay-controls")!;
    // Expanded results can offer 軌跡を再生 in normal motion; reduced motion must keep its full-route label.
    expect(buttonByName(replayControls, "軌跡を再生")).toBeUndefined();
    expect(buttonByName(replayControls, "全経路を表示")).toBeDefined();
  });

  it("keeps the history trigger in the done strip and restores focus when its opener is hidden", () => {
    setViewportWidth(1280);
    let now = 0;
    let scheduledFrame: ((frameTime: number) => void) | null = null;
    const replayStore = createClearReplayStore({
      route: REPLAY_ROUTE,
      scheduler: {
        request: (callback) => { scheduledFrame = callback; return 1; },
        cancel: () => {},
        now: () => now,
      },
    });
    try {
      const { container } = mountScreen(replayProps({ replayStore }));
      click(buttonByName(container, "軌跡を再生"));
      act(() => { scheduledFrame?.(0); });
      now = 551;

      const playingHistory = container.querySelector<HTMLButtonElement>(".clear-replay-controls__history")!;
      click(playingHistory);

      expect(replayStore.getPhase()).toBe("done");
      const doneHistory = container.querySelector<HTMLButtonElement>(".clear-replay-controls__history");
      expect(doneHistory).not.toBeNull();
      expect(doneHistory?.parentElement?.classList.contains("clear-replay-controls__done")).toBe(true);
      expect(buttonByName(container, "結果を表示")).toBeDefined();

      // JSDOM does not load the responsive CSS; hidden simulates the phone rule's display:none for the opener.
      doneHistory!.hidden = true;
      click(buttonByName(container, "閉じる"));
      expect(document.activeElement).toBe(buttonByName(container, "結果を表示"));
    } finally {
      replayStore.dispose();
    }
  });

  it("returns focus to 結果を表示 when the replay completes as history opens, even with the done trigger shown", () => {
    setViewportWidth(1280);
    let now = 0;
    let scheduledFrame: ((frameTime: number) => void) | null = null;
    const replayStore = createClearReplayStore({
      route: REPLAY_ROUTE,
      scheduler: {
        request: (callback) => { scheduledFrame = callback; return 1; },
        cancel: () => {},
        now: () => now,
      },
    });
    try {
      const { container } = mountScreen(replayProps({ replayStore }));
      click(buttonByName(container, "軌跡を再生"));
      act(() => { scheduledFrame?.(0); });
      now = 551;

      click(container.querySelector<HTMLButtonElement>(".clear-replay-controls__history")!);
      expect(replayStore.getPhase()).toBe("done");
      const doneHistory = container.querySelector<HTMLButtonElement>(".clear-replay-controls__history");
      expect(doneHistory, "the done strip keeps a visible history trigger").not.toBeNull();
      expect(doneHistory?.hidden).toBe(false);

      click(buttonByName(container, "閉じる"));
      expect(document.activeElement, "focus does not jump to the newly mounted done trigger").toBe(buttonByName(container, "結果を表示"));
    } finally {
      replayStore.dispose();
    }
  });
});

describe("ClearScreen history dialog", () => {
  it("opens a modal named 移動履歴 with 20 rows per page, focusing its heading", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { container } = mountScreen();
    openHistory(container);
    const dialog = historyDialog(container)!;
    const heading = dialog.querySelector("h2")!;
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(heading.textContent).toBe("移動履歴");
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(document.activeElement).toBe(heading);
    expect(container.querySelectorAll(".clear-screen__history li")).toHaveLength(20);
    expect(rowTurns(container)[0]).toBe("1ターン目");
    expect(dialog.querySelector(".clear-screen__page-status")?.textContent).toBe("1 / 3ページ");
  });

  it("closes with 閉じる and returns focus to the launcher, and the dialog leaves the DOM", () => {
    const { container } = mountScreen();
    openHistory(container);
    click(buttonByName(historyDialog(container)!, "閉じる"));
    expect(historyDialog(container)).toBeNull();
    expect(document.activeElement).toBe(launcher(container));
  });

  it("closes on Escape (native cancel) and returns focus to the launcher", () => {
    const { container } = mountScreen();
    openHistory(container);
    const cancel = new Event("cancel", { cancelable: true });
    act(() => { historyDialog(container)!.dispatchEvent(cancel); });
    expect(cancel.defaultPrevented).toBe(true);
    expect(historyDialog(container)).toBeNull();
    expect(document.activeElement).toBe(launcher(container));
  });

  it("closes on a backdrop click but not on a click inside the dialog", () => {
    const { container } = mountScreen();
    openHistory(container);
    act(() => { historyDialog(container)!.querySelector("ol")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(historyDialog(container)).not.toBeNull();
    act(() => { historyDialog(container)!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(historyDialog(container)).toBeNull();
  });

  it("pages both ways with disabled ends and announces each page from the dialog's own status", () => {
    const { container } = mountScreen();
    openHistory(container);
    expect(buttonByName(container, "前のページ")!.disabled).toBe(true);
    click(buttonByName(container, "次のページ"));
    expect(rowTurns(container)[0]).toBe("21ターン目");
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("2 / 3ページ");
    click(buttonByName(container, "次のページ"));
    expect(container.querySelectorAll(".clear-screen__history li")).toHaveLength(5);
    expect(buttonByName(container, "次のページ")!.disabled).toBe(true);
    click(buttonByName(container, "前のページ"));
    click(buttonByName(container, "前のページ"));
    expect(rowTurns(container)[0]).toBe("1ターン目");
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("1 / 3ページ");
  });

  it("keeps the page while the dialog is closed and reopened within the same result", () => {
    const { container } = mountScreen();
    openHistory(container);
    click(buttonByName(container, "次のページ"));
    click(buttonByName(historyDialog(container)!, "閉じる"));
    openHistory(container);
    expect(rowTurns(container)[0]).toBe("21ターン目");
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("2 / 3ページ");
  });

  it("resets to the first page for a new published result (new generation key)", () => {
    const { container, root } = mountScreen();
    openHistory(container);
    click(buttonByName(container, "次のページ"));
    click(buttonByName(historyDialog(container)!, "閉じる"));
    // Same props with another key: the published generation is what remounts the screen.
    act(() => root.render(createElement(ClearScreen, { ...screenProps(), key: "generation-2" })));
    openHistory(container);
    expect(rowTurns(container)[0]).toBe("1ターン目");
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("1 / 3ページ");
  });

  it("resets the history list scroll when the page changes", () => {
    const { container } = mountScreen();
    openHistory(container);
    const list = container.querySelector<HTMLElement>(".clear-screen__history")!;
    list.scrollTop = 80;
    click(buttonByName(container, "次のページ"));
    expect(list.scrollTop).toBe(0);
  });

  it("shows every turn of a very long save exactly once, at most 20 rows at a time", () => {
    const long = {
      ...game,
      movementHistory: Array.from({ length: 263 }, (_, index) => ({ ...game.movementHistory[0]!, turn: index + 1 })),
    } as unknown as GameState;
    const { container } = mountScreen({ game: long, result: clearResultFor(long, network, presentation, display) });
    openHistory(container);
    const seen: string[] = [];
    for (let pageIndex = 0; pageIndex < 14; pageIndex += 1) {
      expect(container.querySelectorAll(".clear-screen__history li").length).toBeLessThanOrEqual(20);
      seen.push(...rowTurns(container));
      if (pageIndex < 13) click(buttonByName(container, "次のページ"));
    }
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("14 / 14ページ");
    expect(seen).toEqual(Array.from({ length: 263 }, (_, index) => `${index + 1}ターン目`));
  });

  it("renders each row's fields as separate elements", () => {
    const { container } = mountScreen();
    openHistory(container);
    const row = container.querySelector(".clear-screen__history li")!;
    expect(row.querySelector(".clear-history__turn")?.textContent).toBe("1ターン目");
    expect(row.querySelector(".clear-history__roll")?.textContent).toBe("出目1");
    expect(row.querySelector(".clear-history__move")?.textContent).toBe(`${START_NAME} → ${START_NAME}（0駅）`);
    expect(row.querySelector(".clear-history__line")?.textContent).toBe(`${M_LOOP}・正方向`);
    expect(row.querySelector(".clear-history__note")?.textContent).toBe(`途中停止${START_NAME}で終了、残り1を使わず`);
  });

  it("unmounts cleanly while the dialog is open", () => {
    const { container, cleanup } = mountScreen();
    openHistory(container);
    expect(() => { cleanup(); mounted = undefined; }).not.toThrow();
  });
});
