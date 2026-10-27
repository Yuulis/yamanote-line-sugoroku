import { describe, expect, it } from "vitest";
import { createGame, playTurn, rollDie, seedRng } from "../../src/features/game/engine";
import { CLASSIC_GAME_CONFIG, MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { loadBundle } from "../e2e/fixtures/bundle";

const bundle = await loadBundle("real");

describe("classic ruleset regression", () => {
  it("keeps the complete classic configuration literal", () => {
    expect(CLASSIC_GAME_CONFIG).toEqual({
      rulesetVersion: "tokyo-suburban-1",
      targetServiceId: "jr-yamanote",
      startStationId: "shimbashi",
      targetDirection: 1,
      goalArrivalPolicy: "truncate-on-target-service",
      serviceLottery: {
        kindWeights: { local: 1, rapid: 1 },
        target: { kind: "share", numerator: 2, denominator: 3 },
      },
      directionLottery: { towardTargetWeight: 2 },
    });
  });

  it("keeps the MVP alias on classic until S11 switches the shipped configuration", () => {
    expect(MVP_GAME_CONFIG).toBe(CLASSIC_GAME_CONFIG);
  });

  it("locks the first twelve die draws for the classic seed", () => {
    let rngState = seedRng("yamanote");
    const rolls: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const result = rollDie(rngState);
      rolls.push(result.value);
      rngState = result.nextRngState;
    }
    expect(rolls).toEqual([2, 6, 1, 3, 1, 4, 2, 6, 1, 4, 1, 6]);
  });

  it("locks a short mixed-turn classic trajectory including a landing lottery", () => {
    let state = createGame(CLASSIC_GAME_CONFIG, "classic-s1-trajectory", bundle.network);
    const turns = [];
    let lotteryObserved = false;
    for (let index = 0; index < 5; index += 1) {
      const result = playTurn(state, bundle.network);
      lotteryObserved ||= result.events.some((event) =>
        event.type === "landing-resolved" && (event.serviceDrawRequired || event.directionDrawRequired),
      );
      const record = result.state.movementHistory.at(-1)!;
      turns.push({
        roll: record.roll,
        serviceId: record.serviceId,
        direction: record.direction,
        from: record.fromStationId,
        to: record.toStationId,
        stopReason: record.stopReason,
        landing: record.landing,
      });
      state = result.state;
    }
    expect(lotteryObserved).toBe(true);
    expect(turns).toEqual([
      {
        roll: 2,
        serviceId: "jr-yamanote",
        direction: 1,
        from: "shimbashi",
        to: "tamachi",
        stopReason: "roll",
        landing: { serviceId: "jr-yamanote", direction: 1 },
      },
      {
        roll: 2,
        serviceId: "jr-yamanote",
        direction: 1,
        from: "tamachi",
        to: "shinagawa",
        stopReason: "roll",
        landing: { serviceId: "jr-yamanote", direction: 1 },
      },
      {
        roll: 5,
        serviceId: "jr-yamanote",
        direction: 1,
        from: "shinagawa",
        to: "shibuya",
        stopReason: "roll",
        landing: { serviceId: "jr-yamanote", direction: 1 },
      },
      {
        roll: 4,
        serviceId: "jr-yamanote",
        direction: 1,
        from: "shibuya",
        to: "shin-okubo",
        stopReason: "roll",
        landing: { serviceId: "jr-yamanote", direction: 1 },
      },
      {
        roll: 5,
        serviceId: "jr-yamanote",
        direction: 1,
        from: "shin-okubo",
        to: "sugamo",
        stopReason: "roll",
        landing: { serviceId: "toei-mita", direction: -1 },
      },
    ]);
  });
});
