import { describe, expect, it } from "vitest";
import {
  listFailures,
  loadRailwayData,
  validateData,
  type JsonFetcher,
} from "../../src/data/loaders";
import { isStationList } from "../../src/data/guards";
import {
  validFeatureCollection,
  validManifest,
  validSegment,
  validService,
  validStation,
} from "./fixtures/railway";

const BASE = "/data/";

const allFiles: Record<string, unknown> = {
  "/data/stations.json": [validStation],
  "/data/services.json": [validService],
  "/data/segments.json": [validSegment],
  "/data/segments.geojson": validFeatureCollection,
  "/data/manifest.json": validManifest,
};

function fetcherFor(files: Record<string, unknown>): JsonFetcher {
  return async (url) => {
    if (!(url in files)) throw new Error("HTTP 404");
    return files[url];
  };
}

describe("validateData", () => {
  it("returns ok for valid input", () => {
    const result = validateData("stations.json", [validStation], isStationList);
    expect(result).toEqual({ ok: true, value: [validStation] });
  });

  it("returns a failure naming the file for invalid input", () => {
    const result = validateData("stations.json", [], isStationList);
    expect(result).toEqual({
      ok: false,
      file: "stations.json",
      reason: "invalid shape",
    });
  });
});

describe("loadRailwayData", () => {
  it("loads all files when every file is valid", async () => {
    const data = await loadRailwayData(BASE, fetcherFor(allFiles));
    expect(listFailures(data)).toEqual([]);
  });

  it("reports a missing file without failing the others", async () => {
    const { "/data/services.json": _omitted, ...rest } = allFiles;
    const data = await loadRailwayData(BASE, fetcherFor(rest));
    expect(listFailures(data)).toEqual([
      { file: "services.json", reason: "HTTP 404" },
    ]);
    expect(data.stations.ok).toBe(true);
  });

  it("reports a file that fails validation", async () => {
    const files = { ...allFiles, "/data/manifest.json": { dataVersion: "1" } };
    const data = await loadRailwayData(BASE, fetcherFor(files));
    expect(listFailures(data).map((f) => f.file)).toEqual(["manifest.json"]);
  });

  it("reports every file when the fetcher always rejects", async () => {
    const data = await loadRailwayData(BASE, fetcherFor({}));
    expect(listFailures(data)).toHaveLength(5);
  });
});
