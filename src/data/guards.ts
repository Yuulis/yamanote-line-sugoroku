import type {
  DataSource,
  Manifest,
  Position,
  SegmentFeature,
  SegmentFeatureCollection,
} from "../types/data";
import type { Segment, ServicePattern, Station } from "../types/network";

const MAX_LONGITUDE = 180;
const MAX_LATITUDE = 90;
const MIN_LINE_POSITIONS = 2;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

export function isPosition(value: unknown): value is Position {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lon, lat] = value as unknown[];
  return (
    typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= MAX_LONGITUDE &&
    Math.abs(lat) <= MAX_LATITUDE
  );
}

function isPositionList(value: unknown): value is Position[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_LINE_POSITIONS &&
    value.every(isPosition)
  );
}

export function isStation(value: unknown): value is Station {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name)) return false;
  if (!isPosition(value.coordinates) || value.coordinates.length !== 2) return false;
  return value.groupId === undefined || typeof value.groupId === "string";
}

export function isServicePattern(value: unknown): value is ServicePattern {
  if (!isRecord(value)) return false;
  const { directionLabels, platformCoordinates, stationIds, endpoints } = value;
  if (!isNonEmptyArray(stationIds) || !stationIds.every(isNonEmptyString)) return false;
  if (new Set(stationIds).size !== stationIds.length) return false;
  if (typeof value.circular !== "boolean" || stationIds.length < (value.circular ? 3 : 2)) return false;
  if (!isRecord(directionLabels) || !isNonEmptyString(directionLabels.forward) || !isNonEmptyString(directionLabels.backward)) return false;
  if (!isRecord(platformCoordinates) || Object.keys(platformCoordinates).length !== stationIds.length || !stationIds.every((id) => Object.hasOwn(platformCoordinates, id) && isPosition(platformCoordinates[id]))) return false;
  if (value.circular ? endpoints !== undefined : !isRecord(endpoints) || !isEndpointKind(endpoints.first) || !isEndpointKind(endpoints.last)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.operator) &&
    isNonEmptyString(value.color)
  );
}

function isEndpointKind(value: unknown): boolean {
  return value === "terminus" || value === "area-boundary";
}

export function isSegment(value: unknown): value is Segment {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.serviceId) &&
    isNonEmptyString(value.from) &&
    isNonEmptyString(value.to) &&
    isNonEmptyString(value.geometryFeatureId)
  );
}

function isDataSource(value: unknown): value is DataSource {
  if (!isRecord(value)) return false;
  const yearIsValid =
    typeof value.year === "number" || isNonEmptyString(value.year);
  return (
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.dataset) &&
    yearIsValid &&
    isNonEmptyString(value.baseDate) &&
    isNonEmptyString(value.url) &&
    isNonEmptyString(value.license) &&
    isNonEmptyString(value.attribution)
  );
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isManifest(value: unknown): value is Manifest {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 2 &&
    isNonEmptyString(value.dataVersion) &&
    isIsoDate(value.updatedAt) &&
    isDataSource(value.source)
  );
}

function isSegmentGeometry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "LineString") return isPositionList(value.coordinates);
  return false;
}

export function isSegmentFeature(value: unknown): value is SegmentFeature {
  if (!isRecord(value) || value.type !== "Feature") return false;
  if (!isNonEmptyString(value.id) || !isRecord(value.properties)) return false;
  const { featureId, serviceId, from, to } = value.properties;
  return (
    isNonEmptyString(featureId) &&
    value.id === featureId &&
    isNonEmptyString(serviceId) &&
    isNonEmptyString(from) &&
    isNonEmptyString(to) &&
    isSegmentGeometry(value.geometry)
  );
}

export function isSegmentFeatureCollection(
  value: unknown,
): value is SegmentFeatureCollection {
  if (!isRecord(value) || value.type !== "FeatureCollection" || "crs" in value) return false;
  return isNonEmptyArray(value.features) && value.features.every(isSegmentFeature);
}

/** Non-empty array whose every element satisfies `guard`. */
export function isNonEmptyArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return isNonEmptyArray(value) && value.every(guard);
}

export const isStationList = (value: unknown): value is Station[] =>
  isNonEmptyArrayOf(value, isStation);

export const isServicePatternList = (value: unknown): value is ServicePattern[] =>
  isNonEmptyArrayOf(value, isServicePattern);

export const isSegmentList = (value: unknown): value is Segment[] =>
  isNonEmptyArrayOf(value, isSegment);
