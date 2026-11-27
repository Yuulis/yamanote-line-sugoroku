import { describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame, createItemGame } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveClearResult, mapSavedRecord } from "../../src/features/game/clearResult";
import { buildClearRoute, buildClearRouteGeoJson } from "../../src/features/game/clearRoute";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { GeometryIndex, GeometryPath } from "../../src/features/game/animation/movePath";
import type { GameState, ItemGameState, ItemTurnRecord, MoveRecord, Segment } from "../../src/types/network";
import { M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";

const inputData = multiServiceInput();
const segmentId = `${M_LINE}:x:b`;
const targetSegment = inputData.segments.find((segment) => segment.id === segmentId)!;
function withFeatureIds(segment: Segment, featureIds: string[]): Segment {
  return { ...segment, geometryFeatureIds: featureIds as Segment["geometryFeatureIds"] };
}

const splitSegment = withFeatureIds(targetSegment, ["x-joint", "joint-b"]);
const network = buildRailwayNetwork({ ...inputData, segments: inputData.segments.map((segment) => segment.id === segmentId ? splitSegment : segment) });
const presentation = createPresentationResolver(network);
const base = createGame(multiConfig(), "clear-route", network);
const display = { title: "Test", subtitle: "Edition", documentTitle: "Test", ruleParagraphs: [] };

function record(ids: string[] = [segmentId], from = "x", to = "b"): MoveRecord {
  return { turn: 1, roll: ids.length, serviceId: M_LINE, direction: 1, fromStationId: from, toStationId: to,
    traversedSegmentIds: ids, stopReason: "roll", landing: null };
}

function game(movementHistory: MoveRecord[]): GameState {
  return { ...base, config: { ...base.config, startStationId: "x" }, status: "completed", turn: movementHistory.length,
    currentStationId: movementHistory.at(-1)?.toStationId ?? "x", movementHistory };
}

function geometry(overrides: readonly [string, GeometryPath][] = []): GeometryIndex {
  const networkFeatures = [...network.segmentsById.values()].flatMap((segment) => {
    if (segment.id === segmentId) return [];
    const service = network.servicesById.get(segment.serviceId)!;
    const featureId = segment.geometryFeatureIds[0]!;
    return [[featureId, {
      fromStationId: segment.from,
      toStationId: segment.to,
      points: [service.platformCoordinates[segment.from]!, service.platformCoordinates[segment.to]!],
    }] as [string, GeometryPath]];
  });
  const splitFeatures: [string, GeometryPath][] = [
    ["x-joint", { fromStationId: "x", toStationId: "joint", points: [[139.7, 35.6], [139.71, 35.61]] }],
    ["joint-b", { fromStationId: "joint", toStationId: "b", points: [[139.71, 35.61], [139.72, 35.62]] }],
  ];
  return new Map([...networkFeatures, ...splitFeatures, ...overrides]);
}

function itemRide(fromStationId: string, toStationId: string, segmentIds: string[]): Extract<ItemTurnRecord, { kind: "item-ride" }> {
  return {
    kind: "item-ride", turn: 1, fromStationId, toStationId, command: { items: [] }, traversedSegmentIds: segmentIds,
    landing: { serviceId: M_LINE, direction: 1 }, landingSnapshot: null, itemEvents: [], discardedInstanceId: null,
    resolvedRide: { serviceId: M_LINE, direction: 1 }, rawRoll: 1, effectiveFace: 1, adjustment: null,
    movementMode: "normal", pips: segmentIds.length, hopBudget: segmentIds.length, physicalHops: segmentIds.length,
    unusedPips: 0, stopReason: "roll",
  };
}

function itemDeadhead(stationId: string): Extract<ItemTurnRecord, { kind: "deadhead" }> {
  return {
    kind: "deadhead", turn: 2, fromStationId: stationId, toStationId: stationId, command: { items: [] },
    traversedSegmentIds: [], landing: { serviceId: M_LINE, direction: 1 }, landingSnapshot: null, itemEvents: [],
    discardedInstanceId: null, resolvedRide: null, rawRoll: null, effectiveFace: null, adjustment: null,
    movementMode: "deadhead", pips: null, hopBudget: null, physicalHops: 0, unusedPips: null,
    stopReason: "relocation", relocation: { fromStationId: stationId, toStationId: stationId, serviceId: M_LOOP, direction: 1, distance: 0 },
  };
}

function itemGame(movementHistory: ItemTurnRecord[]): ItemGameState {
  const base = createItemGame({ ...multiConfig(), itemPolicy: ITEM_GAME_CONFIG.itemPolicy! }, "clear-route-deadhead", network);
  return { ...base, config: { ...base.config, startStationId: "x" }, status: "completed", turn: movementHistory.length,
    currentStationId: movementHistory.at(-1)?.toStationId ?? "x", movementHistory };
}

function derive(geometryIndex: GeometryIndex = geometry()) {
  return deriveClearResult({ game: game([record()]), network, geometry: geometryIndex, presentation, display });
}

describe("clear route construction", () => {
  it("keeps directed feature order and builds bounds from every oriented point", () => {
    const result = derive();
    expect(result.route?.steps[0]?.points).toEqual([[139.7, 35.6], [139.71, 35.61], [139.72, 35.62]]);
    expect(result.route?.legs).toEqual([{ firstStepIndex: 0, endStepIndexExclusive: 1, serviceId: M_LINE,
      lineGroupId: M_LINE, color: "#123456" }]);
    expect(result.route?.bounds).toEqual([[139.7, 35.6], [139.72, 35.62]]);
    expect(result.route?.turnSpans).toEqual([
      { recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1, destination: network.stationsById.get("b")!.coordinates },
    ]);
  });

  it("omits a turn destination when the validated traversal's end station has no coordinates", () => {
    const savedRecord = record();
    const traversal = mapSavedRecord(savedRecord, 0, "x", {
      game: game([savedRecord]), network, geometry: geometry(), presentation, display,
    });
    const networkWithoutDestination = {
      ...network,
      stationsById: new Map([...network.stationsById].filter(([stationId]) => stationId !== "b")),
    };

    const route = buildClearRoute([traversal], networkWithoutDestination, geometry(), (serviceId) => presentation.lineGroupId(serviceId));

    expect(route?.turnSpans).toEqual([
      { recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1 },
    ]);
  });

  it("uses the directed reverse segment feature order without reversing the id list", () => {
    const reverseId = `${M_LINE}:b:x`;
    const reverse = inputData.segments.find((segment) => segment.id === reverseId)!;
    const updated = withFeatureIds(reverse, ["b-joint", "joint-x"]);
    const reverseNetwork = buildRailwayNetwork({ ...inputData, segments: inputData.segments.map((segment) => segment.id === reverseId ? updated : segment) });
    const reverseGeometry = new Map<string, GeometryPath>([
      ["b-joint", { fromStationId: "b", toStationId: "joint", points: [[139.72, 35.62], [139.71, 35.61]] }],
      ["joint-x", { fromStationId: "joint", toStationId: "x", points: [[139.71, 35.61], [139.7, 35.6]] }],
    ]);
    const reverseBase = createGame(multiConfig(), "clear-route-reverse", reverseNetwork);
    const result = deriveClearResult({ game: { ...reverseBase, config: { ...reverseBase.config, startStationId: "b" }, status: "completed", turn: 1,
      movementHistory: [{ ...record([reverseId], "b", "x"), direction: -1 }] }, network: reverseNetwork,
      geometry: reverseGeometry, presentation: createPresentationResolver(reverseNetwork), display });
    expect(result.route?.steps[0]?.points).toEqual([[139.72, 35.62], [139.71, 35.61], [139.7, 35.6]]);
  });

  it("orients shared geometry for a segment and keeps the ridden service color", () => {
    const sharedId = "shared-line";
    const sourceLine = inputData.services.find((service) => service.id === M_LINE)!;
    const sourceSpur = inputData.services.find((service) => service.id === M_SPUR)!;
    const sharedSpur = {
      ...sourceSpur,
      stationIds: ["x", "b", "s1"],
      platformCoordinates: {
        x: sourceLine.platformCoordinates.x!, b: sourceLine.platformCoordinates.b!, s1: sourceSpur.platformCoordinates.s1!,
      },
    };
    const spurSegments: Segment[] = [
      { id: `${M_SPUR}:x:b`, serviceId: M_SPUR, from: "x", to: "b", geometryFeatureIds: [sharedId] },
      { id: `${M_SPUR}:b:x`, serviceId: M_SPUR, from: "b", to: "x", geometryFeatureIds: [sharedId] },
      { id: `${M_SPUR}:b:s1`, serviceId: M_SPUR, from: "b", to: "s1", geometryFeatureIds: [`${M_SPUR}:b:s1`] },
      { id: `${M_SPUR}:s1:b`, serviceId: M_SPUR, from: "s1", to: "b", geometryFeatureIds: [`${M_SPUR}:s1:b`] },
    ];
    const sharedForward = withFeatureIds(targetSegment, [sharedId]);
    const sharedNetwork = buildRailwayNetwork({
      ...inputData,
      stations: inputData.stations.filter((station) => station.id !== "s2"),
      services: inputData.services.map((service) => service.id === M_SPUR ? sharedSpur : service),
      segments: [
        ...inputData.segments.filter((segment) => segment.serviceId !== M_SPUR && segment.id !== segmentId),
        sharedForward,
        ...spurSegments,
      ],
    });
    const sharedBase = createGame(multiConfig(), "clear-route-shared", sharedNetwork);
    const sharedPresentation = createPresentationResolver(sharedNetwork, {
      version: 1, operators: [], stations: [], serviceStopNames: [],
      lineGroups: [
        { id: "m-line-group", name: "Line", operatorId: "test", color: "#0000ff", serviceIds: [M_LINE] },
        { id: "m-spur-group", name: "Spur", operatorId: "test", color: "#ff0000", serviceIds: [M_SPUR] },
      ],
    });
    const result = deriveClearResult({ game: { ...sharedBase, config: { ...sharedBase.config, startStationId: "x" },
      status: "completed", turn: 1, movementHistory: [record()] }, network: sharedNetwork,
      geometry: new Map([[sharedId, { fromStationId: "b", toStationId: "x", points: [[139.72, 35.62], [139.7, 35.6]] }]]),
      presentation: sharedPresentation, display });
    expect(result.route?.steps[0]?.points).toEqual([[139.7, 35.6], [139.72, 35.62]]);
    expect(result.route?.steps[0]?.segmentId).toBe(segmentId);
    expect(result.route?.legs[0]?.color).toBe("#0000ff");
  });

  it("does not count an internal geometry joint as a visited station", () => {
    const distantJoint = new Map<string, GeometryPath>([
      ["x-joint", { fromStationId: "x", toStationId: "joint", points: [[139.7, 35.6], [0, 0]] }],
      ["joint-b", { fromStationId: "joint", toStationId: "b", points: [[0, 0], [139.72, 35.62]] }],
    ]);
    const result = deriveClearResult({ game: game([record()]), network, geometry: distantJoint, presentation, display });
    expect(result.route).not.toBeNull();
    expect(result.highlights.farthestStation?.stationId).toBe("b");
  });

  it("rejects latitudes beyond the Web Mercator limit without changing highlights", () => {
    const validGeometryResult = derive();
    const beyondMercatorLimit = 85.05113;
    const invalidGeometryResult = derive(geometry([
      ["x-joint", { fromStationId: "x", toStationId: "joint", points: [[139.7, 35.6], [139.71, beyondMercatorLimit]] }],
      ["joint-b", { fromStationId: "joint", toStationId: "b", points: [[139.71, beyondMercatorLimit], [139.72, 35.62]] }],
    ]));

    expect(validGeometryResult.route).not.toBeNull();
    expect(invalidGeometryResult.route).toBeNull();
    expect(invalidGeometryResult.highlights).toEqual(validGeometryResult.highlights);
  });

  it("splits route legs at a service change and an exact geometry gap", () => {
    const result = deriveClearResult({ game: game([
      { ...record(), landing: { serviceId: "m-spur", direction: 1 } },
      { ...record(["m-spur:b:s1"], "b", "s1"), serviceId: "m-spur" },
    ]), network, geometry: geometry(), presentation, display });
    expect(result.route?.steps).toHaveLength(2);
    expect(result.route?.legs.map((leg) => [leg.firstStepIndex, leg.endStepIndexExclusive, leg.serviceId])).toEqual([
      [0, 1, M_LINE], [1, 2, "m-spur"],
    ]);
  });

  it("breaks route leg continuity across a same-station deadhead", () => {
    const line = network.servicesById.get(M_LINE)!;
    const from = line.platformCoordinates.x!;
    const to = line.platformCoordinates.b!;
    const middle: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const continuousGeometry = geometry([
      ["x-joint", { fromStationId: "x", toStationId: "joint", points: [from, middle] }],
      ["joint-b", { fromStationId: "joint", toStationId: "b", points: [middle, to] }],
    ]);
    const result = deriveClearResult({ game: itemGame([
      itemRide("x", "b", [segmentId]),
      itemDeadhead("b"),
      itemRide("b", "y", [`${M_LINE}:b:y`]),
      itemRide("y", "y", []),
    ]), network, geometry: continuousGeometry, presentation, display });
    expect(result.route?.legs.map((leg) => [leg.firstStepIndex, leg.endStepIndexExclusive])).toEqual([[0, 1], [1, 2]]);
    expect(result.route?.turnSpans).toEqual([
      { recordIndex: 0, firstStepIndex: 0, endStepIndexExclusive: 1, destination: network.stationsById.get("b")!.coordinates },
      { recordIndex: 1, firstStepIndex: 1, endStepIndexExclusive: 1, destination: network.stationsById.get("b")!.coordinates },
      { recordIndex: 2, firstStepIndex: 1, endStepIndexExclusive: 2, destination: network.stationsById.get("y")!.coordinates },
      { recordIndex: 3, firstStepIndex: 2, endStepIndexExclusive: 2, destination: network.stationsById.get("y")!.coordinates },
    ]);
  });

  it.each([
    ["missing feature", splitSegment, new Map([["x-joint", geometry().get("x-joint")!]])],
    ["non-finite coordinate", splitSegment, geometry([["joint-b", { ...geometry().get("joint-b")!, points: [[139.71, 35.61], [Number.NaN, 35.62]] }]])],
    ["out-of-range coordinate", splitSegment, geometry([["joint-b", { ...geometry().get("joint-b")!, points: [[139.71, 35.61], [200, 35.62]] }]])],
    ["feature joint gap", splitSegment, geometry([["joint-b", { ...geometry().get("joint-b")!, points: [[139.710001, 35.61], [139.72, 35.62]] }]])],
    ["zero-length path", splitSegment, geometry([
      ["x-joint", { fromStationId: "x", toStationId: "joint", points: [[139.7, 35.6], [139.7, 35.6]] }],
      ["joint-b", { fromStationId: "joint", toStationId: "b", points: [[139.7, 35.6], [139.7, 35.6]] }],
    ])],
  ] as const)("rejects %s while preserving topology highlights", (_label, segment, geometryIndex) => {
    const candidateNetwork = buildRailwayNetwork({ ...inputData,
      segments: inputData.segments.map((candidate) => candidate.id === segmentId ? segment : candidate) });
    const candidateBase = createGame(multiConfig(), "clear-route-invalid", candidateNetwork);
    const candidateGame = { ...candidateBase, config: { ...candidateBase.config, startStationId: "x" },
      status: "completed" as const, turn: 1, movementHistory: [record()] };
    const result = deriveClearResult({ game: candidateGame, network: candidateNetwork, geometry: geometryIndex,
      presentation: createPresentationResolver(candidateNetwork), display });
    expect(result.route).toBeNull();
    expect(result.highlights.farthestStation).not.toBeNull();
  });

  it("rejects an empty directed feature id list even though the engine input type forbids it", () => {
    const candidateNetwork = buildRailwayNetwork({ ...inputData, segments: inputData.segments.map((segment) => segment.id === segmentId
      ? withFeatureIds(segment, ["unused-feature"]) : segment) });
    const malformed = { ...candidateNetwork.segmentsById.get(segmentId)!, geometryFeatureIds: [] as unknown as Segment["geometryFeatureIds"] };
    const segmentsById = new Map(candidateNetwork.segmentsById).set(segmentId, malformed);
    const segmentsByEndpoints = new Map([...candidateNetwork.segmentsByEndpoints].map(([key, segment]) =>
      [key, segment.id === segmentId ? malformed : segment] as const));
    const malformedNetwork = { ...candidateNetwork, segmentsById, segmentsByEndpoints };
    const candidateBase = createGame(multiConfig(), "clear-route-empty-chain", candidateNetwork);
    const result = deriveClearResult({ game: { ...candidateBase, config: { ...candidateBase.config, startStationId: "x" },
      status: "completed", turn: 1, movementHistory: [record()] }, network: malformedNetwork, geometry: geometry(),
      presentation: createPresentationResolver(candidateNetwork), display });
    expect(result.route).toBeNull();
    expect(result.highlights.farthestStation).not.toBeNull();
  });

  it("rejects a segment with fewer than two geometry points and zero-length returned steps", () => {
    expect(derive(geometry([["x-joint", { fromStationId: "x", toStationId: "joint", points: [[139.7, 35.6]] }]] )).route).toBeNull();
  });

  it("rejects an arrival station that differs from the topology-validated final hop", () => {
    const result = deriveClearResult({ game: game([record([segmentId], "x", "y")]), network, geometry: geometry(), presentation, display });
    expect(result.route).toBeNull();
    expect(result.highlights.mostUsedLine).toBeNull();
  });
});

/** The split segment ends exactly at the platform of b, so the next ride on the same line continues the leg. */
function platformJoinedGeometry(): GeometryIndex {
  const line = network.servicesById.get(M_LINE)!;
  const from = line.platformCoordinates.x!;
  const to = line.platformCoordinates.b!;
  const middle: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return geometry([
    ["x-joint", { fromStationId: "x", toStationId: "joint", points: [from, middle] }],
    ["joint-b", { fromStationId: "joint", toStationId: "b", points: [middle, to] }],
  ]);
}

describe("full-route GeoJSON", () => {
  it("draws one LineString per leg in the ridden service colour and joins the steps of a leg without a repeated point", () => {
    const result = deriveClearResult({ game: game([
      record(),
      { ...record(["m-spur:b:s1"], "b", "s1"), serviceId: "m-spur" },
    ]), network, geometry: geometry(), presentation, display });
    const route = result.route!;
    const collection = buildClearRouteGeoJson(route);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(route.legs.length);
    expect(collection.features.map((feature) => feature.properties)).toEqual(route.legs.map((leg) => ({
      serviceId: leg.serviceId, lineGroupId: leg.lineGroupId, color: leg.color,
    })));
    expect(collection.features[0]?.geometry).toEqual({ type: "LineString", coordinates: [[139.7, 35.6], [139.71, 35.61], [139.72, 35.62]] });
    for (const feature of collection.features) {
      expect(feature.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("merges consecutive steps of one leg into one LineString without duplicating the shared joint", () => {
    const result = deriveClearResult({ game: game([record(), record([`${M_LINE}:b:y`], "b", "y")]),
      network, geometry: platformJoinedGeometry(), presentation, display });
    const route = result.route!;
    expect(route.legs).toHaveLength(1);
    const [feature] = buildClearRouteGeoJson(route).features;
    const joint = route.steps[0]!.points.at(-1)!;
    expect(feature?.geometry.coordinates.filter(([lng, lat]) => lng === joint[0] && lat === joint[1])).toHaveLength(1);
    expect(feature?.geometry.coordinates).toHaveLength(route.steps[0]!.points.length + route.steps[1]!.points.length - 1);
  });

  it("never draws a line across a relocation: each side of the break is its own LineString", () => {
    const line = network.servicesById.get(M_LINE)!;
    const from = line.platformCoordinates.x!;
    const to = line.platformCoordinates.b!;
    const middle: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const continuousGeometry = geometry([
      ["x-joint", { fromStationId: "x", toStationId: "joint", points: [from, middle] }],
      ["joint-b", { fromStationId: "joint", toStationId: "b", points: [middle, to] }],
    ]);
    const result = deriveClearResult({ game: itemGame([
      itemRide("x", "b", [segmentId]),
      itemDeadhead("b"),
      itemRide("b", "y", [`${M_LINE}:b:y`]),
    ]), network, geometry: continuousGeometry, presentation, display });
    const collection = buildClearRouteGeoJson(result.route!);
    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.geometry.coordinates.at(-1)).toEqual(to);
    expect(collection.features[1]?.geometry.coordinates[0]).toEqual(to);
    expect(collection.features.every((feature) => feature.geometry.coordinates.length >= 2)).toBe(true);
  });
});
