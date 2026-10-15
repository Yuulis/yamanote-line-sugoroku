import type { ExpressionSpecification } from "maplibre-gl";
import type { ServicePattern, Station } from "../../types/network";
import { ORDINARY_STATION_MIN_ZOOM, TRANSFER_MIN_SERVICES, type ZoomStops } from "./mapConfig";

/** How prominently a station is marked: target-line and transfer stations stay visible when zoomed out. */
export type StationTier = "target" | "transfer" | "ordinary";

export function classifyStation(servingServiceIds: readonly string[], targetServiceId: string): StationTier {
  if (servingServiceIds.includes(targetServiceId)) return "target";
  return servingServiceIds.length >= TRANSFER_MIN_SERVICES ? "transfer" : "ordinary";
}

/** Tier of every station, keyed by station id. */
export function classifyStations(
  stations: readonly Station[],
  services: readonly ServicePattern[],
  targetServiceId: string,
): Map<string, StationTier> {
  const serving = new Map<string, string[]>();
  for (const service of services) {
    for (const stationId of service.stationIds) serving.set(stationId, [...(serving.get(stationId) ?? []), service.id]);
  }
  return new Map(stations.map((station) => [station.id, classifyStation(serving.get(station.id) ?? [], targetServiceId)]));
}

/** Whether a station of this tier has its marker drawn at `zoom`. */
export function isStationMarkerVisible(tier: StationTier, zoom: number): boolean {
  return tier !== "ordinary" || zoom >= ORDINARY_STATION_MIN_ZOOM;
}

/** Ids of the stations whose marker is drawn at every zoom. */
export function keyStationIds(tiers: ReadonlyMap<string, StationTier>): string[] {
  return [...tiers].filter(([, tier]) => tier !== "ordinary").map(([id]) => id);
}

/** Paint expression interpolating `stops` over the map zoom. */
export function zoomInterpolation(stops: ZoomStops): ExpressionSpecification {
  // The tuple length is dynamic, which the library types cannot express.
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;
}
