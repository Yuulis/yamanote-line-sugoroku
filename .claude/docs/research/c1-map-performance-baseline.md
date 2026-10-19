# C1 Map Performance Baseline

Date: 2026-10-19. Branch: `feature/map-performance-a11y` (no source changes).
Scope: measure how fast the map loads and renders, and rank the bottlenecks.
Nothing was implemented.

## Method

- Script: `scripts/perf/measure-map.mjs` (`npm run perf:map`). It builds
  `vite build --mode e2e --sourcemap` into `node_modules/.cache/sugoroku-perf-dist`.
  That is the minified production bundle plus the `window.__sugorokuE2E` map hook.
  The script serves the build on `[::1]:4180` and drives Playwright Chromium (and Firefox).
- Server: a built-in static server that gzips responses (level 6), like the
  Vercel host. `vite preview` sends files **uncompressed**, so it was only used
  for one comparison run (D).
- "Map load" = the hook is assigned. This happens inside MapLibre `load`, after
  `addRailwayLayers`. "Map idle" = the first `idle` event after that, when every
  tile and layer is rendered. The "全体" button becomes enabled at the same moment
  as map load.
- Each run uses a fresh browser context (cold cache). Phases in each run: load;
  an animated `panBy` (1.2 s); an `easeTo` zoom +2 (1.5 s); three seeded dice
  moves (seed `…0398`, default speed 450 ms/step, follow camera on).
  `--ablation` then pans again with layer groups hidden.
- Profiles:
  - desktop: 1280x800, DPR 1.
  - mobile: Pixel 7 (412x839, DPR 2.625), CDP CPU throttle 4x, Fast-4G
    approximation (165 ms RTT, 9 Mbit/s down, 1.5 Mbit/s up).
- Tiles:
  - `stub`: the E2E stub style (background + water layer, empty tiles, local
    Japanese glyph PBFs), so the numbers are app cost only.
  - `live`: the real OpenFreeMap Liberty style (111 layers) over the internet.
- Renderer:
  - Chromium headless uses `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`,
    i.e. software GL. Frame numbers are software-GL numbers; use them for
    relative comparisons only.
  - Firefox reports "llvmpipe, or similar" (also software).
- Runs: 5 per cell (live ablation: 3). Values below are median [min–max] in ms
  unless stated otherwise.
- Host noise: another agent ran E2E work on the same 12-core / 7 GB WSL2 host
  during some batches. Firefox desktop changed about 2x between two batches
  (C vs G), so a single batch is not reliable at the ±20% level.

Raw data lives in `.claude/logs/perf/<stamp>-<browser>-<tiles>-<server>/`
(`runs.json`, `summary.json`, `summary.md`, `*.cpuprofile`):

| Batch | Directory | Content |
|---|---|---|
| A | `2026-10-19T08-25-35-chromium-stub-gzip` | baseline + CPU profiles |
| B | `2026-10-19T08-30-19-chromium-live-gzip` | live tiles + CPU profiles |
| C | `2026-10-19T08-31-33-firefox-stub-gzip` | Firefox desktop |
| D | `2026-10-19T08-32-15-chromium-stub-preview` | `vite preview`, mobile, load only |
| E | `2026-10-19T08-40-49-chromium-stub-gzip` | stub + layer ablation |
| F | `2026-10-19T08-48-03-chromium-live-gzip` | live + layer ablation (3 runs) |
| G | `2026-10-19T08-54-48-firefox-stub-gzip` | Firefox + ablation |

## 1. Baseline (Chromium, gzip server)

| Metric | desktop stub (A) | mobile stub (A) | desktop live (B) | mobile live (B) |
|---|---|---|---|---|
| main JS responseEnd | 34 [23–136] | 749 [726–784] | 67 [42–88] | 743 [710–804] |
| FCP ("読み込み中…") | 152 [144–260] | 1144 [984–1260] | 192 [152–372] | 1144 [1048–1272] |
| data fetch start | 145 [115–222] | 1153 [945–1215] | 191 [125–308] | 1152 [990–1212] |
| data fetch end (409 KB transferred) | 169 [134–304] | 1714 [1520–1802] | 217 [177–346] | 1711 [1535–1759] |
| title screen in DOM | 257 [225–391] | 1961 [1792–2121] | 321 [268–493] | 1989 [1792–2045] |
| style request start | 294 [270–494] | 2092 [1947–2261] | 369 [339–538] | 2114 [1924–2175] |
| style response end | 297 | 2098 | 650 [552–823] | 2331 [2314–2529] |
| **map load (railway layers added)** | **519 [503–794]** | **2674 [2583–2871]** | **2279 [2036–3425]** | **5400 [5307–6515]** |
| **map idle (fully rendered)** | **1913 [1845–2581]** | **5027 [4845–5118]** | **4749 [4443–5617]** | **8486 [8144–9402]** |
| long tasks to idle (count / max) | 11 / 388 | 18 / 823 | 17 / 355 | 22 / 637 |
| TBT to idle | 669 [648–1109] | 2441 [2303–2657] | 2604 [2067–3390] | 4717 [4659–5040] |
| main-thread task time to idle | 1844 | 4112 | 4238 | 6816 |
| JS heap at idle (MB) | 24.5 | 13.6 | 19.4 | 26.9 |
| pan fps / p95 frame | 19.3 / 67 | 9.2 / 233 | 5.5 / 250 | 4.4 / 333 |
| zoom fps / p95 frame | 22.4 / 67 | 10.6 / 133 | 9.2 / 233 | 5.0 / 333 |
| move-animation fps / p95 frame | 18.9 / 83 | 9.7 / 150 | 6.0 / 267 | 5.6 / 267 |
| move-animation TBT (3 moves, ~8.5 s) | 608 | 4253 | 7130 | 7482 |

Firefox desktop stub:

| Batch | map load | map idle | pan / zoom / move fps |
|---|---|---|---|
| C | 737 [654–1553] | 1566 [1466–2430] | 45 / 52 / 41 |
| G (host busy) | 1656 | 3081 | 26 / 28 / 24 |

Firefox has no Long Tasks API, so TBT is n/a.

Uncompressed `vite preview` (D, mobile stub):

- 1407 KB data transferred instead of 409 KB.
- data end 2756 (+1.0 s), map load 4011 (+1.3 s), map idle 7105 (+2.1 s).
- Production must keep compression on. The Vercel host does compress.

## 2. Bundle and data sizes

| File | raw KB | gzip-9 KB | Contents |
|---|---|---|---|
| `assets/index-*.js` (main, Vite >500 KB warning) | 1292.8 | 358.2 | maplibre-gl.mjs 472 + maplibre-gl-shared.mjs 465 (= 72%), react-dom 199, all app code ~75 |
| `assets/maplibre-gl-worker-*.js` | 497.8 | 141.7 | its own copy of maplibre-gl-shared (479) + worker 18 |
| `assets/index-*.css` | 88.6 | 12.0 | mostly `maplibre-gl.css` |
| `data/segments.geojson` | 1258.1 | 258.5 | 1938 LineStrings, 35,525 points, 5–6 decimals; properties are 291 KB of the raw size |
| `data/segments.json` | 726.4 | 58.0 | 3988 gameplay segments |
| `data/services.json` | 298.4 | 45.2 | 135 services |
| `data/stations.json` | 187.3 | 34.8 | 1586 stations |
| `data/manifest.json` | 46.9 | 6.3 | |
| **Total first load** | **~4.4 MB** | **~915 KB** | |

How the data is loaded:

- `App.tsx` calls `loadRailwayData` (`src/data/loaders.ts:730`). It does five
  parallel `fetch()` + `response.json()` calls and runs the guards on the main
  thread.
- The fetch starts only after the whole main bundle has executed.
- `RailwayMap` is mounted only after the data has arrived (`App.tsx:28`). So the
  map, the style fetch and the worker start only after the data is loaded and
  validated, and `networkFromData` has run.
- MapLibre is imported statically (`RailwayMap.tsx:1-8`). It is not lazy-loaded.
- The parsed GeoJSON object is passed to `addSource` (`railwayLayers.ts:79`),
  which structured-clones it to the worker.

Map composition (`src/features/map/railwayLayers.ts`):

- 3 GeoJSON sources.
- Five line layers on the same 1938-feature source. `railway-base` draws all
  1938 features. `railway-services` draws every non-Yamanote feature (~1908)
  directly on top of it. The other three are filtered subsets.
- 2 circle layers and 1 symbol layer on 1586 stations, plus a marker layer.

## 3. Bottlenecks, ranked by expected user-visible gain

1. **The railway layers wait for the basemap's complete first render.**
   (`RailwayMap.tsx:207` uses `map.on("load")`. MapLibre fires `load` only once
   `map.loaded()` is true, i.e. after every basemap tile has loaded; see
   maplibre-gl-dev.mjs:27585.)
   - Evidence, live tiles: the style arrives at 650 ms (desktop) and 2331 ms
     (mobile), but railway layers are added at 2279 ms and 5400 ms.
   - In stub mode, where the tiles are empty, the same gap is only ~220 ms
     (297 → 519).
   - Fix: add the sources and layers on `style.load` (or when `isStyleLoaded()`)
     instead of `load`. Set the `loaded` flag of the style-failure check at the
     same point.
   - Expected gain: railway lines appear ~1.5 s earlier on desktop and ~3 s
     earlier on mobile with live tiles. GeoJSON tiling overlaps basemap
     loading, so idle also moves earlier.
   - Effort S. Risk low–medium: only the `styleFailed` / retry semantics
     change, and E2E hook timing moves earlier.

2. **CJK station labels are rasterised on the main thread by TinySDF.**
   - Cause: MapLibre's default `localIdeographFontFamily: "sans-serif"` draws
     every kana/kanji locally (maplibre-gl-dev.mjs:1680).
   - Evidence, CPU profile from map load to idle: `GlyphManager._drawGlyph`
     takes 735 ms inclusive on desktop and 1077 ms on mobile. It is the largest
     JS item and the source of the 388 ms (desktop) / 823 ms (mobile) long
     tasks.
   - Amplifier: the label layer (`railwayLayers.ts:179-207`) hides ordinary
     stations below z13 with `text-size` 0. That still shapes them, so glyphs
     are drawn for every station in the loaded tiles. Near the opening view
     that is ~398 distinct characters; key stations alone need ~218. Across all
     stations there are 745 CJK characters.
   - Glyphs keep being drawn as the follow camera enters new areas. This is part
     of the move-phase TBT (608 ms desktop / 4253 ms mobile).
   - Fix (a), effort S, risk low: split the labels into a key-station layer
     (minzoom 11) and an ordinary-station layer (minzoom 13), so hidden labels
     are never shaped. Expected: ~45% fewer glyphs in the opening view.
   - Fix (b), effort M, risk medium: ship pre-built SDF glyph PBFs for the
     station character set (the generator already exists:
     `tests/e2e/fixtures/glyphs/generate.mjs`). Turn off local ideographs for
     that font stack, routing it via `transformRequest`. This removes TinySDF
     entirely, at the cost of a few hundred KB of PBFs fetched on demand. The
     basemap's CJK fallback behaviour needs checking.

3. **The load is a serial waterfall: JS → data → map/style.**
   - Evidence, mobile: the main JS ends at 749 ms, but the data fetch starts at
     1153 ms (it waits for the bundle to execute). The data ends at 1714 ms, the
     title appears at 1961 ms, and the style request starts at 2092 ms.
   - Fix (a), effort S, risk low: in `index.html`, add
     `<link rel="preload" as="fetch" crossorigin>` for the five `data/*` files
     (honouring `BASE_URL`) and `<link rel="preconnect">` to
     `tiles.openfreemap.org`.
     Expected: the 560 ms data download overlaps the JS download and parse, so
     the title and the map arrive ~0.4 s earlier on mobile. The preconnect saves
     the TLS round trips to the style host.
   - Fix (b), effort M, risk medium: create the map (style, sprite and TileJSON
     fetches, worker start) at mount. Add the railway layers when the data
     arrives. Expected: the style chain (~0.6 s on mobile) overlaps the data
     fetch. Combine with item 1.

4. **The live basemap dominates the frame cost.**
   - Evidence, live ablation (F), desktop: pan runs at 5.7 fps with everything
     visible and 16.0 fps with the basemap layers hidden. Hiding only the
     basemap labels and 3D buildings gives 6.5 fps, no real change. Mobile:
     6.0 → 10.3 fps.
   - So the Liberty fill and line layers (83 of its 111 layers) cost about 2/3
     of each frame.
   - Fix: switch to a lighter OpenFreeMap style (e.g. positron), or prune layers
     with `setStyle(..., { transformStyle })`.
   - Effort S–M. Risk: this is a visual/design decision for the user, and the
     attribution must stay the same.

5. **The railway layers redraw the network twice.**
   - Evidence, stub ablation (E): pan runs at 16.7 fps with all layers, 20.5 fps
     without `railway-base` (+23%), and 35.1 fps without any railway layers.
     Mobile: 8.9 → 9.8 → 12.3 fps. Live: 5.7 → 7.2 fps without the base layer.
     Labels and station circles cost little (≤ +3 fps, within noise).
   - Fix: restrict `railway-base` to the target service's 30 features (the only
     place where it is not covered by `railway-services`), or drop it. Keep the
     composition of the line-visibility filter
     (`lineVisibility.ts:34`).
   - Effort S. Risk low: there are visual tests for the line styling.

6. **The bundle is large and duplicates code.**
   - The main chunk is 1293 KB (358 KB gzip), and 937 KB of it is MapLibre. The
     maplibre-gl-shared code (~465 KB raw / ~140 KB gzip) ships twice, once in
     the main chunk and once in the worker.
   - Mobile FCP of the loading text (1144 ms) is gated on parsing and executing
     the whole bundle (DCL 1030 ms).
   - Fix: lazy-load `RailwayMap`/maplibre with `import()`, so the shell and
     title render first. This also removes the Vite chunk warning.
     Expected: a few hundred ms earlier FCP/title on mobile. Not measured.
     Effort M. Risk medium: Suspense fallback and E2E readiness.
   - Deduplicating the shared chunk (serving the MapLibre ESM files as one
     vendor module graph for both page and worker) saves ~140 KB gzip.
     Effort M–L. Risk medium.

7. **React re-renders the whole game UI on every animation frame.**
   - `useMoveAnimation` → `setFrameState` → `GameApp` re-renders
     `GamePanel`/`GameLegend` (134 line groups).
   - Evidence, move-phase profile: ~1.3 ms per frame of React work on desktop
     and ~3.5 ms on mobile. MapLibre JS adds ~2–3 ms per frame (`_render`, the
     marker `setData` worker round-trip).
   - The cost is small under SwiftShader, where GPU-bound native time is
     8–10 s of a 9 s window. It matters on phones with real GPUs, where JS is
     the frame budget.
   - Fix: `React.memo` on the legend and on the static panel parts, or keep the
     per-frame position out of React state. Effort S. Risk low.

8. **Data payload and main-thread parsing (minor).**
   - Main-thread time for guards, `networkFromData` and the presentation index:
     ~60 ms on desktop, ~230 ms on mobile.
   - `segments.geojson` properties repeat the `from`/`to`/`lineId` data that is
     already in `featureId`. Coordinates go up to 6 decimals.
   - Trimming them saves ~10–15% of raw size, but little after gzip. This is a
     data-pipeline change, effort M. Low priority.

Suggested order: 1 + 3a + 5 + 2a, which are all S and low risk. Then remeasure
and decide on 4 (needs the user's design call), 2b, 3b and 6.

## 4. Re-running

```bash
npm run perf:map                                          # Chromium, stub tiles, desktop+mobile, 5 runs
npm run perf:map -- --tiles live --cpu-profile            # real OpenFreeMap + CPU profiles
npm run perf:map -- --ablation --no-build                 # add per-layer-group pans
npm run perf:map -- --browser firefox --profiles desktop  # Firefox (WAYLAND_DISPLAY is dropped automatically)
npm run perf:map -- --server preview --no-interaction     # compare with uncompressed vite preview
```

- The script stops its own server. It prints the summary table and writes
  `.claude/logs/perf/<stamp>-…/summary.md`.
- One stub run of both profiles with ablation takes ~6 min. A live run takes
  ~8 min.
- Compare medians across runs taken on a quiet host.

## 5. Not measured, and caveats

- **A real GPU.** The only renderers available were SwiftShader (Chromium) and
  llvmpipe (Firefox). Frame rates and the share of native (program) time are
  pessimistic. The JS per-frame numbers (item 7) carry over better.
- **The worker thread.** Its CPU time (GeoJSON tiling, vector-tile parsing)
  was not profiled, because the CPU profile covers the page main thread only.
  It shows up only as load → idle wall time.
- **Throttling of worker requests.** It is not verified whether CDP network
  throttling applies to MapLibre worker tile requests. Live mobile tile timings
  may therefore be optimistic.
- **CPU throttling.** It applies to the renderer main thread. GPU-process work
  (SwiftShader) is not throttled.
- **Real-device and WebKit timings, and LCP.** Not measured. LCP is not
  meaningful for a canvas map.
- **Item 6.** The gain is an estimate, not a measurement.
- **Production-build size.** The script measures the `--mode e2e` build. It
  is the same code plus one tiny hook, but its main chunk is 1292.8 KB vs
  1323.7 KB for the plain `npm run build`. The cause of the 31 KB difference
  was not investigated, so use the plain build for absolute size claims.

## C1 implementation result (2026-10-19)

Commits `5b4dcdb` (five speed-ups), `5709bcc` (no tile preconnect in E2E
builds), `4f3408d` (railway-source errors are not basemap failures, from Codex
review), `0552a21` (E2E helper race). Branch CI green on `0552a21`.

Live OpenFreeMap tiles, Chromium software GL, gzip-served, interleaved A/B:
baseline copy of `cba1367` vs `4f3408d`, 3 rounds × 2 runs per profile
(median of 6). Raw: `.claude/logs/perf/c1-ab-live.log`.

| Metric | desktop before | desktop after | mobile before | mobile after |
|--------|---------------|---------------|---------------|--------------|
| map load (railway layers added) | 2016 ms | 547 ms (−73%) | 5502 ms | 2507 ms (−54%) |
| map idle (fully rendered) | 4131 ms | 3030 ms (−27%) | 8470 ms | 6791 ms (−20%) |
| TBT to idle | 1905 ms | 1454 ms (−24%) | 5001 ms | 3704 ms (−26%) |

Pan/move fps with live tiles stay basemap-bound (~5–7 fps on software GL); the
basemap style was left unchanged by user decision.
