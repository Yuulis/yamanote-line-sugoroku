// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulesGuide, focusRulesSection, type RulesGuideProps } from "../../src/features/game/components/RulesGuide";
import { TitleScreen } from "../../src/features/game/components/TitleScreen";
import { EDITIONS } from "../../src/features/editions/registry";
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

function mountGuide(overrides: Partial<RulesGuideProps> = {}): HTMLElement {
  mounted = mountReact(createElement(RulesGuide, { model, idPrefix: ID_PREFIX, ...overrides }));
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

  it("offers the coach replay only when the host supplies the game action", () => {
    const onReplayCoach = vi.fn();
    const container = mountGuide({ onReplayCoach, canReplayCoach: true });
    const replay = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "最初のガイドをもう一度見る");

    expect(replay).toBeDefined();
    expect(replay?.disabled).toBe(false);
    dispatchReactEvent(replay!, new MouseEvent("click", { bubbles: true }));
    expect(onReplayCoach).toHaveBeenCalledTimes(1);
  });

  it("disables coach replay when the host says a game surface owns the turn", () => {
    const container = mountGuide({ onReplayCoach: vi.fn(), canReplayCoach: false });
    const replay = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "最初のガイドをもう一度見る");

    expect(replay).toBeDefined();
    expect(replay?.disabled).toBe(true);
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
    expect(itemsText).toContain("不利なアイテムは持ち物には入らず、それぞれ決まったタイミングで自動で効きます。");
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

const RULES_BUTTON_NAME = "遊び方";
const BACK_BUTTON_NAME = "タイトルへ戻る";
const CREDITS_BUTTON_NAME = "クレジット";
const TITLE_RULES_ID_PREFIX = "title-rules";

function titleWithRules(rulesModel?: typeof model): MountedReact {
  return mountReact(createElement(TitleScreen, {
    manifest: null,
    network: null,
    display: EDITIONS[0]!.display,
    rulesModel,
    saveLookup: null,
    unavailableReason: null,
    notice: null,
    onNewGame: vi.fn(),
    onResume: vi.fn(),
    onDeleteSave: vi.fn(),
  }));
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === name)!;
}

function clickButton(container: HTMLElement, name: string): void {
  dispatchReactEvent(buttonNamed(container, name), new MouseEvent("click", { bubbles: true }));
}

describe("TitleScreen rules sub-screen", () => {
  it("title rules screen changes main naming and restores focus", () => {
    Element.prototype.scrollIntoView = vi.fn();
    scrollStubbed = true;
    mounted = titleWithRules(model);
    const { container } = mounted;

    clickButton(container, RULES_BUTTON_NAME);

    const heading = container.querySelector("h1#rules-title");
    expect(heading?.textContent).toBe(RULES_BUTTON_NAME);
    expect(document.activeElement).toBe(heading);
    expect(container.querySelector("main")?.getAttribute("aria-labelledby")).toBe("rules-title");
    expect(container.querySelector("#game-title")).toBeNull();
    const sections = [...container.querySelectorAll("section.rules-guide__section")];
    expect(sections.map((section) => section.id)).toEqual(SECTION_IDS.map((id) => `${TITLE_RULES_ID_PREFIX}-${id}`));
    expect(container.querySelector(".title-screen__rules-body .rules-guide")).not.toBeNull();
    expect(buttonNamed(container, "最初のガイドをもう一度見る")).toBeUndefined();

    clickButton(container, BACK_BUTTON_NAME);

    expect(container.querySelector("main")?.getAttribute("aria-labelledby")).toBe("game-title");
    // The title view remounts, so the opener is looked up again after returning.
    expect(document.activeElement).toBe(buttonNamed(container, RULES_BUTTON_NAME));
  });

  it("Escape returns from rules without opening credits", () => {
    mounted = titleWithRules(model);
    const { container } = mounted;
    clickButton(container, RULES_BUTTON_NAME);

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(container.querySelector("#rules-title")).toBeNull();
    expect(container.querySelector("#credits-title")).toBeNull();
    expect(container.querySelector("main")?.getAttribute("aria-labelledby")).toBe("game-title");
    expect(document.activeElement).toBe(buttonNamed(container, RULES_BUTTON_NAME));
    expect(document.activeElement).not.toBe(buttonNamed(container, CREDITS_BUTTON_NAME));
  });

  it("title without network renders rules without a target count", () => {
    mounted = titleWithRules(buildRulesGuide(EDITIONS[0]!.config));
    const { container } = mounted;

    clickButton(container, RULES_BUTTON_NAME);

    const goal = container.querySelector(`#${TITLE_RULES_ID_PREFIX}-goal`)?.textContent ?? "";
    expect(goal).toContain("すべての区間");
    expect(goal).not.toMatch(/全\d+区間/);
    expect(container.querySelectorAll("section.rules-guide__section")).toHaveLength(SECTION_IDS.length);
  });

  it("omits the rules button when no rules model is supplied", () => {
    mounted = titleWithRules(undefined);

    expect(buttonNamed(mounted.container, RULES_BUTTON_NAME)).toBeUndefined();
    expect(buttonNamed(mounted.container, CREDITS_BUTTON_NAME)).toBeDefined();
  });
});
