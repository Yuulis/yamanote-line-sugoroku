// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MoveAnimation } from "../../src/features/game/gameSession";
import type { ItemSessionView } from "../../src/features/game/itemSession";
import { useTurnMoments, type TurnMoments, type UseTurnMomentsOptions } from "../../src/features/game/animation/useTurnMoments";
import type { TurnMomentObservation, TurnOrigin } from "../../src/features/game/animation/turnMoments";
import type { ItemRideRecord } from "../../src/types/network";
import { buildRailwayNetwork, createGame, moveByRoll } from "../../src/features/game/engine";
import { useMoveAnimation } from "../../src/features/game/animation/useMoveAnimation";
import { buildGeometryIndex } from "../../src/features/game/animation/movePath";
import { mountReact } from "./helpers/reactDom";
import { DEFAULT_CONFIG, yamanoteInput } from "./fixtures/yamanote";

const VIEW = {
  phase: "idle", identity: { sessionId: 7, turn: 0, decisionRevision: 3 }, inventory: [],
  position: { currentStationId: "shimbashi", currentServiceId: "jr-yamanote", direction: 1 },
  draft: { items: [] }, usableItems: [],
  hints: { routes: [], direction: { directions: [], closerDirection: null }, rapidHeadsTowardYamanote: false,
    deadheadDestination: null, deadheadRecommended: false, suspensionIgnored: false, suspendedServiceIds: [] },
  decision: null, effects: { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false }, events: [],
} as unknown as ItemSessionView;
const ORIGIN: TurnOrigin = {
  stationId: "shimbashi", ride: { serviceId: "jr-yamanote", direction: 1 }, completedSegmentIds: [], turn: 0,
  itemView: VIEW, previousLastMove: null,
};
const RECORD: ItemRideRecord = {
  kind: "item-ride", turn: 1, fromStationId: "shimbashi", toStationId: "yoyogi", command: { items: [] },
  traversedSegmentIds: [], landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
  resolvedRide: { serviceId: "jr-yamanote", direction: 1 }, rawRoll: 4, effectiveFace: 4, adjustment: null,
  movementMode: "normal", pips: 4, hopBudget: 4, physicalHops: 4, unusedPips: 0, stopReason: "roll",
};
const INITIAL_OBSERVATION: TurnMomentObservation = {
  decision: null, record: null, movementEvents: [], targetServiceId: "jr-yamanote",
};
const ARRIVAL = [{ key: "arrival", durationMs: 800 }] as const;
const NETWORK = buildRailwayNetwork(yamanoteInput());
const GAME = createGame(DEFAULT_CONFIG, "turn-moments-lifecycle", NETWORK);
const MOVE: MoveAnimation = {
  sessionId: 7, turn: 1, decisionRevision: 3, fromStationId: GAME.currentStationId,
  events: moveByRoll(GAME, 1, NETWORK).events,
};
const GEOMETRY = buildGeometryIndex(undefined);

interface HarnessProps {
  options: UseTurnMomentsOptions;
  onCommit: (moments: TurnMoments) => void;
}

function Harness({ options, onCommit }: HarnessProps) {
  const moments = useTurnMoments(options);
  useLayoutEffect(() => onCommit(moments));
  return createElement("output", null, `${moments.attempt?.stage ?? "none"}:${moments.revealStage}`);
}

function options(changes: Partial<UseTurnMomentsOptions> = {}): UseTurnMomentsOptions {
  return {
    sessionId: 7, gameTurn: 0, decisionRevision: 3, origin: ORIGIN, stepMs: 450, reducedMotion: false,
    observation: INITIAL_OBSERVATION,
    revealObservation: { sessionId: 7, recordTurn: null, gameTurn: 0, pendingDecisionTurn: null, movementComplete: false },
    revealStages: ARRIVAL, animation: null, finishAnimation: vi.fn(), ...changes,
  };
}

function mountHarness(initial: UseTurnMomentsOptions = options()) {
  let latest: TurnMoments | null = null;
  const commits: TurnMoments[] = [];
  const onCommit = (moments: TurnMoments) => { latest = moments; commits.push(moments); };
  let current = initial;
  const mount = mountReact(createElement(Harness, { options: current, onCommit }));
  const update = (changes: Partial<UseTurnMomentsOptions>) => {
    current = { ...current, ...changes };
    act(() => mount.root.render(createElement(Harness, { options: current, onCommit })));
  };
  return { mount, update, commits, get moments(): TurnMoments { return latest!; } };
}

function acceptedRecordObservation(): TurnMomentObservation {
  return { ...INITIAL_OBSERVATION, record: RECORD, movementSessionId: 7, movementTurn: 1 };
}

afterEach(() => vi.useRealTimers());

describe("useTurnMoments", () => {
  it("arms only the current pre-move stage timer and cleans each transition", () => {
    vi.useFakeTimers();
    const harness = mountHarness();
    act(() => harness.moments.begin());
    harness.update({ observation: { ...INITIAL_OBSERVATION,
      decision: { kind: "adjust", turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
        allowedDeltas: [-1, 1], itemInstanceIds: ["adjust"], canContinue: true },
    } });
    expect(harness.moments.attempt?.stage).toBe("tumble");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(600));
    expect(harness.moments.attempt?.stage).toBe("awaiting-adjust");
    expect(vi.getTimerCount()).toBe(0);

    const modifierRecord: ItemRideRecord = { ...RECORD, command: { items: [{ kind: "double", instanceId: "double" }] } };
    harness.update({ observation: { ...acceptedRecordObservation(), record: modifierRecord } });
    expect(harness.moments.attempt?.stage).toBe("stamps");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(240));
    expect(harness.moments.attempt?.stage).toBe("released");
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the tumble deadline when equivalent same-turn facts are appended", () => {
    vi.useFakeTimers();
    const harness = mountHarness();
    act(() => harness.moments.begin());
    const decision = { kind: "adjust" as const, turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1] as const, itemInstanceIds: ["adjust"], canContinue: true as const };
    harness.update({ observation: { ...INITIAL_OBSERVATION, decision } });
    act(() => vi.advanceTimersByTime(250));
    harness.update({ observation: { ...INITIAL_OBSERVATION, decision, movementEvents: [] } });
    expect(harness.moments.attempt?.stage).toBe("tumble");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(349));
    expect(harness.moments.attempt?.stage).toBe("tumble");
    act(() => vi.advanceTimersByTime(1));
    expect(harness.moments.attempt?.stage).toBe("awaiting-adjust");
    harness.mount.cleanup();
  });

  it("holds the accepted timing and current-stage deadline across appended record events", () => {
    vi.useFakeTimers();
    const harness = mountHarness();
    act(() => harness.moments.begin());
    const decision = { kind: "adjust" as const, turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1] as const, itemInstanceIds: ["adjust"], canContinue: true as const };
    harness.update({ stepMs: 300, observation: { ...INITIAL_OBSERVATION, decision } });
    expect(harness.moments.attempt?.timing.stepMs).toBe(450);
    act(() => vi.advanceTimersByTime(600));
    expect(harness.moments.attempt?.stage).toBe("awaiting-adjust");
    const modifierRecord: ItemRideRecord = { ...RECORD, command: { items: [{ kind: "double", instanceId: "double" }] } };
    harness.update({ observation: { ...acceptedRecordObservation(), record: modifierRecord } });
    expect(harness.moments.attempt?.stage).toBe("stamps");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(100));
    const appendedRecord: ItemRideRecord = { ...modifierRecord, itemEvents: [...modifierRecord.itemEvents, { type: "effect-activated", effect: "delay" }] as ItemRideRecord["itemEvents"] };
    harness.update({ observation: { ...acceptedRecordObservation(), record: appendedRecord } });
    expect(harness.moments.attempt?.stage).toBe("stamps");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(139));
    expect(harness.moments.attempt?.stage).toBe("stamps");
    act(() => vi.advanceTimersByTime(1));
    expect(harness.moments.attempt?.stage).toBe("released");
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("cancels an active stage on key change, Skip, session replacement, and unmount", () => {
    vi.useFakeTimers();
    const harness = mountHarness();
    act(() => harness.moments.begin());
    harness.update({ observation: { ...INITIAL_OBSERVATION, decision: {
      kind: "adjust", turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1], itemInstanceIds: ["adjust"], canContinue: true,
    } } });
    expect(harness.moments.attempt?.stage).toBe("tumble");
    expect(vi.getTimerCount()).toBe(1);
    act(() => harness.moments.skip());
    expect(harness.moments.attempt?.stage).toBe("released");
    expect(vi.getTimerCount()).toBe(0);
    harness.update({ decisionRevision: 4 });
    act(() => harness.moments.begin());
    expect(harness.moments.attempt?.key).toBe("7:roll:1:4");
    harness.update({ observation: { ...INITIAL_OBSERVATION, decision: {
      kind: "adjust", turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1], itemInstanceIds: ["adjust"], canContinue: true,
    } } });
    expect(harness.moments.attempt?.stage).toBe("tumble");
    expect(vi.getTimerCount()).toBe(1);
    harness.update({ sessionId: 8, revealObservation: { sessionId: 8, recordTurn: null, gameTurn: 0, pendingDecisionTurn: null, movementComplete: false } });
    expect(harness.moments.attempt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => harness.moments.begin());
    harness.update({ observation: { ...INITIAL_OBSERVATION, decision: {
      kind: "adjust", turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1], itemInstanceIds: ["adjust"], canContinue: true,
    } } });
    expect(harness.moments.attempt?.stage).toBe("tumble");
    expect(vi.getTimerCount()).toBe(1);
    harness.mount.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels active reveal timers on key change, Skip, session replacement, and unmount", () => {
    vi.useFakeTimers();
    const harness = mountHarness(options({ revealObservation: {
      sessionId: 7, recordTurn: null, gameTurn: 1, pendingDecisionTurn: null, movementComplete: false,
    } }));
    harness.update({ revealObservation: {
      sessionId: 7, recordTurn: 2, gameTurn: 1, pendingDecisionTurn: null, movementComplete: true,
    } });
    expect(harness.moments.revealStage).toBe("arrival");
    expect(harness.moments.reveal.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(400));
    harness.update({ revealObservation: {
      sessionId: 7, recordTurn: 3, gameTurn: 2, pendingDecisionTurn: null, movementComplete: true,
    } });
    expect(harness.moments.revealStage).toBe("arrival");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(400));
    expect(harness.moments.revealStage).toBe("arrival");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(400));
    expect(harness.moments.revealStage).toBe("done");
    expect(harness.moments.reveal.ready).toBe(true);

    harness.update({ revealObservation: {
      sessionId: 7, recordTurn: 4, gameTurn: 3, pendingDecisionTurn: null, movementComplete: true,
    } });
    expect(harness.moments.revealStage).toBe("arrival");
    expect(vi.getTimerCount()).toBe(1);
    act(() => harness.moments.skip());
    expect(harness.moments.revealStage).toBe("done");
    expect(harness.moments.reveal.ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    harness.update({ revealObservation: {
      sessionId: 7, recordTurn: 5, gameTurn: 4, pendingDecisionTurn: null, movementComplete: true,
    } });
    expect(vi.getTimerCount()).toBe(1);
    harness.update({ sessionId: 8, revealObservation: {
      sessionId: 8, recordTurn: null, gameTurn: 0, pendingDecisionTurn: null, movementComplete: false,
    } });
    expect(vi.getTimerCount()).toBe(0);
    harness.update({ revealObservation: {
      sessionId: 8, recordTurn: 2, gameTurn: 1, pendingDecisionTurn: null, movementComplete: true,
    } });
    expect(harness.moments.revealStage).toBe("arrival");
    expect(vi.getTimerCount()).toBe(1);
    harness.mount.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("carries Skip across adjustment and save, then finishes the matching move without RAF", () => {
    vi.useFakeTimers();
    const request = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", request);
    const finishAnimation = vi.fn();
    const commits: TurnMoments[] = [];
    const onCommit = (moments: TurnMoments) => commits.push(moments);
    let current = options({ finishAnimation });
    function CombinedHarness({ currentOptions }: { currentOptions: UseTurnMomentsOptions }) {
      const moments = useTurnMoments(currentOptions);
      useMoveAnimation(currentOptions.animation, NETWORK, GEOMETRY, 450,
        currentOptions.finishAnimation, { startAllowed: moments.movementStartAllowed });
      useLayoutEffect(() => { onCommit(moments); });
      return createElement("output", null, moments.revealStage);
    }
    const mount = mountReact(createElement(CombinedHarness, { currentOptions: current }));
    const render = (changes: Partial<UseTurnMomentsOptions>) => {
      current = { ...current, ...changes };
      act(() => mount.root.render(createElement(CombinedHarness, { currentOptions: current })));
    };
    act(() => commits.at(-1)!.begin());
    render({ observation: { ...INITIAL_OBSERVATION, decision: {
      kind: "adjust", turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1], itemInstanceIds: ["adjust"], canContinue: true,
    } } });
    expect(commits.at(-1)?.attempt?.stage).toBe("tumble");
    act(() => commits.at(-1)!.skip());
    expect(commits.at(-1)?.attempt?.skipRequested).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    render({ observation: INITIAL_OBSERVATION });
    expect(commits.at(-1)?.attempt?.skipRequested).toBe(true);
    render({ observation: acceptedRecordObservation(), animation: MOVE });
    expect(commits.at(-1)?.attempt?.stage).toBe("released");
    expect(commits.at(-1)?.movementStartAllowed).toBe(false);
    expect(finishAnimation).toHaveBeenCalledTimes(1);
    expect(finishAnimation).toHaveBeenCalledWith(MOVE);
    expect(request).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);
    render({ revealObservation: { sessionId: 7, recordTurn: 1, gameTurn: 1, pendingDecisionTurn: null, movementComplete: true } });
    expect(commits.at(-1)?.revealStage).toBe("done");
    expect(commits.at(-1)?.reveal.ready).toBe(true);
    mount.cleanup();
  });

  it("finishes a later matching animation once after Skip without starting it", () => {
    vi.useFakeTimers();
    const finishAnimation = vi.fn();
    const animation: MoveAnimation = { sessionId: 7, turn: 1, decisionRevision: 8, fromStationId: "shimbashi", events: [] };
    const harness = mountHarness(options({ finishAnimation }));
    act(() => harness.moments.begin());
    act(() => harness.moments.skip());
    expect(harness.moments.movementStartAllowed).toBe(false);
    harness.update({ animation });
    expect(finishAnimation).toHaveBeenCalledTimes(1);
    expect(finishAnimation).toHaveBeenCalledWith(animation);
    harness.update({ animation: { ...animation } });
    expect(finishAnimation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("ignores a stale animation identity when completing a latched Skip", () => {
    vi.useFakeTimers();
    const finishAnimation = vi.fn();
    const harness = mountHarness(options({ finishAnimation }));
    act(() => harness.moments.begin());
    act(() => harness.moments.skip());
    harness.update({ animation: { sessionId: 6, turn: 1, fromStationId: "shimbashi", events: [] } });
    expect(finishAnimation).not.toHaveBeenCalled();
    harness.mount.cleanup();
  });

  it("omits both sequences irreversibly when reduced motion turns on mid-tumble", () => {
    vi.useFakeTimers();
    const harness = mountHarness();
    act(() => harness.moments.begin());
    const decision = { kind: "adjust" as const, turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1] as const, itemInstanceIds: ["adjust"], canContinue: true as const };
    harness.update({ observation: { ...INITIAL_OBSERVATION, decision } });
    expect(harness.moments.attempt?.stage).toBe("tumble");
    harness.update({ reducedMotion: true, observation: acceptedRecordObservation(),
      revealObservation: { sessionId: 7, recordTurn: 1, gameTurn: 1, pendingDecisionTurn: null, movementComplete: false } });
    expect(harness.moments.attempt?.motionOmitted).toBe(true);
    expect(harness.moments.attempt?.stage).toBe("released");
    expect(harness.moments.movementStartAllowed).toBe(true);
    expect(harness.moments.revealStage).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    harness.update({ reducedMotion: false, revealObservation: { sessionId: 7, recordTurn: 1, gameTurn: 1,
      pendingDecisionTurn: null, movementComplete: true } });
    expect(harness.moments.attempt?.motionOmitted).toBe(true);
    expect(harness.moments.revealStage).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("gives a restored pending adjustment a fresh arrival without replaying tumble", () => {
    vi.useFakeTimers();
    const adjustment = { kind: "adjust" as const, turn: 1, rawRoll: 4, resolvedRide: RECORD.resolvedRide,
      allowedDeltas: [-1, 1] as const, itemInstanceIds: ["adjust"], canContinue: true as const };
    const harness = mountHarness(options({
      observation: { ...INITIAL_OBSERVATION, decision: adjustment },
      revealObservation: { sessionId: 7, recordTurn: null, gameTurn: 0, pendingDecisionTurn: 1, movementComplete: false },
    }));
    act(() => harness.moments.begin("restored-roll"));
    expect(harness.moments.attempt?.stage).toBe("waiting-record");
    expect(vi.getTimerCount()).toBe(0);
    harness.update({ observation: INITIAL_OBSERVATION, revealObservation: {
      sessionId: 7, recordTurn: null, gameTurn: 0, pendingDecisionTurn: 1, movementComplete: false,
    } });
    harness.update({ observation: acceptedRecordObservation(), revealObservation: {
      sessionId: 7, recordTurn: 1, gameTurn: 1, pendingDecisionTurn: null, movementComplete: false,
    } });
    expect(harness.moments.attempt?.stage).toBe("released");
    expect(harness.moments.restoredOrOmitted).toBe(false);
    expect(harness.moments.revealStage).toBe("waiting");
    expect(harness.moments.reveal.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    harness.update({ revealObservation: {
      sessionId: 7, recordTurn: 1, gameTurn: 1, pendingDecisionTurn: null, movementComplete: true,
    } });
    expect(harness.moments.revealStage).toBe("arrival");
    expect(harness.moments.reveal.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(800));
    expect(harness.moments.revealStage).toBe("done");
    expect(harness.moments.reveal.ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
  });

  it("freezes reveal stages by key and resets timers on session replacement", () => {
    vi.useFakeTimers();
    const harness = mountHarness(options({
      revealObservation: { sessionId: 7, recordTurn: 1, gameTurn: 0, pendingDecisionTurn: null, movementComplete: true },
      revealStages: [{ key: "arrival", durationMs: 800 }],
    }));
    // Existing records are treated as restored on the first observation.
    expect(harness.moments.revealStage).toBe("done");
    harness.update({ revealObservation: { sessionId: 7, recordTurn: 2, gameTurn: 1, pendingDecisionTurn: null, movementComplete: true },
      revealStages: [{ key: "arrival", durationMs: 800 }] });
    expect(harness.moments.revealStage).toBe("arrival");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(200));
    harness.update({ revealStages: [{ key: "arrival", durationMs: 100 }] });
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(600));
    expect(harness.moments.revealStage).toBe("done");

    harness.update({ sessionId: 8, gameTurn: 0, decisionRevision: 0,
      revealObservation: { sessionId: 8, recordTurn: null, gameTurn: 0, pendingDecisionTurn: null, movementComplete: false } });
    expect(harness.moments.attempt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    harness.mount.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps callback identities stable while options change", () => {
    vi.useFakeTimers();
    const harness = mountHarness();
    const begin = harness.moments.begin;
    const skip = harness.moments.skip;
    harness.update({ stepMs: 300 });
    expect(harness.moments.begin).toBe(begin);
    expect(harness.moments.skip).toBe(skip);
    harness.mount.cleanup();
  });
});
