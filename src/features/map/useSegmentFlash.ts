import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { SegmentFlashRequest } from "./railwayLayers";
import {
  clearSegmentFlash,
  segmentFlashOpacity,
  setSegmentFlashFeatures,
  setSegmentFlashOpacity,
} from "./railwayLayers";

/** Start time of the flash for one request key; kept across style reloads so a reload never restarts it. */
interface SegmentFlashClock {
  key: string;
  startedAt: number;
}

/**
 * Drive the flash layer for `request` with a local animation-frame loop. The start time is keyed by the request
 * key, so a style reload (`layersRevision`) or a new map reapplies the remaining flash against the original
 * deadline, and a deadline that expired meanwhile leaves the new layer empty. Every write checks that the layer
 * exists. A null request, a new key, teardown and every re-run cancel the pending frame and clear the layer. A
 * missing map or layer only skips writes: nothing here gates the turn's stages or decisions.
 */
export function useSegmentFlash(
  map: MapLibreMap | null,
  layersRevision: number,
  request: SegmentFlashRequest | null | undefined,
  targetServiceId: string,
): void {
  const clockRef = useRef<SegmentFlashClock | null>(null);
  const active = request !== null && request !== undefined && request.featureIds.length > 0 && request.durationMs > 0;
  const key = active ? request.key : null;
  const featureKey = active ? request.featureIds.join("\n") : "";
  const durationMs = active ? request.durationMs : 0;
  useEffect(() => {
    // The clock starts when the request is first seen, with or without a map to draw it on.
    if (key !== null && clockRef.current?.key !== key) clockRef.current = { key, startedAt: performance.now() };
    if (!map) return;
    if (key === null || clockRef.current === null) {
      clearSegmentFlash(map, targetServiceId);
      return;
    }
    const { startedAt } = clockRef.current;
    const elapsed = performance.now() - startedAt;
    if (elapsed >= durationMs) {
      clearSegmentFlash(map, targetServiceId);
      return;
    }
    setSegmentFlashFeatures(map, featureKey.split("\n"), targetServiceId);
    setSegmentFlashOpacity(map, segmentFlashOpacity(elapsed, durationMs));
    let frame = 0;
    const tick = (): void => {
      const now = performance.now() - startedAt;
      if (now >= durationMs) {
        frame = 0;
        clearSegmentFlash(map, targetServiceId);
        return;
      }
      setSegmentFlashOpacity(map, segmentFlashOpacity(now, durationMs));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      clearSegmentFlash(map, targetServiceId);
    };
  }, [map, layersRevision, key, featureKey, durationMs, targetServiceId]);
}
