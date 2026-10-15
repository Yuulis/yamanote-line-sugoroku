import type { Manifest, SegmentFeatureCollection } from "../types/data";
import type { Segment, ServicesData, Station } from "../types/network";
import {
  isManifest,
  isSegmentFeatureCollection,
  isSegmentList,
  isServicesData,
  isStationList,
} from "./guards";

export const DATA_FILES = {
  stations: "stations.json",
  services: "services.json",
  segments: "segments.json",
  geometry: "segments.geojson",
  manifest: "manifest.json",
} as const;

export type DataFileName = (typeof DATA_FILES)[keyof typeof DATA_FILES];

export type LoadResult<T> =
  | { ok: true; value: T }
  | { ok: false; file: DataFileName; reason: string };

export type JsonFetcher = (url: string) => Promise<unknown>;

export interface RailwayData {
  stations: LoadResult<Station[]>;
  services: LoadResult<ServicesData>;
  segments: LoadResult<Segment[]>;
  geometry: LoadResult<SegmentFeatureCollection>;
  manifest: LoadResult<Manifest>;
}

/** Parse already-fetched JSON; pure, never throws. */
export function validateData<T>(
  file: DataFileName,
  json: unknown,
  guard: (value: unknown) => value is T,
): LoadResult<T> {
  if (guard(json)) return { ok: true, value: json };
  const reason = file === DATA_FILES.manifest && typeof json === "object" && json !== null && "schemaVersion" in json && json.schemaVersion !== 3
    ? "unsupported data schemaVersion; expected 3"
    : file === DATA_FILES.services && Array.isArray(json) ? "unsupported v2 services array; expected v3 {lines, services}" : "invalid shape";
  return { ok: false, file, reason };
}

export const defaultJsonFetcher: JsonFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

async function loadFile<T>(
  baseUrl: string,
  file: DataFileName,
  guard: (value: unknown) => value is T,
  fetchJson: JsonFetcher,
): Promise<LoadResult<T>> {
  try {
    const json = await fetchJson(`${baseUrl}${file}`);
    return validateData(file, json, guard);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "fetch failed";
    return { ok: false, file, reason };
  }
}

/** Load every data file independently so one failure does not block the rest. */
export async function loadRailwayData(
  baseUrl: string,
  fetchJson: JsonFetcher = defaultJsonFetcher,
): Promise<RailwayData> {
  const [stations, services, segments, geometry, manifest] = await Promise.all([
    loadFile(baseUrl, DATA_FILES.stations, isStationList, fetchJson),
    loadFile(baseUrl, DATA_FILES.services, isServicesData, fetchJson),
    loadFile(baseUrl, DATA_FILES.segments, isSegmentList, fetchJson),
    loadFile(baseUrl, DATA_FILES.geometry, isSegmentFeatureCollection, fetchJson),
    loadFile(baseUrl, DATA_FILES.manifest, isManifest, fetchJson),
  ]);
  return { stations, services, segments, geometry, manifest };
}

/** Failed results, for the non-blocking error banner. */
export function listFailures(
  data: RailwayData,
): { file: DataFileName; reason: string }[] {
  return Object.values(data).flatMap((result: LoadResult<unknown>) =>
    result.ok ? [] : [{ file: result.file, reason: result.reason }],
  );
}
