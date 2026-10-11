import type { Map as MapLibreMap } from "maplibre-gl";

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

/** Publish the map once its layers exist; pass null when it is removed. */
export function exposeMapForE2E(map: MapLibreMap | null): void {
  if (!E2E_HOOK_ENABLED) return;
  (window as unknown as { __sugorokuE2E?: { map: MapLibreMap | null } }).__sugorokuE2E = {
    map,
  };
}
