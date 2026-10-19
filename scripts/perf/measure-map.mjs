#!/usr/bin/env node
// Map load/render performance baseline (roadmap C1). Not part of `npm test` or
// `npm run test:e2e`: run it by hand before and after a map speed-up.
//
//   npm run perf:map -- [--runs 5] [--tiles stub|live] [--profiles desktop,mobile]
//                       [--browser chromium|firefox] [--server gzip|preview]
//                       [--no-build] [--no-interaction] [--cpu-profile] [--ablation]
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
  const opts = { runs: 5, tiles: "stub", profiles: ["desktop", "mobile"], browser: "chromium", server: "gzip", build: true, interaction: true, cpuProfile: false, ablation: false };
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
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

/** Runs in the page before any app code: timestamps, long tasks, map hook, dice seed. */
function pageInit(seedBytes) {
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
const round = (value) => (value == null ? null : Math.round(value * 10) / 10);

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

async function measureRun(browser, opts, profileName, runIndex, mapper) {
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
  await context.addInitScript(pageInit, seedBytes);
  const page = await context.newPage();
  let cdp = null;
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
  }
  await page.goto(BASE_URL);
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
  if (cdp) {
    const { metrics: cdpMetrics } = await cdp.send("Performance.getMetrics");
    const byName = Object.fromEntries(cdpMetrics.map(({ name, value }) => [name, value]));
    Object.assign(metrics, { mainTaskMs: byName.TaskDuration * 1000, scriptMs: byName.ScriptDuration * 1000, layoutMs: byName.LayoutDuration * 1000, jsHeapMB: byName.JSHeapUsedSize / 2 ** 20 });
  }
  const profiling = cdp && opts.cpuProfile && runIndex === 0;
  const rawProfiles = {};
  const stopProfile = async (phase) => {
    rawProfiles[phase] = (await cdp.send("Profiler.stop")).profile;
    return summariseProfile(rawProfiles[phase], mapper);
  };
  const cpuProfile = profiling ? { load: await stopProfile("load") } : null;
  if (opts.interaction) {
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
  return { profile: profileName, run: runIndex + 1, renderer: load.renderer, requests, metrics, cpuProfile, rawProfiles };
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
      const values = mine.map((r) => r.metrics[key]).filter((v) => v != null);
      out[profile][key] = values.length ? { median: quantile(values, 0.5), min: Math.min(...values), max: Math.max(...values) } : null;
    }
  }
  return out;
}

function formatSummary(summary, meta) {
  const profiles = Object.keys(summary);
  const cell = (s) => (s ? `${s.median} [${s.min}–${s.max}]` : "n/a");
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
  try {
    for (const profile of opts.profiles) {
      for (let i = 0; i < opts.runs; i += 1) {
        const run = await measureRun(browser, opts, profile, i, mapper);
        console.log(`${profile} #${run.run}: idle ${run.metrics.mapIdleMs} ms, load ${run.metrics.mapLoadMs} ms, TBT ${run.metrics.totalBlockingMs} ms`);
        runs.push(run);
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
  const meta = { stamp, ...opts, renderers: [...new Set(runs.map((r) => r.renderer))], requests: runs[0].requests, sizes: sizeTable(mapper), cpuProfiles: runs.filter((r) => r.cpuProfile) };
  for (const run of runs) {
    for (const [phase, profile] of Object.entries(run.rawProfiles)) writeFileSync(join(outDir, `${run.profile}-${phase}.cpuprofile`), JSON.stringify(profile));
  }
  writeFileSync(join(outDir, "runs.json"), JSON.stringify(runs.map(({ rawProfiles: _raw, ...run }) => run), null, 1));
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ meta, summary }, null, 1));
  const text = formatSummary(summary, meta);
  writeFileSync(join(outDir, "summary.md"), `${text}\n`);
  console.log(`\n${text}\n\nWritten to ${relative(ROOT, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
