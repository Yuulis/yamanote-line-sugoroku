import { describe, expect, it } from "vitest";
import { isManifest, isSegment, isSegmentFeatureCollection, isServicePattern, isServicesData } from "../../src/data/guards";
import type { RailwayData } from "../../src/data/loaders";
import { displayedProgress } from "../../src/features/game/animation/displayedProgress";
import { buildGeometryIndex, buildMovePlan, orientPath } from "../../src/features/game/animation/movePath";
import { buildRailwayNetwork, createGame, moveByRoll, platformPosition } from "../../src/features/game/engine";
import { networkFromData } from "../../src/features/game/networkFromData";
import type { SegmentFeatureCollection } from "../../src/types/data";
import { validFeatureCollection, validManifest, validService } from "./fixtures/railway";
import { M_LINE, M_LOOP, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { yamanoteInput } from "./fixtures/yamanote";

function appData(): RailwayData {
  const input = yamanoteInput();
  return {
    stations: { ok: true, value: [...input.stations] },
    services: { ok: true, value: { lines: input.services.map(({ id, name, color }) => ({ id, name, color })), services: [...input.services] } },
    segments: { ok: true, value: [...input.segments] },
    manifest: { ok: true, value: { ...validManifest, dataVersion: input.dataVersion } },
    geometry: { ok: true, value: { type: "FeatureCollection", features: input.segments.map((segment) => ({
      type: "Feature", id: segment.geometryFeatureIds[0]!,
      properties: { featureId: segment.geometryFeatureIds[0]!, serviceId: segment.serviceId, lineId: segment.serviceId, from: segment.from, to: segment.to },
      geometry: { type: "LineString", coordinates: [input.services[0]!.platformCoordinates[segment.from]!, input.services[0]!.platformCoordinates[segment.to]!] },
    })) } },
  };
}

/** A rapid hop composes two primitives while its gameplay stop list skips their joint. */
function chainData(): RailwayData {
  const data = appData();
  if (!data.services.ok || !data.segments.ok || !data.geometry.ok) throw new Error("Invalid fixture");
  const owner = data.services.value.services[0]!;
  const [first, second] = data.geometry.value.features.slice(1, 3);
  if (!first || !second) throw new Error("Missing fixture geometry");
  const from = first.properties.from, to = second.properties.to;
  // The second primitive has its own service owner; the rapid owns no geometry.
  const ownerId = "second-owner", ownerFeatureId = `${ownerId}:${second.properties.from}~${to}`;
  data.services.value.services.push({ ...owner, id: ownerId, circular: false,
    stationIds: [second.properties.from, to],
    platformCoordinates: { [second.properties.from]: owner.platformCoordinates[second.properties.from]!, [to]: owner.platformCoordinates[to]! },
    endpoints: { first: "terminus", last: "terminus" } });
  data.geometry.value.features.push({ ...structuredClone(second), id: ownerFeatureId,
    properties: { ...second.properties, featureId: ownerFeatureId, serviceId: ownerId } });
  data.segments.value.push(
    { id: `${ownerId}:${second.properties.from}:${to}`, serviceId: ownerId, from: second.properties.from, to, geometryFeatureIds: [ownerFeatureId] },
    { id: `${ownerId}:${to}:${second.properties.from}`, serviceId: ownerId, from: to, to: second.properties.from, geometryFeatureIds: [ownerFeatureId] },
  );
  data.services.value.services.push({ ...owner, id: "rapid-chain", kind: "rapid", circular: false,
    stationIds: [from, to], platformCoordinates: { [from]: owner.platformCoordinates[from]!, [to]: owner.platformCoordinates[to]! },
    endpoints: { first: "service-boundary", last: "area-boundary" } });
  data.segments.value.push(
    { id: `rapid-chain:${from}:${to}`, serviceId: "rapid-chain", from, to, geometryFeatureIds: [first.id, ownerFeatureId] },
    { id: `rapid-chain:${to}:${from}`, serviceId: "rapid-chain", from: to, to: from, geometryFeatureIds: [ownerFeatureId, first.id] },
  );
  return data;
}

describe("v3 runtime guards", () => {
  it.each([
    { ...validService, kind: undefined },
    { ...validService, kind: "special-rapid" },
    { ...validService, lineIds: [] },
    { ...validService, lineIds: [validService.id, validService.id] },
    { ...validService, directionLabels: undefined },
    { ...validService, platformCoordinates: {} },
    { ...validService, platformCoordinates: { ...validService.platformCoordinates, extra: [139, 35] } },
    { ...validService, platformCoordinates: { ...validService.platformCoordinates, "st-tokyo": [139, Number.NaN] } },
    { ...validService, stationIds: ["st-tokyo", "st-tokyo", "st-ueno"] },
    { ...validService, endpoints: { first: "terminus", last: "area-boundary" } },
    { ...validService, circular: false },
    { ...validService, circular: false, endpoints: { first: "end", last: "terminus" } },
  ])("rejects invalid service metadata %#", (service) => {
    expect(isServicePattern(service)).toBe(false);
  });

  it("accepts a linear pattern with explicit endpoint kinds", () => {
    expect(isServicePattern({ ...validService, circular: false, endpoints: { first: "terminus", last: "area-boundary" } })).toBe(true);
  });

  it("requires known line references in the services envelope", () => {
    const lines = [{ id: validService.id, name: validService.name, color: validService.color }];
    expect(isServicesData({ lines, services: [validService] })).toBe(true);
    expect(isServicesData({ lines, services: [{ ...validService, lineIds: ["unknown"] }] })).toBe(false);
    expect(isServicesData({ lines: [...lines, ...lines], services: [validService] })).toBe(false);
  });

  it("rejects the old manifest and geometry identity contract", () => {
    expect(isManifest({ ...validManifest, schemaVersion: undefined })).toBe(false);
    expect(isManifest({ ...validManifest, schemaVersion: 1 })).toBe(false);
    expect(isManifest({ ...validManifest, schemaVersion: 2 })).toBe(false);
    expect(isServicesData([validService])).toBe(false);
    expect(isSegment({ id: "v2", serviceId: "owner", from: "a", to: "b", geometryFeatureId: "v2" })).toBe(false);
    const feature = validFeatureCollection.features[0]!;
    expect(isSegmentFeatureCollection({ ...validFeatureCollection, crs: {} })).toBe(false);
    expect(isSegmentFeatureCollection({ type: "FeatureCollection", features: [{ ...feature, id: "other" }] })).toBe(false);
  });
});

describe("v3 network ownership and geometry identity", () => {
  it("deep copies nested service metadata and geometry chains", () => {
    const input = multiServiceInput();
    const line = input.services[1]!;
    const network = buildRailwayNetwork(input);
    const before = structuredClone(network.servicesById.get(M_LINE));
    line.platformCoordinates.b![0] += 1;
    line.directionLabels.forward = "changed";
    line.lineIds[0] = "changed";
    input.segments[0]!.geometryFeatureIds[0] = "changed";
    if (!line.circular) line.endpoints.first = "area-boundary";
    expect(network.servicesById.get(M_LINE)).toEqual(before);
    expect(network.segmentsById.get(input.segments[0]!.id)!.geometryFeatureIds).toEqual([input.segments[0]!.id]);
  });

  it("orients by identity even when coordinates are nearer the opposite end", () => {
    const path = { fromStationId: "a", toStationId: "b", points: [[140, 36], [139, 35]] as [number, number][] };
    expect(orientPath(path, "a", "b")).toEqual(path.points);
    expect(orientPath(path, "b", "a")).toEqual([...path.points].reverse());
    expect(() => orientPath(path, "a", "c")).toThrowError(expect.objectContaining({ code: "INVALID_NETWORK" }));
  });

  it("rejects missing, unrelated and duplicate geometry references before starting", () => {
    expect(networkFromData(appData()).ok).toBe(true);
    for (const mutate of [
      (collection: SegmentFeatureCollection) => collection.features.pop(),
      (collection: SegmentFeatureCollection) => { collection.features[0]!.properties.to = "tokyo"; },
      (collection: SegmentFeatureCollection) => collection.features.push(collection.features[0]!),
    ]) {
      const data = appData();
      if (!data.geometry.ok) throw new Error("fixture missing geometry");
      mutate(data.geometry.value);
      expect(networkFromData(data)).toEqual({ ok: false, reason: "路線データが不正です" });
    }
  });

  it("accepts composed rapid chains in both directions without an owned rapid feature", () => {
    expect(networkFromData(chainData()).ok).toBe(true);
  });

  it("rejects individually contiguous chains whose reverse ids are not the exact forward reversal", () => {
    const data = chainData();
    if (!data.segments.ok || !data.geometry.ok) throw new Error("Invalid fixture");
    const forward = data.segments.value.at(-2)!;
    const reverse = data.segments.value.at(-1)!;
    const ownedSecond = data.geometry.value.features.at(-1)!;
    const alternate = data.geometry.value.features.find((feature) =>
      feature.id !== ownedSecond.id && feature.properties.from === ownedSecond.properties.from &&
      feature.properties.to === ownedSecond.properties.to)!;
    expect(alternate.geometry.coordinates).toEqual(ownedSecond.geometry.coordinates);
    reverse.geometryFeatureIds = [alternate.id, forward.geometryFeatureIds[0]];
    // The alternate primitive has the same endpoints and exact joint, and is
    // already consumed by its owner. Each paired chain is individually valid.
    const matchedForward = structuredClone(data);
    if (!matchedForward.segments.ok) throw new Error("Invalid fixture");
    matchedForward.segments.value.at(-2)!.geometryFeatureIds = [forward.geometryFeatureIds[0], alternate.id];
    expect(networkFromData(matchedForward).ok).toBe(true);
    const matchedReverse = structuredClone(data);
    if (!matchedReverse.segments.ok) throw new Error("Invalid fixture");
    matchedReverse.segments.value.at(-1)!.geometryFeatureIds = [...forward.geometryFeatureIds].reverse() as typeof forward.geometryFeatureIds;
    expect(networkFromData(matchedReverse).ok).toBe(true);
    expect(networkFromData(data)).toEqual({ ok: false, reason: "路線データが不正です" });
  });

  it.each(["empty", "missing", "unknown", "misordered", "wrong reverse", "wrong endpoint", "backtracking", "joint gap", "unknown owner"])("rejects an invalid chain: %s", (problem) => {
    const data = chainData();
    if (!data.segments.ok || !data.geometry.ok) throw new Error("Invalid fixture");
    const forward = data.segments.value.at(-2)!;
    const reverse = data.segments.value.at(-1)!;
    const [first, second] = forward.geometryFeatureIds;
    if (problem === "empty") forward.geometryFeatureIds = [] as unknown as typeof forward.geometryFeatureIds;
    if (problem === "missing") Reflect.deleteProperty(forward, "geometryFeatureIds");
    if (problem === "unknown") forward.geometryFeatureIds = ["unknown"];
    if (problem === "misordered") forward.geometryFeatureIds = [second!, first];
    if (problem === "wrong reverse") reverse.geometryFeatureIds = [...forward.geometryFeatureIds];
    if (problem === "wrong endpoint") forward.geometryFeatureIds = [first];
    if (problem === "backtracking") forward.geometryFeatureIds = [first, first, second!];
    if (problem === "joint gap") {
      const coordinates = data.geometry.value.features.at(-1)!.geometry.coordinates;
      coordinates[0] = [coordinates[0]![0] + 0.001, coordinates[0]![1]];
    }
    if (problem === "unknown owner") data.geometry.value.features[0]!.properties.serviceId = "unknown";
    expect(networkFromData(data)).toEqual({ ok: false, reason: "路線データが不正です" });
  });

  it("still allows the documented animation fallback when geometry failed to load", () => {
    const data = { ...appData(), geometry: { ok: false, file: "segments.geojson", reason: "HTTP 503" } } as RailwayData;
    expect(networkFromData(data).ok).toBe(true);
  });

  it("shows the ridden platform until the transfer animation finishes", () => {
    const input = multiServiceInput();
    input.services[1]!.platformCoordinates.b = [139.9, 35.9];
    const network = buildRailwayNetwork(input);
    const start = createGame(multiConfig(), "platform", network);
    const { state, events } = moveByRoll(start, 2, network, { serviceId: M_LINE, direction: 1 });
    const steps = buildMovePlan(events, network, buildGeometryIndex(undefined));
    expect(displayedProgress(state, network, null).position).toEqual([139.9, 35.9]);
    expect(displayedProgress(state, network, { fromStationId: start.currentStationId, steps, frame: null }).position).toEqual(platformPosition(network, M_LOOP, start.currentStationId));
    expect(displayedProgress(state, network, { fromStationId: start.currentStationId, steps, frame: { stepsCompleted: 2, position: platformPosition(network, M_LOOP, "b"), done: true } }).position).toEqual(platformPosition(network, M_LOOP, "b"));
    expect(steps[1]!.points.at(-1)).toEqual(platformPosition(network, M_LOOP, "b"));
  });
});
