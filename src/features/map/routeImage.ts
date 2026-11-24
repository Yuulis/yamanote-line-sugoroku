import { Map as MapLibreMap, type MapOptions } from "maplibre-gl";
import type { ClearRoute } from "../game/clearResult";
import { buildClearRouteGeoJson } from "../game/clearRoute";
import type { GameSummary } from "../game/gameSummary";
import { applyClearRouteLayers } from "./clearRouteLayers";
import { CC_BY_LICENSE_NAME, CC_BY_URL } from "./attribution";
import { MAP_CENTER, MAP_CREDITS, MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_STYLE_URL } from "./mapConfig";

export const ROUTE_IMAGE_WIDTH = 1200;
export const ROUTE_IMAGE_HEIGHT = 675;
export const ROUTE_IMAGE_TIMEOUT_MS = 15_000;
export const ROUTE_IMAGE_FILENAME = "yamanote-sugoroku-route.png";

const TOP_BAND_HEIGHT = 78;
const BOTTOM_BAND_TOP = 500;
const BAND_HORIZONTAL_PADDING = 32;
const IMAGE_TEXT_COLOR = "#14242e";
const IMAGE_FONT_STACK = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
const STAT_LABELS = ["所要ターン数", "移動回数", "乗換回数"] as const;
const OSM_CREDIT = "© OpenStreetMap contributors (openstreetmap.org/copyright)";

export interface RouteImageRailwayCredit {
  readonly source: string;
  readonly licenseName: string;
  readonly licenseUrl: string | null;
}

export interface RouteImageInput {
  readonly route: ClearRoute;
  readonly title: string;
  readonly editionName: string;
  readonly summary: GameSummary;
  readonly railwayCredit: RouteImageRailwayCredit;
}

/** Narrow view of MapLibre used by the exporter; tests supply the same event and rendering surface. */
export type ExportMap = Pick<
  MapLibreMap,
  | "on"
  | "off"
  | "getCanvas"
  | "getStyle"
  | "getSource"
  | "getLayer"
  | "addSource"
  | "addLayer"
  | "removeLayer"
  | "removeSource"
  | "fitBounds"
  | "triggerRepaint"
  | "redraw"
  | "remove"
>;

export interface ExportMapFactory {
  create(container: HTMLElement, options: Omit<MapOptions, "container">): ExportMap;
}

export interface RouteImageDependencies {
  readonly mapFactory: ExportMapFactory;
  readonly createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

export interface PreparedRouteImage {
  readonly blob: Blob;
  readonly file: File;
  readonly url: string;
  readonly filename: string;
}

export type RouteImageState =
  | { readonly kind: "unavailable" | "pending" | "failed" }
  | { readonly kind: "ready"; readonly image: PreparedRouteImage };

export const browserRouteImageDependencies: RouteImageDependencies = {
  mapFactory: {
    create: (container, options) => new MapLibreMap({ ...options, container }),
  },
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

function railwayCreditText(credit: RouteImageRailwayCredit): string {
  const uri = credit.licenseName === CC_BY_LICENSE_NAME ? CC_BY_URL : credit.licenseUrl;
  const license = uri ? `${credit.licenseName} ${uri}` : credit.licenseName;
  return `鉄道データ: ${credit.source}（${license}）`;
}

function creditLines(input: RouteImageInput): readonly string[] {
  const mapCredits: string[] = MAP_CREDITS.map(({ label }) => label === "© OpenStreetMap contributors" ? OSM_CREDIT : label);
  return [...mapCredits, railwayCreditText(input.railwayCredit)];
}

function wrapToWidth(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const character of Array.from(text)) {
    const candidate = `${current}${character}`;
    if (current !== "" && context.measureText(candidate).width > width) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function composeInformationBands(context: CanvasRenderingContext2D, input: RouteImageInput): void {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, ROUTE_IMAGE_WIDTH, TOP_BAND_HEIGHT);
  context.fillRect(0, BOTTOM_BAND_TOP, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT - BOTTOM_BAND_TOP);

  context.fillStyle = IMAGE_TEXT_COLOR;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.font = `700 24px ${IMAGE_FONT_STACK}`;
  context.fillText(input.title, BAND_HORIZONTAL_PADDING, 14);
  context.font = `400 16px ${IMAGE_FONT_STACK}`;
  context.fillText(input.editionName, BAND_HORIZONTAL_PADDING, 48);

  const values = [input.summary.turns, input.summary.moves, input.summary.transfers];
  const columnWidth = (ROUTE_IMAGE_WIDTH - BAND_HORIZONTAL_PADDING * 2) / STAT_LABELS.length;
  context.font = `600 16px ${IMAGE_FONT_STACK}`;
  STAT_LABELS.forEach((label, index) => {
    const value = values[index] ?? 0;
    const suffix = index === 0 ? "ターン" : "回";
    context.fillText(`${label}：${value}${suffix}`, BAND_HORIZONTAL_PADDING + columnWidth * index, BOTTOM_BAND_TOP + 16);
  });

  context.font = `400 12px ${IMAGE_FONT_STACK}`;
  let y = BOTTOM_BAND_TOP + 48;
  const lineHeight = 17;
  const maxWidth = ROUTE_IMAGE_WIDTH - BAND_HORIZONTAL_PADDING * 2;
  for (const creditLine of creditLines(input)) {
    for (const wrappedLine of wrapToWidth(context, creditLine, maxWidth)) {
      context.fillText(wrappedLine, BAND_HORIZONTAL_PADDING, y);
      y += lineHeight;
    }
  }
}

function exportError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason !== "") return new Error(reason);
  return new Error("MapLibre route image export failed");
}

function abortError(): Error {
  const error = new Error("Route image export was aborted");
  error.name = "AbortError";
  return error;
}

function combineErrors(errors: readonly Error[]): Error | null {
  if (errors.length === 0) return null;
  if (errors.length === 1) return errors[0] ?? null;
  return new AggregateError(errors, "Route image export cleanup failed");
}

function mapOn(map: ExportMap, event: "error" | "style.load" | "idle", listener: (event?: unknown) => void): void {
  map.on(event as never, listener as never);
}

function mapOff(map: ExportMap, event: "error" | "style.load" | "idle", listener: (event?: unknown) => void): void {
  map.off(event as never, listener as never);
}

/** Render the verified, complete route on a disposable 1200×675 MapLibre canvas and encode a PNG. */
export function renderRouteImage(
  input: RouteImageInput,
  signal: AbortSignal,
  dependencies: RouteImageDependencies = browserRouteImageDependencies,
): Promise<Blob> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<Blob>((resolve, reject) => {
    let container: HTMLDivElement | null = null;
    let imageCanvas: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D | null = null;
    let map: ExportMap | null = null;
    let setupComplete = false;
    let idleArmed = false;
    let captureStarted = false;
    let settled = false;
    let cleaned = false;
    let idleListener: ((event?: unknown) => void) | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let contextLostListener: ((event: Event) => void) | null = null;

    const releaseContainer = (): Error[] => {
      const currentContainer = container;
      if (!currentContainer) return [];
      container = null;
      if (!currentContainer.parentNode) return [];
      try {
        currentContainer.parentNode.removeChild(currentContainer);
        return [];
      } catch (error) {
        return [exportError(error)];
      }
    };

    const releaseMap = (): Error[] => {
      const currentMap = map;
      map = null;
      const cleanupErrors: Error[] = [];
      if (currentMap) {
        const onError = handleMapError;
        const onStyleLoad = handleStyleLoad;
        try { mapOff(currentMap, "error", onError); } catch (error) { cleanupErrors.push(exportError(error)); }
        try { mapOff(currentMap, "style.load", onStyleLoad); } catch (error) { cleanupErrors.push(exportError(error)); }
        if (idleListener) {
          try { mapOff(currentMap, "idle", idleListener); } catch (error) { cleanupErrors.push(exportError(error)); }
          idleListener = null;
        }
        if (contextLostListener) {
          try { currentMap.getCanvas().removeEventListener("webglcontextlost", contextLostListener); }
          catch (error) { cleanupErrors.push(exportError(error)); }
          contextLostListener = null;
        }
        try { currentMap.remove(); } catch (error) { cleanupErrors.push(exportError(error)); }
      }
      return [...cleanupErrors, ...releaseContainer()];
    };

    const cleanup = (): Error[] => {
      if (cleaned) return [];
      cleaned = true;
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      signal.removeEventListener("abort", handleAbort);
      const cleanupErrors = releaseMap();
      if (imageCanvas) {
        try {
          imageCanvas.width = 0;
          imageCanvas.height = 0;
        } catch (error) {
          cleanupErrors.push(exportError(error));
        }
      }
      imageCanvas = null;
      context = null;
      return cleanupErrors;
    };

    const settle = (blob: Blob | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      const cleanupErrors = cleanup();
      const allErrors = error === null ? cleanupErrors : [error, ...cleanupErrors];
      const finalError = combineErrors(allErrors);
      if (finalError) {
        reject(finalError);
        return;
      }
      if (!blob) {
        reject(new Error("PNG encoding returned no image"));
        return;
      }
      resolve(blob);
    };

    const fail = (reason: unknown): void => settle(null, exportError(reason));

    const handleAbort = (): void => settle(null, abortError());
    const handleTimeout = (): void => fail(new Error(`Route image export timed out after ${ROUTE_IMAGE_TIMEOUT_MS / 1000} seconds`));
    const handleContextLost = (): void => fail(new Error("WebGL context was lost during route image export"));
    const handleMapError = (event?: unknown): void => {
      const reason = typeof event === "object" && event !== null && "error" in event
        ? (event as { error?: unknown }).error
        : undefined;
      fail(reason ?? new Error("MapLibre reported a resource error during route image export"));
    };

    const handleIdle = (): void => {
      if (settled || !setupComplete || !idleArmed || captureStarted || !map || !imageCanvas || !context) return;
      captureStarted = true;
      try {
        map.redraw();
        const mapCanvas = map.getCanvas();
        if (mapCanvas.width !== ROUTE_IMAGE_WIDTH || mapCanvas.height !== ROUTE_IMAGE_HEIGHT) {
          throw new Error(`Export map canvas has unexpected size ${mapCanvas.width}×${mapCanvas.height}`);
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT);
        context.drawImage(mapCanvas, 0, 0);
        composeInformationBands(context, input);
        const mapCleanupError = combineErrors(releaseMap());
        if (mapCleanupError) throw mapCleanupError;
        imageCanvas.toBlob((blob) => {
          if (settled) return;
          if (!blob || blob.size === 0) {
            fail(new Error("PNG encoding returned an empty image"));
            return;
          }
          settle(blob, null);
        }, "image/png");
      } catch (error) {
        fail(error);
      }
    };

    const handleStyleLoad = (): void => {
      if (settled || setupComplete || !map) return;
      try {
        const added = applyClearRouteLayers(map as MapLibreMap, buildClearRouteGeoJson(input.route));
        if (!added) throw new Error("The export map style is not ready for the clear route");
        const [[southWestLongitude, southWestLatitude], [northEastLongitude, northEastLatitude]] = input.route.bounds;
        map.fitBounds([[southWestLongitude, southWestLatitude], [northEastLongitude, northEastLatitude]], {
          padding: { top: TOP_BAND_HEIGHT + 12, right: 24, bottom: ROUTE_IMAGE_HEIGHT - BOTTOM_BAND_TOP + 12, left: 24 },
          duration: 0,
          maxZoom: MAP_MAX_ZOOM,
        });
        setupComplete = true;
        idleListener = handleIdle;
        mapOn(map, "idle", handleIdle);
        idleArmed = true;
        map.triggerRepaint();
      } catch (error) {
        fail(error);
      }
    };

    try {
      timeout = setTimeout(handleTimeout, ROUTE_IMAGE_TIMEOUT_MS);
      signal.addEventListener("abort", handleAbort, { once: true });
      if (signal.aborted) {
        handleAbort();
        return;
      }

      container = document.createElement("div");
      container.className = "route-image-export-container";
      container.setAttribute("aria-hidden", "true");
      Object.assign(container.style, {
        position: "fixed",
        left: "-1300px",
        top: "0",
        width: `${ROUTE_IMAGE_WIDTH}px`,
        height: `${ROUTE_IMAGE_HEIGHT}px`,
        overflow: "hidden",
        pointerEvents: "none",
      });
      document.body.appendChild(container);
      imageCanvas = dependencies.createCanvas(ROUTE_IMAGE_WIDTH, ROUTE_IMAGE_HEIGHT);
      imageCanvas.width = ROUTE_IMAGE_WIDTH;
      imageCanvas.height = ROUTE_IMAGE_HEIGHT;
      context = imageCanvas.getContext("2d");
      if (!context) throw new Error("A 2D canvas context is unavailable for route image export");

      map = dependencies.mapFactory.create(container, {
        style: MAP_STYLE_URL,
        center: MAP_CENTER,
        zoom: 8,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        pixelRatio: 1,
        interactive: false,
        fadeDuration: 0,
        attributionControl: false,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      const onError = handleMapError;
      const onStyleLoad = handleStyleLoad;
      mapOn(map, "error", onError);
      contextLostListener = handleContextLost;
      map.getCanvas().addEventListener("webglcontextlost", handleContextLost);
      mapOn(map, "style.load", onStyleLoad);
    } catch (error) {
      fail(error);
    }
  });
}
