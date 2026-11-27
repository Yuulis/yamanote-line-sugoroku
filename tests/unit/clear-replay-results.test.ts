import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeScheduler, FakeVisibility } from "./support/clearReplayFakes";
import type { StepPath } from "../../src/features/game/animation/movePath";
import {
  createClearReplayStore,
  type ClearReplaySnapshot,
  type ClearReplayUiSnapshot,
} from "../../src/features/game/clearReplayStore";
import type { ClearRoute } from "../../src/features/game/clearResult";

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

afterEach(() => { vi.unstubAllGlobals(); });

describe("clear replay results card", () => {
  it("keeps the card collapsed at ordinary replay start and pause", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler: new FakeScheduler() });

    store.start();
    expect(store.getUiSnapshot()).toMatchObject({ phase: "playing", cardExpanded: false });
    store.pause();
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", cardExpanded: false });
  });

  it("keeps the card collapsed at natural completion with the full route", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    store.start();
    scheduler.frameAt(0);
    scheduler.advance(1_100);

    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "done", recordIndex: 2, cardExpanded: false });
  });

  it("keeps the card collapsed when finish publishes the full route", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler: new FakeScheduler() });
    store.start();
    store.pause();
    store.finish();

    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "done", recordIndex: 2, cardExpanded: false });
  });

  it("shows results from playing in one UI transition and stops replay resources", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler, visibility });
    store.start();
    scheduler.frameAt(0);
    const transitions: ClearReplayUiSnapshot[] = [];
    store.subscribeUi(() => transitions.push(store.getUiSnapshot()));

    store.showResults();

    expect(transitions).toEqual([{
      phase: "done", recordIndex: 2, turnCount: 2, cardExpanded: true, seekRevision: 0,
    }]);
    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
    expect(scheduler.liveFrameCount).toBe(0);
    expect(visibility.listenerCount).toBe(0);
  });

  it("shows results from paused and done states", () => {
    const pausedStore = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler: new FakeScheduler() });
    pausedStore.start();
    pausedStore.pause();
    pausedStore.showResults();
    expect(pausedStore.getUiSnapshot()).toMatchObject({ phase: "done", recordIndex: 2, cardExpanded: true });
    expect(pausedStore.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });

    const doneStore = createClearReplayStore({ route: route([[0, 1], [1, 2]]) });
    doneStore.finish();
    doneStore.showResults();
    expect(doneStore.getUiSnapshot()).toMatchObject({ phase: "done", recordIndex: 2, cardExpanded: true });
    expect(doneStore.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
  });

  it("does not notify when results are already expanded", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]) });
    store.finish();
    store.showResults();
    const before = store.getUiSnapshot();
    let notifications = 0;
    store.subscribeUi(() => { notifications += 1; });

    store.showResults();

    expect(store.getUiSnapshot()).toBe(before);
    expect(notifications).toBe(0);
  });

  it("collapses results when replay restarts, seeks, or steps", () => {
    const store = createClearReplayStore({
      route: route([[0, 1], [1, 2], [2, 3]]),
      scheduler: new FakeScheduler(),
    });
    store.finish();
    store.showResults();
    store.start();
    expect(store.getUiSnapshot()).toMatchObject({ phase: "playing", recordIndex: 0, cardExpanded: false });

    store.showResults();
    store.seek(1);
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1, cardExpanded: false });
    store.showResults();
    store.step(-1);
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0, cardExpanded: false });
  });

  it("starts reduced-motion replay completed with the card expanded", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), reducedMotion: true });
    store.start();

    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "done", recordIndex: 2, cardExpanded: true });
  });

  it.each(["playing", "paused"] as const)("expands reduced-motion results atomically from %s", (initialPhase) => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler, visibility });
    store.start();
    scheduler.frameAt(0);
    if (initialPhase === "paused") store.pause();
    expect(store.getUiSnapshot().phase).toBe(initialPhase);
    const transitions: ClearReplayUiSnapshot[] = [];
    store.subscribeUi(() => transitions.push(store.getUiSnapshot()));

    store.setReducedMotion(true);

    expect(transitions).toEqual([{
      phase: "done", recordIndex: 2, turnCount: 2, cardExpanded: true, seekRevision: 0,
    }]);
    expect(store.getSnapshot()).toEqual({ phase: "done", recordIndex: 2, stepIndex: 2, fraction: 1 });
    expect(scheduler.liveFrameCount).toBe(0);
    expect(visibility.listenerCount).toBe(0);
  });

  it("keeps a seek made by a subscriber during showResults notification", () => {
    const scheduler = new FakeScheduler();
    const visibility = new FakeVisibility();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler, visibility });
    store.subscribeUi(() => {
      const ui = store.getUiSnapshot();
      if (ui.phase === "done" && ui.cardExpanded) store.seek(1);
    });
    store.start();

    store.showResults();

    expect(store.getUiSnapshot()).toMatchObject({
      phase: "paused", recordIndex: 1, cardExpanded: false, seekRevision: 1,
    });
    expect(scheduler.liveFrameCount).toBe(0);
    expect(visibility.listenerCount).toBe(0);
  });

  it("keeps reduced-motion results expanded when seeking", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), reducedMotion: true });
    store.start();

    store.seek(1);

    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 1, cardExpanded: true, seekRevision: 1 });
  });

  it("keeps reduced-motion results expanded when stepping from done", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), reducedMotion: true });
    store.start();

    store.step(-1);

    expect(store.getSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "paused", recordIndex: 0, cardExpanded: true, seekRevision: 1 });
  });

  it("does not notify when finish is called on expanded done results", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), reducedMotion: true });
    store.start();
    const before = store.getUiSnapshot();
    let notifications = 0;
    store.subscribeUi(() => { notifications += 1; });

    store.finish();

    expect(store.getUiSnapshot()).toBe(before);
    expect(notifications).toBe(0);
  });

  it("expands the card when finish newly completes a reduced-motion store", () => {
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]) });
    store.setReducedMotion(true);

    store.finish();

    expect(store.getSnapshot()).toMatchObject({ phase: "done", recordIndex: 2 });
    expect(store.getUiSnapshot()).toMatchObject({ phase: "done", recordIndex: 2, cardExpanded: true });
  });

  it("delivers only the newest state after a frame subscriber seeks during showResults", () => {
    const store = createClearReplayStore({
      route: route([[0, 1], [1, 2], [2, 3]]),
      scheduler: new FakeScheduler(),
    });
    store.start();
    store.pause();
    let sought = false;
    const observed: Array<{ ui: ClearReplayUiSnapshot; frame: ClearReplaySnapshot }> = [];
    store.subscribe(() => {
      if (!sought && store.getSnapshot().phase === "done") {
        sought = true;
        store.seek(0);
      }
    });
    store.subscribeUi(() => observed.push({ ui: store.getUiSnapshot(), frame: store.getSnapshot() }));

    store.showResults();

    expect(observed).toEqual([{
      ui: { phase: "paused", recordIndex: 0, turnCount: 3, cardExpanded: false, seekRevision: 1 },
      frame: { phase: "paused", recordIndex: 0, stepIndex: 0, fraction: 0 },
    }]);
  });

  it("publishes the done frame snapshot before notifying the results UI subscriber", () => {
    const store = createClearReplayStore({
      route: route([[0, 1], [1, 2], [2, 3]]),
      scheduler: new FakeScheduler(),
    });
    store.start();
    store.pause();
    const observed: Array<{ ui: ClearReplayUiSnapshot; frame: ClearReplaySnapshot }> = [];
    store.subscribeUi(() => observed.push({ ui: store.getUiSnapshot(), frame: store.getSnapshot() }));

    store.showResults();

    expect(observed).toEqual([{
      ui: { phase: "done", recordIndex: 3, turnCount: 3, cardExpanded: true, seekRevision: 0 },
      frame: { phase: "done", recordIndex: 3, stepIndex: 3, fraction: 1 },
    }]);
  });

  it("resets card expansion when changing route or disposing", () => {
    const changedStore = createClearReplayStore({ route: route([[0, 1]]) });
    changedStore.finish();
    changedStore.showResults();
    changedStore.setRoute(null);
    expect(changedStore.getUiSnapshot()).toMatchObject({ phase: "idle", cardExpanded: false });

    const disposedStore = createClearReplayStore({ route: route([[0, 1]]) });
    disposedStore.finish();
    disposedStore.showResults();
    disposedStore.dispose();
    expect(disposedStore.getUiSnapshot()).toMatchObject({ phase: "idle", cardExpanded: false });
  });

  it("does not restart playback from a subscriber during the dispose notification", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1]]), scheduler });
    store.finish();
    store.showResults();
    let attemptedStart = false;
    store.subscribeUi(() => {
      if (!attemptedStart && store.getUiSnapshot().phase === "idle") {
        attemptedStart = true;
        store.start();
      }
    });

    store.dispose();

    expect(attemptedStart).toBe(true);
    expect(store.getPhase()).toBe("idle");
    expect(scheduler.liveFrameCount).toBe(0);
  });

  it("still tells phase subscribers about playing when a start frame subscriber seeks", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    let sought = false;
    store.subscribe(() => {
      if (!sought && store.getSnapshot().phase === "playing") {
        sought = true;
        store.seek(1);
      }
    });
    const phases: string[] = [];
    store.subscribePhase(() => phases.push(store.getPhase()));
    const uiSeen: ClearReplayUiSnapshot[] = [];
    store.subscribeUi(() => uiSeen.push(store.getUiSnapshot()));

    store.start();

    expect(phases).toEqual(["playing"]);
    expect(uiSeen).toEqual([
      { phase: "playing", recordIndex: 1, turnCount: 3, cardExpanded: false, seekRevision: 1 },
    ]);
    expect(scheduler.liveFrameCount).toBe(1);
  });

  it("delivers done to every group when a finish frame subscriber shows results", () => {
    const store = createClearReplayStore({
      route: route([[0, 1], [1, 2]]),
      scheduler: new FakeScheduler(),
    });
    store.start();
    let shown = false;
    store.subscribe(() => {
      if (!shown && store.getSnapshot().phase === "done") {
        shown = true;
        store.showResults();
      }
    });
    const laterFrames: string[] = [];
    store.subscribe(() => laterFrames.push(store.getSnapshot().phase));
    const phases: string[] = [];
    store.subscribePhase(() => phases.push(store.getPhase()));
    const uiSeen: ClearReplayUiSnapshot[] = [];
    store.subscribeUi(() => uiSeen.push(store.getUiSnapshot()));

    store.finish();

    expect(laterFrames).toEqual(["done"]);
    expect(phases).toEqual(["done"]);
    expect(uiSeen).toEqual([
      { phase: "done", recordIndex: 2, turnCount: 2, cardExpanded: true, seekRevision: 0 },
    ]);
  });

  it("delivers the final phase to a later listener when the phase returns to its earlier value", () => {
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2], [2, 3]]), scheduler });
    let resumed = false;
    store.subscribe(() => {
      if (!resumed && store.getPhase() === "paused") {
        resumed = true;
        store.resume();
      }
    });
    let paused = false;
    store.subscribePhase(() => {
      if (!paused && store.getPhase() === "playing") {
        paused = true;
        store.pause();
      }
    });
    const laterPhases: string[] = [];
    store.subscribePhase(() => laterPhases.push(store.getPhase()));

    store.start();

    expect(store.getPhase()).toBe("playing");
    expect(laterPhases.at(-1)).toBe("playing");
    expect(new Set(laterPhases).size).toBe(laterPhases.length);
    expect(scheduler.liveFrameCount).toBe(1);
  });

  it("delivers idle to phase listeners when a frame subscriber disposes during finish", () => {
    const store = createClearReplayStore({
      route: route([[0, 1], [1, 2]]),
      scheduler: new FakeScheduler(),
    });
    store.start();
    store.subscribe(() => {
      if (store.getPhase() === "done") store.dispose();
    });
    const phases: string[] = [];
    store.subscribePhase(() => phases.push(store.getPhase()));

    store.finish();

    expect(phases.at(-1)).toBe("idle");
    store.start();
    expect(phases.at(-1)).toBe("idle");
  });

  it("keeps notifying and starts the clock when a subscriber throws", () => {
    const reported: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => {
      try { callback(); } catch (error) { reported.push(error); }
    });
    const scheduler = new FakeScheduler();
    const store = createClearReplayStore({ route: route([[0, 1], [1, 2]]), scheduler });
    const failure = new Error("listener failed");
    store.subscribe(() => { throw failure; });
    const phases: string[] = [];
    store.subscribePhase(() => phases.push(store.getPhase()));

    store.start();

    expect(reported).toEqual([failure]);
    expect(phases).toEqual(["playing"]);
    expect(scheduler.liveFrameCount).toBe(1);
  });

  it("does not repeat a value to a listener that resubscribes during its callback", () => {
    const store = createClearReplayStore({
      route: route([[0, 1], [1, 2]]),
      scheduler: new FakeScheduler(),
    });
    let calls = 0;
    let unsubscribe = (): void => {};
    const listener = (): void => {
      calls += 1;
      unsubscribe();
      unsubscribe = store.subscribePhase(listener);
    };
    unsubscribe = store.subscribePhase(listener);

    store.start();

    expect(calls).toBe(1);
    store.pause();
    expect(calls).toBe(2);
  });
});
