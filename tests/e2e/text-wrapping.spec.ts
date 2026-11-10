import { expect, test } from "./fixtures";
import { expectSingleLine, measureTextLayout } from "./support/layout";

test("layout measurement", async ({ page }, testInfo) => {
  await page.setContent(`<!doctype html>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      .fixture { box-sizing: border-box; overflow-wrap: normal; }
      #one { width: 200px; font-size: 16px; line-height: 20px; }
      #wrap { width: 90px; font-size: 16px; line-height: 20px; }
      #clamp {
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
        overflow: hidden; width: 90px; height: 34px; font-size: 15px; line-height: 17px;
      }
      #normal { width: 100px; font-size: 16px; line-height: normal; }
      #unicode { width: 18px; font: 16px/20px monospace; }
      #overlong { box-sizing: border-box; width: 50px; height: 20px; overflow: hidden; white-space: nowrap; font: 16px/20px monospace; }
      #clip-host { width: 75px; height: 20px; overflow: hidden; }
      #clip-target { width: 200px; white-space: nowrap; font: 16px/20px monospace; }
    </style>
    <div id="one" class="fixture">one line</div>
    <div id="wrap" class="fixture">Wrap these words across the line</div>
    <div id="clamp" class="fixture">Alpha Beta Gamma Delta Epsilon Zeta</div>
    <div id="normal" class="fixture">button uses normal line-height</div>
    <div id="unicode" class="fixture">A<wbr>😀<wbr>B</div>
    <div id="overlong" class="fixture">UNBREAKABLETOKEN</div>
    <div id="clip-host"><div id="clip-target">ABCDEFGHIJKLMN</div></div>
    <button id="button">OK</button>`);

  const oneLine = await measureTextLayout(page.locator("#one"));
  expect(oneLine).toMatchObject({
    text: "one line",
    widthFits: true,
    rawLineCount: 1,
    visibleLineCount: 1,
    lineHeight: 20,
    fontSize: 16,
    height: 20,
    clampCount: 0,
    contentExcess: { width: 0, height: 0 },
    breakOffsets: [],
    hintOffsets: [],
  });
  await expectSingleLine(page.locator("#button"));

  const wrapped = await measureTextLayout(page.locator("#wrap"));
  expect(wrapped.text).toBe("Wrap these words across the line");
  expect(wrapped.rawLineCount).toBeGreaterThan(1);
  expect(wrapped.breakOffsets.length).toBeGreaterThan(0);

  const clamped = await measureTextLayout(page.locator("#clamp"));
  expect(clamped).toMatchObject({ height: 34, lineHeight: 17, clampCount: 2 });
  expect(clamped.visibleLineCount).toBeLessThanOrEqual(2);
  const clampScreenshot: string = testInfo.outputPath("two-line-clamp-paint.png");
  await page.locator("#clamp").screenshot({ path: clampScreenshot });
  await testInfo.attach("two-line-clamp-paint", { path: clampScreenshot, contentType: "image/png" });

  await expect(measureTextLayout(page.locator("#normal")))
    .rejects.toThrow(/finite positive pixel line-height.*normal/i);

  const unicode = await measureTextLayout(page.locator("#unicode"));
  expect(unicode.text).toBe("A😀B");
  expect(unicode.hintOffsets).toEqual([1, 3]);
  expect(unicode.breakOffsets).not.toContain(2);

  const overlong = await measureTextLayout(page.locator("#overlong"));
  expect(overlong.widthFits).toBe(false);
  expect(overlong.contentExcess.width).toBeGreaterThan(0);
  expect(overlong.height).toBe(20);

  const clipped = await measureTextLayout(page.locator("#clip-target"));
  expect(clipped.visibleGlyphRectCount).toBeGreaterThan(0);
  expect(clipped.partiallyVisibleGlyphRectCount).toBeGreaterThan(0);
  expect(clipped.fullyContainedGlyphRectCount).toBeGreaterThan(0);
  expect(clipped.visibleGlyphRectCount).toBeLessThan(clipped.glyphRectCount);
});
