import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { expect, test } from "./fixtures";
import { gamePanel, openTitle, readSave, rollOnce } from "./support/app";
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
