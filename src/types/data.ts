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

export interface Manifest {
  schemaVersion: 3;
  dataVersion: string;
  /** Data update date, `YYYY-MM-DD`. */
  updatedAt: string;
  source: DataSource;
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
