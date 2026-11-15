import type { Direction } from "../../types/network";
import { nextStationId, targetHopDistances, type RailwayNetwork } from "./engine";

export const TARGET_PROXIMITY_COPY = {
  prefix: "山手線まで あと",
  stationSuffix: "駅",
  closer: "（近づく）",
  farther: "（遠ざかる）",
} as const;

const TARGET_DISTANCE = 0;

export interface TargetProximity {
  readonly hops: number;
  readonly trend: "closer" | "farther" | null;
  readonly text: string;
}

export interface TargetProximityInput {
  readonly stationId: string;
  readonly ride: Readonly<{ serviceId: string; direction: Direction }>;
  readonly targetServiceId: string;
  readonly targetComplete: boolean;
}

export function deriveTargetProximity(
  input: TargetProximityInput,
  network: RailwayNetwork,
): TargetProximity | null {
  if (input.ride.serviceId === input.targetServiceId || input.targetComplete) return null;
  const distances = targetHopDistances(network, input.targetServiceId);
  const hops = distances.get(input.stationId);
  if (hops === undefined || hops === TARGET_DISTANCE) return null;
  const nextStation = nextStationId(network, input.ride.serviceId, input.stationId, input.ride.direction);
  const nextDistance = nextStation === undefined ? undefined : distances.get(nextStation);
  const trend = nextDistance === undefined ? null
    : nextDistance < hops ? "closer" : nextDistance > hops ? "farther" : null;
  const trendText = trend === null ? "" : TARGET_PROXIMITY_COPY[trend];
  return {
    hops,
    trend,
    text: `${TARGET_PROXIMITY_COPY.prefix}${hops}${TARGET_PROXIMITY_COPY.stationSuffix}${trendText}`,
  };
}
