// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { StrictMode, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS, saveKeyForEdition } from "../../src/features/editions/registry";
import type { EditionRegistry } from "../../src/features/editions/types";
import * as turnMomentsModule from "../../src/features/game/animation/useTurnMoments";
import { createItemGame, serializeGame } from "../../src/features/game/engine";
import { FIRST_PLAY_HINT_IDS } from "../../src/features/game/firstPlayGuide";
import { networkFromData } from "../../src/features/game/networkFromData";
import * as turnMomentPresentation from "../../src/features/game/turnMomentPresentation";
import { GUIDE_COACH_KEY, GUIDE_STARTED_KEY, guideHintStorageKey } from "../../src/features/game/store/guide";
import { FIRST_TURN_NOTICE_KEY } from "../../src/features/game/store/notices";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { seedFirstPlayGuide } from "./helpers/notices";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

const { guideSnapshots } = vi.hoisted(() => ({
  guideSnapshots: [] as Array<{ sessionId: number | null }>,
}));

vi.mock("../../src/features/game/useFirstPlayGuide", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/game/useFirstPlayGuide")>();
  return {
    ...actual,
    useFirstPlayGuide: (options: Parameters<typeof actual.useFirstPlayGuide>[0]) => {
      guideSnapshots.push({ sessionId: options.sessionId });
      return actual.useFirstPlayGuide(options);
    },
  };
});

vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: () => createElement("div") }));

const data = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const result = networkFromData(data);
if (!result.ok) throw new Error(result.reason);
const network = result.network;
const edition = EDITIONS[0];
let mounted: MountedReact | null = null;
const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

function appNode(editions: EditionRegistry = EDITIONS): React.JSX.Element {
  return createElement(GameApp, {
    data,
    network,
    edition,
    picker: {
      editions,
      editionId: edition.id,
      onEditionChange: vi.fn(),
      focusPicker: false,
      onPickerFocusRestored: vi.fn(),
    },
  });
}

function mountApp(strict = false, editions: EditionRegistry = EDITIONS): void {
  const child = appNode(editions);
  mounted = mountReact(strict ? createElement(StrictMode, null, child) : child);
}

function button(label: string): HTMLButtonElement {
  const found = [...mounted!.container.querySelectorAll("button")]
    .find((candidate) => `${candidate.getAttribute("aria-label") ?? ""} ${candidate.textContent ?? ""}`.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function click(label: string): void {
  dispatchReactEvent(button(label), new MouseEvent("click", { bubbles: true }));
}

function lastGuideSnapshot(): { sessionId: number | null } {
  const snapshot = guideSnapshots.at(-1);
  if (!snapshot) throw new Error("Expected useFirstPlayGuide to run");
  return snapshot;
}

function createMemoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

beforeEach(() => {
  localStorage.clear();
  guideSnapshots.length = 0;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement): void { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement): void { this.removeAttribute("open"); },
  });
});

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  vi.restoreAllMocks();
  if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "close", closeDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  localStorage.clear();
});

describe("GameApp first-play eligibility", () => {
  it("blocks dice and Space/Enter before showModal opens on the first eligible render", () => {
    let coachWasClosedDuringAttempts = false;
    let turnDuringAttempts: string | null = null;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement): void {
        if (this.classList.contains("first-play-coach")) {
          coachWasClosedDuringAttempts = !this.open;
          const dice = mounted!.container.querySelector<HTMLButtonElement>(".game-panel__roll");
          if (!dice) throw new Error("Expected the dice button before the coach opens");
          dispatchReactEvent(dice, new MouseEvent("click", { bubbles: true }));
          for (const key of [" ", "Enter"]) {
            dispatchReactEvent(mounted!.container, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
          }
          turnDuringAttempts = mounted!.container.querySelector('[data-stat="turn"]')?.textContent ?? null;
        }
        this.setAttribute("open", "");
      },
    });
    mountApp();

    click("はじめから");

    expect(coachWasClosedDuringAttempts).toBe(true);
    expect(turnDuringAttempts).toBe("0");
    expect(mounted!.container.querySelector('[data-stat="turn"]')?.textContent).toBe("0");
    expect(mounted!.container.querySelector(".first-play-coach[open]")).not.toBeNull();
  });

  it("routes an enabled skip button through the guarded handler while the coach is open", () => {
    const skipTurnMoment = vi.fn();
    const actualUseTurnMoments = turnMomentsModule.useTurnMoments;
    vi.spyOn(turnMomentsModule, "useTurnMoments").mockImplementation((options) => ({
      ...actualUseTurnMoments(options),
      skip: skipTurnMoment,
    }));
    const actualDeriveTurnMomentDisplay = turnMomentPresentation.deriveTurnMomentDisplay;
    vi.spyOn(turnMomentPresentation, "deriveTurnMomentDisplay").mockImplementation((input) => {
      const display = actualDeriveTurnMomentDisplay(input);
      return display ? { ...display, canSkip: true } : display;
    });
    mountApp();

    click("はじめから");

    const skip = mounted!.container.querySelector<HTMLButtonElement>(".game-panel__skip");
    expect(skip?.disabled).toBe(false);
    dispatchReactEvent(skip!, new MouseEvent("click", { bubbles: true }));

    expect(skipTurnMoment).not.toHaveBeenCalled();
    expect(mounted!.container.querySelector('[data-stat="turn"]')?.textContent).toBe("0");
    expect(mounted!.container.querySelector(".first-play-coach[open]")).not.toBeNull();
  });

  it("fixes eligibility before the turn-zero save and binds it to that new session", () => {
    const writeOrder: string[] = [];
    let startedReads = 0;
    let coachWasWrittenAfterDialogOpened = false;
    const setItem = Storage.prototype.setItem;
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (key === GUIDE_STARTED_KEY) startedReads += 1;
      return getItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      writeOrder.push(key);
      if (key === GUIDE_COACH_KEY) {
        coachWasWrittenAfterDialogOpened = Boolean(document.querySelector("dialog.first-play-coach[open]"));
      }
      setItem.call(this, key, value);
    });
    mountApp(true);

    click("はじめから");

    expect(startedReads).toBe(1);
    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBe("1");
    expect(writeOrder.indexOf(GUIDE_STARTED_KEY)).toBeGreaterThanOrEqual(0);
    expect(writeOrder.indexOf(GUIDE_STARTED_KEY)).toBeLessThan(writeOrder.indexOf(edition.saveKey));
    expect(lastGuideSnapshot()).toEqual({ sessionId: 1 });
    expect(localStorage.getItem(edition.saveKey)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(edition.saveKey)!).turn).toBe(0);
    expect(mounted!.container.querySelector(".first-play-coach[open]")).not.toBeNull();
    expect(localStorage.getItem(GUIDE_COACH_KEY)).toBe("1");
    expect(coachWasWrittenAfterDialogOpened).toBe(true);

    localStorage.setItem(FIRST_TURN_NOTICE_KEY, "1");
    click("とばす");
    click("メニュー");
    expect(lastGuideSnapshot()).toEqual({ sessionId: 1 });
    expect(startedReads).toBe(2);
    expect(writeOrder.filter((key) => key === GUIDE_STARTED_KEY)).toHaveLength(1);
  });

  it("remembers an existing save observation after the player deletes it", () => {
    localStorage.setItem(edition.saveKey, serializeGame(createItemGame(edition.config, "existing-save", network)));
    mountApp();

    click("セーブを削除");
    click("削除する");
    expect(localStorage.getItem(edition.saveKey)).toBeNull();
    click("はじめから");

    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBeNull();
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
  });

  it("remembers a successful turn-zero save after the save is deleted in the same mount", () => {
    const getItem = Storage.prototype.getItem;
    let startedReadCount = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (key === GUIDE_STARTED_KEY) {
        startedReadCount += 1;
        if (startedReadCount === 1) throw new Error("temporarily blocked");
      }
      return getItem.call(this, key);
    });
    mountApp();

    click("はじめから");

    expect(startedReadCount).toBe(1);
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
    expect(JSON.parse(localStorage.getItem(edition.saveKey)!).turn).toBe(0);

    localStorage.removeItem(edition.saveKey);
    click("メニュー");
    click("タイトル");
    expect(localStorage.getItem(edition.saveKey)).toBeNull();
    click("はじめから");

    expect(startedReadCount).toBe(2);
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
  });

  it("checks saves for every known edition before allowing the guide", () => {
    const otherEdition = { ...edition, id: "other-edition", saveKey: saveKeyForEdition("other-edition") };
    const editions = [edition, otherEdition] as const satisfies EditionRegistry;
    localStorage.setItem(otherEdition.saveKey, serializeGame(createItemGame(edition.config, "other-save", network)));
    mountApp(false, editions);

    click("はじめから");

    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBeNull();
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
  });

  it("never marks a resumed turn-zero session as first play", () => {
    localStorage.setItem(edition.saveKey, serializeGame(createItemGame(edition.config, "resume-turn-zero", network)));
    mountApp();

    click("つづきから");

    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBeNull();
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
  });

  it("treats an invalid save payload as an existing save", () => {
    localStorage.setItem(edition.saveKey, "not a valid game save");
    mountApp();

    click("はじめから");

    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBeNull();
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
  });

  it("keeps the in-memory started decision after every storage write fails", () => {
    const attemptedWrites: string[] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key) {
      attemptedWrites.push(key);
      throw new Error("quota");
    });
    mountApp();

    click("はじめから");
    expect(lastGuideSnapshot()).toEqual({ sessionId: 1 });
    click("メニュー");
    click("タイトル");
    click("はじめから");

    expect(attemptedWrites.filter((key) => key === GUIDE_STARTED_KEY)).toHaveLength(1);
    expect(lastGuideSnapshot()).toEqual({ sessionId: null });
  });

  it("suppresses eligibility when the #68 flag is set", () => {
    seedFlag(FIRST_TURN_NOTICE_KEY);
    mountApp();
    click("はじめから");
    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBeNull();
    expect(lastGuideSnapshot().sessionId).toBeNull();
  });

  it("suppresses eligibility when only the save key is unreadable", () => {
    const getItem = Storage.prototype.getItem;
    const readKeys: string[] = [];
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      readKeys.push(key);
      if (key === edition.saveKey) throw new Error("save key blocked");
      return getItem.call(this, key);
    });
    mountApp();

    click("はじめから");

    expect(readKeys).toContain(FIRST_TURN_NOTICE_KEY);
    expect(readKeys).toContain(GUIDE_STARTED_KEY);
    expect(localStorage.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
    expect(localStorage.getItem(GUIDE_STARTED_KEY)).toBeNull();
    expect(lastGuideSnapshot().sessionId).toBeNull();
  });
});

describe("first-play unit seed helper", () => {
  it("seeds guide state independently from the #68 notice key", () => {
    const store = createMemoryStorage();

    seedFirstPlayGuide(store);

    expect(store.getItem(GUIDE_STARTED_KEY)).toBe("1");
    expect(store.getItem(GUIDE_COACH_KEY)).toBe("1");
    for (const hintId of FIRST_PLAY_HINT_IDS) {
      expect(store.getItem(guideHintStorageKey(hintId))).toBe("1");
    }
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
  });
});

function seedFlag(key: string): void {
  localStorage.setItem(key, "1");
}
