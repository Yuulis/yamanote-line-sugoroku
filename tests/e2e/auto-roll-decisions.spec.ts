import { serializeGame } from "../../src/features/game/engine";
import type { ItemGameState } from "../../src/types/network";
import { expect, test } from "./fixtures";
import { itemScenario } from "./fixtures/itemScenarios";
import type { RailwayBundle } from "./fixtures/bundle";
import { autoRollToggle, AUTO_ROLL_GAP_MS } from "./support/autoRoll";
import {
  closeGameLog,
  closeGameMenu,
  diceButton,
  freezeClock,
  gamePanel,
  inventoryItem,
  openGameLog,
  openGameMenu,
  readSave,
  useInventoryItem,
  writeSaveText,
} from "./support/app";

test.use({ dataset: "fixture", reducedMotion: "reduce" });

const PENDING_CHECK_GAPS = 3;

async function resumeFrozen(page: import("@playwright/test").Page, game: ItemGameState): Promise<void> {
  await page.clock.install();
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await freezeClock(page);
}

async function expectFreshGap(page: import("@playwright/test").Page, turn: number): Promise<void> {
  await page.clock.runFor(AUTO_ROLL_GAP_MS - 1);
  const beforeGapEnd = await readSave(page);
  expect(beforeGapEnd?.turn).toBe(turn);
  expect(beforeGapEnd?.pending).toBeNull();
  await page.clock.runFor(1);
  await expect.poll(async () => {
    const save = await readSave(page);
    return save?.turn === turn + 1 || save?.pending !== null;
  }).toBe(true);
}

async function prepareDiscard(page: import("@playwright/test").Page, railwayBundle: RailwayBundle): Promise<void> {
  await resumeFrozen(page, itemScenario("discard", railwayBundle.network));
  await autoRollToggle(page).click();
  await diceButton(page).click();
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  if (await adjustment.isVisible()) await adjustment.getByRole("button", { name: "そのまま続ける" }).click();
  await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
}

test("a pending discard stays ON and unanswered while the dialog is open", async ({ page, railwayBundle }) => {
  await prepareDiscard(page, railwayBundle);
  const turnBefore = (await readSave(page))?.turn;
  if (turnBefore === undefined) throw new Error("Expected the discard fixture save");

  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);

  await expect(autoRollToggle(page)).toBeEnabled();
  await expect(autoRollToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
  expect(await readSave(page)).toMatchObject({ turn: turnBefore, pending: { kind: "discard" } });
});

test("discarding an old item turns auto-roll OFF after the resolved publication", async ({ page, railwayBundle }) => {
  await prepareDiscard(page, railwayBundle);
  const turnBefore = (await readSave(page))?.turn;
  if (turnBefore === undefined) throw new Error("Expected the discard fixture save");

  await page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })
    .getByRole("button", { name: "このアイテムを捨てる" }).first().click();

  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  await expect(autoRollToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeHidden();
});

test("discarding the new item resumes auto-roll after a fresh gap", async ({ page, railwayBundle }) => {
  await prepareDiscard(page, railwayBundle);
  const turnBefore = (await readSave(page))?.turn;
  if (turnBefore === undefined) throw new Error("Expected the discard fixture save");

  await page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })
    .getByRole("button", { name: "このアイテムを捨てる" }).last().click();

  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  await expect(autoRollToggle(page)).toBeEnabled();
  await expect(autoRollToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expectFreshGap(page, turnBefore + 1);
});

test("auto-roll waits for adjustment and stops only when its harmful pickup is published", async ({ page, railwayBundle }) => {
  await resumeFrozen(page, itemScenario("adjust", railwayBundle.network));
  const toggle = autoRollToggle(page);
  await toggle.click();
  const turnBefore = (await readSave(page))?.turn;
  if (turnBefore === undefined) throw new Error("Expected the adjustment fixture save");
  await page.clock.runFor(AUTO_ROLL_GAP_MS);
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect(adjustment).toBeVisible();

  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(adjustment).toBeVisible();
  expect(await readSave(page)).toMatchObject({ turn: turnBefore, pending: { kind: "roll" } });

  await adjustment.getByRole("button", { name: "そのまま続ける" }).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const published = await readSave(page);
  expect(published?.movementHistory.at(-1)?.itemEvents.some((event) =>
    event.type === "harmful-scheduled" && event.item === "oversleep")).toBe(true);
});

test("the certificate fixture stops at its published cancellation", async ({ page, railwayBundle }) => {
  await resumeFrozen(page, itemScenario("certificate", railwayBundle.network));
  const toggle = autoRollToggle(page);
  const turnBefore = (await readSave(page))?.turn;
  if (turnBefore === undefined) throw new Error("Expected the certificate fixture save");
  await toggle.click();

  await page.clock.runFor(AUTO_ROLL_GAP_MS);

  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect(adjustment).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: turnBefore, pending: { kind: "roll" } });
  await adjustment.getByRole("button", { name: "そのまま続ける" }).click();

  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect((await readSave(page))?.movementHistory.at(-1)?.itemEvents.some((event) => event.type === "cancelled-by-certificate")).toBe(true);
});

test("the menu pauses auto-roll and closing it restarts the full gap", async ({ page, railwayBundle }) => {
  const base = itemScenario("double", railwayBundle.network);
  await resumeFrozen(page, base);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await openGameMenu(page);
  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: base.turn, pending: null });
  await closeGameMenu(page);
  await expectFreshGap(page, base.turn);
});

test("the log pauses auto-roll and closing it restarts the full gap", async ({ page, railwayBundle }) => {
  const base = itemScenario("double", railwayBundle.network);
  await resumeFrozen(page, base);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await openGameLog(page);
  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: base.turn, pending: null });
  await closeGameLog(page);
  await expectFreshGap(page, base.turn);
});

test("an item card pauses auto-roll and closing it restarts the full gap", async ({ page, railwayBundle }) => {
  const base = itemScenario("double", railwayBundle.network);
  await resumeFrozen(page, base);
  const toggle = autoRollToggle(page);
  await toggle.click();
  const itemButton = inventoryItem(page, "倍速券").getByRole("button");
  await itemButton.click();
  await expect(itemButton).toHaveAttribute("aria-expanded", "true");
  const card = gamePanel(page).getByRole("dialog", { name: "倍速券" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "使う" })).toBeVisible();
  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: base.turn, pending: null });
  await card.getByRole("button", { name: "閉じる" }).click();
  await expect(itemButton).toHaveAttribute("aria-expanded", "false");
  await expectFreshGap(page, base.turn);
});

test("the item-use dialog pauses auto-roll and closing it restarts the full gap", async ({ page, railwayBundle }) => {
  const base = itemScenario("route", railwayBundle.network);
  await resumeFrozen(page, base);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await useInventoryItem(page, "路線指定券");
  const dialog = page.getByRole("dialog", { name: "乗る路線を選ぶ" });
  await expect(dialog).toBeVisible();
  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: base.turn, pending: null });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expectFreshGap(page, base.turn);
});

test("the 新規 confirmation pauses auto-roll and closing both surfaces restarts the full gap", async ({ page, railwayBundle }) => {
  const base = itemScenario("double", railwayBundle.network);
  await resumeFrozen(page, base);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await openGameMenu(page);
  await gamePanel(page).getByRole("button", { name: "新規", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
  await expect(confirmation).toBeVisible();
  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: base.turn, pending: null });
  await confirmation.getByRole("button", { name: "キャンセル" }).click();
  await expect(confirmation).toBeHidden();
  await closeGameMenu(page);
  await expectFreshGap(page, base.turn);
});

test("a staged item pauses auto-roll but a manual dice click still uses it", async ({ page, railwayBundle }) => {
  const base = itemScenario("double", railwayBundle.network);
  await resumeFrozen(page, base);
  const toggle = autoRollToggle(page);
  await toggle.click();
  await useInventoryItem(page, "倍速券");
  await expect(gamePanel(page).locator(".item-staged-summary")).toContainText("倍速券");
  await page.clock.runFor(AUTO_ROLL_GAP_MS * PENDING_CHECK_GAPS);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readSave(page)).toMatchObject({ turn: base.turn, pending: null });

  await diceButton(page).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(base.turn + 1);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const record = (await readSave(page))?.movementHistory.at(-1);
  expect(record?.command.items).toContainEqual(expect.objectContaining({ kind: "double" }));
});

for (const key of ["Space", "Enter"] as const) {
  test(`${key} from a non-interactive focus makes one manual roll while auto-roll is ON`, async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    await page.getByRole("button", { name: "はじめから" }).click();
    await expect(gamePanel(page)).toBeVisible();
    await freezeClock(page);
    const toggle = autoRollToggle(page);
    await toggle.click();
    await page.clock.runFor(AUTO_ROLL_GAP_MS - 1);
    const heading = gamePanel(page).getByRole("heading").first();
    await heading.focus();
    await page.keyboard.press(key);
    await expect.poll(async () => {
      const save = await readSave(page);
      return save?.turn === 1 || save?.pending !== null;
    }).toBe(true);
    await page.clock.runFor(1);
    expect((await readSave(page))?.turn).toBe(1);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
}

test("Space and Enter on the focused toggle toggle it without manually rolling", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "はじめから" }).click();
  await expect(gamePanel(page)).toBeVisible();
  await freezeClock(page);
  const toggle = autoRollToggle(page);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(1);
  expect(await readSave(page)).toMatchObject({ turn: 0, pending: null });
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.clock.runFor(AUTO_ROLL_GAP_MS);
  expect(await readSave(page)).toMatchObject({ turn: 0, pending: null });
});
