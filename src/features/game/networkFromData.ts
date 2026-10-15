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
        services: services.value.services,
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
      const lines = new Set(services.value.lines.map((line) => line.id));
      for (const feature of features.values()) {
        const { serviceId, lineId, from, to } = feature.properties;
        const owner = network.servicesById.get(serviceId);
        const index = owner?.stationIds.indexOf(from) ?? -1;
        const next = owner?.stationIds[(index + 1) % owner.stationIds.length];
        if (!owner || !lines.has(lineId) || !owner.lineIds.includes(lineId) || index < 0 ||
            (!owner.circular && index === owner.stationIds.length - 1) || next !== to) {
          throw new GameEngineError("INVALID_NETWORK", `Invalid geometry owner pair ${feature.id}`);
        }
      }
      const used = new Set<string>();
      for (const segment of network.segmentsById.values()) {
        let current = segment.from;
        let previous: readonly number[] | undefined;
        const visited = new Set([current]);
        for (const id of segment.geometryFeatureIds) {
          const feature = features.get(id);
          if (!feature) throw new GameEngineError("INVALID_NETWORK", `Missing geometry ${id}`);
          const { from, to } = feature.properties;
          const forward = from === current;
          if (!forward && to !== current) throw new GameEngineError("INVALID_NETWORK", `Misordered geometry for ${segment.id}`);
          current = forward ? to : from;
          if (visited.has(current)) throw new GameEngineError("INVALID_NETWORK", `Backtracking geometry for ${segment.id}`);
          visited.add(current);
          const points = feature.geometry.coordinates;
          const start = forward ? points[0]! : points.at(-1)!;
          if (previous && (previous[0] !== start[0] || previous[1] !== start[1])) {
            throw new GameEngineError("INVALID_NETWORK", `Geometry joint gap for ${segment.id}`);
          }
          previous = forward ? points.at(-1)! : points[0]!;
          used.add(id);
        }
        if (current !== segment.to) throw new GameEngineError("INVALID_NETWORK", `Wrong geometry endpoint for ${segment.id}`);
        const reverse = network.segmentsByEndpoints.get(JSON.stringify([segment.serviceId, segment.to, segment.from]));
        if (reverse && (reverse.geometryFeatureIds.length !== segment.geometryFeatureIds.length ||
            !segment.geometryFeatureIds.every((id, index) => id === reverse.geometryFeatureIds[reverse.geometryFeatureIds.length - 1 - index]))) {
          throw new GameEngineError("INVALID_NETWORK", `Wrong reverse chain for ${segment.id}`);
        }
      }
      if (used.size !== features.size) throw new GameEngineError("INVALID_NETWORK", "Orphan geometry feature");
    }
    return { ok: true, network };
  } catch (error) {
    if (isGameEngineError(error)) return { ok: false, reason: "路線データが不正です" };
    throw error;
  }
}
