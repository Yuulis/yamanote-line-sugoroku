import { describe, expect, it } from "vitest";
import * as engine from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState, ItemInstance } from "../../src/types/network";
import { loadShippedBundle } from "../simulation/inputs";
import { chooseAdjustment, chooseDiscard, choosePreRoll, pick } from "../simulation/item-engine/policy";
import { LEGACY_ITEM_CONFIG, LEGACY_SIMULATION_CONFIG, PRODUCT_SIMULATION_CONFIG, runProductionGame } from "../simulation/item-engine/runner";

const { network } = loadShippedBundle("public/data", "jr-yamanote", "shimbashi");
const rng = engine.seedRng("s1m-20261012-0|policy");
function stateWith(kinds: ItemInstance["kind"][], seed: string = "s1m-20261012-0"): ItemGameState {
  return { ...engine.createItemGame(ITEM_GAME_CONFIG, seed, network),
    inventory: kinds.map((kind, index) => ({ id: `test-${index}`, kind })) };
}

describe("round-3 production policy adapter", () => {
  it("forces singleton choices without consuming a policy draw", () => {
    expect(pick([42], rng)).toEqual({ value: 42, rng });
    expect(() => pick([], rng)).toThrow("empty");
  });
  it("keeps the round-3 discard order and discards the newest on ties", () => {
    const candidates = stateWith(["roll-adjust", "delay-certificate", "rapid", "delay-certificate"]).inventory;
    expect(chooseDiscard(candidates, "greedy", rng)).toEqual({ instanceId: "test-3", rng });
    expect(chooseDiscard(stateWith(["deadhead", "route-ticket", "direction-ticket", "double"]).inventory, "greedy", rng).instanceId).toBe("test-3");
  });
  it("spends double before rapid on Yamanote and reserves adjust", () => {
    const state = stateWith(["rapid", "roll-adjust", "double"]);
    expect(choosePreRoll(state, network, "greedy", rng)).toMatchObject({
      command: { items: [{ kind: "double", instanceId: "test-2" }] }, adjust: false, rng,
    });
  });
  it("blocks active items under delay and oversleep", () => {
    const state = stateWith(["double", "rapid", "roll-adjust"]);
    for (const effects of [{ ...state.effects, delayDueTurns: [1] }, { ...state.effects, oversleepPending: true }]) {
      expect(choosePreRoll({ ...state, effects }, network, "random", rng)).toEqual({ command: { items: [] }, adjust: false, decision: false, rng });
    }
  });
  it("random chooses unique usable kinds rather than inventory slots", () => {
    const state = stateWith(["double", "double", "rapid"]);
    const draw = engine.drawIndex(rng, 2);
    const chosen = choosePreRoll(state, network, "random", rng);
    expect(chosen.command.items[0]?.kind).toBe(["double", "rapid"][draw.index]);
    expect(chosen.rng).toBe(draw.nextRngState);
    expect(state.rngState).toBe(engine.seedRng("s1m-20261012-0"));
  });
  it("random adjust honors face bounds without advancing a forced policy draw", () => {
    const initial = stateWith(["roll-adjust"]);
    const revealed = engine.beginItemTurn(initial, { items: [] }, network).state;
    if (revealed.pending?.kind !== "roll") throw new Error("Expected roll");
    const result = chooseAdjustment(revealed, network, "random", true, rng, { maxFace: LEGACY_SIMULATION_CONFIG.maxFace });
    expect(result.adjustment?.instanceId).toBe("test-0");
    const adjusted = revealed.pending.rawRoll + result.adjustment!.delta;
    expect(adjusted).toBeGreaterThanOrEqual(1);
    expect(adjusted).toBeLessThanOrEqual(6);
    if (revealed.pending.rawRoll === 1 || revealed.pending.rawRoll === 6) expect(result.rng).toBe(rng);
    expect(chooseAdjustment(revealed, network, "greedy", false, rng, { maxFace: LEGACY_SIMULATION_CONFIG.maxFace }).adjustment).toBeNull();
  });
  it("chooses the target route before a direction ticket off target", () => {
    const state = { ...stateWith(["direction-ticket", "route-ticket"]), currentServiceId: "jr-keihin-tohoku" };
    // Select a real non-target service that calls at the starting station.
    state.currentServiceId = network.servicesByStation.get(state.currentStationId)!.find((id) => id !== state.config.targetServiceId)!;
    expect(choosePreRoll(state, network, "greedy", rng).command.items[0]).toMatchObject({ kind: "route-ticket", serviceId: "jr-yamanote" });
  });
  it("boards Yamanote with a route ticket when suspension leaves it the only eligible service", () => {
    const base = stateWith(["route-ticket"]);
    const services = network.servicesByStation.get(base.currentStationId)!;
    const state = { ...base, currentServiceId: services.find((id) => id !== base.config.targetServiceId)!,
      effects: { ...base.effects, suspensions: services.filter((id) => id !== base.config.targetServiceId).map((serviceId) => ({ serviceId, expiresTurn: 5 })) } };
    expect(engine.routeTicketOptions(state, { turn: 1, suspensions: state.effects.suspensions }, network).options.services).toEqual(["jr-yamanote"]);
    const command = choosePreRoll(state, network, "greedy", rng).command;
    expect(command.items).toEqual([{ kind: "route-ticket", instanceId: "test-0", serviceId: "jr-yamanote" }]);
    expect(engine.beginItemTurn(state, command, network).state.pending).toMatchObject({ resolvedRide: { serviceId: "jr-yamanote" } });
  });
  it("history trimming preserves all policy measurements and trace output", () => {
    const full = runProductionGame(network, "s1m-20261012-0", "greedy", 20000, LEGACY_SIMULATION_CONFIG, true, true);
    const trimmed = runProductionGame(network, "s1m-20261012-0", "greedy", 20000, LEGACY_SIMULATION_CONFIG, false, true);
    expect(full.error).toBeNull();
    expect(full.completed).toBe(true);
    expect({ ...full, saveChecks: {} }).toEqual(trimmed);
  }, 10000);

  it("keeps the test-only simulation config equal to the frozen legacy rules literal", () => {
    expect(LEGACY_ITEM_CONFIG).toEqual({
      rulesetVersion: "tokyo-suburban-items-1",
      targetServiceId: "jr-yamanote",
      startStationId: "shimbashi",
      targetDirection: 1,
      goalArrivalPolicy: "truncate-on-target-service",
      serviceLottery: { kindWeights: { local: 1, rapid: 1 }, target: { kind: "share", numerator: 1, denominator: 2 } },
      directionLottery: { towardTargetWeight: 3, awayFromTargetWeight: 2 },
      itemPolicy: {
        dropChancePerMille: 300,
        harmfulChancePercent: 30,
        inventoryCapacity: 3,
        maxActiveItemsPerTurn: 1,
        delayTurns: 3,
        suspensionTurns: 5,
        fullInventoryPolicy: "player-chooses-discard",
        beneficialKinds: ["route-ticket", "direction-ticket", "roll-adjust", "double", "rapid", "deadhead", "delay-certificate"],
        beneficialWeights: [1, 1, 1, 1, 1, 1, 1],
        harmfulKinds: ["delay", "suspension", "detour", "oversleep"],
      },
    });
    expect(LEGACY_SIMULATION_CONFIG.gameConfig).toEqual(LEGACY_ITEM_CONFIG);
    expect(PRODUCT_SIMULATION_CONFIG.gameConfig).toEqual(ITEM_GAME_CONFIG);
    expect(LEGACY_SIMULATION_CONFIG.maxFace).toBe(6);
    expect(PRODUCT_SIMULATION_CONFIG.maxFace).toBeUndefined();
  });

  it("lets the product chooser reach face 7 and 9 while legacy stays capped at six", () => {
    const pendingWith = (kind: "roll-adjust" | "roll-adjust-3", suffix: string): ItemGameState => {
      for (let index = 0; index < 100; index += 1) {
        const base = engine.createItemGame(PRODUCT_SIMULATION_CONFIG.gameConfig, `${suffix}-${index}`, network);
        const held = { ...base, inventory: [{ id: "test-adjust", kind }] };
        const candidate = engine.beginItemTurn(held, { items: [] }, network).state;
        if (candidate.pending?.kind === "roll" && candidate.pending.rawRoll === 6) return candidate;
      }
      throw new Error(`Could not find a seeded six for ${kind}`);
    };
    let productRng = "";
    for (let index = 0; index < 100 && productRng === ""; index += 1) {
      const candidate = engine.seedRng(`item-policy-positive-adjust-${index}`);
      if (engine.drawIndex(candidate, 2).index === 1) productRng = candidate;
    }
    if (productRng === "") throw new Error("Could not find a policy seed that chooses a positive adjustment");

    const plusOne = chooseAdjustment(pendingWith("roll-adjust", "product-plus-one"), network, "random", true, productRng,
      { maxFace: PRODUCT_SIMULATION_CONFIG.maxFace });
    const plusThree = chooseAdjustment(pendingWith("roll-adjust-3", "product-plus-three"), network, "random", true, productRng,
      { maxFace: PRODUCT_SIMULATION_CONFIG.maxFace });
    const legacyState = engine.createItemGame(LEGACY_SIMULATION_CONFIG.gameConfig, "legacy-boundary", network);
    const legacyPending = (() => {
      for (let index = 0; index < 100; index += 1) {
        const base = engine.createItemGame(LEGACY_SIMULATION_CONFIG.gameConfig, `legacy-boundary-${index}`, network);
        const held = { ...base, inventory: [{ id: "test-adjust", kind: "roll-adjust" as const }] };
        const candidate = engine.beginItemTurn(held, { items: [] }, network).state;
        if (candidate.pending?.kind === "roll" && candidate.pending.rawRoll === 6) return candidate;
      }
      throw new Error("Could not find a seeded legacy six");
    })();
    expect(legacyState.turn).toBe(0);
    const legacy = chooseAdjustment(legacyPending, network, "random", true, productRng, { maxFace: LEGACY_SIMULATION_CONFIG.maxFace });
    expect(plusOne.adjustment).toEqual({ instanceId: "test-adjust", delta: 1 });
    expect(legacyPending.pending?.kind === "roll" ? legacyPending.pending.rawRoll + legacy.adjustment!.delta : null).toBe(5);
    expect(plusThree.adjustment).toEqual({ instanceId: "test-adjust", delta: 3 });
    const randomAdjustmentRng = engine.drawIndex(productRng, 2).nextRngState;
    expect(plusOne.rng).toBe(randomAdjustmentRng);
    expect(plusThree.rng).toBe(randomAdjustmentRng);
    expect(legacy.rng).toBe(productRng);
    expect(6 + plusOne.adjustment!.delta).toBe(7);
    expect(6 + plusThree.adjustment!.delta).toBe(9);
  });
});
