import { expect, test } from "./fixtures";
import { playItemTurn } from "../../src/features/game/engine";
import { ITEM_DESCRIPTIONS } from "../../src/features/game/itemPresentation";
import { itemScenario, type ItemScenario } from "./fixtures/itemScenarios";
import {
  clickDice,
  diceButton,
  expectAcceptedSave,
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
  titleScreen,
  waitForRollOutcome,
  writeSaveText,
} from "./support/app";
import { advanceMovement, NORMAL_STEP_MS } from "./support/turnMoments";

// Spec 8.3 item covered here:
//   [8.3-4] The game resumes correctly after a page reload.

const ROLLS_BEFORE_RELOAD = 2;

test.use({ dataset: "fixture" });

test("[8.3-4] reload mid-game resumes the same game and the same next roll", async ({
  page,
  railwayBundle,
}) => {
  const stations = await loadStations(railwayBundle);

  // Control run: never reloaded.
  await openTitle(page);
  await startNewGame(page);
  for (let roll = 0; roll <= ROLLS_BEFORE_RELOAD; roll += 1) await rollOnce(page);
  const control = await readSave(page);
  if (!control) throw new Error("control run was not saved");

  // Same seed again: a fresh load restarts the stubbed CSPRNG stream.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await startNewGame(page);
  expect((await readSave(page))?.rngSeed).toBe(control.rngSeed);
  for (let roll = 0; roll < ROLLS_BEFORE_RELOAD; roll += 1) await rollOnce(page);
  const beforeReload = await readSave(page);
  if (!beforeReload) throw new Error("no save before the reload");
  const station = stations.get(beforeReload.currentStationId);

  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  const resume = page.getByRole("button", {
    name: `つづきから（${ROLLS_BEFORE_RELOAD}ターン目・${station?.name}）`,
  });
  await resume.click();

  await expect(panelStat(page, "ターン数")).toHaveText(String(ROLLS_BEFORE_RELOAD));
  await expect(panelStat(page, "現在駅")).toHaveText(station?.name ?? "?");
  await expect(panelStat(page, "踏破区間")).toHaveText(
    `${targetCompletedIds(beforeReload).length}/${REQUIRED_SEGMENTS}`,
  );
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(markerPosition(railwayBundle, beforeReload));
  await expect
    .poll(async () => [...((await readMap(page))?.completedFilterIds ?? [])].sort())
    .toEqual(targetFeatureIds(beforeReload, railwayBundle).sort());

  // The next roll continues the seeded sequence exactly like the control run.
  await rollOnce(page);
  expect(await readSave(page)).toEqual(control);
});

test.describe("with move animation", () => {
  test.use({ reducedMotion: "no-preference" });

  test("[8.3-4] reload during a move resumes from the committed turn", async ({ page }) => {
    await page.clock.install();
    await openTitle(page);
    await startNewGame(page);
    await freezeClock(page);

    const turnBefore = await clickDice(page);
    // S11 inserts advanceTumble here, before the adjustment dialog or movement.
    await waitForRollOutcome(page, turnBefore);
    // S11 inserts advanceStamps here for turns with modifier wording.
    await expect(diceButton(page)).toHaveText("移動中…");
    const committed = await readSave(page);
    expect(committed?.turn).toBe(1);
    await expectAcceptedSave(page, 1);
    // Establish the movement (first frame primed, half a hop in) so the reload
    // really interrupts a running move, as the baseline did.
    await advanceMovement(page, NORMAL_STEP_MS / 2);
    await expect(diceButton(page)).toHaveText("移動中…");

    await page.reload();
    await page.getByRole("button", { name: /^つづきから（1ターン目・/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(page.locator(".toast-host__toast")).toHaveCount(0);
    expect(await readSave(page)).toEqual(committed);
  });

  test("does not replay an item pickup toast after reload and resume", async ({ page, railwayBundle }) => {
    const scenarios: ItemScenario[] = ["route", "rapid", "double", "discard", "certificate", "delay", "oversleep"];
    const candidate = scenarios.map((name) => itemScenario(name, railwayBundle.network)).find((game) =>
      playItemTurn(game, {}, railwayBundle.network).record?.itemEvents.some((event) => event.type === "pickup-retained"),
    );
    if (!candidate) throw new Error("Expected an engine-built scenario with a next-turn pickup");
    const predicted = playItemTurn(candidate, {}, railwayBundle.network).record;
    const pickup = predicted?.itemEvents.find((event) => event.type === "pickup-retained");
    if (!predicted || pickup?.type !== "pickup-retained") throw new Error("Expected the predicted engine record to include a pickup");
    const expectedText = `${ITEM_DESCRIPTIONS[pickup.item.kind].name}を手に入れた！`;

    // Pin the clock so the move is still running when スキップ is pressed.
    await page.clock.install();
    await page.goto("/");
    await writeSaveText(page, JSON.stringify(candidate));
    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    await freezeClock(page);
    await diceButton(page).click();
    await expect(diceButton(page)).toHaveText("移動中…");
    await expect.poll(async () => (await readSave(page))?.turn).toBe(candidate.turn + 1);
    const liveSave = await readSave(page);
    const liveRecord = liveSave?.movementHistory.at(-1);
    const livePickup = liveRecord?.itemEvents.find((event) => event.type === "pickup-retained");
    expect(livePickup).toMatchObject({ type: "pickup-retained", item: { kind: pickup.item.kind } });
    await gamePanel(page).getByRole("button", { name: "スキップ" }).click();
    await expect(page.locator(".toast-host__toast")).toHaveCount(1);
    await expect(page.locator(".toast-host__toast")).toHaveText(expectedText);

    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    await expect(page.locator(".toast-host__toast")).toHaveCount(0);
    await page.waitForTimeout(250);
    await expect(page.locator(".toast-host__toast")).toHaveCount(0);
  });
});
