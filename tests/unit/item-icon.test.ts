// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemIcon } from "../../src/features/game/components/ItemIcon";
import { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS, type ItemKind } from "../../src/types/network";

const ITEM_KINDS: readonly ItemKind[] = [...BENEFICIAL_ITEM_KINDS, ...HARMFUL_ITEM_KINDS];

describe("ItemIcon", () => {
  it("renders one decorative, self-contained SVG for every item kind", () => {
    for (const kind of ITEM_KINDS) {
      const markup: string = renderToStaticMarkup(createElement(ItemIcon, { kind }));
      const document: Document = new DOMParser().parseFromString(markup, "image/svg+xml");
      const svg: SVGSVGElement | null = document.querySelector("svg");

      expect(document.querySelectorAll("svg"), kind).toHaveLength(1);
      expect(svg?.getAttribute("aria-hidden"), kind).toBe("true");
      expect(svg?.getAttribute("focusable"), kind).toBe("false");
      expect(svg?.textContent, kind).toBe("");
      expect(document.querySelector("[id], title, text, use, image, [href], [xlink\\:href]"), kind).toBeNull();
      expect(svg?.querySelectorAll("path, circle, rect").length, kind).toBeGreaterThan(0);
      expect(svg?.querySelectorAll(".item-icon__accent, .item-icon__accent-stroke").length, kind).toBeGreaterThan(0);
    }
  });

  it("uses the requested dimensions and a currentColor outline", () => {
    const markup: string = renderToStaticMarkup(createElement(ItemIcon, { kind: "delay", size: 32 }));

    expect(markup).toContain('width="32"');
    expect(markup).toContain('height="32"');
    expect(markup).toContain('stroke="currentColor"');
    // No inline accent value, so a container's --item-icon-accent reaches the drawing.
    expect(markup).not.toContain("style=");
    expect(markup).not.toContain("--item-icon-accent");
  });
});
