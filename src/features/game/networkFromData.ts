import type { RailwayData } from "../../data/loaders";
import {
  buildRailwayNetwork,
  GameEngineError,
  isGameEngineError,
  type RailwayNetwork,
  validateConfig,
} from "./engine";
import { EXPECTED_STATION_COUNTS, MVP_GAME_CONFIG } from "./gameConfig";

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
      { expectedStationCounts: EXPECTED_STATION_COUNTS },
    );
    validateConfig(MVP_GAME_CONFIG, network);
    if (data.geometry.ok) {
      const features = new Map(data.geometry.value.features.map((feature) => [feature.id, feature]));
      if (features.size !== data.geometry.value.features.length) {
        throw new GameEngineError("INVALID_NETWORK", "Duplicate geometry feature id");
      }
      for (const segment of network.segmentsById.values()) {
        const feature = features.get(segment.geometryFeatureId);
        const properties = feature?.properties;
        const matchesPair = properties && (
          (properties.from === segment.from && properties.to === segment.to) ||
          (properties.from === segment.to && properties.to === segment.from)
        );
        if (!matchesPair || properties.serviceId !== segment.serviceId) {
          throw new GameEngineError("INVALID_NETWORK", `Invalid geometry for ${segment.id}`);
        }
      }
    }
    return { ok: true, network };
  } catch (error) {
    if (isGameEngineError(error)) return { ok: false, reason: "路線データが不正です" };
    throw error;
  }
}
