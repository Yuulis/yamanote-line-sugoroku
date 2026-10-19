import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDataAttribution,
  CC_BY_URL,
  escapeHtml,
} from "../../src/features/map/attribution";
import { buildLineColorExpression, buildTrackColorExpression } from "../../src/features/map/lineColor";
import { buildStationCollection } from "../../src/features/map/stationCollection";
import {
  buildMapPresentationIndex,
  visiblePrimitiveFeatureIds,
} from "../../src/features/map/mapPresentation";
import {
  backgroundServiceFilter,
  primitiveFeatureFilter,
  targetTrackFilter,
  updateLineGroupVisibility,
} from "../../src/features/map/lineVisibility";
import { labelSortKey, isStationLabelEligible } from "../../src/features/map/stationMarkers";
import { updateLineGroupSelection } from "../../src/features/map/lineVisibilityStore";
import { LAYER_IDS, SOURCE_IDS, isBasemapError } from "../../src/features/map/mapConfig";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { RailwayMap } from "../../src/features/map/RailwayMap";
import { loadBundle } from "../e2e/fixtures/bundle";
import { validManifest, validService, validStation } from "./fixtures/railway";

const realBundle = await loadBundle("real");

describe("buildStationCollection", () => {
  it("attaches the names of lines serving the station", () => {
    const collection = buildStationCollection([validStation], [validService]);
    expect(collection.features[0]?.properties).toMatchObject({
      id: "st-tokyo",
      name: "東京",
      lineNames: "JR山手線",
    });
  });

  it("uses an empty line name when no service serves the station", () => {
    const other = { ...validStation, id: "st-other" };
    const collection = buildStationCollection([other], [validService]);
    expect(collection.features[0]?.properties.lineNames).toBe("");
  });

  it("uses joined station aliases and carries label priority and eligibility", () => {
    const presentation = {
      stationName: () => "東京・東京駅",
      serviceStationName: () => "東京・東京駅",
      serviceName: () => "山手線",
      lineGroupId: () => "jr-yamanote",
      lineGroupColor: () => "#9ACD32",
      lineGroups: () => [],
      sameLineGroup: () => true,
      candidateRows: () => [],
    };
    const collection = buildStationCollection(
      [validStation],
      [validService],
      presentation,
      new Map([[validStation.id, [validService.id]]]),
      "jr-yamanote",
    );

    expect(collection.features[0]?.properties).toMatchObject({
      name: "東京・東京駅",
      labelTier: "target",
      labelEligibleAt: 11,
      labelPriority: 0,
    });
  });

  it("uses the audited joined alias and one Oedo service-group name on real bundle stations", () => {
    if (!realBundle.data.stations.ok || !realBundle.data.services.ok || !realBundle.data.segments.ok || !realBundle.data.manifest.ok) {
      throw new Error("The live product bundle must be complete");
    }
    const uiPresentation = realBundle.data.manifest.value.uiPresentation;
    if (!uiPresentation) throw new Error("The live product bundle must contain UI presentation data");
    const resolver = createPresentationResolver(realBundle.network, uiPresentation);
    const index = buildMapPresentationIndex(
      realBundle.data.services.value.services,
      realBundle.data.segments.value,
      uiPresentation,
      realBundle.data.services.value.lines,
    );
    const collection = buildStationCollection(
      realBundle.data.stations.value,
      realBundle.data.services.value.services,
      resolver,
      index.serviceIdsByStation,
    );

    expect(collection.features.find((feature) => feature.id === "hamamatsucho")?.properties.name).toBe("浜松町・大門");
    expect(index.lineGroups.filter((group) => group.name === "大江戸線")).toEqual([
      expect.objectContaining({ serviceIds: ["toei-oedo-loop", "toei-oedo-radial"] }),
    ]);
    expect(collection.features.find((feature) => feature.id === "toei-tochomae")?.properties.lineNames.match(/大江戸線/g)).toHaveLength(1);
  });
});

describe("RailwayMap invalid network fallback", () => {
  it("renders the canonical-label fallback when a segment references an unknown service", () => {
    if (!realBundle.data.segments.ok) throw new Error("The live product bundle must contain segments");
    const invalidData = {
      ...realBundle.data,
      segments: {
        ...realBundle.data.segments,
        value: realBundle.data.segments.value.map((segment, index) =>
          index === 0 ? { ...segment, serviceId: "nonexistent-service" } : segment,
        ),
      },
    };

    const markup = renderToStaticMarkup(createElement(RailwayMap, { data: invalidData }));

    expect(markup).toContain('class="map-container"');
  });
});

describe("map presentation index and visibility filters", () => {
  const secondService = {
    ...validService,
    id: "private-line",
    operator: "私鉄",
    stationIds: ["st-tokyo"],
  };
  const thirdService = {
    ...validService,
    id: "private-line-radial",
    operator: "私鉄",
    stationIds: ["st-tokyo"],
  };
  const groups = {
    version: 1 as const,
    operators: [
      { id: "東日本旅客鉄道", name: "東日本旅客鉄道" },
      { id: "私鉄", name: "私鉄" },
    ],
    lineGroups: [
      { id: "jr-yamanote", name: "山手線", operatorId: "東日本旅客鉄道", color: "#9ACD32", serviceIds: ["jr-yamanote"] },
      { id: "private-line", name: "私鉄線", operatorId: "私鉄", color: "#123456", serviceIds: ["private-line", "private-line-radial"] },
    ],
    stations: [],
    serviceStopNames: [],
  };
  const segments = [
    { id: "jr-segment", serviceId: "jr-yamanote", from: "st-tokyo", to: "st-kanda", geometryFeatureIds: ["shared", "jr-only"] as [string, ...string[]] },
    { id: "private-segment", serviceId: "private-line", from: "st-tokyo", to: "st-ueno", geometryFeatureIds: ["shared", "private-only"] as [string, ...string[]] },
    { id: "private-radial-segment", serviceId: "private-line-radial", from: "st-tokyo", to: "st-ueno", geometryFeatureIds: ["radial-only"] as [string, ...string[]] },
  ];
  const index = buildMapPresentationIndex([validService, secondService, thirdService], segments, groups);

  it("indexes station, operator, group and primitive references once", () => {
    expect(index.serviceIdsByStation.get("st-tokyo")).toEqual(["jr-yamanote", "private-line", "private-line-radial"]);
    expect(index.groupIdsByOperator.get("私鉄")).toEqual(["private-line"]);
    expect(index.serviceIdsByGroup.get("private-line")).toEqual(["private-line", "private-line-radial"]);
    expect(index.primitiveFeatureIdsByGroup.get("private-line")).toEqual(["shared", "private-only", "radial-only"]);
  });

  it("keeps shared primitives when any selected UI group references them", () => {
    expect(visiblePrimitiveFeatureIds(index, new Set(["private-line"]))).toEqual(["shared", "private-only", "radial-only"]);
  });

  it("leaves the feature filter unset when every UI group is visible", () => {
    expect(visiblePrimitiveFeatureIds(index, null)).toBeNull();
    expect(primitiveFeatureFilter(null)).toBeNull();
  });

  it("filters both background layers by primitive ids while excluding the target from the service overlay", () => {
    const visible = ["shared", "private-only", "radial-only"];
    expect(primitiveFeatureFilter(visible)).toEqual(["in", ["get", "featureId"], ["literal", visible]]);
    expect(backgroundServiceFilter(visible, "jr-yamanote")).toEqual([
      "all",
      ["!=", ["get", "serviceId"], "jr-yamanote"],
      ["in", ["get", "featureId"], ["literal", visible]],
    ]);
  });

  it("limits the base track to target features while applying visibility", () => {
    const visible = ["shared", "jr-only"];
    expect(targetTrackFilter(null, "jr-yamanote")).toEqual(["==", ["get", "serviceId"], "jr-yamanote"]);
    expect(targetTrackFilter(visible, "jr-yamanote")).toEqual([
      "all",
      ["==", ["get", "serviceId"], "jr-yamanote"],
      ["in", ["get", "featureId"], ["literal", visible]],
    ]);
  });

  it("restores the unfiltered target base track when every group is visible again", () => {
    const filters: Record<string, unknown> = {};
    const map = {
      getLayer: (id: string) => id === LAYER_IDS.base || id === LAYER_IDS.services ? { id } : undefined,
      setFilter: (id: string, filter: unknown) => { filters[id] = filter; },
    } as never;

    updateLineGroupVisibility(map, index, null, "jr-yamanote");

    expect(filters[LAYER_IDS.base]).toEqual(targetTrackFilter(null, "jr-yamanote"));
    expect(filters[LAYER_IDS.services]).toEqual(backgroundServiceFilter(null, "jr-yamanote"));
  });

  it("updates only the background base and service layers", () => {
    const filters: Record<string, unknown> = {};
    const map = {
      getLayer: (id: string) => id === LAYER_IDS.base || id === LAYER_IDS.services ? { id } : undefined,
      setFilter: (id: string, filter: unknown) => { filters[id] = filter; },
    } as never;

    updateLineGroupVisibility(map, index, new Set(["private-line"]), "jr-yamanote");

    expect(filters[LAYER_IDS.base]).toEqual(targetTrackFilter(["shared", "private-only", "radial-only"], "jr-yamanote"));
    expect(filters[LAYER_IDS.services]).toEqual(backgroundServiceFilter(["shared", "private-only", "radial-only"], "jr-yamanote"));
    expect(filters).not.toHaveProperty(LAYER_IDS.segmentsPending);
    expect(filters).not.toHaveProperty(LAYER_IDS.currentService);
  });
});

describe("line group selection", () => {
  it("toggles one group and returns to all-visible state when all are selected", () => {
    expect(updateLineGroupSelection(null, ["a", "b"], ["a"], false)).toEqual(new Set(["b"]));
    expect(updateLineGroupSelection(new Set(["b"]), ["a", "b"], ["a"], true)).toBeNull();
  });

  it("selects or clears every group for an operator without touching others", () => {
    expect(updateLineGroupSelection(new Set(["a", "c"]), ["a", "b", "c"], ["a", "b"], false)).toEqual(new Set(["c"]));
    expect(updateLineGroupSelection(new Set(["c"]), ["a", "b", "c"], ["a", "b"], true)).toBeNull();
  });
});

describe("label density helpers", () => {
  it("allows target and interchange labels at 11, and ordinary labels at 13", () => {
    expect(isStationLabelEligible("target", 11.5)).toBe(true);
    expect(isStationLabelEligible("transfer", 11.5)).toBe(true);
    expect(isStationLabelEligible("ordinary", 11.5)).toBe(false);
    expect(isStationLabelEligible("ordinary", 13.5)).toBe(true);
  });

  it("sorts target labels before interchanges and ordinary labels with stable order ties", () => {
    expect(labelSortKey("target", 12, 100)).toBeLessThan(labelSortKey("transfer", 0, 100));
    expect(labelSortKey("transfer", 4, 100)).toBeLessThan(labelSortKey("ordinary", 0, 100));
    expect(labelSortKey("transfer", 4, 100)).toBeLessThan(labelSortKey("transfer", 5, 100));
  });
});

describe("buildLineColorExpression", () => {
  it("maps serviceId to colour with a fallback", () => {
    const expression = buildLineColorExpression([validService]);
    expect(expression).toEqual([
      "match",
      ["get", "serviceId"],
      "jr-yamanote",
      "#80c241",
      "#80c241",
    ]);
  });

  it("returns a literal fallback when there are no services", () => {
    expect(buildLineColorExpression([])).toEqual(["literal", "#80c241"]);
  });

  it("uses presentation group colours for service-owned line features", () => {
    const presentation = {
      lineGroupColor: () => "#9ACD32",
    };
    expect(buildLineColorExpression([validService], presentation as never)).toEqual([
      "match",
      ["get", "serviceId"],
      "jr-yamanote",
      "#9ACD32",
      "#80c241",
    ]);
  });
});

describe("buildTrackColorExpression", () => {
  it("uses the UI resolver colour for railway primitives while preserving the line-id fallback", () => {
    const presentation = { lineGroupColor: () => "#9ACD32" };
    expect(buildTrackColorExpression([], [validService], presentation as never)).toEqual([
      "match",
      ["get", "serviceId"],
      "jr-yamanote",
      "#9ACD32",
      "#80c241",
    ]);
    expect(buildTrackColorExpression([{ id: "jr-yamanote", name: "山手線", color: "#aabbcc" }])).toEqual([
      "match",
      ["get", "lineId"],
      "jr-yamanote",
      "#aabbcc",
      "#80c241",
    ]);
  });
});

describe("buildDataAttribution", () => {
  it("includes attribution and license", () => {
    const html = buildDataAttribution(validManifest);
    expect(html).toContain("国土交通省");
    expect(html).toContain("CC BY 4.0");
  });

  it("links CC BY 4.0 to the licence deed in a new tab", () => {
    const html = buildDataAttribution(validManifest);
    expect(html).toContain(
      `<a href="${CC_BY_URL}" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>`,
    );
  });

  it("links the credit to the dataset page from the manifest", () => {
    const html = buildDataAttribution(validManifest);
    expect(html).toContain(
      '<a href="https://nlftp.mlit.go.jp/ksj/" target="_blank" rel="noopener noreferrer">',
    );
  });

  it("does not link a non-https dataset URL", () => {
    const manifest = {
      ...validManifest,
      source: { ...validManifest.source, url: "javascript:alert(1)" },
    };
    const html = buildDataAttribution(manifest);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("国土交通省");
  });

  it("escapes HTML in the attribution text and the URL", () => {
    const manifest = {
      ...validManifest,
      source: {
        ...validManifest.source,
        attribution: "<script>x</script>",
        url: 'https://example.com/?a="b"&c=<d>',
      },
    };
    const html = buildDataAttribution(manifest);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('"b"');
  });

  it("does not link a licence other than CC BY 4.0", () => {
    const manifest = { ...validManifest, source: { ...validManifest.source, license: "OtherL" } };
    expect(buildDataAttribution(manifest)).not.toContain(CC_BY_URL);
  });

  it("escapes HTML in manifest strings", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("isBasemapError", () => {
  it("treats errors without a source or from basemap sources as basemap failures", () => {
    expect(isBasemapError({})).toBe(true);
    expect(isBasemapError({ sourceId: "openmaptiles" })).toBe(true);
  });

  it("ignores errors from the app's own railway sources", () => {
    for (const sourceId of Object.values(SOURCE_IDS)) {
      expect(isBasemapError({ sourceId })).toBe(false);
    }
  });
});
