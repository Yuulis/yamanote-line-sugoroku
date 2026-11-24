import type { RouteImageInput, RouteImageState } from "./routeImage";

export interface RouteImageProbeOutput {
  readonly blob: Blob;
  readonly colors: readonly string[];
  readonly bounds: RouteImageInput["route"]["bounds"];
}

/** Read the prepared PNG for the currently published clear; its bytes came from the product exporter. */
export function readRouteImageProbeOutput(
  input: RouteImageInput | null,
  state: RouteImageState,
): RouteImageProbeOutput {
  if (!input || state.kind !== "ready") throw new Error("The pinned clear route image is not ready");
  return {
    blob: state.image.blob,
    colors: [...new Set(input.route.legs.map((leg) => leg.color))],
    bounds: input.route.bounds,
  };
}
