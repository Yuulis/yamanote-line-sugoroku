// Auto-follow helpers (spec 6.2): the camera follows the marker, and any
// camera change the user makes switches following off instead of fighting it.

import type { Position } from "../../types/data";

export interface CameraRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CameraPoint {
  x: number;
  y: number;
}

export interface PreviewCalloutBounds {
  anchor: CameraPoint;
  rect: CameraRect;
}

export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface CameraViewport {
  width: number;
  height: number;
}

/** Stable fit identity: identical geometry still needs fitting after a new session or landing set. */
export function adjustmentPreviewFitSignature(
  sessionKey: number | undefined,
  candidateKey: string,
  originKey: string,
  viewport: CameraViewport,
  padding: CameraPadding,
): string {
  return JSON.stringify([
    sessionKey ?? null,
    candidateKey,
    originKey,
    viewport.width,
    viewport.height,
    padding.top,
    padding.right,
    padding.bottom,
    padding.left,
  ]);
}

const PREVIEW_OBSTRUCTION_GAP_PX = 12;
const MIN_PREVIEW_VIEWPORT_SIDE_PX = 64;
const MIN_FALLBACK_VIEWPORT_SIDE_PX = 8;
const PREVIEW_PADDING_SIDES = ["left", "right", "top", "bottom"] as const;
const ZERO_CAMERA_PADDING: CameraPadding = { top: 0, right: 0, bottom: 0, left: 0 };

function calloutClearance(callouts: readonly PreviewCalloutBounds[]): CameraPadding {
  return callouts.reduce<CameraPadding>((padding, callout) => ({
    left: Math.max(padding.left, callout.anchor.x - callout.rect.left),
    right: Math.max(padding.right, callout.rect.right - callout.anchor.x),
    top: Math.max(padding.top, callout.anchor.y - callout.rect.top),
    bottom: Math.max(padding.bottom, callout.rect.bottom - callout.anchor.y),
  }), ZERO_CAMERA_PADDING);
}

function obstructionPadding(rect: CameraRect, side: keyof CameraPadding, viewport: CameraViewport): number {
  const required = side === "left"
    ? rect.right + PREVIEW_OBSTRUCTION_GAP_PX
    : side === "right"
      ? viewport.width - rect.left + PREVIEW_OBSTRUCTION_GAP_PX
      : side === "top"
        ? rect.bottom + PREVIEW_OBSTRUCTION_GAP_PX
        : viewport.height - rect.top + PREVIEW_OBSTRUCTION_GAP_PX;
  const dimension = side === "left" || side === "right" ? viewport.width : viewport.height;
  return Math.max(0, Math.min(dimension, required));
}

function usableArea(padding: CameraPadding, viewport: CameraViewport): number {
  const width = viewport.width - padding.left - padding.right;
  const height = viewport.height - padding.top - padding.bottom;
  return width > 0 && height > 0 ? width * height : 0;
}

function keepMinimumViewport(
  padding: CameraPadding,
  viewport: CameraViewport,
  minimumSide: number,
): CameraPadding {
  const minWidth = Math.min(minimumSide, viewport.width);
  const minHeight = Math.min(minimumSide, viewport.height);
  const maxHorizontalPadding = Math.max(0, viewport.width - minWidth);
  const horizontalTotal = padding.left + padding.right;
  const horizontalScale = horizontalTotal > maxHorizontalPadding && horizontalTotal > 0
    ? maxHorizontalPadding / horizontalTotal
    : 1;
  const maxVerticalPadding = Math.max(0, viewport.height - minHeight);
  const verticalTotal = padding.top + padding.bottom;
  const verticalScale = verticalTotal > maxVerticalPadding && verticalTotal > 0
    ? maxVerticalPadding / verticalTotal
    : 1;
  return {
    left: padding.left * horizontalScale,
    right: padding.right * horizontalScale,
    top: padding.top * verticalScale,
    bottom: padding.bottom * verticalScale,
  };
}

function axisCandidates(boundaries: readonly number[], minimum: number, maximum: number): readonly number[] {
  const sorted = [...new Set(boundaries.filter((value) => value >= minimum && value <= maximum))].sort((a, b) => a - b);
  const midpoints = sorted.slice(1).map((value, index) => ((sorted[index] ?? value) + value) / 2);
  return [...new Set([...sorted, ...midpoints])];
}

function overlapsMarker(point: CameraPoint, radius: number, rect: CameraRect): boolean {
  return point.x - radius < rect.right && point.x + radius > rect.left &&
    point.y - radius < rect.bottom && point.y + radius > rect.top;
}

/** Find the best screen point for a marker that avoids overlays, even when no full fit area exists. */
export function bestUnobstructedPoint(
  viewport: CameraViewport,
  obstructions: readonly CameraRect[],
  markerRadius: number,
): CameraPoint | null {
  const xBoundaries = [markerRadius, viewport.width / 2, viewport.width - markerRadius,
    ...obstructions.flatMap((rect) => [rect.left - markerRadius, rect.right + markerRadius])];
  const yBoundaries = [markerRadius, viewport.height / 2, viewport.height - markerRadius,
    ...obstructions.flatMap((rect) => [rect.top - markerRadius, rect.bottom + markerRadius])];
  const xs = axisCandidates(xBoundaries, markerRadius, viewport.width - markerRadius);
  const ys = axisCandidates(yBoundaries, markerRadius, viewport.height - markerRadius);
  let bestPoint: CameraPoint | null = null;
  let bestClearance = Number.NEGATIVE_INFINITY;

  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y };
      if (obstructions.some((rect) => overlapsMarker(point, markerRadius, rect))) continue;
      const edgeClearance = Math.min(
        x - markerRadius,
        viewport.width - x - markerRadius,
        y - markerRadius,
        viewport.height - y - markerRadius,
      );
      const obstacleClearance = obstructions.reduce((minimum, rect) => {
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        return Math.min(minimum, Math.hypot(dx, dy) - markerRadius);
      }, Number.POSITIVE_INFINITY);
      const clearance = Math.min(edgeClearance, obstacleClearance);
      if (clearance > bestClearance) {
        bestPoint = point;
        bestClearance = clearance;
      }
    }
  }
  return bestPoint;
}

/**
 * Choose the largest rectangular map area that clears every measured obstruction
 * and leaves room around the actual callout boxes and their lane leaders.
 */
export function adjustmentPreviewPadding(
  viewport: CameraViewport,
  obstructions: readonly CameraRect[],
  callouts: readonly PreviewCalloutBounds[],
): CameraPadding {
  const clearance = calloutClearance(callouts);
  let bestValid: CameraPadding | null = null;
  let bestValidArea = 0;
  let bestEffort = ZERO_CAMERA_PADDING;
  let bestEffortArea = 0;
  let bestObstructionPadding = ZERO_CAMERA_PADDING;
  let bestObstructionArea = 0;

  const visit = (index: number, padding: CameraPadding): void => {
    if (index === obstructions.length) {
      const obstructionArea = usableArea(padding, viewport);
      if (obstructionArea > bestObstructionArea) {
        bestObstructionPadding = padding;
        bestObstructionArea = obstructionArea;
      }
      const withClearance: CameraPadding = {
        top: padding.top + clearance.top,
        right: padding.right + clearance.right,
        bottom: padding.bottom + clearance.bottom,
        left: padding.left + clearance.left,
      };
      const area = usableArea(withClearance, viewport);
      if (area > bestEffortArea) {
        bestEffort = withClearance;
        bestEffortArea = area;
      }
      const availableWidth = viewport.width - withClearance.left - withClearance.right;
      const availableHeight = viewport.height - withClearance.top - withClearance.bottom;
      if (availableWidth < MIN_PREVIEW_VIEWPORT_SIDE_PX || availableHeight < MIN_PREVIEW_VIEWPORT_SIDE_PX) return;
      if (area > bestValidArea) {
        bestValid = withClearance;
        bestValidArea = area;
      }
      return;
    }

    const obstruction = obstructions[index];
    if (!obstruction) return;
    for (const side of PREVIEW_PADDING_SIDES) {
      const nextPadding: CameraPadding = {
        ...padding,
        [side]: Math.max(padding[side], obstructionPadding(obstruction, side, viewport)),
      };
      visit(index + 1, nextPadding);
    }
  };

  visit(0, ZERO_CAMERA_PADDING);
  if (bestValid) return bestValid;
  const fallbackPadding = bestEffortArea > 0 ? bestEffort : bestObstructionPadding;
  return keepMinimumViewport(fallbackPadding, viewport, MIN_FALLBACK_VIEWPORT_SIDE_PX);
}

/** Camera events that start a view change; user-made ones carry `originalEvent`. */
export const USER_CAMERA_EVENTS = [
  "movestart",
  "dragstart",
  "zoomstart",
  "rotatestart",
  "pitchstart",
] as const;

/** Degrees; closer than this the camera is treated as already on target. */
const CENTER_TOLERANCE = 1e-7;

/**
 * True for camera changes caused by the user (drag, wheel, pinch, keyboard,
 * navigation buttons): MapLibre attaches the DOM event as `originalEvent`.
 * Programmatic jumpTo / easeTo calls carry none.
 */
export function isUserCameraEvent(event: { originalEvent?: unknown }): boolean {
  return event.originalEvent !== undefined && event.originalEvent !== null;
}

/** Whether moving the camera centre from `current` to `target` changes anything. */
export function needsRecentre(current: Position, target: Position): boolean {
  return (
    Math.abs(current[0] - target[0]) > CENTER_TOLERANCE ||
    Math.abs(current[1] - target[1]) > CENTER_TOLERANCE
  );
}

/** Compact city bundles keep their established initial overview. Regional bundles start at the target. */
export function initialOverviewServices<T extends { id: string; platformCoordinates: Record<string, Position> }>(
  services: readonly T[], targetServiceId: string,
): readonly T[] {
  const points = services.flatMap((service) => Object.values(service.platformCoordinates));
  const longitudeSpan = Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x));
  const latitudeSpan = Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));
  const COMPACT_SPAN_DEGREES = 0.5;
  return Math.max(longitudeSpan, latitudeSpan) <= COMPACT_SPAN_DEGREES
    ? services
    : services.filter((service) => service.id === targetServiceId);
}
