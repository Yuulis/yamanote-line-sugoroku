// Geometry for the move animation (spec 6.2): the marker follows each
// traversed segment's GeoJSON line, never a straight jump between stations.
// Pure: no DOM, no clock.

import type { Position, SegmentFeatureCollection } from "../../../types/data";
import type { RailwayNetwork, SegmentTraversedEvent } from "../engine";

/** Polyline coordinates keyed by GeoJSON feature id (stringified). */
export type GeometryIndex = ReadonlyMap<string, readonly Position[]>;

/** One traversed segment, ready to be sampled by distance. */
export interface StepPath {
  segmentId: string;
  fromStationId: string;
  toStationId: string;
  newlyCompleted: boolean;
  /** Oriented from the departure station to the arrival station. */
  points: readonly Position[];
  /** cumulative[i] = distance from points[0] to points[i]; same length as points. */
  cumulative: readonly number[];
  total: number;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Index every LineString segment feature's coordinates. MultiLineString
 * features are left out: joining disjoint parts would draw a made-up straight
 * link between them (the current data has none; see stepPath's fallback).
 */
export function buildGeometryIndex(
  collection: SegmentFeatureCollection | undefined,
): GeometryIndex {
  const index = new Map<string, Position[]>();
  for (const feature of collection?.features ?? []) {
    const { geometry } = feature;
    if (geometry.type !== "LineString" || geometry.coordinates.length === 0) continue;
    index.set(String(feature.id), geometry.coordinates.map(clonePosition));
  }
  return index;
}

function clonePosition([longitude, latitude]: Position): Position {
  return [longitude, latitude];
}

/**
 * Planar distance with the longitude scaled by cos(latitude): accurate
 * enough to pace the marker over a few kilometres, and cheap per frame.
 */
export function planarDistance(a: Position, b: Position): number {
  const meanLatitude = ((a[1] + b[1]) / 2) * DEGREES_TO_RADIANS;
  const dx = (b[0] - a[0]) * Math.cos(meanLatitude);
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

/**
 * Orient `points` so the line starts at `from`: the stored geometry may run
 * the other way (e.g. a shared line ridden in the opposite direction).
 */
export function orientPath(
  points: readonly Position[],
  from: Position,
): Position[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return [];
  const startsAtFrom = planarDistance(first, from) <= planarDistance(last, from);
  return startsAtFrom ? [...points] : [...points].reverse();
}

function cumulativeLengths(points: readonly Position[]): number[] {
  let total = 0;
  return points.map((point, index) => {
    const previous = points[index - 1];
    if (previous) total += planarDistance(previous, point);
    return total;
  });
}

/**
 * The path for one traversed segment. Falls back to the straight line
 * between the two stations only when the segment has no usable geometry
 * (segments.geojson failed to load, which the data error banner already
 * reports), so the move is still shown hop by hop.
 */
export function stepPath(
  event: SegmentTraversedEvent,
  network: RailwayNetwork,
  geometry: GeometryIndex,
): StepPath {
  const from = network.stationsById.get(event.fromStationId)?.coordinates;
  const to = network.stationsById.get(event.toStationId)?.coordinates;
  const featureId = network.segmentsById.get(event.segmentId)?.geometryFeatureId;
  const line = featureId === undefined ? undefined : geometry.get(featureId);
  let points: Position[] = [];
  if (line && from) points = orientPath(line, from);
  else if (from && to) points = [clonePosition(from), clonePosition(to)];
  const cumulative = cumulativeLengths(points);
  return {
    segmentId: event.segmentId,
    fromStationId: event.fromStationId,
    toStationId: event.toStationId,
    newlyCompleted: event.newlyCompleted,
    points,
    cumulative,
    total: cumulative.at(-1) ?? 0,
  };
}

/** Step paths for every `segment-traversed` event, in travel order. */
export function buildMovePlan(
  events: readonly { type: string }[],
  network: RailwayNetwork,
  geometry: GeometryIndex,
): StepPath[] {
  return events
    .filter((event): event is SegmentTraversedEvent => event.type === "segment-traversed")
    .map((event) => stepPath(event, network, geometry));
}

/** The point `fraction` (clamped to 0..1) of the way along `path` by distance. */
export function positionAlong(path: StepPath, fraction: number): Position | null {
  const { points, cumulative, total } = path;
  const first = points[0];
  if (!first) return null;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  if (total === 0) return clonePosition(first);
  const target = clamped * total;
  for (let index = 1; index < points.length; index += 1) {
    const end = cumulative[index] ?? total;
    if (end < target) continue;
    const start = cumulative[index - 1] ?? 0;
    const a = points[index - 1] ?? first;
    const b = points[index] ?? a;
    const span = end - start;
    const t = span === 0 ? 0 : (target - start) / span;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return clonePosition(points.at(-1) ?? first);
}
