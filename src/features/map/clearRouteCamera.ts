import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position } from "../../types/data";
import type { ClearRoute } from "../game/clearResult";
import type { CameraPadding, CameraRect } from "./camera";
import { positionsBounds } from "./railwayMapCamera";

/** Breathing room between the route and the map edge or the clear card. */
export const CLEAR_FIT_MARGIN_PX = 24;
/** Extra room on the edge that carries the map credit button, so the route never runs under it. */
export const CLEAR_FIT_CREDIT_CLEARANCE_PX = 44;
/** Below this width or height the uncovered area cannot show a route; the previous camera is kept. */
export const CLEAR_FIT_MIN_SIDE_PX = 64;
/** A short route is not zoomed in further than this. */
export const CLEAR_FIT_MAX_ZOOM = 13;
/** Bounds narrower than this on both axes (about 0.1 m) are a single point. */
const SINGLE_POINT_SPAN_DEGREES = 1e-6;
const ZERO_PADDING: CameraPadding = { top: 0, right: 0, bottom: 0, left: 0 };
const CREDITS_AT_TOP_SELECTOR = ".maplibregl-ctrl-top-left .maplibregl-ctrl-attrib";

export type CreditEdge = "top" | "bottom";

export interface ClearFitViewport {
  readonly width: number;
  readonly height: number;
}

export interface ClearFitMeasurement {
  readonly viewport: ClearFitViewport;
  /** The clear card in map-container coordinates. */
  readonly card: CameraRect;
  readonly creditEdge: CreditEdge;
}

interface Candidate {
  readonly padding: CameraPadding;
  readonly area: number;
}

/** The part of the card that overlaps the map, or null when it covers nothing. */
function clampToViewport(card: CameraRect, viewport: ClearFitViewport): CameraRect | null {
  const clamped = {
    left: Math.max(0, card.left),
    top: Math.max(0, card.top),
    right: Math.min(viewport.width, card.right),
    bottom: Math.min(viewport.height, card.bottom),
  };
  return clamped.right > clamped.left && clamped.bottom > clamped.top ? clamped : null;
}

/** Padding that leaves exactly `free` (the open region, in map coordinates) as the fit area. */
function paddingForRegion(free: CameraRect, viewport: ClearFitViewport, creditEdge: CreditEdge): CameraPadding {
  const top = free.top + CLEAR_FIT_MARGIN_PX
    + (creditEdge === "top" && free.top === 0 ? CLEAR_FIT_CREDIT_CLEARANCE_PX : 0);
  const bottom = viewport.height - free.bottom + CLEAR_FIT_MARGIN_PX
    + (creditEdge === "bottom" && free.bottom === viewport.height ? CLEAR_FIT_CREDIT_CLEARANCE_PX : 0);
  return {
    top,
    bottom,
    left: free.left + CLEAR_FIT_MARGIN_PX,
    right: viewport.width - free.right + CLEAR_FIT_MARGIN_PX,
  };
}

function candidateFor(padding: CameraPadding, viewport: ClearFitViewport): Candidate | null {
  const width = viewport.width - padding.left - padding.right;
  const height = viewport.height - padding.top - padding.bottom;
  if (width < CLEAR_FIT_MIN_SIDE_PX || height < CLEAR_FIT_MIN_SIDE_PX) return null;
  return { padding, area: width * height };
}

/**
 * Camera padding that frames the route in the part of the map the clear card leaves open: the largest of the
 * regions above, below, left of and right of the card (a phone's bottom sheet leaves the top, a centred desktop
 * card leaves a side). Null when no region keeps at least 64 CSS px on both axes after the margins.
 */
export function clearFitPadding(measurement: ClearFitMeasurement): CameraPadding | null {
  const { viewport, creditEdge } = measurement;
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const card = clampToViewport(measurement.card, viewport);
  const regions: readonly CameraRect[] = card === null
    ? [{ left: 0, top: 0, right: viewport.width, bottom: viewport.height }]
    : [
        { left: 0, top: 0, right: viewport.width, bottom: card.top },
        { left: 0, top: card.bottom, right: viewport.width, bottom: viewport.height },
        { left: 0, top: 0, right: card.left, bottom: viewport.height },
        { left: card.right, top: 0, right: viewport.width, bottom: viewport.height },
      ];
  let best: Candidate | null = null;
  for (const region of regions) {
    const candidate = candidateFor(paddingForRegion(region, viewport, creditEdge), viewport);
    if (candidate && (best === null || candidate.area > best.area)) best = candidate;
  }
  return best?.padding ?? null;
}

/**
 * Measure the card against the map container. Null while either is not laid out (no size, or the card is not
 * mounted), so the caller keeps the previous camera instead of fitting to a guess.
 */
export function measureClearFit(container: HTMLElement, card: HTMLElement | null): ClearFitMeasurement | null {
  if (!card) return null;
  const mapRect = container.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  if (mapRect.width <= 0 || mapRect.height <= 0 || cardRect.width <= 0 || cardRect.height <= 0) return null;
  return {
    viewport: { width: mapRect.width, height: mapRect.height },
    card: {
      left: cardRect.left - mapRect.left,
      top: cardRect.top - mapRect.top,
      right: cardRect.right - mapRect.left,
      bottom: cardRect.bottom - mapRect.top,
    },
    creditEdge: container.querySelector(CREDITS_AT_TOP_SELECTOR) ? "top" : "bottom",
  };
}

/** Identity of one fit, so an unchanged layout is not fitted again. */
export function clearFitSignature(
  viewport: ClearFitViewport,
  padding: CameraPadding,
  bounds: readonly [Position, Position],
): string {
  return JSON.stringify([
    viewport.width, viewport.height,
    padding.top, padding.right, padding.bottom, padding.left,
    bounds[0], bounds[1],
  ]);
}

function isSinglePoint(bounds: readonly [Position, Position]): boolean {
  return Math.abs(bounds[1][0] - bounds[0][0]) < SINGLE_POINT_SPAN_DEGREES
    && Math.abs(bounds[1][1] - bounds[0][1]) < SINGLE_POINT_SPAN_DEGREES;
}

/**
 * Frame `bounds` inside the padded area without animation. The map is told to re-measure its container first,
 * because a fit solved against the previous canvas size lands in the wrong place once the canvas catches up.
 * Retained camera padding is cleared next because MapLibre combines it with the fit padding; a single point is
 * centred with `jumpTo` at the maximum zoom.
 */
export function applyClearRouteFit(
  map: MapLibreMap,
  bounds: readonly [Position, Position],
  padding: CameraPadding,
): void {
  map.resize();
  map.setPadding(ZERO_PADDING);
  if (isSinglePoint(bounds)) {
    map.jumpTo({
      center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
      zoom: CLEAR_FIT_MAX_ZOOM,
      padding,
    });
    return;
  }
  map.fitBounds([bounds[0], bounds[1]], { padding, animate: false, maxZoom: CLEAR_FIT_MAX_ZOOM });
}

export type ClearReplayBounds = readonly [southWest: Position, northEast: Position];

/** Bounds for one saved replay turn, or null when its index or coordinates cannot be resolved. */
export function clearReplayTurnBounds(route: ClearRoute, recordIndex: number): ClearReplayBounds | null {
  // Index by position, matching how ClearReplayStore resolves its turn cursor.
  if (!Number.isInteger(recordIndex)) return null;
  const span = route.turnSpans[recordIndex];
  if (!span) return null;

  if (span.firstStepIndex === span.endStepIndexExclusive) {
    const destination = span.destination;
    return destination
      ? [[destination[0], destination[1]], [destination[0], destination[1]]]
      : null;
  }

  const positions: Position[] = [];
  for (let stepIndex = span.firstStepIndex; stepIndex < span.endStepIndexExclusive; stepIndex += 1) {
    const step = route.steps[stepIndex];
    if (!step) return null;
    positions.push(...step.points);
  }
  return positionsBounds(positions);
}
