import type { Page } from "@playwright/test";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState, ItemTurnRecord } from "../../src/types/network";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { autoRollToggle, AUTO_ROLL_GAP_MS, setVisibilityState } from "./support/autoRoll";
import {
  diceButton,
  freezeClock,
  gamePanel,
  openGameMenu,
  openTitle,
  panelStat,
  readSave,
  stampsExpected,
  startNewGame,
  titleScreen,
  writeSaveText,
} from "./support/app";
import {
  advanceArrival,
  advanceLotteryFlip,
  advanceLotterySettle,
  advanceMovement,
  advancePickup,
  advanceStamps,
  advanceTumble,
  awaitStage,
  awaitMovementRelease,
} from "./support/turnMoments";
import { seedGameSettings } from "./support/settings";

test.use({ dataset: "fixture", reducedMotion: "reduce" });

const MAX_SEED_CANDIDATES = 4_096;
const SAFE_LOOKAHEAD_TURNS = 10;
const MAX_GAME_TURNS = 1_000;
const MOVEMENT_COMPLETION_MS = 7_000;
const HIDE_AFTER_MS = 500;
const STOPPED_CALLBACK_GRACE_MS = 100;
const GAP_REMAINDER_MS = 1;
const SETTINGS_STORAGE_KEY = "yamanote-line-sugoroku:settings:v1";

function seedText(candidate: number): string {
  return candidate.toString(16).padStart(32, "0");
}

function hasPickupStop(record: ItemTurnRecord | null | undefined): boolean {
  return record?.itemEvents.some((event) => event.type === "pickup-retained"
    || event.type === "harmful-scheduled" || event.type === "cancelled-by-certificate"
    || event.type === "pickup-pending-discard") ?? false;
}

function plainStart(bundle: RailwayBundle): ItemGameState {
  for (let candidate = 0; candidate < MAX_SEED_CANDIDATES; candidate += 1) {
    let game = createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
    let safe = true;
    for (let turn = 0; turn < SAFE_LOOKAHEAD_TURNS; turn += 1) {
      const result = playItemTurn(game, {}, bundle.network);
      if (hasPickupStop(result.record) || result.state.pending !== null) {
        safe = false;
        break;
      }
      game = result.state;
    }
    if (safe) return createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
  }
  throw new Error("No fixture seed produced ten turns without a pickup decision");
}

function firstRetainedPickupStart(bundle: RailwayBundle): ItemGameState {
  for (let candidate = 0; candidate < MAX_SEED_CANDIDATES; candidate += 1) {
    const game = createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
    const record = playItemTurn(game, {}, bundle.network).record;
    if (record?.itemEvents.some((event) => event.type === "pickup-retained")) return game;
  }
  throw new Error("No fixture seed produced a retained first-turn pickup");
}

function preCompletionGame(bundle: RailwayBundle): ItemGameState {
  for (let candidate = 0; candidate < MAX_SEED_CANDIDATES; candidate += 1) {
    let game = createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
    for (let turn = 0; turn < MAX_GAME_TURNS && game.status === "playing"; turn += 1) {
      const previous = game;
      let result = playItemTurn(game, {}, bundle.network);
      if (result.state.pending?.kind === "discard") {
        result = resolveItemDiscard(result.state, result.state.pending.item.id);
      }
      if (result.state.status === "completed") {
        if (!previous.inventory.some((item) => item.kind === "roll-adjust")) return previous;
        break;
      }
      game = result.state;
    }
  }
  throw new Error("No fixture trajectory reached completion without a final-turn adjustment decision");
}

async function resumeSavedGame(page: Page, game: ItemGameState): Promise<void> {
  await page.clock.install();
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /^つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await freezeClock(page);
}

async function hasAcceptedRoll(page: Page): Promise<boolean> {
  const save = await readSave(page);
  return save !== null && (save.turn === 1 || save.pending !== null);
}

test("[handler coverage] hidden turns auto-roll OFF, cancels the gap, and visible does not resume", async ({ page }) => {
  await page.clock.install();
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await page.clock.runFor(HIDE_AFTER_MS);

  // A page-side visibility override exercises the listener; it does not emulate browser tab lifecycle.
  await setVisibilityState(page, "hidden");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(AUTO_ROLL_GAP_MS + STOPPED_CALLBACK_GRACE_MS);
  expect(await readSave(page)).toMatchObject({ turn: 0, pending: null });

  await setVisibilityState(page, "visible");
  await page.clock.runFor(AUTO_ROLL_GAP_MS + STOPPED_CALLBACK_GRACE_MS);
  expect(await readSave(page)).toMatchObject({ turn: 0, pending: null });
});

test("new game, title-to-resume, and reload-to-resume each start auto-roll OFF", async ({ page }) => {
  await page.clock.install();
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  await diceButton(page).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(1);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "新規", exact: true }).click();
  await page.getByRole("alertdialog", { name: "新しく始めますか？" })
    .getByRole("button", { name: "新しく始める" }).click();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(AUTO_ROLL_GAP_MS + STOPPED_CALLBACK_GRACE_MS);
  expect((await readSave(page))?.turn).toBe(0);

  await toggle.click();
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "タイトル", exact: true }).click();
  await titleScreen(page).getByRole("button", { name: /^つづきから/ }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(AUTO_ROLL_GAP_MS + STOPPED_CALLBACK_GRACE_MS);
  expect((await readSave(page))?.turn).toBe(0);

  await toggle.click();
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  await titleScreen(page).getByRole("button", { name: /^つづきから/ }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(AUTO_ROLL_GAP_MS + STOPPED_CALLBACK_GRACE_MS);
  expect((await readSave(page))?.turn).toBe(0);
});

test("the current single-edition start has no picker and begins with auto-roll OFF", async ({ page }) => {
  await openTitle(page);
  await expect(titleScreen(page).getByRole("combobox", { name: "遊ぶ版" })).toHaveCount(0);
  await startNewGame(page);
  await expect(autoRollToggle(page)).toHaveAttribute("aria-pressed", "false");
});

test("the clear screen leaves no auto-roll callback after the final turn", async ({ page, railwayBundle }) => {
  const preFinal = preCompletionGame(railwayBundle);
  const turnBefore = preFinal.turn;
  await resumeSavedGame(page, preFinal);
  await autoRollToggle(page).click();
  await page.clock.runFor(AUTO_ROLL_GAP_MS);

  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
  const completed = await readSave(page);
  if (!completed) throw new Error("Expected the completed game save");
  await page.clock.runFor(AUTO_ROLL_GAP_MS + 100);
  expect(await readSave(page)).toEqual(completed);
});

test("OS reduced motion does not shorten the full ready gap", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  await autoRollToggle(page).click();
  await page.clock.runFor(AUTO_ROLL_GAP_MS - GAP_REMAINDER_MS);
  expect(await readSave(page)).toMatchObject({ turn: 0, pending: null });
  await page.clock.runFor(GAP_REMAINDER_MS);
  await expect.poll(() => hasAcceptedRoll(page)).toBe(true);
});

test("演出なし does not shorten the full ready gap", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  await openGameMenu(page);
  const presentation = gamePanel(page).getByRole("button", { name: /^演出:/ });
  await presentation.click();
  await presentation.click();
  await expect(presentation).toHaveText("演出: なし");
  await gamePanel(page).getByRole("button", { name: "メニュー", exact: true }).click();
  await autoRollToggle(page).click();

  await page.clock.runFor(AUTO_ROLL_GAP_MS - GAP_REMAINDER_MS);
  expect(await readSave(page)).toMatchObject({ turn: 0, pending: null });
  await page.clock.runFor(GAP_REMAINDER_MS);
  await expect.poll(() => hasAcceptedRoll(page)).toBe(true);
});

test("reduced-motion no-preference stays ON through movement, reveal, and pickup until publication", async ({ page, railwayBundle }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await resumeSavedGame(page, firstRetainedPickupStart(railwayBundle));
  const toggle = autoRollToggle(page);
  await toggle.click();
  await page.clock.runFor(AUTO_ROLL_GAP_MS);
  await expect(page.locator(".turn-moment-host .dice-tumble")).toHaveAttribute("data-stage", "tumble");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await advanceTumble(page);
  const save = await readSave(page);
  const record = save?.movementHistory.at(-1);
  if (!record) throw new Error("Expected the first turn record");
  if (record.kind !== "item-ride" || record.itemEvents.every((event) => event.type !== "pickup-retained")) {
    throw new Error("Expected the retained-pickup fixture record");
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  if (stampsExpected(record)) await advanceStamps(page);
  await awaitMovementRelease(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await advanceMovement(page, MOVEMENT_COMPLETION_MS);
  await expect(page.locator(".turn-moment-host .arrival-banner")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await advanceArrival(page);

  const lottery = page.locator(".lottery-reveal");
  const pickupStage = page.locator('.turn-moment-host [data-stage="pickup"]');
  await expect.poll(async () => await lottery.isVisible() || await pickupStage.isVisible()).toBe(true);
  if (await lottery.isVisible()) {
    await advanceLotteryFlip(page);
    await advanceLotterySettle(page);
  }
  await awaitStage(page, "pickup");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await advancePickup(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("a save failure alone does not pause or stop auto-roll", async ({ page, railwayBundle }) => {
  const safeGame = plainStart(railwayBundle);
  await resumeSavedGame(page, safeGame);
  await page.evaluate(() => {
    const storage = Storage.prototype as Storage & { originalSetItem?: Storage["setItem"] };
    storage.originalSetItem = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save")) throw new Error("quota");
      storage.originalSetItem?.call(this, key, value);
    };
  });
  const toggle = autoRollToggle(page);
  await toggle.click();
  await page.clock.runFor(AUTO_ROLL_GAP_MS);
  await expect(panelStat(page, "ターン数")).toHaveText("1");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".game-panel__save")).toContainText("失敗");
  expect((await readSave(page))?.turn).toBe(0);

  await page.clock.runFor(AUTO_ROLL_GAP_MS);
  await expect(panelStat(page, "ターン数")).toHaveText("2");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("toggling auto-roll never writes the settings key", async ({ page }) => {
  await page.clock.install();
  await seedGameSettings(page, { speedId: "normal", follow: true, presentationLevel: "all" });
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  const settingsBefore = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_STORAGE_KEY);
  await page.evaluate((key) => {
    const typedWindow = window as Window & { __settingsWrites?: string[] };
    typedWindow.__settingsWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey: string, value: string): void {
      if (storageKey === key) typedWindow.__settingsWrites?.push(storageKey);
      original.call(this, storageKey, value);
    };
  }, SETTINGS_STORAGE_KEY);
  await autoRollToggle(page).click();
  await autoRollToggle(page).click();

  expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_STORAGE_KEY)).toBe(settingsBefore);
  expect(await page.evaluate(() => (window as Window & { __settingsWrites?: string[] }).__settingsWrites)).toEqual([]);
});
