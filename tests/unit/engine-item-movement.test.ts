import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceWithMode, buildRailwayNetwork, createGame, GameEngineError,
  nearestTargetStation, type RailwayNetwork,
} from "../../src/features/game/engine";
import { advance, type GamePosition } from "../../src/features/game/engine/movement";
import type { Direction, ServicePattern } from "../../src/types/network";
import {
  LONG_LINE, longLineInput, LOOP_SEGMENT_IDS, M_LINE, M_LOOP, M_SPUR,
  multiConfig, multiServiceInput,
} from "./fixtures/multiService";
import {
  DEFAULT_CONFIG, deepFreeze, inputWithShuttle, OTHER_SERVICE_ID,
  SERVICE_ID, yamanoteInput,
} from "./fixtures/yamanote";

const network = buildRailwayNetwork(multiServiceInput());

function at(stationId: string, serviceId = M_LOOP, direction: Direction = 1): GamePosition {
  return {
    ...createGame(multiConfig(), "item-movement", network),
    currentStationId: stationId, currentServiceId: serviceId, direction,
  };
}

describe("normal movement compatibility", () => {
  it("preserves every classic advance field byte for byte", () => {
    for (const service of network.servicesById.values()) {
      for (const stationId of service.stationIds) {
        for (const direction of [1, -1] as const) {
          if (service.id === M_LOOP && direction === -1) continue;
          const index = service.stationIds.indexOf(stationId);
          if (!service.circular && (index + direction < 0 || index + direction >= service.stationIds.length)) continue;
          for (const pips of [1, 2, 6, 12]) {
            const position = deepFreeze(at(stationId, service.id, direction));
            const result = advanceWithMode(position, { mode: "normal", pips }, network);
            const { mode, pips: budget, hopBudget, physicalHops, ...classic } = result;
            expect(JSON.stringify(classic)).toBe(JSON.stringify(advance(position, pips, network)));
            expect([mode, budget, hopBudget, physicalHops]).toEqual([
              "normal", pips, pips, result.traversedSegmentIds.length,
            ]);
          }
        }
      }
    }
  });
});

describe("rapid movement", () => {
  it("counts only transfer arrivals and retains every traversed segment", () => {
    const result = advanceWithMode(deepFreeze(at("x", M_LINE)), { mode: "rapid", pips: 2 }, network);
    expect(result).toMatchObject({ stationId: "d", pips: 2, physicalHops: 3, hopBudget: 3, unusedPips: 0, stopReason: "roll" });
    expect(result.traversedSegmentIds).toEqual([`${M_LINE}:x:b`, `${M_LINE}:b:y`, `${M_LINE}:y:d`]);
    expect(result.completedSegmentIds).toEqual(result.traversedSegmentIds);
    expect(result.events.filter((event) => event.type === "segment-traversed").map((event) => event.step)).toEqual([1, 2, 3]);
  });

  it("reports unspent pips and an endpoint even when the final stop is not a transfer", () => {
    const result = advanceWithMode(at("x", M_LINE), { mode: "rapid", pips: 5 }, network);
    expect(result).toMatchObject({ stationId: "z", physicalHops: 4, pips: 5, unusedPips: 3, stopReason: "endpoint" });
    expect(result.events.at(-1)).toEqual({ type: "endpoint-reached", step: 4, stationId: "z", discardedPips: 3 });
    const noTransfers = advanceWithMode(at("b", M_SPUR), { mode: "rapid", pips: 1 }, network);
    expect(noTransfers).toMatchObject({ stationId: "s2", physicalHops: 2, unusedPips: 1, stopReason: "endpoint" });
  });

  it("spends the last pip at a transfer endpoint without reporting truncation", () => {
    const result = advanceWithMode(at("s2", M_SPUR, -1), { mode: "rapid", pips: 1 }, network);
    expect(result).toMatchObject({ stationId: "b", physicalHops: 2, unusedPips: 0, stopReason: "roll" });
  });

  it("truncates at the target goal and reports pips rather than physical hops", () => {
    const result = advanceWithMode(at("start"), { mode: "rapid", pips: 4 }, network);
    expect(result).toMatchObject({ stationId: "start", cleared: true, physicalHops: 6, hopBudget: 10, unusedPips: 2, stopReason: "goal" });
    expect(result.completedSegmentIds).toEqual(LOOP_SEGMENT_IDS);
    expect(result.events.at(-1)).toEqual({ type: "goal-reached", stationId: "start", step: 6 });
  });

  it("supports doubled pips and circular paths beyond twice the network size", () => {
    const position = { ...at("start"), config: multiConfig("exact-stop") };
    const result = advanceWithMode(position, { mode: "rapid", pips: 12 }, network);
    expect(result).toMatchObject({ stationId: "d", physicalHops: 34, hopBudget: 34, unusedPips: 0, cleared: false });
    expect(result.physicalHops).toBeGreaterThan(network.stationsById.size * 2);
    expect(result.traversedSegmentIds).toHaveLength(34);
  });

  it("crosses long runs without an arbitrary global hop limit", () => {
    const long = buildRailwayNetwork(longLineInput(30, 40));
    const position = { ...createGame(multiConfig(), "long-rapid", long), currentStationId: "l1", currentServiceId: LONG_LINE };
    const result = advanceWithMode(position, { mode: "rapid", pips: 2 }, long);
    expect(result).toMatchObject({ stationId: "b", physicalHops: 71, unusedPips: 0 });
    expect(result.completedSegmentIds).toHaveLength(71);
  });

  it("rejects a circular ride with no countable station instead of looping forever", () => {
    const isolatedLoop = buildRailwayNetwork(yamanoteInput());
    expect(() => advanceWithMode(createGame(DEFAULT_CONFIG, "no-transfer", isolatedLoop), { mode: "rapid", pips: 1 }, isolatedLoop))
      .toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
  });
});

describe("oversleep movement", () => {
  it.each([["x", 1, "z"], ["z", -1, "x"]] as const)("rides from %s to the endpoint in direction %s", (from, direction, to) => {
    const result = advanceWithMode(at(from, M_LINE, direction), { mode: "oversleep" }, network);
    expect(result).toMatchObject({ mode: "oversleep", stationId: to, physicalHops: 4, pips: 4, hopBudget: 4, unusedPips: 0, stopReason: "endpoint" });
    expect(result.events.at(-1)).toEqual({ type: "endpoint-reached", stationId: to, step: 4, discardedPips: 0 });
  });

  it("takes six hops on the target loop, with normal goal truncation", () => {
    const loop = buildRailwayNetwork(yamanoteInput());
    const result = advanceWithMode(createGame(DEFAULT_CONFIG, "sleep", loop), { mode: "oversleep" }, loop);
    expect(result).toMatchObject({ physicalHops: 6, pips: 6, stopReason: "roll" });
    const goal = advanceWithMode({ ...at("e"), completedSegmentIds: [...LOOP_SEGMENT_IDS] }, { mode: "oversleep" }, network);
    expect(goal).toMatchObject({ cleared: true, physicalHops: 1, unusedPips: 5, stopReason: "goal" });
  });

  it.each([1, -1] as const)("takes six hops on a non-target loop in direction %s", (direction) => {
    const loop = buildRailwayNetwork(inputWithShuttle());
    const position = { ...createGame(DEFAULT_CONFIG, "sleep-other", loop), currentStationId: "test-a", currentServiceId: OTHER_SERVICE_ID, direction };
    const result = advanceWithMode(position, { mode: "oversleep" }, loop);
    expect(result).toMatchObject({ stationId: "test-a", physicalHops: 6, pips: 6, stopReason: "roll" });
  });

  it("documents the shipped non-Yamanote loop that uses the six-hop rule", () => {
    const { services } = JSON.parse(readFileSync("public/data/services.json", "utf8")) as { services: ServicePattern[] };
    expect(services.filter((service) => service.circular && service.id !== SERVICE_ID).map((service) => service.id))
      .toEqual(["toei-oedo-loop"]);
  });
});

describe("directed nearest-target search and deadhead", () => {
  it("breaks equidistant ties by target station order, independently of segment order", () => {
    const input = multiServiceInput();
    for (const segments of [input.segments, [...input.segments].reverse()]) {
      const graph = buildRailwayNetwork({ ...input, segments });
      expect(nearestTargetStation(graph, M_LOOP, "y")).toEqual({ stationId: "b", distance: 1 });
      expect(nearestTargetStation(graph, M_LOOP, "b")).toEqual({ stationId: "b", distance: 0 });
    }
  });

  it("uses directed edges, not the undirected station order", () => {
    const input = multiServiceInput();
    const directed = buildRailwayNetwork({ ...input, segments: input.segments.filter((segment) => segment.id !== `${M_LINE}:y:b`) });
    expect(nearestTargetStation(directed, M_LOOP, "y")).toEqual({ stationId: "d", distance: 1 });
  });

  it("throws a typed engine error when no target path exists", () => {
    const input = multiServiceInput();
    const isolated: RailwayNetwork = buildRailwayNetwork({
      ...input, segments: input.segments.filter((segment) => segment.from !== "s2"),
    });
    expect(() => nearestTargetStation(isolated, M_LOOP, "s2")).toThrowError(GameEngineError);
    expect(() => nearestTargetStation(isolated, M_LOOP, "s2")).toThrowError(expect.objectContaining({ code: "INVALID_STATE", message: expect.stringContaining("No target station reachable") }));
    expect(() => nearestTargetStation(network, "unknown", "s2")).toThrowError(expect.objectContaining({ code: "INVALID_NETWORK" }));
    expect(() => nearestTargetStation(network, M_LOOP, "unknown")).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("relocates without a roll, fabricated segment, or completion", () => {
    const position = deepFreeze({ ...at("y", M_LINE), completedSegmentIds: [...LOOP_SEGMENT_IDS] });
    const result = advanceWithMode(position, { mode: "deadhead" }, network);
    expect(result).toEqual({
      mode: "deadhead", stationId: "b", pips: null, hopBudget: null, physicalHops: 0,
      traversedSegmentIds: [], completedSegmentIds: [...LOOP_SEGMENT_IDS], events: [],
      cleared: false, stopReason: "relocation", unusedPips: null,
      relocation: { fromStationId: "y", toStationId: "b", serviceId: M_LOOP, direction: 1, distance: 1 },
    });
    expect(result).not.toHaveProperty("roll");
    expect(result.completedSegmentIds).not.toBe(position.completedSegmentIds);
  });

  it("never clears by relocating to the goal, including a zero-distance relocation", () => {
    const position = { ...at("start"), completedSegmentIds: [...LOOP_SEGMENT_IDS] };
    expect(advanceWithMode(position, { mode: "deadhead" }, network)).toMatchObject({
      stationId: "start", cleared: false, physicalHops: 0, relocation: { distance: 0, serviceId: M_LOOP, direction: 1 },
    });
  });
});

it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid pip budget %s", (pips) => {
  for (const mode of ["normal", "rapid"] as const) {
    expect(() => advanceWithMode(at("start"), { mode, pips }, network)).toThrowError(expect.objectContaining({ code: "INVALID_ROLL" }));
  }
});
