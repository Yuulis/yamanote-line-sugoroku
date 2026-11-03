// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountReact } from "./helpers/reactDom";
import {
  revealReducer,
  useRevealSequence,
  type RevealAction,
  type RevealObservation,
  type RevealSequence,
  type RevealStage,
  type RevealState,
} from "../../src/features/game/animation/useRevealSequence";

const INITIAL: RevealState = {
  sessionId: null,
  baselineTurn: 0,
  key: null,
  stageIndex: 0,
  movementComplete: false,
  done: true,
};

const OBSERVATION: RevealObservation = {
  sessionId: 1,
  recordTurn: 2,
  gameTurn: 1,
  pendingDecisionTurn: null,
  movementComplete: true,
};

const STAGES: readonly RevealStage[] = [
  { key: "first", durationMs: 100 },
  { key: "second", durationMs: 200 },
];

interface HarnessProps {
  observation: RevealObservation;
  stages: readonly RevealStage[];
  reducedMotion: boolean;
  onChange: (sequence: RevealSequence) => void;
  onCommit: (sequence: RevealSequence) => void;
}

function Harness({ observation, stages, reducedMotion, onChange, onCommit }: HarnessProps) {
  const sequence = useRevealSequence({ observation, stages, reducedMotion });
  onChange(sequence);
  // Records only committed values, so a value React discarded is never seen.
  useLayoutEffect(() => onCommit(sequence));
  return createElement("output", null, `${sequence.stage}:${sequence.ready}`);
}

function mountHarness(
  observation: RevealObservation,
  stages: readonly RevealStage[],
  reducedMotion = false,
) {
  let latest: RevealSequence | null = null;
  const commits: RevealSequence[] = [];
  const onChange = (sequence: RevealSequence) => { latest = sequence; };
  const onCommit = (sequence: RevealSequence) => { commits.push(sequence); };
  const mount = mountReact(createElement(Harness, { observation, stages, reducedMotion, onChange, onCommit }));
  const update = (nextObservation: RevealObservation, nextStages: readonly RevealStage[], nextReducedMotion: boolean) => {
    act(() => mount.root.render(createElement(Harness, {
      observation: nextObservation,
      stages: nextStages,
      reducedMotion: nextReducedMotion,
      onChange,
      onCommit,
    })));
  };
  return { mount, update, commits, get sequence(): RevealSequence { return latest!; } };
}

function mountFreshHarness(
  observation: RevealObservation,
  stages: readonly RevealStage[],
  reducedMotion = false,
) {
  const entry = withObservation({
    sessionId: observation.sessionId,
    recordTurn: null,
    gameTurn: observation.gameTurn,
    pendingDecisionTurn: null,
    movementComplete: false,
  });
  const harness = mountHarness(entry, stages, reducedMotion);
  harness.update(observation, stages, reducedMotion);
  return harness;
}

function withObservation(changes: Partial<RevealObservation>): RevealObservation {
  return { ...OBSERVATION, ...changes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("revealReducer", () => {
  it.each([
    {
      name: "captures a session baseline and treats its existing record as done",
      state: INITIAL,
      action: { type: "observe", observation: withObservation({ gameTurn: 4, recordTurn: 3, pendingDecisionTurn: 5 }), stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 5, key: "1:3", movementComplete: true, done: true },
    },
    {
      name: "arms a new record above the baseline",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 1 },
      action: { type: "observe", observation: OBSERVATION, stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: true, done: false },
    },
    {
      name: "does not replay a duplicate observation",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", stageIndex: 1, movementComplete: true, done: false },
      action: { type: "observe", observation: OBSERVATION, stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", stageIndex: 1, movementComplete: true, done: false },
    },
    {
      name: "ignores an advance for a stale key or stage index",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: true, done: false },
      action: { type: "advance", key: "1:1", stageIndex: 0, stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: true, done: false },
    },
    {
      name: "ignores an advance for the right key but a stale stage index",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", stageIndex: 1, movementComplete: true, done: false },
      action: { type: "advance", key: "1:2", stageIndex: 0, stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", stageIndex: 1, movementComplete: true, done: false },
    },
    {
      name: "ignores an advance before movement completes",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: false, done: false },
      action: { type: "advance", key: "1:2", stageIndex: 0, stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: false, done: false },
    },
    {
      name: "marks the final stage done and ignores later advances",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", stageIndex: 1, movementComplete: true, done: false },
      action: { type: "advance", key: "1:2", stageIndex: 1, stageCount: 2 } as RevealAction,
      expected: { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", stageIndex: 2, movementComplete: true, done: true },
    },
    {
      name: "resets to the initial state",
      state: { ...INITIAL, sessionId: 1, baselineTurn: 4, key: "1:4", movementComplete: true },
      action: { type: "reset" } as RevealAction,
      expected: INITIAL,
    },
  ])("$name", ({ state, action, expected }) => {
    expect(revealReducer(state, action)).toEqual(expected);
  });

  it("returns the same state object for a duplicate observation", () => {
    const armed: RevealState = { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: true, done: false };
    expect(revealReducer(armed, { type: "observe", observation: OBSERVATION, stageCount: 2 })).toBe(armed);
  });

  it("handles skip idempotently and movement completion only for the active key", () => {
    const armed = { ...INITIAL, sessionId: 1, baselineTurn: 1, key: "1:2", movementComplete: false, done: false };
    const skipped = revealReducer(armed, { type: "skip", key: "1:2" });
    expect(skipped).toMatchObject({ done: true, movementComplete: false });
    expect(revealReducer(skipped, { type: "skip", key: "1:2" })).toBe(skipped);
    expect(revealReducer(armed, { type: "movementComplete", key: "1:1" })).toBe(armed);
    expect(revealReducer(armed, { type: "movementComplete", key: "1:2" })).toMatchObject({ movementComplete: true });
  });
});

describe("useRevealSequence", () => {
  it("keeps empty stages ready after movement with no timers", () => {
    vi.useFakeTimers();
    const harness = mountHarness(OBSERVATION, []);
    expect(harness.sequence).toMatchObject({ key: "1:2", stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("runs each stage for its duration then becomes ready", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    expect(harness.sequence).toMatchObject({ stage: "first", busy: true, ready: false });
    act(() => vi.advanceTimersByTime(100));
    expect(harness.sequence.stage).toBe("second");
    act(() => vi.advanceTimersByTime(199));
    expect(harness.sequence.ready).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("waits for movement, then advances; skip while armed completes the key", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(withObservation({ movementComplete: false }), STAGES);
    expect(harness.sequence).toMatchObject({ stage: "waiting", busy: true, ready: false });
    expect(vi.getTimerCount()).toBe(0);
    act(() => harness.sequence.skip());
    expect(harness.sequence.busy).toBe(false);
    harness.update(OBSERVATION, STAGES, false);
    expect(harness.sequence.ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("skip during a stage cancels its timer and repeated skip is harmless", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    act(() => harness.sequence.skip());
    act(() => harness.sequence.skip());
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("finishes immediately when reduced motion turns on", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    harness.update(OBSERVATION, STAGES, true);
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("completes a key when reduced motion turns on while movement is still running", () => {
    vi.useFakeTimers();
    const moving = withObservation({ movementComplete: false });
    const harness = mountFreshHarness(moving, STAGES);
    expect(harness.sequence).toMatchObject({ stage: "waiting", busy: true });
    harness.update(moving, STAGES, true);
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: false });
    harness.update(moving, STAGES, false);
    harness.update(OBSERVATION, STAGES, false);
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("does not replay a completed key after duplicate observations or stage identity changes", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    act(() => vi.advanceTimersByTime(100));
    act(() => vi.advanceTimersByTime(200));
    const replacementStages = STAGES.map((stage) => ({ ...stage }));
    harness.update(OBSERVATION, replacementStages, false);
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("keeps the active stage's deadline when only the stage-array identity changes", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    act(() => vi.advanceTimersByTime(90));
    harness.update(OBSERVATION, STAGES.map((stage) => ({ ...stage })), false);
    expect(harness.sequence.stage).toBe("first");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(10));
    expect(harness.sequence.stage).toBe("second");
    harness.mount.cleanup();
  });

  it("commits consistent values from the first commit of a key", () => {
    vi.useFakeTimers();
    const resumed = mountHarness(withObservation({ gameTurn: 9, recordTurn: 9 }), []);
    expect(resumed.commits).toHaveLength(1);
    expect(resumed.commits[0]).toMatchObject({ key: "1:9", stage: "done", busy: false, ready: true });
    resumed.update(withObservation({ gameTurn: 10, recordTurn: 10, movementComplete: false }), STAGES, false);
    const firstOfNewKey = resumed.commits[1];
    expect(firstOfNewKey).toMatchObject({ key: "1:10", stage: "waiting", busy: true, ready: false });
    act(() => firstOfNewKey!.skip());
    expect(resumed.sequence).toMatchObject({ key: "1:10", busy: false, ready: false });
    resumed.update(withObservation({ gameTurn: 10, recordTurn: 10 }), STAGES, false);
    expect(resumed.sequence).toMatchObject({ stage: "done", busy: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    resumed.mount.cleanup();
  });

  it("uses record turn rather than game turn and starts resumed records at baseline done", () => {
    vi.useFakeTimers();
    const resumed = mountHarness(withObservation({ gameTurn: 12, recordTurn: 9 }), STAGES);
    expect(resumed.sequence).toMatchObject({ key: "1:9", stage: "done", busy: false, ready: true });
    resumed.mount.cleanup();
    const fresh = mountFreshHarness(withObservation({ gameTurn: 8, recordTurn: 9 }), STAGES);
    expect(fresh.sequence.key).toBe("1:9");
    expect(fresh.sequence.stage).toBe("first");
    fresh.mount.cleanup();
  });

  it.each([
    ["idle", withObservation({ recordTurn: null, gameTurn: 6 })],
    ["pending roll resume", withObservation({ recordTurn: null, gameTurn: 6, movementComplete: false })],
    ["pending discard resume", withObservation({ recordTurn: 6, gameTurn: 6, pendingDecisionTurn: 7 })],
  ])("starts a resumed %s at the baseline", (_label, observation) => {
    vi.useFakeTimers();
    const harness = mountHarness(observation, STAGES);
    expect(harness.sequence).toMatchObject({ stage: "done", busy: false, ready: observation.movementComplete });
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("clears the old timer on record or session change and ignores stale advances", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    act(() => vi.advanceTimersByTime(90));
    harness.update(withObservation({ recordTurn: 3, gameTurn: 3 }), STAGES, false);
    expect(harness.sequence).toMatchObject({ key: "1:3", stage: "first", busy: true });
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(10));
    expect(harness.sequence.stage).toBe("first");
    act(() => vi.advanceTimersByTime(90));
    expect(harness.sequence.stage).toBe("second");
    harness.update(withObservation({ sessionId: 2, recordTurn: 1, gameTurn: 1 }), STAGES, false);
    expect(harness.sequence.key).toBe("2:1");
    expect(harness.sequence.stage).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("clears an active timer on unmount", () => {
    vi.useFakeTimers();
    const harness = mountFreshHarness(OBSERVATION, STAGES);
    expect(vi.getTimerCount()).toBe(1);
    harness.mount.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
