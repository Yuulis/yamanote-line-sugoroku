import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { createItemGame, nextStationId, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { displayedHeading } from "../../src/features/game/mapGuidance";
import type { ItemGameState } from "../../src/types/network";
import { LAYER_IDS } from "../../src/features/map/mapConfig";
import { expect, test } from "./fixtures";
import type { RailwayBundle } from "./fixtures/bundle";
import { closeGameMenu, gamePanel, openGameMenu, openTitle, readHeadingPixels, readMap, startNewGame, writeSaveText } from "./support/app";

// S6V: the 1都3県 network must stay readable. Real data, both form factors.
test.use({ dataset: "real" });

const SCREENSHOT_DIR = resolve(".claude/logs/jrcr-s6v/screenshots");
const JRCR_S7_SCREENSHOT_DIR = resolve(".claude/logs/jrcr-s7/screenshots");
const TARGET_SERVICE_ID = "jr-yamanote";
const MIN_COMPLETED_YAMANOTE_SEGMENTS = 4;
const MAX_VISUAL_GAME_TURNS = 24;
const MAX_VISUAL_GAME_SEEDS = 512;
const MIN_HEADING_RED_PIXELS = 80;
const HEADING_SAMPLE_RADIUS = 18;
const HEADING_MATCH_TOLERANCE_DEGREES = 20;
const HEADING_ICON_CENTER = 16;
const HEADING_ICON_POLYGON: readonly [number, number][] = [[16, 1], [27, 28], [16, 22], [5, 28]];
/** Tokyo to Yurakucho from the public jr-yamanote platform coordinates. */
const TOKYO_OUTER_LOOP_BEARING = 205.15;
/** Allowed offset of the target line's centre from the free area's centre. */
const CENTRE_TOLERANCE_SHARE = 0.12;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function isPhone(page: Page): boolean {
  return page.viewportSize()!.width <= 600;
}

/** The map area the panel does not cover: beside it on desktop, above it on phone. */
async function freeArea(page: Page): Promise<Rect> {
  const viewport = page.viewportSize()!;
  const panel = (await gamePanel(page).boundingBox())!;
  return isPhone(page)
    ? { left: 0, top: 0, right: viewport.width, bottom: panel.y }
    : { left: panel.x + panel.width, top: 0, right: viewport.width, bottom: viewport.height };
}

async function project(page: Page, points: [number, number][]): Promise<{ x: number; y: number }[]> {
  return page.evaluate((coordinates) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E;
    return coordinates.map((point) => {
      const { x, y } = hook.map.project(point);
      return { x, y };
    });
  }, points);
}

async function expectInFreeArea(page: Page, points: [number, number][]): Promise<Rect> {
  const result = await page.evaluate(({ coordinates, phone }) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { project(point: [number, number]): { x: number; y: number } } } }).__sugorokuE2E;
    const panel = document.querySelector<HTMLElement>(".game-panel")!.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const projected = coordinates.map((point) => hook.map.project(point));
    return {
      bounds: {
        left: Math.min(...projected.map((point) => point.x)),
        right: Math.max(...projected.map((point) => point.x)),
        top: Math.min(...projected.map((point) => point.y)),
        bottom: Math.max(...projected.map((point) => point.y)),
      },
      area: phone
        ? { left: 0, top: 0, right: viewport.width, bottom: panel.top }
        : { left: panel.right, top: 0, right: viewport.width, bottom: viewport.height },
    };
  }, { coordinates: points, phone: isPhone(page) });
  expect(result.bounds.left).toBeGreaterThanOrEqual(result.area.left);
  expect(result.bounds.right).toBeLessThanOrEqual(result.area.right);
  expect(result.bounds.top).toBeGreaterThanOrEqual(result.area.top);
  expect(result.bounds.bottom).toBeLessThanOrEqual(result.area.bottom);
  return result.bounds;
}

function expectRoughlyCentred(bounds: Rect, area: Rect): void {
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  const dx = (bounds.left + bounds.right) / 2 - (area.left + area.right) / 2;
  const dy = (bounds.top + bounds.bottom) / 2 - (area.top + area.bottom) / 2;
  expect(Math.abs(dx)).toBeLessThanOrEqual(width * CENTRE_TOLERANCE_SHARE);
  expect(Math.abs(dy)).toBeLessThanOrEqual(height * CENTRE_TOLERANCE_SHARE);
}

async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${name}.png`) });
}

async function screenshotAt(page: Page, directory: string, name: string): Promise<void> {
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, name) });
}

async function renderedStationIds(page: Page): Promise<string[]> {
  return page.evaluate((layers) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { queryRenderedFeatures(options: { layers: string[] }): { properties: { id: string } }[] } } }).__sugorokuE2E;
    return [...new Set(hook.map.queryRenderedFeatures({ layers }).map((feature) => feature.properties.id))];
  }, [LAYER_IDS.stationCircles, LAYER_IDS.stationCirclesOrdinary]);
}

interface RenderedStationLabel {
  id: string;
  name: string;
  labelTier: "target" | "transfer" | "ordinary";
}

async function renderedStationLabels(page: Page): Promise<RenderedStationLabel[]> {
  return page.evaluate((layers) => {
    const hook = (window as unknown as {
      __sugorokuE2E: {
        map: {
          queryRenderedFeatures(options: { layers: string[] }): {
            properties: RenderedStationLabel;
          }[];
        };
      };
    }).__sugorokuE2E;
    return hook.map.queryRenderedFeatures({ layers }).map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      labelTier: feature.properties.labelTier,
    }));
  }, [LAYER_IDS.stationLabels, LAYER_IDS.stationLabelsOrdinary]);
}

/** Key names from z11, ordinary names from z13: [minzoom of the key layer, of the ordinary layer]. */
async function stationLabelMinZooms(page: Page): Promise<unknown[]> {
  return page.evaluate((layers) => {
    const hook = (window as unknown as {
      __sugorokuE2E: { map: { getLayer(id: string): { minzoom?: number } | undefined } };
    }).__sugorokuE2E;
    return layers.map((layer) => hook.map.getLayer(layer)?.minzoom);
  }, [LAYER_IDS.stationLabels, LAYER_IDS.stationLabelsOrdinary]);
}

async function startReadyGame(page: Page): Promise<void> {
  await openTitle(page);
  await startNewGame(page);
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);
}

function deviceName(page: Page): "phone" | "desktop" {
  return isPhone(page) ? "phone" : "desktop";
}

function midGameWithYamanoteProgress(bundle: RailwayBundle): ItemGameState {
  for (let seed = 0; seed < MAX_VISUAL_GAME_SEEDS; seed += 1) {
    const seedText = seed.toString(16).padStart(32, "0");
    let game = createItemGame(ITEM_GAME_CONFIG, seedText, bundle.network);
    for (let turn = 0; turn < MAX_VISUAL_GAME_TURNS && game.status === "playing"; turn += 1) {
      game = playItemTurn(game, {}, bundle.network).state;
      if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
      const completedTargetCount = game.completedSegmentIds.filter((id) => id.startsWith(`${TARGET_SERVICE_ID}:`)).length;
      if (completedTargetCount >= MIN_COMPLETED_YAMANOTE_SEGMENTS && game.currentServiceId === TARGET_SERVICE_ID) return game;
    }
  }
  throw new Error("No engine-generated game reached the map guidance screenshot state");
}

function sampledHeadingDirection(redPixels: readonly [number, number][]): number {
  const redPixelSet = new Set(redPixels.map(([x, y]) => `${x},${y}`));
  let bestDirection = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let direction = 0; direction < 360; direction += 1) {
    const radians = direction * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    let intersection = 0;
    let union = 0;
    for (let y = -HEADING_SAMPLE_RADIUS; y <= HEADING_SAMPLE_RADIUS; y += 1) {
      for (let x = -HEADING_SAMPLE_RADIUS; x <= HEADING_SAMPLE_RADIUS; x += 1) {
        const localX = HEADING_ICON_CENTER + x * cosine + y * sine;
        const localY = HEADING_ICON_CENTER - x * sine + y * cosine;
        let inside = false;
        for (let index = 0; index < HEADING_ICON_POLYGON.length; index += 1) {
          const start = HEADING_ICON_POLYGON[index]!;
          const end = HEADING_ICON_POLYGON[(index + 1) % HEADING_ICON_POLYGON.length]!;
          const crossesRay = (start[1] > localY) !== (end[1] > localY);
          if (crossesRay && localX < ((end[0] - start[0]) * (localY - start[1])) / (end[1] - start[1]) + start[0]) {
            inside = !inside;
          }
        }
        const sampledRed = redPixelSet.has(`${x},${y}`);
        if (inside && sampledRed) intersection += 1;
        if (inside || sampledRed) union += 1;
      }
    }
    const score = intersection / union;
    if (score > bestScore) {
      bestDirection = direction;
      bestScore = score;
    }
  }
  return bestDirection;
}

function angularDifference(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
}

test("the target line starts centred in the free map area and 全体 shows every platform unclipped", async ({ page, railwayBundle }) => {
  const services = [...railwayBundle.network.servicesById.values()];
  const targetPoints = Object.values(railwayBundle.network.servicesById.get(TARGET_SERVICE_ID)!.platformCoordinates);
  const allPoints = services.flatMap((service) => Object.values(service.platformCoordinates));
  expect(services).toHaveLength(railwayBundle.network.servicesById.size);
  for (const stationId of ["hakuba", "nagano", "namie", "ito"]) {
    expect(railwayBundle.network.stationsById.has(stationId), `missing overview extreme ${stationId}`).toBe(true);
    expect(services.some((service) => stationId in service.platformCoordinates), `no platform for overview extreme ${stationId}`).toBe(true);
  }
  await startReadyGame(page);
  const device = deviceName(page);

  const targetBounds = await expectInFreeArea(page, targetPoints);
  expectRoughlyCentred(targetBounds, await freeArea(page));
  await screenshot(page, `${device}-initial`);

  await page.getByRole("button", { name: "全体", exact: true }).click();
  // The camera and the panel layout settle a frame after the click.
  await expect(async () => { await expectInFreeArea(page, allPoints); }).toPass();
  await screenshot(page, `${device}-overview`);
  if (!isPhone(page)) await screenshotAt(page, JRCR_S7_SCREENSHOT_DIR, "after-desktop-overview.png");
});

test("phone 全体 fits the collapsed-legend map area and remains clear when expanded", async ({ page, railwayBundle }) => {
  test.skip(!isPhone(page), "Phone-specific overview fit assertion");
  const allPoints = [...railwayBundle.network.servicesById.values()]
    .flatMap((service) => Object.values(service.platformCoordinates));
  for (const stationId of ["hakuba", "nagano", "namie", "ito"]) {
    expect(railwayBundle.network.stationsById.has(stationId), `missing overview extreme ${stationId}`).toBe(true);
    expect([...railwayBundle.network.servicesById.values()].some((service) => stationId in service.platformCoordinates), `no platform for overview extreme ${stationId}`).toBe(true);
  }
  await startReadyGame(page);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await expect(async () => { await expectInFreeArea(page, allPoints); }).toPass();
  await screenshotAt(page, JRCR_S7_SCREENSHOT_DIR, "after-collapsed.png");

  const collapsedBounds = await expectInFreeArea(page, allPoints);
  const collapsedArea = await freeArea(page);
  const collapsedBottomGap = collapsedArea.bottom - collapsedBounds.bottom;
  const maxBottomGap = 16 + Math.ceil(page.viewportSize()!.height * 0.1);

  const toggle = gamePanel(page).getByRole("button", { name: /路線の凡例/ });
  await openGameMenu(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await closeGameMenu(page);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await expect(async () => { await expectInFreeArea(page, allPoints); }).toPass();
  await screenshotAt(page, JRCR_S7_SCREENSHOT_DIR, "after-expanded.png");
  const expandedBounds = await expectInFreeArea(page, allPoints);
  const expandedArea = await freeArea(page);
  const expandedBottomGap = expandedArea.bottom - expandedBounds.bottom;

  // The fit leaves 16 px beyond the panel; the 10% viewport allowance covers
  // the phone's width-limited network aspect ratio and platform extrema.
  expect(collapsedBottomGap).toBeLessThanOrEqual(maxBottomGap);
  expect(expandedBottomGap).toBeLessThanOrEqual(maxBottomGap);
});

test("at overview zoom only transfer and target stations are marked; close zoom shows them all", async ({ page, railwayBundle }) => {
  await startReadyGame(page);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  const { network } = railwayBundle;
  const servedBy = (id: string) => network.servicesByStation.get(id) ?? [];
  const ordinary = [...network.stationsById.keys()].filter(
    (id) => servedBy(id).length < 2 && !servedBy(id).includes(TARGET_SERVICE_ID),
  );
  expect(ordinary.length).toBeGreaterThan(100);
  // Rendering catches up with the camera a frame later: wait for the zoomed-out result.
  await expect
    .poll(async () => {
      const rendered = await renderedStationIds(page);
      return rendered.length > 0 && ordinary.every((id) => !rendered.includes(id));
    })
    .toBe(true);
  const overview = new Set(await renderedStationIds(page));
  expect(overview.has("ueno")).toBe(true);
  for (const id of network.servicesById.get(TARGET_SERVICE_ID)!.stationIds) expect(overview.has(id)).toBe(true);

  const ueno = network.stationsById.get("ueno")!.coordinates;
  await page.evaluate((center) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center, zoom: 13.5 });
  }, ueno);
  await expect.poll(async () => (await renderedStationIds(page)).filter((id) => ordinary.includes(id)).length).toBeGreaterThan(0);
  // Let labels finish fading in before the screenshot.
  await page.evaluate(() => new Promise<void>((done) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { once(type: "idle", listener: () => void): void; triggerRepaint(): void } } }).__sugorokuE2E;
    hook.map.once("idle", done);
    hook.map.triggerRepaint();
  }));
  if (!isPhone(page)) await screenshot(page, "desktop-ueno-zoom");
});

test("real Japanese labels follow overview and zoom density at station hubs on desktop and phone", async ({ page, railwayBundle }, testInfo) => {
  await startReadyGame(page);
  await page.getByRole("button", { name: "全体", exact: true }).click();
  await expect.poll(async () => (await renderedStationLabels(page)).length).toBe(0);

  const tokyo = railwayBundle.network.stationsById.get("tokyo")!;
  await page.evaluate((center) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center, zoom: 11.5 });
  }, tokyo.coordinates);
  await expect.poll(async () => (await renderedStationLabels(page)).length).toBeGreaterThan(0);
  expect(await stationLabelMinZooms(page)).toEqual([11, 13]);
  expect((await renderedStationLabels(page)).filter((label) => label.labelTier === "ordinary")).toEqual([]);

  const shinjuku = railwayBundle.network.stationsById.get("shinjuku")!;
  await page.evaluate((center) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center, zoom: 13.5 });
  }, shinjuku.coordinates);
  await expect.poll(async () => (await renderedStationLabels(page)).some((label) => label.labelTier === "ordinary")).toBe(true);

  for (const stationId of ["shinjuku", "tokyo", "yokohama", "omiya"]) {
    const station = railwayBundle.network.stationsById.get(stationId)!;
    await page.evaluate((center) => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
      hook.map.jumpTo({ center, zoom: 13.5 });
    }, station.coordinates);
    await expect.poll(async () => (await renderedStationLabels(page)).some((label) => label.id === stationId)).toBe(true);
    const labels = await renderedStationLabels(page);
    expect(new Set(labels.map((label) => label.id)).size).toBe(labels.length);
    await page.screenshot({ path: testInfo.outputPath(`labels-${stationId}.png`) });
  }

  const expectedLabels = [
    ["hamamatsucho", "浜松町・大門"],
    ["metro-korakuen", "後楽園・春日"],
    ["odakyu-shin-yurigaoka", "新百合ヶ丘・新百合ケ丘"],
  ] as const;
  for (const [stationId, expectedName] of expectedLabels) {
    const station = railwayBundle.network.stationsById.get(stationId)!;
    await page.evaluate((center) => {
      const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
      hook.map.jumpTo({ center, zoom: 13.5 });
    }, station.coordinates);
    await expect.poll(async () => (await renderedStationLabels(page)).some((label) => label.id === stationId && label.name === expectedName)).toBe(true);
  }
});

test("the service legend collapses; 山手線 progress and 現在地 stay visible", async ({ page }) => {
  await startReadyGame(page);
  await openGameMenu(page);
  const panel = gamePanel(page);
  const legend = panel.getByRole("list", { name: "凡例" });
  const toggle = panel.getByRole("button", { name: /路線の凡例/ });
  const serviceRow = panel.getByRole("checkbox", { name: "京浜東北線を表示" });
  const jrOperator = panel.locator(".game-panel__legend-operator").filter({ hasText: "東日本旅客鉄道" });
  await expect(legend.getByRole("listitem").filter({ hasText: "山手線 踏破済み" })).toBeVisible();
  await expect(legend.getByRole("listitem").filter({ hasText: "山手線 未踏破" })).toBeVisible();
  await expect(legend.getByRole("listitem").filter({ hasText: /^現在地$/ })).toBeVisible();
  await expect(legend).toContainText("現在地・乗車中の路線・山手線の進捗は常に表示します。");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(serviceRow).toBeHidden();
  await expect(panel.getByRole("button", { name: "サイコロを振る" })).toBeInViewport();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await jrOperator.locator("summary").click();
  await expect(serviceRow).toBeVisible();
  if (isPhone(page)) {
    await screenshot(page, "phone-legend-expanded");
  }
  await toggle.click();
  await expect(serviceRow).toBeHidden();
  await expect(legend.getByRole("listitem").filter({ hasText: "山手線 踏破済み" })).toBeVisible();
  await toggle.click();
  await expect(serviceRow).toBeVisible();
  await toggle.click();
  await expect(serviceRow).toBeHidden();
  await toggle.click();
  await expect(serviceRow).toBeVisible();
});

test("pending guidance and heading", async ({ page, railwayBundle }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "This paint comparison uses one desktop viewport");
  const game = midGameWithYamanoteProgress(railwayBundle);
  await page.goto("/");
  await writeSaveText(page, serializeGame(game));
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect.poll(async () => (await readMap(page))?.styleLoaded).toBe(true);

  const expectedBearing = displayedHeading(
    { stationId: game.currentStationId },
    { serviceId: game.currentServiceId, direction: game.direction },
    railwayBundle.network,
  );
  expect(game.turn).toBe(18);
  expect(game.currentStationId).toBe("tokyo");
  expect(game.direction).toBe(1);
  expect(expectedBearing).not.toBeNull();
  expect(expectedBearing).toBeCloseTo(TOKYO_OUTER_LOOP_BEARING, 1);
  const snapshot = await readMap(page);
  expect(snapshot?.markerBearing).toBeCloseTo(expectedBearing!, 0);
  const nextStation = nextStationId(railwayBundle.network, game.currentServiceId, game.currentStationId, game.direction);
  expect(nextStation).toBeDefined();
  const screenBearing = await page.evaluate(({ from, to }) => {
    const map = (window as unknown as { __sugorokuE2E: { map: {
      project(coordinates: [number, number]): { x: number; y: number };
    } } }).__sugorokuE2E.map;
    const start = map.project(from);
    const end = map.project(to);
    return (Math.atan2(end.x - start.x, start.y - end.y) * 180 / Math.PI + 360) % 360;
  }, {
    from: railwayBundle.network.servicesById.get(game.currentServiceId)!.platformCoordinates[game.currentStationId]!,
    to: railwayBundle.network.servicesById.get(game.currentServiceId)!.platformCoordinates[nextStation!]!,
  });
  const headingPixels = await readHeadingPixels(page);
  const renderedBearing = sampledHeadingDirection(headingPixels.redPixels);
  expect(
    angularDifference(renderedBearing, screenBearing),
    `rendered beak ${renderedBearing}° should point toward the next platform at ${screenBearing}°; ` +
      `marker bearing=${snapshot?.markerBearing}, red samples=${headingPixels.redPixels.length}`,
  ).toBeLessThanOrEqual(HEADING_MATCH_TOLERANCE_DEGREES);
  expect(headingPixels.redPixels.length, "the heading SDF should occupy its full rendered footprint").toBeGreaterThanOrEqual(MIN_HEADING_RED_PIXELS);

  const casingPaint = await page.evaluate((layerId) => {
    const map = (window as unknown as { __sugorokuE2E: { map: {
      getPaintProperty(id: string, name: string): unknown;
    } } }).__sugorokuE2E.map;
    return {
      color: map.getPaintProperty(layerId, "line-color"),
      width: map.getPaintProperty(layerId, "line-width"),
      dash: map.getPaintProperty(layerId, "line-dasharray"),
    };
  }, LAYER_IDS.segmentsPendingCasing);
  expect(casingPaint).toEqual({ color: "#ffffff", width: 8, dash: [1, 0.75] });

  const backgroundId = await page.evaluate(() => {
    const map = (window as unknown as { __sugorokuE2E: { map: {
      getStyle(): { layers: { id: string; type: string }[] };
    } } }).__sugorokuE2E.map;
    const background = map.getStyle().layers.find((layer) => layer.type === "background");
    if (!background) throw new Error("The basemap background layer is missing");
    return background.id;
  });
  const backgroundPaints = ["#faf7ef", "#263238"] as const;
  for (const color of backgroundPaints) {
    const appliedColor = await page.evaluate(({ layerId, backgroundColor }) => {
      const map = (window as unknown as { __sugorokuE2E: { map: {
        setPaintProperty(id: string, name: string, value: string): void;
        getPaintProperty(id: string, name: string): unknown;
      } } }).__sugorokuE2E.map;
      map.setPaintProperty(layerId, "background-color", backgroundColor);
      return map.getPaintProperty(layerId, "background-color");
    }, { layerId: backgroundId, backgroundColor: color });
    expect(appliedColor).toBe(color);

    const snapshot = await readMap(page);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.markerRendered).toBe(true);
    expect(snapshot!.markerBearing).toEqual(expect.any(Number));
    expect(snapshot!.headingRendered).toBe(true);
    expect(snapshot!.pendingPaint.color).toBe("#c040cf");
    expect(snapshot!.pendingPaint.dash).toEqual([2, 1.5]);
    expect(snapshot!.completedPaint.dash).toBeNull();
    expect(snapshot!.completedPaint.color).not.toEqual(snapshot!.pendingPaint.color);
    expect(snapshot!.completedRenderedIds.length).toBeGreaterThan(0);
    expect(snapshot!.pendingRenderedIds.length).toBeGreaterThan(0);
  }
});

test("clicking an ordinary station opens exactly one popup naming it", async ({ page, railwayBundle }) => {
  await startReadyGame(page);
  const { network } = railwayBundle;
  const ordinary = [...network.stationsById.values()].find(
    (station) => (network.servicesByStation.get(station.id) ?? []).length === 1 && !network.servicesByStation.get(station.id)!.includes(TARGET_SERVICE_ID),
  )!;
  await page.evaluate((center) => {
    const hook = (window as unknown as { __sugorokuE2E: { map: { jumpTo(options: { center: [number, number]; zoom: number }): void } } }).__sugorokuE2E;
    hook.map.jumpTo({ center, zoom: 13.5 });
  }, ordinary.coordinates);
  await expect.poll(async () => (await renderedStationIds(page)).includes(ordinary.id)).toBe(true);
  const [point] = await project(page, [ordinary.coordinates]);
  await page.mouse.click(point!.x, point!.y);
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toHaveCount(1);
  await expect(popup).toContainText(ordinary.name);
});
