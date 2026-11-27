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
  readonly turnCount: number;
  readonly cardExpanded: boolean;
  readonly seekRevision: number;
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
  showResults(): void;
  seek(recordIndex: number): void;
  step(delta: -1 | 1): void;
  setSpeed(speed: ClearReplaySpeed): void;
  getSpeed(): ClearReplaySpeed;
  setReducedMotion(reduced: boolean): void;
  setRoute(route: ClearRoute | null): void;
  /** Re-enables a disposed store when React replays an effect setup in StrictMode. */
  activate(): void;
  dispose(): void;
}

const IDLE_SNAPSHOT: ClearReplaySnapshot = { phase: "idle", recordIndex: 0, stepIndex: 0, fraction: 0 };

/** Resolve a requested cursor to one of the saved turns, excluding the full-route boundary. */
export function resolveReplaySeekIndex(turnCount: number, recordIndex: number): number | null {
  if (!Number.isFinite(turnCount) || turnCount < 1 || !Number.isFinite(recordIndex)) return null;
  return Math.min(turnCount - 1, Math.max(0, Math.trunc(recordIndex)));
}

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
  // Each subscriber remembers the last value it was told about, so delivery is per listener.
  const listeners = new Map<() => void, ClearReplaySnapshot>();
  const phaseListeners = new Map<() => void, ClearReplayPhase>();
  const uiListeners = new Map<() => void, ClearReplayUiSnapshot>();
  let seekRevision = 0;
  let cardExpanded = false;
  let uiSnapshot: ClearReplayUiSnapshot = {
    phase: "idle",
    recordIndex: 0,
    turnCount: route?.turnSpans.length ?? 0,
    cardExpanded,
    seekRevision,
  };
  let phase: ClearReplayPhase = "idle";
  let elapsedMs = 0;
  let turnFraction = 0;
  let anchorAt: number | null = null;
  let frameHandle: number | null = null;
  let runId = 0;
  let disposed = false;
  let visibilityListening = false;

  // A store method called by a subscriber during a notification only updates the snapshots; the
  // outer flush loop then delivers the newest value once to every listener that has not seen it.
  let flushing = false;
  let clearListenersAfterFlush = false;
  const reportListenerError = (error: unknown): void => {
    // Surface the failure without stopping other listeners or the transition that published it.
    queueMicrotask(() => { throw error; });
  };
  const deliver = <T>(group: Map<() => void, T>, current: () => T): boolean => {
    let delivered = false;
    for (const listener of Array.from(group.keys())) {
      if (!group.has(listener)) continue;
      const value = current();
      if (group.get(listener) === value) continue;
      group.set(listener, value);
      delivered = true;
      try {
        listener();
      } catch (error) {
        reportListenerError(error);
      }
    }
    return delivered;
  };
  const clearListeners = (): void => {
    listeners.clear();
    phaseListeners.clear();
    uiListeners.clear();
  };
  const flush = (): void => {
    if (flushing) return;
    flushing = true;
    try {
      let delivered = true;
      while (delivered) {
        delivered = deliver(listeners, () => snapshot);
        delivered = deliver(phaseListeners, () => snapshot.phase) || delivered;
        delivered = deliver(uiListeners, () => uiSnapshot) || delivered;
      }
    } finally {
      flushing = false;
    }
    if (clearListenersAfterFlush) {
      clearListenersAfterFlush = false;
      clearListeners();
    }
  };
  const publish = (next: ClearReplaySnapshot): void => {
    const nextUiSnapshot: ClearReplayUiSnapshot = {
      phase: next.phase,
      recordIndex: next.recordIndex,
      turnCount: route?.turnSpans.length ?? 0,
      cardExpanded,
      seekRevision,
    };
    const uiChanged = uiSnapshot.phase !== nextUiSnapshot.phase ||
      uiSnapshot.recordIndex !== nextUiSnapshot.recordIndex ||
      uiSnapshot.turnCount !== nextUiSnapshot.turnCount ||
      uiSnapshot.cardExpanded !== nextUiSnapshot.cardExpanded ||
      uiSnapshot.seekRevision !== nextUiSnapshot.seekRevision;

    // Publish both views before notifying any subscriber so one transition is observed atomically.
    if (!sameSnapshot(snapshot, next)) snapshot = next;
    if (uiChanged) uiSnapshot = nextUiSnapshot;
    flush();
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
  const complete = (expandCard: boolean): void => {
    if (phase === "done" && cardExpanded === expandCard) return;
    cancelFrame();
    runId += 1;
    anchorAt = null;
    phase = "done";
    cardExpanded = expandCard;
    detachVisibility();
    publish(atElapsed(route, 0, speed, "done").snapshot);
  };
  const setElapsed = (value: number): void => {
    elapsedMs = value;
    const progress = atElapsed(route, elapsedMs, speed, phase);
    turnFraction = progress.turnFraction;
    if (progress.snapshot.phase === "done") {
      completeNaturally();
      return;
    }
    publish(progress.snapshot);
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
    complete(false);
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
  const seekTo = (recordIndex: number): void => {
    const wasPlaying = phase === "playing";
    cancelFrame();
    runId += 1;
    const seekGeneration = runId;
    const seekTime = wasPlaying ? scheduler.now?.() ?? null : null;
    phase = wasPlaying ? "playing" : "paused";
    cardExpanded = reducedMotion;
    elapsedMs = recordIndex * CLEAR_REPLAY_SPEEDS[speed];
    turnFraction = 0;
    anchorAt = seekTime;
    seekRevision += 1;
    publish(atElapsed(route, elapsedMs, speed, phase).snapshot);
    if (!wasPlaying || runId !== seekGeneration || phase !== "playing") return;
    frameHandle = scheduler.request((now) => tick(seekGeneration, now));
  };

  const store: ClearReplayStore = {
    getSnapshot: () => snapshot,
    getPhase: () => snapshot.phase,
    subscribePhase(listener) {
      // A new subscriber is told about the next change, not the current value.
      if (!phaseListeners.has(listener)) phaseListeners.set(listener, snapshot.phase);
      return () => { phaseListeners.delete(listener); };
    },
    getUiSnapshot: () => uiSnapshot,
    subscribe(listener) {
      // A new subscriber is told about the next change, not the current value.
      if (!listeners.has(listener)) listeners.set(listener, snapshot);
      return () => { listeners.delete(listener); };
    },
    subscribeUi(listener) {
      // A new subscriber is told about the next change, not the current value.
      if (!uiListeners.has(listener)) uiListeners.set(listener, uiSnapshot);
      return () => { uiListeners.delete(listener); };
    },
    start() {
      if (disposed || phase === "playing" || !route) return;
      if (reducedMotion) {
        complete(true);
        return;
      }
      if (visibility?.hidden) {
        phase = "paused";
        cardExpanded = false;
        elapsedMs = 0;
        turnFraction = 0;
        attachVisibility();
        publish({ ...IDLE_SNAPSHOT, phase: "paused" });
        return;
      }
      cancelFrame();
      phase = "playing";
      cardExpanded = false;
      elapsedMs = 0;
      turnFraction = 0;
      attachVisibility();
      const startGeneration = runId;
      publish({ ...IDLE_SNAPSHOT, phase: "playing" });
      // A subscriber may seek, pause or finish during the notification; keep its clock.
      if (runId !== startGeneration || phase !== "playing") return;
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
      cardExpanded = false;
      publish({ ...snapshot, phase: "paused" });
    },
    resume() {
      if (disposed || phase !== "paused" || visibility?.hidden) return;
      if (reducedMotion) {
        complete(true);
        return;
      }
      phase = "playing";
      cardExpanded = false;
      attachVisibility();
      const resumeGeneration = runId;
      publish({ ...snapshot, phase: "playing" });
      if (runId !== resumeGeneration || phase !== "playing") return;
      startClock();
    },
    finish() {
      // finish() keeps its no-op on done so an expanded results card stays expanded.
      if (disposed || phase === "done") return;
      complete(reducedMotion);
    },
    showResults() {
      if (disposed || phase === "idle") return;
      complete(true);
    },
    seek(recordIndex) {
      if (disposed) return;
      const target = resolveReplaySeekIndex(route?.turnSpans.length ?? 0, recordIndex);
      if (target === null) return;
      seekTo(target);
    },
    step(delta) {
      if (disposed) return;
      const turnCount = route?.turnSpans.length ?? 0;
      if (turnCount === 0) return;
      if (phase === "done") {
        seekTo(0);
        return;
      }
      const current = resolveReplaySeekIndex(turnCount, snapshot.recordIndex);
      if (current === null) return;
      const target = resolveReplaySeekIndex(turnCount, current + delta);
      if (target === null || target === current) return;
      seekTo(target);
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
      if (reduced && (phase === "playing" || phase === "paused")) complete(true);
    },
    setRoute(nextRoute) {
      if (route === nextRoute) return;
      cancelFrame();
      runId += 1;
      detachVisibility();
      route = nextRoute;
      phase = "idle";
      cardExpanded = false;
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
      disposed = true;
      cardExpanded = false;
      elapsedMs = 0;
      turnFraction = 0;
      anchorAt = null;
      // Deliver idle to current subscribers first; inside a notification, clear after that flush.
      if (flushing) clearListenersAfterFlush = true;
      publish(IDLE_SNAPSHOT);
      if (!flushing) clearListeners();
    },
  };
  return store;
}
