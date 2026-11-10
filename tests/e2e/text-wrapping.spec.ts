import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { nextStationId, restoreGame as restoreSavedGame, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState } from "../../src/types/network";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { longestRideState, longestDirectionState, longLineLotteryState } from "./support/textWrappingState";
import { createGame as createProductGame, playTurn as playProductTurn } from "./fixtures/productGame";
import { itemScenario } from "./fixtures/itemScenarios";
import { PRODUCT_HISTORY_GAME_SEED, PRODUCT_HISTORY_SCENARIO_TURNS } from "./fixtures/seeds";
import { diceButton, gamePanel, openTitle, panelStat, readSave, startNewGame, useInventoryItem, writeSaveText, rollOnce } from "./support/app";
import { expectSingleLine, measureTextLayout } from "./support/layout";

const PHONE_HUD_TARGET_BUDGET_PX = 252;
const PHONE_HUD_MAX_HEIGHT_RATIO = 0.45;
const PHONE_HUD_STATS_HEIGHT_PX = 104;
const PHONE_HUD_LABEL_HEIGHT_PX = 18;
const PHONE_HUD_LABEL_FONT_SIZE_PX = 13;
const PHONE_HUD_VALUE_FONT_SIZE_PX = 15;
const PHONE_HUD_VALUE_LINE_HEIGHT_PX = 17;
const PHONE_HUD_TWO_LINE_HEIGHT_PX = 34;
const PHONE_HUD_MAX_VISIBLE_LINES = 2;
const PHONE_HUD_SINGLE_LINE_COUNT = 1;
const DESKTOP_HUD_ROW_HEIGHT_PX = 24;
const SHORT_LANDSCAPE_HUD_ROW_HEIGHT_PX = 18;
const PHONE_BREAKPOINT_WIDTH_PX = 600;
const BREAKPOINT_TEST_HEIGHT_PX = 844;
const DESKTOP_TEXT_VIEWPORT = { width: 1280, height: 800 } as const;
const FALLBACK_TEXT_VIEWPORT = { width: 390, height: 844 } as const;
const LONGEST_TEXT_TEST_TIMEOUT_MS = 90_000;
const VISUAL_EVIDENCE_TEST_TIMEOUT_MS = 180_000;
const VISUAL_EVIDENCE_DIRECTORY = "/home/yuulis/yamanote-line-sugoroku/.claude/logs/screenshots/ttw-step7";
const HUD_INVENTORY_SLOT_COUNT = 3;
const HUD_INVENTORY_SLOT_HEIGHT_PX = 56;
const HUD_INTERACTIVE_TARGET_MINIMUM_PX = 44;
const HUD_DICE_POSITION_TOLERANCE_PX = 1;
// Same sub-pixel allowance as the existing 45% checks in ui-pop.spec.ts and capital-region.spec.ts.
const PANEL_HEIGHT_TOLERANCE_PX = 1;
const HUD_BUDGET_VERTICAL_GRID_GAPS = 2;
const NARROW_PHONE_VIEWPORT = { width: 320, height: 568 } as const;
const TALL_PHONE_VIEWPORT = { width: 412, height: 839 } as const;
const LONGEST_TEXT_VIEWPORTS = [NARROW_PHONE_VIEWPORT, TALL_PHONE_VIEWPORT, DESKTOP_TEXT_VIEWPORT] as const;
const SHORT_LANDSCAPE_VIEWPORT = { width: 667, height: 375 } as const;
const DIALOG_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
] as const;
const CLEAR_SCREEN_VIEWPORT = { width: 320, height: 568 } as const;
const CLEAR_HISTORY_PAGE_COUNT = 5;
const CLEAR_SCREEN_SUMMARY_TEXT = "山手線の外回り全30区間を踏破し、新橋に戻りました。";
const CLEAR_SCREEN_GOAL_ANNOUNCEMENT = "96ターン目：出目3（3マス、1駅移動、残り2は使わず）、新橋に到着。ゴールに到着しました。踏破 30/30";
const CLEAR_SCREEN_GOAL_HISTORY = "96ターン目 出目3（3マス、1駅移動、残り2は使わず）：有楽町・日比谷 → 新橋（山手線・外回り）。ゴールに到着しました";
const PANEL_CANDIDATE_MINIMUM = 5;
const PHONE_HUD_STATS_ROWS = [
  `${PHONE_HUD_LABEL_HEIGHT_PX}px`,
  `${PHONE_HUD_TWO_LINE_HEIGHT_PX}px`,
  `${PHONE_HUD_TWO_LINE_HEIGHT_PX}px`,
  `${PHONE_HUD_LABEL_HEIGHT_PX}px`,
];
const VALID_DIRECTION_VALUES = [-1, 1] as const;
const SHORT_LANDSCAPE_STATS_ROWS = Array.from(
  { length: 3 },
  () => `${SHORT_LANDSCAPE_HUD_ROW_HEIGHT_PX}px`,
);

function fixedHeight(heightPx: number) {
  const height: string = `${heightPx}px`;
  return { height, minHeight: height, maxHeight: height };
}

test.use({ dataset: "real", reducedMotion: "reduce" });

async function restoreGame(page: Page, game: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

interface CompletedHistoryScenario {
  beforeFinalTurn: ItemGameState;
  completedGame: ItemGameState;
}

function completedHistoryGame(bundle: RailwayBundle): CompletedHistoryScenario {
  let game: ItemGameState = createProductGame(ITEM_GAME_CONFIG, PRODUCT_HISTORY_GAME_SEED, bundle.network);
  let beforeFinalTurn: ItemGameState = game;
  while (game.status === "playing" && game.turn < PRODUCT_HISTORY_SCENARIO_TURNS.completed) {
    beforeFinalTurn = game;
    game = playProductTurn(game, bundle.network).state;
  }
  if (game.status !== "completed" || game.turn !== PRODUCT_HISTORY_SCENARIO_TURNS.completed) {
    throw new Error("Expected the product history game to reach its verified clear state");
  }
  return { beforeFinalTurn, completedGame: game };
}

function panelCandidateGame(bundle: RailwayBundle): ItemGameState {
  let game: ItemGameState = createProductGame(ITEM_GAME_CONFIG, PRODUCT_HISTORY_GAME_SEED, bundle.network);
  while (game.status === "playing" && game.turn < PRODUCT_HISTORY_SCENARIO_TURNS.completed) {
    const result = playProductTurn(game, bundle.network);
    game = result.state;
    if ((result.record.landingSnapshot?.services.length ?? 0) >= PANEL_CANDIDATE_MINIMUM) return game;
  }
  throw new Error("Expected the product history trajectory to reach a multi-candidate station");
}

async function expectNoHorizontalOverflow(locator: Locator): Promise<void> {
  const { clientWidth, scrollWidth } = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollWidth, `${locator.toString()} should not overflow horizontally`).toBeLessThanOrEqual(clientWidth);
}

async function expectPageNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentScrollWidth, "document should not overflow horizontally")
    .toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyScrollWidth, "body should not overflow horizontally")
    .toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function expectButtonsSingleLine(buttons: Locator): Promise<void> {
  const count: number = await buttons.count();
  for (let index: number = 0; index < count; index += 1) {
    const button: Locator = buttons.nth(index);
    await button.scrollIntoViewIfNeeded();
    await expectSingleLine(button);
  }
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
      clampCount: PHONE_HUD_MAX_VISIBLE_LINES,
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
      #mixed { width: 500px; font: 15px/17px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; }
      #mixed-two-lines { width: 500px; font: 15px/17px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; }
      #overlong { box-sizing: border-box; width: 50px; height: 20px; overflow: hidden; white-space: nowrap; font: 16px/20px monospace; }
      #clip-host { width: 75px; height: 20px; overflow: hidden; }
      #clip-target { width: 200px; white-space: nowrap; font: 16px/20px monospace; }
    </style>
    <div id="one" class="fixture">one line</div>
    <div id="wrap" class="fixture">Wrap these words across the line</div>
    <div id="clamp" class="fixture">Alpha Beta Gamma Delta Epsilon Zeta</div>
    <div id="normal" class="fixture">button uses normal line-height</div>
    <div id="unicode" class="fixture">A<wbr>😀<wbr>B</div>
    <div id="mixed" class="fixture">羽田第1ターミナルA12方面</div>
    <div id="mixed-two-lines" class="fixture">羽田第1ターミナルA12方面<br>成田第2ターミナルB34</div>
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

  const mixed = await measureTextLayout(page.locator("#mixed"));
  expect(mixed.text).toBe("羽田第1ターミナルA12方面");
  expect(mixed.rawLineCount, JSON.stringify(mixed)).toBe(1);
  expect(mixed.visibleLineCount, JSON.stringify(mixed)).toBe(1);
  expect(mixed.breakOffsets).toEqual([]);

  const mixedTwoLines = await measureTextLayout(page.locator("#mixed-two-lines"));
  expect(mixedTwoLines.text).toBe("羽田第1ターミナルA12方面成田第2ターミナルB34");
  expect(mixedTwoLines.rawLineCount, JSON.stringify(mixedTwoLines)).toBe(2);
  expect(mixedTwoLines.visibleLineCount, JSON.stringify(mixedTwoLines)).toBe(2);
  expect(mixedTwoLines.breakOffsets).toContain("羽田第1ターミナルA12方面".length);

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
  const longRide: ItemGameState = longestRideState(railwayBundle).game;
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

interface DiceLayoutPosition {
  offset: number;
  viewportY: number;
}

async function measureDiceLayoutPosition(page: Page): Promise<DiceLayoutPosition> {
  await expect(diceButton(page)).toHaveText("サイコロを振る");
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const button = document.querySelector<HTMLElement>(".game-panel__roll");
    if (!panel || !button) throw new Error("HUD panel or dice button is missing");
    const panelRect = panel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return { offset: buttonRect.y - panelRect.y, viewportY: buttonRect.y };
  });
}

async function expectLongestHudText(
  page: Page,
  label: "乗車中" | "進行方向",
  expectedText: string,
  viewportWidth: number,
): Promise<void> {
  const value: Locator = panelStat(page, label);
  await expect(value).toHaveText(expectedText);
  await expect(value).toHaveAttribute("title", expectedText);

  if (viewportWidth <= PHONE_BREAKPOINT_WIDTH_PX) {
    const layout = await measureTextLayout(value);
    expect(layout.text).toBe(expectedText);
    expect(layout).toMatchObject({
      fontSize: PHONE_HUD_VALUE_FONT_SIZE_PX,
      lineHeight: PHONE_HUD_VALUE_LINE_HEIGHT_PX,
      height: PHONE_HUD_TWO_LINE_HEIGHT_PX,
      clampCount: 2,
    });
    expect(layout.visibleLineCount, JSON.stringify(layout)).toBeLessThanOrEqual(PHONE_HUD_MAX_VISIBLE_LINES);
    expect(layout.widthFits).toBe(true);
    return;
  }

  const desktopLayout = await value.evaluate((element) => {
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      text: element.textContent ?? "",
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      lineTops: [...new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)))],
    };
  });
  expect(desktopLayout.text).toBe(expectedText);
  expect(desktopLayout.lineTops, JSON.stringify(desktopLayout)).toHaveLength(PHONE_HUD_SINGLE_LINE_COUNT);
  expect(desktopLayout.whiteSpace).toBe("nowrap");
  expect(desktopLayout.overflow).toBe("hidden");
  expect(desktopLayout.textOverflow).toBe("ellipsis");
}

async function expectRestoredTurnRoundTrip(page: Page, bundle: RailwayBundle, game: ItemGameState): Promise<void> {
  const turnBefore: number = game.turn;
  await rollOnce(page);
  const saved = await readSave(page);
  if (!saved) throw new Error("The completed turn did not leave a save");
  expect(saved.turn).toBe(turnBefore + 1);
  expect(saved.movementHistory).toHaveLength(saved.turn);
  expect(saved.pending).toBeNull();
  expect(VALID_DIRECTION_VALUES).toContain(saved.direction);
  const service = bundle.network.servicesById.get(saved.currentServiceId);
  expect(service).toBeDefined();
  expect(service?.stationIds).toContain(saved.currentStationId);
  expect(nextStationId(bundle.network, saved.currentServiceId, saved.currentStationId, saved.direction)).toBeDefined();

  const serialized: string = serializeGame(saved);
  expect(restoreSavedGame(serialized, bundle.network)).toEqual(saved);
  await writeSaveText(page, serialized);
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  if (saved.status === "completed") {
    await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
  } else {
    await expect(gamePanel(page)).toBeVisible();
  }
  expect(await readSave(page)).toEqual(saved);
}

test("longest text", async ({ page, railwayBundle }) => {
  test.setTimeout(LONGEST_TEXT_TEST_TIMEOUT_MS);
  const rideState = longestRideState(railwayBundle);
  const directionState = longestDirectionState(railwayBundle);
  const states = [rideState, directionState] as const;
  const idlePositions: DiceLayoutPosition[] = [];

  await openTitle(page);
  await startNewGame(page);
  for (const viewport of LONGEST_TEXT_VIEWPORTS) {
    await page.setViewportSize(viewport);
    idlePositions.push(await measureDiceLayoutPosition(page));
  }

  for (const state of states) {
    for (let viewportIndex: number = 0; viewportIndex < LONGEST_TEXT_VIEWPORTS.length; viewportIndex += 1) {
      const viewport = LONGEST_TEXT_VIEWPORTS[viewportIndex]!;
      await page.setViewportSize(viewport);
      await restoreGame(page, state.game);

      await expectLongestHudText(page, "乗車中", state.serviceName, viewport.width);
      await expectLongestHudText(page, "進行方向", state.directionLabel, viewport.width);
      await expectNoHorizontalOverflow(gamePanel(page));
      await expectPageNoHorizontalOverflow(page);

      const dicePosition = await measureDiceLayoutPosition(page);
      const idlePosition = idlePositions[viewportIndex]!;
      expect(Math.abs(dicePosition.offset - idlePosition.offset), `${state.kind} ${viewport.width}px panel offset`)
        .toBeLessThanOrEqual(HUD_DICE_POSITION_TOLERANCE_PX);
      expect(Math.abs(dicePosition.viewportY - idlePosition.viewportY), `${state.kind} ${viewport.width}px viewport position`)
        .toBeLessThanOrEqual(HUD_DICE_POSITION_TOLERANCE_PX);
    }

    await expectRestoredTurnRoundTrip(page, railwayBundle, state.game);
  }
});

test("fallback wrapping", async ({ page, railwayBundle }, testInfo) => {
  const state = longestRideState(railwayBundle);
  await page.setViewportSize(FALLBACK_TEXT_VIEWPORT);
  await restoreGame(page, state.game);

  const ride: Locator = panelStat(page, "乗車中");
  const layout = await measureTextLayout(ride);
  const wrapping = await ride.evaluate((element) => ({
    autoPhraseSupported: CSS.supports("word-break", "auto-phrase"),
    wordBreak: getComputedStyle(element).wordBreak,
    overflowWrap: getComputedStyle(element).overflowWrap,
  }));
  // HUD names use keep-all + PhraseText hints in every engine (auto-phrase ignores the hints when a phrase overflows).
  expect(wrapping.wordBreak).toBe("keep-all");
  expect(wrapping.overflowWrap).toBe("anywhere");
  expect(layout.text).toBe(state.serviceName);
  expect(layout.hintOffsets.length).toBeGreaterThan(0);
  expect(layout.widthFits).toBe(true);
  expect(layout.visibleLineCount).toBeLessThanOrEqual(2);
  await expectNoHorizontalOverflow(ride);
  await expectNoHorizontalOverflow(gamePanel(page));
  await expectPageNoHorizontalOverflow(page);
  testInfo.annotations.push({ type: "fallback CSS", description: JSON.stringify(wrapping) });

  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  const direction: Locator = panelStat(page, "進行方向");
  const directionLayout = await measureTextLayout(direction);
  expect(directionLayout.breakOffsets.length, JSON.stringify(directionLayout)).toBeGreaterThan(0);
  for (const offset of directionLayout.breakOffsets) {
    expect(directionLayout.hintOffsets, `break at ${offset} in ${directionLayout.text}`).toContain(offset);
  }
});

test("Step 7 visual evidence", async ({ page, railwayBundle }) => {
  test.skip(process.env.TTW_SCREENSHOTS !== "1", "visual evidence is generated only on explicit request");
  test.setTimeout(VISUAL_EVIDENCE_TEST_TIMEOUT_MS);
  mkdirSync(VISUAL_EVIDENCE_DIRECTORY, { recursive: true });

  for (const state of [longestRideState(railwayBundle), longestDirectionState(railwayBundle)]) {
    for (const viewport of LONGEST_TEXT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await restoreGame(page, state.game);
      const fileName = `${state.kind}-${viewport.width}x${viewport.height}.png`;
      await gamePanel(page).screenshot({ path: join(VISUAL_EVIDENCE_DIRECTORY, fileName) });
    }
  }

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const lotteryGame: ItemGameState = longLineLotteryState(railwayBundle);
  await restoreGame(page, lotteryGame);
  await diceButton(page).click();
  const lotteryReveal: Locator = page.locator(".lottery-reveal");
  const adjustmentDialog: Locator = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect(lotteryReveal.or(adjustmentDialog)).toBeVisible();
  if (await adjustmentDialog.isVisible()) {
    await adjustmentDialog.getByRole("button", { name: "そのまま続ける" }).click();
  }
  await expect(lotteryReveal).toBeVisible();
  await lotteryReveal.screenshot({ path: join(VISUAL_EVIDENCE_DIRECTORY, "lottery-reveal-long-line.png") });
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

test("dialog wrapping", async ({ page, railwayBundle }) => {
  // Two viewports, each restoring two saves and opening two native dialogs: about 28 s on a loaded
  // local Firefox, close to the default 30 s budget.
  test.slow();
  const routeGame: ItemGameState = itemScenario("route", railwayBundle.network);
  const adjustmentGame: ItemGameState = itemScenario("adjust", railwayBundle.network);

  for (const viewport of DIALOG_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await restoreGame(page, routeGame);
    await useInventoryItem(page, "路線指定券");

    const routeDialog = page.getByRole("dialog");
    await expect(routeDialog).toBeVisible();
    await expect(routeDialog.getByRole("heading")).toHaveAccessibleName("乗る路線を選ぶ");
    await expect(routeDialog.getByRole("radio").first()).toHaveAccessibleName(
      "山手線（山手線） 外回り：目黒、次の駅から山手線まで0駅。向きは固定です",
    );
    await expectButtonsSingleLine(routeDialog.locator(".dialog__actions button"));
    await expectNoHorizontalOverflow(routeDialog);
    await expectPageNoHorizontalOverflow(page);

    const guidanceOptions: Locator = routeDialog.locator(".item-route-option__guidance");
    const guidanceTexts: string[] = await guidanceOptions.allTextContents();
    expect(guidanceTexts.length).toBeGreaterThan(0);
    let longestGuidanceIndex: number = 0;
    for (let index: number = 1; index < guidanceTexts.length; index += 1) {
      if (guidanceTexts[index]!.length > guidanceTexts[longestGuidanceIndex]!.length) {
        longestGuidanceIndex = index;
      }
    }
    const longGuidance: ReturnType<typeof routeDialog.locator> = guidanceOptions.nth(longestGuidanceIndex);
    const guidanceLayout = await measureTextLayout(longGuidance);
    expect(guidanceLayout.text.length).toBeGreaterThan(0);
    expect(guidanceLayout.rawLineCount).toBeGreaterThan(1);
    expect(guidanceLayout.widthFits).toBe(true);
    expect(guidanceLayout.hintOffsets.length).toBeGreaterThan(0);

    await routeDialog.getByRole("button", { name: "キャンセル", exact: true }).click();
    await restoreGame(page, adjustmentGame);
    await diceButton(page).click();

    const adjustmentDialog = page.getByRole("dialog", { name: "出目を調整しますか？", exact: true });
    await expect(adjustmentDialog).toBeVisible();
    await expectButtonsSingleLine(adjustmentDialog.locator(".dialog__actions button"));
    await expectNoHorizontalOverflow(adjustmentDialog);
    await expectPageNoHorizontalOverflow(page);
  }
});

test("clear-screen wrapping", async ({ page, railwayBundle }) => {
  const { beforeFinalTurn, completedGame } = completedHistoryGame(railwayBundle);
  expect(completedGame.turn).toBe(PRODUCT_HISTORY_SCENARIO_TURNS.completed);
  await page.setViewportSize(CLEAR_SCREEN_VIEWPORT);
  await page.goto("/");
  await writeSaveText(page, serializeGame(beforeFinalTurn));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await diceButton(page).click();

  const clearScreen: Locator = page.getByRole("region", { name: "クリア！" });
  const historyItems: Locator = clearScreen.locator(".clear-screen__history li");
  const paging: Locator = clearScreen.getByRole("navigation", { name: "移動履歴のページ" });
  const summaryParagraph: Locator = clearScreen.locator(".clear-screen__summary");
  const goalAnnouncement: Locator = clearScreen.locator(".item-event-notice [role=status]");
  await expect(clearScreen).toBeVisible();
  await expect(summaryParagraph).toHaveText(CLEAR_SCREEN_SUMMARY_TEXT);
  const summaryLayout = await measureTextLayout(summaryParagraph);
  expect(summaryLayout.hintOffsets.length).toBeGreaterThan(0);
  expect(summaryLayout.text).toBe(CLEAR_SCREEN_SUMMARY_TEXT);
  expect(summaryLayout.widthFits).toBe(true);
  await expect(goalAnnouncement).toHaveText(CLEAR_SCREEN_GOAL_ANNOUNCEMENT);
  const goalAnnouncementWordBreak: string = await goalAnnouncement.evaluate(() =>
    CSS.supports("word-break", "auto-phrase") ? "auto-phrase" : "keep-all",
  );
  await expect(goalAnnouncement).toHaveCSS("word-break", goalAnnouncementWordBreak);
  await expectNoHorizontalOverflow(goalAnnouncement);
  await expect(historyItems).toHaveCount(20);
  await expect(historyItems.first()).toContainText("1ターン目");
  await expectButtonsSingleLine(paging.getByRole("button"));
  const actionColumns: string[] = await clearScreen.locator(".clear-screen__actions").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
  );
  expect(actionColumns).toHaveLength(1);
  await expect(paging).toHaveCSS("flex-wrap", "wrap");
  await expectNoHorizontalOverflow(clearScreen);
  await expectPageNoHorizontalOverflow(page);

  await paging.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(historyItems.first()).toContainText("21ターン目");
  await expect(paging.getByRole("status")).toHaveText("2 / 5ページ");
  await paging.getByRole("button", { name: "前のページ", exact: true }).click();
  await expect(historyItems.first()).toContainText("1ターン目");
  await expect(paging.getByRole("status")).toHaveText("1 / 5ページ");

  for (let pageIndex: number = 1; pageIndex < CLEAR_HISTORY_PAGE_COUNT; pageIndex += 1) {
    await paging.getByRole("button", { name: "次のページ", exact: true }).click();
  }
  await expect(paging.getByRole("status")).toHaveText("5 / 5ページ");
  const goalHistoryEntry: Locator = historyItems.last();
  const goalHistoryLayout = await measureTextLayout(goalHistoryEntry);
  expect(goalHistoryLayout.hintOffsets.length).toBeGreaterThan(0);
  expect(goalHistoryLayout.text).toBe(CLEAR_SCREEN_GOAL_HISTORY);
  expect(goalHistoryLayout.widthFits).toBe(true);
  await expectNoHorizontalOverflow(goalHistoryEntry);

  await expectButtonsSingleLine(clearScreen.locator(
    ".clear-screen__actions button, .clear-screen__share button, .clear-screen__paging button",
  ));
  await expectNoHorizontalOverflow(clearScreen);
  await expectPageNoHorizontalOverflow(page);
});

test("panel wrapping", async ({ page, railwayBundle }) => {
  const routeGame: ItemGameState = itemScenario("route", railwayBundle.network);
  await page.setViewportSize(NARROW_PHONE_VIEWPORT);
  await restoreGame(page, routeGame);
  await useInventoryItem(page, "路線指定券");

  const routeDialog: Locator = page.getByRole("dialog", { name: "乗る路線を選ぶ", exact: true });
  await routeDialog.getByRole("radio").first().check();
  await routeDialog.getByRole("button", { name: "この路線に決める", exact: true }).click();

  const panel: Locator = gamePanel(page);
  const stagedSummary: Locator = panel.locator(".item-staged-summary");
  await expect(stagedSummary).toBeVisible();
  expect(await stagedSummary.locator("wbr").count()).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(stagedSummary);

  await restoreGame(page, panelCandidateGame(railwayBundle));
  await panel.getByRole("button", { name: "ログ", exact: true }).click();
  const lotteryText: Locator = panel.locator(".game-panel__lottery");
  await expect(lotteryText).toBeVisible();
  const lotteryLayout = await measureTextLayout(lotteryText);
  expect(lotteryLayout.hintOffsets.length).toBeGreaterThan(0);
  expect(lotteryLayout.widthFits).toBe(true);

  const routeSummary: Locator = panel.locator(".game-panel__route-summary");
  await routeSummary.locator("summary").click();
  await expect(routeSummary.locator("section[aria-label='乗車中の次の駅']")).toBeVisible();
  const routeRows: Locator = routeSummary.locator("section[aria-label='乗車中の次の駅'] li");
  await expect(routeRows.first()).toBeVisible();
  expect(await routeSummary.locator("li wbr").count()).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(routeSummary);

  const candidates: Locator = panel.locator(".game-panel__candidates");
  await expect(candidates).toBeVisible();
  await candidates.locator("summary").click();
  await expect(candidates.locator("li").first()).toBeVisible();
  expect(await candidates.locator("li wbr").count()).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(candidates);

  await expectNoHorizontalOverflow(panel);
  await expectPageNoHorizontalOverflow(page);
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
