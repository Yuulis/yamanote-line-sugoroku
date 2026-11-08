import type { Locator, Page } from "@playwright/test";
import type { MoveEvent } from "../../src/features/game/engine";
import { beginItemTurn, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import type { ItemGameState, ItemRollAdjustment, ItemRideRecord } from "../../src/types/network";
import { expect, test } from "./fixtures";
import { itemScenario } from "./fixtures/itemScenarios";
import {
  combinedMomentGame,
  closeGameMenu,
  movementDurationMs,
  markerPosition,
  waitForRollOutcome,
  clickDice,
  diceButton,
  diceMoment,
  expectAcceptedSave,
  freezeClock,
  gamePanel,
  openGameMenu,
  openGameLog,
  openTitle,
  panelStat,
  readMap,
  readSave,
  stampsExpected,
  startNewGame,
  targetCompletedIds,
  targetFeatureIds,
  writeSaveText,
} from "./support/app";
import { advanceLotteryFlip, advanceLotterySettle, advanceArrival, advanceMovement, advancePickup, advanceStamps, advanceTumble, awaitStage, arrivalStagesForSpeed, advanceStageForSpeed, FRAME_MS, NORMAL_STEP_MS, stageDurationMs, stageMsForSpeed, type PresentedStage, type MomentSpeedId } from "./support/turnMoments";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { directionLabel } from "../../src/features/game/presentation";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import type { RailwayBundle } from "./fixtures/bundle";

// UI pop P2, S11: the pre-move moment (dice tumble, adjustment after the tumble,
// modifier stamps, one Skip). Saved records are the oracle: the cube lands on
// the saved raw roll, and every result equals the engine replay of the save.
// S12: the arrival banner after the movement. S14 publishes the ride at the
// lottery boundary; S15 publishes pickup results at the end of its own stage.
// S13: the completed-segment map flash, concurrent with the arrival.

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
  await awaitStage(page, "stamps");
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

// ---------------------------------------------------------------------------
// S12: the arrival banner.
// ---------------------------------------------------------------------------

/** Longer than any movement: the app caps a move at 6,000 ms, so this always lands after its end. */
const PAST_ANY_MOVEMENT_MS = 6_100;

function arrivalBanner(page: Page): Locator {
  return page.locator(".turn-moment-host .arrival-banner");
}

function serviceDisplayName(bundle: RailwayBundle, serviceId: string): string {
  return createPresentationResolver(bundle.network,
    bundle.data.manifest.ok ? bundle.data.manifest.value.uiPresentation : undefined).serviceName(serviceId);
}

function slotNamed(page: Page, name: string): Locator {
  return gamePanel(page).locator(".item-slot h3", { hasText: name });
}

/** Resume the route scenario frozen and play its plain turn up to the end of the movement; returns the replay. */
async function playRouteTurnToArrival(page: Page, bundle: RailwayBundle): Promise<ReturnType<typeof playItemTurn>> {
  const base = itemScenario("route", bundle.network);
  await resumeFrozen(page, base);
  const turnBefore = await clickDice(page);
  // The tumble timer starts once the saved roll is observed: wait for it before advancing the clock.
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await advanceTumble(page);
  await waitForRollOutcome(page, turnBefore);
  await expectAcceptedSave(page, base.turn + 1);
  const expected = playItemTurn(base, {}, bundle.network);
  expect(await readSave(page)).toEqual(expected.state);
  const record = expected.state.movementHistory.at(-1)!;
  if (stampsExpected(record)) await advanceStamps(page);
  await expect(diceMoment(page)).toHaveCount(0);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
  return expected;
}

interface DiscardPickupResult {
  readonly base: ItemGameState;
  readonly committed: ItemGameState;
  readonly record: ItemRideRecord;
}

async function playDiscardTurnToPickup(page: Page, bundle: RailwayBundle): Promise<DiscardPickupResult> {
  const base: ItemGameState = itemScenario("discard", bundle.network);
  const predicted = playItemTurn(base, {}, bundle.network).state;
  if (predicted.pending?.kind !== "discard") throw new Error("Expected an engine-built full-inventory discard turn");
  if (predicted.pending.record.kind !== "item-ride" || !predicted.pending.record.itemEvents.some((event) => event.type === "pickup-pending-discard")) {
    throw new Error("Expected the engine oracle to contain a pending-discard pickup");
  }
  const record: ItemRideRecord = structuredClone(predicted.pending.record) as ItemRideRecord;
  await resumeFrozen(page, base);
  await clickDice(page);
  await advanceTumble(page);
  const adjustDialog = adjustmentDialog(page);
  if (base.inventory.some((item) => item.kind === "roll-adjust")) {
    await expect(adjustDialog).toBeVisible();
    await adjustDialog.getByRole("button", { name: "そのまま続ける" }).click();
  }
  await expect.poll(async () => {
    const saved = await readSave(page);
    return saved?.pending?.kind === "discard" || saved?.movementHistory.length === base.movementHistory.length + 1;
  }).toBe(true);
  const committed: ItemGameState | null = await readSave(page);
  if (!committed) throw new Error("The accepted turn was not saved");
  expect(committed.pending?.kind).toBe("discard");
  if (stampsExpected(record)) await advanceStamps(page);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
  await advanceArrival(page);
  const landingCandidates = record.landingSnapshot?.services;
  if ((landingCandidates?.length ?? 0) > 1 || (landingCandidates?.find((candidate) => candidate.serviceId === record.landing?.serviceId)?.directions.length ?? 0) > 1) {
    await advanceLotteryFlip(page);
    await advanceLotterySettle(page);
  }
  await awaitStage(page, "pickup");
  return { base, committed, record };
}

test("the arrival and pickup stages hold turn results, then publish them together", async ({ page, railwayBundle }) => {
  const base = itemScenario("route", railwayBundle.network);
  await resumeFrozen(page, base);
  const turnBefore = await clickDice(page);
  // The tumble timer starts once the saved roll is observed: wait for it before advancing the clock.
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await advanceTumble(page);
  await waitForRollOutcome(page, turnBefore);
  await expectAcceptedSave(page, base.turn + 1);
  const expected = playItemTurn(base, {}, railwayBundle.network);
  expect(await readSave(page)).toEqual(expected.state);
  const record = expected.state.movementHistory.at(-1)!;
  if (record.kind !== "item-ride" || !record.resolvedRide || !record.landing) throw new Error("expected a ride with a landing");
  expect(stampsExpected(record)).toBe(false);
  // The saved oracle: the ride stops short (unused pips), reverses at the area end and picks up an item.
  expect(record.unusedPips).toBeGreaterThan(0);
  expect(record.landing.direction).not.toBe(record.resolvedRide.direction);
  expect(record.itemEvents.some((event) => event.type === "pickup-retained")).toBe(true);
  const status = gamePanel(page).getByRole("status");
  // Movement: the live region says the raw face only, never the hops, unused pips or the landing.
  await expect(status).toHaveText(`出目は${record.rawRoll}です。移動中です。スキップできます。`);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);

  // Arrival: the station is public; the ride, direction, highlight and platform are still the ridden ones.
  const arrived = railwayBundle.network.stationsById.get(record.toStationId)!.name;
  const ridden = record.resolvedRide;
  await expect(arrivalBanner(page)).toHaveText(`到着${arrived}`);
  await expect(page.locator(".turn-moment-host")).toHaveAttribute("aria-hidden", "true");
  await expect(panelStat(page, "現在駅")).toHaveText(arrived);
  await expect(panelStat(page, "乗車中")).toHaveText(serviceDisplayName(railwayBundle, ridden.serviceId));
  await expect(panelStat(page, "進行方向")).toHaveText(directionLabel(railwayBundle.network, ridden.serviceId, ridden.direction));
  await expect.poll(async () => (await readMap(page))?.marker)
    .toEqual(markerPosition(railwayBundle, { ...expected.state, currentServiceId: ridden.serviceId }));
  await expect(slotNamed(page, "快速券")).toHaveCount(0);
  await expect(page.locator(".toast-host__toast")).toHaveCount(0);
  await expect(diceButton(page)).toHaveText("サイコロを振る");
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(gamePanel(page).getByRole("button", { name: "スキップ", exact: true })).toBeEnabled();
  await expect(status).toHaveText(new RegExp(`^${record.turn}ターン目：${arrived}に到着。踏破 \\d+/30$`));
  expect(await readSave(page)).toEqual(expected.state);

  // The arrival's own duration, nothing earlier. Its timer starts in the frame that ended the movement, which is at
  // most the helper's one trailing frame (FRAME_MS) before now.
  await awaitStage(page, "arrival");
  await page.clock.runFor(stageDurationMs("arrival") - FRAME_MS - 1);
  await expect(arrivalBanner(page)).toBeVisible();
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(FRAME_MS + 1);

  const landingCandidates = record.landingSnapshot?.services;
  if ((landingCandidates?.length ?? 0) > 1 || (landingCandidates?.find((candidate) => candidate.serviceId === record.landing?.serviceId)?.directions.length ?? 0) > 1) {
    await advanceLotteryFlip(page);
    await advanceLotterySettle(page);
  }

  // The ride is published before pickup; inventory, notice, toast and readiness remain held through the flight.
  await expect(page.locator('.turn-moment-host [data-stage="pickup"]')).toBeVisible();
  await expect(page.locator('.turn-moment-host')).toHaveAttribute("aria-hidden", "true");
  await expect(slotNamed(page, "快速券")).toHaveCount(0);
  await expect(page.locator(".toast-host__toast")).toHaveCount(0);
  await expect(page.locator(".item-event-notice")).toHaveCount(0);
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(status).not.toContainText("快速券");
  await advancePickup(page);

  // Published: next direction, platform, picked-up item, toast and readiness together.
  await expect(arrivalBanner(page)).toHaveCount(0);
  await expect(panelStat(page, "進行方向")).toHaveText(directionLabel(railwayBundle.network, record.landing.serviceId, record.landing.direction));
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, expected.state));
  await expect(slotNamed(page, "快速券")).toHaveCount(1);
  await expect(page.locator(".toast-host__toast").first()).toBeVisible();
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(status).toHaveText(/。サイコロを振れます$/);
  expect(await readSave(page)).toEqual(expected.state);
});

test("tapping the arrival card is the one Skip: the result publishes at once and nothing replays", async ({ page, railwayBundle }) => {
  const expected = await playRouteTurnToArrival(page, railwayBundle);
  await diceButton(page).focus();
  await expect(arrivalBanner(page)).toBeVisible();
  await expect(page.locator(".turn-moment-host button, .turn-moment-host [tabindex]")).toHaveCount(0);
  await page.locator(".turn-moment-host__card").click();

  await expect(arrivalBanner(page)).toHaveCount(0);
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(diceButton(page)).toBeFocused();
  await expect(slotNamed(page, "快速券")).toHaveCount(1);
  await page.clock.runFor(stageDurationMs("arrival"));
  await expect(page.locator(".turn-moment-host")).toHaveCount(0);
  expect(await readSave(page)).toEqual(expected.state);
});

test("a reload during the arrival resumes the published result with no banner replay", async ({ page, railwayBundle }) => {
  const expected = await playRouteTurnToArrival(page, railwayBundle);
  await expect(arrivalBanner(page)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(".turn-moment-host")).toHaveCount(0);
  await page.clock.runFor(2_000);
  await expect(page.locator(".turn-moment-host")).toHaveCount(0);
  await expect(slotNamed(page, "快速券")).toHaveCount(1);
  expect(await readSave(page)).toEqual(expected.state);
});

test("the arrival card stays clear of the panel and the map controls", async ({ page, railwayBundle }) => {
  const base = itemScenario("route", railwayBundle.network);
  await page.clock.install();
  await page.goto("/");
  await writeSaveText(page, serializeGame(base));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await freezeClock(page);
  const turnBefore = await clickDice(page);
  // The tumble timer starts once the saved roll is observed: wait for it before advancing the clock.
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await advanceTumble(page);
  await waitForRollOutcome(page, turnBefore);
  await expectAcceptedSave(page, base.turn + 1);
  const record = (await readSave(page))!.movementHistory.at(-1)!;
  if (stampsExpected(record)) await advanceStamps(page);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
  const card = page.locator(".turn-moment-host__card");
  await expect(arrivalBanner(page)).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.y).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height);
  for (const obstacle of [
    gamePanel(page),
    page.locator(".maplibregl-ctrl-top-right .maplibregl-ctrl-group"),
    page.locator(".map-overview"),
    page.locator(".maplibregl-ctrl-attrib"),
  ]) {
    await expect(obstacle).toBeVisible();
    const box = (await obstacle.boundingBox())!;
    expect(overlaps(cardBox, box), `card ${JSON.stringify(cardBox)} overlaps ${JSON.stringify(box)}`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// S13: the completed-segment flash, concurrent with the arrival banner.
// ---------------------------------------------------------------------------

/**
 * Oracle: geometry features of the target segments the saved record newly completed (traversed and not completed
 * before the turn), cross-checked against the saved completion difference.
 */
function newlyCompletedFlashIds(bundle: RailwayBundle, base: ItemGameState, after: ItemGameState): string[] {
  const record = after.movementHistory.at(-1)!;
  const before = new Set(base.completedSegmentIds);
  const fresh = targetCompletedIds({ completedSegmentIds: record.traversedSegmentIds }).filter((id) => !before.has(id));
  const difference = targetCompletedIds(after).filter((id) => !before.has(id));
  expect([...new Set(fresh)].sort()).toEqual([...difference].sort());
  return targetFeatureIds({ completedSegmentIds: difference }, bundle).sort();
}

/** Resume the "delay" scenario frozen with the map loaded and play its turn up to the end of the movement. */
async function playDelayTurnToArrival(page: Page, bundle: RailwayBundle): Promise<{ base: ItemGameState; flashIds: string[] }> {
  const base = itemScenario("delay", bundle.network);
  await page.clock.install();
  await page.goto("/");
  await writeSaveText(page, serializeGame(base));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await freezeClock(page);
  // Initialised empty and transparent.
  expect((await readMap(page))?.flashFilterIds).toEqual([]);
  expect((await readMap(page))?.flashOpacity).toBe(0);
  const turnBefore = await clickDice(page);
  await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
  await advanceTumble(page);
  await waitForRollOutcome(page, turnBefore);
  await expectAcceptedSave(page, base.turn + 1);
  const expected = playItemTurn(base, {}, bundle.network);
  expect(await readSave(page)).toEqual(expected.state);
  if (stampsExpected(expected.state.movementHistory.at(-1)!)) await advanceStamps(page);
  await expect(diceMoment(page)).toHaveCount(0);
  const flashIds = newlyCompletedFlashIds(bundle, base, expected.state);
  expect(flashIds.length).toBeGreaterThan(0);
  // Movement: segments complete hop by hop on the completed layer, but nothing flashes yet.
  await advanceMovement(page, NORMAL_STEP_MS / 2);
  expect((await readMap(page))?.flashFilterIds).toEqual([]);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
  await expect(arrivalBanner(page)).toBeVisible();
  return { base, flashIds };
}

test("the arrival flashes exactly the record's newly completed target segments, in one pulse, then empties", async ({ page, railwayBundle }) => {
  const { base, flashIds } = await playDelayTurnToArrival(page, railwayBundle);
  const arrival = await readMap(page);
  expect([...arrival!.flashFilterIds].sort()).toEqual(flashIds);
  // Only the new segments: the completed layer also holds the ones completed before this turn.
  const earlier = targetFeatureIds(base, railwayBundle);
  expect(earlier.length).toBeGreaterThan(0);
  expect(arrival!.flashFilterIds.some((id) => earlier.includes(id))).toBe(false);
  expect(arrival!.completedFilterIds).toEqual(expect.arrayContaining([...earlier, ...flashIds]));

  // Mid-arrival the single pulse is near its peak; the banner and the flash share the arrival's duration.
  await awaitStage(page, "arrival");
  await page.clock.runFor(stageDurationMs("arrival") / 2 - FRAME_MS);
  const middle = await readMap(page);
  expect([...middle!.flashFilterIds].sort()).toEqual(flashIds);
  expect(middle!.flashOpacity).toBeGreaterThan(0.5);
  expect(middle!.flashOpacity).toBeLessThanOrEqual(0.85);

  await advanceArrival(page);
  await expect(arrivalBanner(page)).toHaveCount(0);
  await expect.poll(async () => (await readMap(page))?.flashFilterIds).toEqual([]);
  expect((await readMap(page))?.flashOpacity).toBe(0);
  await page.clock.runFor(stageDurationMs("arrival"));
  expect((await readMap(page))?.flashFilterIds).toEqual([]);
});

for (const end of ["スキップ", "タイトル"] as const) {
  test(`${end} during the arrival empties the flash at once and nothing lingers`, async ({ page, railwayBundle }) => {
    const { flashIds } = await playDelayTurnToArrival(page, railwayBundle);
    expect([...(await readMap(page))!.flashFilterIds].sort()).toEqual(flashIds);
    if (end === "スキップ") {
      await gamePanel(page).getByRole("button", { name: "スキップ", exact: true }).click();
      await expect(arrivalBanner(page)).toHaveCount(0);
    } else {
      await openGameMenu(page);
      await gamePanel(page).getByRole("button", { name: "タイトル" }).click();
      await expect(gamePanel(page)).toHaveCount(0);
    }
    await expect.poll(async () => (await readMap(page))?.flashFilterIds).toEqual([]);
    expect((await readMap(page))?.flashOpacity).toBe(0);
    await page.clock.runFor(stageDurationMs("arrival"));
    expect((await readMap(page))?.flashFilterIds).toEqual([]);
    expect((await readMap(page))?.flashOpacity).toBe(0);
  });
}

// S14: explicit lottery boundaries, with the saved result as oracle.
async function playLotteryToFlip(page: Page): Promise<NonNullable<Awaited<ReturnType<typeof readSave>>>> {
  await page.clock.install();
  await openTitle(page); await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
  await freezeClock(page); await clickDice(page); await advanceTumble(page);
  await expectAcceptedSave(page, 1);
  const saved = (await readSave(page))!;
  if (stampsExpected(saved.movementHistory.at(-1)!)) await advanceStamps(page);
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS); await advanceArrival(page);
  await awaitStage(page, "lottery-flip");
  return saved;
}

test("lottery flip and settle keep HUD, highlight, platform, log, upcoming stations and item results behind one publication", async ({ page, railwayBundle }) => {
  const saved = await playLotteryToFlip(page);
  const record = saved.movementHistory.at(-1)!;
  if (record.kind !== "item-ride") throw new Error("expected ride");
  expect(record.landingSnapshot!.services.length).toBeGreaterThan(1);
  const status = gamePanel(page).getByRole("status");
  const arrivalCopy = await status.textContent();
  await expect(status).toContainText("抽選結果を表示しています");
  await openGameLog(page);
  await expect(gamePanel(page).locator('section[aria-label="乗車中の次の駅"]')).toHaveCount(1);
  const oldUpcoming = await gamePanel(page).locator('section[aria-label="乗車中の次の駅"]').textContent();
  for (const stage of ["lottery-flip", "lottery-settle"] as const) {
    await awaitStage(page, stage);
    await expect(panelStat(page, "乗車中")).toHaveText(serviceDisplayName(railwayBundle, record.resolvedRide.serviceId));
    await expect(panelStat(page, "進行方向")).toHaveText(directionLabel(railwayBundle.network, record.resolvedRide.serviceId, record.resolvedRide.direction));
    await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
      .toEqual([...new Set([...railwayBundle.network.segmentsById.values()].filter((segment) => segment.serviceId === record.resolvedRide.serviceId).flatMap((segment) => segment.geometryFeatureIds))]);
    await expect.poll(async () => (await readMap(page))?.marker)
      .toEqual(markerPosition(railwayBundle, { ...saved, currentServiceId: record.resolvedRide.serviceId }));
    await expect(gamePanel(page).locator(".game-panel__lottery")).toHaveText("抽選: —");
    await expect(gamePanel(page).locator(".game-panel__candidates")).toHaveCount(0);
    expect(await gamePanel(page).locator('section[aria-label="乗車中の次の駅"]').textContent()).toBe(oldUpcoming);
    await expect(status).toHaveText(arrivalCopy!);
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".item-event-notice")).toHaveCount(0);
    await expect(page.locator(".turn-moment-host button, .turn-moment-host [tabindex]")).toHaveCount(0);
    if (stage === "lottery-flip") await advanceLotteryFlip(page);
  }
  const board = page.locator(".lottery-reveal");
  await expect(board.locator(".lottery-reveal__result").first()).toHaveText(serviceDisplayName(railwayBundle, saved.currentServiceId));
  await expect(board.locator(".lottery-reveal__result").last()).toHaveText(directionLabel(railwayBundle.network, saved.currentServiceId, saved.direction));
  await advanceLotterySettle(page);
  await expect(board).toHaveCount(0);
  await expect(panelStat(page, "乗車中")).toHaveText(serviceDisplayName(railwayBundle, saved.currentServiceId));
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, saved));
  await expect.poll(async () => (await readMap(page))?.highlightedFeatureIds)
    .toEqual([...new Set([...railwayBundle.network.segmentsById.values()].filter((segment) => segment.serviceId === saved.currentServiceId).flatMap((segment) => segment.geometryFeatureIds))]);
  await expect(gamePanel(page).locator(".game-panel__lottery")).toContainText("抽選 → テスト南線");
  expect(await gamePanel(page).locator('section[aria-label="乗車中の次の駅"]').textContent()).not.toBe(oldUpcoming);
  await expect(status).toHaveText(/。サイコロを振れます$/);
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
  expect(await readSave(page)).toEqual(saved);
});

for (const stage of ["lottery-flip", "lottery-settle"] as const) {
  for (const end of ["Skip", "reduced motion"] as const) {
    test(`${end} during ${stage} ends the whole presentation without replay`, async ({ page }) => {
      const saved = await playLotteryToFlip(page);
      if (stage === "lottery-settle") await advanceLotteryFlip(page);
      await awaitStage(page, stage);
      await diceButton(page).focus();
      if (end === "Skip") await page.locator(".turn-moment-host__card").click();
      else { await page.emulateMedia({ reducedMotion: "reduce" }); }
      await expect(page.locator(".turn-moment-host")).toHaveCount(0);
      await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
      await expect(diceButton(page)).toBeFocused();
      await page.emulateMedia({ reducedMotion: "no-preference" }); await page.clock.runFor(3_000);
      await expect(page.locator(".turn-moment-host")).toHaveCount(0);
      expect(await readSave(page)).toEqual(saved);
    });
  }
}

test.describe("S15 pickup and delayed discard", () => {
  test("a full-inventory pickup publishes its choice and paused toast together, then adds the discard toast without replay", async ({ page, railwayBundle }) => {
    const { committed, record } = await playDiscardTurnToPickup(page, railwayBundle);
    const pickup = record.itemEvents.find((event) => event.type === "pickup-pending-discard");
    if (pickup?.type !== "pickup-pending-discard") throw new Error("Expected the full-inventory pickup event");
    const pickupName = ITEM_DESCRIPTIONS[pickup.item.kind].name;
    const status = gamePanel(page).getByRole("status");

    await expect(page.locator('.turn-moment-host [data-stage="pickup"]')).toHaveAttribute("data-motion", "flight");
    await expect(gamePanel(page).locator(".item-slot")).toHaveCount(3);
    await expect(gamePanel(page).locator(".item-discard")).toHaveCount(0);
    await expect(status).toHaveCount(1);
    await expect(status).not.toContainText(pickupName);
    await expect(page.locator(".toast-host__toast")).toHaveCount(0);
    expect(await readSave(page)).toEqual(committed);

    await advancePickup(page);
    const dialog = page.locator(".item-discard");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "捨てるアイテムを選ぶ" })).toBeFocused();
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await expect(gamePanel(page).getByRole("status")).toHaveCount(1);
    await expect(gamePanel(page).getByRole("status")).toContainText(pickupName);
    await expect(gamePanel(page).getByRole("status")).toContainText("捨てるアイテムを1つ選んでください");
    await expect(gamePanel(page).locator(".item-slot")).toHaveCount(3);
    const pickupToast = page.locator(".toast-host__toast");
    await expect(pickupToast).toHaveCount(1);
    await expect(pickupToast).toContainText(`${pickupName}を手に入れた！`);
    await page.clock.runFor(5_000);
    await expect(pickupToast).toHaveCount(1);

    await dialog.getByRole("button", { name: "このアイテムを捨てる" }).first().click();
    await expect(page.locator(".item-discard")).toHaveCount(0);
    await expect(page.locator('.turn-moment-host [data-stage="pickup"]')).toHaveCount(0);
    await expect.poll(async () => (await readSave(page))?.pending?.kind ?? null).toBe(null);
    await expect.poll(async () => page.locator(".toast-host__toast").count()).toBe(2);
    await expect(page.locator(".toast-host__toast").first()).toContainText(`${pickupName}を手に入れた！`);
    await expect(page.locator(".toast-host__toast").last()).toContainText("を捨てた");
  });

  test("Skip during a full-inventory pickup keeps the mandatory discard choice", async ({ page, railwayBundle }) => {
    const { record } = await playDiscardTurnToPickup(page, railwayBundle);
    await expect(page.locator('.turn-moment-host [data-stage="pickup"]')).toBeVisible();
    await page.locator(".turn-moment-host__card").click();

    const dialog = page.locator(".item-discard");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "捨てるアイテムを選ぶ" })).toBeFocused();
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await expect(gamePanel(page).locator(".item-slot")).toHaveCount(3);
    await expect(gamePanel(page).getByRole("status")).toContainText("捨てるアイテムを1つ選んでください");
    const pickup = record.itemEvents.find((event) => event.type === "pickup-pending-discard");
    if (pickup?.type !== "pickup-pending-discard") throw new Error("Expected the full-inventory pickup event");
    await expect(gamePanel(page).getByRole("status")).toContainText(ITEM_DESCRIPTIONS[pickup.item.kind].name);
  });

  test("reduced motion during a full-inventory pickup opens discard without replay", async ({ page, railwayBundle }) => {
    await playDiscardTurnToPickup(page, railwayBundle);
    await expect(page.locator('.turn-moment-host [data-stage="pickup"]')).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });

    const dialog = page.locator(".item-discard");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "捨てるアイテムを選ぶ" })).toBeFocused();
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.clock.runFor(3_000);
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
});

// S16: cross-feature composition. Adjustment/goal/save-failure boundaries remain
// in the S11/S12 cases, accessibility.spec.ts and save-errors.spec.ts.
const SPEED_CASES = [
  { id: "slow", label: "ゆっくり", clicks: 3, stepMs: 600 },
  { id: "normal", label: "ふつう", clicks: 0, stepMs: 450 },
  { id: "fast", label: "はやい", clicks: 1, stepMs: 300 },
  { id: "very-fast", label: "とても速い", clicks: 2, stepMs: 120 },
] as const;

async function combinedTo(page: Page, bundle: RailwayBundle, checkpoint: string): Promise<ItemGameState> {
  const base: ItemGameState = combinedMomentGame(bundle);
  await resumeFrozen(page, base);
  const expected: ItemGameState = playItemTurn(base, {}, bundle.network).state;
  expect(expected.pending?.kind).toBe("discard");
  await clickDice(page);
  if (checkpoint === "tumble") return expected;
  await advanceTumble(page);
  await awaitStage(page, "stamps");
  if (checkpoint === "stamps") return expected;
  await advanceStamps(page);
  if (checkpoint === "movement") return expected;
  await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
  await awaitStage(page, "arrival");
  if (checkpoint === "arrival") return expected;
  await advanceArrival(page);
  await awaitStage(page, "lottery-flip");
  if (checkpoint === "lottery-flip") return expected;
  await advanceLotteryFlip(page);
  await awaitStage(page, "lottery-settle");
  if (checkpoint === "lottery-settle") return expected;
  await advanceLotterySettle(page);
  await awaitStage(page, "pickup");
  return expected;
}

for (const speed of SPEED_CASES) {
  test(`S16 complete overflow turn at ${speed.id} keeps captured deadlines and one live region`, async ({ page, railwayBundle }) => {
    // The page clock owns the exact reveal deadlines; allow headroom for software rendering at four workers.
    test.setTimeout(60_000);
    const base: ItemGameState = combinedMomentGame(railwayBundle);
    await resumeFrozen(page, base);
    await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
    await openGameMenu(page);
    const speedButton = gamePanel(page).getByRole("button", { name: /^アニメーション速度:/ });
    for (let index: number = 0; index < speed.clicks; index += 1) await speedButton.click();
    await expect(speedButton).toContainText(speed.label);
    await closeGameMenu(page);
    await page.evaluate((flashLayerId) => {
      const original: typeof window.setTimeout = window.setTimeout.bind(window);
      const timers: { stage: string; delay: number; deadline: number }[] = [];
      (window as unknown as { momentTimers: typeof timers }).momentTimers = timers;
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]): number => {
        const map = (window as unknown as { __sugorokuE2E?: { map?: {
          getLayer(id: string): unknown; getFilter(id: string): unknown;
        } } }).__sugorokuE2E?.map;
        const filter = map?.getLayer(flashLayerId) ? map.getFilter(flashLayerId) as
          [string, unknown, [string, unknown, [string, string[]]]] : null;
        const flashing: boolean = (filter?.[2]?.[2]?.[1]?.length ?? 0) > 0;
        const stage: string | null = document.querySelector(".dice-tumble, .lottery-reveal, .item-pickup-moment")?.getAttribute("data-stage")
          ?? (document.querySelector(".arrival-banner") ? "arrival"
            : flashing && !document.querySelector(".turn-moment-host") ? "segment-flash" : null);
        if (stage && delay !== undefined) timers.push({ stage, delay, deadline: Date.now() + delay });
        return original(handler, delay, ...args);
      }) as typeof window.setTimeout;
    }, LAYER_IDS.segmentsFlash);
    await diceButton(page).focus();
    await page.keyboard.press("Enter");
    const expected: ItemGameState = playItemTurn(base, {}, railwayBundle.network).state;
    expect(expected.pending?.kind).toBe("discard");
    if (expected.pending?.kind !== "discard") throw new Error("Missing overflow oracle");
    const record = structuredClone(expected.pending.record) as ItemRideRecord;
    expect(stampsExpected(record)).toBe(true);
    expect(record.landingSnapshot!.services.length).toBeGreaterThan(1);
    // Change the setting while this turn is active; the entire chain keeps its captured speed.
    await openGameMenu(page);
    await speedButton.click();
    await closeGameMenu(page);
    await diceButton(page).focus();
    const boundaries = new Map<PresentedStage, string>();
    const check = async (stage: PresentedStage): Promise<void> => {
      await expect(gamePanel(page).getByRole("status")).toHaveCount(1);
      if (stage === "segment-flash") await expect(page.locator(".turn-moment-host")).toHaveCount(0);
      else await expect(page.locator(".turn-moment-host")).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator(".turn-moment-host button, .turn-moment-host [tabindex], .turn-moment-host [role=status]")).toHaveCount(0);
      await expect(diceButton(page)).toBeFocused();
      await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
      boundaries.set(stage, (await gamePanel(page).getByRole("status").textContent())!);
      expect(await readSave(page)).toEqual(expected);
    };
    for (const stage of ["tumble", "stamps"] as const) {
      await awaitStage(page, stage); await check(stage);
      await page.clock.runFor(stageMsForSpeed(stage, speed.id)! - 1);
      await expect(diceMoment(page)).toHaveAttribute("data-stage", stage);
      await page.clock.runFor(1);
    }
    const moveMs: number = movementDurationMs(railwayBundle, playItemTurn(base, {}, railwayBundle.network).events.filter((event): event is MoveEvent => event.type === "segment-traversed" || event.type === "goal-reached" || event.type === "endpoint-reached" || event.type === "landing-resolved"), speed.stepMs);
    await advanceMovement(page, moveMs * 0.8);
    await expect(diceButton(page)).toHaveText("移動中…");
    await expect(arrivalBanner(page)).toHaveCount(0);
    await advanceMovement(page, moveMs * 0.2);
    const arrivalStages = arrivalStagesForSpeed(speed.id, true);
    const revealStages: PresentedStage[] = [...arrivalStages, "lottery-flip", "lottery-settle", "pickup"];
    for (const stage of revealStages) {
      await awaitStage(page, stage); await check(stage);
      if (speed.id === "very-fast") await expect(arrivalBanner(page)).toHaveCount(0);
      const isArrival = stage === "arrival" || stage === "segment-flash";
      const flashIds: string[] = isArrival ? targetFeatureIds({ completedSegmentIds: record.traversedSegmentIds.filter((id) => !base.completedSegmentIds.includes(id)) }, railwayBundle) : [];
      if (isArrival) expect(flashIds.length).toBeGreaterThan(0);
      await expect.poll(async () => [...((await readMap(page))?.flashFilterIds ?? [])].sort()).toEqual(flashIds.sort());
      const timer = await page.evaluate(({ stage, delay }) => {
        const timers = (window as unknown as { momentTimers: { stage: string; delay: number; deadline: number }[] }).momentTimers;
        const timer = timers.find((entry) => entry.stage === stage && entry.delay === delay);
        return timer ? { ...timer, remaining: timer.deadline - Date.now() } : null;
      }, { stage, delay: stageMsForSpeed(stage, speed.id)! });
      expect(timer?.delay).toBe(stageMsForSpeed(stage, speed.id));
      expect(timer!.remaining).toBeGreaterThan(0);
      await page.clock.runFor(timer!.remaining - 1);
      await awaitStage(page, stage);
      await page.clock.runFor(1);
    }
    // Flip/settle share one announcement; pickup publishes the ride before the item.
    expect(boundaries.get(arrivalStages[0]!)).toBe(boundaries.get("lottery-flip"));
    expect(boundaries.get("lottery-flip")).toBe(boundaries.get("lottery-settle"));
    expect(boundaries.get("pickup")).not.toBe(boundaries.get("lottery-settle"));
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await expect(discard.getByRole("heading", { name: "捨てるアイテムを選ぶ" })).toBeFocused();
    await expect(gamePanel(page).getByRole("status")).toHaveCount(1);
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await discard.getByRole("button", { name: "このアイテムを捨てる" }).last().click();
    expect(await readSave(page)).toEqual(resolveItemDiscard(expected, expected.pending.item.id).state);
    await expect(diceButton(page)).toBeFocused();
    // The next turn captures the newly selected speed.
    await diceButton(page).click();
    await awaitStage(page, "tumble");
    const nextSpeed: MomentSpeedId = speed.id === "slow" ? "normal" : speed.id === "normal" ? "fast"
      : speed.id === "fast" ? "very-fast" : "slow";
    await page.clock.runFor(stageMsForSpeed("tumble", nextSpeed)! - 1);
    await expect(diceMoment(page)).toHaveAttribute("data-stage", "tumble");
    await page.clock.runFor(1);
    await expect(page.locator('.dice-tumble[data-stage="tumble"]')).toHaveCount(0);
    if (speed.id === "very-fast") {
      // This inventory still owns an adjustment ticket: the next turn must resolve that decision before moving.
      await expect(adjustmentDialog(page)).toBeVisible();
      await adjustmentDialog(page).getByRole("button", { name: "そのまま続ける", exact: true }).click();
      await expectAcceptedSave(page, base.turn + 2);
      const nextBase = resolveItemDiscard(expected, expected.pending.item.id).state;
      const nextResult = playItemTurn(nextBase, {}, railwayBundle.network);
      expect(await readSave(page)).toEqual(nextResult.state);
      if (!nextResult.record) throw new Error("Expected the next turn's accepted record");
      if (stampsExpected(nextResult.record)) await advanceStageForSpeed(page, "stamps", nextSpeed);
      // The active very-fast turn had no banner even after selecting slow; only this next turn gets it.
      await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
      await awaitStage(page, "arrival");
      await expect(arrivalBanner(page)).toBeVisible();
      const nextArrival = await page.evaluate((delay) => {
        const timers = (window as unknown as { momentTimers: { stage: string; delay: number; deadline: number }[] }).momentTimers;
        const timer = timers.findLast((entry) => entry.stage === "arrival" && entry.delay === delay);
        return timer ? { ...timer, remaining: timer.deadline - Date.now() } : null;
      }, stageMsForSpeed("arrival", nextSpeed)!);
      expect(nextArrival?.delay).toBe(1_067);
      expect(nextArrival!.remaining).toBeGreaterThan(0);
      await page.clock.runFor(nextArrival!.remaining - 1);
      await expect(arrivalBanner(page)).toBeVisible();
      await page.clock.runFor(1);
      await expect(arrivalBanner(page)).toHaveCount(0);
    }
  });
}

for (const stage of ["tumble", "stamps", "movement", "arrival", "lottery-flip", "lottery-settle", "pickup"] as const) {
  test(`S16 one Skip during ${stage} reaches the same overflow result`, async ({ page, railwayBundle }) => {
    const expected = await combinedTo(page, railwayBundle, stage);
    await gamePanel(page).getByRole("button", { name: "スキップ", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    expect(await readSave(page)).toEqual(expected);
    await page.clock.runFor(10_000);
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await expect.poll(async () => (await readMap(page))?.flashFilterIds).toEqual([]);
    expect(await readSave(page)).toEqual(expected);
  });
}

for (const stage of ["movement", "lottery-flip", "pickup"] as const) {
  test(`S16 reload during ${stage} restores the same mandatory discard without replay`, async ({ page, railwayBundle }) => {
    const expected = await combinedTo(page, railwayBundle, stage);
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await page.clock.runFor(10_000);
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    expect(await readSave(page)).toEqual(expected);
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 412, height: 839 }, { width: 320, height: 720 }, { width: 667, height: 375 }, { width: 640, height: 400 }]) {
  test(`S16 usable map placement through all moments at ${viewport.width}x${viewport.height}`, async ({ page, railwayBundle }, testInfo) => {
    // Six stages plus repeated hit testing can exceed 30 s with touch DPR and software WebGL.
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await combinedTo(page, railwayBundle, "tumble");
    const verify = async (stage: string): Promise<void> => {
      const card = page.locator(".turn-moment-host__card");
      // Arrival content has its own minimum width, so include its overflow in placement checks.
      const bounds = (await (stage === "arrival" ? arrivalBanner(page) : card).boundingBox())!;
      const panel = (await gamePanel(page).boundingBox())!;
      const map = (await page.locator(".map-container").boundingBox())!;
      const obstacles = [panel];
      for (const selector of [".maplibregl-ctrl-top-right .maplibregl-ctrl-group", ".map-overview", ".maplibregl-ctrl-attrib"]) {
        obstacles.push((await page.locator(selector).boundingBox())!);
      }
      const fits: boolean = bounds.x >= map.x && bounds.y >= map.y && bounds.x + bounds.width <= viewport.width
        && bounds.y + bounds.height <= viewport.height && obstacles.every((box) => !overlaps(bounds, box));
      const effectiveWidth: number = await page.locator(".turn-moment-host__region").evaluate((element) => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        return element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      expect.soft(effectiveWidth, `${stage}: usable card region width`).toBeGreaterThanOrEqual(112);
      if (stage === "arrival" || stage === "lottery") {
        expect.soft(bounds.width, `${stage}: effective card width`).toBeGreaterThanOrEqual(112);
      }
      if (!fits) await page.screenshot({ path: `.claude/logs/screenshots/p2-s16-layout-${viewport.width}-${stage}.png` });
      expect.soft(fits, `${stage}: ${JSON.stringify({ bounds, obstacles })}`).toBe(true);
      await page.locator(".turn-moment-host").evaluate((element) => { (element as HTMLElement).hidden = true; });
      expect(await gamePanel(page).boundingBox()).toEqual(panel);
      await page.locator(".turn-moment-host").evaluate((element) => { (element as HTMLElement).hidden = false; });
      await page.getByRole("button", { name: "Zoom in", exact: true }).click({ trial: true });
      await page.locator(".maplibregl-ctrl-attrib-button").click({ trial: true });
      testInfo.annotations.push({ type: stage, description: JSON.stringify({ bounds, panel }) });
    };
    await verify("tumble"); await advanceTumble(page);
    await verify("stamps"); await advanceStamps(page);
    await advanceMovement(page, PAST_ANY_MOVEMENT_MS);
    await awaitStage(page, "arrival"); await verify("arrival"); await advanceArrival(page);
    await awaitStage(page, "lottery-flip"); await verify("lottery"); await advanceLotteryFlip(page);
    await advanceLotterySettle(page);
    await awaitStage(page, "pickup"); await verify("pickup"); await advancePickup(page);
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await discard.getByRole("button", { name: "このアイテムを捨てる" }).last().click();
    await expect(page.locator(".toast-host__toast")).toHaveCount(2);
    await expect(page.locator(".toast-host")).toBeInViewport();
  });
}

for (const size of ["normal", "alternative"] as const) {
  for (const target of ["slot", "header"] as const) {
    test(`S16 pickup viewport flight to ${target} at ${size} size`, async ({ page, railwayBundle }, testInfo) => {
      if (size === "alternative") await page.setViewportSize({ width: 640, height: 400 });
      if (target === "header") await combinedTo(page, railwayBundle, "pickup");
      else {
        const expected = await playRouteTurnToArrival(page, railwayBundle);
        const record = expected.state.movementHistory.at(-1)!;
        expect(record.itemEvents.some((event) => event.type === "pickup-retained")).toBe(true);
        await advanceArrival(page);
        const candidates = record.landingSnapshot?.services;
        if ((candidates?.length ?? 0) > 1 || (candidates?.find((candidate) => candidate.serviceId === record.landing?.serviceId)?.directions.length ?? 0) > 1) {
          await advanceLotteryFlip(page);
          await advanceLotterySettle(page);
        }
        await awaitStage(page, "pickup");
      }
      const saved = await readSave(page);
      const pickup = page.locator(".item-pickup-moment");
      await expect(pickup).toHaveAttribute("data-motion", "flight");
      await expect(page.locator(".turn-moment-host")).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator(".turn-moment-host button, .turn-moment-host [tabindex]")).toHaveCount(0);
      await diceButton(page).focus();
      // CSS animations have their own timeline. Seek the actual flight without advancing the stage timer.
      const geometry = await pickup.evaluate((element, targetKind) => {
        const animation = element.getAnimations().find((candidate) =>
          candidate instanceof CSSAnimation && candidate.animationName === "item-pickup-flight");
        if (!animation) throw new Error("Expected the pickup CSS flight");
        animation.pause();
        const duration = Number(animation.effect!.getComputedTiming().duration);
        const box = (node: Element): { x: number; y: number; width: number; height: number } => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const card = box(element.closest(".turn-moment-host__card")!);
        const destination = box(document.querySelector(targetKind === "header"
          ? ".item-inventory__header" : ".item-slot--empty")!);
        const samples = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          animation.currentTime = duration * fraction;
          return box(element);
        });
        animation.currentTime = 0;
        return { card, destination, samples, viewport: { width: innerWidth, height: innerHeight } };
      }, target);
      await testInfo.attach("pickup-flight-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
      const centre = (box: { x: number; y: number; width: number; height: number }): { x: number; y: number } =>
        ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      const start = centre(geometry.samples[0]!);
      const end = centre(geometry.samples.at(-1)!);
      const message = JSON.stringify(geometry);
      expect.soft(start.x, message).toBeCloseTo(centre(geometry.card).x, 1);
      expect.soft(start.y, message).toBeCloseTo(centre(geometry.card).y, 1);
      for (const bounds of geometry.samples) {
        expect.soft(bounds.x, message).toBeGreaterThanOrEqual(0);
        expect.soft(bounds.y, message).toBeGreaterThanOrEqual(0);
        expect.soft(bounds.x + bounds.width, message).toBeLessThanOrEqual(geometry.viewport.width);
        expect.soft(bounds.y + bounds.height, message).toBeLessThanOrEqual(geometry.viewport.height);
      }
      expect.soft(end.x, message).toBeCloseTo(centre(geometry.destination).x, 1);
      expect.soft(end.y, message).toBeCloseTo(centre(geometry.destination).y, 1);
      // Tap the measured icon itself; its bubbling click must still Skip without moving focus.
      await pickup.click();
      await expect(page.locator(".turn-moment-host")).toHaveCount(0);
      if (target === "header") {
        await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "捨てるアイテムを選ぶ" })).toBeFocused();
      } else {
        await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
        await expect(diceButton(page)).toBeFocused();
      }
      expect(await readSave(page)).toEqual(saved);
    });
  }
}

test("S16 unavailable map does not block pickup, retry or mandatory discard", async ({ page, railwayBundle, mapStub }) => {
  mapStub.failStyle = true;
  const expected = await combinedTo(page, railwayBundle, "pickup");
  const error = page.getByRole("alert").filter({ hasText: "地図の読み込みに失敗しました。" });
  await expect(error).toBeVisible();
  mapStub.failStyle = false;
  await error.getByRole("button", { name: "再試行" }).click();
  await page.clock.runFor(FRAME_MS);
  await expect.poll(async () => {
    await page.clock.runFor(FRAME_MS);
    return (await readMap(page))?.styleLoaded;
  }).toBe(true);
  expect((await readMap(page))?.flashFilterIds).toEqual([]);
  await advancePickup(page);
  await expect(page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" })).toBeVisible();
  expect(await readSave(page)).toEqual(expected);
});

for (const exit of ["タイトル", "新規"] as const) {
  test(`S16 ${exit} during lottery removes the host and no old moment reaches the replacement session`, async ({ page, railwayBundle }) => {
    await combinedTo(page, railwayBundle, "lottery-flip");
    await openGameMenu(page);
    await gamePanel(page).getByRole("button", { name: exit, exact: true }).click();
    if (exit === "タイトル") await page.getByRole("button", { name: "はじめから" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "新しく始める", exact: true }).click();
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    await expect(panelStat(page, "ターン数")).toHaveText("0");
    await page.clock.runFor(10_000);
    await expect(page.locator(".turn-moment-host")).toHaveCount(0);
    expect((await readMap(page))?.flashFilterIds).toEqual([]);
    await expect(panelStat(page, "ターン数")).toHaveText("0");
  });
}
