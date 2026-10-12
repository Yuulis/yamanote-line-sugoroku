import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Position, SegmentFeatureCollection } from "../../types/data";
import type { ServicePattern, Station } from "../../types/network";
import { buildLineColorExpression } from "./lineColor";
import {
  CURRENT_POSITION_COLOR,
  CURRENT_POSITION_RADIUS,
  CURRENT_POSITION_STROKE_COLOR,
  CURRENT_POSITION_STROKE_WIDTH,
  LABEL_FONT,
  LABEL_HALO_COLOR,
  LABEL_HALO_WIDTH,
  LABEL_MIN_ZOOM,
  LABEL_OFFSET_EM,
  LABEL_SIZE,
  LAYER_IDS,
  OTHER_SERVICE_LINE_OFFSET,
  OTHER_SERVICE_LINE_OPACITY,
  OTHER_SERVICE_LINE_WIDTH,
  PENDING_SEGMENT_COLOR,
  PENDING_SEGMENT_DASH,
  PENDING_SEGMENT_WIDTH,
  SEGMENT_LINE_WIDTH,
  SOURCE_IDS,
  STATION_FILL_COLOR,
  STATION_RADIUS,
  STATION_STROKE_COLOR,
  STATION_STROKE_WIDTH,
} from "./mapConfig";
import {
  completedSegmentFilter,
  currentPositionCollection,
  pendingSegmentFilter,
} from "./progressStyle";
import { buildStationCollection } from "./stationCollection";

/** Game progress drawn on the map. */
export interface MapProgress {
  completedFeatureIds: readonly string[];
  currentPosition: Position | null;
}

export interface RailwayLayerInput {
  stations?: readonly Station[];
  services?: readonly ServicePattern[];
  geometry?: SegmentFeatureCollection;
}

/** Add whichever railway layers the available data allows. */
export function addRailwayLayers(
  map: MapLibreMap,
  { stations, services = [], geometry }: RailwayLayerInput,
): void {
  if (geometry) {
    map.addSource(SOURCE_IDS.segments, { type: "geojson", data: geometry });
    map.addLayer({
      id: LAYER_IDS.services,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: ["!=", ["get", "serviceId"], "jr-yamanote"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": buildLineColorExpression(services),
        "line-width": OTHER_SERVICE_LINE_WIDTH,
        "line-opacity": OTHER_SERVICE_LINE_OPACITY,
        "line-offset": OTHER_SERVICE_LINE_OFFSET,
      },
    });
    // Two layers so progress is told by line style as well as colour (spec 6.3).
    map.addLayer({
      id: LAYER_IDS.segmentsPending,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: pendingSegmentFilter([]),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": PENDING_SEGMENT_COLOR,
        "line-width": PENDING_SEGMENT_WIDTH,
        "line-dasharray": PENDING_SEGMENT_DASH,
      },
    });
    map.addLayer({
      id: LAYER_IDS.segmentsCompleted,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: completedSegmentFilter([]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": buildLineColorExpression(services),
        "line-width": SEGMENT_LINE_WIDTH,
      },
    });
  }
  if (stations) {
    map.addSource(SOURCE_IDS.stations, {
      type: "geojson",
      data: buildStationCollection(stations, services),
    });
    map.addLayer({
      id: LAYER_IDS.stationCircles,
      type: "circle",
      source: SOURCE_IDS.stations,
      paint: {
        "circle-radius": STATION_RADIUS,
        "circle-color": STATION_FILL_COLOR,
        "circle-stroke-color": STATION_STROKE_COLOR,
        "circle-stroke-width": STATION_STROKE_WIDTH,
      },
    });
    map.addLayer({
      id: LAYER_IDS.stationLabels,
      type: "symbol",
      source: SOURCE_IDS.stations,
      minzoom: LABEL_MIN_ZOOM,
      layout: {
        "text-field": ["get", "name"],
        "text-font": LABEL_FONT,
        "text-size": LABEL_SIZE,
        "text-offset": [0, LABEL_OFFSET_EM],
        "text-anchor": "top",
      },
      paint: {
        "text-color": STATION_STROKE_COLOR,
        "text-halo-color": LABEL_HALO_COLOR,
        "text-halo-width": LABEL_HALO_WIDTH,
      },
    });
  }
  map.addSource(SOURCE_IDS.currentPosition, {
    type: "geojson",
    data: currentPositionCollection(null),
  });
  map.addLayer({
    id: LAYER_IDS.currentPosition,
    type: "circle",
    source: SOURCE_IDS.currentPosition,
    paint: {
      "circle-radius": CURRENT_POSITION_RADIUS,
      "circle-color": CURRENT_POSITION_COLOR,
      "circle-stroke-color": CURRENT_POSITION_STROKE_COLOR,
      "circle-stroke-width": CURRENT_POSITION_STROKE_WIDTH,
    },
  });
}

/** Restyle segments as completed / pending; skips layers that failed to load. */
export function updateCompletedSegments(
  map: MapLibreMap,
  completedFeatureIds: readonly string[],
): void {
  if (!map.getLayer(LAYER_IDS.segmentsCompleted)) return;
  map.setFilter(LAYER_IDS.segmentsCompleted, completedSegmentFilter(completedFeatureIds));
  map.setFilter(LAYER_IDS.segmentsPending, pendingSegmentFilter(completedFeatureIds));
}

/** Move the player marker (called on every animation frame). */
export function updateCurrentPosition(map: MapLibreMap, position: Position | null): void {
  const source = map.getSource<GeoJSONSource>(SOURCE_IDS.currentPosition);
  source?.setData(currentPositionCollection(position));
}
