import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, type RailwayNetwork } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import {
  bothWays,
  M_LINE,
  M_LOOP,
  M_SPUR,
  M_START,
  multiServiceInput,
} from "./fixtures/multiService";
import { deriveCollectionProgress } from "../../src/features/game/collectionProgress";

const TOTAL_STATIONS = 1_586;
const TOTAL_LINE_GROUPS = 134;
const UI_PRESENTATION = {
  version: 1 as const,
  operators: [{ id: "test", name: "Test" }],
  lineGroups: [
    { id: "shared-group", name: "Shared", operatorId: "test", color: "#123456", serviceIds: [M_LOOP, M_LINE] },
    { id: "spur-group", name: "Spur", operatorId: "test", color: "#654321", serviceIds: [M_SPUR] },
  ],
  stations: [],
  serviceStopNames: [],
};

function fixture() {
  const network = buildRailwayNetwork(multiServiceInput());
  return { network, presentation: createPresentationResolver(network, UI_PRESENTATION) };
}

function rapidFixture() {
  const input = multiServiceInput();
  const network = buildRailwayNetwork({
    ...input,
    stations: input.stations.filter(({ id }) => id !== "y" && id !== "z"),
    services: input.services.map((service) => service.id === M_LINE ? {
      ...service,
      kind: "rapid" as const,
      stationIds: ["x", "d"],
      platformCoordinates: { x: service.platformCoordinates.x!, d: service.platformCoordinates.d! },
    } : service),
    segments: [...input.segments.filter(({ serviceId }) => serviceId !== M_LINE), ...bothWays(M_LINE, ["x", "d"])],
  });
  return { network, presentation: createPresentationResolver(network, UI_PRESENTATION) };
}

describe("deriveCollectionProgress", () => {
  it("starts with the start station and runtime network totals", () => {
    const { network, presentation } = fixture();
    const progress = deriveCollectionProgress(M_START, [], network, presentation);
    expect(progress).toEqual({
      visitedStations: 1,
      totalStations: network.stationsById.size,
      riddenLines: 0,
      totalLines: presentation.lineGroups().length,
      stationsText: `訪れた駅 1/${network.stationsById.size}`,
      linesText: `乗った路線 0/${presentation.lineGroups().length}`,
    });
  });

  it("deduplicates repeated stops and services in the same presentation group", () => {
    const { network, presentation } = fixture();
    const progress = deriveCollectionProgress(M_START, [
      { traversedSegmentIds: [`${M_LOOP}:start:a`, `${M_LOOP}:a:b`] },
      { traversedSegmentIds: [`${M_LOOP}:start:a`, `${M_LINE}:x:b`] },
    ], network, presentation);
    expect(progress.visitedStations).toBe(4);
    expect(progress.riddenLines).toBe(1);
  });

  it("counts only the endpoints of a traversed rapid segment", () => {
    const { network, presentation } = rapidFixture();
    const progress = deriveCollectionProgress("x", [
      { traversedSegmentIds: [`${M_LINE}:x:d`] },
    ], network, presentation);
    expect(network.stationsById.has("b")).toBe(true);
    expect(progress.visitedStations).toBe(2);
  });

  it("counts a deadhead destination without counting a ridden line", () => {
    const { network, presentation } = fixture();
    const progress = deriveCollectionProgress(M_START, [
      { traversedSegmentIds: [], relocationDestinationId: "s1" },
    ], network, presentation);
    expect(progress.visitedStations).toBe(2);
    expect(progress.riddenLines).toBe(0);
  });

  it("formats counts using runtime totals and Japanese digit grouping", () => {
    const { network, presentation } = fixture();
    const stationsById = new Map(network.stationsById);
    for (let index = stationsById.size; index < TOTAL_STATIONS; index += 1) {
      const id = `fixture-station-${index}`;
      stationsById.set(id, { id, name: id, coordinates: [0, 0] });
    }
    const largeNetwork: RailwayNetwork = { ...network, stationsById };
    const lineGroups = Array.from({ length: TOTAL_LINE_GROUPS }, (_, index) => ({
      id: `fixture-group-${index}`, name: "Fixture", operatorId: "test", color: "#123456", serviceIds: [],
    }));
    const largePresentation = { ...presentation, lineGroups: () => lineGroups };
    const progress = deriveCollectionProgress(M_START, [], largeNetwork, largePresentation);
    expect(progress.stationsText).toBe("訪れた駅 1/1,586");
    expect(progress.linesText).toBe("乗った路線 0/134");
  });
});
