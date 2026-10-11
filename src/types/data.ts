import type { SegmentId, ServiceId, StationId } from "./network";

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
  dataVersion: string;
  source: DataSource;
}

export type Position = [longitude: number, latitude: number];

export interface SegmentLineString {
  type: "LineString";
  coordinates: Position[];
}

export interface SegmentMultiLineString {
  type: "MultiLineString";
  coordinates: Position[][];
}

export interface SegmentFeatureProperties {
  segmentId: SegmentId;
  serviceId: ServiceId;
  from: StationId;
  to: StationId;
}

export interface SegmentFeature {
  type: "Feature";
  id: string | number;
  properties: SegmentFeatureProperties;
  geometry: SegmentLineString | SegmentMultiLineString;
}

/** public/data/segments.geojson */
export interface SegmentFeatureCollection {
  type: "FeatureCollection";
  features: SegmentFeature[];
}
