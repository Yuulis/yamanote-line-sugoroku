// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LineBadge } from "../../src/features/game/components/LineBadge";
import { badgeTextColor, LINE_BADGE_CODES, lineBadgeFor, NO_CODE_LINE_GROUP_IDS } from "../../src/features/game/lineBadge";
import type { PresentationResolver } from "../../src/features/game/presentationResolver";
import { contrastRatio } from "../../src/features/game/uiContrast";

interface ManifestLineGroup {
  id: string;
  name: string;
  operatorId: string;
  color: string;
  serviceIds: string[];
}

interface ManifestData {
  uiPresentation: {
    lineGroups: ManifestLineGroup[];
  };
}

const MANIFEST: ManifestData = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/data/manifest.json"), "utf8"),
) as ManifestData;
const LINE_GROUPS: readonly ManifestLineGroup[] = MANIFEST.uiPresentation.lineGroups;
const GROUP_BY_SERVICE: Map<string, ManifestLineGroup> = new Map(
  LINE_GROUPS.flatMap((group: ManifestLineGroup) => group.serviceIds.map((serviceId: string) => [serviceId, group] as const)),
);
const PRESENTATION: PresentationResolver = {
  stationName: (stationId: string): string => stationId,
  serviceStationName: (_serviceId: string, stationId: string): string => stationId,
  serviceName: (serviceId: string): string => GROUP_BY_SERVICE.get(serviceId)?.name ?? serviceId,
  lineGroupId: (serviceId: string): string => GROUP_BY_SERVICE.get(serviceId)?.id ?? serviceId,
  lineGroupColor: (serviceId: string): string | undefined => GROUP_BY_SERVICE.get(serviceId)?.color,
  lineGroups: (): readonly never[] => [],
  sameLineGroup: (firstServiceId: string, secondServiceId: string): boolean =>
    GROUP_BY_SERVICE.get(firstServiceId)?.id === GROUP_BY_SERVICE.get(secondServiceId)?.id,
  candidateRows: (_serviceIds: readonly string[]) => [],
};

const EXPECTED_UNCODED_IDS: readonly string[] = [
  "jr-hachiko", "jr-kawagoe-west", "jr-sagami", "jr-narita-abiko", "jr-kashima", "jr-sotobo",
  "jr-uchibo", "jr-kururi", "jr-togane", "jr-chuo-tatsuno", "jr-koumi", "jr-oito",
  "jr-shinetsu-yokokawa", "jr-joetsu", "jr-agatsuma", "jr-ryomo", "jr-mito", "jr-nikko",
  "jr-karasuyama", "jr-suigun", "jr-suigun-ota",
];

const OPERATOR_SYMBOLS: Readonly<Record<string, ReadonlySet<string>>> = {
  "jr-": new Set(["JY", "JK", "JB", "JC", "JA", "JE", "JM", "JN", "JI", "JH", "JT", "JO", "JU", "JS", "JJ", "JL", "SN", "SE"]),
  "tobu-": new Set(["TS", "TI", "TN", "TD", "TJ"]),
  "seibu-": new Set(["SI", "SS", "SK", "ST", "SW", "SY"]),
  "metro-": new Set(["G", "M", "H", "T", "C", "Y", "Z", "N", "F"]),
  "tokyu-": new Set(["TY", "MG", "SH", "DT", "OM", "IK", "TM", "SG", "KD"]),
  "keisei-": new Set(["KS"]),
  "keio-": new Set(["KO", "IN"]),
  "toei-": new Set(["A", "I", "S", "E"]),
  "keikyu-": new Set(["KK"]),
  "odakyu-": new Set(["OH", "OE", "OT"]),
  "sotetsu-": new Set(["SO"]),
  "yokohama-": new Set(["B", "G"]),
  "tx": new Set(["TX"]),
  "mm-": new Set(["MM"]),
  "hokuso-": new Set(["HS"]),
};

const EXPECTED_SPOT_CODES: Readonly<Record<string, string>> = {
  "jr-yamanote": "JY",
  "jr-keihin-tohoku": "JK",
  "jr-chuo-sobu-local": "JB",
  "jr-chuo-rapid": "JC",
  "jr-saikyo": "JA",
  "jr-keiyo": "JE",
  "jr-yokohama": "JH",
  "jr-joban-local": "JL",
  "metro-ginza": "G",
  "metro-marunouchi": "M",
  "metro-namboku": "N",
  "toei-asakusa": "A",
  "toei-mita": "I",
  "toei-oedo": "E",
  "tokyu-toyoko": "TY",
  "keio-main": "KO",
  "odakyu-odawara": "OH",
  "sotetsu-main": "SO",
  tx: "TX",
  "mm-minatomirai": "MM",
  "hokuso-main": "HS",
  "keikyu-main": "KK",
  "keisei-main": "KS",
  "tobu-tojo": "TJ",
  "seibu-ikebukuro": "SI",
  "yokohama-blue": "B",
};

describe("line badge catalogue", () => {
  it("covers each manifest group exactly once across coded and uncoded ids", () => {
    const manifestIds: string[] = LINE_GROUPS.map((group: ManifestLineGroup) => group.id);
    const codedIds: string[] = Object.keys(LINE_BADGE_CODES);
    const uncodedIds: string[] = [...NO_CODE_LINE_GROUP_IDS];

    expect(new Set([...codedIds, ...uncodedIds])).toEqual(new Set(manifestIds));
    expect(codedIds.length).toBe(113);
    expect(uncodedIds.length).toBe(21);
    expect(codedIds.filter((id: string) => NO_CODE_LINE_GROUP_IDS.has(id))).toEqual([]);
    expect(new Set(uncodedIds)).toEqual(new Set(EXPECTED_UNCODED_IDS));
  });

  it("maps both Oedo services to the same line badge model", () => {
    const loopBadge = lineBadgeFor("toei-oedo-loop", PRESENTATION);
    const radialBadge = lineBadgeFor("toei-oedo-radial", PRESENTATION);

    expect(loopBadge).toEqual(radialBadge);
    expect(loopBadge).toMatchObject({ groupId: "toei-oedo", code: "E", name: "大江戸線" });
  });

  it("assigns every coded group id to exactly one operator prefix", () => {
    for (const groupId of Object.keys(LINE_BADGE_CODES)) {
      const matchingPrefixes: string[] = Object.keys(OPERATOR_SYMBOLS)
        .filter((prefix: string) => prefix === "tx" ? groupId === prefix : groupId.startsWith(prefix));
      expect(matchingPrefixes, groupId).toHaveLength(1);
    }
  });

  it("uses only symbols allowed for each operator prefix", () => {
    for (const [prefix, allowedCodes] of Object.entries(OPERATOR_SYMBOLS)) {
      const actualCodes: string[] = Object.entries(LINE_BADGE_CODES)
        .filter(([groupId]: [string, string]) => prefix === "tx" ? groupId === prefix : groupId.startsWith(prefix))
        .map(([, code]: [string, string]) => code);
      expect(actualCodes.every((code: string) => allowedCodes.has(code)), prefix).toBe(true);
    }
  });

  it("matches independent literal spot expectations", () => {
    for (const [groupId, code] of Object.entries(EXPECTED_SPOT_CODES)) {
      expect(LINE_BADGE_CODES[groupId]).toBe(code);
    }
  });

  it("resolves a coded service to its code, manifest color and name", () => {
    expect(lineBadgeFor("jr-yamanote", PRESENTATION)).toEqual({
      groupId: "jr-yamanote",
      code: "JY",
      color: "#9ACD32",
      name: "山手線",
      textColor: "#000000",
    });
  });

  it("resolves an uncoded group to its color and name without a code", () => {
    const badge = lineBadgeFor("jr-hachiko", PRESENTATION);
    expect(badge).toMatchObject({ groupId: "jr-hachiko", code: null, name: "八高線" });
    expect(badge.color).not.toBeNull();
    expect(badge.textColor).not.toBeNull();
  });

  it("never resolves inherited object keys to a code", () => {
    for (const serviceId of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(lineBadgeFor(serviceId, PRESENTATION).code, serviceId).toBeNull();
    }
  });

  it("returns no code and no color for an unknown group without a fallback", () => {
    const badge = lineBadgeFor("unknown-service", PRESENTATION);
    expect(badge.code).toBeNull();
    expect(badge.color).toBeNull();
    expect(badge.textColor).toBeNull();
  });

  it("uses fallback color when the presentation color is invalid", () => {
    const noColorPresentation: PresentationResolver = {
      ...PRESENTATION,
      lineGroupId: (_serviceId: string): string => "unknown-group",
      lineGroupColor: (_serviceId: string): string | undefined => "invalid",
    };
    expect(lineBadgeFor("unknown-service", noColorPresentation, "#ffffff")).toMatchObject({
      code: null,
      color: "#ffffff",
      textColor: "#000000",
    });
    expect(lineBadgeFor("unknown-service", noColorPresentation, "invalid").color).toBeNull();
  });

  it("chooses readable text for every manifest line color", () => {
    for (const group of LINE_GROUPS) {
      expect(contrastRatio(group.color, badgeTextColor(group.color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("LineBadge renderer", () => {
  it("renders the model code on an aria-hidden pennant and the line name as text", () => {
    const model = lineBadgeFor("jr-yamanote", PRESENTATION);
    const markup: string = renderToStaticMarkup(createElement(LineBadge, { model }));
    const document: Document = new DOMParser().parseFromString(markup, "text/html");
    const mark: HTMLElement | null = document.querySelector(".line-badge__mark");

    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelector(".line-badge__code")?.textContent).toBe("JY");
    expect(document.querySelector(".line-badge__name")?.textContent).toBe("山手線");
    expect(document.querySelector(".line-badge")).not.toBeNull();
    expect(mark?.getAttribute("style")).toContain("color:#000000");
    expect(mark?.className).toBe("line-badge__mark");
    expect(markup).not.toMatch(/(?:class|style)="[^"]*(?:ring|border-radius\s*:\s*50%)[^"]*"/i);
  });

  it("renders uncoded and unknown lines as a colour block with no code", () => {
    const uncoded: string = renderToStaticMarkup(createElement(LineBadge, {
      model: lineBadgeFor("jr-hachiko", PRESENTATION),
    }));
    const unknown: string = renderToStaticMarkup(createElement(LineBadge, {
      model: lineBadgeFor("unknown-service", PRESENTATION),
    }));
    const uncodedDocument: Document = new DOMParser().parseFromString(uncoded, "text/html");
    const unknownDocument: Document = new DOMParser().parseFromString(unknown, "text/html");

    expect(uncodedDocument.querySelector(".line-badge__code")).toBeNull();
    expect(uncodedDocument.querySelector(".line-badge__name")?.textContent).toBe("八高線");
    expect(unknownDocument.querySelector(".line-badge__code")).toBeNull();
    expect(unknownDocument.querySelector(".line-badge__name")?.textContent).toBe("unknown-service");
    expect(unknownDocument.querySelector(".line-badge__mark")?.getAttribute("style")).toContain("var(--color-border)");
  });

  it("shows only the catalogue letters on every manifest line, never a station number", () => {
    for (const [serviceId, group] of GROUP_BY_SERVICE) {
      const markup: string = renderToStaticMarkup(createElement(LineBadge, {
        model: lineBadgeFor(serviceId, PRESENTATION),
      }));
      const document: Document = new DOMParser().parseFromString(markup, "text/html");
      const codeText: string | undefined = document.querySelector(".line-badge__code")?.textContent ?? undefined;

      expect(codeText, group.id).toBe(Object.hasOwn(LINE_BADGE_CODES, group.id) ? LINE_BADGE_CODES[group.id] : undefined);
      expect(document.querySelector(".line-badge__mark")?.textContent ?? "", group.id).toMatch(/^[A-Z]{0,2}$/);
      expect(document.querySelector(".line-badge__name")?.textContent, group.id).toBe(group.name);
    }
  });

  it("can omit the adjacent line name and uses the requested size class", () => {
    const markup: string = renderToStaticMarkup(createElement(LineBadge, {
      model: lineBadgeFor("jr-yamanote", PRESENTATION),
      showName: false,
      size: "lg",
    }));

    expect(markup).toContain("line-badge--lg");
    expect(markup).not.toContain("line-badge__name");
    expect(markup).toContain("JY");
  });
});
