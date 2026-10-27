// Throwaway spike, round 2 (2026-10-27): movement helpers for the 快速券 (rapid),
// 寝過ごし (oversleep) and 回送列車 (deadhead) items. They only compute hop
// counts or a destination; the move itself still goes through the engine's
// `advance`, so segment completion and goal truncation stay engine-defined.

import * as engine from "../../../src/features/game/engine";
import type { Direction, ServiceId, StationId } from "../../../src/types/network";

/** Stations served by two or more services (the stations a rapid ticket counts). */
export function transferStations(network: engine.RailwayNetwork): ReadonlySet<StationId> {
  const stations = new Set<StationId>();
  for (const stationId of network.stationsById.keys()) {
    if (engine.transferOptions(network, stationId).length >= 2) stations.add(stationId);
  }
  return stations;
}

/** Directed station adjacency over every service segment. */
export function forwardAdjacency(network: engine.RailwayNetwork): ReadonlyMap<StationId, readonly StationId[]> {
  const adjacency = new Map<StationId, StationId[]>();
  for (const segment of network.segmentsById.values()) {
    const next = adjacency.get(segment.from) ?? [];
    if (!next.includes(segment.to)) next.push(segment.to);
    adjacency.set(segment.from, next);
  }
  return adjacency;
}

function hopLimit(network: engine.RailwayNetwork): number {
  return network.stationsById.size * 2;
}

/**
 * Hops needed to reach the `pips`-th transfer station ahead on the current
 * service and direction, or the endpoint if it comes first. Non-transfer
 * stations are passed without spending a pip.
 */
export function rapidHops(
  network: engine.RailwayNetwork, transfers: ReadonlySet<StationId>,
  serviceId: ServiceId, stationId: StationId, direction: Direction, pips: number,
): number {
  let hops = 0;
  let remaining = pips;
  let station = stationId;
  while (remaining > 0 && hops < hopLimit(network)) {
    const next = engine.nextStationId(network, serviceId, station, direction);
    if (next === undefined) break;
    hops += 1;
    station = next;
    if (transfers.has(next)) remaining -= 1;
  }
  return hops;
}

/** Hops from `stationId` to the end of a linear service in `direction`. */
export function hopsToEndpoint(
  network: engine.RailwayNetwork, serviceId: ServiceId, stationId: StationId, direction: Direction,
): number {
  let hops = 0;
  let station = stationId;
  for (;;) {
    const next = engine.nextStationId(network, serviceId, station, direction);
    if (next === undefined || hops >= hopLimit(network)) return hops;
    hops += 1;
    station = next;
  }
}

/**
 * Nearest target-service station by directed hop distance (forward BFS over
 * all segments); ties go to the lowest index in the target's station order.
 */
export function nearestTargetStation(
  adjacency: ReadonlyMap<StationId, readonly StationId[]>,
  targetStationIds: readonly StationId[],
  from: StationId,
): StationId | undefined {
  const order = new Map(targetStationIds.map((id, index) => [id, index]));
  const seen = new Set<StationId>([from]);
  let frontier: StationId[] = [from];
  while (frontier.length > 0) {
    const reached = frontier.filter((id) => order.has(id));
    if (reached.length > 0) {
      return reached.reduce((best, id) => ((order.get(id) ?? 0) < (order.get(best) ?? 0) ? id : best));
    }
    const next: StationId[] = [];
    for (const station of frontier) {
      for (const neighbour of adjacency.get(station) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return undefined;
}
