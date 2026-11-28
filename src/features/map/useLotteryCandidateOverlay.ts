import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { LAYER_IDS } from "./mapConfig";
import { updateLotteryCandidates } from "./railwayLayers";

interface AppliedCandidateFilter {
  readonly map: MapLibreMap;
  readonly layersRevision: number;
  readonly featureIds: readonly string[];
}

/** Resolve service references to the deduplicated primitive geometry used by the map source. */
export function resolveLotteryCandidateFeatureIds(
  serviceIds: readonly string[],
  serviceGeometry: ReadonlyMap<string, readonly string[]>,
): string[] {
  const featureIds = new Set<string>();
  for (const serviceId of serviceIds) {
    for (const featureId of serviceGeometry.get(serviceId) ?? []) featureIds.add(featureId);
  }
  return [...featureIds];
}

function sameFeatureIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((featureId) => leftSet.has(featureId));
}

/** Apply lottery candidates only when their resolved feature set or map layers change. */
export function useLotteryCandidateOverlay(
  map: MapLibreMap | null,
  layersRevision: number,
  serviceIds: readonly string[] | undefined,
  serviceGeometry: ReadonlyMap<string, readonly string[]>,
): void {
  const appliedFilter = useRef<AppliedCandidateFilter | null>(null);

  useEffect(() => {
    if (!map) {
      appliedFilter.current = null;
      return;
    }

    const featureIds = resolveLotteryCandidateFeatureIds(serviceIds ?? [], serviceGeometry);
    if (!map.getLayer(LAYER_IDS.lotteryCandidates)) return;
    const previous = appliedFilter.current;
    if (!previous && featureIds.length === 0) {
      // addRailwayLayers gives the new layer this exact empty filter already.
      appliedFilter.current = { map, layersRevision, featureIds };
      return;
    }
    if (previous?.map === map && previous.layersRevision === layersRevision
      && sameFeatureIdSet(previous.featureIds, featureIds)) return;

    updateLotteryCandidates(map, featureIds);
    appliedFilter.current = { map, layersRevision, featureIds };
  }, [map, layersRevision, serviceIds, serviceGeometry]);
}
