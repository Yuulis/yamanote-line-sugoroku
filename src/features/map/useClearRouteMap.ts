import type { Map as MapLibreMap } from "maplibre-gl";
import { type RefObject, useEffect, useMemo } from "react";
import { buildClearRouteGeoJson } from "../game/clearRoute";
import type { ClearRoute } from "../game/clearResult";
import type { ClearReplayStore } from "../game/clearReplayStore";
import { applyClearRouteFit, clearFitPadding, clearFitSignature, measureClearFit } from "./clearRouteCamera";
import { applyClearRouteLayers, removeClearRouteLayers } from "./clearRouteLayers";
import { exposeClearFitPaddingForE2E } from "./e2eHook";

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

/**
 * Draws the travelled route of the published clear and frames it in the map area the clear card leaves open.
 * Leaving the clear screen (or replacing the map) removes the route and restores the camera padding that was
 * retained on entry; the screen that follows then applies its own camera.
 */
const REPLAY_CAPTION_TOP_CLEARANCE_PX = 60;

export function useClearRouteMap({ map, layersRevision, active, route, generation, cardRef, replayStore }: ClearRouteMapInput): void {
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

  useEffect(() => {
    if (!map || !active || !route) return;
    const removal = watchRemoval(map);
    const container = map.getContainer();
    const entryPadding = map.getPadding();
    let appliedSignature: string | null = null;
    let frame: number | null = null;
    let scheduled = false;

    const refit = (): void => {
      if (removal.isRemoved()) return;
      const measurement = measureClearFit(container, cardRef?.current ?? null);
      if (!measurement) return;
      const basePadding = clearFitPadding(measurement);
      if (!basePadding) {
        exposeClearFitPaddingForE2E(null);
        return;
      }
      const padding = { ...basePadding, top: Math.max(basePadding.top, REPLAY_CAPTION_TOP_CLEARANCE_PX) };
      const signature = clearFitSignature(measurement.viewport, padding, route.bounds);
      if (signature === appliedSignature) {
        exposeClearFitPaddingForE2E(padding);
        return;
      }
      appliedSignature = signature;
      applyClearRouteFit(map, route.bounds, padding);
      exposeClearFitPaddingForE2E(padding);
    };
    const scheduleRefit = (): void => {
      if (scheduled) return;
      scheduled = true;
      frame = window.requestAnimationFrame(() => {
        scheduled = false;
        refit();
      });
    };

    refit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRefit);
    observer?.observe(container);
    const card = cardRef?.current;
    if (card) observer?.observe(card);
    const viewport = window.visualViewport;
    window.addEventListener("resize", scheduleRefit);
    window.addEventListener("orientationchange", scheduleRefit);
    viewport?.addEventListener("resize", scheduleRefit);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleRefit);
      window.removeEventListener("orientationchange", scheduleRefit);
      viewport?.removeEventListener("resize", scheduleRefit);
      if (!removal.isRemoved()) map.setPadding(entryPadding);
      exposeClearFitPaddingForE2E(null);
      removal.stop();
    };
  }, [map, active, route, generation, cardRef]);
}
