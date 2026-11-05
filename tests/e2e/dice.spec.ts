import { ANIMATION_SPEEDS, DEFAULT_ANIMATION_SPEED, DEFAULT_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createGame, playTurn } from "./fixtures/productGame";
import {
  clickDice,
  diceButton,
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
  targetFeatureIds,
  waitForRollOutcome,
} from "./support/app";
import { advanceMovement } from "./support/turnMoments";

// Spec 8.3 items covered here:
//   [8.3-2] Rolling the dice updates the current position on the map.
//   [8.3-3] Completed segments are distinguishable (legend, line style).
//   [8.3-5] Rapid clicks during a move do not advance two turns.

/** Per-hop duration of the default animation speed. */
const STEP_MS =
  ANIMATION_SPEEDS.find((speed) => speed.id === DEFAULT_ANIMATION_SPEED)?.stepMs ?? 0;

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
 * Movement checkpoint for a frozen clock: half a hop in, the dice is still locked
 * and a forced click neither advances the turn nor changes the stored save.
 */
async function expectLockedThroughMovement(page: Page, turn: number): Promise<void> {
  await advanceMovement(page, STEP_MS / 2);
  await expect(diceButton(page)).toHaveText("移動中…");
  await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
  await diceButton(page).click({ force: true });
  await expect(panelStat(page, "ターン数")).toHaveText(String(turn));
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
    // S11 inserts advanceTumble / advanceStamps here; the dice stays locked through them.
    await expect(diceButton(page)).toHaveText("移動中…");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(diceButton(page)).toHaveJSProperty("disabled", false);
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    // The focused button stays available to keyboard users, but ignores clicks while moving.
    await diceButton(page).click({ force: true });
    await diceButton(page).dblclick({ force: true });
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    await expectLockedThroughMovement(page, 1);
    await skip.click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    expect((await readSave(page))?.turn).toBe(1);

    // Clicks dispatched in one task, before React can re-render the button.
    await diceButton(page).evaluate((button: HTMLElement) => {
      button.click();
      button.click();
      button.click();
    });
    await expectAcceptedSave(page, 2);
    // S11 inserts advanceTumble / advanceStamps here as well.
    await expect(diceButton(page)).toHaveText("移動中…");
    await expectLockedThroughMovement(page, 2);
    await skip.click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
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
    // S11 inserts advanceTumble here: the origin stays shown and the dice locked.
    await waitForRollOutcome(page, turnBefore);
    // S11 inserts advanceStamps here for turns with modifier wording.
    await expect(diceButton(page)).toHaveText("移動中…");
    const save = await readSave(page);
    const move = save?.movementHistory[0];
    if (!save || !move) throw new Error("the roll was not committed");
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
    // S12-S15 insert advanceArrival / advanceLotteryFlip / advanceLotterySettle /
    // advancePickup here, each followed by its own assertion, before readiness.
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(diceButton(page)).toBeEnabled();
    await expect(diceButton(page)).toHaveAttribute("aria-disabled", "false");
    await expect(panelStat(page, "現在駅")).toHaveText(end?.name ?? "?");
    await expect(panelStat(page, "踏破区間")).toHaveText(`${move.rawRoll}/${REQUIRED_SEGMENTS}`);
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, (await readSave(page))!));
    await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);
  });
});
