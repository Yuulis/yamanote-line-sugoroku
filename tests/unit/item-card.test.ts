// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ItemCard } from "../../src/features/game/components/ItemCard";
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
    expect(container.querySelector(".item-card__reason")?.textContent).toBe("持っているだけで効くアイテムです");
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
