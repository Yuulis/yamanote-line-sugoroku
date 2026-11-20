import type { Locator, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { saveStatusPresentation } from "../../src/features/game/saveStatusPresentation";
import { expect, test } from "./fixtures";
import { diceMoment, gamePanel, openGameMenu, openTitle, panelStat, readSave, rollOnce, startNewGame } from "./support/app";

const PHONE_VIEWPORT = { width: 320, height: 568 };
const PHONE_HUD_BUDGET_PX = 252;
const HIT_TARGET_MINIMUM_PX = 44;
const HIT_PROBE_RADIUS_PX = 40;
const SCREENSHOT_DIRECTORY = resolve(process.cwd(), ".claude/logs/screenshots");

test.use({ dataset: "fixture" });

interface Box { left: number; top: number; right: number; bottom: number }

function saveTrigger(page: Page): Locator {
  return gamePanel(page).locator(".game-panel__save .save-status__trigger");
}

function saveExplanation(page: Page): Locator {
  return gamePanel(page).getByRole("dialog", { name: "セーブの状態" });
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-7b-${name}.png`) });
}

async function failSaves(page: Page): Promise<void> {
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    storage.originalSetItem = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save")) throw new Error("quota");
      storage.originalSetItem?.call(this, key, value);
    };
  });
}

/** The effective hit box: every probed point whose hit test lands on the trigger, so clipping and covering count. */
async function measureHitBox(trigger: Locator): Promise<Box> {
  return trigger.evaluate((element, radius) => {
    const anchor = element.getBoundingClientRect();
    const centerX = Math.round(anchor.left + anchor.width / 2);
    const centerY = Math.round(anchor.top + anchor.height / 2);
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if (document.elementFromPoint(x, y)?.closest(".save-status__trigger") !== element) continue;
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        box.right = Math.max(box.right, x + 1);
        box.bottom = Math.max(box.bottom, y + 1);
      }
    }
    return box;
  }, HIT_PROBE_RADIUS_PX);
}

/** A roll would start a tumble and save within a frame or two, so settle two frames before reading the state. */
async function expectNoRoll(page: Page, turn: number | undefined): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await expect(diceMoment(page)).toBeHidden();
  expect((await readSave(page))?.turn).toBe(turn);
  await expect(panelStat(page, "ターン数")).toHaveText(String(turn));
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

test("save explanations work by keyboard and tap", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  const trigger = saveTrigger(page);
  const explanation = saveExplanation(page);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAccessibleName("セーブ: 自動保存済み");
  await expect(gamePanel(page).locator(".game-panel__save")).toHaveAttribute("title", "セーブ: 自動保存済み");
  const turnBefore = (await readSave(page))?.turn;

  // Tap opens, focus moves to 閉じる, and Enter / Space act on it instead of rolling the dice.
  await trigger.click();
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText(saveStatusPresentation("saved").explanation);
  await expect(explanation.getByRole("button", { name: "閉じる" })).toBeFocused();
  await capture(page, "saved-open-desktop");
  await page.keyboard.press("Enter");
  await expect(explanation).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNoRoll(page, turnBefore);
  await page.keyboard.press("Enter");
  await expect(explanation).toBeVisible();
  await page.keyboard.press("Space");
  await expect(explanation).toBeHidden();
  await expectNoRoll(page, turnBefore);

  // Escape dismisses without skipping and returns focus.
  await page.keyboard.press("Space");
  await expect(explanation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(explanation).toBeHidden();
  await expect(trigger).toBeFocused();

  // A failed save leaves plain status text: no button, no tab stop, no explanation to open.
  await failSaves(page);
  await page.getByRole("button", { name: "サイコロを振る" }).click();
  const failedLine = gamePanel(page).locator(".game-panel__save");
  await expect(failedLine).toContainText("失敗");
  await expect(failedLine.locator("button, [tabindex], a[href]")).toHaveCount(0);
  await expect(gamePanel(page).locator(".save-status__trigger, .save-status__popover")).toHaveCount(0);
  await capture(page, "failed-line-desktop");
});

test("save popover and rules restore their own openers across resize", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  await openGameMenu(page);

  const trigger = saveTrigger(page);
  const explanation = saveExplanation(page);
  const opener = gamePanel(page).getByRole("button", { name: "遊び方", exact: true });
  const rules = page.getByRole("dialog", { name: "遊び方" });
  const heading = rules.getByRole("heading", { level: 1, name: "遊び方" });

  await test.step("a script click closes the native popover without stealing rules focus", async () => {
    await trigger.click();
    await expect(explanation).toBeVisible();
    await opener.dispatchEvent("click");
    await expect(heading).toBeFocused();
    await expect(explanation).toBeHidden();
    await expect(heading).toBeFocused();
    await rules.getByRole("button", { name: "閉じる" }).click();
    await expect(rules).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  await test.step("a real rules click closes the popover and Escape restores its opener", async () => {
    await trigger.click();
    await expect(explanation).toBeVisible();
    await opener.click();
    await expect(heading).toBeFocused();
    await expect(explanation).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(rules).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  await test.step("phone resize keeps each close target focused and the saved turn", async () => {
    await trigger.click();
    await expect(explanation).toBeVisible();
    await expect(explanation.getByRole("button", { name: "閉じる" })).toBeFocused();
    await page.setViewportSize(PHONE_VIEWPORT);
    await expect(explanation).toBeVisible();
    await explanation.getByRole("button", { name: "閉じる" }).click();
    await expect(explanation).toBeHidden();
    await expect(trigger).toBeFocused();

    await openGameMenu(page);
    const phoneOpener = gamePanel(page).getByRole("button", { name: "遊び方", exact: true });
    await phoneOpener.click();
    await expect(heading).toBeFocused();
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.keyboard.press("Escape");
    await expect(rules).toHaveCount(0);
    await expect(phoneOpener).toBeFocused();
    expect((await readSave(page))?.turn).toBe(1);
  });
});

test("a real click on 遊び方 closes the explanation and rules close back to the opener", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  await openGameMenu(page);
  await saveTrigger(page).click();
  await expect(saveExplanation(page)).toBeVisible();

  const opener = gamePanel(page).getByRole("button", { name: "遊び方", exact: true });
  await opener.click();
  const rules = page.getByRole("dialog", { name: "遊び方" });
  await expect(rules.getByRole("heading", { level: 1, name: "遊び方" })).toBeFocused();
  await expect(saveExplanation(page)).toBeHidden();
  await rules.getByRole("button", { name: "閉じる" }).click();
  await expect(rules).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Space and Enter do not roll after clicking the explanation text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  const turnBefore = (await readSave(page))?.turn;
  await saveTrigger(page).click();
  await expect(saveExplanation(page)).toBeVisible();

  // The click moves focus from 閉じる to the dialog container, which is not a button.
  await saveExplanation(page).locator(".save-status__text").click();
  await expect(saveExplanation(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expectNoRoll(page, turnBefore);
  await page.keyboard.press("Enter");
  await expectNoRoll(page, turnBefore);
  await expect(saveExplanation(page)).toBeVisible();
});

test("the inline fallback stays inside the HUD", async ({ page }) => {
  await page.addInitScript(() => { delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover; });
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  for (const viewport of [{ width: 1280, height: 800 }, PHONE_VIEWPORT]) {
    await page.setViewportSize(viewport);
    await saveTrigger(page).click();
    const explanation = saveExplanation(page);
    await expect(explanation).toBeVisible();
    await expect(explanation.getByRole("button", { name: "閉じる" })).toBeFocused();
    const panel = gamePanel(page);
    const fit = await panel.evaluate((element, selector) => {
      const box = element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return {
        scrollLeft: element.scrollLeft,
        overflowX: element.scrollWidth - element.clientWidth,
        inside: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom,
      };
    }, ".save-status__popover");
    expect(fit, `${viewport.width}x${viewport.height}`).toEqual({ scrollLeft: 0, overflowX: 0, inside: true });
    if (viewport === PHONE_VIEWPORT) await capture(page, "fallback-320x568");
    await explanation.getByRole("button", { name: "閉じる" }).click();
    await expect(explanation).toBeHidden();
  }
});

test("save hit target preserves the phone HUD budget", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  const panel = gamePanel(page);
  const trigger = saveTrigger(page);
  await capture(page, "hud-320x568");
  const markBefore = await trigger.boundingBox();
  expect(markBefore).not.toBeNull();

  const hit = await measureHitBox(trigger);
  const station = await panelStat(page, "現在駅").boundingBox();
  const controls = await panel.locator("button:not(.save-status__trigger)").evaluateAll((buttons) =>
    buttons.filter((button) => button.getClientRects().length > 0).map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }));
  expect(hit.right - hit.left, "hit box width").toBeGreaterThanOrEqual(HIT_TARGET_MINIMUM_PX);
  expect(hit.bottom - hit.top, "hit box height").toBeGreaterThanOrEqual(HIT_TARGET_MINIMUM_PX);
  expect(overlaps(hit, { left: station!.x, top: station!.y, right: station!.x + station!.width, bottom: station!.y + station!.height }), "hit box overlaps 現在駅").toBe(false);
  expect(controls.filter((control) => overlaps(hit, control)), "hit box overlaps neighbouring controls").toEqual([]);

  const hud = await panel.evaluate((element) => {
    const box = (selector: string): DOMRect => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      budget: box(".item-inventory").bottom - element.getBoundingClientRect().top + Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth),
      scrollTop: element.scrollTop,
    };
  });
  expect(Math.round(hud.budget)).toBe(PHONE_HUD_BUDGET_PX);
  expect(hud.scrollTop).toBe(0);

  await trigger.click();
  await expect(saveExplanation(page)).toBeVisible();
  await capture(page, "saved-open-320x568");
  await saveExplanation(page).getByRole("button", { name: "閉じる" }).click();
  await expect(saveExplanation(page)).toBeHidden();
  expect(await trigger.boundingBox()).toEqual(markBefore);
});
