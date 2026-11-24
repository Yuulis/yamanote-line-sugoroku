// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ClearRoute } from "../../src/features/game/clearResult";
import type { RouteImageDependencies, RouteImageInput } from "../../src/features/map/routeImage";
import { renderRouteImage, ROUTE_IMAGE_HEIGHT, ROUTE_IMAGE_WIDTH } from "../../src/features/map/routeImage";

const route: ClearRoute = {
  steps: [{
    segmentId: "probe-segment", fromStationId: "a", toStationId: "b", newlyCompleted: false,
    points: [[139.7, 35.6], [139.8, 35.7]], cumulative: [0, 1], total: 1,
  }],
  legs: [{ firstStepIndex: 0, endStepIndexExclusive: 1, serviceId: "probe-service", lineGroupId: "probe-line", color: "#e600ff" }],
  turnSpans: [{ recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1 }],
  bounds: [[139.7, 35.6], [139.8, 35.7]],
};

const input: RouteImageInput = {
  route,
  title: "山手線すごろく",
  editionName: "試験版",
  summary: { turns: 12, moves: 34, transfers: 5 },
  railwayCredit: {
    source: "「鉄道データ」（提供元）を加工して作成",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.ja",
  },
};

type TextContext = CanvasRenderingContext2D & { readonly calls: string[] };

function makeCanvas(): HTMLCanvasElement & { readonly textContext: TextContext; toBlob: (callback: BlobCallback, type?: string) => void } {
  const canvas = document.createElement("canvas") as HTMLCanvasElement & {
    textContext: TextContext;
    toBlob: (callback: BlobCallback, type?: string) => void;
  };
  const calls: string[] = [];
  const textContext = {
    calls,
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    measureText: vi.fn(() => ({ width: 0 } as TextMetrics)),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn((text: string) => { calls.push(text); }),
  } as unknown as TextContext;
  Object.defineProperty(canvas, "textContext", { value: textContext });
  vi.spyOn(canvas, "getContext").mockReturnValue(textContext);
  canvas.toBlob = (callback, type) => callback(new Blob(["png"], { type }));
  return canvas;
}

class MapDouble {
  readonly calls: string[] = [];
  readonly canvas = document.createElement("canvas");
  readonly listeners = new Map<string, Set<(event?: unknown) => void>>();
  sourceData: unknown;
  readonly layers: Array<{ id: string; paint?: Record<string, unknown> }> = [];
  fitArguments: readonly unknown[] = [];

  constructor() {
    this.canvas.width = ROUTE_IMAGE_WIDTH;
    this.canvas.height = ROUTE_IMAGE_HEIGHT;
  }

  on(event: string, listener: (event?: unknown) => void): void {
    this.calls.push(`on:${event}`);
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (event?: unknown) => void): void {
    this.calls.push(`off:${event}`);
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(value);
  }

  getCanvas(): HTMLCanvasElement { return this.canvas; }
  getStyle(): { layers: never[] } { return { layers: [] }; }
  getSource(): undefined { return undefined; }
  getLayer(): undefined { return undefined; }
  addSource(_id: string, source: { data: unknown }): void { this.calls.push("addSource"); this.sourceData = source.data; }
  addLayer(layer: { id: string; paint?: Record<string, unknown> }): void {
    this.calls.push(`addLayer:${layer.id}`);
    this.layers.push(layer);
  }
  fitBounds(bounds: unknown, options: unknown): void { this.calls.push("fitBounds"); this.fitArguments = [bounds, options]; }
  triggerRepaint(): void { this.calls.push("triggerRepaint"); }
  redraw(): void { this.calls.push("redraw"); }
  removeLayer(): void { this.calls.push("removeLayer"); }
  removeSource(): void { this.calls.push("removeSource"); }
  remove(): void { this.calls.push("remove"); }
}

function setup(canvas = makeCanvas()): { map: MapDouble; createMap: ReturnType<typeof vi.fn>; dependencies: RouteImageDependencies } {
  const map = new MapDouble();
  const createMap = vi.fn(() => map as unknown as MapLibreMap);
  return { map, createMap, dependencies: { mapFactory: { create: createMap }, createCanvas: vi.fn(() => canvas) } };
}

function armAndCapture(map: MapDouble): void {
  map.emit("style.load");
  map.emit("idle");
}

afterEach(() => vi.useRealTimers());

describe("renderRouteImage", () => {
  it("registers fatal listeners synchronously and fits the complete route before arming idle", async () => {
    const { map, createMap, dependencies } = setup();
    const addEventListener = map.canvas.addEventListener.bind(map.canvas);
    vi.spyOn(map.canvas, "addEventListener").mockImplementation((type, listener, options) => {
      map.calls.push(`canvas:${String(type)}`);
      addEventListener(type, listener, options);
    });
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    const container = document.body.querySelector<HTMLElement>(".route-image-export-container");
    expect(container?.style.width).toBe(`${ROUTE_IMAGE_WIDTH}px`);
    expect(container?.style.height).toBe(`${ROUTE_IMAGE_HEIGHT}px`);
    expect(map.calls.slice(0, 3)).toEqual(["on:error", "canvas:webglcontextlost", "on:style.load"]);
    expect(map.listeners.has("idle")).toBe(false);

    map.emit("idle");
    expect(map.calls).not.toContain("redraw");
    armAndCapture(map);
    await expect(promise).resolves.toMatchObject({ type: "image/png", size: 3 });
    const options = createMap.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options).toMatchObject({
      pixelRatio: 1,
      interactive: false,
      fadeDuration: 0,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    expect(map.calls.indexOf("addSource")).toBeLessThan(map.calls.indexOf("addLayer:clear-traveled-route-outline"));
    expect(map.calls.indexOf("addLayer:clear-traveled-route-outline")).toBeLessThan(map.calls.indexOf("addLayer:clear-traveled-route-line"));
    expect(map.calls.indexOf("addLayer:clear-traveled-route-line")).toBeLessThan(map.calls.indexOf("fitBounds"));
    expect(map.calls.indexOf("fitBounds")).toBeLessThan(map.calls.indexOf("on:idle"));
    expect(map.calls.indexOf("on:idle")).toBeLessThan(map.calls.indexOf("triggerRepaint"));
    expect(map.fitArguments).toEqual([
      [[139.7, 35.6], [139.8, 35.7]],
      { padding: { top: 90, right: 24, bottom: 187, left: 24 }, duration: 0, maxZoom: 17 },
    ]);
    expect(map.sourceData).toMatchObject({
      type: "FeatureCollection",
      features: [{ geometry: { coordinates: route.steps[0]?.points } }],
    });
    expect(map.layers[0]?.paint).toMatchObject({ "line-color": "#ffffff", "line-width": 11 });
    expect(map.layers[1]?.paint).toMatchObject({ "line-color": ["get", "color"], "line-width": 7 });
    expect(map.calls.filter((call) => call === "remove")).toHaveLength(1);
  });

  it("removes the export container and clears setup resources when the map factory throws", async () => {
    vi.useFakeTimers();
    const { createMap, dependencies } = setup();
    createMap.mockImplementation(() => { throw new Error("WebGL2 unavailable"); });
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
    const appendContainer = vi.spyOn(document.body, "appendChild");
    const removeContainer = vi.spyOn(document.body, "removeChild");

    const promise = renderRouteImage(input, controller.signal, dependencies);
    const container = appendContainer.mock.calls[0]?.[0];
    await expect(promise).rejects.toThrow("WebGL2 unavailable");

    const abortListener = addAbortListener.mock.calls[0]?.[1];
    expect(createMap).toHaveBeenCalledTimes(1);
    expect(container).not.toBeNull();
    expect(removeContainer).toHaveBeenCalledExactlyOnceWith(container);
    expect(document.body.querySelector(".route-image-export-container")).toBeNull();
    expect(abortListener).toBeTypeOf("function");
    expect(removeAbortListener).toHaveBeenCalledExactlyOnceWith("abort", abortListener);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the export container and clears setup resources when no 2D context exists", async () => {
    vi.useFakeTimers();
    const { createMap, dependencies } = setup();
    const canvas = makeCanvas();
    vi.mocked(canvas.getContext).mockReturnValue(null as never);
    const failingDependencies: RouteImageDependencies = {
      mapFactory: dependencies.mapFactory,
      createCanvas: vi.fn(() => canvas),
    };
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
    const appendContainer = vi.spyOn(document.body, "appendChild");
    const removeContainer = vi.spyOn(document.body, "removeChild");

    const promise = renderRouteImage(input, controller.signal, failingDependencies);
    const container = appendContainer.mock.calls[0]?.[0];
    await expect(promise).rejects.toThrow("A 2D canvas context is unavailable");

    const abortListener = addAbortListener.mock.calls[0]?.[1];
    expect(createMap).not.toHaveBeenCalled();
    expect(container).not.toBeNull();
    expect(removeContainer).toHaveBeenCalledExactlyOnceWith(container);
    expect(document.body.querySelector(".route-image-export-container")).toBeNull();
    expect(abortListener).toBeTypeOf("function");
    expect(removeAbortListener).toHaveBeenCalledExactlyOnceWith("abort", abortListener);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("redraws and copies the map canvas synchronously on the first armed idle", async () => {
    const canvas = makeCanvas();
    let finishEncode: BlobCallback | undefined;
    canvas.toBlob = (callback) => { finishEncode = callback; };
    const { map, dependencies } = setup(canvas);
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    map.emit("style.load");
    map.emit("idle");

    expect(map.calls.indexOf("triggerRepaint")).toBeLessThan(map.calls.indexOf("redraw"));
    expect(map.calls.indexOf("redraw")).toBeLessThan(map.calls.indexOf("remove"));
    expect(canvas.textContext.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.textContext.drawImage).toHaveBeenCalledWith(map.canvas, 0, 0);
    expect(finishEncode).toBeTypeOf("function");
    finishEncode?.(new Blob(["png"], { type: "image/png" }));
    await expect(promise).resolves.toMatchObject({ size: 3 });
  });

  it("draws the title, edition, three summary values, and all four plain-text credit lines exactly", async () => {
    const canvas = makeCanvas();
    const { map, dependencies } = setup(canvas);
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    armAndCapture(map);
    await promise;

    expect(canvas.textContext.calls).toEqual([
      "山手線すごろく",
      "試験版",
      "所要ターン数：12ターン",
      "移動回数：34回",
      "乗換回数：5回",
      "OpenFreeMap",
      "© OpenMapTiles",
      "© OpenStreetMap contributors (openstreetmap.org/copyright)",
      "鉄道データ: 「鉄道データ」（提供元）を加工して作成（CC BY 4.0 https://creativecommons.org/licenses/by/4.0/deed.ja）",
    ]);
    expect(canvas.textContext.font).toContain("12px");
    expect(canvas.textContext.fillRect).toHaveBeenCalled();
  });

  it("rejects a fatal MapLibre resource error even if idle follows", async () => {
    const { map, dependencies } = setup();
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    map.emit("style.load");
    map.emit("error", { error: new Error("glyph request failed") });
    map.emit("idle");
    await expect(promise).rejects.toThrow("glyph request failed");
    expect(map.calls).not.toContain("redraw");
    expect(map.calls.filter((call) => call === "remove")).toHaveLength(1);
  });

  it("rejects WebGL context loss and releases the map", async () => {
    const { map, dependencies } = setup();
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    map.canvas.dispatchEvent(new Event("webglcontextlost"));
    await expect(promise).rejects.toThrow(/context/i);
    expect(map.calls.filter((call) => call === "remove")).toHaveLength(1);
  });

  it("rejects canvas draw errors and still removes the map and container", async () => {
    const canvas = makeCanvas();
    vi.mocked(canvas.textContext.drawImage).mockImplementation(() => { throw new Error("draw failed"); });
    const { map, dependencies } = setup(canvas);
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    map.emit("style.load");
    map.emit("idle");
    await expect(promise).rejects.toThrow("draw failed");
    expect(map.calls.filter((call) => call === "remove")).toHaveLength(1);
    expect(document.body.querySelector(".route-image-export-container")).toBeNull();
  });

  it("rejects toBlob exceptions and null or empty encodes", async () => {
    for (const result of [
      (callback: BlobCallback) => callback(null),
      (callback: BlobCallback) => callback(new Blob()),
      () => { throw new Error("encode failed"); },
    ]) {
      const canvas = makeCanvas();
      canvas.toBlob = result;
      const { map, dependencies } = setup(canvas);
      const promise = renderRouteImage(input, new AbortController().signal, dependencies);
      armAndCapture(map);
      await expect(promise).rejects.toThrow();
      expect(map.calls.filter((call) => call === "remove")).toHaveLength(1);
    }
  });

  it("does no work when the signal is already aborted", async () => {
    const { createMap, dependencies } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(renderRouteImage(input, controller.signal, dependencies)).rejects.toMatchObject({ name: "AbortError" });
    expect(createMap).not.toHaveBeenCalled();
    expect(document.body.querySelector(".route-image-export-container")).toBeNull();
  });

  it("honors abort during style loading and abort during encode, ignoring late callbacks", async () => {
    const duringStyle = setup();
    const styleAbort = new AbortController();
    const stylePromise = renderRouteImage(input, styleAbort.signal, duringStyle.dependencies);
    styleAbort.abort();
    await expect(stylePromise).rejects.toMatchObject({ name: "AbortError" });
    expect(duringStyle.map.calls.filter((call) => call === "remove")).toHaveLength(1);

    const canvas = makeCanvas();
    let lateEncode: BlobCallback | undefined;
    canvas.toBlob = (callback) => { lateEncode = callback; };
    const duringEncode = setup(canvas);
    const encodeAbort = new AbortController();
    const encodePromise = renderRouteImage(input, encodeAbort.signal, duringEncode.dependencies);
    armAndCapture(duringEncode.map);
    encodeAbort.abort();
    await expect(encodePromise).rejects.toMatchObject({ name: "AbortError" });
    lateEncode?.(new Blob(["late"], { type: "image/png" }));
    expect(duringEncode.map.calls.filter((call) => call === "remove")).toHaveLength(1);
  });

  it("times out at exactly fifteen seconds, including an in-flight encode", async () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    canvas.toBlob = () => {};
    const { map, dependencies } = setup(canvas);
    const promise = renderRouteImage(input, new AbortController().signal, dependencies);
    armAndCapture(map);
    let settled = false;
    void promise.finally(() => { settled = true; }).catch(() => {});
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toThrow(/15 seconds|timeout/i);
    expect(map.calls.filter((call) => call === "remove")).toHaveLength(1);
  });
});
