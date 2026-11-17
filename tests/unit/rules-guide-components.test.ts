// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulesGuide, focusRulesSection } from "../../src/features/game/components/RulesGuide";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { buildRulesGuide, type RulesSectionId } from "../../src/features/game/rulesGuide";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

const ID_PREFIX = "test-rules";
const SECTION_IDS: readonly RulesSectionId[] = ["goal", "lottery", "items", "controls", "save"];
const AUTO_TRIGGER_WORDING = "自動で発動";
const PHONE_REDUCED_SELECTOR = ".rules-guide__phone-reduced";

const model = buildRulesGuide(ITEM_GAME_CONFIG);
let mounted: MountedReact | null = null;
let scrollStubbed = false;

function mountGuide(): HTMLElement {
  mounted = mountReact(createElement(RulesGuide, { model, idPrefix: ID_PREFIX }));
  return mounted.container;
}

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  // jsdom does not implement scrollIntoView; remove the stub so other cases see the environment default.
  if (scrollStubbed) Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  scrollStubbed = false;
});

describe("RulesGuide", () => {
  it("renders all five labelled sections with prefixed ids", () => {
    const container = mountGuide();

    const sections = [...container.querySelectorAll<HTMLElement>("section.rules-guide__section")];
    expect(sections.map((section) => section.id)).toEqual(SECTION_IDS.map((id) => `${ID_PREFIX}-${id}`));
    sections.forEach((section, index) => {
      const heading = container.querySelector<HTMLElement>(`#${section.getAttribute("aria-labelledby")}`);
      expect(heading?.tagName).toBe("H2");
      expect(heading?.getAttribute("tabindex")).toBe("-1");
      expect(heading?.textContent).toBe(model.sections[index]!.heading);
    });
  });

  it("renders configured item icons names and effects", () => {
    const container = mountGuide();

    const rows = [...container.querySelectorAll<HTMLElement>(".rules-guide__item")];
    expect(rows.map((row) => row.dataset.itemKind)).toEqual(model.items.map((item) => item.kind));
    rows.forEach((row, index) => {
      const item = model.items[index]!;
      expect(row.querySelector("svg.item-icon")).not.toBeNull();
      expect(row.querySelector(".rules-guide__item-name")?.textContent).toBe(item.name);
      expect(row.querySelector(".rules-guide__item-effect")?.textContent).toBe(item.effect);
      expect(row.querySelector(".rules-guide__item-timing")?.textContent).toBe(item.timing);
    });
    expect(container.querySelector(`#${ID_PREFIX}-items`)?.textContent).toContain(ITEM_DESCRIPTIONS.double.name);
  });

  it("navigation focuses the requested section", () => {
    const container = mountGuide();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollStubbed = true;

    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".rules-guide__nav button")];
    expect(buttons.map((button) => button.textContent)).toEqual(model.sections.map((section) => section.heading));
    dispatchReactEvent(buttons[2]!, new MouseEvent("click", { bubbles: true }));

    expect(document.activeElement).toBe(container.querySelector(`#${ID_PREFIX}-items h2`));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("keeps shortcut content semantically separate", () => {
    const container = mountGuide();

    const shortcuts = container.querySelector<HTMLElement>(".rules-guide__shortcuts");
    expect(shortcuts).not.toBeNull();
    expect(shortcuts?.closest("section.rules-guide__section")).toBeNull();
    expect(shortcuts?.tagName).toBe("ASIDE");
    expect(shortcuts?.getAttribute("aria-labelledby")).toBe(shortcuts?.querySelector("h2")?.id);
    expect([...shortcuts!.querySelectorAll("li")].map((entry) => entry.textContent)).toEqual(model.shortcuts);
    for (const section of container.querySelectorAll("section.rules-guide__section")) {
      expect(model.shortcuts.some((line) => section.textContent?.includes(line))).toBe(false);
    }
    expect(container.querySelectorAll(".rules-guide__nav button")).toHaveLength(SECTION_IDS.length);
  });

  it("marks only duplicate detail for phone reduction", () => {
    const container = mountGuide();

    const reduced = [...container.querySelectorAll<HTMLElement>(PHONE_REDUCED_SELECTOR)];
    const rows = [...container.querySelectorAll<HTMLElement>(".rules-guide__item")];
    const harmful = rows.filter((row) => row.classList.contains("rules-guide__item--bad"));
    const beneficial = rows.filter((row) => row.classList.contains("rules-guide__item--good"));
    const harmfulTimings = harmful.map((row) => row.querySelector(".rules-guide__item-timing"));
    const itemsText = model.sections.find((section) => section.id === "items")!.paragraphs.join("");
    expect(harmful.length).toBeGreaterThan(0);
    expect(beneficial.length).toBeGreaterThan(0);
    expect(reduced).toHaveLength(1 + harmful.length);
    expect(reduced).toEqual(expect.arrayContaining([container.querySelector(".rules-guide__nav"), ...harmfulTimings]));
    for (const timing of harmfulTimings) {
      expect(timing?.textContent).toContain(AUTO_TRIGGER_WORDING);
    }
    expect(itemsText).toContain(AUTO_TRIGGER_WORDING);
    for (const row of beneficial) {
      expect(row.querySelector(".rules-guide__item-timing")?.matches(PHONE_REDUCED_SELECTOR)).toBe(false);
    }
    for (const element of reduced) {
      expect(element.querySelector("svg, h2, .rules-guide__item-name, .rules-guide__item-effect, p")).toBeNull();
    }
  });

  it("focusRulesSection focuses the heading and reports a missing section", () => {
    const container = mountGuide();
    Element.prototype.scrollIntoView = vi.fn();
    scrollStubbed = true;

    expect(focusRulesSection(container, ID_PREFIX, "save")).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(`#${ID_PREFIX}-save h2`));
    expect(focusRulesSection(container, "other-prefix", "save")).toBe(false);
  });
});
