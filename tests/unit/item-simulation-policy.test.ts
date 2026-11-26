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

  it("keeps the test-only legacy config identical to the current product config", () => {
    expect(LEGACY_ITEM_CONFIG).toEqual(ITEM_GAME_CONFIG);
    expect(LEGACY_SIMULATION_CONFIG.maxFace).toBe(6);
    expect(PRODUCT_SIMULATION_CONFIG.maxFace).toBeUndefined();
  });

  it("keeps both chooser paths within the temporary 1..6 face bound", () => {
    let revealed: ItemGameState | null = null;
    for (let index = 0; index < 100 && revealed === null; index += 1) {
      const candidate = engine.beginItemTurn(stateWith(["roll-adjust"], `s1m-20261012-${index}`), { items: [] }, network).state;
      if (candidate.pending?.kind === "roll" && candidate.pending.rawRoll === 6) revealed = candidate;
    }
    if (revealed === null) throw new Error("Could not find a seeded six for the adjustment boundary test");
    let productRng = "";
    for (let index = 0; index < 100 && productRng === ""; index += 1) {
      const candidate = engine.seedRng(`item-policy-max-face-${index}`);
      if (engine.drawIndex(candidate, 2).index === 1) productRng = candidate;
    }
    if (productRng === "") throw new Error("Could not find a policy seed that chooses +1");

    const legacy = chooseAdjustment(revealed, network, "random", true, productRng, { maxFace: LEGACY_SIMULATION_CONFIG.maxFace });
    const product = chooseAdjustment(revealed, network, "random", true, productRng, { maxFace: PRODUCT_SIMULATION_CONFIG.maxFace });
    expect(legacy.adjustment).toEqual({ instanceId: "test-0", delta: -1 });
    expect(product.adjustment).toEqual({ instanceId: "test-0", delta: -1 });
    expect(legacy.rng).toBe(productRng);
    expect(product.rng).toBe(productRng);
  });
});
