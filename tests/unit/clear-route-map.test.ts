// @vitest-environment jsdom
import type { Map as MapLibreMap } from "maplibre-gl";
import { act, createElement, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepPath } from "../../src/features/game/animation/movePath";
import type { ClearRoute } from "../../src/features/game/clearResult";
import {
  applyClearRouteFit,
  CLEAR_FIT_CREDIT_CLEARANCE_PX,
  CLEAR_FIT_MARGIN_PX,
  CLEAR_FIT_MAX_ZOOM,
  clearFitPadding,
  measureClearFit,
} from "../../src/features/map/clearRouteCamera";
import {
  applyClearRouteLayers,
  CLEAR_ROUTE_LAYER_IDS,
  CLEAR_ROUTE_SOURCE_ID,
  clearRouteAnchor,
  removeClearRouteLayers,
} from "../../src/features/map/clearRouteLayers";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { useClearRouteMap, type ClearRouteMapInput } from "../../src/features/map/useClearRouteMap";
import { mountReact, type MountedReact } from "./helpers/reactDom";

interface StyleLayer {
  readonly id: string;
  readonly type: string;
}

/** The slice of MapLibre the clear-route code touches, recording every call in order. */
class FakeMap {
  readonly calls: string[] = [];
  readonly fits: Array<{ bounds: unknown; options: Record<string, unknown> }> = [];
  readonly jumps: Array<Record<string, unknown>> = [];
  readonly paddings: unknown[] = [];
  readonly sources = new Map<string, { data: { features: unknown[] } }>();
  readonly listeners = new Map<string, Set<() => void>>();
  layers: StyleLayer[];
  styleLoaded = true;
  padding = { top: 7, right: 0, bottom: 300, left: 0 };

  constructor(readonly container: HTMLElement, layers: StyleLayer[] = stationStyle()) {
    this.layers = layers;
  }

  getContainer(): HTMLElement { return this.container; }
  getStyle(): { layers: StyleLayer[] } | undefined { return this.styleLoaded ? { layers: this.layers } : undefined; }
  getSource(id: string): { setData: (data: { features: unknown[] }) => void } | undefined {
    const source = this.sources.get(id);
    return source && { setData: (data) => { this.calls.push(`setData:${id}`); source.data = data; } };
  }
  addSource(id: string, spec: { data: { features: unknown[] } }): void {
    this.calls.push(`addSource:${id}`);
    this.sources.set(id, { data: spec.data });
  }
  addLayer(layer: StyleLayer, beforeId?: string): void {
    this.calls.push(`addLayer:${layer.id}:${beforeId ?? "top"}`);
    const index = beforeId === undefined ? this.layers.length : this.layers.findIndex((candidate) => candidate.id === beforeId);
    this.layers.splice(index, 0, layer);
  }
  getLayer(id: string): StyleLayer | undefined { return this.layers.find((layer) => layer.id === id); }
  removeLayer(id: string): void {
    this.calls.push(`removeLayer:${id}`);
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }
  removeSource(id: string): void {
    this.calls.push(`removeSource:${id}`);
    this.sources.delete(id);
  }
  resize(): void { this.calls.push("resize"); }
  getPadding(): typeof this.padding { return this.padding; }
  setPadding(padding: typeof this.padding): void {
    this.calls.push("setPadding");
    this.paddings.push(padding);
  }
  fitBounds(bounds: unknown, options: Record<string, unknown>): void {
    this.calls.push("fitBounds");
    this.fits.push({ bounds, options });
  }
  jumpTo(options: Record<string, unknown>): void {
    this.calls.push("jumpTo");
    this.jumps.push(options);
  }
  on(event: string, listener: () => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? new Set()).add(listener));
  }
  off(event: string, listener: () => void): void { this.listeners.get(event)?.delete(listener); }
  emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener(); }
  /** A replaced style: the basemap layers come back, the app's sources and layers do not. */
  replaceStyle(): void {
    this.sources.clear();
    this.layers = stationStyle();
  }
  asMap(): MapLibreMap { return this as unknown as MapLibreMap; }
}

function stationStyle(): StyleLayer[] {
  return [
    { id: "basemap-water", type: "fill" },
    { id: "railway-services", type: "line" },
    { id: LAYER_IDS.stationCircles, type: "circle" },
    { id: LAYER_IDS.stationLabels, type: "symbol" },
    { id: LAYER_IDS.currentPosition, type: "circle" },
  ];
}

function step(points: StepPath["points"]): StepPath {
  return { segmentId: "s", fromStationId: "a", toStationId: "b", newlyCompleted: false, points,
    cumulative: points.map((_, index) => index), total: points.length - 1 };
}

function route(bounds: ClearRoute["bounds"] = [[139.7, 35.6], [139.8, 35.7]], legCount = 2): ClearRoute {
  const steps = Array.from({ length: legCount }, (_, index) => step([[139.7 + index * 0.01, 35.6], [139.71 + index * 0.01, 35.61]]));
  return {
    steps,
    legs: steps.map((_, index) => ({ firstStepIndex: index, endStepIndexExclusive: index + 1, serviceId: `svc-${index}`,
      lineGroupId: `grp-${index}`, color: `#00${index}000` })),
    bounds,
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

describe("clear route layers", () => {
  it("adds one source with the outline below the main line, both below the first station layer", () => {
    const map = new FakeMap(document.createElement("div"));
    const added = applyClearRouteLayers(map.asMap(), { type: "FeatureCollection", features: [] });

    expect(added).toBe(true);
    expect(map.calls).toEqual([
      `addSource:${CLEAR_ROUTE_SOURCE_ID}`,
      `addLayer:${CLEAR_ROUTE_LAYER_IDS.outline}:${LAYER_IDS.stationCircles}`,
      `addLayer:${CLEAR_ROUTE_LAYER_IDS.line}:${LAYER_IDS.stationCircles}`,
    ]);
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "basemap-water", "railway-services", CLEAR_ROUTE_LAYER_IDS.outline, CLEAR_ROUTE_LAYER_IDS.line,
      LAYER_IDS.stationCircles, LAYER_IDS.stationLabels, LAYER_IDS.currentPosition,
    ]);
  });

  it("anchors below the first station layer in style order, whichever kind it is", () => {
    expect(clearRouteAnchor([
      { id: "a", type: "symbol" }, { id: LAYER_IDS.stationLabels, type: "symbol" }, { id: LAYER_IDS.stationCircles, type: "circle" },
    ])).toBe(LAYER_IDS.stationLabels);
    expect(clearRouteAnchor([{ id: LAYER_IDS.goalStation, type: "circle" }])).toBe(LAYER_IDS.goalStation);
  });

  it("falls back to the first symbol layer when no station layer exists, then to the top", () => {
    expect(clearRouteAnchor([
      { id: "water", type: "fill" }, { id: "place-labels", type: "symbol" }, { id: "road-labels", type: "symbol" },
    ])).toBe("place-labels");
    expect(clearRouteAnchor([{ id: "water", type: "fill" }])).toBeUndefined();

    const map = new FakeMap(document.createElement("div"), [{ id: "water", type: "fill" }]);
    applyClearRouteLayers(map.asMap(), { type: "FeatureCollection", features: [] });
    expect(map.calls.slice(1)).toEqual([
      `addLayer:${CLEAR_ROUTE_LAYER_IDS.outline}:top`, `addLayer:${CLEAR_ROUTE_LAYER_IDS.line}:top`,
    ]);
    expect(map.layers.map((layer) => layer.id)).toEqual(["water", CLEAR_ROUTE_LAYER_IDS.outline, CLEAR_ROUTE_LAYER_IDS.line]);
  });

  it("updates the existing source instead of adding the layers twice", () => {
    const map = new FakeMap(document.createElement("div"));
    applyClearRouteLayers(map.asMap(), { type: "FeatureCollection", features: [] });
    map.calls.length = 0;
    const latest = { type: "FeatureCollection" as const, features: [] };
    applyClearRouteLayers(map.asMap(), latest);
    expect(map.calls).toEqual([`setData:${CLEAR_ROUTE_SOURCE_ID}`]);
    expect(map.sources.get(CLEAR_ROUTE_SOURCE_ID)?.data).toBe(latest);
  });

  it("writes nothing while the style is not loaded", () => {
    const map = new FakeMap(document.createElement("div"));
    map.styleLoaded = false;
    expect(applyClearRouteLayers(map.asMap(), { type: "FeatureCollection", features: [] })).toBe(false);
    expect(map.calls).toEqual([]);
  });

  it("removes the layers before the source and skips parts a style replacement already dropped", () => {
    const map = new FakeMap(document.createElement("div"));
    applyClearRouteLayers(map.asMap(), { type: "FeatureCollection", features: [] });
    map.calls.length = 0;
    removeClearRouteLayers(map.asMap());
    expect(map.calls).toEqual([
      `removeLayer:${CLEAR_ROUTE_LAYER_IDS.line}`, `removeLayer:${CLEAR_ROUTE_LAYER_IDS.outline}`, `removeSource:${CLEAR_ROUTE_SOURCE_ID}`,
    ]);

    map.calls.length = 0;
    removeClearRouteLayers(map.asMap());
    expect(map.calls).toEqual([]);
  });
});

describe("clear route padding", () => {
  const margin = CLEAR_FIT_MARGIN_PX;
  const credit = CLEAR_FIT_CREDIT_CLEARANCE_PX;

  it("frames the route beside a centred desktop card, on the side that keeps more room", () => {
    const padding = clearFitPadding({
      viewport: { width: 1280, height: 800 }, creditEdge: "bottom",
      card: { left: 420, top: 40, right: 860, bottom: 760 },
    });
    // Left and right strips are equal; the left one wins the tie.
    expect(padding).toEqual({ top: margin, right: 1280 - 420 + margin, bottom: margin + credit, left: margin });
  });

  it("prefers the wider side when the card is off centre", () => {
    const padding = clearFitPadding({
      viewport: { width: 1280, height: 800 }, creditEdge: "bottom",
      card: { left: 100, top: 40, right: 540, bottom: 760 },
    });
    expect(padding).toEqual({ top: margin, right: margin, bottom: margin + credit, left: 540 + margin });
  });

  it("frames the route above a phone bottom sheet and keeps the credit button clear at the top", () => {
    const padding = clearFitPadding({
      viewport: { width: 320, height: 568 }, creditEdge: "top",
      card: { left: 8, top: 191, right: 312, bottom: 560 },
    });
    expect(padding).toEqual({ top: margin + credit, right: margin, bottom: 568 - 191 + margin, left: margin });
  });

  it("uses the whole map minus margins when the card is outside it", () => {
    const padding = clearFitPadding({
      viewport: { width: 600, height: 400 }, creditEdge: "bottom",
      card: { left: 700, top: 0, right: 900, bottom: 100 },
    });
    expect(padding).toEqual({ top: margin, right: margin, bottom: margin + credit, left: margin });
  });

  it("returns null when no open region keeps 64 px on both axes after the margins", () => {
    const sheet = (top: number) => ({
      viewport: { width: 320, height: 568 }, creditEdge: "top" as const, card: { left: 8, top, right: 312, bottom: 560 },
    });
    expect(clearFitPadding({
      viewport: { width: 320, height: 568 }, creditEdge: "top", card: { left: 0, top: 0, right: 320, bottom: 568 },
    }), "the card covers the whole map").toBeNull();
    expect(clearFitPadding(sheet(155)), "63 px of height is left above the sheet").toBeNull();
    expect(clearFitPadding(sheet(156)), "exactly 64 px is enough").toEqual({
      top: margin + credit, right: margin, bottom: 568 - 156 + margin, left: margin,
    });
    expect(clearFitPadding({ viewport: { width: 0, height: 0 }, creditEdge: "top", card: { left: 0, top: 0, right: 0, bottom: 0 } })).toBeNull();
  });
});

describe("clear route measurement and fit", () => {
  it("measures the card in map coordinates and finds the credit edge from the map controls", () => {
    const container = document.createElement("div");
    const card = document.createElement("section");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(10, 20, 1000, 700));
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(rect(110, 70, 400, 500));
    expect(measureClearFit(container, card)).toEqual({
      viewport: { width: 1000, height: 700 }, card: { left: 100, top: 50, right: 500, bottom: 550 }, creditEdge: "bottom",
    });

    const topLeft = document.createElement("div");
    topLeft.className = "maplibregl-ctrl-top-left";
    const attribution = document.createElement("div");
    attribution.className = "maplibregl-ctrl-attrib";
    topLeft.append(attribution);
    container.append(topLeft);
    expect(measureClearFit(container, card)?.creditEdge).toBe("top");
  });

  it("is unavailable until both the map and the card are laid out", () => {
    const container = document.createElement("div");
    const card = document.createElement("section");
    expect(measureClearFit(container, card), "jsdom lays nothing out").toBeNull();
    expect(measureClearFit(container, null)).toBeNull();
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 0, 800, 600));
    expect(measureClearFit(container, card), "the card has no size").toBeNull();
  });

  it("re-measures the canvas, clears retained padding, then fits without animation and caps the zoom", () => {
    const map = new FakeMap(document.createElement("div"));
    const padding = { top: 1, right: 2, bottom: 3, left: 4 };
    applyClearRouteFit(map.asMap(), [[139.7, 35.6], [139.8, 35.7]], padding);
    expect(map.calls).toEqual(["resize", "setPadding", "fitBounds"]);
    expect(map.paddings[0]).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(map.fits[0]).toEqual({ bounds: [[139.7, 35.6], [139.8, 35.7]], options: { padding, animate: false, maxZoom: CLEAR_FIT_MAX_ZOOM } });
  });

  it("centres a single point with jumpTo at the maximum zoom instead of fitting", () => {
    const map = new FakeMap(document.createElement("div"));
    const padding = { top: 1, right: 2, bottom: 3, left: 4 };
    applyClearRouteFit(map.asMap(), [[139.7, 35.6], [139.7, 35.6]], padding);
    expect(map.calls).toEqual(["resize", "setPadding", "jumpTo"]);
    expect(map.jumps[0]).toEqual({ center: [139.7, 35.6], zoom: CLEAR_FIT_MAX_ZOOM, padding });
  });
});

describe("useClearRouteMap", () => {
  let mounted: MountedReact | null = null;
  let frames: Array<FrameRequestCallback | null> = [];
  let observers: FakeResizeObserver[] = [];
  let mapRect = rect(0, 0, 1280, 800);
  let cardRect = rect(420, 40, 440, 720);
  let container: HTMLElement;
  let card: HTMLElement;
  let cardRef: RefObject<HTMLElement | null>;

  class FakeResizeObserver {
    readonly targets: Element[] = [];
    disconnected = false;
    constructor(readonly callback: () => void) { observers.push(this); }
    observe(target: Element): void { this.targets.push(target); }
    disconnect(): void { this.disconnected = true; }
  }

  function flushFrames(): void {
    const pending = frames;
    frames = [];
    act(() => { for (const callback of pending) callback?.(0); });
  }

  function mount(map: FakeMap, overrides: Partial<ClearRouteMapInput> = {}): ClearRouteMapInput {
    const input: ClearRouteMapInput = {
      map: map.asMap(), layersRevision: 0, active: true, route: route(), generation: 1, cardRef, ...overrides,
    };
    render(input);
    return input;
  }

  function render(input: ClearRouteMapInput): void {
    const node = createElement(() => { useClearRouteMap(input); return null; });
    if (mounted) mounted.render(node);
    else mounted = mountReact(node);
  }

  beforeEach(() => {
    frames = [];
    observers = [];
    mapRect = rect(0, 0, 1280, 800);
    cardRect = rect(420, 40, 440, 720);
    container = document.createElement("div");
    card = document.createElement("section");
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(() => mapRect);
    vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => cardRect);
    cardRef = { current: card };
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => { frames[handle - 1] = null; });
  });

  afterEach(() => {
    mounted?.cleanup();
    mounted = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws every leg and fits the camera immediately to the area beside the card", () => {
    const map = new FakeMap(container);
    mount(map);

    expect(map.layers.map((layer) => layer.id)).toContain(CLEAR_ROUTE_LAYER_IDS.line);
    expect(map.sources.get(CLEAR_ROUTE_SOURCE_ID)?.data.features).toHaveLength(2);
    expect(map.fits).toHaveLength(1);
    expect(map.fits[0]?.options).toEqual({
      padding: { top: 24, right: 1280 - 420 + 24, bottom: 24 + CLEAR_FIT_CREDIT_CLEARANCE_PX, left: 24 },
      animate: false, maxZoom: 13,
    });
  });

  it("refits at most once per frame on resize, orientation and visual viewport changes, only when the layout changed", () => {
    const map = new FakeMap(container);
    mount(map);
    map.fits.length = 0;

    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("orientationchange"));
    expect(frames, "one animation frame serves every notification").toHaveLength(1);
    flushFrames();
    expect(map.fits, "unchanged measurements are not fitted again").toHaveLength(0);

    mapRect = rect(0, 0, 1100, 700);
    cardRect = rect(330, 20, 440, 660);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(map.fits).toHaveLength(1);
    expect((map.fits[0]?.options.padding as { right: number }).right).toBe(1100 - 330 + 24);
  });

  it("refits when the card is resized and does not refit for an unchanged card (history dialog open or closed)", () => {
    const map = new FakeMap(container);
    mount(map);
    map.fits.length = 0;
    const [observer] = observers;
    expect(observer?.targets).toEqual([container, card]);

    act(() => observer?.callback());
    flushFrames();
    expect(map.fits, "the modal dialog lives in the top layer and leaves the card rectangle unchanged").toHaveLength(0);

    cardRect = rect(520, 40, 440, 720);
    act(() => observer?.callback());
    flushFrames();
    expect(map.fits).toHaveLength(1);
  });

  it("keeps the previous camera while the card or map has no measurable size, then fits once it does", () => {
    const map = new FakeMap(container);
    cardRect = rect(0, 0, 0, 0);
    mount(map);
    expect(map.fits).toHaveLength(0);
    expect(map.calls).not.toContain("resize");
    expect(map.calls).not.toContain("setPadding");

    cardRect = rect(420, 40, 440, 720);
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(map.fits).toHaveLength(1);

    mapRect = rect(0, 0, 0, 0);
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(map.fits).toHaveLength(1);
  });

  it("keeps the camera when the card leaves no usable area", () => {
    const map = new FakeMap(container);
    mapRect = rect(0, 0, 320, 568);
    cardRect = rect(0, 0, 320, 568);
    mount(map);
    expect(map.fits).toHaveLength(0);
  });

  it("fits again for a new publication even with identical measurements", () => {
    const map = new FakeMap(container);
    const input = mount(map);
    expect(map.fits).toHaveLength(1);
    render({ ...input, generation: 2 });
    expect(map.fits).toHaveLength(2);
  });

  it("restores the retained padding, removes the route and stops observing when the clear screen is left", () => {
    const map = new FakeMap(container);
    const input = mount(map);
    map.calls.length = 0;

    render({ ...input, active: false });

    expect(map.calls).toEqual([
      `removeLayer:${CLEAR_ROUTE_LAYER_IDS.line}`, `removeLayer:${CLEAR_ROUTE_LAYER_IDS.outline}`,
      `removeSource:${CLEAR_ROUTE_SOURCE_ID}`, "setPadding",
    ]);
    expect(map.paddings.at(-1)).toEqual({ top: 7, right: 0, bottom: 300, left: 0 });
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
    map.fits.length = 0;
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(map.fits).toHaveLength(0);
  });

  it("does nothing for a route that could not be verified or outside the clear screen", () => {
    const map = new FakeMap(container);
    mount(map, { route: null });
    expect(map.calls).toEqual([]);
    mounted?.cleanup();
    mounted = null;

    const other = new FakeMap(container);
    mount(other, { active: false });
    expect(other.calls).toEqual([]);
    expect(observers).toHaveLength(0);
  });

  it("does nothing before the map exists", () => {
    mount(new FakeMap(container), { map: null });
    expect(observers).toHaveLength(0);
  });

  it("adds the route again after a style replacement, with the latest data", () => {
    const map = new FakeMap(container);
    const input = mount(map);
    map.replaceStyle();
    map.calls.length = 0;

    const latest = route(undefined, 3);
    render({ ...input, layersRevision: 1, route: latest });

    expect(map.calls.filter((call) => call.startsWith("add"))).toEqual([
      `addSource:${CLEAR_ROUTE_SOURCE_ID}`,
      `addLayer:${CLEAR_ROUTE_LAYER_IDS.outline}:${LAYER_IDS.stationCircles}`,
      `addLayer:${CLEAR_ROUTE_LAYER_IDS.line}:${LAYER_IDS.stationCircles}`,
    ]);
    expect(map.sources.get(CLEAR_ROUTE_SOURCE_ID)?.data.features).toHaveLength(3);
  });

  it("holds the write while the style is absent and applies it when the style is back", () => {
    const map = new FakeMap(container);
    map.styleLoaded = false;
    const input = mount(map);
    expect(map.sources.size).toBe(0);

    map.styleLoaded = true;
    render({ ...input, layersRevision: 1 });
    expect(map.sources.get(CLEAR_ROUTE_SOURCE_ID)?.data.features).toHaveLength(2);
  });

  it("makes no call on a map that was already removed", () => {
    const map = new FakeMap(container);
    mount(map);
    map.emit("remove");
    map.calls.length = 0;

    mounted?.cleanup();
    mounted = null;

    expect(map.calls).toEqual([]);
    expect(map.listeners.get("remove")?.size).toBe(0);
  });
});
