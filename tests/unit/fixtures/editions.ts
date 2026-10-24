import { EDITIONS, saveKeyForEdition } from "../../../src/features/editions/registry";
import type { Edition, EditionRegistry } from "../../../src/features/editions/types";
import { M_LOOP, multiConfig, multiServiceInput } from "./multiService";
import type { RailwayData } from "../../../src/data/loaders";

const base = EDITIONS[0]!;

export const FIXTURE_EDITION_A: Edition = {
  ...base,
  id: "fixture-a",
  dataBaseUrl: "/fixture-a/",
  config: multiConfig(),
  expectedStationCounts: { [M_LOOP]: 6 },
  saveKey: saveKeyForEdition("fixture-a"),
  display: { ...base.display, title: "Fixture A", subtitle: "試験版A", documentTitle: "Fixture A", logoUrl: undefined },
};

export const FIXTURE_EDITION_B: Edition = {
  ...FIXTURE_EDITION_A,
  id: "fixture-b",
  dataBaseUrl: "/fixture-b/",
  config: { ...multiConfig(), rulesetVersion: "test-multi-2", startStationId: "a" },
  saveKey: saveKeyForEdition("fixture-b"),
  display: { ...base.display, title: "Fixture B", subtitle: "試験版B", documentTitle: "Fixture B", logoUrl: undefined },
};

export const FIXTURE_EDITIONS: EditionRegistry = [FIXTURE_EDITION_A, FIXTURE_EDITION_B];

export function fixtureRailwayData(dataVersion: string): RailwayData {
  const input = multiServiceInput();
  return {
    stations: { ok: true, value: [...input.stations] },
    services: {
      ok: true,
      value: {
        lines: input.services.map((service) => ({ id: service.id, name: service.name, color: service.color })),
        services: [...input.services],
      },
    },
    segments: { ok: true, value: [...input.segments] },
    geometry: { ok: false, file: "segments.geojson", reason: "fixture omits map geometry" },
    manifest: {
      ok: true,
      value: {
        schemaVersion: 3,
        dataVersion,
        updatedAt: "2026-01-01",
        source: {
          name: "fixture", dataset: "fixture", year: 2026, baseDate: "2026-01-01",
          url: "https://example.test", license: "CC BY 4.0", attribution: "fixture",
        },
      },
    },
  };
}

export function fixtureFileResponses(dataVersion: string): Record<string, unknown> {
  const data = fixtureRailwayData(dataVersion);
  return {
    "stations.json": data.stations.ok ? data.stations.value : null,
    "services.json": data.services.ok ? data.services.value : null,
    "segments.json": data.segments.ok ? data.segments.value : null,
    "segments.geojson": null,
    "manifest.json": data.manifest.ok ? data.manifest.value : null,
  };
}
