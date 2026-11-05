import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { Position, SegmentFeatureCollection } from "../../types/data";
import type { LineMetadata, ServicePattern, Station } from "../../types/network";
import type { PresentationResolver } from "../game/presentationResolver";
import { DEFAULT_GAME_CONFIG } from "../game/gameConfig";
import { buildLineColorExpression, buildTrackColorExpression } from "./lineColor";
import { targetTrackFilter } from "./lineVisibility";
import {
  CURRENT_POSITION_COLOR,
  CURRENT_POSITION_RADIUS,
  CURRENT_POSITION_STROKE_COLOR,
  CURRENT_POSITION_STROKE_WIDTH,
  CURRENT_SERVICE_LINE_WIDTH,
  KEY_STATION_RADIUS_STOPS,
  KEY_STATION_STROKE_STOPS,
  LABEL_MIN_ZOOM,
  LABEL_ORDINARY_MIN_ZOOM,
  LABEL_FONT,
  LABEL_HALO_COLOR,
  LABEL_HALO_WIDTH,
  LABEL_OFFSET_EM,
  LABEL_SIZE,
  LAYER_IDS,
  ORDINARY_STATION_MIN_ZOOM,
  ORDINARY_STATION_RADIUS_STOPS,
  ORDINARY_STATION_STROKE_STOPS,
  OTHER_SERVICE_LINE_OPACITY,
  OTHER_SERVICE_LINE_WIDTH,
  PENDING_SEGMENT_COLOR,
  PENDING_SEGMENT_DASH,
  PENDING_SEGMENT_WIDTH,
  SEGMENT_FLASH_COLOR,
  SEGMENT_FLASH_LINE_BLUR,
  SEGMENT_FLASH_LINE_WIDTH,
  SEGMENT_FLASH_MAX_OPACITY,
  SEGMENT_LINE_WIDTH,
  SOURCE_IDS,
  STATION_FILL_COLOR,
  STATION_STROKE_COLOR,
} from "./mapConfig";
import {
  completedSegmentFilter,
  currentPositionCollection,
  pendingSegmentFilter,
} from "./progressStyle";
import { buildStationCollection } from "./stationCollection";
import { classifyStations, keyStationIds, zoomInterpolation } from "./stationMarkers";
import type { MapPresentationIndex } from "./mapPresentation";

/** Game progress drawn on the map. */
export interface MapProgress {
  completedFeatureIds: readonly string[];
  currentPosition: Position | null;
  highlightedServiceId?: string;
}

/**
 * One arrival's flash of newly completed target segments. `key` is the reveal key (one flash per arrival),
 * `featureIds` the geometry features of the segments the accepted record newly completed, and `durationMs` the
 * arrival duration captured with the roll.
 */
export interface SegmentFlashRequest {
  key: string;
  featureIds: readonly string[];
  durationMs: number;
}

export interface RailwayLayerInput {
  stations?: readonly Station[];
  services?: readonly ServicePattern[];
  geometry?: SegmentFeatureCollection;
  lines?: readonly LineMetadata[];
  targetServiceId?: string;
  presentation?: Pick<
    PresentationResolver,
    "stationName" | "serviceStationName" | "serviceName" | "lineGroupId" | "lineGroupColor"
  >;
  presentationIndex?: MapPresentationIndex;
}

/** Add whichever railway layers the available data allows. */
export function addRailwayLayers(
  map: MapLibreMap,
  {
    stations,
    services = [],
    lines = [],
    geometry,
    targetServiceId = DEFAULT_GAME_CONFIG.targetServiceId,
    presentation,
    presentationIndex,
  }: RailwayLayerInput,
): void {
  if (geometry) {
    map.addSource(SOURCE_IDS.segments, { type: "geojson", data: geometry });
    // Track under the target's dashed pending line; every other feature is
    // drawn by the service layer above, so drawing it here too is wasted work.
    map.addLayer({
      id: LAYER_IDS.base,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: targetTrackFilter(null, targetServiceId),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": buildTrackColorExpression(lines, services, presentation), "line-width": 2, "line-opacity": 0.5 },
    });
    map.addLayer({
      id: LAYER_IDS.services,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: ["!=", ["get", "serviceId"], targetServiceId],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": buildTrackColorExpression(lines, services, presentation),
        "line-width": OTHER_SERVICE_LINE_WIDTH,
        "line-opacity": OTHER_SERVICE_LINE_OPACITY,
      },
    });
    map.addLayer({
      id: LAYER_IDS.currentService,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: ["in", ["get", "featureId"], ["literal", []]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#80c241", "line-width": CURRENT_SERVICE_LINE_WIDTH },
    });
    // Two layers so progress is told by line style as well as colour (spec 6.3).
    map.addLayer({
      id: LAYER_IDS.segmentsPending,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: pendingSegmentFilter([], targetServiceId),
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
      filter: completedSegmentFilter([], targetServiceId),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": buildLineColorExpression(services, presentation),
        "line-width": SEGMENT_LINE_WIDTH,
      },
    });
    // Above the completed line, below the stations: starts empty and transparent until an arrival flashes.
    map.addLayer({
      id: LAYER_IDS.segmentsFlash,
      type: "line",
      source: SOURCE_IDS.segments,
      filter: completedSegmentFilter([], targetServiceId),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": SEGMENT_FLASH_COLOR,
        "line-width": SEGMENT_FLASH_LINE_WIDTH,
        "line-blur": SEGMENT_FLASH_LINE_BLUR,
        "line-opacity": 0,
      },
    });
  }
  if (stations) {
    map.addSource(SOURCE_IDS.stations, {
      type: "geojson",
      data: buildStationCollection(
        stations,
        services,
        presentation,
        presentationIndex?.serviceIdsByStation,
        targetServiceId,
      ),
    });
    const isKeyStation: ExpressionSpecification = [
      "in",
      ["get", "id"],
      ["literal", keyStationIds(classifyStations(
        stations,
        services,
        targetServiceId,
        presentationIndex?.serviceIdsByStation,
      ))],
    ];
    const isKeyLabel: ExpressionSpecification = ["==", ["get", "labelEligibleAt"], LABEL_MIN_ZOOM];
    // Ordinary stations first so the always-visible markers are drawn on top.
    map.addLayer({
      id: LAYER_IDS.stationCirclesOrdinary,
      type: "circle",
      source: SOURCE_IDS.stations,
      minzoom: ORDINARY_STATION_MIN_ZOOM,
      filter: ["!", isKeyStation],
      paint: {
        "circle-radius": zoomInterpolation(ORDINARY_STATION_RADIUS_STOPS),
        "circle-color": STATION_FILL_COLOR,
        "circle-stroke-color": STATION_STROKE_COLOR,
        "circle-stroke-width": zoomInterpolation(ORDINARY_STATION_STROKE_STOPS),
      },
    });
    map.addLayer({
      id: LAYER_IDS.stationCircles,
      type: "circle",
      source: SOURCE_IDS.stations,
      filter: isKeyStation,
      paint: {
        "circle-radius": zoomInterpolation(KEY_STATION_RADIUS_STOPS),
        "circle-color": STATION_FILL_COLOR,
        "circle-stroke-color": STATION_STROKE_COLOR,
        "circle-stroke-width": zoomInterpolation(KEY_STATION_STROKE_STOPS),
      },
    });
    // Ordinary names below key ones, so key names are placed first; separate
    // layers (not a zero text-size) keep hidden names from being shaped at all.
    map.addLayer(stationLabelLayer(LAYER_IDS.stationLabelsOrdinary, LABEL_ORDINARY_MIN_ZOOM, ["!", isKeyLabel]));
    map.addLayer(stationLabelLayer(LAYER_IDS.stationLabels, LABEL_MIN_ZOOM, isKeyLabel));
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

/** Collision-aware station names of one tier, shown from `minzoom` up. */
function stationLabelLayer(
  id: string,
  minzoom: number,
  filter: ExpressionSpecification,
): SymbolLayerSpecification {
  return {
    id,
    type: "symbol",
    source: SOURCE_IDS.stations,
    minzoom,
    filter,
    layout: {
      "text-field": ["get", "name"],
      "text-font": LABEL_FONT,
      "text-offset": [0, LABEL_OFFSET_EM],
      "text-anchor": "top",
      "text-size": LABEL_SIZE,
      "symbol-sort-key": ["get", "labelPriority"],
      "text-allow-overlap": false,
      "text-ignore-placement": false,
    },
    paint: {
      "text-color": STATION_STROKE_COLOR,
      "text-halo-color": LABEL_HALO_COLOR,
      "text-halo-width": LABEL_HALO_WIDTH,
    },
  };
}

/** Restyle segments as completed / pending; skips layers that failed to load. */
export function updateCompletedSegments(
  map: MapLibreMap,
  completedFeatureIds: readonly string[],
  targetServiceId = DEFAULT_GAME_CONFIG.targetServiceId,
): void {
  if (!map.getLayer(LAYER_IDS.segmentsCompleted)) return;
  map.setFilter(LAYER_IDS.segmentsCompleted, completedSegmentFilter(completedFeatureIds, targetServiceId));
  map.setFilter(LAYER_IDS.segmentsPending, pendingSegmentFilter(completedFeatureIds, targetServiceId));
}

/** Move the player marker (called on every animation frame). */
export function updateCurrentPosition(map: MapLibreMap, position: Position | null): void {
  const source = map.getSource<GeoJSONSource>(SOURCE_IDS.currentPosition);
  source?.setData(currentPositionCollection(position));
}

/** Highlight by referenced feature IDs, never by primitive owner. */
export function updateHighlightedService(map: MapLibreMap, featureIds: readonly string[], color: string): void {
  if (!map.getLayer(LAYER_IDS.currentService)) return;
  map.setFilter(LAYER_IDS.currentService, ["in", ["get", "featureId"], ["literal", [...featureIds]]]);
  map.setPaintProperty(LAYER_IDS.currentService, "line-color", color);
}

/**
 * Opacity of the arrival flash `elapsedMs` into a `durationMs` flash: one half-sine pulse, 0 at both ends and
 * outside them, peaking once at SEGMENT_FLASH_MAX_OPACITY in the middle. Never repeats, so it cannot strobe.
 */
export function segmentFlashOpacity(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || !(elapsedMs > 0) || elapsedMs >= durationMs) return 0;
  return SEGMENT_FLASH_MAX_OPACITY * Math.sin((Math.PI * elapsedMs) / durationMs);
}

/** Point the flash layer at `featureIds` (target-scoped like the completed layer); skipped while it is missing. */
export function setSegmentFlashFeatures(
  map: MapLibreMap,
  featureIds: readonly string[],
  targetServiceId = DEFAULT_GAME_CONFIG.targetServiceId,
): void {
  if (!map.getLayer(LAYER_IDS.segmentsFlash)) return;
  map.setFilter(LAYER_IDS.segmentsFlash, completedSegmentFilter(featureIds, targetServiceId));
}

/** Set the flash layer's opacity; skipped while it is missing (failed map, replaced style). */
export function setSegmentFlashOpacity(map: MapLibreMap, opacity: number): void {
  if (!map.getLayer(LAYER_IDS.segmentsFlash)) return;
  map.setPaintProperty(LAYER_IDS.segmentsFlash, "line-opacity", opacity);
}

/** Empty, transparent flash layer: its initial state, and the state after every flash. */
export function clearSegmentFlash(map: MapLibreMap, targetServiceId = DEFAULT_GAME_CONFIG.targetServiceId): void {
  setSegmentFlashOpacity(map, 0);
  setSegmentFlashFeatures(map, [], targetServiceId);
}
