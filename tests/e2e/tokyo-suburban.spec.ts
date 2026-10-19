import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { createGame, playTurn, serializeGame, targetSegmentIds } from "../../src/features/game/engine";
import {
  PRODUCT_HISTORY_GAME_SEED,
  PRODUCT_KORAKUEN_TRANSFER_SEED,
  PRODUCT_KORAKUEN_TRANSFER_TURN,
} from "./fixtures/seeds";
import {
  gamePanel,
  markerPosition,
  openTitle,
  panelStat,
  readMap,
  readSave,
  rollOnce,
  writeSaveText,
} from "./support/app";

test.use({ dataset: "real" });

function pinnedSave(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").trimEnd();
}

function stateAt(seed: string, turn: number, network: Parameters<typeof createGame>[2]) {
  let game = createGame(MVP_GAME_CONFIG, seed, network);
  while (game.status === "playing" && game.turn < turn) game = playTurn(game, network).state;
  if (game.status !== "playing" || game.turn !== turn) throw new Error(`Seed did not reach playing turn ${turn}`);
  return game;
}

test("the real Korakuen transfer shows joined station names, candidates, platform, popup, and next ride", async ({ page, railwayBundle }) => {
  const before = stateAt(PRODUCT_KORAKUEN_TRANSFER_SEED, PRODUCT_KORAKUEN_TRANSFER_TURN - 1, railwayBundle.network);
  expect(serializeGame(before)).toBe(pinnedSave("tokyo-suburban-korakuen-before-transfer-save.json"));
  const expected = playTurn(before, railwayBundle.network).state;
  expect(expected.movementHistory.at(-1)).toMatchObject({ toStationId: "metro-korakuen", landing: { serviceId: "metro-marunouchi", direction: 1 } });

  await openTitle(page);
  await writeSaveText(page, pinnedSave("tokyo-suburban-korakuen-before-transfer-save.json"));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("12");
  await rollOnce(page);
  expect(await readSave(page)).toEqual(expected);
  await expect(panelStat(page, "現在駅")).toHaveText("後楽園・春日");
  await expect(panelStat(page, "乗車中")).toHaveText("東京メトロ丸ノ内線 各停");
  const lottery = gamePanel(page).locator(".game-panel__lottery");
  await expect(lottery).toContainText("後楽園・春日：");
  for (const candidate of ["東京メトロ丸ノ内線 各停", "東京メトロ南北線 各停", "都営三田線 各停", "大江戸線"]) {
    await expect(lottery).toContainText(candidate);
  }
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, expected));

  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  const korakuen = railwayBundle.network.stationsById.get("metro-korakuen")!;
  await page.evaluate((center) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center, zoom: 15 });
  }, korakuen.coordinates);
  const korakuenPoint = await page.evaluate((point) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E;
    return hook.map.project(point);
  }, korakuen.coordinates);
  await page.mouse.click(korakuenPoint.x, korakuenPoint.y);
  await expect(page.locator(".maplibregl-popup")).toContainText("後楽園・春日");

  const next = playTurn(expected, railwayBundle.network).state;
  await rollOnce(page);
  expect(await readSave(page)).toEqual(next);
  expect(next.movementHistory.at(-1)).toMatchObject({
    turn: 14,
    serviceId: "metro-marunouchi",
    fromStationId: "metro-korakuen",
    toStationId: "ikebukuro",
  });

  const smallKeStation = railwayBundle.network.stationsById.get("odakyu-shin-yurigaoka")!;
  await page.evaluate((center) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center, zoom: 15 });
  }, smallKeStation.coordinates);
  const smallKePoint = await page.evaluate((point) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E;
    return hook.map.project(point);
  }, smallKeStation.coordinates);
  await page.mouse.click(smallKePoint.x, smallKePoint.y);
  await expect(page.locator(".maplibregl-popup")).toContainText("新百合ヶ丘");
});

test("the product game's actual clearing turn saves the exact result and restarts", async ({ page, railwayBundle }) => {
  const before = stateAt(PRODUCT_HISTORY_GAME_SEED, 41, railwayBundle.network);
  expect(serializeGame(before)).toBe(pinnedSave("tokyo-suburban-before-clear-save.json"));
  const clear = playTurn(before, railwayBundle.network).state;
  expect(clear).toMatchObject({ status: "completed", turn: 42, currentStationId: "shimbashi" });
  const targetIds = targetSegmentIds(MVP_GAME_CONFIG, railwayBundle.network);
  expect(targetIds).toHaveLength(30);
  expect(targetIds.every((id) => clear.completedSegmentIds.includes(id))).toBe(true);

  await openTitle(page);
  await writeSaveText(page, pinnedSave("tokyo-suburban-before-clear-save.json"));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("41");
  await rollOnce(page);
  expect(await readSave(page)).toEqual(clear);
  const result = page.getByRole("region", { name: "クリア！" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("新橋に戻りました");
  await expect(result.locator("dt + dd").first()).toHaveText("42ターン");
  await expect(result.locator("dt + dd").nth(1)).toHaveText("135回");
  await expect(result.locator("dt + dd").nth(2)).toHaveText("19回");
  expect(clear.movementHistory).toHaveLength(42);
  expect(clear.movementHistory.at(-1)).toMatchObject({ toStationId: "shimbashi" });
  expect(clear.completedSegmentIds.filter((id) => id.startsWith("jr-yamanote:"))).toHaveLength(30);

  const history = result.getByRole("listitem");
  const pager = result.getByRole("navigation", { name: "移動履歴のページ" });
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    const pageRecords = clear.movementHistory.slice(pageIndex * 20, (pageIndex + 1) * 20);
    await expect(pager.getByRole("status")).toHaveText(`${pageIndex + 1} / 3ページ`);
    await expect(history).toHaveCount(pageRecords.length);
    for (const [index, record] of pageRecords.entries()) {
      await expect(history.nth(index)).toContainText(`${record.turn}ターン目`);
    }
    if (pageIndex < 2) await pager.getByRole("button", { name: "次のページ" }).click();
  }

  await page.reload();
  await page.getByRole("button", { name: "クリア結果を見る（42ターンでクリア）" }).click();
  await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
  await page.getByRole("region", { name: "クリア！" }).getByRole("button", { name: "もう一度遊ぶ" }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(panelStat(page, "現在駅")).toHaveText("新橋");
  const restarted = await readSave(page);
  expect(restarted).toMatchObject({ turn: 0, status: "playing", movementHistory: [], completedSegmentIds: [] });
});
