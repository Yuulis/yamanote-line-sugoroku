import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { MapPresentationIndex } from "./mapPresentation";
import { LAYER_IDS } from "./mapConfig";
import { visiblePrimitiveFeatureIds } from "./mapPresentation";

/** Filter a background line layer by primitive feature ids, or clear it for all lines. */
export function primitiveFeatureFilter(
  featureIds: readonly string[] | null,
): FilterSpecification | null {
  if (featureIds === null) return null;
  return ["in", ["get", "featureId"], ["literal", [...featureIds]]];
}

/** Keep the target excluded from the ordinary service overlay while applying visibility. */
export function backgroundServiceFilter(
  featureIds: readonly string[] | null,
  targetServiceId: string,
): FilterSpecification {
  const targetFilter: FilterSpecification = ["!=", ["get", "serviceId"], targetServiceId];
  const primitiveFilter = primitiveFeatureFilter(featureIds);
  return primitiveFilter === null
    ? targetFilter
    : ["all", targetFilter, primitiveFilter] as unknown as FilterSpecification;
}

/** Apply UI visibility only to the two background layers; progress/highlight layers remain independent. */
export function updateLineGroupVisibility(
  map: MapLibreMap,
  index: MapPresentationIndex,
  selectedGroupIds: ReadonlySet<string> | null,
  targetServiceId: string,
): void {
  const featureIds = visiblePrimitiveFeatureIds(index, selectedGroupIds);
  if (map.getLayer(LAYER_IDS.base)) {
    map.setFilter(LAYER_IDS.base, primitiveFeatureFilter(featureIds));
  }
  if (map.getLayer(LAYER_IDS.services)) {
    map.setFilter(LAYER_IDS.services, backgroundServiceFilter(featureIds, targetServiceId));
  }
}
