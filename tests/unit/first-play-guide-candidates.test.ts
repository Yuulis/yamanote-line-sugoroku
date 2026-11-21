import { describe, expect, it } from "vitest";
import type { EndpointKind, GameConfig, ItemDeadheadRecord, ItemEvent, ItemRideRecord, StopReason } from "../../src/types/network";
import {
  buildRailwayNetwork,
  createGame,
  filterLandingOptions,
  landingOptions,
  resolveLandingEvent,
  type LandingResolvedEvent,
} from "../../src/features/game/engine";
import type { GameSession, LastMove } from "../../src/features/game/gameSession";
import { captureTurnPresentationPolicy } from "../../src/features/game/animation/turnMomentPolicy";
import type { RollAttempt } from "../../src/features/game/animation/turnMoments";
import { buildGuideCopy, createGuideCandidate } from "../../src/features/game/firstPlayGuide";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay, type TurnMomentDisplayInput } from "../../src/features/game/turnMomentPresentation";
import { multiConfig, multiServiceInput, M_LINE, M_LOOP, M_SPUR } from "./fixtures/multiService";

const network = buildRailwayNetwork(multiServiceInput());
const presentation = createPresentationResolver(network);
const SESSION_ID = 42;
const DEFAULT_CONFIG: GameConfig = {
  ...multiConfig(),
  directionLottery: { towardTargetWeight: 3, awayFromTargetWeight: 2 },
};

function landingAt(
  stationId: string,
  serviceId: string,
  overrides: Partial<LandingResolvedEvent> = {},
): LandingResolvedEvent {
  return {
    type: "landing-resolved",
    stationId,
    serviceCandidates: [serviceId],
    serviceId,
    serviceDrawRequired: false,
    directionCandidates: [1, -1],
    direction: 1,
    directionDrawRequired: true,
    changedService: false,
    ...overrides,
  };
}

function itemRideRecord(
  turn: number,
  itemEvents: readonly ItemEvent[],
  stopReason: StopReason,
  unusedPips: number,
  stationId: string,
): ItemRideRecord {
  return {
    kind: "item-ride",
    turn,
    fromStationId: "b",
    toStationId: stationId,
    command: { items: [] },
    traversedSegmentIds: [],
    landing: null,
    landingSnapshot: null,
    itemEvents: [...itemEvents],
    discardedInstanceId: null,
    resolvedRide: { serviceId: M_SPUR, direction: -1 },
    rawRoll: 3,
    effectiveFace: 3,
    adjustment: null,
    movementMode: "normal",
    pips: 3,
    hopBudget: 3,
    physicalHops: 2,
    unusedPips,
    stopReason,
  };
}

function deadheadRecord(turn: number, itemEvents: readonly ItemEvent[], stationId: string): ItemDeadheadRecord {
  return {
    kind: "deadhead",
    turn,
    fromStationId: "s1",
    toStationId: stationId,
    command: { items: [{ kind: "deadhead", instanceId: "deadhead-item" }] },
    traversedSegmentIds: [],
    landing: null,
    landingSnapshot: null,
    itemEvents: [...itemEvents],
    discardedInstanceId: null,
    resolvedRide: null,
    rawRoll: null,
    effectiveFace: null,
    adjustment: null,
    movementMode: "deadhead",
    pips: null,
    hopBudget: null,
    physicalHops: 0,
    unusedPips: null,
    stopReason: "relocation",
    relocation: { fromStationId: "s1", toStationId: stationId, serviceId: M_LOOP, direction: 1, distance: 1 },
  };
}

interface SessionOptions {
  readonly stationId?: string;
  readonly turn?: number;
  readonly config?: GameConfig;
  readonly landing?: LandingResolvedEvent | null;
  readonly deadhead?: boolean;
  readonly stopReason?: StopReason | "relocation";
  readonly endpointKind?: EndpointKind | null;
  readonly unusedPips?: number;
  readonly itemEvents?: readonly ItemEvent[];
}

function sessionWithPublishedMove(options: SessionOptions = {}): GameSession {
  const stationId = options.stationId ?? "s1";
  const turn = options.turn ?? 1;
  const config = options.config ?? DEFAULT_CONFIG;
  const landing = options.deadhead ? null : options.landing === undefined ? landingAt(stationId, M_SPUR) : options.landing;
  const session = createGame(config, "guide-candidate-session", network);
  const resolvedService = options.deadhead ? M_LOOP : landing?.serviceId ?? M_SPUR;
  const stopReason = options.stopReason ?? "roll";
  const itemRecord = options.itemEvents === undefined ? undefined : options.deadhead
    ? deadheadRecord(turn, options.itemEvents, stationId)
    : itemRideRecord(turn, options.itemEvents, stopReason === "relocation" ? "roll" : stopReason,
      options.unusedPips ?? 0, stationId);
  const direction = options.deadhead ? 1 : landing?.direction ?? -1;
  const lastMove: LastMove = {
    roll: options.deadhead ? null : 3,
    ...(itemRecord ? { itemRecord } : {}),
    unusedPips: options.unusedPips ?? 0,
    stopReason: options.deadhead ? "relocation" : stopReason,
    stopStationId: stationId,
    serviceId: resolvedService,
    direction,
    endpointKind: options.endpointKind ?? null,
    landing,
  };
  return {
    sessionId: SESSION_ID,
    game: {
      ...session,
      turn,
      currentStationId: stationId,
      currentServiceId: resolvedService,
      direction,
    },
    phase: "idle",
    lastMove,
    animation: null,
  };
}

function attemptFor(
  session: GameSession,
  presentationLevel: "all" | "important" | "none" = "all",
): RollAttempt {
  const turn = session.game.turn;
  return {
    key: `${session.sessionId}:roll:${turn}:0`,
    sessionId: session.sessionId,
    recordTurn: turn,
    source: "click",
    origin: {
      stationId: session.game.currentStationId,
      ride: { serviceId: session.game.currentServiceId, direction: session.game.direction },
      completedSegmentIds: session.game.completedSegmentIds,
      turn: turn - 1,
      itemView: null as never,
      previousLastMove: null,
    },
    policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel }),
    stage: "released",
    rawRoll: 3,
    tumbleCompleted: true,
    skipRequested: false,
    motionOmitted: false,
    adjustObserved: false,
    recordAccepted: true,
    stampsRequired: false,
    newlyCompletedTargetSegmentIds: [],
  };
}

function derive(
  session: GameSession,
  overrides: Partial<TurnMomentDisplayInput> = {},
) {
  const currentServiceId = session.lastMove?.landing?.serviceId ?? session.game.currentServiceId;
  const progress = {
    stationId: session.game.currentStationId,
    position: network.servicesById.get(currentServiceId)?.platformCoordinates[session.game.currentStationId] ?? null,
    completedSegmentIds: session.game.completedSegmentIds,
    stepsCompleted: 0,
  };
  return deriveTurnMomentDisplay({
    session,
    network,
    presentation,
    progress,
    attempt: null,
    revealStage: "done",
    restoredOrOmitted: false,
    entryTurn: 0,
    ...overrides,
  });
}

function hintIds(session: GameSession, overrides: Partial<TurnMomentDisplayInput> = {}) {
  return derive(session, overrides).guideCandidates.map((candidate) => candidate.copy.hintId);
}

describe("published first-play guide candidates", () => {
  it("uses the session, turn and hint ID for a stable key and excludes non-hint copy", () => {
    const hint = {
      copyId: "lottery-direction" as const,
      hintId: "lottery" as const,
      sectionId: "lottery" as const,
      text: "方向を抽選します。",
    };
    const coach = { ...hint, copyId: "coach-dice" as const, hintId: null };

    expect(createGuideCandidate(42, 7, hint)).toEqual({
      key: "42:7:lottery",
      sessionId: 42,
      turn: 7,
      copy: hint,
    });
    expect(createGuideCandidate(42, 7, coach)).toBeNull();
  });

  it.each([
    ["service-only", landingAt("b", M_SPUR, {
      serviceCandidates: [M_LOOP, M_LINE, M_SPUR], serviceDrawRequired: true,
      directionCandidates: [1], directionDrawRequired: false,
    }), "lottery-service"],
    ["direction-only", landingAt("s1", M_SPUR), "lottery-direction"],
    ["both draws", landingAt("b", M_LINE, {
      serviceCandidates: [M_LOOP, M_LINE, M_SPUR], serviceDrawRequired: true,
      directionCandidates: [1, -1], directionDrawRequired: true,
    }), "lottery-service-direction"],
  ] as const)("selects the %s lottery copy from the published draw flags", (_name, landing, copyId) => {
    const display = derive(sessionWithPublishedMove({ stationId: landing.stationId, landing }));
    expect(display.guideCandidates.find((candidate) => candidate.copy.hintId === "lottery")?.copy.copyId).toBe(copyId);
  });

  it("uses the resolved draw flags after suspension and detour filtering", () => {
    const config = DEFAULT_CONFIG;
    const origin = createGame(config, "filtered-guide-landing", network);
    const position = { ...origin, currentStationId: "b", currentServiceId: M_LOOP };
    const unfiltered = landingOptions(position, network);
    expect(unfiltered.serviceDrawRequired).toBe(true);
    const filtered = filterLandingOptions(unfiltered, config, {
      turn: 5,
      suspensions: [
        { serviceId: M_LOOP, expiresTurn: 5 },
        { serviceId: M_SPUR, expiresTurn: 5 },
      ],
      detourServiceId: M_LOOP,
    }, network);
    expect(filtered.options.services).toEqual([M_LINE]);
    expect(filtered.options.serviceDrawRequired).toBe(false);
    expect(filtered.options.directionsByService.get(M_LINE)).toEqual([1, -1]);
    const event = resolveLandingEvent(filtered.options, M_LOOP, { serviceId: M_LINE, direction: 1 }).event;
    expect(event).toMatchObject({ serviceDrawRequired: false, directionDrawRequired: true });

    const display = derive(sessionWithPublishedMove({ stationId: "b", landing: event }));
    expect(display.guideCandidates.map((candidate) => candidate.copy.copyId)).toContain("lottery-direction");
    expect(display.guideCandidates.map((candidate) => candidate.copy.copyId)).not.toContain("lottery-service-direction");
  });

  it("does not create a lottery candidate when neither draw is required", () => {
    const landing = landingAt("x", M_LINE, {
      serviceCandidates: [M_LINE], serviceDrawRequired: false,
      directionCandidates: [-1], directionDrawRequired: false,
    });
    const display = derive(sessionWithPublishedMove({ stationId: "x", landing }));
    expect(display.guideCandidates.map((candidate) => candidate.copy.hintId)).not.toContain("lottery");
    expect(display.guideCandidates.map((candidate) => candidate.copy.hintId)).not.toContain("off-target");
  });

  it.each([
    ["only one movable direction", landingAt("s1", M_SPUR, {
      directionCandidates: [1], directionDrawRequired: false,
    }), DEFAULT_CONFIG],
    ["equal target distances", landingAt("y", M_LINE), DEFAULT_CONFIG],
    ["equal direction weights", landingAt("s1", M_SPUR), {
      ...DEFAULT_CONFIG, directionLottery: { towardTargetWeight: 2, awayFromTargetWeight: 2 },
    }],
    ["away-biased direction weights", landingAt("s1", M_SPUR), {
      ...DEFAULT_CONFIG, directionLottery: { towardTargetWeight: 1, awayFromTargetWeight: 3 },
    }],
  ] as const)("omits off-target when %s", (_name, landing, config) => {
    const display = derive(sessionWithPublishedMove({ stationId: landing.stationId, landing, config }));
    expect(display.guideCandidates.map((candidate) => candidate.copy.hintId)).not.toContain("off-target");
  });

  it("omits off-target copy on the target service even with two distinct direction distances", () => {
    expect(buildGuideCopy({
      kind: "off-target",
      resultPublished: true,
      config: { targetServiceId: M_LOOP, directionLottery: DEFAULT_CONFIG.directionLottery },
      targetName: "目標線",
      landing: { serviceId: M_LOOP, directionDistancesToTarget: [2, 5] },
    })).toBeNull();
  });

  it("creates the off-target hint for two distinct published direction distances and a toward bias", () => {
    const display = derive(sessionWithPublishedMove());
    const candidate = display.guideCandidates.find((entry) => entry.copy.hintId === "off-target");
    expect(candidate?.copy).toMatchObject({ copyId: "off-target", sectionId: "lottery" });
    expect(candidate?.copy.text).toContain("に近づく向きが抽選で出やすくなっています。");
  });

  it.each([
    ["retained pickup", [{ type: "pickup-retained", item: { id: "new", kind: "double" } }], "item"],
    ["pending discard", [{ type: "pickup-pending-discard", item: { id: "new", kind: "double" }, candidates: [] }], "item-pending-discard"],
  ] as const)("uses the item variant from a %s event", (_name, events, copyId) => {
    const session = sessionWithPublishedMove({ landing: null, itemEvents: events });
    const candidate = derive(session).guideCandidates.find((entry) => entry.copy.hintId === "item");
    expect(candidate?.copy.copyId).toBe(copyId);
  });

  it("publishes a beneficial pickup from a deadhead record", () => {
    const session = sessionWithPublishedMove({ deadhead: true, stationId: "b", itemEvents: [
      { type: "pickup-retained", item: { id: "new", kind: "double" } },
    ] });

    expect(derive(session).guideCandidates.map((candidate) => candidate.copy.hintId)).toContain("item");
  });

  it.each([
    ["scheduled", { type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 4 }, "harmful-item"],
    ["certificate-cancelled", { type: "cancelled-by-certificate", item: "delay", certificate: { id: "certificate", kind: "delay-certificate" } }, "harmful-item-cancelled"],
  ] as const)("publishes a %s harmful pickup from a deadhead record", (_name, event, copyId) => {
    const session = sessionWithPublishedMove({ deadhead: true, stationId: "b", itemEvents: [event] });
    const candidate = derive(session).guideCandidates.find((entry) => entry.copy.hintId === "harmful-item");

    expect(candidate?.copy.copyId).toBe(copyId);
  });

  it("does not create a terminus candidate for a deadhead relocation", () => {
    const session = sessionWithPublishedMove({
      deadhead: true,
      stationId: "b",
      endpointKind: "terminus",
      unusedPips: 2,
      itemEvents: [],
    });

    expect(session.lastMove?.stopReason).toBe("relocation");
    expect(derive(session).guideCandidates.map((candidate) => candidate.copy.hintId)).not.toContain("terminus");
  });

  it.each([
    ["harmful-scheduled", [{ type: "harmful-scheduled", item: "delay", effect: "delay", dueTurn: 4 }], "harmful-item"],
    ["certificate cancellation", [{ type: "cancelled-by-certificate", item: "delay", certificate: { id: "certificate", kind: "delay-certificate" } }], "harmful-item-cancelled"],
  ] as const)("creates harmful copy for %s", (_name, events, copyId) => {
    const session = sessionWithPublishedMove({ landing: null, itemEvents: events });
    const candidate = derive(session).guideCandidates.find((entry) => entry.copy.hintId === "harmful-item");
    expect(candidate?.copy.copyId).toBe(copyId);
  });

  it.each([
    ["consumed item", [{ type: "consumed", item: { id: "used", kind: "double" } }]],
    ["scheduled effect activation", [{ type: "effect-activated", effect: "delay" }]],
    ["expired suspension", [{ type: "effect-expired", effect: "suspension", serviceId: M_LINE }]],
    ["discarded item", [{ type: "discarded", item: { id: "discarded", kind: "rapid" } }]],
  ] as const)("does not infer pickup or harmful hints from %s alone", (_name, events) => {
    const session = sessionWithPublishedMove({ landing: null, itemEvents: events });
    expect(hintIds(session)).not.toContain("item");
    expect(hintIds(session)).not.toContain("harmful-item");
  });

  it("creates a terminus hint only for an endpoint terminus with unused pips", () => {
    const qualifies = derive(sessionWithPublishedMove({ landing: null, stopReason: "endpoint", endpointKind: "terminus", unusedPips: 2 }));
    expect(qualifies.guideCandidates.find((candidate) => candidate.copy.hintId === "terminus")?.copy.copyId).toBe("terminus");
    for (const options of [
      { stopReason: "endpoint" as const, endpointKind: "area-boundary" as const, unusedPips: 2 },
      { stopReason: "endpoint" as const, endpointKind: "service-boundary" as const, unusedPips: 2 },
      { stopReason: "endpoint" as const, endpointKind: "terminus" as const, unusedPips: 0 },
      { stopReason: "roll" as const, endpointKind: "terminus" as const, unusedPips: 2 },
      { stopReason: "goal" as const, endpointKind: "terminus" as const, unusedPips: 2 },
    ]) {
      const display = derive(sessionWithPublishedMove({ landing: null, ...options }));
      expect(display.guideCandidates.map((candidate) => candidate.copy.hintId)).not.toContain("terminus");
    }
  });

  it("publishes all event candidates in fixed order with stable keys and only display data", () => {
    const events: ItemEvent[] = [
      { type: "pickup-pending-discard", item: { id: "new", kind: "double" }, candidates: [] },
      { type: "cancelled-by-certificate", item: "delay", certificate: { id: "certificate", kind: "delay-certificate" } },
    ];
    const display = derive(sessionWithPublishedMove({
      turn: 7,
      itemEvents: events,
      stopReason: "endpoint",
      endpointKind: "terminus",
      unusedPips: 2,
    }));

    expect(display.guideCandidates.map((candidate) => candidate.copy.hintId)).toEqual([
      "lottery", "off-target", "item", "harmful-item", "terminus",
    ]);
    expect(display.guideCandidates.map((candidate) => candidate.key)).toEqual([
      "42:7:lottery", "42:7:off-target", "42:7:item", "42:7:harmful-item", "42:7:terminus",
    ]);
    expect(display.guideCandidates.map((candidate) => candidate.copy.copyId)).toEqual([
      "lottery-direction", "off-target", "item-pending-discard", "harmful-item-cancelled", "terminus",
    ]);
    expect(Object.keys(display.guideCandidates[0]!).sort()).toEqual(["copy", "key", "sessionId", "turn"]);
    expect(derive(sessionWithPublishedMove({ turn: 7, itemEvents: events, stopReason: "endpoint", endpointKind: "terminus", unusedPips: 2 }))
      .guideCandidates.map((candidate) => candidate.key)).toEqual(display.guideCandidates.map((candidate) => candidate.key));
  });

  it("excludes turns at or before the session entry turn, including a restored result", () => {
    const session = sessionWithPublishedMove({ turn: 4 });
    expect(hintIds(session, { entryTurn: 4, restoredOrOmitted: true })).toEqual([]);
    expect(hintIds(session, { entryTurn: 5, restoredOrOmitted: true })).toEqual([]);
    expect(hintIds(session, { entryTurn: 3 })).toContain("lottery");
  });

  it.each([
    ["Skip", (session: GameSession) => ({
      attempt: { ...attemptFor(session), skipRequested: true },
      revealStage: "done" as const,
    })],
    ["なし presentation", (session: GameSession) => ({
      attempt: attemptFor(session, "none"),
      revealStage: "done" as const,
    })],
    ["reduced motion", (_session: GameSession) => ({ restoredOrOmitted: true })],
  ] as const)("keeps candidates when the result is published by %s", (_name, overrides) => {
    const session = sessionWithPublishedMove();
    const candidates = derive(session, overrides(session)).guideCandidates;
    expect(candidates.map((candidate) => candidate.copy.hintId)).toContain("lottery");
    expect(candidates.map((candidate) => candidate.key)).toContain("42:1:lottery");
  });
});
