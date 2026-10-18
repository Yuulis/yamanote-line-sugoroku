import type { ExpressionSpecification } from "maplibre-gl";
import type { LineMetadata, ServicePattern } from "../../types/network";
import type { PresentationResolver } from "../game/presentationResolver";
import { FALLBACK_LINE_COLOR } from "./mapConfig";

/** Paint expression colouring each segment by its service's colour. */
export function buildLineColorExpression(
  services: readonly ServicePattern[],
  presentation?: Pick<PresentationResolver, "lineGroupColor">,
): ExpressionSpecification {
  // The tuple length is dynamic, which the library types cannot express.
  if (services.length === 0) return ["literal", FALLBACK_LINE_COLOR];
  const cases = services.flatMap((service) => [
    service.id,
    presentation?.lineGroupColor(service.id) ?? service.color,
  ]);
  return [
    "match",
    ["get", "serviceId"],
    ...cases,
    FALLBACK_LINE_COLOR,
  ] as unknown as ExpressionSpecification;
}

/** Primitive track colour comes from line metadata, independently of its owner. */
export function buildTrackColorExpression(
  lines: readonly LineMetadata[],
  services?: readonly ServicePattern[],
  presentation?: Pick<PresentationResolver, "lineGroupColor">,
): ExpressionSpecification {
  const hasPresentationColors = services?.some(
    (service) => presentation?.lineGroupColor(service.id) !== undefined,
  ) ?? false;
  if (services && services.length > 0 && hasPresentationColors) {
    return [
      "match",
      ["get", "serviceId"],
      ...services.flatMap((service) => [
        service.id,
        presentation?.lineGroupColor(service.id) ?? service.color,
      ]),
      FALLBACK_LINE_COLOR,
    ] as unknown as ExpressionSpecification;
  }
  if (lines.length === 0) return ["literal", FALLBACK_LINE_COLOR];
  return ["match", ["get", "lineId"], ...lines.flatMap((line) => [line.id, line.color]), FALLBACK_LINE_COLOR] as unknown as ExpressionSpecification;
}
