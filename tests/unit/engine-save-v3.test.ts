import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork, createGame, landingOptions, moveByRoll, playTurn, restoreGame, rollDie, SAVE_VERSION, serializeGame,
} from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { GameConfig, GameState } from "../../src/types/network";
import { deleteSave, readSave, SAVE_STORAGE_KEY, type StorageLike } from "../../src/features/game/store/persistence";
import { kindInput, lotteryConfig } from "./fixtures/lottery";
import { M_LINE, multiServiceInput } from "./fixtures/multiService";
import { yamanoteInput } from "./fixtures/yamanote";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const network = buildRailwayNetwork(kindInput());
const yamanoteNetwork = buildRailwayNetwork(yamanoteInput());
const INVALID_SAVE = expect.objectContaining({ code: "INVALID_SAVE" });
type RawConfig = Record<string, unknown>;

function tampered(state: GameState, edit: (raw: RawConfig) => void): string {
  const raw = JSON.parse(serializeGame(state)) as { config: RawConfig };
  edit(raw.config);
  return JSON.stringify(raw);
}

function seededStates(config: GameConfig, seed: string): GameState[] {
  let state = createGame(config, seed, network);
  const states = [state];
  while (state.status === "playing" && state.turn < 500) {
    state = playTurn(state, network).state;
    states.push(state);
  }
  return states;
}

describe("save v3 lottery policies", () => {
  it("rejects a save made under the previously shipped ruleset", () => {
    // Legacy config creates the archived save; the current production config
    // is the expected restore target for this compatibility rejection proof.
    const oldSave = serializeGame(createGame(LEGACY_CAPITAL_REGION_CONFIG, "previous-ruleset", yamanoteNetwork));

    expect(() => restoreGame(oldSave, yamanoteNetwork, { expectedConfig: MVP_GAME_CONFIG }))
      .toThrowError(expect.objectContaining({ code: "CONFIG_MISMATCH" }));
  });

  it.each([
    ["share", "weighted-save-30"],
    // First weighted-save-v3-N (N ascending from 0) completing within 500 turns
    // with >0 non-equal service draws AND >0 non-equal direction draws: N=32.
    ["weight", "weighted-save-v3-32"],
  ] as const)("v3 %s policy round trips every seeded turn and resumes identically", (kind, seed) => {
    const config = lotteryConfig();
    if (kind === "weight") config.serviceLottery.target = { kind: "weight", weight: 3 };
    const states = seededStates(config, seed);
    expect(SAVE_VERSION).toBe(3);
    expect(states.at(-1)?.status).toBe("completed");
    let nonEqualServiceDraws = 0;
    let nonEqualDirectionDraws = 0;
    for (const record of states.at(-1)!.movementHistory) {
      if (!record.landing) continue;
      const options = landingOptions({
        config, currentStationId: record.toStationId,
        currentServiceId: record.serviceId, direction: record.direction,
      }, network);
      if (options.serviceDrawRequired && new Set(options.serviceWeights).size > 1) nonEqualServiceDraws += 1;
      const directionWeights = options.directionWeightsByService.get(record.landing.serviceId)!;
      if (directionWeights.length > 1 && new Set(directionWeights).size > 1) nonEqualDirectionDraws += 1;
    }
    expect(nonEqualServiceDraws).toBeGreaterThan(0);
    expect(nonEqualDirectionDraws).toBeGreaterThan(0);
    for (const state of states) {
      const restored = restoreGame(serializeGame(state), network, { expectedConfig: config, requireSeededRolls: true });
      expect(restored).toEqual(state);
      expect(restored.saveVersion).toBe(3);
      if (state.status === "playing") expect(playTurn(restored, network)).toEqual(playTurn(state, network));
    }
  });

  it("v3 structural replay still accepts a legal injected weighted landing", () => {
    const initial = createGame(lotteryConfig(), "injected-weighted", network);
    const injected = moveByRoll(initial, 2, network, { serviceId: M_LINE, direction: -1 }).state;
    expect(restoreGame(serializeGame(injected), network)).toEqual(injected);
    expect(() => restoreGame(serializeGame(injected), network, { requireSeededRolls: true }))
      .toThrowError(expect.objectContaining({ code: "RNG_MISMATCH" }));
  });

  it("a clearing weighted turn consumes the die only and records no landing", () => {
    const states = seededStates(lotteryConfig(), "weighted-save");
    const before = states.at(-2)!;
    const completed = states.at(-1)!;
    expect(completed.status).toBe("completed");
    expect(completed.rngState).toBe(rollDie(before.rngState).nextRngState);
    expect(completed.movementHistory.at(-1)?.landing).toBeNull();
  });

  it("policy comparison ignores object key order", () => {
    const config = lotteryConfig();
    const state = createGame(config, "ordered", network);
    const json = tampered(state, (raw) => {
      raw.directionLottery = { towardTargetWeight: 2 };
      raw.serviceLottery = {
        target: { denominator: 5, kind: "share", numerator: 2 },
        kindWeights: { rapid: 3, local: 2 },
      };
    });
    expect(restoreGame(json, network, { expectedConfig: config })).toEqual(state);
  });

  it.each<[string, (config: GameConfig) => void]>([
    ["ruleset version", (config) => { config.rulesetVersion = "jr-east-23ku-1"; }],
    ["target service", (config) => { config.targetServiceId = "other-target"; }],
    ["start station", (config) => { config.startStationId = "tokyo"; }],
    ["target direction", (config) => { config.targetDirection = -1; }],
    ["goal arrival policy", (config) => { config.goalArrivalPolicy = "exact-stop"; }],
    ["local kind base", (config) => { (config.serviceLottery.kindWeights as Record<string, number>).local = 99; }],
    ["rapid kind base", (config) => { (config.serviceLottery.kindWeights as Record<string, number>).rapid = 99; }],
    ["share numerator", (config) => { config.serviceLottery.target = { kind: "share", numerator: 1, denominator: 5 }; }],
    ["share denominator", (config) => { config.serviceLottery.target = { kind: "share", numerator: 2, denominator: 6 }; }],
    ["target mode", (config) => { config.serviceLottery.target = { kind: "weight", weight: 2 }; }],
    ["direction weight", (config) => { config.directionLottery.towardTargetWeight = 3; }],
  ])("rejects a nested config mismatch: %s", (_label, edit) => {
    const config = lotteryConfig();
    const state = createGame(config, "mismatch", network);
    const expected = structuredClone(config);
    edit(expected);
    expect(() => restoreGame(serializeGame(state), network, { expectedConfig: expected }))
      .toThrowError(expect.objectContaining({ code: "CONFIG_MISMATCH" }));
  });

  it("compares weight multipliers even when no history exists", () => {
    const config = lotteryConfig();
    config.serviceLottery.target = { kind: "weight", weight: 2 };
    const state = createGame(config, "weight-mismatch", network);
    config.serviceLottery.target.weight = 3;
    expect(() => restoreGame(serializeGame(state), network, { expectedConfig: config }))
      .toThrowError(expect.objectContaining({ code: "CONFIG_MISMATCH" }));
  });

  it.each<[string, (raw: RawConfig) => void]>([
    ["missing service policy", (raw) => { delete raw.serviceLottery; }],
    ["missing direction policy", (raw) => { delete raw.directionLottery; }],
    ["missing kind base", (raw) => { delete ((raw.serviceLottery as RawConfig).kindWeights as RawConfig).local; }],
    ["unknown policy key", (raw) => { (raw.directionLottery as RawConfig).typo = 2; }],
    ["unknown kind key", (raw) => { ((raw.serviceLottery as RawConfig).kindWeights as RawConfig).express = 1; }],
    ["invalid share", (raw) => { (raw.serviceLottery as RawConfig).target = { kind: "share", numerator: 0, denominator: 2 }; }],
    ["excessive integer", (raw) => { (raw.directionLottery as RawConfig).towardTargetWeight = 1001; }],
  ])("v3 parse rejects malformed policies before config comparison: %s", (_label, edit) => {
    const state = createGame(lotteryConfig(), "malformed", network);
    expect(() => restoreGame(tampered(state, edit), network, { expectedConfig: lotteryConfig() }))
      .toThrowError(INVALID_SAVE);
  });

  it("restored policies and expected config never share nested mutable objects", () => {
    const config = lotteryConfig();
    const original = createGame(config, "copy-restore", network);
    const restored = restoreGame(serializeGame(original), network, { expectedConfig: config });
    (restored.config.serviceLottery.kindWeights as Record<string, number>).local = 1000;
    restored.config.serviceLottery.target = { kind: "weight", weight: 1000 };
    restored.config.directionLottery.towardTargetWeight = 1000;
    expect(original.config).toEqual(lotteryConfig());
    expect(config).toEqual(lotteryConfig());
  });

  it("v2 is rejected before checking data, config or history, through the existing discard path", () => {
    const json = JSON.stringify({ saveVersion: 2, dataVersion: "old", config: null });
    expect(() => restoreGame(json, buildRailwayNetwork(multiServiceInput())))
      .toThrowError(expect.objectContaining({ code: "UNSUPPORTED_SAVE_VERSION" }));
    const values = new Map([[SAVE_STORAGE_KEY, json]]);
    const storage: StorageLike = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); },
    };
    expect(readSave(storage, network, lotteryConfig())).toEqual({ kind: "invalid", problem: "unsupported-version" });
    expect(deleteSave(storage)).toBe(true);
    expect(readSave(storage, network, lotteryConfig())).toEqual({ kind: "none" });
  });
});
