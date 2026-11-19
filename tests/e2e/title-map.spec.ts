import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { expect, test } from "./fixtures";
import { CAPITAL_GAME_SEED } from "./fixtures/capital-region/seeds";
import { FIXTURE_GAME_SEED } from "./fixtures/seeds";
import type { RailwayBundle } from "./fixtures/bundle";
import { MAP_HOST } from "./support/mapStub";
import { gamePanel, readMap, startNewGame, titleScreen, writeSaveText } from "./support/app";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const RESIZED_DESKTOP_VIEWPORT = { width: 1024, height: 768 };
const PHONE_VIEWPORT = { width: 320, height: 568 };
const TITLE_PADDING_DESKTOP_PX = 48;
const TITLE_PADDING_PHONE_PX = 24;
const SCREENSHOT_DIRECTORY = resolve(process.cwd(), ".claude/logs/screenshots");
const COMPLETION_TURN_LIMIT = 100;

test.use({ dataset: "capital-region", gameSeed: CAPITAL_GAME_SEED });

async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-11-${name}.png`) });
}

async function screenshot12b(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-12b-${name}.png`) });
}

async function screenshot13(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-13-${name}.png`) });
}

async function expectTargetLoopVisible(page: Page, bundle: RailwayBundle, padding: number): Promise<void> {
  const target = bundle.network.servicesById.get(DEFAULT_GAME_CONFIG.targetServiceId);
  if (!target) throw new Error("The capital-region fixture needs the configured target service");
  const points = Object.values(target.platformCoordinates);
  await expect.poll(async () => {
    const projected = await page.evaluate((coordinates) => {
      const map = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E.map;
      return coordinates.map((point) => map.project(point));
    }, points);
    const viewport = page.viewportSize();
    if (!viewport || projected.length === 0) return false;
    const xs = projected.map(({ x }) => x);
    const ys = projected.map(({ y }) => y);
    const left = Math.min(...xs);
    const right = viewport.width - Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = viewport.height - Math.max(...ys);
    return projected.every(({ x, y }) => x >= padding - 2 && x <= viewport.width - padding + 2 &&
      y >= padding - 2 && y <= viewport.height - padding + 2) &&
      Math.abs(left - right) <= 4 && Math.abs(top - bottom) <= 4;
  }).toBe(true);
}

test("network failure keeps decorative title and disabled play", { tag: "@layout" }, async ({ page, mapStub }, testInfo) => {
  mapStub.failStyle = true;
  await page.route("**/data/stations.json", (route) => route.fulfill({ status: 500, body: "" }));
  await page.setViewportSize(testInfo.project.name === "desktop-chromium" ? DESKTOP_VIEWPORT : PHONE_VIEWPORT);
  await page.goto("/");

  await expect(titleScreen(page)).toBeVisible();
  await expect(titleScreen(page).getByRole("button", { name: "はじめから", exact: true })).toBeDisabled();
  await expect(titleScreen(page).getByRole("button", { name: "遊び方", exact: true })).toBeVisible();
  await expect(page.locator(".title-map-placeholder")).toHaveCount(1);
  await expect(page.locator(".maplibregl-ctrl-attrib")).toBeVisible();
  await expect(page.getByText("ゲームを開始できません", { exact: false })).toBeVisible();
  await expect(page.getByText("データの読み込みに失敗しました", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行", exact: true })).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") await screenshot13(page, "failure-desktop");
});

test("map navigation follows title game and clear modes", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  let completed = createItemGame(DEFAULT_GAME_CONFIG, FIXTURE_GAME_SEED, railwayBundle.network);
  while (completed.status === "playing" && completed.turn < COMPLETION_TURN_LIMIT) {
    const result = playItemTurn(completed, {}, railwayBundle.network);
    completed = result.state.pending?.kind === "discard"
      ? resolveItemDiscard(result.state, result.state.pending.item.id).state
      : result.state;
  }
  if (completed.status !== "completed") throw new Error("Fixture trajectory did not complete");

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto("/");
  await expect(titleScreen(page)).toBeVisible();
  await expect(page.locator(".map-overview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toHaveCount(0);
  await expect(page.locator(".maplibregl-ctrl-attrib")).toBeVisible();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expect(page.locator(".title-map-placeholder")).toBeHidden();
  await screenshot12b(page, "title-desktop");

  await page.setViewportSize(PHONE_VIEWPORT);
  await expect(page.locator(".map-overview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toHaveCount(0);
  await screenshot12b(page, "title-320x568");

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expect(page.locator(".map-overview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toBeVisible();
  await screenshot12b(page, "game-desktop");

  await writeSaveText(page, serializeGame(completed));
  await page.reload();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  const clearButton = page.getByRole("button", { name: `クリア結果を見る（${completed.turn}ターンでクリア）`, exact: true });
  await expect(clearButton).toBeVisible();
  await clearButton.click();
  await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
  await expect(page.locator(".map-overview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toHaveCount(0);
  await expect(page.locator(".maplibregl-ctrl-attrib")).toBeVisible();
  await screenshot12b(page, "clear-desktop");
});

test("title refits target loop on return and resize", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto("/");
  await expect(titleScreen(page)).toBeVisible();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expectTargetLoopVisible(page, railwayBundle, TITLE_PADDING_DESKTOP_PX);
  await screenshot(page, "title-desktop");

  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await screenshot(page, "game-from-title-desktop");

  await gamePanel(page).getByRole("button", { name: "メニュー", exact: true }).click();
  await gamePanel(page).getByRole("button", { name: "タイトル", exact: true }).click();
  await expect(titleScreen(page)).toBeVisible();
  await expectTargetLoopVisible(page, railwayBundle, TITLE_PADDING_DESKTOP_PX);

  await page.setViewportSize(RESIZED_DESKTOP_VIEWPORT);
  await expectTargetLoopVisible(page, railwayBundle, TITLE_PADDING_DESKTOP_PX);
  await screenshot(page, "title-resized-desktop");

  await page.setViewportSize(PHONE_VIEWPORT);
  await expectTargetLoopVisible(page, railwayBundle, TITLE_PADDING_PHONE_PX);
  await screenshot(page, "title-320x568");
});

test("title placeholder survives delayed paint and failure", { tag: "@layout" }, async ({ page }) => {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  let releaseFirstStyle: () => void = () => undefined;
  const firstStyleGate = new Promise<void>((resolve) => { releaseFirstStyle = resolve; });
  let styleRequests = 0;
  await page.route(`${MAP_HOST}/styles/**`, async (route) => {
    styleRequests += 1;
    if (styleRequests === 1) await firstStyleGate;
    if (styleRequests === 2) {
      await route.abort("connectionrefused");
      return;
    }
    await route.fallback();
  });

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto("/");
  const placeholder = page.locator(".title-map-placeholder");
  await expect(titleScreen(page)).toBeVisible();
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveAttribute("aria-hidden", "true");
  await expect(placeholder.locator("svg")).toHaveAttribute("focusable", "false");
  await expect(placeholder.locator("button, a, [tabindex]")).toHaveCount(0);
  expect(await placeholder.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, "rgts-12a-placeholder-desktop.png") });

  await page.setViewportSize(PHONE_VIEWPORT);
  await expect(placeholder).toBeVisible();
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, "rgts-12a-placeholder-320x568.png") });

  releaseFirstStyle();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expect(placeholder).toBeHidden();

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.reload();
  const errorBanner = page.getByRole("alert").filter({ hasText: "地図の読み込みに失敗しました。" });
  await expect(errorBanner).toBeVisible();
  await expect(placeholder).toBeVisible();
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, "rgts-12a-failure-desktop.png") });

  await errorBanner.getByRole("button", { name: "再試行" }).click();
  await expect(errorBanner).toBeHidden();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expect(placeholder).toBeHidden();
  expect(styleRequests).toBe(3);
});
