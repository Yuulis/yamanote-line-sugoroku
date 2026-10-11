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
} from "./support/app";

// Spec 8.3 items covered here (MVP completion condition, spec 9):
//   [8.3-2] Repeated rolls move around the whole loop.
//   [8.3-3] All 30 segments end up completed.
//   [8.3-4] A cleared game reopens its result after a reload.

/** A loop of 30 segments needs at most 30 rolls even if every roll is a 1. */
const MAX_TURNS = REQUIRED_SEGMENTS;
const GOAL_STATION_ID = "shimbashi";

test("[8.3-2/3] play a full game to the clear screen, then play again", async ({
  page,
  request,
}) => {
  const stations = await loadStations(request);
  await openTitle(page);
  await startNewGame(page);
  const clear = page.getByRole("region", { name: "クリア！" });

  for (let turn = 0; turn < MAX_TURNS && !(await clear.isVisible()); turn += 1) {
    await rollOnce(page);
  }
  await expect(clear).toBeVisible();

  const save = await readSave(page);
  if (!save) throw new Error("the clearing turn was not saved");
  expect(save.status).toBe("completed");
  expect(save.currentStationId).toBe(GOAL_STATION_ID);
  expect(new Set(save.completedSegmentIds).size).toBe(REQUIRED_SEGMENTS);

  await expect(clear).toContainText("新橋に戻りました");
  const stats = clear.locator("dl");
  await expect(stats.locator("dt + dd").first()).toHaveText(`${save.turn}ターン`);
  await expect(stats.locator("dt + dd").nth(1)).toHaveText(`${REQUIRED_SEGMENTS}回`);
  const items = clear.getByRole("listitem");
  await expect(items).toHaveCount(save.turn);
  for (const [index, record] of save.movementHistory.entries()) {
    const from = stations.get(record.fromStationId)?.name;
    const to = stations.get(record.toStationId)?.name;
    const unused = record.roll - record.traversedSegmentIds.length;
    const note = unused > 0 ? `（新橋で停止、残り${unused}）` : "";
    await expect(items.nth(index)).toHaveText(
      `${record.turn}ターン目 出目${record.roll}：${from} → ${to}${note}`,
    );
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
