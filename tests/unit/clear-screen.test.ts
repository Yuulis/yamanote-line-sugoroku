// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClearHighlights } from "../../src/features/game/components/ClearHighlights";
import { ClearScreen } from "../../src/features/game/components/ClearScreen";
import type { ClearHighlights as ClearHighlightsModel } from "../../src/features/game/clearResult";
import { buildClearHighlightRows } from "../../src/features/game/clearHighlightsPresentation";
import { buildRailwayNetwork } from "../../src/features/game/engine";
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

  it("renders the highlights section on screen with a heading", () => {
    const { container } = mountScreen();
    expect(container.querySelector(".clear-screen__highlights h2")?.textContent).toBe("ハイライト");
    expect(container.querySelector(".clear-screen__highlights")?.textContent).toContain("使ったアイテム");
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
    expect(row.querySelector(".clear-history__move")?.textContent).toBe(`${START_NAME} → ${START_NAME}`);
    expect(row.querySelector(".clear-history__line")?.textContent).toBe(`${M_LOOP}・正方向`);
    expect(row.querySelector(".clear-history__note")?.textContent).toBe(`途中で停止${START_NAME}で停止、残り1`);
  });

  it("unmounts cleanly while the dialog is open", () => {
    const { container, cleanup } = mountScreen();
    openHistory(container);
    expect(() => { cleanup(); mounted = undefined; }).not.toThrow();
  });
});
