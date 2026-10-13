// Auto-follow helpers (spec 6.2): the camera follows the marker, and any
// camera change the user makes switches following off instead of fighting it.

import type { Position } from "../../types/data";

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
