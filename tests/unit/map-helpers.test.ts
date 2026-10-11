import { describe, expect, it } from "vitest";
import {
  buildDataAttribution,
  CC_BY_URL,
  escapeHtml,
} from "../../src/features/map/attribution";
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
