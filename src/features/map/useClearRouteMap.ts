import type { Map as MapLibreMap } from "maplibre-gl";
import { type RefObject, useEffect, useMemo } from "react";
import { buildClearRouteGeoJson } from "../game/clearRoute";
import type { ClearRoute } from "../game/clearResult";
import type { ClearReplayStore } from "../game/clearReplayStore";
import { applyClearRouteLayers, removeClearRouteLayers } from "./clearRouteLayers";

export interface ClearRouteMapInput {
  /** The map once its railway layers exist; null before that and while it is rebuilt. */
  readonly map: MapLibreMap | null;
  /** Bumped when a replaced style dropped the layers, so the route is added again. */
  readonly layersRevision: number;
  /** True while the clear screen owns the map. */
  readonly active: boolean;
  /** The route of the published clear; null when its geometry could not be verified. */
  readonly route: ClearRoute | null;
  /** The published clear's generation; a new publication fits the camera again. */
  readonly generation: number | undefined;
  /** The clear card whose rectangle the route must stay clear of. */
  readonly cardRef: RefObject<HTMLElement | null> | undefined;
  readonly replayStore?: ClearReplayStore;
}

export interface RemovalWatch {
  readonly isRemoved: () => boolean;
  readonly stop: () => void;
}

/** MapLibre forbids any call on a removed map, so cleanups ask first. */
export function watchRemoval(map: MapLibreMap): RemovalWatch {
  let removed = false;
  const onRemove = (): void => { removed = true; };
  map.on("remove", onRemove);
  return { isRemoved: () => removed, stop: () => { map.off("remove", onRemove); } };
}

/** Draws and removes the travelled route; replay camera ownership lives in useClearReplayCamera. */
export function useClearRouteMap({ map, layersRevision, active, route, replayStore }: ClearRouteMapInput): void {
  const routeGeoJson = useMemo(() => route === null ? null : buildClearRouteGeoJson(route), [route]);

  useEffect(() => {
    if (!map || !active || !route || !routeGeoJson) return;
    const removal = watchRemoval(map);
    const applyLatest = (): void => {
      if (removal.isRemoved()) return;
      const snapshot = replayStore?.getSnapshot();
      const data = snapshot && (snapshot.phase === "playing" || snapshot.phase === "paused")
        ? buildClearRouteGeoJson(route, { stepIndex: snapshot.stepIndex, fraction: snapshot.fraction })
        : routeGeoJson;
      applyClearRouteLayers(map, data);
    };
    applyLatest();
    const unsubscribe = replayStore?.subscribe(applyLatest);
    return () => {
      unsubscribe?.();
      if (!removal.isRemoved()) removeClearRouteLayers(map);
      removal.stop();
    };
  }, [map, layersRevision, active, route, routeGeoJson, replayStore]);
}
