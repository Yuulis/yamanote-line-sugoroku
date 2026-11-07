import { ANIMATION_SPEEDS, DEFAULT_ANIMATION_SPEED, DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createGame, playTurn } from "./fixtures/productGame";
import {
  clickDice,
  diceButton,
  diceMoment,
  expectAcceptedSave,
  freezeClock,
  gamePanel,
  loadStations,
  markerPosition,
  movementDurationMs,
  targetCompletedIds,
  openTitle,
  openGameLog,
  openGameMenu,
  panelStat,
  REQUIRED_SEGMENTS,
  readMap,
  readSave,
  rollOnce,
  startNewGame,
  stampsExpected,
  targetFeatureIds,
  waitForRollOutcome,
} from "./support/app";
import { advanceLotteryFlip, advanceLotterySettle, advanceArrival, advanceMovement, advanceStamps, advanceTumble } from "./support/turnMoments";

// Spec 8.3 items covered here:
//   [8.3-2] Rolling the dice updates the current position on the map.
//   [8.3-3] Completed segments are distinguishable (legend, line style).
//   [8.3-5] Rapid clicks during a move do not advance two turns.

/** Per-hop duration of the default animation speed. */
const STEP_MS =
  ANIMATION_SPEEDS.find((speed) => speed.id === DEFAULT_ANIMATION_SPEED)?.stepMs ?? 0;

/** The arrival banner card of the turn-moment overlay (S12). */
function arrivalBanner(page: Page): Locator {
  return page.locator(".turn-moment-host .arrival-banner");
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

const START_STATION_ID = "shimbashi";

test.use({ dataset: "fixture" });

test("[8.3-2] a roll updates station, turn, progress and the map marker", async ({
  page,
  railwayBundle,
}) => {
  const stations = await loadStations(railwayBundle);
  await openTitle(page);
  await startNewGame(page);

  const start = stations.get(START_STATION_ID);
  await expect(panelStat(page, "現在駅")).toHaveText("新橋");
  await expect(panelStat(page, "踏破区間")).toHaveText(`0/${REQUIRED_SEGMENTS}`);
  await openGameLog(page);
  await expect(panelStat(page, "出目")).toHaveText("—");
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(start?.coordinates);
  await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);

  await rollOnce(page);

  const save = await readSave(page);
  if (!save) throw new Error("the roll was not saved");
  const [move] = save.movementHistory;
  if (!move) throw new Error("the roll is missing from the history");
  const arrived = stations.get(save.currentStationId);
  expect(save.turn).toBe(1);
  expect(move.toStationId).toBe(save.currentStationId);
  expect(save.currentStationId).not.toBe(START_STATION_ID);
  await expect(panelStat(page, "ターン数")).toHaveText("1");
  await openGameLog(page);
  await expect(panelStat(page, "出目")).toHaveText(`${move.rawRoll}（${move.pips}マス、${move.physicalHops}駅移動）`);
  await expect(panelStat(page, "現在駅")).toHaveText(arrived?.name ?? "?");
  await expect(panelStat(page, "踏破区間")).toHaveText(`${move.rawRoll}/${REQUIRED_SEGMENTS}`);
  // The marker on the map sits on the station the panel names, and is drawn there.
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, save));
  await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);
});

test("[8.3-3] completed segments are told apart by legend, line style and colour", async ({
  page,
  railwayBundle,
}) => {
  await openTitle(page);
  await startNewGame(page);
  await openGameMenu(page);
  const legend = gamePanel(page).getByRole("list", { name: "凡例" });
  await expect(legend.getByRole("listitem")).toHaveText([
    "山手線 踏破済み（実線）",
    "山手線 未踏破（点線）",
    "現在地",
    "現在地・乗車中の路線・山手線の進捗は常に表示します。",
  ]);
  await expect.poll(async () => (await readMap(page))?.completedFilterIds).toEqual([]);

  await rollOnce(page);
  await rollOnce(page);

  const save = await readSave(page);
  if (!save) throw new Error("no save after two rolls");
  expect(save.completedSegmentIds.length).toBeGreaterThan(0);
  await expect(panelStat(page, "踏破区間")).toHaveText(
    `${targetCompletedIds(save).length}/${REQUIRED_SEGMENTS}`,
  );
  // The solid "completed" layer is filtered to exactly the traversed segments.
  await expect
    .poll(async () => sorted((await readMap(page))?.completedFilterIds ?? []))
    .toEqual(sorted(targetFeatureIds(save, railwayBundle)));
  // What is drawn agrees: traversed segments only in the completed layer,
  // never in the pending one (both layers have visible features).
  const completed = new Set(targetFeatureIds(save, railwayBundle));
  await expect
    .poll(async () => {
      const map = await readMap(page);
      if (!map) return "no map";
      if (map.completedRenderedIds.length === 0) return "nothing drawn as completed";
      if (map.pendingRenderedIds.length === 0) return "nothing drawn as pending";
      const wrongCompleted = map.completedRenderedIds.filter((id) => !completed.has(id));
      const wrongPending = map.pendingRenderedIds.filter((id) => completed.has(id));
      return { wrongCompleted, wrongPending };
    })
    .toEqual({ wrongCompleted: [], wrongPending: [] });
  // Told apart by line style and colour: solid vs dashed, different colours.
  const map = await readMap(page);
  if (!map) throw new Error("the map disappeared");
  expect(map.completedPaint.dash).toBeNull();
  expect(map.pendingPaint.dash).not.toBeNull();
  expect(map.completedPaint.color).not.toEqual(map.pendingPaint.color);
});

/**
 * Pre-move checkpoint for a frozen clock (S11): the dice stays locked through the
 * tumble of the saved raw roll (and the stamps when the record has modifiers), a
 * forced click changes nothing, and the moment card is gone when the move starts.
 */
async function expectLockedThroughPreMove(page: Page, turn: number): Promise<void> {
  const record = (await readSave(page))?.movementHistory.at(-1);
  if (!record || record.kind !== "item-ride") throw new Error("the accepted turn has no ride record");
  await expect(diceMoment(page)).toHaveAttribute("data-raw-roll", String(record.rawRoll));
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await diceButton(page).click({ force: true });
  await advanceTumble(page);
  if (stampsExpected(record)) await advanceStamps(page);
  await expect(diceMoment(page)).toHaveCount(0);
  // P2 publishes the turn count with the arrival: until then the HUD keeps the origin turn.
  await expect(panelStat(page, "ターン数")).toHaveText(String(turn - 1));
  await expectAcceptedSave(page, turn);
}

/**
 * Movement checkpoint for a frozen clock: half a hop in, the dice is still locked
 * and a forced click neither advances the turn nor changes the stored save.
 */
async function expectLockedThroughMovement(page: Page, turn: number): Promise<void> {
  await advanceMovement(page, STEP_MS / 2);
  await expect(diceButton(page)).toHaveText("移動中…");
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await diceButton(page).click({ force: true });
  // S11 re-point: `ターン数 = turn` moved to the published checkpoint after スキップ (callers assert it there).
  await expect(panelStat(page, "ターン数")).toHaveText(String(turn - 1));
  await expectAcceptedSave(page, turn);
}

test.describe("with move animation", () => {
  // The animation must be running for "clicks during a move" to mean anything.
  test.use({ reducedMotion: "no-preference" });

  test("[8.3-5] double and triple clicks on the dice advance one turn", async ({ page }) => {
    // Fake timers: the move stays "in progress" until the test skips it, so
    // the assertions below never race the animation.
    await page.clock.install();
    await openTitle(page);
    await startNewGame(page);
    await freezeClock(page);
    const skip = gamePanel(page).getByRole("button", { name: "スキップ" });

    await diceButton(page).click({ clickCount: 3 });
    // Accepted-save checkpoint: exactly one turn is stored, however many clicks landed.
    await expectAcceptedSave(page, 1);
    await expect(diceButton(page)).toHaveText("移動中…");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(diceButton(page)).toHaveJSProperty("disabled", false);
    // P2: the turn count is published with the arrival; during the tumble the HUD keeps the origin turn.
    await expect(panelStat(page, "ターン数")).toHaveText("0");
    // The focused button stays available to keyboard users, but ignores clicks while moving.
    await diceButton(page).click({ force: true });
    await diceButton(page).dblclick({ force: true });
    await expectAcceptedSave(page, 1);
    await expectLockedThroughPreMove(page, 1);
    await expectLockedThroughMovement(page, 1);
    await skip.click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    // Published checkpoint. S11 folds three in-move `ターン数 = 1` checks into this one (same value): the one after the
    // accepted save, the one after the forced clicks, and expectLockedThroughMovement's.
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    expect((await readSave(page))?.turn).toBe(1);

    // Clicks dispatched in one task, before React can re-render the button.
    await diceButton(page).evaluate((button: HTMLElement) => {
      button.click();
      button.click();
      button.click();
    });
    await expectAcceptedSave(page, 2);
    await expect(diceButton(page)).toHaveText("移動中…");
    await expectLockedThroughPreMove(page, 2);
    await expectLockedThroughMovement(page, 2);
    await skip.click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    // Published checkpoint; S11 folds expectLockedThroughMovement's in-move `ターン数 = 2` into it (same value).
    await expect(panelStat(page, "ターン数")).toHaveText("2");
    const save = await readSave(page);
    expect(save?.turn).toBe(2);
    expect(save?.movementHistory.map((record) => record.turn)).toEqual([1, 2]);
  });

  test("[8.3-2] at normal speed the marker moves along the line and the move ends by itself", async ({
    page,
    railwayBundle,
  }) => {
    const stations = await loadStations(railwayBundle);
    await page.clock.install();
    await openTitle(page);
    await startNewGame(page);
    const start = stations.get(START_STATION_ID)?.coordinates;
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(start);
    await freezeClock(page);

    const turnBefore = await clickDice(page);
    // Pre-move checkpoint (S11): during the tumble the origin stays shown and the dice locked.
    await expect(diceMoment(page)).toBeVisible();
    await expect(panelStat(page, "現在駅")).toHaveText("新橋");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
    expect((await readMap(page))?.marker).toEqual(start);
    await advanceTumble(page);
    await waitForRollOutcome(page, turnBefore);
    await expect(diceButton(page)).toHaveText("移動中…");
    const save = await readSave(page);
    const move = save?.movementHistory[0];
    if (!save || !move) throw new Error("the roll was not committed");
    if (stampsExpected(move)) await advanceStamps(page);
    await expect(diceMoment(page)).toHaveCount(0);
    // Oracle for the movement length: replay the turn offline (P1 planner, capped
    // like the app) and make sure it is the move the app made.
    const expected = playTurn(createGame(DEFAULT_GAME_CONFIG, save.rngSeed, railwayBundle.network), railwayBundle.network);
    expect({ rawRoll: move.rawRoll, toStationId: move.toStationId })
      .toEqual({ rawRoll: expected.record.rawRoll, toStationId: expected.record.toStationId });
    const moveMs = movementDurationMs(railwayBundle, expected.events, STEP_MS);
    const end = stations.get(move.toStationId);
    await expect(panelStat(page, "現在駅")).toHaveText("新橋");

    // Half a hop in, the marker is between stations: neither start nor end.
    await advanceMovement(page, STEP_MS / 2);
    await expect
      .poll(async () => {
        const marker = (await readMap(page))?.marker;
        return marker !== undefined && marker !== null && JSON.stringify(marker) !== JSON.stringify(start);
      })
      .toBe(true);
    expect((await readMap(page))?.marker).not.toEqual(end?.coordinates);
    await expect(diceButton(page)).toHaveText("移動中…");

    // Time alone finishes the move: no スキップ, no reload. Advance exactly the
    // rest of the movement (total minus the half hop already advanced); the
    // helper's priming and trailing frames add only 32 ms of overshoot.
    await advanceMovement(page, moveMs - STEP_MS / 2);
    // Arrival checkpoint (S12): the move ended by itself and the arrival banner
    // holds the result. The arrival station is shown, the dice stays locked, and
    // the marker sits on the ridden service's platform until publication.
    // S14-S15 insert advanceLotteryFlip / advanceLotterySettle / advancePickup
    // after the arrival, each followed by its own assertion, before readiness.
    await expect(arrivalBanner(page)).toHaveText(`到着${end?.name ?? "?"}`);
    await expect(panelStat(page, "現在駅")).toHaveText(end?.name ?? "?");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
    expect(move.resolvedRide).not.toBeNull();
    await expect.poll(async () => (await readMap(page))?.marker)
      .toEqual(markerPosition(railwayBundle, { ...save, currentServiceId: move.resolvedRide!.serviceId, currentStationId: move.toStationId }));
    await advanceArrival(page);
    const landingCandidates = move.landingSnapshot?.services;
    if ((landingCandidates?.length ?? 0) > 1 || (landingCandidates?.find((candidate) => candidate.serviceId === move.landing?.serviceId)?.directions.length ?? 0) > 1) {
      await advanceLotteryFlip(page);
      await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
      await advanceLotterySettle(page);
    }
    await expect(arrivalBanner(page)).toHaveCount(0);
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(diceButton(page)).toBeEnabled();
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    await expect(panelStat(page, "現在駅")).toHaveText(end?.name ?? "?");
    await expect(panelStat(page, "踏破区間")).toHaveText(`${move.rawRoll}/${REQUIRED_SEGMENTS}`);
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, (await readSave(page))!));
    await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);
  });
});
