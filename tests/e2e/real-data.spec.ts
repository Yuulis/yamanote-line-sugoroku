import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { createGame, playTurn, serializeGame } from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { expect, test } from "./fixtures";
import { PRODUCT_UENO_TRANSFER_SEED } from "./fixtures/seeds";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { diceButton, gamePanel, markerPosition, openTitle, panelStat, readMap, readSave, rollOnce, startNewGame, writeSaveText } from "./support/app";

test.use({ dataset: "real" });
const SCREENSHOT_DIR = resolve(".claude/logs/jrcr-s6/screenshots");

async function expectPlatformsInView(page: Page, points: [number, number][]): Promise<void> {
  const projected = await page.evaluate((coordinates) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E;
    return coordinates.map((point) => {
      const { x, y } = hook.map.project(point);
      return { x, y };
    });
  }, points);
  const viewport = page.viewportSize()!;
  const panel = (await gamePanel(page).boundingBox())!;
  for (const { x, y } of projected) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(viewport.width);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(viewport.height);
    expect(x < panel.x || x > panel.x + panel.width || y < panel.y || y > panel.y + panel.height).toBe(true);
  }
}


test("the shipped Tokyo suburban product network starts, moves and restores without console errors", async ({ page, railwayBundle }, testInfo) => {
  // One smoke over the full 1,586-station bundle with several reloads under
  // software WebGL; it measures 22-33 s locally, at the default 30 s limit.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  expect(railwayBundle.network.stationsById.size).toBe(1_586);
  expect(railwayBundle.network.servicesById.size).toBe(135);
  expect(railwayBundle.network.segmentsById.size).toBe(3_988);
  if (!railwayBundle.data.services.ok) throw new Error("The shipped service catalogue did not load");
  expect(railwayBundle.data.services.value.services.reduce((sum, service) => sum + service.stationIds.length, 0)).toBe(2_142);
  await openTitle(page);
  await expect(page.getByText("JR東日本 1都3県版", { exact: true })).toBeVisible();
  await page.evaluate(() => performance.mark("jrcr-s6-app-start"));
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await page.evaluate(() => performance.mark("jrcr-s6-map-style-ready"));
  if (testInfo.project.name === "desktop-chromium") {
    const loadMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const dataResources = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/data/")) as PerformanceResourceTiming[];
      return {
        domInteractiveMs: navigation.domInteractive,
        loadEventEndMs: navigation.loadEventEnd,
        appStartToMapStyleReadyMs: performance.measure(
          "jrcr-s6-app-startup",
          "jrcr-s6-app-start",
          "jrcr-s6-map-style-ready",
        ).duration,
        dataResources: dataResources.map((entry) => ({
          file: new URL(entry.name).pathname.split("/").at(-1),
          durationMs: entry.duration,
          transferBytes: entry.transferSize,
          decodedBytes: entry.decodedBodySize,
        })),
      };
    });
    console.info(`JRCR_S6_LOAD_METRICS ${JSON.stringify(loadMetrics)}`);
  }
  const legend = gamePanel(page).getByRole("list", { name: "凡例" });
  await expect(legend).toContainText("京浜東北線");
  await expect(legend).toContainText("中央・総武線各駅停車");
  await expect(legend).toContainText("埼京線");
  await expect(legend).toContainText("京葉線");
  const yamanotePoints = Object.values(railwayBundle.network.servicesById.get("jr-yamanote")!.platformCoordinates);
  await expectPlatformsInView(page, yamanotePoints);
  const allPlatforms = [...railwayBundle.network.servicesById.values()]
    .flatMap((service) => Object.values(service.platformCoordinates));
  expect(railwayBundle.network.servicesById.size).toBe(135);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await expectPlatformsInView(page, allPlatforms);
  await page.screenshot({ path: testInfo.outputPath("network-overview.png") });
  const renderedServices = await page.evaluate((layer) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { queryRenderedFeatures(options: { layers: string[] }): { properties: { serviceId: string } }[] } } }).__sugorokuE2E;
    return [...new Set(hook.map.queryRenderedFeatures({ layers: [layer] }).map((feature) => feature.properties.serviceId))].sort();
  }, LAYER_IDS.services);
  const expectedNonTargetServices = [...railwayBundle.network.servicesById.keys()]
    .filter((serviceId) => serviceId !== MVP_GAME_CONFIG.targetServiceId)
    .sort();
  expect(renderedServices).toEqual(expectedNonTargetServices);
  expect((await readMap(page))?.pendingRenderedIds.length).toBeGreaterThan(0);
  if (testInfo.project.name === "desktop-chromium" || testInfo.project.name === "phone-chromium") {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const device = testInfo.project.name === "phone-chromium" ? "phone" : "desktop";
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, `network-overview-${device}.png`) });
    const ueno = railwayBundle.network.stationsById.get("ueno")!.coordinates;
    await page.evaluate((center) => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
      hook.map.jumpTo({ center, zoom: 14 });
    }, ueno);
    const zoomedFeatureCount = await page.evaluate((layer) => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { queryRenderedFeatures(options: { layers: string[] }): unknown[] } } }).__sugorokuE2E;
      return hook.map.queryRenderedFeatures({ layers: [layer] }).length;
    }, LAYER_IDS.services);
    expect(zoomedFeatureCount).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, `ueno-zoom-${device}.png`) });
  }
  for (let turn = 0; turn < 3; turn += 1) await rollOnce(page);
  const saved = (await readSave(page))!;
  expect(saved.turn).toBe(3);
  await expect(panelStat(page, "乗車中")).toHaveText(railwayBundle.network.servicesById.get(saved.currentServiceId)!.name);
  await expect(panelStat(page, "進行方向")).not.toBeEmpty();
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, saved));
  await expect(diceButton(page)).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("populated-panel.png") });
  await page.reload();
  await page.getByRole("button", { name: /^つづきから（3ターン目・/ }).click();
  expect(await readSave(page)).toEqual(saved);
  // Resuming the saved game can finish before the asynchronously rebuilt map.
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  // A new game must re-fit the network even after moving/zooming elsewhere.
  await page.evaluate(() => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center: [139.61, 35.72], zoom: 16 });
  });
  await gamePanel(page).getByRole("button", { name: "新規", exact: true }).click();
  await page.getByRole("button", { name: "新しく始める", exact: true }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expectPlatformsInView(page, yamanotePoints);
  await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);
  if (testInfo.project.name === "desktop-chromium") {
    let transferGame = createGame(MVP_GAME_CONFIG, PRODUCT_UENO_TRANSFER_SEED, railwayBundle.network);
    while (
      transferGame.status === "playing" &&
      transferGame.turn < 5_000 &&
      !(transferGame.currentStationId === "ueno" && transferGame.currentServiceId === "jr-joban-rapid")
    ) {
      transferGame = playTurn(transferGame, railwayBundle.network).state;
    }
    expect(transferGame.currentStationId).toBe("ueno");
    expect(transferGame.currentServiceId).toBe("jr-joban-rapid");
    await writeSaveText(page, serializeGame(transferGame));
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, transferGame));
    const uenoPlatform = railwayBundle.network.servicesById.get("jr-joban-rapid")!.platformCoordinates.ueno!;
    await page.evaluate((center) => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
      hook.map.jumpTo({ center, zoom: 15.5 });
    }, uenoPlatform);
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, transferGame));
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "ueno-transfer-desktop.png") });
  }
  expect(errors).toEqual([]);
});
