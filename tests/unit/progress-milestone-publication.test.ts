import { describe, expect, it } from "vitest";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import type { RollAttempt } from "../../src/features/game/animation/turnMoments";
import { captureTurnPresentationPolicy } from "../../src/features/game/animation/turnMomentPolicy";
import { playItemTurn, targetSegmentIds } from "../../src/features/game/engine";
import { resumeSession, startSession, type GameSession } from "../../src/features/game/gameSession";
import { itemSessionView } from "../../src/features/game/itemSession";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveProgressCrossings } from "../../src/features/game/progressMilestones";
import { progressMilestoneToast, targetSegmentsMilestoneToast } from "../../src/features/game/toastQueue";
import { deriveTurnMomentDisplay, type TurnMomentDisplay, type TurnRevealState } from "../../src/features/game/turnMomentPresentation";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { LEGACY_FIXTURE_GAME_SEED } from "../e2e/fixtures/seeds";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");
const presentation = createPresentationResolver(network);
const SESSION_ID = 79;
const origin = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, SESSION_ID);
const required = targetSegmentIds(origin.game.config, network);
const key = (threshold: number): string => `${SESSION_ID}:milestone:target-segments:${threshold}`;
const keys = (result: TurnMomentDisplay): string[] => result.toastInputs.map((toast) => toast.key);

interface Scenario { phase?: "idle" | "animating"; stage?: TurnRevealState; level?: "all" | "important" | "none"; entryTurn?: number;
  omitted?: boolean; skip?: boolean; restored?: boolean; jump?: boolean; clear?: boolean; laterTurn?: boolean }

/** Derives the turn `recordTurn` that took `before` to `session`, at the arrival stage unless `options` say otherwise. */
function derive(session: GameSession, before: GameSession, recordTurn: number, options: Scenario): TurnMomentDisplay {
  const attempt: RollAttempt = {
    key: `${SESSION_ID}:roll:${recordTurn}:0`, sessionId: SESSION_ID, recordTurn, source: "click",
    origin: { stationId: before.game.currentStationId, ride: { serviceId: before.game.currentServiceId, direction: before.game.direction },
      completedSegmentIds: before.game.completedSegmentIds, turn: recordTurn - 1, itemView: itemSessionView(before, network) as never,
      previousLastMove: before.lastMove },
    policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: options.level ?? "all" }),
    stage: "released", rawRoll: 1, tumbleCompleted: true, skipRequested: options.skip ?? false, motionOmitted: options.omitted ?? false,
    adjustObserved: false, recordAccepted: true, stampsRequired: false, newlyCompletedTargetSegmentIds: [],
  };
  return deriveTurnMomentDisplay({ session: { ...session, phase: options.phase ?? "idle" }, network, presentation,
    progress: displayedProgress(sessionProgress(session), network, null), attempt: options.laterTurn ? null : attempt,
    revealStage: options.stage ?? "arrival", restoredOrOmitted: options.restored ?? false,
    itemView: itemSessionView(session, network), entryTurn: options.entryTurn });
}

/** A classic game that completed `count` target segments, one per turn (or all of them in turn 1 with `jump`). */
function display(count: number, options: Scenario = {}): TurnMomentDisplay {
  const records = (options.jump ? [required.slice(0, count)] : required.slice(0, count).map((id) => [id])).map((ids, index) => {
    const { serviceId, from, to } = network.segmentsById.get(ids.at(-1)!)!;
    return { turn: index + 1, roll: 1, serviceId, direction: 1 as const, fromStationId: from, toStationId: to, traversedSegmentIds: ids, stopReason: "roll" as const, landing: null };
  });
  const game = { ...origin.game, status: options.clear ? "completed" as const : "playing" as const, turn: records.length + (options.laterTurn ? 1 : 0),
    currentStationId: records.at(-1)!.toStationId, currentServiceId: LEGACY_CAPITAL_REGION_CONFIG.targetServiceId,
    completedSegmentIds: required.slice(0, count), movementHistory: records };
  const before = resumeSession({ ...game, turn: records.length - 1, currentStationId: records.at(-2)?.toStationId ?? origin.game.currentStationId,
    completedSegmentIds: options.jump ? [] : required.slice(0, count - 1), movementHistory: records.slice(0, -1) }, network, SESSION_ID);
  return derive(resumeSession(game, network, SESSION_ID), before, records.length, options);
}

describe("milestone publication", () => {
  it("publishes nothing while moving, then the toast, sentence and flash with the arrival", () => {
    for (const moving of [display(10, { phase: "animating" }), display(10, { phase: "animating", restored: true, omitted: true })]) {
      expect(moving).toMatchObject({ toastInputs: [], milestoneFlash: null });
      expect(moving.announcement).not.toContain("10区間突破！");
    }
    const arrival = display(10);
    expect(keys(arrival)).toEqual([key(10)]);
    expect(arrival.announcement).toMatch(/。10区間突破！$/);
    expect(arrival.milestoneFlash).toEqual({ key: `${SESSION_ID}:10:10`, threshold: 10 });
    expect(display(10, { omitted: true }).milestoneFlash).toBeNull();
  });

  it.each(["segment-flash", "lottery-flip", "lottery-settle"] as const)("keeps the arrival announcement unchanged through %s", (stage) => {
    expect(display(10, { stage }).announcement).toBe(display(10).announcement);
    const completion = display(required.length, { jump: true });
    expect(completion.announcement).toContain(completion.goalGuidance!.text);
    expect(display(required.length, { jump: true, stage }).announcement).toBe(completion.announcement);
  });

  it("notifies only the fresh crossing: earlier thresholds and the entered turn stay silent", () => {
    expect(keys(display(20))).toEqual([key(20)]);
    expect(keys(display(21))).toEqual([]);
    const entered = display(20, { stage: "done", restored: true, entryTurn: 20 });
    expect(entered).toMatchObject({ toastInputs: [], milestoneFlash: null });
    expect(entered.announcement).not.toMatch(/区間突破/);
    expect(keys(display(20, { entryTurn: 19 }))).toEqual([key(20)]);
  });

  it("keeps the 30/30 path as it was: its own toast on and after the completing turn, no fallback, no flash", () => {
    const expected = [targetSegmentsMilestoneToast(SESSION_ID, 1, presentation.stationName(LEGACY_CAPITAL_REGION_CONFIG.startStationId))];
    expect(display(required.length, { jump: true })).toMatchObject({ toastInputs: expected, milestoneFlash: null });
    expect(display(required.length, { jump: true, laterTurn: true, stage: "done" }).toastInputs).toEqual(expected);
    expect(keys(display(required.length))).toEqual([key(30)]);
    expect(display(required.length, { jump: true, clear: true, stage: "done" })).toMatchObject({ toastInputs: [], milestoneFlash: null });
  });
});

describe("milestone publication of an engine-played item turn with a pending discard", () => {
  const base = itemScenario("discard", network);
  const played = playItemTurn(base, {}, network).state;
  if (played.pending?.kind !== "discard") throw new Error("Expected an engine-built pending discard");
  const record = played.pending.record;
  const crossing = deriveProgressCrossings([...played.movementHistory, record], targetSegmentIds(base.config, network))
    .find(({ turn }) => turn === record.turn);
  if (!crossing) throw new Error(`Expected turn ${record.turn} to cross a threshold (${played.completedSegmentIds.length} segments completed)`);
  const sentence = progressMilestoneToast(SESSION_ID, crossing).text;
  const result = (options: Scenario): TurnMomentDisplay =>
    derive(resumeSession(played, network, SESSION_ID), resumeSession(base, network, SESSION_ID), record.turn, options);

  it("queues the toast with the arrival card and does not repeat the notification with the results", () => {
    expect(keys(result({}))).toEqual([key(crossing.threshold)]);
    const published = result({ stage: "done" });
    expect(keys(published)).not.toContain(key(crossing.threshold));
    expect(published.announcement).not.toContain(sentence);
    expect(published.milestoneFlash?.threshold).toBe(crossing.threshold);
  });

  it("重要なときだけ announces and flashes with the segment flash, and queues the toast with the results", () => {
    const flash = result({ level: "important", stage: "segment-flash" });
    expect(flash.toastInputs).toEqual([]);
    expect(flash.announcement).toContain(sentence);
    expect(flash.milestoneFlash?.threshold).toBe(crossing.threshold);
    const published = result({ level: "important", stage: "done" });
    expect(published.decision?.kind).toBe("discard");
    expect(keys(published).indexOf(key(crossing.threshold))).toBe(0);
    expect(keys(published).length).toBeGreaterThan(1);
    expect(published.announcement).not.toContain(sentence);
  });

  it.each([["演出なし", { level: "none" }], ["OS reduced motion", { restored: true, omitted: true }], ["Skip", { skip: true, omitted: true }]] as const)(
    "%s publishes the toast before the item events and the sentence with the results, without a flash", (_name, options) => {
      const published = result({ ...options, stage: "done" });
      expect(keys(published).indexOf(key(crossing.threshold))).toBe(0);
      expect(keys(published).length).toBeGreaterThan(1);
      expect(published.announcement).toContain(sentence);
      expect(published.milestoneFlash).toBeNull();
    });
});
