import { describe, expect, it } from "vitest";
import {
  buildRailwayNetwork,
  findSegment,
  nextStationId,
  type RailwayNetworkInput,
} from "../../src/features/game/engine";
import {
  LAST_STATION,
  SEGMENT_IDS,
  SERVICE_ID,
  START,
  yamanoteInput,
} from "./fixtures/yamanote";

const INVALID_NETWORK = expect.objectContaining({ code: "INVALID_NETWORK" });

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
    const network = buildRailwayNetwork(yamanoteInput(), { expectedStationCount: 30 });
    expect(network.stationsById.size).toBe(30);
    expect(network.segmentsById.size).toBe(30);
    expect(network.dataVersion).toBe("test-data-1");
  });

  it("rejects a station count other than the expected one", () => {
    expect(() => buildRailwayNetwork(yamanoteInput(), { expectedStationCount: 29 })).toThrowError(
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

  it("rejects a loop that does not close (missing wrap segment)", () => {
    const input = yamanoteInput();
    const open = { ...input, segments: input.segments.slice(0, -1) };
    expect(() => buildRailwayNetwork(open)).toThrowError(INVALID_NETWORK);
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
    input.services[0]?.stationIds.reverse();
    expect(nextStationId(network, SERVICE_ID, START, 1)).toBe("hamamatsucho");
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
