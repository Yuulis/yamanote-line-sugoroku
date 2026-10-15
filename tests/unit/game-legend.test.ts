import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameLegend, type LegendLine } from "../../src/features/game/components/GameLegend";
import {
  defaultLegendExpanded,
  PHONE_LEGEND_MAX_EXPANDED_ROWS,
} from "../../src/features/game/components/legendCollapse";
import { validService } from "./fixtures/railway";

function legendLines(count: number): LegendLine[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `line-${index}`,
    name: `路線${index}`,
    color: "#112233",
    services: [{ ...validService, id: `service-${index}`, name: `系統${index}` }],
  }));
}

function render(count: number): string {
  return renderToStaticMarkup(createElement(GameLegend, { lines: legendLines(count), targetColor: "#80c241" }));
}

function stubViewport(phone: boolean): void {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: phone }) });
}

afterEach(() => vi.unstubAllGlobals());

describe("defaultLegendExpanded", () => {
  it("expands on desktop whatever the length", () => {
    expect(defaultLegendExpanded(2, false)).toBe(true);
    expect(defaultLegendExpanded(39, false)).toBe(true);
  });

  it("collapses on a phone only past the row threshold", () => {
    expect(defaultLegendExpanded(PHONE_LEGEND_MAX_EXPANDED_ROWS, true)).toBe(true);
    expect(defaultLegendExpanded(PHONE_LEGEND_MAX_EXPANDED_ROWS + 1, true)).toBe(false);
  });
});

describe("GameLegend", () => {
  it("starts expanded when there is no browser window to measure", () => {
    const markup = render(10);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('hidden=""');
  });

  it("starts a long legend collapsed on a phone while keeping progress and the current position shown", () => {
    stubViewport(true);
    const markup = render(10);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="game-legend"');
    expect(markup.match(/<li hidden=""/g)).toHaveLength(10);
    expect(markup).toMatch(/<li><span[^>]*><\/span>山手線 踏破済み（実線）<\/li>/);
    expect(markup).toMatch(/<li><span[^>]*><\/span>山手線 未踏破（点線）<\/li>/);
    expect(markup).toMatch(/<li><span[^>]*><\/span>現在地<\/li>/);
  });

  it("starts a short legend expanded on a phone", () => {
    stubViewport(true);
    const markup = render(PHONE_LEGEND_MAX_EXPANDED_ROWS);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('hidden=""');
  });

  it("names the toggle after the legend and the line count", () => {
    expect(render(3)).toMatch(/<button[^>]*>.*路線の凡例（3路線）<\/button>/);
  });

  it("omits the toggle when no other line is listed", () => {
    expect(render(0)).not.toContain("<button");
  });
});
