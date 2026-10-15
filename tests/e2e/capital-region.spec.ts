import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { CAPITAL_BRANCH_SEED, CAPITAL_GAME_SEED, CAPITAL_SCENARIO_TURNS } from "./fixtures/capital-region/seeds";
import { createGame, playTurn, serializeGame } from "../../src/features/game/engine";
import { MVP_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { RailwayBundle } from "./fixtures/bundle";
import { diceButton, freezeClock, gamePanel, markerPosition, openTitle, panelStat, readMap, readSave, rollOnce, startNewGame, writeSaveText } from "./support/app";

const RAPID_FEATURES = ["capital-owner-a:shinagawa~capital-joint", "capital-owner-b:capital-joint~capital-south"];

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

test("hub summary expands every candidate outside aria-live; reduced motion, reverse hop and reload are deterministic", async ({ page, railwayBundle }) => {
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  const result = gamePanel(page).locator(".game-panel__lottery");
  await expect(result).toContainText("品川：7系統から抽選 → 広域直通快速");
  const candidates = gamePanel(page).locator(".game-panel__candidates");
  await expect(candidates).not.toHaveAttribute("aria-live");
  await candidates.locator("summary").click();
  const names = (await readSave(page))!.movementHistory[0]!.landing;
  expect(names?.serviceId).toBe("capital-rapid");
  const expectedCandidates = railwayBundle.network.servicesByStation.get("shinagawa")!;
  await expect(candidates.getByRole("listitem")).toHaveCount(expectedCandidates.length);
  for (const id of expectedCandidates) await expect(candidates.getByRole("listitem").filter({ hasText: railwayBundle.network.servicesById.get(id)!.name })).toBeVisible();
  await candidates.locator("summary").click();
  await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(RAPID_FEATURES);
  await expect.poll(async () => (await readMap(page))?.highlightedColor).toBe("#EE2222");
  await rollOnce(page);
  expect((await readSave(page))!.movementHistory.at(-1)!.traversedSegmentIds).toEqual(["capital-rapid:shinagawa:capital-south"]);
  await expect(panelStat(page, "現在駅")).toHaveText("南端駅");
  await expect(panelStat(page, "進行方向")).toHaveText("北・西方面");
  await rollOnce(page);
  const committed = (await readSave(page))!;
  expect(committed.movementHistory.at(-1)!.traversedSegmentIds).toEqual(["capital-rapid:capital-south:shinagawa"]);
  await expect(panelStat(page, "乗車中")).toHaveText("幹線A 各駅停車");
  await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual([RAPID_FEATURES[0]]);
  await page.reload();
  await page.getByRole("button", { name: /^つづきから（3ターン目・/ }).click();
  expect(await readSave(page)).toEqual(committed);
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, committed));
  await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual([RAPID_FEATURES[0]]);
});

test.describe("paced composed-hop reveal", () => {
  test.use({ reducedMotion: "no-preference" });
  test("forward and reverse animate each as one step; landing highlight follows finish or skip", async ({ page, railwayBundle }) => {
    await page.clock.install();
    await openTitle(page);
    await startNewGame(page);
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await page.getByRole("button", { name: "全体", exact: true }).click();
    await freezeClock(page);
    await diceButton(page).click();
    await expect(panelStat(page, "乗車中")).toHaveText("山手線");
    await expect(gamePanel(page).locator(".game-panel__lottery")).toHaveText("抽選: 移動中…");
    await gamePanel(page).getByRole("button", { name: "スキップ", exact: true }).click();
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(RAPID_FEATURES);
    await expect.poll(async () => (await readMap(page))?.highlightedColor).toBe("#EE2222");
    // Both owners' primitives must be drawn, not merely present in the filter.
    await page.clock.runFor(16);
    await expect.poll(async () => (await readMap(page))?.highlightedRenderedIds).toEqual(expect.arrayContaining(RAPID_FEATURES));
    await diceButton(page).click();
    const forward = (await readSave(page))!;
    expect(forward.movementHistory.at(-1)?.traversedSegmentIds).toHaveLength(1);
    // Start the runner's elapsed-time origin, then sample rather than replay
    // ~40 software-rendered WebGL frames per 650 ms (especially costly at
    // the Pixel 7's deviceScaleFactor). Keep the same midpoint/end assertions.
    await page.clock.runFor(16);
    await page.clock.fastForward(634);
    await expect(panelStat(page, "現在駅")).toHaveText("品川");
    await expect(panelStat(page, "踏破区間")).toHaveText("4/30");
    const midway = (await readMap(page))!.marker;
    expect(midway).not.toEqual(railwayBundle.network.servicesById.get("capital-rapid")!.platformCoordinates.shinagawa);
    expect(midway).not.toEqual(markerPosition(railwayBundle, forward));
    await page.clock.fastForward(650);
    await expect(panelStat(page, "現在駅")).toHaveText("南端駅");
    await expect(panelStat(page, "進行方向")).toHaveText("北・西方面");
    await diceButton(page).click();
    const reverse = (await readSave(page))!;
    expect(reverse.currentServiceId).toBe("capital-owner-a");
    await page.clock.runFor(16);
    await page.clock.fastForward(634);
    await expect(panelStat(page, "現在駅")).toHaveText("南端駅");
    await expect(panelStat(page, "乗車中")).toHaveText("広域直通快速");
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(RAPID_FEATURES);
    await expect(gamePanel(page).locator(".game-panel__lottery")).toHaveText("抽選: 移動中…");
    await gamePanel(page).getByRole("button", { name: "スキップ", exact: true }).click();
    await expect(panelStat(page, "乗車中")).toHaveText("幹線A 各駅停車");
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual([RAPID_FEATURES[0]]);
    expect(await readSave(page)).toEqual(reverse);
  });

  test("natural reverse completion switches from the ridden rapid to the landing service", async ({ page, railwayBundle }) => {
    // The real-engine proof pins this seed's turns 1-3 and the 1,200 ms reverse hop.
    let game = createGame(MVP_GAME_CONFIG, CAPITAL_GAME_SEED, railwayBundle.network);
    for (let turn = 0; turn < CAPITAL_SCENARIO_TURNS.rapidForward; turn += 1) game = playTurn(game, railwayBundle.network).state;
    await page.clock.install();
    await openTitle(page);
    await writeSaveText(page, serializeGame(game));
    await page.reload();
    await page.getByRole("button", { name: /^つづきから（2ターン目・/ }).click();
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await page.getByRole("button", { name: "全体", exact: true }).click();
    await freezeClock(page);
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(RAPID_FEATURES);
    await diceButton(page).click();
    const committed = (await readSave(page))!;
    expect(committed).toEqual(playTurn(game, railwayBundle.network).state);
    expect(committed).toMatchObject({ turn: CAPITAL_SCENARIO_TURNS.rapidReverse, currentStationId: "shinagawa", currentServiceId: "capital-owner-a" });
    await page.clock.runFor(16);
    await page.clock.fastForward(634);
    await expect(panelStat(page, "現在駅")).toHaveText("南端駅");
    await expect(panelStat(page, "乗車中")).toHaveText("広域直通快速");
    await expect(gamePanel(page).locator(".game-panel__lottery")).toHaveText("抽選: 移動中…");
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual(RAPID_FEATURES);
    await expect.poll(async () => (await readMap(page))?.highlightedColor).toBe("#EE2222");
    await expect.poll(async () => (await readMap(page))?.highlightedRenderedIds).toEqual(expect.arrayContaining(RAPID_FEATURES));
    await page.clock.fastForward(650);
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(panelStat(page, "現在駅")).toHaveText("品川");
    await expect(panelStat(page, "乗車中")).toHaveText("幹線A 各駅停車");
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds).toEqual([RAPID_FEATURES[0]]);
    await expect.poll(async () => (await readMap(page))?.highlightedColor).toBe("#0055AA");
    expect(await readSave(page)).toEqual(committed);
  });
});

test("clear history pages without losing records, and reopened results retain full saved history", async ({ page, railwayBundle }) => {
  let game = createGame(MVP_GAME_CONFIG, CAPITAL_GAME_SEED, railwayBundle.network);
  while (game.status === "playing" && game.turn < 100) game = playTurn(game, railwayBundle.network).state;
  expect(game).toMatchObject({ status: "completed", turn: CAPITAL_SCENARIO_TURNS.completed });
  await openTitle(page);
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
  const clear = page.getByRole("region", { name: "クリア！" });
  const items = clear.locator(".clear-screen__history li");
  await expect(items).toHaveCount(Math.min(20, game.turn));
  await expect(items.first()).toContainText("1ターン目");
  await expect(clear.getByRole("button", { name: "前のページ" })).toBeDisabled();
  const history = clear.locator(".clear-screen__history");
  await history.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(items.first()).not.toBeInViewport();
  await clear.getByRole("button", { name: "次のページ" }).click();
  await expect(items).toHaveCount(game.turn - 20);
  await expect(items.first()).toContainText("21ターン目");
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(items.first()).toBeInViewport({ ratio: 1 });
  await expect(items.last()).toContainText(`${game.turn}ターン目`);
  await expect(clear.getByRole("button", { name: "次のページ" })).toBeDisabled();
  await clear.getByRole("button", { name: "前のページ" }).click();
  await expect(items).toHaveCount(Math.min(20, game.turn));
  expect((await readSave(page))?.movementHistory).toEqual(game.movementHistory);
  await page.reload();
  await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
  await expect(items).toHaveCount(Math.min(20, game.turn));
  expect(await readSave(page)).toEqual(game);
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
