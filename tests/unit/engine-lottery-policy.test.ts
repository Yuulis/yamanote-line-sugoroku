import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork, createGame, drawIndex, drawLanding, drawWeightedIndex,
  landingOptions, playTurn, resolveLandingEvent, seedRng, targetHopDistances,
  type LandingOptions,
} from "../../src/features/game/engine";
import type { Direction, GameConfig } from "../../src/types/network";
import { M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { kindInput, lotteryConfig, proximityInput, SPECIAL, EXTRA_LOCAL } from "./fixtures/lottery";
import { deepFreeze } from "./fixtures/yamanote";

const network = buildRailwayNetwork(kindInput());

function optionsAt(stationId: string, serviceId: string, config: GameConfig = lotteryConfig()): LandingOptions {
  return landingOptions({ config, currentStationId: stationId, currentServiceId: serviceId, direction: 1 }, network);
}

describe("service lottery policies", () => {
  it("share uses p times other kind bases and (q-p) times each other base", () => {
    const options = optionsAt("b", M_LOOP);
    expect(options.services).toEqual([M_LOOP, M_LINE, M_SPUR, SPECIAL, EXTRA_LOCAL]);
    // p=2, q=5: target=2*(3+2+3+2)=20; others=3*[3,2,3,2].
    expect(options.serviceWeights).toEqual([20, 9, 6, 9, 6]);
  });

  it("weight multiplies the target kind base and preserves other kind bases", () => {
    const config = lotteryConfig();
    config.serviceLottery.target = { kind: "weight", weight: 4 };
    // weight=4: target=4*local(2)=8; others retain [3,2,3,2].
    expect(optionsAt("b", M_LOOP, config).serviceWeights).toEqual([8, 3, 2, 3, 2]);
  });

  it.each([
    // target=2*(3+2+3+2)=20; others=3*[3,2,3,2], in candidate order.
    { kind: "share", position: "middle", services: [M_LINE, M_SPUR, M_LOOP, SPECIAL, EXTRA_LOCAL], weights: [9, 6, 20, 9, 6] },
    // target=2*(3+2+3+2)=20; others=3*[3,2,3,2], target last.
    { kind: "share", position: "end", services: [M_LINE, M_SPUR, SPECIAL, EXTRA_LOCAL, M_LOOP], weights: [9, 6, 9, 6, 20] },
    // target=4*2=8; others retain [3,2,3,2], in candidate order.
    { kind: "weight", position: "middle", services: [M_LINE, M_SPUR, M_LOOP, SPECIAL, EXTRA_LOCAL], weights: [3, 2, 8, 3, 2] },
    // target=4*2=8; others retain [3,2,3,2], target last.
    { kind: "weight", position: "end", services: [M_LINE, M_SPUR, SPECIAL, EXTRA_LOCAL, M_LOOP], weights: [3, 2, 3, 2, 8] },
  ])("$kind policy preserves cumulative intervals with the target at the $position", ({ kind, services, weights }) => {
    const input = kindInput();
    input.services = services.map((id) => input.services.find((service) => service.id === id)!);
    const config = lotteryConfig();
    if (kind === "weight") config.serviceLottery.target = { kind: "weight", weight: 4 };
    const options = landingOptions({
      config, currentStationId: "b", currentServiceId: M_LOOP, direction: 1,
    }, buildRailwayNetwork(input));
    expect(options.services).toEqual(services);
    expect(options.serviceWeights).toEqual(weights);
    const expectedChoices = services.flatMap((id, index) => Array<string>(weights[index]!).fill(id));
    for (const [raw, serviceId] of expectedChoices.entries()) {
      const rngState = `sfc32-v1:${raw.toString(16).padStart(8, "0")}:00000000:00000000:00000000`;
      expect(drawLanding(options, rngState).choice.serviceId).toBe(serviceId);
    }
  });

  it("half share with equal kind bases assigns k-1 to the target", () => {
    const config = multiConfig();
    config.serviceLottery.target = { kind: "share", numerator: 1, denominator: 2 };
    // p=1, q=2 with five candidates: target=1*(1+1+1+1)=4; others=1*1.
    expect(optionsAt("b", M_LOOP, config).serviceWeights).toEqual([4, 1, 1, 1, 1]);
  });

  it("absent target leaves the base weights unchanged and singleton target stays positive", () => {
    // No target: each service retains its base, rapid(3), rapid(3), local(2).
    expect(optionsAt("y", M_LINE).serviceWeights).toEqual([3, 3, 2]);
    // Singleton: the target retains local(2), with no target multiplier/share.
    expect(optionsAt("a", M_LOOP).serviceWeights).toEqual([2]);
  });

  it("draws the non-equal service first, then the equal direction lottery", () => {
    const options = optionsAt("b", M_LOOP);
    const seed = "sfc32-v1:00000014:00000000:00000000:00000000";
    const first = drawWeightedIndex(seed, options.serviceWeights);
    const serviceId = options.services[first.index]!;
    expect(serviceId).toBe(M_LINE);
    const directions = options.directionsByService.get(serviceId)!;
    const second = directions.length === 2
      ? drawWeightedIndex(first.nextRngState, options.directionWeightsByService.get(serviceId)!) : null;
    expect(drawLanding(options, seed)).toEqual({
      choice: { serviceId, direction: directions[second?.index ?? 0] },
      nextRngState: second?.nextRngState ?? first.nextRngState,
    });
  });

  it("draws the service before the direction when both lotteries have non-equal weights", () => {
    const input = proximityInput();
    input.services.find((service) => service.id === "branch")!.kind = "rapid";
    const options = landingOptions({
      config: lotteryConfig(), currentStationId: "s1", currentServiceId: M_SPUR, direction: 1,
    }, buildRailwayNetwork(input));
    expect(options.services).toEqual([M_SPUR, "branch"]);
    expect(options.serviceWeights).toEqual([2, 3]);
    const seed = "sfc32-v1:00000000:00000000:00000000:00000000";
    const first = drawWeightedIndex(seed, options.serviceWeights);
    const serviceId = options.services[first.index]!;
    expect(serviceId).toBe(M_SPUR);
    const directions = options.directionsByService.get(serviceId)!;
    const weights = options.directionWeightsByService.get(serviceId)!;
    expect(directions).toEqual([1, -1]);
    expect(weights).toEqual([1, 2]);
    const second = drawWeightedIndex(first.nextRngState, weights);
    expect(directions[second.index]).toBe(-1);
    // Drawing direction first would choose +1 from the initial zero output.
    expect(drawWeightedIndex(seed, weights).index).not.toBe(second.index);
    expect(drawLanding(options, seed)).toEqual({
      choice: { serviceId, direction: directions[second.index] },
      nextRngState: second.nextRngState,
    });
  });

  it("injected legal choices ignore the lottery weights and consume no RNG", () => {
    const options = optionsAt("b", M_LOOP);
    const unweighted = { ...options, serviceWeights: [], directionWeightsByService: new Map() };
    expect(resolveLandingEvent(unweighted, M_LOOP, { serviceId: SPECIAL, direction: -1 }).choice)
      .toEqual({ serviceId: SPECIAL, direction: -1 });
  });
});

describe("proximity and direction policies", () => {
  it("reverse directed edges measure distance toward any target stop", () => {
    const input = multiServiceInput();
    // s1 -> s2 remains, but s2 cannot return: forward BFS would incorrectly reach it.
    input.segments = input.segments.filter((segment) => !(segment.from === "s2" && segment.to === "s1"));
    const distances = targetHopDistances(buildRailwayNetwork(input), M_LOOP);
    expect(distances.get("b")).toBe(0);
    expect(distances.get("s1")).toBe(1);
    expect(distances.has("s2")).toBe(false);
  });

  it("branches transfer freely and a rapid stop-to-stop segment counts as one hop", () => {
    const net = buildRailwayNetwork(deepFreeze(proximityInput()));
    const distances = targetHopDistances(net, M_LOOP);
    expect(distances.get("q")).toBe(1);
    expect(distances.get("r")).toBe(2);
    expect(distances.get("s2")).toBe(2);
    expect(distances.get("start")).toBe(0);
    expect(targetHopDistances(net, M_LOOP)).toBe(distances);
    expect(targetHopDistances(buildRailwayNetwork(multiServiceInput()), M_LOOP).has("q")).toBe(false);
    expect(targetHopDistances(net, M_LINE).get("x")).toBe(0);
  });

  it("toward-target weights follow next stops in [1, -1] order and ties stay equal", () => {
    expect(optionsAt("s1", M_SPUR).directionWeightsByService.get(M_SPUR)).toEqual([1, 2]);
    expect(optionsAt("y", M_LINE).directionWeightsByService.get(M_LINE)).toEqual([1, 1]);
    expect(optionsAt("b", M_LOOP).directionWeightsByService.get(M_LINE)).toEqual([1, 1]);
    expect(optionsAt("b", M_LOOP).directionWeightsByService.get(M_LOOP)).toEqual([1]);
    const input = kindInput();
    input.services.find((service) => service.id === M_SPUR)!.stationIds.reverse();
    const net = buildRailwayNetwork(input);
    const reversed = landingOptions({ config: lotteryConfig(), currentStationId: "s1", currentServiceId: M_SPUR, direction: 1 }, net);
    expect(reversed.directionWeightsByService.get(M_SPUR)).toEqual([2, 1]);
  });

  it("expresses 3:2 toward/away weights in canonical direction order", () => {
    const config = lotteryConfig();
    config.directionLottery = { towardTargetWeight: 3, awayFromTargetWeight: 2 };
    expect(optionsAt("s1", M_SPUR, config).directionWeightsByService.get(M_SPUR)).toEqual([2, 3]);
    const input = kindInput();
    input.services.find((service) => service.id === M_SPUR)!.stationIds.reverse();
    const reversed = landingOptions({
      config, currentStationId: "s1", currentServiceId: M_SPUR, direction: 1,
    }, buildRailwayNetwork(input));
    expect(reversed.directionsByService.get(M_SPUR)).toEqual([1, -1]);
    expect(reversed.directionWeightsByService.get(M_SPUR)).toEqual([3, 2]);
  });

  it("both unreachable next stops tie, while a reachable next stop wins", () => {
    const base = multiServiceInput();
    const disconnected = base.segments.filter((segment) => segment.serviceId !== M_SPUR ||
      (segment.from !== "s1" && segment.to !== "s1"));
    const net = buildRailwayNetwork({ ...base, segments: disconnected });
    const config = lotteryConfig();
    const opts = landingOptions({ config, currentStationId: "s1", currentServiceId: M_SPUR, direction: 1 }, net);
    expect(opts.directionWeightsByService.get(M_SPUR)).toEqual([1, 2]);
    // At b the line's two off-target neighbors become unreachable without its segments.
    const lineIsolated = buildRailwayNetwork({ ...base, segments: base.segments.filter(
      (segment) => segment.serviceId === M_LOOP,
    ) });
    const atB = landingOptions({ config, currentStationId: "b", currentServiceId: M_LOOP, direction: 1 }, lineIsolated);
    expect(atB.directionWeightsByService.get(M_LINE)).toEqual([1, 1]);
  });

  it("uniform direction policy does not inspect the segment graph", () => {
    const net = buildRailwayNetwork(multiServiceInput());
    const withoutGraph = { ...net, get segmentsById(): never { throw new Error("BFS must be lazy"); } };
    const options = landingOptions({ config: multiConfig(), currentStationId: "y", currentServiceId: M_LINE, direction: 1 }, withoutGraph);
    expect(options.directionWeightsByService.get(M_LINE)).toEqual([1, 1]);
  });

  it("rejects an unknown target in the distance query", () => {
    expect(() => targetHopDistances(network, "missing")).toThrowError(
      expect.objectContaining({ code: "INVALID_NETWORK" }),
    );
  });
});

describe("uniform compatibility and forced choices", () => {
  it("equal derived share weights delegate to drawIndex even for unreduced fractions", () => {
    const net = buildRailwayNetwork(multiServiceInput());
    const config = multiConfig();
    config.serviceLottery.target = { kind: "share", numerator: 5, denominator: 10 };
    const options = landingOptions({ config, currentStationId: "d", currentServiceId: M_LOOP, direction: 1 }, net);
    expect(options.serviceWeights).toEqual([5, 5]);
    const rngState = "sfc32-v1:ffffffff:00000000:00000000:00000000";
    const serviceDraw = drawIndex(rngState, 2);
    const directionDraw = drawIndex(serviceDraw.nextRngState, 2);
    expect(drawLanding(options, rngState)).toEqual({
      choice: { serviceId: M_LINE, direction: [1, -1][directionDraw.index] },
      nextRngState: directionDraw.nextRngState,
    });
  });

  it("equal bases of any allowed value preserve every mixed-game roll, choice and RNG state", () => {
    const net = buildRailwayNetwork(multiServiceInput());
    const uniform = multiConfig();
    const scaled = multiConfig();
    scaled.serviceLottery.kindWeights = { local: 37, rapid: 37 };
    let first = createGame(uniform, "mixed-30", net);
    let second = createGame(scaled, "mixed-30", net);
    while (first.status === "playing") {
      const a = playTurn(first, net);
      const b = playTurn(second, net);
      expect(b).toEqual({ ...a, state: { ...a.state, config: scaled } });
      first = a.state;
      second = b.state;
    }
  });

  it.each<[string, string, Direction]>([["a", M_LOOP, 1], ["s2", M_SPUR, -1]])(
    "forced service and direction at %s consume no draw",
    (stationId, serviceId, direction) => {
      const seed = seedRng("forced");
      expect(drawLanding(optionsAt(stationId, serviceId), seed)).toEqual({
        choice: { serviceId, direction }, nextRngState: seed,
      });
    },
  );

  it("a forced direction consumes no draw with unequal configured weights", () => {
    const config = lotteryConfig();
    config.directionLottery = { towardTargetWeight: 3, awayFromTargetWeight: 2 };
    const seed = seedRng("forced-weighted-direction");
    const options = optionsAt("s2", M_SPUR, config);
    expect(options.directionWeightsByService.get(M_SPUR)).toEqual([1]);
    expect(drawLanding(options, seed)).toEqual({
      choice: { serviceId: M_SPUR, direction: -1 }, nextRngState: seed,
    });
  });

  it("a forced service with two movable directions consumes only the direction draw", () => {
    const seed = seedRng("direction-only");
    const options = optionsAt("s1", M_SPUR);
    const draw = drawWeightedIndex(seed, [1, 2]);
    expect(drawLanding(options, seed)).toEqual({
      choice: { serviceId: M_SPUR, direction: [1, -1][draw.index] }, nextRngState: draw.nextRngState,
    });
  });

  it("a forced direction after a service lottery consumes only the service draw", () => {
    const options = optionsAt("b", M_LOOP, multiConfig());
    // Raw zero chooses the target, whose direction is always forced.
    const state = "sfc32-v1:00000000:00000000:00000000:00000000";
    expect(drawLanding(options, state)).toEqual({
      choice: { serviceId: M_LOOP, direction: 1 }, nextRngState: drawIndex(state, options.services.length).nextRngState,
    });
  });
});
