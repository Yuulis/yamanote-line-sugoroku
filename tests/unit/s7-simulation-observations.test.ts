import { describe, expect, it } from "vitest";
import {
  lotteryEligibility,
  summarizeObservations,
  wilsonInterval,
  type ObservationGame,
} from "../simulation/suburban-observations";

const game = (overrides: Partial<ObservationGame> = {}): ObservationGame => ({
  seed: "s1m-20261012-0", turns: 3, hops: 5, completed: true, errors: 0,
  errorMessages: [], zeroHopPlayingTurns: 0, invalidChoices: 0,
  unreachableStations: 0, invalidTransitions: 0, weightViolations: 0, capHit: false,
  targetDraws: 0, targetSelections: 0, towardDraws: 0, towardSelections: 0,
  targetExpectedSelections: 0, towardExpectedSelections: 0,
  equalDistanceDraws: 0, equalDistanceForwardSelections: 0,
  ...overrides,
});

describe("S7 observation aggregation", () => {
  it("aggregates game counters and nearest-rank hop statistics", () => {
    const result = summarizeObservations([game(), game({ seed: "s1m-20261012-1", turns: 4, hops: 8, completed: false, capHit: true })]);
    expect(result.games).toBe(2);
    expect(result.completedGames).toBe(1);
    expect(result.totalHops).toBe(13);
    expect(result.hops.median).toBe(5);
    expect(result.capSeeds).toEqual(["s1m-20261012-1"]);
  });

  it("rejects duplicate or malformed seeds before aggregating", () => {
    expect(() => summarizeObservations([game(), game()])).toThrow(/duplicate seed/i);
    expect(() => summarizeObservations([game({ seed: "bad" })])).toThrow(/seed/i);
  });

  it("counts only eligible target and direction lotteries", () => {
    expect(lotteryEligibility({
      serviceCandidates: ["jr-yamanote"], serviceDrawRequired: false,
      selectedService: "jr-yamanote", targetService: "jr-yamanote",
      directionDrawRequired: false, nextDistances: [0],
    })).toEqual({ targetService: false, towardTarget: false, equalDistance: false });
    expect(lotteryEligibility({
      serviceCandidates: ["jr-yamanote", "metro"], serviceDrawRequired: true,
      selectedService: "jr-yamanote", targetService: "jr-yamanote",
      directionDrawRequired: false, nextDistances: [0],
    })).toEqual({ targetService: true, towardTarget: false, equalDistance: false });
    expect(lotteryEligibility({
      serviceCandidates: ["metro"], serviceDrawRequired: false,
      selectedService: "metro", targetService: "jr-yamanote",
      directionDrawRequired: true, nextDistances: [2, 2],
    })).toEqual({ targetService: false, towardTarget: false, equalDistance: true });
    expect(lotteryEligibility({
      serviceCandidates: ["metro"], serviceDrawRequired: false,
      selectedService: "metro", targetService: "jr-yamanote",
      directionDrawRequired: true, nextDistances: [1, 3],
    })).toEqual({ targetService: false, towardTarget: true, equalDistance: false });
  });

  it("calculates a Wilson interval for a Bernoulli proportion", () => {
    const interval = wilsonInterval(2, 3);
    expect(interval.low).toBeCloseTo(0.2077, 3);
    expect(interval.high).toBeCloseTo(0.9385, 3);
  });
});
