import { describe, expect, it } from "vitest";
import { captureTurnPresentationPolicy, turnMomentTiming } from "../../src/features/game/animation/turnMomentPolicy";
import {
  buildTurnRevealStages,
  INITIAL_TURN_MOMENTS_STATE,
  observeTurnFacts,
  segmentFlashFeatureIds,
  turnMomentsReducer,
  type TurnMomentObservation,
  type TurnMomentsAction,
  type TurnOrigin,
  type TurnMomentsState,
} from "../../src/features/game/animation/turnMoments";
import type { ItemSessionView } from "../../src/features/game/itemSession";
import type { ItemDeadheadRecord, ItemEvent, ItemRideRecord } from "../../src/types/network";
import { buildRailwayNetwork } from "../../src/features/game/engine";
import { inputWithShuttle, SEGMENT_IDS } from "./fixtures/yamanote";
import type { MoveEvent } from "../../src/features/game/engine";

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
    origin: ORIGIN, policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" }), ...changes });
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
const PICKUP: ItemEvent[] = [{ type: "pickup-retained", item: { id: "double-b", kind: "double" } } as ItemEvent];

describe("turnMomentTiming", () => {
  it.each([
    ["slow", { stepMs: 600, tumbleMs: 800, stampsMs: 320, arrivalMs: 1067,
      lotteryFlipMs: 2133, lotterySettleMs: 533, pickupMs: 667, flashMs: 1067 }],
    ["normal", { stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800,
      lotteryFlipMs: 1600, lotterySettleMs: 400, pickupMs: 500, flashMs: 800 }],
    ["fast", { stepMs: 300, tumbleMs: 400, stampsMs: 160, arrivalMs: 533,
      lotteryFlipMs: 1067, lotterySettleMs: 267, pickupMs: 333, flashMs: 533 }],
  ] as const)("preserves all legacy moments at %s", (speedId, expected) => {
    expect(turnMomentTiming(speedId)).toEqual(expected);
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

describe("buildTurnRevealStages (arrival, conditional lottery and pickup)", () => {
  const NORMAL = captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" });
  const ARRIVAL = [{ key: "arrival", durationMs: 800 }];

  it.each([
    ["a plain fresh ride", ride(), ARRIVAL],
    ["a ride with new target segments", ride({ traversedSegmentIds: ["target-segment"] }), ARRIVAL],
    ["a ride with no new segment", ride({ traversedSegmentIds: [] }), ARRIVAL],
    ["a goal ride", ride({ stopReason: "goal" }), ARRIVAL],
    ["a deadhead", deadhead(), ARRIVAL],
    ["a ride that retained a pickup", ride({ itemEvents: PICKUP }), [...ARRIVAL, { key: "pickup", durationMs: 500 }]],
    ["a full-inventory pickup", ride({ itemEvents: [{ type: "pickup-pending-discard", item: { id: "double-b", kind: "double" }, candidates: [] } as ItemEvent] }),
      [...ARRIVAL, { key: "pickup", durationMs: 500 }]],
    ["a harmful drop", ride({ itemEvents: [{ type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 3 }] }), ARRIVAL],
    ["a certificate cancellation", ride({ itemEvents: [{ type: "cancelled-by-certificate", item: "oversleep", certificate: { id: "cert", kind: "delay-certificate" } }] }), ARRIVAL],
  ] as const)("builds the expected stages for %s", (_label, record, expected) => {
    expect(buildTurnRevealStages({ record, restored: false,
      hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: record.traversedSegmentIds, omitted: false }, NORMAL)).toEqual(expected);
  });

  it.each([
    ["classic mode (no item record)", { record: null, restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }],
    ["a restored record", { record: ride(), restored: true, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }],
    ["reduced motion", { record: ride(), restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: true }],
    ["a restored deadhead under reduced motion", { record: deadhead(), restored: true, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: true }],
  ] as const)("builds no stage for %s", (_label, facts) => {
    expect(buildTurnRevealStages(facts, NORMAL)).toEqual([]);
  });

  it("does not construct an arrival stage when the timing has no arrival card", () => {
    expect(buildTurnRevealStages({ record: ride(), restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false },
      { ...NORMAL, timing: { ...NORMAL.timing, arrivalMs: null } })).toEqual([]);
  });

  it.each([
    ["slow", 1_067],
    ["normal", 800],
    ["fast", 533],
  ] as const)("takes the arrival duration from the captured %s timing", (speedId, arrivalMs) => {
    expect(buildTurnRevealStages({ record: ride(), restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }, captureTurnPresentationPolicy({ speedId, presentationLevel: "all" })))
      .toEqual([{ key: "arrival", durationMs: arrivalMs }]);
  });
});


describe("S14-S15 lottery and pickup stage planning", () => {
  it.each([false, true])("plans only actual draws, with serviceDraw=%s", (serviceDraw) => {
    for (const directionDraw of [false, true]) {
      for (const [speedId, arrivalMs, flipMs, settleMs, pickupMs] of [
        ["fast", 533, 1067, 267, 333], ["normal", 800, 1600, 400, 500], ["slow", 1067, 2133, 533, 667],
      ] as const) {
        const policy = captureTurnPresentationPolicy({ speedId, presentationLevel: "all" });
        const selected = { serviceId: "jr-yamanote", weight: 1, directions: directionDraw ? [1, -1] as const : [1] as const, directionWeights: [1] };
        const record = ride({ landing: { serviceId: "jr-yamanote", direction: 1 }, landingSnapshot: {
          stationId: "yoyogi", services: serviceDraw ? [selected, { ...selected, serviceId: "fixture-south" }] : [selected],
          suspensionIgnored: false, detourConsumed: false,
        } });
        const stages = buildTurnRevealStages({ record, restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }, policy);
        const pickedUp = record.itemEvents.some((event) => event.type === "pickup-retained" || event.type === "pickup-pending-discard");
        expect(stages).toEqual([{ key: "arrival", durationMs: arrivalMs }, ...(serviceDraw || directionDraw ? [
          { key: "lottery-flip", durationMs: flipMs },
          { key: "lottery-settle", durationMs: settleMs },
        ] : []), ...(pickedUp ? [{ key: "pickup", durationMs: pickupMs }] : [])]);
        expect(buildTurnRevealStages({ record: { ...record, stopReason: "goal" }, restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }, policy))
          .toEqual([{ key: "arrival", durationMs: arrivalMs }]);
        expect(buildTurnRevealStages({ record, restored: true, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }, policy)).toEqual([]);
        expect(buildTurnRevealStages({ record, restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: true }, policy)).toEqual([]);
      }
    }
  });

  it.each(["fast", "normal", "slow"] as const)("appends pickup after a lottery at captured speed=%s", (speedId) => {
    const policy = captureTurnPresentationPolicy({ speedId, presentationLevel: "all" });
    const pickupRecord = ride({
      itemEvents: PICKUP,
      landing: { serviceId: "jr-yamanote", direction: 1 },
      landingSnapshot: { stationId: "yoyogi", services: [
        { serviceId: "jr-yamanote", weight: 1, directions: [1], directionWeights: [1] },
        { serviceId: "fixture-south", weight: 1, directions: [1], directionWeights: [1] },
      ], suspensionIgnored: false, detourConsumed: false },
    });
    expect(buildTurnRevealStages({ record: pickupRecord, restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }, policy).map(({ key }) => key))
      .toEqual(["arrival", "lottery-flip", "lottery-settle", "pickup"]);
    expect(buildTurnRevealStages({ record: pickupRecord, restored: true, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: false }, policy)).toEqual([]);
    expect(buildTurnRevealStages({ record: pickupRecord, restored: false, hasRenderableNewTargetSegments: false, newlyCompletedTargetSegmentIds: [], omitted: true }, policy)).toEqual([]);
  });
});


describe("card-less segment flash planning", () => {
  const network = buildRailwayNetwork(inputWithShuttle());
  const normal = captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" });
  const cardless = { ...normal, showArrival: false, timing: { ...normal.timing, flashMs: 180 } };
  const facts = { record: ride(), restored: false, omitted: false,
    newlyCompletedTargetSegmentIds: [SEGMENT_IDS[0]!], hasRenderableNewTargetSegments: true };

  it("selects only new target segments with geometry and deduplicates feature ids", () => {
    const targetIds = SEGMENT_IDS;
    expect(segmentFlashFeatureIds(network, targetIds,
      [SEGMENT_IDS[0]!, SEGMENT_IDS[0]!, "test-shuttle:shimbashi:test-a", "unknown"]))
      .toEqual([SEGMENT_IDS[0]!]);
    const withoutGeometry = { ...network, segmentsById: new Map() };
    expect(segmentFlashFeatureIds(withoutGeometry, targetIds, [SEGMENT_IDS[0]!])).toEqual([]);
    expect(segmentFlashFeatureIds(network, targetIds, [])).toEqual([]);
  });

  it("uses the captured flash duration when arrival is disabled", () => {
    expect(buildTurnRevealStages(facts, cardless)).toEqual([{ key: "segment-flash", durationMs: 180 }]);
    expect(buildTurnRevealStages(facts, { ...cardless, timing: { ...cardless.timing, arrivalMs: null } }))
      .toEqual([{ key: "segment-flash", durationMs: 180 }]);
  });

  it.each([
    { name: "no new segments", ...facts, newlyCompletedTargetSegmentIds: [] },
    { name: "no renderable segments", ...facts, hasRenderableNewTargetSegments: false },
    { name: "restored record", ...facts, restored: true },
    { name: "omitted record", ...facts, omitted: true },
  ])("does not add a flash stage for $name", (input) => {
    expect(buildTurnRevealStages(input, cardless)).toEqual([]);
  });

  it("keeps the concurrent arrival flash without an additional stage", () => {
    expect(buildTurnRevealStages(facts, normal)).toEqual([{ key: "arrival", durationMs: 800 }]);
    expect(buildTurnRevealStages(facts, { ...cardless, showImportantMoments: false })).toEqual([]);
  });

  it("places flash before lottery and pickup, and keeps a goal flash", () => {
    const record = ride({ itemEvents: PICKUP, landing: { serviceId: "jr-yamanote", direction: 1 },
      landingSnapshot: { stationId: "yoyogi", services: [
        { serviceId: "jr-yamanote", weight: 1, directions: [1, -1], directionWeights: [1, 1] },
      ], suspensionIgnored: false, detourConsumed: false } });
    expect(buildTurnRevealStages({ ...facts, record }, cardless).map(({ key }) => key))
      .toEqual(["segment-flash", "lottery-flip", "lottery-settle", "pickup"]);
    expect(buildTurnRevealStages({ ...facts, record: ride({ stopReason: "goal" }) }, cardless))
      .toEqual([{ key: "segment-flash", durationMs: 180 }]);
  });
});


describe("very-fast reveal planning", () => {
  const policy = captureTurnPresentationPolicy({ speedId: "very-fast", presentationLevel: "all" });
  const facts = { record: ride(), restored: false, omitted: false,
    newlyCompletedTargetSegmentIds: [SEGMENT_IDS[0]!], hasRenderableNewTargetSegments: true };

  it("omits arrival and retains the standalone new-segment flash at 180 ms", () => {
    expect(buildTurnRevealStages(facts, policy)).toEqual([{ key: "segment-flash", durationMs: 180 }]);
  });

  it.each([
    { ...facts, newlyCompletedTargetSegmentIds: [] },
    { ...facts, hasRenderableNewTargetSegments: false },
  ])("adds no flash delay without renderable new segments (%j)", (input) => {
    expect(buildTurnRevealStages(input, policy)).toEqual([]);
  });
});

describe.each(["important", "none"] as const)("%s pre-move scheduling", (presentationLevel) => {
  const policy = captureTurnPresentationPolicy({ speedId: "very-fast", presentationLevel });
  it.each(["click", "restored-roll"] as const)("keeps %s adjustment usable without hidden timers or motion omission", (source) => {
    const begun = start(undefined, { policy, source });
    expect(begun.attempt?.tumbleCompleted).toBe(true);
    expect(begun.attempt?.motionOmitted).toBe(false);
    const pending = observe(begun, { decision: DECISION });
    expect(pending.attempt?.stage).toBe("awaiting-adjust");
    expect(pending.attempt?.recordAccepted).toBe(false);
    expect(observe(pending)).toBe(pending);
    const accepted = observe(pending, { record: ride({ adjustment: { instanceId: "adjust-a", delta: 1 } }) });
    expect(accepted.attempt?.stage).toBe("released");
    expect(accepted.attempt?.policy).toBe(policy);
    expect(accepted.attempt?.motionOmitted).toBe(false);
  });
  it.each([
    ["oversleep", ride({ movementMode: "oversleep" })],
    ["forced delay", ride({ itemEvents: [{ type: "effect-activated", effect: "delay" }] })],
    ["deadhead", deadhead()],
  ] as const)("releases %s without waiting for hidden stamps", (_name, record) => {
    const accepted = observe(start(undefined, { policy }), { record });
    expect(accepted.attempt?.stage).toBe("released");
    expect(accepted.attempt?.tumbleCompleted).toBe(true);
    expect(accepted.attempt?.motionOmitted).toBe(record.kind === "deadhead");
  });
});

it.each(["all", "important", "none"] as const)("selects %s reveal stages and goal boundaries", (presentationLevel) => {
  const policy = captureTurnPresentationPolicy({ speedId: "normal", presentationLevel });
  const record = ride({ landing: { serviceId: "jr-yamanote", direction: 1 },
    landingSnapshot: { stationId: "yoyogi", services: [
      { serviceId: "jr-yamanote", weight: 1, directions: [1, -1], directionWeights: [1, 1] },
    ], suspensionIgnored: false, detourConsumed: false }, itemEvents: PICKUP });
  for (const hasSegments of [false, true]) {
    const facts = { record, restored: false, omitted: false,
      newlyCompletedTargetSegmentIds: hasSegments ? ["target-segment"] : [], hasRenderableNewTargetSegments: hasSegments };
    const prefix = presentationLevel === "all" ? ["arrival"]
      : presentationLevel === "important" && hasSegments ? ["segment-flash"] : [];
    expect(buildTurnRevealStages(facts, policy).map(({ key }) => key)).toEqual([
      ...prefix, ...(presentationLevel === "none" ? [] : ["lottery-flip", "lottery-settle", "pickup"]),
    ]);
    expect(buildTurnRevealStages({ ...facts, record: { ...record, stopReason: "goal" } }, policy)
      .map(({ key }) => key)).toEqual(prefix);
  }
});
