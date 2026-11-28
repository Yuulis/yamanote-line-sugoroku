import { describe, expect, it } from "vitest";
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

function payload(targetServiceId: string) {
  const result = buildCorridorOffsets(geometry, targetServiceId);
  return { geoJson: new Blob([JSON.stringify(result)], { type: "application/geo+json" }), derivedCount: result.features.length };
}

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
  it("stores one successful worker result by geometry identity and target", () => {
    const memo = createCorridorOffsetMemo();
    const first = payload("service-a");
    const replacement = payload("service-b");

    expect(memo.get(geometry, "service-a")).toBeNull();
    memo.set(geometry, "service-a", first);
    expect(memo.get(geometry, "service-a")).toBe(first);
    expect(memo.get(geometry, "service-b")).toBeNull();
    memo.set(geometry, "service-b", replacement);
    expect(memo.get(geometry, "service-a")).toBeNull();
    expect(memo.get(geometry, "service-b")).toBe(replacement);
  });

  it("reuses the cached result after a style reload without requesting derivation again", () => {
    const memo = createCorridorOffsetMemo();
    const firstStyle = railwayMap();
    const firstDerived = payload("service-a");
    memo.set(geometry, "service-a", firstDerived);
    addRailwayLayers(firstStyle.map, {
      geometry,
      corridorGeometry: memo.get(geometry, "service-a") ? "blob:cached-offsets" : geometry,
    });

    // A replacement style gets a fresh source, but the module memo supplies the same object.
    const reloadedStyle = railwayMap();
    const reloadedDerived = memo.get(geometry, "service-a");
    addRailwayLayers(reloadedStyle.map, {
      geometry,
      corridorGeometry: reloadedDerived ? "blob:cached-offsets" : geometry,
    });

    expect(reloadedDerived).toBe(firstDerived);
    expect(firstStyle.sources[SOURCE_IDS.corridorSegments]?.data).toBe("blob:cached-offsets");
    expect(reloadedStyle.sources[SOURCE_IDS.corridorSegments]?.data).toBe("blob:cached-offsets");
    expect(reloadedStyle.layers[LAYER_IDS.services]?.source).toBe(SOURCE_IDS.corridorSegments);
  });

  it("starts with canonical data when no successful worker result is cached", () => {
    const memo = createCorridorOffsetMemo();
    const style = railwayMap();
    addRailwayLayers(style.map, {
      geometry,
      corridorGeometry: memo.get(geometry, "service-a") ? "blob:cached-offsets" : geometry,
    });

    expect(style.sources[SOURCE_IDS.segments]?.data).toBe(geometry);
    expect(style.sources[SOURCE_IDS.corridorSegments]?.data).toBe(geometry);
    expect(style.layers[LAYER_IDS.services]?.source).toBe(SOURCE_IDS.corridorSegments);
  });
});
