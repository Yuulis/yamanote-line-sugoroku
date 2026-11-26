import { createGame, playTurn, type ProductTurnResult } from "../e2e/fixtures/productGame";
import { describe, expect, it } from "vitest";
import { beginItemTurn, createItemGame, finishItemTurn, playItemTurn, resolveItemDiscard, restoreGame, rollDie, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { resumeSession, reduceGameSession, startSession } from "../../src/features/game/gameSession";
import { displayedRide, landingText, lastRollText } from "../../src/features/game/presentation";
import { DEFAULT_GAME_CONFIG, ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { legalAdjustments } from "../../src/features/game/itemRollAdjust";
import {
  FIXTURE_GAME_SEED,
  FIXTURE_SCENARIO_TURNS,
  FIXTURE_VERY_FAST_MOMENT_GAME_SEED,
  FIXTURE_VERY_FAST_MOMENT_TURN,
  LEGACY_FIXTURE_GAME_SEED,
  LEGACY_FIXTURE_SCENARIO_TURNS,
  PRODUCT_ANNOUNCEMENT_GAME_SEED,
  PRODUCT_REVERSE_LANDING_GAME_SEED,
  PRODUCT_REVERSE_LANDING_TURN,
} from "../e2e/fixtures/seeds";
import { isItemSave, createGame as createClassicGame, playTurn as playClassicTurn, type MoveResult } from "../../src/features/game/engine";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");
const { network: realNetwork } = await loadBundle("real");

function endpointKind(result: ProductTurnResult | MoveResult): string | null {
  const record = result.state.movementHistory.at(-1);
  if (!record) return null;
  const service = network.servicesById.get("kind" in record ? record.resolvedRide!.serviceId : record.serviceId);
  if (!service || service.circular) return null;
  return record.toStationId === service.stationIds[0] ? service.endpoints.first : service.endpoints.last;
}

interface FixtureTrajectory {
  seed: string;
  fresh: ItemGameState;
  turns: ProductTurnResult[];
  game: ItemGameState;
}

/**
 * Deterministic search: scan ascending integers, encode each as a 128-bit
 * lowercase hex seed, and keep the first trajectory with a turn-1 transfer,
 * turn-2 area boundary, turn-3 terminus, turn-5 direction draw, and completion.
 * The first match in this bounded search is 0x5ff (decimal 1535); browser specs
 * consume that seed.
 */
function findProductionFixtureTrajectory(lastCandidate: number): FixtureTrajectory {
  for (let candidate = 0; candidate <= lastCandidate; candidate += 1) {
    const seed = candidate.toString(16).padStart(32, "0");
    const fresh = createGame(DEFAULT_GAME_CONFIG, seed, network);
    const first = playTurn(fresh, network);
    const firstLanding = first.events.find((event) => event.type === "landing-resolved");
    if (first.roll !== 4 || firstLanding?.type !== "landing-resolved" || !firstLanding.changedService || firstLanding.serviceId !== "fixture-south") continue;

    const second = playTurn(first.state, network);
    const secondRecord = second.state.movementHistory.at(-1);
    if (second.roll !== 3 || second.stopReason !== "endpoint" || secondRecord?.toStationId !== "fixture-omori" || endpointKind(second) !== "area-boundary") continue;

    const third = playTurn(second.state, network);
    const thirdRecord = third.state.movementHistory.at(-1);
    if (third.roll !== 3 || third.stopReason !== "endpoint" || thirdRecord?.toStationId !== "shinagawa" || endpointKind(third) !== "terminus") continue;

    const turns = [first, second, third];
    let game = third.state;
    while (game.status === "playing" && game.turn < 100) {
      const result = playTurn(game, network);
      turns.push(result);
      game = result.state;
    }
    const direction = turns[FIXTURE_SCENARIO_TURNS.direction - 1]?.events.find(
      (event) => event.type === "landing-resolved" && event.directionDrawRequired,
    );
    const targetIds = targetSegmentIds(DEFAULT_GAME_CONFIG, network);
    const completedTarget = targetIds.every((id) => game.completedSegmentIds.includes(id));
    if (
      direction?.type !== "landing-resolved"
      || direction.stationId !== "fixture-oimachi"
      || direction.directionCandidates.join(",") !== "1,-1"
      || direction.direction !== -1
      || game.status !== "completed"
      || game.currentStationId !== "shimbashi"
      || !completedTarget
    ) continue;

    return { seed, fresh, turns, game };
  }
  throw new Error(`No production fixture trajectory found through candidate ${lastCandidate}`);
}

const legacyFresh = createClassicGame(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network);
const legacyTurns: MoveResult[] = [];
let legacyGame = legacyFresh;
while (legacyGame.status === "playing" && legacyGame.turn < 30) {
  const result = playClassicTurn(legacyGame, network);
  legacyTurns.push(result);
  legacyGame = result.state;
}

const productionFixture = findProductionFixtureTrajectory(Number.parseInt(FIXTURE_GAME_SEED, 16));

describe("pinned legacy browser-fixture trajectory", () => {
  it("starts with a real transfer, no initial lottery, and a 4-station roll", () => {
    expect(legacyFresh.turn).toBe(0);
    expect(legacyFresh.currentServiceId).toBe("jr-yamanote");
    const result = legacyTurns[LEGACY_FIXTURE_SCENARIO_TURNS.transfer - 1]!;
    expect(result.roll).toBe(4);
    expect(result.state.rngSeed).toBe(LEGACY_FIXTURE_GAME_SEED);
    expect(result.events.at(-1)).toMatchObject({ type: "landing-resolved", changedService: true, serviceDrawRequired: true, directionDrawRequired: false, serviceId: "fixture-south" });
  });

  it("proves complete candidate lists at every transfer station in the pinned trajectory", () => {
    const transferStations = new Set(legacyTurns.flatMap((turn) => {
      const record = turn.state.movementHistory.at(-1);
      return record?.landing && record.landing.serviceId !== record.serviceId ? [turn.state.currentStationId] : [];
    }));
    expect(transferStations.size).toBeGreaterThan(0);
    for (const stationId of transferStations) {
      const expected = [...network.servicesById.values()]
        .filter((service) => service.stationIds.includes(stationId))
        .map((service) => service.id);
      expect(network.servicesByStation.get(stationId), stationId).toEqual(expected);
      expect(expected.length, stationId).toBeGreaterThan(1);
    }
  });

  it.each([
    [LEGACY_FIXTURE_SCENARIO_TURNS.boundary, "fixture-omori", "area-boundary", 1],
    [LEGACY_FIXTURE_SCENARIO_TURNS.terminus, "shinagawa", "terminus", -1],
  ] as const)("turn %d truncates at %s (%s)", (turn, station, kind, direction) => {
    const result = legacyTurns[turn - 1]!;
    const record = result.state.movementHistory.at(-1)!;
    expect(result.stopReason).toBe("endpoint");
    expect(result.unusedPips).toBeGreaterThan(0);
    expect(record).toMatchObject({ toStationId: station, direction });
    expect(endpointKind(result)).toBe(kind);
    expect(result.events.some((event) => event.type === "endpoint-reached")).toBe(true);
  });

  it("turn 8 draws a direction at a sole-service interior station", () => {
    expect(legacyTurns[LEGACY_FIXTURE_SCENARIO_TURNS.direction - 1]!.events.at(-1)).toMatchObject({
      type: "landing-resolved", stationId: "fixture-oimachi", serviceDrawRequired: false,
      directionDrawRequired: true, directionCandidates: [1, -1], direction: -1,
    });
  });

  it("clears after exactly 15 turns while counting only the 30 target segments", () => {
    expect(legacyGame).toMatchObject({ status: "completed", turn: LEGACY_FIXTURE_SCENARIO_TURNS.completed, currentStationId: "shimbashi" });
    expect(targetSegmentIds(LEGACY_CAPITAL_REGION_CONFIG, network).every((id) => legacyGame.completedSegmentIds.includes(id))).toBe(true);
    expect(legacyGame.completedSegmentIds.length).toBeGreaterThan(30);
    expect(legacyGame.movementHistory.at(-1)?.landing).toBeNull();
  });

  it("every fixture save restores and continues identically under legacy rules", () => {
    for (const state of [legacyFresh, ...legacyTurns.map((turn) => turn.state)]) {
      const restored = restoreGame(serializeGame(state), network, { expectedConfig: LEGACY_CAPITAL_REGION_CONFIG, requireSeededRolls: true });
      expect(restored).toEqual(state);
      if (state.status === "playing") expect(playClassicTurn(restored, network)).toEqual(playClassicTurn(state, network));
    }
  });
});

describe("pinned production browser-fixture trajectory", () => {
  it("keeps the unit double scenario and phone double-adjust scenario pinned", () => {
    const unitScenario = itemScenario("double", network);
    expect(unitScenario).toMatchObject({ turn: 2, rngSeed: "00000000000000000000000000000003", status: "playing", pending: null });
    expect(unitScenario.inventory.some((item) => item.kind === "double")).toBe(true);

    for (const datasetNetwork of [network, realNetwork]) {
      const phoneScenario = itemScenario("double-adjust", datasetNetwork);
      expect(phoneScenario).toMatchObject({ turn: 10, rngSeed: "0000000000000000000000000000006b", status: "playing", pending: null });
      expect(phoneScenario.inventory.some((item) => item.kind === "double")).toBe(true);
      expect(phoneScenario.inventory.some((item) => item.kind === "roll-adjust")).toBe(true);

      const double = phoneScenario.inventory.find((item) => item.kind === "double")!;
      const doubledTurn = playItemTurn(phoneScenario, { command: { items: [{ kind: "double", instanceId: double.id }] } }, datasetNetwork).state;
      expect(doubledTurn.status).toBe("playing");
      expect(doubledTurn.pending).toBeNull();
    }
  });

  it("pins the rapid animation scenario to a non-clearing rapid turn", () => {
    const before = itemScenario("rapid", network);
    expect(before).toMatchObject({ turn: 2, rngSeed: "00000000000000000000000000000002", status: "playing", pending: null });
    const rapid = before.inventory.find((item) => item.kind === "rapid");
    expect(rapid).toBeDefined();
    expect(before.inventory.some((item) => item.kind === "roll-adjust")).toBe(false);

    const after = playItemTurn(before, { command: { items: [{ kind: "rapid", instanceId: rapid!.id }] } }, network);
    expect(after.state).toMatchObject({ status: "playing", pending: null });
    const rapidRecord = after.record;
    if (!rapidRecord || rapidRecord.kind !== "item-ride") throw new Error("Expected a rapid ride");
    expect(rapidRecord).toMatchObject({ movementMode: "rapid" });
    expect(rapidRecord.physicalHops).toBeGreaterThan(rapidRecord.pips);
  });

  it("pins the route arrival pickup to a retained rapid ticket", () => {
    const before = itemScenario("route-rapid-pickup", network);
    expect(before).toMatchObject({ turn: 6, rngSeed: "0000000000000000000000000000000c", status: "playing", pending: null });
    expect(before.inventory.length).toBeLessThan(3);
    expect(before.inventory.some((item) => item.kind === "roll-adjust")).toBe(false);
    expect(before.inventory.some((item) => item.kind === "rapid")).toBe(false);

    const result = playItemTurn(before, {}, network);
    expect(result.state).toMatchObject({ turn: 7, status: "playing", pending: null });
    expect(result.record).toMatchObject({ movementMode: "normal", unusedPips: 4, fromStationId: "shinagawa", toStationId: "fixture-omori",
      resolvedRide: { direction: 1 }, landing: { serviceId: "fixture-south", direction: -1 } });
    expect(result.record?.itemEvents).toContainEqual(expect.objectContaining({
      type: "pickup-retained", item: expect.objectContaining({ kind: "rapid" }),
    }));
  });

  it("pins the very-fast overflow path with a retained adjustment ticket for the following turn", () => {
    let before = createItemGame(ITEM_GAME_CONFIG, FIXTURE_VERY_FAST_MOMENT_GAME_SEED, network);
    while (before.turn < FIXTURE_VERY_FAST_MOMENT_TURN) {
      const result = playItemTurn(before, {}, network);
      before = result.state.pending?.kind === "discard" ? resolveItemDiscard(result.state, result.state.pending.item.id).state : result.state;
    }
    expect(before).toMatchObject({ turn: 6, status: "playing", pending: null, effects: { oversleepPending: true } });
    expect(before.inventory.map((item) => item.kind)).toEqual(["deadhead", "route-ticket", "rapid"]);

    const overflow = playItemTurn(before, {}, network).state;
    if (overflow.pending?.kind !== "discard") throw new Error("Expected a full-inventory pickup");
    expect(overflow.pending.item.kind).toBe("roll-adjust-2");
    expect(overflow.pending.record).toMatchObject({ movementMode: "oversleep", physicalHops: 6 });
    expect(overflow.pending.record.traversedSegmentIds).toContain("jr-yamanote:gotanda:meguro");
    expect(overflow.pending.record.itemEvents).toContainEqual({ type: "effect-activated", effect: "oversleep" });
    expect(overflow.pending.record.landingSnapshot?.services.length).toBeGreaterThan(1);

    const afterDiscard = resolveItemDiscard(overflow, before.inventory[0]!.id).state;
    expect(afterDiscard.inventory.map((item) => item.kind)).toEqual(["route-ticket", "rapid", "roll-adjust-2"]);
    const nextPending = beginItemTurn(afterDiscard, { items: [] }, network).state;
    expect(nextPending.pending).toMatchObject({ kind: "roll", rawRoll: 3 });
    expect(finishItemTurn(nextPending, null, network).state).toMatchObject({ turn: 8, status: "playing", pending: null });
  });

  it("pins the real-data oversleep pickup and repeated-roll announcement trajectories", () => {
    const oversleepBase = itemScenario("oversleep-pickup", realNetwork);
    const oversleep = playItemTurn(oversleepBase, {}, realNetwork).state;
    expect(oversleep).toMatchObject({ turn: 9, status: "playing", pending: null, effects: { oversleepPending: true } });

    let announcementGame = createGame(DEFAULT_GAME_CONFIG, PRODUCT_ANNOUNCEMENT_GAME_SEED, realNetwork);
    const turns: ProductTurnResult[] = [];
    while (announcementGame.turn < 5) {
      const result = playTurn(announcementGame, realNetwork);
      turns.push(result);
      announcementGame = result.state;
    }
    expect(announcementGame.status).toBe("playing");
    expect(turns[1]!.roll).toBe(turns[2]!.roll);
    expect(turns.slice(1).every((turn) => turn.record.itemEvents.length === 0)).toBe(true);

    let reverseGame = createGame(DEFAULT_GAME_CONFIG, PRODUCT_REVERSE_LANDING_GAME_SEED, realNetwork);
    while (reverseGame.turn < PRODUCT_REVERSE_LANDING_TURN) reverseGame = playTurn(reverseGame, realNetwork).state;
    const reverseRecord = reverseGame.movementHistory.at(-1);
    expect(reverseGame).toMatchObject({ turn: PRODUCT_REVERSE_LANDING_TURN, status: "playing" });
    expect(reverseRecord).toMatchObject({
      traversedSegmentIds: expect.arrayContaining(["jr-shonan-shinjuku-rapid-takasaki:yokohama:musashi-kosugi"]),
      resolvedRide: { serviceId: "jr-shonan-shinjuku-rapid-takasaki", direction: -1 },
      landing: { serviceId: "metro-fukutoshin", direction: 1 },
    });
    expect(reverseRecord?.itemEvents.some((event) => event.type === "pickup-pending-discard")).toBe(false);
  });

  it("pins adjust-wide to three tickets, seven choices, and an untruncated +3 ride above six", () => {
    const before = itemScenario("adjust-wide", network);
    expect(before).toMatchObject({ turn: 5, rngSeed: "0000000000000000000000000000560b" });
    expect(new Set(before.inventory.map((item) => item.kind))).toEqual(new Set([
      "roll-adjust", "roll-adjust-2", "roll-adjust-3",
    ]));
    expect(legalAdjustments(rollDie(before.rngState).value, before.inventory)).toHaveLength(6);

    const pending = beginItemTurn(before, { items: [] }, network).state;
    if (pending.pending?.kind !== "roll") throw new Error("Expected an actionable adjustment roll");
    expect(pending.pending.rawRoll).toBeGreaterThanOrEqual(4);
    const ticket = before.inventory.find((item) => item.kind === "roll-adjust-3")!;
    const adjusted = finishItemTurn(pending, { instanceId: ticket.id, delta: 3 }, network).record;
    expect(adjusted).toMatchObject({
      kind: "item-ride", rawRoll: pending.pending.rawRoll, effectiveFace: pending.pending.rawRoll + 3,
      pips: pending.pending.rawRoll + 3, physicalHops: pending.pending.rawRoll + 3,
      stopReason: "roll", unusedPips: 0,
    });
  });

  it("selects the first ascending-search seed proved by the production engine", () => {
    expect(productionFixture.seed).toBe(FIXTURE_GAME_SEED);
    expect(FIXTURE_GAME_SEED).toBe("000000000000000000000000000005ff");
    expect(productionFixture.fresh).toMatchObject({ turn: 0, currentStationId: "shimbashi", currentServiceId: "jr-yamanote" });
  });

  it("proves the browser transfer, both endpoint kinds, and direction lottery", () => {
    const transfer = productionFixture.turns[FIXTURE_SCENARIO_TURNS.transfer - 1]!;
    expect(transfer).toMatchObject({ roll: 4, state: { currentStationId: "shinagawa", currentServiceId: "fixture-south" } });
    expect(transfer.events.at(-1)).toMatchObject({
      type: "landing-resolved", stationId: "shinagawa", serviceCandidates: ["jr-yamanote", "fixture-south"],
      changedService: true, serviceDrawRequired: true, directionDrawRequired: false, serviceId: "fixture-south", direction: 1,
    });

    const boundary = productionFixture.turns[FIXTURE_SCENARIO_TURNS.boundary - 1]!;
    expect(boundary).toMatchObject({ roll: 3, stopReason: "endpoint", unusedPips: 1 });
    expect(boundary.state.movementHistory.at(-1)).toMatchObject({ toStationId: "fixture-omori", resolvedRide: { direction: 1 } });
    expect(endpointKind(boundary)).toBe("area-boundary");
    expect(boundary.events.some((event) => event.type === "endpoint-reached")).toBe(true);
    expect(lastRollText(resumeSession(boundary.state, network).lastMove, network)).toBe("3（3マス、2駅移動、残り1は使わず）");

    const terminus = productionFixture.turns[FIXTURE_SCENARIO_TURNS.terminus - 1]!;
    expect(terminus).toMatchObject({ roll: 3, stopReason: "endpoint", unusedPips: 1 });
    expect(terminus.state.movementHistory.at(-1)).toMatchObject({ toStationId: "shinagawa", resolvedRide: { direction: -1 } });
    expect(endpointKind(terminus)).toBe("terminus");
    expect(terminus.events.some((event) => event.type === "endpoint-reached")).toBe(true);
    expect(lastRollText(resumeSession(terminus.state, network).lastMove, network)).toBe("3（3マス、2駅移動、残り1は使わず）");

    const direction = productionFixture.turns[FIXTURE_SCENARIO_TURNS.direction - 1]!.events.at(-1);
    expect(direction).toMatchObject({
      type: "landing-resolved", stationId: "fixture-oimachi", serviceCandidates: ["fixture-south"],
      serviceDrawRequired: false, directionCandidates: [1, -1], directionDrawRequired: true, direction: -1,
    });
    expect(landingText(resumeSession(productionFixture.turns[FIXTURE_SCENARIO_TURNS.direction - 1]!.state, network).lastMove, network))
      .toBe("テスト南線のみ ／ 方向抽選 → 品川方面");
  });

  it("proves the production transfer result stays hidden until animation settles", () => {
    const started = startSession(DEFAULT_GAME_CONFIG, FIXTURE_GAME_SEED, network, 1);
    let moving = reduceGameSession(
      started,
      { type: "item-commit", sessionId: 1, turn: 0, decisionRevision: 0 },
      DEFAULT_GAME_CONFIG,
      network,
    );
    moving = reduceGameSession(moving, { type: "item-save-attempted", sessionId: 1, turn: moving.game.turn, decisionRevision: moving.item!.decisionRevision }, DEFAULT_GAME_CONFIG, network);
    moving = reduceGameSession(moving, { type: "item-save-attempted", sessionId: 1, turn: moving.game.turn, decisionRevision: moving.item!.decisionRevision }, DEFAULT_GAME_CONFIG, network);
    expect(moving.game.currentServiceId).toBe("fixture-south");
    expect(displayedRide(moving)).toEqual({ serviceId: "jr-yamanote", direction: 1 });

    const settled = reduceGameSession(moving, { type: "animation-finished", sessionId: 1, turn: 1, decisionRevision: moving.item!.decisionRevision }, DEFAULT_GAME_CONFIG, network);
    expect(displayedRide(settled)).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(landingText(settled.lastMove, network)).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(reduceGameSession(settled, { type: "animation-finished", sessionId: 1, turn: 1, decisionRevision: moving.item!.decisionRevision }, DEFAULT_GAME_CONFIG, network)).toBe(settled);
  });

  it("completes at turn 14 after every target segment is covered", () => {
    const targetIds = targetSegmentIds(DEFAULT_GAME_CONFIG, network);
    expect(targetIds).toHaveLength(30);
    expect(productionFixture.game).toMatchObject({
      status: "completed", turn: FIXTURE_SCENARIO_TURNS.completed, currentStationId: "shimbashi",
    });
    expect(targetIds.every((id) => productionFixture.game.completedSegmentIds.includes(id))).toBe(true);
    expect(productionFixture.game.completedSegmentIds.length).toBeGreaterThan(30);
    expect(productionFixture.game.movementHistory.at(-1)?.landing).toBeNull();
  });

  it("restores each production fixture save and continues without drawing again", () => {
    for (const state of [productionFixture.fresh, ...productionFixture.turns.map((turn) => turn.state)]) {
      const restored = restoreGame(serializeGame(state), network, { expectedConfig: DEFAULT_GAME_CONFIG, requireSeededRolls: true });
      expect(restored).toEqual(state);
      if (!isItemSave(restored)) throw new Error("Expected item save");
      if (state.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });
});
