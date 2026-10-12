import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import type { Position } from "../../types/data";

function isCompleted(featureIds: readonly string[]): ExpressionSpecification {
  return ["in", ["get", "featureId"], ["literal", [...featureIds]]];
}

/** Filter matching segment features whose `segmentId` is in `segmentIds`. */
export function completedSegmentFilter(
  featureIds: readonly string[],
  targetServiceId = "jr-yamanote",
): FilterSpecification {
  return ["all", ["==", ["get", "serviceId"], targetServiceId], isCompleted(featureIds)];
}

/** Filter matching segment features not yet completed. */
export function pendingSegmentFilter(
  featureIds: readonly string[],
  targetServiceId = "jr-yamanote",
): FilterSpecification {
  return ["all", ["==", ["get", "serviceId"], targetServiceId], ["!", isCompleted(featureIds)]];
}

export interface CurrentPositionCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, never>;
    geometry: { type: "Point"; coordinates: Position };
  }[];
}

/** A single-point collection for the player marker (empty when unknown). */
export function currentPositionCollection(
  position: Position | null,
): CurrentPositionCollection {
  const features = position
    ? [
        {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: position },
        },
      ]
    : [];
  return { type: "FeatureCollection", features };
}
