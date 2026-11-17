import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { serializeGame } from "../../src/features/game/engine";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { buildRulesGuide } from "../../src/features/game/rulesGuide";
import { itemScenario } from "./fixtures/itemScenarios";
import { expect, test } from "./fixtures";
import { openTitle, REQUIRED_SEGMENTS, titleScreen, writeSaveText } from "./support/app";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const NARROW_VIEWPORT = { width: 320, height: 568 };
const SCREENSHOT_DIRECTORY = resolve(process.cwd(), ".claude/logs/screenshots");
const RULES_BUTTON_NAME = "遊び方";

test.use({ dataset: "fixture" });

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-4-${name}.png`) });
}

test("title rules navigation restores focus", async ({ page }) => {
  const model = buildRulesGuide(DEFAULT_GAME_CONFIG);
  await openTitle(page);
  const opener = () => titleScreen(page).getByRole("button", { name: RULES_BUTTON_NAME });
  for (const [name, viewport] of [["desktop", DESKTOP_VIEWPORT], ["320x568", NARROW_VIEWPORT]] as const) {
    await page.setViewportSize(viewport);
    await expect(opener()).toBeVisible();
    await capture(page, `title-${name}`);
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);

  await opener().click();
  const rules = page.getByRole("main", { name: RULES_BUTTON_NAME });
  await expect(rules).toBeVisible();
  await expect(rules.getByRole("heading", { level: 1, name: RULES_BUTTON_NAME })).toBeFocused();
  for (const section of model.sections) {
    await expect(rules.getByRole("heading", { level: 2, name: section.heading })).toBeAttached();
  }
  await capture(page, "rules-desktop");
  await page.setViewportSize(NARROW_VIEWPORT);
  await capture(page, "rules-320x568");
  await page.setViewportSize(DESKTOP_VIEWPORT);

  await rules.getByRole("navigation", { name: "ルールの目次" }).getByRole("button", { name: "アイテム" }).click();
  const itemsHeading = rules.getByRole("heading", { level: 2, name: "アイテム" });
  await expect(itemsHeading).toBeFocused();
  await expect(itemsHeading).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(rules).toHaveCount(0);
  await expect(titleScreen(page)).toBeVisible();
  await expect(opener()).toBeFocused();
  await expect(page.getByRole("region", { name: "出典・ライセンス" })).toHaveCount(0);
});

test("rules retain essential content on phone", { tag: "@layout" }, async ({ page }) => {
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
