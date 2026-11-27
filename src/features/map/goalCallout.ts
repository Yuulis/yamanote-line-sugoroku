import { Marker } from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position } from "../../types/data";
import { GOAL_STATION_RING_COLOR } from "./mapConfig";
import { createMapCallout, type AdjustmentCandidate } from "./rollAdjustmentPreview";

const GOAL_CALLOUT_TEXT = "ここに着けばゴール";

export interface GoalCalloutController {
  setAdjustmentCandidates(candidates: readonly AdjustmentCandidate[]): void;
  remove(): void;
}

/** Mount the goal pulse and control the bubble independently so it can yield to adjustment callouts. */
export function mountGoalCallout(map: MapLibreMap, position: Position | null): GoalCalloutController {
  if (!position) {
    return { setAdjustmentCandidates: () => {}, remove: () => {} };
  }

  const pulseMarker = new Marker({ element: createGoalPulseElement() })
    .setLngLat(position)
    .addTo(map);
  let calloutMarker: Marker | null = null;

  return {
    setAdjustmentCandidates(candidates) {
      const visible = candidates.length === 0;
      if (visible && !calloutMarker) {
        const callout = createMapCallout([document.createTextNode(GOAL_CALLOUT_TEXT)]);
        callout.element.removeAttribute("data-map-adjustment-callout");
        callout.element.setAttribute("data-map-goal-callout", "");
        calloutMarker = new Marker({
          element: callout.element,
          anchor: "bottom",
          offset: [0, -6],
          rotationAlignment: "viewport",
          pitchAlignment: "viewport",
        }).setLngLat(position).addTo(map);
      } else if (!visible && calloutMarker) {
        calloutMarker.remove();
        calloutMarker = null;
      }
    },
    remove() {
      calloutMarker?.remove();
      calloutMarker = null;
      pulseMarker.remove();
    },
  };
}

function createGoalPulseElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = "map-goal-pulse";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("data-map-goal-pulse", "");
  element.style.pointerEvents = "none";
  element.style.setProperty("--map-goal-ring-color", GOAL_STATION_RING_COLOR);
  const inner = document.createElement("div");
  inner.className = "map-goal-pulse__inner";
  element.append(inner);
  return element;
}
