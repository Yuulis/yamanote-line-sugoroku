// @vitest-environment jsdom
import { act, StrictMode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { RouteImageInput, RouteImageState } from "../../src/features/map/routeImage";
import type { RouteImageDependencies } from "../../src/features/map/routeImage";
import { useClearRouteImage, type ClearRouteImageController } from "../../src/features/game/useClearRouteImage";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const imageInput: RouteImageInput = {
  route: {
    steps: [{
      segmentId: "a-b", fromStationId: "a", toStationId: "b", newlyCompleted: false,
      points: [[139, 35], [139.1, 35.1]], cumulative: [0, 1], total: 1,
    }],
    legs: [{ firstStepIndex: 0, endStepIndexExclusive: 1, serviceId: "line", lineGroupId: "group", color: "#0088cc" }],
    turnSpans: [{ recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1 }],
    bounds: [[139, 35], [139.1, 35.1]],
  },
  title: "山手線すごろく",
  editionName: "東京近郊版",
  summary: { turns: 1, moves: 1, transfers: 0 },
  railwayCredit: { source: "鉄道データ", licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.ja" },
};

class MapDouble {
  readonly canvas = document.createElement("canvas");
  readonly listeners = new Map<string, Set<(event?: unknown) => void>>();
  removed = 0;

  constructor() {
    this.canvas.width = 1200;
    this.canvas.height = 675;
  }

  on(event: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (event?: unknown) => void): void { this.listeners.get(event)?.delete(listener); }
  emit(event: string): void { for (const listener of [...(this.listeners.get(event) ?? [])]) listener(); }
  getCanvas(): HTMLCanvasElement { return this.canvas; }
  getStyle(): { layers: never[] } { return { layers: [] }; }
  getSource(): undefined { return undefined; }
  getLayer(): undefined { return undefined; }
  addSource(): void {}
  addLayer(): void {}
  fitBounds(): void {}
  triggerRepaint(): void {}
  redraw(): void {}
  removeLayer(): void {}
  removeSource(): void {}
  remove(): void { this.removed += 1; }
}

function makeDependencies(): {
  readonly maps: MapDouble[];
  readonly encodes: BlobCallback[];
  readonly createMap: ReturnType<typeof vi.fn>;
  readonly dependencies: RouteImageDependencies;
} {
  const maps: MapDouble[] = [];
  const encodes: BlobCallback[] = [];
  const createMap = vi.fn(() => {
    const map = new MapDouble();
    maps.push(map);
    queueMicrotask(() => {
      map.emit("style.load");
      map.emit("idle");
    });
    return map as unknown as MapLibreMap;
  });
  const createCanvas = vi.fn(() => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue({
      fillStyle: "", font: "", textAlign: "left", textBaseline: "top",
      measureText: () => ({ width: 0 }), fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    canvas.toBlob = (callback) => encodes.push(callback);
    return canvas;
  });
  return { maps, encodes, createMap, dependencies: { mapFactory: { create: createMap }, createCanvas } };
}

let mounted: MountedReact | undefined;
let currentController: ClearRouteImageController | undefined;
let currentState: RouteImageState | undefined;

function Harness(props: { input: RouteImageInput | null; generation: number; dependencies: RouteImageDependencies }): null {
  const controller = useClearRouteImage(props.input, props.generation, props.dependencies);
  currentController = controller;
  currentState = controller.state;
  return null;
}

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  currentController = undefined;
  currentState = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useClearRouteImage lifecycle", () => {
  it("cancels StrictMode's first start and creates one ready image for the retained setup", async () => {
    vi.useFakeTimers();
    const { dependencies, maps, encodes, createMap } = makeDependencies();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:clear-route-1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    mounted = mountReact(createElement(StrictMode, null,
      createElement(Harness, { input: imageInput, generation: 1, dependencies })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(createMap).toHaveBeenCalledTimes(1);
    expect(maps).toHaveLength(1);
    expect(encodes).toHaveLength(1);

    await act(async () => {
      encodes[0]?.(new Blob(["png"], { type: "image/png" }));
      await Promise.resolve();
    });
    expect(currentState?.kind).toBe("ready");
    if (currentState?.kind !== "ready") throw new Error("expected a ready image");
    expect(currentState.image.blob.size).toBe(3);
    expect(currentState.image.file.name).toBe("yamanote-sugoroku-route.png");
    expect(currentState.image.file.type).toBe("image/png");
    expect(currentState.image.url).toBe("blob:clear-route-1");

    currentController?.markDownloadStarted();
    mounted.cleanup();
    mounted = undefined;
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:clear-route-1");
  });

  it("discards a stale encode callback from an older result generation", async () => {
    vi.useFakeTimers();
    const { dependencies, maps, encodes } = makeDependencies();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:current");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    mounted = mountReact(createElement(Harness, { input: imageInput, generation: 1, dependencies }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(encodes).toHaveLength(1);

    const nextInput = { ...imageInput, editionName: "次の結果" };
    mounted.render(createElement(Harness, { input: nextInput, generation: 2, dependencies }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(maps[0]?.removed).toBe(1);
    expect(encodes).toHaveLength(2);
    await act(async () => {
      encodes[0]?.(new Blob(["stale"], { type: "image/png" }));
      encodes[1]?.(new Blob(["current"], { type: "image/png" }));
      await Promise.resolve();
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(currentState?.kind).toBe("ready");
    if (currentState?.kind !== "ready") throw new Error("expected the current image");
    expect(await currentState.image.blob.text()).toBe("current");
  });

  it("revokes an unused URL on result disposal and stays unavailable without a complete route input", async () => {
    vi.useFakeTimers();
    const { dependencies, encodes, createMap } = makeDependencies();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unused");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    mounted = mountReact(createElement(Harness, { input: null, generation: 0, dependencies }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(currentState).toEqual({ kind: "unavailable" });
    expect(createMap).not.toHaveBeenCalled();

    mounted.render(createElement(Harness, { input: imageInput, generation: 1, dependencies }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => {
      encodes[0]?.(new Blob(["png"], { type: "image/png" }));
      await Promise.resolve();
    });
    mounted.cleanup();
    mounted = undefined;
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:unused");
  });
});
