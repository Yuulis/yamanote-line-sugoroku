import type { Page } from "@playwright/test";
import type { RailwayBundle } from "./fixtures/bundle";
import { expect, test } from "./fixtures";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { diceButton, gamePanel, markerPosition, openTitle, panelStat, readMap, readSave, rollOnce, startNewGame } from "./support/app";

test.use({ dataset: "real" });

async function expectNetworkOverview(page: Page, railwayBundle: RailwayBundle): Promise<void> {
  // At turn 0, every platform fits outside the panel. This also catches an
  // immediate follow-camera jump that undoes the initial network fit.
  const points = [...railwayBundle.network.servicesById.values()].flatMap((service) => Object.values(service.platformCoordinates));
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

test("the shipped five-service network starts, moves and restores without console errors", async ({ page, railwayBundle }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  expect(railwayBundle.network.stationsById.size).toBe(67);
  await openTitle(page);
  await expect(page.getByText("JR東日本 東京23区版", { exact: true })).toBeVisible();
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  const legend = gamePanel(page).getByRole("list", { name: "凡例" });
  await expect(legend).toContainText("京浜東北線");
  await expect(legend).toContainText("中央・総武線各駅停車");
  await expect(legend).toContainText("埼京線");
  await expect(legend).toContainText("京葉線");
  const renderedServices = await page.evaluate((layer) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { queryRenderedFeatures(options: { layers: string[] }): { properties: { serviceId: string } }[] } } }).__sugorokuE2E;
    return [...new Set(hook.map.queryRenderedFeatures({ layers: [layer] }).map((feature) => feature.properties.serviceId))].sort();
  }, LAYER_IDS.services);
  expect(renderedServices).toEqual(["jr-chuo-sobu-local", "jr-keihin-tohoku", "jr-keiyo", "jr-saikyo"]);
  await expectNetworkOverview(page, railwayBundle);
  await page.screenshot({ path: testInfo.outputPath("network-overview.png") });
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
  await expectNetworkOverview(page, railwayBundle);
  await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);
  expect(errors).toEqual([]);
});
