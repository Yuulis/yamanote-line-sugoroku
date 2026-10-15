import { ANIMATION_SPEEDS, DEFAULT_ANIMATION_SPEED } from "../../src/features/game/gameConfig";
import { expect, test } from "./fixtures";
import {
  diceButton,
  freezeClock,
  gamePanel,
  loadStations,
  markerPosition,
  targetCompletedIds,
  openTitle,
  panelStat,
  REQUIRED_SEGMENTS,
  readMap,
  readSave,
  rollOnce,
  startNewGame,
  targetFeatureIds,
} from "./support/app";

// Spec 8.3 items covered here:
//   [8.3-2] Rolling the dice updates the current position on the map.
//   [8.3-3] Completed segments are distinguishable (legend, line style).
//   [8.3-5] Rapid clicks during a move do not advance two turns.

/** Per-hop duration of the default animation speed. */
const STEP_MS =
  ANIMATION_SPEEDS.find((speed) => speed.id === DEFAULT_ANIMATION_SPEED)?.stepMs ?? 0;
/** Extra wait for a real-time move to settle on a loaded, software-rendered page. */
const MOVE_SETTLE_TIMEOUT_MS = 7_000;

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
  await expect(panelStat(page, "出目")).toHaveText(String(move.roll));
  await expect(panelStat(page, "現在駅")).toHaveText(arrived?.name ?? "?");
  await expect(panelStat(page, "踏破区間")).toHaveText(`${move.roll}/${REQUIRED_SEGMENTS}`);
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
  const legend = gamePanel(page).getByRole("list", { name: "凡例" });
  await expect(legend.getByRole("listitem")).toHaveText([
    "山手線 踏破済み（実線）",
    "山手線 未踏破（点線）",
    "テスト南線",
    "テスト西線",
    "現在地",
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
    await expect(diceButton(page)).toHaveText("移動中…");
    await expect(diceButton(page)).toBeDisabled();
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    // More clicks on the disabled button while moving change nothing.
    await diceButton(page).click({ force: true });
    await diceButton(page).dblclick({ force: true });
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    await skip.click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    expect((await readSave(page))?.turn).toBe(1);

    // Clicks dispatched in one task, before React can re-render the button.
    await diceButton(page).evaluate((button: HTMLElement) => {
      button.click();
      button.click();
      button.click();
    });
    await expect(diceButton(page)).toHaveText("移動中…");
    await skip.click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
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

    await diceButton(page).click();
    await expect(diceButton(page)).toHaveText("移動中…");
    const move = (await readSave(page))?.movementHistory[0];
    if (!move) throw new Error("the roll was not committed");
    const end = stations.get(move.toStationId);
    await expect(panelStat(page, "現在駅")).toHaveText("新橋");

    // Half a hop in, the marker is between stations: neither start nor end.
    await page.clock.runFor(STEP_MS / 2);
    await expect
      .poll(async () => {
        const marker = (await readMap(page))?.marker;
        return marker !== undefined && marker !== null && JSON.stringify(marker) !== JSON.stringify(start);
      })
      .toBe(true);
    expect((await readMap(page))?.marker).not.toEqual(end?.coordinates);
    await expect(diceButton(page)).toHaveText("移動中…");

    // Time alone finishes the move: no スキップ, no reload. The clock runs in
    // real time from here (stepping every fake frame would re-render the map
    // in software ~170 times); the whole move takes at most 6 hops.
    await page.clock.resume();
    await expect(diceButton(page)).toHaveText("サイコロを振る", {
      timeout: move.roll * STEP_MS + MOVE_SETTLE_TIMEOUT_MS,
    });
    await expect(diceButton(page)).toBeEnabled();
    await expect(panelStat(page, "現在駅")).toHaveText(end?.name ?? "?");
    await expect(panelStat(page, "踏破区間")).toHaveText(`${move.roll}/${REQUIRED_SEGMENTS}`);
    await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, (await readSave(page))!));
    await expect.poll(async () => (await readMap(page))?.markerRendered).toBe(true);
  });
});
