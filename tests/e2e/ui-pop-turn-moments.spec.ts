import type { Locator, Page } from "@playwright/test";
import { beginItemTurn, playItemTurn, serializeGame } from "../../src/features/game/engine";
import type { ItemGameState, ItemRollAdjustment } from "../../src/types/network";
import { expect, test } from "./fixtures";
import { itemScenario } from "./fixtures/itemScenarios";
import {
  clickDice,
  diceButton,
  diceMoment,
  expectAcceptedSave,
  freezeClock,
  gamePanel,
  openTitle,
  panelStat,
  readMap,
  readSave,
  stampsExpected,
  startNewGame,
  writeSaveText,
} from "./support/app";
import { advanceMovement, advanceTumble, NORMAL_STEP_MS, stageDurationMs } from "./support/turnMoments";

// UI pop P2, S11: the pre-move moment (dice tumble, adjustment after the tumble,
// modifier stamps, one Skip). Saved records are the oracle: the cube lands on
// the saved raw roll, and every result equals the engine replay of the save.
// Post-move moments (arrival, lottery, pickup) arrive with S12-S15.

test.use({ dataset: "fixture", reducedMotion: "no-preference" });

const ADJUST_TITLE = "出目を調整しますか？";

function adjustmentDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: ADJUST_TITLE });
}

/** Resume `game` from storage with the page clock installed, then freeze it. */
async function resumeFrozen(page: Page, game: ItemGameState): Promise<void> {
  await page.clock.install();
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await freezeClock(page);
}

/**
 * The cube face the viewer sees, from the rendered transforms: compose the
 * cube's computed transform with each face's own placement and pick the face
 * whose outward normal points at the viewer (+z). CSS animations run on the
 * browser's own timeline, so the cube reaches its held final pose even under a
 * frozen page clock; until then no face points straight at the viewer.
 */
async function visibleFace(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const cube = document.querySelector(".dice-tumble__cube");
    if (!cube) return null;
    const cubeMatrix = new DOMMatrix(getComputedStyle(cube).transform === "none" ? undefined : getComputedStyle(cube).transform);
    for (const face of document.querySelectorAll<HTMLElement>(".dice-tumble__face")) {
      const own = getComputedStyle(face).transform;
      const normal = cubeMatrix.multiply(new DOMMatrix(own === "none" ? undefined : own)).transformPoint(new DOMPoint(0, 0, 1, 0));
      if (normal.z > 0.99) return face.getAttribute("data-face");
    }
    return null;
  });
}

/** Choose +1 when the dialog offers it (else −1) and return the engine adjustment it means. */
async function chooseAdjustment(page: Page, base: ItemGameState): Promise<ItemRollAdjustment> {
  const plus = adjustmentDialog(page).getByRole("radio", { name: /^\+1/ });
  const delta = await plus.count() > 0 ? 1 : -1;
  await adjustmentDialog(page).getByRole("radio", { name: delta > 0 ? /^\+1/ : /^−1/ }).check();
  const ticket = base.inventory.find((item) => item.kind === "roll-adjust");
  if (!ticket) throw new Error("the adjust scenario has no adjustment ticket");
  return { instanceId: ticket.id, delta };
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("the cube lands on the saved raw roll, the adjustment follows the one tumble, and stamps precede the movement", async ({ page, railwayBundle }) => {
  const base = itemScenario("adjust", railwayBundle.network);
  await resumeFrozen(page, base);
  const originStation = await panelStat(page, "現在駅").innerText();
  await expect.poll(async () => (await readMap(page))?.marker ?? null).not.toBeNull();
  const originMarker = (await readMap(page))!.marker;

  await clickDice(page);
  const saved = await readSave(page);
  if (saved?.pending?.kind !== "roll") throw new Error("expected the saved pending adjustment");
  const rawRoll = saved.pending.rawRoll;
  // Tumble: the saved raw roll, no dialog yet, the origin still shown, the dice locked.
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await expect(diceMoment(page)).toHaveAttribute("data-raw-roll", String(rawRoll));
  await expect.poll(() => visibleFace(page)).toBe(String(rawRoll));
  await expect(adjustmentDialog(page)).toHaveCount(0);
  await expect(panelStat(page, "現在駅")).toHaveText(originStation);
  expect((await readMap(page))?.marker).toEqual(originMarker);
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".turn-moment-host")).toHaveAttribute("aria-hidden", "true");

  await advanceTumble(page);
  await expect(adjustmentDialog(page)).toBeVisible();
  await expect(adjustmentDialog(page).getByRole("heading", { name: ADJUST_TITLE })).toBeFocused();
  await expect(diceMoment(page)).toHaveCount(0);
  await expect(adjustmentDialog(page)).toContainText(`出目：${rawRoll}`);
  const adjustment = await chooseAdjustment(page, base);
  await adjustmentDialog(page).getByRole("button", { name: /で続ける$/ }).click();

  // The resulting record attaches to the same attempt: stamps on the raw face, no second tumble, no movement yet.
  await expectAcceptedSave(page, base.turn + 1);
  const expected = playItemTurn(base, { adjustment }, railwayBundle.network);
  expect(await readSave(page)).toEqual(expected.state);
  const record = expected.state.movementHistory.at(-1)!;
  expect(stampsExpected(record)).toBe(true);
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "stamps");
  await expect(diceMoment(page)).toHaveAttribute("data-raw-roll", String(rawRoll));
  await expect(diceMoment(page).locator(".dice-tumble__stamp")).toHaveText([adjustment.delta > 0 ? "調整+1" : "調整-1"]);
  await expect(page.locator(".dice-tumble--tumble")).toHaveCount(0);
  await expect(diceButton(page)).toHaveText("移動中…");
  await expect(panelStat(page, "現在駅")).toHaveText(originStation);
  expect((await readMap(page))?.marker).toEqual(originMarker);

  // Clock time inside the stamps stage moves nothing: the movement is still gated.
  await page.clock.runFor(stageDurationMs("stamps") - 1);
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "stamps");
  expect((await readMap(page))?.marker).toEqual(originMarker);
  await page.clock.runFor(1);
  await expect(diceMoment(page)).toHaveCount(0);
  await advanceMovement(page, NORMAL_STEP_MS / 2);
  await expect.poll(async () => JSON.stringify((await readMap(page))?.marker)).not.toBe(JSON.stringify(originMarker));
  await expect(diceButton(page)).toHaveText("移動中…");
  expect(await readSave(page)).toEqual(expected.state);
});

test("Skip inside the adjustment keeps the chosen die and Continue, then nothing more plays", async ({ page, railwayBundle }) => {
  const base = itemScenario("adjust", railwayBundle.network);
  await resumeFrozen(page, base);
  await clickDice(page);
  await advanceTumble(page);
  await expect(adjustmentDialog(page)).toBeVisible();
  const adjustment = await chooseAdjustment(page, base);
  const proceed = adjustmentDialog(page).getByRole("button", { name: /で続ける$/ });
  const label = await proceed.innerText();
  const skip = adjustmentDialog(page).getByRole("button", { name: "スキップ", exact: true });
  await expect(skip).toHaveAttribute("aria-disabled", "false");
  await skip.click();

  // Skip ends the presentation only: the decision, its chosen radio and Continue stay mandatory.
  await expect(adjustmentDialog(page)).toBeVisible();
  await expect(adjustmentDialog(page).getByRole("radio", { name: adjustment.delta > 0 ? /^\+1/ : /^−1/ })).toBeChecked();
  await expect(proceed).toHaveText(label);
  await expect(skip).toHaveAttribute("aria-disabled", "true");
  await expect(skip).toBeFocused();
  expect((await readSave(page))?.pending?.kind).toBe("roll");
  await proceed.click();

  // No clock advance at all: no stamps, no movement frame, the turn is complete.
  await expect(diceMoment(page)).toHaveCount(0);
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(diceButton(page)).toBeFocused();
  expect(await readSave(page)).toEqual(playItemTurn(base, { adjustment }, railwayBundle.network).state);
});

test("tapping the dice card is the one Skip and keeps keyboard focus on the dice", async ({ page }) => {
  await page.clock.install();
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  const before = await gamePanel(page).boundingBox();
  await diceButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(diceMoment(page)).toBeVisible();
  await expect(diceButton(page)).toBeFocused();
  await expectAcceptedSave(page, 1);
  // The overlay never changes the panel's size.
  expect(await gamePanel(page).boundingBox()).toEqual(before);
  await expect(page.locator(".turn-moment-host button, .turn-moment-host [tabindex]")).toHaveCount(0);

  await page.locator(".turn-moment-host__card").click();
  await expect(diceMoment(page)).toHaveCount(0);
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(diceButton(page)).toBeFocused();
  await expectAcceptedSave(page, 1);
});

test("the dice card stays clear of the panel and the map controls", async ({ page }) => {
  await page.clock.install();
  await openTitle(page);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await freezeClock(page);
  await clickDice(page);
  const card = page.locator(".turn-moment-host__card");
  await expect(card).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.y).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height);
  const obstacles = [
    gamePanel(page),
    page.locator(".maplibregl-ctrl-top-right .maplibregl-ctrl-group"),
    page.locator(".map-overview"),
    page.locator(".maplibregl-ctrl-attrib"),
  ];
  for (const obstacle of obstacles) {
    await expect(obstacle).toBeVisible();
    const box = (await obstacle.boundingBox())!;
    expect(overlaps(cardBox, box), `card ${JSON.stringify(cardBox)} overlaps ${JSON.stringify(box)}`).toBe(false);
  }
});

test("a reload during the tumble resumes the saved turn with no moment replay", async ({ page }) => {
  await page.clock.install();
  await openTitle(page);
  await startNewGame(page);
  await freezeClock(page);
  await clickDice(page);
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await expectAcceptedSave(page, 1);
  const committed = await readSave(page);

  await page.reload();
  await page.getByRole("button", { name: /^つづきから（1ターン目・/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(".turn-moment-host")).toHaveCount(0);
  await page.clock.runFor(2_000);
  await expect(page.locator(".turn-moment-host")).toHaveCount(0);
  await expect(panelStat(page, "ターン数")).toHaveText("1");
  expect(await readSave(page)).toEqual(committed);
});

test("a reload while the adjustment is pending resumes at the dialog without a second tumble", async ({ page, railwayBundle }) => {
  const base = itemScenario("adjust", railwayBundle.network);
  await resumeFrozen(page, base);
  await clickDice(page);
  await advanceTumble(page);
  await expect(adjustmentDialog(page)).toBeVisible();
  const pending = await readSave(page);
  expect(pending).toEqual(beginItemTurn(base, { items: [] }, railwayBundle.network).state);

  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  // Restored pending roll: the saved die and its dialog at once, no tumble.
  await expect(adjustmentDialog(page)).toBeVisible();
  await expect(diceMoment(page)).toHaveCount(0);
  if (pending?.pending?.kind !== "roll") throw new Error("expected the restored pending roll");
  await expect(adjustmentDialog(page)).toContainText(`出目：${pending.pending.rawRoll}`);
  await adjustmentDialog(page).getByRole("button", { name: "そのまま続ける" }).click();
  await expect(adjustmentDialog(page)).toHaveCount(0);
  await expect(diceMoment(page)).toHaveCount(0);
  await expectAcceptedSave(page, base.turn + 1);
  expect(await readSave(page)).toEqual(playItemTurn(base, {}, railwayBundle.network).state);
});
