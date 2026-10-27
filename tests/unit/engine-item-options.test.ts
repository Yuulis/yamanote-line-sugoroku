import { describe, expect, it, vi } from "vitest";
import * as rng from "../../src/features/game/engine/rng";
import {
  advanceWithMode, buildRailwayNetwork, createGame, deadheadDestination, directionHint,
  drawLanding, filterLandingOptions, itemLandingOptions, landingOptions,
  rapidHeadsTowardTarget, routeTicketOptions, seedRng,
  type LandingFilters, type RailwayNetwork,
} from "../../src/features/game/engine";
import type { Direction, GameState } from "../../src/types/network";
import { EXTRA_LOCAL, kindInput, lotteryConfig, SPECIAL } from "./fixtures/lottery";
import { LONG_LINE, longLineInput, M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { deepFreeze } from "./fixtures/yamanote";

const network = buildRailwayNetwork(multiServiceInput());
const noEffects: LandingFilters = { turn: 5, suspensions: [] };

function at(stationId = "b", serviceId = M_LOOP, direction: Direction = 1): GameState {
  return { ...createGame(multiConfig(), "item-options", network), currentStationId: stationId, currentServiceId: serviceId, direction };
}

function filters(ids: readonly string[], detourServiceId?: string): LandingFilters {
  return { turn: 5, suspensions: ids.map((serviceId) => ({ serviceId, expiresTurn: 5 })), detourServiceId };
}

describe("filtered landing candidates", () => {
  it("can suspend the target and preserves canonical order and original inputs", () => {
    const position = deepFreeze(at());
    const effects = deepFreeze(filters([M_LOOP]));
    const original = landingOptions(position, network);
    const result = filterLandingOptions(original, position.config, effects, network);
    expect(result.options.services).toEqual([M_LINE, M_SPUR]);
    expect([...result.options.directionsByService.keys()]).toEqual([M_LINE, M_SPUR]);
    expect([...result.options.directionWeightsByService.keys()]).toEqual([M_LINE, M_SPUR]);
    expect(result).toMatchObject({ suspensionIgnored: false, detourConsumed: false });
    expect(original).toEqual(landingOptions(position, network));
  });

  it("ignores suspension at a station when every candidate is suspended", () => {
    const result = itemLandingOptions(at(), filters([M_SPUR, M_LOOP, M_LINE]), network);
    expect(result.options).toEqual(landingOptions(at(), network));
    expect(result).toMatchObject({ suspensionIgnored: true, detourConsumed: false });
  });

  it("keeps a suspension active through its expiry turn and expires it afterward", () => {
    const effects = filters([M_LINE]);
    expect(itemLandingOptions(at(), effects, network).options.services).toEqual([M_LOOP, M_SPUR]);
    expect(itemLandingOptions(at(), { ...effects, turn: 6 }, network).options.services).toEqual([M_LOOP, M_LINE, M_SPUR]);
  });

  it("forces a single eligible service without drawing service or target direction RNG", () => {
    const result = itemLandingOptions(at(), filters([M_LINE, M_SPUR]), network);
    expect(result.options.services).toEqual([M_LOOP]);
    expect(result.options.serviceDrawRequired).toBe(false);
    const rngState = seedRng("forced-target");
    expect(drawLanding(result.options, rngState)).toEqual({ choice: { serviceId: M_LOOP, direction: 1 }, nextRngState: rngState });
  });

  it("keeps a detour pending when there is no other eligible service", () => {
    expect(itemLandingOptions(at("c"), { ...noEffects, detourServiceId: M_LOOP }, network))
      .toMatchObject({ detourConsumed: false, options: { services: [M_LOOP] } });
    expect(itemLandingOptions(at(), filters([M_LINE, M_SPUR], M_LOOP), network))
      .toMatchObject({ detourConsumed: false, options: { services: [M_LOOP] } });
  });

  it("consumes a detour when suspension already forces a different service", () => {
    expect(itemLandingOptions(at(), filters([M_LOOP, M_SPUR], M_LOOP), network))
      .toMatchObject({ detourConsumed: true, options: { services: [M_LINE] } });
  });

  it("applies all-suspended fallback before detour exclusion", () => {
    const result = itemLandingOptions(at(), filters([M_LOOP, M_LINE, M_SPUR], M_LINE), network);
    expect(result).toMatchObject({ suspensionIgnored: true, detourConsumed: true, options: { services: [M_LOOP, M_SPUR] } });
  });

  it("recomputes the target half-share over remaining services with existing kind weights", () => {
    const graph = buildRailwayNetwork(kindInput());
    const position = { ...at(), config: { ...lotteryConfig(), serviceLottery: { kindWeights: { local: 2, rapid: 3 }, target: { kind: "share" as const, numerator: 1, denominator: 2 } } } };
    const result = itemLandingOptions(position, filters([M_SPUR, EXTRA_LOCAL]), graph);
    expect(result.options.services).toEqual([M_LOOP, M_LINE, SPECIAL]);
    expect(result.options.serviceWeights).toEqual([6, 3, 3]);
    const withoutTarget = itemLandingOptions(position, filters([M_LOOP, M_SPUR, EXTRA_LOCAL]), graph);
    expect(withoutTarget.options.serviceWeights).toEqual([3, 3]);
  });

  it("preserves direction weights, including 3:2, after candidate filtering", () => {
    const position = { ...at("s1", M_SPUR), config: { ...multiConfig(), directionLottery: { towardTargetWeight: 3, awayFromTargetWeight: 2 } } };
    const result = itemLandingOptions(position, noEffects, network);
    expect(result.options.directionWeightsByService.get(M_SPUR)).toEqual([2, 3]);
    expect(result.options.directionsByService.get(M_SPUR)).toEqual([1, -1]);
  });

  it("preserves classic options, weights and every seeded draw when no filter applies", () => {
    const graph = buildRailwayNetwork(kindInput());
    for (const config of [multiConfig(), lotteryConfig()]) {
      for (const service of graph.servicesById.values()) {
        for (const stationId of service.stationIds) {
          const position = { ...at(stationId, service.id), config };
          const classic = landingOptions(position, graph);
          const filtered = itemLandingOptions(position, noEffects, graph);
          expect(filtered.options).toEqual(classic);
          let rngState = seedRng(`${config.rulesetVersion}:${stationId}:${service.id}`);
          for (let sample = 0; sample < 12; sample += 1) {
            const expected = drawLanding(classic, rngState);
            expect(drawLanding(filtered.options, rngState)).toEqual(expected);
            rngState = expected.nextRngState;
          }
        }
      }
    }
  });
});

describe("side-effect-free route and direction queries", () => {
  it("offers route-ticket candidates after suspension, identifies the target and ignores detour", () => {
    const result = routeTicketOptions(at(), filters([M_SPUR], M_LOOP), network);
    expect(result.candidates).toEqual([{ serviceId: M_LOOP, isTarget: true }, { serviceId: M_LINE, isTarget: false }]);
    expect(result.options.services).toEqual([M_LOOP, M_LINE]);
    expect(routeTicketOptions(at(), filters([M_LOOP]), network).candidates.every((candidate) => !candidate.isTarget)).toBe(true);
    expect(routeTicketOptions(at(), filters([M_LOOP, M_LINE, M_SPUR]), network).suspensionIgnored).toBe(true);
  });

  it("offers the only service at a single-service station", () => {
    expect(routeTicketOptions(at("s1", M_SPUR), noEffects, network).candidates)
      .toEqual([{ serviceId: M_SPUR, isTarget: false }]);
  });

  it("reports next-stop graph distances and the uniquely shorter direction", () => {
    expect(directionHint(at("s1", M_SPUR), network)).toEqual({
      directions: [{ direction: 1, nextStationId: "s2", targetHops: 2 }, { direction: -1, nextStationId: "b", targetHops: 0 }],
      closerDirection: -1,
    });
    expect(directionHint(at("y", M_LINE), network).closerDirection).toBeNull();
    expect(directionHint(at("b"), network).directions.map((option) => option.direction)).toEqual([1]);
    expect(directionHint(at("x", M_LINE), network).closerDirection).toBe(1);
  });

  it("does not recommend one direction when both are unreachable", () => {
    const input = longLineInput(2, 3);
    const graph: RailwayNetwork = buildRailwayNetwork({ ...input, segments: input.segments.filter((segment) => segment.serviceId !== LONG_LINE) });
    const result = directionHint(at("m2", LONG_LINE), graph);
    expect(result.directions.map((option) => option.targetHops)).toEqual([Infinity, Infinity]);
    expect(result.closerDirection).toBeNull();
  });

  it("recommends rapid toward the target or on it, with no die or landing prediction", () => {
    expect(rapidHeadsTowardTarget(at("s1", M_SPUR, -1), network)).toBe(true);
    expect(rapidHeadsTowardTarget(at("s1", M_SPUR, 1), network)).toBe(false);
    expect(rapidHeadsTowardTarget(at("b"), network)).toBe(true);
    expect(rapidHeadsTowardTarget(at("y", M_LINE, 1), network)).toBe(true);
  });

  it("previews the exact deadhead outcome without applying it", () => {
    const position = deepFreeze(at("s2", M_SPUR, -1));
    const preview = deadheadDestination(position, network);
    expect(preview).toEqual({ fromStationId: "s2", toStationId: "b", serviceId: M_LOOP, direction: 1, distance: 2 });
    expect(advanceWithMode(position, { mode: "deadhead" }, network).relocation).toEqual(preview);
    expect(position.currentStationId).toBe("s2");
  });

  it("does not mutate state/effects or alter the next RNG outcome when queries repeat", () => {
    const position = deepFreeze(at());
    const effects = deepFreeze(filters([M_SPUR]));
    const before = JSON.stringify({ position, effects });
    const originalDraw = drawLanding(landingOptions(position, network), position.rngState);
    for (let index = 0; index < 5; index += 1) {
      itemLandingOptions(position, effects, network);
      routeTicketOptions(position, effects, network);
      directionHint(position, network);
      rapidHeadsTowardTarget(position, network);
      deadheadDestination(position, network);
    }
    expect(JSON.stringify({ position, effects })).toBe(before);
    expect(drawLanding(landingOptions(position, network), position.rngState)).toEqual(originalDraw);
  });

  it("never invokes an RNG primitive while answering queries", () => {
    const position = at();
    const spies = [vi.spyOn(rng, "drawIndex"), vi.spyOn(rng, "drawWeightedIndex"), vi.spyOn(rng, "rollDie")];
    try {
      itemLandingOptions(position, noEffects, network);
      routeTicketOptions(position, noEffects, network);
      directionHint(position, network);
      rapidHeadsTowardTarget(position, network);
      deadheadDestination(position, network);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("counts underlying transfer services for rapid even when suspension leaves only one active", () => {
    const position = at("x", M_LINE);
    const arrival = { ...position, currentStationId: "b" };
    expect(itemLandingOptions(arrival, filters([M_LOOP, M_SPUR]), network).options.services).toEqual([M_LINE]);
    expect(advanceWithMode(position, { mode: "rapid", pips: 1 }, network)).toMatchObject({ stationId: "b", physicalHops: 1, unusedPips: 0 });
  });
});
