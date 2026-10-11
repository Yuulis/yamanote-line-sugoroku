import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibreWorker";
import { useEffect, useRef, useState } from "react";
import type { RailwayData } from "../../data/loaders";
import { buildDataAttribution } from "./attribution";
import { LAYER_IDS, MAP_CENTER, MAP_STYLE_URL, MAP_ZOOM } from "./mapConfig";
import { addRailwayLayers, type MapProgress, updateGameProgress } from "./railwayLayers";
import { createStationPopupContent } from "./stationPopup";

interface RailwayMapProps {
  data: RailwayData;
  /** Game progress to draw; omitted when no game is running. */
  progress?: MapProgress;
}

function attachStationPopup(map: MapLibreMap): void {
  map.on("click", LAYER_IDS.stationCircles, (event) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    const { name, lineNames } = feature.properties as {
      name: string;
      lineNames: string;
    };
    const [lon, lat] = feature.geometry.coordinates;
    if (lon === undefined || lat === undefined) return;
    new Popup({ closeButton: true })
      .setLngLat([lon, lat])
      .setDOMContent(createStationPopupContent(name, lineNames))
      .addTo(map);
  });
  map.on("mouseenter", LAYER_IDS.stationCircles, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", LAYER_IDS.stationCircles, () => {
    map.getCanvas().style.cursor = "";
  });
}

export function RailwayMap({ data, progress }: RailwayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [styleFailed, setStyleFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The map instance once its layers exist, so progress can be applied to it.
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const customAttribution = data.manifest.ok
      ? buildDataAttribution(data.manifest.value)
      : undefined;
    const map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      attributionControl: false,
    });
    map.addControl(
      new AttributionControl({ compact: true, customAttribution }),
    );
    map.addControl(new NavigationControl({ showCompass: false }));

    let loaded = false;
    map.on("error", () => {
      // Tile errors after load are tolerated; only a failed style is fatal.
      if (!loaded) setStyleFailed(true);
    });
    map.on("load", () => {
      loaded = true;
      addRailwayLayers(map, {
        stations: data.stations.ok ? data.stations.value : undefined,
        services: data.services.ok ? data.services.value : undefined,
        geometry: data.geometry.ok ? data.geometry.value : undefined,
      });
      attachStationPopup(map);
      setLoadedMap(map);
    });

    return () => {
      setLoadedMap(null);
      map.remove();
    };
  }, [data, attempt]);

  useEffect(() => {
    if (loadedMap && progress) updateGameProgress(loadedMap, progress);
  }, [loadedMap, progress]);

  const retry = () => {
    setStyleFailed(false);
    setAttempt((count) => count + 1);
  };

  return (
    <>
      <div ref={containerRef} className="map-container" />
      {styleFailed && (
        <div className="map-error" role="alert">
          <p>地図の読み込みに失敗しました。</p>
          <button type="button" onClick={retry}>
            再試行
          </button>
        </div>
      )}
    </>
  );
}
