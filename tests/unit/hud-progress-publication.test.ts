import { describe, expect, it } from "vitest";
import { isItemSave, playItemTurn, targetHopDistances, type ItemGameState } from "../../src/features/game/engine";
import type { Direction } from "../../src/types/network";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import { captureTurnPresentationPolicy } from "../../src/features/game/animation/turnMomentPolicy";
import type { RollAttempt } from "../../src/features/game/animation/turnMoments";
import { reduceGameSession, resumeSession, startSession, type GameSession } from "../../src/features/game/gameSession";
import { itemSessionView, type ItemSessionView } from "../../src/features/game/itemSession";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveCollectionProgress } from "../../src/features/game/collectionProgress";
import { deriveTargetProximity } from "../../src/features/game/targetProximity";
import { deriveTurnMomentDisplay, type TurnRevealState } from "../../src/features/game/turnMomentPresentation";
import { loadBundle } from "../e2e/fixtures/bundle";
import { LEGACY_FIXTURE_GAME_SEED } from "../e2e/fixtures/seeds";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";
import { itemScenario } from "../e2e/fixtures/itemScenarios";

const { network } = await loadBundle("fixture");
const presentation = createPresentationResolver(network);
const before = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 65);
const committed = reduceGameSession(before, { type: "roll", sessionId: 65, rngSeed: LEGACY_FIXTURE_GAME_SEED, turn: 0 }, LEGACY_CAPITAL_REGION_CONFIG, network);
const record = committed.game.movementHistory.at(-1)!;
const completed = reduceGameSession(committed, { type: "animation-finished", sessionId: 65, turn: 1 }, LEGACY_CAPITAL_REGION_CONFIG, network);

function attemptFor(stage: RollAttempt["stage"] = "released"): RollAttempt {
  return {
    key: "65:roll:1:0", sessionId: 65, recordTurn: 1, source: "click",
    origin: { stationId: before.game.currentStationId, ride: { serviceId: before.game.currentServiceId, direction: before.game.direction },
      completedSegmentIds: [], turn: 0, itemView: null as never, previousLastMove: null },
    policy: captureTurnPresentationPolicy({ speedId: "normal", presentationLevel: "all" }), stage, rawRoll: null,
    tumbleCompleted: true, skipRequested: false, motionOmitted: false, adjustObserved: false, recordAccepted: true,
    stampsRequired: false, newlyCompletedTargetSegmentIds: [],
  };
}

function progress(session: GameSession) { return displayedProgress(sessionProgress(session), network, null); }

function itemVisits(game: ItemGameState) {
  return game.movementHistory.map((record) => ({ traversedSegmentIds: record.traversedSegmentIds,
    ...(record.kind === "deadhead" ? { relocationDestinationId: record.toStationId } : {}) }));
}

function display(session: GameSession, attempt: RollAttempt | null = null, revealStage: TurnRevealState = "done", omitted = true,
  itemView: ItemSessionView | null = null, shownProgress = progress(session)) {
  return deriveTurnMomentDisplay({ session, network, presentation, progress: shownProgress, attempt, revealStage, restoredOrOmitted: omitted, itemView });
}

function proximityAt(stationId: string, ride: Readonly<{ serviceId: string; direction: Direction }>) {
  return deriveTargetProximity({ stationId, ride, targetServiceId: "fixture-west", targetComplete: false }, network);
}

function projectWestTarget(session: GameSession): GameSession {
  if (isItemSave(session.game)) throw new Error("West target projection requires a classic replay");
  return { ...session, game: { ...session.game, config: { ...session.game.config, targetServiceId: "fixture-west" } } };
}

describe("HUD progress publication", () => {
  it("gates the committed record, reveals the moving prefix, then publishes the full traversal", () => {
    const preMove = display(committed, attemptFor("tumble"), "waiting", false);
    expect(preMove.collection.visitedStations).toBe(1);
    const firstSegment = network.segmentsById.get(record.traversedSegmentIds[0]!)!;
    const partial = { ...progress(committed), stationId: firstSegment.to, stepsCompleted: 1 };
    const moving = display(committed, null, "waiting", false, null, partial);
    expect(moving.phase).toBe("moving");
    expect(moving.collection.visitedStations).toBe(2);
    const expected = deriveCollectionProgress(LEGACY_CAPITAL_REGION_CONFIG.startStationId,
      [{ traversedSegmentIds: record.traversedSegmentIds }], network, presentation);
    for (const stage of ["arrival", "lottery-flip", "lottery-settle", "published"] as const) {
      const shown = display(completed, attemptFor(), stage === "published" ? "done" : stage, stage === "published");
      expect(shown.collection).toEqual(expected);
    }
    const picked = itemScenario("double", network);
    const last = picked.movementHistory.at(-1)!;
    const pickupRecord = { ...last, itemEvents: [...last.itemEvents, { type: "pickup-retained" as const, item: { id: "fixture-pickup", kind: "double" as const } }] };
    const pickupGame = { ...picked, movementHistory: [...picked.movementHistory.slice(0, -1), pickupRecord] };
    const pickup = display(resumeSession(pickupGame, network, 69), null, "pickup", false);
    expect(pickup.phase).toBe("pickup");
    expect(pickup.collection).toEqual(display(resumeSession(picked, network, 69)).collection);
  });

  it("uses the displayed ride for proximity and ignores a staged route ticket", () => {
    const itemGame = itemScenario("route", network);
    const distances = targetHopDistances(network, itemGame.config.targetServiceId);
    const location = [...network.stationsById.keys()].find((stationId) => (distances.get(stationId) ?? 0) > 0
      && [...network.servicesByStation.get(stationId) ?? []].some((serviceId) => serviceId !== itemGame.config.targetServiceId));
    if (!location) throw new Error("Fixture network has no non-target station with an external service");
    const external = [...network.servicesByStation.get(location) ?? []].find((serviceId) => serviceId !== itemGame.config.targetServiceId)!;
    const session = resumeSession({ ...itemGame, currentStationId: location, currentServiceId: external }, network, 66);
    const view = itemSessionView(session, network);
    if (!view) throw new Error("Expected item presentation for route-ticket fixture");
    const plain = display(session, null, "done", true, view);
    const staged = display(session, null, "done", true,
      { ...view, draft: { items: [{ kind: "route-ticket", instanceId: "staged", serviceId: itemGame.config.targetServiceId }] } });
    expect(plain.proximity).not.toBeNull();
    expect(staged.proximity).toEqual(plain.proximity);
  });

  it("publishes proximity from the visible station and ride through lottery, pickup, skip and resume", () => {
    const origin = projectWestTarget(committed);
    const arrival = projectWestTarget(completed);
    if ("kind" in record) throw new Error("Transfer fixture produced an item record");
    const firstHop = network.segmentsById.get(record.traversedSegmentIds[0]!);
    if (!firstHop || completed.game.currentServiceId === record.serviceId) throw new Error(`Transfer fixture changed: ${JSON.stringify({ record, ride: completed.game.currentServiceId })}`);
    const oldRide = { serviceId: record.serviceId, direction: record.direction };
    const expectedOrigin = proximityAt(before.game.currentStationId, oldRide);
    const expectedMid = proximityAt(firstHop.to, oldRide);
    const expectedArrival = proximityAt(record.toStationId, oldRide);
    const expectedPublished = proximityAt(record.toStationId, { serviceId: completed.game.currentServiceId, direction: completed.game.direction });
    if (!expectedOrigin || !expectedMid || !expectedArrival || !expectedPublished) throw new Error(`Proximity fixture is unreachable: ${JSON.stringify({ expectedOrigin, expectedMid, expectedArrival, expectedPublished })}`);
    expect(new Set([expectedOrigin.text, expectedMid.text, expectedArrival.text]).size).toBe(3);
    expect(expectedArrival.text).not.toBe(expectedPublished.text);
    expect(display(origin, attemptFor("tumble"), "waiting", false).proximity).toEqual(expectedOrigin);
    expect(display(origin, null, "waiting", false, null, { ...progress(origin), stationId: firstHop.to, stepsCompleted: 1 }).proximity).toEqual(expectedMid);
    for (const stage of ["arrival", "lottery-flip", "lottery-settle"] as const) expect(display(arrival, attemptFor(), stage, false).proximity).toEqual(expectedArrival);
    expect(display(arrival, attemptFor(), "done", false).proximity).toEqual(expectedPublished);
    const skipped = display(arrival, { ...attemptFor(), skipRequested: true, motionOmitted: true }, "done", true);
    const resumed = display(resumeSession(arrival.game, network, 70));
    expect(skipped.proximity).toEqual(expectedPublished);
    expect(resumed.proximity).toEqual(expectedPublished);

    const pickupBase = itemScenario("double", network);
    const pickupRecord = pickupBase.movementHistory.at(-1)!;
    const pickupGame = { ...pickupBase, config: { ...pickupBase.config, targetServiceId: "fixture-west" },
      movementHistory: [...pickupBase.movementHistory.slice(0, -1), { ...pickupRecord,
        itemEvents: [...pickupRecord.itemEvents, { type: "pickup-retained" as const, item: { id: "fixture-pickup", kind: "double" as const } }] }] };
    const pickupSession = resumeSession(pickupGame, network, 69);
    const pickup = display(pickupSession, null, "pickup", false);
    expect(pickup.phase).toBe("pickup");
    expect(pickup.proximity).not.toBeNull();
    expect(pickup.proximity).toEqual(proximityAt(pickup.progress.stationId, pickup.ride));
    expect(display(pickupSession, null, "done", true).proximity).toEqual(pickup.proximity);
  });

  it("counts deadhead arrival and a pending discard record once", () => {
    const deadhead = itemScenario("deadhead", network);
    const ticket = deadhead.inventory.find(({ kind }) => kind === "deadhead");
    if (!ticket) throw new Error(`Deadhead fixture has no ticket: ${JSON.stringify(deadhead.inventory.map(({ kind }) => kind))}`);
    const arrivalState = playItemTurn(deadhead, { command: { items: [{ kind: "deadhead", instanceId: ticket.id }] } }, network).state;
    const destination = arrivalState.movementHistory.at(-1);
    if (destination?.kind !== "deadhead") throw new Error(`Deadhead play produced ${destination?.kind ?? "no record"}`);
    const session = resumeSession(arrivalState, network, 67);
    const preAttempt = attemptFor("tumble");
    const preMove = display(session, { ...preAttempt, recordTurn: destination.turn,
      origin: { ...preAttempt.origin, stationId: destination.fromStationId, turn: destination.turn - 1 } }, "waiting", false);
    const arrival = display(session, { ...preAttempt, stage: "released", recordTurn: destination.turn }, "arrival", false);
    const withoutDeadhead = deriveCollectionProgress(deadhead.config.startStationId,
      itemVisits({ ...arrivalState, movementHistory: arrivalState.movementHistory.slice(0, -1) }), network, presentation);
    const expectedDeadhead = deriveCollectionProgress(deadhead.config.startStationId, itemVisits(arrivalState), network, presentation);
    expect(preMove.collection).toEqual(withoutDeadhead);
    expect(arrival.phase).toBe("arrival");
    expect(arrival.collection).toEqual(expectedDeadhead);

    const pendingGame = itemScenario("discard", network);
    const pendingRecord = pendingGame.movementHistory.at(-1);
    if (!pendingRecord) throw new Error("Discard fixture has no movement record");
    const visited = new Set([pendingGame.config.startStationId]);
    for (const { traversedSegmentIds } of itemVisits(pendingGame)) for (const segmentId of traversedSegmentIds) {
      const segment = network.segmentsById.get(segmentId)!;
      visited.add(segment.from); visited.add(segment.to);
    }
    const extraSegment = [...network.segmentsById.values()].find(({ from, to }) => !visited.has(from) && !visited.has(to));
    if (!extraSegment) throw new Error("Fixture network has no segment for duplicate-turn diagnostic");
    const pending: ItemGameState = { ...pendingGame, pending: { kind: "discard", turn: pendingRecord.turn,
      item: { id: "pending", kind: "double" }, candidates: [], nextItemRngState: pendingGame.itemRngState,
      position: pendingGame, record: { ...pendingRecord, traversedSegmentIds: [...pendingRecord.traversedSegmentIds, extraSegment.id] } } };
    const pendingDisplay = display(resumeSession(pending, network, 68));
    const expected = deriveCollectionProgress(pending.config.startStationId, itemVisits(pending), network, presentation);
    expect(pendingDisplay.collection).toEqual(expected);

    const generated = playItemTurn(itemScenario("discard", network), {}, network).state;
    const appended = generated.pending?.kind === "discard" ? generated.pending.record : null;
    if (!appended || appended.kind !== "item-ride" || generated.movementHistory.some((entry) => entry.turn === appended.turn)) {
      throw new Error(`Expected a pending-only discard record: ${JSON.stringify({ pending: generated.pending?.kind, turn: generated.turn, historyTurns: generated.movementHistory.map(({ turn }) => turn) })}`);
    }
    const resumed = resumeSession(generated, network, 70);
    const movingSession = { ...resumed, phase: "animating" as const, animation: {
      sessionId: resumed.sessionId, turn: appended.turn, fromStationId: appended.fromStationId, events: [],
    } };
    const firstPendingHop = network.segmentsById.get(appended.traversedSegmentIds[0]!);
    if (!firstPendingHop) throw new Error(`Pending move has no first segment: ${JSON.stringify(appended)}`);
    const prefix = [...itemVisits(generated), { traversedSegmentIds: appended.traversedSegmentIds.slice(0, 1) }];
    const full = [...itemVisits(generated), { traversedSegmentIds: appended.traversedSegmentIds }];
    const expectedPrefix = deriveCollectionProgress(generated.config.startStationId, prefix, network, presentation);
    const expectedFull = deriveCollectionProgress(generated.config.startStationId, full, network, presentation);
    const moving = display(movingSession, null, "waiting", false, null,
      { ...progress(movingSession), stationId: firstPendingHop.to, stepsCompleted: 1 });
    expect(moving.phase).toBe("moving");
    expect(moving.collection).toEqual(expectedPrefix);
    expect(display(resumed, null, "arrival", false).collection).toEqual(expectedFull);
    expect(display(resumed).collection).toEqual(expectedFull);
    expect(display(resumeSession(generated, network, 71)).collection).toEqual(expectedFull);
  });
});
