import type { Segment } from "../../types/network";

/** Built once per bundle: composed services can share primitives with several owners. */
export function indexServiceGeometry(segments: readonly Segment[]): ReadonlyMap<string, readonly string[]> {
  const features = new Map<string, Set<string>>();
  for (const segment of segments) {
    const ids = features.get(segment.serviceId) ?? new Set<string>();
    for (const id of segment.geometryFeatureIds) ids.add(id);
    features.set(segment.serviceId, ids);
  }
  return new Map([...features].map(([id, ids]) => [id, [...ids]]));
}
