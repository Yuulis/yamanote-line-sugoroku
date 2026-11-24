// @vitest-environment jsdom
import { summarizeGame } from "../../src/features/game/gameSummary";
import { createItemGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState, ItemRideRecord, ItemDeadheadRecord, ItemTurnRecord } from "../../src/types/network";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClearScreen } from "../../src/features/game/components/ClearScreen";
import type { GameState } from "../../src/types/network";
import { EDITIONS } from "../../src/features/editions/registry";
import { FIXTURE_EDITION_A } from "./fixtures/editions";
import { buildShareText } from "../../src/features/game/shareText";
import { createResultShareActions } from "../../src/features/game/resultShareActions";
import { createResultImageShareActions, type ResultImageShareActions } from "../../src/features/game/resultImageShareActions";
import type { ClearReplayStore } from "../../src/features/game/clearReplayStore";
import type { RouteImageState } from "../../src/features/map/routeImage";
import { trackEvent } from "../../src/features/analytics/analytics";
import type { RailwayNetwork } from "../../src/features/game/engine";
import type { PresentationResolver } from "../../src/features/game/presentationResolver";
import { act } from "react";
import { mountReact } from "./helpers/reactDom";
import { buttonByName, clearResultFor } from "./helpers/clearScreen";

vi.mock("../../src/features/analytics/analytics", () => ({ trackEvent: vi.fn() }));
const trackEventMock = vi.mocked(trackEvent);

const accountingNetwork = buildRailwayNetwork(multiServiceInput());
const accountingPresentation = createPresentationResolver(accountingNetwork);

const display = EDITIONS[0]!.display;
const emptyNetwork = { stationsById: new Map() } as unknown as RailwayNetwork;
const presentation = createPresentationResolver(emptyNetwork);
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
    result: clearResultFor(game, emptyNetwork, presentation, display),
    shareActions: actions,
    saveStatus: "saved",
    onPlayAgain: vi.fn(),
    onShowTitle: vi.fn(),
  }));
}

async function click(button: HTMLButtonElement | undefined): Promise<void> {
  if (!button) throw new Error("Expected the button to exist");
  await act(async () => button.click());
}

const COPY = "結果をコピー";
const SHARE = "共有";

/** The visible share message, and the clear screen's only live region. */
function shareStatus(container: HTMLElement): string | undefined {
  return container.querySelector(".clear-screen__share-status")?.textContent ?? undefined;
}

function liveRegions(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="status"], [aria-live]')];
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
    await click(buttonByName(mounted.container, COPY));
    expect(writeText).toHaveBeenCalledWith(expectedText);
    expect(shareStatus(mounted.container)).toBe("結果をコピーしました");
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual(["結果をコピーしました"]);
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.cleanup();
  });

  it.each(["rejected clipboard", "missing clipboard"])("shows selectable text on %s", async (failureKind) => {
    const clipboard = failureKind === "missing clipboard"
      ? undefined
      : { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const mounted = mountClearScreen(createResultShareActions(clipboard, undefined));
    await click(buttonByName(mounted.container, COPY));
    expect(shareStatus(mounted.container)).toBe(
      "コピーできませんでした。下の文面を選択してコピーしてください。",
    );
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual([
      "コピーできませんでした。下の文面を選択してコピーしてください。",
    ]);
    const textarea = mounted.container.querySelector("textarea");
    expect(textarea?.readOnly).toBe(true);
    expect(textarea?.value).toBe(expectedText);
    expect(mounted.container.querySelector('label[for="clear-share-text"]')?.textContent).toBe("共有する結果");
    mounted.cleanup();
  });

  it("hides share when unavailable and shows it when supported", () => {
    const unavailable = mountClearScreen(createResultShareActions(undefined, undefined));
    expect(buttonByName(unavailable.container, SHARE)).toBeUndefined();
    unavailable.cleanup();

    const share = vi.fn().mockResolvedValue(undefined);
    const available = mountClearScreen(createResultShareActions(undefined, { share }));
    expect(buttonByName(available.container, SHARE)).toBeDefined();
    available.cleanup();
  });

  it("hides share when canShare rejects the text", () => {
    const mounted = mountClearScreen(createResultShareActions(undefined, {
      share: vi.fn(),
      canShare: () => false,
    }));
    expect(buttonByName(mounted.container, SHARE)).toBeUndefined();
    mounted.cleanup();
  });

  it("shows no message when sharing is cancelled", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click(buttonByName(mounted.container, SHARE));
    expect(share).toHaveBeenCalledWith({ text: expectedText });
    expect(shareStatus(mounted.container)).toBe("");
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual([""]);
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.cleanup();
  });

  it("shows selectable text when sharing fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("failed"));
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click(buttonByName(mounted.container, SHARE));
    expect(shareStatus(mounted.container)).toBe(
      "共有できませんでした。下の文面を選択してコピーしてください。",
    );
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual([
      "共有できませんでした。下の文面を選択してコピーしてください。",
    ]);
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
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const itemGame = state("jr-yamanote", [deadhead(1, "toei-mita")]);
    const mounted = mountReact(createElement(ClearScreen, {
      game: itemGame, network: accountingNetwork, presentation: accountingPresentation,
      result: clearResultFor(itemGame, accountingNetwork, accountingPresentation, display),
      shareActions: createResultShareActions({ writeText }, undefined), saveStatus: "saved",
      onPlayAgain: vi.fn(), onShowTitle: vi.fn(),
    }));
    await click(buttonByName(mounted.container, COPY));
    expect(writeText).toHaveBeenCalledWith(buildShareText(display, { turns: 1, moves: 0, transfers: 1 }));
    // The deadhead entry now lives in the history dialog, not on the card.
    expect(mounted.container.textContent).not.toContain("回送");
    await click(buttonByName(mounted.container, "移動履歴を見る"));
    expect(mounted.container.querySelector("dialog")?.textContent).toContain("回送");
    mounted.cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });
});


describe("ClearScreen image sharing", () => {
  const X_TEXT = expectedText;
  const X_INTENT = `https://x.com/intent/post?text=${encodeURIComponent(X_TEXT)}`;
  const PASTE_HINT = "Xの投稿画面に画像を貼り付けてください";
  const blob = new Blob(["png"], { type: "image/png" });
  const file = new File([blob], "yamanote-sugoroku-route.png", { type: "image/png" });
  const readyImage: RouteImageState = {
    kind: "ready", image: { blob, file, url: "blob:http://localhost/route", filename: "yamanote-sugoroku-route.png" },
  };

  /** Image actions whose every platform call lands in `log`; `overrides` swap single behaviours. */
  function stubImageActions(log: string[], overrides: Partial<ResultImageShareActions> = {}): ResultImageShareActions {
    return {
      canShareFile: () => false,
      shareFile: () => { log.push("shareFile"); return Promise.resolve("success"); },
      copyImageAndOpenX: () => { log.push("copyImageAndOpenX"); return { clipboard: Promise.resolve("copied"), navigation: "started" }; },
      saveImage: () => { log.push("saveImage"); return "dispatched"; },
      ...overrides,
    };
  }

  function replayStoreAt(phase: "idle" | "playing" | "paused", log: string[]): ClearReplayStore {
    return {
      subscribePhase: () => () => undefined,
      getPhase: () => phase,
      pause: vi.fn(),
      finish: vi.fn(() => { log.push("finish"); }),
    } as unknown as ClearReplayStore;
  }

  function mountImageScreen(options: {
    routeImage?: RouteImageState;
    imageShareActions?: ResultImageShareActions;
    replayStore?: ClearReplayStore;
    onImageDownloadStarted?: () => void;
  }) {
    return mountReact(createElement(ClearScreen, {
      game, network: emptyNetwork, presentation,
      result: clearResultFor(game, emptyNetwork, presentation, display),
      shareActions: createResultShareActions({ writeText: vi.fn().mockResolvedValue(undefined) }, undefined),
      saveStatus: "saved", onPlayAgain: vi.fn(), onShowTitle: vi.fn(),
      routeImage: options.routeImage ?? readyImage,
      imageShareActions: options.imageShareActions ?? stubImageActions([]),
      replayStore: options.replayStore,
      onImageDownloadStarted: options.onImageDownloadStarted,
    }));
  }

  const textLink = (container: HTMLElement): HTMLAnchorElement | null => container.querySelector("a.clear-screen__x-text-link");
  const events = (): Array<Record<string, unknown>> => trackEventMock.mock.calls.map(([, params]) => params);

  beforeEach(() => { trackEventMock.mockClear(); });

  it("shows only a disabled 画像を準備中… state on the image actions while the PNG is pending", () => {
    const mounted = mountImageScreen({ routeImage: { kind: "pending" } });
    const pending = buttonByName(mounted.container, "画像を準備中…");
    expect(pending?.disabled).toBe(true);
    expect(buttonByName(mounted.container, "Xでシェア")).toBeUndefined();
    expect(buttonByName(mounted.container, "画像を保存")).toBeUndefined();
    expect(buttonByName(mounted.container, COPY)).toBeDefined();
    expect(textLink(mounted.container)?.getAttribute("href")).toBe(X_INTENT);
    mounted.cleanup();
  });

  it.each(["unavailable", "failed"] as const)("keeps only the text paths when the image is %s", (kind) => {
    const mounted = mountImageScreen({ routeImage: { kind } });
    for (const name of ["Xでシェア", "画像を保存", "画像を準備中…"]) expect(buttonByName(mounted.container, name)).toBeUndefined();
    expect(buttonByName(mounted.container, COPY)).toBeDefined();
    const link = textLink(mounted.container);
    expect(link?.textContent).toBe("文面だけXに投稿");
    expect(link?.getAttribute("href")).toBe(X_INTENT);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
    const note = mounted.container.querySelector(".clear-screen__image-note")?.textContent ?? null;
    expect(note).toBe(kind === "failed" ? "画像を作成できませんでした。文面だけで共有できます。" : null);
    // The failure is a visible note only: the single polite region is not used for it (it would replace the
    // completion sentence), and the note itself has no live attributes.
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual([""]);
    expect(mounted.container.querySelector(".clear-screen__image-note")?.closest("[aria-live],[role=status]") ?? null).toBeNull();
    mounted.cleanup();
  });

  it("moves keyboard focus from 共有 to Xでシェア when the image becomes ready on a file-share device", () => {
    const props = {
      game, network: emptyNetwork, presentation,
      result: clearResultFor(game, emptyNetwork, presentation, display),
      shareActions: createResultShareActions(
        { writeText: vi.fn().mockResolvedValue(undefined) },
        { share: vi.fn().mockResolvedValue(undefined), canShare: () => true },
      ),
      saveStatus: "saved" as const, onPlayAgain: vi.fn(), onShowTitle: vi.fn(),
      imageShareActions: stubImageActions([], { canShareFile: () => true }),
    };
    const mounted = mountReact(createElement(ClearScreen, { ...props, routeImage: { kind: "pending" } }));
    const textShare = buttonByName(mounted.container, "共有");
    if (!textShare) throw new Error("共有 is shown while the image is pending");
    act(() => textShare.focus());
    expect(document.activeElement).toBe(textShare);

    act(() => mounted.root.render(createElement(ClearScreen, { ...props, routeImage: readyImage })));
    expect(buttonByName(mounted.container, "共有")).toBeUndefined();
    expect(document.activeElement).toBe(buttonByName(mounted.container, "Xでシェア"));
    mounted.cleanup();
  });

  it("starts the desktop copy-and-open in the click and shows the paste hint only after both succeed", async () => {
    const log: string[] = [];
    const mounted = mountImageScreen({ imageShareActions: stubImageActions(log), replayStore: replayStoreAt("playing", log) });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(log).toEqual(["finish", "copyImageAndOpenX"]);
    expect(shareStatus(mounted.container)).toBe(PASTE_HINT);
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual([PASTE_HINT]);
    expect(events()).toEqual([{ method: "x", outcome: "success" }]);
    mounted.cleanup();
  });

  it("passes the original blob and the full unchanged text to the desktop path", async () => {
    const copyImageAndOpenX = vi.fn(() => ({ clipboard: Promise.resolve("copied" as const), navigation: "started" as const }));
    const mounted = mountImageScreen({ imageShareActions: stubImageActions([], { copyImageAndOpenX }) });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(copyImageAndOpenX).toHaveBeenCalledWith(blob, X_TEXT);
    mounted.cleanup();
  });

  it.each([
    ["copied", "blocked", "画像をコピーしましたが、Xを開けませんでした。「文面だけXに投稿」から開いて貼り付けるか、「画像を保存」を使ってください。"],
    ["rejected", "started", "Xを開きましたが、画像をコピーできませんでした。「画像を保存」して投稿に添付してください。"],
    ["unavailable", "open-threw", "Xを開けず、画像もコピーできませんでした。「画像を保存」と「文面だけXに投稿」を使ってください。"],
    ["sync-failed", "location-failed", "Xを開けず、画像もコピーできませんでした。「画像を保存」と「文面だけXに投稿」を使ってください。"],
  ] as const)("reports partial or total failure (%s, %s) without the paste hint", async (clipboard, navigation, message) => {
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions([], { copyImageAndOpenX: () => ({ clipboard: Promise.resolve(clipboard), navigation }) }),
    });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(shareStatus(mounted.container)).toBe(message);
    expect(shareStatus(mounted.container)).not.toContain("貼り付けてください。");
    expect(events()).toEqual([{ method: "x", outcome: "failed" }]);
    expect(buttonByName(mounted.container, "画像を保存")).toBeDefined();
    expect(textLink(mounted.container)).not.toBeNull();
    mounted.cleanup();
  });

  it("shares the real File and the full text natively on a phone, hides the text-only 共有 and stays silent on success", async () => {
    const log: string[] = [];
    const shareFile = vi.fn(() => { log.push("shareFile"); return Promise.resolve("success" as const); });
    const copyImageAndOpenX = vi.fn();
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions(log, { canShareFile: (candidate) => candidate === file, shareFile, copyImageAndOpenX }),
      replayStore: replayStoreAt("paused", log),
    });
    // The text-only native 共有 would repeat what the file share already does.
    expect(buttonByName(mounted.container, SHARE)).toBeUndefined();
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(log).toEqual(["finish", "shareFile"]);
    expect(shareFile).toHaveBeenCalledWith(file, X_TEXT);
    expect(copyImageAndOpenX).not.toHaveBeenCalled();
    expect(shareStatus(mounted.container)).toBe("");
    expect(events()).toEqual([{ method: "x", outcome: "success" }]);
    mounted.cleanup();
  });

  it("keeps the text-only 共有 when the file share is not available", () => {
    const withShare = mountReact(createElement(ClearScreen, {
      game, network: emptyNetwork, presentation, result: clearResultFor(game, emptyNetwork, presentation, display),
      shareActions: createResultShareActions(undefined, { share: vi.fn() }), saveStatus: "saved",
      onPlayAgain: vi.fn(), onShowTitle: vi.fn(), routeImage: readyImage, imageShareActions: stubImageActions([]),
    }));
    expect(buttonByName(withShare.container, SHARE)).toBeDefined();
    withShare.cleanup();
  });

  it("treats a cancelled file share as silent, finishes the replay first, and still records one event", async () => {
    const log: string[] = [];
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions(log, { canShareFile: () => true, shareFile: () => Promise.resolve("cancelled") }),
      replayStore: replayStoreAt("playing", log),
    });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(log).toEqual(["finish"]);
    expect(shareStatus(mounted.container)).toBe("");
    expect(liveRegions(mounted.container).map((region) => region.textContent)).toEqual([""]);
    expect(events()).toEqual([{ method: "x", outcome: "cancelled" }]);
    mounted.cleanup();
  });

  it("guides to saving the image and the text link when the file share fails", async () => {
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions([], { canShareFile: () => true, shareFile: () => Promise.resolve("failed") }),
    });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(shareStatus(mounted.container)).toBe(
      "共有できませんでした。「画像を保存」してXの投稿に添付するか、「文面だけXに投稿」を使ってください。",
    );
    expect(events()).toEqual([{ method: "x", outcome: "failed" }]);
    mounted.cleanup();
  });

  it("uses the desktop copy-and-open path when file sharing is not available", async () => {
    const log: string[] = [];
    const mounted = mountImageScreen({ imageShareActions: stubImageActions(log, { canShareFile: () => false }) });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(log).toEqual(["copyImageAndOpenX"]);
    mounted.cleanup();
  });

  it("emits one event and no state update when the screen is left before the share settles", async () => {
    let settle: (outcome: "success" | "failed" | "cancelled") => void = () => undefined;
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions([], {
        canShareFile: () => true,
        shareFile: () => new Promise((resolve) => { settle = resolve; }),
      }),
    });
    await click(buttonByName(mounted.container, "Xでシェア"));
    const container = mounted.container;
    mounted.cleanup();
    await act(async () => settle("failed"));
    expect(events()).toEqual([{ method: "x", outcome: "failed" }]);
    expect(container.textContent).toBe("");
  });

  it("ignores a second click while the first share is unsettled, and accepts a new one after it settles", async () => {
    const log: string[] = [];
    let settle: (outcome: "success") => void = () => undefined;
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions(log, {
        canShareFile: () => true,
        shareFile: () => { log.push("shareFile"); return new Promise((resolve) => { settle = resolve; }); },
      }),
    });
    const button = buttonByName(mounted.container, "Xでシェア");
    await click(button);
    await click(button);
    expect(log).toEqual(["shareFile"]);
    await act(async () => settle("success"));
    expect(events()).toEqual([{ method: "x", outcome: "success" }]);
    await click(button);
    expect(log).toEqual(["shareFile", "shareFile"]);
    mounted.cleanup();
  });

  it("saves through the adapter, marks the download in the same click, and reports one event", async () => {
    const log: string[] = [];
    const saveImage = vi.fn(() => { log.push("saveImage"); return "dispatched" as const; });
    const mounted = mountImageScreen({
      imageShareActions: stubImageActions(log, { saveImage }),
      replayStore: replayStoreAt("playing", log),
      onImageDownloadStarted: () => { log.push("marked"); },
    });
    await click(buttonByName(mounted.container, "画像を保存"));
    expect(log).toEqual(["finish", "marked", "saveImage"]);
    expect(saveImage).toHaveBeenCalledWith("blob:http://localhost/route", "yamanote-sugoroku-route.png");
    expect(shareStatus(mounted.container)).toBe("画像の保存を始めました");
    expect(events()).toEqual([{ method: "save", outcome: "success" }]);
    mounted.cleanup();
  });

  it("reports a failed save with the text fallbacks", async () => {
    const mounted = mountImageScreen({ imageShareActions: stubImageActions([], { saveImage: () => "failed" }) });
    await click(buttonByName(mounted.container, "画像を保存"));
    expect(shareStatus(mounted.container)).toBe("画像を保存できませんでした。「文面だけXに投稿」か「結果をコピー」を使ってください。");
    expect(events()).toEqual([{ method: "save", outcome: "failed" }]);
    mounted.cleanup();
  });

  it("counts the text-only X link as one handoff and finishes the replay without preventing the navigation", async () => {
    const log: string[] = [];
    const mounted = mountImageScreen({ routeImage: { kind: "failed" }, replayStore: replayStoreAt("paused", log) });
    const link = textLink(mounted.container)!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.addEventListener("click", (clickEvent) => clickEvent.preventDefault(), { once: true });
    await act(async () => link.dispatchEvent(event));
    expect(log).toEqual(["finish"]);
    expect(events()).toEqual([{ method: "x", outcome: "success" }]);
    mounted.cleanup();
  });

  it("finishes a running replay before copying or sharing the text, and not when no replay runs", async () => {
    const log: string[] = [];
    const mounted = mountImageScreen({ replayStore: replayStoreAt("playing", log) });
    await click(buttonByName(mounted.container, COPY));
    expect(log).toEqual(["finish"]);
    mounted.cleanup();
    const idleLog: string[] = [];
    const idle = mountImageScreen({ replayStore: replayStoreAt("idle", idleLog), imageShareActions: stubImageActions(idleLog) });
    await click(buttonByName(idle.container, COPY));
    await click(buttonByName(idle.container, "Xでシェア"));
    await click(buttonByName(idle.container, "画像を保存"));
    expect(idleLog).toEqual(["copyImageAndOpenX", "saveImage"]);
    idle.cleanup();
  });

  it("normalises the existing text share outcome shared to success", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const mounted = mountClearScreen(createResultShareActions(undefined, { share }));
    await click(buttonByName(mounted.container, SHARE));
    expect(events()).toEqual([{ method: "share", outcome: "success" }]);
    mounted.cleanup();
  });

  it("builds the real image adapter chain from platform doubles end to end", async () => {
    const log: string[] = [];
    const actions = createResultImageShareActions({
      createClipboardItem: () => { log.push("item"); return {} as ClipboardItem; },
      writeClipboard: () => { log.push("write"); return Promise.resolve(); },
      openWindow: () => {
        log.push("open");
        return { opener: {}, location: { set href(value: string) { log.push(`href=${value}`); } }, close: vi.fn() } as unknown as WindowProxy;
      },
    });
    const mounted = mountImageScreen({ imageShareActions: actions });
    await click(buttonByName(mounted.container, "Xでシェア"));
    expect(log).toEqual(["item", "write", "open", `href=${X_INTENT}`]);
    expect(shareStatus(mounted.container)).toBe(PASTE_HINT);
    mounted.cleanup();
  });
});
