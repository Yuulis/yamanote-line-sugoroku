import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openClearHistory } from "./support/app";
import { DESKTOP, LANDSCAPE_PHONE, PHONE_MEDIUM, PHONE_SMALL, PHONE_SHEET_MAX_HEIGHT_RATIO, SCREENSHOT_DIR,
  clearWithOneRoll, expectNoHorizontalOverflow, expectWithinFirstScreen, expectReachable,
  expectRouteFramedBesideCard, readClearRoute } from "./clear-replay-share-support";

// Issue #69, S2: result layout and full-route presentation.
test.use({ dataset: "real" });

const SCREENSHOTS_ENABLED = Boolean(process.env.ISSUE69_S3_SCREENSHOTS) && !process.env.CI;
const SCREENSHOTS_S4_ENABLED = Boolean(process.env.ISSUE69_S4_SCREENSHOTS) && !process.env.CI;
const SCREENSHOTS_S4B_ENABLED = Boolean(process.env.ISSUE69_S4B_SCREENSHOTS) && !process.env.CI;
const CLEAR_ROUTE_LAYERS = ["clear-traveled-route-outline", "clear-traveled-route-line"] as const;

test("shows the highlights on screen after the clear, with the history behind a button on desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);

  const highlights = clear.locator(".clear-screen__highlights");
  await expect(highlights.getByRole("heading", { name: "ハイライト" })).toBeVisible();
  const row = (key: string): Locator => highlights.locator(`[data-highlight="${key}"] dd`);
  await expect(row("longest-ride")).toHaveText(/^.+ \d+駅（.+→.+）$/);
  await expect(row("most-used-line")).toHaveText(/^.+ \d+区間$/);
  await expect(row("farthest-station")).toHaveText(/^.+（新橋から \d+\.\dkm）$/);
  await expect(highlights.locator('[data-highlight="most-used-line"] dt')).toHaveText("最も使った路線（山手線以外）");
  await expect(row("used-items")).toBeVisible();
  await expect(row("avoided-items")).toBeVisible();
  await expect(highlights.getByRole("listitem")).toHaveCount(0);

  // The card carries no history list or disclosure and no log line of the clearing turn.
  await expect(clear.locator("details")).toHaveCount(0);
  await expect(clear.locator(".clear-screen__history")).toHaveCount(0);
  await expect(clear.locator(".item-event-notice__completion")).toHaveCount(0);
  await expect(clear.getByRole("status")).toHaveCount(1);
  await expect(clear.getByRole("status")).toContainText("ゴールに到着しました");
  await expect(clear.getByText("ゴールに到着しました")).toHaveCount(1);
  await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toBeVisible();
  await expectNoHorizontalOverflow(page, clear);

  const dialog = await openClearHistory(clear);
  await expect(dialog.locator(".clear-screen__history li")).toHaveCount(20);
  await expect(dialog.locator(".clear-screen__history li").first()).toContainText("1ターン目");
  await dialog.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toBeFocused();
});

test("keeps the numbers and main actions on the first phone screen, with the history behind a button", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  const clear = await clearWithOneRoll(page);

  await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "結果をコピー" }), "the share actions");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "もう一度遊ぶ" }), "もう一度遊ぶ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "タイトルへ" }), "タイトルへ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "移動履歴を見る" }), "移動履歴を見る");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: /^(軌跡を再生|全経路を表示)$/ }), "軌跡を再生");
  const sheet = await clear.evaluate((element) => ({ height: element.getBoundingClientRect().height, viewport: window.innerHeight }));
  expect(sheet.height, "the phone sheet stays within its 65% cap").toBeLessThanOrEqual(sheet.viewport * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
  const layout = await clear.evaluate((element) => {
    const sheetBox = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll<HTMLButtonElement>("button")].map((button) => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "", top: box.top, bottom: box.bottom };
    });
    const lastButtonBottom = Math.max(...buttons.map((button) => button.bottom));
    return {
      sheet: { top: sheetBox.top, bottom: sheetBox.bottom },
      buttons,
      remainingClearance: sheetBox.bottom - lastButtonBottom,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  console.log(`[S5 idle layout 320x568] ${JSON.stringify(layout)}`);

  await expect(clear.locator("details")).toHaveCount(0);
  await expect(clear.locator(".clear-screen__history")).toHaveCount(0);
  await expect(clear.getByRole("heading", { name: "ハイライト" })).toBeAttached();
  await expectNoHorizontalOverflow(page, clear);

  const dialog = await openClearHistory(clear);
  await expect(dialog.locator(".clear-screen__history li")).toHaveCount(20);
  await expectNoHorizontalOverflow(page, clear);
  await expectNoHorizontalOverflow(page, dialog);
});

test("keeps the 390px phone sheet within its cap with the actions on the first screen", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_MEDIUM);
  const clear = await clearWithOneRoll(page);
  await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "結果をコピー" }), "the share actions");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "もう一度遊ぶ" }), "もう一度遊ぶ");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: "移動履歴を見る" }), "移動履歴を見る");
  await expectWithinFirstScreen(clear, clear.getByRole("button", { name: /^(軌跡を再生|全経路を表示)$/ }), "軌跡を再生");
  const sheet = await clear.evaluate((element) => ({ height: element.getBoundingClientRect().height, viewport: window.innerHeight }));
  expect(sheet.height).toBeLessThanOrEqual(sheet.viewport * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
  await expectNoHorizontalOverflow(page, clear);
});

test("keeps every action reachable in a landscape phone", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(LANDSCAPE_PHONE);
  const clear = await clearWithOneRoll(page);
  for (const [name, label] of [
    ["結果をコピー", "結果をコピー"], ["もう一度遊ぶ", "もう一度遊ぶ"], ["タイトルへ", "タイトルへ"],
    ["移動履歴を見る", "移動履歴を見る"], [/^(軌跡を再生|全経路を表示)$/, "軌跡を再生"],
  ] as const) {
    await expectReachable(clear, clear.getByRole("button", { name }), label);
  }
  await expectNoHorizontalOverflow(page, clear);
  const dialog = await openClearHistory(clear);
  const box = await dialog.boundingBox();
  expect(box && box.y >= -1 && box.y + box.height <= LANDSCAPE_PHONE.height + 1, "the dialog fits the landscape viewport").toBe(true);
  await expectNoHorizontalOverflow(page, dialog);
});

test("does not overflow horizontally on a small phone when the clear could not be saved", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  const clear = await clearWithOneRoll(page, { failSave: true });

  await expect(clear.getByRole("alert")).toContainText("再読み込みするとこのクリアは残りません");
  await expect(clear.getByRole("status")).toHaveCount(1);
  for (const [name, label] of [
    ["結果をコピー", "結果をコピー"], ["もう一度遊ぶ", "もう一度遊ぶ"], ["タイトルへ", "タイトルへ"],
    ["移動履歴を見る", "移動履歴を見る"], [/^(軌跡を再生|全経路を表示)$/, "軌跡を再生"],
  ] as const) {
    await expectReachable(clear, clear.getByRole("button", { name }), label);
  }
  await expectNoHorizontalOverflow(page, clear);
  const dialog = await openClearHistory(clear);
  await expectNoHorizontalOverflow(page, clear);
  await expectNoHorizontalOverflow(page, dialog);
});

test("opens the phone history dialog, pages it, and keeps the page when it is reopened", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_MEDIUM);
  const clear = await clearWithOneRoll(page);
  const dialog = await openClearHistory(clear);
  const items = dialog.locator(".clear-screen__history li");
  await expect(items).toHaveCount(20);
  await expect(items.first()).toContainText("1ターン目");
  await dialog.getByRole("button", { name: "次のページ" }).click();
  await expect(items.first()).toContainText("21ターン目");
  await expect(dialog.locator(".clear-screen__page-status")).toHaveText("2 / 5ページ");
  await expect(dialog.getByRole("status")).toHaveText("2 / 5ページ");

  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();
  await expect(clear.getByRole("button", { name: "移動履歴を見る" })).toBeFocused();
  const reopened = await openClearHistory(clear);
  await expect(reopened.locator(".clear-screen__page-status")).toHaveText("2 / 5ページ");
  await expect(reopened.locator(".clear-screen__history li").first()).toContainText("21ターン目");
});

test("keeps focus inside the history modal and restores the same rows after a reload", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  const dialog = await openClearHistory(clear);
  const before = await dialog.locator(".clear-screen__history li").allTextContents();
  expect(before).toHaveLength(20);
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement)), "focus stays inside the modal").toBe(true);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
  const reopened = await openClearHistory(page.getByRole("region", { name: "クリア！" }));
  expect(await reopened.locator(".clear-screen__history li").allTextContents()).toEqual(before);
});

test("saves the review screenshots on request", async ({ page }) => {
  test.skip(!SCREENSHOTS_ENABLED, "set ISSUE69_S3_SCREENSHOTS=1 (outside CI) to write the review screenshots");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  const cards: readonly [string, { width: number; height: number }][] = [
    ["issue69-s3-desktop.png", DESKTOP],
    ["issue69-s3-phone390.png", PHONE_MEDIUM],
    ["issue69-s3-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of cards) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      await expect(clear).toBeVisible();
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
    });
  }
  const dialogs: readonly [string, { width: number; height: number }][] = [
    ["issue69-s3-dialog-desktop.png", DESKTOP],
    ["issue69-s3-dialog-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of dialogs) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      const dialog = await openClearHistory(clear);
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
      await dialog.getByRole("button", { name: "閉じる" }).click();
      await expect(dialog).toBeHidden();
    });
  }
});

test("draws the full route below the stations and frames it beside the desktop card", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await clearWithOneRoll(page);
  const reading = await expectRouteFramedBesideCard(page);

  const order = (id: string): number => reading.layerIds.indexOf(id);
  for (const id of CLEAR_ROUTE_LAYERS) expect(order(id), `${id} is on the map`).toBeGreaterThanOrEqual(0);
  expect(order(CLEAR_ROUTE_LAYERS[0])).toBeLessThan(order(CLEAR_ROUTE_LAYERS[1]));
  expect(order(CLEAR_ROUTE_LAYERS[1]), "below the station circles").toBeLessThan(order("railway-stations-circle"));
  expect(order(CLEAR_ROUTE_LAYERS[1]), "below the station names").toBeLessThan(order("railway-stations-label"));
  expect(order("railway-segments-completed"), "above the gameplay track layers").toBeLessThan(order(CLEAR_ROUTE_LAYERS[0]));
  expect(reading.mapControlsVisible, "the clear screen keeps the map controls hidden").toBe(false);
});

test("keeps the route framed when the viewport is resized while the history dialog is open", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);

  const dialog = await openClearHistory(clear);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(dialog).toBeVisible();
  await expectRouteFramedBesideCard(page);
});

test("frames the route above the 320px phone sheet", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_SMALL);
  await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);
});

test("frames the route above the 390px phone sheet", { tag: "@layout" }, async ({ page }) => {
  await page.setViewportSize(PHONE_MEDIUM);
  await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);
});

test("draws the route again after a reload when the cleared save is reopened", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);

  await page.reload();
  await page.getByRole("button", { name: /^クリア結果を見る/ }).click();
  await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
  await expectRouteFramedBesideCard(page);
});

test("removes the route and brings the gameplay map controls back when a new game starts", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);

  await clear.getByRole("button", { name: "もう一度遊ぶ" }).click();
  await expect(clear).toBeHidden();
  await expect(page.getByRole("button", { name: "全体" })).toBeVisible();
  const reading = await readClearRoute(page);
  expect(reading?.featureCount, "no route source after leaving the clear screen").toBe(0);
  for (const id of CLEAR_ROUTE_LAYERS) expect(reading?.layerIds).not.toContain(id);
  expect(reading?.layerIds, "the gameplay layers are untouched").toContain("railway-segments-completed");
});

interface NetworkLayersReading {
  /** Rendered feature counts per layer id, over the whole canvas. */
  rendered: Record<string, number>;
  /** The layout visibility of each hidden-in-clear overlay, as MapLibre reports it. */
  overlayVisibility: Record<string, string | undefined>;
}

interface E2ENetworkMap {
  queryRenderedFeatures(geometry: undefined, options: { layers: string[] }): unknown[];
  getLayoutProperty(layerId: string, name: string): string | undefined;
}

const NETWORK_BACKGROUND_LAYERS = ["railway-services", "railway-base"] as const;
const NETWORK_OVERLAY_LAYERS = [
  "railway-current-service", "railway-segments-pending-casing", "railway-segments-pending",
  "railway-segments-completed", "railway-segments-flash",
] as const;

/** Read how many features of the coloured network layers and of the route are actually drawn, plus overlay visibility. */
async function readNetworkLayers(page: Page): Promise<NetworkLayersReading | null> {
  return page.evaluate(({ background, overlays, route }) => {
    const map = (window as unknown as { __sugorokuE2E?: { map?: E2ENetworkMap | null } }).__sugorokuE2E?.map;
    if (!map) return null;
    const rendered: Record<string, number> = {};
    for (const id of [...background, ...route]) rendered[id] = map.queryRenderedFeatures(undefined, { layers: [id] }).length;
    const overlayVisibility: Record<string, string | undefined> = {};
    for (const id of overlays) overlayVisibility[id] = map.getLayoutProperty(id, "visibility");
    return { rendered, overlayVisibility };
  }, { background: [...NETWORK_BACKGROUND_LAYERS], overlays: [...NETWORK_OVERLAY_LAYERS], route: ["clear-traveled-route-line"] });
}

test("colours only the travelled route on the clear screen and brings the network back for a new game", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);

  await expect.poll(async () => (await readNetworkLayers(page))?.rendered["clear-traveled-route-line"] ?? 0, { message: "the route is drawn" })
    .toBeGreaterThan(0);
  const inClear = await readNetworkLayers(page);
  for (const id of NETWORK_BACKGROUND_LAYERS) expect(inClear?.rendered[id], `${id} draws nothing on the clear screen`).toBe(0);
  for (const id of NETWORK_OVERLAY_LAYERS) expect(inClear?.overlayVisibility[id], `${id} is hidden on the clear screen`).toBe("none");

  await clear.getByRole("button", { name: "もう一度遊ぶ" }).click();
  await expect(clear).toBeHidden();
  await expect(page.getByRole("button", { name: "全体" })).toBeVisible();
  await expect.poll(async () => (await readNetworkLayers(page))?.rendered["railway-services"] ?? 0, { message: "the network lines are drawn again" })
    .toBeGreaterThan(0);
  const afterRestart = await readNetworkLayers(page);
  for (const id of NETWORK_OVERLAY_LAYERS) expect(afterRestart?.overlayVisibility[id], `${id} is shown again`).toBe("visible");
});

test("removes the route when returning to the title", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const clear = await clearWithOneRoll(page);
  await expectRouteFramedBesideCard(page);

  await clear.getByRole("button", { name: "タイトルへ" }).click();
  await expect(clear).toBeHidden();
  const reading = await readClearRoute(page);
  expect(reading?.featureCount).toBe(0);
  for (const id of CLEAR_ROUTE_LAYERS) expect(reading?.layerIds).not.toContain(id);
});

test("saves the S4 review screenshots on request", async ({ page }) => {
  test.skip(!SCREENSHOTS_S4_ENABLED, "set ISSUE69_S4_SCREENSHOTS=1 (outside CI) to write the review screenshots");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  await clearWithOneRoll(page);
  const shots: readonly [string, { width: number; height: number }][] = [
    ["issue69-s4-desktop.png", DESKTOP],
    ["issue69-s4-phone390.png", PHONE_MEDIUM],
    ["issue69-s4-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of shots) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      const reading = await expectRouteFramedBesideCard(page);
      console.info(`${file} ${JSON.stringify({ route: reading.bounds, card: reading.card, viewport: reading.viewport })}`);
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
    });
  }
});

test("saves the S4b review screenshots on request", async ({ page }) => {
  test.skip(!SCREENSHOTS_S4B_ENABLED, "set ISSUE69_S4B_SCREENSHOTS=1 (outside CI) to write the review screenshots");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  await clearWithOneRoll(page);
  const shots: readonly [string, { width: number; height: number }][] = [
    ["issue69-s4b-desktop.png", DESKTOP],
    ["issue69-s4b-phone390.png", PHONE_MEDIUM],
    ["issue69-s4b-phone320.png", PHONE_SMALL],
  ];
  for (const [file, viewport] of shots) {
    await test.step(file, async () => {
      await page.setViewportSize(viewport);
      await expectRouteFramedBesideCard(page);
      await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
    });
  }
});
