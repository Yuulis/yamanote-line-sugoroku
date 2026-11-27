import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { buildCorridorOffsets } from "../../src/features/map/corridorOffsets";
import { createCorridorOffsetMemo } from "../../src/features/map/corridorOffsetMemo";
import { LAYER_IDS, SOURCE_IDS } from "../../src/features/map/mapConfig";
import { addRailwayLayers } from "../../src/features/map/railwayLayers";
import type { Position, SegmentFeature, SegmentFeatureCollection } from "../../src/types/data";

const geometry: SegmentFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "service-a:edge",
      properties: { featureId: "shared-edge", serviceId: "service-a", lineId: "line-a", from: "a", to: "b" },
      geometry: { type: "LineString", coordinates: [[139, 35], [139.1, 35.1]] as Position[] },
    } satisfies SegmentFeature,
  ],
};

function railwayMap(): { map: MapLibreMap; sources: Record<string, { data: unknown }>; layers: Record<string, Record<string, unknown>> } {
  const sources: Record<string, { data: unknown }> = {};
  const layers: Record<string, Record<string, unknown>> = {};
  return {
    sources,
    layers,
    map: {
      addSource: (id: string, source: { data: unknown }) => { sources[id] = source; },
      addLayer: (layer: { id: string }) => { layers[layer.id] = layer; },
    } as unknown as MapLibreMap,
  };
}

describe("corridor offset memo", () => {
  it("reuses the result for the same geometry identity and target, then recomputes for a new target", () => {
    const build = vi.fn((input: SegmentFeatureCollection, target: string) => buildCorridorOffsets(input, target));
    const memo = createCorridorOffsetMemo(build, vi.fn());

    const first = memo.get(geometry, "service-a");
    const reused = memo.get(geometry, "service-a");
    const newTarget = memo.get(geometry, "service-b");

    expect(reused).toBe(first);
    expect(newTarget).not.toBe(first);
    const evictedTarget = memo.get(geometry, "service-a");
    expect(evictedTarget).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(3);
    expect(build).toHaveBeenNthCalledWith(1, geometry, "service-a");
    expect(build).toHaveBeenNthCalledWith(2, geometry, "service-b");
    expect(build).toHaveBeenNthCalledWith(3, geometry, "service-a");
  });

  it("reuses the same derived source after a style reload", () => {
    const build = vi.fn((input: SegmentFeatureCollection, target: string) => buildCorridorOffsets(input, target));
    const memo = createCorridorOffsetMemo(build, vi.fn());
    const firstStyle = railwayMap();
    const firstDerived = memo.get(geometry, "service-a");
    addRailwayLayers(firstStyle.map, { geometry, corridorGeometry: firstDerived ?? undefined });

    // A style reload removes the custom source and layers; the same component memo serves the new style.
    const reloadedStyle = railwayMap();
    const reloadedDerived = memo.get(geometry, "service-a");
    addRailwayLayers(reloadedStyle.map, { geometry, corridorGeometry: reloadedDerived ?? undefined });

    expect(build).toHaveBeenCalledTimes(1);
    expect(reloadedDerived).toBe(firstDerived);
    expect(firstStyle.sources[SOURCE_IDS.corridorSegments]?.data).toBe(firstDerived);
    expect(reloadedStyle.sources[SOURCE_IDS.corridorSegments]?.data).toBe(firstDerived);
    expect(reloadedStyle.layers[LAYER_IDS.services]?.source).toBe(SOURCE_IDS.corridorSegments);
  });

  it("falls back to the canonical source and warns once when derivation throws", () => {
    const error = new Error("bad geometry");
    const warn = vi.fn();
    const memo = createCorridorOffsetMemo(() => { throw error; }, warn);
    const result = memo.get(geometry, "service-a");
    const repeatedFailure = memo.get(geometry, "service-a");
    const style = railwayMap();

    addRailwayLayers(style.map, { geometry, corridorGeometry: result ?? undefined });

    expect(result).toBeNull();
    expect(repeatedFailure).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Map data unavailable: could not derive shared-track offsets; using canonical geometry.",
      error,
    );
    expect(style.sources[SOURCE_IDS.segments]?.data).toBe(geometry);
    expect(style.sources).not.toHaveProperty(SOURCE_IDS.corridorSegments);
    expect(style.layers[LAYER_IDS.services]?.source).toBe(SOURCE_IDS.segments);
  });
});
