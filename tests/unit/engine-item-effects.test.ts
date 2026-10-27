import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork, clearDetour, clearOversleep, consumeDelayDue,
  consumeInventoryInstance, createItemEffectsState, createGame,
  filterLandingOptions, isDelayDue, landingOptions, pruneExpiredSuspensions,
  scheduleDelay, scheduleDetour, scheduleOversleep, scheduleSuspension,
} from "../../src/features/game/engine";
import { deepFreeze } from "./fixtures/yamanote";
import { M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
import type { ItemEffectsState, ItemInstance } from "../../src/types/network";

const network = buildRailwayNetwork(multiServiceInput());

describe("harmful item effect reducers", () => {
  it("schedules delay at exactly t+3, deduplicates, queries and consumes due turns immutably", () => {
    const original = deepFreeze(createItemEffectsState());
    const one = scheduleDelay(original, 8);
    const two = scheduleDelay(one, 8);
    expect(two.delayDueTurns).toEqual([8]);
    expect(isDelayDue(two, 7)).toBe(false);
    expect(isDelayDue(two, 8)).toBe(true);
    const consumed = consumeDelayDue(two, 8);
    expect(consumed).toEqual({ state: { ...two, delayDueTurns: [] }, consumed: true });
    expect(original.delayDueTurns).toEqual([]);
    expect(scheduleDelay(original, 5 + 3).delayDueTurns).toEqual([8]);
  });

  it("keeps suspension through t+5 and makes the service available at t+6", () => {
    const base = createGame(multiConfig(), "item-effect-boundary", network);
    const position = { ...base, currentStationId: "b", currentServiceId: M_LOOP };
    const options = landingOptions(position, network);
    const state = scheduleSuspension(createItemEffectsState(), M_LINE, 5 + 5);
    const atBoundary = filterLandingOptions(options, position.config,
      { turn: 10, suspensions: state.suspensions }, network);
    const afterBoundary = filterLandingOptions(options, position.config,
      { turn: 11, suspensions: state.suspensions }, network);
    expect(atBoundary.options.services).not.toContain(M_LINE);
    expect(afterBoundary.options.services).toContain(M_LINE);
  });

  it("refreshes a repeated suspension and keeps service entries ordered", () => {
    let state: ItemEffectsState = createItemEffectsState();
    state = scheduleSuspension(state, M_SPUR, 9);
    state = scheduleSuspension(state, M_LINE, 8);
    state = scheduleSuspension(state, M_SPUR, 12);
    expect(state.suspensions).toEqual([
      { serviceId: M_LINE, expiresTurn: 8 }, { serviceId: M_SPUR, expiresTurn: 12 },
    ]);
    expect(pruneExpiredSuspensions(state, 9).suspensions).toEqual([{ serviceId: M_SPUR, expiresTurn: 12 }]);
    expect(pruneExpiredSuspensions(state, 12).suspensions).toHaveLength(1);
    expect(pruneExpiredSuspensions(state, 13).suspensions).toEqual([]);
  });

  it("keeps detour and oversleep as non-stacking flags and clears them immutably", () => {
    const original = deepFreeze(createItemEffectsState());
    const repeated = scheduleOversleep(scheduleOversleep(scheduleDetour(scheduleDetour(original))));
    expect(repeated).toMatchObject({ detourPending: true, oversleepPending: true });
    expect(clearDetour(repeated).detourPending).toBe(false);
    expect(clearOversleep(repeated).oversleepPending).toBe(false);
    expect(original).toEqual({ delayDueTurns: [], suspensions: [], detourPending: false, oversleepPending: false });
  });

  it("consumes an inventory instance by id and validates missing ids", () => {
    const inventory: readonly ItemInstance[] = deepFreeze([
      { id: "one", kind: "double" }, { id: "two", kind: "rapid" },
    ]);
    const result = consumeInventoryInstance(inventory, "one");
    expect(result).toEqual({
      inventory: [{ id: "two", kind: "rapid" }],
      consumed: { id: "one", kind: "double" },
      events: [{ type: "consumed", item: { id: "one", kind: "double" } }],
    });
    expect(inventory).toHaveLength(2);
    expect(() => consumeInventoryInstance(inventory, "missing")).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
  });
});
