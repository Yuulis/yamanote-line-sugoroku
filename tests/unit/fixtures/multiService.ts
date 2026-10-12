// Small in-memory multi-service network for landing / endpoint tests.
//
//   target loop  M_LOOP   start -> a -> b -> c -> d -> e -> start   (+1 only)
//   linear       M_LINE   x - b - y - d - z    (both directions; x = terminus,
//                                              z = area boundary: the v1 data
//                                              contract cannot tell them apart)
//   linear spur  M_SPUR   b - s1 - s2          (both directions; b is its end)
//
// Transfer stations: b (loop, line, spur: k = 3) and d (loop, line: k = 2).
// Single-service stations: y, s1 (two movable directions), x, z, s2 (one).

import type { RailwayNetworkInput } from "../../../src/features/game/engine";
import type { GameConfig, Segment, ServicePattern, Station } from "../../../src/types/network";

export const M_LOOP = "m-loop";
export const M_LINE = "m-line";
export const M_SPUR = "m-spur";
export const M_START = "start";
export const M_DATA_VERSION = "multi-data-1";

export const LOOP_STATION_IDS = [M_START, "a", "b", "c", "d", "e"] as const;
export const LINE_STATION_IDS = ["x", "b", "y", "d", "z"] as const;
export const SPUR_STATION_IDS = ["b", "s1", "s2"] as const;

function station(id: string, index: number): Station {
  return { id, name: `駅${id}`, coordinates: [139.8 + index / 1000, 35.7 + index / 1000] };
}

function segment(serviceId: string, from: string, to: string): Segment {
  const id = `${serviceId}:${from}:${to}`;
  return { id, serviceId, from, to, geometryFeatureId: id };
}

/** Directed segments along `ids` (+1 order); `closed` adds the wrap pair. */
function forward(serviceId: string, ids: readonly string[], closed: boolean): Segment[] {
  const count = closed ? ids.length : ids.length - 1;
  return Array.from({ length: count }, (_, index) =>
    segment(serviceId, ids[index] as string, ids[(index + 1) % ids.length] as string),
  );
}

/** Both directions of every adjacent pair of a linear service. */
export function bothWays(serviceId: string, ids: readonly string[]): Segment[] {
  return [...forward(serviceId, ids, false), ...forward(serviceId, [...ids].reverse(), false)];
}

function service(
  id: string,
  stationIds: readonly string[],
  circular: boolean,
): ServicePattern {
  return { id, name: id, operator: "test", stationIds: [...stationIds], circular, color: "#123456" };
}

function uniqueStations(services: readonly ServicePattern[]): Station[] {
  const ids = [...new Set(services.flatMap((item) => item.stationIds))];
  return ids.map(station);
}

export function multiServiceInput(): RailwayNetworkInput {
  const services = [
    service(M_LOOP, LOOP_STATION_IDS, true),
    service(M_LINE, LINE_STATION_IDS, false),
    service(M_SPUR, SPUR_STATION_IDS, false),
  ];
  return {
    dataVersion: M_DATA_VERSION,
    stations: uniqueStations(services),
    services,
    segments: [
      ...forward(M_LOOP, LOOP_STATION_IDS, true),
      ...bothWays(M_LINE, LINE_STATION_IDS),
      ...bothWays(M_SPUR, SPUR_STATION_IDS),
    ],
  };
}

export function multiConfig(
  policy: GameConfig["goalArrivalPolicy"] = "truncate-on-target-service",
): GameConfig {
  return {
    rulesetVersion: "test-multi-1",
    targetServiceId: M_LOOP,
    startStationId: M_START,
    targetDirection: 1,
    goalArrivalPolicy: policy,
  };
}

export const LOOP_SEGMENT_IDS: string[] = forward(M_LOOP, LOOP_STATION_IDS, true).map(
  (item) => item.id,
);

/**
 * A 3-stop target loop (start, a, b) crossed at a and b by one long
 * bidirectional line, so a seeded game can wander the line for hundreds of
 * turns (long-history save tests).
 */
export const LONG_LINE = "long-line";

export function longLineInput(sideLength = 200, middleLength = 80): RailwayNetworkInput {
  const run = (prefix: string, length: number) =>
    Array.from({ length }, (_, index) => `${prefix}${index + 1}`);
  const lineIds = [...run("l", sideLength), "a", ...run("m", middleLength), "b", ...run("r", sideLength)];
  const loopIds = [M_START, "a", "b"];
  const services = [service(M_LOOP, loopIds, true), service(LONG_LINE, lineIds, false)];
  return {
    dataVersion: "long-data-1",
    stations: uniqueStations(services),
    services,
    segments: [...forward(M_LOOP, loopIds, true), ...bothWays(LONG_LINE, lineIds)],
  };
}
