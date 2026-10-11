import type { BrowserContext, Route } from "@playwright/test";

// Hermetic stand-in for the background map (src/features/map/mapConfig.ts
// MAP_STYLE_URL). The app's own railway layers come from public/data/ and are
// served by `vite preview`; every other external request is aborted.

export const MAP_HOST = "https://tiles.openfreemap.org";
const STYLE_PATH = "/styles/";
const TILE_PATH = "/e2e-tiles/";
const GLYPH_PATH = "/fonts/";

const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

/**
 * Background + one vector source, so tile requests really happen (and can be
 * failed). Glyphs point at the stub host: the station label layer needs them.
 */
const STUB_STYLE = {
  version: 8,
  name: "e2e-stub",
  glyphs: `${MAP_HOST}${GLYPH_PATH}{fontstack}/{range}.pbf`,
  sources: {
    "e2e-base": {
      type: "vector",
      tiles: [`${MAP_HOST}${TILE_PATH}{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 14,
      // Mirrors the credit OpenFreeMap's TileJSON carries for the real style.
      attribution: OPENFREEMAP_ATTRIBUTION,
    },
  },
  layers: [
    { id: "e2e-background", type: "background", paint: { "background-color": "#eef2e6" } },
    {
      id: "e2e-water",
      type: "fill",
      source: "e2e-base",
      "source-layer": "water",
      paint: { "fill-color": "#a8c8e8" },
    },
  ],
};

export interface MapStubCounts {
  style: number;
  tiles: number;
  glyphs: number;
  /** External requests outside the stub host (always aborted). */
  blocked: string[];
}

/** Switches a test flips to simulate an unreachable map service. */
export interface MapStub {
  failStyle: boolean;
  failTiles: boolean;
  readonly counts: MapStubCounts;
}

function isLocal(url: string, baseURL: string): boolean {
  return url.startsWith(baseURL) || url.startsWith("data:") || url.startsWith("blob:");
}

async function fulfilStub(route: Route, stub: MapStub): Promise<void> {
  const { pathname } = new URL(route.request().url());
  if (pathname.startsWith(STYLE_PATH)) {
    stub.counts.style += 1;
    if (stub.failStyle) return route.abort("connectionrefused");
    return route.fulfill({ json: STUB_STYLE });
  }
  if (pathname.startsWith(TILE_PATH)) {
    stub.counts.tiles += 1;
    if (stub.failTiles) return route.abort("connectionrefused");
    // An empty body is a valid (empty) vector tile.
    return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: "" });
  }
  if (pathname.startsWith(GLYPH_PATH)) {
    stub.counts.glyphs += 1;
    return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: "" });
  }
  stub.counts.blocked.push(route.request().url());
  return route.abort("blockedbyclient");
}

/** Install the routes on the whole context (pages and their workers). */
export async function installMapStub(context: BrowserContext, baseURL: string): Promise<MapStub> {
  const stub: MapStub = {
    failStyle: false,
    failTiles: false,
    counts: { style: 0, tiles: 0, glyphs: 0, blocked: [] },
  };
  // Registered first, so it runs last: everything not handled below.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (isLocal(url, baseURL)) return route.fallback();
    stub.counts.blocked.push(url);
    return route.abort("blockedbyclient");
  });
  await context.route(`${MAP_HOST}/**`, (route) => fulfilStub(route, stub));
  return stub;
}
