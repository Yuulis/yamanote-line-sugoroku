import { describe, expect, it } from "vitest";
import { createGame, type MoveResult, playTurn, restoreGame, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { lastMoveOf, reduceGameSession, startSession } from "../../src/features/game/gameSession";
import { displayedRide, landingText, lastRollText } from "../../src/features/game/presentation";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { GameState } from "../../src/types/network";
import { loadBundle } from "../e2e/fixtures/bundle";
import {
  FIXTURE_GAME_SEED,
  FIXTURE_SCENARIO_TURNS,
  LEGACY_FIXTURE_GAME_SEED,
  LEGACY_FIXTURE_SCENARIO_TURNS,
} from "../e2e/fixtures/seeds";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");

function endpointKind(result: MoveResult): string | null {
  const record = result.state.movementHistory.at(-1);
  if (!record) return null;
  const service = network.servicesById.get(record.serviceId);
  if (!service || service.circular) return null;
  return record.toStationId === service.stationIds[0] ? service.endpoints.first : service.endpoints.last;
}

interface FixtureTrajectory {
  seed: string;
  fresh: GameState;
  turns: MoveResult[];
  game: GameState;
}

/**
 * Deterministic search: scan ascending integers, encode each as a 128-bit
 * lowercase hex seed, and keep the first trajectory with a turn-1 transfer,
 * turn-2 area boundary, turn-3 terminus, turn-5 direction draw, and completion.
 * The first match in this bounded search is 0x398 (decimal 920); browser specs
 * consume that seed.
 */
function findProductionFixtureTrajectory(lastCandidate: number): FixtureTrajectory {
  for (let candidate = 0; candidate <= lastCandidate; candidate += 1) {
    const seed = candidate.toString(16).padStart(32, "0");
    const fresh = createGame(MVP_GAME_CONFIG, seed, network);
    const first = playTurn(fresh, network);
    const firstLanding = first.events.find((event) => event.type === "landing-resolved");
    if (firstLanding?.type !== "landing-resolved" || !firstLanding.changedService || firstLanding.serviceId !== "fixture-south") continue;

    const second = playTurn(first.state, network);
    const secondRecord = second.state.movementHistory.at(-1);
    if (second.stopReason !== "endpoint" || secondRecord?.toStationId !== "fixture-omori" || endpointKind(second) !== "area-boundary") continue;

    const third = playTurn(second.state, network);
    const thirdRecord = third.state.movementHistory.at(-1);
    if (third.stopReason !== "endpoint" || thirdRecord?.toStationId !== "shinagawa" || endpointKind(third) !== "terminus") continue;

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
    const targetIds = targetSegmentIds(MVP_GAME_CONFIG, network);
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

const legacyFresh = createGame(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network);
const legacyTurns: MoveResult[] = [];
let legacyGame = legacyFresh;
while (legacyGame.status === "playing" && legacyGame.turn < 30) {
  const result = playTurn(legacyGame, network);
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
      if (state.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });
});

describe("pinned production browser-fixture trajectory", () => {
  it("selects the first ascending-search seed proved by the production engine", () => {
    expect(productionFixture.seed).toBe(FIXTURE_GAME_SEED);
    expect(FIXTURE_GAME_SEED).toBe("00000000000000000000000000000398");
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
    expect(boundary.state.movementHistory.at(-1)).toMatchObject({ toStationId: "fixture-omori", direction: 1 });
    expect(endpointKind(boundary)).toBe("area-boundary");
    expect(boundary.events.some((event) => event.type === "endpoint-reached")).toBe(true);
    expect(lastRollText(lastMoveOf(boundary.state, network), network)).toBe("3（大森で停止〔エリア端〕、残り1は使わず）");

    const terminus = productionFixture.turns[FIXTURE_SCENARIO_TURNS.terminus - 1]!;
    expect(terminus).toMatchObject({ roll: 3, stopReason: "endpoint", unusedPips: 1 });
    expect(terminus.state.movementHistory.at(-1)).toMatchObject({ toStationId: "shinagawa", direction: -1 });
    expect(endpointKind(terminus)).toBe("terminus");
    expect(terminus.events.some((event) => event.type === "endpoint-reached")).toBe(true);
    expect(lastRollText(lastMoveOf(terminus.state, network), network)).toBe("3（品川で停止〔終点〕、残り1は使わず）");

    const direction = productionFixture.turns[FIXTURE_SCENARIO_TURNS.direction - 1]!.events.at(-1);
    expect(direction).toMatchObject({
      type: "landing-resolved", stationId: "fixture-oimachi", serviceCandidates: ["fixture-south"],
      serviceDrawRequired: false, directionCandidates: [1, -1], directionDrawRequired: true, direction: -1,
    });
    expect(landingText(lastMoveOf(productionFixture.turns[FIXTURE_SCENARIO_TURNS.direction - 1]!.state, network), network))
      .toBe("テスト南線のみ ／ 方向抽選 → 品川方面");
  });

  it("proves the production transfer result stays hidden until animation settles", () => {
    const started = startSession(MVP_GAME_CONFIG, FIXTURE_GAME_SEED, network, 1);
    const moving = reduceGameSession(
      started,
      { type: "roll", sessionId: 1, rngSeed: FIXTURE_GAME_SEED, turn: 0 },
      MVP_GAME_CONFIG,
      network,
    );
    expect(moving.game.currentServiceId).toBe("fixture-south");
    expect(displayedRide(moving)).toEqual({ serviceId: "jr-yamanote", direction: 1 });

    const settled = reduceGameSession(moving, { type: "animation-finished", sessionId: 1, turn: 1 }, MVP_GAME_CONFIG, network);
    expect(displayedRide(settled)).toEqual({ serviceId: "fixture-south", direction: 1 });
    expect(landingText(settled.lastMove, network)).toBe("品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(reduceGameSession(settled, { type: "animation-finished", sessionId: 1, turn: 1 }, MVP_GAME_CONFIG, network)).toBe(settled);
  });

  it("completes at turn 13 after every target segment is covered", () => {
    const targetIds = targetSegmentIds(MVP_GAME_CONFIG, network);
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
      const restored = restoreGame(serializeGame(state), network, { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true });
      expect(restored).toEqual(state);
      if (state.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });
});
