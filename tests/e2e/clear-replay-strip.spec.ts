import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { openClearHistory, readMap } from "./support/app";
import {
  DESKTOP, PHONE_MEDIUM, PHONE_SMALL, SCREENSHOT_DIR, SCREENSHOTS_S5_ENABLED, SCREENSHOTS_S5B_ENABLED,
  cameraPaddingChanged, clearWithOneRoll, expectCaptionTurnFramed, expectExpandedPhoneSheet,
  expectNoHorizontalOverflow, expectPartialRouteDrawn, expectReachable, expectRouteFramedBesideCard,
  measureCollapsedBand, readClearRoute, startReplay, waitForSettledShareRow,
} from "./clear-replay-share-support";

// Issue #69 replay presentation cases. Shared clear/result setup lives in clear-replay-share-support.ts.
test.use({ dataset: "real" });
const SCREENSHOTS_S25_ENABLED = Boolean(process.env.ISSUE72_S25_SCREENSHOTS) && !process.env.CI;

async function expectAttributionOutsideStrip(page: import("@playwright/test").Page): Promise<void> {
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  const attributionText = attribution.locator(".maplibregl-ctrl-attrib-inner");
  await expect(attribution).toBeVisible();
  await expect(attributionText).toBeVisible();
  expect((await attributionText.innerText()).trim(), "the visible MapLibre attribution contains credit text").not.toBe("");
  const intersects = await page.evaluate(() => {
    const attributionElement = document.querySelector(".maplibregl-ctrl-attrib");
    const stripElement = document.querySelector(".clear-screen--replay-collapsed");
    if (!attributionElement || !stripElement) throw new Error("The map attribution and replay strip must both be present");
    const attributionRect = attributionElement.getBoundingClientRect();
    const stripRect = stripElement.getBoundingClientRect();
    return attributionRect.left < stripRect.right && attributionRect.right > stripRect.left
      && attributionRect.top < stripRect.bottom && attributionRect.bottom > stripRect.top;
  });
  expect(intersects, "the map attribution rectangle must not intersect the replay strip").toBe(false);
}

async function setRangeValue(range: import("@playwright/test").Locator, value: number): Promise<void> {
  await range.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("The native range value setter is unavailable");
    setValue.call(input, String(nextValue));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function readRoutePrefix(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __sugorokuE2E?: {
      map?: { getSource(id: string): { serialize(): { data: { features: { geometry: { coordinates: [number, number][] } }[] } } } | undefined };
    } }).__sugorokuE2E;
    const features = hook?.map?.getSource("clear-traveled-route")?.serialize().data.features ?? [];
    return features.map((feature) => feature.geometry.coordinates
      .map(([longitude, latitude]) => `${longitude},${latitude}`).join(";"))
      .join("|");
  });
}

async function readClearFitCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => (window as unknown as {
    __sugorokuE2E?: { clearFitCount?: number };
  }).__sugorokuE2E?.clearFitCount ?? 0);
}

async function expectPhoneTurnControls(page: import("@playwright/test").Page, clear: import("@playwright/test").Locator): Promise<void> {
  const range = clear.locator("input[type='range']");
  const previous = clear.getByRole("button", { name: "前のターン" });
  const next = clear.getByRole("button", { name: "次のターン" });
  await expect(range).toBeVisible();
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  await expectReachable(clear, range, "ターンのシークバー");
  await expectReachable(clear, previous, "前のターン");
  await expectReachable(clear, next, "次のターン");
  await expectNoHorizontalOverflow(page, clear);
}

test.describe("turn-synced replay", () => {
  test.use({ reducedMotion: "no-preference" });

  test("keeps the caption and partial route in the same turn, completes, and replays", async ({ page }) => {
    // Measured 24-30 s on two local workers once the strip adds explicit results steps; 30 s flaked.
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    // The route source is filled asynchronously after the clear (WebKit can lag a frame), so wait for it.
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0, { message: "the full route is drawn" })
      .toBeGreaterThan(0);
    const fullFeatureCount = (await readClearRoute(page))?.featureCount ?? 0;
    const caption = page.locator(".clear-replay-caption");
    // The route image is drawn with real frames; let it finish before the fake clock freezes them.
    await waitForSettledShareRow(clear);

    // install() starts the fake clock running from installTime; pauseAt() may only move forward, so pause a safe
    // margin later than the install time rather than at the same instant (which already lies in the past).
    const installTime = new Date("2026-11-23T00:00:00.000Z");
    const CLOCK_PAUSE_MARGIN_MS = 10_000;
    await page.clock.install({ time: installTime });
    await page.clock.pauseAt(new Date(installTime.getTime() + CLOCK_PAUSE_MARGIN_MS));
    await startReplay(clear);
    await expect(caption).toBeVisible();
    await expect(caption).toHaveAttribute("data-record-index", "0");
    await page.clock.runFor(20);
    await expectCaptionTurnFramed(page);
    await page.clock.runFor(1_100);
    await page.clock.runFor(20);
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(0);
    const advancedIndex = Number(await caption.getAttribute("data-record-index"));
    await expectCaptionTurnFramed(page);
    const cameraBeforePan = (await readClearRoute(page))?.camera;
    await page.mouse.move(120, 300);
    await page.mouse.down();
    await page.mouse.move(210, 350, { steps: 6 });
    await page.mouse.up();
    await page.clock.runFor(20);
    const cameraAfterPan = (await readClearRoute(page))?.camera;
    expect(cameraAfterPan && cameraBeforePan && (
      Math.abs(cameraAfterPan.center.lng - cameraBeforePan.center.lng) > 1e-4 ||
      Math.abs(cameraAfterPan.center.lat - cameraBeforePan.center.lat) > 1e-4 ||
      Math.abs(cameraAfterPan.zoom - cameraBeforePan.zoom) > 0.01
    ), "a user camera pan moves the replay camera").toBe(true);
    const indexAfterPan = Number(await caption.getAttribute("data-record-index"));
    await page.clock.runFor(1_100);
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(indexAfterPan);
    const cameraAfterTurn = (await readClearRoute(page))?.camera;
    expect(cameraAfterTurn && cameraAfterPan &&
      Math.abs(cameraAfterTurn.center.lng - cameraAfterPan.center.lng) < 1e-4 &&
      Math.abs(cameraAfterTurn.center.lat - cameraAfterPan.center.lat) < 1e-4 &&
      Math.abs(cameraAfterTurn.zoom - cameraAfterPan.zoom) < 0.01,
    "the manual camera position survives an automatic turn change").toBe(true);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0,
      { message: "the map source advances with the caption turn" }).toBeGreaterThan(0);

    const range = clear.locator("input[type='range']");
    const turnCount = Number(await range.getAttribute("max"));
    const seekIndex = Math.min(40, turnCount - 3);
    const prefixBeforeSeek = await readRoutePrefix(page);
    const fitsBeforeSeek = await readClearFitCount(page);
    await setRangeValue(range, seekIndex + 1);
    await page.clock.runFor(20);
    await expect(caption).toHaveAttribute("data-record-index", String(seekIndex));
    await expect.poll(async () => readRoutePrefix(page), { message: "the route prefix advances with the sought caption" })
      .not.toBe(prefixBeforeSeek);
    await expect.poll(async () => (await readClearRoute(page))?.cameraTarget?.recordIndex,
      { message: "the first explicit seek reframes to its selected turn under the manual lock" }).toBe(seekIndex);
    await expect.poll(async () => readClearFitCount(page),
      { message: "one explicit seek applies exactly one camera fit" }).toBe(fitsBeforeSeek + 1);
    const prefixAtSeek = await readRoutePrefix(page);

    const stepIndex = seekIndex - 1;
    const fitsBeforeStep = await readClearFitCount(page);
    await clear.getByRole("button", { name: "前のターン" }).click();
    await page.clock.runFor(20);
    await expect(caption).toHaveAttribute("data-record-index", String(stepIndex));
    await expect.poll(async () => readRoutePrefix(page), { message: "the previous-turn step updates the route prefix" })
      .not.toBe(prefixAtSeek);
    await expect.poll(async () => (await readClearRoute(page))?.cameraTarget?.recordIndex,
      { message: "one previous-turn step causes one explicit reframe" }).toBe(stepIndex);
    await expect.poll(async () => readClearFitCount(page),
      { message: "one previous-turn step applies exactly one camera fit" }).toBe(fitsBeforeStep + 1);
    await expect(clear.getByRole("button", { name: "一時停止" })).toBeVisible();

    const fitsBeforeAutomaticTurns = await readClearFitCount(page);
    await page.clock.runFor(1_100);
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index")),
      { message: "playback continues after seeking while playing" }).toBeGreaterThan(stepIndex);
    await expect.poll(async () => (await readClearRoute(page))?.cameraTarget?.recordIndex,
      { message: "automatic turns keep the manual camera lock after an explicit seek" }).toBe(stepIndex);
    await expect.poll(async () => readClearFitCount(page),
      { message: "automatic turn advances under the manual lock apply no camera fits" }).toBe(fitsBeforeAutomaticTurns);
    const pausedPrefixBeforeSeek = await readRoutePrefix(page);
    await clear.getByRole("button", { name: "一時停止" }).click();
    await expect(clear.getByRole("button", { name: "再開" })).toBeVisible();

    const pausedSeekIndex = Math.min(seekIndex + 10, turnCount - 2);
    const fitsBeforePausedSeek = await readClearFitCount(page);
    await setRangeValue(range, pausedSeekIndex + 1);
    await page.clock.runFor(20);
    await expect(caption).toHaveAttribute("data-record-index", String(pausedSeekIndex));
    await expect.poll(async () => readRoutePrefix(page), { message: "the paused seek updates the route prefix with its caption" })
      .not.toBe(pausedPrefixBeforeSeek);
    await expect.poll(async () => (await readClearRoute(page))?.cameraTarget?.recordIndex,
      { message: "the paused seek causes one explicit reframe under the manual lock" }).toBe(pausedSeekIndex);
    await expect.poll(async () => readClearFitCount(page),
      { message: "one paused seek applies exactly one camera fit" }).toBe(fitsBeforePausedSeek + 1);
    await page.clock.runFor(1_100);
    await expect(caption).toHaveAttribute("data-record-index", String(pausedSeekIndex));
    await expect(clear.getByRole("button", { name: "再開" })).toBeVisible();

    const fitsBeforeCompletion = await readClearFitCount(page);
    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(caption).toHaveCount(0);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
    await page.clock.runFor(20);
    await expectRouteFramedBesideCard(page);
    await expect.poll(async () => (await readClearRoute(page))?.cameraTarget?.recordIndex,
      { message: "completion supersedes the manual lock with the full-route fit" }).toBeNull();
    await expect.poll(async () => readClearFitCount(page),
      { message: "completion applies exactly one full-route camera fit" }).toBe(fitsBeforeCompletion + 1);
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await startReplay(clear);
    await expect(caption).toHaveAttribute("data-record-index", "0");
    await page.clock.runFor(20);
    await expectCaptionTurnFramed(page);
    expect(advancedIndex).toBeGreaterThan(0);
    await page.clock.runFor(1_100);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? fullFeatureCount).toBeLessThan(fullFeatureCount);
  });

  test("keeps the done-state range focused across two keyboard seeks", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    await clear.getByRole("button", { name: "全経路を表示" }).click();

    const range = clear.locator("input[type='range']");
    const turnCount = Number(await range.getAttribute("max"));
    expect(turnCount).toBeGreaterThan(2);
    await expect(range).toHaveValue(String(turnCount));
    await expect(range).toHaveAttribute("aria-valuetext", `全経路（${turnCount}ターン完了）`);
    await range.focus();
    await expect(range).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    await expect(range).toBeFocused();
    await expect(range).toHaveValue(String(turnCount - 1));
    await expect(page.locator(".clear-replay-caption")).toHaveAttribute("data-record-index", String(turnCount - 2));

    await page.keyboard.press("ArrowLeft");
    await expect(range).toBeFocused();
    await expect(range).toHaveValue(String(turnCount - 2));
    await expect(page.locator(".clear-replay-caption")).toHaveAttribute("data-record-index", String(turnCount - 3));
  });

  test("hides both gameplay marker layers while playing or paused and keeps the goal ring", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await expect.poll(async () => {
      const map = await readMap(page);
      return Boolean(map?.markerRendered && map.headingMarker?.visible);
    }).toBe(true);
    const idle = await readMap(page);
    expect(idle?.goalStationId).toBe("shimbashi");

    await startReplay(clear);
    await expect.poll(async () => {
      const map = await readMap(page);
      return map ? [map.markerRendered, map.headingMarker?.visible] : null;
    }).toEqual([false, false]);
    expect((await readMap(page))?.goalStationId).toBe(idle?.goalStationId);

    await clear.getByRole("button", { name: "一時停止" }).click();
    await expect.poll(async () => {
      const map = await readMap(page);
      return map ? [map.markerRendered, map.headingMarker?.visible] : null;
    }).toEqual([false, false]);
    expect((await readMap(page))?.goalStationId).toBe(idle?.goalStationId);

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect.poll(async () => {
      const map = await readMap(page);
      return Boolean(map?.markerRendered && map.headingMarker?.visible);
    }).toBe(true);
    expect((await readMap(page))?.goalStationId).toBe(idle?.goalStationId);
  });

  test("shows the selected speed, keeps it for this result, and fast speed advances more turns", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    const caption = page.locator(".clear-replay-caption");
    const normal = clear.getByRole("button", { name: "速度: ふつう" });
    const fast = clear.getByRole("button", { name: "速度: はやい" });
    await expect(normal).toHaveAttribute("aria-pressed", "true");
    await expect(normal).toHaveCSS("font-weight", "700");
    await expect.poll(() => normal.evaluate((button) => getComputedStyle(button, "::after").content)).toContain("✓");
    await page.waitForTimeout(1_200);
    const normalProgress = Number(await caption.getAttribute("data-record-index"));
    expect(normalProgress).toBeGreaterThan(0);

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await startReplay(clear);
    await expect(normal).toHaveAttribute("aria-pressed", "true");
    await fast.click();
    await expect(fast).toHaveAttribute("aria-pressed", "true");
    await expect(normal).toHaveAttribute("aria-pressed", "false");
    await expect(fast).toHaveCSS("font-weight", "700");
    await page.waitForTimeout(1_200);
    const fastProgress = Number(await caption.getAttribute("data-record-index"));
    expect(fastProgress, "fast mode should advance more saved turns in the same 1.2 seconds").toBeGreaterThan(normalProgress);

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await startReplay(clear);
    await expect(fast).toHaveAttribute("aria-pressed", "true");
    await clear.getByRole("button", { name: "一時停止" }).click();
    const pausedIndex = await caption.getAttribute("data-record-index");
    const pausedFeatures = (await readClearRoute(page))?.featureCount;
    await page.waitForTimeout(650);
    await expect(caption).toHaveAttribute("data-record-index", pausedIndex!);
    expect((await readClearRoute(page))?.featureCount).toBe(pausedFeatures);
  });

  test("opening the history dialog pauses replay until the user resumes", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const caption = page.locator(".clear-replay-caption");
    // The route image is drawn with real frames; let it finish before the fake clock freezes them.
    await waitForSettledShareRow(clear);
    // Replay time only moves when the test says so: two normal-speed turns (550 ms each) per step below. Each step
    // runs one frame (the replay anchors its clock on it) and then jumps, so a due frame fires once instead of
    // rendering every frame of the jump in software WebGL.
    const installTime = new Date("2026-11-23T00:00:00.000Z");
    const CLOCK_PAUSE_MARGIN_MS = 10_000;
    const TWO_TURNS_MS = 1_100;
    const ONE_FRAME_MS = 20;
    const advanceTwoTurns = async (): Promise<void> => {
      await page.clock.runFor(ONE_FRAME_MS);
      await page.clock.fastForward(TWO_TURNS_MS);
      await page.clock.runFor(ONE_FRAME_MS);
    };
    await page.clock.install({ time: installTime });
    await page.clock.pauseAt(new Date(installTime.getTime() + CLOCK_PAUSE_MARGIN_MS));
    await startReplay(clear);
    await advanceTwoTurns();
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(0);

    const dialog = await openClearHistory(clear);
    const resume = clear.getByRole("button", { name: "再開" });
    await expect(resume).toBeVisible();
    const index = await caption.getAttribute("data-record-index");
    const features = (await readClearRoute(page))?.featureCount;
    expect(features, "the partial route is drawn when the dialog opens").toBeGreaterThan(0);
    await advanceTwoTurns();
    await expect(caption).toHaveAttribute("data-record-index", index!);
    expect((await readClearRoute(page))?.featureCount, "the paused route does not grow while the dialog is open").toBe(features);
    await dialog.getByRole("button", { name: "閉じる" }).click();
    await expect(dialog).toBeHidden();
    await expect(resume, "closing the dialog leaves the replay paused").toBeVisible();

    // The same clock does advance the replay once the user resumes, so the paused check above is not vacuous.
    await resume.click();
    await advanceTwoTurns();
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(Number(index));
  });

  test("clips only the station part of the replay caption on a 320px phone", { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    const caption = page.locator(".clear-replay-caption");
    await expect(caption).toBeVisible();
    await clear.getByRole("button", { name: "一時停止" }).click();
    const station = caption.locator(".clear-replay-caption__station");
    await expect(station).toHaveCSS("white-space", "nowrap");
    await expect(station).toHaveCSS("overflow", "hidden");
    await expect(station).toHaveCSS("text-overflow", "ellipsis");
    const textGaps = await caption.evaluate((element) => {
      const roll = element.querySelector(".clear-replay-caption__roll")!.getBoundingClientRect();
      const arrow = element.querySelector(".clear-replay-caption__arrow")!.getBoundingClientRect();
      const target = element.querySelector(".clear-replay-caption__station")!.getBoundingClientRect();
      return { beforeArrow: arrow.left - roll.right, afterArrow: target.left - arrow.right };
    });
    expect(textGaps.beforeArrow, "the rendered station arrow has space after the roll").toBeGreaterThanOrEqual(3);
    expect(textGaps.afterArrow, "the rendered station arrow has space before the station").toBeGreaterThanOrEqual(3);
    const accessibleCaption = await caption.getAttribute("aria-label");
    expect(accessibleCaption).toMatch(/\s→\s/);
    expect(accessibleCaption).not.toMatch(/\d→\s*\d/);
    await station.evaluate((element) => { element.textContent = "東京国際クルーズターミナル"; });
    const clipping = await station.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      captionHeight: element.closest(".clear-replay-caption")!.getBoundingClientRect().height,
      oneLineHeight: parseFloat(getComputedStyle(element.closest(".clear-replay-caption")!).fontSize) * 1.35 + 10,
    }));
    expect(clipping.scrollWidth, "the long station name must overflow its own clipped span").toBeGreaterThan(clipping.clientWidth);
    expect(clipping.captionHeight, "the caption remains a single line").toBeLessThanOrEqual(clipping.oneLineHeight + 1);
    await expectNoHorizontalOverflow(page, clear);
    await expectReachable(clear, clear.getByRole("button", { name: "再開" }), "再開");
    await expectReachable(clear, clear.getByRole("button", { name: "全経路を表示" }), "全経路を表示");
  });

  test("collapses the phone card to replay controls and refits the partial route at 320px and 390px", { tag: "@layout" }, async ({ page }) => {
    // Measured 32-50 s on two local workers once the seek-bar reachability checks run at both widths.
    test.setTimeout(90_000);
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page);
    const caption = page.locator(".clear-replay-caption");
    const fullFeatureCount = (await readClearRoute(page))?.featureCount ?? 0;
    const expandedPadding = (await readClearRoute(page))?.padding ?? null;
    expect(expandedPadding).not.toBeNull();

    await startReplay(clear);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("button", { name: "一時停止" })).toBeFocused();
    await expect(clear.locator(".clear-screen__content").first()).toBeHidden();
    await expect(clear.getByRole("heading", { name: "クリア！" })).toHaveCount(0);
    await expect(clear.getByRole("button", { name: "結果をコピー" })).toHaveCount(0);
    await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toHaveCount(0);
    await expectPhoneTurnControls(page, clear);
    await expect(caption).toBeVisible();
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(0);
    await expectPartialRouteDrawn(page, "320px playback");
    await expect.poll(async () => cameraPaddingChanged(expandedPadding, (await readClearRoute(page))?.padding ?? null),
      { message: "the camera padding changes when the card collapses" }).toBe(true);
    await expectCaptionTurnFramed(page);
    const smallBand = await measureCollapsedBand(clear);
    expect(smallBand.height, "the replay band stays low").toBeLessThanOrEqual(130);
    expect(smallBand.bottomGap, "the replay band stays bottom-anchored").toBeLessThanOrEqual(9);
    expect(smallBand.controlRows, "replay controls fit within two rows").toBeLessThanOrEqual(2);
    expect(smallBand.controlsInside, "all replay controls meet the target size inside the band").toBe(true);
    console.log(`S5b 320x568 band=${smallBand.height.toFixed(1)}px map=${smallBand.openMapWidth.toFixed(1)}x${smallBand.openMapHeight.toFixed(1)}px`);

    await clear.getByRole("button", { name: "一時停止" }).click();
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    const pausedIndex = await caption.getAttribute("data-record-index");
    await page.waitForTimeout(600);
    await expect(caption).toHaveAttribute("data-record-index", pausedIndex!);
    await expectPartialRouteDrawn(page, "320px paused playback");
    await expectCaptionTurnFramed(page);
    const pausedBand = await measureCollapsedBand(clear);
    expect(pausedBand.controlsInside).toBe(true);

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(caption).toHaveCount(0);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
    await expectRouteFramedBesideCard(page);
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await expectExpandedPhoneSheet(clear, PHONE_SMALL.height);

    await page.setViewportSize(PHONE_MEDIUM);
    await startReplay(clear);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expectPhoneTurnControls(page, clear);
    await expectPartialRouteDrawn(page, "390px playback");
    await expectCaptionTurnFramed(page);
    const mediumBand = await measureCollapsedBand(clear);
    expect(mediumBand.height).toBeLessThanOrEqual(130);
    expect(mediumBand.bottomGap).toBeLessThanOrEqual(9);
    expect(mediumBand.controlRows).toBeLessThanOrEqual(2);
    expect(mediumBand.controlsInside).toBe(true);
    console.log(`S5b 390x844 band=${mediumBand.height.toFixed(1)}px map=${mediumBand.openMapWidth.toFixed(1)}x${mediumBand.openMapHeight.toFixed(1)}px`);
    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expectRouteFramedBesideCard(page);
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await expectExpandedPhoneSheet(clear, PHONE_MEDIUM.height);
    await expectRouteFramedBesideCard(page);
  });

  test("keeps the phone strip after natural replay end until results are shown", { tag: "@layout" }, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await clear.getByRole("button", { name: "速度: はやい" }).click();
    await expect(clear.getByRole("button", { name: "結果を表示" })).toBeVisible({ timeout: 40_000 });
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expectRouteFramedBesideCard(page);
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await expectExpandedPhoneSheet(clear, PHONE_SMALL.height);
    await expectRouteFramedBesideCard(page);
  });

  test("keeps phone replay speed across finish and an explicit-result restart", { tag: "@layout" }, async ({ page }) => {
    // Measured 24-30 s on two local workers once the strip adds explicit results steps; 30 s flaked.
    test.setTimeout(60_000);
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    const fast = clear.getByRole("button", { name: "速度: はやい" });
    await fast.click();
    await expect(fast).toHaveAttribute("aria-pressed", "true");

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("button", { name: "結果を表示" })).toBeVisible();
    await expectRouteFramedBesideCard(page);
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await expectExpandedPhoneSheet(clear, PHONE_MEDIUM.height);
    await startReplay(clear);
    await expect(fast).toHaveAttribute("aria-pressed", "true");
    await clear.getByRole("button", { name: "一時停止" }).click();
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("button", { name: "結果を表示" })).toBeVisible();
  });

  test("uses a bottom strip on desktop and expands results explicitly", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);

    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("heading", { name: "クリア！" })).toHaveCount(0);
    await expect(clear.getByRole("button", { name: "結果をコピー" })).toHaveCount(0);
    await expect(clear.getByRole("button", { name: "一時停止" })).toBeVisible();
    const history = clear.getByRole("button", { name: "移動履歴を見る" });
    await expect(history).toBeVisible();
    await expectReachable(clear, history, "desktop strip history trigger");
    await expectAttributionOutsideStrip(page);
    if (SCREENSHOTS_S25_ENABLED) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(SCREENSHOT_DIR, "issue72-s25-strip-desktop.png") });
    }
    const strip = await clear.evaluate((element) => ({
      bottomGap: innerHeight - element.getBoundingClientRect().bottom,
      top: element.getBoundingClientRect().top,
      viewportHeight: innerHeight,
    }));
    expect(strip.bottomGap).toBeLessThanOrEqual(13);
    expect(strip.top).toBeGreaterThan(strip.viewportHeight / 2);
    await expectCaptionTurnFramed(page);

    await clear.getByRole("button", { name: "一時停止" }).click();
    await expect(clear.getByRole("button", { name: "結果を表示" })).toBeVisible();
    await expectAttributionOutsideStrip(page);
    if (SCREENSHOTS_S25_ENABLED) {
      await page.screenshot({ path: join(SCREENSHOT_DIR, "issue72-s25-paused-desktop.png") });
    }
    await clear.getByRole("button", { name: "結果を表示" }).click();
    await expect(clear).not.toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("heading", { name: "クリア！" })).toBeVisible();
    await expect(clear.getByRole("button", { name: "結果をコピー" })).toBeVisible();
    await expect(clear.getByRole("button", { name: "軌跡を再生" })).toBeFocused();
    const centered = await clear.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - innerWidth / 2) <= 1
        && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) <= 1;
    });
    expect(centered).toBe(true);
  });

  test("moves focus from the desktop history trigger to replay controls when a closed-dialog layout shrinks", { tag: "@layout" }, async ({ page }) => {
    // Measured 24-30 s on two local workers once the strip adds explicit results steps; 30 s flaked.
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    const history = clear.getByRole("button", { name: "移動履歴を見る" });
    await history.focus();
    await expect(history).toBeFocused();
    await expect(clear.getByRole("dialog", { name: "移動履歴" })).toHaveCount(0);

    await page.setViewportSize(PHONE_MEDIUM);
    await expect(clear.getByRole("button", { name: "一時停止" })).toBeFocused();
    await expect(clear.getByRole("dialog", { name: "移動履歴" })).toHaveCount(0);
  });

  test("keeps the history dialog open across resize with the strip behind it", { tag: "@layout" }, async ({ page }) => {
    // Measured 24-30 s on two local workers once the strip adds explicit results steps; 30 s flaked.
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    const dialog = clear.getByRole("dialog", { name: "移動履歴" });
    await clear.getByRole("button", { name: "移動履歴を見る" }).click();
    await expect(dialog).toBeVisible();
    await expect(clear.getByRole("button", { name: "再開" })).toBeVisible();

    await page.setViewportSize(PHONE_MEDIUM);
    await expect(dialog).toBeVisible();
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await dialog.getByRole("button", { name: "閉じる" }).click();
    await expect(dialog).toBeHidden();
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("button", { name: "再開" })).toBeFocused();
  });

  test("saves S5b phone replay screenshots on request", async ({ page }) => {
    test.skip(!SCREENSHOTS_S5B_ENABLED, "set ISSUE69_S5B_SCREENSHOTS=1 (outside CI) to write the S5b review screenshots");
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await page.waitForTimeout(650);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5b-replay-phone390.png") });

    await page.setViewportSize(PHONE_SMALL);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5b-replay-phone320.png") });
    await clear.getByRole("button", { name: "一時停止" }).click();
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5b-paused-phone320.png") });
  });

  test("saves S5 replay and dialog screenshots on request", async ({ page }) => {
    test.skip(!SCREENSHOTS_S5_ENABLED, "set ISSUE69_S5_SCREENSHOTS=1 (outside CI) to write the review screenshots");
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const caption = page.locator(".clear-replay-caption");

    await startReplay(clear);
    await expect(caption).toBeVisible();
    await page.waitForTimeout(650);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-replay-desktop.png") });
    const desktopDialog = await openClearHistory(clear);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-dialog-desktop.png") });
    await desktopDialog.getByRole("button", { name: "閉じる" }).click();

    await page.setViewportSize(PHONE_MEDIUM);
    await clear.getByRole("button", { name: "再開" }).click();
    await page.waitForTimeout(650);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-replay-phone390.png") });

    await page.setViewportSize(PHONE_SMALL);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-replay-phone320.png") });
    await clear.getByRole("button", { name: "一時停止" }).click();
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-paused-phone320.png") });
    await clear.getByRole("button", { name: "結果を表示" }).click();
    const phoneDialog = await openClearHistory(clear);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-dialog-phone320.png") });
    await phoneDialog.getByRole("button", { name: "閉じる" }).click();
  });
});

test.describe("reduced-motion replay", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows the full route immediately with the results card expanded", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const fullFeatureCount = (await readClearRoute(page))?.featureCount ?? 0;
    await expect(clear.getByRole("button", { name: "全経路を表示" })).toBeVisible();
    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(page.locator(".clear-replay-caption")).toHaveCount(0);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
    await expect(clear).not.toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("heading", { name: "クリア！" })).toBeVisible();
  });
});

/**
 * Literal history rows for the pinned one-roll clear. These pin the formatted roll, move, line and note texts
 * independently of production formatting (the helper in support/clearHistory.ts checks only shape and kind).
 */
