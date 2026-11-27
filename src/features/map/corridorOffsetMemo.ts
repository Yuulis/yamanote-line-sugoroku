import type { SegmentFeatureCollection } from "../../types/data";
import { buildCorridorOffsets, type CorridorRenderCollection } from "./corridorOffsets";

export interface CorridorOffsetMemo {
  get(geometry: SegmentFeatureCollection, targetServiceId: string): CorridorRenderCollection | null;
}

type CorridorOffsetBuilder = (
  geometry: SegmentFeatureCollection,
  targetServiceId: string,
) => CorridorRenderCollection;

type WarningLogger = (message: string, error: unknown) => void;

/** Cache render-only geometry by canonical object identity and target, including failed derivations. */
export function createCorridorOffsetMemo(
  build: CorridorOffsetBuilder = buildCorridorOffsets,
  warn: WarningLogger = (message, error) => console.warn(message, error),
): CorridorOffsetMemo {
  let hasEntry = false;
  let lastGeometry: SegmentFeatureCollection | undefined;
  let lastTargetServiceId: string | undefined;
  let lastResult: CorridorRenderCollection | null = null;

  return {
    get(geometry, targetServiceId) {
      if (hasEntry && lastGeometry === geometry && lastTargetServiceId === targetServiceId) {
        return lastResult;
      }

      lastGeometry = geometry;
      lastTargetServiceId = targetServiceId;
      hasEntry = true;
      try {
        lastResult = build(geometry, targetServiceId);
      } catch (error) {
        lastResult = null;
        warn("Map data unavailable: could not derive shared-track offsets; using canonical geometry.", error);
      }
      return lastResult;
    },
  };
}

// Module ownership lets a module reload replace the cache and its builder,
// while keeping results across style reloads in the current module instance.
const corridorOffsetMemo = createCorridorOffsetMemo();

export function getCorridorOffsetGeometry(
  geometry: SegmentFeatureCollection,
  targetServiceId: string,
): CorridorRenderCollection | null {
  return corridorOffsetMemo.get(geometry, targetServiceId);
}
