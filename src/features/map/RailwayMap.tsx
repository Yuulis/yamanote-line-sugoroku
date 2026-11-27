import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibreWorker";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { RailwayData } from "../../data/loaders";
import type { Position } from "../../types/data";
import type { LivePosition } from "../game/animation/livePosition";
import type { PresentationResolver } from "../game/presentationResolver";
import { ATTRIBUTION_SELECTOR, buildDataAttribution, watchCompactAttribution } from "./attribution";
import { exposeMapForE2E } from "./e2eHook";
import { DEFAULT_GAME_CONFIG } from "../game/gameConfig";
import { indexServiceGeometry } from "./serviceGeometry";
import { buildMapPresentationIndex } from "./mapPresentation";
import { useClearNetworkVisibility } from "./clearNetworkVisibility";
import { useVisibleLineGroupIds } from "./lineVisibilityStore";
import {
  initialOverviewServices,
  isUserCameraEvent,
  USER_CAMERA_EVENTS,
} from "./camera";
import {
  MAP_CENTER,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_STYLE_URL,
  MAP_ZOOM,
  PHONE_MEDIA_QUERY,
  SOURCE_IDS,
  isBasemapError,
} from "./mapConfig";
import {
  addRailwayLayers,
  setBackgroundFocus,
  type MapProgress,
  type SegmentFlashRequest,
  updateCompletedSegments,
  updateCurrentPosition,
  updateGoalStation,
  updateHighlightedService,
} from "./railwayLayers";
import {
  applyBasemapLabelFocus,
  BASEMAP_ICON_OPACITY_FACTOR,
  BASEMAP_TEXT_OPACITY_FACTOR,
  buildBasemapLabelPatches,
  type BasemapOpacityPatch,
} from "./basemapLabels";
import { createHeadingMarker, type HeadingMarkerController } from "./headingMarker";
import {
  cameraLayoutKey,
  COMPACT_VIEWPORT_QUERY,
  fitAdjustmentPreview,
  fitNetworkOverview,
  fitTitleService,
  recentre,
  usesBottomPanelCameraPadding,
  useCameraLayoutObserver,
  ZERO_MAP_PADDING,
} from "./railwayMapCamera";
import {
  type AdjustmentCandidate,
  mountAdjustmentCallouts,
} from "./rollAdjustmentPreview";
import { bindStationInteractions } from "./stationInteraction";
import { createStationPopupContent } from "./stationPopup";
import { trackException } from "../analytics/analytics";
import { TitleMapPlaceholder } from "./components/TitleMapPlaceholder";
import type { ClearRoute } from "../game/clearResult";
import type { ClearReplayStore } from "../game/clearReplayStore";
import type { HistoryRow } from "../game/historyRows";
import { ClearReplayMapCaption } from "../game/components/ClearReplayControls";
import { useClearRouteMap } from "./useClearRouteMap";
import { useClearReplayCamera } from "./useClearReplayCamera";
import { useClearMapInteraction } from "./useClearMapInteraction";
import { shouldShowGameplayPosition } from "./clearReplayMarker";
import { useSegmentFlash } from "./useSegmentFlash";
import { useLotteryCandidateOverlay } from "./useLotteryCandidateOverlay";
import { mountGoalCallout, type GoalCalloutController } from "./goalCallout";
import { getCorridorOffsetGeometry } from "./corridorOffsetMemo";

export interface MapFollow {
  enabled: boolean;
  /** Jump instead of gliding: every animation frame, or reduced motion. */
  immediate: boolean;
  /** Called when the user moves the camera, so following can be switched off. */
  onUserCameraMove: () => void;
  /** Snapshot and restore the owning follow state around an adjustment decision. */
  onAdjustmentPreviewOpen?: () => void;
  onAdjustmentPreviewClose?: () => void;
}

interface RailwayMapProps {
  data: RailwayData;
  /** Selects which screen owns the map camera. */
  mode?: RailwayMapMode;
  /** Resolver from the already-validated gameplay network, when available. */
  presentation?: PresentationResolver;
  /** Game progress to draw; omitted when no game is running. */
  progress?: MapProgress;
  /** Reveal-gated heading from the shared turn display. */
  markerBearing?: number | null;
  /** Reveal-gated goal station id from the shared turn display; null/omitted clears the ring. */
  goalStationId?: string | null;
  /** Reveal-gated landings of the open roll-adjustment decision; empty/omitted shows no callouts. */
  adjustmentCandidates?: readonly AdjustmentCandidate[];
  /** Reveal-gated service candidates during the lottery flip and settle. */
  lotteryCandidateServiceIds?: readonly string[];
  /** The presented arrival's flash of newly completed target segments; null/omitted clears the flash layer. */
  segmentFlash?: SegmentFlashRequest | null;
  /** Per-frame marker position of a running move; overrides the progress position once set. */
  livePosition?: LivePosition;
  follow?: MapFollow;
  /** Session identity for rebinding layout observation when the panel is replaced. */
  panelKey?: number;
  /** Coach target: the map viewport, or its readable fallback when WebGL/style loading fails. */
  coachTargetRef?: RefObject<HTMLElement | null>;
  /** New/resumed turn-0 session: fit the entire network even on a reused map. */
  overviewKey?: number;
  /** Remove map controls from keyboard and assistive technology while another screen is active. */
  inert?: boolean;
  /** The published clear's travelled route, drawn and framed in clear mode; null when it could not be verified. */
  clearRoute?: ClearRoute | null;
  /** Generation of the published clear; a new publication frames the route again. */
  clearRouteKey?: number;
  /** The clear card, so the route is framed in the map area it leaves open. */
  clearCardRef?: RefObject<HTMLElement | null>;
  /** Store drives partial route frames imperatively while the map remains outside React state. */
  clearReplayStore?: ClearReplayStore;
  clearHistoryRows?: readonly HistoryRow[];
  targetServiceId?: string;
  minZoom?: number;
}

export type RailwayMapMode = "title" | "game" | "clear";

const subscribeToNoReplayPhase = (_listener: () => void): (() => void) => () => {};
const getIdleReplayPhase = (): "idle" => "idle";

const NO_LIVE_POSITION: LivePosition = {
  subscribe: () => () => {},
  get: () => null,
};

function attributionPosition(atTop: boolean): "top-left" | "bottom-right" {
  return atTop ? "top-left" : "bottom-right";
}

/**
 * Phones and short landscape: the panel covers the bottom (or the bottom-left
 * and centre), so the attribution goes top-left and starts collapsed.
 */
function usesCompactAttribution(): boolean {
  return usesBottomPanelCameraPadding();
}

function attachStationPopup(
  map: MapLibreMap,
  isClearMode: () => boolean,
  popupRef: MutableRefObject<Popup | null>,
): void {
  bindStationInteractions(map, ({ name, lineNames, lngLat }) => {
    if (isClearMode()) return;
    // Kept so entering the clear screen can close a popup left open from gameplay.
    popupRef.current = new Popup({ closeButton: true })
      .setLngLat(lngLat)
      .setDOMContent(createStationPopupContent(name, lineNames))
      .addTo(map);
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

function navigationControlsContainFocus(mapContainer: HTMLElement | null): boolean {
  const focusedElement = document.activeElement;
  if (!mapContainer || !(focusedElement instanceof HTMLElement)) return false;
  const zoomGroup = mapContainer.querySelector(".maplibregl-ctrl-zoom");
  const overview = mapContainer.parentElement?.querySelector(".map-overview");
  return Boolean(zoomGroup?.contains(focusedElement) || overview?.contains(focusedElement));
}

const NO_ADJUSTMENT_CANDIDATES: readonly AdjustmentCandidate[] = [];

export function RailwayMap({ data, mode = "game", presentation, progress, markerBearing: displayedBearing, goalStationId = null, adjustmentCandidates = NO_ADJUSTMENT_CANDIDATES, lotteryCandidateServiceIds, segmentFlash = null, livePosition = NO_LIVE_POSITION, follow, panelKey, coachTargetRef, overviewKey, inert = false, clearRoute = null, clearRouteKey, clearCardRef, clearReplayStore, clearHistoryRows = [], targetServiceId = DEFAULT_GAME_CONFIG.targetServiceId, minZoom = MAP_MIN_ZOOM }: RailwayMapProps) {
  const services = data.services.ok ? data.services.value.services : [];
  const lines = data.services.ok ? data.services.value.lines : [];
  const segments = data.segments.ok ? data.segments.value : [];
  const canonicalGeometry = data.geometry.ok ? data.geometry.value : undefined;
  const uiPresentation = data.manifest.ok ? data.manifest.value.uiPresentation : undefined;
  const selectedGroupIds = useVisibleLineGroupIds();
  const serviceGeometry = useMemo(
    () => indexServiceGeometry(data.segments.ok ? data.segments.value : []), [data.segments],
  );
  const mapPresentationIndex = useMemo(
    () => buildMapPresentationIndex(services, segments, uiPresentation, lines),
    [services, segments, uiPresentation, lines],
  );
  const initialServices = useMemo(
    () => initialOverviewServices(services, targetServiceId),
    [services, targetServiceId],
  );
  const goalPosition = useMemo(() => {
    if (!goalStationId || !data.stations.ok) return null;
    return data.stations.value.find((station) => station.id === goalStationId)?.coordinates ?? null;
  }, [data.stations, goalStationId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const goalCalloutRef = useRef<GoalCalloutController | null>(null);
  const [styleFailed, setStyleFailed] = useState(false);
  const restoreFocusAfterMapFailureRef = useRef(false);
  // The browser cannot create a WebGL2 context: no map can ever be shown here.
  const [unsupported, setUnsupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The map instance once its layers exist, so progress can be applied to it.
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);
  const [paintedAttempt, setPaintedAttempt] = useState<number | null>(null);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const modeRef = useRef(mode);
  const stationPopupRef = useRef<Popup | null>(null);
  modeRef.current = mode;
  const headingMarkerRef = useRef<HeadingMarkerController | null>(null);
  // Bumped when a replaced style forced the layers to be re-added, so the
  // progress and visibility effects below apply their state to them again.
  const [layersRevision, setLayersRevision] = useState(0);
  const basemapLabelPatchesRef = useRef<readonly BasemapOpacityPatch[]>([]);
  const [cameraLayoutRevision, setCameraLayoutRevision] = useState(0);
  const setCoachTarget = useCallback((element: HTMLElement | null): void => {
    if (coachTargetRef) coachTargetRef.current = element;
  }, [coachTargetRef]);
  const setMapContainer = useCallback((element: HTMLDivElement | null): void => {
    containerRef.current = element;
    if (!unsupported && !styleFailed) setCoachTarget(element);
  }, [setCoachTarget, styleFailed, unsupported]);
  // Set synchronously by a user camera gesture, before React re-renders with
  // following off, so no queued follow update can cancel the gesture.
  const userMovedRef = useRef(false);
  const previewCameraOverrideRef = useRef(false);
  const previewActiveRef = useRef(false);
  const previousPreviewActiveRef = useRef(false);
  const onUserCameraMoveRef = useRef(follow?.onUserCameraMove);
  const adjustmentPreviewCallbacksRef = useRef({
    onOpen: follow?.onAdjustmentPreviewOpen,
    onClose: follow?.onAdjustmentPreviewClose,
  });
  useEffect(() => {
    onUserCameraMoveRef.current = follow?.onUserCameraMove;
    adjustmentPreviewCallbacksRef.current = {
      onOpen: follow?.onAdjustmentPreviewOpen,
      onClose: follow?.onAdjustmentPreviewClose,
    };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const customAttribution = data.manifest.ok
      ? buildDataAttribution(data.manifest.value)
      : undefined;
    const map = createMap(container, minZoom);
    if (!map) {
      setPaintedAttempt(null);
      setUnsupported(true);
      trackException("webgl2_unavailable", false);
      return;
    }
    setPaintedAttempt(null);
    setUnsupported(false);
    // On phones and short landscape the control panel covers the bottom edge,
    // so the attribution goes to the top where it stays readable (spec 6.2) and
    // starts collapsed (one tap opens the full credit). The corner follows the
    // media queries so a resize or rotation never leaves it under the panel; a
    // reattached control is a fresh container, so it is watched again.
    const attributionControl = new AttributionControl({ compact: true, customAttribution });
    let attributionAtTop = usesCompactAttribution();
    let stopCompactAttribution: (() => void) | null = null;
    const watchAttribution = (compact: boolean): void => {
      stopCompactAttribution?.();
      stopCompactAttribution = null;
      if (!compact) return;
      const element = container.querySelector<HTMLElement>(ATTRIBUTION_SELECTOR);
      if (element) stopCompactAttribution = watchCompactAttribution(element);
    };
    map.addControl(attributionControl, attributionPosition(attributionAtTop));
    watchAttribution(attributionAtTop);
    const attributionQueries = typeof window.matchMedia === "function"
      ? [window.matchMedia(PHONE_MEDIA_QUERY), window.matchMedia(COMPACT_VIEWPORT_QUERY)]
      : [];
    const onAttributionQueryChange = () => {
      const atTop = usesCompactAttribution();
      if (atTop === attributionAtTop) return;
      attributionAtTop = atTop;
      watchAttribution(false);
      map.removeControl(attributionControl);
      map.addControl(attributionControl, attributionPosition(atTop));
      watchAttribution(atTop);
    };
    for (const query of attributionQueries) query.addEventListener("change", onAttributionQueryChange);
    // Fatal until the basemap has rendered completely once ("load"): a failed
    // style, or tiles failing so that never happens. Later tile errors are tolerated.
    let basemapLoaded = false;
    let layersReady = false;
    let sawLoad = false;
    let sawRenderAfterLoad = false;
    let paintFrame: number | null = null;
    let active = true;
    const effectAttempt = attempt;
    const schedulePaintedState = (): void => {
      if (!active || attemptRef.current !== effectAttempt || !layersReady || !sawLoad || !sawRenderAfterLoad || paintFrame !== null) return;
      paintFrame = window.requestAnimationFrame(() => {
        paintFrame = null;
        if (active && attemptRef.current === effectAttempt && layersReady && sawLoad && sawRenderAfterLoad) {
          setPaintedAttempt(effectAttempt);
        }
      });
    };
    map.on("error", (event) => {
      if (!basemapLoaded && isBasemapError(event)) {
        restoreFocusAfterMapFailureRef.current ||= navigationControlsContainFocus(containerRef.current);
        setStyleFailed(true);
        trackException("map_style_or_tile_failure", false);
      }
    });
    map.once("load", () => {
      basemapLoaded = true;
      sawLoad = true;
      map.triggerRepaint();
      schedulePaintedState();
    });
    map.on("render", () => {
      if (!sawLoad) return;
      sawRenderAfterLoad = true;
      schedulePaintedState();
    });
    // The railway layers need only the parsed style, not the basemap tiles, so
    // they are added on "style.load" while the basemap is still loading.
    let initialised = false;
    map.on("style.load", () => {
      // A replaced style drops custom layers; never add them twice.
      if (map.getSource(SOURCE_IDS.currentPosition)) return;
      // Capture this style's own values before railway station labels are added.
      // Reloads replace this baseline, so opacity never compounds across styles.
      basemapLabelPatchesRef.current = buildBasemapLabelPatches(map.getStyle().layers, {
        text: BASEMAP_TEXT_OPACITY_FACTOR,
        icon: BASEMAP_ICON_OPACITY_FACTOR,
      });
      const corridorGeometry = canonicalGeometry
        ? getCorridorOffsetGeometry(canonicalGeometry, targetServiceId) ?? undefined
        : undefined;
      addRailwayLayers(map, {
        stations: data.stations.ok ? data.stations.value : undefined,
        services: data.services.ok ? data.services.value.services : undefined,
        geometry: canonicalGeometry,
        corridorGeometry: corridorGeometry ?? undefined,
        lines: data.services.ok ? data.services.value.lines : undefined,
        targetServiceId,
        focusBackground: modeRef.current !== "title",
        presentation,
        presentationIndex: mapPresentationIndex,
      });
      if (initialised) {
        setLayersRevision((revision) => revision + 1);
        return;
      }
      initialised = true;
      layersReady = true;
      schedulePaintedState();
      attachStationPopup(map, () => modeRef.current === "clear", stationPopupRef);
      for (const type of USER_CAMERA_EVENTS) {
        map.on(type, (event: { originalEvent?: unknown }) => {
          if (!isUserCameraEvent(event)) return;
          userMovedRef.current = true;
          if (previewActiveRef.current) previewCameraOverrideRef.current = true;
          onUserCameraMoveRef.current?.();
        });
      }
      setLoadedMap(map);
      exposeMapForE2E(map);
    });

    return () => {
      active = false;
      if (paintFrame !== null) window.cancelAnimationFrame(paintFrame);
      for (const query of attributionQueries) query.removeEventListener("change", onAttributionQueryChange);
      watchAttribution(false);
      exposeMapForE2E(null);
      setLoadedMap(null);
      map.remove();
    };
  }, [data, attempt, targetServiceId, minZoom, initialServices, presentation, mapPresentationIndex]);

  const completedFeatureIds = progress?.completedFeatureIds;
  const backgroundFocused = mode !== "title";
  useLayoutEffect(() => {
    if (loadedMap) setBackgroundFocus(loadedMap, backgroundFocused);
  }, [loadedMap, layersRevision, backgroundFocused]);
  const basemapLabelsFocused = mode !== "title";
  useLayoutEffect(() => {
    if (loadedMap) applyBasemapLabelFocus(loadedMap, basemapLabelPatchesRef.current, basemapLabelsFocused);
  }, [loadedMap, layersRevision, basemapLabelsFocused]);

  useClearMapInteraction(loadedMap, mode === "clear", stationPopupRef);

  // Only this component re-renders on animation frames, not the game UI.
  const framePosition = useSyncExternalStore(livePosition.subscribe, livePosition.get, livePosition.get);
  const replayPhase = useSyncExternalStore(
    clearReplayStore?.subscribePhase ?? subscribeToNoReplayPhase,
    clearReplayStore?.getPhase ?? getIdleReplayPhase,
    clearReplayStore?.getPhase ?? getIdleReplayPhase,
  );
  const position = framePosition ?? progress?.currentPosition ?? null;
  // Keyed by content: the list is rebuilt on every hop of a move but only
  // changes when a segment is finished, so the filters are set that often.
  const completedKey = completedFeatureIds?.join("\n");
  const markerBearing = displayedBearing ?? null;
  const hideGameplayPosition = !shouldShowGameplayPosition(mode, replayPhase);
  const previewOpen = adjustmentCandidates.length > 0;
  const previewActive = mode === "game" && previewOpen;
  previewActiveRef.current = previewActive;
  useEffect(() => {
    const wasActive = previousPreviewActiveRef.current;
    if (previewActive && !wasActive) {
      previewCameraOverrideRef.current = false;
      adjustmentPreviewCallbacksRef.current.onOpen?.();
    } else if (!previewActive && wasActive) {
      previewCameraOverrideRef.current = false;
      adjustmentPreviewCallbacksRef.current.onClose?.();
    }
    previousPreviewActiveRef.current = previewActive;
  }, [previewActive]);
  const previewOriginKey = position?.join(",") ?? "unknown";
  const previewOriginRef = useRef<Position | null>(position);
  previewOriginRef.current = position;
  const previewFitRef = useRef<{ map: MapLibreMap; signature: string } | null>(null);
  const overviewModeRef = useRef<{ map: MapLibreMap; mode: RailwayMapMode } | null>(null);
  useEffect(() => {
    if (!loadedMap) return;
    const headingMarker = createHeadingMarker(loadedMap);
    headingMarkerRef.current = headingMarker;
    return () => {
      headingMarker.remove();
      if (headingMarkerRef.current === headingMarker) headingMarkerRef.current = null;
    };
  }, [loadedMap]);
  // Keyed by content: the parent rebuilds the array on every render.
  const candidatesRef = useRef(adjustmentCandidates);
  candidatesRef.current = adjustmentCandidates;
  const candidatesKey = adjustmentCandidates
    .map((candidate) => `${candidate.delta}:${candidate.stationId}:${candidate.travelledSteps}:${candidate.position?.join(",") ?? ""}`)
    .join("|");
  useEffect(() => {
    if (!loadedMap || candidatesRef.current.length === 0) return;
    return mountAdjustmentCallouts(loadedMap, candidatesRef.current);
  }, [loadedMap, panelKey, candidatesKey]);
  useEffect(() => {
    if (loadedMap && completedFeatureIds) updateCompletedSegments(loadedMap, completedFeatureIds, targetServiceId);
  }, [loadedMap, layersRevision, completedKey, targetServiceId]);
  useEffect(() => {
    if (!loadedMap || mode !== "game" || !goalPosition) return;
    const callout = mountGoalCallout(loadedMap, goalPosition);
    goalCalloutRef.current = callout;
    return () => {
      callout.remove();
      if (goalCalloutRef.current === callout) goalCalloutRef.current = null;
    };
  }, [loadedMap, mode, goalStationId, goalPosition]);
  useEffect(() => {
    goalCalloutRef.current?.setAdjustmentCandidates(adjustmentCandidates);
  }, [loadedMap, mode, goalStationId, goalPosition, candidatesKey]);
  useClearNetworkVisibility({
    map: loadedMap, layersRevision, active: mode === "clear", index: mapPresentationIndex, selectedGroupIds, targetServiceId,
  });
  useEffect(() => {
    if (!loadedMap) return;
    const displayedPosition = hideGameplayPosition ? null : position;
    updateCurrentPosition(loadedMap, displayedPosition);
    headingMarkerRef.current?.update(displayedPosition, hideGameplayPosition ? null : markerBearing);
  }, [loadedMap, layersRevision, position, markerBearing, hideGameplayPosition]);
  useEffect(() => {
    if (loadedMap) updateGoalStation(loadedMap, goalStationId);
  }, [loadedMap, layersRevision, goalStationId]);
  useSegmentFlash(loadedMap, layersRevision, segmentFlash, targetServiceId);
  const clearRouteMapInput = {
    map: loadedMap, layersRevision, active: mode === "clear", route: clearRoute, generation: clearRouteKey,
    cardRef: clearCardRef, replayStore: clearReplayStore,
  };
  useClearRouteMap(clearRouteMapInput);
  useClearReplayCamera(clearRouteMapInput);

  useEffect(() => {
    if (mode !== "title" || !loadedMap || !data.services.ok) return;
    const targetService = services.find((service) => service.id === targetServiceId);
    fitTitleService(loadedMap, targetService);
  }, [loadedMap, layersRevision, mode, targetServiceId, services, cameraLayoutRevision, data.services]);

  useEffect(() => {
    if (!loadedMap) return;
    const previousOverviewMode = overviewModeRef.current;
    const enteringGame = previousOverviewMode?.map !== loadedMap || previousOverviewMode.mode !== "game";
    if (mode !== "game") {
      overviewModeRef.current = { map: loadedMap, mode };
      return;
    }
    if (!data.services.ok) return;
    overviewModeRef.current = { map: loadedMap, mode };
    // Fit once when entering game, then only for an explicit overview request.
    // GameApp clears overviewKey after turn zero; that is not a new request.
    if (!enteringGame && overviewKey === undefined) return;
    fitNetworkOverview(loadedMap, initialServices);
  }, [loadedMap, mode, overviewKey, initialServices, data.services]);

  const highlightedServiceId = progress?.highlightedServiceId;
  useLotteryCandidateOverlay(
    loadedMap,
    layersRevision,
    mode === "game" ? lotteryCandidateServiceIds : undefined,
    serviceGeometry,
  );
  useEffect(() => {
    if (!loadedMap) return;
    const service = services.find((item) => item.id === highlightedServiceId);
    updateHighlightedService(
      loadedMap,
      serviceGeometry.get(highlightedServiceId ?? "") ?? [],
      presentation?.lineGroupColor(highlightedServiceId ?? "") ?? service?.color ?? "#80c241",
    );
  }, [loadedMap, layersRevision, highlightedServiceId, services, serviceGeometry, presentation]);

  const followEnabled = follow?.enabled ?? false;
  const immediate = follow?.immediate ?? false;
  const trackCameraLayout = mode === "title" || (mode === "game" && (followEnabled || previewOpen));
  const handledCameraLayoutRevisionRef = useRef(cameraLayoutRevision);
  // The camera layout last applied by a follow move; null forces the next
  // observed layout to be applied even if the marker is already centred.
  const appliedCameraLayoutRef = useRef<string | null>(null);
  useCameraLayoutObserver(
    trackCameraLayout ? loadedMap : null,
    panelKey,
    () => { appliedCameraLayoutRef.current = null; },
    () => {
      if (!loadedMap) return;
      if (mode === "title") {
        setCameraLayoutRevision((revision) => revision + 1);
        return;
      }
      if (mode !== "game") return;
      if (previewOpen) {
        setCameraLayoutRevision((revision) => revision + 1);
        return;
      }
      // A resize that leaves the camera layout unchanged (any panel resize
      // on desktop) must not pull a moved camera back to the marker.
      if (cameraLayoutKey(loadedMap) === appliedCameraLayoutRef.current) return;
      setCameraLayoutRevision((revision) => revision + 1);
    },
    mode === "game" && previewOpen,
    mode === "game" ? candidatesKey : "",
  );
  useEffect(() => {
    if (!loadedMap || mode === "clear") return;
    if (mode === "title") {
      previewFitRef.current = null;
      return;
    }
    if (!previewOpen) {
      const previousFit = previewFitRef.current;
      previewFitRef.current = null;
      if (previousFit?.map === loadedMap) loadedMap.setPadding(ZERO_MAP_PADDING);
      return;
    }
    if (previewCameraOverrideRef.current) return;
    const previousSignature = previewFitRef.current?.map === loadedMap
      ? previewFitRef.current.signature
      : null;
    const signature = fitAdjustmentPreview(
      loadedMap,
      previewOriginRef.current,
      candidatesRef.current,
      panelKey,
      candidatesKey,
      previewOriginKey,
      previousSignature,
    );
    if (signature !== null) previewFitRef.current = { map: loadedMap, signature };
  }, [loadedMap, mode, previewOpen, panelKey, candidatesKey, previewOriginKey, cameraLayoutRevision]);
  // Declared before the camera effect: re-enabling following clears the
  // gesture flag before the camera recentres.
  useEffect(() => {
    if (mode !== "game") return;
    if (followEnabled) userMovedRef.current = false;
  }, [mode, followEnabled]);
  useEffect(() => {
    if (mode !== "game" || !loadedMap || !followEnabled || previewOpen || userMovedRef.current || !position) return;
    if (recentre(loadedMap, position, immediate)) {
      appliedCameraLayoutRef.current = cameraLayoutKey(loadedMap);
    }
  }, [loadedMap, mode, followEnabled, previewOpen, position, immediate]);
  // Layout changes only: re-checked here because a revision queued before a
  // follow move applied the same layout is stale by the time it renders.
  useEffect(() => {
    if (mode !== "game") return;
    if (handledCameraLayoutRevisionRef.current === cameraLayoutRevision) return;
    if (!loadedMap) return;
    if (previewOpen) {
      handledCameraLayoutRevisionRef.current = cameraLayoutRevision;
      return;
    }
    if (!followEnabled || userMovedRef.current || !position) return;
    handledCameraLayoutRevisionRef.current = cameraLayoutRevision;
    const layoutKey = cameraLayoutKey(loadedMap);
    if (layoutKey === appliedCameraLayoutRef.current) return;
    recentre(loadedMap, position, immediate, true);
    appliedCameraLayoutRef.current = layoutKey;
  }, [loadedMap, mode, followEnabled, previewOpen, position, immediate, cameraLayoutRevision]);

  const retry = () => {
    setStyleFailed(false);
    setPaintedAttempt(null);
    setAttempt((count) => count + 1);
  };

  const showNavigationControls = mode === "game" && loadedMap !== null && !styleFailed && !unsupported;
  const showTitlePlaceholder = mode === "title" && (paintedAttempt !== attempt || styleFailed || unsupported);
  useEffect(() => {
    if (!loadedMap || !showNavigationControls) return;
    const navigationControl = new NavigationControl({ showCompass: false });
    loadedMap.addControl(navigationControl);
    return () => {
      if (loadedMap.hasControl(navigationControl)) loadedMap.removeControl(navigationControl);
    };
  }, [loadedMap, showNavigationControls]);
  useLayoutEffect(() => {
    if (!styleFailed || !restoreFocusAfterMapFailureRef.current) return;
    restoreFocusAfterMapFailureRef.current = false;
    const retryButton = document.querySelector<HTMLButtonElement>(".map-error[role='alert'] button");
    if (retryButton) {
      retryButton.focus();
      return;
    }
    const panel = document.querySelector<HTMLElement>(".game-panel");
    if (panel) {
      if (!panel.hasAttribute("tabindex")) panel.tabIndex = -1;
      panel.focus();
    }
  }, [styleFailed]);

  return (
    <>
      <div inert={inert && mode !== "clear"}>
        <div ref={setMapContainer} className="map-container" />
        {showNavigationControls && <div className="map-overview" aria-label="地図表示範囲">
          <button type="button" disabled={!loadedMap} onClick={() => {
            if (!loadedMap || !data.services.ok) return;
            userMovedRef.current = true;
            if (previewActiveRef.current) previewCameraOverrideRef.current = true;
            onUserCameraMoveRef.current?.();
            fitNetworkOverview(loadedMap, data.services.value.services);
          }}>全体</button>
          <button type="button" disabled={!loadedMap} onClick={() => {
            if (!loadedMap || !data.services.ok) return;
            userMovedRef.current = true;
            if (previewActiveRef.current) previewCameraOverrideRef.current = true;
            onUserCameraMoveRef.current?.();
            fitNetworkOverview(loadedMap, data.services.value.services.filter((service) => service.id === targetServiceId));
          }}>目標路線</button>
        </div>}
      </div>
      {mode === "clear" && clearRoute && clearReplayStore && (
        <ClearReplayMapCaption store={clearReplayStore} rows={clearHistoryRows} />
      )}
      {showTitlePlaceholder && <TitleMapPlaceholder />}
      {unsupported && (
        // The clear screen owns the only polite live region, so the notice stays visible there without one.
        <div ref={setCoachTarget} className="map-error" role={mode === "clear" ? undefined : "status"}>
          <p>
            この端末・ブラウザでは地図を表示できません（WebGL2 が必要です）。
            地図なしでゲームを続けられます。
          </p>
        </div>
      )}
      {styleFailed && !unsupported && (
        <div ref={setCoachTarget} className="map-error" role="alert">
          <p>地図の読み込みに失敗しました。</p>
          <button type="button" onClick={retry}>
            再試行
          </button>
        </div>
      )}
    </>
  );
}
