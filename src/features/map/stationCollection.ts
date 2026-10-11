import type { ServicePattern, Station } from "../../types/network";
import { LINE_NAME_SEPARATOR } from "./mapConfig";

export interface StationFeatureProperties {
  id: string;
  name: string;
  lineNames: string;
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

/** Build a point FeatureCollection with the line names serving each station. */
export function buildStationCollection(
  stations: readonly Station[],
  services: readonly ServicePattern[],
): StationFeatureCollection {
  const features = stations.map((station): StationFeature => {
    const lineNames = services
      .filter((service) => service.stationIds.includes(station.id))
      .map((service) => service.name)
      .join(LINE_NAME_SEPARATOR);
    return {
      type: "Feature",
      id: station.id,
      properties: { id: station.id, name: station.name, lineNames },
      geometry: { type: "Point", coordinates: [...station.coordinates] },
    };
  });
  return { type: "FeatureCollection", features };
}
