import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame, moveByRoll, playTurn, validateConfig } from "../../src/features/game/engine";
import type { GameConfig } from "../../src/types/network";
import { kindInput, lotteryConfig } from "./fixtures/lottery";
import { M_LOOP } from "./fixtures/multiService";
import { deepFreeze } from "./fixtures/yamanote";

const network = buildRailwayNetwork(kindInput());
const INVALID = expect.objectContaining({ code: "INVALID_CONFIG" });
type RawPolicies = { serviceLottery: Record<string, unknown>; directionLottery: Record<string, unknown> };

function edited(edit: (raw: RawPolicies) => void): GameConfig {
  const config = lotteryConfig();
  edit(config as unknown as RawPolicies);
  return config;
}

describe("lottery config validation", () => {
  it.each([1, 1000])("accepts inclusive integer base and multiplier limits %d", (weight) => {
    const config = lotteryConfig();
    config.serviceLottery.kindWeights = { local: weight, rapid: weight };
    config.serviceLottery.target = { kind: "weight", weight };
    config.directionLottery.towardTargetWeight = weight;
    expect(() => validateConfig(config, network)).not.toThrow();
  });

  it("accepts the largest share denominator", () => {
    const config = lotteryConfig();
    config.serviceLottery.target = { kind: "share", numerator: 999, denominator: 1000 };
    expect(() => validateConfig(config, network)).not.toThrow();
  });

  it.each([0, -1, 1.5, 1001, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    "rejects invalid policy integer %s in every weight position", (weight) => {
      for (const config of [
        edited((raw) => { (raw.serviceLottery.kindWeights as Record<string, unknown>).rapid = weight; }),
        edited((raw) => { raw.serviceLottery.target = { kind: "weight", weight }; }),
        edited((raw) => { raw.directionLottery.towardTargetWeight = weight; }),
      ]) expect(() => validateConfig(config, network)).toThrowError(INVALID);
    },
  );

  it.each([[0, 2], [-1, 2], [2, 2], [3, 2], [1.5, 3], [1, 2.5], [1, 1001]])(
    "rejects invalid share %s/%s", (numerator, denominator) => {
      const config = lotteryConfig();
      config.serviceLottery.target = { kind: "share", numerator, denominator };
      expect(() => validateConfig(config, network)).toThrowError(INVALID);
    },
  );

  it.each<[string, (raw: RawPolicies) => void]>([
    ["missing service policy", (raw) => { delete (raw as Partial<RawPolicies>).serviceLottery; }],
    ["missing direction policy", (raw) => { delete (raw as Partial<RawPolicies>).directionLottery; }],
    ["array service policy", (raw) => { raw.serviceLottery = [] as unknown as Record<string, unknown>; }],
    ["null direction policy", (raw) => { raw.directionLottery = null as unknown as Record<string, unknown>; }],
    ["unknown service key", (raw) => { raw.serviceLottery.extra = 1; }],
    ["unknown kind", (raw) => { (raw.serviceLottery.kindWeights as Record<string, unknown>).express = 1; }],
    ["missing kind", (raw) => { delete (raw.serviceLottery.kindWeights as Record<string, unknown>).rapid; }],
    ["unknown target kind", (raw) => { raw.serviceLottery.target = { kind: "other", weight: 1 }; }],
    ["extra share weight", (raw) => { (raw.serviceLottery.target as Record<string, unknown>).weight = 1; }],
    ["extra weight numerator", (raw) => { raw.serviceLottery.target = { kind: "weight", weight: 1, numerator: 1 }; }],
    ["missing multiplier", (raw) => { raw.serviceLottery.target = { kind: "weight" }; }],
    ["missing direction weight", (raw) => { delete raw.directionLottery.towardTargetWeight; }],
    ["unknown direction key", (raw) => { raw.directionLottery.extra = 1; }],
    ["string base", (raw) => { (raw.serviceLottery.kindWeights as Record<string, unknown>).local = "2"; }],
  ])("rejects policy keys and shapes: %s", (_label, edit) => {
    expect(() => validateConfig(edited(edit), network)).toThrowError(INVALID);
  });

  it("rejects an unknown explicitly supplied service kind", () => {
    const input = kindInput();
    input.services[0]!.kind = "express" as NonNullable<typeof input.services[0]>["kind"];
    expect(() => buildRailwayNetwork(input)).toThrowError(expect.objectContaining({ code: "INVALID_NETWORK" }));
  });
});

describe("nested config isolation", () => {
  it("createGame deep copies bases, target policy and direction policy", () => {
    const config = lotteryConfig();
    const snapshot = structuredClone(config);
    const state = createGame(config, "copy", network);
    expect(state.config.serviceLottery.target).not.toBe(config.serviceLottery.target);
    if (config.serviceLottery.target.kind === "share") config.serviceLottery.target.numerator = 1;
    (config.serviceLottery.kindWeights as Record<string, number>).rapid = 999;
    config.serviceLottery.target = { kind: "weight", weight: 999 };
    config.directionLottery.towardTargetWeight = 999;
    expect(state.config).toEqual(snapshot);
    expect(state.config.serviceLottery).not.toBe(config.serviceLottery);
  });

  it("seeded and injected turns deep copy nested config instead of sharing earlier states", () => {
    const initial = deepFreeze(createGame(lotteryConfig(), "copy-turn", network));
    const seeded = playTurn(initial, network).state;
    const injected = moveByRoll(initial, 1, network, { serviceId: M_LOOP, direction: 1 }).state;
    for (const next of [seeded, injected]) {
      expect(next.config).toEqual(initial.config);
      expect(next.config).not.toBe(initial.config);
      expect(next.config.serviceLottery.kindWeights).not.toBe(initial.config.serviceLottery.kindWeights);
      (next.config.serviceLottery.kindWeights as Record<string, number>).local = 1000;
      next.config.directionLottery.towardTargetWeight = 1000;
      if (next.config.serviceLottery.target.kind === "share") next.config.serviceLottery.target.numerator = 1;
      expect(initial.config).toEqual(lotteryConfig());
    }
  });
});
