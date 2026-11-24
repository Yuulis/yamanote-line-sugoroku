import type { Map as MapLibreMap } from "maplibre-gl";
import type { CameraPadding } from "./camera";

/**
 * Observation point for the Playwright suite (tests/e2e). The map is drawn on
 * a canvas, so the marker position and the completed-segment filter cannot be
 * read from the DOM; the E2E build publishes the live map on
 * `window.__sugorokuE2E.map` instead.
 *
 * Absent from production: only `vite build --mode e2e` (the Playwright
 * webServer) sets `import.meta.env.MODE` to "e2e". Vite replaces MODE with a
 * string literal at build time, so in every other build the condition below
 * is the constant `false` and the minifier drops the body, key included.
 */
const E2E_HOOK_ENABLED = import.meta.env.MODE === "e2e";

interface SugorokuE2EHook {
  readonly [key: string]: unknown;
  readonly map?: MapLibreMap | null;
  readonly clearFitPadding?: CameraPadding | null;
}

function updateE2EHook(values: Partial<SugorokuE2EHook>): void {
  if (!E2E_HOOK_ENABLED) return;
  const windowWithHook = window as unknown as { __sugorokuE2E?: SugorokuE2EHook };
  windowWithHook.__sugorokuE2E = { ...windowWithHook.__sugorokuE2E, ...values };
}

/** Publish the map once its layers exist; pass null when it is removed. */
export function exposeMapForE2E(map: MapLibreMap | null): void {
  updateE2EHook({ map, clearFitPadding: null });
}

/** Expose the actual padding passed to the live map's latest clear-route fit. */
export function exposeClearFitPaddingForE2E(padding: CameraPadding | null): void {
  updateE2EHook({ clearFitPadding: padding === null ? null : { ...padding } });
}
