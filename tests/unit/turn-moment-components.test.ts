// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import type { ReactNode, RefObject } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GameHud, type GameHudProps } from "../../src/features/game/components/GameHud";
import { GamePanel, type GamePanelProps } from "../../src/features/game/components/GamePanel";
import { InventoryPanel } from "../../src/features/game/components/InventoryPanel";
import {
  chooseSettleMotion,
  chooseTurnMomentPlacement,
  TurnMomentHost,
  type PlacementRegion,
  type RectBox,
  type TurnMomentHostProps,
  type TurnMomentTargets,
} from "../../src/features/game/components/TurnMomentHost";
import { buildRailwayNetwork, createItemGame, platformPosition } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { createItemSession, itemSessionView, type ItemSessionView } from "../../src/features/game/itemSession";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay } from "../../src/features/game/turnMomentPresentation";
import { M_LINE, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";

const mounted: MountedReact[] = [];

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
});

afterEach(() => {
  mounted.splice(0).forEach((mount) => mount.cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function box(left: number, top: number, width: number, height: number): RectBox {
  return { left, top, width, height };
}

interface PlacementRow {
  readonly name: string;
  readonly viewport: RectBox | null;
  readonly map: RectBox | null;
  readonly panel: RectBox | null;
  readonly region: PlacementRegion;
  readonly rect: RectBox;
  readonly centerX: number;
  readonly centerY: number;
}

const PLACEMENT_ROWS: readonly PlacementRow[] = [
  {
    name: "desktop: full-screen map, panel bottom-right",
    viewport: box(0, 0, 1280, 800), map: box(0, 0, 1280, 800), panel: box(958, 100, 310, 680),
    region: "left", rect: box(0, 0, 958, 800), centerX: 479, centerY: 400,
  },
  {
    name: "phone: panel is a bottom sheet, free space above",
    viewport: box(0, 0, 390, 844), map: box(0, 0, 390, 844), panel: box(8, 456, 374, 380),
    region: "above", rect: box(0, 0, 390, 456), centerX: 195, centerY: 228,
  },
  {
    name: "short landscape: panel on the left side, free space beside it not above",
    viewport: box(0, 0, 800, 400), map: box(0, 0, 800, 400), panel: box(12, 92, 310, 280),
    region: "right", rect: box(322, 0, 478, 400), centerX: 561, centerY: 200,
  },
  {
    name: "long panel content: panel taller than half the viewport leaves the side",
    viewport: box(0, 0, 1280, 600), map: box(0, 0, 1280, 600), panel: box(12, 20, 310, 560),
    region: "right", rect: box(322, 0, 958, 600), centerX: 801, centerY: 300,
  },
  {
    name: "long panel content: tall bottom sheet leaves only the strip above",
    viewport: box(0, 0, 600, 800), map: box(0, 0, 600, 800), panel: box(0, 300, 600, 500),
    region: "above", rect: box(0, 0, 600, 300), centerX: 300, centerY: 150,
  },
  {
    name: "clipping: map and panel hanging off the viewport edges are clipped first",
    viewport: box(0, 0, 1000, 600), map: box(-100, -50, 1300, 800), panel: box(900, 400, 300, 300),
    region: "left", rect: box(0, 0, 900, 600), centerX: 450, centerY: 300,
  },
  {
    name: "clipping: the visible map is smaller than the viewport",
    viewport: box(0, 0, 1000, 600), map: box(100, 0, 800, 600), panel: box(100, 400, 800, 200),
    region: "above", rect: box(100, 0, 800, 400), centerX: 500, centerY: 200,
  },
  {
    name: "tie-break: four equal areas resolve to above",
    viewport: box(0, 0, 1000, 1000), map: box(0, 0, 1000, 1000), panel: box(400, 400, 200, 200),
    region: "above", rect: box(0, 0, 1000, 400), centerX: 500, centerY: 200,
  },
  {
    name: "tie-break: below beats left and right when above is smaller",
    viewport: box(0, 0, 1000, 1000), map: box(0, 0, 1000, 1000), panel: box(400, 200, 200, 400),
    region: "below", rect: box(0, 600, 1000, 400), centerX: 500, centerY: 800,
  },
  {
    name: "tie-break: left beats right when above and below are smaller",
    viewport: box(0, 0, 1000, 1000), map: box(0, 0, 1000, 1000), panel: box(400, 100, 200, 800),
    region: "left", rect: box(0, 0, 400, 1000), centerX: 200, centerY: 500,
  },
  {
    name: "missing panel: the whole clipped map",
    viewport: box(0, 0, 1000, 500), map: box(0, 0, 1000, 500), panel: null,
    region: "map", rect: box(0, 0, 1000, 500), centerX: 500, centerY: 250,
  },
  {
    name: "missing map: free space is computed inside the viewport",
    viewport: box(0, 0, 1000, 500), map: null, panel: box(0, 200, 400, 300),
    region: "right", rect: box(400, 0, 600, 500), centerX: 700, centerY: 250,
  },
  {
    name: "missing map and panel: the whole viewport",
    viewport: box(0, 0, 1000, 500), map: null, panel: null,
    region: "viewport", rect: box(0, 0, 1000, 500), centerX: 500, centerY: 250,
  },
  {
    name: "zero-area map falls back to the viewport",
    viewport: box(0, 0, 1000, 500), map: box(10, 10, 0, 300), panel: null,
    region: "viewport", rect: box(0, 0, 1000, 500), centerX: 500, centerY: 250,
  },
  {
    name: "zero-area panel is ignored",
    viewport: box(0, 0, 1000, 500), map: box(0, 0, 1000, 500), panel: box(100, 100, 300, 0),
    region: "map", rect: box(0, 0, 1000, 500), centerX: 500, centerY: 250,
  },
  {
    name: "negative-size and NaN rectangles are ignored",
    viewport: box(0, 0, 1000, 500), map: box(0, 0, -50, 500), panel: box(Number.NaN, 0, 300, 300),
    region: "viewport", rect: box(0, 0, 1000, 500), centerX: 500, centerY: 250,
  },
  {
    name: "off-viewport map falls back to the viewport",
    viewport: box(0, 0, 1000, 500), map: box(2000, 0, 800, 500), panel: null,
    region: "viewport", rect: box(0, 0, 1000, 500), centerX: 500, centerY: 250,
  },
  {
    name: "panel that does not overlap the map leaves the whole map",
    viewport: box(0, 0, 1000, 500), map: box(0, 0, 500, 500), panel: box(600, 0, 300, 500),
    region: "map", rect: box(0, 0, 500, 500), centerX: 250, centerY: 250,
  },
  {
    name: "panel covering the whole map falls back to the whole map",
    viewport: box(0, 0, 600, 800), map: box(0, 0, 600, 800), panel: box(0, 0, 600, 800),
    region: "map", rect: box(0, 0, 600, 800), centerX: 300, centerY: 400,
  },
  {
    name: "unusable viewport: an empty rectangle at the origin",
    viewport: box(0, 0, 0, 0), map: box(0, 0, 100, 100), panel: null,
    region: "viewport", rect: box(0, 0, 0, 0), centerX: 0, centerY: 0,
  },
  {
    name: "missing viewport: an empty rectangle at the origin",
    viewport: null, map: null, panel: null,
    region: "viewport", rect: box(0, 0, 0, 0), centerX: 0, centerY: 0,
  },
];

describe("chooseTurnMomentPlacement", () => {
  it.each(PLACEMENT_ROWS)("$name", ({ viewport, map, panel, region, rect, centerX, centerY }) => {
    const placement = chooseTurnMomentPlacement(viewport, map, panel);

    expect(placement.region).toBe(region);
    expect(placement.rect).toEqual(rect);
    expect(placement.centerX).toBe(centerX);
    expect(placement.centerY).toBe(centerY);
  });

  it.each(PLACEMENT_ROWS)("never returns NaN or negative sizes: $name", ({ viewport, map, panel }) => {
    const { rect, centerX, centerY } = chooseTurnMomentPlacement(viewport, map, panel);

    for (const value of [rect.left, rect.top, rect.width, rect.height, centerX, centerY]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
  });
});

describe("chooseSettleMotion", () => {
  const viewport: RectBox = box(0, 0, 1000, 800);
  const source: RectBox = box(100, 100, 40, 20);
  const fade = { kind: "fade", opacityFrom: 1, opacityTo: 0 };

  it("flies to a measured target by translate and scale", () => {
    expect(chooseSettleMotion(source, box(300, 500, 80, 40), viewport)).toEqual({
      kind: "flight", translateX: 220, translateY: 410, scaleX: 2, scaleY: 2, opacityFrom: 1, opacityTo: 0,
    });
  });

  it("still flies when the target is only partly visible", () => {
    expect(chooseSettleMotion(source, box(-20, 100, 50, 50), viewport)).toEqual({
      kind: "flight", translateX: -115, translateY: 15, scaleX: 1.25, scaleY: 2.5, opacityFrom: 1, opacityTo: 0,
    });
  });

  it.each([
    ["a missing target", null],
    ["an undefined target", undefined],
    ["a zero-width target", box(300, 500, 0, 40)],
    ["a zero-height target", box(300, 500, 80, 0)],
    ["a NaN target", box(Number.NaN, 500, 80, 40)],
    ["an off-viewport target (right)", box(1200, 100, 50, 50)],
    ["an off-viewport target (below)", box(100, 900, 50, 50)],
    ["an off-viewport target (left)", box(-200, 100, 50, 50)],
  ])("falls back to a local fade for %s", (_name, target) => {
    expect(chooseSettleMotion(source, target, viewport)).toEqual(fade);
  });

  it("falls back to a local fade when the source or viewport is unusable", () => {
    expect(chooseSettleMotion(box(100, 100, 0, 20), box(300, 500, 80, 40), viewport)).toEqual(fade);
    expect(chooseSettleMotion(null, box(300, 500, 80, 40), viewport)).toEqual(fade);
    expect(chooseSettleMotion(source, box(300, 500, 80, 40), box(0, 0, 0, 0))).toEqual(fade);
  });
});

/** Stable identity for lifecycle assertions: updates go through `mount.root.render(createElement(HostHarness, …))`. */
function HostHarness(props: TurnMomentHostProps): React.JSX.Element {
  return createElement(TurnMomentHost, props);
}

function sibling(): HTMLElement {
  const panel = document.createElement("main");
  panel.className = "game-panel";
  return panel;
}

function mountHost(props: TurnMomentHostProps): MountedReact {
  const mount = mountReact(createElement(HostHarness, props));
  mounted.push(mount);
  return mount;
}

function hostOf(mount: MountedReact): HTMLElement {
  return mount.container.querySelector<HTMLElement>(".turn-moment-host")!;
}

function cardOf(mount: MountedReact): HTMLElement | null {
  return mount.container.querySelector<HTMLElement>(".turn-moment-host__card");
}

const FOCUSABLE_SELECTOR: string = "button, a, input, select, textarea, [tabindex], [contenteditable], dialog, summary";
const CARD_CONTENT: ReactNode = createElement("span", { className: "moment-probe" }, "演出");

describe("css contract", () => {
  const css: string = readFileSync("src/styles.css", "utf8");

  function rule(selector: string): string {
    const escaped: string = selector.replace(/[.\\]/g, "\\$&");
    const match: RegExpMatchArray | null = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
    expect(match, `rule ${selector}`).not.toBeNull();
    return match![1]!;
  }

  it("keeps the moment layer between the panel and the screens", () => {
    expect(css).toContain("--layer-panel: 10;");
    expect(css).toContain("--layer-turn-moment: 15;");
    expect(css).toContain("--layer-screen: 20;");
    expect(css).toContain("--layer-map-error: 25;");
    expect(css).toContain("--layer-toast: 30;");
  });

  it("makes the host fixed and transparent to pointers", () => {
    const host: string = rule(".turn-moment-host");
    expect(host).toContain("position: fixed;");
    expect(host).toContain("inset: 0;");
    expect(host).toContain("pointer-events: none;");
    expect(host).toContain("z-index: var(--layer-turn-moment);");
    expect(rule(".turn-moment-host__region")).toContain("pointer-events: none;");
  });

  it("gives only the card pointer events and disables its motion under reduced motion", () => {
    expect(rule(".turn-moment-host__card")).toContain("pointer-events: auto;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.turn-moment-host__card \{\s*transition: none;/);
    expect(css.match(/pointer-events: auto/g)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("TurnMomentHost", () => {
  it("renders an aria-hidden host outside the game panel, with no card when there is nothing to show", () => {
    document.body.append(sibling());
    const mount = mountHost({});

    const host = hostOf(mount);
    expect(host.className).toBe("turn-moment-host");
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(host.closest(".game-panel")).toBeNull();
    expect(host.children).toHaveLength(0);
    expect(cardOf(mount)).toBeNull();

    act(() => mount.root.render(createElement(HostHarness, { children: false })));
    expect(cardOf(mount)).toBeNull();
    act(() => mount.root.render(createElement(HostHarness, { children: null })));
    expect(cardOf(mount)).toBeNull();
  });

  it("shows the card with no focusable descendants", () => {
    const mount = mountHost({ children: CARD_CONTENT });

    const host = hostOf(mount);
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".turn-moment-host__region .turn-moment-host__card .moment-probe")).not.toBeNull();
    expect(host.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0);
  });

  it("never calls focus() or showModal()", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const onTap = vi.fn();
    const mount = mountHost({ children: CARD_CONTENT, onTap });

    act(() => mount.root.render(createElement(HostHarness, { children: CARD_CONTENT, onTap })));
    dispatchReactEvent(cardOf(mount)!, new MouseEvent("click", { bubbles: true }));

    expect(focus).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
  });

  it("invokes onTap from the card only", () => {
    const onTap = vi.fn();
    const mount = mountHost({ children: CARD_CONTENT, onTap });

    dispatchReactEvent(hostOf(mount), new MouseEvent("click", { bubbles: true }));
    dispatchReactEvent(mount.container.querySelector(".turn-moment-host__region")!, new MouseEvent("click", { bubbles: true }));
    expect(onTap).not.toHaveBeenCalled();

    dispatchReactEvent(cardOf(mount)!, new MouseEvent("click", { bubbles: true }));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does nothing on tap when no handler is given", () => {
    const mount = mountHost({ children: CARD_CONTENT });

    expect(() => dispatchReactEvent(cardOf(mount)!, new MouseEvent("click", { bubbles: true }))).not.toThrow();
  });

  it.each(["pointerdown", "mousedown"])("prevents the default of %s so keyboard focus does not move", (type) => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const mount = mountHost({ children: CARD_CONTENT, onTap: vi.fn() });
    const event = new Event(type, { bubbles: true, cancelable: true });

    dispatchReactEvent(cardOf(mount)!, event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(outside);
  });
});

describe("TurnMomentHost placement and measurement", () => {
  let map: HTMLElement;
  let panel: HTMLElement;
  let mapRect: RectBox;
  let panelRect: RectBox;

  // Module-stable resolvers: a changed resolver identity would re-run the measurement effect.
  const resolveMap = (): Element | null => map;
  const resolvePanel = (): Element | null => panel;

  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    readonly observed: Element[] = [];
    disconnected = false;
    constructor(private readonly callback: () => void) { FakeResizeObserver.instances.push(this); }
    observe(target: Element): void { this.observed.push(target); }
    disconnect(): void { this.disconnected = true; }
    notify(): void { if (!this.disconnected) this.callback(); }
  }

  function defineRect(element: HTMLElement, read: () => RectBox): void {
    element.getBoundingClientRect = (): DOMRect => {
      const { left, top, width, height } = read();
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
    };
  }

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 800);
    map = document.createElement("div");
    panel = sibling();
    document.body.append(map, panel);
    mapRect = box(0, 0, 1280, 800);
    panelRect = box(958, 100, 310, 680);
    defineRect(map, () => mapRect);
    defineRect(panel, () => panelRect);
  });

  function regionOf(mount: MountedReact): HTMLElement {
    return mount.container.querySelector<HTMLElement>(".turn-moment-host__region")!;
  }

  it("places the region in the largest free rectangle and re-measures on resize", () => {
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });

    expect(regionOf(mount).dataset["region"]).toBe("left");
    expect(regionOf(mount).style.left).toBe("0px");
    expect(regionOf(mount).style.top).toBe("0px");
    expect(regionOf(mount).style.width).toBe("958px");
    expect(regionOf(mount).style.height).toBe("800px");

    panelRect = box(8, 456, 374, 380);
    mapRect = box(0, 0, 390, 844);
    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(regionOf(mount).dataset["region"]).toBe("above");
    expect(regionOf(mount).style.width).toBe("390px");
    expect(regionOf(mount).style.height).toBe("456px");
  });

  it("re-measures on scroll and when the map or panel resizes", () => {
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });

    panelRect = box(12, 92, 310, 280);
    act(() => { document.dispatchEvent(new Event("scroll")); });
    expect(regionOf(mount).dataset["region"]).toBe("right");
    expect(regionOf(mount).style.left).toBe("322px");
    expect(regionOf(mount).style.width).toBe("958px");

    panelRect = box(12, 20, 310, 560);
    mapRect = box(0, 0, 1280, 600);
    act(() => { FakeResizeObserver.instances.forEach((observer) => observer.notify()); });
    expect(regionOf(mount).dataset["region"]).toBe("right");
    expect(regionOf(mount).style.left).toBe("322px");
    expect(regionOf(mount).style.width).toBe("958px");
  });

  it("falls back to the viewport when the map and panel are missing", () => {
    const mount = mountHost({ children: CARD_CONTENT, resolveMap: () => null, resolvePanel: () => null });

    expect(regionOf(mount).dataset["region"]).toBe("viewport");
    expect(regionOf(mount).style.width).toBe("1280px");
    expect(regionOf(mount).style.height).toBe("800px");
  });

  it("observes the map and panel, and removes every listener and observer on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });

    const measureListeners = add.mock.calls.filter(([type]) => type === "resize" || type === "scroll");
    expect(measureListeners.map(([type]) => type).sort()).toEqual(["resize", "scroll"]);
    const scrollCall = measureListeners.find(([type]) => type === "scroll")!;
    expect(scrollCall[2]).toEqual({ capture: true, passive: true });
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]!.observed).toEqual([map, panel]);

    mount.cleanup();
    mounted.splice(mounted.indexOf(mount), 1);

    for (const [type, listener] of measureListeners) {
      expect(remove.mock.calls.some(([removedType, removed, options]) => removedType === type && removed === listener
        && (type !== "scroll" || (options as AddEventListenerOptions).capture === true))).toBe(true);
    }
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
  });

  it("registers nothing while there is no card and cleans up when the card disappears", () => {
    const add = vi.spyOn(window, "addEventListener");
    const mount = mountHost({ resolveMap, resolvePanel });

    expect(add.mock.calls.filter(([type]) => type === "resize" || type === "scroll")).toHaveLength(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);

    act(() => mount.root.render(createElement(HostHarness, { children: CARD_CONTENT, resolveMap, resolvePanel })));
    expect(FakeResizeObserver.instances).toHaveLength(1);
    act(() => mount.root.render(createElement(HostHarness, { resolveMap, resolvePanel })));

    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
    expect(cardOf(mount)).toBeNull();
  });

  it("never writes styles to the panel or the map", () => {
    const panelHtml: string = panel.outerHTML;
    const mapHtml: string = map.outerHTML;
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });

    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(panel.outerHTML).toBe(panelHtml);
    expect(map.outerHTML).toBe(mapHtml);
    expect(panel.hasAttribute("style")).toBe(false);
    expect(mount.container.querySelector(".game-panel")).toBeNull();
  });
});

function hudProps(overrides: Partial<GameHudProps> = {}): GameHudProps {
  return {
    title: "山手線すごろく", subtitle: "東京近郊版", headingRef: createRef<HTMLHeadingElement>(),
    station: "東京", ride: "山手線", lineBadge: { groupId: "jr-yamanote", code: "JY", color: "#80c241", name: "山手線", textColor: "#000000" },
    direction: "外回り", turn: 5, completed: 3, required: 30, compactRoll: "3マス", saveStatus: null,
    saveStatusMessage: "未保存", canRoll: true, canSkip: false, animating: false, draftSelected: false,
    rollButtonRef: createRef<HTMLButtonElement>(), onRoll: vi.fn(), onSkip: vi.fn(), effects: [], ...overrides,
  };
}

function HudHarness({ value }: { value: GameHudProps }): React.JSX.Element {
  return createElement(GameHud, value);
}

function mountHud(value: GameHudProps): MountedReact {
  const mount = mountReact(createElement(HudHarness, { value }));
  mounted.push(mount);
  return mount;
}

const RIDE_HTML: string = '<span class="hud-stat__value" data-stat="ride" title="山手線">山手線</span>';
const DIRECTION_HTML: string = '<span class="hud-stat__value" data-stat="direction" title="外回り">外回り</span>';

describe("GameHud target refs", () => {
  it("resolves the ride and direction targets to the existing value elements", () => {
    const rideTarget = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
    const received: (HTMLElement | null)[] = [];
    const mount = mountHud(hudProps({
      rideTargetRef: rideTarget,
      directionTargetRef: (element: HTMLElement | null) => { received.push(element); },
    }));

    expect(rideTarget.current).toBe(mount.container.querySelector('[data-stat="ride"]'));
    expect(received.at(-1)).toBe(mount.container.querySelector('[data-stat="direction"]'));

    mount.cleanup();
    mounted.splice(mounted.indexOf(mount), 1);
    expect(rideTarget.current).toBeNull();
    expect(received.at(-1)).toBeNull();
  });

  it("keeps the dt/dd, data-stat and value markup identical with and without targets", () => {
    const without = mountHud(hudProps());
    const rideTarget = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
    const directionTarget = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
    const withTargets = mountHud(hudProps({ rideTargetRef: rideTarget, directionTargetRef: directionTarget }));

    for (const mount of [without, withTargets]) {
      const terms = [...mount.container.querySelectorAll("dt")].map((term) => term.textContent);
      expect(terms).toEqual(["現在駅", "乗車中", "進行方向", "ターン数", "踏破区間", "出目"]);
      expect([...mount.container.querySelectorAll("[data-stat]")].map((stat) => stat.getAttribute("data-stat")))
        .toEqual(["station", "ride", "direction", "turn", "progress", "roll-compact"]);
      expect(mount.container.querySelector('[data-stat="ride"]')!.outerHTML).toBe(RIDE_HTML);
      expect(mount.container.querySelector('[data-stat="direction"]')!.outerHTML).toBe(DIRECTION_HTML);
      expect(mount.container.querySelectorAll("dd")).toHaveLength(6);
    }
    expect(withTargets.container.innerHTML).toBe(without.container.innerHTML);
  });
});

function inventoryView(inventory: ItemSessionView["inventory"]): ItemSessionView {
  return {
    phase: "idle",
    identity: { sessionId: 1, turn: 0, decisionRevision: 0 },
    inventory,
    position: { currentStationId: "station-a", currentServiceId: "line-a", direction: 1 },
    draft: { items: [] },
    usableItems: inventory.map((item) => ({
      instanceId: item.id, kind: item.kind, usable: item.kind !== "delay-certificate", reason: null, selected: false, recommended: false,
    })),
    hints: {
      routes: [],
      direction: { directions: [], closerDirection: null },
      rapidHeadsTowardYamanote: false,
      deadheadDestination: null,
      deadheadRecommended: false,
      suspensionIgnored: false,
      suspendedServiceIds: [],
    },
    decision: null,
    effects: { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false },
    events: [],
  } as unknown as ItemSessionView;
}

function InventoryHarness(props: React.ComponentProps<typeof InventoryPanel>): React.JSX.Element {
  return createElement(InventoryPanel, props);
}

function mountInventory(overrides: Partial<React.ComponentProps<typeof InventoryPanel>> = {}): MountedReact {
  const view = inventoryView([{ id: "double-1", kind: "double" }, { id: "rapid-1", kind: "rapid" }] as ItemSessionView["inventory"]);
  const mount = mountReact(createElement(InventoryHarness, {
    view, openItemId: null, onOpenItemChange: vi.fn(), onUse: vi.fn(), ...overrides,
  }));
  mounted.push(mount);
  return mount;
}

describe("InventoryPanel target refs", () => {
  it("resolves each slot by index and the header to the existing boxes", () => {
    const slotTargets = [0, 1, 2].map(() => createRef<HTMLElement>() as RefObject<HTMLElement | null>);
    const headerTarget = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
    const mount = mountInventory({ slotTargetRefs: slotTargets, headerTargetRef: headerTarget });

    const slots = [...mount.container.querySelectorAll(".item-inventory__slots > li")];
    expect(slots).toHaveLength(3);
    slotTargets.forEach((target, index) => expect(target.current).toBe(slots[index]));
    expect(slots[2]!.className).toBe("item-slot item-slot--empty");
    expect(headerTarget.current).toBe(mount.container.querySelector(".item-inventory__header"));

    mount.cleanup();
    mounted.splice(mounted.indexOf(mount), 1);
    expect(slotTargets.map((target) => target.current)).toEqual([null, null, null]);
    expect(headerTarget.current).toBeNull();
  });

  it("accepts a partial slot list and leaves the other slots untouched", () => {
    const only = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
    const mount = mountInventory({ slotTargetRefs: [null, only] });

    expect(only.current).toBe(mount.container.querySelectorAll(".item-inventory__slots > li")[1]);
  });

  it("renders the same literal slot and header markup with and without targets", () => {
    const without = mountInventory();
    const withTargets = mountInventory({
      slotTargetRefs: [0, 1, 2].map(() => createRef<HTMLElement>() as RefObject<HTMLElement | null>),
      headerTargetRef: createRef<HTMLElement>() as RefObject<HTMLElement | null>,
    });

    for (const mount of [without, withTargets]) {
      const slots = [...mount.container.querySelectorAll(".item-inventory__slots > li")];
      expect(slots.map((slot) => slot.classList.contains("item-slot--empty"))).toEqual([false, false, true]);
      expect(slots.map((slot) => slot.querySelectorAll("h3.visually-hidden").length)).toEqual([1, 1, 0]);
      expect(slots[2]!.outerHTML).toBe('<li class="item-slot item-slot--empty"><span class="item-slot__empty">空き枠</span></li>');
      const header = mount.container.querySelector(".item-inventory__header")!;
      expect(header.className).toBe("item-inventory__header");
      expect([...header.children].map((child) => child.tagName)).toEqual(["H2", "P"]);
      expect(header.querySelector("h2")!.textContent).toBe("アイテム（3枠）");
      expect(header.querySelector("p")!.textContent).toBe("持ち物");
      expect(mount.container.querySelectorAll("button.item-slot__button")).toHaveLength(2);
    }
  });
});

function panelValue(): GamePanelProps {
  const network = buildRailwayNetwork(multiServiceInput());
  const config = { ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy };
  const game = createItemGame(config, "turn-moment-components", network);
  const restored = {
    ...game, currentStationId: "b", currentServiceId: M_LINE, direction: 1 as const,
    inventory: [{ id: "choice-1", kind: "route-ticket" as const }],
  };
  const session = createItemSession(config, "turn-moment-components", network, 1, restored);
  const view = itemSessionView(session, network)!;
  const turnDisplay = deriveTurnMomentDisplay({
    session, network, presentation: createPresentationResolver(network),
    progress: {
      stationId: session.game.currentStationId,
      position: platformPosition(network, session.game.currentServiceId, session.game.currentStationId),
      completedSegmentIds: session.game.completedSegmentIds, stepsCompleted: 0,
    },
    attempt: null, revealStage: "done", restoredOrOmitted: true, itemView: view,
  });
  return {
    session, network, lines: [], turnDisplay, requiredCount: 4,
    saveStatus: "saved", follow: true, speedLabel: "標準", reducedMotion: false,
    onRoll: vi.fn(), onSkip: vi.fn(), onToggleFollow: vi.fn(), onCycleSpeed: vi.fn(), onNewGame: vi.fn(), onShowTitle: vi.fn(),
    onEditItemDraft: vi.fn(),
  };
}

function PanelHarness({ value }: { value: GamePanelProps }): React.JSX.Element {
  return createElement(GamePanel, value);
}

describe("GamePanel target ref threading", () => {
  it("threads ride, direction, slot and header targets to the HUD and inventory elements", () => {
    const refs = {
      ride: createRef<HTMLElement>() as RefObject<HTMLElement | null>,
      direction: createRef<HTMLElement>() as RefObject<HTMLElement | null>,
      slots: [0, 1, 2].map(() => createRef<HTMLElement>() as RefObject<HTMLElement | null>),
      inventoryHeader: createRef<HTMLElement>() as RefObject<HTMLElement | null>,
    };
    const turnMomentTargets: TurnMomentTargets = refs;
    const mount = mountReact(createElement(PanelHarness, { value: { ...panelValue(), turnMomentTargets } }));
    mounted.push(mount);

    expect(refs.ride.current).toBe(mount.container.querySelector('[data-stat="ride"]'));
    expect(refs.direction.current).toBe(mount.container.querySelector('[data-stat="direction"]'));
    const slots = [...mount.container.querySelectorAll(".item-inventory__slots > li")];
    expect(slots).toHaveLength(3);
    refs.slots.forEach((target, index) => expect(target.current).toBe(slots[index]));
    expect(refs.inventoryHeader.current).toBe(mount.container.querySelector(".item-inventory__header"));
    expect(mount.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("renders the same panel markup when no targets are given", () => {
    const value = panelValue();
    const without = mountReact(createElement(PanelHarness, { value }));
    mounted.push(without);
    const withEmpty = mountReact(createElement(PanelHarness, { value: { ...value, turnMomentTargets: {} } }));
    mounted.push(withEmpty);
    const withTargets = mountReact(createElement(PanelHarness, {
      value: { ...value, turnMomentTargets: { ride: createRef<HTMLElement>() as RefObject<HTMLElement | null> } },
    }));
    mounted.push(withTargets);

    expect(without.container.querySelectorAll(".game-panel__stats dt")).toHaveLength(6);
    expect(without.container.querySelectorAll(".item-inventory__slots > li")).toHaveLength(3);
    expect(without.container.querySelector('[data-stat="ride"]')!.hasAttribute("ref")).toBe(false);
    expect(withEmpty.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_")).toBe(without.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_"));
    expect(withTargets.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_")).toBe(without.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_"));
  });
});
