import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { serializeGame } from "../../src/features/game/engine";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { buildRulesGuide } from "../../src/features/game/rulesGuide";
import { itemScenario, type ItemScenario } from "./fixtures/itemScenarios";
import type { RailwayBundle } from "./fixtures/bundle";
import { expect, test } from "./fixtures";
import {
  diceButton, diceMoment, freezeClock, gamePanel, inventoryItem, openGameLog, openGameMenu, openTitle, readSave, readSaveText,
  REQUIRED_SEGMENTS, startNewGame, titleScreen, useInventoryItem, writeSaveText,
} from "./support/app";
import { advanceTumble } from "./support/turnMoments";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const NARROW_VIEWPORT = { width: 320, height: 568 };
const SCREENSHOT_DIRECTORY = resolve(process.cwd(), ".claude/logs/screenshots");
const RULES_BUTTON_NAME = "遊び方";

test.use({ dataset: "fixture" });

async function capture(page: Page, name: string, step = "4"): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-${step}-${name}.png`) });
}

async function captureStep14(page: Page, name: string, viewport: "desktop" | "320x568"): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-14-${name}-${viewport}.png`), scale: "css" });
}

async function resumeScenario(page: Page, name: ItemScenario, bundle: RailwayBundle): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(itemScenario(name, bundle.network)));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

function rulesDialog(page: Page) {
  return page.getByRole("dialog", { name: RULES_BUTTON_NAME });
}

function menuRulesButton(page: Page) {
  return gamePanel(page).getByRole("button", { name: RULES_BUTTON_NAME, exact: true });
}

test("rules retain essential content on phone", { tag: "@layout" }, async ({ page, isMobile }) => {
  const model = buildRulesGuide(DEFAULT_GAME_CONFIG);
  await page.setViewportSize(NARROW_VIEWPORT);
  await openTitle(page);

  await titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME }).click();
  const rules = page.getByRole("main", { name: RULES_BUTTON_NAME });
  await expect(rules.getByRole("navigation", { name: "ルールの目次" })).toBeHidden();
  for (const section of model.sections) {
    await expect(rules.getByRole("heading", { level: 2, name: section.heading })).toBeAttached();
    // The live model also carries names and the direction, so it has at least the count-free paragraphs.
    const paragraphCount = await rules.locator(`#title-rules-${section.id} p`).count();
    expect(paragraphCount).toBeGreaterThanOrEqual(section.paragraphs.length);
  }
  const rows = rules.locator(".rules-guide__item");
  await expect(rows).toHaveCount(model.items.length);
  await expect(rules.locator(".rules-guide__item svg.item-icon")).toHaveCount(model.items.length);
  for (const item of model.items) {
    const row = rules.locator(`.rules-guide__item[data-item-kind="${item.kind}"]`);
    await expect(row).toContainText(item.name);
    await expect(row).toContainText(item.effect);
  }

  await expect(rules.locator("#title-rules-goal")).toContainText(`全${REQUIRED_SEGMENTS}区間`);
  await expect(rules.locator("#title-rules-lottery")).toContainText("2分の1の確率");
  await expect(rules.locator("#title-rules-lottery")).toContainText("3:2");

  const body = rules.locator(".title-screen__rules-body");
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const back = rules.getByRole("button", { name: "タイトルへ戻る" });
  await expect(back).toBeInViewport();
  await rules.locator("#title-rules-items").evaluate((section) => section.scrollIntoView({ block: "start" }));
  await expect(rules.getByRole("heading", { level: 2, name: "アイテム" })).toBeInViewport();
  await capture(page, "rules-items-320x568");
  await expect(back).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(titleScreen(page)).toBeVisible();
  await startNewGame(page);
  const finePointer = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
  expect(finePointer).toBe(!isMobile);
  const display = finePointer ? "block" : "none";
  await openGameMenu(page);
  await expect(gamePanel(page).locator(".game-panel__shortcut-hint")).toHaveCSS("display", display);
  await menuRulesButton(page).click();
  const shortcuts = rulesDialog(page).locator(".rules-guide__shortcuts");
  await expect(shortcuts).toHaveCSS("display", display);
  await expect(shortcuts).toBeVisible({ visible: finePointer });
});

test("loading title keeps rules available without a target count", { tag: "@layout" }, async ({ page, baseURL }, testInfo) => {
  if (!baseURL) throw new Error("baseURL must be configured");
  const stationsPath = new URL("data/stations.json", baseURL).pathname;
  let releaseStations: () => void = () => undefined;
  const stationsGate = new Promise<void>((resolve) => { releaseStations = resolve; });
  await page.route("**/data/stations.json", async (route) => {
    await stationsGate;
    await route.fallback();
  });

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto("/");
  await expect(titleScreen(page)).toBeVisible();
  await expect(titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME, exact: true })).toBeVisible();
  await expect(titleScreen(page).getByRole("button", { name: "はじめから", exact: true })).toHaveCount(0);
  await expect(titleScreen(page).getByRole("button", { name: /つづきから/ })).toHaveCount(0);
  await expect(page.locator(".title-map-placeholder")).toHaveCount(1);
  if (testInfo.project.name === "desktop-chromium") await capture(page, "loading-desktop", "13");

  await page.setViewportSize(NARROW_VIEWPORT);
  if (testInfo.project.name === "desktop-chromium") await capture(page, "loading-320x568", "13");
  await titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME, exact: true }).click();
  const rules = page.getByRole("main", { name: RULES_BUTTON_NAME });
  const goal = rules.locator("#title-rules-goal");
  await expect(rules.getByRole("heading", { level: 1, name: RULES_BUTTON_NAME })).toBeFocused();
  await expect(goal).toContainText("目標路線");
  await expect(goal).toContainText("出発駅");
  await expect(goal).not.toContainText(/全\d+区間/);
  await expect(page.locator(".title-map-placeholder")).toHaveCount(1);
  if (testInfo.project.name === "desktop-chromium") await capture(page, "loading-rules-320x568", "13");

  const stationsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === stationsPath);
  releaseStations();
  await stationsResponse;
  await expect(rules).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(titleScreen(page)).toBeVisible();
  await expect(titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME, exact: true })).toBeFocused();

  await titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME, exact: true }).click();
  await expect(page.getByRole("main", { name: RULES_BUTTON_NAME }).locator("#title-rules-goal")).toContainText(/全\d+区間/);
});

test("rules and title remain readable at compact viewports", { tag: "@layout" }, async ({ page, railwayBundle, baseURL }) => {
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("baseURL must be configured");
  const stationsPath = new URL("data/stations.json", baseURL).pathname;
  let releaseStations: () => void = () => undefined;
  const stationsGate = new Promise<void>((resolve) => { releaseStations = resolve; });
  await page.route("**/data/stations.json", async (route) => {
    await stationsGate;
    await route.fallback();
  });

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto("/");
  await expect(titleScreen(page)).toBeVisible();
  await expect(page.locator(".title-map-placeholder")).toHaveCount(1);
  await captureStep14(page, "loading-title", "desktop");
  await page.setViewportSize(NARROW_VIEWPORT);
  await expect(titleScreen(page)).toBeVisible();
  await captureStep14(page, "loading-title", "320x568");

  const stationsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === stationsPath);
  releaseStations();
  await stationsResponse;
  await expect(titleScreen(page).getByRole("button", { name: "はじめから", exact: true })).toBeVisible();

  const viewports = [
    { name: "desktop", size: DESKTOP_VIEWPORT },
    { name: "320x568", size: NARROW_VIEWPORT },
  ] as const;
  for (const viewport of viewports) {
    await page.setViewportSize(viewport.size);
    const title = titleScreen(page);
    await expect(title.getByRole("button", { name: "遊び方", exact: true })).toBeVisible();
    await expect(title.getByRole("button", { name: "はじめから", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureStep14(page, "title-no-save", viewport.name);

    await title.getByRole("button", { name: "遊び方", exact: true }).click();
    const rules = page.getByRole("main", { name: RULES_BUTTON_NAME });
    await expect(rules.locator("#title-rules-goal")).toContainText(`全${REQUIRED_SEGMENTS}区間`);
    await expect(rules.getByRole("heading", { level: 2, name: "アイテム" })).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureStep14(page, "rules-guide-top", viewport.name);
    await rules.locator("#title-rules-items").evaluate((section) => section.scrollIntoView({ block: "start" }));
    await expect(rules.getByRole("heading", { level: 2, name: "アイテム" })).toBeInViewport();
    await captureStep14(page, "rules-guide-items", viewport.name);
    await page.keyboard.press("Escape");
    await expect(title).toBeVisible();
  }

  await writeSaveText(page, serializeGame(itemScenario("route", railwayBundle.network)));
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport.size);
    await expect(titleScreen(page).getByRole("button", { name: /つづきから/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureStep14(page, "title-with-save", viewport.name);
  }
});

test("title keeps the start button above the fold with a save on phone", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto("/");
  await writeSaveText(page, serializeGame(itemScenario("route", railwayBundle.network)));
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();

  await expect(titleScreen(page).getByRole("button", { name: "はじめから", exact: true })).toBeInViewport({ ratio: 1 });
  await capture(page, "title-with-save-320x568");
});

test.describe("combined decision preservation", () => {
  test.use({ reducedMotion: "no-preference" });

  test("rules preserve pending roll and discard decisions", async ({ page, railwayBundle }) => {
    await page.clock.install();
    await resumeScenario(page, "adjust", railwayBundle);
    await freezeClock(page);
    await diceButton(page).click();
    await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
    await openGameMenu(page);
    await menuRulesButton(page).click();

    const rules = rulesDialog(page);
    await expect(rules).toBeVisible();

    await advanceTumble(page);
    const pendingRoll = await readSave(page);
    expect(pendingRoll?.pending?.kind).toBe("roll");
    const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
    await expect(adjustment).toHaveCount(0);
    await expect(rules).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(rules).toHaveCount(0);
    await expect(adjustment).toBeVisible();
    expect((await readSave(page))?.pending).toEqual(pendingRoll?.pending);
    await adjustment.getByRole("button", { name: "そのまま続ける" }).click();

    await page.goto("/");
    await writeSaveText(page, serializeGame(itemScenario("discard", railwayBundle.network)));
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    await freezeClock(page);
    await diceButton(page).click();
    await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
    await openGameMenu(page);
    await menuRulesButton(page).click();
    await expect(rules).toBeVisible();
    await advanceTumble(page);

    const possibleRoll = await readSave(page);
    if (possibleRoll?.pending?.kind === "roll") {
      await page.keyboard.press("Escape");
      await expect(rules).toHaveCount(0);
      const pendingAdjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
      await expect(pendingAdjustment).toBeVisible();
      await pendingAdjustment.getByRole("button", { name: "そのまま続ける" }).click();
      await menuRulesButton(page).click();
      await expect(rules).toBeVisible();
    }

    await page.clock.runFor(30_000);
    await expect.poll(async () => (await readSave(page))?.pending?.kind).toBe("discard");
    const pendingDiscard = await readSave(page);
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await expect(rules).toBeVisible();
    await expect(discard).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(rules).toHaveCount(0);
    await expect(discard).toBeVisible();
    expect((await readSave(page))?.pending).toEqual(pendingDiscard?.pending);
    await discard.getByRole("button", { name: "このアイテムを捨てる" }).first().click();
    await expect.poll(async () => (await readSave(page))?.pending).toBeNull();
  });
});

test("menu rules preserves draft and saved progress", async ({ page, railwayBundle }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await resumeScenario(page, "double", railwayBundle);
  await useInventoryItem(page, "倍速券");
  const staged = gamePanel(page).locator(".item-staged-summary");
  await expect(staged).toContainText("倍速券");
  const savedBefore = await readSaveText(page);

  await openGameMenu(page);
  const finePointer = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
  const shortcutDisplay = finePointer ? "block" : "none";
  await expect(gamePanel(page).locator(".game-panel__shortcut-hint")).toHaveCSS("display", shortcutDisplay);
  await menuRulesButton(page).scrollIntoViewIfNeeded();
  await expect(menuRulesButton(page)).toBeInViewport();
  await capture(page, "menu-desktop", "6a");
  await menuRulesButton(page).click();
  const shortcuts = rulesDialog(page).locator(".rules-guide__shortcuts");
  await expect(shortcuts).toHaveCSS("display", shortcutDisplay);
  await expect(shortcuts).toBeVisible({ visible: finePointer });
  await expect(rulesDialog(page).getByRole("heading", { level: 1, name: RULES_BUTTON_NAME })).toBeFocused();
  await capture(page, "dialog-desktop", "6a");
  await rulesDialog(page).getByRole("button", { name: "閉じる" }).click();
  await expect(rulesDialog(page)).toHaveCount(0);
  await expect(menuRulesButton(page)).toBeFocused();
  await expect(staged).toContainText("倍速券");
  expect(await readSaveText(page)).toBe(savedBefore);

  // The phone menu embeds the same GameMenu, so 遊び方 is reachable from its settings section.
  await page.setViewportSize(NARROW_VIEWPORT);
  await openGameMenu(page);
  await expect(gamePanel(page).locator(".game-panel__shortcut-hint")).toHaveCSS("display", shortcutDisplay);
  await menuRulesButton(page).click();
  await expect(rulesDialog(page)).toBeVisible();
  await expect(rulesDialog(page).locator(".rules-guide__shortcuts")).toHaveCSS("display", shortcutDisplay);
  await capture(page, "dialog-320x568", "6a");
  await page.keyboard.press("Escape");
  await expect(rulesDialog(page)).toHaveCount(0);
  await expect(menuRulesButton(page)).toBeFocused();
  await expect(staged).toContainText("倍速券");
  expect(await readSaveText(page)).toBe(savedBefore);
});

test("title, lottery and item rule entry points reach visible sections", async ({ page, railwayBundle }) => {
  const model = buildRulesGuide(DEFAULT_GAME_CONFIG);
  const items = model.sections.find((section) => section.id === "items")!;
  const lottery = model.sections.find((section) => section.id === "lottery")!;

  await test.step("title rules navigation focuses and scrolls to the chosen section", async () => {
    await openTitle(page);
    const opener = () => titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME });
    await expect(opener()).toBeVisible();
    await opener().click();
    const rules = page.getByRole("main", { name: RULES_BUTTON_NAME });
    await expect(rules.getByRole("heading", { level: 1, name: RULES_BUTTON_NAME })).toBeFocused();
    for (const section of model.sections) {
      await expect(rules.getByRole("heading", { level: 2, name: section.heading })).toBeAttached();
    }
    await rules.getByRole("navigation", { name: "ルールの目次" }).getByRole("button", { name: "アイテム" }).click();
    const heading = rules.getByRole("heading", { level: 2, name: items.heading });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(rules).toHaveCount(0);
    await expect(opener()).toBeFocused();
    await expect(page.getByRole("region", { name: "出典・ライセンス" })).toHaveCount(0);
  });

  await test.step("lottery details focus and reveal the lottery section", async () => {
    await resumeScenario(page, "route", railwayBundle);
    await openGameLog(page);
    const opener = gamePanel(page).getByRole("button", { name: "抽選のルールを詳しく見る", exact: true });
    await expect(opener).toHaveText("詳しく");
    await opener.click();
    const heading = rulesDialog(page).getByRole("heading", { level: 2, name: lottery.heading });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(rulesDialog(page)).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  await test.step("item details reveal the section after closing the card and tooltip", async () => {
    await resumeScenario(page, "double", railwayBundle);
    const trigger = inventoryItem(page, "倍速券").getByRole("button");
    const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
    const details = card.getByRole("button", { name: "アイテムのルールを詳しく見る", exact: true });
    for (const viewport of [DESKTOP_VIEWPORT, NARROW_VIEWPORT]) {
      await page.setViewportSize(viewport);
      await trigger.click();
      await expect(details).toHaveText("詳しく");
      await expect(details).toBeInViewport();
      await details.click();
      const heading = rulesDialog(page).getByRole("heading", { level: 2, name: items.heading });
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      await expect(card).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(rulesDialog(page)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(card).toBeHidden();
      await expect(inventoryItem(page, "倍速券").getByRole("tooltip", { includeHidden: true })).toHaveCount(0);
    }
  });
});

test.describe("with the dice tumble", () => {
  test.use({ reducedMotion: "no-preference" });

  test("closing rules Escape does not skip or clear draft", async ({ page, railwayBundle }) => {
    await page.clock.install();
    await resumeScenario(page, "double", railwayBundle);
    await freezeClock(page);
    await useInventoryItem(page, "倍速券");
    const staged = gamePanel(page).locator(".item-staged-summary");
    const menu = gamePanel(page).getByRole("region", { name: "メニュー", exact: true });
    const savedBefore = await readSaveText(page);

    await openGameMenu(page);
    await menuRulesButton(page).click();
    await expect(rulesDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rulesDialog(page)).toHaveCount(0);
    await expect(staged).toContainText("倍速券");
    await expect(menu).toBeVisible();
    expect(await readSaveText(page)).toBe(savedBefore);

    // The frozen clock holds the tumble, so only a skip could end it.
    await diceButton(page).click();
    await expect(diceMoment(page)).toBeVisible();
    await menuRulesButton(page).click();
    await expect(rulesDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rulesDialog(page)).toHaveCount(0);
    await expect(diceMoment(page)).toBeVisible();
  });
});
