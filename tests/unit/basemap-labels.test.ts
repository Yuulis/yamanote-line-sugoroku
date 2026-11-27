import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import {
  applyBasemapLabelFocus,
  buildBasemapLabelPatches,
  BASEMAP_ICON_OPACITY_FACTOR,
  BASEMAP_TEXT_OPACITY_FACTOR,
} from "../../src/features/map/basemapLabels";

function layer(id: string, type: string, paint?: Record<string, unknown>): LayerSpecification {
  return { id, type, source: "places", paint } as unknown as LayerSpecification;
}

function patchFor(
  patches: ReturnType<typeof buildBasemapLabelPatches>,
  layerId: string,
  property: "text-opacity" | "icon-opacity",
) {
  return patches.find((patch) => patch.layerId === layerId && patch.property === property);
}

function styleWithOpacity(value: unknown, property: "text-opacity" | "icon-opacity"): Parameters<typeof validateStyleMin>[0] {
  const layout = property === "text-opacity"
    ? { "text-field": ["get", "name"] }
    : { "icon-image": ["get", "icon"] };
  return {
    version: 8,
    sources: {
      places: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
    },
    layers: [{
      id: "labels",
      type: "symbol",
      source: "places",
      layout,
      paint: { [property]: value },
    }],
  } as unknown as Parameters<typeof validateStyleMin>[0];
}

describe("basemap label opacity patches", () => {
  it("scales omitted defaults and numeric constants from their original values", () => {
    const patches = buildBasemapLabelPatches([
      layer("default-labels", "symbol"),
      layer("custom-labels", "symbol", { "text-opacity": 0.8, "icon-opacity": 0.4 }),
    ], { text: BASEMAP_TEXT_OPACITY_FACTOR, icon: BASEMAP_ICON_OPACITY_FACTOR });

    expect(patchFor(patches, "default-labels", "text-opacity")).toMatchObject({
      originalValue: undefined,
      value: 0.75,
    });
    expect(patchFor(patches, "default-labels", "icon-opacity")).toMatchObject({
      originalValue: undefined,
      value: 0.65,
    });
    expect(patchFor(patches, "custom-labels", "text-opacity")).toMatchObject({
      originalValue: 0.8,
      value: 0.6,
    });
    expect(patchFor(patches, "custom-labels", "icon-opacity")).toMatchObject({
      originalValue: 0.4,
      value: 0.26,
    });
  });

  it("wraps data expressions and scales outputs of zoom expressions inside let", () => {
    const dataExpression: ExpressionSpecification = ["case", ["has", "visible"], 1, 0.5];
    const zoomExpression: ExpressionSpecification = [
      "let", "unused", 1,
      ["interpolate", ["linear"], ["zoom"], 5, 0.8, 10, 0.4],
    ];
    const stepExpression: ExpressionSpecification = ["step", ["zoom"], 0.8, 8, 0.4];
    const patches = buildBasemapLabelPatches([
      layer("data-labels", "symbol", { "text-opacity": dataExpression }),
      layer("zoom-labels", "symbol", { "text-opacity": zoomExpression }),
      layer("step-labels", "symbol", { "text-opacity": stepExpression }),
    ], { text: BASEMAP_TEXT_OPACITY_FACTOR, icon: BASEMAP_ICON_OPACITY_FACTOR });
    const dataPatch = patchFor(patches, "data-labels", "text-opacity");
    const zoomPatch = patchFor(patches, "zoom-labels", "text-opacity");
    const stepPatch = patchFor(patches, "step-labels", "text-opacity");

    expect(dataPatch?.value).toEqual(["*", dataExpression, 0.75]);
    expect(zoomPatch?.value).toEqual([
      "let", "unused", 1,
      ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 0.3],
    ]);
    expect(stepPatch?.value).toEqual(["step", ["zoom"], 0.6, 8, 0.3]);
    expect(validateStyleMin(styleWithOpacity(dataPatch?.value, "text-opacity"))).toEqual([]);
    expect(validateStyleMin(styleWithOpacity(zoomPatch?.value, "text-opacity"))).toEqual([]);
    expect(validateStyleMin(styleWithOpacity(stepPatch?.value, "text-opacity"))).toEqual([]);
  });

  it("skips unsafe values and leaves non-symbol layers untouched", () => {
    const patches = buildBasemapLabelPatches([
      layer("unsafe-labels", "symbol", { "text-opacity": "transparent", "icon-opacity": null }),
      layer("basemap-fill", "fill", { "text-opacity": 0.3, "icon-opacity": 0.4 }),
    ], { text: BASEMAP_TEXT_OPACITY_FACTOR, icon: BASEMAP_ICON_OPACITY_FACTOR });

    expect(patches).toEqual([]);
  });

  it("uses each replacement style's own opacity baseline", () => {
    const original = buildBasemapLabelPatches([
      layer("labels", "symbol", { "text-opacity": 0.8 }),
    ], { text: BASEMAP_TEXT_OPACITY_FACTOR, icon: BASEMAP_ICON_OPACITY_FACTOR });
    const replacement = buildBasemapLabelPatches([
      layer("labels", "symbol", { "text-opacity": 0.4 }),
    ], { text: BASEMAP_TEXT_OPACITY_FACTOR, icon: BASEMAP_ICON_OPACITY_FACTOR });

    expect(patchFor(original, "labels", "text-opacity")).toMatchObject({ originalValue: 0.8, value: 0.6 });
    expect(patchFor(replacement, "labels", "text-opacity")).toMatchObject({ originalValue: 0.4, value: 0.3 });
  });

  it("toggles focus and restores omitted values, while skipping missing layers", () => {
    const patches = buildBasemapLabelPatches([
      layer("visible-labels", "symbol", { "text-opacity": 0.4 }),
      layer("default-labels", "symbol"),
      layer("removed-labels", "symbol", { "text-opacity": 0.2 }),
    ], { text: BASEMAP_TEXT_OPACITY_FACTOR, icon: BASEMAP_ICON_OPACITY_FACTOR });
    const writes: Array<[string, string, unknown]> = [];
    const existing = new Set(["visible-labels", "default-labels"]);
    const map = {
      getLayer: (id: string) => existing.has(id) ? { id } : undefined,
      setPaintProperty: (id: string, property: string, value: unknown) => writes.push([id, property, value]),
    } as unknown as MapLibreMap;

    applyBasemapLabelFocus(map, patches, true);
    expect(writes).toEqual([
      ["visible-labels", "text-opacity", 0.3],
      ["visible-labels", "icon-opacity", 0.65],
      ["default-labels", "text-opacity", 0.75],
      ["default-labels", "icon-opacity", 0.65],
    ]);

    writes.length = 0;
    applyBasemapLabelFocus(map, patches, false);
    expect(writes).toEqual([
      ["visible-labels", "text-opacity", 0.4],
      ["visible-labels", "icon-opacity", undefined],
      ["default-labels", "text-opacity", undefined],
      ["default-labels", "icon-opacity", undefined],
    ]);

    writes.length = 0;
    const missingMap = {
      getLayer: vi.fn(() => undefined),
      setPaintProperty: vi.fn(),
    } as unknown as MapLibreMap;
    applyBasemapLabelFocus(missingMap, patches, true);
    expect(missingMap.getLayer).toHaveBeenCalledTimes(patches.length);
    expect(missingMap.setPaintProperty).not.toHaveBeenCalled();
  });
});
