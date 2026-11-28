import { buildCorridorOffsets } from "./corridorOffsets";
import type { CorridorOffsetPayload } from "./corridorOffsetMemo";
import type { SegmentFeatureCollection } from "../../types/data";

const E2E_METRICS_ENABLED = import.meta.env.MODE === "e2e";

interface CorridorOffsetRequest {
  readonly requestId: number;
  readonly geometry: SegmentFeatureCollection;
  readonly targetServiceId: string;
  readonly transfer?: "blob" | "object";
}

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CorridorOffsetRequest>) => void,
  ): void;
  postMessage(message: {
    readonly requestId: number;
    readonly result?: CorridorOffsetPayload;
    readonly error?: string;
    readonly workerDerivationMs?: number;
  }): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.addEventListener("message", (event) => {
  const { requestId, geometry, targetServiceId } = event.data;
  const startedAt = E2E_METRICS_ENABLED ? performance.now() : 0;
  try {
    const result = buildCorridorOffsets(geometry, targetServiceId);
    const geoJson = E2E_METRICS_ENABLED && event.data.transfer === "blob"
      ? new Blob([JSON.stringify(result)], { type: "application/geo+json" })
      : result;
    workerScope.postMessage({
      requestId,
      result: { geoJson, derivedCount: result.features.length },
      ...(E2E_METRICS_ENABLED ? { workerDerivationMs: performance.now() - startedAt } : {}),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
      ...(E2E_METRICS_ENABLED ? { workerDerivationMs: performance.now() - startedAt } : {}),
    });
  }
});
