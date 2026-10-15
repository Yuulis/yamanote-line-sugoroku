import { expect, test } from "./fixtures";
import {
  gamePanel,
  loadStations,
  markerPosition,
  openTitle,
  panelStat,
  readMap,
  readSave,
  rollOnce,
  startNewGame,
  targetFeatureIds,
  titleScreen,
} from "./support/app";

// Spec 8.3 item covered here:
//   [8.3-6] The game state survives when the map (style / tiles) cannot be fetched.

const MAP_ERROR_TEXT = "地図の読み込みに失敗しました。";

test.use({ dataset: "fixture" });

test("[8.3-6] a failed map style keeps the game playable and retry recovers the map", async ({
  page,
  railwayBundle,
  mapStub,
}) => {
  const stations = await loadStations(railwayBundle);
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  const firstTurn = await readSave(page);

  // The map service goes down; the page is reloaded mid-game.
  mapStub.failStyle = true;
  await page.reload();
  const banner = page.getByRole("alert").filter({ hasText: MAP_ERROR_TEXT });
  await expect(banner).toBeVisible();
  await expect(titleScreen(page)).toBeVisible();
  expect(await readSave(page)).toEqual(firstTurn);

  // Resume and keep playing without a map.
  await page.getByRole("button", { name: /^つづきから（1ターン目・/ }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("1");
  await rollOnce(page);
  const secondTurn = await readSave(page);
  if (!secondTurn) throw new Error("the turn played without a map was not saved");
  expect(secondTurn.turn).toBe(2);
  const station = stations.get(secondTurn.currentStationId);
  await expect(panelStat(page, "現在駅")).toHaveText(station?.name ?? "?");
  await expect(banner).toBeVisible();
  expect(await readMap(page)).toBeNull();

  // The service is back: retry rebuilds the map with the current progress.
  mapStub.failStyle = false;
  await banner.getByRole("button", { name: "再試行" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, secondTurn));
  await expect
    .poll(async () => [...((await readMap(page))?.completedFilterIds ?? [])].sort())
    .toEqual(targetFeatureIds(secondTurn, railwayBundle).sort());
  await expect(gamePanel(page)).toBeVisible();
  await expect(panelStat(page, "ターン数")).toHaveText("2");
  expect(await readSave(page)).toEqual(secondTurn);
});

test("[8.3-6] tiles failing before the map loads: retry message, game kept, retry recovers", async ({
  page,
  railwayBundle,
  mapStub,
}) => {
  // MapLibre does not repaint after a network tile error, so with every tile
  // failing the map never fires "load"; the app reports it like a style failure.
  mapStub.failTiles = true;
  await openTitle(page);
  const banner = page.getByRole("alert").filter({ hasText: MAP_ERROR_TEXT });
  await expect(banner).toBeVisible();
  expect(mapStub.counts.tiles).toBeGreaterThan(0);

  await startNewGame(page);
  await rollOnce(page);
  await rollOnce(page);
  const save = await readSave(page);
  if (!save) throw new Error("no save after two rolls");
  expect(save.turn).toBe(2);
  await expect(panelStat(page, "ターン数")).toHaveText("2");

  mapStub.failTiles = false;
  await banner.getByRole("button", { name: "再試行" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, save));
  await expect
    .poll(async () => [...((await readMap(page))?.completedFilterIds ?? [])].sort())
    .toEqual(targetFeatureIds(save, railwayBundle).sort());
  expect(await readSave(page)).toEqual(save);
});

test("[8.3-6] tiles failing after the map loaded are tolerated without losing the game", async ({
  page,
  mapStub,
}) => {
  await openTitle(page);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await rollOnce(page);

  // Keep zooming until the viewport needs uncached tiles, and fail those requests.
  mapStub.failTiles = true;
  const tilesBefore = mapStub.counts.tiles;
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let attempt = 0; attempt < 3 && mapStub.counts.tiles === tilesBefore; attempt += 1) {
    await zoomIn.click();
    try {
      await expect.poll(() => mapStub.counts.tiles, { timeout: 1_000 }).toBeGreaterThan(tilesBefore);
    } catch {
      // Some camera zoom steps stay within tiles already in the viewport cache.
    }
  }
  await expect.poll(() => mapStub.counts.tiles).toBeGreaterThan(tilesBefore);

  await rollOnce(page);
  await expect(panelStat(page, "ターン数")).toHaveText("2");
  expect((await readSave(page))?.turn).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: MAP_ERROR_TEXT })).toHaveCount(0);
});
