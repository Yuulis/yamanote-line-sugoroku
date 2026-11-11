import { describe, expect, it } from "vitest";
import { createGame, playItemTurn, playTurn, targetSegmentIds } from "../../src/features/game/engine";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import { captureTurnPresentationPolicy } from "../../src/features/game/animation/turnMomentPolicy";
import { turnMomentArrivalModel } from "../../src/features/game/components/TurnMomentHost";
import { buildTurnRevealStages } from "../../src/features/game/animation/turnMoments";
import type { RollAttempt } from "../../src/features/game/animation/turnMoments";
import { lastMoveOf, reduceGameSession, resumeSession, startSession } from "../../src/features/game/gameSession";
import { itemSessionView } from "../../src/features/game/itemSession";
import { turnMomentAnnouncement } from "../../src/features/game/presentation";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay } from "../../src/features/game/turnMomentPresentation";
import type { GameSession } from "../../src/features/game/gameSession";
import { loadBundle } from "../e2e/fixtures/bundle";
import { LEGACY_FIXTURE_GAME_SEED, LEGACY_FIXTURE_SCENARIO_TURNS } from "../e2e/fixtures/seeds";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";
import { itemScenario } from "../e2e/fixtures/itemScenarios";

const { network } = await loadBundle("fixture");
const resolver = createPresentationResolver(network);

function attemptFor(session: GameSession, stage: RollAttempt["stage"] = "released"): RollAttempt {
  const game = session.game;
  return {
    key: `${session.sessionId}:roll:${game.turn + 1}:0`,
    sessionId: session.sessionId,
    recordTurn: game.turn + 1,
    source: "click",
    origin: {
      stationId: game.currentStationId,
      ride: { serviceId: game.currentServiceId, direction: game.direction },
      completedSegmentIds: game.completedSegmentIds,
      turn: game.turn,
      itemView: null as never,
      previousLastMove: session.lastMove,
    },
    policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" }),
    stage,
    rawRoll: null,
    tumbleCompleted: stage === "released",
    skipRequested: false,
    motionOmitted: false,
    adjustObserved: false,
    recordAccepted: stage === "released",
    stampsRequired: false,
    newlyCompletedTargetSegmentIds: [],
  };
}

function progressFor(session: GameSession) {
  return displayedProgress(sessionProgress(session), network, null);
}

function sessionWithTargetCompletionInHistory(): GameSession {
  const session = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 121);
  const requiredIds = targetSegmentIds(session.game.config, network);
  const movementHistory = [...requiredIds].reverse().map((segmentId, index) => {
    const segment = network.segmentsById.get(segmentId)!;
    return {
      turn: index + 1,
      roll: 1,
      serviceId: segment.serviceId,
      direction: LEGACY_CAPITAL_REGION_CONFIG.targetDirection,
      fromStationId: segment.from,
      toStationId: segment.to,
      traversedSegmentIds: [segmentId],
      stopReason: "roll" as const,
      landing: null,
    };
  });
  const finalRecord = movementHistory.at(-1)!;
  return {
    ...session,
    game: {
      ...session.game,
      status: "playing",
      turn: movementHistory.length,
      currentStationId: finalRecord.toStationId,
      currentServiceId: LEGACY_CAPITAL_REGION_CONFIG.targetServiceId,
      direction: LEGACY_CAPITAL_REGION_CONFIG.targetDirection,
      completedSegmentIds: [...requiredIds],
      movementHistory,
    },
  };
}

describe("shared turn moment publication", () => {
  const before = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 21);
  const moved = reduceGameSession(before, {
    type: "roll", sessionId: 21, rngSeed: LEGACY_FIXTURE_GAME_SEED, turn: 0,
  }, LEGACY_CAPITAL_REGION_CONFIG, network);
  const completed = reduceGameSession(moved, { type: "animation-finished", sessionId: 21, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network);

  it("keeps origin station, progress, ride and prior text behind the pre-move gate", () => {
    const attempt = attemptFor(before, "tumble");
    attempt.rawRoll = 2;
    const display = deriveTurnMomentDisplay({ session: moved, network, presentation: resolver, progress: progressFor(moved), attempt, revealStage: "waiting", restoredOrOmitted: false });
    expect(display.phase).toBe("pre-move");
    expect(display.progress.stationId).toBe("shimbashi");
    expect(display.progress.completedSegmentIds).toEqual([]);
    expect(display.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
    expect(display.compactRoll).toBe("—");
    expect(display.rollText).toBe("—");
  });

  it("follows completed hops while moving and keeps post-turn text unpublished", () => {
    const display = deriveTurnMomentDisplay({ session: moved, network, presentation: resolver, progress: { stationId: "shinagawa", position: [139.738535, 35.628135], completedSegmentIds: ["legacy-yamanote-01"], stepsCompleted: 1 },
      attempt: attemptFor(before), revealStage: "waiting", restoredOrOmitted: false });
    expect(display.phase).toBe("moving");
    expect(display.summaryTurn).toBeNull();
    expect(display.progress.stationId).toBe("shinagawa");
    expect(display.progress.stepsCompleted).toBe(1);
    expect(display.rollText).toBe("—");
    expect(display.lotteryText).toBe("—");
  });

  it("holds the ridden arrival platform and publishes ride, candidates and lottery together after settle", () => {
    const event = moved.lastMove!.landing!;
    expect(event.serviceDrawRequired).toBe(true);
    const settling = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed), attempt: attemptFor(before), revealStage: "lottery-settle", restoredOrOmitted: false });
    expect(settling.phase).toBe("lottery-settle");
    expect(settling.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
    expect(settling.progress.stationId).toBe("shinagawa");
    expect(settling.progress.position).toEqual([139.738535, 35.628135]);
    expect(settling.candidateRows).toEqual([]);
    expect(settling.lotteryText).toBe("—");

    const published = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed), attempt: attemptFor(before), revealStage: "done", restoredOrOmitted: false });
    expect(published.ride).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(published.lotteryText).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(published.candidateRows.map((row) => row.label)).toEqual(["山手線", "テスト南線"]);
    expect(published.rollText).toBe("4");
    expect(published.summaryTurn).toBe(1);
  });

  it("keeps every lottery result hidden through flip and settle, then publishes literal ride and platform together", () => {
    const attempt = attemptFor(before);
    for (const stage of ["arrival", "lottery-flip", "lottery-settle"] as const) {
      const display = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed),
        attempt, revealStage: stage, restoredOrOmitted: false });
      expect(display.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
      expect(display.phase).toBe(stage);
      expect(display.progress.stationId).toBe("shinagawa");
      expect(display.progress.position).toEqual([139.738535, 35.628135]);
      expect(display.compactRoll).toBe("4マス");
      expect(display.rollText).toBe("4");
      expect(display.arrivalText).toBe("1ターン目：品川に到着。踏破 4/30");
      expect(display.lotteryText).toBe("—");
      expect(display.candidateRows).toEqual([]);
      expect(display.markerBearing).toBeCloseTo(225.61, 1);
      expect(display.showClear).toBe(false);
    }
    const display = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed),
      attempt, revealStage: "done", restoredOrOmitted: false });
    expect(display.ride).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(display.markerBearing).toBeCloseTo(194.46, 1);
    expect(display.phase).toBe("published");
    expect(display.progress.position).toEqual([139.741535, 35.628135]);
    expect(display.rollText).toBe("4");
    expect(display.arrivalText).toBe("1ターン目：品川に到着。踏破 4/30");
    expect(display.lotteryText).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(display.candidateRows.map((row) => row.label)).toEqual(["山手線", "テスト南線"]);
  });

  it("uses the ridden service without an attempt while a committed transfer is unpublished", () => {
    for (const stage of ["arrival", "lottery-flip", "lottery-settle"] as const) {
      const display = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed),
        attempt: null, revealStage: stage, restoredOrOmitted: false });
      expect(display.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
      expect(display.lotteryText).toBe("—");
      expect(display.candidateRows).toEqual([]);
    }
    const published = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed),
      attempt: null, revealStage: "done", restoredOrOmitted: false });
    expect(published.ride).toEqual({ serviceId: "fixture-south", direction: 1 });
  });

  it("holds the previous turn text and candidates while the next tumble shows only its placeholder", () => {
    const previous = completed;
    const nextMoved = reduceGameSession(previous, { type: "roll", sessionId: 21, rngSeed: LEGACY_FIXTURE_GAME_SEED, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network);
    const attempt = attemptFor(previous, "tumble");
    attempt.rawRoll = 4;
    const display = deriveTurnMomentDisplay({ session: nextMoved, network, presentation: resolver, progress: progressFor(nextMoved),
      attempt, revealStage: "waiting", restoredOrOmitted: false });
    expect(display.compactRoll).toBe("—");
    expect(display.rollText).toBe("4");
    expect(display.lotteryText).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(display.candidateRows.map((row) => row.label)).toEqual(["山手線", "テスト南線"]);
  });

  it("publishes the raw face after tumble and modifier wording only when stamps begin", () => {
    const base = itemScenario("double", network);
    const item = base.inventory.find((entry) => entry.kind === "double")!;
    const arrived = playItemTurn(base, { command: { items: [{ kind: "double", instanceId: item.id }] } }, network).state;
    const session = resumeSession(arrived, network, 78);
    const record = session.lastMove!.itemRecord;
    if (record?.kind !== "item-ride") throw new Error("Expected engine-built item ride record");
    const attempt = attemptFor(session, "waiting-roll");
    const waiting = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt,
      revealStage: "waiting", restoredOrOmitted: false });
    expect(waiting.compactRoll).toBe("—");
    attempt.stage = "tumble";
    attempt.rawRoll = 1;
    const tumble = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt,
      revealStage: "waiting", restoredOrOmitted: false });
    expect(tumble.compactRoll).toBe("—");
    attempt.stage = "awaiting-adjust";
    const afterTumble = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt,
      revealStage: "waiting", restoredOrOmitted: false });
    expect(afterTumble.compactRoll).toBe("1マス");
    attempt.stage = "stamps";
    const stamped = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt,
      revealStage: "waiting", restoredOrOmitted: false });
    expect(stamped.compactRoll).toBe("2マス ×2");
  });

  it("withholds item physical hops and unused pips during movement, then publishes the literal detail at arrival", () => {
    const base = itemScenario("rapid-long", network);
    const item = base.inventory.find((entry) => entry.kind === "rapid")!;
    const arrived = playItemTurn(base, { command: { items: [{ kind: "rapid", instanceId: item.id }] } }, network).state;
    const session = resumeSession(arrived, network, 79);
    const attempt = attemptFor(resumeSession(base, network, 79), "released");
    const moving = { ...session, phase: "animating" as const };
    const gated = deriveTurnMomentDisplay({ session: moving, network, presentation: resolver, progress: progressFor(moving), attempt,
      revealStage: "waiting", restoredOrOmitted: false });
    expect(gated.rollText).toBe("1（1マス、1駅移動）");
    const arrival = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt,
      revealStage: "arrival", restoredOrOmitted: false });
    expect(arrival.rollText).toBe("5（5マス、13駅移動、残り5は使わず）");
  });

  it("does not publish the final completed-segment set while displayed movement is in progress", () => {
    const attempt = attemptFor(before);
    const movementSession: GameSession = { ...completed, phase: "animating" };
    const display = deriveTurnMomentDisplay({ session: movementSession, network, presentation: resolver,
      progress: { stationId: "shinagawa", position: [139.738535, 35.628135], completedSegmentIds: ["legacy-yamanote-01"], stepsCompleted: 1 },
      attempt, revealStage: "waiting", restoredOrOmitted: false });
    expect(display.phase).toBe("moving");
    expect(display.progress.completedSegmentIds).toEqual(["legacy-yamanote-01"]);
    expect(display.arrivalText).toBeNull();
    expect(display.showClear).toBe(false);
  });

  it("publishes a forced ride when arrival ends without inventing lottery candidates", () => {
    let game = createGame(LEGACY_CAPITAL_REGION_CONFIG, "forced-turn", network);
    let session = resumeSession(game, network, 31);
    for (let turn = 0; turn < 20; turn += 1) {
      const result = playTurn(game, network);
      game = result.state;
      const landing = result.events.find((event) => event.type === "landing-resolved");
      if (landing?.type === "landing-resolved" && !landing.serviceDrawRequired && !landing.directionDrawRequired) {
        session = resumeSession(game, network, 31);
        const arrival = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt: null, revealStage: "arrival", restoredOrOmitted: false });
        const published = deriveTurnMomentDisplay({ session, network, presentation: resolver, progress: progressFor(session), attempt: null, revealStage: "done", restoredOrOmitted: false });
        expect(arrival.phase).toBe("arrival");
        expect(arrival.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
        expect(arrival.progress.stationId).toBe("tamachi");
        expect(arrival.progress.position).toEqual([139.747605, 35.64574]);
        expect(published.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
        expect(published.candidateRows).toEqual([]);
        return;
      }
    }
    throw new Error("Fixture trajectory did not reach a forced ride within 20 turns");
  });

  it("withholds physical hops and unused pips until arrival, and keeps goal clear hidden until publication", () => {
    let game = createGame(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network);
    const states = [game];
    while (game.status === "playing") {
      game = playTurn(game, network).state;
      states.push(game);
    }
    const boundaryGame = states[LEGACY_FIXTURE_SCENARIO_TURNS.boundary]!;
    const boundary = resumeSession(boundaryGame, network, 44);
    const goal = resumeSession(game, network, 45);
    const goalAttempt = attemptFor({ ...goal, game: states.at(-2)! }, "released");
    const boundaryAttempt = attemptFor({ ...boundary, game: states[LEGACY_FIXTURE_SCENARIO_TURNS.boundary - 1]! });
    boundaryAttempt.origin = { ...boundaryAttempt.origin, previousLastMove: null };
    const goalDuringArrival: GameSession = { ...goal, phase: "idle", lastMove: lastMoveOf(game, network) };
    const boundaryMoving: GameSession = { ...boundary, phase: "animating" };
    const gated = deriveTurnMomentDisplay({ session: boundaryMoving, network, presentation: resolver, progress: progressFor(boundaryMoving), attempt: boundaryAttempt,
      revealStage: "arrival", restoredOrOmitted: false });
    expect(gated.rollText).toBe("—");
    const boundaryVisible = deriveTurnMomentDisplay({ session: boundary, network, presentation: resolver, progress: progressFor(boundary), attempt: null, revealStage: "arrival", restoredOrOmitted: false });
    expect(boundaryVisible.rollText).toBe("3（大森で停止〔エリア端〕、残り1は使わず）");
    const goalArrival = deriveTurnMomentDisplay({ session: goalDuringArrival, network, presentation: resolver, progress: progressFor(goalDuringArrival), attempt: goalAttempt, revealStage: "arrival", restoredOrOmitted: false });
    expect(goalArrival.showClear).toBe(false);
    expect(goalArrival.arrivalText).toContain("踏破 30/30");
    const goalPublished = deriveTurnMomentDisplay({ session: goal, network, presentation: resolver, progress: progressFor(goal), attempt: null, revealStage: "done", restoredOrOmitted: false });
    expect(goalPublished.showClear).toBe(true);
    const targetIds = targetSegmentIds(game.config, network);
    expect(targetIds.length).toBe(30);
    expect(targetIds.every((id) => goalPublished.progress.completedSegmentIds.includes(id))).toBe(true);
  });

  it("shows resumed records immediately with no replay stages", () => {
    const restored = resumeSession(completed.game, network, 61);
    const display = deriveTurnMomentDisplay({ session: restored, network, presentation: resolver, progress: progressFor(restored), attempt: null, revealStage: "waiting", restoredOrOmitted: true });
    expect(display.phase).toBe("published");
    expect(display.ride).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(display.lotteryText).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(display.showClear).toBe(false);
  });

  it("uses the revealed ride for its heading and falls back to the incoming direction at an endpoint", () => {
    const target = deriveTurnMomentDisplay({
      session: before, network, presentation: resolver, progress: progressFor(before),
      attempt: attemptFor(before, "waiting-roll"), revealStage: "waiting", restoredOrOmitted: false,
    });
    expect(target.markerBearing).toBeCloseTo(184.55, 1);

    const endpointSession: GameSession = {
      ...before,
      game: { ...before.game, currentStationId: "fixture-omori", currentServiceId: "fixture-south", direction: 1 },
    };
    const endpointProgress = progressFor(endpointSession);
    const endpoint = deriveTurnMomentDisplay({
      session: endpointSession, network, presentation: resolver, progress: endpointProgress,
      attempt: null, revealStage: "waiting", restoredOrOmitted: true,
    });
    expect(endpoint.markerBearing).toBeCloseTo(196.73, 1);
  });
});

describe("shared map guidance publication", () => {
  const session = sessionWithTargetCompletionInHistory();
  const requiredIds = targetSegmentIds(session.game.config, network);
  const lastRequiredSegment = network.segmentsById.get(requiredIds[0]!)!;
  const crossingAttempt: RollAttempt = {
    ...attemptFor(session, "waiting-roll"),
    recordTurn: requiredIds.length,
    origin: {
      ...attemptFor(session).origin,
      stationId: lastRequiredSegment.from,
      ride: { serviceId: lastRequiredSegment.serviceId, direction: 1 },
      completedSegmentIds: requiredIds.slice(1),
      turn: requiredIds.length - 1,
    },
  };

  it("withholds a new 30/30 guidance crossing before arrival and publishes it at arrival", () => {
    const preMove = deriveTurnMomentDisplay({
      session, network, presentation: resolver, progress: progressFor(session),
      attempt: crossingAttempt, revealStage: "waiting", restoredOrOmitted: false,
    });
    expect(preMove.goalGuidance).toBeNull();

    const movingSession = { ...session, phase: "animating" as const };
    const moving = deriveTurnMomentDisplay({
      session: movingSession, network, presentation: resolver,
      progress: { ...progressFor(session), stepsCompleted: 1 },
      attempt: { ...crossingAttempt, stage: "released" }, revealStage: "waiting", restoredOrOmitted: false,
    });
    expect(moving.goalGuidance).toBeNull();

    const arrival = deriveTurnMomentDisplay({
      session, network, presentation: resolver, progress: progressFor(session),
      attempt: { ...crossingAttempt, stage: "released" }, revealStage: "arrival", restoredOrOmitted: false,
    });
    expect(arrival.goalGuidance).toEqual({ stationId: "shimbashi", stationName: "新橋", text: "新橋に着けばクリア" });
    // "重要なときだけ" publishes the arrival through segment-flash instead of the arrival stage.
    const flash = deriveTurnMomentDisplay({
      session, network, presentation: resolver, progress: progressFor(session),
      attempt: { ...crossingAttempt, stage: "released" }, revealStage: "segment-flash", restoredOrOmitted: false,
    });
    expect(flash.phase).toBe("segment-flash");
    expect(flash.goalGuidance).toEqual({ stationId: "shimbashi", stationName: "新橋", text: "新橋に着けばクリア" });
  });

  it("retains published guidance during a later move", () => {
    const laterMove = deriveTurnMomentDisplay({
      session, network, presentation: resolver, progress: progressFor(session),
      attempt: { ...attemptFor(session, "waiting-roll"), recordTurn: session.game.turn + 1 },
      revealStage: "waiting", restoredOrOmitted: false,
    });
    expect(laterMove.phase).toBe("pre-move");
    expect(laterMove.goalGuidance).toEqual({ stationId: "shimbashi", stationName: "新橋", text: "新橋に着けばクリア" });
  });
});

describe("30/30 guidance announcement without presented moments", () => {
  const SENTENCE = "新橋に着けばクリア";
  const base = itemScenario("route", network);
  const requiredIds = targetSegmentIds(base.config, network);
  const played = playItemTurn(base, {}, network).state;
  // The played turn is crafted to complete every target segment (and nothing earlier does).
  const completing = {
    ...played,
    movementHistory: played.movementHistory.map((record, index, history) => ({
      ...record, traversedSegmentIds: index === history.length - 1 ? requiredIds : [] })),
  };
  const origin = resumeSession(base, network, 91);
  const result = resumeSession(completing, network, 91);
  const derive = (phase: "idle" | "animating", revealStage: "waiting" | "done", entryTurn?: number) => deriveTurnMomentDisplay({
    session: { ...result, phase }, network, presentation: resolver, progress: progressFor(result),
    attempt: { ...attemptFor(origin, "released"), policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "none" }) },
    revealStage, restoredOrOmitted: false, itemView: itemSessionView(result, network), entryTurn,
  });

  it("announces the sentence exactly once at publication when the level plans no arrival stage", () => {
    expect(result.game.status).toBe("playing");
    const moving = derive("animating", "waiting");
    expect(moving.goalGuidance).toBeNull();
    expect(moving.announcement).not.toContain(SENTENCE);
    const published = derive("idle", "done");
    expect(published.phase).toBe("published");
    expect(published.announcement.split(SENTENCE)).toHaveLength(2);
  });

  it("does not announce it for a history entered at or after the completing turn", () => {
    expect(derive("idle", "done", result.game.turn).announcement).not.toContain(SENTENCE);
  });
});

describe("S12 arrival and goal publication", () => {
  const base = itemScenario("rapid-long", network);
  const ticket = base.inventory.find((entry) => entry.kind === "rapid")!;
  const goalState = playItemTurn(base, { command: { items: [{ kind: "rapid", instanceId: ticket.id }] } }, network).state;
  const origin = resumeSession(base, network, 81);
  const goal = resumeSession(goalState, network, 81);
  const derive = (session: GameSession, revealStage: "waiting" | "arrival" | "segment-flash" | "done") => deriveTurnMomentDisplay({
    session, network, presentation: resolver, progress: progressFor(session), attempt: attemptFor(origin, "released"),
    revealStage, restoredOrOmitted: false, itemView: itemSessionView(session, network),
  });

  it("announces the raw face and published modifiers during movement, never hops, unused pips or the landing", () => {
    expect(goalState.status).toBe("completed");
    const moving = derive({ ...goal, phase: "animating" }, "waiting");
    expect(moving.phase).toBe("moving");
    // 77駅 is the rapid hop budget the HUD compact roll already shows during movement (the record moved 13 stations).
    expect(moving.announcement).toBe("出目は5、77駅 快速です。移動中です。スキップできます。");
    expect(moving.announcement).not.toMatch(/駅移動|使わず|到着|ゴール/);
    expect(moving.summaryTurn).toBeNull();
  });

  it("does not classify reduced-motion movement copy as a published summary", () => {
    const routeBase = itemScenario("route", network);
    const result = playItemTurn(routeBase, {}, network);
    const publishedSession = resumeSession(result.state, network, 82);
    const movementBoundary = deriveTurnMomentDisplay({
      session: { ...publishedSession, phase: "animating" }, network, presentation: resolver,
      progress: progressFor(publishedSession), attempt: null, revealStage: "done", restoredOrOmitted: true,
      itemView: itemSessionView(publishedSession, network),
    });
    expect(movementBoundary.phase).toBe("published");
    expect(movementBoundary.itemNoticePublished).toBe(true);
    expect(movementBoundary.announcement).toContain("移動中です");
    expect(movementBoundary.summaryTurn).toBeNull();

    const summary = deriveTurnMomentDisplay({
      session: publishedSession, network, presentation: resolver, progress: progressFor(publishedSession),
      attempt: null, revealStage: "done", restoredOrOmitted: true, itemView: itemSessionView(publishedSession, network),
    });
    expect(summary.summaryTurn).toBe(result.record?.turn ?? null);
  });

  it("keeps the goal banner on the panel: no ClearScreen, locked dice and items, Skip available, no goal announcement", () => {
    const arrival = derive(goal, "arrival");
    expect(arrival.phase).toBe("arrival");
    expect(arrival.showClear).toBe(false);
    expect(arrival.canRoll).toBe(false);
    expect(arrival.itemUseLocked).toBe(true);
    expect(arrival.canSkip).toBe(true);
    expect(arrival.goalGuidance).toBeNull();
    expect(arrival.announcement).toBe("8ターン目：新橋に到着。踏破 30/30");
    expect(derive(goal, "segment-flash").goalGuidance).toBeNull();
    expect(arrival.clearAnnouncement).toBe("");
    expect(arrival.toastInputs).toEqual([]);

    // The rapid ticket staged at the roll is spent: no 「この内容で…」 draft comes back during the banner.
    const staged = attemptFor(origin, "released");
    staged.origin = { ...staged.origin, itemView: { ...itemSessionView(origin, network)!,
      draft: { items: [{ kind: "rapid", instanceId: ticket.id }] } } };
    const stagedArrival = deriveTurnMomentDisplay({ session: goal, network, presentation: resolver, progress: progressFor(goal),
      attempt: staged, revealStage: "arrival", restoredOrOmitted: false, itemView: itemSessionView(goal, network) });
    expect(stagedArrival.phase).toBe("arrival");
    expect(stagedArrival.itemView?.draft.items).toEqual([]);
    expect(stagedArrival.itemView?.inventory.map((item) => item.id)).not.toContain(ticket.id);

    const published = derive(goal, "done");
    expect(published.showClear).toBe(true);
    expect(published.canSkip).toBe(false);
    // ClearScreen owns the goal announcement; the panel (being replaced) announces nothing more.
    expect(published.announcement).toBe("");
    expect(published.summaryTurn).toBeNull();
    expect(published.clearAnnouncement).toContain("ゴールに到着しました");
  });
});


describe("S14 lottery announcement boundaries", () => {
  it.each(["arrival", "lottery-flip", "lottery-settle"] as const)("keeps arrival wording during %s and mentions a lottery only for draws", (stage) => {
    const session = resumeSession(playItemTurn(itemScenario("route", network), {}, network).state, network, 91);
    const view = itemSessionView(session, network);
    const landing = session.lastMove!.landing!;
    for (const [serviceDrawRequired, directionDrawRequired] of [[false, false], [true, false], [false, true], [true, true]]) {
      const announcement = turnMomentAnnouncement({ session: { ...session, lastMove: { ...session.lastMove!, landing: {
        ...landing, serviceDrawRequired: serviceDrawRequired!, directionDrawRequired: directionDrawRequired!,
      } } }, view, decision: null, stage, canRoll: false, completedCount: 4, requiredCount: 30, network, presentation: resolver });
      expect(announcement).toBe(`3ターン目：大森に到着。踏破 4/30${serviceDrawRequired || directionDrawRequired ? "。抽選結果を表示しています" : ""}`);
      expect(announcement).not.toContain("品川方面");
    }
  });
});

describe("S15 pickup publication boundary", () => {
  it("publishes the landing ride before pickup while inventory, notice, toast and discard stay masked", () => {
    const base = itemScenario("route", network);
    const committed = playItemTurn(base, {}, network).state;
    const origin = resumeSession(base, network, 95);
    const session = resumeSession(committed, network, 95);
    const originView = itemSessionView(origin, network)!;
    const liveView = itemSessionView(session, network)!;
    const attempt = attemptFor(origin);
    attempt.origin = { ...attempt.origin, itemView: originView };
    const pickupEvent = session.lastMove?.itemRecord?.kind === "item-ride"
      ? session.lastMove.itemRecord.itemEvents.find((event) => event.type === "pickup-retained") : undefined;
    if (pickupEvent?.type !== "pickup-retained") throw new Error("Expected an engine-built retained pickup");

    const during = deriveTurnMomentDisplay({ session, itemView: liveView, network, presentation: resolver,
      progress: progressFor(session), attempt, revealStage: "pickup", restoredOrOmitted: false });
    expect(during.phase).toBe("pickup");
    expect(during.ride).toEqual({ serviceId: "fixture-south", direction: -1 });
    expect(during.itemView?.inventory.map((item) => item.id)).toEqual(originView.inventory.map((item) => item.id));
    expect(during.itemView?.inventory.map((item) => item.id)).not.toContain(pickupEvent.item.id);
    expect(during.decision).toBeNull();
    expect(during.showItemNotice).toBe(false);
    expect(during.toastInputs).toEqual([]);
    expect(during.announcement).toBe("テスト南線のみ ／ エリア端のため折り返し（品川方面）");

    const published = deriveTurnMomentDisplay({ session, itemView: liveView, network, presentation: resolver,
      progress: progressFor(session), attempt, revealStage: "done", restoredOrOmitted: false });
    expect(published.itemView?.inventory.map((item) => item.id)).toContain(pickupEvent.item.id);
    expect(published.showItemNotice).toBe(true);
    expect(published.toastInputs.map((input) => input.text)).toEqual(["快速券を手に入れた！"]);
    expect(published.announcement).toContain("快速券を拾いました");
  });
});


describe("card-less segment flash publication", () => {
  const base = itemScenario("discard", network);
  const result = playItemTurn(base, {}, network);
  const origin = resumeSession(base, network, 101);
  const session = resumeSession(result.state, network, 101);
  const originView = itemSessionView(origin, network)!;
  const liveView = itemSessionView(session, network)!;
  const normal = captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" });
  const attempt: RollAttempt = { ...attemptFor(origin), origin: { ...attemptFor(origin).origin, itemView: originView },
    policy: { ...normal, showArrival: false, timing: { ...normal.timing, arrivalMs: null, flashMs: 180 } },
    newlyCompletedTargetSegmentIds: result.events.flatMap((event) =>
      event.type === "segment-traversed" && event.newlyCompleted && event.serviceId === base.config.targetServiceId
        ? [event.segmentId] : []) };
  const input = { session, network, presentation: resolver, progress: progressFor(session), attempt,
    itemView: liveView, restoredOrOmitted: false, revealKey: `101:${attempt.recordTurn}` };

  it("masks landing, inventory, discard and notices while locking items without an arrival banner", () => {
    expect(liveView.decision?.kind).toBe("discard");
    const display = deriveTurnMomentDisplay({ ...input, revealStage: "segment-flash" });
    expect(display.phase).toBe("segment-flash");
    expect(display.segmentFlash).toMatchObject({ key: input.revealKey, durationMs: 180 });
    expect(display.ride).toEqual(attempt.origin.ride);
    expect(display.candidateRows).toEqual([]);
    expect(display.itemView?.inventory).toEqual(originView.inventory);
    expect(display.decision).toBeNull();
    expect(display.showItemNotice).toBe(false);
    expect(display.itemNoticePublished).toBe(false);
    expect(display.toastInputs).toEqual([]);
    expect(display.itemUseLocked).toBe(true);
    expect(display.canRoll).toBe(false);
    expect(display.canSkip).toBe(true);
    expect(display.showClear).toBe(false);
    expect(display.announcement).not.toMatch(/拾いました|捨てる|サイコロを振れます/);
    expect(turnMomentArrivalModel(display.phase, "segment-flash", "到着駅")).toBeNull();
  });

  it("Skip clears the flash and publishes results while keeping discard mandatory", () => {
    const skipped = { ...attempt, skipRequested: true, motionOmitted: true };
    const display = deriveTurnMomentDisplay({ ...input, attempt: skipped, revealStage: "done" });
    expect(display.phase).toBe("published");
    expect(display.segmentFlash).toBeNull();
    expect(display.itemView).toBe(liveView);
    expect(display.decision).toEqual(liveView.decision);
    expect(display.decision?.kind).toBe("discard");
    expect(display.canRoll).toBe(false);
    expect(display.itemUseLocked).toBe(false);
    expect(display.showItemNotice).toBe(true);
    expect(display.announcement).toContain("捨てるアイテムを1つ選んでください");
  });

  it("publishes one safe announcement at the boundary without announcing hidden pickup results", () => {
    const flash = deriveTurnMomentDisplay({ ...input, revealStage: "segment-flash" });
    const published = deriveTurnMomentDisplay({ ...input, revealStage: "done" });
    const repeated = deriveTurnMomentDisplay({ ...input, revealStage: "done" });
    expect(flash.announcement).toMatch(/到着/);
    expect(flash.announcement).not.toMatch(/拾いました|捨てる/);
    expect(published.announcement).toContain("捨てるアイテムを1つ選んでください");
    expect(repeated.announcement).toBe(published.announcement);
    expect(published.segmentFlash).toBeNull();
  });
});

it.each(["all", "important", "none"] as const)("keeps goal publication and its announcement with %s, with or without new segments", (presentationLevel) => {
  const base = itemScenario("rapid-long", network);
  const ticket = base.inventory.find((item) => item.kind === "rapid")!;
  const result = playItemTurn(base, { command: { items: [{ kind: "rapid", instanceId: ticket.id }] } }, network);
  const origin = resumeSession(base, network, 111);
  const session = resumeSession(result.state, network, 111);
  expect(session.game.status).toBe("completed");
  for (const hasSegments of [false, true]) {
    const attempt = { ...attemptFor(origin), origin: { ...attemptFor(origin).origin, itemView: itemSessionView(origin, network)! },
      policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel }),
      newlyCompletedTargetSegmentIds: hasSegments ? targetSegmentIds(base.config, network) : [] };
    const stages = buildTurnRevealStages({ record: result.record, restored: false, omitted: false,
      newlyCompletedTargetSegmentIds: attempt.newlyCompletedTargetSegmentIds, hasRenderableNewTargetSegments: hasSegments }, attempt.policy);
    const input = { session, network, presentation: resolver, progress: progressFor(session), attempt,
      itemView: itemSessionView(session, network), restoredOrOmitted: false, revealKey: "111:8" };
    const moving = deriveTurnMomentDisplay({ ...input, session: { ...session, phase: "animating" }, revealStage: "done" });
    expect(moving.showClear).toBe(false);
    expect(moving.itemUseLocked).toBe(true);
    expect(moving.announcement).not.toMatch(/到着|ゴール|抽選結果|拾いました/);
    const displays = stages.map(({ key }) => deriveTurnMomentDisplay({ ...input, revealStage: key }));
    for (const display of displays) {
      expect(display.showClear).toBe(false);
      expect(display.clearAnnouncement).toBe("");
      expect(display.announcement).not.toContain("ゴール");
      if (display.phase === "segment-flash") expect(display.segmentFlash).not.toBeNull();
    }
    const published = deriveTurnMomentDisplay({ ...input, revealStage: "done" });
    expect(published.showClear).toBe(true);
    expect(published.announcement).toBe("");
    expect(published.clearAnnouncement.match(/ゴールに到着しました/g)).toHaveLength(1);
    expect(published.itemUseLocked).toBe(false);
  }
});
