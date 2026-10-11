import { describe, expect, it } from "vitest";
import { buildDataAttribution, escapeHtml } from "../../src/features/map/attribution";
import { buildLineColorExpression } from "../../src/features/map/lineColor";
import { buildStationCollection } from "../../src/features/map/stationCollection";
import { validManifest, validService, validStation } from "./fixtures/railway";

describe("buildStationCollection", () => {
  it("attaches the names of lines serving the station", () => {
    const collection = buildStationCollection([validStation], [validService]);
    expect(collection.features[0]?.properties).toEqual({
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
});

describe("buildDataAttribution", () => {
  it("includes attribution and license", () => {
    const html = buildDataAttribution(validManifest);
    expect(html).toContain("国土交通省");
    expect(html).toContain("CC BY 4.0");
  });

  it("escapes HTML in manifest strings", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
  });
});
