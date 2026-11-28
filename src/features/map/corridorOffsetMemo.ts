import type { SegmentFeatureCollection } from "../../types/data";
import type { CorridorRenderCollection } from "./corridorOffsets";

export interface CorridorOffsetPayload {
  readonly geoJson: Blob | SegmentFeatureCollection | CorridorRenderCollection;
  readonly derivedCount: number;
}

export interface CorridorOffsetMemo {
  get(geometry: SegmentFeatureCollection, targetServiceId: string): CorridorOffsetPayload | null;
  set(
    geometry: SegmentFeatureCollection,
    targetServiceId: string,
    result: CorridorOffsetPayload,
  ): void;
  delete(geometry: SegmentFeatureCollection, targetServiceId: string): void;
  clear(): void;
}

/** Cache exactly one successful worker result by canonical geometry identity and target. */
export function createCorridorOffsetMemo(): CorridorOffsetMemo {
  let entry: {
    geometry: SegmentFeatureCollection;
    targetServiceId: string;
    result: CorridorOffsetPayload;
  } | null = null;

  return {
    get(geometry, targetServiceId) {
      return entry?.geometry === geometry && entry.targetServiceId === targetServiceId
        ? entry.result
        : null;
    },
    set(geometry, targetServiceId, result) {
      entry = { geometry, targetServiceId, result };
    },
    delete(geometry, targetServiceId) {
      if (entry?.geometry === geometry && entry.targetServiceId === targetServiceId) entry = null;
    },
    clear() {
      entry = null;
    },
  };
}

export const corridorOffsetMemo = createCorridorOffsetMemo();
