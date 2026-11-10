import type { Position } from "../../types/data";
import type { Direction } from "../../types/network";
import type { DisplayedProgress } from "./animation/displayedProgress";
import { nextStationId, platformPosition, type RailwayNetwork } from "./engine";

export interface GoalGuidance {
  stationId: string;
  stationName: string;
  text: string;
}

type DisplayRide = Readonly<{ serviceId: string; direction: Direction }>;

const HALF_CIRCLE_DEGREES = 180;
const FULL_CIRCLE_DEGREES = 360;
const RADIANS_PER_DEGREE = Math.PI / HALF_CIRCLE_DEGREES;
const DEGREES_PER_RADIAN = HALF_CIRCLE_DEGREES / Math.PI;
const REVERSE_DIRECTIONS: Readonly<Record<Direction, Direction>> = { 1: -1, [-1]: 1 };

function radians(degrees: number): number {
  return degrees * RADIANS_PER_DEGREE;
}

function bearingBetween(from: Position | null, to: Position | null): number | null {
  if (!from || !to) return null;
  const [fromLongitude, fromLatitude] = from;
  const [toLongitude, toLatitude] = to;
  if (![fromLongitude, fromLatitude, toLongitude, toLatitude].every(Number.isFinite)) return null;
  if (fromLongitude === toLongitude && fromLatitude === toLatitude) return null;

  const startLatitude = radians(fromLatitude);
  const endLatitude = radians(toLatitude);
  const longitudeDifference = radians(toLongitude - fromLongitude);
  const y = Math.sin(longitudeDifference) * Math.cos(endLatitude);
  const x = Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDifference);
  if (x === 0 && y === 0) return null;

  const degrees = Math.atan2(y, x) * DEGREES_PER_RADIAN;
  return ((degrees % FULL_CIRCLE_DEGREES) + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES;
}

/** Bearing for the revealed ride, falling back to its incoming heading at a terminus. */
export function displayedHeading(
  progress: Pick<DisplayedProgress, "stationId">,
  ride: DisplayRide,
  network: RailwayNetwork,
): number | null {
  const nextStation = nextStationId(network, ride.serviceId, progress.stationId, ride.direction);
  if (nextStation) {
    return bearingBetween(
      platformPosition(network, ride.serviceId, progress.stationId),
      platformPosition(network, ride.serviceId, nextStation),
    );
  }

  const previousStation = nextStationId(
    network,
    ride.serviceId,
    progress.stationId,
    REVERSE_DIRECTIONS[ride.direction],
  );
  if (!previousStation) return null;
  return bearingBetween(
    platformPosition(network, ride.serviceId, previousStation),
    platformPosition(network, ride.serviceId, progress.stationId),
  );
}

/** First turn whose accepted directed segments complete every required target segment. */
export function firstTargetCompletionTurn(
  records: readonly Readonly<{
    turn: number;
    traversedSegmentIds: readonly string[];
  }>[],
  requiredIds: readonly string[],
): number | null {
  const required = new Set(requiredIds);
  if (required.size === 0) return null;

  const completed = new Set<string>();
  for (const record of records) {
    for (const segmentId of record.traversedSegmentIds) {
      if (required.has(segmentId)) completed.add(segmentId);
    }
    if (required.size === completed.size) return record.turn;
  }
  return null;
}
