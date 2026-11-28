import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { RailwayMap } from "../../../src/features/map/RailwayMap";
import { bindStationInteractions } from "../../../src/features/map/stationInteraction";
import { DEFAULT_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import { loadRailwayData } from "../../../src/data/loaders";
import { addRailwayLayers, setBackgroundFocus } from "../../../src/features/map/railwayLayers";
import { SOURCE_IDS } from "../../../src/features/map/mapConfig";
import { mountReact, type MountedReact } from "./reactDom";

const mapState = vi.hoisted(() => ({ instances: [] as unknown[], failConstruction: false, openedPopups: 0, removedPopups: 0 }));
interface MapEvent {
  readonly sourceId?: string;
  readonly sourceDataType?: string;
  readonly isSourceLoaded?: boolean;
  readonly error?: unknown;
}

interface SourceDouble {
  data: { features: unknown[] };
  readonly dataCalls: unknown[];
  loaded(): boolean;
  setData(data: unknown): Promise<void>;
}

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  Map: class MapDouble {
    readonly calls = { padding: [] as unknown[], fit: [] as unknown[], jump: [] as unknown[], ease: [] as unknown[] };
    /** Camera and clear-route calls in the order they happened. */
    readonly order: string[] = [];
    readonly sources = new Map<string, SourceDouble>();
    layers: Array<{ id: string; type: string; source?: string; paint?: Record<string, unknown> }> = [{ id: "railway-stations-circle", type: "circle" }];
    padding = { top: 5, right: 0, bottom: 200, left: 0 };
    readonly listeners = new Map<string, Array<(event?: MapEvent) => void>>();
    readonly onceListeners = new Map<string, Array<(event?: MapEvent) => void>>();
    readonly container: HTMLElement;
    readonly controls: unknown[] = [];
    removed = false;
    readonly canvas: HTMLCanvasElement;

    constructor(options: { container: HTMLElement }) {
      if (mapState.failConstruction) throw new Error("WebGL unavailable");
      this.container = options.container;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "maplibregl-canvas";
      this.canvas.tabIndex = 0;
      this.container.append(this.canvas);
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
    getCanvas(): HTMLCanvasElement { return this.canvas; }
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
      this.emit("remove");
    }
    getSource(id: string): SourceDouble | undefined {
      return this.sources.get(id);
    }
    isSourceLoaded(): boolean { return true; }
    getStyle(): { layers: Array<{ id: string; type: string }> } { return { layers: this.layers }; }
    addSource(id: string, spec: { data: unknown }): void {
      if (this.sources.has(id)) throw new Error(`Source ${id} already exists`);
      this.order.push(`addSource:${id}`);
      this.sources.set(id, {
        data: spec.data as { features: unknown[] },
        dataCalls: [],
        loaded: () => true,
        setData(data) {
          this.data = data as { features: unknown[] };
          this.dataCalls.push(data);
          return Promise.resolve();
        },
      });
    }
    addLayer(layer: { id: string; type: string; source?: string; paint?: Record<string, unknown> }, beforeId?: string): void {
      this.order.push(`addLayer:${layer.id}:${beforeId ?? "top"}`);
      this.layers.splice(beforeId === undefined ? this.layers.length : this.layers.findIndex((item) => item.id === beforeId), 0, layer);
    }
    getLayer(id: string): { id: string; type: string; source?: string; paint?: Record<string, unknown> } | undefined { return this.layers.find((layer) => layer.id === id); }
    setPaintProperty(id: string, property: string, value: unknown): void {
      const layer = this.layers.find((item) => item.id === id);
      if (layer) {
        layer.paint ??= {};
        layer.paint[property] = value;
      }
    }
    setLayoutProperty(id: string, property: string, value: unknown): void {
      const layer = this.layers.find((item) => item.id === id) as { layout?: Record<string, unknown> } | undefined;
      if (layer) {
        layer.layout ??= {};
        layer.layout[property] = value;
      }
    }
    removeLayer(id: string): void { this.order.push(`removeLayer:${id}`); this.layers = this.layers.filter((layer) => layer.id !== id); }
    removeSource(id: string): void { this.order.push(`removeSource:${id}`); this.sources.delete(id); }
    resize(): void { this.order.push("resize"); }
    getPadding(): { top: number; right: number; bottom: number; left: number } { return this.padding; }
    off(event: string, listener: (event?: MapEvent) => void): this {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((item) => item !== listener));
      return this;
    }
    getCenter(): { lng: number; lat: number } { return { lng: 0, lat: 0 }; }
    getZoom(): number { return 10; }
    triggerRepaint(): void {}
    project(): { x: number; y: number } { return { x: 100, y: 100 }; }
    unproject(): { lng: number; lat: number } { return { lng: 0, lat: 0 }; }
    setPadding(padding: unknown): void { this.order.push("setPadding"); this.calls.padding.push(padding); }
    fitBounds(bounds: unknown, options: unknown): void { this.order.push("fitBounds"); this.calls.fit.push({ bounds, options }); }
    jumpTo(options: unknown): void { this.order.push("jumpTo"); this.calls.jump.push(options); }
    easeTo(options: unknown): void { this.calls.ease.push(options); }
  },
  AttributionControl: class {
    onAdd(): HTMLElement {
      const root = document.createElement("div");
      root.className = "maplibregl-ctrl-attrib";
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "地図の出典";
      details.append(summary);
      root.append(details);
      return root;
    }
  },
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
  Popup: class {
    setLngLat(): this { return this; }
    setDOMContent(): this { return this; }
    addTo(): this { mapState.openedPopups += 1; return this; }
    remove(): this { mapState.removedPopups += 1; return this; }
  },
}));

vi.mock("../../../src/features/map/attribution", () => ({
  ATTRIBUTION_SELECTOR: ".maplibregl-ctrl-attrib",
  buildDataAttribution: vi.fn(),
  watchCompactAttribution: vi.fn(() => () => undefined),
}));
vi.mock("../../../src/features/map/e2eHook", () => ({
  exposeMapForE2E: vi.fn(),
  exposeClearFitPaddingForE2E: vi.fn(),
  exposeClearCameraTargetForE2E: vi.fn(),
  incrementClearFitCountForE2E: vi.fn(),
}));
vi.mock("../../../src/features/map/railwayLayers", () => ({
  addRailwayLayers: vi.fn(), setBackgroundFocus: vi.fn(), clearSegmentFlash: vi.fn(), segmentFlashOpacity: vi.fn(),
  setSegmentFlashFeatures: vi.fn(), setSegmentFlashOpacity: vi.fn(), updateCompletedSegments: vi.fn(),
  updateCurrentPosition: vi.fn(), updateGoalStation: vi.fn(), updateHighlightedService: vi.fn(), updateLotteryCandidates: vi.fn(),
}));
vi.mock("../../../src/features/map/lineVisibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/features/map/lineVisibility")>();
  return { ...actual, hideAllLineGroups: vi.fn(), updateLineGroupVisibility: vi.fn() };
});
vi.mock("../../../src/features/map/lineVisibilityStore", () => ({ useVisibleLineGroupIds: () => null }));
vi.mock("../../../src/features/map/headingMarker", () => ({
  createHeadingMarker: () => ({ remove: vi.fn(), update: vi.fn() }),
}));
vi.mock("../../../src/features/map/rollAdjustmentPreview", () => ({
  mountAdjustmentCallouts: vi.fn(() => () => undefined), measureAdjustmentCallouts: vi.fn(() => []),
}));
vi.mock("../../../src/features/map/stationInteraction", () => ({ bindStationInteractions: vi.fn() }));
vi.mock("../../../src/features/map/stationPopup", () => ({ createStationPopupContent: vi.fn() }));
vi.mock("../../../src/features/analytics/analytics", () => ({ trackException: vi.fn() }));

export interface MapDouble {
  readonly calls: { padding: unknown[]; fit: Array<{ bounds: unknown; options: { padding?: unknown } }>; jump: unknown[]; ease: unknown[] };
  readonly controls: unknown[];
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly removed: boolean;
  readonly order: string[];
  readonly sources: Map<string, SourceDouble>;
  layers: Array<{ id: string; type: string; source?: string; paint?: Record<string, unknown> }>;
  padding: { top: number; right: number; bottom: number; left: number };
  emit(event: string, payload?: MapEvent): void;
  getCanvas(): HTMLCanvasElement;
  addLayer(layer: { id: string; type: string; paint?: Record<string, unknown> }, beforeId?: string): void;
  addSource(id: string, spec: { data: unknown }): void;
  getLayer(id: string): { id: string; type: string; source?: string; paint?: Record<string, unknown> } | undefined;
  setPaintProperty(id: string, property: string, value: unknown): void;
  hasControl(control: unknown): boolean;
}

interface WorkerRequestDouble {
  readonly requestId: number;
  readonly geometry: unknown;
  readonly targetServiceId: string;
}

export class WorkerDouble {
  static instances: WorkerDouble[] = [];
  readonly requests: WorkerRequestDouble[] = [];
  readonly terminated = vi.fn();
  readonly messageListeners: Array<(event: { data: unknown }) => void> = [];
  readonly errorListeners: Array<(event: { error?: unknown; message?: string }) => void> = [];

  constructor(readonly url: unknown, readonly options: unknown) {
    WorkerDouble.instances.push(this);
  }

  postMessage(message: WorkerRequestDouble): void { this.requests.push(message); }
  addEventListener(type: "message" | "error", listener: (event: never) => void): void {
    if (type === "message") this.messageListeners.push(listener as (event: { data: unknown }) => void);
    else this.errorListeners.push(listener as (event: { error?: unknown; message?: string }) => void);
  }
  removeEventListener(): void {}
  terminate(): void { this.terminated(); }
  respond(result: unknown): void {
    const request = this.requests.at(-1);
    if (!request) throw new Error("Worker did not receive a derivation request");
    for (const listener of this.messageListeners) {
      listener({ data: { requestId: request.requestId, result, workerDerivationMs: 3 } });
    }
  }
  fail(error: Error): void {
    for (const listener of this.errorListeners) listener({ error });
  }
}

export function emitSuccessfulOffsetUpdate(map: MapDouble): void {
  map.emit("sourcedataloading", { sourceId: SOURCE_IDS.corridorSegments });
  map.emit("sourcedata", {
    sourceId: SOURCE_IDS.corridorSegments,
    sourceDataType: "content",
    isSourceLoaded: true,
  });
  map.emit("render");
}

export async function flushOffsetPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

export const data = await loadRailwayData("", async (url) => JSON.parse(
  readFileSync(resolve(process.cwd(), "public/data", url), "utf8"),
 ) as unknown);
export const TARGET_SERVICE_ID = DEFAULT_GAME_CONFIG.targetServiceId;
export const mapHarness = {
  mounted: null as MountedReact | null,
  viewport: { width: 1280, height: 800 },
};

export function mapFromState(index = 0): MapDouble {
  const map = mapState.instances[index] as MapDouble | undefined;
  if (!map) throw new Error("RailwayMap did not construct a MapLibre map");
  return map;
}

export function navigationControlCount(map: MapDouble): number {
  return map.controls.filter((control) => typeof control === "object" && control !== null && "navigationControl" in control).length;
}

export function navigationControl(map: MapDouble): unknown {
  return map.controls.find((control) => typeof control === "object" && control !== null && "navigationControl" in control);
}

export function render(mode: "title" | "game" | "clear", overrides: Record<string, unknown> = {}): void {
  const node = createElement(RailwayMap, { data, mode, targetServiceId: TARGET_SERVICE_ID, ...overrides });
  if (mapHarness.mounted) act(() => mapHarness.mounted?.root.render(node));
  else mapHarness.mounted = mountReact(node);
}

export function unmountMounted(): unknown {
  const current = mapHarness.mounted;
  mapHarness.mounted = null;
  try {
    current?.cleanup();
    return undefined;
  } catch (error) {
    return error;
  }
}

export function ready(mode: "title" | "game" | "clear" = "game", overrides: Record<string, unknown> = {}): MapDouble {
  render(mode, overrides);
  const map = mapFromState(mapState.instances.length - 1);
  vi.spyOn(map.container, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, mapHarness.viewport.width, mapHarness.viewport.height));
  act(() => map.emit("style.load"));
  return map;
}

export function fitOptions(map: MapDouble, index = map.calls.fit.length - 1): { padding?: unknown } {
  const fit = map.calls.fit[index];
  if (!fit || typeof fit.options !== "object" || fit.options === null) throw new Error("Expected a fitBounds call");
  return fit.options;
}

beforeEach(() => {
  mapState.instances = [];
  mapState.failConstruction = false;
  mapState.openedPopups = 0;
  mapState.removedPopups = 0;
  WorkerDouble.instances = [];
  vi.mocked(addRailwayLayers).mockReset();
  vi.mocked(setBackgroundFocus).mockReset();
  vi.mocked(bindStationInteractions).mockReset();
  mapHarness.viewport = { width: 1280, height: 800 };
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  Object.defineProperty(window, "ResizeObserver", { configurable: true, value: globalThis.ResizeObserver });
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback): number => { callback(0); return 1; } });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: vi.fn() });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});

afterEach(() => {
  mapHarness.mounted?.cleanup();
  mapHarness.mounted = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


export { mapState };
