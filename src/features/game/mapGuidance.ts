import type { Position } from "../../types/data";
import type { Direction } from "../../types/network";
import type { DisplayedProgress } from "./animation/displayedProgress";
import { nextStationId, platformPosition, type RailwayNetwork } from "./engine";
import { advance, assertSettledPosition, type GamePosition } from "./engine/movement";
import { adjustedPips } from "./itemPresentation";
import type { PresentationResolver } from "./presentationResolver";

export interface GoalGuidance {
  stationId: string;
  stationName: string;
  text: string;
}

/** One legal roll-adjustment choice and the exact station its real resolution stops at. */
export interface AdjustmentLanding {
  delta: -1 | 0 | 1;
  pips: number;
  stationId: string;
  stationName: string;
  /** Platform of the landing station on the resolved ride; null if the data has none. */
  position: Position | null;
  /** Hops actually travelled; less than `pips` when the move truncates. */
  travelledSteps: number;
  stopReason: "roll" | "endpoint" | "goal";
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

/**
 * Exact landing of every legal choice (−1 / そのまま / +1), in that order. Duplicates stay separate entries.
 * Pure: the engine's `advance` copies its input, and neither RNG stream is drawn (the landing lottery runs
 * only after the stopping station is fixed). `position` carries the visible decision's resolved ride.
 */
export function adjustmentLandings(
  position: GamePosition,
  rawRoll: number,
  allowedDeltas: readonly (-1 | 1)[],
  network: RailwayNetwork,
  presentation: PresentationResolver,
): readonly AdjustmentLanding[] {
  assertSettledPosition(position, network);
  const deltas = ([-1, 0, 1] as const).filter((delta) => delta === 0 || allowedDeltas.includes(delta));
  return deltas.map((delta) => {
    const pips = adjustedPips(rawRoll, delta);
    const moved = advance(position, pips, network);
    return {
      delta,
      pips,
      stationId: moved.stationId,
      stationName: presentation.stationName(moved.stationId),
      position: platformPosition(network, position.currentServiceId, moved.stationId),
      travelledSteps: moved.traversedSegmentIds.length,
      stopReason: moved.stopReason,
    };
  });
}
