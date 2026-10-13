// Distances to the target, in directed gameplay hops. Transfers at a shared
// station are free; a rapid service segment is one hop regardless of geometry.

import type { ServiceId, StationId } from "../../../types/network";
import { GameEngineError } from "./errors";
import type { RailwayNetwork } from "./network";

// Built networks, including nested records and arrays, are immutable by contract.
// This identity-keyed cache has no invalidation; edits require building a new network.
const cache = new WeakMap<RailwayNetwork, Map<ServiceId, ReadonlyMap<StationId, number>>>();

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
