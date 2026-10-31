// @vitest-environment jsdom
import { act, createElement, Fragment, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCard, ItemCardPopover, placeItemCard, type ItemCardPopoverProps, type ItemCardPlacementRect } from "../../src/features/game/components/ItemCard";
import {
  ITEM_DESCRIPTIONS, ITEM_REPLACEMENT_NOTE, itemHint, itemTiming, itemTone,
  itemUnavailableLabel,
} from "../../src/features/game/itemPresentation";
import { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS, type ItemKind } from "../../src/types/network";
import type { ItemUnavailableReason } from "../../src/features/game/itemSession";
import { mountReact } from "./helpers/reactDom";

const ITEM_KINDS: readonly ItemKind[] = [...BENEFICIAL_ITEM_KINDS, ...HARMFUL_ITEM_KINDS];
const UNAVAILABLE_REASONS: readonly ItemUnavailableReason[] = [
  "completed", "decision-pending", "forced-turn", "passive", "after-roll", "item-already-selected",
  "no-route-choice", "fixed-direction", "no-rapid-stop", "single-direction", "suspended-route",
];

function markup(kind: ItemKind, props: Omit<React.ComponentProps<typeof ItemCard>, "kind"> = {}): string {
  return renderToStaticMarkup(createElement(ItemCard, { kind, ...props }));
}

describe("ItemCard", () => {
  it("renders the full name, effect, timing, icon and tone for every item", () => {
    for (const kind of ITEM_KINDS) {
      const container: HTMLDivElement = document.createElement("div");
      container.innerHTML = markup(kind);
      const heading: HTMLHeadingElement | null = container.querySelector("h3");
      expect(container.querySelectorAll("h3"), kind).toHaveLength(1);
      expect(heading?.textContent, kind).toBe(ITEM_DESCRIPTIONS[kind].name);
      expect(container.textContent, kind).toContain(ITEM_DESCRIPTIONS[kind].effect);
      expect(container.textContent, kind).toContain(itemTiming(kind));
      expect(container.querySelectorAll("svg"), kind).toHaveLength(1);
      expect(container.querySelector("svg")?.getAttribute("aria-hidden"), kind).toBe("true");
      expect(container.firstElementChild?.classList.contains(`item-card--${itemTone(kind)}`), kind).toBe(true);
    }
  });

  it("renders a passive certificate without an action button", () => {
    const container: HTMLDivElement = document.createElement("div");
    container.innerHTML = markup("delay-certificate", { unavailableReason: "passive" });
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".item-card__timing")?.textContent).toBe("持っているだけで効く");
    expect(container.querySelector(".item-card__reason")).toBeNull();
    expect(container.textContent).not.toContain("持っているだけで効くアイテムです");
  });

  it("describes an after-roll action with its unavailable reason", () => {
    const container: HTMLDivElement = document.createElement("div");
    container.innerHTML = markup("roll-adjust", {
      unavailableReason: "after-roll", action: { label: "使う", disabled: true, onActivate: () => undefined },
    });
    const button: HTMLButtonElement | null = container.querySelector("button");
    const reasonId: string | null = button?.getAttribute("aria-describedby") ?? null;
    expect(button?.disabled).toBe(true);
    expect(reasonId).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(reasonId ?? "")}`)?.textContent).toBe("出目が出た後に使えるアイテムです");
  });

  it("renders each unavailable reason label", () => {
    for (const reason of UNAVAILABLE_REASONS) {
      const container: HTMLDivElement = document.createElement("div");
      container.innerHTML = markup("double", { unavailableReason: reason });
      expect(container.querySelector(".item-card__reason")?.textContent, reason).toBe(itemUnavailableLabel(reason));
    }
  });

  it("renders rapid and deadhead hints with caution only where needed", () => {
    const rapidGood: HTMLDivElement = document.createElement("div");
    rapidGood.innerHTML = markup("rapid", { hint: itemHint("rapid", { rapidHeadsTowardYamanote: true, deadheadRecommended: true }) });
    expect(rapidGood.querySelector(".item-card__hint")?.textContent).toBe("おすすめ：現在の向きは山手線に近づきます");
    expect(rapidGood.querySelector(".item-card__hint--caution")).toBeNull();

    const rapidCaution: HTMLDivElement = document.createElement("div");
    rapidCaution.innerHTML = markup("rapid", { hint: itemHint("rapid", { rapidHeadsTowardYamanote: false, deadheadRecommended: true }) });
    expect(rapidCaution.querySelector(".item-card__hint--caution")?.textContent).toBe("注意：現在の向きは山手線から遠ざかります");

    const deadhead: HTMLDivElement = document.createElement("div");
    deadhead.innerHTML = markup("deadhead", { hint: itemHint("deadhead", { rapidHeadsTowardYamanote: true, deadheadRecommended: false }) });
    expect(deadhead.querySelector(".item-card__hint--caution")?.textContent).toBe("おすすめしない：山手線の駅にいるため、同じ駅にとどまり1ターン使います");
  });

  it("shows the replacement note unless this card is selected", () => {
    expect(markup("rapid", { replacesSelection: true })).toContain(ITEM_REPLACEMENT_NOTE);
    expect(markup("rapid", { replacesSelection: true, selected: true })).not.toContain(ITEM_REPLACEMENT_NOTE);
  });

  it("shows selected and new markers outside the heading", () => {
    const plain: HTMLDivElement = document.createElement("div");
    plain.innerHTML = markup("rapid");
    expect(plain.querySelector(".item-card__markers")).toBeNull();
    const marked: HTMLDivElement = document.createElement("div");
    marked.innerHTML = markup("rapid", { selected: true, isNew: true });
    expect(marked.querySelector(".item-card__markers")?.textContent).toContain("選択中");
    expect(marked.querySelector(".item-card__markers")?.textContent).toContain("新しく拾った");
    expect(marked.querySelector("h3")?.textContent).toBe(ITEM_DESCRIPTIONS.rapid.name);
  });

  it("uses exact action labels without aria-label overrides", () => {
    for (const label of ["使う", "選択中・変更する", "このアイテムを捨てる"]) {
      const container: HTMLDivElement = document.createElement("div");
      container.innerHTML = markup("rapid", { action: { label, disabled: false, onActivate: () => undefined } });
      expect(container.querySelectorAll("button")).toHaveLength(1);
      expect(container.querySelector("button")?.textContent).toBe(label);
      expect(container.querySelector("button")?.hasAttribute("aria-label")).toBe(false);
    }
  });

  it("activates enabled actions once and never activates disabled actions", () => {
    const onActivate = vi.fn<() => void>();
    const enabled = mountReact(createElement(ItemCard, { kind: "rapid", action: { label: "使う", disabled: false, onActivate } }));
    act(() => enabled.container.querySelector("button")?.click());
    enabled.cleanup();
    expect(onActivate).toHaveBeenCalledTimes(1);

    const disabledAction = vi.fn<() => void>();
    const disabled = mountReact(createElement(ItemCard, { kind: "rapid", action: { label: "使う", disabled: true, onActivate: disabledAction } }));
    act(() => disabled.container.querySelector("button")?.click());
    disabled.cleanup();
    expect(disabledAction).not.toHaveBeenCalled();
  });

  it("contains no extra controls, tab stops, or live regions", () => {
    const container: HTMLDivElement = document.createElement("div");
    container.innerHTML = markup("rapid", { action: { label: "使う", disabled: false, onActivate: () => undefined } });
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("button button, a, input, select, textarea, [role='status'], [aria-live]")).toBeNull();
    expect([...container.querySelectorAll("[tabindex]")].map((element) => element.getAttribute("tabindex"))).toEqual(["-1"]);
    expect(container.querySelector("h3")?.getAttribute("tabindex")).toBe("-1");
  });

  it("uses a supplied heading id and generates distinct defaults", () => {
    const supplied: HTMLDivElement = document.createElement("div");
    supplied.innerHTML = markup("rapid", { headingId: "chosen-heading" });
    expect(supplied.querySelector("h3")?.id).toBe("chosen-heading");

    // Several cards share one dialog in S22, so the defaults must differ inside one root.
    const both = mountReact(createElement(Fragment, null,
      createElement(ItemCard, { kind: "rapid", unavailableReason: "forced-turn" }),
      createElement(ItemCard, { kind: "double", unavailableReason: "forced-turn" })));
    const headingIds: string[] = [...both.container.querySelectorAll("h3")].map((heading) => heading.id);
    const reasonIds: string[] = [...both.container.querySelectorAll(".item-card__reason")].map((reason) => reason.id);
    both.cleanup();
    expect(headingIds).toHaveLength(2);
    expect(headingIds.every((id) => id.length > 0)).toBe(true);
    expect(new Set([...headingIds, ...reasonIds]).size).toBe(4);
  });

  it("does not import game engines or stores and keeps card CSS static", () => {
    const source: string = readFileSync("src/features/game/components/ItemCard.tsx", "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*\/(?:engine|store)(?:\/|["'])/);
    expect(source).not.toContain("Math.random");
    const styles: string = readFileSync("src/styles.css", "utf8");
    expect(styles).toMatch(/\.item-card__action\s*\{[^}]*min-height:\s*44px/s);
    const cardRules: string[] = styles.match(/\.item-card[\w-]*[^{]*\{[^}]*\}/g) ?? [];
    expect(cardRules.length).toBeGreaterThan(10);
    for (const rule of cardRules) expect(rule).not.toMatch(/transition|animation/i);
  });
});

interface PopoverHarnessProps {
  open: boolean; anchorPresent: boolean; onClose: () => void; popoverPresent?: boolean;
  /** Overrides the rendered slot, e.g. an element the test detaches while keeping its identity. */
  externalAnchor?: HTMLElement;
}

function Harness({ open, anchorPresent, onClose, popoverPresent = true, externalAnchor }: PopoverHarnessProps): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const popoverProps: Omit<ItemCardPopoverProps, "children"> = {
    open,
    anchor: externalAnchor ?? anchor,
    onClose,
    labelledBy: "popover-heading",
  };
  return createElement("main", { className: "game-panel" },
    createElement("button", { className: "game-panel__roll" }, "サイコロを振る"),
    anchorPresent && createElement("button", { ref: setAnchor }, "slot"),
    popoverPresent && createElement(ItemCardPopover, {
      ...popoverProps,
      children: createElement(ItemCard, { kind: "rapid", headingId: "popover-heading", action: { label: "使う", disabled: false, onActivate: () => undefined } }),
    }));
}

describe("ItemCardPopover", () => {
  let showPopover: ReturnType<typeof vi.fn>;
  let hidePopover: ReturnType<typeof vi.fn>;
  let togglePopover: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showPopover = vi.fn(function (this: HTMLElement): void { this.style.display = "block"; });
    hidePopover = vi.fn(function (this: HTMLElement): void { this.style.display = ""; });
    togglePopover = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: showPopover });
    Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: hidePopover });
    Object.defineProperty(HTMLElement.prototype, "togglePopover", { configurable: true, value: togglePopover });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
    Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
    Reflect.deleteProperty(HTMLElement.prototype, "togglePopover");
    document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
  });

  function mountHarness(props: PopoverHarnessProps): ReturnType<typeof mountReact> {
    const mount = mountReact(createElement(Harness, { ...props, open: false }));
    if (props.open) update(mount, props);
    return mount;
  }

  function update(mount: ReturnType<typeof mountReact>, props: PopoverHarnessProps): void {
    act(() => mount.root.render(createElement(Harness, props)));
  }

  it("renders a named native dialog inside the game panel", () => {
    const mount = mountHarness({ open: false, anchorPresent: true, onClose: vi.fn() });
    const element = mount.container.querySelector<HTMLElement>("[role=dialog]");
    expect(element?.getAttribute("popover")).toBe("auto");
    expect(element?.getAttribute("aria-labelledby")).toBe("popover-heading");
    expect(element?.hasAttribute("aria-modal")).toBe(false);
    expect(element?.closest(".game-panel")).not.toBeNull();
    expect(mount.container.querySelector("#popover-heading")?.textContent).toBe(ITEM_DESCRIPTIONS.rapid.name);
    mount.cleanup();
  });

  it("shows and hides once, focusing the heading, and ignores disconnected elements", () => {
    const mount = mountHarness({ open: false, anchorPresent: true, onClose: vi.fn() });
    update(mount, { open: true, anchorPresent: true, onClose: vi.fn() });
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toBe("popover-heading");
    update(mount, { open: true, anchorPresent: true, onClose: vi.fn() });
    expect(showPopover).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose: vi.fn() });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    mount.container.remove();
    update(mount, { open: true, anchorPresent: true, onClose: vi.fn() });
    expect(showPopover).toHaveBeenCalledTimes(1);
    mount.cleanup();
  });

  it("handles Escape and restores focus to the anchor after the parent closes", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: false, anchorPresent: true, onClose });
    update(mount, { open: true, anchorPresent: true, onClose });
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.getElementById("popover-heading")?.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement?.textContent).toBe("slot");
    mount.cleanup();
  });

  it("leaves Escape to an open native modal dialog", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.getElementById("popover-heading")?.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    mount.cleanup();
  });

  it("closes from its button and restores focus", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    act(() => mount.container.querySelector<HTMLButtonElement>(".item-card-popover__close")?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement?.textContent).toBe("slot");
    mount.cleanup();
  });

  it("syncs native dismissal without restoring focus and ignores a closed toggle", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    const event = new Event("toggle");
    Object.defineProperty(event, "newState", { value: "closed" });
    act(() => mount.container.querySelector("[role=dialog]")?.dispatchEvent(event));
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement?.textContent).not.toBe("slot");
    const next = new Event("toggle");
    Object.defineProperty(next, "newState", { value: "closed" });
    act(() => mount.container.querySelector("[role=dialog]")?.dispatchEvent(next));
    expect(onClose).toHaveBeenCalledTimes(1);
    mount.cleanup();
  });

  it("syncs a light dismiss on beforetoggle once, before the queued toggle arrives", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    const element = mount.container.querySelector("[role=dialog]");
    const before = new Event("beforetoggle");
    Object.defineProperty(before, "newState", { value: "closed" });
    act(() => element?.dispatchEvent(before));
    expect(onClose).toHaveBeenCalledTimes(1);
    const toggle = new Event("toggle");
    Object.defineProperty(toggle, "newState", { value: "closed" });
    act(() => element?.dispatchEvent(toggle));
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    // The browser already hid it, so closing must not call hidePopover() again or move focus back.
    expect(hidePopover).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).not.toBe("slot");
    mount.cleanup();
  });

  it("treats focus moving to its own opener as Tab-out without pulling focus back", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    const slot = [...mount.container.querySelectorAll("button")].find((button) => button.textContent === "slot");
    act(() => slot?.focus());
    act(() => mount.container.querySelector("[role=dialog]")?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: slot })));
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement).toBe(slot);
    mount.cleanup();
  });

  it("closes on focus leaving without taking focus back", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    const event = new FocusEvent("focusout", { bubbles: true, relatedTarget: outside });
    act(() => mount.container.querySelector("[role=dialog]")?.dispatchEvent(event));
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement).toBe(outside);
    outside.remove();
    mount.cleanup();
  });

  it("closes when the opener is removed and restores to the dice button", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    update(mount, { open: true, anchorPresent: false, onClose });
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: false, onClose });
    expect(document.activeElement?.classList.contains("game-panel__roll")).toBe(true);
    mount.cleanup();
  });

  it("restores focus to the opener even when the parent clears the anchor while closing", () => {
    const onClose = vi.fn();
    const opener: HTMLButtonElement = document.createElement("button");
    opener.textContent = "opener";
    document.body.append(opener);
    const mount = mountHarness({ open: true, anchorPresent: false, onClose, externalAnchor: opener });
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.getElementById("popover-heading")?.dispatchEvent(escape));
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: false, onClose });
    expect(document.activeElement).toBe(opener);
    opener.remove();
    mount.cleanup();
  });

  it("closes when an opener with the same identity is detached and restores to the dice button", () => {
    const onClose = vi.fn();
    const externalAnchor: HTMLButtonElement = document.createElement("button");
    externalAnchor.textContent = "external slot";
    document.body.append(externalAnchor);
    const mount = mountHarness({ open: true, anchorPresent: false, onClose, externalAnchor });
    expect(onClose).not.toHaveBeenCalled();
    externalAnchor.remove();
    update(mount, { open: true, anchorPresent: false, onClose, externalAnchor });
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: false, onClose, externalAnchor });
    expect(document.activeElement?.classList.contains("game-panel__roll")).toBe(true);
    mount.cleanup();
  });

  it("applies the anchored placement inline and switches to the sheet when the viewport narrows", () => {
    const width: number = window.innerWidth;
    const mount = mountHarness({ open: true, anchorPresent: true, onClose: vi.fn() });
    const element = mount.container.querySelector<HTMLElement>("[role=dialog]");
    expect(element?.classList.contains("item-card-popover--anchored")).toBe(true);
    expect(element?.style.top).toMatch(/px$/);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(element?.classList.contains("item-card-popover--sheet")).toBe(true);
    expect(element?.style.top).toBe("");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    mount.cleanup();
  });

  it("adds and removes resize, capture-scroll and capture-key listeners with its open lifetime", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const mount = mountHarness({ open: false, anchorPresent: true, onClose: vi.fn() });
    update(mount, { open: true, anchorPresent: true, onClose: vi.fn() });
    const added = add.mock.calls.filter(([type]) => ["resize", "scroll", "keydown"].includes(type as string));
    expect(added.map(([type]) => type)).toEqual(expect.arrayContaining(["resize", "scroll", "keydown"]));
    const handlers = added.map(([, listener]) => listener);
    update(mount, { open: false, anchorPresent: true, onClose: vi.fn() });
    const removed = remove.mock.calls.filter(([, listener]) => handlers.includes(listener));
    expect(removed).toHaveLength(3);
    add.mockRestore();
    remove.mockRestore();
    mount.cleanup();
  });

  it("removes every open-lifetime listener with its capture flag when unmounted while open", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const mount = mountHarness({ open: true, anchorPresent: true, onClose: vi.fn() });
    const added = add.mock.calls.filter(([type]) => ["resize", "scroll", "keydown"].includes(type as string));
    expect(added).toHaveLength(3);
    mount.cleanup();
    for (const [type, listener, options] of added) {
      const capture: boolean = typeof options === "boolean" ? options : options?.capture === true;
      const match = remove.mock.calls.find(([removedType, removedListener]) => removedType === type && removedListener === listener);
      expect(match, type as string).toBeDefined();
      const removedOptions = match?.[2];
      expect(typeof removedOptions === "boolean" ? removedOptions : removedOptions?.capture === true, type as string).toBe(capture);
    }
    add.mockRestore();
    remove.mockRestore();
  });

  it("restores focus after the browser's own hide-time focus move", () => {
    const onClose = vi.fn();
    const mount = mountHarness({ open: true, anchorPresent: true, onClose });
    const elsewhere: HTMLButtonElement = document.createElement("button");
    document.body.append(elsewhere);
    // A real browser may move focus while hiding; the requested restoration must still win.
    hidePopover.mockImplementation(function (this: HTMLElement): void { elsewhere.focus(); });
    act(() => mount.container.querySelector<HTMLButtonElement>(".item-card-popover__close")?.click());
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe("slot");
    expect(onClose).toHaveBeenCalledTimes(1);
    elsewhere.remove();
    mount.cleanup();
  });

  it("renders an inline fallback with equivalent focus and dismissal", () => {
    Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
    Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
    Reflect.deleteProperty(HTMLElement.prototype, "togglePopover");
    const onClose = vi.fn();
    const add = vi.spyOn(window, "addEventListener");
    const mount = mountHarness({ open: false, anchorPresent: true, onClose });
    const element = mount.container.querySelector<HTMLElement>("[role=dialog]");
    expect(element?.hasAttribute("popover")).toBe(false);
    expect(element?.hidden).toBe(true);
    update(mount, { open: true, anchorPresent: true, onClose });
    expect(element?.hidden).toBe(false);
    expect(document.activeElement?.id).toBe("popover-heading");
    expect(add.mock.calls.filter(([type]) => type === "resize" || type === "scroll")).toHaveLength(0);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.getElementById("popover-heading")?.dispatchEvent(escape));
    expect(onClose).toHaveBeenCalledTimes(1);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement?.textContent).toBe("slot");
    update(mount, { open: true, anchorPresent: true, onClose });
    act(() => mount.container.querySelector<HTMLButtonElement>(".item-card-popover__close")?.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    update(mount, { open: false, anchorPresent: true, onClose });
    update(mount, { open: true, anchorPresent: true, onClose });
    const outside: HTMLButtonElement = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    act(() => element?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside })));
    expect(onClose).toHaveBeenCalledTimes(3);
    update(mount, { open: false, anchorPresent: true, onClose });
    expect(document.activeElement).toBe(outside);
    outside.remove();
    add.mockRestore();
    mount.cleanup();
  });

  it("has no live region and adds only the close button beside the card action", () => {
    const mount = mountHarness({ open: true, anchorPresent: true, onClose: vi.fn() });
    const element = mount.container.querySelector("[role=dialog]");
    expect(element?.querySelector("[role=status], [aria-live]")).toBeNull();
    expect(element?.querySelectorAll("button")).toHaveLength(2);
    expect(element?.querySelector(".item-card-popover__close")?.textContent).toBe("閉じる");
    mount.cleanup();
  });

  it("moves focus to dice when unmounted while focus is inside", () => {
    const mount = mountHarness({ open: true, anchorPresent: true, onClose: vi.fn() });
    update(mount, { open: true, anchorPresent: true, onClose: vi.fn(), popoverPresent: false });
    expect(document.activeElement?.classList.contains("game-panel__roll")).toBe(true);
    mount.cleanup();
  });

  it("guards popover CSS placement, static motion, and close target size", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const actionIndex = styles.indexOf(".item-card__action {");
    const baseIndex = styles.indexOf(".item-card-popover {");
    const mediaIndex = styles.indexOf("@media", actionIndex);
    expect(baseIndex).toBeGreaterThan(actionIndex);
    expect(baseIndex).toBeLessThan(mediaIndex);
    const rules = styles.match(/\.item-card-popover[\w:()[\]. -]*\s*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(7);
    for (const rule of rules) expect(rule).not.toMatch(/transition|animation/i);
    expect(rules.find((rule) => rule.startsWith(".item-card-popover {"))).not.toMatch(/display\s*:/);
    expect(rules.find((rule) => rule.startsWith(".item-card-popover--native {"))).not.toMatch(/display\s*:/);
    // The popover has no motion at all (so nothing to disable under reduced motion); any later transition fails above.
    expect(styles).not.toMatch(/item-card-popover[^{]*\{[^}]*(?:transition|animation)/i);
    expect(styles).toMatch(/\.item-card-popover__close\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
  });
});

describe("placeItemCard", () => {
  const anchor: ItemCardPlacementRect = { top: 300, left: 300, width: 40, height: 40 };
  const viewport = { width: 1000, height: 800 };

  it("prefers above, flips below, and clamps both horizontal edges", () => {
    expect(placeItemCard(anchor, { width: 200, height: 100 }, viewport)).toEqual({ mode: "anchored", side: "above", top: 192, left: 220 });
    expect(placeItemCard({ ...anchor, top: 40 }, { width: 200, height: 100 }, viewport)).toEqual({ mode: "anchored", side: "below", top: 88, left: 220 });
    expect(placeItemCard({ ...anchor, left: 0 }, { width: 200, height: 100 }, viewport)).toMatchObject({ left: 8 });
    expect(placeItemCard({ ...anchor, left: 980 }, { width: 200, height: 100 }, viewport)).toMatchObject({ left: 792 });
  });

  it("chooses the roomier side when neither side fits and clamps tall cards", () => {
    expect(placeItemCard({ ...anchor, top: 350 }, { width: 200, height: 400 }, viewport)).toEqual({ mode: "anchored", side: "below", top: 392, left: 220 });
    expect(placeItemCard({ ...anchor, top: 350 }, { width: 200, height: 900 }, viewport)).toMatchObject({ mode: "anchored", top: 8 });
  });

  it("uses the sheet at each inclusive viewport breakpoint", () => {
    for (const size of [{ width: 600, height: 800 }, { width: 390, height: 844 }, { width: 1000, height: 500 }, { width: 667, height: 375 }]) {
      expect(placeItemCard(anchor, { width: 200, height: 100 }, size)).toEqual({ mode: "sheet" });
    }
    expect(placeItemCard(anchor, { width: 200, height: 100 }, { width: 601, height: 501 }).mode).toBe("anchored");
  });
});
