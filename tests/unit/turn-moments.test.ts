import { describe, expect, it } from "vitest";
import { ANIMATION_SPEEDS } from "../../src/features/game/gameConfig";
import {
  buildTurnRevealStages,
  INITIAL_TURN_MOMENTS_STATE,
  observeTurnFacts,
  turnMomentTiming,
  turnMomentsReducer,
  type TurnMomentObservation,
  type TurnMomentsAction,
  type TurnOrigin,
  type TurnMomentsState,
} from "../../src/features/game/animation/turnMoments";
import type { ItemSessionView } from "../../src/features/game/itemSession";
import type { ItemDeadheadRecord, ItemEvent, ItemRideRecord } from "../../src/types/network";
import type { MoveEvent } from "../../src/features/game/engine";

const NORMAL_STEP_MS = ANIMATION_SPEEDS.find((speed) => speed.id === "normal")!.stepMs;
const VIEW = {
  phase: "idle", identity: { sessionId: 7, turn: 0, decisionRevision: 3 }, inventory: [],
  position: { currentStationId: "shimbashi", currentServiceId: "jr-yamanote", direction: 1 },
  draft: { items: [] }, usableItems: [],
  hints: { routes: [], direction: { directions: [{ direction: 1, nextStationId: "yoyogi", targetHops: 1 }], closerDirection: 1 },
    rapidHeadsTowardYamanote: false,
    deadheadDestination: { fromStationId: "shimbashi", toStationId: "yoyogi", serviceId: "jr-yamanote", direction: 1, distance: 1 },
    deadheadRecommended: false, suspensionIgnored: false, suspendedServiceIds: [] },
  decision: null, effects: { delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false }, events: [],
} satisfies ItemSessionView;
const ORIGIN: TurnOrigin = {
  stationId: "shimbashi", ride: { serviceId: "jr-yamanote", direction: 1 }, completedSegmentIds: [], turn: 0,
  itemView: VIEW, previousLastMove: null,
};
const DECISION: NonNullable<ItemSessionView["decision"]> & { kind: "adjust" } = {
  kind: "adjust", turn: 1, rawRoll: 4, resolvedRide: { serviceId: "jr-yamanote", direction: 1 },
  allowedDeltas: [-1, 1], itemInstanceIds: ["adjust-a"], canContinue: true,
};

function ride(overrides: Partial<ItemRideRecord> = {}): ItemRideRecord {
  return {
    kind: "item-ride", turn: 1, fromStationId: "shimbashi", toStationId: "yoyogi", command: { items: [] },
    traversedSegmentIds: [], landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: { serviceId: "jr-yamanote", direction: 1 }, rawRoll: 1, effectiveFace: 1, adjustment: null,
    movementMode: "normal", pips: 1, hopBudget: 1, physicalHops: 1, unusedPips: 0, stopReason: "roll", ...overrides,
  };
}

function deadhead(): ItemDeadheadRecord {
  return {
    kind: "deadhead", turn: 1, fromStationId: "shimbashi", toStationId: "yoyogi", command: { items: [] },
    traversedSegmentIds: [], landing: null, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: null, rawRoll: null, effectiveFace: null, adjustment: null, movementMode: "deadhead",
    pips: null, hopBudget: null, physicalHops: 0, unusedPips: null, stopReason: "relocation",
    relocation: { fromStationId: "shimbashi", toStationId: "yoyogi", serviceId: "jr-yamanote", direction: 1, distance: 2 },
  };
}

function start(state: TurnMomentsState = INITIAL_TURN_MOMENTS_STATE,
  changes: Partial<Extract<TurnMomentsAction, { type: "begin" }>> = {}): TurnMomentsState {
  return turnMomentsReducer(state, { type: "begin", sessionId: 7, turn: 0, decisionRevision: 3,
    origin: ORIGIN, timing: turnMomentTiming(NORMAL_STEP_MS), ...changes });
}

function observe(state: TurnMomentsState, changes: Partial<TurnMomentObservation> = {}, sessionId = 7): TurnMomentsState {
  return turnMomentsReducer(state, { type: "observe", sessionId, facts: {
    decision: null, record: null, movementEvents: [], targetServiceId: "jr-yamanote", ...changes,
  } });
}

function recordWithMove(record: ItemRideRecord, events: readonly MoveEvent[] = []): Partial<TurnMomentObservation> {
  return { record, movementEvents: events, movementSessionId: 7, movementTurn: record.turn };
}

const SEGMENT_EVENT: MoveEvent = { type: "segment-traversed", step: 1, serviceId: "jr-yamanote", direction: 1,
  segmentId: "target-segment", fromStationId: "shimbashi", toStationId: "yoyogi", newlyCompleted: true };

describe("turnMomentTiming", () => {
  it.each(ANIMATION_SPEEDS.map(({ id, stepMs }) => [id, stepMs] as const))("scales all moments at %s", (_id, stepMs) => {
    const factor = stepMs / NORMAL_STEP_MS;
    expect(turnMomentTiming(stepMs)).toEqual({ stepMs,
      tumbleMs: Math.round(600 * factor), stampsMs: Math.round(240 * factor), arrivalMs: Math.round(800 * factor),
      lotteryFlipMs: Math.round(1600 * factor), lotterySettleMs: Math.round(400 * factor), pickupMs: Math.round(500 * factor),
    });
  });
});

describe("accepted turn facts", () => {
  it.each([
    ["normal ride", ride(), false],
    ["rapid modifier", ride({ movementMode: "rapid", hopBudget: 2 }), true],
    ["double modifier", ride({ command: { items: [{ kind: "double", instanceId: "double-a" }] } }), true],
    ["adjustment modifier", ride({ adjustment: { instanceId: "adjust-a", delta: 1 } }), true],
    ["effective face modifier", ride({ rawRoll: 4, effectiveFace: 1 }), true],
    ["oversleep stamp without compact modifier", ride({ movementMode: "oversleep" }), true],
  ])("derives stamps for %s using compact-roll modifier rules", (_label, record, expected) => {
    expect(observeTurnFacts({ decision: null, record, movementEvents: [], targetServiceId: "jr-yamanote" }).stampsRequired).toBe(expected);
  });

  it("requires stamps when delay activates even when the raw face is already one", () => {
    const delayed = ride({ itemEvents: [{ type: "effect-activated", effect: "delay" }] });
    expect(observeTurnFacts({ decision: null, record: delayed, movementEvents: [], targetServiceId: "jr-yamanote" }).stampsRequired).toBe(true);
  });

  it("reads only an acknowledged decision or accepted record and matching move segments", () => {
    const facts = observeTurnFacts({ decision: DECISION, record: ride(), movementEvents: [SEGMENT_EVENT],
      movementSessionId: 7, movementTurn: 1, targetServiceId: "jr-yamanote" });
    expect(facts.rawRoll).toBe(4);
    expect(facts.newlyCompletedTargetSegmentIds).toEqual(["target-segment"]);
    expect(observeTurnFacts({ decision: null, record: null, movementEvents: [SEGMENT_EVENT], movementSessionId: 7,
      movementTurn: 1, targetServiceId: "jr-yamanote" }).newlyCompletedTargetSegmentIds).toEqual([]);
  });
});

describe("turnMomentsReducer", () => {
  it("keeps one attempt through adjustment and waits for its accepted record before stamps", () => {
    let state = start();
    expect(state.attempt?.key).toBe("7:roll:1:3");
    state = observe(state, { decision: DECISION });
    expect(state.attempt?.stage).toBe("tumble");
    state = turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "tumble" });
    expect(state.attempt?.stage).toBe("awaiting-adjust");
    const stillOpen = observe(state, { decision: DECISION });
    expect(stillOpen.attempt?.stage).toBe("awaiting-adjust");
    expect(turnMomentsReducer(stillOpen, { type: "advance", key: "7:roll:1:3", expectedStage: "awaiting-adjust" })).toBe(stillOpen);
    state = observe(stillOpen, { record: ride({ rawRoll: 4, adjustment: { instanceId: "adjust-a", delta: 1 }, effectiveFace: 5 }) });
    expect(state.attempt?.stage).toBe("stamps");
    expect(state.attempt?.key).toBe("7:roll:1:3");
    state = turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "stamps" });
    expect(state.attempt?.stage).toBe("released");
  });

  it("completes the full normal path without modifiers directly after tumble", () => {
    let state = observe(start(), { record: ride() });
    expect(state.attempt?.stage).toBe("tumble");
    state = turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "tumble" });
    expect(state.attempt?.stage).toBe("released");
  });

  it("moves from tumble to waiting-record when acknowledgement has not arrived", () => {
    const pending = start();
    const attempt = pending.attempt!;
    let state: TurnMomentsState = { ...pending, attempt: { ...attempt, stage: "tumble", rawRoll: 4 } };
    state = turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "tumble" });
    expect(state.attempt?.stage).toBe("waiting-record");
  });

  it("completes the full modifier path through stamps", () => {
    let state = observe(start(), { record: ride({ command: { items: [{ kind: "double", instanceId: "double-a" }] } }) });
    state = turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "tumble" });
    expect(state.attempt?.stage).toBe("stamps");
    state = turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "stamps" });
    expect(state.attempt?.stage).toBe("released");
  });

  it("rejects a wrong key and the right key with a wrong expected stage by identity", () => {
    const state = start();
    expect(turnMomentsReducer(state, { type: "advance", key: "wrong", expectedStage: "waiting-roll" })).toBe(state);
    expect(turnMomentsReducer(state, { type: "advance", key: "7:roll:1:3", expectedStage: "tumble" })).toBe(state);
  });

  it("returns the same state for a duplicate observation after a real change", () => {
    const changed = observe(start(), { decision: DECISION });
    expect(observe(changed, { decision: DECISION })).toBe(changed);
  });

  it("ignores stale turn records, decisions, and movement segment events", () => {
    const state = start();
    const staleDecision = { ...DECISION, turn: 0 };
    expect(observe(state, { decision: staleDecision })).toBe(state);
    const foreignRide = ride({ turn: 0 });
    expect(observe(state, recordWithMove(foreignRide, [SEGMENT_EVENT]))).toBe(state);
    const foreignDeadhead = { ...deadhead(), turn: 0 };
    expect(observe(state, { record: foreignDeadhead })).toBe(state);
    const accepted = observe(state, { record: ride() });
    expect(observe(accepted, { record: ride(), movementEvents: [SEGMENT_EVENT], movementSessionId: 6, movementTurn: 1 })).toBe(accepted);
    expect(observe(accepted, { record: ride(), movementEvents: [SEGMENT_EVENT], movementSessionId: 7, movementTurn: 0 })).toBe(accepted);
  });

  it.each([
    ["before acknowledgement", false],
    ["before record creation", true],
  ])("latches Skip %s until later facts arrive", (_point, acknowledged) => {
    let state = start();
    if (acknowledged) state = observe(state, { decision: DECISION });
    state = turnMomentsReducer(state, { type: "skip", key: "7:roll:1:3" });
    expect(state.attempt?.skipRequested).toBe(true);
    state = observe(state, { decision: DECISION });
    state = observe(state, recordWithMove(ride(), [SEGMENT_EVENT]));
    expect(state.attempt?.skipRequested).toBe(true);
    expect(state.attempt?.recordAccepted).toBe(true);
    expect(state.attempt?.newlyCompletedTargetSegmentIds).toEqual(["target-segment"]);
    expect(state.attempt?.stage).toBe("released");
  });

  it("clears a latched Skip only for the next accepted begin", () => {
    let state = turnMomentsReducer(start(), { type: "skip", key: "7:roll:1:3" });
    state = start(state, { turn: 1, decisionRevision: 4 });
    expect(state.attempt?.key).toBe("7:roll:2:4");
    expect(state.attempt?.skipRequested).toBe(false);
  });

  it("omits restored-roll pre-move visuals but attaches its later arrival record", () => {
    let state = start(INITIAL_TURN_MOMENTS_STATE, { source: "restored-roll" });
    expect(state.attempt?.stage).toBe("waiting-record");
    state = observe(state, { record: ride() });
    expect(state.attempt?.stage).toBe("released");
    expect(state.attempt?.motionOmitted).toBe(true);
    expect(state.attempt?.recordAccepted).toBe(true);
    expect(state.attempt?.rawRoll).toBe(1);
  });

  it("omits a die for deadhead", () => {
    const state = observe(start(), { record: deadhead() });
    expect(state.attempt?.stage).toBe("released");
    expect(state.attempt?.rawRoll).toBeNull();
    expect(state.attempt?.recordAccepted).toBe(true);
  });

  it("collects only new target segments from the matching movement", () => {
    const events: readonly MoveEvent[] = [SEGMENT_EVENT,
      { ...SEGMENT_EVENT, segmentId: "already", newlyCompleted: false },
      { ...SEGMENT_EVENT, segmentId: "other-line", serviceId: "jr-keihin-tohoku" }];
    const state = observe(start(), recordWithMove(ride(), events));
    expect(state.attempt?.newlyCompletedTargetSegmentIds).toEqual(["target-segment"]);
  });

  it("releases without modifier stamps and keeps the delayed roll-one stamp", () => {
    const plain = observe(start(), { record: ride() });
    expect(plain.attempt?.stampsRequired).toBe(false);
    const delay: ItemEvent[] = [{ type: "effect-activated", effect: "delay" }];
    const delayed = observe(start(), { record: ride({ itemEvents: delay }) });
    expect(delayed.attempt?.stampsRequired).toBe(true);
    const advanced = turnMomentsReducer(delayed, { type: "advance", key: "7:roll:1:3", expectedStage: "tumble" });
    expect(advanced.attempt?.stage).toBe("stamps");
  });

  it("omits reduced-motion stages and resets at a session boundary", () => {
    let state = start(INITIAL_TURN_MOMENTS_STATE, { reducedMotion: true });
    expect(state.attempt?.motionOmitted).toBe(true);
    state = turnMomentsReducer(state, { type: "reset", sessionId: 8 });
    expect(state).toEqual({ sessionId: 8, attempt: null });
  });
});

describe("buildTurnRevealStages (arrival and conditional lottery)", () => {
  const NORMAL = turnMomentTiming(NORMAL_STEP_MS);
  const ARRIVAL = [{ key: "arrival", durationMs: 800 }];
  const PICKUP: ItemEvent[] = [{ type: "pickup-retained", item: { id: "double-b", kind: "double" } } as ItemEvent];

  it.each([
    ["a plain fresh ride", ride(), ARRIVAL],
    ["a ride with new target segments", ride({ traversedSegmentIds: ["target-segment"] }), ARRIVAL],
    ["a ride with no new segment", ride({ traversedSegmentIds: [] }), ARRIVAL],
    ["a goal ride", ride({ stopReason: "goal" }), ARRIVAL],
    ["a deadhead", deadhead(), ARRIVAL],
    ["a ride that picked up an item", ride({ itemEvents: PICKUP }), ARRIVAL],
  ] as const)("builds only the arrival for %s", (_label, record, expected) => {
    expect(buildTurnRevealStages({ record, restored: false, omitted: false }, NORMAL)).toEqual(expected);
  });

  it.each([
    ["classic mode (no item record)", { record: null, restored: false, omitted: false }],
    ["a restored record", { record: ride(), restored: true, omitted: false }],
    ["reduced motion", { record: ride(), restored: false, omitted: true }],
    ["a restored deadhead under reduced motion", { record: deadhead(), restored: true, omitted: true }],
  ] as const)("builds no stage for %s", (_label, facts) => {
    expect(buildTurnRevealStages(facts, NORMAL)).toEqual([]);
  });

  it.each([
    ["slow", 600, 1_067],
    ["normal", 450, 800],
    ["fast", 300, 533],
  ] as const)("takes the arrival duration from the captured %s timing", (_label, stepMs, arrivalMs) => {
    expect(buildTurnRevealStages({ record: ride(), restored: false, omitted: false }, turnMomentTiming(stepMs)))
      .toEqual([{ key: "arrival", durationMs: arrivalMs }]);
  });
});


describe("S14 lottery stage planning", () => {
  it.each([false, true])("plans only actual draws, with serviceDraw=%s", (serviceDraw) => {
    for (const directionDraw of [false, true]) {
      for (const stepMs of [300, 450, 600]) {
        const timing = turnMomentTiming(stepMs);
        const selected = { serviceId: "jr-yamanote", weight: 1, directions: directionDraw ? [1, -1] as const : [1] as const, directionWeights: [1] };
        const record = ride({ landing: { serviceId: "jr-yamanote", direction: 1 }, landingSnapshot: {
          stationId: "yoyogi", services: serviceDraw ? [selected, { ...selected, serviceId: "fixture-south" }] : [selected],
          suspensionIgnored: false, detourConsumed: false,
        } });
        const stages = buildTurnRevealStages({ record, restored: false, omitted: false }, timing);
        expect(stages).toEqual([{ key: "arrival", durationMs: timing.arrivalMs }, ...(serviceDraw || directionDraw ? [
          { key: "lottery-flip", durationMs: Math.round(1600 * stepMs / 450) },
          { key: "lottery-settle", durationMs: Math.round(400 * stepMs / 450) },
        ] : [])]);
        expect(buildTurnRevealStages({ record: { ...record, stopReason: "goal" }, restored: false, omitted: false }, timing))
          .toEqual([{ key: "arrival", durationMs: timing.arrivalMs }]);
        expect(buildTurnRevealStages({ record, restored: true, omitted: false }, timing)).toEqual([]);
        expect(buildTurnRevealStages({ record, restored: false, omitted: true }, timing)).toEqual([]);
      }
    }
  });
});
