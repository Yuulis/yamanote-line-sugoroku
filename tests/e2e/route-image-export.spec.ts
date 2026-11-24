import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test, expect } from "./fixtures";
import { rollOnce, writeSaveText } from "./support/app";

test.use({ dataset: "real" });

interface PngInspection {
  readonly width: number;
  readonly height: number;
  readonly opaque: boolean;
  readonly topBandWhite: boolean;
  readonly bottomBandWhite: boolean;
  readonly topBandTextPixels: number;
  readonly bottomBandTextPixels: number;
  readonly routeColorPixels: number;
  readonly routeNorthPixels: number;
  readonly routeSouthPixels: number;
  readonly stubBackgroundPixel: readonly number[];
  readonly stubBackgroundPainted: boolean;
}

declare global {
  interface Window {
    __sugorokuE2E?: {
      readonly runRouteImageExportProbe?: () => Promise<{
        readonly size: number;
        readonly routeColors: readonly string[];
        readonly routeBounds: readonly [readonly [number, number], readonly [number, number]];
      }>;
      readonly routeImageProbeBlob?: Blob;
      readonly routeImageState?: { readonly kind: string };
      startRouteImageProbeDownload?: () => void;
      inspectRouteImageProbeBlob?: (
        blob: Blob,
        routeColors: readonly string[],
        routeBounds: readonly [readonly [number, number], readonly [number, number]],
      ) => Promise<PngInspection>;
    };
  }
}

test("exports, decodes, and downloads the full-route PNG from the product exporter", async ({ page }) => {
  await page.goto("/");
  const pinnedSave = readFileSync("tests/e2e/fixtures/tokyo-suburban-before-clear-save.json", "utf8").trimEnd();
  await writeSaveText(page, pinnedSave);
  await page.reload();
  await page.getByRole("button", { name: /つづきから/ }).click();
  await rollOnce(page);
  await expect(page.getByRole("region", { name: "クリア！" })).toBeVisible();
  await page.waitForFunction(() => window.__sugorokuE2E?.routeImageState?.kind === "ready");
  await page.waitForFunction(() => typeof window.__sugorokuE2E?.runRouteImageExportProbe === "function");

  await page.evaluate(() => {
    const hook = window.__sugorokuE2E;
    if (!hook) throw new Error("e2e hook is unavailable");
    hook.inspectRouteImageProbeBlob = async (blob, routeColors, routeBounds) => {
      const expectedRouteColors = routeColors.map((color) => {
        const hex = color.startsWith("#") ? color.slice(1) : color;
        if (hex.length !== 6) return null;
        return [
          Number.parseInt(hex.slice(0, 2), 16),
          Number.parseInt(hex.slice(2, 4), 16),
          Number.parseInt(hex.slice(4, 6), 16),
        ];
      }).filter((color): color is number[] => color !== null);
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PNG decoder canvas is unavailable");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let opaque = true;
      let topBandTextPixels = 0;
      let bottomBandTextPixels = 0;
      let routeColorPixels = 0;
      let routeNorthPixels = 0;
      let routeSouthPixels = 0;
      const fittedMapArea = { top: 90, bottom: canvas.height - 187, left: 24, right: canvas.width - 24 };
      const endpointBandHeight = Math.ceil((fittedMapArea.bottom - fittedMapArea.top) * 0.2);
      const northLatitude = routeBounds[1][1];
      const southLatitude = routeBounds[0][1];
      const mercatorY = (latitude: number): number => {
        const radians = latitude * Math.PI / 180;
        return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
      };
      const longitudeSpan = (routeBounds[1][0] - routeBounds[0][0]) / 360;
      const latitudeSpan = Math.abs(mercatorY(northLatitude) - mercatorY(southLatitude));
      const fitsByLatitude = (fittedMapArea.bottom - fittedMapArea.top) / latitudeSpan
        <= (fittedMapArea.right - fittedMapArea.left) / longitudeSpan;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          const red = data[index] ?? 0;
          const green = data[index + 1] ?? 0;
          const blue = data[index + 2] ?? 0;
          if ((data[index + 3] ?? 0) !== 255) opaque = false;
          if (y >= fittedMapArea.top && y < fittedMapArea.bottom && expectedRouteColors.some((color) =>
            Math.abs(red - (color[0] ?? 0)) < 48
            && Math.abs(green - (color[1] ?? 0)) < 48
            && Math.abs(blue - (color[2] ?? 0)) < 48)) {
            routeColorPixels += 1;
            if (y < fittedMapArea.top + endpointBandHeight) routeNorthPixels += 1;
            if (y >= fittedMapArea.bottom - endpointBandHeight) routeSouthPixels += 1;
          }
          if (red < 95 && green < 95 && blue < 95) {
            if (y < 78) topBandTextPixels += 1;
            if (y >= 500) bottomBandTextPixels += 1;
          }
        }
      }
      const pixel = (x: number, y: number): readonly number[] => {
        const index = (y * canvas.width + x) * 4;
        return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
      };
      const stubBackgroundPixel = pixel(16, Math.floor((fittedMapArea.top + fittedMapArea.bottom) / 2));
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        opaque,
        topBandWhite: pixel(10, 10).every((value) => value > 245),
        bottomBandWhite: pixel(10, canvas.height - 10).every((value) => value > 245),
        topBandTextPixels,
        bottomBandTextPixels,
        routeColorPixels,
        routeNorthPixels,
        routeSouthPixels,
        stubBackgroundPixel,
        stubBackgroundPainted: fitsByLatitude
          && northLatitude > southLatitude
          && stubBackgroundPixel.every((value, channel) => Math.abs(value - [238, 242, 230][channel]!) <= 2),
      };
    };
  });

  const exported = await page.evaluate(async () => {
    const hook = window.__sugorokuE2E;
    if (!hook?.runRouteImageExportProbe) throw new Error("route image probe is unavailable");
    const result = await hook.runRouteImageExportProbe();
    const updatedHook = window.__sugorokuE2E;
    if (result.size <= 0 || !updatedHook?.routeImageProbeBlob) {
      throw new Error(`route image probe returned no PNG (size=${result.size})`);
    }
    const image = await updatedHook.inspectRouteImageProbeBlob?.(
      updatedHook.routeImageProbeBlob,
      result.routeColors,
      result.routeBounds,
    );
    if (!image) throw new Error("route image PNG inspection failed");
    const sourceBytes = new Uint8Array(await updatedHook.routeImageProbeBlob.arrayBuffer());
    let sourceBinary = "";
    for (let offset = 0; offset < sourceBytes.length; offset += 0x8000) {
      sourceBinary += String.fromCharCode(...sourceBytes.subarray(offset, offset + 0x8000));
    }
    updatedHook.startRouteImageProbeDownload = () => {
      const blob = window.__sugorokuE2E?.routeImageProbeBlob;
      if (!blob) throw new Error("route image probe PNG is unavailable for download");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "route-image-probe.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 6_000);
    };
    return {
      size: result.size,
      routeColors: result.routeColors,
      routeBounds: result.routeBounds,
      sourceBytesBase64: btoa(sourceBinary),
      image,
    };
  });
  expect(exported.size).toBeGreaterThan(0);
  expect(exported.routeColors.length).toBeGreaterThan(0);
  expect(exported.routeBounds[0][1]).toBeLessThan(exported.routeBounds[1][1]);
  expect(exported.image).toMatchObject({
    width: 1200,
    height: 675,
    opaque: true,
    topBandWhite: true,
    bottomBandWhite: true,
  });
  expect(exported.image.topBandTextPixels).toBeGreaterThan(20);
  expect(exported.image.bottomBandTextPixels).toBeGreaterThan(20);
  expect(exported.image.routeColorPixels).toBeGreaterThan(20);
  expect(exported.image.stubBackgroundPainted).toBe(true);
  expect(exported.image.stubBackgroundPixel).toEqual([238, 242, 230]);
  expect(exported.image.routeNorthPixels).toBeGreaterThan(10);
  expect(exported.image.routeSouthPixels).toBeGreaterThan(10);

  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(() => {
    const startDownload = window.__sugorokuE2E?.startRouteImageProbeDownload;
    if (!startDownload) throw new Error("route image test download helper is unavailable");
    startDownload();
  });
  const download = await downloadPromise;
  const savedPath = test.info().outputPath("route-image-export.png");
  mkdirSync(dirname(savedPath), { recursive: true });
  await download.saveAs(savedPath);
  const savedBytes = readFileSync(savedPath);
  const downloadedImage = await page.evaluate(async ({ base64, routeColors, routeBounds }) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    const inspect = window.__sugorokuE2E?.inspectRouteImageProbeBlob;
    if (!inspect) throw new Error("route image PNG decoder is unavailable");
    return inspect(blob, routeColors, routeBounds);
  }, {
    base64: savedBytes.toString("base64"),
    routeColors: exported.routeColors,
    routeBounds: exported.routeBounds,
  });
  expect(downloadedImage).toEqual(exported.image);

  const sourceBytes = Buffer.from(exported.sourceBytesBase64, "base64");
  expect(savedBytes.equals(sourceBytes)).toBe(true);

  const shouldSaveReviewCopy = test.info().project.name === "desktop-chromium"
    && process.env.ISSUE69_S6_SCREENSHOTS === "1"
    && !process.env.CI && !process.env.GITHUB_ACTIONS;
  if (shouldSaveReviewCopy) {
    const reviewPath = resolve(".claude/logs/screenshots/issue69-s6-export.png");
    mkdirSync(dirname(reviewPath), { recursive: true });
    copyFileSync(savedPath, reviewPath);
  }
});
