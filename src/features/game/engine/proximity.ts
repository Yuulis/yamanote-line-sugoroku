// Distances to the target, in directed gameplay hops. Transfers at a shared
// station are free; a rapid service segment is one hop regardless of geometry.

import type { ServiceId, StationId } from "../../../types/network";
import { GameEngineError } from "./errors";
import type { RailwayNetwork } from "./network";

// Built networks, including nested records and arrays, are immutable by contract.
// This identity-keyed cache has no invalidation; edits require building a new network.
const cache = new WeakMap<RailwayNetwork, Map<ServiceId, ReadonlyMap<StationId, number>>>();
const adjacencyCache = new WeakMap<RailwayNetwork, ReadonlyMap<StationId, readonly StationId[]>>();

export interface NearestTargetStation {
  stationId: StationId;
  /** Directed search distance, not a count of segments ridden by deadhead. */
  distance: number;
}

function forwardAdjacency(network: RailwayNetwork): ReadonlyMap<StationId, readonly StationId[]> {
  const cached = adjacencyCache.get(network);
  if (cached) return cached;
  const adjacency = new Map<StationId, StationId[]>();
  for (const segment of network.segmentsById.values()) {
    const next = adjacency.get(segment.from) ?? [];
    next.push(segment.to);
    adjacency.set(segment.from, next);
  }
  adjacencyCache.set(network, adjacency);
  return adjacency;
}

/**
 * Forward BFS over directed segments. Ties at the first reachable depth use
 * target station order, independently of adjacency or service iteration order.
 * @throws GameEngineError `INVALID_STATE` for an unknown origin or no path,
 *   `INVALID_NETWORK` for an unknown target service.
 */
export function nearestTargetStation(
  network: RailwayNetwork,
  targetServiceId: ServiceId,
  from: StationId,
): NearestTargetStation {
  const target = network.servicesById.get(targetServiceId);
  if (!target) throw new GameEngineError("INVALID_NETWORK", `Unknown target service ${targetServiceId}`);
  if (!network.stationsById.has(from)) throw new GameEngineError("INVALID_STATE", `Unknown origin station ${from}`);
  const adjacency = forwardAdjacency(network);
  const seen = new Set<StationId>([from]);
  let frontier: StationId[] = [from];
  for (let distance = 0; frontier.length > 0; distance += 1) {
    const reached = new Set(frontier);
    const stationId = target.stationIds.find((id) => reached.has(id));
    if (stationId !== undefined) return { stationId, distance };
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
  throw new GameEngineError("INVALID_STATE", `No target station reachable from ${from} on ${targetServiceId}`);
}

/**
 * Reverse-edge multi-source BFS from every target stop. Missing map entries
 * are unreachable (callers compare them as Infinity). Cache by immutable
 * network identity and target id; neither input is mutated. Landing calls
 * this only when the direction policy differs from uniform.
 */
export function targetHopDistances(
  network: RailwayNetwork,
  targetServiceId: ServiceId,
): ReadonlyMap<StationId, number> {
  const cached = cache.get(network)?.get(targetServiceId);
  if (cached) return cached;
  const target = network.servicesById.get(targetServiceId);
  if (!target) throw new GameEngineError("INVALID_NETWORK", `Unknown target service ${targetServiceId}`);
  const predecessors = new Map<StationId, StationId[]>();
  for (const segment of network.segmentsById.values()) {
    const incoming = predecessors.get(segment.to) ?? [];
    incoming.push(segment.from);
    predecessors.set(segment.to, incoming);
  }
  const distances = new Map<StationId, number>();
  const queue: StationId[] = [...target.stationIds];
  for (const stationId of queue) distances.set(stationId, 0);
  for (let head = 0; head < queue.length; head += 1) {
    const stationId = queue[head]!;
    const nextDistance = distances.get(stationId)! + 1;
    for (const predecessor of predecessors.get(stationId) ?? []) {
      if (distances.has(predecessor)) continue;
      distances.set(predecessor, nextDistance);
      queue.push(predecessor);
    }
  }
  const targets = cache.get(network) ?? new Map<ServiceId, ReadonlyMap<StationId, number>>();
  targets.set(targetServiceId, distances);
  cache.set(network, targets);
  return distances;
}
