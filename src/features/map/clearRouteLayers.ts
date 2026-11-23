import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { ClearRouteGeoJson } from "../game/clearRoute";
import { LAYER_IDS } from "./mapConfig";

export const CLEAR_ROUTE_SOURCE_ID = "clear-traveled-route";
export const CLEAR_ROUTE_LAYER_IDS = {
  outline: "clear-traveled-route-outline",
  line: "clear-traveled-route-line",
} as const;

export const CLEAR_ROUTE_OUTLINE_COLOR = "#ffffff";
export const CLEAR_ROUTE_OUTLINE_WIDTH = 9;
export const CLEAR_ROUTE_OUTLINE_OPACITY = 0.9;
export const CLEAR_ROUTE_LINE_WIDTH = 5;

/** The route is drawn below the first of these, so station markers and names stay readable above it. */
const STATION_ANCHOR_IDS: ReadonlySet<string> = new Set([
  LAYER_IDS.stationCircles,
  LAYER_IDS.stationCirclesOrdinary,
  LAYER_IDS.goalStation,
  LAYER_IDS.stationLabels,
  LAYER_IDS.stationLabelsOrdinary,
]);

interface StyleLayerRef {
  readonly id: string;
  readonly type: string;
}

/**
 * The layer the route goes below: the first station marker or name in style order, else the first symbol layer
 * of the basemap, else undefined (the route is appended on top).
 */
export function clearRouteAnchor(layers: readonly StyleLayerRef[]): string | undefined {
  return layers.find((layer) => STATION_ANCHOR_IDS.has(layer.id))?.id
    ?? layers.find((layer) => layer.type === "symbol")?.id;
}

const LINE_SHAPE = { "line-cap": "round", "line-join": "round" } as const;

function outlineLayer(): LayerSpecification {
  return {
    id: CLEAR_ROUTE_LAYER_IDS.outline,
    type: "line",
    source: CLEAR_ROUTE_SOURCE_ID,
    layout: LINE_SHAPE,
    paint: {
      "line-color": CLEAR_ROUTE_OUTLINE_COLOR,
      "line-width": CLEAR_ROUTE_OUTLINE_WIDTH,
      "line-opacity": CLEAR_ROUTE_OUTLINE_OPACITY,
    },
  };
}

function mainLayer(): LayerSpecification {
  return {
    id: CLEAR_ROUTE_LAYER_IDS.line,
    type: "line",
    source: CLEAR_ROUTE_SOURCE_ID,
    layout: LINE_SHAPE,
    paint: { "line-color": ["get", "color"], "line-width": CLEAR_ROUTE_LINE_WIDTH },
  };
}

/**
 * Show `data` on the map: update the source when the route is already there, otherwise add the source, the
 * casing and the main line. Returns false while the style is not loaded, so nothing is written to a style that
 * the next reload would replace anyway.
 */
export function applyClearRouteLayers(map: MapLibreMap, data: ClearRouteGeoJson): boolean {
  const layers = map.getStyle()?.layers;
  if (!layers) return false;
  const source = map.getSource<GeoJSONSource>(CLEAR_ROUTE_SOURCE_ID);
  if (source) {
    source.setData(data);
    return true;
  }
  map.addSource(CLEAR_ROUTE_SOURCE_ID, { type: "geojson", data: data });
  const beforeId = clearRouteAnchor(layers);
  map.addLayer(outlineLayer(), beforeId);
  map.addLayer(mainLayer(), beforeId);
  return true;
}

/** Remove the layers, then the source; absent parts (for example after a style replacement) are skipped. */
export function removeClearRouteLayers(map: MapLibreMap): void {
  for (const id of [CLEAR_ROUTE_LAYER_IDS.line, CLEAR_ROUTE_LAYER_IDS.outline]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(CLEAR_ROUTE_SOURCE_ID)) map.removeSource(CLEAR_ROUTE_SOURCE_ID);
}
