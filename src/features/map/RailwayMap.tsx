import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibreWorker";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RailwayData } from "../../data/loaders";
import type { Position } from "../../types/data";
import type { ServicePattern } from "../../types/network";
import { buildDataAttribution } from "./attribution";
import { exposeMapForE2E } from "./e2eHook";
import { MVP_GAME_CONFIG } from "../game/gameConfig";
import { indexServiceGeometry } from "./serviceGeometry";
import { initialOverviewServices, isUserCameraEvent, needsRecentre, USER_CAMERA_EVENTS } from "./camera";
import {
  FOLLOW_EASE_MS,
  LAYER_IDS,
  MAP_CENTER,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_STYLE_URL,
  MAP_ZOOM,
  NETWORK_FIT_PADDING_DESKTOP,
  NETWORK_FIT_PADDING_PHONE,
  NETWORK_FIT_PANEL_GAP,
  PHONE_PANEL_MAX_HEIGHT_SHARE,
  PHONE_MEDIA_QUERY,
} from "./mapConfig";
import {
  addRailwayLayers,
  type MapProgress,
  updateCompletedSegments,
  updateCurrentPosition,
  updateHighlightedService,
} from "./railwayLayers";
import { createStationPopupContent } from "./stationPopup";

export interface MapFollow {
  enabled: boolean;
  /** Jump instead of gliding: every animation frame, or reduced motion. */
  immediate: boolean;
  /** Called when the user moves the camera, so following can be switched off. */
  onUserCameraMove: () => void;
}

interface RailwayMapProps {
  data: RailwayData;
  /** Game progress to draw; omitted when no game is running. */
  progress?: MapProgress;
  follow?: MapFollow;
  /** New/resumed turn-0 session: fit the entire network even on a reused map. */
  overviewKey?: number;
  targetServiceId?: string;
  minZoom?: number;
}

function isPhoneWidth(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

function attributionPosition(onPhone: boolean): "top-left" | "bottom-right" {
  return onPhone ? "top-left" : "bottom-right";
}

/** Fit all service platforms above/beside the panel without retaining camera padding. */
function fitNetworkOverview(map: MapLibreMap, services: readonly ServicePattern[]): void {
  const points = services.flatMap((service) => Object.values(service.platformCoordinates));
  if (points.length === 0) return;
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  const bounds: [Position, Position] = [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
  const padding = isPhoneWidth()
    ? {
        ...NETWORK_FIT_PADDING_PHONE,
        bottom: map.getContainer().clientHeight * PHONE_PANEL_MAX_HEIGHT_SHARE + NETWORK_FIT_PANEL_GAP,
      }
    : NETWORK_FIT_PADDING_DESKTOP;
  map.fitBounds(bounds, { padding, duration: 0, maxZoom: MAP_ZOOM });
  map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
}

/** Centre the camera on `position` without touching the zoom. */
function recentre(map: MapLibreMap, position: Position, immediate: boolean): void {
  const { lng, lat } = map.getCenter();
  if (!needsRecentre([lng, lat], position)) return;
  if (immediate) map.jumpTo({ center: position });
  else map.easeTo({ center: position, duration: FOLLOW_EASE_MS });
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

/**
 * MapLibre throws from its constructor when no WebGL2 context can be created.
 * Returning null lets the game carry on without a map instead of unmounting
 * the whole React tree.
 */
function createMap(container: HTMLElement, minZoom: number): MapLibreMap | null {
  try {
    return new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      minZoom,
      maxZoom: MAP_MAX_ZOOM,
      attributionControl: false,
    });
  } catch (error) {
    console.warn("Map unavailable: could not create the map.", error);
    return null;
  }
}

export function RailwayMap({ data, progress, follow, overviewKey, targetServiceId = MVP_GAME_CONFIG.targetServiceId, minZoom = MAP_MIN_ZOOM }: RailwayMapProps) {
  const serviceGeometry = useMemo(
    () => indexServiceGeometry(data.segments.ok ? data.segments.value : []), [data.segments],
  );
  const initialServices = useMemo(
    () => initialOverviewServices(data.services.ok ? data.services.value.services : [], targetServiceId),
    [data.services, targetServiceId],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [styleFailed, setStyleFailed] = useState(false);
  // The browser cannot create a WebGL2 context: no map can ever be shown here.
  const [unsupported, setUnsupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The map instance once its layers exist, so progress can be applied to it.
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);
  // Set synchronously by a user camera gesture, before React re-renders with
  // following off, so no queued follow update can cancel the gesture.
  const userMovedRef = useRef(false);
  const onUserCameraMoveRef = useRef(follow?.onUserCameraMove);
  useEffect(() => {
    onUserCameraMoveRef.current = follow?.onUserCameraMove;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const customAttribution = data.manifest.ok
      ? buildDataAttribution(data.manifest.value)
      : undefined;
    const map = createMap(container, minZoom);
    if (!map) {
      setUnsupported(true);
      return;
    }
    setUnsupported(false);
    // On phones the control panel spans the bottom edge, so the attribution
    // goes to the top where it stays readable (spec 6.2). The corner follows
    // the media query so a resize or rotation never leaves it under the panel.
    const attributionControl = new AttributionControl({ compact: true, customAttribution });
    let attributionOnPhone = isPhoneWidth();
    map.addControl(attributionControl, attributionPosition(attributionOnPhone));
    const phoneQuery =
      typeof window.matchMedia === "function" ? window.matchMedia(PHONE_MEDIA_QUERY) : null;
    const onPhoneQueryChange = () => {
      const onPhone = isPhoneWidth();
      if (onPhone === attributionOnPhone) return;
      attributionOnPhone = onPhone;
      map.removeControl(attributionControl);
      map.addControl(attributionControl, attributionPosition(onPhone));
    };
    phoneQuery?.addEventListener("change", onPhoneQueryChange);
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
        services: data.services.ok ? data.services.value.services : undefined,
        geometry: data.geometry.ok ? data.geometry.value : undefined,
        lines: data.services.ok ? data.services.value.lines : undefined,
        targetServiceId,
      });
      fitNetworkOverview(map, initialServices);
      attachStationPopup(map);
      for (const type of USER_CAMERA_EVENTS) {
        map.on(type, (event: { originalEvent?: unknown }) => {
          if (!isUserCameraEvent(event)) return;
          userMovedRef.current = true;
          onUserCameraMoveRef.current?.();
        });
      }
      setLoadedMap(map);
      exposeMapForE2E(map);
    });

    return () => {
      phoneQuery?.removeEventListener("change", onPhoneQueryChange);
      exposeMapForE2E(null);
      setLoadedMap(null);
      map.remove();
    };
  }, [data, attempt, targetServiceId, minZoom, initialServices]);

  const completedFeatureIds = progress?.completedFeatureIds;
  const position = progress?.currentPosition ?? null;
  // Keyed by content: the list is rebuilt on animation frames but only
  // changes when a segment is finished, so the filters are set that often.
  const completedKey = completedFeatureIds?.join("\n");
  useEffect(() => {
    if (loadedMap && completedFeatureIds) updateCompletedSegments(loadedMap, completedFeatureIds, targetServiceId);
  }, [loadedMap, completedKey, targetServiceId]);
  useEffect(() => {
    if (loadedMap) updateCurrentPosition(loadedMap, position);
  }, [loadedMap, position]);

  useEffect(() => {
    if (loadedMap && overviewKey !== undefined && data.services.ok) {
      fitNetworkOverview(loadedMap, initialServices);
    }
  }, [loadedMap, overviewKey, initialServices]);

  const highlightedServiceId = progress?.highlightedServiceId;
  useEffect(() => {
    if (!loadedMap) return;
    const service = data.services.ok ? data.services.value.services.find((item) => item.id === highlightedServiceId) : undefined;
    updateHighlightedService(loadedMap, serviceGeometry.get(highlightedServiceId ?? "") ?? [], service?.color ?? "#80c241");
  }, [loadedMap, highlightedServiceId, data.services, serviceGeometry]);

  const followEnabled = follow?.enabled ?? false;
  const immediate = follow?.immediate ?? false;
  // Declared before the camera effect: re-enabling following clears the
  // gesture flag before the camera recentres.
  useEffect(() => {
    if (followEnabled) userMovedRef.current = false;
  }, [followEnabled]);
  useEffect(() => {
    if (!loadedMap || !followEnabled || userMovedRef.current || !position) return;
    recentre(loadedMap, position, immediate);
  }, [loadedMap, followEnabled, position, immediate]);

  const retry = () => {
    setStyleFailed(false);
    setAttempt((count) => count + 1);
  };

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <div className="map-overview" aria-label="地図表示範囲">
        <button type="button" disabled={!loadedMap} onClick={() => {
          if (!loadedMap || !data.services.ok) return;
          userMovedRef.current = true;
          onUserCameraMoveRef.current?.();
          fitNetworkOverview(loadedMap, data.services.value.services);
        }}>全体</button>
        <button type="button" disabled={!loadedMap} onClick={() => {
          if (!loadedMap || !data.services.ok) return;
          userMovedRef.current = true;
          onUserCameraMoveRef.current?.();
          fitNetworkOverview(loadedMap, data.services.value.services.filter((service) => service.id === targetServiceId));
        }}>目標路線</button>
      </div>
      {unsupported && (
        <div className="map-error" role="status">
          <p>
            この端末・ブラウザでは地図を表示できません（WebGL2 が必要です）。
            地図なしでゲームを続けられます。
          </p>
        </div>
      )}
      {styleFailed && !unsupported && (
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
