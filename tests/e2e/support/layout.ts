import { expect, type Locator } from "@playwright/test";

interface TextLayoutSnapshot {
  text: string;
  widthFits: boolean;
  rawLineCount: number;
  visibleLineCount: number;
  lineHeight: number | null;
  fontSize: number | null;
  height: number | null;
  clampCount: number | null;
  contentExcess: { width: number; height: number } | null;
  breakOffsets: number[];
  hintOffsets: number[];
  glyphRectCount: number;
  visibleGlyphRectCount: number;
  partiallyVisibleGlyphRectCount: number;
  fullyContainedGlyphRectCount: number;
}

export interface TextLayoutMeasurement extends Omit<
  TextLayoutSnapshot,
  "fontSize" | "height" | "clampCount" | "contentExcess"
> {
  fontSize: number;
  height: number;
  clampCount: number;
  contentExcess: { width: number; height: number };
  lineHeight: number;
}

async function collectTextLayout(locator: Locator, includeLineHeight: boolean): Promise<TextLayoutSnapshot> {
  const targetCount: number = await locator.count();
  if (targetCount !== 1) {
    throw new Error(`Text layout measurement expected one target, found ${targetCount}: ${locator.toString()}`);
  }

  return locator.evaluate(async (target, needsNumericLineHeight) => {
    const MIN_SIZE = 0;
    const PIXEL_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)px$/;
    await document.fonts.ready;
    if (!(target instanceof HTMLElement)) throw new Error("Text layout target must be an HTML element");

    const style = getComputedStyle(target);
    const rawText: string = target.textContent ?? "";
    type GlyphRect = { offset: number; rect: DOMRect };
    const glyphRects: GlyphRect[] = [];
    const textWalker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const range: Range = document.createRange();
    let textOffset: number = 0;
    let textNode: Node | null = textWalker.nextNode();

    while (textNode) {
      const value: string = textNode.textContent ?? "";
      if (value.trim().length > 0) {
        for (let localOffset: number = 0; localOffset < value.length;) {
          const codePoint: number = value.codePointAt(localOffset) ?? 0;
          const codeUnitLength: number = codePoint > 0xffff ? 2 : 1;
          range.setStart(textNode, localOffset);
          range.setEnd(textNode, localOffset + codeUnitLength);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > MIN_SIZE && rect.height > MIN_SIZE) {
              glyphRects.push({ offset: textOffset + localOffset, rect });
            }
          }
          localOffset += codeUnitLength;
        }
      }
      textOffset += value.length;
      textNode = textWalker.nextNode();
    }

    const hints: number[] = Array.from(target.querySelectorAll("wbr"), (hint) => {
      const hintRange: Range = document.createRange();
      hintRange.selectNodeContents(target);
      hintRange.setEndBefore(hint);
      return hintRange.toString().length;
    });

    const clips: Array<{
      left: number;
      right: number;
      top: number;
      bottom: number;
      clipX: boolean;
      clipY: boolean;
    }> = [{
      left: 0,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
      clipX: true,
      clipY: true,
    }];
    let ancestor: HTMLElement | null = target;
    while (ancestor) {
      const ancestorStyle = getComputedStyle(ancestor);
      const clipX: boolean = ["auto", "clip", "hidden", "scroll"].includes(ancestorStyle.overflowX);
      const clipY: boolean = ["auto", "clip", "hidden", "scroll"].includes(ancestorStyle.overflowY);
      if (clipX || clipY) {
        const box: DOMRect = ancestor.getBoundingClientRect();
        const left: number = box.left + ancestor.clientLeft;
        const top: number = box.top + ancestor.clientTop;
        clips.push({
          left,
          right: left + ancestor.clientWidth,
          top,
          bottom: top + ancestor.clientHeight,
          clipX,
          clipY,
        });
      }
      // Top-layer elements (modal dialogs, open popovers) paint above their DOM ancestors,
      // so ancestor scrollports beyond them do not clip what they contain.
      if (ancestor.matches(":modal, :popover-open")) break;
      ancestor = ancestor.parentElement;
    }

    // Glyph rects can extend a fraction of a pixel past their line box (Firefox paints the
    // font content area, not the line box), so a sub-pixel overlap with a clip is not a visible glyph.
    const PAINT_TOLERANCE = 1;
    const overlaps = (start: number, end: number, clipStart: number, clipEnd: number): boolean =>
      Math.min(end, clipEnd) - Math.max(start, clipStart) > PAINT_TOLERANCE;
    const within = (start: number, end: number, clipStart: number, clipEnd: number): boolean =>
      start >= clipStart - PAINT_TOLERANCE && end <= clipEnd + PAINT_TOLERANCE;
    const intersects: (rect: DOMRect) => boolean = (rect) => clips.every((clip) =>
      (!clip.clipX || overlaps(rect.left, rect.right, clip.left, clip.right))
      && (!clip.clipY || overlaps(rect.top, rect.bottom, clip.top, clip.bottom)));
    const contained: (rect: DOMRect) => boolean = (rect) => clips.every((clip) =>
      (!clip.clipX || within(rect.left, rect.right, clip.left, clip.right))
      && (!clip.clipY || within(rect.top, rect.bottom, clip.top, clip.bottom)));
    const groupLines = (rects: GlyphRect[]): { count: number; indices: Map<GlyphRect, number> } => {
      const ordered: GlyphRect[] = [...rects].sort((first, second) => first.rect.top - second.rect.top);
      const lines: Array<{ top: number; bottom: number; glyphs: GlyphRect[] }> = [];
      for (const glyph of ordered) {
        const center: number = (glyph.rect.top + glyph.rect.bottom) / 2;
        const currentLine = lines.at(-1);
        if (currentLine && center >= currentLine.top && center <= currentLine.bottom) {
          currentLine.top = Math.min(currentLine.top, glyph.rect.top);
          currentLine.bottom = Math.max(currentLine.bottom, glyph.rect.bottom);
          currentLine.glyphs.push(glyph);
        } else {
          lines.push({ top: glyph.rect.top, bottom: glyph.rect.bottom, glyphs: [glyph] });
        }
      }
      const indices = new Map<GlyphRect, number>();
      lines.forEach((line, lineIndex) => line.glyphs.forEach((glyph) => indices.set(glyph, lineIndex)));
      return { count: lines.length, indices };
    };

    const visibleRects = glyphRects.filter(({ rect }) => intersects(rect));
    // Range rectangles can overlap a clamp edge even when only their typographic box, not the
    // painted glyph, reaches the clipping area. Count a line as visible only when a glyph's
    // vertical center remains inside every clipping ancestor.
    const lineCenterVisibleRects = visibleRects.filter(({ rect }) => {
      const center: number = (rect.top + rect.bottom) / 2;
      return clips.every((clip) => !clip.clipY || (center >= clip.top && center <= clip.bottom));
    });
    const rawLines = groupLines(glyphRects);
    const visibleLines = groupLines(lineCenterVisibleRects);
    const fullyContainedCount: number = glyphRects.filter(({ rect }) => contained(rect)).length;
    const breakOffsets: number[] = [];
    for (let index: number = 1; index < glyphRects.length; index += 1) {
      const previous = glyphRects[index - 1]!;
      const current = glyphRects[index]!;
      if (rawLines.indices.get(current) !== rawLines.indices.get(previous)
        && breakOffsets.at(-1) !== current.offset) {
        breakOffsets.push(current.offset);
      }
    }

    const lineHeightText: string = needsNumericLineHeight ? style.lineHeight.trim() : "";
    const lineHeight: number | null = needsNumericLineHeight && PIXEL_PATTERN.test(lineHeightText)
      ? Number.parseFloat(lineHeightText)
      : null;
    if (needsNumericLineHeight && (lineHeight === null || !Number.isFinite(lineHeight) || lineHeight <= MIN_SIZE)) {
      const targetName: string = target.id ? `#${target.id}` : target.tagName.toLowerCase();
      throw new Error(
        `measureTextLayout requires a finite positive pixel line-height; received "${lineHeightText}" for ${targetName}`,
      );
    }

    const fontSize: number | null = needsNumericLineHeight ? Number.parseFloat(style.fontSize) : null;
    if (needsNumericLineHeight && (fontSize === null || !Number.isFinite(fontSize) || fontSize <= MIN_SIZE)) {
      throw new Error(`Text layout measurement requires a positive computed font size; received "${style.fontSize}"`);
    }
    const clampCount: number | null = needsNumericLineHeight
      ? Number.parseInt(style.getPropertyValue("-webkit-line-clamp") || style.getPropertyValue("line-clamp"), 10)
      : null;
    const box: DOMRect | null = needsNumericLineHeight ? target.getBoundingClientRect() : null;

    return {
      text: rawText,
      widthFits: target.scrollWidth <= target.clientWidth,
      rawLineCount: rawLines.count,
      visibleLineCount: visibleLines.count,
      lineHeight,
      fontSize,
      height: box?.height ?? null,
      clampCount: clampCount !== null && Number.isFinite(clampCount) && clampCount > 0 ? clampCount : 0,
      contentExcess: needsNumericLineHeight ? {
        width: Math.max(MIN_SIZE, target.scrollWidth - target.clientWidth),
        height: Math.max(MIN_SIZE, target.scrollHeight - target.clientHeight),
      } : null,
      breakOffsets,
      hintOffsets: hints,
      glyphRectCount: glyphRects.length,
      visibleGlyphRectCount: visibleRects.length,
      partiallyVisibleGlyphRectCount: visibleRects.length - fullyContainedCount,
      fullyContainedGlyphRectCount: fullyContainedCount,
    };
  }, includeLineHeight);
}

/** Measure text using its computed numeric line-height and painted clipping bounds. */
export async function measureTextLayout(locator: Locator): Promise<TextLayoutMeasurement> {
  const measurement: TextLayoutSnapshot = await collectTextLayout(locator, true);
  if (measurement.lineHeight === null) {
    throw new Error(`Text layout measurement did not return a numeric line-height: ${locator.toString()}`);
  }
  if (measurement.fontSize === null || measurement.height === null
    || measurement.clampCount === null || measurement.contentExcess === null) {
    throw new Error(`Text layout measurement is missing computed metrics: ${locator.toString()}`);
  }
  return {
    ...measurement,
    fontSize: measurement.fontSize,
    height: measurement.height,
    clampCount: measurement.clampCount,
    contentExcess: measurement.contentExcess,
    lineHeight: measurement.lineHeight,
  };
}

/** Assert a single visible line without requiring a numeric computed line-height. */
export async function expectSingleLine(locator: Locator): Promise<void> {
  const measurement: TextLayoutSnapshot = await collectTextLayout(locator, false);
  expect(measurement.rawLineCount, `${locator.toString()} should occupy one Range line`).toBe(1);
  expect(measurement.widthFits, `${locator.toString()} should fit its content width`).toBe(true);
  expect(
    measurement.fullyContainedGlyphRectCount,
    `${locator.toString()} should keep every glyph fully inside its clipping bounds`,
  ).toBe(measurement.glyphRectCount);
}
