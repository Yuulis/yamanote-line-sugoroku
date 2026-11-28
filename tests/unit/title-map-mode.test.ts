// @vitest-environment jsdom
import {
  data, emitSuccessfulOffsetUpdate, fitOptions, flushOffsetPromises, mapFromState, mapHarness,
  mapState, navigationControl, navigationControlCount, ready, render, TARGET_SERVICE_ID,
  unmountMounted, WorkerDouble, type MapDouble,
} from "./helpers/railwayMapHarness";
import { act, createElement, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RailwayMap } from "../../src/features/map/RailwayMap";
import { TITLE_FIT_PADDING_PHONE_PX, TITLE_FIT_PADDING_PX, titleFitPadding } from "../../src/features/map/camera";
import { addRailwayLayers, setBackgroundFocus } from "../../src/features/map/railwayLayers";
import { corridorOffsetMemo } from "../../src/features/map/corridorOffsetMemo";
import { LAYER_IDS, SOURCE_IDS } from "../../src/features/map/mapConfig";
import { mountReact } from "./helpers/reactDom";

const ZERO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
const PREVIEW_POSITION: [number, number] = [139.758, 35.666];
const PREVIEW = [{ delta: 0 as const, stationId: "shimbashi", position: PREVIEW_POSITION, travelledSteps: 1 }];
const FOLLOW_POSITION: [number, number] = [139.75, 35.66];
const FOLLOW_PROGRESS = { completedFeatureIds: [], currentPosition: FOLLOW_POSITION };


describe("title map camera", () => {
  it("re-registers the canonical source after style reload when Worker support is unavailable", async () => {
    const actualRailwayLayers = await vi.importActual<typeof import("../../src/features/map/railwayLayers")>(
      "../../src/features/map/railwayLayers",
    );
    vi.mocked(addRailwayLayers).mockImplementation((map, input) => actualRailwayLayers.addRailwayLayers(map, input));

    if (!data.geometry.ok) throw new Error("Railway fixture needs canonical geometry");
    vi.stubGlobal("Worker", undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const geometry = structuredClone(data.geometry.value);
    const testData = { ...data, geometry: { ...data.geometry, value: geometry } };
    const map = ready("title", { data: testData });
    const originalDerived = map.sources.get(SOURCE_IDS.corridorSegments)?.data;
    expect(originalDerived).toBe(geometry);
    expect(warn).toHaveBeenCalledWith(
      "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.",
      expect.objectContaining({ message: "Web Worker is not available." }),
    );
    expect(addRailwayLayers).toHaveBeenCalledTimes(1);
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect((map.getLayer(layerId) as unknown as { source: string }).source).toBe(SOURCE_IDS.corridorSegments);
    }

    render("game", { data: testData });
    render("clear", { data: testData });
    render("title", { data: testData });
    expect(mapState.instances).toHaveLength(1);
    expect(addRailwayLayers).toHaveBeenCalledTimes(1);

    // MapLibre clears application sources/layers when a style is replaced.
    map.sources.clear();
    map.layers = [{ id: "water-name", type: "symbol" }];
    act(() => map.emit("style.load"));

    expect(addRailwayLayers).toHaveBeenCalledTimes(2);
    expect(map.order.filter((entry) => entry === `addSource:${SOURCE_IDS.corridorSegments}`)).toHaveLength(2);
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(originalDerived);
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect((map.getLayer(layerId) as unknown as { source: string }).source).toBe(SOURCE_IDS.corridorSegments);
    }

    const addCountAfterReload = map.order.filter((entry) => entry.startsWith("addSource:")).length;
    render("game", { data: testData });
    render("clear", { data: testData });
    render("title", { data: testData });
    expect(addRailwayLayers).toHaveBeenCalledTimes(2);
    expect(map.order.filter((entry) => entry.startsWith("addSource:")).length).toBe(addCountAfterReload);
  });

  it("keeps canonical data in the derived source and warns once when Worker is unavailable", async () => {
    const actualRailwayLayers = await vi.importActual<typeof import("../../src/features/map/railwayLayers")>(
      "../../src/features/map/railwayLayers",
    );
    vi.mocked(addRailwayLayers).mockImplementation((map, input) => actualRailwayLayers.addRailwayLayers(map, input));
    vi.stubGlobal("Worker", undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    if (!data.geometry.ok) throw new Error("Railway fixture needs canonical geometry");
    const geometry = structuredClone(data.geometry.value);
    const testData = { ...data, geometry: { ...data.geometry, value: geometry } };
    const map = ready("game", { data: testData });

    expect(warn).toHaveBeenCalledWith(
      "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.",
      expect.objectContaining({ message: "Web Worker is not available." }),
    );
    expect(map.sources.get(SOURCE_IDS.segments)?.data).toBe(geometry);
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(geometry);
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect((map.getLayer(layerId) as unknown as { source: string }).source).toBe(SOURCE_IDS.corridorSegments);
    }

    map.sources.clear();
    map.layers = [{ id: "water-name", type: "symbol" }];
    act(() => map.emit("style.load"));
    expect(warn).toHaveBeenCalledOnce();
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(geometry);
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect((map.getLayer(layerId) as unknown as { source: string }).source).toBe(SOURCE_IDS.corridorSegments);
    }
  });

  it("reuses a successful worker payload across style reload, mode changes, and a same-key map replacement", async () => {
    const actualRailwayLayers = await vi.importActual<typeof import("../../src/features/map/railwayLayers")>(
      "../../src/features/map/railwayLayers",
    );
    vi.mocked(addRailwayLayers).mockImplementation((map, input) => actualRailwayLayers.addRailwayLayers(map, input));
    vi.stubGlobal("Worker", WorkerDouble);
    let nextUrl = 0;
    const createUrl = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:offset-${++nextUrl}`);
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    if (!data.geometry.ok) throw new Error("Railway fixture needs canonical geometry");
    const geometry = structuredClone(data.geometry.value);
    const testData = { ...data, geometry: { ...data.geometry, value: geometry } };
    const derivedPayload = {
      geoJson: new Blob([JSON.stringify({ type: "FeatureCollection", features: [] })], { type: "application/geo+json" }),
      derivedCount: 0,
    };
    const map = ready("title", { data: testData });
    const worker = WorkerDouble.instances[0]!;

    expect(worker.requests).toHaveLength(1);
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(geometry);
    expect(() => map.addSource(SOURCE_IDS.corridorSegments, { data: geometry })).toThrow(
      `Source ${SOURCE_IDS.corridorSegments} already exists`,
    );
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect(map.getLayer(layerId)?.source).toBe(SOURCE_IDS.corridorSegments);
    }

    const source = map.sources.get(SOURCE_IDS.corridorSegments)!;
    vi.spyOn(source, "loaded").mockReturnValueOnce(false);
    worker.respond(derivedPayload);
    await flushOffsetPromises();
    map.emit("sourcedata", { sourceId: SOURCE_IDS.segments, sourceDataType: "content" });
    expect(source.dataCalls).toEqual([]);

    const update = { sourceId: SOURCE_IDS.corridorSegments, sourceDataType: "content" };
    map.emit("sourcedata", update); // Initial canonical indexing completed.
    map.emit("render");
    await flushOffsetPromises();
    const initialBlobUrl = "blob:offset-1";
    expect(source.dataCalls).toEqual([initialBlobUrl]);
    expect(corridorOffsetMemo.get(geometry, TARGET_SERVICE_ID)).toBeNull();

    map.emit("sourcedata", update); // Derived indexing completed.
    await flushOffsetPromises();
    expect(corridorOffsetMemo.get(geometry, TARGET_SERVICE_ID)).toBeNull();
    map.emit("render");
    await flushOffsetPromises();
    expect(corridorOffsetMemo.get(geometry, TARGET_SERVICE_ID)).toBe(derivedPayload);
    expect(createUrl).toHaveBeenCalledOnce();

    map.sources.clear();
    map.layers = [{ id: "water-name", type: "symbol" }];
    act(() => map.emit("style.load"));
    await flushOffsetPromises();
    expect(addRailwayLayers).toHaveBeenCalledTimes(2);
    expect(map.order.filter((entry) => entry === `addSource:${SOURCE_IDS.corridorSegments}`)).toHaveLength(2);
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(initialBlobUrl);
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.dataCalls).toEqual([]);
    expect(worker.requests).toHaveLength(1);
    expect(createUrl).toHaveBeenCalledOnce();
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect(map.getLayer(layerId)?.source).toBe(SOURCE_IDS.corridorSegments);
    }
    emitSuccessfulOffsetUpdate(map);
    await flushOffsetPromises();

    const registrationsAfterReload = map.order.filter((entry) => entry.startsWith("addSource:")).length;
    render("game", { data: testData });
    render("clear", { data: testData });
    render("title", { data: testData });
    expect(mapState.instances).toHaveLength(1);
    expect(map.order.filter((entry) => entry.startsWith("addSource:")).length).toBe(registrationsAfterReload);

    render("title", { data: { ...testData } });
    const replacement = mapFromState(1);
    vi.spyOn(replacement.container, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, mapHarness.viewport.width, mapHarness.viewport.height));
    act(() => replacement.emit("style.load"));
    await flushOffsetPromises();
    expect(map.removed).toBe(true);
    expect(worker.terminated).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith(initialBlobUrl);
    expect(WorkerDouble.instances).toHaveLength(1);
    expect(worker.requests).toHaveLength(1);
    expect(createUrl).toHaveBeenCalledTimes(2);
    expect(replacement.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe("blob:offset-2");
    expect(replacement.sources.get(SOURCE_IDS.corridorSegments)?.dataCalls).toEqual([]);
    for (const layerId of [LAYER_IDS.services, LAYER_IDS.currentService, LAYER_IDS.lotteryCandidates]) {
      expect(replacement.getLayer(layerId)?.source).toBe(SOURCE_IDS.corridorSegments);
    }
  });

  it("keeps canonical geometry and warns once with the original Worker error", async () => {
    const actualRailwayLayers = await vi.importActual<typeof import("../../src/features/map/railwayLayers")>(
      "../../src/features/map/railwayLayers",
    );
    vi.mocked(addRailwayLayers).mockImplementation((map, input) => actualRailwayLayers.addRailwayLayers(map, input));
    vi.stubGlobal("Worker", WorkerDouble);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    if (!data.geometry.ok) throw new Error("Railway fixture needs canonical geometry");
    const geometry = structuredClone(data.geometry.value);
    const testData = { ...data, geometry: { ...data.geometry, value: geometry } };
    const map = ready("game", { data: testData });
    const originalError = new Error("original worker failure");
    WorkerDouble.instances[0]!.fail(originalError);
    await flushOffsetPromises();

    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(geometry);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.",
      originalError,
    );
  });

  it.each(["error", "dataabort"] as const)("restores canonical data after a MapLibre %s and does not cache the failed apply", async (eventType) => {
    const actualRailwayLayers = await vi.importActual<typeof import("../../src/features/map/railwayLayers")>(
      "../../src/features/map/railwayLayers",
    );
    vi.mocked(addRailwayLayers).mockImplementation((map, input) => actualRailwayLayers.addRailwayLayers(map, input));
    vi.stubGlobal("Worker", WorkerDouble);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:failed-offset");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    if (!data.geometry.ok) throw new Error("Railway fixture needs canonical geometry");
    const geometry = structuredClone(data.geometry.value);
    const testData = { ...data, geometry: { ...data.geometry, value: geometry } };
    const map = ready("game", { data: testData });
    const worker = WorkerDouble.instances[0]!;
    const derivedPayload = {
      geoJson: new Blob([JSON.stringify({ type: "FeatureCollection", features: [] })], { type: "application/geo+json" }),
      derivedCount: 0,
    };
    worker.respond(derivedPayload);
    await flushOffsetPromises();
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe("blob:failed-offset");
    map.emit("sourcedataloading", { sourceId: SOURCE_IDS.corridorSegments });

    const originalError = new Error("MapLibre failed to fetch derived GeoJSON.");
    if (eventType === "error") map.emit("error", { sourceId: SOURCE_IDS.corridorSegments, error: originalError });
    else map.emit("dataabort", { sourceId: SOURCE_IDS.corridorSegments });
    await flushOffsetPromises();
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.data).toBe(geometry);
    expect(map.sources.get(SOURCE_IDS.corridorSegments)?.dataCalls).toEqual(["blob:failed-offset", geometry]);
    expect(revokeUrl).toHaveBeenCalledWith("blob:failed-offset");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.",
      eventType === "error"
        ? originalError
        : expect.objectContaining({ message: "MapLibre aborted corridor offset request 1." }),
    );

    map.sources.clear();
    map.layers = [{ id: "water-name", type: "symbol" }];
    act(() => map.emit("style.load"));
    expect(worker.requests).toHaveLength(2);
  });

  it("fades only basemap symbols across title, game, and a replacement style", () => {
    vi.mocked(addRailwayLayers).mockImplementation((map) => {
      const testMap = map as unknown as MapDouble;
      testMap.addLayer({
        id: "railway-stations-label",
        type: "symbol",
        paint: { "text-opacity": 0.2 },
      });
      testMap.addLayer({
        id: "game-marker-symbol",
        type: "symbol",
        paint: { "icon-opacity": 0.1 },
      });
    });

    render("title");
    const map = mapFromState();
    map.layers = [{
      id: "water-name",
      type: "symbol",
      paint: { "text-opacity": 0.8 },
    }];
    act(() => map.emit("style.load"));
    expect(map.getLayer("water-name")?.paint?.["text-opacity"]).toBe(0.8);

    render("game");
    expect(mapState.instances).toHaveLength(1);
    expect(map.getLayer("water-name")?.paint).toMatchObject({ "text-opacity": 0.6, "icon-opacity": 0.65 });
    expect(map.getLayer("railway-stations-label")?.paint?.["text-opacity"]).toBe(0.2);
    expect(map.getLayer("game-marker-symbol")?.paint?.["icon-opacity"]).toBe(0.1);

    render("title");
    expect(map.getLayer("water-name")?.paint?.["text-opacity"]).toBe(0.8);
    expect(map.getLayer("water-name")?.paint?.["icon-opacity"]).toBeUndefined();
    expect(map.getLayer("railway-stations-label")?.paint?.["text-opacity"]).toBe(0.2);
    expect(map.getLayer("game-marker-symbol")?.paint?.["icon-opacity"]).toBe(0.1);

    render("clear");
    expect(mapState.instances).toHaveLength(1);
    expect(map.getLayer("water-name")?.paint).toMatchObject({ "text-opacity": 0.6, "icon-opacity": 0.65 });
    render("title");
    expect(map.getLayer("water-name")?.paint?.["text-opacity"]).toBe(0.8);

    map.layers = [{
      id: "water-name",
      type: "symbol",
      paint: { "text-opacity": 0.4 },
    }];
    act(() => map.emit("style.load"));
    expect(map.getLayer("water-name")?.paint?.["text-opacity"]).toBe(0.4);
    render("game");
    expect(map.getLayer("water-name")?.paint?.["text-opacity"]).toBe(0.3);
    expect(map.getLayer("railway-stations-label")).toBeDefined();
  });

  it("updates background service paint when the persistent map changes modes", () => {
    vi.mocked(addRailwayLayers).mockImplementation((map, input) => {
      const testMap = map as unknown as MapDouble;
      testMap.addLayer({
        id: LAYER_IDS.services,
        type: "line",
        paint: {
          "line-width": input.focusBackground ? 2 : 3,
          "line-opacity": input.focusBackground ? 0.3 : 0.75,
        },
      });
    });
    vi.mocked(setBackgroundFocus).mockImplementation((map, focused) => {
      const testMap = map as unknown as MapDouble;
      if (!testMap.getLayer(LAYER_IDS.services)) return;
      testMap.setPaintProperty(LAYER_IDS.services, "line-width", focused ? 2 : 3);
      testMap.setPaintProperty(LAYER_IDS.services, "line-opacity", focused ? 0.3 : 0.75);
    });

    const map = ready("title");
    expect(map.getLayer(LAYER_IDS.services)?.paint).toMatchObject({ "line-width": 3, "line-opacity": 0.75 });
    expect(addRailwayLayers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ focusBackground: false }));

    render("game");
    expect(mapState.instances).toHaveLength(1);
    expect(map.getLayer(LAYER_IDS.services)?.paint).toMatchObject({ "line-width": 2, "line-opacity": 0.3 });

    render("title");
    expect(map.getLayer(LAYER_IDS.services)?.paint).toMatchObject({ "line-width": 3, "line-opacity": 0.75 });
  });

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
    mapHarness.mounted = mountReact(createElement(StrictMode, null, node));
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
    expect(mapState.instances).toHaveLength(1);
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

  it("keeps the unsupported notice visible on the clear screen without a second live region", () => {
    mapState.failConstruction = true;
    render("clear");

    const notice = document.querySelector(".map-error");
    expect(notice?.textContent).toContain("この端末・ブラウザでは地図を表示できません");
    expect(notice?.hasAttribute("role")).toBe(false);
    expect(document.querySelectorAll("[role='status'], [aria-live]")).toHaveLength(0);

    render("game");
    expect(document.querySelector(".map-error[role='status']")).not.toBeNull();
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
    mapHarness.viewport = { width: 1024, height: 768 };
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

    render("title", { ...overrides, adjustmentCandidates: [] });

    expect(map.calls.padding).toHaveLength(before.padding);
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
});
