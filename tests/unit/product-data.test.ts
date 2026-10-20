import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createGame,
  moveByRoll,
  playTurn,
  restoreGame,
  serializeGame,
  targetSegmentIds,
} from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { GameConfig, GameState } from "../../src/types/network";
import { readSave, type StorageLike } from "../../src/features/game/store/persistence";
import { loadBundle } from "../e2e/fixtures/bundle";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

interface FreezeContract {
  counts: { directedSegments: number; services: number; stationGroups: number };
  ruleset: {
    id: string;
    targetServiceId: string;
    startStationId: string;
    targetDirection: 1 | -1;
    goalArrivalPolicy: string;
    serviceLottery: GameConfig["serviceLottery"];
    directionLottery: GameConfig["directionLottery"];
  };
}

interface ProductCatalog {
  services: { id: string; stationIds: string[] }[];
  stationIds: string[];
}

interface ServiceEvidence {
  services: { id: string; circular: boolean }[];
}

interface OldSaveProvenance {
  bundleDataVersion: string;
  bundleSha256: Record<string, string>;
  config: GameConfig;
  fixtureFileSha256: string;
  seed: string;
  turns: number;
  saveSha256: string;
}

interface EditionSaveCompatibility {
  sourceSha256: string;
  resumedSaveSha256: string;
  nextTurnSaveSha256: string;
}

const { network, data } = await loadBundle("real");
const freeze = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../.claude/docs/plans/tokyo-suburban-s0-freeze.json", import.meta.url)), "utf8"),
) as FreezeContract;
const catalogue = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/staging/tokyo-suburban-assembled/overrides/expected-catalog.json", import.meta.url)), "utf8"),
) as ProductCatalog;
const serviceEvidence = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/staging/tokyo-suburban-assembled/overrides/services.json", import.meta.url)), "utf8"),
) as ServiceEvidence;
const oldSave = readFileSync(
  fileURLToPath(new URL("../e2e/fixtures/old-capital-region-save.json", import.meta.url)),
  "utf8",
).trimEnd();
const oldSaveProvenance = JSON.parse(
  readFileSync(fileURLToPath(new URL("../e2e/fixtures/old-capital-region-save.provenance.json", import.meta.url)), "utf8"),
) as OldSaveProvenance;
const editionSaveCompatibility = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/edition-save-compatibility.json", import.meta.url)), "utf8"),
) as EditionSaveCompatibility;
const preEditionSave = readFileSync(
  fileURLToPath(new URL("../e2e/fixtures/tokyo-suburban-before-clear-save.json", import.meta.url)),
  "utf8",
).trimEnd();

function memoryStorage(value: string): StorageLike & { value: string | null } {
  let stored: string | null = value;
  return {
    get value() { return stored; },
    getItem: () => stored,
    removeItem: () => { stored = null; },
    setItem: (_key, next) => { stored = next; },
  };
}

describe("frozen Tokyo suburban runtime contract", () => {
  it("maps every frozen rule field and the prose goal to the engine policy", () => {
    expect(freeze.ruleset).toMatchObject({
      id: "tokyo-suburban-1",
      goalArrivalPolicy: "all 30 jr-yamanote outer directed segments, then arrive shimbashi",
    });
    expect(MVP_GAME_CONFIG).toEqual({
      rulesetVersion: freeze.ruleset.id,
      targetServiceId: freeze.ruleset.targetServiceId,
      startStationId: freeze.ruleset.startStationId,
      targetDirection: freeze.ruleset.targetDirection,
      goalArrivalPolicy: "truncate-on-target-service",
      serviceLottery: freeze.ruleset.serviceLottery,
      directionLottery: freeze.ruleset.directionLottery,
    });
    expect(MVP_GAME_CONFIG.goalArrivalPolicy).toBe("truncate-on-target-service");
  });

  it("matches the frozen catalogue and directed-segment formula", () => {
    expect(data.services.ok).toBe(true);
    expect(data.manifest.ok).toBe(true);
    if (data.manifest.ok) expect(data.manifest.value.schemaVersion).toBe(3);
    expect(network.servicesById.size).toBe(freeze.counts.services);
    expect(network.stationsById.size).toBe(freeze.counts.stationGroups);
    expect([...network.servicesById.keys()]).toEqual(catalogue.services.map((service) => service.id));
    expect([...network.servicesById.values()].map((service) => service.stationIds)).toEqual(
      catalogue.services.map((service) => service.stationIds),
    );
    expect([...network.stationsById.keys()].sort()).toEqual([...catalogue.stationIds].sort());

    const circularById = new Map(serviceEvidence.services.map((service) => [service.id, service.circular]));
    expect(circularById.size).toBe(freeze.counts.services);
    const expectedDirectedSegments = catalogue.services.reduce((count, service) => {
      const circular = circularById.get(service.id);
      expect(circular).toBeDefined();
      const pairCount = circular ? service.stationIds.length : service.stationIds.length - 1;
      return count + pairCount * (service.id === freeze.ruleset.targetServiceId ? 1 : 2);
    }, 0);
    expect(expectedDirectedSegments).toBe(freeze.counts.directedSegments);
    expect(network.segmentsById.size).toBe(expectedDirectedSegments);

    for (const service of catalogue.services) {
      const circular = circularById.get(service.id)!;
      const pairCount = circular ? service.stationIds.length : service.stationIds.length - 1;
      for (let index = 0; index < pairCount; index += 1) {
        const from = service.stationIds[index]!;
        const to = service.stationIds[(index + 1) % service.stationIds.length]!;
        expect(network.segmentsByEndpoints.has(JSON.stringify([service.id, from, to]))).toBe(true);
        expect(network.segmentsByEndpoints.has(JSON.stringify([service.id, to, from]))).toBe(
          service.id !== freeze.ruleset.targetServiceId,
        );
      }
    }
  });

  it("keeps the Yamanote one-way target and both directions on the non-target Oedo loop", () => {
    const target = network.servicesById.get(freeze.ruleset.targetServiceId)!;
    expect(target.circular).toBe(true);
    const targetIds = targetSegmentIds(MVP_GAME_CONFIG, network);
    expect(targetIds).toHaveLength(30);
    for (let index = 0; index < target.stationIds.length; index += 1) {
      const from = target.stationIds[index]!;
      const to = target.stationIds[(index + 1) % target.stationIds.length]!;
      expect(network.segmentsByEndpoints.has(JSON.stringify([target.id, from, to]))).toBe(true);
      expect(network.segmentsByEndpoints.has(JSON.stringify([target.id, to, from]))).toBe(false);
    }

    const oedo = network.servicesById.get("toei-oedo-loop")!;
    expect(oedo.circular).toBe(true);
    for (let index = 0; index < oedo.stationIds.length; index += 1) {
      const from = oedo.stationIds[index]!;
      const to = oedo.stationIds[(index + 1) % oedo.stationIds.length]!;
      expect(network.segmentsByEndpoints.has(JSON.stringify([oedo.id, from, to]))).toBe(true);
      expect(network.segmentsByEndpoints.has(JSON.stringify([oedo.id, to, from]))).toBe(true);
    }
  });

  it("requires all target segments before returning to Shimbashi and truncates remaining pips", () => {
    const targetIds = targetSegmentIds(MVP_GAME_CONFIG, network);
    let state = createGame(MVP_GAME_CONFIG, "product-goal-truncation", network);
    for (let index = 0; index < targetIds.length - 1; index += 1) {
      state = moveByRoll(state, 1, network, { serviceId: MVP_GAME_CONFIG.targetServiceId, direction: 1 }).state;
      expect(state.status).toBe("playing");
    }
    const result = moveByRoll(state, 6, network, null);
    expect(result.state).toMatchObject({ status: "completed", currentStationId: "shimbashi" });
    expect(result.state.completedSegmentIds).toEqual(targetIds);
    expect(result.stopReason).toBe("goal");
    expect(result.unusedPips).toBe(5);
  });

  it("round trips fresh, mid-run and completed product saves with strict seeded restore", () => {
    const seed = "00000000000000000000000000000005";
    const fresh = createGame(MVP_GAME_CONFIG, seed, network);
    expect(restoreGame(serializeGame(fresh), network, {
      expectedConfig: MVP_GAME_CONFIG,
      requireSeededRolls: true,
    })).toEqual(fresh);

    let state = fresh;
    let midRun: GameState | undefined;
    while (state.status === "playing" && state.turn < 5_000) {
      state = playTurn(state, network).state;
      if (!midRun && state.turn >= 10) midRun = state;
    }
    expect(midRun).toBeDefined();
    expect(state.status).toBe("completed");
    for (const saved of [midRun!, state]) {
      const restored = restoreGame(serializeGame(saved), network, {
        expectedConfig: MVP_GAME_CONFIG,
        requireSeededRolls: true,
      });
      expect(restored).toEqual(saved);
      if (saved.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(saved, network));
    }
  });

  it("accepts the archived save only on its source data and rejects current data plus old rules", async () => {
    expect(oldSaveProvenance.config).toEqual(LEGACY_CAPITAL_REGION_CONFIG);
    expect(oldSaveProvenance.turns).toBe(3);
    expect(createHash("sha256").update(readFileSync(
      fileURLToPath(new URL("../e2e/fixtures/old-capital-region-save.json", import.meta.url)),
    )).digest("hex")).toBe(oldSaveProvenance.fixtureFileSha256);
    expect(JSON.parse(oldSave).dataVersion).toBe(oldSaveProvenance.bundleDataVersion);
    expect(data.manifest.ok).toBe(true);

    const archived = await loadBundle("old-edition");
    expect(archived.network.dataVersion).toBe(oldSaveProvenance.bundleDataVersion);
    expect(createHash("sha256").update(oldSave).digest("hex")).toBe(oldSaveProvenance.saveSha256);
    expect(Object.fromEntries(
      Object.entries(archived.payloads).map(([file, payload]) => [file, createHash("sha256").update(payload).digest("hex")]),
    )).toEqual(oldSaveProvenance.bundleSha256);
    expect(restoreGame(oldSave, archived.network, {
      expectedConfig: LEGACY_CAPITAL_REGION_CONFIG,
      requireSeededRolls: true,
    }).turn).toBe(oldSaveProvenance.turns);
    if (data.manifest.ok) expect(data.manifest.value.dataVersion).not.toBe(oldSaveProvenance.bundleDataVersion);
    expect(() => restoreGame(oldSave, network, {
      expectedConfig: MVP_GAME_CONFIG,
    })).toThrowError(expect.objectContaining({ code: "DATA_VERSION_MISMATCH" }));
  });

  it("rejects current-data saves made under the old rules", () => {
    const currentWithOldRules = createGame(LEGACY_CAPITAL_REGION_CONFIG, "old-rules-current-data", network);
    expect(() => restoreGame(serializeGame(currentWithOldRules), network, {
      expectedConfig: MVP_GAME_CONFIG,
    })).toThrowError(expect.objectContaining({ code: "CONFIG_MISMATCH" }));
  });

  it("retains rejected old-save bytes across repeated reads", () => {
    const storage = memoryStorage(oldSave);
    expect(readSave(storage, network, MVP_GAME_CONFIG)).toEqual({ kind: "invalid", problem: "data-version" });
    expect(readSave(storage, network, MVP_GAME_CONFIG)).toEqual({ kind: "invalid", problem: "data-version" });
    expect(storage.value).toBe(oldSave);
  });

  it("matches the pre-edition source, resumed, and next-turn save bytes", () => {
    expect(createHash("sha256").update(preEditionSave).digest("hex")).toBe(editionSaveCompatibility.sourceSha256);

    const resumed = restoreGame(preEditionSave, network, {
      expectedConfig: MVP_GAME_CONFIG,
      requireSeededRolls: true,
    });
    const resumedSave = serializeGame(resumed);
    expect(createHash("sha256").update(resumedSave).digest("hex")).toBe(editionSaveCompatibility.resumedSaveSha256);

    const nextTurnSave = serializeGame(playTurn(resumed, network).state);
    expect(createHash("sha256").update(nextTurnSave).digest("hex")).toBe(editionSaveCompatibility.nextTurnSaveSha256);
  });
});
