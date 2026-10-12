export const validStation = {
  id: "st-tokyo",
  name: "東京",
  coordinates: [139.7671, 35.6812] as [number, number],
};

export const validService = {
  id: "jr-yamanote",
  name: "JR山手線",
  operator: "東日本旅客鉄道",
  stationIds: ["st-tokyo", "st-kanda", "st-ueno"],
  circular: true as const,
  color: "#80c241",
  directionLabels: { forward: "外回り", backward: "内回り" },
  platformCoordinates: { "st-tokyo": [139.7671, 35.6812] as [number, number], "st-kanda": [139.7708, 35.6918] as [number, number], "st-ueno": [139.777, 35.712] as [number, number] },
};

export const validSegment = {
  id: "seg-tokyo-kanda",
  serviceId: "jr-yamanote",
  from: "st-tokyo",
  to: "st-kanda",
  geometryFeatureId: "seg-tokyo-kanda",
};

export const validFeature = {
  type: "Feature",
  id: "seg-tokyo-kanda",
  properties: {
    featureId: "seg-tokyo-kanda",
    serviceId: "jr-yamanote",
    from: "st-tokyo",
    to: "st-kanda",
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [139.7671, 35.6812],
      [139.7708, 35.6918],
    ],
  },
};

export const validFeatureCollection = {
  type: "FeatureCollection",
  features: [validFeature],
};

export const validManifest = {
  schemaVersion: 2 as const,
  dataVersion: "2026-10-11",
  updatedAt: "2026-10-11",
  source: {
    name: "国土数値情報",
    dataset: "N02",
    year: 2025,
    baseDate: "2025-01-01",
    url: "https://nlftp.mlit.go.jp/ksj/",
    license: "CC BY 4.0",
    attribution: "「国土数値情報（鉄道データ）」（国土交通省）を加工して作成",
  },
};
