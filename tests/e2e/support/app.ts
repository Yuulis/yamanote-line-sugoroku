import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { ItemGameState, ItemTurnRecord } from "../../../src/types/network";
import type { RailwayBundle } from "../fixtures/bundle";
import { LAYER_IDS, SOURCE_IDS } from "../../../src/features/map/mapConfig";
import { createItemGame, playItemTurn, resolveItemDiscard } from "../../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../../src/features/game/gameConfig";
import type { MoveEvent } from "../../../src/features/game/engine";
import { buildGeometryIndex, buildMovePlan } from "../../../src/features/game/animation/movePath";
import { hopDurationMs, MAX_MOVE_DURATION_MS } from "../../../src/features/game/animation/timeline";

// Page helpers shared by the specs. Selectors are role / accessible-name
// based; the game state is read from the app's own save (localStorage) and
// the live map from the opt-in hook (src/features/map/e2eHook.ts).

export const SAVE_STORAGE_KEY = "yamanote-line-sugoroku:save:v1";
export const REQUIRED_SEGMENTS = 30;
/**
 * How far ahead of the page clock `freezeClock` pauses. Generous on purpose:
 * under parallel load a software-rendered page can stall for over a second
 * between reading the time and pausing, and pausing "in the past" throws.
 */
const FREEZE_AHEAD_MS = 60_000;

export type SavedMove = ItemTurnRecord;
export type SavedGame = ItemGameState;

export interface MapSnapshot {
  styleLoaded: boolean;
  highlightedFeatureIds: string[];
  highlightedColor: unknown;
  highlightedRenderedIds: string[];
  /** Coordinates in the marker's GeoJSON source. */
  marker: [number, number] | null;
  /** The marker layer draws a visible feature at `marker` (not just stored). */
  markerRendered: boolean;
  /** Reveal-gated heading written to the marker source. */
  markerBearing: number | null;
  /** The separately rendered SDF heading symbol at the marker position. */
  headingRendered: boolean;
  /** Geometry feature ids in the completed layer's `in` filter literal. */
  completedFilterIds: string[];
  /** Geometry feature ids the completed / pending line layers actually render. */
  completedRenderedIds: string[];
  pendingRenderedIds: string[];
  /** Paint that tells the two layers apart (spec 6.2: colour and line style). */
  completedPaint: LinePaint;
  pendingPaint: LinePaint;
  /** Geometry feature ids in the arrival flash layer's `in` filter literal (S13); empty when nothing flashes. */
  flashFilterIds: string[];
  /** The flash layer's `line-opacity`; null when the layer is missing. */
  flashOpacity: number | null;
}

export interface HeadingPixelSnapshot {
  /** Beak-layer red pixels, in CSS-pixel offsets from the marker centre. */
  redPixels: [number, number][];
}

export interface LinePaint {
  color: unknown;
  dash: unknown;
}

/** `source` of public/data/manifest.json: what the credits must show. */
export interface ManifestSource {
  attribution: string;
  license: string;
  url: string;
}

export interface Station {
  id: string;
  name: string;
  coordinates: [number, number];
}

/** The title screen (<main>, labelled by its heading). */
export function titleScreen(page: Page): Locator {
  return page.getByRole("main", { name: "山手線すごろく" });
}

export function gamePanel(page: Page): Locator {
  return page.getByRole("main", { name: "ゲーム操作" });
}

export function diceButton(page: Page): Locator {
  return gamePanel(page).getByRole("button", { name: /サイコロを振る|移動中…/ });
}

/** `data-stat` marker for each panel stat label (the value span, not the <dd>). */
const STAT_DATA_BY_LABEL: Readonly<Record<string, string>> = {
  "現在駅": "station",
  "乗車中": "ride",
  "進行方向": "direction",
  "ターン数": "turn",
  "踏破区間": "progress",
  "出目": "roll",
};

/** Compact roll value shown in the HUD. */
export function hudCompactRoll(page: Page): Locator {
  return gamePanel(page).locator('[data-stat="roll-compact"]');
}

/** The value span of a panel stat, found by its <dt> label through `data-stat`. */
export function panelStat(page: Page, label: string): Locator {
  const stat = STAT_DATA_BY_LABEL[label];
  if (!stat) throw new Error(`Unknown game panel stat label: ${label}`);
  return gamePanel(page).locator(`[data-stat="${stat}"]`);
}

/** Open the turn log if needed and wait for its labelled region to be visible. */
export async function openGameLog(page: Page): Promise<void> {
  const trigger = gamePanel(page).getByRole("button", { name: "ログ", exact: true });
  const region = gamePanel(page).getByRole("region", { name: "ターンのログ", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(region).toBeVisible();
}

/** Close the turn log if needed and wait for its labelled region to be hidden. */
export async function closeGameLog(page: Page): Promise<void> {
  const trigger = gamePanel(page).getByRole("button", { name: "ログ", exact: true });
  const region = gamePanel(page).getByRole("region", { name: "ターンのログ", exact: true });
  if (await trigger.getAttribute("aria-expanded") === "true") await trigger.click();
  await expect(region).toBeHidden();
}

/** Open the game menu if needed and wait for its labelled region to be visible. */
export async function openGameMenu(page: Page): Promise<void> {
  const trigger = gamePanel(page).getByRole("button", { name: "メニュー", exact: true });
  const region = gamePanel(page).getByRole("region", { name: "メニュー", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(region).toBeVisible();
}

/** Close the game menu if needed and wait for its labelled region to be hidden. */
export async function closeGameMenu(page: Page): Promise<void> {
  const trigger = gamePanel(page).getByRole("button", { name: "メニュー", exact: true });
  const region = gamePanel(page).getByRole("region", { name: "メニュー", exact: true });
  if (await trigger.getAttribute("aria-expanded") === "true") await trigger.click();
  await expect(region).toBeHidden();
}

/**
 * Locate an inventory slot by its visible item heading. S20 keeps that
 * heading inside `.item-slot`; S21 adds an item-card opener to the slot and
 * labels the resulting dialog with the same item name.
 */
export function inventoryItem(page: Page, name: string): Locator {
  return gamePanel(page).locator(".item-slot")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

/** Open an item's card, then activate its 使う action. */
export async function useInventoryItem(page: Page, name: string): Promise<void> {
  await inventoryItem(page, name).getByRole("button").click();
  const card = gamePanel(page).getByRole("dialog", { name, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "使う", exact: true }).click();
}

export async function openTitle(page: Page): Promise<void> {
  await page.goto("/");
  await expect(titleScreen(page)).toBeVisible();
}

export async function startNewGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "はじめから" }).click();
  await expect(gamePanel(page)).toBeVisible();
  await expect(panelStat(page, "ターン数")).toHaveText("0");
}

/**
 * The dice once it accepts a roll: it keeps its label while a post-move reveal
 * disables it, so readiness is `aria-disabled="false"`, never the label alone.
 */
export function diceReady(page: Page): Locator {
  return diceButton(page).and(page.locator('[aria-disabled="false"]'));
}

/**
 * Roll once and wait until the move has settled: the saved turn, any presented
 * discard dialog resolved, then an enabled dice (or the clear screen).
 *
 * Works under reduced motion and with a real clock. Under a frozen clock the
 * caller must advance every active stage first (see `./turnMoments`).
 */
export async function rollOnce(page: Page): Promise<void> {
  const turnBefore = (await readSave(page))?.turn ?? 0;
  await revealUnadjustedRoll(page);
  await expect.poll(async () => {
    const save = await readSave(page);
    return save?.pending?.kind === "discard" || save?.turn === turnBefore + 1;
  }).toBe(true);
  if ((await readSave(page))?.pending?.kind === "discard") {
    // A saved pending record is not proof the dialog is mounted: wait for it.
    const discard = page.getByRole("dialog", { name: "捨てるアイテムを選ぶ" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button").last().click();
  }
  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  const clear = page.getByRole("heading", { name: "クリア！" });
  await expect(diceReady(page).or(clear)).toBeVisible();
}

/**
 * Whether the saved record shows modifier stamps after the tumble (S11), read
 * from the record's own fields rather than the production predicate: rapid,
 * oversleep, a roll adjustment, a double ticket, a forced (delayed) face or an
 * activated delay. Deadhead turns have no die and no stamps. Frozen-clock
 * callers advance `advanceStamps` exactly when this is true.
 */
export function stampsExpected(record: SavedMove): boolean {
  if (record.kind !== "item-ride") return false;
  return record.movementMode !== "normal" || record.adjustment !== null
    || record.command.items.some((item) => item.kind === "double") || record.effectiveFace !== record.rawRoll
    || record.itemEvents.some((event) => event.type === "effect-activated" && event.effect === "delay");
}

/** The dice tumble / stamps card of the turn-moment overlay (S11). */
export function diceMoment(page: Page): Locator {
  return page.locator(".turn-moment-host .dice-tumble");
}

/**
 * Click the dice once and return the saved turn number from just before the
 * click. Pair it with `waitForRollOutcome`; between the two, a frozen-clock test
 * advances the tumble (`advanceTumble`); after the outcome it advances the
 * stamps (`advanceStamps`) when `stampsExpected` holds for the saved record.
 */
export async function clickDice(page: Page): Promise<number> {
  const turnBefore = (await readSave(page))?.turn ?? 0;
  await diceButton(page).click();
  return turnBefore;
}

/**
 * Wait for the outcome of a dice click made at `turnBefore` and explicitly
 * decline adjustment; leave movement/discard visible.
 *
 * A saved pending roll (`pending.kind === "roll"`) only means an adjustment
 * decision exists, not that its dialog is mounted, so the helper waits for the
 * actual `role=dialog`. Under a frozen clock the dialog cannot appear until the
 * tumble is advanced (S11), which is why this wait is separate from the click.
 */
export async function waitForRollOutcome(page: Page, turnBefore: number): Promise<void> {
  const adjustment = page.getByRole("dialog", { name: "出目を調整しますか？" });
  await expect.poll(async () => {
    const save = await readSave(page);
    if (save?.pending?.kind === "roll") return await adjustment.isVisible();
    return await adjustment.isVisible() || save?.pending?.kind === "discard" || save?.turn === turnBefore + 1;
  }).toBe(true);
  if (await adjustment.isVisible()) await adjustment.getByRole("button", { name: "そのまま続ける" }).click();
}

/**
 * Reveal a die, explicitly declining adjustment; leave movement/discard visible.
 * Composes `clickDice` and `waitForRollOutcome`, so it is only usable with a real
 * clock or reduced motion; a frozen-clock caller calls the two steps itself and
 * advances the tumble between them (S11: an adjustment dialog appears only after
 * the tumble).
 */
export async function revealUnadjustedRoll(page: Page): Promise<void> {
  await waitForRollOutcome(page, await clickDice(page));
}

/** The part of the saved game that tells an accepted save from a pending or failed one. */
export interface SaveObservation {
  turn: number;
  pendingKind: "roll" | "discard" | null;
  history: number;
}

/** Read the stored save as a `SaveObservation`; null when nothing is stored. */
export async function observeSave(page: Page): Promise<SaveObservation | null> {
  const save = await readSave(page);
  return save === null ? null : { turn: save.turn, pendingKind: save.pending?.kind ?? null, history: save.movementHistory.length };
}

/**
 * Wait until storage holds the acknowledged save of `turn`: that turn is
 * committed with no pending decision and one history record per turn. A pending
 * roll/discard record, or the previous turn after a failed write, does not pass.
 * The poll stops at the first matching read; "exactly one turn" is proven by
 * `history === turn` (one record per turn), and callers that must exclude a
 * later extra turn assert again after their next checkpoint.
 */
export async function expectAcceptedSave(page: Page, turn: number): Promise<void> {
  await expect.poll(() => observeSave(page)).toEqual({ turn, pendingKind: null, history: turn });
}

/**
 * Stop time in the page (clock must be installed before navigation): no
 * animation frame runs afterwards, so a started move stays "in progress"
 * until the test presses スキップ, and assertions never race the animation.
 */
export async function freezeClock(page: Page): Promise<void> {
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + FREEZE_AHEAD_MS);
}

export async function readSaveText(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SAVE_STORAGE_KEY);
}

export async function readSave(page: Page): Promise<SavedGame | null> {
  const text = await readSaveText(page);
  return text === null ? null : (JSON.parse(text) as SavedGame);
}

export async function writeSaveText(page: Page, text: string): Promise<void> {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: SAVE_STORAGE_KEY,
    value: text,
  });
}

/** Live map state, or null while no map with railway layers exists. */
export async function readMap(page: Page): Promise<MapSnapshot | null> {
  return page.evaluate(
    async ({ layers, markerSourceId }) => {
      interface RenderedFeature {
        properties: Record<string, unknown>;
      }
      interface HookMap {
        isStyleLoaded(): boolean | void;
        getLayer(layerId: string): unknown;
        getFilter(layerId: string): unknown;
        getPaintProperty(layerId: string, name: string): unknown;
        getSource(id: string): { getData(): Promise<unknown> } | undefined;
        project(lngLat: [number, number]): unknown;
        queryRenderedFeatures(
          pointOrOptions?: unknown,
          options?: { layers: string[] },
        ): RenderedFeature[];
      }
      const hook = (window as unknown as { __sugorokuE2E?: { map?: HookMap | null } })
        .__sugorokuE2E;
      const map = hook?.map;
      // A replaced style drops the railway layers until "style.load" re-adds them.
      if (!map || !map.getLayer(layers.completed)) return null;
      const data = (await map.getSource(markerSourceId)?.getData()) as
        | { features: { geometry: { coordinates: [number, number] }; properties: { bearing?: unknown } }[] }
        | undefined;
      const markerFeature = data?.features[0];
      const marker = markerFeature?.geometry.coordinates ?? null;
      const markerBearing = typeof markerFeature?.properties.bearing === "number" ? markerFeature.properties.bearing : null;
      const renderedIds = (layerId: string): string[] => {
        if (!map.getLayer(layerId)) return [];
        const features = map.queryRenderedFeatures({ layers: [layerId] });
        return [...new Set(features.map((feature) => String(feature.properties.featureId)))];
      };
      // Hit-testing ignores opacity and a zero radius still hits via the
      // stroke, so a hidden marker is also caught from its paint.
      const isPositive = (value: unknown): boolean => typeof value === "number" && value > 0;
      const paint = (layerId: string) => ({
        color: map.getPaintProperty(layerId, "line-color") ?? null,
        dash: map.getPaintProperty(layerId, "line-dasharray") ?? null,
      });
      // Target-scoped v3 filter: ["all", target, ["in", ["get", "featureId"], ["literal", ids]]]
      const filter = map.getFilter(layers.completed) as [string, unknown, [string, unknown, [string, string[]]]];
      // The flash layer uses the same target-scoped filter shape.
      const flashFilter = map.getLayer(layers.flash)
        ? map.getFilter(layers.flash) as [string, unknown, [string, unknown, [string, string[]]]]
        : null;
      const flashOpacity = map.getLayer(layers.flash) ? map.getPaintProperty(layers.flash, "line-opacity") : null;
      return {
        styleLoaded: Boolean(map.isStyleLoaded()),
        highlightedFeatureIds: (map.getFilter(layers.highlighted) as [string, unknown, [string, string[]]])?.[2]?.[1] ?? [],
        highlightedColor: map.getPaintProperty(layers.highlighted, "line-color"),
        highlightedRenderedIds: renderedIds(layers.highlighted),
        marker,
        markerRendered:
          marker !== null &&
          map.queryRenderedFeatures(map.project(marker), { layers: [layers.marker] }).length > 0 &&
          isPositive(map.getPaintProperty(layers.marker, "circle-radius")) &&
          isPositive(map.getPaintProperty(layers.marker, "circle-opacity") ?? 1),
        markerBearing,
        headingRendered:
          marker !== null && markerBearing !== null &&
          map.queryRenderedFeatures(map.project(marker), { layers: [layers.heading] }).length > 0,
        completedFilterIds: filter?.[2]?.[2]?.[1] ?? [],
        completedRenderedIds: renderedIds(layers.completed),
        pendingRenderedIds: renderedIds(layers.pending),
        completedPaint: paint(layers.completed),
        pendingPaint: paint(layers.pending),
        flashFilterIds: flashFilter?.[2]?.[2]?.[1] ?? [],
        flashOpacity: typeof flashOpacity === "number" ? flashOpacity : null,
      };
    },
    {
      layers: {
        highlighted: LAYER_IDS.currentService,
        completed: LAYER_IDS.segmentsCompleted,
        pending: LAYER_IDS.segmentsPending,
        heading: LAYER_IDS.currentPositionHeading,
        flash: LAYER_IDS.segmentsFlash,
        marker: LAYER_IDS.currentPosition,
      },
      markerSourceId: SOURCE_IDS.currentPosition,
    },
  );
}

/** Read the rendered heading symbol from WebGL with every other style layer hidden. */
export async function readHeadingPixels(page: Page): Promise<HeadingPixelSnapshot> {
  return page.evaluate(async ({ headingLayerId, markerSourceId }) => {
    interface RenderedFeature {
      geometry: { coordinates: [number, number] };
    }
    interface HookMap {
      getStyle(): { layers: { id: string }[] };
      getLayer(layerId: string): unknown;
      getLayoutProperty(layerId: string, name: string): unknown;
      setLayoutProperty(layerId: string, name: string, value: string): void;
      getSource(id: string): { getData(): Promise<{ features: RenderedFeature[] }> } | undefined;
      project(lngLat: [number, number]): { x: number; y: number };
      getCanvas(): HTMLCanvasElement;
      once(type: string, listener: () => void): void;
      triggerRepaint(): void;
    }
    const hook = (window as unknown as { __sugorokuE2E?: { map?: HookMap | null } }).__sugorokuE2E;
    const map = hook?.map;
    if (!map || !map.getLayer(headingLayerId)) throw new Error("The heading layer is not available");
    const feature = (await map.getSource(markerSourceId)?.getData())?.features[0];
    if (!feature) throw new Error("The heading marker source is empty");

    const originalVisibility = map.getStyle().layers.map(({ id }) => ({
      id,
      visible: map.getLayoutProperty(id, "visibility") !== "none",
    }));
    for (const { id } of originalVisibility) {
      if (id !== headingLayerId) map.setLayoutProperty(id, "visibility", "none");
    }
    try {
      const render = new Promise<void>((resolve) => map.once("render", resolve));
      map.triggerRepaint();
      await render;

      const canvas = map.getCanvas();
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) throw new Error("The map canvas has no readable WebGL context");
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      const marker = map.project(feature.geometry.coordinates);
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      const sampleRadius = 18;
      const redPixels: [number, number][] = [];
      for (let offsetY = -sampleRadius; offsetY <= sampleRadius; offsetY += 1) {
        for (let offsetX = -sampleRadius; offsetX <= sampleRadius; offsetX += 1) {
          const x = Math.floor((marker.x + offsetX) * scaleX);
          const y = canvas.height - 1 - Math.floor((marker.y + offsetY) * scaleY);
          if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
          const pixelOffset = (y * canvas.width + x) * 4;
          const red = pixels[pixelOffset]!;
          const green = pixels[pixelOffset + 1]!;
          const blue = pixels[pixelOffset + 2]!;
          if (red > 120 && red > green * 1.7 && red > blue * 1.7) redPixels.push([offsetX, offsetY]);
        }
      }
      return { redPixels };
    } finally {
      for (const { id, visible } of originalVisibility) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
      map.triggerRepaint();
    }
  }, { headingLayerId: LAYER_IDS.currentPositionHeading, markerSourceId: SOURCE_IDS.currentPosition });
}

/**
 * Exact natural movement time of a replayed turn: the sum of the distance-based
 * hop durations (P1 planner) at `stepMs`, capped like the app. It is never
 * `physicalHops * stepMs`. Callers replay the turn offline and check the replay
 * against the saved record before trusting the number.
 */
export function movementDurationMs(bundle: RailwayBundle, events: readonly MoveEvent[], stepMs: number): number {
  const geometry = buildGeometryIndex(bundle.data.geometry.ok ? bundle.data.geometry.value : undefined);
  const plan = buildMovePlan(events, bundle.network, geometry);
  return Math.min(plan.reduce((sum, step) => sum + hopDurationMs(step, stepMs), 0), MAX_MOVE_DURATION_MS);
}

/** Stations from the app's own data (served by `vite preview`). */
export async function loadStations(request: APIRequestContext | RailwayBundle): Promise<Map<string, Station>> {
  if ("network" in request) return new Map(request.network.stationsById);
  const response = await request.get("data/stations.json");
  expect(response.ok()).toBe(true);
  const stations = (await response.json()) as Station[];
  return new Map(stations.map((station) => [station.id, station]));
}

/** Data credit from the app's own manifest (served by `vite preview`). */
export async function loadManifestSource(request: APIRequestContext | RailwayBundle): Promise<ManifestSource> {
  if ("data" in request) {
    if (!request.data.manifest.ok) throw new Error("Bundle manifest failed to load");
    return request.data.manifest.value.source;
  }
  const response = await request.get("data/manifest.json");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { source: ManifestSource };
  return manifest.source;
}

/** Goal progress excludes every non-Yamanote directed segment. */
export function targetCompletedIds(game: Pick<SavedGame, "completedSegmentIds">): string[] {
  return game.completedSegmentIds.filter((id) => id.startsWith("jr-yamanote:"));
}

/** Canonical feature ids for the Yamanote +1 directed pair contract. */
export function targetFeatureIds(game: Pick<SavedGame, "completedSegmentIds">, bundle: RailwayBundle): string[] {
  return [...new Set(targetCompletedIds(game).flatMap((id) => {
    const segment = bundle.network.segmentsById.get(id);
    if (!segment) throw new Error(`Missing completed segment ${id}`);
    return segment.geometryFeatureIds;
  }))];
}

/** The platform the committed (next) ride uses after the landing. */
export function markerPosition(bundle: RailwayBundle, save: SavedGame): [number, number] {
  const point = bundle.network.servicesById.get(save.currentServiceId)?.platformCoordinates[save.currentStationId];
  if (!point) throw new Error("Missing platform point");
  return point;
}

/** Pinned engine replay: forced oversleep stamps, lottery and full-inventory pickup on turn 11. */
export function combinedMomentGame(bundle: RailwayBundle): ItemGameState {
  let game: ItemGameState = createItemGame(ITEM_GAME_CONFIG, "00000000000000000000000000001bdc", bundle.network);
  while (game.turn < 10) {
    game = playItemTurn(game, {}, bundle.network).state;
    if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
  }
  return game;
}
