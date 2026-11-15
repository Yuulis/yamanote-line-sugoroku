import type { Page } from "@playwright/test";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState } from "../../src/types/network";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { longestRideState } from "./support/textWrappingState";
import { closeGameLog, diceButton, gamePanel, hudCompactRoll, openGameLog, openTitle, panelStat, rollOnce, startNewGame, writeSaveText } from "./support/app";

// Real data: its long line names are what overflow the phone value columns.
test.use({ dataset: "real", reducedMotion: "reduce" });

interface DicePosition {
  state: string;
  offset: number;
  viewportY: number;
}

async function measureDice(page: Page, state: string): Promise<DicePosition> {
  await expect(diceButton(page)).toHaveText("サイコロを振る");
  return page.evaluate((label) => {
    const panel = document.querySelector<HTMLElement>(".game-panel");
    const button = document.querySelector<HTMLElement>(".game-panel__roll");
    if (!panel || !button) throw new Error("HUD panel or dice button is missing");
    if (panel.scrollTop !== 0) throw new Error(`HUD panel scrolled before measuring: ${panel.scrollTop}`);
    const panelY = panel.getBoundingClientRect().y;
    const buttonY = button.getBoundingClientRect().y;
    return { state: label, offset: buttonY - panelY, viewportY: buttonY };
  }, state);
}

async function restore(page: Page, game: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

function gameWithActiveSuspension(bundle: RailwayBundle): ItemGameState {
  for (let seedValue: number = 0; seedValue < 128; seedValue += 1) {
    const seed: string = seedValue.toString(16).padStart(32, "0");
    let game: ItemGameState = createItemGame(ITEM_GAME_CONFIG, seed, bundle.network);
    for (let turnIndex: number = 0; turnIndex < 40 && game.status === "playing"; turnIndex += 1) {
      const result = playItemTurn(game, {}, bundle.network).state;
      game = result.pending?.kind === "discard"
        ? resolveItemDiscard(result, result.pending.item.id).state
        : result;
      const activeEffects: number = game.effects.delayDueTurns.filter((dueTurn) => dueTurn > game.turn).length
        + game.effects.suspensions.filter((entry) => entry.expiresTurn > game.turn).length;
      const activeSuspension: boolean = game.effects.suspensions.some((entry) => entry.expiresTurn > game.turn);
      if (activeSuspension && activeEffects >= 2) return game;
    }
  }
  throw new Error("No deterministic fixture seed produced two active effects including a suspension");
}

test("keeps the dice button at one HUD position across variable content and save states", { tag: "@layout" }, async ({ page, railwayBundle }, testInfo) => {
  await openTitle(page);
  await startNewGame(page);
  const positions: DicePosition[] = [await measureDice(page, "turn 0")];

  await rollOnce(page);
  positions.push(await measureDice(page, "after roll"));
  const afterRollText: string = await hudCompactRoll(page).innerText();
  expect(afterRollText.length).toBeGreaterThan(2);
  expect(await hudCompactRoll(page).getAttribute("title")).toBe(afterRollText);
  if (testInfo.project.name === "phone-chromium") {
    await expect.poll(() => hudCompactRoll(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await openGameLog(page);
    const fullRoll = panelStat(page, "出目");
    await expect(fullRoll).toBeVisible();
    await expect(fullRoll).toContainText("駅移動");
    await expect.poll(() => fullRoll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await closeGameLog(page);
    await expect.poll(() => gamePanel(page).evaluate((element) => element.scrollTop)).toBe(0);
  }

  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    storage.originalSetItem = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save")) throw new Error("quota");
      storage.originalSetItem?.call(this, key, value);
    };
  });
  await diceButton(page).click();
  await expect(page.locator(".game-panel__save")).toContainText("失敗");
  await expect(diceButton(page)).toHaveText("サイコロを振る");
  positions.push(await measureDice(page, "failed save"));
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    if (storage.originalSetItem) storage.setItem = storage.originalSetItem;
    delete storage.originalSetItem;
  });
  await diceButton(page).click();
  await expect(page.locator(".game-panel__save")).toContainText("自動保存済み");
  await expect(diceButton(page)).toHaveText("サイコロを振る");
  // The saved mark sits inline in the header corner and never covers a stat value.
  const overlaps: string[] = await page.evaluate(() => {
    const mark = document.querySelector<HTMLElement>(".game-panel__header .game-panel__save");
    if (!mark) return ["missing saved mark"];
    const box = mark.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".hud-stat__value")].flatMap((value) => {
      const other = value.getBoundingClientRect();
      const intersects = box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
      return intersects ? [value.dataset.stat ?? "?"] : [];
    });
  });
  expect(overlaps).toEqual([]);
  positions.push(await measureDice(page, "saved"));

  const effectSave: ItemGameState = gameWithActiveSuspension(railwayBundle);
  await restore(page, effectSave);
  await expect(gamePanel(page).locator(".effect-chip").filter({ hasText: "運休" }).first()).toBeVisible();
  expect(await gamePanel(page).locator(".effect-chip").count()).toBeGreaterThanOrEqual(2);
  positions.push(await measureDice(page, "two active effect chips with suspension"));

  const longRide: ItemGameState = longestRideState(railwayBundle).game;
  await restore(page, longRide);
  const ride = panelStat(page, "乗車中");
  if (testInfo.project.name === "phone-chromium") {
    // S23 (user decision 2026-10-30): the phone ride row spans the HUD width. Full text stays in the DOM and title;
    // phone paint may ellipsize after two lines (S10b asserted old narrow-column overflow).
    await expect.poll(() => ride.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // The display name can differ from the raw service name; any truncation is CSS-only, so the span keeps the
    // whole name as text and title.
    const shownName: string = (await ride.textContent()) ?? "";
    expect(shownName.length).toBeGreaterThan(0);
    await expect(ride).toHaveAttribute("title", shownName);
  }
  positions.push(await measureDice(page, "long ride name"));

  const offsets: number[] = positions.map((position) => position.offset);
  const viewportYs: number[] = positions.map((position) => position.viewportY);
  expect(offsets.every((value) => Math.abs(value - offsets[0]!) <= 1), JSON.stringify(positions)).toBe(true);
  expect(viewportYs.every((value) => Math.abs(value - viewportYs[0]!) <= 1), JSON.stringify(positions)).toBe(true);
  testInfo.annotations.push({ type: "dice-positions", description: JSON.stringify(positions) });
});

test("fits all three action labels on one line from phone to compact landscape", { tag: "@layout" }, async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  const actions = gamePanel(page).locator(".game-panel__actions");
  const toggle = gamePanel(page).getByRole("button", { name: "おまかせで進む" });
  const dice = diceButton(page);
  const viewports = [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 640, height: 400 },
    { width: 667, height: 375 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(toggle).toHaveText("おまかせ: OFF");
    const before = await dice.boundingBox();
    const measureLabels = async () => actions.locator("button").evaluateAll((buttons) => buttons.map((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return {
        text: button.textContent?.trim(),
        widthFits: button.scrollWidth <= button.clientWidth,
        lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
      };
    }));
    const off = await measureLabels();
    expect(off.map(({ text }) => text)).toEqual(["サイコロを振る", "スキップ", "おまかせ: OFF"]);
    expect(off.every(({ widthFits, lines }) => widthFits && lines === 1), `${viewport.width}x${viewport.height}: ${JSON.stringify(off)}`).toBe(true);

    await toggle.click();
    await expect(toggle).toHaveText("おまかせ: ON");
    const on = await measureLabels();
    expect(on.map(({ text }) => text)).toEqual(["サイコロを振る", "スキップ", "おまかせ: ON"]);
    expect(on.every(({ widthFits, lines }) => widthFits && lines === 1), `${viewport.width}x${viewport.height}: ${JSON.stringify(on)}`).toBe(true);
    const after = await dice.boundingBox();
    if (!before || !after) throw new Error("The dice button has no layout box");
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await toggle.click();
  }
});
