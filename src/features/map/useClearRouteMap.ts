import type { Map as MapLibreMap } from "maplibre-gl";
import { type RefObject, useEffect, useMemo } from "react";
import { buildClearRouteGeoJson } from "../game/clearRoute";
import type { ClearRoute } from "../game/clearResult";
import { applyClearRouteFit, clearFitPadding, clearFitSignature, measureClearFit } from "./clearRouteCamera";
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
export function useClearRouteMap({ map, layersRevision, active, route, generation, cardRef }: ClearRouteMapInput): void {
  const routeGeoJson = useMemo(() => route === null ? null : buildClearRouteGeoJson(route), [route]);

  useEffect(() => {
    if (!map || !active || !routeGeoJson) return;
    const removal = watchRemoval(map);
    applyClearRouteLayers(map, routeGeoJson);
    return () => {
      if (!removal.isRemoved()) removeClearRouteLayers(map);
      removal.stop();
    };
  }, [map, layersRevision, active, routeGeoJson]);

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
      const padding = clearFitPadding(measurement);
      if (!padding) return;
      const signature = clearFitSignature(measurement.viewport, padding, route.bounds);
      if (signature === appliedSignature) return;
      appliedSignature = signature;
      applyClearRouteFit(map, route.bounds, padding);
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
      removal.stop();
    };
  }, [map, active, route, generation, cardRef]);
}
