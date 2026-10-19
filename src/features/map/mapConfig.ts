// Single place to swap the background map provider (spec section 7).

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Roughly the centre of the Yamanote loop: [longitude, latitude]. */
export const MAP_CENTER: [number, number] = [139.733, 35.69];
export const MAP_ZOOM = 11.5;
/** Zoom bounds: keep the loop findable and avoid zooming past useful detail. */
export const MAP_MIN_ZOOM = 6;
export const MAP_MAX_ZOOM = 17;
/** Must match the phone breakpoint in styles.css. */
export const PHONE_MEDIA_QUERY = "(max-width: 600px)";

/** True on a phone-width viewport; false when there is no window to measure. */
export function isPhoneWidth(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

/** Camera glide when following the marker outside an animation. */
export const FOLLOW_EASE_MS = 500;

/** Background map credits for the title screen (the map also shows its own). */
export const MAP_CREDITS = [
  { label: "OpenFreeMap", url: "https://openfreemap.org/" },
  { label: "© OpenMapTiles", url: "https://www.openmaptiles.org/" },
  { label: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
] as const;

export const SOURCE_IDS = {
  segments: "railway-segments",
  stations: "railway-stations",
  currentPosition: "game-current-position",
} as const;

export const LAYER_IDS = {
  services: "railway-services",
  base: "railway-base",
  currentService: "railway-current-service",
  /** Not yet traversed: grey dashed line. */
  segmentsPending: "railway-segments-pending",
  /** Traversed: solid line in the service colour. */
  segmentsCompleted: "railway-segments-completed",
  /** Transfer and target-line stations: marked at every zoom. */
  stationCircles: "railway-stations-circle",
  /** Every other station: marked from ORDINARY_STATION_MIN_ZOOM up. */
  stationCirclesOrdinary: "railway-stations-circle-ordinary",
  stationLabels: "railway-stations-label",
  currentPosition: "game-current-position-circle",
} as const;

export const FALLBACK_LINE_COLOR = "#80c241";
export const SEGMENT_LINE_WIDTH = 5;
/** Other services remain visible beside the target's shared N02 track shape. */
export const OTHER_SERVICE_LINE_WIDTH = 3;
export const OTHER_SERVICE_LINE_OPACITY = 0.65;
export const CURRENT_SERVICE_LINE_WIDTH = 7;
export const NETWORK_FIT_PADDING_DESKTOP = { top: 60, right: 70, bottom: 50, left: 340 };
export const NETWORK_FIT_PADDING_PHONE = { top: 100, right: 60, left: 20 };
export const PHONE_PANEL_MAX_HEIGHT_SHARE = 0.45;
export const NETWORK_FIT_PANEL_GAP = 16;
export const PENDING_SEGMENT_COLOR = "#8a8a8a";
export const PENDING_SEGMENT_WIDTH = 3;
/** Dash and gap lengths, in line widths. */
export const PENDING_SEGMENT_DASH: [number, number] = [2, 1.5];
export const CURRENT_POSITION_RADIUS = 10;
export const CURRENT_POSITION_COLOR = "#e53935";
export const CURRENT_POSITION_STROKE_COLOR = "#ffffff";
export const CURRENT_POSITION_STROKE_WIDTH = 3;
/** A station served by at least this many services is a transfer station. */
export const TRANSFER_MIN_SERVICES = 2;
/** Below this zoom only transfer and target-line stations are marked, so the lines stay readable. */
export const ORDINARY_STATION_MIN_ZOOM = 10.5;
/** [zoom, value] stops, linearly interpolated; the first/last value holds beyond the ends. */
export type ZoomStops = readonly (readonly [number, number])[];
export const KEY_STATION_RADIUS_STOPS: ZoomStops = [[8, 2.5], [11, 4], [13, 5]];
export const KEY_STATION_STROKE_STOPS: ZoomStops = [[8, 1], [12, 2]];
export const ORDINARY_STATION_RADIUS_STOPS: ZoomStops = [[ORDINARY_STATION_MIN_ZOOM, 2.5], [13, 4], [14, 5]];
export const ORDINARY_STATION_STROKE_STOPS: ZoomStops = [[ORDINARY_STATION_MIN_ZOOM, 1], [13, 2]];
export const STATION_STROKE_COLOR = "#333333";
export const STATION_FILL_COLOR = "#ffffff";
export const LABEL_FONT = ["Noto Sans Regular"];
export const LABEL_SIZE = 12;
export const LABEL_OFFSET_EM = 1.1;
export const LABEL_HALO_COLOR = "#ffffff";
export const LABEL_HALO_WIDTH = 1.5;
export const LABEL_MIN_ZOOM = 11;
export const LABEL_ORDINARY_MIN_ZOOM = 13;
export const LINE_NAME_SEPARATOR = "、";
