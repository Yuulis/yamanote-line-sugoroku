import type { Position } from "../../types/data";
import type { RailwayNetwork } from "./engine";
import { findSegment } from "./engine";
import { orientPath, stepPath, type GeometryIndex, type GeometryPath, type StepPath } from "./animation/movePath";
import type { ClearHop, ClearRecordTraversal, ClearRoute, ClearRouteLeg, ClearTurnSpan } from "./clearResult";

const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;
const MAX_MERCATOR_LATITUDE = 85.051129;
const MIN_LATITUDE = -MAX_MERCATOR_LATITUDE;
const MAX_LATITUDE = MAX_MERCATOR_LATITUDE;

interface DrawnHop {
  readonly hop: ClearHop;
  readonly path: StepPath;
  readonly breaksContinuityBefore: boolean;
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
    value[0] >= MIN_LONGITUDE && value[0] <= MAX_LONGITUDE && value[1] >= MIN_LATITUDE && value[1] <= MAX_LATITUDE;
}

function isSamePosition(first: Position | undefined, second: Position | undefined): boolean {
  return first !== undefined && second !== undefined && first[0] === second[0] && first[1] === second[1];
}

function orientedFeaturePoints(
  feature: GeometryPath,
  fromStationId: string,
  toStationId: string,
): Position[] | null {
  try {
    const points = orientPath(feature, fromStationId, toStationId);
    if (points.length < 2 || points.some((point) => !isPosition(point))) return null;
    return points;
  } catch {
    return null;
  }
}

/** Verify the directed feature chain before calling `stepPath`, whose legacy fallback is intentionally permissive. */
function validateFeatureChain(
  segmentId: string,
  serviceId: string,
  fromStationId: string,
  toStationId: string,
  network: RailwayNetwork,
  geometry: GeometryIndex,
): boolean {
  const segment = findSegment(network, serviceId, fromStationId, toStationId);
  if (!segment || segment.id !== segmentId || segment.serviceId !== serviceId) return false;
  const featureIds: readonly string[] = segment.geometryFeatureIds;
  if (!Array.isArray(featureIds) || featureIds.length === 0) return false;

  let currentStationId = fromStationId;
  let previousPoint: Position | undefined;
  for (const featureId of featureIds) {
    const feature = geometry.get(featureId);
    if (!feature) return false;
    const nextStationId = feature.fromStationId === currentStationId
      ? feature.toStationId
      : feature.toStationId === currentStationId ? feature.fromStationId : null;
    if (!nextStationId) return false;
    const points = orientedFeaturePoints(feature, currentStationId, nextStationId);
    if (!points) return false;
    if (previousPoint && !isSamePosition(previousPoint, points[0])) return false;
    previousPoint = points.at(-1);
    currentStationId = nextStationId;
  }
  return currentStationId === toStationId;
}

function hasValidStepGeometry(path: StepPath): boolean {
  if (path.points.length < 2 || path.points.some((point) => !isPosition(point))) return false;
  if (path.cumulative.length !== path.points.length || path.cumulative.some((distance) => !Number.isFinite(distance))) return false;
  if (path.cumulative[0] !== 0) return false;
  for (let index = 1; index < path.cumulative.length; index += 1) {
    if ((path.cumulative[index] ?? 0) < (path.cumulative[index - 1] ?? 0)) return false;
  }
  return Number.isFinite(path.total) && path.total > 0 && path.total === path.cumulative.at(-1);
}

function buildDrawnHops(
  traversals: readonly ClearRecordTraversal[],
  network: RailwayNetwork,
  geometry: GeometryIndex,
  lineGroupId: (serviceId: string) => string,
): DrawnHop[] | null {
  const drawn: DrawnHop[] = [];
  let currentLineGroupId: string | null = null;
  let continuityBreakPending = false;
  for (const traversal of traversals) {
    if (traversal.kind === "invalid") {
      continuityBreakPending = true;
      return null;
    }
    if (traversal.kind === "deadhead") {
      continuityBreakPending = true;
      currentLineGroupId = null;
      continue;
    }

    const rideLineGroupId = lineGroupId(traversal.ride.serviceId);
    if (currentLineGroupId !== null && currentLineGroupId !== rideLineGroupId) {
      continuityBreakPending = true;
    }
    currentLineGroupId = rideLineGroupId;
    for (const hop of traversal.hops) {
      if (!validateFeatureChain(hop.event.segmentId, hop.event.serviceId, hop.event.fromStationId,
        hop.event.toStationId, network, geometry)) return null;
      try {
        const path = stepPath(hop.event, network, geometry);
        if (!hasValidStepGeometry(path)) return null;
        drawn.push({ hop, path, breaksContinuityBefore: continuityBreakPending });
        continuityBreakPending = false;
      } catch {
        return null;
      }
    }

    if (traversal.landing) {
      const landingLineGroupId = lineGroupId(traversal.landing.serviceId);
      if (landingLineGroupId !== rideLineGroupId) {
        continuityBreakPending = true;
        currentLineGroupId = landingLineGroupId;
      }
    }
  }
  return drawn.length > 0 ? drawn : null;
}

function startsNewLeg(previous: DrawnHop | undefined, current: DrawnHop, forceBreak: boolean): boolean {
  if (!previous || forceBreak) return true;
  return previous.hop.event.serviceId !== current.hop.event.serviceId ||
    previous.hop.lineGroupId !== current.hop.lineGroupId ||
    previous.hop.color !== current.hop.color ||
    !isSamePosition(previous.path.points.at(-1), current.path.points[0]);
}

function createLeg(firstStepIndex: number, hop: ClearHop): ClearRouteLeg {
  return {
    firstStepIndex,
    endStepIndexExclusive: firstStepIndex + 1,
    serviceId: hop.event.serviceId,
    lineGroupId: hop.lineGroupId,
    color: hop.color,
  };
}

function calculateBounds(steps: readonly StepPath[]): readonly [Position, Position] {
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;
  for (const step of steps) {
    for (const [longitude, latitude] of step.points) {
      minLongitude = Math.min(minLongitude, longitude);
      minLatitude = Math.min(minLatitude, latitude);
      maxLongitude = Math.max(maxLongitude, longitude);
      maxLatitude = Math.max(maxLatitude, latitude);
    }
  }
  return [[minLongitude, minLatitude], [maxLongitude, maxLatitude]];
}

/** Build a complete verified display route. Any missing or malformed hop rejects the whole route. */
export function buildClearRoute(
  traversals: readonly ClearRecordTraversal[],
  network: RailwayNetwork,
  geometry: GeometryIndex,
  lineGroupId: (serviceId: string) => string,
): ClearRoute | null {
  const drawn = buildDrawnHops(traversals, network, geometry, lineGroupId);
  if (!drawn) return null;

  const steps: StepPath[] = [];
  const legs: ClearRouteLeg[] = [];
  const turnSpans: ClearTurnSpan[] = [];
  let previous: DrawnHop | undefined;
  let legIndex = -1;
  let spanStepIndex = 0;

  for (const traversal of traversals) {
    if (traversal.kind === "invalid") return null;
    const firstStepIndex = spanStepIndex;
    const stepCount = traversal.kind === "ride" ? traversal.hops.length : 0;
    turnSpans.push({
      recordIndex: traversal.recordIndex,
      firstStepIndex,
      endStepIndexExclusive: firstStepIndex + stepCount,
    });
    spanStepIndex += stepCount;
  }

  for (const current of drawn) {
    const startsLeg = startsNewLeg(previous, current, current.breaksContinuityBefore);
    if (startsLeg) {
      legs.push(createLeg(steps.length, current.hop));
      legIndex += 1;
    } else {
      const leg = legs[legIndex];
      if (leg) legs[legIndex] = { ...leg, endStepIndexExclusive: steps.length + 1 };
    }
    steps.push(current.path);
    previous = current;
  }

  return { steps, legs, turnSpans, bounds: calculateBounds(steps) };
}

export interface ClearRouteFeatureProperties {
  serviceId: string;
  lineGroupId: string;
  color: string;
}

/** Plain mutable shape so MapLibre accepts it as GeoJSON without a cast, like the other map collections. */
export interface ClearRouteGeoJson {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: ClearRouteFeatureProperties;
    geometry: { type: "LineString"; coordinates: Position[] };
  }[];
}

function addCoordinate(coordinates: Position[], point: Position): void {
  if (!isSamePosition(coordinates.at(-1), point)) coordinates.push([point[0], point[1]]);
}

function partialStepPoints(step: StepPath, fraction: number): Position[] {
  const target = step.total * Math.min(1, Math.max(0, fraction));
  const points: Position[] = [step.points[0]!];
  for (let index = 1; index < step.points.length; index += 1) {
    const startDistance = step.cumulative[index - 1] ?? 0;
    const endDistance = step.cumulative[index] ?? startDistance;
    const start = step.points[index - 1]!;
    const end = step.points[index]!;
    if (endDistance <= target) {
      addCoordinate(points, end);
      continue;
    }
    if (target > startDistance && endDistance > startDistance) {
      const ratio = (target - startDistance) / (endDistance - startDistance);
      addCoordinate(points, [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]);
    }
    break;
  }
  return points;
}

function legCoordinates(route: ClearRoute, leg: ClearRouteLeg, cursorStepIndex = Infinity, fraction = 1): Position[] {
  const coordinates: Position[] = [];
  for (let stepIndex = leg.firstStepIndex; stepIndex < leg.endStepIndexExclusive; stepIndex += 1) {
    if (stepIndex > cursorStepIndex) break;
    const step = route.steps[stepIndex];
    if (!step) continue;
    const points = stepIndex === cursorStepIndex ? partialStepPoints(step, fraction) : step.points;
    for (const point of points) addCoordinate(coordinates, point);
  }
  return coordinates;
}

/**
 * The complete travelled route, one LineString per leg in the ridden service's colour. A leg break starts a new
 * LineString, so a relocation or a change of line never produces a connecting line.
 */
export function buildClearRouteGeoJson(
  route: ClearRoute,
  cursor?: { readonly stepIndex: number; readonly fraction: number },
): ClearRouteGeoJson {
  return {
    type: "FeatureCollection",
    features: route.legs.flatMap((leg) => {
      const coordinates = legCoordinates(route, leg, cursor?.stepIndex, cursor?.fraction);
      if (coordinates.length < 2) return [];
      return [{
        type: "Feature" as const,
        properties: { serviceId: leg.serviceId, lineGroupId: leg.lineGroupId, color: leg.color },
        geometry: { type: "LineString" as const, coordinates },
      }];
    }),
  };
}
