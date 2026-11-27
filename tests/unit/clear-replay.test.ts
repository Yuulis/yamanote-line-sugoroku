import { describe, expect, it } from "vitest";
import { FakeScheduler, FakeVisibility } from "./support/clearReplayFakes";
import type { StepPath } from "../../src/features/game/animation/movePath";
import {
  createClearReplayStore,
  resolveReplaySeekIndex,
} from "../../src/features/game/clearReplayStore";
import type { ClearRoute } from "../../src/features/game/clearResult";
import { buildClearRouteGeoJson } from "../../src/features/game/clearRoute";

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

  it.each([-1, 1] as const)("allows step(%s) from a natural done notification without overwriting the seek", (delta) => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    let doneNotifications = 0;
    store.subscribe(() => {
      if (store.getSnapshot().phase !== "done") return;
      doneNotifications += 1;
      store.step(delta);
    });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(1_100);

    expect(doneNotifications).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    expect(scheduler.liveFrameCount).toBe(0);
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
    store.seek(0);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    store.step(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
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
    expect(store.getUiSnapshot()).toEqual({ phase: "playing", recordIndex: 1, turnCount: 2, cardExpanded: false, seekRevision: 0 });
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

  it("reports zero turns and ignores seek and step for an empty timeline", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([]), scheduler });
    const initial = store.getUiSnapshot();

    expect(initial).toMatchObject({ turnCount: 0, seekRevision: 0 });
    expect(resolveReplaySeekIndex(0, 0)).toBeNull();
    expect(resolveReplaySeekIndex(2, Number.NaN)).toBeNull();
    store.seek(0);
    store.step(-1);
    store.step(1);

    expect(store.getUiSnapshot()).toBe(initial);
    expect(store.getSnapshot()).toEqual({ phase: "idle", recordIndex: 0, stepIndex: 0, fraction: 0 });
  });

  it("seeks across empty saved-turn spans", () => {
    const store = createClearReplayStore({ route: route([[0, 0], [0, 0]]) });

    expect(store.getUiSnapshot().turnCount).toBe(2);
    store.seek(1);

    expect(store.getSnapshot()).toEqual({ phase: "paused", recordIndex: 1, stepIndex: 0, fraction: 0 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1, turnCount: 2, seekRevision: 1 });
  });

  it("clamps and truncates finite seek input to real turns", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]) });

    expect(resolveReplaySeekIndex(3, -10)).toBe(0);
    expect(resolveReplaySeekIndex(3, 1.9)).toBe(1);
    expect(resolveReplaySeekIndex(3, 20)).toBe(2);
    store.seek(-10);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    store.seek(20);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 2 });
    expect(store.getUiSnapshot()).toMatchObject({ turnCount: 3, seekRevision: 2 });
  });

  it("ignores non-finite seek input without changing state or revision", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]) });
    store.seek(1);
    const before = store.getSnapshot();
    const uiBefore = store.getUiSnapshot();

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) store.seek(value);

    expect(store.getSnapshot()).toBe(before);
    expect(store.getUiSnapshot()).toBe(uiBefore);
  });

  it("bumps seek revision when explicitly seeking to the current turn", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]) });
    store.seek(0);
    const before = store.getUiSnapshot();
    store.seek(0);

    expect(store.getUiSnapshot()).toMatchObject({ recordIndex: 0, seekRevision: before.seekRevision + 1 });
  });

  it("keeps playback running from a sought turn and publishes its cursor atomically", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    const observed: Array<[number, number]> = [];
    store.subscribe(() => {
      observed.push([store.getSnapshot().recordIndex, store.getUiSnapshot().recordIndex]);
    });
    store.start();
    scheduler.frameAt(0);
    store.seek(2);

    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2, stepIndex: 2, fraction: 0 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2, seekRevision: 1 });
    expect(observed.at(-1)).toEqual([2, 2]);
    scheduler.advance(549);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
    scheduler.advance(1);
    expect(store.getSnapshot().phase).toBe("done");
  });

  it("does not schedule a frame when a seek subscriber pauses playback", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    let pausedInSeek = false;
    store.subscribe(() => {
      if (!pausedInSeek && store.getSnapshot().recordIndex === 1 && store.getSnapshot().phase === "playing") {
        pausedInSeek = true;
        store.pause();
      }
    });
    store.start();
    scheduler.frameAt(0);
    store.seek(1);

    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
    expect(scheduler.liveFrameCount).toBe(0);
  });

  it("keeps only the inner frame when a seek subscriber seeks again", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3], [3, 4]]), scheduler });
    let soughtAgain = false;
    store.subscribe(() => {
      if (!soughtAgain && store.getSnapshot().recordIndex === 1 && store.getSnapshot().phase === "playing") {
        soughtAgain = true;
        store.seek(3);
      }
    });
    store.start();
    scheduler.frameAt(0);
    store.seek(1);

    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 3 });
    expect(scheduler.liveFrameCount).toBe(1);
  });

  it("anchors a playing seek at seek time for the next turn boundary", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    let advancedDuringNotification = false;
    store.subscribe(() => {
      if (!advancedDuringNotification && store.getSnapshot().recordIndex === 1 && store.getSnapshot().phase === "playing") {
        advancedDuringNotification = true;
        scheduler.time += 25;
      }
    });
    store.start();
    scheduler.frameAt(0);
    scheduler.time = 200;
    store.seek(1);

    scheduler.advance(524);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 1 });
    scheduler.advance(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
  });

  it("keeps the seek clock when a start subscriber seeks during the playing notification", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3], [3, 4]]), scheduler });
    let sought = false;
    store.subscribePhase(() => {
      if (!sought && store.getPhase() === "playing") {
        sought = true;
        store.seek(2);
      }
    });
    scheduler.time = 100;
    store.start();

    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
    expect(scheduler.liveFrameCount).toBe(1);
    scheduler.advance(549);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
    scheduler.advance(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 3 });
  });

  it("keeps the seek clock when a resume subscriber seeks during the playing notification", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3], [3, 4]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    store.pause();
    let sought = false;
    store.subscribePhase(() => {
      if (!sought && store.getPhase() === "playing") {
        sought = true;
        store.seek(2);
      }
    });
    scheduler.time = 300;
    store.resume();

    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
    expect(scheduler.liveFrameCount).toBe(1);
    scheduler.advance(549);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
    scheduler.advance(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 3 });
  });

  it("leaves no clock or visibility listener when a start subscriber finishes the replay", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler, visibility });
    let finished = false;
    store.subscribePhase(() => {
      if (!finished && store.getPhase() === "playing") {
        finished = true;
        store.finish();
      }
    });
    store.start();

    expect(store.getPhase()).toBe("done");
    expect(scheduler.liveFrameCount).toBe(0);
    expect(visibility.listenerCount).toBe(0);
  });

  it("leaves no visibility listener when a hidden-start subscriber finishes the replay", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    visibility.hidden = true;
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler, visibility });
    store.subscribePhase(() => {
      if (store.getPhase() === "paused") store.finish();
    });
    store.start();

    expect(store.getPhase()).toBe("done");
    expect(scheduler.liveFrameCount).toBe(0);
    expect(visibility.listenerCount).toBe(0);
  });

  it("reattaches visibility handling after done, seek, and resume", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler, visibility });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(1_100);
    expect(store.getSnapshot().phase).toBe("done");
    expect(visibility.listenerCount).toBe(0);
    store.seek(1);
    store.resume();
    expect(visibility.listenerCount).toBe(1);

    visibility.change(true);

    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
    expect(scheduler.liveFrameCount).toBe(0);
  });

  it("keeps a paused replay paused when seeking", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    store.pause();
    store.seek(1);

    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1, stepIndex: 1, fraction: 0 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1, seekRevision: 1 });
    expect(scheduler.staleCallbacks.size).toBeGreaterThan(0);
  });

  it("moves a completed replay to the selected turn in a paused state", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]) });
    store.finish();
    store.seek(1);

    expect(store.getSnapshot()).toEqual({ phase: "paused", recordIndex: 1, stepIndex: 1, fraction: 0 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1, seekRevision: 1 });
  });

  it.each([-1, 1] as const)("selects the first real turn when stepping %s from done", (delta) => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]) });
    store.finish();
    store.step(delta);

    expect(store.getSnapshot()).toEqual({ phase: "paused", recordIndex: 0, stepIndex: 0, fraction: 0 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0, seekRevision: 1 });
  });

  it("drops a queued frame from before a playing seek", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    store.seek(1);
    const sought = store.getSnapshot();

    scheduler.fireStale(10_000);

    expect(store.getSnapshot()).toEqual(sought);
    expect(store.getSnapshot().phase).toBe("playing");
  });

  it("preserves the sought turn across speed changes and resume", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    store.seek(1);
    store.setSpeed("fast");
    store.resume();
    expect(store.getUiSnapshot().seekRevision).toBe(1);
    scheduler.frameAt(scheduler.time);
    scheduler.advance(249);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 1 });
    scheduler.advance(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", recordIndex: 2 });
  });

  it("does not bump seek revision during playback, pause, resume, speed change, or finish", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.seek(0);
    const revision = store.getUiSnapshot().seekRevision;
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(100);
    store.pause();
    store.setSpeed("fast");
    store.resume();
    scheduler.frameAt(scheduler.time);
    scheduler.advance(500);
    expect(store.getSnapshot().phase).toBe("done");
    store.start();
    store.finish();

    expect(store.getUiSnapshot().seekRevision).toBe(revision);
  });

  it("steps one turn and leaves the seek revision unchanged at either bound", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]) });
    store.seek(0);
    const atFirst = store.getUiSnapshot();
    store.step(-1);
    expect(store.getUiSnapshot()).toBe(atFirst);

    store.step(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
    expect(store.getUiSnapshot().seekRevision).toBe(2);
    store.step(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 2 });
    const atLast = store.getUiSnapshot();
    store.step(1);
    expect(store.getUiSnapshot()).toBe(atLast);
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
