// @vitest-environment jsdom
import { summarizeGame } from "../../src/features/game/gameSummary";
import { createItemGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState, ItemRideRecord, ItemDeadheadRecord, ItemTurnRecord } from "../../src/types/network";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClearScreen } from "../../src/features/game/components/ClearScreen";
import type { GameState } from "../../src/types/network";
import { EDITIONS } from "../../src/features/editions/registry";
import { FIXTURE_EDITION_A } from "./fixtures/editions";
import { buildShareText } from "../../src/features/game/shareText";
import { createResultShareActions } from "../../src/features/game/resultShareActions";
import type { RailwayNetwork } from "../../src/features/game/engine";
import type { PresentationResolver } from "../../src/features/game/presentationResolver";
import { act } from "react";
import { mountReact } from "./helpers/reactDom";

const accountingNetwork = buildRailwayNetwork(multiServiceInput());
const accountingPresentation = createPresentationResolver(accountingNetwork);

const display = EDITIONS[0]!.display;
const emptyNetwork = { stationsById: new Map() } as unknown as RailwayNetwork;
const presentation = { stationName: (id: string) => id } as unknown as PresentationResolver;
const game = {
  turn: 61,
  movementHistory: [],
  config: { startStationId: "shimbashi" },
} as unknown as GameState;

function mountClearScreen(actions: ReturnType<typeof createResultShareActions>) {
  return mountReact(createElement(ClearScreen, {
    game,
    network: emptyNetwork,
    presentation,
    display,
    shareActions: actions,
    saveStatus: "saved",
    onPlayAgain: vi.fn(),
    onShowTitle: vi.fn(),
  }));
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
}

const expectedText = "山手線すごろく 東京近郊版をクリア！\n所要ターン数 61・移動回数 0・乗換回数 0\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app";

describe("result share text", () => {
  it("builds the exact current edition text", () => {
    expect(buildShareText(display, { turns: 61, moves: 240, transfers: 35 })).toBe(
      "山手線すごろく 東京近郊版をクリア！\n所要ターン数 61・移動回数 240・乗換回数 35\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app",
    );
  });

  it("uses the supplied edition display", () => {
    expect(buildShareText(FIXTURE_EDITION_A.display, { turns: 2, moves: 5, transfers: 1 })).toBe(
      "Fixture A 試験版Aをクリア！\n所要ターン数 2・移動回数 5・乗換回数 1\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app",
    );
  });
});

describe("ClearScreen result sharing", () => {
  it("copies and reports success without showing the fallback field", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const mounted = mountClearScreen(createResultShareActions({ writeText }, undefined));
    await click(mounted.container.querySelector('button')!);
    expect(writeText).toHaveBeenCalledWith(expectedText);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe("結果をコピーしました");
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.cleanup();
  });

  it.each(["rejected clipboard", "missing clipboard"])("shows selectable text on %s", async (failureKind) => {
    const clipboard = failureKind === "missing clipboard"
      ? undefined
      : { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const mounted = mountClearScreen(createResultShareActions(clipboard, undefined));
    await click(mounted.container.querySelector("button")!);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe(
      "コピーできませんでした。下の文面を選択してコピーしてください。",
    );
    const textarea = mounted.container.querySelector("textarea");
    expect(textarea?.readOnly).toBe(true);
    expect(textarea?.value).toBe(expectedText);
    expect(mounted.container.querySelector('label[for="clear-share-text"]')?.textContent).toBe("共有する結果");
    mounted.cleanup();
  });

  it("hides share when unavailable and shows it when supported", () => {
    const unavailable = mountClearScreen(createResultShareActions(undefined, undefined));
    expect([...unavailable.container.querySelectorAll("button")].some((button) => button.textContent === "共有")).toBe(false);
    unavailable.cleanup();

    const share = vi.fn().mockResolvedValue(undefined);
    const available = mountClearScreen(createResultShareActions(undefined, { share }));
    expect([...available.container.querySelectorAll("button")].some((button) => button.textContent === "共有")).toBe(true);
    available.cleanup();
  });

  it("hides share when canShare rejects the text", () => {
    const mounted = mountClearScreen(createResultShareActions(undefined, {
      share: vi.fn(),
      canShare: () => false,
    }));
    expect([...mounted.container.querySelectorAll("button")].some((button) => button.textContent === "共有")).toBe(false);
    mounted.cleanup();
  });

  it("shows no message when sharing is cancelled", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click([...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "共有")!);
    expect(share).toHaveBeenCalledWith({ text: expectedText });
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.cleanup();
  });

  it("shows selectable text when sharing fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("failed"));
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click([...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "共有")!);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe(
      "共有できませんでした。下の文面を選択してコピーしてください。",
    );
    expect(mounted.container.querySelector("textarea")?.value).toBe(expectedText);
    mounted.cleanup();
  });
});

describe("item result accounting", () => {
  const grouped = {
    sameLineGroup: (a: string, b: string) => a.startsWith("toei-oedo-") && b.startsWith("toei-oedo-"),
  } as PresentationResolver;
  const ride = (turn: number, serviceId: string, landingId: string | null): ItemRideRecord => ({
    kind: "item-ride", turn, fromStationId: "a", toStationId: "b",
    command: { items: [{ kind: "route-ticket", instanceId: `ticket-${turn}`, serviceId }] },
    resolvedRide: { serviceId, direction: 1 }, rawRoll: 2, effectiveFace: 2,
    adjustment: null, movementMode: "normal", pips: 2, hopBudget: 2, physicalHops: 2,
    traversedSegmentIds: [`${turn}-1`, `${turn}-2`], unusedPips: 0, stopReason: "roll",
    landing: landingId ? { serviceId: landingId, direction: 1 } : null,
    landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
  });
  const deadhead = (turn: number, serviceId: string): ItemDeadheadRecord => ({
    kind: "deadhead", turn, fromStationId: "b", toStationId: "a",
    command: { items: [{ kind: "deadhead", instanceId: `ticket-${turn}` }] },
    resolvedRide: null, rawRoll: null, effectiveFace: null, adjustment: null,
    movementMode: "deadhead", pips: null, hopBudget: null, physicalHops: 0,
    unusedPips: null, traversedSegmentIds: [], stopReason: "relocation",
    relocation: { fromStationId: "b", toStationId: "a", serviceId, direction: 1, distance: 8 },
    landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
  });
  const state = (targetServiceId: string, movementHistory: ItemTurnRecord[]): ItemGameState => ({
    ...createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy }, "share-accounting", accountingNetwork),
    config: { ...ITEM_GAME_CONFIG, targetServiceId, itemPolicy: ITEM_GAME_CONFIG.itemPolicy! },
    turn: movementHistory.length, movementHistory,
  });

  it("counts ticket changes and arrival transfers separately; deadhead costs one turn and zero moves", () => {
    const itemGame = state("jr-yamanote", [ride(1, "toei-mita", "metro-marunouchi"), deadhead(2, "jr-yamanote")]);
    expect(summarizeGame(itemGame, grouped)).toEqual({ turns: 2, moves: 2, transfers: 3 });
    expect(buildShareText(display, summarizeGame(itemGame, grouped))).toBe(
      "山手線すごろく 東京近郊版をクリア！\n所要ターン数 2・移動回数 2・乗換回数 3\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app",
    );
  });

  it("excludes same-group ticket, arrival and deadhead changes on Oedo", () => {
    const itemGame = state("toei-oedo-loop", [
      ride(1, "toei-oedo-radial", "toei-oedo-loop"), deadhead(2, "toei-oedo-radial"),
    ]);
    expect(summarizeGame(itemGame, grouped)).toEqual({ turns: 2, moves: 2, transfers: 0 });
  });

  it("ClearScreen copies the item accounting from its original transcript", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const itemGame = state("jr-yamanote", [deadhead(1, "toei-mita")]);
    const mounted = mountReact(createElement(ClearScreen, {
      game: itemGame, network: accountingNetwork, presentation: accountingPresentation, display,
      shareActions: createResultShareActions({ writeText }, undefined), saveStatus: "saved",
      onPlayAgain: vi.fn(), onShowTitle: vi.fn(),
    }));
    await click(mounted.container.querySelector("button")!);
    expect(writeText).toHaveBeenCalledWith(buildShareText(display, { turns: 1, moves: 0, transfers: 1 }));
    expect(mounted.container.textContent).toContain("回送");
    mounted.cleanup();
  });
});
