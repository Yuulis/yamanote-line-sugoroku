// Single place to swap the background map provider (spec section 7).

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Roughly the centre of the Yamanote loop: [longitude, latitude]. */
export const MAP_CENTER: [number, number] = [139.733, 35.69];
export const MAP_ZOOM = 11.5;

export const SOURCE_IDS = {
  segments: "railway-segments",
  stations: "railway-stations",
  currentPosition: "game-current-position",
} as const;

export const LAYER_IDS = {
  /** Not yet traversed: grey dashed line. */
  segmentsPending: "railway-segments-pending",
  /** Traversed: solid line in the service colour. */
  segmentsCompleted: "railway-segments-completed",
  stationCircles: "railway-stations-circle",
  stationLabels: "railway-stations-label",
  currentPosition: "game-current-position-circle",
} as const;

export const FALLBACK_LINE_COLOR = "#80c241";
export const SEGMENT_LINE_WIDTH = 5;
export const PENDING_SEGMENT_COLOR = "#8a8a8a";
export const PENDING_SEGMENT_WIDTH = 3;
/** Dash and gap lengths, in line widths. */
export const PENDING_SEGMENT_DASH: [number, number] = [2, 1.5];
export const CURRENT_POSITION_RADIUS = 10;
export const CURRENT_POSITION_COLOR = "#e53935";
export const CURRENT_POSITION_STROKE_COLOR = "#ffffff";
export const CURRENT_POSITION_STROKE_WIDTH = 3;
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
