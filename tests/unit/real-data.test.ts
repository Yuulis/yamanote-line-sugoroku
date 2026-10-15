import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGame, playTurn, restoreGame, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { loadBundle } from "../e2e/fixtures/bundle";

// Disk -> runtime guards -> the app's own network/config, exactly as in production.
const { network, data } = await loadBundle("real");
const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/overrides/expected-catalog.json", import.meta.url)), "utf8"),
) as { services: { id: string; stationIds: string[] }[]; stationIds: string[] };
const productCatalogRows = readFileSync(
  fileURLToPath(new URL("../../.claude/docs/research/jr-east-capital-region-product-catalog.csv", import.meta.url)),
  "utf8",
).trim().split(/\r?\n/).slice(1).map((line) => line.split(","));
const SEEDS = ["real-alpha", "real-beta", "real-gamma", "real-delta", "real-epsilon", "real-zeta", "real-eta", "real-theta"];
const MAX_TURNS = 5_000;
const RESTORE_OPTIONS = { expectedConfig: MVP_GAME_CONFIG, requireSeededRolls: true } as const;

describe("shipped JR East capital-region network", () => {
  it("matches the approved product catalog and complete directed geometry contract", () => {
    expect(catalog.services).toHaveLength(40);
    expect(catalog.stationIds).toHaveLength(472);
    expect([...network.servicesById.keys()]).toEqual(catalog.services.map((service) => service.id));
    expect([...network.servicesById.values()].map((service) => service.stationIds)).toEqual(
      catalog.services.map((service) => service.stationIds),
    );
    expect([...network.stationsById.keys()].sort()).toEqual([...catalog.stationIds].sort());
    const expectedDirectedSegments = catalog.services.reduce(
      (count, service) => count + (service.id === "jr-yamanote" ? service.stationIds.length : (service.stationIds.length - 1) * 2),
      0,
    );
    expect(network.stationsById.size).toBe(catalog.stationIds.length);
    expect(network.segmentsById.size).toBe(expectedDirectedSegments);
    if (!data.geometry.ok) throw new Error("geometry did not pass the runtime guard");
    const referencedFeatures = new Set(
      [...network.segmentsById.values()].flatMap((segment) => segment.geometryFeatureIds),
    );
    expect(referencedFeatures.size).toBe(data.geometry.value.features.length);
    expect(new Set(data.geometry.value.features.map((feature) => feature.id))).toEqual(referencedFeatures);
  });

  it("indexes every station's complete service membership from the product catalog", () => {
    const expectedMembership = new Map<string, Set<string>>();
    for (const [serviceId, , stationId] of productCatalogRows) {
      const services = expectedMembership.get(stationId!) ?? new Set<string>();
      services.add(serviceId!);
      expectedMembership.set(stationId!, services);
    }
    expect(expectedMembership.size).toBe(472);
    expect([...network.servicesByStation.keys()].sort()).toEqual([...expectedMembership.keys()].sort());
    for (const [stationId, expectedServices] of expectedMembership) {
      const actualServices = network.servicesByStation.get(stationId)!;
      expect(actualServices, stationId).toHaveLength(expectedServices.size);
      expect(new Set(actualServices), stationId).toEqual(expectedServices);
    }
  });

  it("shares Tokyo identity while retaining the distant Keiyo platform", () => {
    const productServicesAtTokyo = productCatalogRows.filter((row) => row[2] === "tokyo").map((row) => row[0]);
    expect(network.servicesByStation.get("tokyo")).toEqual(productServicesAtTokyo);
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
    expect(game.turn).toBeLessThan(MAX_TURNS);
    expect(game.status).toBe("completed");
    expect(game.currentStationId).toBe("shimbashi");
    const target = targetSegmentIds(MVP_GAME_CONFIG, network);
    expect(target).toHaveLength(30);
    expect(target.every((id) => game.completedSegmentIds.includes(id))).toBe(true);
    expect(restoreGame(serializeGame(game), network, RESTORE_OPTIONS)).toEqual(game);
  });
});
