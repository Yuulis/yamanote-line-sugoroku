import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseHexColor, relativeLuminance } from "../../src/features/game/uiContrast";

const STYLES_PATH = resolve(process.cwd(), "src/styles.css");
const STYLES = readFileSync(STYLES_PATH, "utf8");

describe("UI contrast helpers", () => {
  it("calculates the WCAG contrast ratio for black and white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  });

  it("returns a contrast ratio of one for matching colors", () => {
    expect(contrastRatio("#d9502f", "#d9502f")).toBe(1);
  });

  it("checks the brand and strong-brand text contrast", () => {
    expect(contrastRatio("#ffffff", "#d9502f")).toBeCloseTo(4.09, 2);
    expect(contrastRatio("#ffffff", "#d9502f")).toBeLessThan(4.5);
    expect(contrastRatio("#ffffff", "#b83f24")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps normal-size text readable on cream and brand tint", () => {
    expect(contrastRatio("#263238", "#faf7ef")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#555555", "#faf7ef")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#263238", "#fbe9e3")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#b83f24", "#fbe9e3")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#236b2a", "#fbe9e3")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps disabled button text legible on the disabled surface", () => {
    expect(contrastRatio("#6b6b6b", "#eeeeee")).toBeGreaterThanOrEqual(4.5);
  });

  it("parses short and long hex values and rejects invalid input", () => {
    expect(parseHexColor("#abc")).toEqual([170, 187, 204]);
    expect(parseHexColor("d9502f")).toEqual([217, 80, 47]);
    expect(parseHexColor("#12xz45")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
    expect(Number.isNaN(relativeLuminance("invalid"))).toBe(true);
  });
});

describe("light-theme design tokens", () => {
  it("defines the brand and supporting token families", () => {
    const tokenValues: Record<string, string> = {
      "--color-brand": "#d9502f",
      "--color-brand-strong": "#b83f24",
      "--color-brand-tint": "#fbe9e3",
      "--color-ink": "#263238",
      "--color-cream": "#faf7ef",
    };

    for (const [token, value] of Object.entries(tokenValues)) {
      expect(STYLES).toMatch(new RegExp(`${token}:\\s*${value.replace("#", "\\#")};`));
    }

    for (const token of [
      "--color-surface", "--color-surface-raised", "--color-text", "--color-text-muted",
      "--color-border", "--color-good", "--color-bad", "--color-warning", "--color-focus-ring",
      "--color-surface-disabled", "--color-text-disabled",
      "--radius-sm", "--radius-md", "--radius-lg", "--radius-pill", "--shadow-sm", "--shadow-md",
      "--motion-fast", "--motion-normal", "--motion-slow",
    ]) {
      expect(STYLES).toContain(`${token}:`);
    }
  });

  it("removes green UI primaries and zeroes each motion token for reduced motion", () => {
    expect(STYLES).not.toContain("#2e7d32");
    expect(STYLES).not.toContain("#1b5e20");

    const reducedMotionBlock = STYLES.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([^}]+\{[^}]+\})\s*\}/)?.[1];
    expect(reducedMotionBlock).toBeDefined();
    expect(reducedMotionBlock).toContain("--motion-fast: 0ms;");
    expect(reducedMotionBlock).toContain("--motion-normal: 0ms;");
    expect(reducedMotionBlock).toContain("--motion-slow: 0ms;");
  });
});
