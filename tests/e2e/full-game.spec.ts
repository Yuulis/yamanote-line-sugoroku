import { FIXTURE_GAME_SEED, FIXTURE_SCENARIO_TURNS } from "./fixtures/seeds";
import { expect, test } from "./fixtures";
import {
  gamePanel,
  loadStations,
  openTitle,
  panelStat,
  REQUIRED_SEGMENTS,
  readSave,
  rollOnce,
  startNewGame,
  targetCompletedIds,
} from "./support/app";

// Spec 8.3 items covered here (MVP completion condition, spec 9):
//   [8.3-2] Repeated rolls move around the whole loop.
//   [8.3-3] All 30 segments end up completed.
//   [8.3-4] A cleared game reopens its result after a reload.

/** This fixture trajectory is proved by Vitest, including lotteries and endpoints. */
const MAX_TURNS = FIXTURE_SCENARIO_TURNS.completed;
const GOAL_STATION_ID = "shimbashi";

test.use({ dataset: "fixture" });

test("[8.3-2/3] play a full game to the clear screen, then play again", async ({
  page,
  railwayBundle,
}) => {
  const stations = await loadStations(railwayBundle);
  await openTitle(page);
  await startNewGame(page);
  const clear = page.getByRole("region", { name: "クリア！" });

  for (let turn = 0; turn < MAX_TURNS && !(await clear.isVisible()); turn += 1) {
    await rollOnce(page);
  }
  await expect(clear).toBeVisible();
  await expect(clear.getByRole("button", { name: "結果をコピー" })).toBeVisible();

  const save = await readSave(page);
  if (!save) throw new Error("the clearing turn was not saved");
  expect(save.status).toBe("completed");
  expect(save.currentStationId).toBe(GOAL_STATION_ID);
  expect(new Set(targetCompletedIds(save)).size).toBe(REQUIRED_SEGMENTS);
  expect(save.rngSeed).toBe(FIXTURE_GAME_SEED);
  expect(save.turn).toBe(MAX_TURNS);
  expect(save.completedSegmentIds.length).toBeGreaterThan(REQUIRED_SEGMENTS);

  await expect(clear).toContainText("新橋に戻りました");
  const stats = clear.locator("dl");
  await expect(stats.locator("dt + dd").first()).toHaveText(`${save.turn}ターン`);
  await expect(stats.locator("dt + dd").nth(1)).toHaveText(`${save.movementHistory.reduce((total, record) => total + record.traversedSegmentIds.length, 0)}回`);
  const items = clear.getByRole("listitem");
  await expect(items).toHaveCount(save.turn);
  for (const [index, record] of save.movementHistory.entries()) {
    const from = stations.get(record.fromStationId)?.name;
    const to = stations.get(record.toStationId)?.name;
    if (record.kind !== "item-ride") throw new Error("Autoplay should not use deadhead");
    const service = railwayBundle.network.servicesById.get(record.resolvedRide.serviceId)!;
    const direction = record.resolvedRide.direction === 1 ? service.directionLabels.forward : service.directionLabels.backward;
    await expect(items.nth(index)).toContainText(`${record.turn}ターン目 出目${record.rawRoll}`);
    await expect(items.nth(index)).toContainText(`${record.physicalHops}駅移動`);
    await expect(items.nth(index)).toContainText(`${from} → ${to}`);
    await expect(items.nth(index)).toContainText(`（${service.name}・${direction}）`);
    if (record.unusedPips > 0) {
      await expect(items.nth(index)).toContainText(`残り${record.unusedPips}は使わず`);
    }
    if (record.landing && record.landing.serviceId !== record.resolvedRide.serviceId) {
      const next = railwayBundle.network.servicesById.get(record.landing.serviceId)!;
      await expect(items.nth(index)).toContainText(`抽選 → ${next.name}`);
    }

  }

  // The result survives a reload and is offered on the title screen.
  await page.reload();
  await page.getByRole("button", { name: `クリア結果を見る（${save.turn}ターンでクリア）` }).click();
  await expect(clear).toBeVisible();

  await clear.getByRole("button", { name: "もう一度遊ぶ" }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(panelStat(page, "現在駅")).toHaveText("新橋");
  await expect(panelStat(page, "踏破区間")).toHaveText(`0/${REQUIRED_SEGMENTS}`);
  const restarted = await readSave(page);
  expect(restarted?.turn).toBe(0);
  expect(restarted?.status).toBe("playing");
  expect(restarted?.movementHistory).toEqual([]);
  expect(restarted?.completedSegmentIds).toEqual([]);
});
