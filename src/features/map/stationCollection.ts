import type { ServicePattern, Station } from "../../types/network";
import type { PresentationResolver } from "../game/presentationResolver";
import { DEFAULT_GAME_CONFIG } from "../game/gameConfig";
import {
  LABEL_MIN_ZOOM,
  LABEL_ORDINARY_MIN_ZOOM,
  LINE_NAME_SEPARATOR,
  TRANSFER_MIN_SERVICES,
} from "./mapConfig";
import { labelSortKey, type StationTier } from "./stationMarkers";

export interface StationFeatureProperties {
  id: string;
  name: string;
  lineNames: string;
  labelTier: StationTier;
  labelEligibleAt: number;
  labelPriority: number;
}

export interface StationFeature {
  type: "Feature";
  id: string;
  properties: StationFeatureProperties;
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface StationFeatureCollection {
  type: "FeatureCollection";
  features: StationFeature[];
}

/** Build map labels and popup data from canonical stations plus presentation metadata. */
export function buildStationCollection(
  stations: readonly Station[],
  services: readonly ServicePattern[],
  presentation?: Pick<
    PresentationResolver,
    "stationName" | "serviceStationName" | "serviceName" | "lineGroupId"
  >,
  serviceIdsByStation: ReadonlyMap<string, readonly string[]> = indexStationServices(services),
  targetServiceId = DEFAULT_GAME_CONFIG.targetServiceId,
): StationFeatureCollection {
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const features = stations.map((station, stationOrder): StationFeature => {
    const serviceIds = serviceIdsByStation.get(station.id) ?? [];
    const tier = getStationTier(serviceIds, targetServiceId);
    const labelName = presentation?.stationName(station.id) ?? station.name;
    const labelParts = new Set(labelName.split("・"));
    const groupedLineNames = new Map<string, { name: string; stopNames: Set<string> }>();
    for (const serviceId of serviceIds) {
      const service = serviceById.get(serviceId);
      if (!service) continue;
      const groupId = presentation?.lineGroupId(serviceId) ?? serviceId;
      const name = presentation?.serviceName(serviceId) ?? service.name;
      const line = groupedLineNames.get(groupId) ?? { name, stopNames: new Set<string>() };
      const stopParts = presentation?.serviceStationName(serviceId, station.id)
        .split("・")
        .filter((part) => !labelParts.has(part)) ?? [];
      for (const stopName of stopParts) line.stopNames.add(stopName);
      groupedLineNames.set(groupId, line);
    }
    const lineNames = [...groupedLineNames.values()]
      .map(({ name, stopNames }) => stopNames.size > 0 ? `${name}（${[...stopNames].join("・")}）` : name)
      .join(LINE_NAME_SEPARATOR);
    return {
      type: "Feature",
      id: station.id,
      properties: {
        id: station.id,
        name: labelName,
        lineNames,
        labelTier: tier,
        labelEligibleAt: tier === "ordinary" ? LABEL_ORDINARY_MIN_ZOOM : LABEL_MIN_ZOOM,
        labelPriority: labelSortKey(tier, stationOrder, stations.length),
      },
      geometry: { type: "Point", coordinates: [...station.coordinates] },
    };
  });
  return { type: "FeatureCollection", features };
}

function indexStationServices(services: readonly ServicePattern[]): ReadonlyMap<string, readonly string[]> {
  const byStation = new Map<string, string[]>();
  for (const service of services) {
    for (const stationId of service.stationIds) {
      const serviceIds = byStation.get(stationId) ?? [];
      if (!serviceIds.includes(service.id)) serviceIds.push(service.id);
      byStation.set(stationId, serviceIds);
    }
  }
  return byStation;
}

function getStationTier(serviceIds: readonly string[], targetServiceId: string): StationTier {
  if (serviceIds.includes(targetServiceId)) return "target";
  return serviceIds.length >= TRANSFER_MIN_SERVICES ? "transfer" : "ordinary";
}
