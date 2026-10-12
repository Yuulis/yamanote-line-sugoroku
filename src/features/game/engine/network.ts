// Railway network model for the engine: lookup tables built once from the
// loaded data and validated so movement never meets a dangling reference.

import type {
  Direction,
  Segment,
  SegmentId,
  ServiceId,
  ServicePattern,
  Station,
  StationId,
} from "../../../types/network";
import { GameEngineError } from "./errors";

export interface RailwayNetworkInput {
  dataVersion: string;
  stations: readonly Station[];
  services: readonly ServicePattern[];
  segments: readonly Segment[];
}

export interface RailwayNetworkOptions {
  /**
   * Per-service stop counts the data must match (e.g. `{ "jr-yamanote": 30 }`).
   * A key naming a service the data does not contain is an error, so a typo
   * cannot silently disable the check.
   */
  expectedStationCounts?: Readonly<Partial<Record<ServiceId, number>>>;
}

export interface RailwayNetwork {
  readonly dataVersion: string;
  readonly stationsById: ReadonlyMap<StationId, Station>;
  /** In data (services.json) order; this order is the lottery candidate order. */
  readonly servicesById: ReadonlyMap<ServiceId, ServicePattern>;
  readonly segmentsById: ReadonlyMap<SegmentId, Segment>;
  /** Directed lookup keyed by {@link segmentKey}. */
  readonly segmentsByEndpoints: ReadonlyMap<string, Segment>;
  /** Services stopping at each station, deduplicated, in data order. */
  readonly servicesByStation: ReadonlyMap<StationId, readonly ServiceId[]>;
}

/** A service the player may board on landing at a station (spec 4.1, design C6). */
export interface TransferOption {
  serviceId: ServiceId;
  /** Where the player boards; always the landing station while stations are shared ids. */
  boardingStationId: StationId;
}

/** Canonical direction order for candidates and lotteries. */
export const DIRECTIONS: readonly Direction[] = [1, -1];

const MIN_LOOP_STOPS = 3;
const MIN_LINEAR_STOPS = 2;

function segmentKey(
  serviceId: ServiceId,
  from: StationId,
  to: StationId,
): string {
  return JSON.stringify([serviceId, from, to]);
}

function invalid(message: string): never {
  throw new GameEngineError("INVALID_NETWORK", message);
}

function indexUnique<T extends { id: string }>(
  items: readonly T[],
  kind: string,
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (byId.has(item.id)) invalid(`Duplicate ${kind} id: ${item.id}`);
    byId.set(item.id, item);
  }
  return byId;
}

/** Station ids in travel order for `direction` (+1 = stationIds order). */
function orderedStationIds(
  service: ServicePattern,
  direction: Direction,
): StationId[] {
  return direction === 1 ? [...service.stationIds] : [...service.stationIds].reverse();
}

/** Consecutive (from, to) pairs a train on `service` runs in `direction`. */
export function servicePairs(
  service: ServicePattern,
  direction: Direction,
): [StationId, StationId][] {
  const ids = orderedStationIds(service, direction);
  const pairCount = service.circular ? ids.length : ids.length - 1;
  return Array.from({ length: Math.max(pairCount, 0) }, (_, index) => {
    const from = ids[index] as StationId;
    const to = ids[(index + 1) % ids.length] as StationId;
    return [from, to];
  });
}

function validateService(
  service: ServicePattern,
  stationsById: ReadonlyMap<StationId, Station>,
): void {
  const minStops = service.circular ? MIN_LOOP_STOPS : MIN_LINEAR_STOPS;
  if (service.stationIds.length < minStops) invalid(`Service ${service.id} is too short`);
  if (new Set(service.stationIds).size !== service.stationIds.length) {
    invalid(`Service ${service.id} lists a station twice`);
  }
  for (const stationId of service.stationIds) {
    if (!stationsById.has(stationId)) {
      invalid(`Service ${service.id} references unknown station ${stationId}`);
    }
  }
}

function validateSegment(
  segment: Segment,
  servicesById: ReadonlyMap<ServiceId, ServicePattern>,
): void {
  const service = servicesById.get(segment.serviceId);
  if (!service) invalid(`Segment ${segment.id} references unknown service`);
  const isServicePair = [1, -1].some((direction) =>
    servicePairs(service, direction as Direction).some(
      ([from, to]) => from === segment.from && to === segment.to,
    ),
  );
  if (!isServicePair) {
    invalid(`Segment ${segment.id} does not join adjacent stations of its service`);
  }
}

function validateExpectedCounts(
  servicesById: ReadonlyMap<ServiceId, ServicePattern>,
  options: RailwayNetworkOptions,
): void {
  for (const [serviceId, expected] of Object.entries(options.expectedStationCounts ?? {})) {
    if (expected === undefined) continue;
    const service = servicesById.get(serviceId);
    if (!service) invalid(`Expected station count for unknown service ${serviceId}`);
    if (!Number.isSafeInteger(expected) || expected < 0) {
      invalid(`Expected station count for ${serviceId} must be a non-negative integer`);
    }
    if (service.stationIds.length !== expected) {
      invalid(
        `Service ${serviceId} has ${service.stationIds.length} stations, expected ${expected}`,
      );
    }
  }
}

function indexServicesByStation(
  stationsById: ReadonlyMap<StationId, Station>,
  servicesById: ReadonlyMap<ServiceId, ServicePattern>,
): Map<StationId, ServiceId[]> {
  const byStation = new Map<StationId, ServiceId[]>();
  for (const service of servicesById.values()) {
    for (const stationId of service.stationIds) {
      byStation.set(stationId, [...(byStation.get(stationId) ?? []), service.id]);
    }
  }
  for (const stationId of stationsById.keys()) {
    if (!byStation.has(stationId)) invalid(`Station ${stationId} is not served by any service`);
  }
  return byStation;
}

/**
 * Build and validate the network structurally: unique ids, known references,
 * segments joining adjacent stops of their service, every station served.
 * Whether the segments cover what a game needs (target direction, both
 * directions of every other service) depends on the config and is checked
 * by `validateConfig`; movement still throws on a missing segment rather
 * than mistaking it for an endpoint.
 *
 * @throws GameEngineError `INVALID_NETWORK` on any inconsistency.
 */
export function buildRailwayNetwork(
  input: RailwayNetworkInput,
  options: RailwayNetworkOptions = {},
): RailwayNetwork {
  if (input.dataVersion.length === 0) invalid("dataVersion is empty");
  // Copy every record so later mutation of the loaded data cannot reach us.
  const stationsById = indexUnique(
    input.stations.map((station) => ({
      ...station,
      coordinates: [...station.coordinates] as Station["coordinates"],
    })),
    "station",
  );
  const servicesById = indexUnique(
    input.services.map((service) => ({
      ...service,
      stationIds: [...service.stationIds],
    })),
    "service",
  );
  const segmentsById = indexUnique(
    input.segments.map((segment) => ({ ...segment })),
    "segment",
  );
  if (servicesById.size === 0) invalid("No services");

  for (const service of servicesById.values()) {
    validateService(service, stationsById);
  }
  validateExpectedCounts(servicesById, options);
  const servicesByStation = indexServicesByStation(stationsById, servicesById);

  const segmentsByEndpoints = new Map<string, Segment>();
  for (const segment of segmentsById.values()) {
    validateSegment(segment, servicesById);
    const key = segmentKey(segment.serviceId, segment.from, segment.to);
    if (segmentsByEndpoints.has(key)) {
      invalid(`Segment ${segment.id} duplicates another segment's endpoints`);
    }
    segmentsByEndpoints.set(key, segment);
  }

  return {
    dataVersion: input.dataVersion,
    stationsById,
    servicesById,
    segmentsById,
    segmentsByEndpoints,
    servicesByStation,
  };
}

/** The directed segment from `from` to `to` on `serviceId`, if any. */
export function findSegment(
  network: RailwayNetwork,
  serviceId: ServiceId,
  from: StationId,
  to: StationId,
): Segment | undefined {
  return network.segmentsByEndpoints.get(segmentKey(serviceId, from, to));
}

/**
 * The next stop after `stationId` on `serviceId` in `direction`, or
 * `undefined` at the end of a non-circular service.
 */
export function nextStationId(
  network: RailwayNetwork,
  serviceId: ServiceId,
  stationId: StationId,
  direction: Direction,
): StationId | undefined {
  const service = network.servicesById.get(serviceId);
  if (!service) return undefined;
  const ids = service.stationIds;
  const index = ids.indexOf(stationId);
  if (index < 0) return undefined;
  const nextIndex = index + direction;
  if (service.circular) return ids[(nextIndex + ids.length) % ids.length];
  return ids[nextIndex];
}

/**
 * Segment ids a player must traverse to complete `serviceId` in `direction`.
 * Throws `INVALID_NETWORK` when a required directed segment is missing.
 */
export function requiredSegmentIds(
  network: RailwayNetwork,
  serviceId: ServiceId,
  direction: Direction,
): SegmentId[] {
  const service = network.servicesById.get(serviceId);
  if (!service) invalid(`Unknown service ${serviceId}`);
  return servicePairs(service, direction).map(([from, to]) => {
    const segment = findSegment(network, serviceId, from, to);
    if (!segment) invalid(`Service ${serviceId} has no segment ${from} -> ${to}`);
    return segment.id;
  });
}

/** Boardable services at `stationId`, one per service, in data order. */
export function transferOptions(
  network: RailwayNetwork,
  stationId: StationId,
): TransferOption[] {
  return (network.servicesByStation.get(stationId) ?? []).map((serviceId) => ({
    serviceId,
    boardingStationId: stationId,
  }));
}

/**
 * Directions in `[1, -1]` order in which `serviceId` has a next stop after
 * `stationId` (structural: a circular service is movable both ways). Empty
 * when the service does not stop there.
 */
export function movableDirections(
  network: RailwayNetwork,
  serviceId: ServiceId,
  stationId: StationId,
): Direction[] {
  return DIRECTIONS.filter(
    (direction) => nextStationId(network, serviceId, stationId, direction) !== undefined,
  );
}
