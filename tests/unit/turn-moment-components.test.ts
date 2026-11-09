// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import type { ReactNode, RefObject } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DICE_DELAY_STAMP_LABEL,
  DICE_TUMBLE_HOLD_FRACTION,
  DICE_TUMBLE_SETTLE_PERCENT,
  DiceTumble,
  diceFinalOrientation,
  dicePipCells,
  diceRawRollFor,
  diceStampLabels,
  diceTumbleModelFor,
  type DiceFace,
  type DiceTumbleModel,
  type DiceTumbleProps,
} from "../../src/features/game/components/DiceTumble";
import { LotteryReveal, type LotteryRevealProps } from "../../src/features/game/components/LotteryReveal";
import { ItemPickupMoment, type ItemPickupMomentProps } from "../../src/features/game/components/ItemPickupMoment";
import { GameHud, type GameHudProps } from "../../src/features/game/components/GameHud";
import { GamePanel, type GamePanelProps } from "../../src/features/game/components/GamePanel";
import { InventoryPanel } from "../../src/features/game/components/InventoryPanel";
import {
  chooseSettleMotion,
  chooseTurnMomentPlacement,
  MIN_CARD_REGION_PX,
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
import type { ItemDeadheadRecord, ItemEvent, ItemRideRecord } from "../../src/types/network";
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

function PickupHarness(props: ItemPickupMomentProps): React.JSX.Element {
  return createElement(ItemPickupMoment, props);
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
    expect(rule(".turn-moment-host")).not.toContain("pointer-events: auto;");
    expect(rule(".turn-moment-host__region")).not.toContain("pointer-events: auto;");
  });

  it("defines pickup flight and local-fade animations from the captured stage duration", () => {
    expect(rule(".item-pickup-moment")).toContain("animation: item-pickup-flight var(--pickup-ms)");
    expect(rule(".item-pickup-moment--fade")).toContain("animation-name: item-pickup-fade;");
    expect(css).toContain("@keyframes item-pickup-flight");
    expect(css).toContain("@keyframes item-pickup-fade");
  });
});

describe("ItemPickupMoment", () => {
  function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  }

  it("flies the item icon from the supplied map centre to a measured target", () => {
    const target = document.createElement("div");
    target.getBoundingClientRect = () => rect(300, 500, 60, 40);
    const targetRef = { current: target } as RefObject<HTMLElement | null>;
    const mount = mountReact(createElement(PickupHarness, { kind: "rapid", durationMs: 500, centerX: 500, centerY: 250, targetRef }));
    mounted.push(mount);

    const moment = mount.container.querySelector<HTMLElement>('[data-stage="pickup"]')!;
    expect(moment.dataset["motion"]).toBe("flight");
    expect(moment.style.left).toBe("476px");
    expect(moment.style.top).toBe("226px");
    expect(moment.style.getPropertyValue("--pickup-ms")).toBe("500ms");
    expect(moment.style.getPropertyValue("--pickup-x")).toBe("-170px");
    expect(moment.style.getPropertyValue("--pickup-y")).toBe("270px");
    expect(moment.style.getPropertyValue("--pickup-sx")).toBe("0.5");
    expect(moment.style.getPropertyValue("--pickup-sy")).toBe("0.5");
    expect(moment.querySelector("svg")).not.toBeNull();
    expect(moment.querySelector("button, a, input, [tabindex]")).toBeNull();
  });

  it.each(["missing", "zero-size"] as const)("uses the local fade with the same deadline for a %s target", (targetCase) => {
    const target = document.createElement("div");
    target.getBoundingClientRect = () => rect(300, 500, targetCase === "missing" ? 60 : 0, 40);
    const targetRef = targetCase === "missing" ? null : { current: target } as RefObject<HTMLElement | null>;
    const mount = mountReact(createElement(PickupHarness, { kind: "rapid", durationMs: 333, centerX: 500, centerY: 250, targetRef }));
    mounted.push(mount);

    const moment = mount.container.querySelector<HTMLElement>('[data-stage="pickup"]')!;
    expect(moment.dataset["motion"]).toBe("fade");
    expect(moment.style.getPropertyValue("--pickup-ms")).toBe("333ms");
  });
});

describe("TurnMomentHost", () => {
  it.each([0, ""])("keeps %j as card content", (children) => {
    const mount = mountHost({ children });
    expect(cardOf(mount)).not.toBeNull();
    expect(cardOf(mount)!.textContent).toBe(String(children));
  });

  it("renders an aria-hidden host outside the game panel, with no card when there is nothing to show", () => {
    const panel: HTMLElement = sibling();
    document.body.append(panel);
    const mount = mountHost({ children: CARD_CONTENT });
    expect(cardOf(mount)).not.toBeNull();
    expect(panel.isConnected).toBe(true);
    expect(panel.contains(hostOf(mount))).toBe(false);
    act(() => mount.root.render(createElement(HostHarness, {})));

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

  it("renders a decorative pickup flight in the map-centred card and maps its tap to shared Skip", () => {
    const target = document.createElement("div");
    target.getBoundingClientRect = () => ({ left: 300, top: 500, width: 60, height: 40, right: 360, bottom: 540,
      x: 300, y: 500, toJSON: () => ({}) });
    const targetRef = { current: target } as RefObject<HTMLElement | null>;
    const onTap = vi.fn();
    const mount = mountHost({ pickup: { kind: "rapid", durationMs: 500, targetRef }, onTap });
    const host = hostOf(mount);
    const pickup = host.querySelector<HTMLElement>('[data-stage="pickup"]')!;

    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0);
    expect(pickup.dataset["motion"]).toBe("flight");
    expect(pickup.closest(".turn-moment-host__card")?.classList).toContain("turn-moment-host__card--pickup");
    act(() => pickup.click());
    expect(onTap).toHaveBeenCalledTimes(1);
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
    expect(document.activeElement).toBe(outside);
    const onTap = vi.fn();
    const mount = mountHost({ children: CARD_CONTENT, onTap });
    const event = new Event(type, { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");

    dispatchReactEvent(cardOf(mount)!, event);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    expect(onTap).not.toHaveBeenCalled();
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

  function addControl(className: string, rect: RectBox): void {
    const control: HTMLElement = document.createElement("div");
    control.className = className;
    defineRect(control, () => rect);
    document.body.append(control);
  }

  it.each([560, 448])("keeps the measured-control minimum at 640x400 when the control starts at %i", (controlLeft) => {
    vi.stubGlobal("innerWidth", 640);
    vi.stubGlobal("innerHeight", 400);
    mapRect = box(0, 0, 640, 400);
    panelRect = box(12, 92, 440, 300);
    // 560 leaves only 104px under round 1; 448 exhausts the entire chosen strip's width.
    addControl("map-overview", box(controlLeft, 156, 630 - controlLeft, 92));
    addControl("maplibregl-ctrl-top-right", box(0, 0, 0, 0));
    const zoom: HTMLElement = document.createElement("div");
    zoom.className = "maplibregl-ctrl-group";
    defineRect(zoom, () => box(600, 10, 30, 90));
    document.querySelector(".maplibregl-ctrl-top-right")!.append(zoom);
    addControl("maplibregl-ctrl-attrib", box(10, 10, 44, 44));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement): DOMRect {
      const scale: number = Number(this.style.scale) || 1;
      const width: number = 188 * scale;
      const height: number = 197.15625 * scale;
      return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };
    });
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });
    const region: HTMLElement = regionOf(mount);

    expect(region.style.left).toBe("452px");
    expect(region.style.top).toBe("252px");
    expect(region.style.width).toBe("188px");
    expect(region.style.height).toBe("148px");
    expect(region.style.padding).toBe("0px");
    const scale: number = Number(cardOf(mount)!.style.scale);
    expect(scale).toBeCloseTo(147 / 197.15625);
    expect(188 * scale).toBeGreaterThanOrEqual(MIN_CARD_REGION_PX);
    expect(197.15625 * scale).toBeLessThanOrEqual(148);

    mount.cleanup();
    mounted.splice(mounted.indexOf(mount), 1);
    expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
  });

  it("omits the decorative card explicitly when measured controls leave no minimum-sized strip", () => {
    vi.stubGlobal("innerWidth", 640);
    vi.stubGlobal("innerHeight", 400);
    mapRect = box(0, 0, 640, 400);
    panelRect = box(12, 92, 440, 300);
    addControl("map-overview", box(452, 0, 188, 400));
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });

    expect(mount.container.querySelector(".turn-moment-host")).not.toBeNull();
    expect(regionOf(mount)).toBeNull();
    expect(cardOf(mount)).toBeNull();
  });

  it("also excludes measured attribution from the alternate strip", () => {
    vi.stubGlobal("innerWidth", 640);
    vi.stubGlobal("innerHeight", 400);
    mapRect = box(0, 0, 640, 400);
    panelRect = box(12, 92, 440, 300);
    addControl("map-overview", box(560, 156, 70, 92));
    const zoomHost: HTMLElement = document.createElement("div");
    zoomHost.className = "maplibregl-ctrl-top-right";
    const zoom: HTMLElement = document.createElement("div");
    zoom.className = "maplibregl-ctrl-group";
    defineRect(zoom, () => box(600, 10, 30, 90));
    zoomHost.append(zoom);
    document.body.append(zoomHost);
    addControl("maplibregl-ctrl-attrib", box(452, 380, 188, 20));
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });

    expect(regionOf(mount).style.top).toBe("252px");
    expect(regionOf(mount).style.height).toBe("124px");
    expect(regionOf(mount).style.width).toBe("188px");
  });

  it.each([
    { width: 1280, height: 800, panel: box(12, 100, 310, 680), region: [322, 0, 958, 800], padding: "56px 84px 56px 0px" },
    { width: 412, height: 839, panel: box(8, 453.453125, 396, 373.546875), region: [0, 0, 412, 453.453125], padding: "56px 84px 0px 56px" },
  ])("preserves the usual measured-control geometry at $width x $height", ({ width, height, panel: measuredPanel, region, padding }) => {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("innerHeight", height);
    mapRect = box(0, 0, width, height);
    panelRect = measuredPanel;
    addControl("map-overview", box(width - 80, 156, 70, 92));
    addControl("maplibregl-ctrl-attrib", box(10, 10, 44, 44));
    const mount = mountHost({ children: CARD_CONTENT, resolveMap, resolvePanel });
    const actual: HTMLElement = regionOf(mount);

    expect([actual.style.left, actual.style.top, actual.style.width, actual.style.height]).toEqual(region.map((value) => `${value}px`));
    expect(actual.style.padding).toBe(padding);
    expect(cardOf(mount)!.style.scale).toBe("");
    expect(cardOf(mount)!.style.width).toBe("");
  });

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
    autoRollEnabled: false, onToggleAutoRoll: vi.fn(),
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

  it("keeps memoised target callback refs attached across inventory rerenders", () => {
    const view = inventoryView([{ id: "double-1", kind: "double" }] as ItemSessionView["inventory"]);
    const slotCalls: (HTMLElement | null)[] = [];
    const headerCalls: (HTMLElement | null)[] = [];
    const slotTarget = (element: HTMLElement | null): void => { slotCalls.push(element); };
    const headerTarget = (element: HTMLElement | null): void => { headerCalls.push(element); };
    const slotTargetRefs = [slotTarget];
    const props = { view, openItemId: null, onOpenItemChange: vi.fn(), onUse: vi.fn(), slotTargetRefs,
      headerTargetRef: headerTarget } satisfies React.ComponentProps<typeof InventoryPanel>;
    const mount = mountReact(createElement(InventoryHarness, props));
    mounted.push(mount);
    expect(slotCalls.at(-1)).toBe(mount.container.querySelector(".item-inventory__slots > li"));
    expect(headerCalls.at(-1)).toBe(mount.container.querySelector(".item-inventory__header"));

    slotCalls.length = 0;
    headerCalls.length = 0;
    act(() => mount.root.render(createElement(InventoryHarness, { ...props,
      view: { ...view, identity: { ...view.identity, turn: view.identity.turn + 1 } } })));
    expect(slotCalls).toEqual([]);
    expect(headerCalls).toEqual([]);
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
    saveStatus: "saved", follow: true, speedLabel: "標準", presentationLevel: "all" as const, onCyclePresentation: vi.fn(), reducedMotion: false,
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
    expect(without.container.querySelector('[data-stat="ride"]')!.outerHTML).toBe('<span class="hud-stat__value" data-stat="ride" title="m-line">m-line</span>');
    expect(withTargets.container.querySelector('[data-stat="ride"]')!.outerHTML).toBe('<span class="hud-stat__value" data-stat="ride" title="m-line">m-line</span>');
    expect(withEmpty.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_")).toBe(without.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_"));
    expect(withTargets.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_")).toBe(without.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_ID_"));
  });
});

function rideRecord(overrides: Partial<ItemRideRecord> = {}): ItemRideRecord {
  return {
    kind: "item-ride", turn: 1, fromStationId: "a", toStationId: "b", command: { items: [] },
    traversedSegmentIds: [], landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: { serviceId: "line-a", direction: 1 }, rawRoll: 3, effectiveFace: 3, adjustment: null,
    movementMode: "normal", pips: 3, hopBudget: 3, physicalHops: 3, unusedPips: 0, stopReason: "roll", ...overrides,
  };
}

function deadheadRecord(): ItemDeadheadRecord {
  return {
    kind: "deadhead", turn: 1, fromStationId: "a", toStationId: "b", command: { items: [] },
    traversedSegmentIds: [], landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: null, rawRoll: null, effectiveFace: null, adjustment: null, movementMode: "deadhead",
    pips: null, hopBudget: null, physicalHops: 0, unusedPips: null, stopReason: "relocation",
    relocation: { fromStationId: "a", toStationId: "b", serviceId: "line-a", direction: 1, distance: 2 },
  };
}

const DELAY_EVENT: ItemEvent = { type: "effect-activated", effect: "delay" };
const OVERSLEEP_EVENT: ItemEvent = { type: "effect-activated", effect: "oversleep" };
const DOUBLE_COMMAND: ItemRideRecord["command"] = { items: [{ kind: "double", instanceId: "double-1" }] };

function modelOf(overrides: Partial<DiceTumbleModel> = {}): DiceTumbleModel {
  return { stage: "tumble", rawRoll: 4, stampLabels: [], stageMs: 600, reducedMotion: false, ...overrides };
}

/** Stable identity for lifecycle assertions: updates go through `mount.root.render(createElement(DiceHarness, …))`. */
function DiceHarness(props: DiceTumbleProps): React.JSX.Element {
  return createElement(DiceTumble, props);
}

function mountDice(model: DiceTumbleModel): MountedReact {
  const mount = mountReact(createElement(DiceHarness, { model }));
  mounted.push(mount);
  return mount;
}

function diceRoot(mount: MountedReact): HTMLElement | null {
  return mount.container.querySelector<HTMLElement>(".dice-tumble");
}

function stampTexts(mount: MountedReact): string[] {
  return [...mount.container.querySelectorAll(".dice-tumble__stamp")].map((stamp) => stamp.textContent ?? "");
}

interface OrientationRow {
  readonly roll: DiceFace;
  readonly xDeg: number;
  readonly yDeg: number;
}

const ORIENTATION_ROWS: readonly OrientationRow[] = [
  { roll: 1, xDeg: 0, yDeg: 0 },
  { roll: 2, xDeg: 0, yDeg: -90 },
  { roll: 3, xDeg: -90, yDeg: 0 },
  { roll: 4, xDeg: 90, yDeg: 0 },
  { roll: 5, xDeg: 0, yDeg: 90 },
  { roll: 6, xDeg: 0, yDeg: 180 },
];

describe("diceFinalOrientation", () => {
  it.each(ORIENTATION_ROWS)("raw roll $roll lands on rotateX($xDeg) rotateY($yDeg)", ({ roll, xDeg, yDeg }) => {
    expect(diceFinalOrientation(roll)).toEqual({ xDeg, yDeg });
  });

  it.each(ORIENTATION_ROWS)("raw roll $roll shows that number on the front face with the matching pips", ({ roll, xDeg, yDeg }) => {
    const mount = mountDice(modelOf({ rawRoll: roll }));

    const root = diceRoot(mount)!;
    expect(root.dataset["rawRoll"]).toBe(String(roll));
    expect(root.style.getPropertyValue("--dice-final-x")).toBe(`${xDeg}deg`);
    expect(root.style.getPropertyValue("--dice-final-y")).toBe(`${yDeg}deg`);
    const finals = root.querySelectorAll(".dice-tumble__face--final");
    expect(finals).toHaveLength(1);
    expect((finals[0] as HTMLElement).dataset["face"]).toBe(String(roll));
    expect(finals[0]!.querySelectorAll(".dice-tumble__pip")).toHaveLength(roll);
  });

  it("renders six fixed faces whose opposite faces sum to 7 and whose pips match their number", () => {
    const mount = mountDice(modelOf());

    const faces = [...mount.container.querySelectorAll<HTMLElement>(".dice-tumble__face")];
    expect(faces.map((face) => face.dataset["face"])).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(faces.map((face) => face.querySelectorAll(".dice-tumble__pip").length)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dicePipCells(6)).toEqual([1, 3, 4, 6, 7, 9]);
    expect(dicePipCells(5)).toEqual([1, 3, 5, 7, 9]);
  });

  it("uses the inverse of each face placement in styles.css", () => {
    const css: string = readFileSync("src/styles.css", "utf8");
    const normalize = (degrees: number): number => ((degrees % 360) + 360) % 360;

    for (const { roll, xDeg, yDeg } of ORIENTATION_ROWS) {
      const placement: string = css.match(new RegExp(`\\.dice-tumble__face\\[data-face="${roll}"\\] \\{ transform: ([^;]*);`))![1]!;
      const placedX: number = Number(placement.match(/rotateX\((-?\d+)deg\)/)?.[1] ?? 0);
      const placedY: number = Number(placement.match(/rotateY\((-?\d+)deg\)/)?.[1] ?? 0);
      expect(normalize(xDeg), `face ${roll} x`).toBe(normalize(0 - placedX));
      expect(normalize(yDeg), `face ${roll} y`).toBe(normalize(0 - placedY));
    }
  });
});

describe("diceRawRollFor", () => {
  it("lands on the saved raw roll, never the effective face", () => {
    const forced = rideRecord({ rawRoll: 4, effectiveFace: 1, pips: 1, hopBudget: 1 });
    const adjusted = rideRecord({
      rawRoll: 2, effectiveFace: 3, adjustment: { instanceId: "adjust-1", delta: 1 },
    });

    expect(diceRawRollFor(forced)).toBe(4);
    expect(diceRawRollFor(adjusted)).toBe(2);
    expect(diceTumbleModelFor(forced, "tumble", 600, false).rawRoll).toBe(4);
    expect(diceTumbleModelFor(adjusted, "stamps", 240, false).rawRoll).toBe(2);
  });

  it.each([[null], [undefined], [deadheadRecord()]])("has no die for %j", (record) => {
    expect(diceRawRollFor(record)).toBeNull();
  });
});

describe("diceStampLabels", () => {
  interface LabelRow {
    readonly name: string;
    readonly record: ItemRideRecord;
    readonly labels: readonly string[];
  }

  const LABEL_ROWS: readonly LabelRow[] = [
    { name: "plain ride", record: rideRecord(), labels: [] },
    { name: "double", record: rideRecord({ command: DOUBLE_COMMAND, rawRoll: 2, effectiveFace: 2, pips: 4 }), labels: ["×2"] },
    {
      name: "adjustment +1",
      record: rideRecord({ rawRoll: 3, effectiveFace: 4, adjustment: { instanceId: "adjust-1", delta: 1 } }),
      labels: ["調整+1"],
    },
    {
      name: "adjustment -1",
      record: rideRecord({ rawRoll: 3, effectiveFace: 2, adjustment: { instanceId: "adjust-1", delta: -1 } }),
      labels: ["調整-1"],
    },
    { name: "rapid", record: rideRecord({ movementMode: "rapid", hopBudget: 3 }), labels: ["快速"] },
    {
      name: "oversleep",
      record: rideRecord({ movementMode: "oversleep", itemEvents: [OVERSLEEP_EVENT] }),
      labels: ["寝過ごし"],
    },
    {
      name: "delay forcing the face to 1",
      record: rideRecord({ rawRoll: 4, effectiveFace: 1, pips: 1, hopBudget: 1, itemEvents: [DELAY_EVENT] }),
      labels: ["遅延"],
    },
    {
      name: "delay forced face without an event",
      record: rideRecord({ rawRoll: 4, effectiveFace: 1, pips: 1, hopBudget: 1 }),
      labels: ["遅延"],
    },
    {
      name: "delay activated on a raw 1 (event only)",
      record: rideRecord({ rawRoll: 1, effectiveFace: 1, pips: 1, hopBudget: 1, itemEvents: [DELAY_EVENT] }),
      labels: ["遅延"],
    },
    {
      name: "double together with a delay on a raw 1",
      record: rideRecord({ rawRoll: 1, effectiveFace: 1, command: DOUBLE_COMMAND, itemEvents: [DELAY_EVENT] }),
      labels: ["×2", "遅延"],
    },
    {
      name: "rapid together with a forced face has no duplicate delay stamp",
      record: rideRecord({ movementMode: "rapid", rawRoll: 4, effectiveFace: 1, itemEvents: [DELAY_EVENT] }),
      labels: ["快速", "遅延"],
    },
    {
      name: "a non-delay effect event on a raw 1 adds nothing",
      record: rideRecord({ rawRoll: 1, effectiveFace: 1, itemEvents: [{ type: "effect-activated", effect: "detour" }] }),
      labels: [],
    },
  ];

  it.each(LABEL_ROWS)("$name", ({ record, labels }) => {
    expect(diceStampLabels(record)).toEqual(labels);
  });

  it("keeps the delay label equal to the wording helper's forced-face wording", () => {
    expect(DICE_DELAY_STAMP_LABEL).toBe("遅延");
    expect(diceStampLabels(rideRecord({ rawRoll: 5, effectiveFace: 1 }))).toEqual([DICE_DELAY_STAMP_LABEL]);
  });

  it("has no stamps for deadhead, a missing record, or nothing", () => {
    expect(diceStampLabels(deadheadRecord())).toEqual([]);
    expect(diceStampLabels(null)).toEqual([]);
    expect(diceStampLabels(undefined)).toEqual([]);
  });
});

describe("DiceTumble stages", () => {
  it("shows no stamps during the tumble even when labels are given", () => {
    const mount = mountDice(modelOf({ stage: "tumble", stampLabels: ["×2"] }));

    expect(diceRoot(mount)!.dataset["stage"]).toBe("tumble");
    expect(diceRoot(mount)!.className).toBe("dice-tumble dice-tumble--tumble");
    expect(stampTexts(mount)).toEqual([]);
  });

  it("shows each stamp label once during the stamps stage, with the cube at its final pose", () => {
    const mount = mountDice(modelOf({ stage: "stamps", stampLabels: ["×2", "遅延"], stageMs: 240 }));

    expect(diceRoot(mount)!.className).toBe("dice-tumble dice-tumble--stamps");
    expect(stampTexts(mount)).toEqual(["×2", "遅延"]);
    expect(mount.container.querySelectorAll(".dice-tumble__face--final")).toHaveLength(1);
  });

  it("renders the cube without a stamp row when the stamps stage has no labels", () => {
    const mount = mountDice(modelOf({ stage: "stamps", stampLabels: [] }));

    expect(diceRoot(mount)).not.toBeNull();
    expect(mount.container.querySelector(".dice-tumble__stamps")).toBeNull();
  });

  it.each([
    ["deadhead", diceTumbleModelFor(deadheadRecord(), "stamps", 240, false)],
    ["a missing raw roll while stamping", modelOf({ stage: "stamps", rawRoll: null, stampLabels: ["×2"] })],
    ["a missing raw roll while tumbling", modelOf({ stage: "tumble", rawRoll: null })],
    ["an out-of-range raw roll", modelOf({ rawRoll: 7 })],
    ["a fractional raw roll", modelOf({ rawRoll: 2.5 })],
  ])("renders nothing for %s", (_name, model) => {
    const mount = mountDice(model);

    expect(mount.container.childElementCount).toBe(0);
  });

  it.each([
    [800, "800ms"], [600, "600ms"], [400, "400ms"], [240, "240ms"], [160, "160ms"],
    [0, "0ms"], [-5, "0ms"], [Number.NaN, "0ms"], [Number.POSITIVE_INFINITY, "0ms"],
  ])("sets --dice-stage-ms for a %s ms stage to %s", (stageMs, literal) => {
    const mount = mountDice(modelOf({ stageMs }));

    expect(diceRoot(mount)!.style.getPropertyValue("--dice-stage-ms")).toBe(literal);
  });

  it("marks the reduced-motion flag as a modifier class", () => {
    const mount = mountDice(modelOf({ reducedMotion: true }));

    expect(diceRoot(mount)!.className).toBe("dice-tumble dice-tumble--tumble dice-tumble--reduced");
  });

  it("updates in place when the stage changes", () => {
    const mount = mountDice(modelOf());
    const root = diceRoot(mount)!;

    act(() => mount.root.render(createElement(DiceHarness, { model: modelOf({ stage: "stamps", stampLabels: ["快速"], stageMs: 240 }) })));

    expect(diceRoot(mount)).toBe(root);
    expect(stampTexts(mount)).toEqual(["快速"]);
    expect(root.style.getPropertyValue("--dice-stage-ms")).toBe("240ms");
  });
});

describe("DiceTumble independence from timers and animation events", () => {
  const source: string = readFileSync("src/features/game/components/DiceTumble.tsx", "utf8");

  it("uses no presentation randomness, timers or animation-end hooks in its source", () => {
    expect(source).not.toContain("Math.random");
    expect(source).not.toMatch(/animationend|transitionend|onAnimationEnd|onTransitionEnd/i);
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|useEffect|useLayoutEffect/);
  });

  it("registers no animationend or transitionend listener and draws no random number while rendering", () => {
    const mount = mountDice(modelOf({ rawRoll: null }));
    const add = vi.spyOn(EventTarget.prototype, "addEventListener");
    const random = vi.spyOn(Math, "random");

    act(() => mount.root.render(createElement(DiceHarness, { model: modelOf({ stage: "tumble" }) })));
    act(() => mount.root.render(createElement(DiceHarness, { model: modelOf({ stage: "stamps", stampLabels: ["×2"], stageMs: 240 }) })));

    const types: string[] = add.mock.calls.map(([type]) => type);
    expect(types).not.toContain("animationend");
    expect(types).not.toContain("transitionend");
    expect(random).not.toHaveBeenCalled();
    expect(diceRoot(mount)).not.toBeNull();
  });
});

describe("DiceTumble decorative accessibility", () => {
  it.each(["tumble", "stamps"] as const)("is aria-hidden with no focusable descendants or live region in the %s stage", (stage) => {
    const mount = mountDice(modelOf({ stage, stampLabels: ["×2", "遅延"] }));

    const root = diceRoot(mount)!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0);
    expect(root.querySelectorAll("[role], [aria-live], [aria-label], [aria-labelledby]")).toHaveLength(0);
  });

  it("has no text on the faces, so nothing repeats the panel announcement", () => {
    const mount = mountDice(modelOf({ stage: "tumble", rawRoll: 5 }));

    expect(diceRoot(mount)!.textContent).toBe("");
  });
});

describe("dice css contract", () => {
  const css: string = readFileSync("src/styles.css", "utf8");

  function block(selector: string): string {
    const start: number = css.indexOf(`${selector} {`);
    expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("\n}", start));
  }

  it("builds a pseudo-3D cube from six absolutely placed faces", () => {
    expect(block(".dice-tumble__cube")).toContain("transform-style: preserve-3d;");
    expect(block(".dice-tumble__cube")).toContain("transform: rotateX(var(--dice-final-x, 0deg)) rotateY(var(--dice-final-y, 0deg));");
    expect(block(".dice-tumble__scene")).toContain("perspective: 480px;");
    expect(block(".dice-tumble__face")).toContain("position: absolute;");
    expect(css.match(/\.dice-tumble__face\[data-face="[1-6]"\] \{ transform: /g)).toHaveLength(6);
  });

  it("derives both animation durations from the stage custom property and adds no delay", () => {
    expect(css).toContain("animation: dice-tumble-spin var(--dice-stage-ms, 600ms) cubic-bezier(0.22, 0.61, 0.36, 1) both;");
    expect(css).toContain("animation: dice-stamp-in var(--dice-stage-ms, 240ms) ease-out both;");
    expect(css).not.toContain("animation-delay");
  });

  it("reaches the final pose at the settle percentage and holds it for the rest of the same duration", () => {
    expect(DICE_TUMBLE_SETTLE_PERCENT).toBe(75);
    expect(DICE_TUMBLE_HOLD_FRACTION).toBe(0.25);
    expect(DICE_TUMBLE_SETTLE_PERCENT / 100 + DICE_TUMBLE_HOLD_FRACTION).toBe(1);
    const keyframes: string = block("@keyframes dice-tumble-spin");
    expect(keyframes).toContain("75%, 100% { transform: rotateX(var(--dice-final-x, 0deg)) rotateY(var(--dice-final-y, 0deg)); }");
    expect(keyframes).toMatch(/0% \{ transform: rotateX\(calc\(var\(--dice-final-x, 0deg\) - 720deg\)\)/);
  });

  it("animates only transform and opacity", () => {
    const frames: string = `${block("@keyframes dice-tumble-spin")}${block("@keyframes dice-stamp-in")}`;
    const properties: string[] = [...frames.matchAll(/\{\s*([a-z-]+):/g)].map((match) => match[1]!);
    expect(new Set(properties)).toEqual(new Set(["transform", "opacity"]));
  });

  it("falls back to a flat final face when 3D transforms are unsupported", () => {
    const fallback: string = block("@supports not (transform-style: preserve-3d)");
    expect(fallback).toContain("transform: none;");
    expect(fallback).toContain("animation: none;");
    expect(fallback).toMatch(/\.dice-tumble__face\[data-face\] \{\s*transform: none;\s*display: none;/);
    expect(fallback).toMatch(/\.dice-tumble__face--final\[data-face\] \{\s*display: grid;/);
  });

  it("shows the end state without animation under the reduced-motion flag and the system preference", () => {
    expect(css).toMatch(/\.dice-tumble--reduced \.dice-tumble__cube,\s*\.dice-tumble--reduced \.dice-tumble__stamp \{\s*animation: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.dice-tumble \.dice-tumble__cube,\s*\.dice-tumble \.dice-tumble__stamp \{\s*animation: none;/);
  });

  it("places the dice rules after the first reduced-motion block that ui-contrast reads", () => {
    expect(css.indexOf("@media (prefers-reduced-motion: reduce)")).toBeLessThan(css.indexOf(".dice-tumble {"));
  });

  it("keeps the base rules at the final state so a missing animation changes nothing", () => {
    expect(block(".dice-tumble__stamp")).toContain("transform: rotate(var(--dice-stamp-tilt));");
    expect(block(".dice-tumble__stamp")).not.toContain("opacity");
  });

  it("uses colour tokens only inside the dice rules", () => {
    const dice: string = css.slice(css.indexOf(".dice-tumble {"), css.indexOf("@supports not (transform-style"));
    expect(dice).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
});

// S14: the decorative board uses the saved candidates, never a new draw.

function LotteryHarness(props: LotteryRevealProps): React.JSX.Element {
  return createElement(LotteryReveal, props);
}

describe("S14 LotteryReveal", () => {
  it.each([[true, false], [false, true], [true, true], [false, false]])("flips only drawn rows (service %s, direction %s) and stops on saved values", (serviceDrawRequired, directionDrawRequired) => {
    const network = buildRailwayNetwork(multiServiceInput());
    const ids = [...network.servicesById.keys()];
    const props: LotteryRevealProps = { network, presentation: createPresentationResolver(network), stage: "lottery-flip", durationMs: 1600,
      landing: { type: "landing-resolved", stationId: "a", serviceId: ids[0]!, direction: 1,
        serviceCandidates: ids, directionCandidates: [1, -1], serviceDrawRequired, directionDrawRequired, changedService: false },
      rideTarget: createRef<HTMLElement>(), directionTarget: createRef<HTMLElement>(),
    };
    const mount = mountReact(createElement(LotteryHarness, props)); mounted.push(mount);
    const rows = [...mount.container.querySelectorAll(".lottery-reveal__row")];
    expect(rows.map((row) => row.classList.contains("lottery-reveal__row--flipping"))).toEqual([serviceDrawRequired, directionDrawRequired]);
    const finalValues = rows.map((row) => row.querySelector(".lottery-reveal__result")!.textContent);
    expect(finalValues[0]).toBe(props.presentation.serviceName(ids[0]!));
    expect(mount.container.querySelector("button, a, input, [tabindex], [role=status]")).toBeNull();
    act(() => mount.root.render(createElement(LotteryHarness, { ...props, stage: "lottery-settle", durationMs: 400 })));
    expect(mount.container.querySelectorAll(".lottery-reveal__frame")).toHaveLength(0);
    expect([...mount.container.querySelectorAll(".lottery-reveal__result")].map((row) => row.textContent)).toEqual(finalValues);
    expect([...mount.container.querySelectorAll(".lottery-reveal__row")].map((row) => row.getAttribute("data-motion"))).toEqual(["fade", "fade"]);
    expect(mount.container.textContent).not.toMatch(/%|確率|重み/);
  });

  it("measures both HUD targets for settle without changing either target", () => {
    const network = buildRailwayNetwork(multiServiceInput());
    const id = [...network.servicesById.keys()][0]!;
    const target = document.createElement("span"); document.body.append(target);
    const rect = { left: 20, top: 30, width: 80, height: 40 } as DOMRect;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect);
    const source = vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({ ...rect, left: 100, top: 120 } as DOMRect);
    const props: LotteryRevealProps = { network, presentation: createPresentationResolver(network), stage: "lottery-settle", durationMs: 400,
      landing: { type: "landing-resolved", stationId: "a", serviceId: id, direction: 1, serviceCandidates: [id], directionCandidates: [1, -1],
        serviceDrawRequired: false, directionDrawRequired: true, changedService: false }, rideTarget: { current: target }, directionTarget: { current: target } };
    const mount = mountReact(createElement(LotteryHarness, props)); mounted.push(mount);
    expect([...mount.container.querySelectorAll<HTMLElement>(".lottery-reveal__row")].map((row) => [row.dataset["motion"], row.style.getPropertyValue("--lottery-x")]))
      .toEqual([["flight", "-80px"], ["flight", "-80px"]]);
    expect(target.getAttribute("style")).toBeNull();
    expect(source).toHaveBeenCalledTimes(2);
  });
});
