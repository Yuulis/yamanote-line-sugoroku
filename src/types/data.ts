import type { ServiceId, StationId } from "./network";

/** public/data/manifest.json */
export interface DataSource {
  name: string;
  dataset: string;
  year: number | string;
  baseDate: string;
  url: string;
  license: string;
  attribution: string;
}

export interface UiOperator {
  id: string;
  name: string;
}

export interface UiLineGroup {
  id: string;
  name: string;
  operatorId: string;
  color: string;
  serviceIds: string[];
}

export interface UiStationPresentation {
  id: string;
  aliases: string[];
}

export interface UiServiceStopName {
  serviceId: string;
  stationId: string;
  name: string;
}

/** Optional, presentation-only metadata kept outside the gameplay payloads. */
export interface UiPresentation {
  version: 1;
  operators: UiOperator[];
  lineGroups: UiLineGroup[];
  stations: UiStationPresentation[];
  serviceStopNames: UiServiceStopName[];
}

export interface Manifest {
  schemaVersion: 3;
  dataVersion: string;
  /** Data update date, `YYYY-MM-DD`. */
  updatedAt: string;
  source: DataSource;
  /** Absent from S5 and archived bundles; never affects engine data. */
  uiPresentation?: UiPresentation;
}

export type Position = [longitude: number, latitude: number];

export interface SegmentLineString {
  type: "LineString";
  coordinates: Position[];
}

export interface SegmentFeatureProperties {
  featureId: string;
  serviceId: ServiceId;
  lineId: string;
  from: StationId;
  to: StationId;
}

export interface SegmentFeature {
  type: "Feature";
  id: string;
  properties: SegmentFeatureProperties;
  geometry: SegmentLineString;
}

/** public/data/segments.geojson */
export interface SegmentFeatureCollection {
  type: "FeatureCollection";
  features: SegmentFeature[];
}
