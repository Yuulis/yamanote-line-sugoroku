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
    const TOP_TOLERANCE = 1;
    const MIN_SIZE = 0;
    const PIXEL_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)px$/;
    await document.fonts.ready;
    if (!(target instanceof HTMLElement)) throw new Error("Text layout target must be an HTML element");

    const style = getComputedStyle(target);
    const rawText: string = target.textContent ?? "";
    const glyphRects: Array<{ offset: number; rect: DOMRect }> = [];
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
      ancestor = ancestor.parentElement;
    }

    const intersects: (rect: DOMRect) => boolean = (rect) => clips.every((clip) =>
      (!clip.clipX || (rect.right > clip.left && rect.left < clip.right))
      && (!clip.clipY || (rect.bottom > clip.top && rect.top < clip.bottom)));
    const contained: (rect: DOMRect) => boolean = (rect) => clips.every((clip) =>
      (!clip.clipX || (rect.left >= clip.left && rect.right <= clip.right))
      && (!clip.clipY || (rect.top >= clip.top && rect.bottom <= clip.bottom)));
    const lineCount: (tops: number[]) => number = (tops) => {
      const ordered: number[] = tops.sort((first, second) => first - second);
      let count: number = 0;
      let groupTop: number | null = null;
      for (const top of ordered) {
        if (groupTop === null || Math.abs(top - groupTop) > TOP_TOLERANCE) {
          count += 1;
          groupTop = top;
        }
      }
      return count;
    };

    const visibleRects = glyphRects.filter(({ rect }) => intersects(rect));
    const fullyContainedCount: number = glyphRects.filter(({ rect }) => contained(rect)).length;
    const breakOffsets: number[] = [];
    for (let index: number = 1; index < glyphRects.length; index += 1) {
      const previous = glyphRects[index - 1]!;
      const current = glyphRects[index]!;
      if (Math.abs(current.rect.top - previous.rect.top) > TOP_TOLERANCE
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
      rawLineCount: lineCount(glyphRects.map(({ rect }) => rect.top)),
      visibleLineCount: lineCount(visibleRects.map(({ rect }) => rect.top)),
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
