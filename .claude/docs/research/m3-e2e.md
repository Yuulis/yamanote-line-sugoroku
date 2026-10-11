# M3 E2E Suite (Playwright) — Notes

Status: 48 tests (16 x 3 projects) green twice in a row, ~90-100 s wall
(2026-10-11, WSL2, 12 cores / 7 GB, 4 workers).

## Layout

- `playwright.config.ts` — projects `desktop-chromium` (1280x800),
  `phone-chromium` (Pixel 7, 412x839, touch, DPR 2.625), `desktop-firefox`.
  WebKit omitted: launch fails without `sudo npx playwright install-deps`.
- webServer: `vite build --mode e2e --outDir node_modules/.cache/sugoroku-e2e-dist`
  then `vite preview` on `[::1]:4319` (override `E2E_HOST=127.0.0.1`).
- `tests/e2e/fixtures.ts` — auto fixture: map stub routes + deterministic
  `crypto.getRandomValues` (xorshift32, restarts on each load) + "no blocked
  external request" assertion at teardown. Fresh context per test = empty
  localStorage.
- `tests/e2e/support/mapStub.ts` — fulfils style/tiles/glyphs on
  `tiles.openfreemap.org`, aborts every other non-local URL and records it.
  Switches `failStyle` / `failTiles` simulate outages.
- `tests/e2e/support/app.ts` — role/name selectors, save read/write,
  `readMap()` (via hook), `freezeClock()`, `loadStations()`,
  `loadManifestSource()`.

## Spec 8.3 mapping

| 8.3 | Tests |
|-----|-------|
| 1 PC/phone layout | layout: title -> map + controls visible, panel < 50 % of map area, zoom not under panel |
| 2 dice -> position | dice: station/turn/roll/progress text + marker coords + marker rendered; animation test (marker mid-hop, move ends without skip); full-game |
| 3 completed distinguishable | dice: legend items, filter ids == save, rendered completed/pending sets disjoint and correct, solid vs dashed, colours differ |
| 4 reload | resume: つづきから restores station/turn/progress/map; next roll == non-reloaded control run (same seed); reload mid-move; save-errors: corrupt JSON / saveVersion 999 / tampered rngSeed -> Japanese alert -> 破棄 -> 削除する; cancel keeps save |
| 5 rapid clicks | dice: triple click + forced clicks while moving + 3 clicks in one JS task -> one turn each |
| 6 tile/style failure | map-failure: style down on reload (banner, save intact, playable, 再試行 recovers with current progress); tiles down before load; tiles down after load (tolerated, no banner) |
| 7 Vercel deploy | manual (below) |
| 8 attribution | layout: title credits (manifest attribution/license/link, OpenFreeMap, OSM), in-map control (data credit + provider credit, in viewport), title reachable from play |

Manual (Vercel, 8.3-7): push to `develop`/feature branch creates a Preview
deployment; merge `develop` -> `master` deploys Production; production URL
loads data from `/data/*.json`, the real OpenFreeMap style renders, and the
attribution shows OpenFreeMap / OpenMapTiles / OSM + the MLIT credit.

## Production isolation of the hook

`src/features/map/e2eHook.ts` returns early unless
`import.meta.env.MODE === "e2e"`. Vite inlines MODE as a literal, so every
other build constant-folds the body away. Evidence: `grep -c __sugorokuE2E
dist/assets/*.js` = 0 after `npm run build` (and after E2E runs, because the
E2E build writes elsewhere); the e2e bundle contains it. Caveat: an explicit
`npm run build -- --mode e2e` would ship it.

## Mutation checks (temporary src edits, reverted)

Caught: marker `circle-radius: 0`; marker `visibility: none`; completed
filter on a wrong property; pending layer without dash; rAF scheduler that
never fires. Before hardening, radius 0 passed (stroke still hit-tests;
`queryRenderedFeatures` ignores opacity) — hence the paint check in `readMap`.

## Environment findings

- WSL2 `networkingMode=mirrored`: connect to a *closed* port on 127.0.0.1 is
  dropped (SYN timeout ~135 s) unless the port was used recently. Playwright's
  pre-start "is the URL in use?" GET hit this and stalled runs by 2+ minutes.
  `::1` / `127.0.0.2` refuse immediately -> server binds `::1`.
- Dead proxy `http://[::1]:9` + bypass `127.0.0.1,localhost,[::1],::1`
  (Chromium matches `[::1]`, Firefox/Juggler the bare `::1`). Probe verified:
  an un-routed `fetch("https://tiles.openfreemap.org/...")` fails in all three
  projects within 200 ms.
- `page.clock.pauseAt(now + 1s)` raced under load in Firefox ("Cannot
  fast-forward to the past"); `freezeClock` uses +60 s.

## Flakiness risks

- Software WebGL is CPU-bound: per-test time triples under 4 workers; phone
  full-game / resume take ~15-17 s against a 30 s timeout. Lower
  `LOCAL_WORKERS` on slower machines.
- Rendered-feature checks (`queryRenderedFeatures`) depend on the follow
  camera keeping the marker and nearby segments in view.
- Firefox is not part of the original brief; drop the project if it becomes
  noisy (`--project=desktop-chromium --project=phone-chromium`).
