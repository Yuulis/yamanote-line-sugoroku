import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openClearHistory, openTitle, panelStat, readMap, revealUnadjustedRoll, rollOnce, writeSaveText } from "./support/app";
import { PRODUCT_HISTORY_CLEAR_ROUTE_LEGS, PRODUCT_HISTORY_SCENARIO_TURNS } from "./fixtures/seeds";
import { readShareLog, stubShareApis, type ShareLogEntry } from "./support/shareStubs";

// Issue #69, S2: the published clear result on screen. The pinned save is one roll before the clear.
test.use({ dataset: "real" });

const PINNED_SAVE = readFileSync(new URL("./fixtures/tokyo-suburban-before-clear-save.json", import.meta.url), "utf8").trimEnd();
const PHONE_SMALL = { width: 320, height: 568 } as const;
const PHONE_MEDIUM = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 800 } as const;
/** Review screenshots are produced on request only (never in CI). */
const SCREENSHOT_DIR = ".claude/logs/screenshots";
const SCREENSHOTS_ENABLED = Boolean(process.env.ISSUE69_S3_SCREENSHOTS) && !process.env.CI;
/** Phone sheet cap (Revision 4): the first screen of the sheet must hold the numbers and the main actions. */
const PHONE_SHEET_MAX_HEIGHT_RATIO = 0.65;
const LANDSCAPE_PHONE = { width: 667, height: 375 } as const;
const SCREENSHOTS_S4_ENABLED = Boolean(process.env.ISSUE69_S4_SCREENSHOTS) && !process.env.CI;
const SCREENSHOTS_S4B_ENABLED = Boolean(process.env.ISSUE69_S4B_SCREENSHOTS) && !process.env.CI;
const SCREENSHOTS_S5_ENABLED = Boolean(process.env.ISSUE69_S5_SCREENSHOTS) && !process.env.CI;
const SCREENSHOTS_S5B_ENABLED = Boolean(process.env.ISSUE69_S5B_SCREENSHOTS) && !process.env.CI;
const CLEAR_ROUTE_LAYERS = ["clear-traveled-route-outline", "clear-traveled-route-line"] as const;
/** The route must fill at least this share of the open area along its limiting axis, so "somewhere small" fails. */
const MIN_ROUTE_FILL_RATIO = 0.4;
const FRAMING_TOLERANCE_PX = 1;

interface RouteImageEncodingWindow extends Window {
  __routeImageEncodeReleases?: Array<() => void>;
  __releaseRouteImageEncoding?: () => void;
}

async function failSaveWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const storage = Storage.prototype;
    const original = storage.setItem;
    storage.setItem = function (key: string, value: string): void {
      if (key.includes("save") && (JSON.parse(value) as { status?: unknown }).status === "completed") {
        throw new Error("quota");
      }
      original.call(this, key, value);
    };
  });
}

/** Resume the pinned save and clear with its one remaining roll. */
async function clearWithOneRoll(page: Page, options: { failSave?: boolean } = {}): Promise<Locator> {
  await openTitle(page);
  await writeSaveText(page, PINNED_SAVE);
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(panelStat(page, "ターン数")).toHaveText(String(PRODUCT_HISTORY_SCENARIO_TURNS.completed - 1));
  if (options.failSave) {
    await failSaveWrites(page);
    await revealUnadjustedRoll(page);
  } else {
    await rollOnce(page);
  }
  const clear = page.getByRole("region", { name: "クリア！" });
  await expect(clear).toBeVisible();
  await expect(clear.getByRole("heading", { name: "クリア！" })).toBeFocused();
  return clear;
}

/** Starts the replay after the route-image controls leave their pending state. */
async function startReplay(clear: Locator): Promise<void> {
  await waitForSettledShareRow(clear);
  await clear.getByRole("button", { name: "軌跡を再生" }).click();
}

/** The row is settled as soon as its pending controls are in place; it no longer has to wait for PNG encoding. */
async function waitForSettledShareRow(clear: Locator): Promise<void> {
  const note = clear.locator("#clear-image-pending-note");
  const shareButton = clear.getByRole("button", { name: "Xでシェア" });
  const saveButton = clear.getByRole("button", { name: "画像を保存" });
  await expect.poll(async () => {
    if (await note.isVisible()) {
      if (await shareButton.count() !== 1 || await saveButton.count() !== 1) return false;
      return await shareButton.isDisabled() && await saveButton.isDisabled();
    }
    const shareCount = await shareButton.count();
    const saveCount = await saveButton.count();
    if (shareCount === 0 && saveCount === 0) return true;
    if (shareCount !== 1 || saveCount !== 1) return false;
    return await shareButton.isEnabled() && await saveButton.isEnabled();
  }, { message: "the image action row has a stable pending or settled layout", timeout: IMAGE_READY_TIMEOUT_MS }).toBe(true);
}

/** Self-contained: hold the export canvas encoding so an E2E can measure the visible pending state. */
function holdRouteImageEncoding(): void {
  const windowWithHold = window as RouteImageEncodingWindow;
  const releases: Array<() => void> = [];
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  windowWithHold.__routeImageEncodeReleases = releases;
  windowWithHold.__releaseRouteImageEncoding = () => releases.shift()?.();
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality): void {
    const canvas = this;
    releases.push(() => originalToBlob.call(canvas, callback, type, quality));
  };
}

async function measurePhoneSheet(clear: Locator, buttonNames: readonly string[]): Promise<{
  readonly sheet: { readonly height: number; readonly width: number };
  readonly scrollTop: number;
  readonly targets: Record<string, { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }>;
}> {
  return clear.evaluate((element, names) => {
    const sheet = element.getBoundingClientRect();
    const round = (value: number): number => Math.round(value * 10) / 10;
    const rect = (target: Element): { top: number; bottom: number; left: number; right: number } => {
      const box = target.getBoundingClientRect();
      return {
        top: round(box.top - sheet.top),
        bottom: round(box.bottom - sheet.top),
        left: round(box.left - sheet.left),
        right: round(box.right - sheet.left),
      };
    };
    const targets: Record<string, { top: number; bottom: number; left: number; right: number }> = {};
    const stats = element.querySelector(".clear-screen__stats");
    if (!stats) throw new Error("The clear result numbers are missing");
    targets["三つの数値"] = rect(stats);
    const buttons = [...element.querySelectorAll<HTMLButtonElement>("button")];
    for (const name of names) {
      const button = buttons.find((candidate) => candidate.textContent?.trim() === name);
      if (!button) throw new Error(`The ${name} button is missing`);
      targets[name] = rect(button);
    }
    return {
      sheet: { height: round(sheet.height), width: round(sheet.width) },
      scrollTop: element.scrollTop,
      targets,
    };
  }, [...buttonNames]);
}

async function expectNoHorizontalOverflow(page: Page, clear: Locator): Promise<void> {
  const card = await clear.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(card.scroll, "the clear card must not scroll horizontally").toBeLessThanOrEqual(card.client);
  const document = await page.evaluate(() => ({
    client: window.document.documentElement.clientWidth,
    scroll: window.document.documentElement.scrollWidth,
  }));
  expect(document.scroll, "the page must not scroll horizontally").toBeLessThanOrEqual(document.client);
}

/** True when the element sits fully inside the card's first (unscrolled) screen. */
async function expectWithinFirstScreen(clear: Locator, target: Locator, name: string): Promise<void> {
  const fits = await target.evaluate((element, cardElement) => {
    const card = cardElement as HTMLElement;
    const cardBox = card.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return card.scrollTop === 0 && box.height > 0 && box.top >= cardBox.top && box.bottom <= cardBox.bottom;
  }, await clear.elementHandle());
  expect(fits, `${name} must be visible without scrolling the card`).toBe(true);
}

/** After scrolling it into view, the control sits inside both the card's scrollport and the viewport (1px tolerance). */
async function expectReachable(clear: Locator, target: Locator, name: string): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const reachable = await target.evaluate((element, cardElement) => {
    const tolerance = 1;
    const box = element.getBoundingClientRect();
    const card = (cardElement as HTMLElement).getBoundingClientRect();
    return box.height > 0
      && box.top >= Math.max(card.top, 0) - tolerance && box.bottom <= Math.min(card.bottom, window.innerHeight) + tolerance
      && box.left >= 0 - tolerance && box.right <= window.innerWidth + tolerance;
  }, await clear.elementHandle());
  expect(reachable, `${name} must be reachable by scrolling the card`).toBe(true);
}

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

interface Box { left: number; top: number; right: number; bottom: number }

interface ClearRouteReading {
  featureCount: number;
  /** Layer ids in style order. */
  layerIds: string[];
  /** Pixel bounds of every projected route vertex, in map-container (= viewport) coordinates. */
  bounds: Box | null;
  viewport: { width: number; height: number };
  card: Box | null;
  padding: { top: number; right: number; bottom: number; left: number } | null;
  mapControlsVisible: boolean;
}

interface E2EMapHook {
  map?: E2ERouteMap | null;
  clearFitPadding?: ClearRouteReading["padding"];
}

interface E2ERouteMap {
  getSource(id: string): { serialize(): { data: { features: { geometry: { coordinates: [number, number][] } }[] } } } | undefined;
  getStyle(): { layers: { id: string }[] };
  project(lngLat: [number, number]): { x: number; y: number };
}

/** Read the live map through the e2e-build hook: the route source, its layer order and where its vertices are drawn. */
async function readClearRoute(page: Page): Promise<ClearRouteReading | null> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __sugorokuE2E?: E2EMapHook }).__sugorokuE2E;
    const map = hook?.map;
    if (!map) return null;
    const features = map.getSource("clear-traveled-route")?.serialize().data.features ?? [];
    let bounds: Box | null = null;
    for (const feature of features) {
      for (const coordinate of feature.geometry.coordinates) {
        const { x, y } = map.project(coordinate);
        bounds = bounds === null
          ? { left: x, top: y, right: x, bottom: y }
          : { left: Math.min(bounds.left, x), top: Math.min(bounds.top, y), right: Math.max(bounds.right, x), bottom: Math.max(bounds.bottom, y) };
      }
    }
    const cardRect = document.querySelector(".clear-screen")?.getBoundingClientRect();
    return {
      featureCount: features.length,
      layerIds: map.getStyle().layers.map((layer) => layer.id),
      bounds,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      card: cardRect ? { left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom } : null,
      padding: hook.clearFitPadding ?? null,
      mapControlsVisible: document.querySelector(".map-overview") !== null,
    };
  });
}

function cameraPaddingChanged(
  before: ClearRouteReading["padding"] | null,
  after: ClearRouteReading["padding"] | null,
): boolean {
  if (!before || !after) return false;
  return (["top", "right", "bottom", "left"] as const)
    .some((edge) => Math.abs(before[edge] - after[edge]) > 0.5);
}

/** The largest map region the card leaves open: above, below, left or right of it. */
function openRegion(card: Box, viewport: { width: number; height: number }): Box {
  const regions: Box[] = [
    { left: 0, top: 0, right: viewport.width, bottom: Math.max(0, card.top) },
    { left: 0, top: Math.min(viewport.height, card.bottom), right: viewport.width, bottom: viewport.height },
    { left: 0, top: 0, right: Math.max(0, card.left), bottom: viewport.height },
    { left: Math.min(viewport.width, card.right), top: 0, right: viewport.width, bottom: viewport.height },
  ];
  const area = (box: Box): number => (box.right - box.left) * (box.bottom - box.top);
  return regions.reduce((best, region) => area(region) > area(best) ? region : best);
}

/** Empty when the whole route is drawn inside the area the card leaves open and fills it; else what is wrong. */
function framingProblem(reading: ClearRouteReading | null): string {
  if (!reading?.bounds || !reading.card) return "route or card not available yet";
  const { bounds, card, viewport } = reading;
  const region = openRegion(card, viewport);
  const t = FRAMING_TOLERANCE_PX;
  if (bounds.left < region.left - t || bounds.top < region.top - t || bounds.right > region.right + t || bounds.bottom > region.bottom + t) {
    return `route ${JSON.stringify(bounds)} is outside the open area ${JSON.stringify(region)}`;
  }
  const fill = Math.max((bounds.right - bounds.left) / (region.right - region.left), (bounds.bottom - bounds.top) / (region.bottom - region.top));
  return fill >= MIN_ROUTE_FILL_RATIO ? "" : `route fills only ${fill.toFixed(2)} of the open area ${JSON.stringify(region)}`;
}

/** Empty when a partial replay route stays in the open map region, without requiring the full route bounds. */
function routeOutsideOpenRegion(reading: ClearRouteReading | null): string {
  if (!reading?.bounds || !reading.card) return "route or card not available yet";
  const { bounds, card, viewport } = reading;
  const region = openRegion(card, viewport);
  const tolerance = FRAMING_TOLERANCE_PX;
  if (bounds.left < region.left - tolerance || bounds.top < region.top - tolerance
    || bounds.right > region.right + tolerance || bounds.bottom > region.bottom + tolerance) {
    return `route ${JSON.stringify(bounds)} is outside the open area ${JSON.stringify(region)}`;
  }
  return "";
}

async function expectRouteFramedBesideCard(page: Page): Promise<ClearRouteReading> {
  await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0, { message: "the route source carries one feature per leg" })
    .toBe(PRODUCT_HISTORY_CLEAR_ROUTE_LEGS);
  await expect.poll(async () => framingProblem(await readClearRoute(page)), { message: "the route is framed in the open map area" }).toBe("");
  const reading = await readClearRoute(page);
  if (!reading) throw new Error("the e2e map hook is not available");
  return reading;
}

async function expectPartialRouteInsideOpenMap(page: Page): Promise<void> {
  await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0,
    { message: "the partial replay route is still drawn" }).toBeGreaterThan(0);
  await expect.poll(async () => routeOutsideOpenRegion(await readClearRoute(page)),
    { message: "the partial route remains inside the uncovered map area after refit" }).toBe("");
}

async function expectExpandedPhoneSheet(clear: Locator, viewportHeight: number): Promise<void> {
  await expect(clear).not.toHaveClass(/clear-screen--replay-collapsed/);
  await expect(clear.locator(".clear-screen__content").first()).toBeVisible();
  await expect(clear.getByRole("button", { name: "軌跡を再生" })).toBeFocused();
  const sheet = await clear.evaluate((element) => ({
    scrollTop: (element as HTMLElement).scrollTop,
    maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
    bottomGap: window.innerHeight - element.getBoundingClientRect().bottom,
  }));
  expect(sheet.scrollTop).toBe(0);
  expect(sheet.maxHeight).toBeLessThanOrEqual(viewportHeight * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
  expect(sheet.bottomGap).toBeLessThanOrEqual(9);
  await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three result numbers");
  for (const button of await clear.locator(".clear-screen__share button, .clear-screen__actions button, .clear-screen__history-button").all()) {
    await expectWithinFirstScreen(clear, button, (await button.textContent())?.trim() ?? "clear action");
  }
}

async function measureCollapsedBand(clear: Locator): Promise<{
  readonly height: number;
  readonly bottomGap: number;
  readonly controlRows: number;
  readonly controlsInside: boolean;
  readonly openMapWidth: number;
  readonly openMapHeight: number;
}> {
  return clear.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll<HTMLElement>(".clear-replay-controls__active button")]
      .map((button) => button.getBoundingClientRect());
    const rowTops = new Set(controls.map((rect) => Math.round(rect.top)));
    const regions = [
      { left: 0, top: 0, right: innerWidth, bottom: Math.max(0, card.top) },
      { left: 0, top: Math.min(innerHeight, card.bottom), right: innerWidth, bottom: innerHeight },
      { left: 0, top: 0, right: Math.max(0, card.left), bottom: innerHeight },
      { left: Math.min(innerWidth, card.right), top: 0, right: innerWidth, bottom: innerHeight },
    ];
    const area = (region: typeof regions[number]): number => (region.right - region.left) * (region.bottom - region.top);
    const open = regions.reduce((best, region) => area(region) > area(best) ? region : best);
    return {
      height: card.height,
      bottomGap: innerHeight - card.bottom,
      controlRows: rowTops.size,
      controlsInside: controls.every((rect) => rect.height >= 44 && rect.width >= 44
        && rect.left >= card.left && rect.right <= card.right && rect.top >= card.top && rect.bottom <= card.bottom),
      openMapWidth: open.right - open.left,
      openMapHeight: open.bottom - open.top,
    };
  });
}

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

test.describe("turn-synced replay", () => {
  test.use({ reducedMotion: "no-preference" });

  test("keeps the caption and partial route in the same turn, completes, and replays", async ({ page }) => {
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
    await page.clock.runFor(1_100);
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(0);
    const advancedIndex = Number(await caption.getAttribute("data-record-index"));
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0,
      { message: "the map source advances with the caption turn" }).toBeGreaterThan(0);

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(caption).toHaveCount(0);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
    await startReplay(clear);
    await expect(caption).toHaveAttribute("data-record-index", "0");
    expect(advancedIndex).toBeGreaterThan(0);
    await page.clock.runFor(1_100);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? fullFeatureCount).toBeLessThan(fullFeatureCount);
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
    await expect(caption).toBeVisible();
    await expect.poll(async () => Number(await caption.getAttribute("data-record-index"))).toBeGreaterThan(0);
    await expect.poll(async () => cameraPaddingChanged(expandedPadding, (await readClearRoute(page))?.padding ?? null),
      { message: "the camera padding changes when the card collapses" }).toBe(true);
    await expectPartialRouteInsideOpenMap(page);
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
    await expectPartialRouteInsideOpenMap(page);
    const pausedBand = await measureCollapsedBand(clear);
    expect(pausedBand.controlsInside).toBe(true);

    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(caption).toHaveCount(0);
    await expectExpandedPhoneSheet(clear, PHONE_SMALL.height);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
    await expectRouteFramedBesideCard(page);

    await page.setViewportSize(PHONE_MEDIUM);
    await startReplay(clear);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await expectPartialRouteInsideOpenMap(page);
    const mediumBand = await measureCollapsedBand(clear);
    expect(mediumBand.height).toBeLessThanOrEqual(130);
    expect(mediumBand.bottomGap).toBeLessThanOrEqual(9);
    expect(mediumBand.controlRows).toBeLessThanOrEqual(2);
    expect(mediumBand.controlsInside).toBe(true);
    console.log(`S5b 390x844 band=${mediumBand.height.toFixed(1)}px map=${mediumBand.openMapWidth.toFixed(1)}x${mediumBand.openMapHeight.toFixed(1)}px`);
    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expectExpandedPhoneSheet(clear, PHONE_MEDIUM.height);
    await expectRouteFramedBesideCard(page);
  });

  test("restores the phone sheet when replay ends naturally", { tag: "@layout" }, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    await expect(clear).toHaveClass(/clear-screen--replay-collapsed/);
    await clear.getByRole("button", { name: "速度: はやい" }).click();
    await expect(clear.getByRole("button", { name: "軌跡を再生" })).toBeVisible({ timeout: 40_000 });
    await expectExpandedPhoneSheet(clear, PHONE_SMALL.height);
    await expectRouteFramedBesideCard(page);
  });

  test("leaves the desktop clear card expanded during replay", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const maxHeightBeforeReplay = await clear.evaluate((element) => getComputedStyle(element).maxHeight);
    await startReplay(clear);

    await expect(clear).not.toHaveClass(/clear-screen--replay-collapsed/);
    await expect(clear.getByRole("heading", { name: "クリア！" })).toBeVisible();
    await expect(clear.getByRole("button", { name: "結果をコピー" })).toBeVisible();
    const desktopLayout = await clear.evaluate((element) => ({
      maxHeight: getComputedStyle(element).maxHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(desktopLayout.maxHeight).toBe(maxHeightBeforeReplay);
    expect(desktopLayout.overflowY).toBe("auto");
  });

  test("keeps the history dialog open across a phone resize, then collapses after closing", { tag: "@layout" }, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await startReplay(clear);
    const dialog = clear.getByRole("dialog", { name: "移動履歴" });
    await clear.getByRole("button", { name: "移動履歴を見る" }).click();
    await expect(dialog).toBeVisible();
    await expect(clear.getByRole("button", { name: "再開" })).toBeVisible();

    await page.setViewportSize(PHONE_MEDIUM);
    await expect(dialog).toBeVisible();
    await expect(clear).not.toHaveClass(/clear-screen--replay-collapsed/);
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
    const phoneDialog = await openClearHistory(clear);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s5-dialog-phone320.png") });
    await phoneDialog.getByRole("button", { name: "閉じる" }).click();
  });
});

test.describe("reduced-motion replay", () => {
  test.use({ reducedMotion: "reduce" });

  test("uses full-route wording and shows the route immediately", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const fullFeatureCount = (await readClearRoute(page))?.featureCount ?? 0;
    await expect(clear.getByRole("button", { name: "全経路を表示" })).toBeVisible();
    await clear.getByRole("button", { name: "全経路を表示" }).click();
    await expect(page.locator(".clear-replay-caption")).toHaveCount(0);
    await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
  });
});

/**
 * Literal history rows for the pinned one-roll clear. These pin the formatted roll, move, line and note texts
 * independently of production formatting (the helper in support/clearHistory.ts checks only shape and kind).
 */
const PINNED_HISTORY_LITERALS: readonly {
  readonly page: number;
  readonly recordIndex: number;
  readonly turn: string;
  readonly roll: string;
  readonly move: string;
  readonly line: string;
  readonly notes: readonly (readonly [kind: string, text: string])[];
}[] = [
  {
    page: 1, recordIndex: 0, turn: "1ターン目", roll: "出目2", move: "新橋 → 田町・三田（2駅）", line: "山手線・外回り",
    notes: [["landing", "到着田町・三田：山手線・京浜東北線・都営浅草線 各停・都営三田線 各停から抽選 → 山手線 ／ 外回りに固定"]],
  },
  {
    page: 1, recordIndex: 3, turn: "4ターン目", roll: "出目6", move: "浜松町・大門 → 蒲田（6駅）", line: "京浜東北線・大船方面",
    notes: [
      ["landing", "到着蒲田：京浜東北線・東急池上線 各停・東急多摩川線 各停から抽選 → 京浜東北線 ／ 方向抽選 → 大船方面"],
      ["item", "アイテム出目調整券±3を拾いました。出目を見てから、出目に3を足すか引くかできる（1より小さくはできない）"],
    ],
  },
  {
    page: 1, recordIndex: 16, turn: "17ターン目", roll: "出目4", move: "東白楽 → 横浜（2駅）", line: "東急東横線 各停・横浜方面",
    notes: [
      ["landing", "到着横浜：10系統から抽選 → 横須賀線 ／ 方向抽選 → 東京方面"],
      ["truncation", "途中停止横浜で終了〔系統の端〕、残り2を使わず"],
      ["item", "アイテム方向指定券を拾いました。山手線以外の路線で進む向きを選べる"],
    ],
  },
  {
    page: 5, recordIndex: 82, turn: "83ターン目", roll: "出目4", move: "有楽町・日比谷 → 新橋（1駅）", line: "山手線・外回り",
    notes: [["truncation", "途中停止新橋で終了、残り3を使わず"], ["goal", "ゴールに到着しました"]],
  },
];

test("renders literal history rows for the pinned clear, independent of production formatting", async ({ page }) => {
  const clear = await clearWithOneRoll(page);
  const dialog = await openClearHistory(clear);
  let currentPage = 1;
  for (const expected of PINNED_HISTORY_LITERALS) {
    while (currentPage < expected.page) {
      await dialog.getByRole("button", { name: "次のページ" }).click();
      currentPage += 1;
    }
    const row = dialog.locator(`[data-record-index="${expected.recordIndex}"]`);
    await expect(row.locator(".clear-history__turn")).toHaveText(expected.turn);
    await expect(row.locator(".clear-history__roll")).toHaveText(expected.roll);
    await expect(row.locator(".clear-history__move")).toHaveText(expected.move);
    await expect(row.locator(".clear-history__line")).toHaveText(expected.line);
    const notes = row.locator(".clear-history__note");
    await expect(notes).toHaveText(expected.notes.map(([, text]) => text));
    for (const [index, [kind]] of expected.notes.entries()) {
      await expect(notes.nth(index)).toHaveAttribute("data-note", kind);
    }
  }
});

// Issue #69, S7: image share, save and the text fallbacks. Every platform API is stubbed (see support/shareStubs.ts),
// so no click can reach x.com; the fixture's blocked-request guard and the request spy below prove it.
const IMAGE_FILE_NAME = "yamanote-sugoroku-route.png";
const PASTE_HINT = "Xの投稿画面に画像を貼り付けてください";
const SCREENSHOTS_S7_ENABLED = Boolean(process.env.ISSUE69_S7_SCREENSHOTS) && !process.env.CI;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPORT_WIDTH = 1200;
const EXPORT_HEIGHT = 675;
/** The image is generated after the clear; software WebGL on a loaded runner can need several seconds. */
const IMAGE_READY_TIMEOUT_MS = 20_000;

/** Records requests to hosts the test must never reach. */
function spyOnForbiddenRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (/(^|\.)x\.com$|twitter\.com|google-analytics|googletagmanager/.test(new URL(request.url()).hostname)) seen.push(request.url());
  });
  return seen;
}

async function waitForImageActions(clear: Locator): Promise<void> {
  await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeEnabled({ timeout: IMAGE_READY_TIMEOUT_MS });
  await expect(clear.getByRole("button", { name: "画像を保存" })).toBeEnabled();
}

/** The share text, rebuilt literally from the numbers the card shows (never from production code). */
async function expectedShareText(clear: Locator): Promise<string> {
  const [turns, moves, transfers] = (await clear.locator(".clear-screen__stats dd").allTextContents())
    .slice(0, 3).map((text) => text.replace(/\D/g, ""));
  return `山手線すごろく 東京近郊版をクリア！\n所要ターン数 ${turns}・移動回数 ${moves}・乗換回数 ${transfers}\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app`;
}

function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** Calls other than the repeated capability probe, in order. */
async function shareCalls(page: Page): Promise<ShareLogEntry[]> {
  return (await readShareLog(page)).filter((entry) => entry.call !== "canShare");
}

async function readPngSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), "the saved file is a PNG").toBe(true);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe("image share and save", () => {
  test("copies the image first and opens X in the same click on desktop, even when the browser offers file share", async ({ page }) => {
    const forbidden = spyOnForbiddenRequests(page);
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    const text = await expectedShareText(clear);

    await clear.getByRole("button", { name: "Xでシェア" }).click();
    expect((await shareCalls(page)).slice(0, 5)).toEqual([
      { call: "ClipboardItem", types: ["image/png"], promiseValued: true },
      { call: "clipboard.write", items: 1 },
      { call: "open", url: "about:blank", target: "_blank" },
      { call: "popup.opener", value: "null" },
      { call: "popup.location", href: intentUrl(text) },
    ]);
    await expect.poll(() => shareCalls(page)).toContainEqual({ call: "clipboard.blob", type: "image/png", nonEmpty: true });
    expect((await shareCalls(page)).map((entry) => entry.call)).not.toContain("share");
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(PASTE_HINT);
    await expect(clear.getByRole("status")).toHaveText(PASTE_HINT);
    expect(forbidden, "no request reached x.com or analytics").toEqual([]);
  });

  test("saves a 1200x675 PNG through the product 画像を保存 download", async ({ page }) => {
    await stubShareApis(page);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);

    const downloadPromise = page.waitForEvent("download");
    await clear.getByRole("button", { name: "画像を保存" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(IMAGE_FILE_NAME);
    const savedPath = test.info().outputPath("saved-route.png");
    mkdirSync(dirname(savedPath), { recursive: true });
    await download.saveAs(savedPath);
    const bytes = readFileSync(savedPath);
    expect(await readPngSize(bytes)).toEqual({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT });
    const decoded = await page.evaluate(async (base64) => {
      const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([binary], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("decoder canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      const corner = context.getImageData(4, 4, 1, 1).data;
      const size = { width: bitmap.width, height: bitmap.height, cornerAlpha: corner[3] };
      bitmap.close();
      return size;
    }, bytes.toString("base64"));
    expect(decoded).toEqual({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT, cornerAlpha: 255 });
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("画像の保存を始めました");
  });

  test("keeps the text-only X link available with the exact intent and counts no request", async ({ page }) => {
    const forbidden = spyOnForbiddenRequests(page);
    await stubShareApis(page);
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    const text = await expectedShareText(clear);
    const link = clear.getByRole("link", { name: "文面だけXに投稿" });
    // Available straight away, before the PNG is ready.
    await expect(link).toHaveAttribute("href", intentUrl(text));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    expect(new URL((await link.getAttribute("href"))!).searchParams.get("text")).toBe(text);
    // Cancel the navigation the click would start; the app's own handler still runs first.
    await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault(), { capture: true }));
    await link.click();
    expect(forbidden).toEqual([]);
    expect(await shareCalls(page)).toEqual([]);
  });

  test("reports a clipboard rejection and a blocked popup separately, never with the paste hint", async ({ page }) => {
    await stubShareApis(page, { clipboard: "reject" });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(
      "Xを開きましたが、画像をコピーできませんでした。「画像を保存」して投稿に添付してください。",
    );
    await expect(clear.getByRole("button", { name: "画像を保存" })).toBeEnabled();
    await expect(clear.getByRole("link", { name: "文面だけXに投稿" })).toBeVisible();
  });

  test("guides to the text link when the popup is blocked after a successful copy", async ({ page }) => {
    await stubShareApis(page, { open: "null" });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(
      "画像をコピーしましたが、Xを開けませんでした。「文面だけXに投稿」から開いて貼り付けるか、「画像を保存」を使ってください。",
    );
    expect((await shareCalls(page)).map((entry) => entry.call)).not.toContain("popup.location");
  });

  test.describe("while the replay runs", () => {
    test.use({ reducedMotion: "no-preference" });

    test("finishes the replay and draws the whole route before the share starts", async ({ page }) => {
      await stubShareApis(page);
      await page.setViewportSize(DESKTOP);
      const clear = await clearWithOneRoll(page);
      await waitForImageActions(clear);
      await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBeGreaterThan(0);
      const fullFeatureCount = (await readClearRoute(page))?.featureCount ?? 0;
      await startReplay(clear);
      await expect(page.locator(".clear-replay-caption")).toBeVisible();

      await clear.getByRole("button", { name: "Xでシェア" }).click();
      await expect(page.locator(".clear-replay-caption")).toHaveCount(0);
      await expect(clear.getByRole("button", { name: "一時停止" })).toHaveCount(0);
      await expect(clear.getByRole("button", { name: "軌跡を再生" })).toBeVisible();
      await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0).toBe(fullFeatureCount);
      expect((await shareCalls(page)).map((entry) => entry.call)).toContain("popup.location");
    });
  });

  test("shares the real PNG file with the full text natively on a phone", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    const text = await expectedShareText(clear);
    // The native text-only 共有 would repeat what Xでシェア already shares with the image.
    await expect(clear.getByRole("button", { name: "共有", exact: true })).toHaveCount(0);

    await clear.getByRole("button", { name: "Xでシェア" }).click();
    expect(await shareCalls(page)).toEqual([
      { call: "clipboard.writeText", text },
      { call: "share", keys: ["files", "text"], files: [`${IMAGE_FILE_NAME}:image/png:true`], text },
    ]);
    expect((await readShareLog(page)).find((entry) => entry.call === "canShare" && (entry.files as string[]).length > 0)).toEqual({
      call: "canShare", files: [`${IMAGE_FILE_NAME}:image/png:true`],
    });
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("");
    await expect(clear.getByRole("alert")).toHaveCount(0);
  });

  test("stays silent when the phone share is cancelled", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true, share: "abort" });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    // The live region still holds the goal announcement; a cancel must leave it untouched.
    const announced = await clear.getByRole("status").textContent();
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect.poll(async () => (await shareCalls(page)).map((entry) => entry.call)).toContain("share");
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("");
    await expect(clear.getByRole("status")).toHaveText(announced ?? "");
    await expect(clear.getByRole("alert")).toHaveCount(0);
    await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeEnabled();
  });

  test("guides to saving the image and the text link when the phone share is refused", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true, share: "reject" });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(
      "共有できませんでした。「画像を保存」してXの投稿に添付するか、「文面だけXに投稿」を使ってください。",
    );
    await expect(clear.getByRole("button", { name: "画像を保存" })).toBeEnabled();
    await expect(clear.getByRole("link", { name: "文面だけXに投稿" })).toBeVisible();
  });

  test("falls back to the copy-and-open path on a phone when file share is not offered", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: false });
    await page.setViewportSize(PHONE_MEDIUM);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    const calls = (await shareCalls(page)).map((entry) => entry.call);
    expect(calls.slice(0, 3)).toEqual(["ClipboardItem", "clipboard.write", "open"]);
    expect(calls).not.toContain("share");
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(PASTE_HINT);
  });

  test("keeps the image and replay button rectangles fixed from pending to ready at 320x568", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.addInitScript(holdRouteImageEncoding);
    await page.setViewportSize(PHONE_SMALL);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const clear = await clearWithOneRoll(page);
    await expect.poll(
      () => page.evaluate(() => (window as RouteImageEncodingWindow).__routeImageEncodeReleases?.length ?? 0),
      { timeout: IMAGE_READY_TIMEOUT_MS },
    ).toBe(1);
    await expect(clear.getByText("画像を準備中…", { exact: true })).toBeVisible();
    await expect(clear.getByRole("button", { name: "Xでシェア" })).toBeDisabled();
    await expect(clear.getByRole("button", { name: "画像を保存" })).toBeDisabled();

    const buttonNames = ["結果をコピー", "Xでシェア", "画像を保存", "軌跡を再生", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"] as const;
    const pendingLayout = await measurePhoneSheet(clear, buttonNames);
    expect(pendingLayout.scrollTop, "the pending sheet stays at the top").toBe(0);
    expect(pendingLayout.sheet.height, "the pending sheet stays within its 65% cap")
      .toBeLessThanOrEqual(PHONE_SMALL.height * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
    await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats"), "the three numbers");
    for (const name of buttonNames) await expectWithinFirstScreen(clear, clear.getByRole("button", { name, exact: true }), name);
    await expectNoHorizontalOverflow(page, clear);

    await page.evaluate(() => (window as RouteImageEncodingWindow).__releaseRouteImageEncoding?.());
    await waitForImageActions(clear);
    await expect(clear.getByText("画像を準備中…", { exact: true })).toBeHidden();
    const readyLayout = await measurePhoneSheet(clear, buttonNames);
    expect(readyLayout.scrollTop, "the ready sheet stays at the top").toBe(0);
    expect(readyLayout.sheet.height, "the ready sheet stays within its 65% cap")
      .toBeLessThanOrEqual(PHONE_SMALL.height * PHONE_SHEET_MAX_HEIGHT_RATIO + 1);
    await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats"), "the three numbers");
    for (const name of buttonNames) await expectWithinFirstScreen(clear, clear.getByRole("button", { name, exact: true }), name);
    await expectNoHorizontalOverflow(page, clear);

    for (const name of ["軌跡を再生", "Xでシェア", "画像を保存"] as const) {
      for (const edge of ["top", "bottom", "left", "right"] as const) {
        expect(
          Math.abs(readyLayout.targets[name]![edge] - pendingLayout.targets[name]![edge]),
          `${name} ${edge} stays within one pixel while the image becomes ready`,
        ).toBeLessThanOrEqual(1);
      }
    }
    console.log(`[S7 pending layout 320x568] ${JSON.stringify(pendingLayout)}`);
    console.log(`[S7 ready layout 320x568] ${JSON.stringify(readyLayout)}`);
  });

  test("keeps the share row, numbers and main actions inside the 320px sheet and reports the rectangles", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    await expectNoHorizontalOverflow(page, clear);
    await expectWithinFirstScreen(clear, clear.locator(".clear-screen__stats dd").nth(2), "the three numbers");
    for (const name of ["結果をコピー", "Xでシェア", "画像を保存", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"]) {
      await expectWithinFirstScreen(clear, clear.getByRole("button", { name }), name);
    }
    await expectWithinFirstScreen(clear, clear.getByRole("button", { name: /^(軌跡を再生|全経路を表示)$/ }), "軌跡を再生");
    // Single-line labels: the narrowest button (タイトルへ) must not clip its own text.
    for (const button of await clear.locator("button").all()) {
      const clipped = await button.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(clipped, `${await button.textContent()} must not clip its label`).toBe(false);
    }
    const rects = await clear.evaluate((element) => {
      const sheet = element.getBoundingClientRect();
      const round = (value: number): number => Math.round(value * 10) / 10;
      const rect = (target: Element): number[] => {
        const box = target.getBoundingClientRect();
        return [round(box.top - sheet.top), round(box.bottom - sheet.top), round(box.left - sheet.left), round(box.right - sheet.left)];
      };
      const report: Record<string, unknown> = { sheet: [round(sheet.height), round(sheet.width)], scrollTop: element.scrollTop };
      for (const target of element.querySelectorAll("button, a")) report[(target.textContent ?? "").trim()] = rect(target);
      report["三つの数値(dd3)"] = rect(element.querySelectorAll(".clear-screen__stats dd")[2]!);
      return report;
    });
    console.log(`S7-RECTS 320x568 ${JSON.stringify(rects)}`);
  });

  test("keeps the share row reachable at 320px when the clear could not be saved", { tag: "@layout" }, async ({ page }) => {
    await stubShareApis(page, { canShare: true });
    await page.setViewportSize(PHONE_SMALL);
    const clear = await clearWithOneRoll(page, { failSave: true });
    await waitForImageActions(clear);
    await expect(clear.getByRole("alert")).toContainText("再読み込みするとこのクリアは残りません");
    for (const name of ["結果をコピー", "Xでシェア", "画像を保存", "もう一度遊ぶ", "タイトルへ", "移動履歴を見る"]) {
      await expectReachable(clear, clear.getByRole("button", { name }), name);
    }
    await expectReachable(clear, clear.getByRole("link", { name: "文面だけXに投稿" }), "文面だけXに投稿");
    await expectNoHorizontalOverflow(page, clear);
    await clear.getByRole("button", { name: "画像を保存" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText("画像の保存を始めました");
    await expectNoHorizontalOverflow(page, clear);
  });

  test("saves the S7 review screenshots on request", async ({ page }) => {
    test.skip(!SCREENSHOTS_S7_ENABLED, "set ISSUE69_S7_SCREENSHOTS=1 (outside CI) to write the review screenshots");
    await stubShareApis(page);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize(DESKTOP);
    const clear = await clearWithOneRoll(page);
    await waitForImageActions(clear);
    const cards: readonly [string, { width: number; height: number }][] = [
      ["issue69-s7-desktop.png", DESKTOP],
      ["issue69-s7-phone390.png", PHONE_MEDIUM],
      ["issue69-s7-phone320.png", PHONE_SMALL],
    ];
    for (const [file, viewport] of cards) {
      await test.step(file, async () => {
        await page.setViewportSize(viewport);
        await expect(clear).toBeVisible();
        await page.screenshot({ path: join(SCREENSHOT_DIR, file) });
      });
    }
    await page.setViewportSize(DESKTOP);
    await clear.getByRole("button", { name: "Xでシェア" }).click();
    await expect(clear.locator(".clear-screen__share-status")).toHaveText(PASTE_HINT);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "issue69-s7-paste-hint.png") });
  });
});
