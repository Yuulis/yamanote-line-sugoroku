import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Emitted into dist/; the title screen links to it by this name. */
const THIRD_PARTY_LICENSES_FILE = "third-party-licenses.txt";
const PACKAGE_JSON = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string };
function resolveCommit(): string {
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelCommit) return vercelCommit.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim().slice(0, 7);
  } catch {
    return "dev";
  }
}

const TILE_PRECONNECT_PATTERN = /\s*<link rel="preconnect" href="https:\/\/tiles\.openfreemap\.org"[^>]*>/;

/**
 * E2E builds stub the background map and block outside hosts, so the tile
 * preconnect in index.html can only fail there (WebKit logs it as a console
 * error). Production and dev keep it.
 */
function dropTilePreconnectInE2E(mode: string): Plugin {
  return {
    name: "drop-tile-preconnect-in-e2e",
    transformIndexHtml(html) {
      if (mode !== "e2e") return html;
      if (!TILE_PRECONNECT_PATTERN.test(html)) {
        throw new Error("index.html tile preconnect not found; update TILE_PRECONNECT_PATTERN");
      }
      return html.replace(TILE_PRECONNECT_PATTERN, "");
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), dropTilePreconnectInE2E(mode)],
  define: {
    __APP_VERSION__: JSON.stringify(PACKAGE_JSON.version),
    __APP_COMMIT__: JSON.stringify(resolveCommit()),
  },
  build: {
    // Reproduces the licences of bundled third-party code (MapLibre, React, ...)
    // next to the binary; linked from the title-screen credits.
    license: { fileName: THIRD_PARTY_LICENSES_FILE },
  },
  worker: {
    // The maplibre-gl worker is an ES module (see src/features/map/maplibreWorker.ts).
    format: "es",
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
}));
