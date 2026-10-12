import { describe, expect, it } from "vitest";
import { isManifest, isSegmentFeatureCollection, isServicePattern } from "../../src/data/guards";
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
    services: { ok: true, value: [...input.services] },
    segments: { ok: true, value: [...input.segments] },
    manifest: { ok: true, value: { ...validManifest, dataVersion: input.dataVersion } },
    geometry: { ok: true, value: { type: "FeatureCollection", features: input.segments.map((segment) => ({
      type: "Feature", id: segment.geometryFeatureId,
      properties: { featureId: segment.geometryFeatureId, serviceId: segment.serviceId, from: segment.from, to: segment.to },
      geometry: { type: "LineString", coordinates: [input.services[0]!.platformCoordinates[segment.from]!, input.services[0]!.platformCoordinates[segment.to]!] },
    })) } },
  };
}

describe("v2 runtime guards", () => {
  it.each([
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

  it("rejects the old manifest and geometry identity contract", () => {
    expect(isManifest({ ...validManifest, schemaVersion: undefined })).toBe(false);
    expect(isManifest({ ...validManifest, schemaVersion: 1 })).toBe(false);
    const feature = validFeatureCollection.features[0]!;
    expect(isSegmentFeatureCollection({ ...validFeatureCollection, crs: {} })).toBe(false);
    expect(isSegmentFeatureCollection({ type: "FeatureCollection", features: [{ ...feature, id: "other" }] })).toBe(false);
  });
});

describe("v2 network ownership and geometry identity", () => {
  it("deep copies nested service metadata", () => {
    const input = multiServiceInput();
    const line = input.services[1]!;
    const network = buildRailwayNetwork(input);
    const before = structuredClone(network.servicesById.get(M_LINE));
    line.platformCoordinates.b![0] += 1;
    line.directionLabels.forward = "changed";
    if (!line.circular) line.endpoints.first = "area-boundary";
    expect(network.servicesById.get(M_LINE)).toEqual(before);
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
