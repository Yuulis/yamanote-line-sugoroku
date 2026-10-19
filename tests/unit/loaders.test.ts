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
  validUiPresentation,
} from "./fixtures/railway";

const BASE = "/data/";

const allFiles: Record<string, unknown> = {
  "/data/stations.json": [validStation],
  "/data/services.json": { lines: [{ id: validService.id, name: validService.name, color: validService.color }], services: [validService] },
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

describe("legacy v2 bundle errors", () => {
  it("explains both the old manifest version and the services array", async () => {
    const data = await loadRailwayData(BASE, async (url) => {
      if (url.endsWith("manifest.json")) return { ...validManifest, schemaVersion: 2 };
      if (url.endsWith("services.json")) return [validService];
      return allFiles[url];
    });
    expect(data.manifest).toEqual({ ok: false, file: "manifest.json", reason: "unsupported data schemaVersion; expected 3" });
    expect(data.services).toEqual({ ok: false, file: "services.json", reason: "unsupported v2 services array; expected v3 {lines, services}" });
  });
});

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

  it("loads optional presentation metadata and keeps old bundles valid", async () => {
    const oldBundle = await loadRailwayData(BASE, fetcherFor(allFiles));
    const newBundle = await loadRailwayData(BASE, fetcherFor({
      ...allFiles,
      "/data/manifest.json": { ...validManifest, uiPresentation: validUiPresentation },
    }));
    expect(oldBundle.manifest.ok).toBe(true);
    expect(newBundle.manifest).toMatchObject({ ok: true, value: { uiPresentation: validUiPresentation } });
    expect(listFailures(newBundle)).toEqual([]);
  });

  it("rejects presentation references to unknown services", async () => {
    const uiPresentation = {
      ...validUiPresentation,
      lineGroups: [{ ...validUiPresentation.lineGroups[0], serviceIds: ["unknown-service"] }],
    };
    const data = await loadRailwayData(BASE, fetcherFor({
      ...allFiles,
      "/data/manifest.json": { ...validManifest, uiPresentation },
    }));
    expect(data.manifest).toEqual({
      ok: false,
      file: "manifest.json",
      reason: "invalid uiPresentation references",
    });
  });

  it("rejects a service-stop name for a station the service does not serve", async () => {
    const uiPresentation = {
      ...validUiPresentation,
      serviceStopNames: [{ serviceId: "jr-yamanote", stationId: "unknown-station", name: "不明駅" }],
    };
    const data = await loadRailwayData(BASE, fetcherFor({
      ...allFiles,
      "/data/manifest.json": { ...validManifest, uiPresentation },
    }));
    expect(data.manifest.ok).toBe(false);
  });

  it("rejects aliases altered to duplicate the canonical station name", async () => {
    const uiPresentation = {
      ...validUiPresentation,
      stations: [{ id: "st-tokyo", aliases: ["東京"] }],
    };
    const data = await loadRailwayData(BASE, fetcherFor({
      ...allFiles,
      "/data/manifest.json": { ...validManifest, uiPresentation },
    }));
    expect(data.manifest).toEqual({
      ok: false,
      file: "manifest.json",
      reason: "invalid uiPresentation references",
    });
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
