// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { beginItemTurn, createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { buildGeometryIndex, buildMovePlan } from "../../src/features/game/animation/movePath";
import { hopDurationMs, MAX_MOVE_DURATION_MS } from "../../src/features/game/animation/timeline";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { networkFromData } from "../../src/features/game/networkFromData";
import type { ItemGameState } from "../../src/types/network";
import { turnToasts } from "../../src/features/game/toastQueue";
import { itemLastMove } from "../../src/features/game/itemSession";
import { dispatchReactEvent, flushReact, mountReact, type MountedReact } from "./helpers/reactDom";
import { itemScenario, ITEM_SCENARIOS } from "../e2e/fixtures/itemScenarios";
import { playTurn } from "../e2e/fixtures/productGame";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";

const { railwayMapProps } = vi.hoisted(() => ({ railwayMapProps: vi.fn() }));
vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: (props: { panelKey?: number }) => {
  railwayMapProps(props);
  return createElement("div");
} }));

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
  railwayMapProps.mockClear();
});

describe("RailwayMap panel session key", () => {
  it("tracks the mounted panel session, changes for a new game, and clears on the title screen", () => {
    localStorage.setItem(edition.saveKey, serializeGame(itemScenario("route", network)));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mounted = mountReact(createElement(Harness, {
      data, network, edition, picker: {
        editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(),
        focusPicker: false, onPickerFocusRestored: vi.fn(),
      },
    }));
    click("つづきから");
    const resumedKey = railwayMapProps.mock.calls.at(-1)?.[0].panelKey;
    expect(typeof resumedKey).toBe("number");

    click("新規");
    click("新しく始める");
    const newGameKey = railwayMapProps.mock.calls.at(-1)?.[0].panelKey;
    expect(typeof newGameKey).toBe("number");
    expect(newGameKey).not.toBe(resumedKey);

    click("タイトル");
    expect(railwayMapProps.mock.calls.at(-1)?.[0].panelKey).toBeUndefined();
  });
});

function click(label: string): void {
  const button = [...mounted!.container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
}

/**
 * S11: an adjustment dialog is presented only after the dice tumble. When the click saved a pending roll, end the
 * tumble with the shared スキップ (it consumes no clock time, so toast reading clocks are untouched) and return the
 * presented dialog's Continue button; null when the turn needs no adjustment.
 */
function reachPresentedAdjustment(): HTMLButtonElement | null {
  const saved = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
  if (saved.pending?.kind !== "roll") return null;
  expect(mounted!.container.querySelector(".item-adjustment")).toBeNull();
  click("スキップ");
  const proceed = mounted!.container.querySelector<HTMLButtonElement>(".item-adjustment .dialog__actions button");
  expect(proceed?.textContent).toBe("そのまま続ける");
  return proceed;
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

/** Normal-speed (450 ms/hop) and はやい (300 ms/hop) tumble durations, written down from the specification. */
const NORMAL_TUMBLE_MS = 600;
const FAST_TUMBLE_MS = 400;
/** S12 arrival stage at normal and fast speed (800 x 300 / 450, rounded). */
const NORMAL_ARRIVAL_MS = 800;
const FAST_ARRIVAL_MS = 533;

/** S11 pre-move checkpoint: run the dice tumble's stage timer (callers install fake setTimeout first). */
function advanceTumble(milliseconds: number): void {
  act(() => vi.advanceTimersByTime(milliseconds));
}

/**
 * Fixture guard for the pre-move checkpoint: the next turn of `game` (engine-built) shows no modifier stamps, so
 * the movement is released by the end of the tumble alone.
 */
function expectNoStampsNext(game: ItemGameState): void {
  const record = playItemTurn(game, {}, network).record;
  if (record?.kind !== "item-ride") throw new Error("Expected a plain ride record");
  expect({
    movementMode: record.movementMode, adjustment: record.adjustment, items: record.command.items.length,
    forced: record.effectiveFace !== record.rawRoll,
    delay: record.itemEvents.some((event) => event.type === "effect-activated" && event.effect === "delay"),
  }).toEqual({ movementMode: "normal", adjustment: null, items: 0, forced: false, delay: false });
}

function advanceTime(milliseconds: number): void {
  act(() => vi.advanceTimersByTime(milliseconds));
}

function rollUntilToast(): string {
  for (let turn = 0; turn < 12; turn += 1) {
    const before = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
    click("サイコロを振る");
    const adjustment = reachPresentedAdjustment();
    if (adjustment) dispatchReactEvent(adjustment, new MouseEvent("click", { bubbles: true }));
    const discard = mounted!.container.querySelector<HTMLButtonElement>(".item-discard .item-card__action");
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
  const adjustment = reachPresentedAdjustment();
  if (adjustment) dispatchReactEvent(adjustment, new MouseEvent("click", { bubbles: true }));
  const discard = mounted!.container.querySelector<HTMLButtonElement>(".item-discard .item-card__action");
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
  const useButton = mounted!.container.querySelector<HTMLButtonElement>(".item-card__action");
  expect(useButton).not.toBeNull();
  expect(useButton?.disabled).toBe(false);
  click("使う");
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
    .find((term) => term.textContent === label)?.nextElementSibling
    ?.querySelector<HTMLElement>(".hud-stat__value")?.textContent ?? null;
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
    const choice = mounted!.container.querySelector<HTMLButtonElement>(".item-discard .item-card__action");
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
    // S11: the dialog is presented after the tumble; Skip ends the tumble without consuming reading time.
    reachPresentedAdjustment();
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
      const adjustment = reachPresentedAdjustment();
      if (adjustment) dispatchReactEvent(adjustment, new MouseEvent("click", { bubbles: true }));
      click("スキップ");
    }
    expect(mounted!.container.querySelector(".item-discard")).not.toBeNull();
    advanceTime(10000);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).toContain(toastText);
    const choice = mounted!.container.querySelector<HTMLButtonElement>(".item-discard .item-card__action");
    if (!choice) throw new Error("Expected engine-built discard choices");
    dispatchReactEvent(choice, new MouseEvent("click", { bubbles: true }));
    click("スキップ");
    advanceTime(2499);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).toContain(toastText);
    advanceTime(1);
    expect([...mounted!.container.querySelectorAll(".toast-host__toast")].map((toast) => toast.textContent)).not.toContain(toastText);
  });

  it.each(["saved", "failed"] as const)("keeps the origin visible until the %s movement save attempt", (outcome) => {
    // S11: the tumble's stage timer must be controllable; the stubbed animation frames stay stubbed.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    // S11 re-point: no movement frame while the tumble gates the move, then the frame after its release.
    expectNoStampsNext(game);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    advanceTumble(NORMAL_TUMBLE_MS);
    expect(stat("現在駅")).toBe("新橋");
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    click("スキップ");
    expect(stat("現在駅")).toBe("浜松町");
    expect(stat("踏破区間")).toBe("1/30");
  });
});

// ---------------------------------------------------------------------------
// S10b integration fixtures. They describe today's behaviour (no tumble, no
// attempt in production) through the real GameApp + useGameApp + storage path,
// so S11 can re-point their literals instead of rebuilding the fixtures.
// ---------------------------------------------------------------------------

/** Fixed seed whose turn 1 and turn 2 need neither adjustment nor discard. */
const PLAIN_SEED = "review-order";
/** Hop-time scale of each ANIMATION_SPEEDS entry, in ms per hop. */
const NORMAL_STEP_MS = 450;
const FAST_STEP_MS = 300;

/** What the screen shows at one instant; `frames` counts requestAnimationFrame calls so far. */
interface ScreenReading {
  station: string | null;
  progress: string | null;
  dice: string | null;
  diceDisabled: string | null;
  frames: number;
}

function readScreen(): ScreenReading {
  const dice = mounted!.container.querySelector(".game-panel__roll");
  return {
    station: stat("現在駅"), progress: stat("踏破区間"), dice: dice?.textContent ?? null,
    diceDisabled: dice?.getAttribute("aria-disabled") ?? null,
    frames: vi.mocked(window.requestAnimationFrame).mock.calls.length,
  };
}

function saveStatusText(): string | null {
  return mounted!.container.querySelector(".game-panel__save")?.textContent ?? null;
}

/** What the browser storage holds right now: the last write that returned successfully. */
function storedSave(): { turn: number; pending: string | null; history: number } {
  const stored = JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
  return { turn: stored.turn, pending: stored.pending?.kind ?? null, history: stored.movementHistory.length };
}

interface ObservedWrite {
  turn: number;
  pending: string | null;
  /** Taken inside the storage call, before the write returns or throws: not yet acknowledged. */
  screen: ScreenReading;
}

/**
 * Accepted-save observation fixture. Records the screen inside every game write
 * (a pending `committing` write has `pending: "roll"`; the write that carries
 * the resolved turn has `pending: null`). The write only counts as acknowledged
 * once the call returns, so a reading taken after the click sits on the other
 * side of that boundary. `failOnResolved` makes the resolved-turn write throw,
 * which is the save-failure case.
 */
function observeWrites(failOnResolved: boolean): ObservedWrite[] {
  const writes: ObservedWrite[] = [];
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    // Only game saves are observed; any other storage key passes through untouched.
    if (key !== edition.saveKey) {
      write.call(this, key, value);
      return;
    }
    const saved = JSON.parse(value) as ItemGameState;
    writes.push({ turn: saved.turn, pending: saved.pending?.kind ?? null, screen: readScreen() });
    if (failOnResolved && saved.pending === null && saved.turn > 0) throw new Error("quota");
    write.call(this, key, value);
  });
  return writes;
}

function diceButton(): HTMLElement {
  return mounted!.container.querySelector<HTMLElement>(".game-panel__roll")!;
}

function reactOnClick(element: Element): () => void {
  const key = Object.keys(element).find((name) => name.startsWith("__reactProps"))!;
  return (element as unknown as Record<string, { onClick: () => void }>)[key]!.onClick;
}

/** Natural movement time at `stepMs`, from the same P1 planner and cap the app uses. */
function movementMs(game: ItemGameState, stepMs: number): number {
  const geometry = buildGeometryIndex(data.geometry.ok ? data.geometry.value : undefined);
  const plan = buildMovePlan(playTurn(game, network).events, network, geometry);
  return Math.min(plan.reduce((sum, step) => sum + hopDurationMs(step, stepMs), 0), MAX_MOVE_DURATION_MS);
}

/** S11 switch: before the pre-move gate, an accepted roll shows the origin and locks the dice with the old label. */
const LOCKED_BEFORE_ACCEPTANCE = { station: "新橋", progress: "0/30", dice: "サイコロを振る", diceDisabled: "true", frames: 0 };
/** S11: after the save attempt the dice tumbles; the move is staged (dice label 移動中…) but gated: no frame yet. */
const TUMBLING_AFTER_SAVE_ATTEMPT = { station: "新橋", progress: "0/30", dice: "移動中…", diceDisabled: "true", frames: 0 };
/** S11: the tumble released the move: exactly one movement frame, still from the origin. */
const MOVING_AFTER_SAVE_ATTEMPT = { station: "新橋", progress: "0/30", dice: "移動中…", diceDisabled: "true", frames: 1 };

/** The saved raw roll of the plain turn 1, from the engine (the cube's final face). */
function plainRawRoll(): number {
  const record = playItemTurn(createItemGame(edition.config, PLAIN_SEED, network), {}, network).record;
  if (record?.kind !== "item-ride") throw new Error("Expected a plain ride record");
  return record.rawRoll;
}

describe("S10b accepted-save boundary", () => {
  it.each(["saved", "failed"] as const)("observes the %s turn-1 write before any movement frame, then starts one movement", (outcome) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const origin = createItemGame(edition.config, PLAIN_SEED, network);
    expectNoStampsNext(origin);
    openApp(origin);
    const writes = observeWrites(outcome === "failed");

    click("サイコロを振る");

    expect(writes).toEqual([
      { turn: 0, pending: "roll", screen: LOCKED_BEFORE_ACCEPTANCE },
      { turn: 1, pending: null, screen: LOCKED_BEFORE_ACCEPTANCE },
    ]);
    // Save attempted (saved or failed alike): the tumble lands on the saved raw roll while the move stays gated.
    expect(readScreen()).toEqual(TUMBLING_AFTER_SAVE_ATTEMPT);
    expect(mounted!.container.querySelector(".dice-tumble")?.getAttribute("data-raw-roll")).toBe(String(plainRawRoll()));
    // A failed save does not advance the sequence: up to the last millisecond of the tumble there is no extra
    // write and no frame, and the die keeps the same face.
    advanceTumble(NORMAL_TUMBLE_MS - 1);
    expect(writes).toHaveLength(2);
    expect(readScreen()).toEqual(TUMBLING_AFTER_SAVE_ATTEMPT);
    // Released by the end of the tumble: the movement starts exactly once, from the origin.
    advanceTumble(1);
    expect(readScreen()).toEqual(MOVING_AFTER_SAVE_ATTEMPT);
    expect(mounted!.container.querySelector(".dice-tumble, .turn-moment-host")).toBeNull();
    if (outcome === "saved") {
      expect(storedSave()).toEqual({ turn: 1, pending: null, history: 1 });
      expect(saveStatusText()).toBe("セーブ: 自動保存済み");
    } else {
      // The failed write left the pending roll behind; the failure stays visible.
      expect(storedSave()).toEqual({ turn: 0, pending: "roll", history: 0 });
      expect(saveStatusText()).toContain("保存に失敗しました（この進行は未保存です）");
      expect(mounted!.container.querySelector(".toast-host")?.textContent).toContain("保存に失敗しました");
    }

    click("スキップ");

    expect(writes).toHaveLength(2);
    expect(readScreen()).toEqual({ station: "浜松町", progress: "1/30", dice: "サイコロを振る", diceDisabled: "false", frames: 1 });
    if (outcome === "failed") {
      expect(saveStatusText()).toContain("保存に失敗しました（この進行は未保存です）");
      expect(mounted!.container.querySelector(".toast-host")?.textContent).toContain("保存に失敗しました");
    }
  });

  it("resumes a pending adjustment at its dialog with no movement and no moment layer", () => {
    const pending = beginItemTurn(itemScenario("adjust", network), { items: [] }, network).state;
    if (pending.pending?.kind !== "roll") throw new Error("Expected an engine-built pending adjustment");
    openApp(pending);
    const writes = observeWrites(false);

    expect(mounted!.container.querySelector(".item-adjustment")).not.toBeNull();
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "true", frames: 0 });
    expect(mounted!.container.querySelector(".dice-tumble, .turn-moment-host")).toBeNull();
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
    expect(storedSave()).toMatchObject({ turn: pending.turn, pending: "roll" });

    click("そのまま続ける");

    // S11: the restored roll keeps omitting the tumble; only the dialog decision is new here.
    expect(mounted!.container.querySelector(".dice-tumble, .turn-moment-host")).toBeNull();
    expect(writes.map(({ turn, pending: kind }) => ({ turn, kind }))).toEqual([{ turn: pending.turn + 1, kind: null }]);
    expect(storedSave()).toMatchObject({ turn: pending.turn + 1, pending: null });
    expect(readScreen().frames).toBe(1);
    expect(readScreen().dice).toBe("移動中…");
  });
});

describe("S10b same-task duplicate clicks", () => {
  it.each(["native-click", "stale-handler"] as const)("accepts exactly one turn for three %s calls in one task", (kind) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    openApp(createItemGame(edition.config, PLAIN_SEED, network));
    const writes = observeWrites(false);
    const dice = diceButton();
    const stale = reactOnClick(dice);

    act(() => {
      for (let call = 0; call < 3; call += 1) {
        if (kind === "native-click") dice.click();
        else stale();
      }
    });

    expect(writes.filter((entry) => entry.pending === null)).toHaveLength(1);
    expect(storedSave()).toEqual({ turn: 1, pending: null, history: 1 });
    // S11 re-point: one tumble, gated; its release starts exactly one movement.
    expect(readScreen()).toEqual(TUMBLING_AFTER_SAVE_ATTEMPT);
    expect(mounted!.container.querySelectorAll(".dice-tumble")).toHaveLength(1);
    advanceTumble(NORMAL_TUMBLE_MS);
    expect(readScreen()).toEqual(MOVING_AFTER_SAVE_ATTEMPT);
    expect(storedSave()).toEqual({ turn: 1, pending: null, history: 1 });
  });
});

describe("S10b speed capture", () => {
  /** Plain two-turn fixture with a frame queue; the tumble timer is faked, animation frames run by hand. */
  function speedFixture() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = createItemGame(edition.config, PLAIN_SEED, network);
    const second = playTurn(first, network).state;
    expectNoStampsNext(first);
    expectNoStampsNext(second);
    openApp(first);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => frames.push(callback)));
    const runFrame = (now: number): void => {
      const callback = frames.pop();
      if (!callback) throw new Error("No pending animation frame");
      act(() => callback(now));
    };
    const normalFirst = movementMs(first, NORMAL_STEP_MS);
    const fastFirst = movementMs(first, FAST_STEP_MS);
    const fastSecond = movementMs(second, FAST_STEP_MS);
    // Uncapped, so the 450 ms and 300 ms plans differ.
    expect(normalFirst).toBeLessThan(MAX_MOVE_DURATION_MS);
    expect(normalFirst).toBeGreaterThan(fastFirst + 1);
    return { frames, runFrame, normalFirst, fastFirst, fastSecond };
  }

  it("keeps the speed read at the start of a move and applies a 速度 change from the next turn", () => {
    const { runFrame, normalFirst, fastFirst, fastSecond } = speedFixture();

    click("サイコロを振る");
    // S11: the move starts when the tumble releases it.
    advanceTumble(NORMAL_TUMBLE_MS);
    runFrame(1_000);
    click("速度");
    expect(mounted!.container.textContent).toContain("速度: はやい");
    // Past the whole move at 300 ms per hop, still moving: 450 ms was captured at the start.
    runFrame(1_000 + fastFirst + 1);
    expect(readScreen().dice).toBe("移動中…");
    runFrame(1_000 + normalFirst + 1);
    // S12 arrival checkpoint: the move is over, the dice waits for the arrival captured at normal speed (800 ms).
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "true" });
    advanceTumble(FAST_ARRIVAL_MS);
    expect(readScreen().diceDisabled).toBe("true");
    advanceTumble(NORMAL_ARRIVAL_MS - FAST_ARRIVAL_MS);
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "false" });

    click("サイコロを振る");
    // The next roll captured はやい: its tumble is shorter too.
    advanceTumble(FAST_TUMBLE_MS);
    runFrame(5_000);
    runFrame(5_000 + fastSecond - 1);
    expect(readScreen().dice).toBe("移動中…");
    runFrame(5_000 + fastSecond + 1);
    // S12 arrival checkpoint: this roll captured はやい, so its arrival lasts 533 ms.
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "true" });
    advanceTumble(FAST_ARRIVAL_MS - 1);
    expect(readScreen().diceDisabled).toBe("true");
    advanceTumble(1);
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "false" });
    expect(storedSave()).toMatchObject({ turn: 2, pending: null, history: 2 });
  });

  it("keeps the roll's captured speed when 速度 changes during the tumble", () => {
    const { frames, runFrame, normalFirst, fastFirst } = speedFixture();

    click("サイコロを振る");
    click("速度");
    expect(mounted!.container.textContent).toContain("速度: はやい");
    // The はやい tumble would be over by now; the captured normal tumble still holds the move.
    advanceTumble(FAST_TUMBLE_MS);
    expect(frames).toHaveLength(0);
    expect(readScreen()).toEqual(TUMBLING_AFTER_SAVE_ATTEMPT);
    advanceTumble(NORMAL_TUMBLE_MS - FAST_TUMBLE_MS);
    expect(frames).toHaveLength(1);
    runFrame(1_000);
    // Past the whole move at 300 ms per hop, still moving: the movement uses the 450 ms captured with the roll.
    runFrame(1_000 + fastFirst + 1);
    expect(readScreen().dice).toBe("移動中…");
    runFrame(1_000 + normalFirst + 1);
    // S12 arrival checkpoint: the arrival also keeps the normal speed captured with the roll (800 ms, not 533 ms).
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "true" });
    advanceTumble(FAST_ARRIVAL_MS);
    expect(readScreen().diceDisabled).toBe("true");
    advanceTumble(NORMAL_ARRIVAL_MS - FAST_ARRIVAL_MS);
    expect(readScreen()).toMatchObject({ dice: "サイコロを振る", diceDisabled: "false" });
  });
});
