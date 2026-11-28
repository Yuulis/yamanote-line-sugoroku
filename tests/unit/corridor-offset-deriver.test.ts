import { describe, expect, it, vi } from "vitest";
import {
  CorridorOffsetLoader,
  type CorridorOffsetApplyResult,
  type CorridorOffsetDeriver,
  type CorridorOffsetReply,
  type CorridorOffsetRequest,
} from "../../src/features/map/corridorOffsetDeriver";
import { createCorridorOffsetMemo } from "../../src/features/map/corridorOffsetMemo";
import { buildCorridorOffsets } from "../../src/features/map/corridorOffsets";
import type { Position, SegmentFeatureCollection } from "../../src/types/data";

const geometry: SegmentFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "service-a:edge",
      properties: { featureId: "edge", serviceId: "service-a", lineId: "line-a", from: "a", to: "b" },
      geometry: { type: "LineString", coordinates: [[139, 35], [139.1, 35.1]] as Position[] },
    },
  ],
};

interface DeferredRequest {
  readonly request: CorridorOffsetRequest;
  readonly resolve: (reply: CorridorOffsetReply) => void;
  readonly reject: (error: Error) => void;
  readonly onPosted?: (postMessageMs: number) => void;
}

function fakeDeriver(): { deriver: CorridorOffsetDeriver; requests: DeferredRequest[] } {
  const requests: DeferredRequest[] = [];
  return {
    requests,
    deriver: {
      derive: (request, onPosted) => new Promise((resolve, reject) => {
        requests.push({ request, resolve, reject, onPosted });
        onPosted?.(2.5);
      }),
    },
  };
}

async function flushPromiseHandlers(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

const applied: CorridorOffsetApplyResult = { loadToAppliedMs: 12, renderLatencyMs: 9 };

function payload(input: SegmentFeatureCollection, targetServiceId: string) {
  const result = buildCorridorOffsets(input, targetServiceId);
  return {
    geoJson: new Blob([JSON.stringify(result)], { type: "application/geo+json" }),
    derivedCount: result.features.length,
  };
}

describe("corridor offset worker loader", () => {
  it("starts with canonical data, then updates the derived source on reply", async () => {
    const { deriver, requests } = fakeDeriver();
    const memo = createCorridorOffsetMemo();
    const report = vi.fn();
    const loader = new CorridorOffsetLoader(deriver, vi.fn(), report, memo);
    const source: { data: unknown; setData(data: unknown): void } = {
      data: loader.cached(geometry, "service-a") ?? geometry,
      setData(data) { this.data = data; },
    };

    expect(source.data).toBe(geometry);
    loader.request(geometry, "service-a", (result) => {
      source.setData(result);
      return applied;
    });
    expect(requests).toHaveLength(1);
    const derived = payload(geometry, "service-a");
    requests[0]!.resolve({ result: derived, workerDerivationMs: 18 });
    await flushPromiseHandlers();

    expect(source.data).toBe(derived);
    expect(memo.get(geometry, "service-a")).toBe(derived);
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores replies made stale by geometry and target changes", async () => {
    const { deriver, requests } = fakeDeriver();
    const loader = new CorridorOffsetLoader(deriver, vi.fn(), vi.fn());
    const staleApply = vi.fn(() => applied);
    const staleTargetApply = vi.fn(() => applied);
    const currentApply = vi.fn(() => applied);
    const replacementGeometry = structuredClone(geometry);

    loader.request(geometry, "service-a", staleApply);
    loader.request(replacementGeometry, "service-a", staleTargetApply);
    requests[0]!.resolve({ result: payload(geometry, "service-a"), workerDerivationMs: 5 });
    await flushPromiseHandlers();
    expect(staleApply).not.toHaveBeenCalled();

    loader.request(replacementGeometry, "service-b", currentApply);
    requests[1]!.resolve({ result: payload(replacementGeometry, "service-a"), workerDerivationMs: 6 });
    await flushPromiseHandlers();
    expect(staleTargetApply).not.toHaveBeenCalled();

    requests[2]!.resolve({ result: payload(replacementGeometry, "service-b"), workerDerivationMs: 7 });
    await flushPromiseHandlers();
    expect(currentApply).toHaveBeenCalledTimes(1);
  });

  it("ignores a reply after map removal", async () => {
    const { deriver, requests } = fakeDeriver();
    const loader = new CorridorOffsetLoader(deriver, vi.fn(), vi.fn());
    const apply = vi.fn(() => applied);
    loader.request(geometry, "service-a", apply);
    loader.dispose();
    requests[0]!.resolve({ result: payload(geometry, "service-a"), workerDerivationMs: 5 });
    await flushPromiseHandlers();
    expect(apply).not.toHaveBeenCalled();
  });

  it("reuses the cached result after a style reload without starting another request", async () => {
    const { deriver, requests } = fakeDeriver();
    const memo = createCorridorOffsetMemo();
    const loader = new CorridorOffsetLoader(deriver, vi.fn(), vi.fn(), memo);
    const firstData = loader.cached(geometry, "service-a");
    const firstApply = vi.fn(() => applied);
    loader.request(geometry, "service-a", firstApply);
    const derived = payload(geometry, "service-a");
    requests[0]!.resolve({ result: derived, workerDerivationMs: 5 });
    await flushPromiseHandlers();

    expect(firstApply).toHaveBeenCalledOnce();
    expect(firstData).toBeNull();
    expect(loader.cached(geometry, "service-a")).toBe(derived);
    const styleReloadApply = vi.fn(() => applied);
    loader.request(geometry, "service-a", styleReloadApply);
    await flushPromiseHandlers();
    expect(styleReloadApply).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    expect(loader.cached(geometry, "service-a")).toBe(derived);
  });

  it("does not cache a failed source apply and restores the warning text and original error", async () => {
    const warnError = vi.fn();
    const { deriver, requests } = fakeDeriver();
    const memo = createCorridorOffsetMemo();
    const failedLoader = new CorridorOffsetLoader(deriver, warnError, vi.fn(), memo);
    const originalError = new Error("MapLibre source failed to load the Blob URL.");
    const failedApply = vi.fn(() => Promise.reject(originalError));
    expect(failedLoader.cached(geometry, "service-a")).toBeNull();
    failedLoader.request(geometry, "service-a", failedApply);
    requests[0]!.resolve({ result: payload(geometry, "service-a"), workerDerivationMs: 5 });
    await flushPromiseHandlers();
    expect(memo.get(geometry, "service-a")).toBeNull();
    expect(warnError).toHaveBeenCalledWith(
      "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.",
      originalError,
    );

    failedLoader.request(geometry, "service-a", vi.fn(() => applied));
    expect(requests).toHaveLength(2);
    expect(failedApply).toHaveBeenCalledOnce();
    expect(warnError).toHaveBeenCalledOnce();
  });

  it("keeps canonical data and warns once when Worker is unsupported", () => {
    const warnUnsupported = vi.fn();
    const unsupportedLoader = new CorridorOffsetLoader(null, warnUnsupported, vi.fn(), createCorridorOffsetMemo());
    expect(unsupportedLoader.cached(geometry, "service-a")).toBeNull();
    unsupportedLoader.request(geometry, "service-a", vi.fn(() => applied));
    unsupportedLoader.request(geometry, "service-a", vi.fn(() => applied));
    expect(warnUnsupported).toHaveBeenCalledOnce();
    expect(warnUnsupported).toHaveBeenCalledWith(
      "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.",
      expect.any(Error),
    );
  });

  it("retries a derived result after the previous style generation becomes stale", async () => {
    const { deriver, requests } = fakeDeriver();
    const memo = createCorridorOffsetMemo();
    const loader = new CorridorOffsetLoader(deriver, vi.fn(), vi.fn(), memo);
    const oldStyleApply = vi.fn(() => null);
    const newStyleApply = vi.fn(() => applied);
    loader.request(geometry, "service-a", oldStyleApply);
    requests[0]!.resolve({ result: payload(geometry, "service-a"), workerDerivationMs: 5 });
    await flushPromiseHandlers();
    expect(memo.get(geometry, "service-a")).toBeNull();

    loader.request(geometry, "service-a", newStyleApply);
    await flushPromiseHandlers();
    expect(oldStyleApply).toHaveBeenCalledOnce();
    expect(newStyleApply).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    expect(memo.get(geometry, "service-a")).not.toBeNull();
  });
});
