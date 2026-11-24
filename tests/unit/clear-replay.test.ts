import { describe, expect, it } from "vitest";
import type { StepPath } from "../../src/features/game/animation/movePath";
import type { FrameScheduler } from "../../src/features/game/animation/runner";
import { createClearReplayStore, type ReplayVisibility } from "../../src/features/game/clearReplayStore";
import type { ClearRoute } from "../../src/features/game/clearResult";
import { buildClearRouteGeoJson } from "../../src/features/game/clearRoute";

class FakeScheduler implements FrameScheduler {
  private nextHandle = 1;
  private callbacks = new Map<number, (now: number) => void>();
  readonly staleCallbacks = new Map<number, (now: number) => void>();
  time = 0;

  request(callback: (now: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    const callback = this.callbacks.get(handle);
    if (callback) this.staleCallbacks.set(handle, callback);
    this.callbacks.delete(handle);
  }

  now(): number { return this.time; }

  frameAt(time: number): void {
    this.time = time;
    const entry = this.callbacks.entries().next().value as [number, (now: number) => void] | undefined;
    if (!entry) return;
    this.callbacks.delete(entry[0]);
    entry[1](time);
  }

  advance(milliseconds: number): void { this.frameAt(this.time + milliseconds); }

  fireStale(time: number): void {
    this.time = time;
    const callback = this.staleCallbacks.values().next().value as ((now: number) => void) | undefined;
    callback?.(time);
  }
}

class FakeVisibility implements ReplayVisibility {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "visibilitychange", listener: () => void): void { this.listeners.delete(listener); }
  change(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
  get listenerCount(): number { return this.listeners.size; }
}

function step(index: number, distanceKm = 1): StepPath {
  return {
    segmentId: `segment-${index}`,
    fromStationId: `station-${index}`,
    toStationId: `station-${index + 1}`,
    newlyCompleted: false,
    points: [[index, 0], [index + 1, 0]],
    cumulative: [0, 1],
    total: 1,
    distanceKm,
  };
}

function route(spans: readonly [number, number][]): ClearRoute {
  const steps = Array.from({ length: Math.max(0, ...spans.map((span) => span[1])) }, (_, index) => step(index));
  const legs = steps.map((_, index) => ({
    firstStepIndex: index,
    endStepIndexExclusive: index + 1,
    serviceId: "line",
    lineGroupId: "line-group",
    color: "#0088cc",
  }));
  return {
    steps,
    legs,
    turnSpans: spans.map(([firstStepIndex, endStepIndexExclusive], recordIndex) => ({
      recordIndex, firstStepIndex, endStepIndexExclusive,
    })),
    bounds: [[0, 0], [steps.length, 0]],
  };
}

describe("clear replay store", () => {
  it("keeps exact saved-turn and step boundaries, including multi-hop and empty deadhead turns", () => {
    const scheduler = new FakeScheduler();
    const replayRoute = route([[0, 2], [2, 2], [2, 3]]);
    const store = createClearReplayStore({ route: replayRoute, scheduler });
    store.start();
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 0, stepIndex: 0, fraction: 0 });
    scheduler.frameAt(0);
    scheduler.advance(275);
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 0, stepIndex: 1, fraction: 0 });
    scheduler.advance(275);
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 1, stepIndex: 2, fraction: 0 });
    scheduler.advance(550);
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 2, stepIndex: 2, fraction: 0 });
    scheduler.advance(550);
    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 3, stepIndex: 3, fraction: 1 });
  });

  it("holds the route cursor through a zero-hop same-station deadhead and a trailing empty turn", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 1], [1, 1]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(550);
    const afterRide = store.getSnapshot();
    expect(afterRide).toEqual({ phase: "playing", recordIndex: 1, stepIndex: 1, fraction: 0 });
    scheduler.advance(550);
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 2, stepIndex: 1, fraction: 0 });
    scheduler.advance(550);
    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 3, stepIndex: 1, fraction: 1 });
    expect(afterRide.stepIndex).toBe(store.getSnapshot().stepIndex);
  });

  it("changes speed mid-turn without changing the drawn position", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(275);
    const beforeSpeedChange = store.getSnapshot();
    store.setSpeed("fast");
    expect(store.getSnapshot()).toEqual(beforeSpeedChange);
    scheduler.advance(125);
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 1, stepIndex: 1, fraction: 0 });
  });

  it("pauses and resumes in place, and finish works while paused", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(190);
    store.pause();
    const paused = store.getSnapshot();
    expect(paused.phase).toBe("paused");
    scheduler.advance(1_000);
    expect(store.getSnapshot()).toEqual(paused);
    store.resume();
    scheduler.frameAt(scheduler.time);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: paused.recordIndex, stepIndex: paused.stepIndex, fraction: paused.fraction });
    store.pause();
    store.finish();
    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
  });

  it("finishes naturally and can replay from the beginning after completion", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(1_100);
    expect(store.getSnapshot().phase).toBe("done");
    store.start();
    expect(store.getSnapshot()).toEqual({ phase: "playing", recordIndex: 0, stepIndex: 0, fraction: 0 });
  });

  it("pauses when the tab becomes hidden and waits for explicit resume", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler, visibility });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(100);
    visibility.change(true);
    const paused = store.getSnapshot();
    expect(paused.phase).toBe("paused");
    scheduler.advance(1_000);
    expect(store.getSnapshot()).toEqual(paused);
    visibility.change(false);
    store.resume();
    expect(store.getSnapshot().phase).toBe("playing");
  });

  it("shows the full route immediately for reduced motion, including changes during replay", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.setReducedMotion(true);
    store.start();
    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
    store.setReducedMotion(false);
    store.start();
    store.setReducedMotion(true);
    expect(store.getSnapshot().phase).toBe("done");
  });

  it("ignores a callback captured by an older run after pause and replay", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    store.pause();
    const paused = store.getSnapshot();
    scheduler.fireStale(500);
    expect(store.getSnapshot()).toEqual(paused);
    store.finish();
    store.start();
    scheduler.fireStale(1_000);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 0, stepIndex: 0 });
  });

  it("keeps frame subscriptions separate from the phase and saved-turn UI snapshot", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    let frameNotifications = 0;
    let uiNotifications = 0;
    store.subscribe(() => { frameNotifications += 1; });
    store.subscribeUi(() => { uiNotifications += 1; });
    store.start();
    scheduler.frameAt(0);
    const before = store.getUiSnapshot();
    scheduler.advance(100);
    expect(store.getSnapshot().fraction).toBeGreaterThan(0);
    expect(store.getUiSnapshot()).toBe(before);
    expect(uiNotifications).toBe(1);
    expect(frameNotifications).toBeGreaterThan(uiNotifications);
    scheduler.advance(450);
    expect(store.getUiSnapshot()).toEqual({ phase: "playing", recordIndex: 1 });
    expect(uiNotifications).toBe(2);
  });

  it("notifies phase subscribers on phase changes only, without forwarding frame progress", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    const phases: string[] = [];
    store.subscribePhase(() => { phases.push(store.getPhase()); });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(100);
    expect(store.getSnapshot().fraction).toBeGreaterThan(0);
    expect(phases).toEqual(["playing"]);
    store.pause();
    expect(phases).toEqual(["playing", "paused"]);
    store.finish();
    expect(phases).toEqual(["playing", "paused", "done"]);
  });

  it("continues a long saved result beyond twelve seconds of virtual time", () => {
    const scheduler = new FakeScheduler();
    const spans: [number, number][] = Array.from({ length: 24 }, () => [0, 0]);
    spans.push([0, 1]);
    const store = createClearReplayStore({ route: route(spans), scheduler });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(12_001);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 21 });
    scheduler.advance(1_749);
    expect(store.getSnapshot().phase).toBe("done");
  });

  it("unsubscribes visibility and frame listeners on dispose", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1]]), scheduler, visibility });
    store.start();
    expect(visibility.listenerCount).toBe(1);
    store.dispose();
    expect(visibility.listenerCount).toBe(0);
  });
});

describe("partial clear route GeoJSON", () => {
  it("draws only completed legs and the current leg prefix, dropping one-point lines", () => {
    const routeInput = route([[0, 2], [2, 3]]);
    const half = buildClearRouteGeoJson(routeInput, { stepIndex: 1, fraction: 0.5 });
    expect(half.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [[0, 0], [1, 0]],
      [[1, 0], [1.5, 0]],
    ]);
    const start = buildClearRouteGeoJson(routeInput, { stepIndex: 0, fraction: 0 });
    expect(start.features).toEqual([]);
  });

  it("keeps route legs separate across a deadhead turn", () => {
    const routeInput = route([[0, 1], [1, 1], [1, 2]]);
    const data = buildClearRouteGeoJson(routeInput, { stepIndex: 2, fraction: 0.5 });
    expect(data.features).toHaveLength(2);
    expect(data.features.every((feature) => feature.geometry.coordinates.length >= 2)).toBe(true);
  });
});
