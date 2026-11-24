## Feature Brief: Issue #69 clear screen replay, highlights and X image share

### Current State
- Architecture: ClearScreen (`src/features/game/components/ClearScreen.tsx`) is a self-contained card mounted from `src/app/GameApp.tsx:747-762` at `deriveTurnMomentDisplay().showClear`; it shows a heading, a hard-coded summary, three numbers, a 20-per-page text history, 結果をコピー / 共有 (Web Share text only) and actions. RailwayMap (`src/features/map/RailwayMap.tsx`) has no clear-mode camera; the map is `inert` and controls hidden on clear (DESIGN row 289). No image export exists; `createMap` sets no `canvasContextAttributes`.
- Relevant files: ClearScreen.tsx, GameApp.tsx, RailwayMap.tsx, railwayLayers.ts / progressStyle.ts, movePath.ts (`stepPath`), animation runner.ts / timeline.ts, resultShareActions.ts, shareText.ts, gameSummary.ts, analytics.ts (`safeParams`, `EVENT_VALUES.method = ["copy","share"]`), mapConfig.ts (`MAP_CREDITS`), public/privacy.html, styles.css.
- Patterns: pure derivation modules with unit tests in `tests/unit/**/*.test.ts` (jsdom, no canvas); presentation hooks keyed by sessionId; injectable scheduler in `runMoveAnimation`; analytics allow-list drops unknown values; E2E in `tests/e2e` with pinned fixture saves (`tokyo-suburban-before-clear-save.json`, one roll to clear) and a fixture that fails real navigation to external hosts (`fixtures.ts:77-82`).
- Full scan: `.claude/docs/research/feature-clear-screen-replay-and-share-codebase.md`; platform facts: `.claude/docs/research/clear-screen-replay-and-share.md`.

### Feature Goal
Make the clear screen feel like an achievement: let the player replay the travelled route on the real map (on demand, repeatable, ending on the full-route view), show highlights, and share the result to X in one tap with a PNG of the full trajectory on the real map.

### Scope
- Include:
  - Trajectory replay: button on the clear screen; the route draws progressively from the start and ends on the full-route view; replayable any number of times. Before replay the map is fitted to the full travelled route (assumption, Codex default).
  - Highlights (on screen only), user decisions 2026-11-22:
    - 最長の乗車 = most consecutive stations on the same line until a transfer, spanning turns (e.g. 京浜東北線 23駅 大宮→品川).
    - 最も使った路線 = line group with the most segments, excluding 山手線; hidden if only 山手線 was ridden.
    - 一番遠くまで行った駅 = largest straight-line (great-circle) distance from the start station 新橋, with km.
    - 使ったアイテム (consumed + delay certificates) and 避けた不利なアイテム (certificate cancellations).
  - Phone clear screen: numbers, share actions and もう一度遊ぶ first; move history folded in `<details>`.
  - X share: phones = Web Share API with PNG file + text; desktop = 「Xでシェア」 writes PNG to clipboard, then opens `https://x.com/intent/post?text=…` in the same click, with a paste hint; plus 「画像を保存」; fallbacks for browsers without file share / clipboard image.
  - PNG: real MapLibre basemap fitted to the full route, travelled route drawn, the three existing result numbers (no highlights), legible credits (OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors, N02 railway data source).
  - Analytics: `result_share` with method `x` and image save; privacy policy discloses x.com handoff.
- Exclude:
  - Leaderboard / comparison with other players (issue #124), localStorage best or history, simulation percentile.
  - Highlights in share text or PNG (user 2026-11-22); share text stays per DESIGN row 227.
  - Engine, RNG, rules, save format, public rail data (D5 freeze).

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: 16-20
- Estimated LOC: 900-1,470 (incl. 300-490 test LOC)
- Implementation route: team-execute (project practice: paused steps, Codex Luna implements, Sol low reviews, lead verifies)

### Integration Points
- Result publication: `deriveTurnMomentDisplay().showClear` stays the single publication boundary (row 241); one pure result model feeds the UI and the PNG; the existing share status element stays the single status channel.
- Route reconstruction: ordered `traversedSegmentIds` + `resolvedRide` from saved records, oriented with `stepPath`; separate legs at platform changes; deadhead records have no geometry (jump).
- Live map: new travelled-route source/layer (re-added on style reload), clear-mode camera fit padded for the desktop card / phone sheet, refit on resize and on reopening a cleared save; controls stay hidden.
- Export: short-lived off-screen MapLibre map with `canvasContextAttributes.preserveDrawingBuffer`, fixed 16:9 size, credits composed into a 2D canvas; PNG pre-generated before any share click.
- Share/analytics: resultShareActions capability routing; analytics allow-list extended; privacy.html updated.

### Risks
- Second WebGL context on phones / CI software WebGL: create once per result, cap size, cache the PNG, release on every exit path; buttons that need the image wait until it is ready; text share keeps working if export fails.
- Transient user activation (iOS Safari): pre-generate the PNG; clipboard.write before window.open with no await between.
- X app may drop text when files are shared, intent may open the login page: put URL inside text, copy text as backup, manual physical-device check in the release checklist.
- Long games (p99 ~261 turns, ~300 hops): replay duration cap and skip-to-end.
- Test coupling: unit tests assume button order; phone `@layout` E2E assume visible history; use role/name queries and open `<details>`; stub share/clipboard/window.open.

### Success Criteria
- Replay button draws the full route from the start and ends on the full-route view; repeatable; works after reload of a cleared save; OS reduced motion shows the full route immediately.
- Highlights match the definitions above in unit tests (including empty states).
- Phone layout shows numbers, share and もう一度遊ぶ without scrolling the history; history in `<details>`.
- PNG decodes at the expected size with credits; phone share passes a PNG file + text; desktop copies PNG then opens the intent; 画像を保存 downloads; failures fall back without losing the text share.
- `result_share` sends method `x` / save; privacy policy updated.
- typecheck, vitest, build, lint and the E2E suite pass; no engine/save/data change.
