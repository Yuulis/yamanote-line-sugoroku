import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { createGame, playTurn, serializeGame } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { UiLineGroup } from "../../src/types/data";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { PRODUCT_HISTORY_GAME_SEED, PRODUCT_UENO_TRANSFER_SEED } from "./fixtures/seeds";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { diceButton, gamePanel, markerPosition, openTitle, panelStat, readMap, readSave, rollOnce, startNewGame, writeSaveText } from "./support/app";

test.use({ dataset: "real" });
const SCREENSHOT_DIR = resolve(".claude/logs/s6/screenshots");
const OEDO_LOTTERY_SEED = PRODUCT_HISTORY_GAME_SEED;
const OEDO_LOTTERY_TURN = 16;

function productLineGroups(bundle: RailwayBundle): UiLineGroup[] {
  if (!bundle.data.manifest.ok || !bundle.data.manifest.value.uiPresentation) {
    throw new Error("The shipped product presentation metadata did not load");
  }
  return bundle.data.manifest.value.uiPresentation.lineGroups;
}

function gameAfterTurn(bundle: RailwayBundle, seed: string, turn: number) {
  let game = createGame(MVP_GAME_CONFIG, seed, bundle.network);
  while (game.status === "playing" && game.turn < turn) game = playTurn(game, bundle.network).state;
  if (game.turn !== turn || game.status !== "playing") throw new Error(`Seed ${seed} did not reach turn ${turn}`);
  return game;
}

async function filteredPrimitiveIds(page: Page): Promise<string[] | null> {
  return page.evaluate((layerId) => {
    const map = (window as unknown as { __sugorokuE2E: { map: { getFilter(id: string): unknown } } }).__sugorokuE2E.map;
    const filter = map.getFilter(layerId);
    if (filter == null) return null;
    if (
      Array.isArray(filter) && filter[0] === "in" && Array.isArray(filter[2]) &&
      filter[2][0] === "literal" && Array.isArray(filter[2][1])
    ) return filter[2][1] as string[];
    throw new Error(`Unexpected primitive visibility filter: ${JSON.stringify(filter)}`);
  }, LAYER_IDS.base);
}

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

test("the Oedo legend checkbox groups both services and works by keyboard and phone touch", async ({ page, railwayBundle }) => {
  const oedo = productLineGroups(railwayBundle).find((group) => group.id === "toei-oedo");
  expect(oedo).toMatchObject({
    name: "大江戸線",
    serviceIds: ["toei-oedo-loop", "toei-oedo-radial"],
  });
  if (!oedo) throw new Error("The grouped Oedo line is missing from product presentation metadata");

  const otherFeatureIds = new Set(
    productLineGroups(railwayBundle)
      .filter((group) => group.id !== oedo.id)
      .flatMap((group) => group.serviceIds)
      .flatMap((serviceId) => [...railwayBundle.network.segmentsById.values()]
        .filter((segment) => segment.serviceId === serviceId)
        .flatMap((segment) => segment.geometryFeatureIds)),
  );
  const oedoFeatureIdsByService = new Map(oedo.serviceIds.map((serviceId) => [
    serviceId,
    [...new Set([...railwayBundle.network.segmentsById.values()]
      .filter((segment) => segment.serviceId === serviceId)
      .flatMap((segment) => segment.geometryFeatureIds))]
      .filter((featureId) => !otherFeatureIds.has(featureId)),
  ]));
  for (const featureIds of oedoFeatureIdsByService.values()) expect(featureIds.length).toBeGreaterThan(0);

  await openTitle(page);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  const panel = gamePanel(page);
  const legendToggle = panel.getByRole("button", { name: /路線の凡例/ });
  await legendToggle.focus();
  await page.keyboard.press("Enter");
  await expect(legendToggle).toHaveAttribute("aria-expanded", "true");

  const toei = panel.locator(".game-panel__legend-operator").filter({ hasText: "東京都交通局" });
  const toeiSummary = toei.locator("summary");
  await toeiSummary.focus();
  await page.keyboard.press("Enter");
  await expect(toei).toHaveAttribute("open");
  const oedoToggle = toei.getByRole("checkbox", { name: "大江戸線を表示" });
  await expect(oedoToggle).toHaveCount(1);
  await oedoToggle.focus();
  await page.keyboard.press("Space");
  await expect(oedoToggle).not.toBeChecked();
  const hiddenIds = await filteredPrimitiveIds(page);
  if (!hiddenIds) throw new Error("Unchecking Oedo must produce an explicit primitive filter");
  for (const featureIds of oedoFeatureIdsByService.values()) {
    for (const featureId of featureIds) expect(hiddenIds).not.toContain(featureId);
  }

  await page.keyboard.press("Space");
  await expect(oedoToggle).toBeChecked();
  await expect.poll(() => filteredPrimitiveIds(page)).toBeNull();
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    await oedoToggle.tap();
    await expect(oedoToggle).not.toBeChecked();
    await oedoToggle.tap();
    await expect(oedoToggle).toBeChecked();
    await expect.poll(() => filteredPrimitiveIds(page)).toBeNull();
  }
});

test("Oedo candidates at 都庁前 display one row with two lottery slots", async ({ page, railwayBundle }) => {
  const before = gameAfterTurn(railwayBundle, OEDO_LOTTERY_SEED, OEDO_LOTTERY_TURN - 1);
  const result = playTurn(before, railwayBundle.network);
  const game = result.state;
  const record = game.movementHistory.at(-1)!;
  expect(record).toMatchObject({ turn: OEDO_LOTTERY_TURN, toStationId: "toei-tochomae" });
  expect(result.events.find((event) => event.type === "landing-resolved")).toMatchObject({
    type: "landing-resolved",
    stationId: "toei-tochomae",
    serviceCandidates: ["toei-oedo-loop", "toei-oedo-radial"],
  });

  await openTitle(page);
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(panelStat(page, "現在駅")).toHaveText("都庁前");
  await expect(gamePanel(page).locator(".game-panel__lottery"))
    .toContainText("都庁前：大江戸線（抽選枠2）から抽選 → 大江戸線");
});

test("operator and line filters hide, restore, and resolve a Fukutoshin shared primitive", async ({ page, railwayBundle }) => {
  const uiLineGroups = productLineGroups(railwayBundle);
  const fukutoshin = uiLineGroups.find((group) => group.id === "metro-fukutoshin");
  if (!fukutoshin) throw new Error("The Fukutoshin line group is missing from product presentation metadata");
  const sharedFeatureId = "metro-yurakucho:metro-wakoshi~metro-chikatetsu-narimasu";
  const sharedSegments = [...railwayBundle.network.segmentsById.values()]
    .filter((segment) => segment.geometryFeatureIds.includes(sharedFeatureId));
  expect(sharedSegments.map((segment) => segment.serviceId)).toContain("metro-fukutoshin");
  expect(sharedSegments.map((segment) => segment.serviceId)).toContain("metro-yurakucho");

  await openTitle(page);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  const panel = gamePanel(page);
  await panel.getByRole("button", { name: /路線の凡例/ }).click();
  const metro = panel.locator(".game-panel__legend-operator").filter({ hasText: "東京地下鉄" });
  await metro.locator("summary").click();
  const selectMetro = metro.getByRole("checkbox", { name: "東京地下鉄の路線をすべて表示" });
  await selectMetro.uncheck();
  const hiddenByOperator = await filteredPrimitiveIds(page);
  if (!hiddenByOperator) throw new Error("Unchecking the operator must produce an explicit primitive filter");
  expect(hiddenByOperator).not.toContain(sharedFeatureId);

  const fukutoshinToggle = metro.getByRole("checkbox", { name: `${fukutoshin.name}を表示` });
  await fukutoshinToggle.check();
  expect(await filteredPrimitiveIds(page)).toContain(sharedFeatureId);
  await fukutoshinToggle.uncheck();
  const hiddenByLine = await filteredPrimitiveIds(page);
  if (!hiddenByLine) throw new Error("Unchecking Fukutoshin must produce an explicit primitive filter");
  expect(hiddenByLine).not.toContain(sharedFeatureId);
  await fukutoshinToggle.check();
  expect(await filteredPrimitiveIds(page)).toContain(sharedFeatureId);
});


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
  await expect(page.getByText("東京近郊版", { exact: true })).toBeVisible();
  await page.evaluate(() => performance.mark("jrcr-s6-app-start"));
  await startNewGame(page);
  const panelSubtitle = gamePanel(page).getByText("東京近郊版", { exact: true });
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    await expect(panelSubtitle).toBeHidden();
  } else {
    await expect(panelSubtitle).toBeVisible();
  }
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await page.evaluate(() => performance.mark("jrcr-s6-map-style-ready"));
  if (testInfo.project.name === "desktop-chromium" || testInfo.project.name === "phone-chromium") {
    const loadMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const dataResources = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/data/")) as PerformanceResourceTiming[];
      return {
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
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
    console.info(`JRCR_S6_LOAD_METRICS ${JSON.stringify({
      project: testInfo.project.name,
      coldRepeat: testInfo.repeatEachIndex + 1,
      ...loadMetrics,
    })}`);
  }
  const panel = gamePanel(page);
  const lineToggle = panel.getByRole("button", { name: /路線の凡例/ });
  await expect(lineToggle).toHaveAttribute("aria-expanded", "false");
  await lineToggle.click();
  const jrOperator = panel.locator(".game-panel__legend-operator").filter({ hasText: "東日本旅客鉄道" });
  await expect(jrOperator).toHaveCount(1);
  await jrOperator.locator("summary").click();
  await expect(panel.getByRole("checkbox", { name: "京浜東北線を表示" })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "中央・総武線各駅停車を表示" })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "埼京線を表示" })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "京葉線を表示" })).toBeVisible();
  await expect(diceButton(page)).toBeInViewport();
  await page.getByRole("button", { name: "目標路線", exact: true }).click();
  const yamanotePoints = Object.values(railwayBundle.network.servicesById.get("jr-yamanote")!.platformCoordinates);
  await expectPlatformsInView(page, yamanotePoints);
  const allPlatforms = [...railwayBundle.network.servicesById.values()]
    .flatMap((service) => Object.values(service.platformCoordinates));
  expect(railwayBundle.network.servicesById.size).toBe(135);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await expectPlatformsInView(page, allPlatforms);
  const canvas = page.locator("canvas.maplibregl-canvas");
  const canvasBounds = (await canvas.boundingBox())!;
  const panelBounds = (await gamePanel(page).boundingBox())!;
  const panPoint = {
    x: Math.min(
      canvasBounds.x + canvasBounds.width - 24,
      Math.max(canvasBounds.x + canvasBounds.width * 0.8, panelBounds.x + panelBounds.width + 24),
    ),
    y: Math.max(canvasBounds.y + 24, Math.min(canvasBounds.y + canvasBounds.height * 0.2, panelBounds.y - 24)),
  };
  if (testInfo.project.name === "desktop-chromium") {
    const centerBeforePan = await page.evaluate(() => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { getCenter(): { lng: number; lat: number } } } }).__sugorokuE2E;
      const center = hook.map.getCenter();
      return [center.lng, center.lat];
    });
    await page.mouse.move(panPoint.x, panPoint.y);
    await page.mouse.down();
    await page.mouse.move(panPoint.x - 96, panPoint.y + 48, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { getCenter(): { lng: number; lat: number } } } }).__sugorokuE2E;
      const center = hook.map.getCenter();
      return [center.lng, center.lat];
    })).not.toEqual(centerBeforePan);
  }
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
  const presentation = createPresentationResolver(
    railwayBundle.network,
    railwayBundle.data.manifest.ok ? railwayBundle.data.manifest.value.uiPresentation : undefined,
  );
  await expect(panelStat(page, "乗車中")).toHaveText(presentation.serviceName(saved.currentServiceId));
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
