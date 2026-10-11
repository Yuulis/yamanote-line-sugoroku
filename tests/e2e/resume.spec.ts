import { expect, test } from "./fixtures";
import {
  diceButton,
  freezeClock,
  gamePanel,
  loadStations,
  openTitle,
  panelStat,
  REQUIRED_SEGMENTS,
  readMap,
  readSave,
  rollOnce,
  startNewGame,
  titleScreen,
} from "./support/app";

// Spec 8.3 item covered here:
//   [8.3-4] The game resumes correctly after a page reload.

const ROLLS_BEFORE_RELOAD = 2;

test("[8.3-4] reload mid-game resumes the same game and the same next roll", async ({
  page,
  request,
}) => {
  const stations = await loadStations(request);

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
    `${beforeReload.completedSegmentIds.length}/${REQUIRED_SEGMENTS}`,
  );
  await expect.poll(async () => (await readMap(page))?.marker).toEqual(station?.coordinates);
  await expect
    .poll(async () => [...((await readMap(page))?.completedFilterIds ?? [])].sort())
    .toEqual([...beforeReload.completedSegmentIds].sort());

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

    await diceButton(page).click();
    await expect(diceButton(page)).toHaveText("移動中…");
    const committed = await readSave(page);
    expect(committed?.turn).toBe(1);

    await page.reload();
    await page.getByRole("button", { name: /^つづきから（1ターン目・/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    await expect(panelStat(page, "ターン数")).toHaveText("1");
    await expect(diceButton(page)).toHaveText("サイコロを振る");
    expect(await readSave(page)).toEqual(committed);
  });
});
