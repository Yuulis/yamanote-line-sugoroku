import { Marker } from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position } from "../../types/data";
import {
  CURRENT_POSITION_COLOR,
  CURRENT_POSITION_RADIUS,
  CURRENT_POSITION_STROKE_COLOR,
  CURRENT_POSITION_STROKE_WIDTH,
} from "./mapConfig";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HEADING_MARKER_SIZE = 2 * (CURRENT_POSITION_RADIUS + CURRENT_POSITION_STROKE_WIDTH);
// The beak stays smaller than the circle but large enough to read at a glance (user 2026-11-11).
const HEADING_TRIANGLE_HALF_WIDTH = CURRENT_POSITION_RADIUS / 2;
const HEADING_TRIANGLE_BASE_INSET = CURRENT_POSITION_STROKE_WIDTH / 2;
const HEADING_TRIANGLE_LENGTH = CURRENT_POSITION_RADIUS;
const HEADING_TRIANGLE_STROKE_WIDTH = CURRENT_POSITION_STROKE_WIDTH / 2;

export interface HeadingMarkerController {
  update(position: Position | null, bearing: number | null): void;
  remove(): void;
}

function createHeadingMarkerElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = "map-heading-marker";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("data-map-heading-marker", "");
  element.style.width = `${HEADING_MARKER_SIZE}px`;
  element.style.height = `${HEADING_MARKER_SIZE}px`;
  element.style.overflow = "visible";
  element.style.pointerEvents = "none";
  element.style.visibility = "hidden";

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", `${HEADING_MARKER_SIZE}`);
  svg.setAttribute("height", `${HEADING_MARKER_SIZE + HEADING_TRIANGLE_LENGTH}`);
  svg.setAttribute("viewBox", `0 0 ${HEADING_MARKER_SIZE} ${HEADING_MARKER_SIZE + HEADING_TRIANGLE_LENGTH}`);
  svg.style.display = "block";
  svg.style.position = "absolute";
  svg.style.top = `-${HEADING_TRIANGLE_LENGTH}px`;
  svg.style.left = "0";

  const center = HEADING_MARKER_SIZE / 2;
  const triangle = document.createElementNS(SVG_NAMESPACE, "path");
  triangle.setAttribute(
    "d",
    `M ${center} 0 ` +
      `L ${center + HEADING_TRIANGLE_HALF_WIDTH} ${HEADING_TRIANGLE_LENGTH + HEADING_TRIANGLE_BASE_INSET} ` +
      `L ${center - HEADING_TRIANGLE_HALF_WIDTH} ${HEADING_TRIANGLE_LENGTH + HEADING_TRIANGLE_BASE_INSET} Z`,
  );
  triangle.setAttribute("fill", CURRENT_POSITION_COLOR);
  triangle.setAttribute("stroke", CURRENT_POSITION_STROKE_COLOR);
  triangle.setAttribute("stroke-width", `${HEADING_TRIANGLE_STROKE_WIDTH}`);
  triangle.setAttribute("stroke-linejoin", "round");
  svg.append(triangle);
  element.append(svg);
  return element;
}

class MapHeadingMarker implements HeadingMarkerController {
  private readonly element: HTMLElement;
  private readonly marker: Marker;

  constructor(map: MapLibreMap) {
    this.element = createHeadingMarkerElement();
    this.marker = new Marker({
      element: this.element,
      anchor: "center",
      rotationAlignment: "map",
      pitchAlignment: "map",
    })
      .setLngLat(map.getCenter())
      .addTo(map);
  }

  update(position: Position | null, bearing: number | null): void {
    if (position) this.marker.setLngLat(position);
    if (position === null || bearing === null) {
      this.element.style.visibility = "hidden";
      return;
    }
    this.marker.setRotation(bearing);
    this.element.style.visibility = "visible";
  }

  remove(): void {
    this.marker.remove();
  }
}

/** Create the non-interactive DOM beak once the map instance is available. */
export function createHeadingMarker(map: MapLibreMap): HeadingMarkerController {
  return new MapHeadingMarker(map);
}
