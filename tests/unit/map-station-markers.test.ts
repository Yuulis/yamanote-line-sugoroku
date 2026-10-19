import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  KEY_STATION_RADIUS_STOPS,
  KEY_STATION_STROKE_STOPS,
  LABEL_MIN_ZOOM,
  LABEL_ORDINARY_MIN_ZOOM,
  LAYER_IDS,
  ORDINARY_STATION_MIN_ZOOM,
  ORDINARY_STATION_RADIUS_STOPS,
  ORDINARY_STATION_STROKE_STOPS,
} from "../../src/features/map/mapConfig";
import { addRailwayLayers } from "../../src/features/map/railwayLayers";
import { buildStationCollection } from "../../src/features/map/stationCollection";
import { bindStationInteractions, STATION_MARKER_LAYERS } from "../../src/features/map/stationInteraction";
import {
  classifyStation,
  classifyStations,
  isStationLabelEligible,
  isStationMarkerVisible,
  keyStationIds,
  zoomInterpolation,
} from "../../src/features/map/stationMarkers";
import { loadBundle } from "../e2e/fixtures/bundle";

const bundle = await loadBundle("real");
const TARGET = "jr-yamanote";
/** About the zoom at which the whole 1都3県 network fits on screen. */
const OVERVIEW_ZOOM = 8;
const CLOSE_ZOOM = 14;

describe("classifyStation", () => {
  it("marks a station on the target line as target, even when other services also stop there", () => {
    expect(classifyStation([TARGET], TARGET)).toBe("target");
    expect(classifyStation(["a", TARGET, "b"], TARGET)).toBe("target");
  });

  it("marks a station served by two or more non-target services as transfer", () => {
    expect(classifyStation(["a", "b"], TARGET)).toBe("transfer");
  });

  it.each([[[]], [["a"]]])("marks a station served by %j as ordinary", (serving) => {
    expect(classifyStation(serving, TARGET)).toBe("ordinary");
  });
});

describe("isStationMarkerVisible", () => {
  it.each(["target", "transfer"] as const)("always draws %s stations", (tier) => {
    expect(isStationMarkerVisible(tier, 6)).toBe(true);
    expect(isStationMarkerVisible(tier, OVERVIEW_ZOOM)).toBe(true);
    expect(isStationMarkerVisible(tier, CLOSE_ZOOM)).toBe(true);
  });

  it("draws ordinary stations only from the threshold zoom up", () => {
    expect(isStationMarkerVisible("ordinary", OVERVIEW_ZOOM)).toBe(false);
    expect(isStationMarkerVisible("ordinary", ORDINARY_STATION_MIN_ZOOM - 0.01)).toBe(false);
    expect(isStationMarkerVisible("ordinary", ORDINARY_STATION_MIN_ZOOM)).toBe(true);
    expect(isStationMarkerVisible("ordinary", CLOSE_ZOOM)).toBe(true);
  });
});

describe("zoomInterpolation", () => {
  it("builds a linear interpolate over the zoom from [zoom, value] stops", () => {
    expect(zoomInterpolation([[8, 2], [12, 4]])).toEqual(["interpolate", ["linear"], ["zoom"], 8, 2, 12, 4]);
  });
});

describe("shipped network markers", () => {
  const { network } = bundle;
  const stations = [...network.stationsById.values()];
  const tiers = classifyStations(stations, [...network.servicesById.values()], TARGET);
  const visibleAt = (zoom: number) => stations.filter((station) => isStationMarkerVisible(tiers.get(station.id)!, zoom));

  it("keeps every target-line station and a transfer hub at overview zoom, and hides ordinary stations", () => {
    const visible = new Set(visibleAt(OVERVIEW_ZOOM).map((station) => station.id));
    for (const id of network.servicesById.get(TARGET)!.stationIds) expect(visible.has(id)).toBe(true);
    expect(tiers.get("ueno")).toBe("target");
    expect(visible.size).toBeLessThan(stations.length / 2);
    expect(stations.length - visible.size).toBeGreaterThan(300);
  });

  it("draws every station at close zoom", () => {
    expect(visibleAt(CLOSE_ZOOM)).toHaveLength(stations.length);
  });

  it("lists exactly the non-ordinary stations as always-visible", () => {
    const keys = keyStationIds(tiers);
    expect(new Set(keys)).toEqual(new Set(visibleAt(OVERVIEW_ZOOM).map((station) => station.id)));
  });

  it("splits the circle layers: key stations at every zoom, ordinary ones from the threshold zoom", () => {
    const layers: Record<string, Record<string, unknown>> = {};
    const map = {
      addSource: vi.fn(),
      addLayer: (layer: { id: string }) => { layers[layer.id] = layer; },
    } as unknown as MapLibreMap;
    addRailwayLayers(map, { stations, services: [...network.servicesById.values()], targetServiceId: TARGET });
    const keyFilter = ["in", ["get", "id"], ["literal", keyStationIds(tiers)]];
    expect(layers[LAYER_IDS.stationCircles]?.filter).toEqual(keyFilter);
    expect(layers[LAYER_IDS.stationCircles]).not.toHaveProperty("minzoom");
    expect(layers[LAYER_IDS.stationCirclesOrdinary]?.filter).toEqual(["!", keyFilter]);
    expect(layers[LAYER_IDS.stationCirclesOrdinary]?.minzoom).toBe(ORDINARY_STATION_MIN_ZOOM);
    const keyPaint = layers[LAYER_IDS.stationCircles]!.paint;
    expect(keyPaint).toMatchObject({
      "circle-radius": zoomInterpolation(KEY_STATION_RADIUS_STOPS),
      "circle-stroke-width": zoomInterpolation(KEY_STATION_STROKE_STOPS),
    });
    const ordinaryPaint = layers[LAYER_IDS.stationCirclesOrdinary]!.paint;
    expect(ordinaryPaint).toMatchObject({
      "circle-radius": zoomInterpolation(ORDINARY_STATION_RADIUS_STOPS),
      "circle-stroke-width": zoomInterpolation(ORDINARY_STATION_STROKE_STOPS),
    });
  });

  it("splits collision-aware labels into key names from z11 and ordinary names from z13, with stable priority", () => {
    const layers: Record<string, Record<string, unknown>> = {};
    const order: string[] = [];
    const sources: string[] = [];
    const map = {
      addSource: (id: string) => { sources.push(id); },
      addLayer: (layer: { id: string }) => { layers[layer.id] = layer; order.push(layer.id); },
    } as unknown as MapLibreMap;
    addRailwayLayers(map, {
      stations,
      services: [...network.servicesById.values()],
      lines: bundle.data.services.ok ? bundle.data.services.value.lines : [],
      geometry: bundle.data.geometry.ok ? bundle.data.geometry.value : undefined,
      targetServiceId: TARGET,
    });
    const keyLabels = layers[LAYER_IDS.stationLabels]!;
    const ordinaryLabels = layers[LAYER_IDS.stationLabelsOrdinary]!;
    const isKeyLabel = ["==", ["get", "labelEligibleAt"], LABEL_MIN_ZOOM];

    expect(sources).toEqual(["railway-segments", "railway-stations", "game-current-position"]);
    expect(order).toHaveLength(10);
    // Placement runs top-down: key names claim their space before ordinary ones.
    expect(order.indexOf(LAYER_IDS.stationLabelsOrdinary)).toBe(order.indexOf(LAYER_IDS.stationLabels) - 1);
    expect(keyLabels).toMatchObject({ minzoom: 11, filter: isKeyLabel });
    expect(ordinaryLabels).toMatchObject({ minzoom: 13, filter: ["!", isKeyLabel] });
    for (const label of [keyLabels, ordinaryLabels]) {
      expect(label.layout).toMatchObject({
        "text-size": 12,
        "symbol-sort-key": ["get", "labelPriority"],
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      });
    }
  });

  it("shows every station name from the same zoom as the single zero-size layer did", () => {
    const layers: Record<string, { minzoom: number; filter: unknown }> = {};
    const map = {
      addSource: vi.fn(),
      addLayer: (layer: { id: string; minzoom: number; filter: unknown }) => { layers[layer.id] = layer; },
    } as unknown as MapLibreMap;
    addRailwayLayers(map, { stations, services: [...network.servicesById.values()], targetServiceId: TARGET });
    const keyLabels = layers[LAYER_IDS.stationLabels]!;
    const ordinaryLabels = layers[LAYER_IDS.stationLabelsOrdinary]!;
    // The key-label filter is ["==", ["get", "labelEligibleAt"], LABEL_MIN_ZOOM]; the ordinary one negates it.
    expect(keyLabels.filter).toEqual(["==", ["get", "labelEligibleAt"], LABEL_MIN_ZOOM]);
    const collection = buildStationCollection(stations, [...network.servicesById.values()], undefined, undefined, TARGET);

    for (const { properties } of collection.features) {
      const layer = properties.labelEligibleAt === LABEL_MIN_ZOOM ? keyLabels : ordinaryLabels;
      for (const zoom of [10.9, 11, 12.9, 13, 14]) {
        expect(zoom >= layer.minzoom).toBe(isStationLabelEligible(properties.labelTier, zoom));
      }
    }
    expect(collection.features.some((feature) => feature.properties.labelEligibleAt === LABEL_ORDINARY_MIN_ZOOM)).toBe(true);
  });

  it("draws the base track only under the target's own features", () => {
    const layers: Record<string, Record<string, unknown>> = {};
    const map = {
      addSource: vi.fn(),
      addLayer: (layer: { id: string }) => { layers[layer.id] = layer; },
    } as unknown as MapLibreMap;
    addRailwayLayers(map, {
      stations,
      services: [...network.servicesById.values()],
      geometry: bundle.data.geometry.ok ? bundle.data.geometry.value : undefined,
      targetServiceId: TARGET,
    });

    expect(layers[LAYER_IDS.base]?.filter).toEqual(["==", ["get", "serviceId"], TARGET]);
    expect(layers[LAYER_IDS.services]?.filter).toEqual(["!=", ["get", "serviceId"], TARGET]);
  });
});

describe("bindStationInteractions", () => {
  type Handler = (event: unknown) => void;
  function bind() {
    const calls: { type: string; layers: unknown; handler: Handler }[] = [];
    const canvas = { style: { cursor: "" } };
    const map = {
      on: (type: string, layers: unknown, handler: Handler) => { calls.push({ type, layers, handler }); },
      getCanvas: () => canvas,
    } as unknown as MapLibreMap;
    const onSelect = vi.fn();
    bindStationInteractions(map, onSelect);
    return { calls, canvas, onSelect };
  }

  it("registers click, mouseenter and mouseleave once each, for both circle layers together", () => {
    const { calls } = bind();
    expect(calls.map((call) => call.type)).toEqual(["click", "mouseenter", "mouseleave"]);
    for (const call of calls) expect(call.layers).toEqual([...STATION_MARKER_LAYERS]);
    expect(STATION_MARKER_LAYERS).toEqual([LAYER_IDS.stationCircles, LAYER_IDS.stationCirclesOrdinary]);
  });

  it("selects the first clicked station with its name, lines and position", () => {
    const { calls, onSelect } = bind();
    const feature = (name: string) => ({ properties: { name, lineNames: "A線" }, geometry: { type: "Point", coordinates: [139.7, 35.6] } });
    calls[0]!.handler({ features: [feature("駅1"), feature("駅2")] });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ name: "駅1", lineNames: "A線", lngLat: [139.7, 35.6] });
  });

  it("ignores a click without a point feature", () => {
    const { calls, onSelect } = bind();
    calls[0]!.handler({ features: [] });
    calls[0]!.handler({ features: [{ properties: {}, geometry: { type: "LineString", coordinates: [] } }] });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a pointer cursor while hovering and clears it on leave", () => {
    const { calls, canvas } = bind();
    calls[1]!.handler({});
    expect(canvas.style.cursor).toBe("pointer");
    calls[2]!.handler({});
    expect(canvas.style.cursor).toBe("");
  });
});
