import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { CAPITAL_BRANCH_SEED, CAPITAL_GAME_SEED } from "./fixtures/capital-region/seeds";
import { createGame, playTurn, serializeGame } from "../../src/features/game/engine";
import type { GameState } from "../../src/types/network";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { buildGeometryIndex, buildMovePlan } from "../../src/features/game/animation/movePath";
import { hopDurationMs } from "../../src/features/game/animation/timeline";
import type { MoveResult } from "../../src/features/game/engine";
import type { RailwayBundle } from "./fixtures/bundle";
import {
  PRODUCT_COMPOSED_GAME_SEED,
  PRODUCT_COMPOSED_SCENARIO_TURNS,
  PRODUCT_HISTORY_GAME_SEED,
  PRODUCT_HISTORY_SCENARIO_TURNS,
  PRODUCT_HUB_GAME_SEED,
} from "./fixtures/seeds";
import { diceButton, freezeClock, gamePanel, markerPosition, openTitle, panelStat, readMap, readSave, rollOnce, startNewGame, writeSaveText } from "./support/app";

const PRODUCT_COMPOSED_FORWARD = "jr-shonan-shinjuku-rapid-takasaki:musashi-kosugi:yokohama";
const PRODUCT_COMPOSED_REVERSE = "jr-shonan-shinjuku-rapid-takasaki:yokohama:musashi-kosugi";
const DEFAULT_STEP_MS = 450;

interface ComposedTiming {
  beforeTargetMs: number;
  targetDurationMs: number;
  totalMs: number;
}

function gameBeforeTurn(network: RailwayBundle["network"], seed: string, turn: number): GameState {
  let game = createGame(MVP_GAME_CONFIG, seed, network);
  while (game.status === "playing" && game.turn < turn) game = playTurn(game, network).state;
  if (game.turn !== turn || game.status !== "playing") throw new Error(`Seed ${seed} did not reach turn ${turn}`);
  return game;
}

function composedTiming(bundle: RailwayBundle, result: MoveResult, segmentId: string): ComposedTiming {
  if (!bundle.data.geometry.ok) throw new Error("Product geometry is required for the composed-hop reveal");
  const plan = buildMovePlan(result.events, bundle.network, buildGeometryIndex(bundle.data.geometry.value));
  const targetIndex = plan.findIndex((step) => step.segmentId === segmentId);
  if (targetIndex < 0) throw new Error(`Move does not contain composed segment ${segmentId}`);
  const beforeTargetMs = plan.slice(0, targetIndex).reduce((sum, step) => sum + hopDurationMs(step, DEFAULT_STEP_MS), 0);
  return {
    beforeTargetMs,
    targetDurationMs: hopDurationMs(plan[targetIndex]!, DEFAULT_STEP_MS),
    totalMs: plan.reduce((sum, step) => sum + hopDurationMs(step, DEFAULT_STEP_MS), 0),
  };
}

function serviceFeatureIds(bundle: RailwayBundle, serviceId: string): string[] {
  if (!bundle.data.segments.ok) throw new Error("Product segments are required for the landing highlight");
  return [...new Set(bundle.data.segments.value.filter((segment) => segment.serviceId === serviceId).flatMap((segment) => segment.geometryFeatureIds))];
}

async function focusMapOnYokohama(page: Page, bundle: RailwayBundle): Promise<void> {
  const center = bundle.network.stationsById.get("yokohama")!.coordinates;
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await page.evaluate((coordinates) => {
    const map = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E.map;
    map.jumpTo({ center: coordinates, zoom: 10.5 });
  }, center);
}

async function resumeSavedGame(page: Page, game: GameState): Promise<void> {
  await openTitle(page);
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
}

test.use({ dataset: "capital-region", gameSeed: CAPITAL_GAME_SEED });

async function expectFit(page: Page, bundle: RailwayBundle, targetOnly: boolean): Promise<void> {
  const points = [...bundle.network.servicesById.values()]
    .filter((service) => !targetOnly || service.id === MVP_GAME_CONFIG.targetServiceId)
    .flatMap((service) => Object.values(service.platformCoordinates));
  const projected = await page.evaluate((coordinates) => {
    const map = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E.map;
    return coordinates.map((point) => { const { x, y } = map.project(point); return { x, y }; });
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

test("regional target view and full overview fit outside the panel; line groups expand", async ({ page, railwayBundle }) => {
  await openTitle(page);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await expectFit(page, railwayBundle, true);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await expectFit(page, railwayBundle, false);
  await expect(gamePanel(page).getByRole("button", { name: "追尾: OFF", exact: true })).toBeVisible();
  const legend = gamePanel(page).getByRole("list", { name: "凡例" });
  const singleService = legend.getByRole("listitem").filter({ hasText: /^広域支線$/ });
  await expect(singleService).toHaveCount(1);
  await expect(singleService.locator("details, summary")).toHaveCount(0);
  await expect(legend).not.toContainText("テスト支線");
  await expect(legend).not.toContainText("（1系統）");
  const group = legend.locator("details").filter({ has: page.locator("summary", { hasText: "テスト広域線" }) });
  await expect(group.locator("summary")).toHaveText("テスト広域線（3系統）");
  await expect(group).not.toHaveAttribute("open");
  await group.locator("summary").click();
  await expect(group.getByRole("listitem")).toHaveCount(3);
  await expect(group.getByText("広域海岸系統", { exact: true })).toBeVisible();
  await group.locator("summary").click();
  await expect(group).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "目標路線", exact: true }).click();
  await expectFit(page, railwayBundle, true);
  const viewport = page.viewportSize()!;
  const panel = (await gamePanel(page).boundingBox())!;
  if (viewport.width <= 600) expect(panel.height).toBeLessThanOrEqual(viewport.height * 0.45 + 1);
  await expect(diceButton(page)).toBeInViewport();
});

test.describe("current product scenarios", () => {
  test.use({ dataset: "real", gameSeed: PRODUCT_HUB_GAME_SEED });

  test("hub summary expands every candidate outside aria-live; selection and reload are deterministic", async ({ page, railwayBundle }) => {
    await openTitle(page);
    await startNewGame(page);
    await rollOnce(page);
    const result = gamePanel(page).locator(".game-panel__lottery");
    await expect(result).toHaveText("抽選: 品川：6系統から抽選 → 山手線 ／ 外回りに固定");
    const candidates = gamePanel(page).locator(".game-panel__candidates");
    await expect(candidates).not.toHaveAttribute("aria-live");
    await candidates.locator("summary").click();
    const firstMove = (await readSave(page))!.movementHistory[0]!;
    expect(firstMove).toMatchObject({
      toStationId: "shinagawa",
      landing: { serviceId: "jr-yamanote", direction: 1 },
    });
    const expectedCandidates = railwayBundle.network.servicesByStation.get("shinagawa")!;
    await expect(candidates.getByRole("listitem")).toHaveCount(6);
    for (const id of expectedCandidates) {
      await expect(candidates.getByRole("listitem").filter({ hasText: railwayBundle.network.servicesById.get(id)!.name })).toBeVisible();
    }
    await candidates.locator("summary").click();
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
      .toContain("jr-yamanote:shinagawa~osaki");
    const committed = (await readSave(page))!;
    await page.reload();
    await page.getByRole("button", { name: /^つづきから（1ターン目・/ }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    expect(await readSave(page)).toEqual(committed);
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, committed));
  });

  test.describe("paced composed-hop reveal", () => {
    test.use({ reducedMotion: "no-preference" });

    test("forward composed hop reveals the product geometry and landing highlight", async ({ page, railwayBundle }) => {
      await page.clock.install();
      const forwardBefore = gameBeforeTurn(railwayBundle.network, PRODUCT_COMPOSED_GAME_SEED, PRODUCT_COMPOSED_SCENARIO_TURNS.forward - 1);
      const forwardResult = playTurn(forwardBefore, railwayBundle.network);
      const forwardRecord = forwardResult.state.movementHistory.at(-1)!;
      expect(forwardRecord.traversedSegmentIds).toContain(PRODUCT_COMPOSED_FORWARD);
      const forwardTiming = composedTiming(railwayBundle, forwardResult, PRODUCT_COMPOSED_FORWARD);
      await resumeSavedGame(page, forwardBefore);
      await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
      await focusMapOnYokohama(page, railwayBundle);
      await freezeClock(page);
      await diceButton(page).click();
      await expect.poll(async () => (await readSave(page))?.turn).toBe(PRODUCT_COMPOSED_SCENARIO_TURNS.forward);
      const forwardCommitted = (await readSave(page))!;
      expect(forwardCommitted).toEqual(forwardResult.state);
      await page.clock.runFor(16);
      await page.clock.fastForward(forwardTiming.beforeTargetMs + forwardTiming.targetDurationMs / 2);
      const forwardMidpoint = (await readMap(page))!.marker;
      expect(forwardMidpoint).not.toEqual(markerPosition(railwayBundle, forwardBefore));
      expect(forwardMidpoint).not.toEqual(markerPosition(railwayBundle, forwardCommitted));
      const rapidFeatureIds = serviceFeatureIds(railwayBundle, forwardRecord.serviceId);
      await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(rapidFeatureIds);
      const composedFeatures = railwayBundle.network.segmentsById.get(PRODUCT_COMPOSED_FORWARD)!.geometryFeatureIds;
      await expect.poll(async () => (await readMap(page))?.highlightedRenderedIds)
        .toEqual(expect.arrayContaining([...composedFeatures]));
      await gamePanel(page).getByRole("button", { name: "スキップ", exact: true }).click();
      const forwardLandingService = forwardRecord.landing!.serviceId;
      await expect(panelStat(page, "乗車中")).toHaveText(railwayBundle.network.servicesById.get(forwardLandingService)!.name);
      const forwardLandingFeatures = serviceFeatureIds(railwayBundle, forwardLandingService);
      await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(forwardLandingFeatures);

      expect(await readSave(page)).toEqual(forwardCommitted);
    });

    test("reverse composed hop reveals reversed geometry and landing highlight", async ({ page, railwayBundle }) => {
      await page.clock.install();
      const before = gameBeforeTurn(railwayBundle.network, PRODUCT_COMPOSED_GAME_SEED, PRODUCT_COMPOSED_SCENARIO_TURNS.reverse - 1);
      const result = playTurn(before, railwayBundle.network);
      const record = result.state.movementHistory.at(-1)!;
      expect(record.traversedSegmentIds).toContain(PRODUCT_COMPOSED_REVERSE);
      const timing = composedTiming(railwayBundle, result, PRODUCT_COMPOSED_REVERSE);
      await resumeSavedGame(page, before);
      await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
      await focusMapOnYokohama(page, railwayBundle);
      await freezeClock(page);
      await diceButton(page).click();
      await expect.poll(async () => (await readSave(page))?.turn).toBe(PRODUCT_COMPOSED_SCENARIO_TURNS.reverse);
      const committed = (await readSave(page))!;
      expect(committed).toEqual(result.state);
      await page.clock.runFor(16);
      await page.clock.fastForward(timing.beforeTargetMs + timing.targetDurationMs / 2);
      const midpoint = (await readMap(page))!.marker;
      expect(midpoint).not.toEqual(markerPosition(railwayBundle, before));
      expect(midpoint).not.toEqual(markerPosition(railwayBundle, committed));
      await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
        .toEqual(serviceFeatureIds(railwayBundle, record.serviceId));
      const composedFeatures = railwayBundle.network.segmentsById.get(PRODUCT_COMPOSED_REVERSE)!.geometryFeatureIds;
      await expect.poll(async () => (await readMap(page))?.highlightedRenderedIds)
        .toEqual(expect.arrayContaining([...composedFeatures]));
      await gamePanel(page).getByRole("button", { name: "スキップ", exact: true }).click();
      const landingServiceId = record.landing!.serviceId;
      await expect(panelStat(page, "乗車中")).toHaveText(railwayBundle.network.servicesById.get(landingServiceId)!.name);
      await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
        .toEqual(serviceFeatureIds(railwayBundle, landingServiceId));
      expect(await readSave(page)).toEqual(committed);
    });
  });

  test.describe("natural reverse completion", () => {
    test.use({ reducedMotion: "no-preference" });

    test("switches from the ridden rapid to the landing service", async ({ page, railwayBundle }) => {
      const before = gameBeforeTurn(railwayBundle.network, PRODUCT_COMPOSED_GAME_SEED, PRODUCT_COMPOSED_SCENARIO_TURNS.reverse - 1);
      const result = playTurn(before, railwayBundle.network);
      const record = result.state.movementHistory.at(-1)!;
      expect(record).toMatchObject({
        serviceId: "jr-shonan-shinjuku-rapid-takasaki",
        direction: -1,
        landing: { serviceId: "jr-saikyo", direction: 1 },
      });
      expect(record.traversedSegmentIds).toContain(PRODUCT_COMPOSED_REVERSE);
      const timing = composedTiming(railwayBundle, result, PRODUCT_COMPOSED_REVERSE);
      await page.clock.install();
      await resumeSavedGame(page, before);
      await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
      await focusMapOnYokohama(page, railwayBundle);
      await freezeClock(page);
      await diceButton(page).click();
      const committed = (await readSave(page))!;
      expect(committed).toEqual(result.state);
      await page.clock.runFor(16);
      await page.clock.fastForward(timing.beforeTargetMs + timing.targetDurationMs / 2);
      const midpoint = (await readMap(page))!.marker;
      expect(midpoint).not.toEqual(markerPosition(railwayBundle, before));
      expect(midpoint).not.toEqual(markerPosition(railwayBundle, committed));
      await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
        .toEqual(serviceFeatureIds(railwayBundle, record.serviceId));
      const remaining = Math.max(0, timing.totalMs - 16 - timing.beforeTargetMs - timing.targetDurationMs / 2);
      await page.clock.fastForward(remaining + 50);
      await expect(diceButton(page)).toHaveText("サイコロを振る");
      await expect(panelStat(page, "現在駅")).toHaveText(railwayBundle.network.stationsById.get("osaki")!.name);
      await expect(panelStat(page, "乗車中")).toHaveText(railwayBundle.network.servicesById.get("jr-saikyo")!.name);
      await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
        .toEqual(serviceFeatureIds(railwayBundle, "jr-saikyo"));
      expect(await readSave(page)).toEqual(committed);
    });
  });

  test("clear history pages retain every product record, and reopened results restore the saved history", async ({ page, railwayBundle }) => {
    let game = createGame(MVP_GAME_CONFIG, PRODUCT_HISTORY_GAME_SEED, railwayBundle.network);
    while (game.status === "playing" && game.turn < 100) game = playTurn(game, railwayBundle.network).state;
    expect(game).toMatchObject({ status: "completed", turn: PRODUCT_HISTORY_SCENARIO_TURNS.completed, currentStationId: "shimbashi" });
    await openTitle(page);
    await writeSaveText(page, serializeGame(game));
    await page.reload();
    await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
    const clear = page.getByRole("region", { name: "クリア！" });
    const items = clear.locator(".clear-screen__history li");
    const history = clear.locator(".clear-screen__history");
    await expect(items).toHaveCount(20);
    await expect(items.first()).toContainText("1ターン目");
    await expect(clear.getByRole("button", { name: "前のページ" })).toBeDisabled();
    await history.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(items.first()).not.toBeInViewport();
    await clear.getByRole("button", { name: "次のページ" }).click();
    await expect(items).toHaveCount(20);
    await expect(items.first()).toContainText("21ターン目");
    await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(items.first()).toBeInViewport({ ratio: 1 });
    await clear.getByRole("button", { name: "次のページ" }).click();
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("41ターン目");
    await expect(items.last()).toContainText("42ターン目");
    await expect(clear.getByRole("button", { name: "次のページ" })).toBeDisabled();
    await clear.getByRole("button", { name: "前のページ" }).click();
    await expect(items.first()).toContainText("21ターン目");
    await clear.getByRole("button", { name: "前のページ" }).click();
    await expect(items).toHaveCount(20);
    await expect(items.first()).toContainText("1ターン目");
    expect((await readSave(page))?.movementHistory).toEqual(game.movementHistory);
    await page.reload();
    await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
    await expect(items).toHaveCount(20);
    expect(await readSave(page)).toEqual(game);
  });
});

test.describe("branch", () => {
  test.use({ gameSeed: CAPITAL_BRANCH_SEED });
  test("rides the branch through its hub and reports the service boundary", async ({ page }) => {
    await openTitle(page);
    await startNewGame(page);
    for (let turn = 0; turn < 4; turn += 1) await rollOnce(page);
    await expect(panelStat(page, "乗車中")).toHaveText("広域支線");
    await expect(panelStat(page, "出目")).toContainText("系統の端");
    await rollOnce(page);
    expect((await readSave(page))?.movementHistory.at(-1)?.traversedSegmentIds).toEqual(["capital-branch:capital-branch-end:shinagawa", "capital-branch:shinagawa:capital-west"]);
  });
});
