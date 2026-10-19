import { describe, expect, it } from "vitest";
import {
  hasValidUiPresentationReferences,
  isManifest,
  isPosition,
  isSegment,
  isSegmentFeatureCollection,
  isSegmentList,
  isServicePattern,
  isServicePatternList,
  isStation,
  isStationList,
  isUiPresentation,
} from "../../src/data/guards";
import {
  validFeature,
  validFeatureCollection,
  validManifest,
  validSegment,
  validService,
  validStation,
  validUiPresentation,
} from "./fixtures/railway";

describe("isStation", () => {
  it("accepts a valid station", () => {
    expect(isStation(validStation)).toBe(true);
  });

  it("accepts a station with an optional groupId", () => {
    expect(isStation({ ...validStation, groupId: "g1" })).toBe(true);
  });

  it.each([
    ["missing name", { id: "a", coordinates: [139, 35] }],
    ["empty id", { ...validStation, id: "" }],
    ["coordinates as strings", { ...validStation, coordinates: ["139", "35"] }],
    ["three coordinate values", { ...validStation, coordinates: [139, 35, 0] }],
    ["latitude out of range", { ...validStation, coordinates: [139, 95] }],
    ["non-string groupId", { ...validStation, groupId: 1 }],
    ["null", null],
    ["an array", []],
  ])("rejects a station with %s", (_label, value) => {
    expect(isStation(value)).toBe(false);
  });
});

describe("isServicePattern", () => {
  it("accepts a valid service", () => {
    expect(isServicePattern(validService)).toBe(true);
  });

  it.each([
    ["missing color", { ...validService, color: undefined }],
    ["empty stationIds", { ...validService, stationIds: [] }],
    ["non-string stationIds item", { ...validService, stationIds: ["a", 1] }],
    ["non-boolean circular", { ...validService, circular: "true" }],
    ["missing operator", { ...validService, operator: undefined }],
  ])("rejects a service with %s", (_label, value) => {
    expect(isServicePattern(value)).toBe(false);
  });
});

describe("isSegment", () => {
  it("accepts a valid segment", () => {
    expect(isSegment(validSegment)).toBe(true);
  });

  it.each([
    ["missing geometryFeatureIds", { ...validSegment, geometryFeatureIds: undefined }],
    ["numeric from", { ...validSegment, from: 1 }],
    ["missing serviceId", { ...validSegment, serviceId: undefined }],
  ])("rejects a segment with %s", (_label, value) => {
    expect(isSegment(value)).toBe(false);
  });
});

describe("isManifest", () => {
  it("accepts a valid manifest", () => {
    expect(isManifest(validManifest)).toBe(true);
  });

  it("rejects a manifest without source", () => {
    expect(isManifest({ dataVersion: "1" })).toBe(false);
  });

  it("rejects a manifest whose source lacks attribution", () => {
    const source = { ...validManifest.source, attribution: undefined };
    expect(isManifest({ ...validManifest, source })).toBe(false);
  });

  it("rejects a manifest without updatedAt", () => {
    const { updatedAt: _omitted, ...rest } = validManifest;
    expect(isManifest(rest)).toBe(false);
  });

  it("rejects a manifest whose updatedAt is not a string", () => {
    expect(isManifest({ ...validManifest, updatedAt: 20261011 })).toBe(false);
  });

  it.each(["2026-13-01", "2026-02-30", "2026/10/11", "20261011", "2026-1-1", ""])(
    "rejects a manifest with malformed updatedAt %j",
    (updatedAt) => {
      expect(isManifest({ ...validManifest, updatedAt })).toBe(false);
    },
  );

  it("rejects a manifest with empty dataVersion", () => {
    expect(isManifest({ ...validManifest, dataVersion: "" })).toBe(false);
  });

  it("accepts S5 manifests without optional presentation metadata", () => {
    expect(isManifest(validManifest)).toBe(true);
  });

  it("accepts valid optional presentation metadata", () => {
    expect(isManifest({ ...validManifest, uiPresentation: validUiPresentation })).toBe(true);
  });

  it("rejects malformed optional presentation metadata when present", () => {
    expect(isManifest({ ...validManifest, uiPresentation: undefined })).toBe(false);
    expect(isManifest({
      ...validManifest,
      uiPresentation: { ...validUiPresentation, version: 2 },
    })).toBe(false);
  });
});

describe("isUiPresentation", () => {
  it("accepts valid UI metadata", () => {
    expect(isUiPresentation(validUiPresentation)).toBe(true);
  });

  it.each([
    ["empty alias list", { ...validUiPresentation, stations: [{ id: "st-tokyo", aliases: [] }] }],
    ["empty aliases", { ...validUiPresentation, stations: [{ id: "st-tokyo", aliases: [""] }] }],
    ["duplicate aliases", { ...validUiPresentation, stations: [{ id: "st-tokyo", aliases: ["東京駅", "東京駅"] }] }],
    ["invalid color", { ...validUiPresentation, lineGroups: [{ ...validUiPresentation.lineGroups[0], color: "red" }] }],
    ["duplicate service membership", {
      ...validUiPresentation,
      lineGroups: [
        validUiPresentation.lineGroups[0],
        { ...validUiPresentation.lineGroups[0], id: "duplicate", name: "重複", serviceIds: ["jr-yamanote"] },
      ],
    }],
    ["empty operator catalogue", { ...validUiPresentation, operators: [] }],
  ])("rejects malformed metadata with %s", (_label, value) => {
    expect(isUiPresentation(value)).toBe(false);
  });
});

describe("hasValidUiPresentationReferences", () => {
  it("rejects metadata after a service group is removed", () => {
    const privateService = { ...validService, id: "private-line", operator: "私鉄" };
    const completePresentation = {
      ...validUiPresentation,
      operators: [...validUiPresentation.operators, { id: "私鉄", name: "私鉄" }],
      lineGroups: [
        ...validUiPresentation.lineGroups,
        { id: "private-line", name: "私鉄線", operatorId: "私鉄", color: "#123456", serviceIds: [privateService.id] },
      ],
    };
    const services = { lines: [], services: [validService, privateService] };

    expect(hasValidUiPresentationReferences(completePresentation, [validStation], services)).toBe(true);
    expect(hasValidUiPresentationReferences(
      { ...completePresentation, lineGroups: completePresentation.lineGroups.slice(0, 1) },
      [validStation],
      services,
    )).toBe(false);
  });
});

describe("isPosition", () => {
  it("rejects NaN coordinates", () => {
    expect(isPosition([Number.NaN, 35])).toBe(false);
  });
});

describe("isSegmentFeatureCollection", () => {
  it("accepts a collection with a LineString feature", () => {
    expect(isSegmentFeatureCollection(validFeatureCollection)).toBe(true);
  });

  it("rejects a MultiLineString feature in the v3 contract", () => {
    const feature = {
      ...validFeature,
      geometry: {
        type: "MultiLineString",
        coordinates: [validFeature.geometry.coordinates],
      },
    };
    const collection = { type: "FeatureCollection", features: [feature] };
    expect(isSegmentFeatureCollection(collection)).toBe(false);
  });

  it("rejects an empty feature list", () => {
    expect(
      isSegmentFeatureCollection({ type: "FeatureCollection", features: [] }),
    ).toBe(false);
  });

  it("rejects a feature without id", () => {
    const feature = { ...validFeature, id: undefined };
    const collection = { type: "FeatureCollection", features: [feature] };
    expect(isSegmentFeatureCollection(collection)).toBe(false);
  });

  it("rejects a feature with missing featureId property", () => {
    const feature = {
      ...validFeature,
      properties: { ...validFeature.properties, featureId: undefined },
    };
    const collection = { type: "FeatureCollection", features: [feature] };
    expect(isSegmentFeatureCollection(collection)).toBe(false);
  });

  it("rejects a Point geometry", () => {
    const feature = {
      ...validFeature,
      geometry: { type: "Point", coordinates: [139, 35] },
    };
    const collection = { type: "FeatureCollection", features: [feature] };
    expect(isSegmentFeatureCollection(collection)).toBe(false);
  });

  it("rejects a LineString with a single position", () => {
    const feature = {
      ...validFeature,
      geometry: { type: "LineString", coordinates: [[139, 35]] },
    };
    const collection = { type: "FeatureCollection", features: [feature] };
    expect(isSegmentFeatureCollection(collection)).toBe(false);
  });

  it("rejects a non-FeatureCollection value", () => {
    expect(isSegmentFeatureCollection({ type: "Feature" })).toBe(false);
  });
});

describe("list guards", () => {
  it("accepts non-empty lists of valid items", () => {
    expect(isStationList([validStation])).toBe(true);
    expect(isServicePatternList([validService])).toBe(true);
    expect(isSegmentList([validSegment])).toBe(true);
  });

  it("rejects empty arrays", () => {
    expect(isStationList([])).toBe(false);
    expect(isServicePatternList([])).toBe(false);
    expect(isSegmentList([])).toBe(false);
  });

  it("rejects a list containing one invalid item", () => {
    expect(isStationList([validStation, { id: "x" }])).toBe(false);
  });

  it("rejects non-array input", () => {
    expect(isStationList(validStation)).toBe(false);
  });
});
