import type { Page } from "@playwright/test";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState } from "../../src/types/network";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { diceButton, gamePanel, openTitle, panelStat, startNewGame, writeSaveText } from "./support/app";
import { expectSingleLine, measureTextLayout } from "./support/layout";

const PHONE_HUD_TARGET_BUDGET_PX = 252;
const PHONE_HUD_MAX_HEIGHT_RATIO = 0.45;
const PHONE_HUD_STATS_HEIGHT_PX = 104;
const PHONE_HUD_LABEL_HEIGHT_PX = 18;
const PHONE_HUD_LABEL_FONT_SIZE_PX = 13;
const PHONE_HUD_VALUE_FONT_SIZE_PX = 15;
const PHONE_HUD_VALUE_LINE_HEIGHT_PX = 17;
const PHONE_HUD_TWO_LINE_HEIGHT_PX = 34;
const DESKTOP_HUD_ROW_HEIGHT_PX = 24;
const SHORT_LANDSCAPE_HUD_ROW_HEIGHT_PX = 18;
const PHONE_BREAKPOINT_WIDTH_PX = 600;
const BREAKPOINT_TEST_HEIGHT_PX = 844;
const LONG_RIDE_SEED_LIMIT = 64;
const LONG_RIDE_TURN_LIMIT = 12;
const LONG_RIDE_MINIMUM_LENGTH = 5;
const HUD_INVENTORY_SLOT_COUNT = 3;
const HUD_INVENTORY_SLOT_HEIGHT_PX = 56;
const HUD_INTERACTIVE_TARGET_MINIMUM_PX = 44;
const HUD_DICE_POSITION_TOLERANCE_PX = 1;
// Same sub-pixel allowance as the existing 45% checks in ui-pop.spec.ts and capital-region.spec.ts.
const PANEL_HEIGHT_TOLERANCE_PX = 1;
const HUD_BUDGET_VERTICAL_GRID_GAPS = 2;
const NARROW_PHONE_VIEWPORT = { width: 320, height: 568 } as const;
const TALL_PHONE_VIEWPORT = { width: 412, height: 839 } as const;
const SHORT_LANDSCAPE_VIEWPORT = { width: 667, height: 375 } as const;
const PHONE_HUD_STATS_ROWS = [
  `${PHONE_HUD_LABEL_HEIGHT_PX}px`,
  `${PHONE_HUD_TWO_LINE_HEIGHT_PX}px`,
  `${PHONE_HUD_TWO_LINE_HEIGHT_PX}px`,
  `${PHONE_HUD_LABEL_HEIGHT_PX}px`,
];
const SHORT_LANDSCAPE_STATS_ROWS = Array.from(
  { length: 3 },
  () => `${SHORT_LANDSCAPE_HUD_ROW_HEIGHT_PX}px`,
);

function fixedHeight(heightPx: number) {
  const height: string = `${heightPx}px`;
  return { height, minHeight: height, maxHeight: height };
}

test.use({ dataset: "real", reducedMotion: "reduce" });

function longRideGame(bundle: RailwayBundle): ItemGameState {
  for (let seedValue: number = 0; seedValue < LONG_RIDE_SEED_LIMIT; seedValue += 1) {
    const seed: string = seedValue.toString(16).padStart(32, "0");
    let game: ItemGameState = createItemGame(ITEM_GAME_CONFIG, seed, bundle.network);
    for (let turnIndex: number = 0; turnIndex < LONG_RIDE_TURN_LIMIT && game.status === "playing"; turnIndex += 1) {
      const name: string = bundle.network.servicesById.get(game.currentServiceId)?.name ?? "";
      if (game.turn > 0 && name.length >= LONG_RIDE_MINIMUM_LENGTH) return game;
      const result = playItemTurn(game, {}, bundle.network).state;
      game = result.pending?.kind === "discard"
        ? resolveItemDiscard(result, result.pending.item.id).state
        : result;
    }
  }
  throw new Error("Expected a seeded game for the long-text HUD fixture");
}

async function restoreGame(page: Page, game: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

async function measurePhoneHudBudget(page: Page) {
  return page.evaluate(({ heightRatio, verticalGridGaps }) => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const stats = panel?.querySelector<HTMLElement>(".game-panel__stats");
    const actions = panel?.querySelector<HTMLElement>(".game-panel__actions");
    const inventory = panel?.querySelector<HTMLElement>(".item-inventory");
    const heading = inventory?.querySelector<HTMLElement>(".item-inventory__header");
    const dice = panel?.querySelector<HTMLElement>(".game-panel__roll");
    if (!panel || !stats || !actions || !inventory || !heading || !dice) throw new Error("Phone HUD budget targets are missing");
    const style = (element: HTMLElement) => getComputedStyle(element);
    const edges = (element: HTMLElement, prefix: "margin" | "padding" | "border") => {
      const computed = style(element);
      const value = (edge: "Top" | "Right" | "Bottom" | "Left") => Number.parseFloat(computed[`${prefix}${edge}${prefix === "border" ? "Width" : ""}` as keyof CSSStyleDeclaration] as string);
      return [value("Top"), value("Right"), value("Bottom"), value("Left")];
    };
    const rect = (element: Element) => element.getBoundingClientRect();
    const panelRect = rect(panel);
    const slots = Array.from(inventory.querySelectorAll<HTMLElement>(".item-slot"), rect);
    const targets = Array.from(panel.querySelectorAll<HTMLElement>(".game-panel__actions button, .item-slot__button"), rect);
    const padding = edges(panel, "padding");
    const border = edges(panel, "border");
    const statsMargins = edges(stats, "margin");
    const actionMargins = edges(actions, "margin");
    const inventoryMargins = edges(inventory, "margin");
    const parts = {
      padding: padding[0]! + padding[2]!,
      border: border[0]! + border[2]!,
      stats: rect(stats).height,
      statsMargins: statsMargins[0]! + statsMargins[2]!,
      statsGaps: style(stats).gap,
      actions: rect(actions).height,
      actionMargins: actionMargins[0]! + actionMargins[2]!,
      inventory: rect(inventory).height,
      inventoryMargins: inventoryMargins[0]! + inventoryMargins[2]!,
      panelGaps: Number.parseFloat(style(panel).rowGap) * verticalGridGaps,
    };
    return {
      budget: parts.padding + parts.border + parts.stats + parts.statsMargins + parts.actions
        + parts.actionMargins + parts.inventory + parts.inventoryMargins + parts.panelGaps,
      parts,
      panelHeight: panelRect.height,
      panelLimit: window.innerHeight * heightRatio,
      horizontalFit: panel.scrollWidth <= panel.clientWidth,
      scrollTop: panel.scrollTop,
      scrollport: { top: panelRect.top + panel.clientTop, bottom: panelRect.top + panel.clientTop + panel.clientHeight },
      heading: rect(heading),
      slots: slots.map(({ top, bottom, height }) => ({ top, bottom, height })),
      targets: targets.map(({ width, height }) => ({ width, height })),
      rows: style(stats).gridTemplateRows.split(" "),
      dice: { offset: rect(dice).top - panelRect.top, viewportY: rect(dice).top },
    };
  }, { heightRatio: PHONE_HUD_MAX_HEIGHT_RATIO, verticalGridGaps: HUD_BUDGET_VERTICAL_GRID_GAPS });
}

async function expectPhoneHudState(page: Page, viewport: { width: number; height: number }, state: string) {
  const measurement = await measurePhoneHudBudget(page);
  const details = `${viewport.width}x${viewport.height} ${state}: ${JSON.stringify(measurement)}`;
  expect(measurement.rows, details).toEqual(PHONE_HUD_STATS_ROWS);
  expect(measurement.budget, details).toBe(PHONE_HUD_TARGET_BUDGET_PX);
  expect(measurement.panelHeight, details).toBeLessThanOrEqual(measurement.panelLimit + PANEL_HEIGHT_TOLERANCE_PX);
  expect(measurement.horizontalFit, details).toBe(true);
  expect(measurement.scrollTop, details).toBe(0);
  expect(measurement.slots, details).toHaveLength(HUD_INVENTORY_SLOT_COUNT);
  expect(measurement.slots.every((slot) => Math.abs(slot.height - HUD_INVENTORY_SLOT_HEIGHT_PX) <= 1
    && slot.top >= measurement.scrollport.top && slot.bottom <= measurement.scrollport.bottom), details).toBe(true);
  expect(measurement.heading.top, details).toBeGreaterThanOrEqual(measurement.scrollport.top);
  expect(measurement.heading.bottom, details).toBeLessThanOrEqual(measurement.scrollport.bottom);
  expect(measurement.targets.every((target) => target.width >= HUD_INTERACTIVE_TARGET_MINIMUM_PX
    && target.height >= HUD_INTERACTIVE_TARGET_MINIMUM_PX), details).toBe(true);
  for (const label of ["乗車中", "進行方向"]) {
    const value = panelStat(page, label);
    const layout = await measureTextLayout(value);
    expect(layout.text, `${details}; ${label}`).toBe(await value.getAttribute("title"));
    expect(layout).toMatchObject({
      fontSize: PHONE_HUD_VALUE_FONT_SIZE_PX,
      lineHeight: PHONE_HUD_VALUE_LINE_HEIGHT_PX,
      height: PHONE_HUD_TWO_LINE_HEIGHT_PX,
      clampCount: 2,
    });
    expect(layout.visibleLineCount, `${details}; ${label}`).toBeLessThanOrEqual(2);
    expect(layout.widthFits, `${details}; ${label}`).toBe(true);
  }
  await expect(diceButton(page)).toHaveText("サイコロを振る");
  return { offset: measurement.dice.offset, viewportY: measurement.dice.viewportY };
}

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

test("phone HUD budget", async ({ page, railwayBundle }) => {
  const longRide: ItemGameState = longRideGame(railwayBundle);
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  await openTitle(page);
  await startNewGame(page);
  const idleNarrow = await expectPhoneHudState(page, NARROW_PHONE_VIEWPORT, "idle");
  await page.setViewportSize(TALL_PHONE_VIEWPORT);
  const idleTall = await expectPhoneHudState(page, TALL_PHONE_VIEWPORT, "idle");

  await restoreGame(page, longRide);
  const longTall = await expectPhoneHudState(page, TALL_PHONE_VIEWPORT, "long ride");
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  const longNarrow = await expectPhoneHudState(page, NARROW_PHONE_VIEWPORT, "long ride");

  for (const [width, idle, long] of [
    [NARROW_PHONE_VIEWPORT.width, idleNarrow, longNarrow],
    [TALL_PHONE_VIEWPORT.width, idleTall, longTall],
  ] as const) {
    expect(Math.abs(idle.offset - long.offset), `${width}px dice offset`).toBeLessThanOrEqual(HUD_DICE_POSITION_TOLERANCE_PX);
    expect(Math.abs(idle.viewportY - long.viewportY), `${width}px dice viewport position`)
      .toBeLessThanOrEqual(HUD_DICE_POSITION_TOLERANCE_PX);
  }
});

test("HUD breakpoint isolation", async ({ page }) => {
  await page.setViewportSize({ width: PHONE_BREAKPOINT_WIDTH_PX, height: BREAKPOINT_TEST_HEIGHT_PX });
  await openTitle(page);
  await startNewGame(page);
  const phoneLayout = await readHudBreakpointLayout(page);
  expect(phoneLayout.statsRows).toEqual(PHONE_HUD_STATS_ROWS);
  expect(phoneLayout.statsHeight).toBe(PHONE_HUD_STATS_HEIGHT_PX);
  expect(phoneLayout.rideLabel).toMatchObject({
    ...fixedHeight(PHONE_HUD_LABEL_HEIGHT_PX),
    lineHeight: `${PHONE_HUD_LABEL_HEIGHT_PX}px`, fontSize: `${PHONE_HUD_LABEL_FONT_SIZE_PX}px`,
  });
  expect(phoneLayout.rideRow).toMatchObject({ ...fixedHeight(PHONE_HUD_TWO_LINE_HEIGHT_PX), alignItems: "flex-start" });
  expect(phoneLayout.directionRow).toMatchObject({ ...fixedHeight(PHONE_HUD_TWO_LINE_HEIGHT_PX), gridColumnStart: "2" });
  expect(phoneLayout.directionWidth).toBeLessThan(phoneLayout.statsWidth / 2);
  expect(phoneLayout.rollColumn).toBe("4");
  expect(phoneLayout.rideValue).toMatchObject({
    ...fixedHeight(PHONE_HUD_TWO_LINE_HEIGHT_PX),
    fontSize: `${PHONE_HUD_VALUE_FONT_SIZE_PX}px`, lineHeight: `${PHONE_HUD_VALUE_LINE_HEIGHT_PX}px`, clamp: "2", whiteSpace: "normal",
  });
  expect(phoneLayout.stationValue).toMatchObject({
    fontSize: `${PHONE_HUD_VALUE_FONT_SIZE_PX}px`, lineHeight: `${PHONE_HUD_LABEL_HEIGHT_PX}px`, whiteSpace: "nowrap",
  });

  await page.setViewportSize({ width: PHONE_BREAKPOINT_WIDTH_PX + 1, height: BREAKPOINT_TEST_HEIGHT_PX });
  const desktopLayout = await readHudBreakpointLayout(page);
  expect(desktopLayout.rideRow.height).toBe(`${DESKTOP_HUD_ROW_HEIGHT_PX}px`);
  expect(desktopLayout.directionRow.height).toBe(`${DESKTOP_HUD_ROW_HEIGHT_PX}px`);
  expect(desktopLayout.rideValue.whiteSpace).toBe("nowrap");
  expect(desktopLayout.rideValue.clamp).not.toBe("2");

  await page.setViewportSize(SHORT_LANDSCAPE_VIEWPORT);
  const landscapeLayout = await readHudBreakpointLayout(page);
  expect(landscapeLayout.statsRows).toEqual(SHORT_LANDSCAPE_STATS_ROWS);
  expect(landscapeLayout.rideRow.height).toBe(`${SHORT_LANDSCAPE_HUD_ROW_HEIGHT_PX}px`);
  expect(landscapeLayout.directionRow.height).toBe(`${SHORT_LANDSCAPE_HUD_ROW_HEIGHT_PX}px`);
  expect(landscapeLayout.rideValue.whiteSpace).toBe("nowrap");
  expect(landscapeLayout.rideValue.clamp).not.toBe("2");
  await expectSingleLine(diceButton(page));
  for (const value of [landscapeLayout.rideValue, landscapeLayout.directionValue]) {
    expect(value.lineCount).toBe(1);
    expect(value.title).toBe(value.text);
    expect(value).toMatchObject({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
  }
});

async function readHudBreakpointLayout(page: Page) {
  return page.evaluate(() => {
    const stats = document.querySelector<HTMLElement>(".game-panel__stats");
    if (!stats) throw new Error("Missing HUD breakpoint measurement target");
    const labels: HTMLElement[] = Array.from(stats.querySelectorAll<HTMLElement>("dt"));
    const rows: HTMLElement[] = Array.from(stats.querySelectorAll<HTMLElement>("dd"));
    const styleOf = (element: HTMLElement) => {
      const style: CSSStyleDeclaration = getComputedStyle(element);
      const range: Range = document.createRange();
      range.selectNodeContents(element);
      return {
        height: style.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        alignItems: style.alignItems,
        gridColumnStart: style.gridColumnStart,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        clamp: style.getPropertyValue("-webkit-line-clamp").trim(),
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        text: element.textContent ?? "",
        title: element.getAttribute("title"),
        lineCount: new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size,
      };
    };
    const statsStyle: CSSStyleDeclaration = getComputedStyle(stats);
    const directionRect = rows[2]!.getBoundingClientRect();
    return {
      statsHeight: stats.getBoundingClientRect().height,
      statsWidth: stats.getBoundingClientRect().width,
      directionWidth: directionRect.width,
      statsRows: statsStyle.gridTemplateRows.split(" "),
      rideLabel: styleOf(labels[1]!),
      rideRow: styleOf(rows[1]!),
      directionRow: styleOf(rows[2]!),
      rollColumn: getComputedStyle(rows[5]!).gridColumnStart,
      rideValue: styleOf(stats.querySelector<HTMLElement>('[data-stat="ride"]')!),
      directionValue: styleOf(stats.querySelector<HTMLElement>('[data-stat="direction"]')!),
      stationValue: styleOf(stats.querySelector<HTMLElement>('[data-stat="station"]')!),
    };
  });
}
