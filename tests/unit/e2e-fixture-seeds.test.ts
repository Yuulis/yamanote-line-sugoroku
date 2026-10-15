import { describe, expect, it } from "vitest";
import { createGame, type MoveResult, playTurn, restoreGame, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { loadBundle } from "../e2e/fixtures/bundle";
import { FIXTURE_GAME_SEED, FIXTURE_SCENARIO_TURNS } from "../e2e/fixtures/seeds";

const { network } = await loadBundle("fixture");
const fresh = createGame(MVP_GAME_CONFIG, FIXTURE_GAME_SEED, network);
const turns: MoveResult[] = [];
let game = fresh;
while (game.status === "playing" && game.turn < 30) {
  const result = playTurn(game, network);
  turns.push(result);
  game = result.state;
}

describe("pinned browser-fixture trajectory", () => {
  it("starts with a real transfer, no initial lottery, and a 4-station roll", () => {
    expect(fresh.turn).toBe(0);
    expect(fresh.currentServiceId).toBe("jr-yamanote");
    const result = turns[FIXTURE_SCENARIO_TURNS.transfer - 1]!;
    expect(result.roll).toBe(4);
    expect(result.state.rngSeed).toBe(FIXTURE_GAME_SEED);
    expect(result.events.at(-1)).toMatchObject({ type: "landing-resolved", changedService: true, serviceDrawRequired: true, directionDrawRequired: false, serviceId: "fixture-south" });
  });

  it("proves complete candidate lists at every transfer station in the pinned trajectory", () => {
    const transferStations = new Set(turns.flatMap((turn) => {
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
    [FIXTURE_SCENARIO_TURNS.boundary, "fixture-omori", "area-boundary", 1],
    [FIXTURE_SCENARIO_TURNS.terminus, "shinagawa", "terminus", -1],
  ] as const)("turn %d truncates at %s (%s)", (turn, station, kind, direction) => {
    const result = turns[turn - 1]!;
    const record = result.state.movementHistory.at(-1)!;
    const service = network.servicesById.get(record.serviceId)!;
    if (service.circular) throw new Error("expected a linear service");
    expect(result.stopReason).toBe("endpoint");
    expect(result.unusedPips).toBeGreaterThan(0);
    expect(record).toMatchObject({ toStationId: station, direction });
    expect(record.toStationId === service.stationIds[0] ? service.endpoints.first : service.endpoints.last).toBe(kind);
    expect(result.events.some((event) => event.type === "endpoint-reached")).toBe(true);
  });

  it("turn 8 draws a direction at a sole-service interior station", () => {
    expect(turns[FIXTURE_SCENARIO_TURNS.direction - 1]!.events.at(-1)).toMatchObject({
      type: "landing-resolved", stationId: "fixture-oimachi", serviceDrawRequired: false,
      directionDrawRequired: true, directionCandidates: [1, -1], direction: -1,
    });
  });

  it("clears after exactly 15 turns while counting only the 30 target segments", () => {
    expect(game).toMatchObject({ status: "completed", turn: FIXTURE_SCENARIO_TURNS.completed, currentStationId: "shimbashi" });
    expect(targetSegmentIds(MVP_GAME_CONFIG, network).every((id) => game.completedSegmentIds.includes(id))).toBe(true);
    expect(game.completedSegmentIds.length).toBeGreaterThan(30);
    expect(game.movementHistory.at(-1)?.landing).toBeNull();
  });

  it("every fixture save restores and continues identically", () => {
    for (const state of [fresh, ...turns.map((turn) => turn.state)]) {
      const restored = restoreGame(serializeGame(state), network, { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true });
      expect(restored).toEqual(state);
      if (state.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });
});
