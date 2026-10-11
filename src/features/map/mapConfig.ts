// Single place to swap the background map provider (spec section 7).

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Roughly the centre of the Yamanote loop: [longitude, latitude]. */
export const MAP_CENTER: [number, number] = [139.733, 35.69];
export const MAP_ZOOM = 11.5;

export const SOURCE_IDS = {
  segments: "railway-segments",
  stations: "railway-stations",
} as const;

export const LAYER_IDS = {
  segments: "railway-segments-line",
  stationCircles: "railway-stations-circle",
  stationLabels: "railway-stations-label",
} as const;

export const FALLBACK_LINE_COLOR = "#80c241";
export const SEGMENT_LINE_WIDTH = 5;
export const STATION_RADIUS = 5;
export const STATION_STROKE_WIDTH = 2;
export const STATION_STROKE_COLOR = "#333333";
export const STATION_FILL_COLOR = "#ffffff";
export const LABEL_FONT = ["Noto Sans Regular"];
export const LABEL_SIZE = 12;
export const LABEL_OFFSET_EM = 1.1;
export const LABEL_HALO_COLOR = "#ffffff";
export const LABEL_HALO_WIDTH = 1.5;
export const LABEL_MIN_ZOOM = 10;
export const LINE_NAME_SEPARATOR = "、";
