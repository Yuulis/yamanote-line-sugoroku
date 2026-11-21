// @vitest-environment jsdom
import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { serializeGame } from "../../src/features/game/engine";
import { networkFromData } from "../../src/features/game/networkFromData";
import type { ItemGameState } from "../../src/types/network";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: () => createElement("div") }));

const data = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const loadedNetwork = networkFromData(data);
if (!loadedNetwork.ok) throw new Error(loadedNetwork.reason);
const network = loadedNetwork.network;
const edition = EDITIONS[0]!;
let mounted: MountedReact | undefined;

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

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

function openApp(game: ItemGameState): void {
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
}

function button(label: string): HTMLButtonElement {
  const found = [...mounted!.container.querySelectorAll("button")]
    .find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent)?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function click(label: string): void {
  dispatchReactEvent(button(label), new MouseEvent("click", { bubbles: true }));
}

function rulesDialog(): HTMLDialogElement | null {
  return mounted!.container.querySelector<HTMLDialogElement>("dialog.rules-dialog[open]");
}

function openRulesFromMenu(): HTMLButtonElement {
  click("メニュー");
  const opener = button("遊び方");
  dispatchReactEvent(opener, new MouseEvent("click", { bubbles: true }));
  return opener;
}

/** Closes the rules and waits for the microtask that restores focus. */
async function closeRules(): Promise<void> {
  const close = mounted!.container.querySelector(".rules-dialog .rules-dialog__close");
  if (!close) throw new Error("Missing rules close button");
  dispatchReactEvent(close, new MouseEvent("click", { bubbles: true }));
  await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
}

function dice(): HTMLButtonElement {
  return mounted!.container.querySelector<HTMLButtonElement>(".game-panel__roll")!;
}

describe("in-game rules entry points", () => {
  it("menu rules action sits outside the five options", async () => {
    openApp(itemScenario("route", network));
    const opener = openRulesFromMenu();

    const menu = mounted!.container.querySelector("section.game-panel__menu")!;
    expect(menu.querySelectorAll(".game-panel__options button")).toHaveLength(5);
    expect(opener.closest(".game-panel__options")).toBeNull();
    expect(opener.previousElementSibling?.classList.contains("game-panel__options")).toBe(true);
    expect(rulesDialog()).not.toBeNull();
    expect(document.activeElement).toBe(rulesDialog()!.querySelector("h1"));

    await closeRules();
    expect(rulesDialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("persistent lottery details targets lottery", async () => {
    openApp(itemScenario("route", network));
    click("ログ");
    const lottery = mounted!.container.querySelector(".game-panel__lottery")!;
    const opener = button("抽選のルールを詳しく見る");
    expect(opener.textContent).toBe("詳しく");
    expect(lottery.textContent).not.toContain("詳しく");
    dispatchReactEvent(opener, new MouseEvent("click", { bubbles: true }));

    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.activeElement?.closest("section")?.id).toMatch(/-lottery$/);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    await closeRules();
    expect(document.activeElement).toBe(opener);
  });

  it("movement completing under rules keeps focus in the guide", async () => {
    openApp(itemScenario("route", network));
    click("サイコロを振る");
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    const opener = openRulesFromMenu();
    const title = rulesDialog()!.querySelector("h1");
    expect(document.activeElement).toBe(title);

    // Ends the tumble and the movement together, as the running presentation would on its own.
    click("演出をスキップ");
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    expect(document.activeElement).toBe(title);
    await closeRules();
    expect(document.activeElement).toBe(opener);
  });

  it("a decision ready under rules appears after closure", async () => {
    openApp(itemScenario("adjust", network));
    click("サイコロを振る");
    openRulesFromMenu();
    const title = rulesDialog()!.querySelector("h1");
    // The tumble ends under the rules: the adjustment is presented but its modal waits.
    click("演出をスキップ");
    expect(mounted!.container.querySelector(".item-adjustment")).toBeNull();
    expect(document.activeElement).toBe(title);

    await closeRules();
    const adjustment = mounted!.container.querySelector<HTMLDialogElement>("dialog.item-adjustment");
    expect(adjustment?.open).toBe(true);
    expect(adjustment?.contains(document.activeElement)).toBe(true);
  });

  describe("item card details", () => {
    const popoverNames = ["showPopover", "hidePopover"] as const;
    let popoverDescriptors: (PropertyDescriptor | undefined)[] = [];

    beforeEach(() => {
      popoverDescriptors = popoverNames.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
      for (const name of popoverNames) Reflect.deleteProperty(HTMLElement.prototype, name);
    });

    afterEach(() => {
      popoverNames.forEach((name, index) => {
        const descriptor = popoverDescriptors[index];
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else Reflect.deleteProperty(HTMLElement.prototype, name);
      });
    });

    function toggleEvent(type: string): Event {
      const event = new Event(type);
      Object.defineProperty(event, "newState", { value: "closed" });
      return event;
    }

    /** Native Popover API stand-in: showModal() hides open auto popovers synchronously, `toggle` follows as a task. */
    function stubNativePopover(): void {
      const shown = new Set<HTMLElement>();
      const hide = (element: HTMLElement): void => {
        if (!shown.delete(element)) return;
        element.dispatchEvent(toggleEvent("beforetoggle"));
        setTimeout(() => element.dispatchEvent(toggleEvent("toggle")), 0);
      };
      Object.defineProperty(HTMLElement.prototype, "showPopover", {
        configurable: true, value(this: HTMLElement) { shown.add(this); },
      });
      Object.defineProperty(HTMLElement.prototype, "hidePopover", {
        configurable: true, value(this: HTMLElement) { hide(this); },
      });
      vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
        [...shown].forEach(hide);
        this.setAttribute("open", "");
      });
    }

    function openItemDetails(): { trigger: HTMLButtonElement; card: HTMLElement } {
      openApp(itemScenario("double", network));
      const trigger = button("倍速券の詳細");
      click("倍速券の詳細");
      const card = mounted!.container.querySelector<HTMLElement>(".item-card-popover")!;
      const details = button("アイテムのルールを詳しく見る");
      expect(details.textContent).toBe("詳しく");
      expect(details.parentElement?.classList.contains("item-card__footer")).toBe(true);
      dispatchReactEvent(details, new MouseEvent("click", { bubbles: true }));
      return { trigger, card };
    }

    function expectItemsSectionFocused(): void {
      expect(rulesDialog()?.contains(document.activeElement)).toBe(true);
      expect(document.activeElement?.tagName).toBe("H2");
      expect(document.activeElement?.closest("section")?.id).toMatch(/-items$/);
    }

    it("item details captures the inventory trigger before card closure", async () => {
      let focusedAtShowModal: Element | null = null;
      vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
        focusedAtShowModal = document.activeElement;
        this.setAttribute("open", "");
      });
      const { trigger, card } = openItemDetails();
      // Focus already sits on the durable slot trigger when the modal opens, not inside the closing card.
      expect(focusedAtShowModal).toBe(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(card.hidden).toBe(true);
      expectItemsSectionFocused();

      await closeRules();
      expect(rulesDialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it.each(["native", "fallback"] as const)("card cleanup does not steal dialog focus (%s popover)", async (mode) => {
      if (mode === "native") stubNativePopover();
      const { trigger } = openItemDetails();
      expectItemsSectionFocused();
      // Flushes the deferred toggle event and the card's reclick-guard timer.
      await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expectItemsSectionFocused();
    });

    it("missing opener falls back to the panel", async () => {
      const { trigger } = openItemDetails();
      trigger.closest("li")!.remove();
      await closeRules();
      expect(document.activeElement).toBe(button("メニュー"));
    });
  });
});
