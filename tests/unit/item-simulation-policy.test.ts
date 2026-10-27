import { describe, expect, it } from "vitest";
import * as engine from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState, ItemInstance } from "../../src/types/network";
import { loadShippedBundle } from "../simulation/inputs";
import { chooseAdjustment, chooseDiscard, choosePreRoll, pick } from "../simulation/item-engine/policy";
import { runProductionGame } from "../simulation/item-engine/runner";

const { network } = loadShippedBundle("public/data", "jr-yamanote", "shimbashi");
const rng = engine.seedRng("s1m-20261012-0|policy");
function stateWith(kinds: ItemInstance["kind"][]): ItemGameState {
  return { ...engine.createItemGame(ITEM_GAME_CONFIG, "s1m-20261012-0", network),
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
    const result = chooseAdjustment(revealed, network, "random", true, rng);
    expect(result.adjustment?.instanceId).toBe("test-0");
    const adjusted = revealed.pending.rawRoll + result.adjustment!.delta;
    expect(adjusted).toBeGreaterThanOrEqual(1);
    expect(adjusted).toBeLessThanOrEqual(6);
    if (revealed.pending.rawRoll === 1 || revealed.pending.rawRoll === 6) expect(result.rng).toBe(rng);
    expect(chooseAdjustment(revealed, network, "greedy", false, rng).adjustment).toBeNull();
  });
  it("chooses the target route before a direction ticket off target", () => {
    const state = { ...stateWith(["direction-ticket", "route-ticket"]), currentServiceId: "jr-keihin-tohoku" };
    // Select a real non-target service that calls at the starting station.
    state.currentServiceId = network.servicesByStation.get(state.currentStationId)!.find((id) => id !== state.config.targetServiceId)!;
    expect(choosePreRoll(state, network, "greedy", rng).command.items[0]).toMatchObject({ kind: "route-ticket", serviceId: "jr-yamanote" });
  });
  it("exposes the singleton-target route discrepancy instead of issuing an illegal command", () => {
    const base = stateWith(["route-ticket"]);
    const services = network.servicesByStation.get(base.currentStationId)!;
    const state = { ...base, currentServiceId: services.find((id) => id !== base.config.targetServiceId)!,
      effects: { ...base.effects, suspensions: services.filter((id) => id !== base.config.targetServiceId).map((serviceId) => ({ serviceId, expiresTurn: 5 })) } };
    expect(engine.routeTicketOptions(state, { turn: 1, suspensions: state.effects.suspensions }, network).options.services).toEqual(["jr-yamanote"]);
    expect(choosePreRoll(state, network, "greedy", rng).command.items).toEqual([]);
    expect(() => engine.beginItemTurn(state, { items: [{ kind: "route-ticket", instanceId: "test-0", serviceId: "jr-yamanote" }] }, network)).toThrow("choice of eligible services");
  });
  it("history trimming preserves all policy measurements and trace output", () => {
    const full = runProductionGame(network, "s1m-20261012-0", "greedy", 20000, true, true);
    const trimmed = runProductionGame(network, "s1m-20261012-0", "greedy", 20000, false, true);
    expect(full.error).toBeNull();
    expect(full.completed).toBe(true);
    expect({ ...full, saveChecks: {} }).toEqual(trimmed);
  }, 10000);
});
