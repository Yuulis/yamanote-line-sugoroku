import { describe, expect, it } from "vitest";
import { createItemGame, isItemSave, playItemTurn, targetSegmentIds } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { lastMoveOf, reduceGameSession, resumeSession, startSession, type GameSession, type LastMove } from "../../src/features/game/gameSession";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import { captureTurnPresentationPolicy } from "../../src/features/game/animation/turnMomentPolicy";
import { buildTurnRevealStages, type RollAttempt } from "../../src/features/game/animation/turnMoments";
import { landingText, lastRollText, turnMomentAnnouncement } from "../../src/features/game/presentation";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay, type TurnMomentDisplayInput } from "../../src/features/game/turnMomentPresentation";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { deriveTurnResult, type TurnResultModel } from "../../src/features/game/turnResultCard";
import { LEGACY_FIXTURE_GAME_SEED } from "../e2e/fixtures/seeds";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { loadBundle } from "../e2e/fixtures/bundle";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");
const presentation = createPresentationResolver(network);
const policy = captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" });

function attemptFor(session: GameSession, stage: RollAttempt["stage"] = "released"): RollAttempt {
  const game = session.game;
  return { key: `${session.sessionId}:roll:${game.turn + 1}:0`, sessionId: session.sessionId, recordTurn: game.turn + 1,
    source: "click", origin: { stationId: game.currentStationId, ride: { serviceId: game.currentServiceId, direction: game.direction },
      completedSegmentIds: game.completedSegmentIds, turn: game.turn, itemView: null as never, previousLastMove: session.lastMove },
    policy, stage, rawRoll: null, tumbleCompleted: stage === "released", skipRequested: false, motionOmitted: false,
    adjustObserved: false, recordAccepted: stage === "released", stampsRequired: false, newlyCompletedTargetSegmentIds: [] };
}

function inputFor(session: GameSession, attempt: RollAttempt | null = null, revealStage: TurnMomentDisplayInput["revealStage"] = "done",
  extras: Partial<TurnMomentDisplayInput> = {}): TurnMomentDisplayInput {
  return { session, network, presentation, progress: displayedProgress(sessionProgress(session), network, null), attempt, revealStage,
    restoredOrOmitted: false, ...extras };
}

function expectedCard(session: GameSession, move: LastMove | null, turn: number, itemsPublished: boolean): TurnResultModel | null {
  return deriveTurnResult({ sessionId: session.sessionId, turn, move, records: session.game.movementHistory,
    pending: isItemSave(session.game) ? session.game.pending ?? null : null,
    targetSegmentIds: targetSegmentIds(session.game.config, network), initialServiceId: session.game.config.targetServiceId,
    itemsPublished, network, presentation });
}

function lastMove(session: GameSession): LastMove {
  if (!session.lastMove) throw new Error("Expected an engine-built completed move");
  return session.lastMove;
}

const DELAY_CHAIN_TURNS = 3;
const PRE_PUBLICATION_ROWS: readonly (readonly [RollAttempt["stage"], TurnMomentDisplayInput["revealStage"], boolean])[] = [
  ["waiting-roll", "waiting", false], ["tumble", "waiting", false], ["awaiting-adjust", "waiting", false],
  ["waiting-record", "waiting", false], ["stamps", "waiting", false], ["released", "waiting", true], ["released", "waiting", false],
  ["released", "arrival", false], ["released", "segment-flash", false], ["released", "lottery-flip", false],
  ["released", "lottery-settle", false],
];

/** Visible names of the move's own item events, derived from the engine events (not from chip output). */
function itemEventNames(move: LastMove): readonly string[] {
  return (move.itemRecord?.itemEvents ?? []).flatMap((event) => {
    switch (event.type) {
      case "pickup-retained": case "pickup-pending-discard": case "consumed": return [ITEM_DESCRIPTIONS[event.item.kind].name];
      case "harmful-scheduled": case "cancelled-by-certificate": return [ITEM_DESCRIPTIONS[event.item].name];
      case "effect-activated": return [ITEM_DESCRIPTIONS[event.effect].name];
      default: return [];
    }
  });
}

function cardTexts(card: TurnResultModel | null): readonly string[] {
  return card ? card.chips.flatMap((chip) => [chip.label, chip.text]) : [];
}

/** P (previous) is shown through lottery-settle, C without item chips at pickup, C with its own chips once published. */
function expectPhaseGating(previousSession: GameSession, currentSession: GameSession, requiredEvent: "pickup-retained" | "effect-activated"): void {
  const previousMove = lastMove(previousSession), currentMove = lastMove(currentSession);
  const events = currentMove.itemRecord?.itemEvents ?? [];
  expect(events.some((event) => event.type === requiredEvent), `expected ${requiredEvent}; got ${JSON.stringify(events)}`).toBe(true);
  expect(currentMove.stopStationId, "P and C must land on different stations").not.toBe(previousMove.stopStationId);
  const secretNames = itemEventNames(currentMove);
  const previous = expectedCard(currentSession, previousMove, previousMove.itemRecord!.turn, true)!;
  const currentHidden = expectedCard(currentSession, currentMove, currentMove.itemRecord!.turn, false)!;
  const currentPublished = expectedCard(currentSession, currentMove, currentMove.itemRecord!.turn, true)!;
  expect(previous.heading).not.toBe(currentPublished.heading);
  expect(cardTexts(previous).some((text) => secretNames.some((name) => text.includes(name))),
    `P's own chips must not already name C's items ${secretNames}`).toBe(false);
  const hasPickup = events.some((event) => event.type === "pickup-retained" || event.type === "pickup-pending-discard");
  const rows: readonly (readonly [RollAttempt["stage"], TurnMomentDisplayInput["revealStage"], boolean, TurnResultModel])[] = [
    ...PRE_PUBLICATION_ROWS.map(([stage, reveal, animating]) => [stage, reveal, animating, previous] as const),
    ...(hasPickup ? [["released", "pickup", false, currentHidden] as const] : []),
    ["released", "done", false, currentPublished],
  ];
  for (const [attemptStage, reveal, animating, expected] of rows) {
    const session = animating ? { ...currentSession, phase: "animating" as const } : currentSession;
    const display = deriveTurnMomentDisplay(inputFor(session, attemptFor(previousSession, attemptStage), reveal));
    const card = display.turnResult;
    expect(card, `${display.phase} via ${attemptStage}/${reveal}`).toEqual(expected);
    expect([card?.heading, card?.moveText, card?.ride.text, card?.compact.text, card?.compact.accessibleName])
      .toEqual([expected.heading, expected.moveText, expected.ride.text, expected.compact.text, expected.compact.accessibleName]);
    expect(card?.chips.map((chip) => chip.label)).toEqual(expected.chips.map((chip) => chip.label));
    const compact = [card?.compact.text ?? "", card?.compact.accessibleName ?? ""];
    expect(compact.some((text) => secretNames.some((name) => text.includes(name))), `${display.phase} compact leaked`).toBe(false);
    if (display.phase !== "published") {
      expect(cardTexts(card).some((text) => secretNames.some((name) => text.includes(name))), `${display.phase} leaked ${secretNames}`).toBe(false);
    }
  }
  expect(secretNames.length).toBeGreaterThan(0);
  expect(secretNames.every((name) => cardTexts(currentPublished).some((text) => text.includes(name))),
    `published chips must name ${secretNames}`).toBe(true);
}

describe("turn-result publication integration", () => {
  const previousGame = itemScenario("rapid-long", network);
  const currentGame = playItemTurn(previousGame, {}, network).state;
  const previousSession = resumeSession(previousGame, network, 501);
  const currentSession = resumeSession(currentGame, network, 501);
  const previousMove = lastMove(previousSession);
  const currentMove = lastMove(currentSession);
  const attempt = attemptFor(previousSession);

  it("selects complete previous/current cards at every publication phase (pickup turn)", () => {
    expectPhaseGating(previousSession, currentSession, "pickup-retained");
  });

  it("withholds a current-turn activated effect until publication (effect turn)", () => {
    let base = itemScenario("delay", network);
    for (let turn = 0; turn < DELAY_CHAIN_TURNS; turn += 1) base = playItemTurn(base, {}, network).state;
    const next = playItemTurn(base, {}, network).state;
    expectPhaseGating(resumeSession(base, network, 509), resumeSession(next, network, 509), "effect-activated");
  });

  it("shows the new cross-service ride at pickup while retaining publication-owned chips", () => {
    const base = itemScenario("route", network);
    const oldSession = resumeSession(base, network, 502);
    const moved = resumeSession(playItemTurn(base, {}, network).state, network, 502);
    const oldMove = lastMove(oldSession), newMove = lastMove(moved), roll = attemptFor(oldSession);
    expect(newMove.itemRecord?.itemEvents.some((event) => event.type === "pickup-retained")).toBe(true);
    const oldCard = deriveTurnMomentDisplay(inputFor(moved, roll, "lottery-settle")).turnResult!;
    const newCard = deriveTurnMomentDisplay(inputFor(moved, roll, "pickup")).turnResult!;
    expect(newCard.turn).toBe(newMove.itemRecord!.turn);
    expect(newCard.ride.text).not.toBe(oldCard.ride.text);
    expect(newCard.ride.text).toBe(expectedCard(moved, newMove, newMove.itemRecord!.turn, false)?.ride.text);
    expect(oldCard.turn).toBe(oldMove.itemRecord!.turn);
  });

  it("keeps a pending-discard pickup unpublished until the published boundary and counts segments once", () => {
    const base = itemScenario("discard", network), next = playItemTurn(base, {}, network).state;
    if (next.pending?.kind !== "discard") throw new Error(`Expected pending discard; got ${next.pending?.kind ?? "none"}`);
    const old = resumeSession(base, network, 503), current = resumeSession(next, network, 503), roll = attemptFor(old);
    const held = deriveTurnMomentDisplay(inputFor(current, roll, "lottery-settle")).turnResult!;
    const shown = deriveTurnMomentDisplay(inputFor(current, roll, "done")).turnResult!;
    expect(held.turn).toBe(lastMove(old).itemRecord!.turn);
    expect(shown.turn).toBe(next.pending.record.turn);
    expect(shown.chips.some((chip) => chip.kind === "pickup" && chip.label.endsWith("（選択待ち）"))).toBe(true);
    const seenBefore = new Set(base.movementHistory.flatMap((record) => record.traversedSegmentIds));
    const targets = new Set(targetSegmentIds(next.config, network));
    const expectedNew = new Set(next.pending.record.traversedSegmentIds.filter((id) => targets.has(id) && !seenBefore.has(id))).size;
    expect(expectedNew, `pending record should complete a new target segment: ${next.pending.record.traversedSegmentIds}`).toBeGreaterThan(0);
    const segmentChips = shown.chips.filter((chip) => chip.kind === "segments");
    expect(segmentChips.map((chip) => [chip.label, chip.kind === "segments" ? chip.count : null])).toEqual([[`+${expectedNew}区間`, expectedNew]]);
    expect(shown.compact.segmentsText).toBe(`+${expectedNew}区間`);
  });

  it("uses the existing none, Skip, reduced-motion, resume and auto-roll boundaries", () => {
    const nonePolicy = captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "none" });
    expect(buildTurnRevealStages({ record: currentMove.itemRecord!, restored: false, newlyCompletedTargetSegmentIds: [],
      hasRenderableNewTargetSegments: false, omitted: false }, nonePolicy)).toEqual([]);
    const noneAttempt = { ...attempt, policy: nonePolicy };
    expect(deriveTurnMomentDisplay(inputFor(currentSession, { ...noneAttempt, stage: "waiting-roll" }, "waiting")).turnResult?.turn).toBe(previousMove.itemRecord!.turn);
    expect(deriveTurnMomentDisplay(inputFor({ ...currentSession, phase: "animating" }, noneAttempt, "waiting")).turnResult?.turn).toBe(previousMove.itemRecord!.turn);
    expect(deriveTurnMomentDisplay(inputFor(currentSession, noneAttempt, "done")).turnResult).toEqual(
      expectedCard(currentSession, currentMove, currentMove.itemRecord!.turn, true));

    const skipped = { ...attempt, skipRequested: true, motionOmitted: true };
    const skipDisplay = deriveTurnMomentDisplay(inputFor(currentSession, skipped, "done"));
    expect(skipDisplay.phase).toBe("published");
    expect(skipDisplay.turnResult?.turn).toBe(currentMove.itemRecord!.turn);
    const omitted = deriveTurnMomentDisplay(inputFor(currentSession, { ...attempt, stage: "waiting-roll" }, "waiting", { restoredOrOmitted: true }));
    expect(omitted.turnResult?.turn).toBe(currentMove.itemRecord!.turn);
    expect(omitted.turnResult?.chips.map((chip) => chip.label)).toEqual(expectedCard(currentSession, currentMove, currentMove.itemRecord!.turn, true)?.chips.map((chip) => chip.label));

    const resumed = resumeSession(currentGame, network, 504);
    expect(deriveTurnMomentDisplay(inputFor(resumed)).turnResult).toEqual(expectedCard(resumed, lastMove(resumed), currentMove.itemRecord!.turn, true));
    const freshGame = createItemGame(ITEM_GAME_CONFIG, "fresh-turn-zero", network);
    const fresh = resumeSession(freshGame, network, 505);
    expect(deriveTurnMomentDisplay(inputFor(fresh)).turnResult).toBeNull();
    const firstItemTurn = resumeSession(playItemTurn(freshGame, {}, network).state, network, 507);
    expect(deriveTurnMomentDisplay(inputFor({ ...firstItemTurn, phase: "animating" }, null, "waiting")).turnResult).toBeNull();
    const pendingGame = playItemTurn(itemScenario("discard", network), {}, network).state;
    if (pendingGame.pending?.kind !== "discard") throw new Error(`Expected pending discard; got ${pendingGame.pending?.kind ?? "none"}`);
    const pendingResume = resumeSession(pendingGame, network, 508);
    expect(deriveTurnMomentDisplay(inputFor(pendingResume)).turnResult?.turn).toBe(pendingGame.pending.record.turn);

    const nextGame = playItemTurn(currentGame, {}, network).state, nextSession = resumeSession(nextGame, network, 506);
    const autoAttempt = attemptFor(resumed);
    const autoRows = [["waiting-roll", "idle", "waiting"], ["released", "animating", "waiting"], ["released", "idle", "done"]] as const;
    for (const [stage, sessionPhase, reveal] of autoRows) {
      const shown = deriveTurnMomentDisplay(inputFor({ ...nextSession, phase: sessionPhase }, { ...autoAttempt, stage }, reveal));
      if (reveal === "waiting") {
        expect(shown.turnResult?.turn).toBe(currentMove.itemRecord!.turn);
        expect(shown.turnResult?.chips.map((chip) => chip.label)).toEqual(expectedCard(nextSession, lastMove(resumed), currentMove.itemRecord!.turn, true)?.chips.map((chip) => chip.label));
      } else expect(shown.turnResult?.turn).toBe(lastMove(nextSession).itemRecord!.turn);
    }
  });

  it("protects classic animation history, even with contradictory restored flags", () => {
    const start = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 601);
    const first = reduceGameSession(start, { type: "roll", sessionId: 601, rngSeed: start.game.rngSeed, turn: 0 }, LEGACY_CAPITAL_REGION_CONFIG, network);
    expect(first.game.movementHistory).toHaveLength(1);
    expect(deriveTurnMomentDisplay(inputFor(first)).turnResult).toBeNull();
    expect(deriveTurnMomentDisplay(inputFor(first, null, "done", { restoredOrOmitted: true, restoredHistory: true })).turnResult).toBeNull();
    const firstIdle = reduceGameSession(first, { type: "animation-finished", sessionId: 601, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network);
    const second = reduceGameSession(firstIdle, { type: "roll", sessionId: 601, rngSeed: start.game.rngSeed, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network);
    if (isItemSave(second.game)) throw new Error("Expected a classic session");
    const records = second.game.movementHistory, previousRecord = records.at(-2)!;
    const reconstructed = lastMoveOf({ ...second.game, movementHistory: records.slice(0, -1) }, network)!;
    const movingCard = deriveTurnMomentDisplay(inputFor(second, null, "done")).turnResult!;
    const contradictory = deriveTurnMomentDisplay(inputFor(second, null, "done", { restoredOrOmitted: true, restoredHistory: true })).turnResult!;
    expect(movingCard.turn).toBe(previousRecord.turn);
    expect(movingCard.arrivalStation).toBe(presentation.stationName(reconstructed.stopStationId));
    expect(movingCard.ride.text).toBe(expectedCard(resumeSession({ ...second.game, movementHistory: records.slice(0, -1) }, network, 602), reconstructed, previousRecord.turn, true)?.ride.text);
    expect(contradictory).toEqual(movingCard);
    const idle = reduceGameSession(second, { type: "animation-finished", sessionId: 601, turn: 2 }, LEGACY_CAPITAL_REGION_CONFIG, network);
    expect(deriveTurnMomentDisplay(inputFor(idle)).turnResult?.turn).toBe(records.at(-1)!.turn);
  });

  it("preserves every existing display field for a representative pre-move presentation", () => {
    const source = inputFor(currentSession, attemptFor(previousSession, "tumble"), "waiting");
    const display = deriveTurnMomentDisplay(source);
    const previous = source.attempt!.origin.previousLastMove;
    expect({ phase: display.phase, turn: display.turn, rollText: display.rollText, lotteryText: display.lotteryText,
      showItemNotice: display.showItemNotice, itemNoticeMove: display.itemNoticeMove, effectModels: display.effectModels,
      announcement: display.announcement }).toEqual({
      phase: "pre-move", turn: previousSession.game.turn, rollText: lastRollText(previous, network, presentation),
      lotteryText: landingText(previous, network, presentation), showItemNotice: false, itemNoticeMove: null, effectModels: [],
      announcement: turnMomentAnnouncement({ session: currentSession, view: null, decision: null, stage: "tumble", canRoll: false,
        completedCount: 0, requiredCount: targetSegmentIds(currentSession.game.config, network).length, network, presentation }),
    });
  });
});
