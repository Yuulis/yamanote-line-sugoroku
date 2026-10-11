import type { RailwayData } from "../../data/loaders";
import {
  buildRailwayNetwork,
  isGameEngineError,
  type RailwayNetwork,
  validateConfig,
} from "./engine";
import { EXPECTED_STATION_COUNT, MVP_GAME_CONFIG } from "./gameConfig";

export type NetworkResult =
  | { ok: true; network: RailwayNetwork }
  | { ok: false; reason: string };

/** Build the engine network from loaded data, or explain why the game cannot start. */
export function networkFromData(data: RailwayData): NetworkResult {
  const { stations, services, segments, manifest } = data;
  if (!stations.ok || !services.ok || !segments.ok || !manifest.ok) {
    return { ok: false, reason: "必要なデータを読み込めませんでした" };
  }
  try {
    const network = buildRailwayNetwork(
      {
        dataVersion: manifest.value.dataVersion,
        stations: stations.value,
        services: services.value,
        segments: segments.value,
      },
      { expectedStationCount: EXPECTED_STATION_COUNT },
    );
    validateConfig(MVP_GAME_CONFIG, network);
    return { ok: true, network };
  } catch (error) {
    if (isGameEngineError(error)) return { ok: false, reason: "路線データが不正です" };
    throw error;
  }
}
