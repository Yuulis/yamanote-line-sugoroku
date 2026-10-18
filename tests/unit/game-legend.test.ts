import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameLegend, type LegendLine } from "../../src/features/game/components/GameLegend";
import {
  defaultLegendExpanded,
  MAX_EXPANDED_LEGEND_GROUPS,
} from "../../src/features/game/components/legendCollapse";

function legendLines(count: number): LegendLine[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `line-${index}`,
    name: `路線${index}`,
    color: "#112233",
    operatorId: "事業者",
    serviceIds: [`service-${index}`],
  }));
}

function render(count: number): string {
  return renderToStaticMarkup(createElement(GameLegend, {
    lines: legendLines(count),
    targetColor: "#80c241",
    selectedGroupIds: null,
  }));
}

describe("defaultLegendExpanded", () => {
  it("expands short lists and collapses large lists on every viewport", () => {
    expect(defaultLegendExpanded(2)).toBe(true);
    expect(defaultLegendExpanded(39)).toBe(false);
  });

  it("collapses beyond the compact list threshold", () => {
    expect(defaultLegendExpanded(MAX_EXPANDED_LEGEND_GROUPS)).toBe(true);
    expect(defaultLegendExpanded(MAX_EXPANDED_LEGEND_GROUPS + 1)).toBe(false);
  });
});

describe("GameLegend", () => {
  it("starts short lists expanded", () => {
    const markup = render(3);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('id="game-legend-groups" class="game-panel__legend-groups" hidden=""');
  });

  it("starts a long legend collapsed while keeping progress and current position shown", () => {
    const markup = render(10);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="game-legend-groups"');
    expect(markup).toContain('id="game-legend-groups" class="game-panel__legend-groups" hidden=""');
    expect(markup).toMatch(/<li><span[^>]*><\/span>山手線 踏破済み（実線）<\/li>/);
    expect(markup).toMatch(/<li><span[^>]*><\/span>山手線 未踏破（点線）<\/li>/);
    expect(markup).toMatch(/<li><span[^>]*><\/span>現在地<\/li>/);
    expect(markup).toContain("現在地・乗車中の路線・山手線の進捗は常に表示します。");
  });

  it("names the toggle after the legend and line count", () => {
    expect(render(3)).toMatch(/<button[^>]*>.*路線の凡例（3路線）<\/button>/);
  });

  it("omits line controls when no group is listed", () => {
    const markup = render(0);
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("すべて表示");
  });

  it("renders one selectable row per UI line group under its operator", () => {
    const markup = renderToStaticMarkup(createElement(GameLegend, {
      lines: [{
        id: "toei-oedo",
        name: "大江戸線",
        color: "#cc0066",
        operatorId: "東京都交通局",
        serviceIds: ["toei-oedo-loop", "toei-oedo-radial"],
      }],
      targetColor: "#9ACD32",
      selectedGroupIds: null,
      onToggleGroup: () => {},
      onSetOperator: () => {},
      onShowAll: () => {},
    }));

    expect(markup).toContain("東京都交通局");
    expect(markup).toContain("大江戸線");
    expect(markup.match(/aria-label="大江戸線を表示"/g)).toHaveLength(1);
    expect(markup).not.toContain("toei-oedo-loop");
    expect(markup).not.toContain("toei-oedo-radial");
    expect(markup).toContain("すべて表示");
    expect(markup).toContain("現在地・乗車中の路線・山手線の進捗は常に表示します。");
  });

  it("marks an operator select-all checkbox mixed when only some lines are visible", () => {
    const markup = renderToStaticMarkup(createElement(GameLegend, {
      lines: [
        { id: "a", name: "A線", color: "#112233", operatorId: "事業者", serviceIds: ["a"] },
        { id: "b", name: "B線", color: "#445566", operatorId: "事業者", serviceIds: ["b"] },
      ],
      targetColor: "#9ACD32",
      selectedGroupIds: new Set(["a"]),
      onToggleGroup: () => {},
      onSetOperator: () => {},
      onShowAll: () => {},
    }));

    expect(markup).toContain('aria-label="事業者の路線をすべて表示"');
    expect(markup).toContain('aria-checked="mixed"');
  });

  it("starts a regional legend collapsed on desktop as well", () => {
    const markup = renderToStaticMarkup(createElement(GameLegend, {
      lines: legendLines(134),
      targetColor: "#9ACD32",
      selectedGroupIds: null,
      onToggleGroup: () => {},
      onSetOperator: () => {},
      onShowAll: () => {},
    }));
    expect(markup).toContain('aria-expanded="false"');
  });
});
