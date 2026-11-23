// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClearHighlights } from "../../src/features/game/components/ClearHighlights";
import { ClearScreen } from "../../src/features/game/components/ClearScreen";
import type { ClearHighlights as ClearHighlightsModel } from "../../src/features/game/clearResult";
import { buildClearHighlightRows } from "../../src/features/game/clearHighlightsPresentation";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { EDITIONS } from "../../src/features/editions/registry";
import { PHONE_MEDIA_QUERY } from "../../src/features/map/mapConfig";
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
afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  vi.unstubAllGlobals();
});

function stubPhone(isPhone: boolean): { change: (phone: boolean) => void } {
  const listeners = new Set<() => void>();
  let phone = isPhone;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    media: query,
    get matches() { return query === PHONE_MEDIA_QUERY && phone; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })));
  return { change: (next) => { phone = next; act(() => listeners.forEach((listener) => listener())); } };
}

function mountScreen(overrides: Partial<ComponentProps<typeof ClearScreen>> = {}): MountedReact {
  mounted = mountReact(createElement(ClearScreen, {
    game, network, presentation,
    result: clearResultFor(game, network, presentation, display),
    saveStatus: "saved", onPlayAgain: vi.fn(), onShowTitle: vi.fn(),
    ...overrides,
  }));
  return mounted;
}

const liveTexts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="status"], [aria-live]')].map((region) => region.textContent ?? "");

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

  it("keeps the same region node while later messages replace the text", async () => {
    stubPhone(false);
    const { container } = mountScreen({ completionAnnouncement: "ゴール" });
    const region = container.querySelector('[role="status"]');
    await act(async () => buttonByName(container, "次のページ")!.click());
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(liveTexts(container)).toEqual(["2 / 3ページ"]);
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("2 / 3ページ");
    expect(container.querySelector(".clear-screen__page-status")?.hasAttribute("role")).toBe(false);
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

describe("ClearScreen layout order and history disclosure", () => {
  function order(container: HTMLElement): string[] {
    const checks: [string, string][] = [
      ["heading", "#clear-title"], ["numbers", ".clear-screen__stats"], ["share", ".clear-screen__share"],
      ["actions", ".clear-screen__actions"], ["highlights", ".clear-screen__highlights"],
      ["history", ".clear-screen__history"],
    ];
    return checks
      .map(([name, selector]) => [name, container.querySelector(selector)] as const)
      .filter((entry): entry is readonly [string, Element] => entry[1] !== null)
      .sort(([, first], [, second]) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(([name]) => name);
  }

  it("puts numbers, share, actions and highlights before the history", () => {
    stubPhone(true);
    const { container } = mountScreen();
    expect(order(container)).toEqual(["heading", "numbers", "share", "actions", "highlights", "history"]);
  });

  it("starts with the phone history closed inside a 移動履歴 disclosure, and opens it through the summary", () => {
    stubPhone(true);
    const { container } = mountScreen();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("移動履歴");
    expect(details.querySelector(".clear-screen__history")).not.toBeNull();
    act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(container.querySelector("details")!.open).toBe(true);
  });

  it("shows the desktop history without a disclosure under a 移動履歴 heading", () => {
    stubPhone(false);
    const { container } = mountScreen();
    expect(container.querySelector("details")).toBeNull();
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toContain("移動履歴");
    expect(container.querySelectorAll(".clear-screen__history li")).toHaveLength(20);
  });

  it("keeps the page when the width crosses the breakpoint, with one history list at a time", async () => {
    const media = stubPhone(false);
    const { container } = mountScreen();
    await act(async () => buttonByName(container, "次のページ")!.click());
    expect(container.querySelector(".clear-screen__history li")?.textContent).toContain("21ターン目");
    media.change(true);
    expect(container.querySelectorAll(".clear-screen__history")).toHaveLength(1);
    expect(container.querySelector("details")).not.toBeNull();
    expect(container.querySelector(".clear-screen__history li")?.textContent).toContain("21ターン目");
    expect(container.querySelector(".clear-screen__page-status")?.textContent).toBe("2 / 3ページ");
    media.change(false);
    expect(container.querySelectorAll(".clear-screen__history")).toHaveLength(1);
    expect(container.querySelector(".clear-screen__history li")?.textContent).toContain("21ターン目");
  });

  it("resets the history list scroll when the page changes", async () => {
    stubPhone(false);
    const { container } = mountScreen();
    const list = container.querySelector<HTMLElement>(".clear-screen__history")!;
    list.scrollTop = 80;
    await act(async () => buttonByName(container, "次のページ")!.click());
    expect(list.scrollTop).toBe(0);
  });

  it("renders the highlights section on screen with a heading", () => {
    stubPhone(false);
    const { container } = mountScreen();
    expect(container.querySelector(".clear-screen__highlights h2")?.textContent).toBe("ハイライト");
    expect(container.querySelector(".clear-screen__highlights")?.textContent).toContain("使ったアイテム");
  });
});
