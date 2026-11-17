import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  createItemGame,
  playItemTurn,
  resolveItemDiscard,
  serializeGame,
  targetSegmentIds,
} from "../../src/features/game/engine";
import type { ItemGameState, RailwayNetwork } from "../../src/features/game/engine";
import { itemScenario } from "./fixtures/itemScenarios";
import { FIXTURE_GAME_SEED } from "./fixtures/seeds";
import { expect, test } from "./fixtures";
import { readSave, titleScreen, writeSaveText } from "./support/app";

const DELETE_HIT_TARGET_MIN_HEIGHT_PX = 44;
const COMPLETION_TURN_LIMIT = 100;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const NARROW_VIEWPORT = { width: 320, height: 568 };
const SCREENSHOT_VIEWPORTS = [
  { name: "desktop", ...DESKTOP_VIEWPORT },
  { name: "320x568", ...NARROW_VIEWPORT },
] as const;

test.use({ dataset: "fixture" });

function resumeLabel(game: ItemGameState, network: RailwayNetwork): string {
  const position = game.pending?.kind === "discard" ? game.pending.position : game;
  const requiredIds = new Set(targetSegmentIds(game.config, network));
  const completed = new Set(position.completedSegmentIds.filter((id) => requiredIds.has(id))).size;
  const turn = game.pending?.turn ?? game.turn + 1;
  const station = network.stationsById.get(position.currentStationId)?.name ?? position.currentStationId;
  return `つづきから　踏破 ${completed}/${requiredIds.size}・${turn}ターン目から・${station}`;
}

async function loadSave(page: Page, game: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
}

async function captureTitle(page: Page, name: string): Promise<void> {
  const directory = resolve(process.cwd(), ".claude/logs/screenshots");
  mkdirSync(directory, { recursive: true });
  for (const { name: size, width, height } of SCREENSHOT_VIEWPORTS) {
    await page.setViewportSize({ width, height });
    if (size === "320x568") await page.locator(".title-screen__resume").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(directory, `rgts-1b-${name}-${size}.png`) });
  }
}

function completedSave(network: RailwayNetwork): ItemGameState {
  let game = createItemGame(DEFAULT_GAME_CONFIG, FIXTURE_GAME_SEED, network);
  while (game.status === "playing" && game.turn < COMPLETION_TURN_LIMIT) {
    const result = playItemTurn(game, {}, network);
    game = result.state.pending?.kind === "discard"
      ? resolveItemDiscard(result.state, result.state.pending.item.id).state
      : result.state;
  }
  if (game.status !== "completed") throw new Error("Fixture trajectory did not complete");
  return game;
}

test("resume shows progress and next turn", async ({ page, railwayBundle }) => {
  const game = itemScenario("route", railwayBundle.network);
  await loadSave(page, game);
  const label = resumeLabel(game, railwayBundle.network);
  await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "はじめから", exact: true }).click();
  const overwrite = page.getByRole("alertdialog", { name: "新しく始めますか？" });
  await expect(overwrite).toContainText(`保存中のゲーム（${game.turn + 1}ターン目から再開）は上書きされます。はじめから始めますか？`);
  await overwrite.getByRole("button", { name: "キャンセル", exact: true }).click();
  await captureTitle(page, "normal");
  const completed = completedSave(railwayBundle.network);
  await loadSave(page, completed);
  await expect(page.getByRole("button", { name: `クリア結果を見る（${completed.turn}ターンでクリア）`, exact: true })).toBeVisible();
  await captureTitle(page, "completed");
});

test("delete stays secondary and preserves confirmation", async ({ page, railwayBundle }) => {
  const firstTurn = playItemTurn(itemScenario("discard", railwayBundle.network), {}, railwayBundle.network).state;
  if (firstTurn.pending?.kind !== "discard") throw new Error("Expected a pending discard fixture");
  await loadSave(page, firstTurn);
  const group = page.locator(".title-screen__resume");
  const buttons = group.locator(":scope > button");
  await expect(buttons).toHaveCount(2);
  const resume = buttons.nth(0);
  const remove = buttons.nth(1);
  await expect(resume).toHaveAccessibleName(resumeLabel(firstTurn, railwayBundle.network));
  await expect(remove).toHaveText("セーブを削除");
  const style = await remove.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    background: getComputedStyle(element).backgroundColor,
    decoration: getComputedStyle(element).textDecorationLine,
  }));
  const resumeFontSize = await resume.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(style.height).toBeGreaterThanOrEqual(DELETE_HIT_TARGET_MIN_HEIGHT_PX);
  expect(style.fontSize).toBeLessThan(resumeFontSize);
  expect(style.background).toBe("rgba(0, 0, 0, 0)");
  expect(style.decoration).toBe("underline");
  await captureTitle(page, "pending-discard");
  await remove.click();
  const confirmation = page.getByRole("alertdialog", { name: "セーブデータの削除" });
  await expect(confirmation).toContainText("セーブデータを削除しますか？この操作は取り消せません。");
  await confirmation.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(titleScreen(page).getByRole("status")).toHaveText("セーブデータを削除しました。");
  expect(await readSave(page)).toBeNull();
});

test("resume progress wraps on a narrow title", { tag: "@layout" }, async ({ page, railwayBundle }) => {
  const game = playItemTurn(itemScenario("discard", railwayBundle.network), {}, railwayBundle.network).state;
  if (game.pending?.kind !== "discard") throw new Error("Expected a pending discard fixture");
  await loadSave(page, game);
  await page.setViewportSize(NARROW_VIEWPORT);
  const resume = page.getByRole("button", { name: resumeLabel(game, railwayBundle.network), exact: true });
  const layout = await resume.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    // PhraseText emits several text nodes and <wbr>, so count distinct line tops, not rects.
    const lineTops = new Set(
      [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top)),
    );
    return { lineCount: lineTops.size, overflows: element.scrollWidth > element.clientWidth };
  });
  expect(layout.lineCount).toBeGreaterThan(1);
  expect(layout.overflows).toBe(false);
});
