import type { ErrorEvent, GeoJSONSource, Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";
import type { SegmentFeatureCollection } from "../../types/data";
import type { CorridorOffsetApplyResult, CorridorOffsetRequest } from "./corridorOffsetDeriver";
import type { CorridorOffsetPayload } from "./corridorOffsetMemo";
import { SOURCE_IDS } from "./mapConfig";

const E2E_METRICS_ENABLED = import.meta.env.MODE === "e2e";
const SOURCE_ID = SOURCE_IDS.corridorSegments;

export interface CorridorOffsetMapState {
  readonly alreadyRegistered: boolean;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly mapPublishedAt?: () => number | null;
  readonly firstMapPaintAt?: () => number | null;
  readonly blobUrlFor: (blob: Blob) => string;
  readonly releaseBlobUrl: (blob: Blob, url: string) => void;
}

/** Waits for a GeoJSON worker content update and a frame using the updated source tiles. */
export function applyCorridorOffsetsToMap(
  map: MapLibreMap,
  geometry: SegmentFeatureCollection,
  result: CorridorOffsetPayload,
  request: CorridorOffsetRequest,
  state: CorridorOffsetMapState,
): Promise<CorridorOffsetApplyResult | null> {
  const source = map.getSource(SOURCE_ID);
  if (!state.isCurrent() || !source) return Promise.resolve(null);
  const sourceData = result.geoJson instanceof Blob ? state.blobUrlFor(result.geoJson) : result.geoJson;
  const sourceRef = source as GeoJSONSource;

  return new Promise((resolve, reject) => {
    let started = state.alreadyRegistered;
    let setDataResolved = state.alreadyRegistered;
    let sourceLoaded = false;
    let renderAfterLoad = false;
    let settled = false;
    const cleanup = (): void => {
      map.off("sourcedata", onSourceData);
      map.off("dataabort", onDataAbort);
      map.off("sourcedataabort", onDataAbort);
      map.off("error", onError);
      map.off("render", onRender);
      state.signal.removeEventListener("abort", onCancel);
    };
    const finish = (value: CorridorOffsetApplyResult | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const current = (): boolean => state.isCurrent()
      && map.getSource(SOURCE_ID) === sourceRef;
    const fail = (error: unknown): void => {
      if (settled) return;
      if (!current()) {
        finish(null);
        return;
      }
      settled = true;
      cleanup();
      if (result.geoJson instanceof Blob) state.releaseBlobUrl(result.geoJson, sourceData as string);
      try {
        void sourceRef.setData(geometry).catch((restoreError: unknown) => {
          console.error("Map data unavailable: failed to restore canonical railway geometry.", restoreError);
        });
      } catch (restoreError) {
        console.error("Map data unavailable: failed to restore canonical railway geometry.", restoreError);
      }
      reject(error);
    };
    const maybeFinish = (): void => {
      if (!sourceLoaded || !setDataResolved || !renderAfterLoad || !current()) return;
      if (E2E_METRICS_ENABLED) {
        const renderedAt = performance.now();
        const publishedAt = state.mapPublishedAt?.() ?? null;
        const firstPaintAt = state.firstMapPaintAt?.() ?? null;
        finish({
          loadToAppliedMs: publishedAt === null ? null : renderedAt - publishedAt,
          renderLatencyMs: firstPaintAt === null ? null : renderedAt - firstPaintAt,
        });
      } else {
        finish(true);
      }
    };
    const onCancel = (): void => finish(null);
    const onSourceData = (event: MapSourceDataEvent): void => {
      if (event.sourceId !== SOURCE_ID || event.sourceDataType !== "content" || event.tile) return;
      if (!current()) {
        finish(null);
        return;
      }
      // A cold source can still be indexing canonical data when the worker replies.
      if (!started) {
        updateSource();
        return;
      }
      sourceLoaded = true;
      maybeFinish();
    };
    const onDataAbort = (event: MapSourceDataEvent): void => {
      if (event.sourceId !== SOURCE_ID || event.tile) return;
      if (!current()) finish(null);
      else fail(new Error(`MapLibre aborted corridor offset request ${request.requestId}.`));
    };
    const onError = (event: ErrorEvent): void => {
      const sourceId = (event as ErrorEvent & { sourceId?: string }).sourceId;
      if (sourceId !== SOURCE_ID || (event as ErrorEvent & { tile?: unknown }).tile) return;
      fail(event.error);
    };
    const onRender = (): void => {
      if (!current()) {
        finish(null);
        return;
      }
      if (!sourceLoaded || !map.isSourceLoaded(SOURCE_ID)) return;
      renderAfterLoad = true;
      maybeFinish();
    };

    map.on("sourcedata", onSourceData);
    map.on("dataabort", onDataAbort);
    map.on("sourcedataabort", onDataAbort);
    map.on("error", onError);
    map.on("render", onRender);
    state.signal.addEventListener("abort", onCancel);
    function updateSource(): void {
      started = true;
      try {
        if (E2E_METRICS_ENABLED) performance.mark("corridor-offset-before-setData");
        void sourceRef.setData(sourceData).then(() => {
          if (!current()) {
            finish(null);
            return;
          }
          setDataResolved = true;
          maybeFinish();
        }, fail);
      } catch (error) {
        fail(error);
      }
    }
    if (!started && sourceRef.loaded()) updateSource();
  });
}
