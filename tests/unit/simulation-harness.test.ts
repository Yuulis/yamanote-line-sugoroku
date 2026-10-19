import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "../../src/features/game/engine";
import { gameSeed, presetConfig, runGame, runSimulation, summarizeTurns } from "../simulation/harness";
import { parseCsv } from "../simulation/csv";
import { loadResearchCatalog, loadShippedBundle } from "../simulation/inputs";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

afterEach(() => vi.restoreAllMocks());

describe("real-engine simulation harness", () => {
  it("is deterministic and calls real playTurn once for every measured turn", () => {
    const network = engine.buildRailwayNetwork(multiServiceInput());
    const config = multiConfig();
    const options = { baseSeed: 20261012, games: 5, turnCap: 200 };
    const spy = vi.spyOn(engine, "playTurn");
    const first = runSimulation(network, config, options);
    expect(spy).toHaveBeenCalledTimes(first.totalPlayedTurns);
    expect(first.capHits).toBe(0);
    spy.mockClear();
    expect(runSimulation(network, config, options)).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(first.totalPlayedTurns);
  });

  it.each(["all-equal", "decided", "decided-pass-through"] as const)(
    "%s matches direct engine games with full history on the same seed set", (preset) => {
      const network = engine.buildRailwayNetwork(multiServiceInput());
      const base = multiConfig();
      const config = presetConfig(preset, base.targetServiceId, base.startStationId);
      const turns: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        const seed = gameSeed(20261012, index);
        let direct = engine.createGame(config, seed, network);
        while (direct.status === "playing" && direct.turn < 200) direct = engine.playTurn(direct, network).state;
        expect(direct.status).toBe("completed");
        expect(runGame(network, config, seed, 200, true)).toEqual(direct);
        expect(runGame(network, config, seed, 200)).toEqual({ ...direct, movementHistory: [] });
        turns.push(direct.turn);
      }
      expect(runSimulation(network, config, { baseSeed: 20261012, games: 3, turnCap: 200 }))
        .toEqual(summarizeTurns(turns, [], turns.reduce((sum, turn) => sum + turn, 0)));
    },
  );

  it("reports censored games as cap+1 and rejects invalid run sizes", () => {
    const network = engine.buildRailwayNetwork(multiServiceInput());
    expect(runSimulation(network, multiConfig(), { baseSeed: 1, games: 3, turnCap: 1 }))
      .toMatchObject({ games: 3, capHits: 3, completedGames: 0, cappedGameIndices: [0, 1, 2],
        median: 2, p90: 2, p99: 2, mean: 2, max: 2, totalPlayedTurns: 3 });
    expect(() => runSimulation(network, multiConfig(), { baseSeed: 1, games: 0, turnCap: 1 })).toThrow();
    expect(() => runSimulation(network, multiConfig(), { baseSeed: NaN, games: 3, turnCap: 1 })).toThrow();
    expect(() => runGame(network, multiConfig(), "seed", 0)).toThrow();
  });

  it("uses nearest-rank quantiles and strict >500 counts", () => {
    expect(summarizeTurns([501, 1, 500, 7], [], 1009))
      .toMatchObject({ median: 7, p90: 501, p99: 501, mean: 252.25, max: 501, over500Count: 1 });
  });

  it("parses quoted commas, newlines and escaped quotes and rejects malformed CSV", () => {
    expect(parseCsv('id,note\na,"comma, newline\nquote ""x"""\n'))
      .toEqual([{ id: "a", note: 'comma, newline\nquote "x"' }]);
    expect(() => parseCsv('id,note\na,"unfinished')).toThrow();
    expect(() => parseCsv("id,id\na,b\n")).toThrow();
    expect(() => parseCsv("id,note\na\n")).toThrow();
  });

  it("loads approved v2 without changing order, loop direction or identities", () => {
    const { network, provenance } = loadResearchCatalog();
    expect(provenance).toMatchObject({ catalogRows: 666, services: 40, stations: 472, directedSegments: 1224 });
    expect(Object.values(provenance.sha256)).toEqual([
      "ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4",
      "45ee942862f0def53625e76dbafbc4ab306cc181123d71bd37cf225d70746d8b",
    ]);
    expect([...network.servicesById.keys()].slice(0, 3)).toEqual(["yamanote", "keihin_tohoku_negishi", "chuo_sobu_local"]);
    expect(network.servicesById.get("yamanote")?.stationIds.slice(0, 2)).toEqual(["shimbashi", "hamamatsucho"]);
    expect(network.servicesById.get("yamanote")?.stationIds).toHaveLength(30);
    expect(network.servicesById.get("kururi")?.stationIds.at(-1)).toBe("kururi");
    expect(network.servicesByStation.get("tokyo")).toHaveLength(10);
    expect(network.servicesByStation.get("hamakawasaki")).toEqual(["nambu_branch", "tsurumi"]);
  });

  it("accepts shipped data through the same measurement entry point", () => {
    const input = loadShippedBundle("public/data");
    const config = presetConfig("decided", input.targetServiceId, input.startStationId);
    // This test preserves the historical 1/2-share research preset on shipped
    // data. Production-rule measurement is covered by suburban-product.test.ts.
    expect(config.serviceLottery).toEqual(LEGACY_CAPITAL_REGION_CONFIG.serviceLottery);
    expect(config.directionLottery).toEqual(LEGACY_CAPITAL_REGION_CONFIG.directionLottery);
    expect(config.targetServiceId).toBe(LEGACY_CAPITAL_REGION_CONFIG.targetServiceId);
    expect(config.startStationId).toBe(LEGACY_CAPITAL_REGION_CONFIG.startStationId);
    expect(config.goalArrivalPolicy).toBe(LEGACY_CAPITAL_REGION_CONFIG.goalArrivalPolicy);
    expect(runSimulation(input.network, config, { baseSeed: 20261012, games: 3, turnCap: 2000 }).capHits).toBe(0);
  });
});
