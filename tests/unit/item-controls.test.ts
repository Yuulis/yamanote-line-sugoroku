// @vitest-environment jsdom
import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DiscardChoice } from "../../src/features/game/components/DiscardChoice";
import { InventoryPanel } from "../../src/features/game/components/InventoryPanel";
import { ITEM_DESCRIPTIONS, ITEM_SHORT_NAMES, itemTiming } from "../../src/features/game/itemPresentation";
import { ItemUseDialog } from "../../src/features/game/components/ItemUseDialog";
import { RollAdjustment } from "../../src/features/game/components/RollAdjustment";
import { buildRailwayNetwork, createItemGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemSessionView } from "../../src/features/game/itemSession";
import type { ItemKind } from "../../src/types/network";
import { createItemSession, itemSessionView } from "../../src/features/game/itemSession";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { M_LINE, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

const mounted: MountedReact[] = [];
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
afterEach(() => mounted.splice(0).forEach((mount) => mount.cleanup()));

function itemView(overrides: Partial<ItemSessionView> = {}): ItemSessionView {
  return {
    phase: "idle",
    identity: { sessionId: 1, turn: 0, decisionRevision: 0 },
    inventory: [
      { id: "route-1", kind: "route-ticket" },
      { id: "adjust-1", kind: "roll-adjust" },
      { id: "certificate-1", kind: "delay-certificate" },
    ],
    position: { currentStationId: "station-a", currentServiceId: "line-a", direction: 1 },
    draft: { items: [{ kind: "route-ticket", instanceId: "route-1", serviceId: "line-b" }] },
    usableItems: [
      { instanceId: "route-1", kind: "route-ticket", usable: true, reason: null, selected: true, recommended: true },
      { instanceId: "adjust-1", kind: "roll-adjust", usable: false, reason: "forced-turn", selected: false, recommended: true },
      { instanceId: "certificate-1", kind: "delay-certificate", usable: false, reason: "passive", selected: false, recommended: true },
    ],
    hints: {
      routes: [],
      direction: { directions: [], closerDirection: null },
      rapidHeadsTowardYamanote: false,
      deadheadDestination: { fromStationId: "station-a", toStationId: "station-y", serviceId: "yamanote", direction: 1, distance: 2 },
      deadheadRecommended: true,
      suspensionIgnored: false,
      suspendedServiceIds: [],
    },
    decision: null,
    effects: { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false },
    events: [],
    ...overrides,
  } as ItemSessionView;
}

function routeDialogFixture(kind: "route-ticket" | "direction-ticket") {
  const network = buildRailwayNetwork(multiServiceInput());
  const config = { ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy };
  const game = createItemGame(config, "item-controls", network);
  const restored = {
    ...game,
    currentStationId: "b",
    currentServiceId: M_LINE,
    direction: 1 as const,
    inventory: [{ id: "choice-1", kind }],
  };
  const session = createItemSession(config, "item-controls", network, 1, restored);
  return {
    network,
    view: itemSessionView(session, network)!,
    presentation: createPresentationResolver(network),
  };
}

interface InventoryHarnessProps {
  view: ItemSessionView;
  onSelect: (instanceId: string, kind: ItemKind) => void;
}

/** Stable component identity: updates go through `mount.root.render(createElement(InventoryHarness, props))`. */
function InventoryHarness({ view, onSelect }: InventoryHarnessProps): React.JSX.Element {
  return createElement(InventoryPanel, { view, onSelect });
}

function mountInventory(props: InventoryHarnessProps): MountedReact {
  const mount = mountReact(createElement(InventoryHarness, props));
  mounted.push(mount);
  return mount;
}

function rerenderInventory(mount: MountedReact, props: InventoryHarnessProps): void {
  act(() => mount.root.render(createElement(InventoryHarness, props)));
}

function pointerEventOf(type: string, pointerType: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

function escapeKey(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
}

function stubBox(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = (): DOMRect => ({
    top, bottom, left: 0, right: 200, x: 0, y: top, width: 200, height: bottom - top, toJSON: () => ({}),
  });
}

describe("item controls", () => {
  it("renders icon slots with persistent descriptions and empty labels", () => {
    const mount = mountReact(createElement(InventoryPanel, { view: itemView(), onSelect: vi.fn() }));
    mounted.push(mount);
    const slots = [...mount.container.querySelectorAll<HTMLElement>("li.item-slot")];
    expect(slots).toHaveLength(3);
    expect(mount.container.querySelector("h2.visually-hidden")?.textContent).toBe("アイテム（3枠）");
    expect(mount.container.querySelector(".item-inventory__label")?.textContent).toBe("持ち物");
    for (const slot of slots.slice(0, 3)) {
      const button = slot.querySelector<HTMLButtonElement>("button")!;
      expect(slot.querySelectorAll("button")).toHaveLength(1);
      expect(slot.querySelector("h3.visually-hidden")?.textContent).toBeTruthy();
      const kind = itemView().inventory.find((item) => ITEM_DESCRIPTIONS[item.kind].name === slot.querySelector("h3")?.textContent)?.kind;
      if (kind) expect(slot.querySelector(".item-slot__short")?.textContent).toBe(ITEM_SHORT_NAMES[kind]);
      expect(button.getAttribute("aria-describedby")).toBeTruthy();
      expect(slot.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(1);
    }
    const descriptions = [...mount.container.querySelectorAll<HTMLElement>("[id^='item-description-']")];
    expect(descriptions[0]?.textContent).toContain(ITEM_DESCRIPTIONS["route-ticket"].effect);
    expect(descriptions[0]?.textContent).toContain(itemTiming("route-ticket"));
    const emptyMount = mountReact(createElement(InventoryPanel, {
      view: itemView({ inventory: [], usableItems: [], draft: { items: [] } }), onSelect: vi.fn(),
    }));
    mounted.push(emptyMount);
    expect(emptyMount.container.querySelectorAll(".item-slot--empty .item-slot__empty")).toHaveLength(3);
  });

  it("keeps hint, unavailable reason, replacement note, and passive timing in persistent descriptions", () => {
    const view = itemView({
      inventory: [
        { id: "rapid-1", kind: "rapid" },
        { id: "adjust-1", kind: "roll-adjust" },
        { id: "certificate-1", kind: "delay-certificate" },
      ],
      draft: { items: [{ kind: "double", instanceId: "other" }] },
      usableItems: [
        { instanceId: "rapid-1", kind: "rapid", usable: true, reason: null, selected: false, recommended: false },
        { instanceId: "adjust-1", kind: "roll-adjust", usable: false, reason: "forced-turn", selected: false, recommended: true },
        { instanceId: "certificate-1", kind: "delay-certificate", usable: false, reason: "passive", selected: false, recommended: true },
      ],
      hints: { ...itemView().hints, rapidHeadsTowardYamanote: false },
    });
    const mount = mountReact(createElement(InventoryPanel, { view, onSelect: vi.fn() }));
    mounted.push(mount);
    const textFor = (name: string): string => {
      const slot = [...mount.container.querySelectorAll<HTMLElement>(".item-slot")]
        .find((candidate) => candidate.querySelector("h3")?.textContent === name)!;
      const id = slot.querySelector("button")?.getAttribute("aria-describedby");
      return mount.container.querySelector(`#${id}`)?.textContent ?? "";
    };
    expect(textFor("快速券")).toContain("注意：現在の向きは山手線から遠ざかります。");
    expect(textFor("快速券")).toContain("ほかのアイテムを選択中です。使うと置き換わります。");
    expect(textFor("出目調整券")).toContain("遅延・寝過ごしのターンは使えない。");
    expect(textFor("遅延証明書")).toContain("持っているだけで効く。");
    expect(textFor("遅延証明書")).not.toContain("持っているだけで効くアイテムです");
  });

  it("shows and dismisses tooltips for hover and keyboard focus, respecting touch and modal Escape", () => {
    const mount = mountReact(createElement(InventoryPanel, { view: itemView(), onSelect: vi.fn() }));
    mounted.push(mount);
    const slot = mount.container.querySelector<HTMLElement>(".item-slot")!;
    const button = slot.querySelector<HTMLButtonElement>("button")!;
    const enter = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(enter, "pointerType", { value: "mouse" });
    act(() => dispatchReactEvent(slot, enter));
    expect(slot.querySelector("[role=tooltip]")?.textContent).toContain(ITEM_DESCRIPTIONS["route-ticket"].effect);
    const bubble = vi.fn((event: KeyboardEvent) => expect(event.defaultPrevented).toBe(true));
    window.addEventListener("keydown", bubble);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(true);
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
    const focus = new FocusEvent("focus", { bubbles: false });
    act(() => dispatchReactEvent(button, focus));
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
    window.removeEventListener("keydown", bubble);
    act(() => slot.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    act(() => button.focus());
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    act(() => button.blur());
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
  });

  it("keeps inventory tiles fixed-height and free of slot-specific motion", () => {
    const css: string = readFileSync("src/styles.css", "utf8");
    const rules: RegExpMatchArray[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const slotRules: string[] = rules
      .filter((match) => /\.item-slot|\.item-inventory/.test(match[1]!))
      .map((match) => match[2]!);
    expect(slotRules.length).toBeGreaterThan(0);
    for (const declarations of slotRules) {
      expect(declarations).not.toMatch(/\b(?:transition|animation)\s*:/);
    }
    const tileRule = rules.find((match) => match[1]!.includes(".item-slot__button") && match[1]!.includes(".item-slot--empty"));
    expect(tileRule?.[2]).toMatch(/height:\s*56px/);
    expect(tileRule?.[2]).toMatch(/box-sizing:\s*border-box/);
  });

  it("ignores touch hover, yields Escape to a modal, and closes when the hovered item disappears", () => {
    const view = itemView();
    const mount = mountInventory({ view, onSelect: vi.fn() });
    const slot = mount.container.querySelector<HTMLElement>(".item-slot")!;
    const pointerEvent = (pointerType: string): MouseEvent => {
      const event = new MouseEvent("pointerover", { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      return event;
    };
    act(() => dispatchReactEvent(slot, pointerEvent("touch")));
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
    act(() => dispatchReactEvent(slot, pointerEvent("mouse")));
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    const modal = document.createElement("dialog");
    modal.setAttribute("open", "");
    document.body.append(modal);
    const modalEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(modalEscape));
    expect(modalEscape.defaultPrevented).toBe(false);
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    modal.remove();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(slot.querySelector("[role=tooltip]")).toBeNull();

    act(() => dispatchReactEvent(slot, new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    act(() => dispatchReactEvent(slot, pointerEvent("mouse")));
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    rerenderInventory(mount, {
      view: itemView({ inventory: [], usableItems: [], draft: { items: [] } }), onSelect: vi.fn(),
    });
    expect(mount.container.querySelector("[role=tooltip]")).toBeNull();
    // The emptied slot no longer owns Escape, so the draft handler behind it still gets the key.
    const staleEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(staleEscape));
    expect(staleEscape.defaultPrevented).toBe(false);
  });

  it("tracks a hover that starts after keyboard focus and hides once the pointer leaves both boxes", () => {
    const mount = mountInventory({ view: itemView(), onSelect: vi.fn() });
    const slot = mount.container.querySelector<HTMLElement>(".item-slot")!;
    const button = slot.querySelector<HTMLButtonElement>("button")!;
    act(() => button.focus());
    const tooltip = slot.querySelector<HTMLElement>("[role=tooltip]")!;
    expect(tooltip).not.toBeNull();
    stubBox(slot, 40, 96);
    stubBox(tooltip, 100, 160);
    act(() => dispatchReactEvent(button, pointerEventOf("pointerover", "mouse", { relatedTarget: document.body })));
    act(() => dispatchReactEvent(button, pointerEventOf("pointerout", "mouse", { relatedTarget: document.body, clientX: 50, clientY: 130 })));
    act(() => button.blur());
    // Focus has gone, but the pointer is over the tooltip: it stays (hoverable).
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    act(() => { window.dispatchEvent(pointerEventOf("pointermove", "mouse", { clientX: 50, clientY: 300 })); });
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
    const escape = escapeKey();
    act(() => { window.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(false);
  });

  it("never moves a tooltip to another item when the inventory shifts, empties, or refills", () => {
    const usable = (instanceId: string, kind: ItemKind) => ({
      instanceId, kind, usable: true, reason: null, selected: false, recommended: true,
    });
    const viewOf = (items: { id: string; kind: ItemKind }[]): ItemSessionView => itemView({
      inventory: items,
      draft: { items: [] },
      usableItems: items.map((item) => usable(item.id, item.kind)) as ItemSessionView["usableItems"],
    });
    const first = { id: "item-1", kind: "double" as const };
    const second = { id: "item-2", kind: "rapid" as const };
    const refill = { id: "item-3", kind: "deadhead" as const };
    const onSelect = vi.fn();
    const mount = mountInventory({ view: viewOf([first, second]), onSelect });
    const firstSlot = mount.container.querySelector<HTMLElement>(".item-slot")!;
    act(() => dispatchReactEvent(firstSlot, pointerEventOf("pointerover", "mouse")));
    expect(firstSlot.querySelector("[role=tooltip]")?.textContent).toContain("倍速券");

    // The hovered item is used: the next item shifts into slot 1 and must not inherit the tooltip.
    rerenderInventory(mount, { view: viewOf([second]), onSelect });
    expect(mount.container.querySelector("[role=tooltip]")).toBeNull();
    const shiftedEscape = escapeKey();
    act(() => { window.dispatchEvent(shiftedEscape); });
    expect(shiftedEscape.defaultPrevented).toBe(false);

    // Focus the shifted item, then empty and refill the slot: nothing reappears without new hover or focus.
    const shiftedButton = mount.container.querySelector<HTMLButtonElement>(".item-slot button")!;
    act(() => shiftedButton.focus());
    expect(mount.container.querySelector("[role=tooltip]")?.textContent).toContain("快速券");
    rerenderInventory(mount, { view: viewOf([]), onSelect });
    expect(mount.container.querySelector("[role=tooltip]")).toBeNull();
    rerenderInventory(mount, { view: viewOf([refill]), onSelect });
    expect(mount.container.querySelector("[role=tooltip]")).toBeNull();
    const refillEscape = escapeKey();
    act(() => { window.dispatchEvent(refillEscape); });
    expect(refillEscape.defaultPrevented).toBe(false);
    // A real hover on the refilled slot still works.
    const refilledSlot = mount.container.querySelector<HTMLElement>(".item-slot")!;
    act(() => dispatchReactEvent(refilledSlot, pointerEventOf("pointerover", "mouse")));
    expect(refilledSlot.querySelector("[role=tooltip]")?.textContent).toContain("回送列車");
  });

  it("keeps a tooltip open over itself, skips pointer-press focus, dismisses on click, and removes its Escape listener", () => {
    const onSelect = vi.fn();
    const mount = mountReact(createElement(InventoryPanel, { view: itemView(), onSelect }));
    const slot = mount.container.querySelector<HTMLElement>(".item-slot")!;
    const button = slot.querySelector<HTMLButtonElement>("button")!;
    const pointer = (type: string, init: MouseEventInit = {}): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, ...init });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      return event;
    };
    act(() => dispatchReactEvent(button, pointer("pointerover")));
    const tooltip = slot.querySelector<HTMLElement>("[role=tooltip]")!;
    expect(tooltip.getAttribute("aria-hidden")).toBe("true");
    expect(tooltip.querySelectorAll("button, a, [tabindex], h1, h2, h3, h4")).toHaveLength(0);
    // The tooltip takes no pointer events, so hovering it is tracked by position (jsdom has no layout: stub the boxes).
    const box = (top: number, bottom: number) => (): DOMRect => ({
      top, bottom, left: 0, right: 200, x: 0, y: top, width: 200, height: bottom - top, toJSON: () => ({}),
    });
    slot.getBoundingClientRect = box(40, 96);
    tooltip.getBoundingClientRect = box(100, 160);
    act(() => dispatchReactEvent(button, pointer("pointerout", { relatedTarget: document.body, clientX: 50, clientY: 130 })));
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    act(() => { window.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 150 })); });
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();
    act(() => { window.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 300 })); });
    expect(slot.querySelector("[role=tooltip]")).toBeNull();

    // A pointer press focuses the button without opening the tooltip, and the click dismisses it.
    act(() => dispatchReactEvent(button, pointer("pointerdown")));
    act(() => button.focus());
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
    act(() => dispatchReactEvent(button, new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith("route-1", "route-ticket");
    act(() => dispatchReactEvent(button, pointer("pointerover", { relatedTarget: document.body })));
    expect(slot.querySelector("[role=tooltip]")).toBeNull();
    act(() => button.blur());
    act(() => dispatchReactEvent(button, pointer("pointerout", { relatedTarget: document.body })));
    act(() => dispatchReactEvent(button, pointer("pointerover", { relatedTarget: document.body })));
    expect(slot.querySelector("[role=tooltip]")).not.toBeNull();

    const removed = vi.spyOn(window, "removeEventListener");
    mount.cleanup();
    expect(removed.mock.calls.some(([type, , options]) => type === "keydown" && options === true)).toBe(true);
    removed.mockRestore();
    const afterUnmount = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it("renders three inventory slots, selected state, disabled reason, and a passive certificate", () => {
    const onSelect = vi.fn();
    const mount = mountInventory({ view: itemView(), onSelect });

    expect(mount.container.querySelectorAll(".item-slot")).toHaveLength(3);
    const selected = mount.container.querySelector<HTMLButtonElement>("button[aria-pressed='true']");
    expect(selected?.textContent).toContain("変更する");
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    const disabled = mount.container.querySelector<HTMLButtonElement>(".item-slot--unavailable button[aria-disabled='true']");
    expect(disabled?.getAttribute("aria-describedby")).toBeTruthy();
    expect(mount.container.textContent).toContain("遅延・寝過ごしのターンは使えない");
    expect(mount.container.textContent).toContain("持っているだけで効く");
    const passiveButton = mount.container.querySelector<HTMLButtonElement>(".item-slot--passive button")!;
    expect(passiveButton.hasAttribute("aria-pressed")).toBe(false);
    expect(passiveButton.getAttribute("aria-disabled")).toBe("true");
    expect(passiveButton.textContent).not.toContain("このアイテムを使う");
    expect(passiveButton.textContent).not.toContain("変更する");

    dispatchReactEvent(selected!, new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("route-1", "route-ticket");
    dispatchReactEvent(disabled!, new MouseEvent("click", { bubbles: true }));
    dispatchReactEvent(passiveButton, new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    rerenderInventory(mount, {
      view: itemView({ inventory: [], usableItems: [], draft: { items: [] } }), onSelect,
    });
    expect(mount.container.querySelectorAll(".item-slot--empty")).toHaveLength(3);
  });

  it("keeps another pre-roll item available so selecting it replaces the current draft", () => {
    const onSelect = vi.fn();
    const view = itemView({
      inventory: [{ id: "route-1", kind: "route-ticket" }, { id: "double-1", kind: "double" }],
      draft: { items: [{ kind: "route-ticket", instanceId: "route-1", serviceId: "line-b" }] },
      usableItems: [
        { instanceId: "route-1", kind: "route-ticket", usable: true, reason: null, selected: true, recommended: true },
        { instanceId: "double-1", kind: "double", usable: true, reason: null, selected: false, recommended: true },
      ],
    });
    const mount = mountReact(createElement(InventoryPanel, { view, onSelect }));
    mounted.push(mount);

    expect(mount.container.textContent).toContain("ほかのアイテムを選択中です。使うと置き換わります。");
    const replaceButton = [...mount.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.closest(".item-slot")?.textContent?.includes("倍速券"))!;
    expect(replaceButton.disabled).toBe(false);
    expect(replaceButton.getAttribute("aria-disabled")).not.toBe("true");
    dispatchReactEvent(replaceButton, new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("double-1", "double");
  });

  it("groups route choices, highlights Yamanote, explains direction guidance, and commits a concrete service", () => {
    const { network, view, presentation } = routeDialogFixture("route-ticket");
    const onChoose = vi.fn();
    const mount = mountReact(createElement(ItemUseDialog, {
      kind: "route-ticket", instanceId: "choice-1", view, network, presentation,
      onChoose, onClose: vi.fn(),
    }));
    mounted.push(mount);

    expect(mount.container.textContent).toContain("路線指定券で山手線に乗れます");
    expect(mount.container.textContent).toContain("乗車時間ではなく");
    expect(mount.container.querySelector(".item-route-option--target")).not.toBeNull();
    expect(mount.container.textContent).toContain("正方向");
    expect(mount.container.textContent).toContain("短い方向はありません");
    expect(onChoose).not.toHaveBeenCalled();
    const yamanote = mount.container.querySelector<HTMLInputElement>("input[value='m-loop']")!;
    dispatchReactEvent(yamanote, new MouseEvent("click", { bubbles: true }));
    expect(onChoose).not.toHaveBeenCalled();
    const confirm = [...mount.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "この路線に決める")!;
    dispatchReactEvent(confirm, new MouseEvent("click", { bubbles: true }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "route-ticket", instanceId: "choice-1", serviceId: "m-loop" });
  });

  it("lets keyboard radio navigation finish before committing a direction choice", () => {
    const { network, view, presentation } = routeDialogFixture("direction-ticket");
    const onChoose = vi.fn();
    const mount = mountReact(createElement(ItemUseDialog, {
      kind: "direction-ticket", instanceId: "choice-1", view, network, presentation,
      onChoose, onClose: vi.fn(),
    }));
    mounted.push(mount);

    expect(mount.container.textContent).toContain("正方向");
    expect(mount.container.textContent).toContain("逆方向");
    const reverse = mount.container.querySelector<HTMLInputElement>("input[value='-1']")!;
    dispatchReactEvent(reverse, new MouseEvent("click", { bubbles: true }));
    expect(onChoose).not.toHaveBeenCalled();
    dispatchReactEvent([...mount.container.querySelectorAll("button")]
      .find((button) => button.textContent === "この方向に決める")!, new MouseEvent("click", { bubbles: true }));
    expect(onChoose).toHaveBeenCalledWith({ kind: "direction-ticket", instanceId: "choice-1", direction: -1 });
  });

  it("offers only legal adjustments, shows resulting pips, and continues with the chosen ticket", () => {
    const onContinue = vi.fn();
    const decision = {
      kind: "adjust" as const,
      turn: 1,
      rawRoll: 2,
      resolvedRide: { serviceId: "line-a", direction: 1 as const },
      allowedDeltas: [1] as const,
      itemInstanceIds: ["adjust-1"],
      canContinue: true as const,
    };
    const mount = mountReact(createElement(RollAdjustment, { decision, onContinue }));
    mounted.push(mount);

    expect(mount.container.textContent).toContain("出目：2");
    expect(mount.container.textContent).toContain("出目 3、3マス進む");
    expect(mount.container.textContent).toContain("そのまま：出目 2、2マス進む");
    expect(mount.container.textContent).not.toContain("−1：");
    const plus = mount.container.querySelector<HTMLInputElement>("input[value='1']")!;
    dispatchReactEvent(plus, new MouseEvent("click", { bubbles: true }));
    const continueButton = [...mount.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("出目3で続ける"))!;
    dispatchReactEvent(continueButton, new MouseEvent("click", { bubbles: true }));
    expect(onContinue).toHaveBeenCalledWith({ instanceId: "adjust-1", delta: 1 });
  });

  it("treats Escape in the revealed-roll dialog as continue without adjustment", () => {
    const onContinue = vi.fn();
    const decision = {
      kind: "adjust" as const,
      turn: 1,
      rawRoll: 6,
      resolvedRide: { serviceId: "line-a", direction: 1 as const },
      allowedDeltas: [-1] as const,
      itemInstanceIds: ["adjust-1"],
      canContinue: true as const,
    };
    const mount = mountReact(createElement(RollAdjustment, { decision, onContinue }));
    mounted.push(mount);
    const dialog = mount.container.querySelector("dialog")!;
    const cancel = new Event("cancel", { cancelable: true });
    dispatchReactEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onContinue).toHaveBeenCalledWith(null);
  });

  it("requires one of the four inventory candidates to be discarded and marks the new pickup", () => {
    const onDiscard = vi.fn();
    const decision = {
      kind: "discard" as const,
      turn: 1,
      newItemInstanceId: "new-item",
      candidates: [
        { id: "held-a", kind: "double" as const },
        { id: "held-b", kind: "rapid" as const },
        { id: "held-c", kind: "direction-ticket" as const },
        { id: "new-item", kind: "route-ticket" as const },
      ],
    };
    const mount = mountReact(createElement(DiscardChoice, { decision, onDiscard }));
    mounted.push(mount);

    expect(mount.container.querySelectorAll(".item-discard__choice")).toHaveLength(4);
    expect(mount.container.textContent).toContain("新しく拾った");
    expect(mount.container.querySelectorAll("button")).toHaveLength(4);
    const escape = new Event("cancel", { cancelable: true });
    dispatchReactEvent(mount.container.querySelector("dialog")!, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onDiscard).not.toHaveBeenCalled();
    dispatchReactEvent(mount.container.querySelectorAll("button")[3]!, new MouseEvent("click", { bubbles: true }));
    expect(onDiscard).toHaveBeenCalledWith("new-item");
  });
});

it("coordinates the modal announcement, focuses the adjustment heading, then restores roll focus", async () => {
  const { act } = await import("react");
  const { GamePanel } = await import("../../src/features/game/components/GamePanel");
  const { beginItemTurn, finishItemTurn } = await import("../../src/features/game/engine");
  const { resumeSession } = await import("../../src/features/game/gameSession");
  const network = buildRailwayNetwork(multiServiceInput());
  const config = { ...multiConfig(), itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille: 0 } };
  const base = { ...createItemGame(config, "focus-adjust", network), inventory: [{ id: "adjust", kind: "roll-adjust" as const }] };
  const pending = beginItemTurn(base, { items: [] }, network).state;
  const session = resumeSession(pending, network);
  const common = { network, lines: [], displayedStationId: base.currentStationId, displayedCompletedCount: 0,
    requiredCount: 4, saveStatus: "saved" as const, follow: true, speedLabel: "省略", reducedMotion: true,
    onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn() };
  const mount = mountReact(createElement(GamePanel, { ...common, session, itemView: itemSessionView(session, network) }));
  mounted.push(mount);
  expect(document.activeElement?.textContent).toBe("出目を調整しますか？");
  expect(mount.container.querySelectorAll("[role=status]")).toHaveLength(1);
  expect(mount.container.querySelector(".game-panel__save")?.hasAttribute("role")).toBe(false);
  expect(mount.container.querySelector("dialog [role=status]")?.textContent).toContain("出目は");
  const completed = resumeSession(finishItemTurn(pending, null, network).state, network);
  act(() => mount.root.render(createElement(GamePanel, { ...common, session: completed, itemView: itemSessionView(completed, network) })));
  expect(document.activeElement).toBe(mount.container.querySelector(".game-panel__roll"));
  expect(mount.container.querySelectorAll("[role=status]")).toHaveLength(1);
  expect(mount.container.querySelector(".game-panel__save")?.hasAttribute("role")).toBe(false);
  expect(mount.container.querySelector("[role=status]")?.textContent).toContain("サイコロを振れます");
});

it("keeps exactly one game-panel status region in legacy mode", async () => {
  const { GamePanel } = await import("../../src/features/game/components/GamePanel");
  const { createGame } = await import("../../src/features/game/engine");
  const { resumeSession } = await import("../../src/features/game/gameSession");
  const network = buildRailwayNetwork(multiServiceInput());
  const game = createGame(multiConfig(), "legacy-status", network);
  const session = resumeSession(game, network);
  const mount = mountReact(createElement(GamePanel, {
    network, lines: [], session, displayedStationId: game.currentStationId, displayedCompletedCount: 0,
    requiredCount: 4, saveStatus: "saved", follow: true, speedLabel: "標準", reducedMotion: false,
    onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn(),
  }));
  mounted.push(mount);
  expect(mount.container.querySelectorAll(".game-panel [role=status]")).toHaveLength(1);
  expect(mount.container.querySelector(".game-panel__save")?.hasAttribute("role")).toBe(false);
  expect(mount.container.querySelector(".game-panel__save")?.textContent).toContain("セーブ: 自動保存済み");
});

it("feeds the HUD displayed values and the supplied required count, and hides chips while moving", async () => {
  const { act } = await import("react");
  const { GamePanel } = await import("../../src/features/game/components/GamePanel");
  const { resumeSession } = await import("../../src/features/game/gameSession");
  const network = buildRailwayNetwork(multiServiceInput());
  const base = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "hud-displayed", network);
  const game = { ...base, effects: { delayDueTurns: [3], suspensions: [], detourPending: true, oversleepPending: true } };
  const idle = resumeSession(game, network);
  const common = { network, lines: [], displayedStationId: "a", displayedCompletedCount: 2, requiredCount: 4,
    saveStatus: "saved" as const, follow: true, speedLabel: "標準", reducedMotion: false,
    onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn() };
  type PanelProps = Parameters<typeof GamePanel>[0];
  function Harness({ value }: { value: PanelProps }): React.JSX.Element {
    return createElement(GamePanel, value);
  }
  const mount = mountReact(createElement(Harness, { value: { ...common, session: idle, itemView: itemSessionView(idle, network) } }));
  mounted.push(mount);
  const stat = (name: string): string | null | undefined => mount.container.querySelector(`[data-stat=${name}]`)?.textContent;
  expect(stat("station")).toBe("駅a");
  expect(stat("progress")).toBe("2/4");
  const bars = mount.container.querySelectorAll(".game-panel [role=progressbar]");
  expect(bars).toHaveLength(1);
  expect([bars[0]!.getAttribute("aria-valuenow"), bars[0]!.getAttribute("aria-valuemax")]).toEqual(["2", "4"]);
  const chips = mount.container.querySelector(".game-panel [aria-label='続いている効果']");
  expect([...chips!.querySelectorAll(".effect-chip__label")].map((label) => label.textContent)).toEqual(["遅延 あと3", "寄り道", "寝過ごし"]);
  expect(chips!.textContent).toContain("遅延：3ターン目に発動（あと3ターン）");
  const log = mount.container.querySelector("[aria-label='ターンのログ']")!;
  const effectTextList = log.querySelector("[aria-label='効果の説明']")!;
  expect([...effectTextList.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
    "遅延：3ターン目に発動（あと3ターン）",
    "寄り道：次に別の路線へ乗り換えられる駅で発動します",
    "寝過ごし：次のターンは終点まで（環状線は6駅）進みます",
  ]);
  expect((effectTextList as HTMLElement).hidden).toBe(false);
  expect(effectTextList.querySelectorAll(".visually-hidden, [hidden]")).toHaveLength(0);
  expect(log.querySelectorAll("[aria-label='続いている効果']")).toHaveLength(0);
  expect(mount.container.querySelectorAll("[aria-label='続いている効果']")).toHaveLength(1);
  const moving = { ...idle, phase: "animating" as const };
  const roll = mount.container.querySelector(".game-panel__roll");
  act(() => mount.root.render(createElement(Harness, { value: { ...common, session: moving, itemView: itemSessionView(moving, network),
    displayedStationId: "b", displayedCompletedCount: 3 } })));
  expect(mount.container.querySelector(".game-panel__roll")).toBe(roll);
  expect(stat("station")).toBe("駅b");
  expect(stat("progress")).toBe("3/4");
  expect(mount.container.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("3");
  expect(mount.container.querySelector("[aria-label='続いている効果']")).toBeNull();
  const skip = [...mount.container.querySelectorAll("button")].find((button) => button.textContent === "スキップ")!;
  expect(skip.disabled).toBe(false);
  dispatchReactEvent(skip, new MouseEvent("click", { bubbles: true }));
  expect(common.onSkip).toHaveBeenCalledTimes(1);
});

it("shows historical outcomes separately from countdowns, including the all-suspended fallback", async () => {
  const { ItemEventNotice } = await import("../../src/features/game/components/ItemEventNotice");
  const { resumeSession } = await import("../../src/features/game/gameSession");
  const { playItemTurn } = await import("../../src/features/game/engine");
  const network = buildRailwayNetwork(multiServiceInput());
  const config = { ...multiConfig(), itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille: 1000,
    harmfulChancePercent: 100, harmfulKinds: ["delay"] as const } };
  const game = playItemTurn(createItemGame(config, "notice-delay", network), {}, network).state;
  const session = resumeSession(game, network);
  const last = session.lastMove!;
  const record = last.itemRecord!;
  const presentation = createPresentationResolver(network);
  const mount = mountReact(createElement(ItemEventNotice, {
    view: itemSessionView(session, network)!, turn: game.turn, network, presentation,
    lastMove: { ...last, itemRecord: { ...record, landingSnapshot: { ...record.landingSnapshot!, suspensionIgnored: true } } },
  }));
  mounted.push(mount);
  expect(mount.container.querySelector("[aria-label='前のターンの結果']")?.textContent).toContain("4ターン目に発動（あと3ターン）");
  expect(mount.container.querySelector("[aria-label='続いている効果']")?.textContent).toContain("あと3ターン");
  const withoutEffects = mountReact(createElement(ItemEventNotice, {
    view: itemSessionView(session, network)!, turn: game.turn, network, presentation,
    lastMove: session.lastMove, showEffects: false,
  }));
  mounted.push(withoutEffects);
  expect(withoutEffects.container.querySelector("[aria-label='続いている効果']")).toBeNull();
  expect(mount.container.textContent).toContain("この駅では候補がすべて運休のため、運休を無視して抽選しました");
  expect(mount.container.querySelectorAll("[role=status], [aria-live]")).toHaveLength(0);
});
