import type { Map as MapLibreMap } from "maplibre-gl";
import type { SegmentFeatureCollection } from "../../types/data";
import type { ServicePattern, Station } from "../../types/network";
import { buildLineColorExpression } from "./lineColor";
import {
  LABEL_FONT,
  LABEL_HALO_COLOR,
  LABEL_HALO_WIDTH,
  LABEL_MIN_ZOOM,
  LABEL_OFFSET_EM,
  LABEL_SIZE,
  LAYER_IDS,
  SEGMENT_LINE_WIDTH,
  SOURCE_IDS,
  STATION_FILL_COLOR,
  STATION_RADIUS,
  STATION_STROKE_COLOR,
  STATION_STROKE_WIDTH,
} from "./mapConfig";
import { buildStationCollection } from "./stationCollection";

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
      id: LAYER_IDS.segments,
      type: "line",
      source: SOURCE_IDS.segments,
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
}
