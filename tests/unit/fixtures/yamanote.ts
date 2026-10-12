// In-memory Yamanote network for engine tests (does not read public/data).

import type {
  GameConfig,
  Segment,
  ServicePattern,
  Station,
} from "../../../src/types/network";
import type { RailwayNetworkInput } from "../../../src/features/game/engine";

export const SERVICE_ID = "jr-yamanote";
export const OTHER_SERVICE_ID = "test-shuttle";
export const START = "shimbashi";
export const DATA_VERSION = "test-data-1";

/** Outer-loop order, S[0] = 新橋 ... S[29] = 有楽町. */
export const STATION_IDS = [
  "shimbashi",
  "hamamatsucho",
  "tamachi",
  "takanawa-gateway",
  "shinagawa",
  "osaki",
  "gotanda",
  "meguro",
  "ebisu",
  "shibuya",
  "harajuku",
  "yoyogi",
  "shinjuku",
  "shin-okubo",
  "takadanobaba",
  "mejiro",
  "ikebukuro",
  "otsuka",
  "sugamo",
  "komagome",
  "tabata",
  "nishi-nippori",
  "nippori",
  "uguisudani",
  "ueno",
  "okachimachi",
  "akihabara",
  "kanda",
  "tokyo",
  "yurakucho",
] as const;

export const LAST_STATION = "yurakucho";

function station(id: string, index: number): Station {
  return { id, name: id, coordinates: [139.7 + index / 1000, 35.6 + index / 1000] };
}

function loopSegments(serviceId: string, ids: readonly string[]): Segment[] {
  return ids.map((from, index) => {
    const to = ids[(index + 1) % ids.length] as string;
    const id = `${serviceId}:${from}:${to}`;
    return { id, serviceId, from, to, geometryFeatureId: id };
  });
}

/** A fresh service object on every call, so tests that mutate it stay isolated. */
function yamanoteService(): ServicePattern {
  return {
    id: SERVICE_ID,
    name: "山手線",
    operator: "東日本旅客鉄道",
    stationIds: [...STATION_IDS],
    circular: true,
    color: "#9ACD32",
  };
}

/** E[i] = S[i] -> S[(i+1) mod 30]. */
export const SEGMENT_IDS: string[] = loopSegments(SERVICE_ID, STATION_IDS).map(
  (segment) => segment.id,
);

export function segmentId(index: number): string {
  return SEGMENT_IDS[index] as string;
}

export function yamanoteInput(): RailwayNetworkInput {
  return {
    dataVersion: DATA_VERSION,
    stations: STATION_IDS.map(station),
    services: [yamanoteService()],
    segments: loopSegments(SERVICE_ID, STATION_IDS),
  };
}

/**
 * A 3-stop loop through 新橋 on a non-target service, with segments in both
 * directions (every non-target service must be ridable both ways).
 */
export const SHUTTLE_STATION_IDS = [START, "test-a", "test-b"] as const;

export function inputWithShuttle(): RailwayNetworkInput {
  const base = yamanoteInput();
  return {
    ...base,
    stations: [...base.stations, station("test-a", 100), station("test-b", 101)],
    services: [
      ...base.services,
      {
        id: OTHER_SERVICE_ID,
        name: "テスト環状線",
        operator: "test",
        stationIds: [...SHUTTLE_STATION_IDS],
        circular: true,
        color: "#000000",
      },
    ],
    segments: [
      ...base.segments,
      ...loopSegments(OTHER_SERVICE_ID, SHUTTLE_STATION_IDS),
      ...loopSegments(OTHER_SERVICE_ID, [...SHUTTLE_STATION_IDS].reverse()),
    ],
  };
}

export function configWith(policy: GameConfig["goalArrivalPolicy"]): GameConfig {
  return {
    rulesetVersion: "test-1",
    targetServiceId: SERVICE_ID,
    startStationId: START,
    targetDirection: 1,
    goalArrivalPolicy: policy,
  };
}

export const DEFAULT_CONFIG = configWith("truncate-on-target-service");

/** Recursively freeze so any mutation by the engine throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
