import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { expect, test } from "./fixtures";
import { gamePanel, readSave } from "./support/app";
import { openPopulatedResult, populatedResultState } from "./support/turnResult";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const HUD_PROGRESS_HEIGHT_PX = 24;
const PANEL_SCROLL_TOLERANCE_PX = 1;
test.describe("desktop HUD progress feedback", () => {
  test.use({ dataset: "real" });
  test.describe.configure({ timeout: 90_000 });
  test("desktop progress row preserves populated no-scroll budget", async ({ page, railwayBundle }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const populated = populatedResultState(railwayBundle.network);
    await openPopulatedResult(page, populated);
    const panel = gamePanel(page);
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
  });
});
