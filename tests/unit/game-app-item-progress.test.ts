// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { networkFromData } from "../../src/features/game/networkFromData";
import type { ItemGameState } from "../../src/types/network";
import { turnToasts } from "../../src/features/game/toastQueue";
import { itemLastMove } from "../../src/features/game/itemSession";
import { dispatchReactEvent, flushReact, mountReact, type MountedReact } from "./helpers/reactDom";
import { itemScenario, ITEM_SCENARIOS } from "../e2e/fixtures/itemScenarios";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";

vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: () => createElement("div") }));

const data = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const result = networkFromData(data);
if (!result.ok) throw new Error(result.reason);
const network = result.network;
const edition = EDITIONS[0];
let mounted: MountedReact | undefined;

type HarnessProps = ComponentProps<typeof GameApp>;

function Harness(props: HarnessProps) {
  return createElement(GameApp, props);
}

beforeAll(() => {
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

function click(label: string): void {
  const button = [...mounted!.container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
}

function openApp(game: ItemGameState): void {
  localStorage.setItem(edition.saveKey, serializeGame(game));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mounted = mountReact(createElement(Harness, {
    data, network, edition, picker: {
      editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
      focusPicker: false, onPickerFocusRestored: vi.fn(),
    },
  }));
  click("つづきから");
}

function advanceTime(milliseconds: number): void {
  act(() => vi.advanceTimersByTime(milliseconds));
}

function rollUntilToast(): string {
  for (let turn = 0; turn < 12; turn += 1) {
    const before = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
    click("サイコロを振る");
    const adjustment = mounted!.container.querySelector<HTMLButtonElement>(".item-adjustment .dialog__actions button");
    if (adjustment) dispatchReactEvent(adjustment, new MouseEvent("click", { bubbles: true }));
    const discard = mounted!.container.querySelector<HTMLButtonElement>(".item-discard__choice");
    if (discard) dispatchReactEvent(discard, new MouseEvent("click", { bubbles: true }));
    const saved = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
    const record = saved.movementHistory.at(-1);
    if (!record) throw new Error("Expected the committed engine turn");
    const expected = saved.turn > before.turn && record.turn === saved.turn
      ? turnToasts(1, itemLastMove(record, network), network)[0]?.text
      : undefined;
    click("スキップ");
    if (expected) {
      const visible = mounted!.container.querySelector(".toast-host__toast")?.textContent;
      if (visible !== expected) throw new Error(`Expected toast ${expected}, got ${visible}; dialogs=${[...mounted!.container.querySelectorAll("dialog")].map((dialog) => dialog.textContent).join(" | ")}; turn=${saved.turn}`);
      return expected;
    }
  }
  throw new Error("No engine turn produced a toast");
}

/** One settled engine turn through the UI, declining adjustment and discarding the first choice. */
function rollTurn(): void {
  click("サイコロを振る");
  const adjustment = mounted!.container.querySelector<HTMLButtonElement>(".item-adjustment .dialog__actions button");
  if (adjustment) dispatchReactEvent(adjustment, new MouseEvent("click", { bubbles: true }));
  const discard = mounted!.container.querySelector<HTMLButtonElement>(".item-discard__choice");
  if (discard) dispatchReactEvent(discard, new MouseEvent("click", { bubbles: true }));
  click("スキップ");
}

function toastTexts(): (string | null)[] {
  return [...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent);
}

function openRouteTicketDialog(): void {
  const routeSlot = [...mounted!.container.querySelectorAll<HTMLElement>(".item-slot")]
    .find((slot) => slot.querySelector("h3")?.textContent === ITEM_DESCRIPTIONS["route-ticket"].name);
  const routeButton = routeSlot?.querySelector<HTMLButtonElement>("button");
  if (!routeButton || routeButton.disabled) throw new Error("Expected a usable route ticket on the engine-built scenario");
  dispatchReactEvent(routeButton, new MouseEvent("click", { bubbles: true }));
  expect(mounted!.container.querySelector(".item-dialog")).not.toBeNull();
}

function gameBefore(seed: string, turn: number): ItemGameState {
  let game = createItemGame(ITEM_GAME_CONFIG, seed, network);
  while (game.turn < turn) {
    game = playItemTurn(game, {}, network).state;
    if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
  }
  return game;
}

function stat(label: string): string | null {
  return [...mounted!.container.querySelectorAll("dt")]
    .find((term) => term.textContent === label)?.nextElementSibling?.textContent ?? null;
}

describe("item progress in GameApp", () => {
  it("shows event toasts only after movement settles", () => {
    const game = createItemGame(edition.config, "toast-after-settle", network);
    localStorage.setItem(edition.saveKey, serializeGame(game));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mounted = mountReact(createElement(GameApp, {
      data, network, edition, picker: {
        editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
        focusPicker: false, onPickerFocusRestored: vi.fn(),
      },
    }));
    click("つづきから");

    let expectedToast = "";
    for (let turn = 0; turn < 8 && !expectedToast; turn += 1) {
      click("サイコロを振る");
      const saved = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
      const record = saved.movementHistory.at(-1);
      if (!record) throw new Error("Expected the movement save boundary to contain its record");
      expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
      expectedToast = turnToasts(1, itemLastMove(record, network), network)[0]?.text ?? "";
      click("スキップ");
      if (expectedToast) {
        expect(mounted!.container.querySelector(".toast-host__toast")?.textContent).toBe(expectedToast);
      }
    }
    expect(expectedToast).not.toBe("");
  });

  it("shows unavailable save status without raising a failure toast", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    mounted = mountReact(createElement(Harness, {
      data, network, edition, picker: {
        editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
        focusPicker: false, onPickerFocusRestored: vi.fn(),
      },
    }));
    click("はじめから");
    expect(mounted.container.querySelector(".game-panel__save")?.textContent).toContain("この環境では保存できません");
    expect(mounted.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
  });

  it("resumes a pending discard without replaying its baseline pickup toast", async () => {
    const pending = playItemTurn(itemScenario("discard", network), {}, network).state;
    if (pending.pending?.kind !== "discard") throw new Error("Expected the engine-built discard decision");
    expect(turnToasts(1, itemLastMove(pending.pending.record, network), network)).toHaveLength(1);
    openApp(pending);
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
    const choice = mounted!.container.querySelector<HTMLButtonElement>(".item-discard__choice");
    if (!choice) throw new Error("Expected the resumed discard choices");
    dispatchReactEvent(choice, new MouseEvent("click", { bubbles: true }));
    await flushReact();
    click("スキップ");
    await flushReact();
    const saved = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
    const record = saved.movementHistory.at(-1);
    const discardEvent = record?.itemEvents.find((event) => event.type === "discarded");
    if (!record || discardEvent?.type !== "discarded") throw new Error("Expected the new discard event");
    const toastTexts = [...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent);
    expect(toastTexts).toEqual([`${ITEM_DESCRIPTIONS[discardEvent.item.kind].name}を捨てた`]);
  });

  it("does not replay item events from a settled save on resume", () => {
    const saved = (["route", "rapid", "double", "discard", "certificate", "delay", "adjust", "oversleep"] as const)
      .map((name) => itemScenario(name, network))
      .find((game) => {
        const latest = game.movementHistory.at(-1);
        return Boolean(latest && turnToasts(1, itemLastMove(latest, network), network).length > 0);
      });
    if (!saved) throw new Error("Expected an engine fixture with a toast-bearing latest record");
    const latest = saved.movementHistory.at(-1);
    if (!latest || turnToasts(1, itemLastMove(latest, network), network).length === 0) {
      throw new Error("Expected the resumed engine record to contain convertible item events");
    }
    openApp(saved);
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
  });

  it("pauses GameApp toast reading while the new-game confirmation is open", () => {
    vi.useFakeTimers();
    openApp(itemScenario("route", network));
    const firstToast = rollUntilToast();
    advanceTime(1500);
    click("新規");
    expect(mounted!.container.querySelector('[role="alertdialog"]')).not.toBeNull();
    advanceTime(10000);
    expect(mounted!.container.querySelector(".toast-host__toast")?.textContent).toBe(firstToast);
    click("キャンセル");
    advanceTime(2499);
    expect(mounted!.container.querySelector(".toast-host__toast")?.textContent).toBe(firstToast);
    advanceTime(1);
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
  });

  it("replaces an open item dialog without inheriting obscuration or stale toasts", () => {
    vi.useFakeTimers();
    openApp(itemScenario("route", network));
    const oldToast = rollUntilToast();
    advanceTime(1500);
    // The fixture's next turn reaches a station where the route ticket has a choice.
    rollTurn();
    openRouteTicketDialog();
    expect(toastTexts()).toContain(oldToast);
    advanceTime(10000);
    expect(toastTexts()).toContain(oldToast);
    click("新規");
    // Pin the new session's seed so its first toast-bearing turn is deterministic (fixture route seed).
    const routeSeedBytes = ITEM_SCENARIOS.route.seed.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
    vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.set(routeSeedBytes.slice(0, array.length));
      return array;
    });
    click("新しく始める");
    expect(JSON.parse(localStorage.getItem(edition.saveKey)!).rngSeed).toBe(ITEM_SCENARIOS.route.seed);
    expect(mounted!.container.querySelector(".item-dialog")).toBeNull();
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);

    const newToast = rollUntilToast();
    advanceTime(3999);
    expect(mounted!.container.querySelector(".toast-host__toast")?.textContent).toBe(newToast);
    advanceTime(1);
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
  });

  it("keeps a part-read toast paused while the obscuring cause switches between dialogs", () => {
    vi.useFakeTimers();
    openApp(itemScenario("route", network));
    const toastText = rollUntilToast();
    advanceTime(1500);
    // The fixture's next turn reaches a station where the route ticket has a choice.
    rollTurn();
    openRouteTicketDialog();
    click("新規");
    expect(mounted!.container.querySelector('[role="alertdialog"]')).not.toBeNull();
    advanceTime(10000);
    expect(toastTexts()).toContain(toastText);
    // Cancelling the confirmation leaves ItemUseDialog as the only cause: still paused.
    const cancelConfirm = [...mounted!.container.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((button) => button.textContent?.includes("キャンセル"));
    if (!cancelConfirm) throw new Error("Missing the confirmation cancel button");
    dispatchReactEvent(cancelConfirm, new MouseEvent("click", { bubbles: true }));
    expect(mounted!.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mounted!.container.querySelector(".item-dialog")).not.toBeNull();
    advanceTime(10000);
    expect(toastTexts()).toContain(toastText);
    click("キャンセル");
    expect(mounted!.container.querySelector(".item-dialog")).toBeNull();
    advanceTime(2499);
    expect(toastTexts()).toContain(toastText);
    advanceTime(1);
    expect(toastTexts()).not.toContain(toastText);
  });

  it("resumes the remaining reading time after ItemUseDialog closes", () => {
    vi.useFakeTimers();
    openApp(itemScenario("route", network));
    const toastText = rollUntilToast();
    advanceTime(1500);
    // The fixture's next turn reaches a station where the route ticket has a choice.
    rollTurn();
    openRouteTicketDialog();
    advanceTime(10000);
    expect(toastTexts()).toContain(toastText);
    click("キャンセル");
    expect(mounted!.container.querySelector(".item-dialog")).toBeNull();
    advanceTime(2499);
    expect(toastTexts()).toContain(toastText);
    advanceTime(1);
    expect(toastTexts()).not.toContain(toastText);
  });

  it("pauses a live toast through the roll-adjustment decision", () => {
    vi.useFakeTimers();
    openApp(gameBefore(ITEM_SCENARIOS.adjust.seed, ITEM_SCENARIOS.adjust.turn - 1));
    const toastText = rollUntilToast();
    advanceTime(1500);
    click("サイコロを振る");
    expect(mounted!.container.querySelector(".item-adjustment")).not.toBeNull();
    advanceTime(10000);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).toContain(toastText);
    click("そのまま続ける");
    click("スキップ");
    advanceTime(2499);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).toContain(toastText);
    advanceTime(1);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).not.toContain(toastText);
  });

  it("pauses a live toast through the discard decision", () => {
    vi.useFakeTimers();
    openApp(gameBefore(ITEM_SCENARIOS.discard.seed, ITEM_SCENARIOS.discard.turn - 2));
    const toastText = rollUntilToast();
    advanceTime(1500);
    for (let turn = 0; turn < 3 && !mounted!.container.querySelector(".item-discard"); turn += 1) {
      click("サイコロを振る");
      if (mounted!.container.querySelector(".item-discard")) break;
      const adjustment = mounted!.container.querySelector<HTMLButtonElement>(".item-adjustment .dialog__actions button");
      if (adjustment) dispatchReactEvent(adjustment, new MouseEvent("click", { bubbles: true }));
      click("スキップ");
    }
    expect(mounted!.container.querySelector(".item-discard")).not.toBeNull();
    advanceTime(10000);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).toContain(toastText);
    const choice = mounted!.container.querySelector<HTMLButtonElement>(".item-discard__choice");
    if (!choice) throw new Error("Expected engine-built discard choices");
    dispatchReactEvent(choice, new MouseEvent("click", { bubbles: true }));
    click("スキップ");
    advanceTime(2499);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).toContain(toastText);
    advanceTime(1);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).not.toContain(toastText);
  });

  it.each(["saved", "failed"] as const)("keeps the origin visible until the %s movement save attempt", (outcome) => {
    const game = createItemGame(edition.config, "review-order", network);
    localStorage.setItem(edition.saveKey, serializeGame(game));
    // Hold the first frame so the post-save animation start is observable.
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mounted = mountReact(createElement(StrictMode, null, createElement(GameApp, {
      data, network, edition, picker: {
        editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
        focusPicker: false, onPickerFocusRestored: vi.fn(),
      },
    })));
    click("つづきから");
    expect(stat("現在駅")).toBe("新橋");
    const duringSave: { station: string | null; progress: string | null }[] = [];
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      const saved = JSON.parse(value) as ItemGameState;
      if (saved.turn === 1 && saved.pending === null) {
        expect(saved.currentStationId).not.toBe(game.currentStationId);
        duringSave.push({ station: stat("現在駅"), progress: stat("踏破区間") });
        if (outcome === "failed") throw new Error("quota");
      }
      write.call(this, key, value);
    });

    click("サイコロを振る");

    expect(duringSave).toEqual([{ station: "新橋", progress: "0/30" }]);
    expect(stat("現在駅")).toBe("新橋");
    expect(stat("踏破区間")).toBe("0/30");
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    click("スキップ");
    expect(stat("現在駅")).toBe("浜松町");
    expect(stat("踏破区間")).toBe("1/30");
  });
});
