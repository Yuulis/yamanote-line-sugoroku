import { expect, test } from "./fixtures";
import { itemScenario } from "./fixtures/itemScenarios";
import { serializeGame } from "../../src/features/game/engine";
import { diceButton, gamePanel, inventoryItem, readSaveText, writeSaveText } from "./support/app";

test.use({ dataset: "fixture" });

async function scenario(page: import("@playwright/test").Page, name: Parameters<typeof itemScenario>[0], bundle: import("./fixtures/bundle").RailwayBundle): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(itemScenario(name, bundle.network)));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

test("opening an item card inspects without changing the save or draft", async ({ page, railwayBundle }) => {
  await scenario(page, "double", railwayBundle);
  const savedBefore = await readSaveText(page);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button", { name: "倍速券の詳細" });
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "倍速券" })).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(gamePanel(page).locator(".item-staged-summary")).toHaveCount(0);
  expect(await readSaveText(page)).toBe(savedBefore);
  await expect(gamePanel(page).locator("[role=status]")).toHaveCount(1);
});

test("reclicking the open slot closes it and switching slots opens the other card", async ({ page, railwayBundle }) => {
  test.skip(Boolean(test.info().project.use.hasTouch), "pointer click contract runs on desktop projects");
  await scenario(page, "discard", railwayBundle);
  const slots = gamePanel(page).locator(".item-slot");
  const first = inventoryItem(page, "倍速券");
  const firstOpener = first.getByRole("button");
  await firstOpener.click();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeVisible();
  await firstOpener.click();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeHidden();
  await expect(firstOpener).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeHidden();
  const second = gamePanel(page).locator(".item-slot").filter({ has: page.getByRole("heading", { name: "出目調整券" }) });
  // Switching goes straight from an open card to the other slot's card.
  await firstOpener.click();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeVisible();
  await second.getByRole("button").click();
  await expect(gamePanel(page).getByRole("dialog", { name: "出目調整券" })).toBeVisible();
  await expect(gamePanel(page).getByRole("dialog", { name: "倍速券" })).toBeHidden();
  await expect(firstOpener).toHaveAttribute("aria-expanded", "false");
  await expect(second.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  await expect(slots).toHaveCount(3);
});

test("phone tap opens, closes, and uses the item card", async ({ page, railwayBundle }) => {
  test.skip(!test.info().project.use.hasTouch, "needs a touch project");
  await scenario(page, "double", railwayBundle);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button");
  await opener.tap();
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await expect(card).toBeVisible();
  await opener.tap();
  await expect(card).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(card).toBeHidden();
  await opener.tap();
  await expect(card).toBeVisible();
  const otherSlot = inventoryItem(page, "出目調整券");
  const otherOpener = otherSlot.getByRole("button");
  await otherOpener.tap();
  const otherCard = gamePanel(page).getByRole("dialog", { name: "出目調整券", exact: true });
  await expect(otherCard).toBeVisible();
  await expect(card).toBeHidden();
  await otherOpener.tap();
  await expect(otherCard).toBeHidden();
  await otherOpener.tap();
  await expect(otherCard).toBeVisible();
  await otherCard.getByRole("button", { name: "閉じる", exact: true }).tap();
  await expect(otherCard).toBeHidden();
  await expect(otherOpener).toBeFocused();
  await opener.tap();
  await card.getByRole("button", { name: "使う" }).tap();
  await expect(slot).toHaveClass(/item-slot--selected/);
  await expect(gamePanel(page).locator(".item-staged-summary")).toContainText("倍速券");
  await expect(gamePanel(page).getByRole("status")).toContainText("倍速券を選択中");
  await expect(gamePanel(page).locator("[role=tooltip]")).toHaveCount(0);
  await expect(diceButton(page)).toBeVisible();
});

test("unusable and passive items remain inspectable with the right card actions", async ({ page, railwayBundle }) => {
  await scenario(page, "adjust", railwayBundle);
  const adjust = inventoryItem(page, "出目調整券");
  await adjust.getByRole("button").click();
  const adjustCard = gamePanel(page).getByRole("dialog", { name: "出目調整券" });
  await expect(adjustCard.getByRole("button", { name: "使う" })).toBeDisabled();
  await expect(adjustCard).toContainText("出目が出た後に使えるアイテムです");
  await scenario(page, "certificate", railwayBundle);
  const certificate = inventoryItem(page, "遅延証明書");
  await certificate.getByRole("button").click();
  const certificateCard = gamePanel(page).getByRole("dialog", { name: "遅延証明書" });
  await expect(certificateCard).toContainText("持っているだけで効く");
  await expect(certificateCard.getByRole("button", { name: "使う" })).toHaveCount(0);
  await expect(certificateCard).not.toContainText("持っているだけで効くアイテムです");
});

test("keyboard opening, Escape focus return, and light dismiss keep the slot tooltip out of the card", async ({ page, railwayBundle }) => {
  test.skip(Boolean(test.info().project.use.hasTouch), "hover and light dismiss run on desktop projects");
  await scenario(page, "double", railwayBundle);
  const slot = inventoryItem(page, "倍速券");
  const opener = slot.getByRole("button");
  await opener.focus();
  await page.keyboard.press("Enter");
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券", exact: true });
  await expect(card).toBeVisible();
  await expect(slot.locator(".item-slot__tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(slot.locator(".item-slot__tooltip")).toHaveCount(0);
  await opener.click();
  await gamePanel(page).getByRole("heading", { name: "山手線すごろく" }).click();
  await expect(card).toBeHidden();
  await expect(opener).not.toBeFocused();
});

test("route ticket card opens the use dialog and cancellation restores its opener", async ({ page, railwayBundle }) => {
  await scenario(page, "route", railwayBundle);
  const slot = inventoryItem(page, "路線指定券");
  const opener = slot.getByRole("button");
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "路線指定券", exact: true });
  await card.getByRole("button", { name: "使う" }).click();
  await expect(card).toBeHidden();
  const useDialog = gamePanel(page).getByRole("dialog", { name: "乗る路線を選ぶ" });
  await expect(useDialog).toBeVisible();
  await useDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(useDialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("direction ticket card opens its use dialog and cancellation restores its opener", async ({ page, railwayBundle }) => {
  await scenario(page, "direction", railwayBundle);
  const slot = inventoryItem(page, "方向指定券");
  const opener = slot.getByRole("button");
  await opener.click();
  const card = gamePanel(page).getByRole("dialog", { name: "方向指定券", exact: true });
  await card.getByRole("button", { name: "使う" }).click();
  await expect(card).toBeHidden();
  const useDialog = gamePanel(page).getByRole("dialog", { name: "進む向きを選ぶ" });
  await expect(useDialog).toBeVisible();
  await useDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(useDialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("desktop card hides its own hover tooltip, keeps other slot hover, and closes on Tab out", async ({ page, railwayBundle }) => {
  test.skip(Boolean(test.info().project.use.hasTouch), "requires desktop hover and keyboard focus");
  await scenario(page, "discard", railwayBundle);
  const first = inventoryItem(page, "倍速券");
  const firstOpener = first.getByRole("button");
  await firstOpener.click();
  await first.hover();
  await expect(first.locator(".item-slot__tooltip")).toHaveCount(0);
  const second = inventoryItem(page, "出目調整券");
  await second.hover();
  await expect(second.locator(".item-slot__tooltip")).toBeVisible();

  const card = gamePanel(page).getByRole("dialog", { name: "倍速券" });
  await card.getByRole("button", { name: "閉じる" }).focus();
  await page.keyboard.press("Tab");
  await expect(card).toBeHidden();
  await expect(firstOpener).not.toBeFocused();
});
