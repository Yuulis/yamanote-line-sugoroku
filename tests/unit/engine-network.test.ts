import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  findSegment,
  movableDirections,
  nextStationId,
  type RailwayNetworkInput,
  transferOptions,
  validateConfig,
} from "../../src/features/game/engine";
import {
  bothWays,
  M_LINE,
  M_LOOP,
  M_SPUR,
  M_START,
  multiConfig,
  multiServiceInput,
} from "./fixtures/multiService";
import {
  DEFAULT_CONFIG,
  deepFreeze,
  LAST_STATION,
  SEGMENT_IDS,
  SERVICE_ID,
  START,
  yamanoteInput,
} from "./fixtures/yamanote";

const INVALID_NETWORK = expect.objectContaining({ code: "INVALID_NETWORK" });
const INVALID_CONFIG = expect.objectContaining({ code: "INVALID_CONFIG" });

function withService(
  input: RailwayNetworkInput,
  stationIds: string[],
): RailwayNetworkInput {
  const [service] = input.services;
  if (!service) throw new Error("fixture has no service");
  return { ...input, services: [{ ...service, stationIds }] };
}

describe("buildRailwayNetwork", () => {
  it("indexes the 30-station loop", () => {
    const network = buildRailwayNetwork(yamanoteInput(), {
      expectedStationCounts: { [SERVICE_ID]: 30 },
    });
    expect(network.stationsById.size).toBe(30);
    expect(network.segmentsById.size).toBe(30);
    expect(network.dataVersion).toBe("test-data-1");
  });

  it("rejects a station count other than the expected one", () => {
    expect(() =>
      buildRailwayNetwork(yamanoteInput(), { expectedStationCounts: { [SERVICE_ID]: 29 } }),
    ).toThrowError(INVALID_NETWORK);
  });

  it("applies expected counts per service only", () => {
    const network = buildRailwayNetwork(multiServiceInput(), {
      expectedStationCounts: { [M_LOOP]: 6, [M_LINE]: 5 },
    });
    expect(network.servicesById.size).toBe(3);
  });

  it.each([
    ["an unknown service", { nope: 30 }],
    ["a negative count", { [SERVICE_ID]: -1 }],
    ["a fractional count", { [SERVICE_ID]: 29.5 }],
  ])("rejects expected counts naming %s", (_label, expectedStationCounts) => {
    expect(() => buildRailwayNetwork(yamanoteInput(), { expectedStationCounts })).toThrowError(
      INVALID_NETWORK,
    );
  });

  it("rejects duplicate station ids", () => {
    const input = yamanoteInput();
    const duplicated = { ...input, stations: [...input.stations, input.stations[0]!] };
    expect(() => buildRailwayNetwork(duplicated)).toThrowError(INVALID_NETWORK);
  });

  it("rejects a service referencing an unknown station", () => {
    const input = yamanoteInput();
    const stationIds = [...(input.services[0]?.stationIds ?? []), "nowhere"];
    expect(() => buildRailwayNetwork(withService(input, stationIds))).toThrowError(
      INVALID_NETWORK,
    );
  });

  it("leaves segment coverage to validateConfig (missing wrap segment)", () => {
    // Structural build accepts it; the playable-coverage check (config) rejects it.
    const input = yamanoteInput();
    const open = buildRailwayNetwork({ ...input, segments: input.segments.slice(0, -1) });
    expect(() => validateConfig(DEFAULT_CONFIG, open)).toThrowError(INVALID_CONFIG);
  });

  it("rejects a loop with fewer than 3 stops and a line with fewer than 2", () => {
    const input = multiServiceInput();
    const shortLoop = input.services.map((service) =>
      service.id === M_LOOP ? { ...service, stationIds: [M_START, "a"] } : service,
    );
    expect(() => buildRailwayNetwork({ ...input, services: shortLoop })).toThrowError(
      INVALID_NETWORK,
    );
    const shortSpur = input.services.map((service) =>
      service.id === M_SPUR ? { ...service, stationIds: ["b"] } : service,
    );
    expect(() => buildRailwayNetwork({ ...input, services: shortSpur })).toThrowError(
      INVALID_NETWORK,
    );
  });

  it("rejects a station no service stops at", () => {
    const input = yamanoteInput();
    const lonely = { id: "lonely", name: "lonely", coordinates: [139, 35] as [number, number] };
    expect(() =>
      buildRailwayNetwork({ ...input, stations: [...input.stations, lonely] }),
    ).toThrowError(INVALID_NETWORK);
  });

  it("rejects a segment joining non-adjacent stations", () => {
    const input = yamanoteInput();
    const bogus = {
      id: "bogus",
      serviceId: SERVICE_ID,
      from: START,
      to: "tokyo",
      geometryFeatureId: "bogus",
    };
    expect(() =>
      buildRailwayNetwork({ ...input, segments: [...input.segments, bogus] }),
    ).toThrowError(INVALID_NETWORK);
  });

  it("rejects two segments with the same endpoints", () => {
    const input = yamanoteInput();
    const copy = { ...input.segments[0]!, id: "copy" };
    expect(() =>
      buildRailwayNetwork({ ...input, segments: [...input.segments, copy] }),
    ).toThrowError(INVALID_NETWORK);
  });

  it("rejects a segment on an unknown service", () => {
    const input = yamanoteInput();
    const orphan = { ...input.segments[0]!, id: "orphan", serviceId: "nope" };
    expect(() =>
      buildRailwayNetwork({ ...input, segments: [...input.segments, orphan] }),
    ).toThrowError(INVALID_NETWORK);
  });

  it("rejects an empty dataVersion", () => {
    expect(() => buildRailwayNetwork({ ...yamanoteInput(), dataVersion: "" })).toThrowError(
      INVALID_NETWORK,
    );
  });

  it("is not affected by later mutation of the input", () => {
    const input = yamanoteInput();
    const network = buildRailwayNetwork(input);
    const startCoordinates = [...(network.stationsById.get(START)?.coordinates ?? [])];
    input.services[0]?.stationIds.reverse();
    input.stations[0]?.coordinates.reverse();
    if (input.segments[0]) input.segments[0].to = "tokyo";
    expect(nextStationId(network, SERVICE_ID, START, 1)).toBe("hamamatsucho");
    expect(network.stationsById.get(START)?.coordinates).toEqual(startCoordinates);
    expect(findSegment(network, SERVICE_ID, START, "hamamatsucho")?.to).toBe("hamamatsucho");
    // The fixture factory must hand out fresh objects too.
    expect(() => buildRailwayNetwork(yamanoteInput())).not.toThrow();
  });
});

describe("nextStationId / findSegment", () => {
  const network = buildRailwayNetwork(yamanoteInput());

  it("wraps from the last station to 新橋 on the circular service", () => {
    expect(nextStationId(network, SERVICE_ID, LAST_STATION, 1)).toBe(START);
    expect(findSegment(network, SERVICE_ID, LAST_STATION, START)?.id).toBe(SEGMENT_IDS[29]);
  });

  it("returns undefined for unknown services, stations, or reverse segments", () => {
    expect(nextStationId(network, "nope", START, 1)).toBeUndefined();
    expect(nextStationId(network, SERVICE_ID, "nowhere", 1)).toBeUndefined();
    expect(findSegment(network, SERVICE_ID, "hamamatsucho", START)).toBeUndefined();
  });
});

describe("multi-service indexes", () => {
  const network = buildRailwayNetwork(deepFreeze(multiServiceInput()));

  it("lists the services stopping at each station in data order", () => {
    expect(network.servicesByStation.get("b")).toEqual([M_LOOP, M_LINE, M_SPUR]);
    expect(network.servicesByStation.get("d")).toEqual([M_LOOP, M_LINE]);
    expect(network.servicesByStation.get("y")).toEqual([M_LINE]);
  });

  it("offers one transfer option per service, boarding at the same station", () => {
    expect(transferOptions(network, "d")).toEqual([
      { serviceId: M_LOOP, boardingStationId: "d" },
      { serviceId: M_LINE, boardingStationId: "d" },
    ]);
    expect(transferOptions(network, "nowhere")).toEqual([]);
  });

  it("follows the candidate order of the data, not of the ids", () => {
    const input = multiServiceInput();
    const reordered = buildRailwayNetwork({ ...input, services: [...input.services].reverse() });
    expect(reordered.servicesByStation.get("b")).toEqual([M_SPUR, M_LINE, M_LOOP]);
  });

  it("lists movable directions in [1, -1] order and stops at line ends", () => {
    expect(movableDirections(network, M_LINE, "y")).toEqual([1, -1]);
    expect(movableDirections(network, M_LINE, "x")).toEqual([1]);
    expect(movableDirections(network, M_LINE, "z")).toEqual([-1]);
    expect(movableDirections(network, M_SPUR, "b")).toEqual([1]);
    expect(movableDirections(network, M_LOOP, M_START)).toEqual([1, -1]);
    expect(movableDirections(network, M_LINE, "a")).toEqual([]);
  });
});

describe("validateConfig: playable coverage", () => {
  it("accepts the multi-service fixture", () => {
    expect(() => validateConfig(multiConfig(), buildRailwayNetwork(multiServiceInput()))).not.toThrow();
  });

  it("rejects a non-target service missing a reverse segment", () => {
    const input = multiServiceInput();
    const missing = input.segments.filter((segment) => segment.id !== `${M_LINE}:y:b`);
    const network = buildRailwayNetwork({ ...input, segments: missing });
    expect(() => validateConfig(multiConfig(), network)).toThrowError(INVALID_CONFIG);
  });

  it("rejects a start station at the end of a linear service", () => {
    const input = multiServiceInput();
    const stub = { ...input.services[1]!, id: "stub", stationIds: ["x", M_START] };
    const network = buildRailwayNetwork({
      ...input,
      services: [...input.services, stub],
      segments: [...input.segments, ...bothWays("stub", ["x", M_START])],
    });
    expect(() => validateConfig(multiConfig(), network)).toThrowError(INVALID_CONFIG);
  });

  it("accepts a target loop that only has segments in the -1 target direction", () => {
    const input = yamanoteInput();
    const reversed = input.segments.map((segment) => ({
      ...segment,
      id: `${segment.id}:rev`,
      from: segment.to,
      to: segment.from,
    }));
    const network = buildRailwayNetwork({ ...input, segments: reversed });
    expect(() => validateConfig({ ...DEFAULT_CONFIG, targetDirection: -1 }, network)).not.toThrow();
    expect(() => validateConfig(DEFAULT_CONFIG, network)).toThrowError(INVALID_CONFIG);
  });
});
