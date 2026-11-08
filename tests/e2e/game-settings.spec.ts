import { expect, test } from "./fixtures";
import { gamePanel, openTitle, startNewGame } from "./support/app";
import { seedGameSettings } from "./support/settings";

test.use({ dataset: "fixture", reducedMotion: "no-preference" });

test("persists menu speed and follow through reload without the seed overwriting UI changes", async ({ page }) => {
  await seedGameSettings(page, { speedId: "normal", follow: true, presentationLevel: "important" });
  await openTitle(page);
  await startNewGame(page);
  const panel = gamePanel(page);
  await panel.getByRole("button", { name: "メニュー", exact: true }).click();
  await panel.getByRole("button", { name: "アニメーション速度: ふつう（押すと切り替え）", exact: true }).click();
  await panel.getByRole("button", { name: "追尾: ON", exact: true }).click();
  await expect(panel.getByRole("button", { name: "アニメーション速度: はやい（押すと切り替え）", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "追尾: OFF", exact: true })).toBeVisible();
  const expected = { version: 1, speedId: "fast", follow: false, presentationLevel: "important" };
  const readPayload = (): Promise<unknown> => page.evaluate(() =>
    JSON.parse(localStorage.getItem("yamanote-line-sugoroku:settings:v1")!));
  await expect.poll(readPayload).toEqual(expected);

  await page.reload();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await panel.getByRole("button", { name: "メニュー", exact: true }).click();
  await expect(panel.getByRole("button", { name: "アニメーション速度: はやい（押すと切り替え）", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "追尾: OFF", exact: true })).toBeVisible();
  await expect.poll(readPayload).toEqual(expected);
});
