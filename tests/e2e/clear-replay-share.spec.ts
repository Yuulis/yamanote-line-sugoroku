import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { diceButton, openClearHistory, openTitle, panelStat, writeSaveText } from "./support/app";

// Issue #69, S2: the published clear result on screen. The pinned save is one roll before the clear.
test.use({ dataset: "real" });

const PINNED_SAVE = readFileSync(new URL("./fixtures/tokyo-suburban-before-clear-save.json", import.meta.url), "utf8").trimEnd();
const PHONE_SMALL = { width: 320, height: 568 } as const;
const PHONE_MEDIUM = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 800 } as const;
/** Review screenshots are produced on request only (never in CI). */
const SCREENSHOT_DIR = ".claude/logs/screenshots";
const SCREENSHOTS_ENABLED = Boolean(process.env.ISSUE69_S2_SCREENSHOTS) && !process.env.CI;

async function failSaveWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const storage = Storage.prototype;
    const original = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save")) throw new Error("quota");
      original.call(this, key, value);
    };
  });
}

/** Resume the pinned save and clear with its one remaining roll. */
async function clearWithOneRoll(page: Page, options: { failSave?: boolean } = {}): Promise<Locator> {
  await openTitle(page);
  await writeSaveText(page, PINNED_SAVE);
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("95");
  if (options.failSave) await failSaveWrites(page);
  await diceButton(page).click();
  const clear = page.getByRole("region", { name: "クリア！" });
  await expect(clear).toBeVisible();
  await expect(clear.getByRole("heading", { name: "クリア！" })).toBeFocused();
  return clear;
}

async function expectNoHorizontalOverflow(page: Page, clear: Locator): Promise<void> {
  const card = await clear.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(card.scroll, "the clear card must not scroll horizontally").toBeLessThanOrEqual(card.client);
  const document = await page.evaluate(() => ({
    client: window.document.documentElement.clientWidth,
    scroll: window.document.documentElement.scrollWidth,
  }));
  expect(document.scroll, "the page must not scroll horizontally").toBeLessThanOrEqual(document.client);
}

/** True when the element sits fully inside the card's first (unscrolled) screen. */
async function expectWithinFirstScreen(clear: Locator, target: Locator, name: string): Promise<void> {
  const fits = await target.evaluate((element, cardElement) => {
    const card = cardElement as HTMLElement;
    const cardBox = card.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return card.scrollTop === 0 && box.height > 0 && box.top >= cardBox.top && box.bottom <= cardBox.bottom;
  }, await clear.elementHandle());
  expect(fits, `${name} must be visible without scrolling the card`).toBe(true);
}

test("shows the highlights on screen after the clear, with the history visible on desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);

  const highlights = clear.locator(".clear-screen__highlights");
  await expect(highlights.getByRole("heading", { name: "ハイライト" })).toBeVisible();
  const row = (key: string): Locator => highlights.locator(`[data-highlight="${key}"] dd`);
  await expect(row("longest-ride")).toHaveText(/^.+ \d+駅（.+→.+）$/);
  await expect(row("most-used-line")).toHaveText(/^.+ \d+区間$/);
  await expect(row("farthest-station")).toHaveText(/^.+（新橋から \d+\.\dkm）$/);
  await expect(highlights.locator('[data-highlight="most-used-line"] dt')).toHaveText("最も使った路線（山手線以外）");
  await expect(row("used-items")).toBeVisible();
  await expect(row("avoided-items")).toBeVisible();
  await expect(highlights.getByRole("listitem")).toHaveCount(0);

  await expect(clear.locator("details")).toHaveCount(0);
  await expect(clear.getByRole("heading", { name: "移動履歴" })).toBeVisible();
  await expect(clear.locator(".clear-screen__history li")).toHaveCount(20);
  await expect(clear.getByRole("status")).toHaveCount(1);
  await expectNoHorizontalOverflow(page, clear);
});

test("keeps the numbers and main actions on the first phone screen with the history closed", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  const clear = await clearWithOneRoll(page);

  await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "結果をコピー" }), "the share actions");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "もう一度遊ぶ" }), "もう一度遊ぶ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "タイトルへ" }), "タイトルへ");

  const disclosure = clear.locator("details.clear-screen__history-details");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(disclosure.getByText("移動履歴", { exact: true })).toBeVisible();
  await expect(clear.locator(".clear-screen__history")).toBeHidden();
  await expect(clear.getByRole("heading", { name: "ハイライト" })).toBeAttached();
  await expectNoHorizontalOverflow(page, clear);

  await openClearHistory(clear);
  await expect(clear.locator(".clear-screen__history li")).toHaveCount(20);
  await expectNoHorizontalOverflow(page, clear);
});

test("does not overflow horizontally on a small phone when the clear could not be saved", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  const clear = await clearWithOneRoll(page, { failSave: true });

  await expect(clear.getByRole("alert")).toContainText("再読み込みするとこのクリアは残りません");
  await expect(clear.getByRole("status")).toHaveCount(1);
  await expect(clear.getByRole("button", { name: "もう一度遊ぶ" })).toBeVisible();
  await expectNoHorizontalOverflow(page, clear);
  await openClearHistory(clear);
  await expectNoHorizontalOverflow(page, clear);
});

test("opens the phone history through its 移動履歴 summary and pages it", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_MEDIUM);
  const clear = await clearWithOneRoll(page);
  await openClearHistory(clear);
  const items = clear.locator(".clear-screen__history li");
  await expect(items).toHaveCount(20);
  await expect(items.first()).toContainText("1ターン目");
  await clear.getByRole("button", { name: "次のページ" }).click();
  await expect(items.first()).toContainText("21ターン目");
  await expect(clear.locator(".clear-screen__page-status")).toHaveText("2 / 5ページ");
  await expect(clear.getByRole("status")).toHaveText("2 / 5ページ");
});

test("saves the review screenshots on request", async ({ page }) => {
  test.skip(!SCREENSHOTS_ENABLED, "set ISSUE69_S2_SCREENSHOTS=1 (outside CI) to write the review screenshots");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  await clearWithOneRoll(page);
  const shots: readonly [string, { width: number; height: number }][] = [
    ["issue69-s2-desktop.png", DESKTOP],
    ["issue69-s2-phone390.png", PHONE_MEDIUM],
    ["issue69-s2-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of shots) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
    });
  }
});
