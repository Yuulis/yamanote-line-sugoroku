import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Vite emits content-hashed bundles here (its default `build.assetsDir`). */
const HASHED_ASSETS_SOURCE = "/assets/(.*)";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const config = JSON.parse(readFileSync(`${REPO_ROOT}vercel.json`, "utf8")) as {
  headers?: HeaderRule[];
  [key: string]: unknown;
};

describe("vercel.json delivery headers", () => {
  it("caches only the content-hashed bundles for a year", () => {
    expect(config.headers).toEqual([
      { source: HASHED_ASSETS_SOURCE, headers: [{ key: "Cache-Control", value: IMMUTABLE_CACHE }] },
    ]);
  });

  it("leaves build, routing and every other path on Vercel defaults", () => {
    // HTML, /data/* and fixed-name icons must keep revalidating so a deploy
    // reaches players on their next visit.
    expect(Object.keys(config).sort()).toEqual(["$schema", "headers"]);
  });

  it("keeps Vite's default hashed assets directory", () => {
    const viteConfig = readFileSync(`${REPO_ROOT}vite.config.ts`, "utf8");
    expect(viteConfig).not.toMatch(/assetsDir|assetFileNames|entryFileNames|chunkFileNames/);
  });
});
