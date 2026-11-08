import { describe, expect, it } from "vitest";
import { createGame, playItemTurn, playTurn, targetSegmentIds } from "../../src/features/game/engine";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import { captureTurnPresentationPolicy } from "../../src/features/game/animation/turnMomentPolicy";
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
      expect(display.showClear).toBe(false);
    }
    const display = deriveTurnMomentDisplay({ session: completed, network, presentation: resolver, progress: progressFor(completed),
      attempt, revealStage: "done", restoredOrOmitted: false });
    expect(display.ride).toEqual({ serviceId: "fixture-south", direction: 1 });
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
});

describe("S12 arrival and goal publication", () => {
  const base = itemScenario("rapid-long", network);
  const ticket = base.inventory.find((entry) => entry.kind === "rapid")!;
  const goalState = playItemTurn(base, { command: { items: [{ kind: "rapid", instanceId: ticket.id }] } }, network).state;
  const origin = resumeSession(base, network, 81);
  const goal = resumeSession(goalState, network, 81);
  const derive = (session: GameSession, revealStage: "waiting" | "arrival" | "done") => deriveTurnMomentDisplay({
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
  });

  it("keeps the goal banner on the panel: no ClearScreen, locked dice and items, Skip available, no goal announcement", () => {
    const arrival = derive(goal, "arrival");
    expect(arrival.phase).toBe("arrival");
    expect(arrival.showClear).toBe(false);
    expect(arrival.canRoll).toBe(false);
    expect(arrival.itemUseLocked).toBe(true);
    expect(arrival.canSkip).toBe(true);
    expect(arrival.announcement).toBe("8ターン目：新橋に到着。踏破 30/30");
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
