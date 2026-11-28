import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCorridorOffsets, type CorridorRenderCollection } from "../../src/features/map/corridorOffsets";
import type { Position, SegmentFeature, SegmentFeatureCollection } from "../../src/types/data";

function feature(
  serviceId: string,
  id: string,
  coordinates: readonly Position[],
  featureId = `${serviceId}:${id}`,
): SegmentFeature {
  return {
    type: "Feature",
    id: `${serviceId}:${id}`,
    properties: { featureId, serviceId, lineId: serviceId, from: `${id}-from`, to: `${id}-to` },
    geometry: { type: "LineString", coordinates: coordinates.map(([longitude, latitude]) => [longitude, latitude]) },
  };
}

function collection(...features: SegmentFeature[]): SegmentFeatureCollection {
  return { type: "FeatureCollection", features };
}

function featuresForService(result: CorridorRenderCollection, serviceId: string) {
  return result.features.filter((renderFeature) => renderFeature.properties.serviceId === serviceId);
}

function edgeKey(first: Position, second: Position): string {
  const firstKey = JSON.stringify(first);
  const secondKey = JSON.stringify(second);
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
}

function sharedEdgeComponents(input: SegmentFeatureCollection): number {
  const ownersByEdge = new Map<string, Set<string>>();
  const endsByEdge = new Map<string, readonly [string, string]>();
  for (const sourceFeature of input.features) {
    const coordinates = sourceFeature.geometry.coordinates;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const first = coordinates[index];
      const second = coordinates[index + 1];
      if (!first || !second || JSON.stringify(first) === JSON.stringify(second)) continue;
      const key = edgeKey(first, second);
      const owners = ownersByEdge.get(key) ?? new Set<string>();
      owners.add(sourceFeature.properties.serviceId);
      ownersByEdge.set(key, owners);
      const firstKey = JSON.stringify(first);
      const secondKey = JSON.stringify(second);
      endsByEdge.set(key, firstKey < secondKey ? [firstKey, secondKey] : [secondKey, firstKey]);
    }
  }

  const sharedEdges = new Set([...ownersByEdge].filter(([, owners]) => owners.size >= 2).map(([key]) => key));
  const edgesByNode = new Map<string, string[]>();
  for (const key of sharedEdges) {
    for (const node of endsByEdge.get(key) ?? []) {
      const incident = edgesByNode.get(node) ?? [];
      incident.push(key);
      edgesByNode.set(node, incident);
    }
  }

  let components = 0;
  const unseen = new Set(sharedEdges);
  while (unseen.size > 0) {
    components += 1;
    const firstEdge = unseen.values().next().value as string;
    const queue = [firstEdge];
    unseen.delete(firstEdge);
    while (queue.length > 0) {
      const key = queue.pop();
      if (!key) continue;
      for (const node of endsByEdge.get(key) ?? []) {
        for (const neighbor of edgesByNode.get(node) ?? []) {
          if (unseen.delete(neighbor)) queue.push(neighbor);
        }
      }
    }
  }
  return components;
}

function sharedEdgesForServices(
  input: SegmentFeatureCollection,
  firstServiceId: string,
  secondServiceId: string,
): string[] {
  const ownersByEdge = new Map<string, Set<string>>();
  for (const sourceFeature of input.features) {
    const coordinates = sourceFeature.geometry.coordinates;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const first = coordinates[index];
      const second = coordinates[index + 1];
      if (!first || !second || JSON.stringify(first) === JSON.stringify(second)) continue;
      const key = edgeKey(first, second);
      const owners = ownersByEdge.get(key) ?? new Set<string>();
      owners.add(sourceFeature.properties.serviceId);
      ownersByEdge.set(key, owners);
    }
  }
  return [...ownersByEdge]
    .filter(([, owners]) => owners.has(firstServiceId) && owners.has(secondServiceId))
    .map(([key]) => key);
}

function sharedSlotByServiceAndEdge(result: CorridorRenderCollection): Map<string, Map<string, number>> {
  const slots = new Map<string, Map<string, number>>();
  for (const renderFeature of result.features) {
    const serviceId = renderFeature.properties.serviceId;
    const serviceSlots = slots.get(serviceId) ?? new Map<string, number>();
    const coordinates = renderFeature.geometry.coordinates;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const first = coordinates[index];
      const second = coordinates[index + 1];
      if (!first || !second || JSON.stringify(first) === JSON.stringify(second)) continue;
      serviceSlots.set(edgeKey(first, second), renderFeature.properties.corridorSlot);
    }
    slots.set(serviceId, serviceSlots);
  }
  return slots;
}

describe("buildCorridorOffsets", () => {
  it("matches identical and reversed exact edges and keeps a curved run in one oriented fragment", () => {
    const curve: Position[] = [[0, 0], [1, 0.5], [2, 0]];
    const result = buildCorridorOffsets(collection(
      feature("alpha", "curve", curve),
      feature("beta", "curve-reversed", [...curve].reverse()),
    ), "target");

    const alpha = featuresForService(result, "alpha");
    const beta = featuresForService(result, "beta");
    expect(alpha).toHaveLength(1);
    expect(beta).toHaveLength(1);
    expect(alpha[0]?.geometry.coordinates).toEqual(beta[0]?.geometry.coordinates);
    expect(alpha[0]?.geometry.coordinates).toEqual(curve);
    expect(new Set([alpha[0]?.properties.corridorSlot, beta[0]?.properties.corridorSlot]).size).toBe(2);
  });

  it("does not treat duplicate edges from one service as shared owners", () => {
    const result = buildCorridorOffsets(collection(
      feature("alpha", "first", [[0, 0], [1, 0]]),
      feature("alpha", "duplicate", [[1, 0], [0, 0]]),
    ), "target");

    expect(result.features).toHaveLength(2);
    expect(result.features.map((renderFeature) => renderFeature.properties.corridorSlot)).toEqual([0, 0]);
  });

  it("does not match near-parallel edges with different endpoint coordinates", () => {
    const result = buildCorridorOffsets(collection(
      feature("alpha", "north", [[0, 0], [1, 0]]),
      feature("beta", "south", [[0, 0.000001], [1, 0.000001]]),
    ), "target");

    expect(result.features.map((renderFeature) => renderFeature.properties.corridorSlot)).toEqual([0, 0]);
  });

  it("ignores degenerate edges when deciding whether services share track", () => {
    const result = buildCorridorOffsets(collection(
      feature("alpha", "point", [[0, 0], [0, 0]]),
      feature("beta", "same-point", [[0, 0], [0, 0]]),
    ), "target");

    expect(result.features).toHaveLength(2);
    expect(result.features.every((renderFeature) => renderFeature.properties.corridorSlot === 0)).toBe(true);
  });

  it("splits a partly shared feature at shared and unshared transitions", () => {
    const result = buildCorridorOffsets(collection(
      feature("alpha", "long", [[0, 0], [1, 0], [2, 0], [3, 0]]),
      feature("beta", "middle", [[1, 0], [2, 0]]),
    ), "target");

    const alpha = featuresForService(result, "alpha");
    expect(alpha.map((renderFeature) => renderFeature.geometry.coordinates)).toEqual([
      [[0, 0], [1, 0]],
      [[1, 0], [2, 0]],
      [[2, 0], [3, 0]],
    ]);
    expect(alpha[0]?.properties.corridorSlot).toBe(0);
    expect(alpha[1]?.properties.corridorSlot).not.toBe(0);
    expect(alpha[2]?.properties.corridorSlot).toBe(0);
  });

  it("keeps continuing service slots when another service exits and a new one enters", () => {
    const result = buildCorridorOffsets(collection(
      feature("alpha", "through", [[0, 0], [1, 0], [2, 0], [3, 0]]),
      feature("beta", "exit", [[0, 0], [1, 0], [2, 0]]),
      feature("gamma", "entry", [[2, 0], [3, 0]]),
    ), "target");

    const alpha = featuresForService(result, "alpha");
    expect(alpha).toHaveLength(1);
    expect(alpha[0]?.properties.corridorSlot).not.toBe(0);
    expect(featuresForService(result, "beta")[0]?.properties.corridorSlot)
      .not.toBe(alpha[0]?.properties.corridorSlot);
    expect(featuresForService(result, "gamma")[0]?.properties.corridorSlot)
      .not.toBe(alpha[0]?.properties.corridorSlot);
    expect(featuresForService(result, "gamma")[0]?.properties.corridorSlot)
      .toBe(featuresForService(result, "beta")[0]?.properties.corridorSlot);
  });

  it("centres fresh slots and keeps the target service at zero", () => {
    const result = buildCorridorOffsets(collection(
      feature("target", "target", [[0, 0], [1, 0]]),
      feature("alpha", "alpha", [[0, 0], [1, 0]]),
      feature("beta", "beta", [[0, 0], [1, 0]]),
    ), "target");

    const slots = Object.fromEntries(result.features.map((renderFeature) => [
      renderFeature.properties.serviceId,
      renderFeature.properties.corridorSlot,
    ]));
    expect(slots).toEqual({ alpha: -1, beta: 1, target: 0 });
  });

  it("walks a branch deterministically and is independent of feature input order", () => {
    const branch: SegmentFeature[] = [
      feature("alpha", "east", [[0, 0], [1, 0]]),
      feature("alpha", "north", [[0, 0], [0, 1]]),
      feature("alpha", "west", [[0, 0], [-1, 0]]),
      feature("beta", "east", [[1, 0], [0, 0]]),
      feature("beta", "north", [[0, 1], [0, 0]]),
      feature("beta", "west", [[-1, 0], [0, 0]]),
    ];
    const first = buildCorridorOffsets({ type: "FeatureCollection", features: branch }, "target");
    const shuffled = buildCorridorOffsets({ type: "FeatureCollection", features: [...branch].reverse() }, "target");

    expect(first).toEqual(shuffled);
    expect(new Set(first.features.map((renderFeature) => renderFeature.id)).size).toBe(first.features.length);
  });

  it("inherits each branch child's slots from the parent edge and keeps its run direction", () => {
    const result = buildCorridorOffsets(collection(
      feature("a", "parent", [[0, 0], [1, 0]]),
      feature("b", "parent", [[1, 0], [0, 0]]),
      feature("a", "first-branch", [[1, 0], [2, -1]]),
      feature("c", "first-branch", [[2, -1], [1, 0]]),
      feature("b", "second-branch", [[2, 1], [1, 0]]),
      feature("d", "second-branch", [[1, 0], [2, 1]]),
    ), "target");
    const slots = sharedSlotByServiceAndEdge(result);
    const parent = edgeKey([0, 0], [1, 0]);
    const firstBranch = edgeKey([1, 0], [2, -1]);
    const secondBranch = edgeKey([1, 0], [2, 1]);
    const bSlot = slots.get("b")?.get(parent);
    const aSlot = slots.get("a")?.get(parent);

    expect(aSlot).toBe(-0.5);
    expect(bSlot).toBe(0.5);
    expect(slots.get("a")?.get(firstBranch)).toBe(aSlot);
    expect(slots.get("b")?.get(secondBranch)).toBe(bSlot);
    expect(featuresForService(result, "a").find((item) => item.properties.featureId === "a:first-branch")
      ?.geometry.coordinates).toEqual([[1, 0], [2, -1]]);
    expect(featuresForService(result, "b").find((item) => item.properties.featureId === "b:second-branch")
      ?.geometry.coordinates).toEqual([[1, 0], [2, 1]]);
  });

  it("orients an open shared run from an endpoint when the middle vertex sorts first", () => {
    const run: Position[] = [[2, 0], [10, 0], [11, 1]];
    const result = buildCorridorOffsets(collection(
      feature("alpha", "run", run),
      feature("beta", "run-reversed", [...run].reverse()),
    ), "target");
    const alpha = featuresForService(result, "alpha");
    const beta = featuresForService(result, "beta");

    expect(alpha).toHaveLength(1);
    expect(beta).toHaveLength(1);
    expect(alpha[0]?.geometry.coordinates).toEqual(run);
    expect(beta[0]?.geometry.coordinates).toEqual(run);
    expect(alpha[0]?.properties.corridorSlot).not.toBe(0);
    expect(beta[0]?.properties.corridorSlot).not.toBe(0);
    expect(alpha[0]?.properties.corridorSlot).not.toBe(beta[0]?.properties.corridorSlot);
  });

  it("starts an open run at its endpoint even when the middle vertex is numerically smallest", () => {
    const run: Position[] = [[5, 0], [0, 0], [6, 1]];
    const result = buildCorridorOffsets(collection(
      feature("alpha", "run", run),
      feature("beta", "run-reversed", [...run].reverse()),
    ), "target");
    const alpha = featuresForService(result, "alpha");
    const beta = featuresForService(result, "beta");

    expect(alpha).toHaveLength(1);
    expect(beta).toHaveLength(1);
    expect(alpha[0]?.geometry.coordinates).toEqual(run);
    expect(beta[0]?.geometry.coordinates).toEqual(run);
    expect(alpha[0]?.properties.corridorSlot).toBe(-0.5);
    expect(beta[0]?.properties.corridorSlot).toBe(0.5);
  });

  it("gives a service that joins a full corridor its own slot instead of the target's zero", () => {
    const through: Position[] = [[0, 0], [1, 0], [2, 0]];
    const result = buildCorridorOffsets(collection(
      feature("target", "through", through),
      feature("alpha", "through", through),
      feature("beta", "through", through),
      feature("gamma", "through", through),
      feature("delta", "through", through),
      feature("epsilon", "joins", [[1, 0], [2, 0]]),
    ), "target");
    const slotsOnJoinedEdge = result.features
      .filter((item) => item.geometry.coordinates.some(([longitude]) => longitude === 2))
      .map((item) => [item.properties.serviceId, item.properties.corridorSlot] as const);
    const slots = new Map(slotsOnJoinedEdge);

    expect(slots.size).toBe(6);
    expect(slots.get("target")).toBe(0);
    expect(slots.get("epsilon")).not.toBe(0);
    expect(new Set(slots.values()).size).toBe(6);
  });

  it("splits a shared run when the target joins and displaces a continuing service from zero", () => {
    const result = buildCorridorOffsets(collection(
      feature("alpha", "through", [[0, 0], [1, 0], [2, 0], [3, 0]]),
      feature("beta", "through", [[0, 0], [1, 0], [2, 0], [3, 0]]),
      feature("gamma", "leaves", [[0, 0], [1, 0]]),
      feature("target", "joins", [[1, 0], [2, 0], [3, 0]]),
    ), "target");
    const alpha = featuresForService(result, "alpha");
    const target = featuresForService(result, "target");

    expect(alpha.map((item) => item.geometry.coordinates)).toEqual([
      [[0, 0], [1, 0]],
      [[1, 0], [2, 0], [3, 0]],
    ]);
    expect(alpha.map((item) => item.properties.corridorSlot)).toEqual([0, 1]);
    expect(target).toHaveLength(1);
    expect(target[0]?.properties.corridorSlot).toBe(0);
  });

  it("keeps unshared and target fragments at zero and preserves cross-service feature references", () => {
    const primitiveFeatureId = "canonical-owner:primitive-7";
    const input = collection(
      feature("owner", "partial", [[0, 0], [1, 0], [2, 0], [3, 0]], primitiveFeatureId),
      feature("other", "shared", [[1, 0], [2, 0]]),
      feature("target", "target", [[1, 0], [2, 0]]),
    );
    const inputBeforeDerivation = structuredClone(input);
    const result = buildCorridorOffsets(input, "target");
    const primitiveReferences = result.features.filter(
      (renderFeature) => renderFeature.properties.featureId === primitiveFeatureId,
    );

    expect(primitiveReferences).toHaveLength(3);
    expect(primitiveReferences.map((renderFeature) => renderFeature.properties.corridorSlot)[0]).toBe(0);
    expect(primitiveReferences.map((renderFeature) => renderFeature.properties.corridorSlot)[1]).not.toBe(0);
    expect(primitiveReferences.map((renderFeature) => renderFeature.properties.corridorSlot)[2]).toBe(0);
    expect(featuresForService(result, "target").every((renderFeature) => renderFeature.properties.corridorSlot === 0)).toBe(true);
    expect(new Set(result.features.map((renderFeature) => renderFeature.id)).size).toBe(result.features.length);
    expect(input).toEqual(inputBeforeDerivation);
  });

  it("derives the real segment collection within the feature-count budget and separates Tokaido/Yokosuka", () => {
    const realGeometry = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/data/segments.geojson"), "utf8"),
    ) as SegmentFeatureCollection;
    const derived = buildCorridorOffsets(realGeometry, "jr-yamanote");
    const sharedRuns = sharedEdgeComponents(realGeometry);
    const slotsByEdge = sharedSlotByServiceAndEdge(derived);
    const tokaidoSlots = slotsByEdge.get("jr-tokaido");
    const yokosukaSlots = slotsByEdge.get("jr-yokosuka");
    const commonEdges = sharedEdgesForServices(realGeometry, "jr-tokaido", "jr-yokosuka");

    expect(derived.features.length).toBeLessThanOrEqual(realGeometry.features.length * 2);
    expect(commonEdges.length).toBeGreaterThan(0);
    for (const edge of commonEdges) {
      const tokaidoSlot = tokaidoSlots?.get(edge);
      const yokosukaSlot = yokosukaSlots?.get(edge);
      expect(tokaidoSlot).toBeDefined();
      expect(yokosukaSlot).toBeDefined();
      expect(tokaidoSlot).not.toBe(0);
      expect(yokosukaSlot).not.toBe(0);
      expect(tokaidoSlot).not.toBe(yokosukaSlot);
    }
    console.log(JSON.stringify({
      canonicalFeatures: realGeometry.features.length,
      derivedFeatures: derived.features.length,
      sharedRuns,
      tokaidoYokosukaSharedEdges: commonEdges.length,
    }));
  });
});
