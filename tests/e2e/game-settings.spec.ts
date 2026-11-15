import { expect, test } from "./fixtures";
import { gamePanel, openTitle, rollOnce, startNewGame } from "./support/app";
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


test("very-fast menu speed survives reload with the existing settings payload", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  const panel = gamePanel(page);
  await panel.getByRole("button", { name: "メニュー", exact: true }).click();
  const speed = panel.getByRole("button", { name: /^アニメーション速度:/ });
  await speed.click();
  await expect(speed).toContainText("はやい");
  await speed.click();
  await expect(speed).toHaveText("速度: とても速い");
  const payload = { version: 1, speedId: "very-fast", follow: true, presentationLevel: "all" };
  const readPayload = (): Promise<unknown> => page.evaluate(() =>
    JSON.parse(localStorage.getItem("yamanote-line-sugoroku:settings:v1")!));
  await expect.poll(readPayload).toEqual(payload);
  await page.reload();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await panel.getByRole("button", { name: "メニュー", exact: true }).click();
  await expect(speed).toHaveText("速度: とても速い");
  await expect.poll(readPayload).toEqual(payload);
});

for (const width of [1280, 390]) {
  test(`presentation cycles and survives reload and new game with one-line menu labels at ${width}px`, { tag: "@layout" }, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openTitle(page);
    await startNewGame(page);
    const panel = gamePanel(page);
    const menu = panel.getByRole("button", { name: "メニュー", exact: true });
    await menu.click();
    const presentation = panel.getByRole("button", { name: /^演出:/ });
    await expect(presentation).toHaveText("演出: すべて");
    for (const label of ["重要なときだけ", "なし", "すべて", "重要なときだけ"]) {
      await presentation.click();
      await expect(presentation).toHaveText(`演出: ${label}`);
    }
    const speed = panel.getByRole("button", { name: /^アニメーション速度:/ });
    await speed.click(); await speed.click();
    await expect(speed).toHaveText("速度: とても速い");
    for (const button of [speed, presentation]) {
      expect(await button.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return { lines: new Set([...range.getClientRects()].map((rect) => rect.top)).size, fits: element.scrollWidth <= element.clientWidth };
      })).toEqual({ lines: 1, fits: true });
    }
    await page.screenshot({ path: `.claude/logs/screenshots/tempo-s8/menu-${width}-${testInfo.project.name}.png` });
    const payload = { version: 1, speedId: "very-fast", follow: true, presentationLevel: "important" };
    const readPayload = (): Promise<unknown> => page.evaluate(() =>
      JSON.parse(localStorage.getItem("yamanote-line-sugoroku:settings:v1")!));
    await expect.poll(readPayload).toEqual(payload);
    await page.reload();
    await page.getByRole("button", { name: /^つづきから/ }).click();
    await menu.click();
    await expect(presentation).toHaveText("演出: 重要なときだけ");
    await menu.click();
    await rollOnce(page);
    await menu.click();
    await panel.getByRole("button", { name: "新規", exact: true }).click();
    await page.getByRole("button", { name: "新しく始める", exact: true }).click();
    await menu.click();
    await expect(presentation).toHaveText("演出: 重要なときだけ");
    await expect.poll(readPayload).toEqual(payload);
  });
}

test("OS reduction disables presentation without changing the stored choice", async ({ page }) => {
  await seedGameSettings(page, { speedId: "normal", follow: true, presentationLevel: "important" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTitle(page);
  await startNewGame(page);
  await gamePanel(page).getByRole("button", { name: "メニュー", exact: true }).click();
  const control = gamePanel(page).getByRole("button", { name: /^演出:/ });
  await expect(control).toHaveText("演出: 省略");
  await expect(control).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yamanote-line-sugoroku:settings:v1")!).presentationLevel)).toBe("important");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(control).toHaveText("演出: 重要なときだけ");
  await expect(control).toBeEnabled();
});
