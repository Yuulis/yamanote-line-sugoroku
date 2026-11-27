import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import { openTitle, panelStat, revealUnadjustedRoll, rollOnce, writeSaveText } from "./support/app";
import { PRODUCT_HISTORY_CLEAR_ROUTE_LEGS, PRODUCT_HISTORY_SCENARIO_TURNS } from "./fixtures/seeds";
import { buildGeometryIndex } from "../../src/features/game/animation/movePath";
import { deriveClearResult } from "../../src/features/game/clearResult";
import { restoreGame } from "../../src/features/game/engine";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { loadBundle } from "./fixtures/bundle";
import { playTurn } from "./fixtures/productGame";

export const IMAGE_READY_TIMEOUT_MS = 20_000;
export const PINNED_SAVE = readFileSync(new URL("./fixtures/tokyo-suburban-before-clear-save.json", import.meta.url), "utf8").trimEnd();
export const EXPECTED_CLEAR_ROUTE = await (async () => {
  const bundle = await loadBundle("real");
  if (!bundle.data.geometry.ok) throw new Error("The real fixture bundle must carry route geometry");
  const restored = restoreGame(PINNED_SAVE, bundle.network);
  if (restored.status !== "playing") throw new Error("The pinned save must be one roll before the clear");
  const game = playTurn(restored as Parameters<typeof playTurn>[0], bundle.network).state;
  const { route } = deriveClearResult({
    game,
    network: bundle.network,
    geometry: buildGeometryIndex(bundle.data.geometry.value),
    presentation: createPresentationResolver(bundle.network),
    display: { title: "Test", subtitle: "Test", documentTitle: "Test", ruleParagraphs: [] },
  });
  if (!route) throw new Error("The pinned save must derive a verified route fixture");
  return route;
})();
export const PHONE_SMALL = { width: 320, height: 568 } as const;
export const PHONE_MEDIUM = { width: 390, height: 844 } as const;
export const DESKTOP = { width: 1280, height: 800 } as const;
/** Review screenshots are produced on request only (never in CI). */
export const SCREENSHOT_DIR = ".claude/logs/screenshots";
export const SCREENSHOTS_ENABLED = Boolean(process.env.ISSUE69_S3_SCREENSHOTS) && !process.env.CI;
/** Phone sheet cap (Revision 4): the first screen of the sheet must hold the numbers and the main actions. */
export const PHONE_SHEET_MAX_HEIGHT_RATIO = 0.65;
export const LANDSCAPE_PHONE = { width: 667, height: 375 } as const;
export const SCREENSHOTS_S4_ENABLED = Boolean(process.env.ISSUE69_S4_SCREENSHOTS) && !process.env.CI;
export const SCREENSHOTS_S4B_ENABLED = Boolean(process.env.ISSUE69_S4B_SCREENSHOTS) && !process.env.CI;
export const SCREENSHOTS_S5_ENABLED = Boolean(process.env.ISSUE69_S5_SCREENSHOTS) && !process.env.CI;
export const SCREENSHOTS_S5B_ENABLED = Boolean(process.env.ISSUE69_S5B_SCREENSHOTS) && !process.env.CI;
export const CLEAR_ROUTE_LAYERS = ["clear-traveled-route-outline", "clear-traveled-route-line"] as const;
/** The route must fill at least this share of the open area along its limiting axis, so "somewhere small" fails. */
export const MIN_ROUTE_FILL_RATIO = 0.4;
export const FRAMING_TOLERANCE_PX = 1;

export interface RouteImageEncodingWindow extends Window {
  __routeImageEncodeReleases?: Array<() => void>;
  __releaseRouteImageEncoding?: () => void;
}

export async function failSaveWrites(page: Page): Promise<void> {
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
export async function clearWithOneRoll(page: Page, options: { failSave?: boolean } = {}): Promise<Locator> {
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
export async function startReplay(clear: Locator): Promise<void> {
  await waitForSettledShareRow(clear);
  await clear.getByRole("button", { name: "軌跡を再生" }).click();
}

/** The row is settled as soon as its pending controls are in place; it no longer has to wait for PNG encoding. */
export async function waitForSettledShareRow(clear: Locator): Promise<void> {
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
export function holdRouteImageEncoding(): void {
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

export async function measurePhoneSheet(clear: Locator, buttonNames: readonly string[]): Promise<{
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

export async function expectNoHorizontalOverflow(page: Page, clear: Locator): Promise<void> {
  const card = await clear.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(card.scroll, "the clear card must not scroll horizontally").toBeLessThanOrEqual(card.client);
  const document = await page.evaluate(() => ({
    client: window.document.documentElement.clientWidth,
    scroll: window.document.documentElement.scrollWidth,
  }));
  expect(document.scroll, "the page must not scroll horizontally").toBeLessThanOrEqual(document.client);
}

/** True when the element sits fully inside the card's first (unscrolled) screen. */
export async function expectWithinFirstScreen(clear: Locator, target: Locator, name: string): Promise<void> {
  const fits = await target.evaluate((element, cardElement) => {
    const card = cardElement as HTMLElement;
    const cardBox = card.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return card.scrollTop === 0 && box.height > 0 && box.top >= cardBox.top && box.bottom <= cardBox.bottom;
  }, await clear.elementHandle());
  expect(fits, `${name} must be visible without scrolling the card`).toBe(true);
}

/** After scrolling it into view, the control sits inside both the card's scrollport and the viewport (1px tolerance). */
export async function expectReachable(clear: Locator, target: Locator, name: string): Promise<void> {
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

export interface Box { left: number; top: number; right: number; bottom: number }

export interface ClearRouteReading {
  featureCount: number;
  /** Layer ids in style order. */
  layerIds: string[];
  /** Pixel bounds of every projected route vertex, in map-container (= viewport) coordinates. */
  bounds: Box | null;
  viewport: { width: number; height: number };
  card: Box | null;
  padding: { top: number; right: number; bottom: number; left: number } | null;
  cameraTarget: { bounds: [[number, number], [number, number]]; recordIndex: number | null } | null;
  cameraBounds: Box | null;
  camera: { center: { lng: number; lat: number }; zoom: number };
  mapControlsVisible: boolean;
  /** Caption turn read in the same evaluate as the camera target, so both describe one moment of playback. */
  captionRecordIndex: number | null;
}

export interface E2EMapHook {
  map?: E2ERouteMap | null;
  clearFitPadding?: ClearRouteReading["padding"];
  clearCameraTarget?: ClearRouteReading["cameraTarget"];
}

export interface E2ERouteMap {
  getSource(id: string): { serialize(): { data: { features: { geometry: { coordinates: [number, number][] } }[] } } } | undefined;
  getStyle(): { layers: { id: string }[] };
  project(lngLat: [number, number]): { x: number; y: number };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
}

/** Read the live map through the e2e-build hook: the route source, its layer order and where its vertices are drawn. */
export async function readClearRoute(page: Page): Promise<ClearRouteReading | null> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __sugorokuE2E?: E2EMapHook }).__sugorokuE2E;
    const map = hook?.map;
    if (!map) return null;
    const features = map.getSource("clear-traveled-route")?.serialize().data.features ?? [];
    const cameraTarget = hook?.clearCameraTarget ?? null;
    let bounds: Box | null = null;
    for (const feature of features) {
      for (const coordinate of feature.geometry.coordinates) {
        const { x, y } = map.project(coordinate);
        bounds = bounds === null
          ? { left: x, top: y, right: x, bottom: y }
          : { left: Math.min(bounds.left, x), top: Math.min(bounds.top, y), right: Math.max(bounds.right, x), bottom: Math.max(bounds.bottom, y) };
      }
    }
    let cameraBounds: Box | null = null;
    if (cameraTarget) {
      const [[west, south], [east, north]] = cameraTarget.bounds;
      for (const coordinate of [[west, south], [west, north], [east, south], [east, north]] as [number, number][]) {
        const { x, y } = map.project(coordinate);
        cameraBounds = cameraBounds === null
          ? { left: x, top: y, right: x, bottom: y }
          : { left: Math.min(cameraBounds.left, x), top: Math.min(cameraBounds.top, y), right: Math.max(cameraBounds.right, x), bottom: Math.max(cameraBounds.bottom, y) };
      }
    }
    const cardRect = document.querySelector(".clear-screen")?.getBoundingClientRect();
    const captionIndex = document.querySelector(".clear-replay-caption")?.getAttribute("data-record-index");
    return {
      featureCount: features.length,
      layerIds: map.getStyle().layers.map((layer) => layer.id),
      bounds,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      card: cardRect ? { left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom } : null,
      padding: hook.clearFitPadding ?? null,
      cameraTarget,
      cameraBounds,
      camera: { center: map.getCenter(), zoom: map.getZoom() },
      mapControlsVisible: document.querySelector(".map-overview") !== null,
      captionRecordIndex: captionIndex == null || captionIndex === "" ? null : Number(captionIndex),
    };
  });
}

export function cameraPaddingChanged(
  before: ClearRouteReading["padding"] | null,
  after: ClearRouteReading["padding"] | null,
): boolean {
  if (!before || !after) return false;
  return (["top", "right", "bottom", "left"] as const)
    .some((edge) => Math.abs(before[edge] - after[edge]) > 0.5);
}

/** The largest map region the card leaves open: above, below, left or right of it. */
export function openRegion(card: Box, viewport: { width: number; height: number }): Box {
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
export function framingProblem(reading: ClearRouteReading | null): string {
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

export async function expectRouteFramedBesideCard(page: Page): Promise<ClearRouteReading> {
  await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0, { message: "the route source carries one feature per leg" })
    .toBe(PRODUCT_HISTORY_CLEAR_ROUTE_LEGS);
  await expect.poll(async () => framingProblem(await readClearRoute(page)), { message: "the route is framed in the open map area" }).toBe("");
  const reading = await readClearRoute(page);
  if (!reading) throw new Error("the e2e map hook is not available");
  return reading;
}

/** Rebuild the expected bounds from the pinned route fixture, independently of the map camera target. */
export function expectedTurnBounds(recordIndex: number): [[number, number], [number, number]] | null {
  if (!Number.isInteger(recordIndex)) return null;
  const span = EXPECTED_CLEAR_ROUTE.turnSpans[recordIndex];
  if (!span) return null;
  if (span.firstStepIndex === span.endStepIndexExclusive) {
    const destination = span.destination;
    return destination ? [[destination[0], destination[1]], [destination[0], destination[1]]] : null;
  }
  const points = EXPECTED_CLEAR_ROUTE.steps
    .slice(span.firstStepIndex, span.endStepIndexExclusive)
    .flatMap((step) => step.points);
  if (points.length === 0) return null;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

/** Empty when the active saved turn's camera bounds fit and fill the map area outside the current card. */
export function activeTurnFramingProblem(reading: ClearRouteReading | null, recordIndex: number): string {
  if (!reading?.cameraTarget || !reading.cameraBounds || !reading.card) return "turn camera target is not available yet";
  const expectedBounds = expectedTurnBounds(recordIndex);
  if (!expectedBounds) return `fixture has no bounds for turn ${recordIndex}`;
  if (reading.cameraTarget.recordIndex !== recordIndex) {
    return `camera targets turn ${reading.cameraTarget.recordIndex}, expected ${recordIndex}`;
  }
  const matchesExpectedBounds = reading.cameraTarget.bounds.every((corner, cornerIndex) =>
    corner.every((coordinate, coordinateIndex) => Math.abs(coordinate - expectedBounds[cornerIndex]![coordinateIndex]!) <= 1e-8));
  if (!matchesExpectedBounds) {
    return `camera targets bounds ${JSON.stringify(reading.cameraTarget.bounds)}, expected fixture turn ${JSON.stringify(expectedBounds)}`;
  }
  const region = openRegion(reading.card, reading.viewport);
  const bounds = reading.cameraBounds;
  const tolerance = FRAMING_TOLERANCE_PX;
  if (bounds.left < region.left - tolerance || bounds.top < region.top - tolerance
    || bounds.right > region.right + tolerance || bounds.bottom > region.bottom + tolerance) {
    return `active turn ${JSON.stringify(bounds)} is outside the open area ${JSON.stringify(region)}`;
  }
  return "";
}

/**
 * Reads the caption turn and the camera target in one evaluate: separate round trips straddle a turn change
 * while playback advances (550 ms a turn) and compare two different moments.
 */
export async function expectCaptionTurnFramed(page: Page): Promise<void> {
  await expect.poll(async () => {
    const reading = await readClearRoute(page);
    if (reading?.captionRecordIndex == null) return "replay caption is not rendered";
    return activeTurnFramingProblem(reading, reading.captionRecordIndex);
  }, { message: "the active turn is framed in the open map area" }).toBe("");
}

export async function expectPartialRouteDrawn(page: Page, context: string): Promise<void> {
  await expect.poll(async () => (await readClearRoute(page))?.featureCount ?? 0,
    { message: `the partial route is drawn during ${context}` }).toBeGreaterThan(0);
}

export async function expectExpandedPhoneSheet(clear: Locator, viewportHeight: number): Promise<void> {
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

export async function measureCollapsedBand(clear: Locator): Promise<{
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
      .map((button) => button.getBoundingClientRect())
      .filter((rect) => rect.height > 0);
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

