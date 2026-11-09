// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { serializeGame } from "../../src/features/game/engine";
import { AUTO_ROLL_GAP_MS } from "../../src/features/game/autoRoll";
import { networkFromData } from "../../src/features/game/networkFromData";
import type { ItemGameState } from "../../src/types/network";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

beforeEach(() => localStorage.clear());

const { railwayMapProps } = vi.hoisted(() => ({ railwayMapProps: vi.fn() }));
vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: (props: {
  follow?: { onUserCameraMove: () => void };
}) => {
  railwayMapProps(props);
  return createElement("div");
} }));

const data = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const loadedNetwork = networkFromData(data);
if (!loadedNetwork.ok) throw new Error(loadedNetwork.reason);
const network = loadedNetwork.network;
const edition = EDITIONS[0]!;
let mounted: MountedReact | undefined;

type HarnessProps = ComponentProps<typeof GameApp>;

function Harness(props: HarnessProps): React.JSX.Element {
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

function openApp(game: ItemGameState = itemScenario("route", network)): void {
  localStorage.setItem(edition.saveKey, serializeGame(game));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mounted = mountReact(createElement(Harness, {
    data,
    network,
    edition,
    picker: {
      editions: EDITIONS,
      editionId: edition.id,
      onEditionChange: vi.fn(),
      focusPicker: false,
      onPickerFocusRestored: vi.fn(),
    },
  }));
  click("つづきから");
  expect(autoRollButton()).not.toBeNull();
}

function click(label: string): void {
  const button = [...mounted!.container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
}

function autoRollButton(): HTMLButtonElement | null {
  return mounted!.container.querySelector<HTMLButtonElement>('button[aria-label="おまかせで進む"]');
}

function storedGame(): ItemGameState {
  const value = localStorage.getItem(edition.saveKey);
  if (!value) throw new Error("Expected a stored game");
  return JSON.parse(value) as ItemGameState;
}

function advance(milliseconds: number): void {
  act(() => vi.advanceTimersByTime(milliseconds));
}

describe("GameApp auto-roll wiring", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));

  it("passes readiness through the memoised panel and does not restart on an unrelated app render", () => {
    openApp();
    const toggle = autoRollButton();
    if (!toggle) throw new Error("Expected the auto-roll toggle");
    dispatchReactEvent(toggle, new MouseEvent("click", { bubbles: true }));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    advance(700);

    const pan = railwayMapProps.mock.calls.at(-1)?.[0].follow?.onUserCameraMove;
    if (!pan) throw new Error("Expected the map follow callback");
    act(() => pan());

    advance(AUTO_ROLL_GAP_MS - 701);
    expect(storedGame().turn).toBe(2);
    advance(1);
    expect(storedGame().turn).toBe(3);
  });

  it("renders one shared status for auto-roll and retains a manual stop across unrelated renders", () => {
    openApp();
    const status = mounted!.container.querySelector<HTMLElement>('.game-panel [role="status"]');
    if (!status) throw new Error("Expected the panel status region");
    expect(mounted!.container.querySelectorAll('.game-panel [role="status"]')).toHaveLength(1);
    const toggle = autoRollButton();
    if (!toggle) throw new Error("Expected the auto-roll toggle");
    dispatchReactEvent(toggle, new MouseEvent("click", { bubbles: true }));
    expect(status.textContent).toBe("おまかせで進みます。");

    dispatchReactEvent(toggle, new MouseEvent("click", { bubbles: true }));
    expect(status.textContent).toBe("おまかせを止めました。");
    const pan = railwayMapProps.mock.calls.at(-1)?.[0].follow?.onUserCameraMove;
    if (!pan) throw new Error("Expected the map follow callback");
    act(() => pan());
    expect(status.textContent).toBe("おまかせを止めました。");
    expect(mounted!.container.querySelectorAll('.game-panel [role="status"]')).toHaveLength(1);

    click("サイコロを振る");
    expect(status.textContent).not.toContain("おまかせを止めました");
  });

  it.each(["click", "Space", "Enter"] as const)("routes %s through the shared guard when it races the timer", (input) => {
    openApp();
    const toggle = autoRollButton();
    if (!toggle) throw new Error("Expected the auto-roll toggle");
    dispatchReactEvent(toggle, new MouseEvent("click", { bubbles: true }));
    advance(AUTO_ROLL_GAP_MS - 1);

    if (input === "click") {
      click("サイコロを振る");
    } else {
      const key = input === "Space" ? " " : "Enter";
      act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    expect(storedGame().turn).toBe(3);
    advance(AUTO_ROLL_GAP_MS * 2);
    expect(storedGame().turn).toBe(3);
  });

  it("pauses the pending timer for a confirmation dialog and starts a full gap after cancel", () => {
    openApp();
    const toggle = autoRollButton();
    if (!toggle) throw new Error("Expected the auto-roll toggle");
    dispatchReactEvent(toggle, new MouseEvent("click", { bubbles: true }));
    advance(AUTO_ROLL_GAP_MS - 10);

    click("メニュー");
    click("新規");
    const dialog = mounted!.container.querySelector<HTMLDialogElement>('dialog[open]');
    expect(dialog).not.toBeNull();
    advance(AUTO_ROLL_GAP_MS * 2);
    expect(storedGame().turn).toBe(2);

    // The menu closes as the confirmation opens; after cancel, the ready state owns a fresh full gap.
    click("キャンセル");
    advance(AUTO_ROLL_GAP_MS - 1);
    expect(storedGame().turn).toBe(2);
    advance(1);
    expect(storedGame().turn).toBe(3);
  });
});
