import type { ClearRoute } from "./clearResult";
import { browserFrameScheduler, type FrameScheduler } from "./animation/runner";
import { easeInOut, hopDurationMs } from "./animation/timeline";

export type ClearReplayPhase = "idle" | "playing" | "paused" | "done";
export type ClearReplaySpeed = "slow" | "normal" | "fast";

export const CLEAR_REPLAY_SPEEDS: Readonly<Record<ClearReplaySpeed, number>> = {
  slow: 900,
  normal: 550,
  fast: 250,
};

export const CLEAR_REPLAY_SPEED_LABELS: Readonly<Record<ClearReplaySpeed, string>> = {
  slow: "ゆっくり",
  normal: "ふつう",
  fast: "はやい",
};

export interface ClearReplaySnapshot {
  readonly phase: ClearReplayPhase;
  /** Current saved record index; equals `turnSpans.length` when all turns are complete. */
  readonly recordIndex: number;
  /** Index of the route step in progress, or the next step at an exact boundary. */
  readonly stepIndex: number;
  /** Distance fraction on `stepIndex`, eased for the visual animation. */
  readonly fraction: number;
}

export interface ClearReplayUiSnapshot {
  readonly phase: ClearReplayPhase;
  readonly recordIndex: number;
}

export interface ReplayVisibility {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface ClearReplayStoreInput {
  readonly route: ClearRoute | null;
  readonly scheduler?: FrameScheduler & { readonly now?: () => number };
  readonly visibility?: ReplayVisibility;
  readonly reducedMotion?: boolean;
}

export interface ClearReplayStore {
  getSnapshot(): ClearReplaySnapshot;
  subscribe(listener: () => void): () => void;
  getPhase(): ClearReplayPhase;
  subscribePhase(listener: () => void): () => void;
  getUiSnapshot(): ClearReplayUiSnapshot;
  subscribeUi(listener: () => void): () => void;
  start(): void;
  pause(): void;
  resume(): void;
  finish(): void;
  setSpeed(speed: ClearReplaySpeed): void;
  getSpeed(): ClearReplaySpeed;
  setReducedMotion(reduced: boolean): void;
  setRoute(route: ClearRoute | null): void;
  /** Re-enables a disposed store when React replays an effect setup in StrictMode. */
  activate(): void;
  dispose(): void;
}

const IDLE_SNAPSHOT: ClearReplaySnapshot = { phase: "idle", recordIndex: 0, stepIndex: 0, fraction: 0 };
const IDLE_UI_SNAPSHOT: ClearReplayUiSnapshot = { phase: "idle", recordIndex: 0 };

interface TurnProgress {
  readonly snapshot: ClearReplaySnapshot;
  /** Elapsed part of this saved turn, from 0 to 1; also tracks empty spans. */
  readonly turnFraction: number;
}

function sameSnapshot(first: ClearReplaySnapshot, second: ClearReplaySnapshot): boolean {
  return first.phase === second.phase && first.recordIndex === second.recordIndex &&
    first.stepIndex === second.stepIndex && first.fraction === second.fraction;
}

function normalizedHopWeights(route: ClearRoute, first: number, end: number): number[] {
  return route.steps.slice(first, end).map((step) => hopDurationMs(step, 1));
}

function atElapsed(route: ClearRoute | null, elapsedMs: number, speed: ClearReplaySpeed, phase: ClearReplayPhase): TurnProgress {
  if (!route || route.turnSpans.length === 0) {
    return { snapshot: { ...IDLE_SNAPSHOT, phase: phase === "done" ? "done" : "idle" }, turnFraction: 0 };
  }
  const turnDuration = CLEAR_REPLAY_SPEEDS[speed];
  const totalDuration = route.turnSpans.length * turnDuration;
  if (phase === "done" || elapsedMs >= totalDuration) {
    return {
      snapshot: { phase: "done", recordIndex: route.turnSpans.length, stepIndex: route.steps.length, fraction: 1 },
      turnFraction: 1,
    };
  }
  const safeElapsed = Math.max(0, elapsedMs);
  const recordIndex = Math.min(route.turnSpans.length - 1, Math.floor(safeElapsed / turnDuration));
  const turnElapsed = safeElapsed - recordIndex * turnDuration;
  const span = route.turnSpans[recordIndex]!;
  const weights = normalizedHopWeights(route, span.firstStepIndex, span.endStepIndexExclusive);
  if (weights.length === 0) {
    return {
      snapshot: { phase, recordIndex, stepIndex: span.firstStepIndex, fraction: 0 },
      turnFraction: turnElapsed / turnDuration,
    };
  }

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let turnCursor = 0;
  for (const [offset, weight] of weights.entries()) {
    const stepDuration = turnDuration * weight / weightTotal;
    const stepIndex = span.firstStepIndex + offset;
    if (turnElapsed < turnCursor + stepDuration || offset === weights.length - 1) {
      const progress = Math.max(0, Math.min(1, (turnElapsed - turnCursor) / stepDuration));
      return {
        snapshot: { phase, recordIndex, stepIndex, fraction: easeInOut(progress) },
        turnFraction: turnElapsed / turnDuration,
      };
    }
    turnCursor += stepDuration;
  }
  return {
    snapshot: { phase, recordIndex, stepIndex: span.endStepIndexExclusive, fraction: 0 },
    turnFraction: turnElapsed / turnDuration,
  };
}

/** A per-saved-turn timeline. Its clock and document are injectable for deterministic lifecycle tests. */
export function createClearReplayStore(input: ClearReplayStoreInput): ClearReplayStore {
  const scheduler: FrameScheduler & { readonly now?: () => number } = input.scheduler ?? browserFrameScheduler;
  const visibility = input.visibility ?? (typeof document === "undefined" ? null : document);
  let route = input.route;
  let speed: ClearReplaySpeed = "normal";
  let reducedMotion = input.reducedMotion ?? false;
  let snapshot = IDLE_SNAPSHOT;
  let listeners = new Set<() => void>();
  let phaseListeners = new Set<() => void>();
  let uiSnapshot = IDLE_UI_SNAPSHOT;
  let uiListeners = new Set<() => void>();
  let phase: ClearReplayPhase = "idle";
  let elapsedMs = 0;
  let turnFraction = 0;
  let anchorAt: number | null = null;
  let frameHandle: number | null = null;
  let runId = 0;
  let disposed = false;
  let visibilityListening = false;

  const publish = (next: ClearReplaySnapshot): void => {
    const phaseChanged = snapshot.phase !== next.phase;
    if (!sameSnapshot(snapshot, next)) {
      snapshot = next;
      for (const listener of listeners) listener();
    }
    if (phaseChanged) {
      for (const listener of phaseListeners) listener();
    }
    if (uiSnapshot.phase !== next.phase || uiSnapshot.recordIndex !== next.recordIndex) {
      uiSnapshot = { phase: next.phase, recordIndex: next.recordIndex };
      for (const listener of uiListeners) listener();
    }
  };
  const cancelFrame = (): void => {
    if (frameHandle === null) return;
    scheduler.cancel(frameHandle);
    frameHandle = null;
  };
  const detachVisibility = (): void => {
    if (!visibilityListening) return;
    visibility?.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityListening = false;
  };
  const setElapsed = (value: number): void => {
    elapsedMs = value;
    const progress = atElapsed(route, elapsedMs, speed, phase);
    turnFraction = progress.turnFraction;
    publish(progress.snapshot);
    if (progress.snapshot.phase === "done") completeNaturally();
  };
  const tick = (id: number, now: number): void => {
    if (disposed || id !== runId || phase !== "playing") return;
    frameHandle = null;
    if (anchorAt === null) anchorAt = now;
    else {
      elapsedMs += Math.max(0, now - anchorAt);
      anchorAt = now;
    }
    setElapsed(elapsedMs);
    if (phase === "playing" && id === runId) frameHandle = scheduler.request((nextNow) => tick(id, nextNow));
  };
  const startClock = (): void => {
    const id = ++runId;
    anchorAt = null;
    frameHandle = scheduler.request((now) => tick(id, now));
  };
  const completeNaturally = (): void => {
    if (phase === "done") return;
    phase = "done";
    cancelFrame();
    runId += 1;
    anchorAt = null;
    detachVisibility();
    publish(atElapsed(route, 0, speed, "done").snapshot);
  };
  function onVisibilityChange(): void {
    if (visibility?.hidden && phase === "playing") store.pause();
  }
  const attachVisibility = (): void => {
    if (visibilityListening) return;
    visibility?.addEventListener("visibilitychange", onVisibilityChange);
    visibilityListening = true;
  };
  const syncClock = (): void => {
    const now = scheduler.now?.();
    if (phase === "playing" && anchorAt !== null && now !== undefined) {
      elapsedMs += Math.max(0, now - anchorAt);
      anchorAt = now;
      setElapsed(elapsedMs);
    }
  };

  const store: ClearReplayStore = {
    getSnapshot: () => snapshot,
    getPhase: () => snapshot.phase,
    subscribePhase(listener) {
      phaseListeners.add(listener);
      return () => { phaseListeners.delete(listener); };
    },
    getUiSnapshot: () => uiSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeUi(listener) {
      uiListeners.add(listener);
      return () => { uiListeners.delete(listener); };
    },
    start() {
      if (disposed || phase === "playing" || !route) return;
      if (reducedMotion) {
        store.finish();
        return;
      }
      if (visibility?.hidden) {
        phase = "paused";
        elapsedMs = 0;
        turnFraction = 0;
        publish({ ...IDLE_SNAPSHOT, phase: "paused" });
        attachVisibility();
        return;
      }
      cancelFrame();
      phase = "playing";
      elapsedMs = 0;
      turnFraction = 0;
      publish({ ...IDLE_SNAPSHOT, phase: "playing" });
      attachVisibility();
      startClock();
    },
    pause() {
      if (disposed || phase !== "playing") return;
      syncClock();
      if (phase !== "playing") return;
      cancelFrame();
      runId += 1;
      anchorAt = null;
      phase = "paused";
      publish({ ...snapshot, phase: "paused" });
    },
    resume() {
      if (disposed || phase !== "paused" || visibility?.hidden) return;
      if (reducedMotion) {
        store.finish();
        return;
      }
      phase = "playing";
      publish({ ...snapshot, phase: "playing" });
      attachVisibility();
      startClock();
    },
    finish() {
      if (disposed || phase === "done") return;
      cancelFrame();
      runId += 1;
      anchorAt = null;
      phase = "done";
      detachVisibility();
      publish(atElapsed(route, 0, speed, "done").snapshot);
    },
    setSpeed(nextSpeed) {
      if (disposed || nextSpeed === speed) return;
      syncClock();
      const current = atElapsed(route, elapsedMs, speed, phase);
      turnFraction = current.turnFraction;
      speed = nextSpeed;
      elapsedMs = (current.snapshot.recordIndex + turnFraction) * CLEAR_REPLAY_SPEEDS[speed];
    },
    getSpeed: () => speed,
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      if (reduced && (phase === "playing" || phase === "paused")) store.finish();
    },
    setRoute(nextRoute) {
      if (route === nextRoute) return;
      cancelFrame();
      runId += 1;
      detachVisibility();
      route = nextRoute;
      phase = "idle";
      elapsedMs = 0;
      turnFraction = 0;
      anchorAt = null;
      publish(IDLE_SNAPSHOT);
    },
    activate() {
      disposed = false;
      if (phase === "playing" || phase === "paused") attachVisibility();
    },
    dispose() {
      if (disposed) return;
      cancelFrame();
      runId += 1;
      detachVisibility();
      phase = "idle";
      elapsedMs = 0;
      turnFraction = 0;
      anchorAt = null;
      publish(IDLE_SNAPSHOT);
      disposed = true;
      listeners.clear();
      phaseListeners.clear();
      uiListeners.clear();
    },
  };
  return store;
}
