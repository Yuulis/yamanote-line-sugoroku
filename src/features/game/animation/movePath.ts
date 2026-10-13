// Geometry for the move animation (spec 6.2): the marker follows each
// traversed segment's GeoJSON line, never a straight jump between stations.
// Pure: no DOM, no clock.

import type { Position, SegmentFeatureCollection } from "../../../types/data";
import { GameEngineError, platformPosition, type RailwayNetwork, type SegmentTraversedEvent } from "../engine";

export interface GeometryPath {
  fromStationId: string;
  toStationId: string;
  points: readonly Position[];
}

/** Canonical +1 orientation and coordinates keyed by geometry feature id. */
export type GeometryIndex = ReadonlyMap<string, GeometryPath>;

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
 * Index the canonical orientation as well as coordinates: a distant platform
 * must never change the direction in which a shared feature is ridden.
 */
export function buildGeometryIndex(
  collection: SegmentFeatureCollection | undefined,
): GeometryIndex {
  const index = new Map<string, GeometryPath>();
  for (const feature of collection?.features ?? []) {
    const { geometry } = feature;
    if (geometry.type !== "LineString" || geometry.coordinates.length === 0) continue;
    index.set(feature.id, {
      fromStationId: feature.properties.from,
      toStationId: feature.properties.to,
      points: geometry.coordinates.map(clonePosition),
    });
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
 * Orient a shared feature by station identity, independently of distance.
 */
export function orientPath(
  path: GeometryPath,
  from: string,
  to: string,
): Position[] {
  if (path.fromStationId === from && path.toStationId === to) return path.points.map(clonePosition);
  if (path.fromStationId === to && path.toStationId === from) return [...path.points].reverse().map(clonePosition);
  throw new GameEngineError("INVALID_NETWORK", `Geometry does not join ${from} and ${to}`);
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
 * between the two stations only when the geometry index is empty
 * (segments.geojson failed to load, which the data error banner already
 * reports), so the move is still shown hop by hop. Missing or broken chains
 * in a loaded geometry bundle are rejected.
 */
export function stepPath(
  event: SegmentTraversedEvent,
  network: RailwayNetwork,
  geometry: GeometryIndex,
): StepPath {
  const from = platformPosition(network, event.serviceId, event.fromStationId);
  const to = platformPosition(network, event.serviceId, event.toStationId);
  const featureIds = network.segmentsById.get(event.segmentId)?.geometryFeatureIds;
  let points: Position[] = [];
  if (geometry.size > 0 && featureIds) {
    let current = event.fromStationId;
    for (const id of featureIds) {
      const line = geometry.get(id);
      if (!line) throw new GameEngineError("INVALID_NETWORK", `Missing geometry ${id}`);
      const next = line.fromStationId === current ? line.toStationId : line.fromStationId;
      const leg = orientPath(line, current, next);
      const previous = points.at(-1);
      if (previous && (previous[0] !== leg[0]?.[0] || previous[1] !== leg[0]?.[1])) {
        throw new GameEngineError("INVALID_NETWORK", `Geometry joint gap at ${current}`);
      }
      points.push(...(points.length === 0 ? leg : leg.slice(1)));
      current = next;
    }
    if (current !== event.toStationId) throw new GameEngineError("INVALID_NETWORK", `Wrong chain endpoint for ${event.segmentId}`);
  } else if (from && to) points = [clonePosition(from), clonePosition(to)];
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
