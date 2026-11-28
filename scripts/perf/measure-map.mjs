#!/usr/bin/env node
// Map load/render performance baseline (roadmap C1). Not part of `npm test` or
// `npm run test:e2e`: run it by hand before and after a map speed-up.
//
//   npm run perf:map -- [--runs 5] [--tiles stub|live] [--profiles desktop,mobile]
//                       [--browser chromium|firefox] [--server gzip|preview]
//                       [--no-build] [--no-interaction] [--cpu-profile] [--ablation]
//                       [--offset-transfer blob|object]
//
// What it does
// - Builds `vite build --mode e2e --sourcemap` into node_modules/.cache (never
//   dist/): a minified production bundle plus the map hook in
//   src/features/map/e2eHook.ts, which is how "map ready" is observed.
// - Serves it on [::1]:4180. `gzip` (default) is a tiny static server that
//   gzips like the Vercel host does; `preview` is `vite preview`, which sends
//   everything uncompressed and so overstates throttled transfer times.
// - Per run: fresh browser context (cold cache), then records navigation,
//   FCP, data/style fetch timings, "map load" (hook assignment, i.e. railway
//   layers added) and the first `idle` after it, long tasks, and CDP
//   Performance metrics. Then, unless
//   --no-interaction: an animated pan, an animated zoom, and three dice moves
//   (seeded), each with rAF frame intervals and long tasks.
// - `stub` tiles replace OpenFreeMap with the E2E stub (one background + water
//   layer, empty tiles, local glyphs): app cost only. `live` loads the real
//   Liberty style from the internet: realistic but network-dependent.
// - Profiles: desktop 1280x800; mobile = Pixel 7 + 4x CPU throttle + Fast 4G
//   (165 ms RTT, 9 Mbit/s down; Chromium only, via CDP).
// - --cpu-profile: main-thread CPU profiles of the load and move phases of
//   run 1 (*.cpuprofile, open in DevTools), self time summarised by source file.
// - --ablation: after the moves, pans again with groups of app layers (or the
//   background style's layers) hidden, so frame-cost differences estimate each
//   group's render cost.
// - Firefox has no CDP here: no throttling, CPU profile or Performance
//   metrics, and no Long Tasks API (blocking metrics print as n/a).
// - Writes raw runs and summary.json/summary.md under .claude/logs/perf/<stamp>/.
//
// Headless Chromium renders WebGL with SwiftShader (the GL renderer is
// recorded): absolute frame numbers are software-GL numbers; compare runs.
// Medians of >=5 runs; other heavy processes on the host widen the spread.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, devices, firefox } from "@playwright/test";
import { SourceMapConsumer } from "source-map-js";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT_DIR = join(ROOT, "node_modules/.cache/sugoroku-perf-dist");
const HOST = "::1";
const PORT = 4180;
const BASE_URL = `http://[${HOST}]:${PORT}/`;
const MAP_HOST = "https://tiles.openfreemap.org";
const GLYPH_DIR = join(ROOT, "tests/e2e/fixtures/glyphs");
/** tests/e2e/fixtures/seeds.ts FIXTURE_GAME_SEED: deterministic dice. */
const GAME_SEED = "00000000000000000000000000000398";
const MOVES = 3;
const READY_TIMEOUT_MS = 120_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
const LONG_TASK_MS = 50;
const PROFILES = {
  desktop: { device: { viewport: { width: 1280, height: 800 } }, cpu: 1, network: null },
  mobile: {
    device: devices["Pixel 7"],
    cpu: 4,
    network: { offline: false, latency: 165, downloadThroughput: (9_000_000 / 8), uploadThroughput: (1_500_000 / 8) },
  },
};
const STUB_STYLE = {
  version: 8,
  name: "perf-stub",
  glyphs: `${MAP_HOST}/fonts/{fontstack}/{range}.pbf`,
  sources: { base: { type: "vector", tiles: [`${MAP_HOST}/perf-tiles/{z}/{x}/{y}.pbf`], maxzoom: 14 } },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#eef2e6" } },
    { id: "water", type: "fill", source: "base", "source-layer": "water", paint: { "fill-color": "#a8c8e8" } },
  ],
};
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/geo+json", ".txt": "text/plain", ".svg": "image/svg+xml", ".map": "application/json" };

function parseArgs(argv) {
  const opts = { runs: 5, tiles: "stub", profiles: ["desktop", "mobile"], browser: "chromium", server: "gzip", build: true, interaction: true, cpuProfile: false, ablation: false, offsetTransfer: "object" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--runs") opts.runs = Number(argv[++i]);
    else if (arg === "--tiles") opts.tiles = argv[++i];
    else if (arg === "--profiles") opts.profiles = argv[++i].split(",");
    else if (arg === "--browser") opts.browser = argv[++i];
    else if (arg === "--server") opts.server = argv[++i];
    else if (arg === "--no-build") opts.build = false;
    else if (arg === "--no-interaction") opts.interaction = false;
    else if (arg === "--cpu-profile") opts.cpuProfile = true;
    else if (arg === "--ablation") opts.ablation = true;
    else if (arg === "--offset-transfer") opts.offsetTransfer = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["blob", "object"].includes(opts.offsetTransfer)) throw new Error("--offset-transfer must be blob or object");
  return opts;
}

function startGzipServer() {
  const cache = new Map();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, BASE_URL).pathname);
    const file = resolve(OUT_DIR, `.${path.endsWith("/") ? `${path}index.html` : path}`);
    if (!file.startsWith(OUT_DIR + sep)) return res.writeHead(403).end();
    let body;
    try { body = readFileSync(file); } catch { return res.writeHead(404).end(); }
    const headers = { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" };
    if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
      if (!cache.has(file)) cache.set(file, gzipSync(body, { level: 6 }));
      body = cache.get(file);
      headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(200, { ...headers, "Content-Length": body.length }).end(body);
  });
  return new Promise((done) => server.listen(PORT, HOST, () => done(() => server.close())));
}

async function startPreviewServer() {
  const child = spawn(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--mode", "e2e", "--outDir", OUT_DIR, "--host", HOST, "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(BASE_URL)).ok) return () => child.kill(); } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error("vite preview did not start");
}

/** Runs in the page before app code: timestamps, optional offset ablation, camera scenario and dice seed. */
function pageInit({ seedBytes, earlyZ13 }) {
  const perf = { marks: {}, frames: null };
  window.__perf = perf;
  // Firefox has no Long Tasks API: blocking metrics are then reported as null, not 0.
  perf.longTasks = PerformanceObserver.supportedEntryTypes?.includes("longtask") ? [] : null;
  if (perf.longTasks) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: "longtask", buffered: true });
  }
  let hook;
  Object.defineProperty(window, "__sugorokuE2E", {
    configurable: true,
    get: () => hook,
    set: (value) => {
      hook = value;
      if (!value?.map || perf.marks.mapLoad) return;
      perf.marks.mapLoad = performance.now();
      value.map.once("idle", () => { perf.marks.mapIdle = performance.now(); });
      if (earlyZ13) {
        const map = value.map;
        const camera = { center: [139.718, 35.58], zoom: 13 };
        perf.earlyZoom = { frames: 0 };
        let cameraFrame = null;
        const captureTracks = () => {
          const zoom = map.getZoom();
          const { lng, lat } = map.getCenter();
          Object.assign(perf.earlyZoom, { zoom, lng, lat, frames: perf.earlyZoom.frames + 1 });
          if (Math.abs(zoom - camera.zoom) > 0.001
            || Math.abs(lat - camera.center[1]) > 0.001
            || Math.abs(lng - camera.center[0]) > 0.001) {
            // The initial title fit or layout observer can issue a later camera update.
            cameraFrame ??= requestAnimationFrame(() => {
              cameraFrame = null;
              map.stop().jumpTo(camera);
            });
            return;
          }
          const features = map.queryRenderedFeatures({ layers: ["railway-services"] });
          perf.earlyZoom.visibleFeatures = features.length;
          if (features.length === 0) return;
          const offset = features.some((feature) => Math.abs(feature.properties.corridorSlot) > 0);
          if (!offset && !perf.earlyZoom.beforeSwap) {
            perf.earlyZoom.beforeSwap = map.getCanvas().toDataURL("image/png");
          }
          if (offset && !perf.earlyZoom.afterSwap) {
            perf.earlyZoom.renderedAt = performance.now();
            perf.earlyZoom.afterSwap = map.getCanvas().toDataURL("image/png");
            map.off("render", captureTracks);
          }
        };
        map.on("render", captureTracks);
      }
    },
  });
  new MutationObserver((_, observer) => {
    if (!document.getElementById("game-title")) return;
    perf.marks.title = performance.now();
    observer.disconnect();
  }).observe(document, { childList: true, subtree: true });
  let offset = 0;
  const original = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (array) => {
    if (!(array instanceof Uint8Array)) return original(array);
    for (let i = 0; i < array.length; i += 1) array[i] = seedBytes[offset++ % seedBytes.length];
    return array;
  };
  perf.startFrames = () => {
    const record = { t0: performance.now(), ts: [], on: true };
    const loop = (t) => { if (!record.on) return; record.ts.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    perf.frames = record;
  };
  perf.stopFrames = () => {
    perf.frames.on = false;
    return { t0: perf.frames.t0, t1: performance.now(), ts: perf.frames.ts };
  };
}

function findUserTimingMark(events, name) {
  return events.find((event) => event.name === name)
    ?? events.find((event) => event.name === "UserTiming" && event.args?.data?.name === name);
}

function threadTimeAt(anchors, wallTime) {
  let previous;
  for (const [wall, thread] of anchors) {
    if (wall === wallTime) return thread;
    if (wall > wallTime) {
      if (!previous) return null;
      const fraction = (wallTime - previous[0]) / (wall - previous[0]);
      return previous[1] + fraction * (thread - previous[1]);
    }
    previous = [wall, thread];
  }
  return null;
}

function traceWindow(events, durationMs = null) {
  const start = findUserTimingMark(events, "corridor-offset-request");
  const rendered = findUserTimingMark(events, "corridor-offset-rendered");
  if (!start || (durationMs === null && !rendered)) return null;
  const startUs = start.ts;
  const endUs = durationMs === null ? rendered.ts : startUs + durationMs * 1000;
  const mainThreadTasks = events.filter((event) => event.pid === start.pid
    && event.tid === start.tid
    && event.name === "ThreadControllerImpl::RunTask"
    && event.ph === "X"
    && typeof event.dur === "number");
  let busyUs = 0;
  let threadUs = 0;
  let threadClockComplete = true;
  for (const { ts, dur, tdur } of mainThreadTasks) {
    const overlap = Math.min(ts + dur, endUs) - Math.max(ts, startUs);
    if (overlap <= 0) continue;
    busyUs += overlap;
    if (typeof tdur === "number") threadUs += tdur * overlap / dur;
    else threadClockComplete = false;
  }
  if (busyUs === 0) return null;
  if (!threadClockComplete) {
    // The monotonic thread clock can span events with missing per-task durations.
    const anchors = [];
    for (const event of [...mainThreadTasks, start, rendered]) {
      if (!event || typeof event.tts !== "number") continue;
      anchors.push([event.ts, event.tts]);
      if (typeof event.tdur === "number" && typeof event.dur === "number") {
        anchors.push([event.ts + event.dur, event.tts + event.tdur]);
      }
    }
    anchors.sort(([a], [b]) => a - b);
    const threadStart = threadTimeAt(anchors, startUs);
    const threadEnd = threadTimeAt(anchors, endUs);
    threadClockComplete = threadStart !== null && threadEnd !== null && threadEnd >= threadStart;
    if (threadClockComplete) threadUs = threadEnd - threadStart;
  }
  return {
    wallMs: (endUs - startUs) / 1000,
    busyMs: busyUs / 1000,
    threadCpuMs: threadClockComplete ? threadUs / 1000 : null,
  };
}

async function startMainThreadTrace(cdp) {
  if (!cdp) return null;
  const events = [];
  const onData = ({ value }) => events.push(...value);
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    categories: "toplevel,devtools.timeline,blink.user_timing",
    transferMode: "ReportEvents",
  });
  return async () => {
    const complete = new Promise((resolve) => {
      const onComplete = () => {
        cdp.off("Tracing.tracingComplete", onComplete);
        resolve();
      };
      cdp.on("Tracing.tracingComplete", onComplete);
    });
    await cdp.send("Tracing.end");
    await complete;
    cdp.off("Tracing.dataCollected", onData);
    return events;
  };
}

async function installTileStub(context) {
  await context.route(`${MAP_HOST}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith("/styles/")) return route.fulfill({ json: STUB_STYLE });
    if (pathname.startsWith("/perf-tiles/")) return route.fulfill({ contentType: "application/x-protobuf", body: "" });
    if (pathname.startsWith("/fonts/")) {
      const file = resolve(GLYPH_DIR, decodeURIComponent(pathname.slice("/fonts/".length)));
      if (!file.startsWith(GLYPH_DIR + sep)) return route.abort();
      try { return route.fulfill({ contentType: "application/x-protobuf", body: readFileSync(file) }); } catch { return route.abort(); }
    }
    return route.abort();
  });
}

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const round = (value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);

function blocking(longTasks, from, to) {
  if (!longTasks) return { longTaskCount: null, longTaskMaxMs: null, totalBlockingMs: null };
  const inside = longTasks.filter(([start]) => start >= from && start <= to);
  return {
    longTaskCount: inside.length,
    longTaskMaxMs: round(Math.max(0, ...inside.map(([, d]) => d))),
    totalBlockingMs: round(inside.reduce((sum, [, d]) => sum + Math.max(0, d - LONG_TASK_MS), 0)),
  };
}

function frameStats({ t0, t1, ts }, longTasks, prefix) {
  const intervals = ts.slice(1).map((t, i) => t - ts[i]);
  const stats = blocking(longTasks, t0, t1);
  return {
    [`${prefix}DurationMs`]: round(t1 - t0),
    [`${prefix}Fps`]: round((ts.length / (t1 - t0)) * 1000),
    [`${prefix}FrameP50Ms`]: round(quantile(intervals, 0.5)),
    [`${prefix}FrameP95Ms`]: round(quantile(intervals, 0.95)),
    [`${prefix}FrameMaxMs`]: round(Math.max(0, ...intervals)),
    [`${prefix}JankFrames`]: intervals.filter((d) => d > LONG_TASK_MS).length,
    [`${prefix}TbtMs`]: stats.totalBlockingMs,
  };
}

/** Animate the camera and wait for the following `idle`; returns the frame record. */
async function cameraPhase(page, action) {
  await page.evaluate(() => window.__perf.startFrames());
  await page.evaluate(async (kind) => {
    const map = window.__sugorokuE2E.map;
    const idle = new Promise((done) => map.once("idle", done));
    if (kind === "pan") map.panBy([300, 150], { duration: 1200, essential: true });
    else if (kind === "panBack") map.panBy([-300, -150], { duration: 1200, essential: true });
    else map.easeTo({ zoom: map.getZoom() + 2, duration: 1500, essential: true });
    await idle;
  }, action);
  return page.evaluate(() => window.__perf.stopFrames());
}

const SAVE_KEY = "yamanote-line-sugoroku:save:v1";

/** Three seeded dice moves. Waits poll the DOM every 250 ms to keep probe cost off the frames. */
async function movePhase(page) {
  const records = [];
  await page.getByRole("button", { name: "はじめから" }).click();
  // A fresh browser context gets the first-play coach, which intentionally
  // blocks the dice until dismissed and would otherwise intercept the probe.
  const coachSkip = page.getByRole("dialog", { name: "最初のガイド" }).getByRole("button", { name: "とばす", exact: true });
  if (await coachSkip.count()) await coachSkip.click();
  const settled = (key) => {
    const turn = JSON.parse(localStorage.getItem(key) ?? "{}").turn ?? 0;
    const idle = [...document.querySelectorAll("button")].some((b) => b.textContent === "サイコロを振る" && !b.disabled);
    const clear = [...document.querySelectorAll("h1,h2")].some((h) => h.textContent === "クリア！");
    return idle || clear ? { turn } : null; // an object: turn 0 is falsy
  };
  for (let move = 0; move < MOVES; move += 1) {
    const { turn: turnBefore } = await (await page.waitForFunction(settled, SAVE_KEY, { timeout: 60_000, polling: 250 })).jsonValue();
    await page.evaluate(() => window.__perf.startFrames());
    await page.getByRole("button", { name: "サイコロを振る" }).click();
    await page.waitForFunction(([key, before]) => {
      const turn = JSON.parse(localStorage.getItem(key) ?? "{}").turn ?? 0;
      const idle = [...document.querySelectorAll("button")].some((b) => b.textContent === "サイコロを振る" && !b.disabled);
      const clear = [...document.querySelectorAll("h1,h2")].some((h) => h.textContent === "クリア！");
      return turn > before && (idle || clear);
    }, [SAVE_KEY, turnBefore], { timeout: 60_000, polling: 250 });
    records.push(await page.evaluate(() => window.__perf.stopFrames()));
  }
  // One record spanning all moves, with the gaps between moves removed.
  return records.reduce((all, r) => ({ t0: all.t0, t1: all.t1 + (r.t1 - r.t0), ts: [...all.ts, ...r.ts.map((t) => t - r.t0 + all.t1)] }), { t0: records[0].t0, t1: records[0].t0, ts: [] });
}

const APP_LAYERS = ["railway-base", "railway-services", "railway-current-service", "railway-segments-pending", "railway-segments-completed", "railway-stations-circle", "railway-stations-circle-ordinary", "railway-stations-label", "railway-stations-label-ordinary", "game-current-position-circle"];
/**
 * Ablation sets: layers hidden while the camera pans. "basemap-labels" hides
 * the background style's symbol and fill-extrusion layers, "basemap" every
 * background-style layer except the background colour.
 */
const ABLATIONS = {
  all: [],
  noBase: ["railway-base"],
  noLabels: ["railway-stations-label", "railway-stations-label-ordinary"],
  noStations: ["railway-stations-circle", "railway-stations-circle-ordinary", "railway-stations-label", "railway-stations-label-ordinary"],
  noRailway: APP_LAYERS,
  noBasemapLabels: ["basemap-labels"],
  noBasemap: ["basemap"],
};

/** Pan back and forth with each ablation; frame cost differences show per-layer render cost. */
async function ablationPhase(page, longTasks) {
  const out = {};
  const original = await page.evaluate(() => Object.fromEntries(window.__sugorokuE2E.map.getStyle().layers.map((l) => [l.id, l.layout?.visibility ?? "visible"])));
  for (const [index, [name, hidden]] of Object.entries(ABLATIONS).entries()) {
    await page.evaluate(({ hidden, original, appLayers }) => {
      const map = window.__sugorokuE2E.map;
      for (const layer of map.getStyle().layers) {
        const basemap = !appLayers.includes(layer.id);
        const hide = hidden.includes(layer.id) ||
          (basemap && hidden.includes("basemap-labels") && ["symbol", "fill-extrusion"].includes(layer.type)) ||
          (basemap && hidden.includes("basemap") && layer.type !== "background");
        map.setLayoutProperty(layer.id, "visibility", hide ? "none" : original[layer.id]);
      }
      return new Promise((done) => map.once("idle", done));
    }, { hidden, original, appLayers: APP_LAYERS });
    const record = await cameraPhase(page, index % 2 ? "panBack" : "pan");
    Object.assign(out, frameStats(record, await longTasks(), `abl_${name}_`));
  }
  return out;
}

async function measureRun(browser, opts, profileName, runIndex, mapper, {
  offsetsDisabled = false,
  controlDurationMs = null,
  screenshotPrefix = null,
} = {}) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({ ...profile.device, locale: "ja-JP", timezoneId: "Asia/Tokyo", reducedMotion: "no-preference", serviceWorkers: "block" });
  const requests = { style: 0, tiles: 0, glyphs: 0, sprites: 0 };
  context.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(MAP_HOST)) return;
    if (url.includes("/styles/")) requests.style += 1;
    else if (url.includes("/fonts/")) requests.glyphs += 1;
    else if (url.includes("sprite")) requests.sprites += 1;
    else requests.tiles += 1;
  });
  if (opts.tiles === "stub") await installTileStub(context);
  const seedBytes = GAME_SEED.match(/../g).map((byte) => Number.parseInt(byte, 16));
  await context.addInitScript(pageInit, {
    seedBytes,
    earlyZ13: screenshotPrefix !== null,
  });
  const page = await context.newPage();
  let cdp = null;
  let stopTrace = null;
  if (opts.browser === "chromium") {
    cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
    if (profile.network) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", profile.network);
    }
    if (opts.cpuProfile && runIndex === 0) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    if (!screenshotPrefix) stopTrace = await startMainThreadTrace(cdp);
  }
  const pageUrl = new URL(BASE_URL);
  pageUrl.searchParams.set("offsetTransfer", opts.offsetTransfer);
  if (offsetsDisabled) pageUrl.searchParams.set("disableCorridorOffsets", "1");
  await page.goto(pageUrl.toString());
  const screenshots = { beforeSwap: null, afterSwap: null };
  await page.waitForFunction((disable) => {
    const state = window.__sugorokuE2E?.corridorOffsetMetrics?.state;
    return disable ? state === "unsupported" : state === "applied" || state === "failed";
  }, offsetsDisabled, { timeout: READY_TIMEOUT_MS, polling: 20 });
  const offsetState = await page.evaluate(() => window.__sugorokuE2E?.corridorOffsetMetrics?.state ?? null);
  if (!offsetsDisabled && offsetState !== "applied") throw new Error(`Corridor offset apply did not succeed: ${offsetState}`);
  let earlyZoomLatencyMs = null;
  if (screenshotPrefix) {
    try {
      await page.waitForFunction(() => window.__perf.earlyZoom?.afterSwap, null, { timeout: SCREENSHOT_TIMEOUT_MS, polling: 50 });
    } catch (error) {
      const details = await page.evaluate(() => {
        const { frames, zoom, lng, lat, visibleFeatures } = window.__perf.earlyZoom ?? {};
        return { frames, zoom, lng, lat, visibleFeatures };
      });
      await context.close();
      throw new Error(`No rendered early z13 offsets: ${JSON.stringify(details)}`, { cause: error });
    }
    const capture = await page.evaluate(() => ({
      ...window.__perf.earlyZoom,
      firstPaintAt: performance.getEntriesByName("map-first-paint")[0]?.startTime,
    }));
    earlyZoomLatencyMs = capture.renderedAt - capture.firstPaintAt;
    if (!Number.isFinite(earlyZoomLatencyMs)) throw new Error("Missing early z13 first paint or render timing");
    const dir = join(ROOT, ".claude/logs/screenshots");
    mkdirSync(dir, { recursive: true });
    for (const [phase, suffix] of [["beforeSwap", ""], ["afterSwap", "-after"]]) {
      if (!capture[phase]) continue;
      const path = join(dir, `${screenshotPrefix}${suffix}.png`);
      writeFileSync(path, Buffer.from(capture[phase].split(",")[1], "base64"));
      screenshots[phase] = relative(ROOT, path);
    }
  }
  if (controlDurationMs !== null) {
    await page.evaluate((duration) => new Promise((resolve) => {
      const start = performance.getEntriesByName("corridor-offset-request")[0]?.startTime;
      if (start === undefined) throw new Error("Missing corridor offset request timing mark in disabled run");
      setTimeout(resolve, Math.max(0, start + duration - performance.now()));
    }), controlDurationMs);
  }
  const traceEvents = stopTrace ? await stopTrace() : null;
  const offsetTrace = traceEvents
    ? traceWindow(traceEvents, controlDurationMs)
    : null;
  if (stopTrace && !offsetTrace) {
    const userTimings = traceEvents.filter((event) => /user_timing|UserTiming|Mark/i.test(`${event.cat ?? ""} ${event.name ?? ""}`));
    throw new Error(`CDP trace did not contain the corridor offset timing window (found ${userTimings.length} user timing events)`);
  }
  await page.waitForFunction(() => window.__perf.marks.mapIdle, null, { timeout: READY_TIMEOUT_MS, polling: 50 });
  const load = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const data = resources.filter((r) => /\/data\/[^/]+\.(json|geojson)$/.test(r.name));
    const appJs = resources.find((r) => /\/assets\/index-[^/]+\.js$/.test(r.name));
    const style = resources.find((r) => r.name.includes("/styles/"));
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const canvas = document.createElement("canvas").getContext("webgl2");
    const info = canvas?.getExtension("WEBGL_debug_renderer_info");
    const { marks, longTasks } = window.__perf;
    return {
      renderer: canvas ? canvas.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : canvas.RENDERER) : "no webgl2",
      longTasks,
      metrics: {
        canonicalCount: window.__sugorokuE2E?.corridorOffsetMetrics?.canonicalCount ?? null,
        derivedCount: window.__sugorokuE2E?.corridorOffsetMetrics?.derivedCount ?? null,
        offsetState: window.__sugorokuE2E?.corridorOffsetMetrics?.state ?? null,
        offsetPostMessageMs: window.__sugorokuE2E?.corridorOffsetMetrics?.postMessageMs ?? null,
        offsetReplyHandlingMs: window.__sugorokuE2E?.corridorOffsetMetrics?.replyHandlingMs ?? null,
        offsetSynchronousCallsMs: (window.__sugorokuE2E?.corridorOffsetMetrics?.postMessageMs ?? 0) +
          (window.__sugorokuE2E?.corridorOffsetMetrics?.replyHandlingMs ?? 0),
        offsetWorkerDerivationMs: window.__sugorokuE2E?.corridorOffsetMetrics?.workerDerivationMs ?? null,
        offsetLoadToAppliedMs: window.__sugorokuE2E?.corridorOffsetMetrics?.loadToAppliedMs ?? null,
        offsetRenderLatencyMs: window.__sugorokuE2E?.corridorOffsetMetrics?.renderLatencyMs ?? null,
        offsetRequestStartedAt: window.__sugorokuE2E?.corridorOffsetMetrics?.requestStartedAt ?? null,
        offsetWindowMs: (() => {
          const request = performance.getEntriesByName("corridor-offset-request")[0];
          const rendered = performance.getEntriesByName("corridor-offset-rendered")[0];
          return request && rendered ? rendered.startTime - request.startTime : null;
        })(),
        offsetIntervalCpuMs: null,
        ttfbMs: nav.responseStart,
        domContentLoadedMs: nav.domContentLoadedEventEnd,
        fcpMs: fcp?.startTime ?? null,
        appJsEndMs: appJs?.responseEnd ?? null,
        dataStartMs: Math.min(...data.map((r) => r.startTime)),
        dataEndMs: Math.max(...data.map((r) => r.responseEnd)),
        dataTransferKB: data.reduce((sum, r) => sum + r.transferSize, 0) / 1024,
        titleMs: marks.title ?? null,
        styleStartMs: style?.startTime ?? null,
        styleEndMs: style?.responseEnd ?? null,
        mapLoadMs: marks.mapLoad,
        mapIdleMs: marks.mapIdle,
      },
    };
  });
  const metrics = { ...load.metrics, ...blocking(load.longTasks, 0, load.metrics.mapIdleMs) };
  if (offsetTrace) {
    metrics.offsetIntervalCpuMs = offsetTrace.busyMs;
    metrics.offsetIntervalThreadCpuMs = offsetTrace.threadCpuMs;
    metrics.offsetIntervalIdleMs = offsetTrace.wallMs - offsetTrace.busyMs;
    if (!offsetsDisabled) metrics.offsetWindowMs = offsetTrace.wallMs;
  }
  if (screenshotPrefix) {
    metrics.offsetEarlyZ13LatencyMs = earlyZoomLatencyMs;
    metrics.offsetPreSwapScreenshotCaptured = screenshots.beforeSwap !== null;
  }
  if (cdp) {
    const { metrics: cdpMetrics } = await cdp.send("Performance.getMetrics");
    const byName = Object.fromEntries(cdpMetrics.map(({ name, value }) => [name, value]));
    Object.assign(metrics, { mainTaskMs: byName.TaskDuration * 1000, scriptMs: byName.ScriptDuration * 1000, layoutMs: byName.LayoutDuration * 1000, jsHeapMB: byName.JSHeapUsedSize / 2 ** 20 });
  }
  const profiling = cdp && opts.cpuProfile && runIndex === 0 && !offsetsDisabled;
  const rawProfiles = {};
  const stopProfile = async (phase) => {
    rawProfiles[phase] = (await cdp.send("Profiler.stop")).profile;
    return summariseProfile(rawProfiles[phase], mapper);
  };
  const cpuProfile = profiling ? { load: await stopProfile("load") } : null;
  if (opts.interaction && !offsetsDisabled) {
    const pan = await cameraPhase(page, "pan");
    const zoom = await cameraPhase(page, "zoom");
    if (profiling) await cdp.send("Profiler.start");
    const moves = await movePhase(page);
    if (profiling) cpuProfile.move = await stopProfile("move");
    const longTasks = () => page.evaluate(() => window.__perf.longTasks);
    Object.assign(metrics, frameStats(pan, await longTasks(), "pan"), frameStats(zoom, await longTasks(), "zoom"), frameStats(moves, await longTasks(), "move"));
    if (opts.ablation) Object.assign(metrics, await ablationPhase(page, longTasks));
  }
  await context.close();
  for (const key of Object.keys(metrics)) metrics[key] = round(metrics[key]);
  return { profile: profileName, run: runIndex + 1, renderer: load.renderer, requests, metrics, cpuProfile, rawProfiles, screenshots };
}

/** Maps bundle positions to source packages/files via the build's source maps. */
function createMapper() {
  const assets = join(OUT_DIR, "assets");
  const consumers = new Map();
  for (const name of readdirSync(assets).filter((n) => n.endsWith(".js"))) {
    try { consumers.set(name, new SourceMapConsumer(JSON.parse(readFileSync(join(assets, `${name}.map`), "utf8")))); } catch { /* no map */ }
  }
  const group = (source) => {
    if (!source) return "(unmapped)";
    const path = relative(ROOT, resolve(assets, source)).split(sep).join("/");
    if (!path.startsWith("node_modules/")) return path;
    const parts = path.slice("node_modules/".length).split("/");
    const name = parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/");
    return `npm:${name}/${parts.at(-1)}`;
  };
  return {
    consumers,
    group,
    locate(url, line, column) {
      const consumer = consumers.get(url.split("/").at(-1));
      if (!consumer) return url ? `(other) ${url.split("/").at(-1)}` : null;
      return group(consumer.originalPositionFor({ line: line + 1, column }).source);
    },
  };
}

function summariseProfile(profile, mapper) {
  const selfUs = new Map();
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  profile.samples.forEach((id, i) => {
    const { url, lineNumber, columnNumber, functionName } = nodes.get(id).callFrame;
    const key = mapper.locate(url, lineNumber, columnNumber) ?? `(${functionName || "native"})`;
    selfUs.set(key, (selfUs.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
  });
  return [...selfUs].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([key, us]) => [key, round(us / 1000)]);
}

function sizeTable(mapper) {
  const rows = [];
  const add = (label, file) => {
    const body = readFileSync(file);
    rows.push({ file: label, rawKB: round(body.length / 1024), gzipKB: round(gzipSync(body, { level: 9 }).length / 1024) });
  };
  const assets = join(OUT_DIR, "assets");
  for (const name of readdirSync(assets).filter((n) => /\.(js|css)$/.test(n))) add(`assets/${name}`, join(assets, name));
  for (const name of readdirSync(join(OUT_DIR, "data"))) add(`data/${name}`, join(OUT_DIR, "data", name));
  const composition = {};
  for (const [name, consumer] of mapper.consumers) {
    const lines = readFileSync(join(assets, name), "utf8").split("\n");
    const bytes = {};
    let previous = null;
    const flush = (end) => { if (previous) bytes[previous.key] = (bytes[previous.key] ?? 0) + end - previous.column; };
    consumer.eachMapping((m) => {
      if (previous && previous.line !== m.generatedLine) flush(lines[previous.line - 1].length);
      else flush(m.generatedColumn);
      previous = { line: m.generatedLine, column: m.generatedColumn, key: mapper.group(m.source) };
    }, null, SourceMapConsumer.GENERATED_ORDER);
    if (previous) flush(lines[previous.line - 1].length);
    composition[name] = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, round(v / 1024)]);
  }
  return { rows, composition };
}

function summarise(runs) {
  const out = {};
  for (const profile of new Set(runs.map((r) => r.profile))) {
    const mine = runs.filter((r) => r.profile === profile);
    out[profile] = {};
    for (const key of Object.keys(mine[0].metrics)) {
      const recorded = mine.map((r) => r.metrics[key]).filter((value) => value != null);
      const values = recorded.filter((value) => typeof value === "number");
      out[profile][key] = values.length
        ? { median: quantile(values, 0.5), min: Math.min(...values), max: Math.max(...values) }
        : recorded[0] ?? null;
    }
  }
  return out;
}

function formatSummary(summary, meta) {
  const profiles = Object.keys(summary);
  const cell = (s) => (typeof s === "string" ? s : s ? `${s.median} [${s.min}–${s.max}]` : "n/a");
  const lines = [`# Map perf ${meta.stamp}`, "", `browser=${meta.browser} tiles=${meta.tiles} server=${meta.server} runs=${meta.runs}`, `renderer: ${meta.renderers.join(" | ")}`, `map requests (run 1): ${JSON.stringify(meta.requests)}`, "", `| metric | ${profiles.join(" | ")} |`, `|---|${profiles.map(() => "---").join("|")}|`];
  for (const key of Object.keys(summary[profiles[0]])) lines.push(`| ${key} | ${profiles.map((p) => cell(summary[p][key])).join(" | ")} |`);
  lines.push("", "| file | raw KB | gzip-9 KB |", "|---|---|---|", ...meta.sizes.rows.map((r) => `| ${r.file} | ${r.rawKB} | ${r.gzipKB} |`));
  for (const [name, parts] of Object.entries(meta.sizes.composition)) lines.push("", `${name}: ${parts.map(([k, v]) => `${k} ${v} KB`).join(", ")}`);
  for (const run of meta.cpuProfiles) {
    for (const [phase, top] of Object.entries(run.cpuProfile)) {
      lines.push("", `Main-thread CPU self time, ${phase} phase (${run.profile}, run 1, ms): ${top.map(([k, v]) => `${k} ${v}`).join("; ")}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.build) {
    execFileSync(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--mode", "e2e", "--sourcemap", "--outDir", OUT_DIR, "--emptyOutDir", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit" });
  }
  const mapper = createMapper();
  const stopServer = opts.server === "preview" ? await startPreviewServer() : await startGzipServer();
  // Firefox loses WebGL under WSLg when WAYLAND_DISPLAY is set.
  const { WAYLAND_DISPLAY: _ignored, ...firefoxEnv } = process.env;
  const browser = opts.browser === "firefox" ? await firefox.launch({ env: firefoxEnv }) : await chromium.launch();
  const runs = [];
  const earlyZoom = {};
  try {
    for (const profile of opts.profiles) {
      for (let i = 0; i < opts.runs; i += 1) {
        const run = await measureRun(browser, opts, profile, i, mapper);
        if (opts.browser === "chromium") {
          if (typeof run.metrics.offsetWindowMs !== "number" || typeof run.metrics.offsetIntervalCpuMs !== "number") {
            throw new Error(`Missing complete main-thread trace interval for ${profile} run ${i + 1}`);
          }
          const controlOpts = { ...opts, interaction: false, cpuProfile: false };
          const control = await measureRun(browser, controlOpts, profile, i, mapper, {
            offsetsDisabled: true,
            controlDurationMs: run.metrics.offsetWindowMs,
          });
          const enabledCpu = run.metrics.offsetIntervalCpuMs;
          const disabledCpu = control.metrics.offsetIntervalCpuMs;
          const traceCpuDelta = enabledCpu - disabledCpu;
          const synchronousCpu = run.metrics.offsetSynchronousCallsMs ?? 0;
          run.metrics.offsetEnabledIntervalCpuMs = enabledCpu;
          run.metrics.offsetDisabledIntervalCpuMs = disabledCpu;
          run.metrics.offsetTraceCpuDeltaMs = round(traceCpuDelta);
          run.metrics.offsetAsyncCpuEstimateMs = round(Math.max(0, traceCpuDelta - synchronousCpu));
          run.metrics.offsetMainThreadMs = round(synchronousCpu + Math.max(0, traceCpuDelta - synchronousCpu));
          run.metrics.offsetWallWaitMs = run.metrics.offsetWindowMs;
          const enabledThreadCpu = run.metrics.offsetIntervalThreadCpuMs;
          const disabledThreadCpu = control.metrics.offsetIntervalThreadCpuMs;
          run.metrics.offsetTraceThreadCpuDeltaMs = enabledThreadCpu != null && disabledThreadCpu != null
            ? round(enabledThreadCpu - disabledThreadCpu)
            : null;
        }
        console.log(`${profile} #${run.run}: idle ${run.metrics.mapIdleMs} ms, load ${run.metrics.mapLoadMs} ms, TBT ${run.metrics.totalBlockingMs} ms`);
        runs.push(run);
      }
      if (opts.browser === "chromium") {
        const profileSuffix = profile === "desktop" ? "" : "-mobile";
        const transferSuffix = opts.offsetTransfer === "object" ? "" : "-blob";
        try {
          const capture = await measureRun(browser, { ...opts, interaction: false, cpuProfile: false }, profile, opts.runs, mapper, {
            screenshotPrefix: `issue72-s35b-early-z13${profileSuffix}${transferSuffix}`,
          });
          earlyZoom[profile] = { latencyMs: capture.metrics.offsetEarlyZ13LatencyMs, ...capture.screenshots };
          console.log(`${profile} early z13 render latency: ${capture.metrics.offsetEarlyZ13LatencyMs} ms; screenshots: ${JSON.stringify(capture.screenshots)}`);
        } catch (error) {
          earlyZoom[profile] = { error: String(error) };
          console.error(`${profile} early z13 render check failed`, error);
        }
      }
    }
  } finally {
    await browser.close();
    stopServer();
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = join(ROOT, ".claude/logs/perf", `${stamp}-${opts.browser}-${opts.tiles}-${opts.server}`);
  mkdirSync(outDir, { recursive: true });
  const summary = summarise(runs);
  const meta = { stamp, ...opts, earlyZoom, renderers: [...new Set(runs.map((r) => r.renderer))], requests: runs[0].requests, sizes: sizeTable(mapper), cpuProfiles: runs.filter((r) => r.cpuProfile) };
  for (const run of runs) {
    for (const [phase, profile] of Object.entries(run.rawProfiles)) writeFileSync(join(outDir, `${run.profile}-${phase}.cpuprofile`), JSON.stringify(profile));
  }
  writeFileSync(join(outDir, "runs.json"), JSON.stringify(runs.map(({ rawProfiles: _raw, ...run }) => run), null, 1));
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ meta, summary }, null, 1));
  const text = formatSummary(summary, meta);
  const gateLines = Object.entries(summary).map(([profile, metrics]) => {
    const value = metrics.offsetMainThreadMs;
    if (!value || typeof value.median !== "number") return `${profile} complete offset CPU gate: FAIL (trace metric unavailable)`;
    const pass = value.median <= 50 && value.max <= 100;
    return `${profile} complete offset CPU gate: ${pass ? "PASS" : "FAIL"} (median ${value.median} ms, max ${value.max} ms; thresholds 50/100 ms)`;
  });
  const finalText = `${text}\n\n## Complete main-thread CPU gate\n\n${gateLines.join("\n")}\n\nThe gate uses renderer main-thread busy time (CDP task durations, including Chromium throttle stalls), minus an offsets-disabled run over the same request-to-render wall interval. CDP thread CPU time is reported separately when available. Direct postMessage and synchronous reply/setData timing provide a floor when cross-run trace noise is larger than the measured difference; the positive excess over that direct time is reported as asynchronous MapLibre CPU. Wall wait is reported separately as request to rendered source. The direct and asynchronous portions are combined without counting the direct portion twice.`;
  writeFileSync(join(outDir, "summary.md"), `${finalText}\n`);
  console.log(`\n${finalText}\n\nWritten to ${relative(ROOT, outDir)}`);
  if (opts.browser === "chromium" && (gateLines.some((line) => line.includes("FAIL"))
    || Object.values(earlyZoom).some((capture) => capture.error))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
