import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { expect, test } from "./fixtures";
import { diceButton, gamePanel, openTitle, readSave, rollOnce } from "./support/app";
import { openPopulatedResult, populatedResultState } from "./support/turnResult";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const DESKTOP_BUDGET_VIEWPORTS = [
  DESKTOP_VIEWPORT,
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
] as const;
const TITLE_VIEWPORTS = [
  DESKTOP_VIEWPORT,
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
] as const;
const SAVE_MARK_VIEWPORTS = [
  DESKTOP_VIEWPORT,
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;
const HUD_PROGRESS_HEIGHT_PX = 24;
const PANEL_SCROLL_TOLERANCE_PX = 1;
const VISUALLY_HIDDEN_CLIP = "rect(0px, 0px, 0px, 0px)";
const PHONE_PROXIMITY_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 412, height: 839 },
] as const;
const PHONE_PROXIMITY_HEIGHT_PX = 34;
const PHONE_PROXIMITY_LINE_HEIGHT_PX = 17;
const DICE_POSITION_TOLERANCE_PX = 1;
test.describe("desktop HUD progress feedback", () => {
  test.use({ dataset: "real" });
  test.describe.configure({ timeout: 90_000 });
  test("desktop progress row preserves populated no-scroll budget", async ({ page, railwayBundle }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const populated = populatedResultState(railwayBundle.network);
    await openPopulatedResult(page, populated);
    const panel = gamePanel(page);
    const heading = panel.getByRole("heading", { name: "山手線すごろく" });
    const expectTitleAndSubtitleVisuallyHidden = async (): Promise<void> => {
      await expect(heading).toHaveCount(1);
      const hidden = await panel.locator(".game-panel__title, .game-panel__subtitle").evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return { display: style.display, position: style.position, width: rect.width, height: rect.height, clip: style.clip };
        }));
      const hiddenLayout = { display: "block", position: "absolute", width: 1, height: 1, clip: VISUALLY_HIDDEN_CLIP };
      expect(hidden).toEqual([hiddenLayout, hiddenLayout]);
    };
    await expectTitleAndSubtitleVisuallyHidden();
    const row = panel.locator(".hud-progress");
    const proximity = row.locator(".hud-progress__proximity");
    await expect(row).toBeVisible();
    await expect(row).toHaveCSS("height", `${HUD_PROGRESS_HEIGHT_PX}px`);
    const proximityText = (await proximity.textContent())?.trim() ?? "";
    if (proximityText.length === 0) {
      const state = await readSave(page);
      throw new Error(`R4 populated fixture has no target proximity: ${JSON.stringify({
        turn: state?.turn ?? null, stationId: state?.currentStationId ?? null,
        serviceId: state?.currentServiceId ?? null, completedSegments: state?.completedSegmentIds.length ?? null,
      })}`);
    }
    expect(proximityText).toContain("山手線まで あと");
    const presentation = createPresentationResolver(railwayBundle.network,
      railwayBundle.data.manifest.ok ? railwayBundle.data.manifest.value.uiPresentation : undefined);
    const expectedStationTotal = railwayBundle.network.stationsById.size.toLocaleString("ja-JP");
    const expectedLineTotal = presentation.lineGroups().length.toLocaleString("ja-JP");
    const stations = row.locator(".hud-progress__stations");
    const lines = row.locator(".hud-progress__lines");
    const stationText = (await stations.textContent())?.trim() ?? "";
    const lineText = (await lines.textContent())?.trim() ?? "";
    expect([stationText.split("/").at(-1), lineText.split("/").at(-1)]).toEqual([expectedStationTotal, expectedLineTotal]);
    const measurements = await panel.evaluate((root) => {
      const counters = [...root.querySelectorAll<HTMLElement>(".hud-progress__stations, .hud-progress__lines")];
      if (counters.length !== 2) throw new Error("HUD progress row counters missing from panel");
      return {
        counters: counters.map((counter) => ({ scrollWidth: counter.scrollWidth, clientWidth: counter.clientWidth })),
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
      };
    });
    for (const counter of measurements.counters) expect(counter.scrollWidth).toBeLessThanOrEqual(counter.clientWidth);
    expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.clientHeight + PANEL_SCROLL_TOLERANCE_PX);

    const scrollMeasurements: Array<{
      viewport: { width: number; height: number };
      scrollHeight: number;
      clientHeight: number;
    }> = [{ viewport: DESKTOP_VIEWPORT, scrollHeight: measurements.scrollHeight, clientHeight: measurements.clientHeight }];
    for (const viewport of DESKTOP_BUDGET_VIEWPORTS.slice(1)) {
      await page.setViewportSize(viewport);
      const dimensions = await panel.evaluate((root) => ({ scrollHeight: root.scrollHeight, clientHeight: root.clientHeight }));
      scrollMeasurements.push({ viewport, ...dimensions });
      if (viewport.width === 1366) {
        expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + PANEL_SCROLL_TOLERANCE_PX);
      }
    }
    console.info(`HUD panel scroll measurements: ${JSON.stringify(scrollMeasurements)}`);

    for (const viewport of TITLE_VIEWPORTS.slice(1)) {
      await page.setViewportSize(viewport);
      await expectTitleAndSubtitleVisuallyHidden();
    }

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
    if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "新しく始める" }).click();
    await expect(panel).toBeVisible();
    await rollOnce(page);
    const saveMark = panel.locator(".game-panel__save--inline");
    for (const viewport of SAVE_MARK_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(saveMark).toBeVisible();
      const overlaps = await panel.evaluate((root) => {
        const mark = root.querySelector<HTMLElement>(".game-panel__save--inline");
        const station = root.querySelector<HTMLElement>('[data-stat="station"]');
        if (!mark || !station) throw new Error("Saved mark or current station value is missing");
        const markRect = mark.getBoundingClientRect();
        const stationRect = station.getBoundingClientRect();
        return markRect.left < stationRect.right && stationRect.left < markRect.right
          && markRect.top < stationRect.bottom && stationRect.top < markRect.bottom;
      });
      expect(overlaps, `${viewport.width}x${viewport.height} save mark overlaps 現在駅`).toBe(false);
    }
  });
});

test.describe("phone and short-landscape HUD progress feedback", () => {
  test.use({ dataset: "real" });
  test.describe.configure({ timeout: 180_000 });

  test("phone proximity reuses the roll cell without moving dice", { tag: "@layout" }, async ({ page, railwayBundle }) => {
    const populated = populatedResultState(railwayBundle.network);
    for (const viewport of PHONE_PROXIMITY_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await openTitle(page);
      await page.getByRole("button", { name: "はじめから" }).click();
      const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
      if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "新しく始める" }).click();
      await expect(gamePanel(page)).toBeVisible();
      await expect(gamePanel(page).locator('[data-stat="proximity"]')).toHaveCount(0);
      const hiddenDice = await diceButton(page).boundingBox();
      if (!hiddenDice) throw new Error(`Dice button has no box at ${viewport.width}x${viewport.height}`);

      await openPopulatedResult(page, populated);
      const panel = gamePanel(page);
      const cell = panel.locator('[data-stat="proximity"]');
      const save = await readSave(page);
      await expect(cell, `Phone A fixture: ${JSON.stringify({ turn: save?.turn, stationId: save?.currentStationId, serviceId: save?.currentServiceId, completed: save?.completedSegmentIds.length })}`).toBeVisible();
      await expect(cell).toContainText("山手線まで あと");
      const layout = await cell.evaluate((element) => {
        const style = getComputedStyle(element);
        const lines = [...element.children].map((line) => {
          const rect = line.getBoundingClientRect();
          return { top: rect.top, height: rect.height, scrollWidth: line.scrollWidth, clientWidth: line.clientWidth };
        });
        return {
          height: element.getBoundingClientRect().height,
          gridColumn: style.gridColumn,
          gridRow: style.gridRow,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          lines,
        };
      });
      expect(layout).toMatchObject({ height: PHONE_PROXIMITY_HEIGHT_PX, gridColumn: "3 / 5", gridRow: "3" });
      expect(layout.lines).toHaveLength(2);
      expect(layout.lines.map((line) => line.height)).toEqual([PHONE_PROXIMITY_LINE_HEIGHT_PX, PHONE_PROXIMITY_LINE_HEIGHT_PX]);
      expect(layout.lines[1]!.top - layout.lines[0]!.top).toBe(PHONE_PROXIMITY_LINE_HEIGHT_PX);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      for (const line of layout.lines) expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
      const visibleDice = await diceButton(page).boundingBox();
      if (!visibleDice) throw new Error(`Visible-state dice button has no box at ${viewport.width}x${viewport.height}`);
      for (const dimension of ["x", "y", "width", "height"] as const) expect(Math.abs(visibleDice[dimension] - hiddenDice[dimension]), `${dimension} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(DICE_POSITION_TOLERANCE_PX);
      const pageWidth = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(pageWidth.scroll, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(pageWidth.client);
      console.info(`Phone A layout ${viewport.width}x${viewport.height}: ${JSON.stringify({ cell: layout, dice: visibleDice, horizontal: pageWidth })}`);
    }
  });

  test("short landscape progress stays in the current log", { tag: "@layout" }, async ({ page, railwayBundle }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openPopulatedResult(page, populatedResultState(railwayBundle.network));
    const panel = gamePanel(page);
    const statsRows = await panel.locator(".game-panel__stats").evaluate((stats) => getComputedStyle(stats).gridTemplateRows.split(" "));
    expect(statsRows).toEqual(["18px", "18px", "18px"]);
    await expect(panel.locator('[data-stat="proximity"]')).toBeHidden();

    const log = panel.locator(".game-panel__log");
    await panel.locator(".game-panel__log-trigger").click();
    await expect(log).toBeVisible();
    const progress = log.locator(":scope > .hud-progress--log");
    await expect(progress).toBeVisible();
    await expect(progress).toHaveCSS("height", `${HUD_PROGRESS_HEIGHT_PX}px`);
    await expect(progress.locator(".hud-progress__proximity")).toContainText("山手線まで あと");
    await expect(progress.locator(".hud-progress--log__stations")).toContainText("訪れた駅");
    await expect(progress.locator(".hud-progress--log__lines")).toContainText("乗った路線");
  });
});
