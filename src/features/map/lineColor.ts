import type { ExpressionSpecification } from "maplibre-gl";
import type { LineMetadata, ServicePattern } from "../../types/network";
import { FALLBACK_LINE_COLOR } from "./mapConfig";

/** Paint expression colouring each segment by its service's colour. */
export function buildLineColorExpression(
  services: readonly ServicePattern[],
): ExpressionSpecification {
  // The tuple length is dynamic, which the library types cannot express.
  if (services.length === 0) return ["literal", FALLBACK_LINE_COLOR];
  const cases = services.flatMap((service) => [service.id, service.color]);
  return [
    "match",
    ["get", "serviceId"],
    ...cases,
    FALLBACK_LINE_COLOR,
  ] as unknown as ExpressionSpecification;
}

/** Primitive track colour comes from line metadata, independently of its owner. */
export function buildTrackColorExpression(lines: readonly LineMetadata[]): ExpressionSpecification {
  if (lines.length === 0) return ["literal", FALLBACK_LINE_COLOR];
  return ["match", ["get", "lineId"], ...lines.flatMap((line) => [line.id, line.color]), FALLBACK_LINE_COLOR] as unknown as ExpressionSpecification;
}
