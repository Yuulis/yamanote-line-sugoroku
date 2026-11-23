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
const SCREENSHOTS_ENABLED = Boolean(process.env.ISSUE69_S3_SCREENSHOTS) && !process.env.CI;
/** Phone sheet cap (Revision 4): the first screen of the sheet must hold the numbers and the main actions. */
const PHONE_SHEET_MAX_HEIGHT_RATIO = 0.65;
const LANDSCAPE_PHONE = { width: 667, height: 375 } as const;

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

/** After scrolling it into view, the control sits inside both the card's scrollport and the viewport (1px tolerance). */
async function expectReachable(clear: Locator, target: Locator, name: string): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const reachable = await target.evaluate((element, cardElement) => {
    const tolerance = 1;
    const box = element.getBoundingClientRect();
    const card = (cardElement as HTMLElement).getBoundingClientRect();
    return box.height > 0
      && box.top >= Math.max(card.top, 0) - tolerance && box.bottom <= Math.min(card.bottom, window.innerHeight) + tolerance
      && box.left >= 0 - tolerance && box.right <= window.innerWidth + tolerance;
  }, await clear.elementHandle());
  expect(reachable, `${name} must be reachable by scrolling the card`).toBe(true);
}

test("shows the highlights on screen after the clear, with the history behind a button on desktop", async ({ page }) => {
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

  // The card carries no history list or disclosure and no log line of the clearing turn.
  await expect(clear.locator("details")).toHaveCount(0);
  await expect(clear.locator(".clear-screen__history")).toHaveCount(0);
  await expect(clear.locator(".item-event-notice__completion")).toHaveCount(0);
  await expect(clear.getByRole("status")).toHaveCount(1);
  await expect(clear.getByRole("status")).toContainText("ゴールに到着しました");
  await expect(clear.getByText("ゴールに到着しました")).toHaveCount(1);
  await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toBeVisible();
  await expectNoHorizontalOverflow(page, clear);

  const dialog = await openClearHistory(clear);
  await expect(dialog.locator(".clear-screen__history li")).toHaveCount(20);
  await expect(dialog.locator(".clear-screen__history li").first()).toContainText("1ターン目");
  await dialog.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toBeFocused();
});

test("keeps the numbers and main actions on the first phone screen, with the history behind a button", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  const clear = await clearWithOneRoll(page);

  await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "結果をコピー" }), "the share actions");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "もう一度遊ぶ" }), "もう一度遊ぶ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "タイトルへ" }), "タイトルへ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "移動履歴を見る" }), "移動履歴を見る");
  const sheet = await clear.evaluate((element) => ({ height: element.getBoundingClientRect().height, viewport: window.innerHeight }));
  expect(sheet.height, "the phone sheet stays within its 65% cap").toBeLessThanOrEqual(sheet.viewport * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);

  await expect(clear.locator("details")).toHaveCount(0);
  await expect(clear.locator(".clear-screen__history")).toHaveCount(0);
  await expect(clear.getByRole("heading", { name: "ハイライト" })).toBeAttached();
  await expectNoHorizontalOverflow(page, clear);

  const dialog = await openClearHistory(clear);
  await expect(dialog.locator(".clear-screen__history li")).toHaveCount(20);
  await expectNoHorizontalOverflow(page, clear);
  await expectNoHorizontalOverflow(page, dialog);
});

test("keeps the 390px phone sheet within its cap with the actions on the first screen", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_MEDIUM);
  const clear = await clearWithOneRoll(page);
  await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "結果をコピー" }), "the share actions");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "もう一度遊ぶ" }), "もう一度遊ぶ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "移動履歴を見る" }), "移動履歴を見る");
  const sheet = await clear.evaluate((element) => ({ height: element.getBoundingClientRect().height, viewport: window.innerHeight }));
  expect(sheet.height).toBeLessThanOrEqual(sheet.viewport * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
  await expectNoHorizontalOverflow(page, clear);
});

test("keeps every action reachable in a landscape phone", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(LANDSCAPE_PHONE);
  const clear = await clearWithOneRoll(page);
  for (const name of ["結果をコピー", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"]) {
    await expectReachable(clear, clear.getByRole("button", { name }), name);
  }
  await expectNoHorizontalOverflow(page, clear);
  const dialog = await openClearHistory(clear);
  const box = await dialog.boundingBox();
  expect(box && box.y >= -1 && box.y + box.height <= LANDSCAPE_PHONE.height + 1, "the dialog fits the landscape viewport").toBe(true);
  await expectNoHorizontalOverflow(page, dialog);
});

test("does not overflow horizontally on a small phone when the clear could not be saved", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  const clear = await clearWithOneRoll(page, { failSave: true });

  await expect(clear.getByRole("alert")).toContainText("再読み込みするとこのクリアは残りません");
  await expect(clear.getByRole("status")).toHaveCount(1);
  for (const name of ["結果をコピー", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"]) {
    await expectReachable(clear, clear.getByRole("button", { name }), name);
  }
  await expectNoHorizontalOverflow(page, clear);
  const dialog = await openClearHistory(clear);
  await expectNoHorizontalOverflow(page, clear);
  await expectNoHorizontalOverflow(page, dialog);
});

test("opens the phone history dialog, pages it, and keeps the page when it is reopened", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_MEDIUM);
  const clear = await clearWithOneRoll(page);
  const dialog = await openClearHistory(clear);
  const items = dialog.locator(".clear-screen__history li");
  await expect(items).toHaveCount(20);
  await expect(items.first()).toContainText("1ターン目");
  await dialog.getByRole("button", { name: "次のページ" }).click();
  await expect(items.first()).toContainText("21ターン目");
  await expect(dialog.locator(".clear-screen__page-status")).toHaveText("2 / 5ページ");
  await expect(dialog.getByRole("status")).toHaveText("2 / 5ページ");

  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();
  await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toBeFocused();
  const reopened = await openClearHistory(clear);
  await expect(reopened.locator(".clear-screen__page-status")).toHaveText("2 / 5ページ");
  await expect(reopened.locator(".clear-screen__history li").first()).toContainText("21ターン目");
});

test("keeps focus inside the history modal and restores the same rows after a reload", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  const dialog = await openClearHistory(clear);
  const before = await dialog.locator(".clear-screen__history li").allTextContents();
  expect(before).toHaveLength(20);
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement)), "focus stays inside the modal").toBe(true);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
  const reopened = await openClearHistory(page.getByRole("region", { name: "クリア！" }));
  expect(await reopened.locator(".clear-screen__history li").allTextContents()).toEqual(before);
});

test("saves the review screenshots on request", async ({ page }) => {
  test.skip(!SCREENSHOTS_ENABLED, "set ISSUE69_S3_SCREENSHOTS=1 (outside CI) to write the review screenshots");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  const cards: readonly [string, { width: number; height: number }][] = [
    ["issue69-s3-desktop.png", DESKTOP],
    ["issue69-s3-phone390.png", PHONE_MEDIUM],
    ["issue69-s3-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of cards) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      await expect(clear).toBeVisible();
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
    });
  }
  const dialogs: readonly [string, { width: number; height: number }][] = [
    ["issue69-s3-dialog-desktop.png", DESKTOP],
    ["issue69-s3-dialog-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of dialogs) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      const dialog = await openClearHistory(clear);
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
      await dialog.getByRole("button", { name: "閉じる" }).click();
      await expect(dialog).toBeHidden();
    });
  }
});
