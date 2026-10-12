import { describe, expect, it } from "vitest";
import { createGame, playTurn, restoreGame, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { loadBundle } from "../e2e/fixtures/bundle";

// Disk -> runtime guards -> the app's own network/config, exactly as in production.
const { network, data } = await loadBundle("real");
const SEEDS = ["real-alpha", "real-beta", "real-gamma", "real-delta", "real-epsilon", "real-zeta", "real-eta", "real-theta"];
const MAX_TURNS = 5_000;
const RESTORE_OPTIONS = { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true } as const;

describe("shipped JR East 23-ward network", () => {
  it("contains exactly the reviewed five services, 67 stations and 146 directed segments", () => {
    expect([...network.servicesById.keys()]).toEqual(["jr-yamanote", "jr-keihin-tohoku", "jr-chuo-sobu-local", "jr-saikyo", "jr-keiyo"]);
    expect([...network.servicesById.values()].map((service) => service.stationIds.length)).toEqual([30, 22, 24, 10, 6]);
    expect(network.stationsById.size).toBe(67);
    expect(network.segmentsById.size).toBe(146);
    expect([...network.servicesByStation.values()].filter((services) => services.length >= 2)).toHaveLength(22);
    if (!data.geometry.ok) throw new Error("geometry did not pass the runtime guard");
    expect(data.geometry.value.features).toHaveLength(88);
  });

  it("shares Tokyo identity while retaining the distant Keiyo platform", () => {
    expect(network.servicesByStation.get("tokyo")).toEqual(["jr-yamanote", "jr-keihin-tohoku", "jr-keiyo"]);
    const yamanote = network.servicesById.get("jr-yamanote")!.platformCoordinates.tokyo!;
    const keiyo = network.servicesById.get("jr-keiyo")!.platformCoordinates.tokyo!;
    expect(keiyo).not.toEqual(yamanote);
    expect(Math.hypot(keiyo[0] - yamanote[0], keiyo[1] - yamanote[1])).toBeGreaterThan(0.002);
    expect(network.stationsById.get("tokyo")!.coordinates).toEqual(yamanote);
  });

  it.each(SEEDS)("plays %s to completion and restores both mid-game and completed saves", (seed) => {
    let game = createGame(MVP_GAME_CONFIG, seed, network);
    let checkedMidGame = false;
    while (game.status === "playing" && game.turn < MAX_TURNS) {
      game = playTurn(game, network).state;
      if (!checkedMidGame && game.turn >= 10 && game.currentServiceId !== "jr-yamanote") {
        const restored = restoreGame(serializeGame(game), network, RESTORE_OPTIONS);
        expect(restored).toEqual(game);
        expect(playTurn(restored, network)).toEqual(playTurn(game, network));
        checkedMidGame = true;
      }
    }
    expect(checkedMidGame).toBe(true);
    expect(game.status).toBe("completed");
    expect(game.currentStationId).toBe("shimbashi");
    const target = targetSegmentIds(MVP_GAME_CONFIG, network);
    expect(target).toHaveLength(30);
    expect(target.every((id) => game.completedSegmentIds.includes(id))).toBe(true);
    expect(restoreGame(serializeGame(game), network, RESTORE_OPTIONS)).toEqual(game);
  });
});
