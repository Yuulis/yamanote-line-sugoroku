import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";

export const BASEMAP_TEXT_OPACITY_FACTOR = 0.75;
export const BASEMAP_ICON_OPACITY_FACTOR = 0.65;

export type BasemapOpacityProperty = "text-opacity" | "icon-opacity";
export type BasemapOpacityValue = number | ExpressionSpecification;

export interface BasemapOpacityPatch {
  readonly layerId: string;
  readonly property: BasemapOpacityProperty;
  /** The value from the loaded basemap. `undefined` restores the style default. */
  readonly originalValue: BasemapOpacityValue | undefined;
  readonly value: BasemapOpacityValue;
}

export interface BasemapOpacityFactors {
  readonly text: number;
  readonly icon: number;
}

interface ScaledValue {
  readonly value: BasemapOpacityValue;
}

type ZoomScaleResult =
  | { readonly kind: "zoom"; readonly value: BasemapOpacityValue }
  | { readonly kind: "data" }
  | { readonly kind: "unsafe" };

const OPACITY_PROPERTIES: readonly {
  readonly property: BasemapOpacityProperty;
  readonly factorKey: keyof BasemapOpacityFactors;
}[] = [
  { property: "text-opacity", factorKey: "text" },
  { property: "icon-opacity", factorKey: "icon" },
];

function isOpacityNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function scaleNumber(value: number, factor: number): number {
  return Number((value * factor).toFixed(12));
}

function isExpression(value: unknown): value is ExpressionSpecification {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "string";
}

function containsZoom(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 1 && value[0] === "zoom") return true;
  return value.some(containsZoom);
}

function isZoomInput(value: unknown, zoomVariables: ReadonlySet<string>): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 1 && value[0] === "zoom") return true;
  return value.length === 2 && value[0] === "var" && typeof value[1] === "string" && zoomVariables.has(value[1]);
}

function scaleExpressionOutput(value: unknown, factor: number): BasemapOpacityValue | null {
  if (isOpacityNumber(value)) return scaleNumber(value, factor);
  if (!isExpression(value) || containsZoom(value)) return null;
  return ["*", value, factor] as ExpressionSpecification;
}

function scaleZoomExpression(
  expression: unknown,
  factor: number,
  inheritedZoomVariables: ReadonlySet<string> = new Set(),
): ZoomScaleResult {
  if (!Array.isArray(expression) || typeof expression[0] !== "string") return { kind: "unsafe" };
  const operator = expression[0];

  if (operator === "let") {
    if (expression.length < 4 || expression.length % 2 !== 0) return { kind: "unsafe" };
    const zoomVariables = new Set(inheritedZoomVariables);
    for (let index = 1; index < expression.length - 1; index += 2) {
      const name = expression[index];
      const boundValue = expression[index + 1];
      if (typeof name !== "string") return { kind: "unsafe" };
      if (isZoomInput(boundValue, zoomVariables)) zoomVariables.add(name);
    }

    const bodyIndex = expression.length - 1;
    const body = scaleZoomExpression(expression[bodyIndex], factor, zoomVariables);
    if (body.kind === "zoom") {
      const scaled = [...expression];
      scaled[bodyIndex] = body.value;
      return { kind: "zoom", value: scaled as ExpressionSpecification };
    }
    return containsZoom(expression[bodyIndex]) ? { kind: "unsafe" } : { kind: "data" };
  }

  const isStep = operator === "step";
  const isInterpolate = operator === "interpolate";
  if (!isStep && !isInterpolate) return containsZoom(expression) ? { kind: "unsafe" } : { kind: "data" };

  const inputIndex = isStep ? 1 : 2;
  const firstOutputIndex = isStep ? 2 : 4;
  if (expression.length <= firstOutputIndex || !isZoomInput(expression[inputIndex], inheritedZoomVariables)) {
    return containsZoom(expression) ? { kind: "unsafe" } : { kind: "data" };
  }
  if ((expression.length - firstOutputIndex) % 2 !== 1) return { kind: "unsafe" };

  const scaled = [...expression];
  for (let index = firstOutputIndex; index < expression.length; index += 2) {
    const output = scaleExpressionOutput(expression[index], factor);
    if (output === null) return { kind: "unsafe" };
    scaled[index] = output;
  }
  return { kind: "zoom", value: scaled as ExpressionSpecification };
}

function scaleOpacity(value: unknown, factor: number): ScaledValue | null {
  const baseline = value === undefined ? 1 : value;
  if (isOpacityNumber(baseline)) return { value: scaleNumber(baseline, factor) };
  if (!isExpression(baseline)) return null;

  const zoomResult = scaleZoomExpression(baseline, factor);
  if (zoomResult.kind === "zoom") return { value: zoomResult.value };
  if (zoomResult.kind === "unsafe") return null;
  return { value: ["*", baseline, factor] as ExpressionSpecification };
}

/** Build focus values from the opacity values on one freshly loaded basemap style. */
export function buildBasemapLabelPatches(
  layers: readonly LayerSpecification[],
  factors: BasemapOpacityFactors,
): readonly BasemapOpacityPatch[] {
  const patches: BasemapOpacityPatch[] = [];
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const paint = (layer as { readonly paint?: Readonly<Record<string, unknown>> }).paint;

    for (const { property, factorKey } of OPACITY_PROPERTIES) {
      const originalValue = paint?.[property];
      const scaled = scaleOpacity(originalValue, factors[factorKey]);
      if (!scaled) continue;
      patches.push({ layerId: layer.id, property, originalValue: originalValue as BasemapOpacityValue | undefined, value: scaled.value });
    }
  }
  return patches;
}

/** Apply or restore basemap opacity values, ignoring style layers that no longer exist. */
export function applyBasemapLabelFocus(
  map: MapLibreMap,
  patches: readonly BasemapOpacityPatch[],
  focused: boolean,
): void {
  for (const patch of patches) {
    if (!map.getLayer(patch.layerId)) continue;
    const value = focused ? patch.value : patch.originalValue;
    map.setPaintProperty(patch.layerId, patch.property, value as never);
  }
}
