import { expect, test } from "./fixtures";
import { FIXTURE_GAME_SEED, FIXTURE_SCENARIO_TURNS } from "./fixtures/seeds";
import { diceButton, freezeClock, gamePanel, markerPosition, openTitle, panelStat, readMap, readSave, rollOnce, startNewGame } from "./support/app";

test.use({ dataset: "fixture" });

test("arrival lottery, both endpoint kinds and a direction-only draw are visible", async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  expect((await readSave(page))?.rngSeed).toBe(FIXTURE_GAME_SEED);
  await expect(panelStat(page, "乗車中")).toHaveText("テスト南線");
  await expect(panelStat(page, "進行方向")).toHaveText("大森方面");
  const lottery = gamePanel(page).locator(".game-panel__lottery");
  await expect(lottery).toContainText("山手線・テスト南線から抽選 → テスト南線");
  await rollOnce(page);
  await expect(panelStat(page, "出目")).toHaveText("3（大森で停止〔エリア端〕、残り1は使わず）");
  await expect(lottery).toContainText("エリア端のため折り返し");
  await expect(panelStat(page, "踏破区間")).toHaveText("4/30");
  await rollOnce(page);
  await expect(panelStat(page, "出目")).toHaveText("3（品川で停止〔終点〕、残り1は使わず）");
  await expect(lottery).toContainText("終点のため折り返し");
  for (let turn = FIXTURE_SCENARIO_TURNS.terminus; turn < FIXTURE_SCENARIO_TURNS.direction; turn += 1) await rollOnce(page);
  await expect(lottery).toHaveText("抽選: テスト南線のみ ／ 方向抽選 → 品川方面");
  await expect(panelStat(page, "進行方向")).toHaveText("品川方面");
  const viewport = page.viewportSize()!;
  const panel = await gamePanel(page).boundingBox();
  if (!panel) throw new Error("missing panel");
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
  expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
  await expect(diceButton(page)).toBeInViewport();
});

test.describe("lottery reveal after animation", () => {
  test.use({ reducedMotion: "no-preference" });

  test("skip reveals the committed transfer and moves to its platform; reload does not redraw", async ({ page, railwayBundle }) => {
    await page.clock.install();
    await openTitle(page);
    await startNewGame(page);
    await freezeClock(page);
    await diceButton(page).click();
    const committed = (await readSave(page))!;
    expect(committed.currentServiceId).toBe("fixture-south");
    await expect(panelStat(page, "乗車中")).toHaveText("山手線");
    await expect(panelStat(page, "進行方向")).toHaveText("外回り");
    await expect(gamePanel(page).locator(".game-panel__lottery")).toHaveText("抽選: 移動中…");
    await gamePanel(page).getByRole("button", { name: "スキップ" }).click();
    await expect(panelStat(page, "乗車中")).toHaveText("テスト南線");
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, committed));
    expect(await readSave(page)).toEqual(committed);
    await page.reload();
    await page.getByRole("button", { name: /^つづきから（1ターン目・/ }).click();
    await expect(panelStat(page, "乗車中")).toHaveText("テスト南線");
    await expect(gamePanel(page).locator(".game-panel__lottery")).toContainText("抽選 → テスト南線");
    expect(await readSave(page)).toEqual(committed);
  });
});
