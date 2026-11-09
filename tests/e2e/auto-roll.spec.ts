import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createItemGame, playItemTurn, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState, ItemTurnRecord } from "../../src/types/network";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import {
  diceButton,
  freezeClock,
  gamePanel,
  openTitle,
  readSave,
  startNewGame,
  writeSaveText,
} from "./support/app";

test.use({ dataset: "fixture", reducedMotion: "reduce" });

const AUTO_ROLL_GAP_MS = 1_200;
const AUTO_ROLL_TURNS_TO_PROVE = 2;
const MAX_SEED_CANDIDATES = 4_096;
const STOPPED_WAIT_MS = 100;
/** Opt-in visual evidence for local review; CI never writes screenshots. */
const SCREENSHOT_DIRECTORY = process.env.E2E_SCREENSHOT_DIR ? resolve(process.cwd(), process.env.E2E_SCREENSHOT_DIR) : null;

function seedText(candidate: number): string {
  return candidate.toString(16).padStart(32, "0");
}

function hasPublishedPickupStop(record: ItemTurnRecord | null): boolean {
  return record?.itemEvents.some((event) =>
    event.type === "pickup-retained" || event.type === "harmful-scheduled" || event.type === "cancelled-by-certificate"
      || event.type === "pickup-pending-discard") ?? false;
}

function plainStart(bundle: RailwayBundle): ItemGameState {
  for (let candidate = 0; candidate < MAX_SEED_CANDIDATES; candidate += 1) {
    let game = createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
    let safe = true;
    for (let turn = 0; turn < AUTO_ROLL_TURNS_TO_PROVE; turn += 1) {
      const result = playItemTurn(game, {}, bundle.network);
      if (hasPublishedPickupStop(result.record) || result.state.pending !== null) {
        safe = false;
        break;
      }
      game = result.state;
    }
    if (safe) return createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
  }
  throw new Error("No fixture seed produced two turns without a pickup decision");
}

function pickupStart(bundle: RailwayBundle): ItemGameState {
  for (let candidate = 0; candidate < MAX_SEED_CANDIDATES; candidate += 1) {
    const game = createItemGame(ITEM_GAME_CONFIG, seedText(candidate), bundle.network);
    const record = playItemTurn(game, {}, bundle.network).record;
    if (record?.itemEvents.some((event) => event.type === "pickup-retained")) return game;
  }
  throw new Error("No fixture seed produced a retained pickup on its first turn");
}

async function openSavedGame(page: import("@playwright/test").Page, game: ItemGameState): Promise<void> {
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
}

function autoRollButton(page: import("@playwright/test").Page) {
  return gamePanel(page).getByRole("button", { name: "おまかせで進む" });
}

test("captures the dice row with auto-roll OFF and ON at desktop, phone, and compact landscape sizes", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "desktop-chromium") return;
  if (SCREENSHOT_DIRECTORY) mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.clock.install();
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);

  const viewports = [
    { width: 1_280, height: 800, label: "desktop-1280x800" },
    { width: 390, height: 844, label: "phone-390x844" },
    { width: 667, height: 375, label: "landscape-667x375" },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const actions = gamePanel(page).locator(".game-panel__actions");
    const toggle = autoRollButton(page);
    const assertOneLine = async () => {
      const labels = await actions.locator("button").evaluateAll((buttons) => buttons.map((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return {
          label: button.textContent?.trim(),
          fits: button.scrollWidth <= button.clientWidth,
          lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
        };
      }));
      expect(labels).toHaveLength(3);
      expect(labels.every(({ fits, lines }) => fits && lines === 1), `${viewport.label}: ${JSON.stringify(labels)}`).toBe(true);
    };

    await expect(toggle).toHaveText("おまかせ: OFF");
    await assertOneLine();
    if (SCREENSHOT_DIRECTORY) await actions.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `${viewport.label}-off.png`) });
    await toggle.click();
    await expect(toggle).toHaveText("おまかせ: ON");
    await assertOneLine();
    if (SCREENSHOT_DIRECTORY) await actions.screenshot({ path: resolve(SCREENSHOT_DIRECTORY, `${viewport.label}-on.png`) });
    await toggle.click();
  }
});

test("automatically rolls twice with a full gap between published ready turns", async ({ page, railwayBundle }) => {
  await openSavedGame(page, plainStart(railwayBundle));
  const toggle = autoRollButton(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readSave(page))?.turn).toBe(1);
  await expect.poll(async () => (await readSave(page))?.turn).toBe(AUTO_ROLL_TURNS_TO_PROVE);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("manual OFF cancels the pending roll and does not interrupt an active turn", async ({ page, railwayBundle }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSavedGame(page, plainStart(railwayBundle));
  await freezeClock(page);
  const toggle = autoRollButton(page);
  await toggle.click();
  await toggle.click();
  await page.clock.runFor(AUTO_ROLL_GAP_MS + STOPPED_WAIT_MS);
  expect((await readSave(page))?.turn).toBe(0);

  await diceButton(page).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(1);
  await expect(page.locator(".turn-moment-host .dice-tumble")).toBeVisible();
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".turn-moment-host .dice-tumble")).toBeVisible();
});

test("turns OFF on a published retained pickup and does not roll again", async ({ page, railwayBundle }) => {
  await openSavedGame(page, pickupStart(railwayBundle));
  const toggle = autoRollButton(page);
  await toggle.click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(AUTO_ROLL_GAP_MS + STOPPED_WAIT_MS);
  expect((await readSave(page))?.turn).toBe(1);
});
