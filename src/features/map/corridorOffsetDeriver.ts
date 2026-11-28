import type { SegmentFeatureCollection } from "../../types/data";
import type { CorridorOffsetPayload } from "./corridorOffsetMemo";
import { corridorOffsetMemo, type CorridorOffsetMemo } from "./corridorOffsetMemo";
import { exposeCorridorOffsetMetricsForE2E } from "./e2eHook";

const E2E_METRICS_ENABLED = import.meta.env.MODE === "e2e";
const WARNING = "Map data unavailable: shared-track offsets are unavailable; keeping canonical geometry.";

export interface CorridorOffsetRequest {
  readonly requestId: number;
  readonly geometry: SegmentFeatureCollection;
  readonly targetServiceId: string;
  readonly transfer?: "blob" | "object";
}

export interface CorridorOffsetReply {
  readonly result: CorridorOffsetPayload;
  readonly workerDerivationMs?: number | null;
  readonly mainThreadReplyStartedAt?: number;
}

export interface CorridorOffsetDeriver {
  derive(request: CorridorOffsetRequest, onPosted?: (postMessageMs: number) => void): Promise<CorridorOffsetReply>;
  dispose?(): void;
}

export type CorridorOffsetApplyResult = true | {
  readonly loadToAppliedMs: number | null;
  readonly renderLatencyMs: number | null;
};

export type CorridorOffsetApply = (
  result: CorridorOffsetPayload,
  requestId: number,
) => CorridorOffsetApplyResult | null | Promise<CorridorOffsetApplyResult | null>;

export interface CorridorOffsetLoadMetrics {
  readonly state: "pending" | "applied" | "failed" | "unsupported";
  readonly canonicalCount: number;
  readonly derivedCount: number | null;
  readonly postMessageMs: number | null;
  readonly replyHandlingMs: number | null;
  readonly workerDerivationMs: number | null;
  readonly requestStartedAt: number | null;
  readonly loadToAppliedMs: number | null;
  readonly renderLatencyMs: number | null;
}

type WorkerReply = {
  readonly requestId: number;
  readonly result?: CorridorOffsetPayload;
  readonly error?: string;
  readonly workerDerivationMs?: number;
};

interface WorkerPort {
  postMessage(message: CorridorOffsetRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerReply>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<WorkerReply>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

/** Builds the module worker on the first cache miss, not when the map mounts. */
export function createCorridorOffsetWorkerDeriver(
  createWorker: () => WorkerPort = () => new Worker(
    new URL("./corridorOffsets.worker.ts", import.meta.url),
    { type: "module" },
  ),
): CorridorOffsetDeriver | null {
  if (typeof Worker === "undefined") return null;

  let worker: WorkerPort | null = null;
  let disposed = false;
  const pending = new Map<number, {
    resolve: (reply: CorridorOffsetReply) => void;
    reject: (error: unknown) => void;
  }>();
  const onMessage = (event: MessageEvent<WorkerReply>): void => {
    const callbacks = pending.get(event.data.requestId);
    if (!callbacks) return;
    pending.delete(event.data.requestId);
    if (event.data.result) {
      callbacks.resolve({
        result: event.data.result,
        ...(E2E_METRICS_ENABLED ? {
          workerDerivationMs: event.data.workerDerivationMs ?? null,
          mainThreadReplyStartedAt: performance.now(),
        } : {}),
      });
    } else {
      callbacks.reject(new Error(event.data.error ?? "Corridor offset worker failed."));
    }
  };
  const onError = (event: ErrorEvent): void => {
    const error = event.error ?? new Error(event.message || "Corridor offset worker failed.");
    for (const callbacks of pending.values()) callbacks.reject(error);
    pending.clear();
  };

  return {
    derive(request, onPosted) {
      if (disposed) return Promise.reject(new Error("Corridor offset worker is disposed."));
      try {
        if (!worker) {
          worker = createWorker();
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
        }
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        pending.set(request.requestId, { resolve, reject });
        const startedAt = E2E_METRICS_ENABLED ? performance.now() : 0;
        try {
          worker!.postMessage(request);
          if (E2E_METRICS_ENABLED) onPosted?.(performance.now() - startedAt);
        } catch (error) {
          pending.delete(request.requestId);
          reject(error);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (worker) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.terminate();
      }
      const error = new Error("Corridor offset worker was disposed.");
      for (const callbacks of pending.values()) callbacks.reject(error);
      pending.clear();
    },
  };
}

/** Owns one map's request identity while the successful memo survives style reloads. */
export class CorridorOffsetLoader {
  private requestId = 0;
  private current: CorridorOffsetRequest | null = null;
  private readyReply: CorridorOffsetReply | null = null;
  private currentApply: CorridorOffsetApply | null = null;
  private applying = false;
  private disposed = false;
  private warned = false;
  private deriver: CorridorOffsetDeriver | null = null;
  private deriverResolved = false;

  constructor(
    private readonly createDeriver: CorridorOffsetDeriver | null | (() => CorridorOffsetDeriver | null),
    private readonly warn: (message: string, error?: unknown) => void = (message, error) => console.warn(message, error),
    private readonly report: (metrics: CorridorOffsetLoadMetrics) => void = (metrics) => {
      if (E2E_METRICS_ENABLED) exposeCorridorOffsetMetricsForE2E(metrics);
    },
    private readonly memo: CorridorOffsetMemo = corridorOffsetMemo,
  ) {}

  cached(geometry: SegmentFeatureCollection, targetServiceId: string): CorridorOffsetPayload | null {
    return this.memo.get(geometry, targetServiceId);
  }

  request(geometry: SegmentFeatureCollection, targetServiceId: string, apply: CorridorOffsetApply): void {
    if (this.disposed) return;
    const cached = this.memo.get(geometry, targetServiceId);
    if (this.current?.geometry === geometry && this.current.targetServiceId === targetServiceId) {
      this.currentApply = apply;
      if (cached) {
        this.readyReply = { result: cached };
        this.applyReady(this.current);
      } else if (this.readyReply) {
        this.applyReady(this.current);
      }
      return;
    }

    const request = {
      requestId: ++this.requestId,
      geometry,
      targetServiceId,
      transfer: E2E_METRICS_ENABLED && new URLSearchParams(window.location.search).get("offsetTransfer") === "blob"
        ? "blob" as const
        : "object" as const,
    };
    this.current = request;
    this.currentApply = apply;
    this.readyReply = cached ? { result: cached } : null;
    this.applying = false;
    const timing = E2E_METRICS_ENABLED
      ? { requestStartedAt: performance.now(), postMessageMs: null as number | null }
      : null;
    if (timing) performance.mark("corridor-offset-request");

    if (cached) {
      this.reportState("pending", geometry, timing, null);
      this.applyReady(request, timing);
      return;
    }

    const deriver = this.resolveDeriver();
    if (!deriver) {
      this.warnOnce(new Error("Web Worker is not available."));
      this.reportState("unsupported", geometry, timing, null);
      return;
    }
    this.reportState("pending", geometry, timing, null);
    void deriver.derive(request, (postMessageMs) => {
      if (timing) timing.postMessageMs = postMessageMs;
    }).then((reply) => {
      if (!this.isCurrent(request)) return;
      this.readyReply = reply;
      this.applyReady(request, timing);
    }).catch((error: unknown) => {
      if (!this.isCurrent(request)) return;
      this.fail(request, geometry, timing, error);
    });
  }

  isCurrent(request: CorridorOffsetRequest): boolean {
    return !this.disposed
      && this.current?.requestId === request.requestId
      && this.current.geometry === request.geometry
      && this.current.targetServiceId === request.targetServiceId;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.current = null;
    this.currentApply = null;
    this.readyReply = null;
    this.deriver?.dispose?.();
  }

  private resolveDeriver(): CorridorOffsetDeriver | null {
    if (this.deriverResolved) return this.deriver;
    this.deriverResolved = true;
    this.deriver = typeof this.createDeriver === "function" ? this.createDeriver() : this.createDeriver;
    return this.deriver;
  }

  private applyReady(request: CorridorOffsetRequest, timing: {
    requestStartedAt: number;
    postMessageMs: number | null;
  } | null = null): void {
    if (this.applying || !this.isCurrent(request) || !this.readyReply || !this.currentApply) return;
    this.applying = true;
    const apply = this.currentApply;
    const reply = this.readyReply;
    const replyStartedAt = E2E_METRICS_ENABLED
      ? reply.mainThreadReplyStartedAt ?? performance.now()
      : 0;
    let application: CorridorOffsetApplyResult | null | Promise<CorridorOffsetApplyResult | null>;
    try {
      application = apply(reply.result, request.requestId);
    } catch (error) {
      this.fail(request, request.geometry, timing, error);
      return;
    }
    const replyHandlingMs = E2E_METRICS_ENABLED ? performance.now() - replyStartedAt : null;
    void Promise.resolve(application).then((applied) => {
      if (!this.isCurrent(request)) return;
      this.applying = false;
      if (applied === null || this.currentApply !== apply) {
        if (this.currentApply !== apply) this.applyReady(request, timing);
        return;
      }
      this.memo.set(request.geometry, request.targetServiceId, reply.result);
      if (E2E_METRICS_ENABLED) performance.mark("corridor-offset-rendered");
      if (E2E_METRICS_ENABLED && applied !== true) this.reportState("applied", request.geometry, timing, {
        derivedCount: reply.result.derivedCount,
        replyHandlingMs,
        workerDerivationMs: reply.workerDerivationMs ?? null,
        loadToAppliedMs: applied.loadToAppliedMs,
        renderLatencyMs: applied.renderLatencyMs,
      });
    }).catch((error: unknown) => {
      if (!this.isCurrent(request)) return;
      this.fail(request, request.geometry, timing, error);
    });
  }

  private fail(
    request: CorridorOffsetRequest,
    geometry: SegmentFeatureCollection,
    timing: { requestStartedAt: number; postMessageMs: number | null } | null,
    error: unknown,
  ): void {
    if (!this.isCurrent(request)) return;
    this.memo.delete(geometry, request.targetServiceId);
    this.current = null;
    this.readyReply = null;
    this.currentApply = null;
    this.applying = false;
    this.warnOnce(error);
    this.reportState("failed", geometry, timing, null);
  }

  private reportState(
    state: CorridorOffsetLoadMetrics["state"],
    geometry: SegmentFeatureCollection,
    timing: { requestStartedAt: number; postMessageMs: number | null } | null,
    result: {
      derivedCount: number | null;
      replyHandlingMs: number | null;
      workerDerivationMs: number | null;
      loadToAppliedMs: number | null;
      renderLatencyMs: number | null;
    } | null,
  ): void {
    if (!E2E_METRICS_ENABLED) return;
    this.report({
      state,
      canonicalCount: geometry.features.length,
      derivedCount: result?.derivedCount ?? null,
      postMessageMs: timing?.postMessageMs ?? null,
      replyHandlingMs: result?.replyHandlingMs ?? null,
      workerDerivationMs: result?.workerDerivationMs ?? null,
      requestStartedAt: timing?.requestStartedAt ?? null,
      loadToAppliedMs: result?.loadToAppliedMs ?? null,
      renderLatencyMs: result?.renderLatencyMs ?? null,
    });
  }

  private warnOnce(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.warn(WARNING, error);
  }
}
