import type { LngLatLike, Map as MapLibreMap } from "maplibre-gl";
import { LAYER_IDS } from "./mapConfig";

/** Circle layers a station can be clicked on. */
export const STATION_MARKER_LAYERS = [LAYER_IDS.stationCircles, LAYER_IDS.stationCirclesOrdinary] as const;

export interface StationSelection {
  name: string;
  lineNames: string;
  lngLat: LngLatLike;
}

/**
 * Click and hover handling for the station markers. Each event is registered
 * once for both circle layers: a click on overlapping key and ordinary circles
 * selects one station, and leaving one circle cannot clear the cursor set by
 * the other.
 */
export function bindStationInteractions(map: MapLibreMap, onSelect: (station: StationSelection) => void): void {
  const layers = [...STATION_MARKER_LAYERS];
  map.on("click", layers, (event) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    const { name, lineNames } = feature.properties as { name: string; lineNames: string };
    const [lon, lat] = feature.geometry.coordinates;
    if (lon === undefined || lat === undefined) return;
    onSelect({ name, lineNames, lngLat: [lon, lat] });
  });
  map.on("mouseenter", layers, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layers, () => {
    map.getCanvas().style.cursor = "";
  });
}
