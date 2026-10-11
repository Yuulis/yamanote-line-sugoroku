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
