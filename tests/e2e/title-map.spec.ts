import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { expect, test } from "./fixtures";
import { CAPITAL_GAME_SEED } from "./fixtures/capital-region/seeds";
import type { RailwayBundle } from "./fixtures/bundle";
import { gamePanel, readMap, startNewGame, titleScreen } from "./support/app";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const RESIZED_DESKTOP_VIEWPORT = { width: 1024, height: 768 };
const PHONE_VIEWPORT = { width: 320, height: 568 };
const TITLE_PADDING_DESKTOP_PX = 48;
const TITLE_PADDING_PHONE_PX = 24;
const SCREENSHOT_DIRECTORY = resolve(process.cwd(), ".claude/logs/screenshots");

test.use({ dataset: "capital-region", gameSeed: CAPITAL_GAME_SEED });

async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `rgts-11-${name}.png`) });
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
