import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { TURN_RESULT_PILL_LAYOUT_EVENT, TURN_RESULT_PILL_SELECTOR } from "../game/turnResultPillLayout";
import type { Position } from "../../types/data";
import { CURRENT_POSITION_RADIUS, CURRENT_POSITION_STROKE_WIDTH, MAP_ZOOM } from "./mapConfig";
import {
  adjustmentPreviewFitSignature,
  adjustmentPreviewPadding,
  bestUnobstructedPoint,
  type CameraPoint,
  type CameraRect,
} from "./camera";
import { measureAdjustmentCallouts, type AdjustmentCandidate } from "./rollAdjustmentPreview";

const PREVIEW_LAYOUT_SELECTORS = [
  ".item-adjustment",
  ".map-overview",
  ".maplibregl-ctrl-top-left",
  ".maplibregl-ctrl-top-right",
  ".maplibregl-ctrl-bottom-left",
  ".maplibregl-ctrl-bottom-right",
  "[data-map-adjustment-callout]",
  TURN_RESULT_PILL_SELECTOR,
] as const;

/** Elements whose size can change the camera layout. */
export function cameraLayoutTargets(
  container: HTMLElement,
  panelRoot: HTMLElement | null,
  extraTargets: readonly HTMLElement[] = [],
): HTMLElement[] {
  const targets = panelRoot ? [container, panelRoot] : [container];
  return [...targets, ...extraTargets.filter((target) => !targets.includes(target))];
}

/**
 * Watch the map's container, the current `.game-panel` root and the window, and call `onLayoutChange` at
 * most once per animation frame. A new map or a new `panelKey` (a new session's panel element) rebinds the
 * observer to the replacement panel; `onBind` runs on every (re)bind before any observation. A null map
 * observes nothing.
 */
export function useCameraLayoutObserver(
  map: Pick<MapLibreMap, "getContainer"> | null,
  panelKey: number | undefined,
  onBind: () => void,
  onLayoutChange: () => void,
  previewOpen = false,
  previewKey = "",
): void {
  const callbacksRef = useRef({ onBind, onLayoutChange });
  useEffect(() => {
    callbacksRef.current = { onBind, onLayoutChange };
  });
  useEffect(() => {
    if (!map) return;
    const container: HTMLElement = map.getContainer();
    callbacksRef.current.onBind();
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const previewTargets = previewOpen
      ? PREVIEW_LAYOUT_SELECTORS.flatMap((selector) =>
          [...document.querySelectorAll<HTMLElement>(selector)].filter(isVisibleLayoutTarget))
      : [];
    let animationFrame = 0;
    const requestLayoutUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        callbacksRef.current.onLayoutChange();
      });
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(requestLayoutUpdate);
    for (const target of cameraLayoutTargets(container, panel, previewTargets)) observer?.observe(target);
    window.addEventListener("resize", requestLayoutUpdate);
    window.addEventListener("orientationchange", requestLayoutUpdate);
    if (previewOpen) window.addEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, requestLayoutUpdate);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", requestLayoutUpdate);
      window.removeEventListener("orientationchange", requestLayoutUpdate);
      if (previewOpen) window.removeEventListener(TURN_RESULT_PILL_LAYOUT_EVENT, requestLayoutUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [map, panelKey, previewOpen, previewKey]);
}

export function isVisibleLayoutTarget(element: HTMLElement): boolean {
  if (element instanceof HTMLDialogElement && !element.open) return false;
  if (element.matches(TURN_RESULT_PILL_SELECTOR) && getComputedStyle(element).visibility === "hidden") return false;
  return element.getClientRects().length > 0;
}

export const ZERO_MAP_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
const PREVIEW_OBSTRUCTION_SELECTORS = [
  ".game-panel",
  ".item-adjustment",
  ".map-overview",
  ".maplibregl-ctrl-top-left",
  ".maplibregl-ctrl-top-right",
  ".maplibregl-ctrl-bottom-left",
  ".maplibregl-ctrl-bottom-right",
  TURN_RESULT_PILL_SELECTOR,
] as const;
const ORIGIN_MARKER_RADIUS_PX = CURRENT_POSITION_RADIUS + CURRENT_POSITION_STROKE_WIDTH;

function toMapRect(rect: DOMRect, mapRect: DOMRect): CameraRect {
  return {
    left: rect.left - mapRect.left,
    top: rect.top - mapRect.top,
    right: rect.right - mapRect.left,
    bottom: rect.bottom - mapRect.top,
  };
}

export function previewObstructions(container: HTMLElement): readonly CameraRect[] {
  const mapBounds = container.getBoundingClientRect();
  const elements = [...new Set(PREVIEW_OBSTRUCTION_SELECTORS.flatMap((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)]))];
  return elements
    .filter(isVisibleLayoutTarget)
    .map((element) => toMapRect(element.getBoundingClientRect(), mapBounds))
    .filter((rect) => rect.right > 0 && rect.left < mapBounds.width && rect.bottom > 0 && rect.top < mapBounds.height);
}

function originMarkerIntersects(
  point: CameraPoint,
  radius: number,
  obstruction: CameraRect,
): boolean {
  return point.x - radius < obstruction.right && point.x + radius > obstruction.left &&
    point.y - radius < obstruction.bottom && point.y + radius > obstruction.top;
}

function keepOriginVisible(
  map: MapLibreMap,
  position: Position,
  obstructions: readonly CameraRect[],
): void {
  const container = map.getContainer().getBoundingClientRect();
  const viewport = { width: container.width, height: container.height };
  const point = map.project(position);
  const withinViewport = point.x >= ORIGIN_MARKER_RADIUS_PX &&
    point.x <= viewport.width - ORIGIN_MARKER_RADIUS_PX &&
    point.y >= ORIGIN_MARKER_RADIUS_PX &&
    point.y <= viewport.height - ORIGIN_MARKER_RADIUS_PX;
  const overlapsObstruction = obstructions.some((rect) =>
    originMarkerIntersects(point, ORIGIN_MARKER_RADIUS_PX, rect));
  if (withinViewport && !overlapsObstruction) return;

  const target = bestUnobstructedPoint(viewport, obstructions, ORIGIN_MARKER_RADIUS_PX) ?? {
    x: viewport.width / 2,
    y: viewport.height / 2,
  };
  const cameraCenter = map.getCenter();
  const projectedCenter = map.project([cameraCenter.lng, cameraCenter.lat]);
  const shiftedCenter = map.unproject([
    projectedCenter.x + point.x - target.x,
    projectedCenter.y + point.y - target.y,
  ]);
  map.jumpTo({ center: shiftedCenter, zoom: map.getZoom(), padding: ZERO_MAP_PADDING });
}

function originCalloutBounds(map: MapLibreMap, position: Position | null): readonly { anchor: CameraPoint; rect: CameraRect }[] {
  if (position === null) return [];
  const anchor = map.project(position);
  return [{
    anchor,
    rect: {
      left: anchor.x - ORIGIN_MARKER_RADIUS_PX,
      top: anchor.y - ORIGIN_MARKER_RADIUS_PX,
      right: anchor.x + ORIGIN_MARKER_RADIUS_PX,
      bottom: anchor.y + ORIGIN_MARKER_RADIUS_PX,
    },
  }];
}

export function positionsBounds(positions: readonly Position[]): [Position, Position] | null {
  if (positions.length === 0) return null;
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

export function fitAdjustmentPreview(
  map: MapLibreMap,
  origin: Position | null,
  candidates: readonly AdjustmentCandidate[],
  sessionKey: number | undefined,
  candidateKey: string,
  originKey: string,
  previousSignature: string | null,
): string | null {
  const positions = [
    ...(origin ? [origin] : []),
    ...candidates.flatMap((candidate) => candidate.position ? [candidate.position] : []),
  ];
  const bounds = positionsBounds(positions);
  if (!bounds) return null;

  const container = map.getContainer();
  const viewport = container.getBoundingClientRect();
  const measurements = [...measureAdjustmentCallouts(map), ...originCalloutBounds(map, origin)];
  const obstructions = previewObstructions(container);
  const padding = adjustmentPreviewPadding(
    { width: viewport.width, height: viewport.height },
    obstructions,
    measurements,
  );
  const signature = adjustmentPreviewFitSignature(
    sessionKey,
    candidateKey,
    originKey,
    { width: viewport.width, height: viewport.height },
    padding,
  );
  if (signature === previousSignature) return signature;
  try {
    map.setPadding(ZERO_MAP_PADDING);
    map.fitBounds(bounds, { padding, duration: 0, maxZoom: MAP_ZOOM });
  } catch (error) {
    console.warn("Map preview fit failed; centering the origin as a fallback.", error);
    try {
      map.setPadding(ZERO_MAP_PADDING);
      const center = origin ?? positions[0];
      if (center) map.jumpTo({ center, zoom: Math.min(map.getZoom(), MAP_ZOOM), padding: ZERO_MAP_PADDING });
    } catch (fallbackError) {
      console.error("Map preview fallback could not center the origin.", fallbackError);
    }
  } finally {
    try {
      map.setPadding(ZERO_MAP_PADDING);
    } catch (error) {
      console.error("Map preview padding could not be cleared.", error);
    }
    if (origin) {
      try {
        keepOriginVisible(map, origin, obstructions);
      } catch (error) {
        console.error("Map preview could not keep the origin in view.", error);
      }
    }
  }
  return signature;
}
