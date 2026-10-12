import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { GameState, MoveRecord } from "../../../src/types/network";
import type { RailwayBundle } from "../fixtures/bundle";
import { LAYER_IDS, SOURCE_IDS } from "../../../src/features/map/mapConfig";

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

export type SavedMove = MoveRecord;
export type SavedGame = GameState;

export interface MapSnapshot {
  styleLoaded: boolean;
  /** Coordinates in the marker's GeoJSON source. */
  marker: [number, number] | null;
  /** The marker layer draws a visible feature at `marker` (not just stored). */
  markerRendered: boolean;
  /** Segment ids in the completed layer's `in` filter literal. */
  completedFilterIds: string[];
  /** Segment ids the completed / pending line layers actually render. */
  completedRenderedIds: string[];
  pendingRenderedIds: string[];
  /** Paint that tells the two layers apart (spec 6.2: colour and line style). */
  completedPaint: LinePaint;
  pendingPaint: LinePaint;
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
  return page.getByRole("region", { name: "ゲーム操作" });
}

export function diceButton(page: Page): Locator {
  return gamePanel(page).getByRole("button", { name: /サイコロを振る|移動中…/ });
}

/** The <dd> next to a <dt> label in the panel stats. */
export function panelStat(page: Page, label: string): Locator {
  return gamePanel(page)
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");
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

/** Roll once and wait until the move has settled (idle panel or clear screen). */
export async function rollOnce(page: Page): Promise<void> {
  const turnBefore = (await readSave(page))?.turn ?? 0;
  await diceButton(page).click();
  await expect.poll(async () => (await readSave(page))?.turn).toBe(turnBefore + 1);
  const clear = page.getByRole("heading", { name: "クリア！" });
  await expect(diceButton(page).filter({ hasText: "サイコロを振る" }).or(clear)).toBeVisible();
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
      if (!map) return null;
      const data = (await map.getSource(markerSourceId)?.getData()) as
        | { features: { geometry: { coordinates: [number, number] } }[] }
        | undefined;
      const marker = data?.features[0]?.geometry.coordinates ?? null;
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
      // Target-scoped v2 filter: ["all", target, ["in", ["get", "featureId"], ["literal", ids]]]
      const filter = map.getFilter(layers.completed) as [string, unknown, [string, unknown, [string, string[]]]];
      return {
        styleLoaded: Boolean(map.isStyleLoaded()),
        marker,
        markerRendered:
          marker !== null &&
          map.queryRenderedFeatures(map.project(marker), { layers: [layers.marker] }).length > 0 &&
          isPositive(map.getPaintProperty(layers.marker, "circle-radius")) &&
          isPositive(map.getPaintProperty(layers.marker, "circle-opacity") ?? 1),
        completedFilterIds: filter?.[2]?.[2]?.[1] ?? [],
        completedRenderedIds: renderedIds(layers.completed),
        pendingRenderedIds: renderedIds(layers.pending),
        completedPaint: paint(layers.completed),
        pendingPaint: paint(layers.pending),
      };
    },
    {
      layers: {
        completed: LAYER_IDS.segmentsCompleted,
        pending: LAYER_IDS.segmentsPending,
        marker: LAYER_IDS.currentPosition,
      },
      markerSourceId: SOURCE_IDS.currentPosition,
    },
  );
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
export function targetFeatureIds(game: Pick<SavedGame, "completedSegmentIds">): string[] {
  return targetCompletedIds(game).map((id) => id.replace(/:([^:]+):([^:]+)$/, ":$1~$2"));
}

/** The platform the committed (next) ride uses after the landing. */
export function markerPosition(bundle: RailwayBundle, save: SavedGame): [number, number] {
  const point = bundle.network.servicesById.get(save.currentServiceId)?.platformCoordinates[save.currentStationId];
  if (!point) throw new Error("Missing platform point");
  return point;
}
