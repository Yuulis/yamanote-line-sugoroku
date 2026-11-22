import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame, targetSegmentIds, type RailwayNetwork } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { ItemGameState } from "../../src/types/network";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { FIXTURE_GAME_SEED } from "./fixtures/seeds";
import { diceButton, diceReady, gamePanel, openTitle, panelStat, readSave, rollOnce, writeSaveText } from "./support/app";
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
const PHONE_MENU_TAB_STOPS = 12;
const TEN_SEGMENT_MILESTONE = 10;
const NEXT_PROGRESS_MILESTONE = 20;
const MILESTONE_REPLAY_MAX_TURNS = 48;
const MILESTONE_DIAGNOSTIC_LIMIT = 8;
const FLASH_ANIMATION_NAME = "target-progress-flash";

interface MilestoneReplay {
  readonly before: ItemGameState;
  readonly after: ItemGameState;
  readonly completedBefore: number;
  readonly completedAfter: number;
}

function targetCompletionCount(state: ItemGameState, required: ReadonlySet<string>): number {
  return new Set(state.completedSegmentIds.filter((id) => required.has(id))).size;
}

function replayToTenSegmentMilestone(network: RailwayNetwork): MilestoneReplay {
  const required = new Set(targetSegmentIds(ITEM_GAME_CONFIG, network));
  let state = createItemGame(ITEM_GAME_CONFIG, FIXTURE_GAME_SEED, network);
  const diagnostics: Array<Record<string, unknown>> = [];
  for (let index = 0; index < MILESTONE_REPLAY_MAX_TURNS && state.status === "playing"; index += 1) {
    const before = state;
    const result = playItemTurn(before, {}, network);
    const after = result.state.pending?.kind === "discard"
      ? resolveItemDiscard(result.state, result.state.pending.item.id).state
      : result.state;
    const completedBefore = targetCompletionCount(before, required);
    const completedAfter = targetCompletionCount(after, required);
    const predicates = {
      turn: before.turn + 1,
      completedBefore,
      completedAfter,
      pending: result.state.pending?.kind ?? null,
      rollAdjustmentInventory: before.inventory.some((item) => item.kind === "roll-adjust"),
      status: after.status,
    };
    if (completedBefore < TEN_SEGMENT_MILESTONE && completedAfter >= TEN_SEGMENT_MILESTONE
      && completedAfter < NEXT_PROGRESS_MILESTONE && result.state.pending === null
      && !predicates.rollAdjustmentInventory && after.status === "playing") {
      return { before, after, completedBefore, completedAfter };
    }
    diagnostics.push(predicates);
    state = after;
  }
  const recentDiagnostics = diagnostics.slice(-MILESTONE_DIAGNOSTIC_LIMIT);
  throw new Error(`Fixture replay found no eligible ${TEN_SEGMENT_MILESTONE}-segment crossing in ${MILESTONE_REPLAY_MAX_TURNS} turns: ${JSON.stringify({
    turn: state.turn,
    status: state.status,
    requiredSegmentCount: required.size,
    completedTargetSegments: targetCompletionCount(state, required),
    recentDiagnostics,
  })}`);
}

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

  test("breakpoint changes preserve focus in the open log and settings", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await openTitle(page);
    await page.getByRole("button", { name: "はじめから" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "新しく始めますか？" });
    if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "新しく始める" }).click();
    await expect(gamePanel(page)).toBeVisible();
    const panel = gamePanel(page);
    const log = panel.locator(".game-panel__log");
    const desktopLogTrigger = panel.locator(".game-panel__log-trigger");
    const desktopMenuTrigger = panel.locator(".game-panel__menu-trigger");
    const phoneTrigger = panel.locator(".phone-menu__trigger");
    const settings = panel.locator(".game-panel__menu");
    const firstSettingsControl = (): Locator => settings.locator(".game-panel__options button").first();

    await desktopLogTrigger.click();
    await log.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    // WebKit delivers the media-query change a frame after the resize: wait for the new layout before checking focus.
    await expect(phoneTrigger).toBeVisible();
    await expect(log).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(log).toBeHidden();
    await expect(phoneTrigger).toBeFocused();
    await expect(phoneTrigger).toBeVisible();

    await phoneTrigger.click();
    await log.focus();
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(desktopLogTrigger).toBeVisible();
    await expect(log).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(log).toBeHidden();
    await expect(desktopLogTrigger).toBeFocused();
    await expect(desktopLogTrigger).toBeVisible();

    await desktopMenuTrigger.click();
    await firstSettingsControl().focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(phoneTrigger).toBeVisible();
    await expect(firstSettingsControl()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(phoneTrigger).toBeFocused();
    await expect(phoneTrigger).toBeVisible();

    await phoneTrigger.click();
    await panel.locator(".phone-menu__sections").getByRole("button", { name: "設定", exact: true }).click();
    await firstSettingsControl().focus();
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(desktopMenuTrigger).toBeVisible();
    await expect(firstSettingsControl()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(desktopMenuTrigger).toBeFocused();
    await expect(desktopMenuTrigger).toBeVisible();
  });
});

test.describe("milestone resume lifecycle", () => {
  test.use({ dataset: "fixture", reducedMotion: "no-preference" });
  test.describe.configure({ timeout: 90_000 });

  test("milestone feedback publishes once and does not replay on resume", async ({ page, railwayBundle, baseURL }) => {
    if (!baseURL) throw new Error("baseURL must be configured");
    const replay = replayToTenSegmentMilestone(railwayBundle.network);
    const milestoneToast = (target: Page): Locator => target.locator(".toast-host__toast")
      .filter({ hasText: /区間突破|あと\d+区間！/ });
    const announcement = (target: Page): Locator => gamePanel(target)
      .locator('.visually-hidden[role="status"][aria-live="polite"]');
    const flash = (target: Page): Locator => gamePanel(target).locator(".target-progress__flash");
    const restore = async (target: Page): Promise<void> => {
      await target.goto(baseURL);
      await writeSaveText(target, serializeGame(replay.before));
      await target.reload();
      await target.getByRole("button", { name: /つづきから/ }).click();
      await expect(gamePanel(target)).toBeVisible();
      await expect(panelStat(target, "ターン数")).toHaveText(String(replay.before.turn));
    };

    console.info(`10-segment replay candidate: ${JSON.stringify({ turn: replay.before.turn + 1,
      completedBefore: replay.completedBefore, completedAfter: replay.completedAfter })}`);
    await restore(page);
    // The sentence lives only in the arrival copy (#96), so record every status text instead of polling the live one.
    await gamePanel(page).evaluate((panel) => {
      const texts: string[] = [];
      (window as unknown as { __statusTexts: string[] }).__statusTexts = texts;
      const read = (): void => {
        const text = panel.querySelector('.visually-hidden[role="status"][aria-live="polite"]')?.textContent ?? "";
        if (texts.at(-1) !== text) texts.push(text);
      };
      read();
      new MutationObserver(read).observe(panel, { subtree: true, childList: true, characterData: true });
    });
    await diceReady(page).click();
    await expect(milestoneToast(page)).toHaveCount(1);
    const milestoneSentence = (await milestoneToast(page).innerText()).trim();
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __statusTexts: string[] }).__statusTexts))
      .filter((text) => text.includes(milestoneSentence)).length).toBe(1);
    await expect(flash(page)).toBeVisible();
    // The overlay rests at opacity 0 once its one-shot animation ends, so visibility alone could pass with no flash at all;
    // the computed animation proves the glow was attached (finished CSS animations keep their computed name).
    const flashAnimation = await flash(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, durationSeconds: Number.parseFloat(style.animationDuration) };
    });
    expect(flashAnimation.name).toBe(FLASH_ANIMATION_NAME);
    expect(flashAnimation.durationSeconds).toBeGreaterThan(0);
    await expect(diceReady(page)).toBeVisible();
    // Once the turn has settled, the published result must not have repeated the sentence.
    expect((await page.evaluate(() => (window as unknown as { __statusTexts: string[] }).__statusTexts))
      .filter((text) => text.includes(milestoneSentence))).toHaveLength(1);
    expect(await readSave(page)).toEqual(replay.after);

    await page.reload();
    await page.getByRole("button", { name: /つづきから/ }).click();
    await expect(gamePanel(page)).toBeVisible();
    await expect(milestoneToast(page)).toHaveCount(0);
    await expect(announcement(page)).not.toContainText(milestoneSentence);
    await expect(flash(page)).toHaveCount(0);

    // The reduced-motion path publishes the sentence in the status region without a progress flash.
    const reducedPage = await page.context().newPage();
    await reducedPage.route(`${baseURL}data/*`, async (route) => {
      const file = new URL(route.request().url()).pathname.split("/").at(-1);
      if (!file) throw new Error("Fixture data request has no file name");
      const body = railwayBundle.payloads[file];
      if (body === undefined) throw new Error(`Unexpected fixture data request: ${file}`);
      await route.fulfill({ status: 200, contentType: "application/json", body });
    });
    await reducedPage.emulateMedia({ reducedMotion: "reduce" });
    await restore(reducedPage);
    await diceReady(reducedPage).click();
    await expect(milestoneToast(reducedPage)).toHaveCount(1);
    const reducedMilestoneSentence = (await milestoneToast(reducedPage).innerText()).trim();
    await expect(announcement(reducedPage)).toContainText(reducedMilestoneSentence);
    await expect(flash(reducedPage)).toHaveCount(0);
    await expect.poll(async () => (await readSave(reducedPage))?.turn ?? -1).toBe(replay.before.turn + 1);
    expect(await readSave(reducedPage)).toEqual(replay.after);
    await reducedPage.close();
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

  test("phone hamburger switches between log and settings", { tag: "@layout" }, async ({ page, railwayBundle }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPopulatedResult(page, populatedResultState(railwayBundle.network));
    const panel = gamePanel(page);
    const hamburger = panel.locator(".phone-menu__trigger");
    const log = panel.getByRole("region", { name: "ターンのログ", exact: true, includeHidden: true });
    const settings = panel.getByRole("region", { name: "メニュー", exact: true, includeHidden: true });
    const sectionButton = (name: string): Locator => panel.locator(".phone-menu__sections").getByRole("button", { name, exact: true });
    await expect(hamburger).toHaveCount(1);
    await expect(hamburger).toHaveText("メニュー");
    await expect(panel.locator(".game-panel__log-trigger, .game-panel__menu-trigger")).toHaveCount(0);
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await hamburger.click();
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");
    const summary = panel.locator(".phone-menu__summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("訪れた駅");
    await expect(summary).toContainText("乗った路線");
    await expect(sectionButton("ログ")).toHaveAttribute("aria-pressed", "true");
    await expect(log).toBeVisible();
    await expect(settings).toBeHidden();
    await sectionButton("設定").click();
    await expect(sectionButton("設定")).toHaveAttribute("aria-pressed", "true");
    await expect(sectionButton("ログ")).toHaveAttribute("aria-pressed", "false");
    await expect(settings).toBeVisible();
    await expect(log).toBeHidden();
    await hamburger.focus();
    const inHiddenSection: boolean[] = [];
    for (let index = 0; index < PHONE_MENU_TAB_STOPS; index += 1) {
      await page.keyboard.press("Tab");
      inHiddenSection.push(await page.evaluate(() => document.activeElement?.closest("[hidden]") !== null));
    }
    expect(inHiddenSection).not.toContain(true);
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
