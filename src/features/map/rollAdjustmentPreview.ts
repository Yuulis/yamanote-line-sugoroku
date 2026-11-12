import { Marker } from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position } from "../../types/data";
import type { PreviewCalloutBounds } from "./camera";

/** The part of a landing the map needs; `AdjustmentLanding` satisfies it structurally. */
export interface AdjustmentCandidate {
  delta: -1 | 0 | 1;
  stationId: string;
  position: Position | null;
  travelledSteps: number;
}

interface CalloutGroup {
  stationId: string;
  position: Position;
  rows: readonly AdjustmentCandidate[];
}

interface Callout {
  group: CalloutGroup;
  marker: Marker;
  bubble: HTMLElement;
  leader: HTMLElement;
}

// Fallback bubble box when it cannot be measured (jsdom); real bubbles are measured after mount.
const BUBBLE_WIDTH_PX = 84;
const BUBBLE_HEIGHT_PX = 28;
const LANE_HEIGHT_PX = 44;
const TAIL_HEIGHT_PX = 8;
/** Keeps the tail tip off the station dot so the dot and current-position ring stay visible. */
const ANCHOR_OFFSET_PX = 6;

/** Projected station point plus the measured bubble size; size falls back to the constants when absent or 0. */
export interface BubbleBox {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

function deltaLabel(delta: -1 | 0 | 1): string {
  if (delta === 0) return "そのまま";
  return delta === -1 ? "−1" : "+1";
}

/** One group per landing station, in first-seen (delta) order; entries without a platform are skipped. */
export function groupCandidatesByStation(candidates: readonly AdjustmentCandidate[]): readonly CalloutGroup[] {
  const groups = new Map<string, { position: Position; rows: AdjustmentCandidate[] }>();
  for (const candidate of candidates) {
    if (candidate.position === null) continue;
    const group = groups.get(candidate.stationId);
    if (group) group.rows.push(candidate);
    else groups.set(candidate.stationId, { position: candidate.position, rows: [candidate] });
  }
  return [...groups].map(([stationId, group]) => ({ stationId, ...group }));
}

/**
 * Lowest free lane per bubble, in delta order: a bubble moves up a lane while it
 * overlaps an earlier bubble (horizontal extents and lane-shifted vertical extents both intersect).
 * Bubbles whose stations are far apart vertically never conflict, so they stay in lane 0.
 */
export function assignLanes(boxes: readonly BubbleBox[]): readonly number[] {
  const sizes = boxes.map((box) => ({ width: box.width || BUBBLE_WIDTH_PX, height: box.height || BUBBLE_HEIGHT_PX }));
  const bottomAt = (index: number, lane: number): number =>
    (boxes[index]?.y ?? 0) - ANCHOR_OFFSET_PX - TAIL_HEIGHT_PX - lane * LANE_HEIGHT_PX;
  const lanes: number[] = [];
  boxes.forEach((box, index) => {
    const size = sizes[index] as { width: number; height: number };
    const conflicts = (lane: number): boolean => {
      const bottom = bottomAt(index, lane);
      return lanes.some((otherLane, other) => {
        const otherSize = sizes[other] as { width: number; height: number };
        const otherBottom = bottomAt(other, otherLane);
        const half = (size.width + otherSize.width) / 2;
        return Math.abs((boxes[other]?.x ?? 0) - box.x) < half
          && bottom - size.height < otherBottom
          && otherBottom - otherSize.height < bottom;
      });
    };
    let lane = 0;
    while (conflicts(lane)) lane += 1;
    lanes.push(lane);
  });
  return lanes;
}

function createRow(candidate: AdjustmentCandidate): HTMLElement {
  const row = document.createElement("div");
  row.className = "map-adjustment-callout__row";
  const delta = document.createElement("strong");
  delta.textContent = deltaLabel(candidate.delta);
  const steps = document.createElement("span");
  steps.textContent = `${candidate.travelledSteps}マス`;
  row.append(delta, " ", steps);
  return row;
}

function createCalloutElement(rows: readonly AdjustmentCandidate[]): { element: HTMLElement; bubble: HTMLElement; leader: HTMLElement } {
  const element = document.createElement("div");
  element.className = "map-adjustment-callout";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("data-map-adjustment-callout", "");
  element.style.pointerEvents = "none";
  const bubble = document.createElement("div");
  bubble.className = "map-adjustment-callout__bubble";
  bubble.append(...rows.map(createRow));
  const leader = document.createElement("div");
  leader.className = "map-adjustment-callout__leader";
  element.append(bubble, leader);
  return { element, bubble, leader };
}

function layoutLanes(map: MapLibreMap, callouts: readonly Callout[]): void {
  const lanes = assignLanes(callouts.map((callout) => {
    const { x, y } = map.project(callout.group.position);
    return { x, y, width: callout.bubble.offsetWidth, height: callout.bubble.offsetHeight };
  }));
  callouts.forEach((callout, index) => {
    callout.leader.style.height = `${TAIL_HEIGHT_PX + (lanes[index] ?? 0) * LANE_HEIGHT_PX}px`;
  });
}

/**
 * Mount one non-interactive speech bubble per distinct landing station and
 * return the teardown. Lanes are recomputed only when a camera move ends.
 */
export function mountAdjustmentCallouts(
  map: MapLibreMap,
  candidates: readonly AdjustmentCandidate[],
): () => void {
  const callouts: Callout[] = groupCandidatesByStation(candidates).map((group) => {
    const { element, bubble, leader } = createCalloutElement(group.rows);
    element.dataset.longitude = String(group.position[0]);
    element.dataset.latitude = String(group.position[1]);
    const marker = new Marker({
      element,
      anchor: "bottom",
      offset: [0, -ANCHOR_OFFSET_PX],
      rotationAlignment: "viewport",
      pitchAlignment: "viewport",
    })
      .setLngLat(group.position)
      .addTo(map);
    return { group, marker, bubble, leader };
  });
  const relayout = (): void => layoutLanes(map, callouts);
  relayout();
  map.on("moveend", relayout);
  return () => {
    map.off("moveend", relayout);
    for (const callout of callouts) callout.marker.remove();
  };
}

/** Measure each live bubble and its leader from the browser's current layout. */
export function measureAdjustmentCallouts(map: MapLibreMap): readonly PreviewCalloutBounds[] {
  const container = map.getContainer().getBoundingClientRect();
  return [...map.getContainer().querySelectorAll<HTMLElement>("[data-map-adjustment-callout]")]
    .flatMap((element) => {
      const longitude = Number(element.dataset.longitude);
      const latitude = Number(element.dataset.latitude);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
      const position: Position = [longitude, latitude];
      const rect = element.getBoundingClientRect();
      const anchor = map.project(position);
      return [{
        anchor,
        rect: {
          left: rect.left - container.left,
          top: rect.top - container.top,
          right: rect.right - container.left,
          bottom: rect.bottom - container.top,
        },
      }];
    });
}
