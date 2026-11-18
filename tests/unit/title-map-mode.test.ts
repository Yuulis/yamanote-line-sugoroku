// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RailwayMap } from "../../src/features/map/RailwayMap";
import { TITLE_FIT_PADDING_PHONE_PX, TITLE_FIT_PADDING_PX, titleFitPadding } from "../../src/features/map/camera";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { loadRailwayData } from "../../src/data/loaders";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const mapState = vi.hoisted(() => ({ instances: [] as unknown[], failConstruction: false }));

interface MapEvent {
  readonly sourceId?: string;
}

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  Map: class MapDouble {
    readonly calls = { padding: [] as unknown[], fit: [] as unknown[], jump: [] as unknown[], ease: [] as unknown[] };
    readonly listeners = new Map<string, Array<(event?: MapEvent) => void>>();
    readonly onceListeners = new Map<string, Array<(event?: MapEvent) => void>>();
    readonly container: HTMLElement;
    readonly controls: unknown[] = [];
    removed = false;

    constructor(options: { container: HTMLElement }) {
      if (mapState.failConstruction) throw new Error("WebGL unavailable");
      this.container = options.container;
      mapState.instances.push(this);
    }

    on(event: string, listener: (event?: MapEvent) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: (event?: MapEvent) => void): this {
      const listeners = this.onceListeners.get(event) ?? [];
      listeners.push(listener);
      this.onceListeners.set(event, listeners);
      return this;
    }

    emit(event: string, payload: MapEvent = {}): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
      const once = this.onceListeners.get(event) ?? [];
      this.onceListeners.delete(event);
      for (const listener of once) listener(payload);
    }

    getContainer(): HTMLElement { return this.container; }
    addControl(control?: unknown): this {
      if (control === undefined) return this;
      this.controls.push(control);
      const element = (control as { onAdd?: (map: unknown) => HTMLElement }).onAdd?.(this);
      if (element) this.container.append(element);
      return this;
    }
    removeControl(control: unknown): this {
      const index = this.controls.indexOf(control);
      if (index >= 0) this.controls.splice(index, 1);
      (control as { onRemove?: (map: unknown) => void }).onRemove?.(this);
      return this;
    }
    hasControl(control: unknown): boolean { return this.controls.includes(control); }
    remove(): void {
      this.removed = true;
      for (const control of this.controls) {
        (control as { onRemove?: (map: unknown) => void }).onRemove?.(this);
      }
      this.controls.splice(0);
    }
    getSource(): null { return null; }
    getCenter(): { lng: number; lat: number } { return { lng: 0, lat: 0 }; }
    getZoom(): number { return 10; }
    triggerRepaint(): void {}
    project(): { x: number; y: number } { return { x: 100, y: 100 }; }
    unproject(): { lng: number; lat: number } { return { lng: 0, lat: 0 }; }
    setPadding(padding: unknown): void { this.calls.padding.push(padding); }
    fitBounds(bounds: unknown, options: unknown): void { this.calls.fit.push({ bounds, options }); }
    jumpTo(options: unknown): void { this.calls.jump.push(options); }
    easeTo(options: unknown): void { this.calls.ease.push(options); }
  },
  AttributionControl: class {},
  NavigationControl: class {
    readonly navigationControl = true;
    private removed = false;
    private element: HTMLElement | null = null;
    onAdd(): HTMLElement {
      this.element = document.createElement("div");
      this.element.className = "maplibregl-ctrl-zoom";
      for (const label of ["Zoom in", "Zoom out"]) {
        const button = document.createElement("button");
        button.setAttribute("aria-label", label);
        this.element.append(button);
      }
      return this.element;
    }
    onRemove(): void {
      if (this.removed) throw new TypeError("Cannot read properties of undefined (reading 'off')");
      this.removed = true;
      this.element?.remove();
      this.element = null;
    }
  },
  Popup: class {},
}));

vi.mock("../../src/features/map/attribution", () => ({
  ATTRIBUTION_SELECTOR: ".maplibregl-ctrl-attrib",
  buildDataAttribution: vi.fn(),
  watchCompactAttribution: vi.fn(() => () => undefined),
}));
vi.mock("../../src/features/map/e2eHook", () => ({ exposeMapForE2E: vi.fn() }));
vi.mock("../../src/features/map/railwayLayers", () => ({
  addRailwayLayers: vi.fn(), clearSegmentFlash: vi.fn(), segmentFlashOpacity: vi.fn(),
  setSegmentFlashFeatures: vi.fn(), setSegmentFlashOpacity: vi.fn(), updateCompletedSegments: vi.fn(),
  updateCurrentPosition: vi.fn(), updateGoalStation: vi.fn(), updateHighlightedService: vi.fn(),
}));
vi.mock("../../src/features/map/lineVisibility", () => ({ updateLineGroupVisibility: vi.fn() }));
vi.mock("../../src/features/map/lineVisibilityStore", () => ({ useVisibleLineGroupIds: () => null }));
vi.mock("../../src/features/map/headingMarker", () => ({
  createHeadingMarker: () => ({ remove: vi.fn(), update: vi.fn() }),
}));
vi.mock("../../src/features/map/rollAdjustmentPreview", () => ({
  mountAdjustmentCallouts: vi.fn(() => () => undefined), measureAdjustmentCallouts: vi.fn(() => []),
}));
vi.mock("../../src/features/map/stationInteraction", () => ({ bindStationInteractions: vi.fn() }));
vi.mock("../../src/features/map/stationPopup", () => ({ createStationPopupContent: vi.fn() }));
vi.mock("../../src/features/analytics/analytics", () => ({ trackException: vi.fn() }));

interface MapDouble {
  readonly calls: { padding: unknown[]; fit: Array<{ bounds: unknown; options: { padding?: unknown } }>; jump: unknown[]; ease: unknown[] };
  readonly controls: unknown[];
  readonly container: HTMLElement;
  readonly removed: boolean;
  emit(event: string, payload?: MapEvent): void;
  hasControl(control: unknown): boolean;
}

const data = await loadRailwayData("", async (url) => JSON.parse(
  readFileSync(resolve(process.cwd(), "public/data", url), "utf8"),
 ) as unknown);
const ZERO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
const TARGET_SERVICE_ID = DEFAULT_GAME_CONFIG.targetServiceId;
const PREVIEW_POSITION: [number, number] = [139.758, 35.666];
const PREVIEW = [{ delta: 0 as const, stationId: "shimbashi", position: PREVIEW_POSITION, travelledSteps: 1 }];
const FOLLOW_POSITION: [number, number] = [139.75, 35.66];
const FOLLOW_PROGRESS = { completedFeatureIds: [], currentPosition: FOLLOW_POSITION };

let mounted: MountedReact | null = null;
let viewport = { width: 1280, height: 800 };

function mapFromState(index = 0): MapDouble {
  const map = mapState.instances[index] as MapDouble | undefined;
  if (!map) throw new Error("RailwayMap did not construct a MapLibre map");
  return map;
}

function navigationControlCount(map: MapDouble): number {
  return map.controls.filter((control) => typeof control === "object" && control !== null && "navigationControl" in control).length;
}

function navigationControl(map: MapDouble): unknown {
  return map.controls.find((control) => typeof control === "object" && control !== null && "navigationControl" in control);
}

function render(mode: "title" | "game" | "clear", overrides: Record<string, unknown> = {}): void {
  const node = createElement(RailwayMap, { data, mode, targetServiceId: TARGET_SERVICE_ID, ...overrides });
  if (mounted) act(() => mounted?.root.render(node));
  else mounted = mountReact(node);
}

function unmountMounted(): unknown {
  const current = mounted;
  mounted = null;
  try {
    current?.cleanup();
    return undefined;
  } catch (error) {
    return error;
  }
}

function ready(mode: "title" | "game" | "clear" = "game", overrides: Record<string, unknown> = {}): MapDouble {
  render(mode, overrides);
  const map = mapFromState(mapState.instances.length - 1);
  vi.spyOn(map.container, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, viewport.width, viewport.height));
  act(() => map.emit("style.load"));
  return map;
}

function fitOptions(map: MapDouble, index = map.calls.fit.length - 1): { padding?: unknown } {
  const fit = map.calls.fit[index];
  if (!fit || typeof fit.options !== "object" || fit.options === null) throw new Error("Expected a fitBounds call");
  return fit.options;
}

beforeEach(() => {
  mapState.instances = [];
  mapState.failConstruction = false;
  viewport = { width: 1280, height: 800 };
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  Object.defineProperty(window, "ResizeObserver", { configurable: true, value: globalThis.ResizeObserver });
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback): number => { callback(0); return 1; } });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: vi.fn() });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("title map camera", () => {
  it("removes navigation exactly once when an in-game map unmounts", () => {
    const map = ready("game");
    const control = navigationControl(map);
    expect(control).toBeDefined();

    expect(unmountMounted()).toBeUndefined();

    expect(map.removed).toBe(true);
    expect(map.hasControl(control)).toBe(false);
  });

  it("removes navigation exactly once when rebuilding an in-game map", () => {
    const firstMap = ready("game");
    const control = navigationControl(firstMap);
    expect(control).toBeDefined();

    expect(() => render("game", { minZoom: 7 })).not.toThrow();

    expect(firstMap.removed).toBe(true);
    expect(firstMap.hasControl(control)).toBe(false);
    expect(mapState.instances).toHaveLength(2);
  });

  it("removes navigation exactly once during StrictMode teardown", () => {
    const node = createElement(RailwayMap, { data, mode: "game", targetServiceId: TARGET_SERVICE_ID });
    mounted = mountReact(createElement(StrictMode, null, node));
    const map = mapFromState(1);
    act(() => map.emit("style.load"));
    const control = navigationControl(map);
    expect(control).toBeDefined();

    expect(unmountMounted()).toBeUndefined();

    expect(map.removed).toBe(true);
    expect(map.hasControl(control)).toBe(false);
  });

  it.each([
    ["zoom button", (map: MapDouble) => map.container.querySelector<HTMLButtonElement>(".maplibregl-ctrl-zoom button")],
    ["overview button", () => document.querySelector<HTMLButtonElement>(".map-overview button")],
  ] as const)("moves focus from the %s to retry after a fatal pre-load error", (_name, focusTarget) => {
    const map = ready("game");
    const target = focusTarget(map);
    expect(target).not.toBeNull();
    target?.focus();

    act(() => map.emit("error", { sourceId: "basemap" }));

    const retry = [...document.querySelectorAll<HTMLButtonElement>(".map-error[role='alert'] button")]
      .find((button) => button.textContent === "再試行");
    expect(retry).toBeDefined();
    expect(document.activeElement).toBe(retry);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does not move focus elsewhere when a fatal pre-load error removes map controls", () => {
    const map = ready("game");
    const otherButton = document.createElement("button");
    otherButton.textContent = "別の操作";
    document.body.append(otherButton);
    otherButton.focus();

    act(() => map.emit("error", { sourceId: "basemap" }));

    expect(document.activeElement).toBe(otherButton);
  });

  it("navigation is hidden outside ready playable game mode", () => {
    render("game");
    const map = mapFromState();
    expect(document.querySelector(".map-overview")).toBeNull();
    expect(navigationControlCount(map)).toBe(0);

    act(() => map.emit("style.load"));
    expect(document.querySelector(".map-overview")).not.toBeNull();
    expect(navigationControlCount(map)).toBe(1);

    render("title");
    expect(document.querySelector(".map-overview")).toBeNull();
    expect(navigationControlCount(map)).toBe(0);

    render("clear");
    expect(document.querySelector(".map-overview")).toBeNull();
    expect(navigationControlCount(map)).toBe(0);

    render("game");
    expect(document.querySelector(".map-overview")).not.toBeNull();
    expect(navigationControlCount(map)).toBe(1);
    act(() => map.emit("error"));
    expect(document.querySelector(".map-overview")).toBeNull();
    expect(navigationControlCount(map)).toBe(0);
  });

  it("placeholder waits for load layers and a subsequent rendered frame", () => {
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback): number => {
        nextFrameId += 1;
        scheduledFrames.set(nextFrameId, callback);
        return nextFrameId;
      },
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: (frameId: number): void => { scheduledFrames.delete(frameId); },
    });

    render("title");
    const map = mapFromState();
    const placeholder = (): HTMLElement | null => document.querySelector(".title-map-placeholder");
    expect(placeholder()).not.toBeNull();
    expect(placeholder()?.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder()?.querySelector("svg")?.getAttribute("focusable")).toBe("false");

    act(() => map.emit("style.load"));
    expect(placeholder()).not.toBeNull();
    act(() => map.emit("render"));
    expect(scheduledFrames.size).toBe(0);
    act(() => map.emit("load"));
    expect(placeholder()).not.toBeNull();
    act(() => map.emit("render"));
    expect(placeholder()).not.toBeNull();
    expect(scheduledFrames.size).toBe(1);

    act(() => {
      for (const [frameId, callback] of scheduledFrames) {
        scheduledFrames.delete(frameId);
        callback(0);
      }
    });
    expect(placeholder()).toBeNull();
  });

  it("retry resets readiness and cancels stale callbacks", () => {
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    const allFrames: FrameRequestCallback[] = [];
    const cancelledFrames: number[] = [];
    let nextFrameId = 0;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback): number => {
        nextFrameId += 1;
        scheduledFrames.set(nextFrameId, callback);
        allFrames.push(callback);
        return nextFrameId;
      },
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: (frameId: number): void => {
        cancelledFrames.push(frameId);
        scheduledFrames.delete(frameId);
      },
    });

    render("title");
    const firstMap = mapFromState();
    act(() => {
      firstMap.emit("style.load");
      firstMap.emit("load");
      firstMap.emit("render");
    });
    const staleFrame = allFrames[0];
    expect(staleFrame).toBeDefined();
    render("title", { minZoom: 7 });
    expect(cancelledFrames).toContain(1);
    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();
    act(() => staleFrame?.(0));
    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();

    const failureMap = mapFromState(1);
    act(() => failureMap.emit("error", { sourceId: "basemap" }));
    const retryButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "再試行");
    expect(retryButton).toBeDefined();
    act(() => retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();

    const retryMap = mapFromState(2);
    act(() => {
      retryMap.emit("style.load");
      retryMap.emit("load");
      retryMap.emit("render");
    });
    const retryFrameId = [...scheduledFrames.keys()][0];
    const retryFrame = scheduledFrames.get(retryFrameId ?? -1);
    expect(retryFrame).toBeDefined();
    act(() => {
      if (retryFrameId !== undefined) scheduledFrames.delete(retryFrameId);
      retryFrame?.(0);
    });
    expect(document.querySelector(".title-map-placeholder")).toBeNull();
  });

  it("webgl unsupported shows the placeholder only in title mode", () => {
    mapState.failConstruction = true;
    render("title");

    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();
    expect(document.querySelector(".map-error[role='status']")).not.toBeNull();

    render("game");
    expect(document.querySelector(".title-map-placeholder")).toBeNull();

    render("clear");
    expect(document.querySelector(".title-map-placeholder")).toBeNull();

    render("title");
    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();
  });

  it("style failure shows the placeholder only in title mode", () => {
    render("title");
    const map = mapFromState();
    act(() => map.emit("error", { sourceId: "basemap" }));

    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();

    render("game");
    expect(document.querySelector(".title-map-placeholder")).toBeNull();

    render("clear");
    expect(document.querySelector(".title-map-placeholder")).toBeNull();

    render("title");
    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();
  });

  it("fatal failure retains title placeholder and retry controls", () => {
    render("title");
    const map = mapFromState();
    act(() => map.emit("error", { sourceId: "basemap" }));

    expect(document.querySelector(".title-map-placeholder")).not.toBeNull();
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "再試行")).toBe(true);
  });

  it("title padding is symmetric and clamped", () => {
    expect(titleFitPadding({ width: 320, height: 568 }, true)).toEqual({
      top: TITLE_FIT_PADDING_PHONE_PX, right: TITLE_FIT_PADDING_PHONE_PX,
      bottom: TITLE_FIT_PADDING_PHONE_PX, left: TITLE_FIT_PADDING_PHONE_PX,
    });
    expect(titleFitPadding({ width: 1280, height: 800 }, false)).toEqual({
      top: TITLE_FIT_PADDING_PX, right: TITLE_FIT_PADDING_PX,
      bottom: TITLE_FIT_PADDING_PX, left: TITLE_FIT_PADDING_PX,
    });
    expect(titleFitPadding({ width: 80, height: 80 }, false)).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(titleFitPadding({ width: 32, height: 32 }, true)).toEqual(ZERO_PADDING);
  });

  it("title fits the explicit target service without panel padding", () => {
    const panel = document.createElement("main");
    panel.className = "game-panel";
    panel.getBoundingClientRect = () => new DOMRect(0, 500, 1280, 300);
    document.body.append(panel);
    const map = ready("title");
    const target = data.services.ok
      ? data.services.value.services.find((service) => service.id === TARGET_SERVICE_ID)
      : undefined;
    if (!target) throw new Error("Capital-region fixture needs the target service");

    const points = Object.values(target.platformCoordinates);
    const expectedBounds = [
      [Math.min(...points.map(([lng]) => lng)), Math.min(...points.map(([, lat]) => lat))],
      [Math.max(...points.map(([lng]) => lng)), Math.max(...points.map(([, lat]) => lat))],
    ];
    expect(map.calls.fit.at(-1)?.bounds).toEqual(expectedBounds);
    expect(fitOptions(map).padding).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });
    const fitsBeforeLayerReload = map.calls.fit.length;
    act(() => map.emit("style.load"));
    expect(map.calls.fit.length).toBeGreaterThan(fitsBeforeLayerReload);
  });

  it("entry into title and resize refit the existing map", () => {
    const map = ready("game");
    const mapCount = mapState.instances.length;
    const beforeTitle = map.calls.fit.length;
    render("title");
    expect(map.calls.fit.length).toBeGreaterThan(beforeTitle);
    const beforeResize = map.calls.fit.length;
    viewport = { width: 1024, height: 768 };
    act(() => window.dispatchEvent(new window.Event("resize")));
    expect(map.calls.fit.length).toBeGreaterThan(beforeResize);
    expect(mapState.instances).toHaveLength(mapCount);
  });

  it("game camera effects cannot override title fitting", () => {
    const overrides = {
      follow: { enabled: true, immediate: true, onUserCameraMove: vi.fn() },
      progress: FOLLOW_PROGRESS,
      overviewKey: 1,
      adjustmentCandidates: PREVIEW,
    };
    const map = ready("title", overrides);
    const before = { fit: map.calls.fit.length, padding: map.calls.padding.length, jump: map.calls.jump.length, ease: map.calls.ease.length };
    render("title", { ...overrides, overviewKey: 2 });

    expect(map.calls.fit).toHaveLength(before.fit);
    expect(map.calls.padding).toHaveLength(before.padding);
    expect(map.calls.jump).toHaveLength(before.jump);
    expect(map.calls.ease).toHaveLength(before.ease);
  });

  it("title to turn-zero game restores panel-aware overview", () => {
    const map = ready("title");
    const before = map.calls.fit.length;
    render("game", { overviewKey: 1 });

    expect(map.calls.fit.length).toBeGreaterThan(before);
    expect(fitOptions(map).padding).toEqual({ top: 60, right: 70, bottom: 50, left: 340 });
  });

  it("does not refit the overview when the turn-zero overview key becomes undefined", () => {
    const map = ready("game", { overviewKey: 1 });
    const before = { fit: map.calls.fit.length, padding: map.calls.padding.length, jump: map.calls.jump.length, ease: map.calls.ease.length };

    render("game", { overviewKey: undefined });

    expect(map.calls.fit).toHaveLength(before.fit);
    expect(map.calls.padding).toHaveLength(before.padding);
    expect(map.calls.jump).toHaveLength(before.jump);
    expect(map.calls.ease).toHaveLength(before.ease);
  });

  it("reapplies preview bounds after a title round trip with the same preview inputs", () => {
    const overrides = { progress: FOLLOW_PROGRESS, adjustmentCandidates: PREVIEW, panelKey: 7 };
    const map = ready("game", overrides);
    const previewBounds = [
      [FOLLOW_POSITION[0], FOLLOW_POSITION[1]],
      [PREVIEW_POSITION[0], PREVIEW_POSITION[1]],
    ];
    const previewFitCount = () => map.calls.fit.filter(({ bounds }) => JSON.stringify(bounds) === JSON.stringify(previewBounds)).length;
    const beforeRoundTrip = previewFitCount();
    expect(beforeRoundTrip).toBe(1);

    render("title", overrides);
    render("game", overrides);

    expect(previewFitCount()).toBe(beforeRoundTrip + 1);
  });

  it("follows a positioned marker only in game and follows again on re-entry", () => {
    const follow = { enabled: true, immediate: true, onUserCameraMove: vi.fn() };
    const overrides = { follow, progress: FOLLOW_PROGRESS };
    const map = ready("game", overrides);
    expect(map.calls.jump).toHaveLength(1);
    const firstGameFollow = map.calls.jump.length;
    const initialEaseCount = map.calls.ease.length;

    render("title", overrides);
    expect(map.calls.jump).toHaveLength(firstGameFollow);
    expect(map.calls.ease).toHaveLength(initialEaseCount);
    render("clear", overrides);
    expect(map.calls.jump).toHaveLength(firstGameFollow);
    expect(map.calls.ease).toHaveLength(initialEaseCount);

    render("game", overrides);
    expect(map.calls.jump).toHaveLength(firstGameFollow + 1);
  });

  it("preview cleanup does not clear title padding", () => {
    const map = ready("game", { adjustmentCandidates: PREVIEW });
    render("title", { adjustmentCandidates: PREVIEW });
    const titleCallCount = map.calls.padding.length;
    render("title", { adjustmentCandidates: [] });

    expect(map.calls.padding).toHaveLength(titleCallCount);
  });

  it("clear retains camera", () => {
    const map = ready("game");
    const before = { fit: map.calls.fit.length, padding: map.calls.padding.length, jump: map.calls.jump.length, ease: map.calls.ease.length };
    render("clear", { overviewKey: 2, adjustmentCandidates: PREVIEW, follow: { enabled: true, immediate: true, onUserCameraMove: vi.fn() }, progress: FOLLOW_PROGRESS });

    expect(map.calls.fit).toHaveLength(before.fit);
    expect(map.calls.padding).toHaveLength(before.padding);
    expect(map.calls.jump).toHaveLength(before.jump);
    expect(map.calls.ease).toHaveLength(before.ease);
  });

  it("mode changes do not construct another map", () => {
    ready("game");
    render("title");
    render("clear");

    expect(mapState.instances).toHaveLength(1);
  });
});
