# Clear screen replay and X image share (#69) — Step prompts

Shared preamble for every implementation step (prepend to each step prompt):

```
You are implementing one step of an approved plan in /home/yuulis/yamanote-line-sugoroku (branch feature/clear-replay-share).
Read first: .claude/docs/plans/clear-replay-share-plan.md (the "Revision 3 changes" and "Revision 2 changes" sections,
"Assumptions for user confirmation" (all approved by the user 2026-11-22), the Architecture / Interface / Data Flow /
Error Handling sections, and your step section), .claude/docs/research/feature-clear-screen-replay-and-share-brief.md,
.claude/docs/research/feature-clear-screen-replay-and-share-codebase.md, and .claude/rules/{coding-principles,testing}.md.
Rules:
- Implement ONLY the named step. Do not start later steps. Do not commit, push or touch git history.
- Presentation only: do not change src/features/game/engine/, RNG, save format, src/types/network.ts, public/data/, data/,
  package.json / lockfile. Do not modify src/features/game/animation/movePath.ts (Revision 3).
- Do not delete, skip or weaken tests. When an existing assertion must change because of a planned UI change, keep the
  same behaviour checked (e.g. open the history <details> through the UI, then assert exactly what was asserted before).
- No placeholders, TODOs, swallowed errors or hard-coded shortcuts.
- Keep new files within ~200-400 lines; edits to GameApp.tsx and RailwayMap.tsx are wiring only.
- Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=2` at most, only the listed specs; never the full E2E suite.
- Run the step's acceptance commands yourself and report the exact results (counts).
Output format:
## Changes Made (file: summary)
## Tests (added / updated, with names)
## Validation Results (each command + result)
## Deviations from the plan (with reason)
## Remaining Risks
```

## S1 — saved result model and strict route

```
Implement plan "S1 — 保存結果モデルと厳密な経路" exactly (visible: no; nothing is wired into the UI in this step).
Create src/features/game/clearResult.ts and src/features/game/clearRoute.ts with the interfaces in the plan's
"Interface Design / 結果と経路" section, and tests/unit/clear-result.test.ts and tests/unit/clear-route.test.ts written first.
Key contracts:
- Records: MoveRecord uses serviceId/direction; item-ride uses resolvedRide; deadhead is narrowed FIRST and never reads
  resolvedRide. Validate every saved hop with nextStationId/findSegment against traversedSegmentIds and the arrival station.
- Geometry: use the directed segment's geometryFeatureIds in stored order (never reverse), orient features with the existing
  rules, call stepPath with its existing signature. Any missing feature, gap, non-finite coordinate or zero-length path makes
  route = null while topology-based highlights stay identical.
- Highlights exactly as the plan's "保存履歴とハイライト" §3-§6 (longest ride across turns by lineGroupId; most-used excludes
  the target service's line group and is null when empty; farthest = great-circle from config.startStationId over saved
  segment endpoints, deadhead destinations and the start, compared unrounded, no geometry joints; items used = consumed +
  certificates deduplicated by instance id; avoided = certificate cancellations per event; roll adjustment counted once
  via its consumed event).
- summary and shareText come from the existing summarizeGame / buildShareText; assert the full share text byte-for-byte
  for a classic and an item save.
Include every test case listed under S1 "tests first", plus forward and reverse directed records with at least two
features each (Revision 3).
Acceptance: npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build.
```

## S2 — published clear result, single announcer, phone layout (Claude subagent: general-purpose-sonnet)

From S2 the user switched implementation to Claude subagents (2026-11-23): Sonnet implements, Opus reviews.

```
Implement plan "S2 — 結果公開、読み上げ、電話レイアウト" exactly (visible: yes). S1 is committed (e218c98):
src/features/game/clearResult.ts exports deriveClearResult(input) -> { summary, shareText, highlights, route }.
Scope:
- New src/features/game/usePublishedClearResult.ts: called from GameApp at the existing showClear publication; memoised
  on game/history reference + network/geometry/presentation/display refs (never on history length); monotonically
  increasing generation per continuous clear publication; ClearScreen keyed by it. Route is NOT drawn yet (S3).
- New ClearAnnouncements.tsx: the single polite live region on the clear screen (completion, paging, share results; later
  replay/image). Mount empty, emit the existing turnDisplay.clearAnnouncement once at the same publication timing.
  Move ItemEventNotice's clear-time live region here, keep its visible text. Paging text and share status stay visible
  where they are but lose duplicate live attributes. Keep heading focus + scroll-to-top layout effect, the save-failure
  warning/alert, the text copy/share fallback and both collection counters.
- Highlights section (on screen only), heading 「ハイライト」, rows (omit a row whose value is null; items show 「なし」 when empty):
  最長の乗車: 「{line group name} {count}駅（{from}→{to}）」
  最も使った路線（{target line name}以外）: 「{line group name} {count}区間」
  一番遠くまで行った駅: 「{station}（{start station}から {km with 1 decimal}km）」
  使ったアイテム / 避けた不利なアイテム: 「{item name}×{n}」 joined by 「、」, or 「なし」
  Resolve names via the existing PresentationResolver / item display helpers; reuse LineBadge where natural.
- Phone (<=600px, existing breakpoint): order = heading, three numbers, share actions, もう一度遊ぶ/title actions,
  highlights, then the move history inside <details> (summary 「移動履歴」, closed by default). Desktop keeps the history
  visible (no disclosure) with the same single history DOM and page state across widths. Move clear-only CSS from
  src/styles.css into src/features/game/components/clearScreen.css (check import order and cascade).
- GameApp.tsx changes are wiring only.
Tests first: update/add in tests/unit/game-app-turn-moments.test.ts, hud-progress-components.test.ts, result-share.test.ts
(publication boundary, all three 演出 levels, one goal announcement, map-unavailable single polite status, heading focus,
save warning, text-share fallback; query share buttons by accessible name, not order). Add unit tests for the highlights
rendering (each row, null rows omitted, 「なし」). Audit history usage in tests/e2e/{text-wrapping,capital-region,items,
tokyo-suburban,full-game}.spec.ts: where the real viewport is phone width, open 「移動履歴」 through the UI and keep every
original assertion (20 entries, paging, scroll reset, final-entry wrapping, history equality across reload). Never weaken
or delete assertions.
Acceptance (run all, report counts): npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build;
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/items.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/full-game.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
Also add one E2E (tests/e2e/clear-replay-share.spec.ts, new) that loads tests' pinned tokyo-suburban-before-clear-save.json,
clears with one roll, and checks: highlights section visible; at 320x568 the three numbers, share buttons and
もう一度遊ぶ are visible without scrolling the card and the history is closed; no horizontal overflow (save warning case
included). Tag phone cases @layout.
Screenshots for the user's review (not committed): after the clear in that save, capture the clear screen at 1280x800,
390x844 and 320x568 to .claude/logs/screenshots/issue69-s2-{desktop,phone390,phone320}.png (a small throwaway Playwright
script or a test.step with page.screenshot guarded by an env var that is off in CI).
```

## S3 (Revision 4) — clear card cleanup, history dialog, phone sheet (Claude subagent: general-purpose-sonnet)

```
Implement plan "Revision 4 changes (user 2026-11-23)" step "S3 — クリアカード整理と移動履歴ダイアログ" exactly (visible: yes).
S1 (e218c98) and S2 (7b54daa) are committed. Read the Revision 4 section fully: "Proposals for user confirmation" rows
履歴 and 電話シート (approved by the user 2026-11-23 as written, including the desktop/320px text mock), "Changes to
committed S2 code", the S3 step, and "Ported history assertions".
Scope:
- Remove from the clear card: the in-card history list / phone <details>, and the clear turn's own arrival log line that
  ItemEventNotice renders on the clear screen (.item-event-notice__completion and its GameApp wiring). Keep the single
  completion announcement in ClearAnnouncements (announced once), and keep item notices that have real content.
- Add a 「移動履歴を見る」 button after the main actions that opens a native <dialog> named 「移動履歴」 (showModal, focus
  on the heading when opened, Escape and 閉じる return focus to the button, background inert like ConfirmDialog).
  One row per turn, 20 per page, paging inside the dialog with the existing page text format, scroll reset on page change,
  page kept while reopening within the same result generation, reset on a new publication.
- Extract a presentation-only history formatter that builds structured row data (turn, roll/effects text, from→to,
  line + direction, notes for transfer / truncation / items) from saved records, reusing existing helpers
  (lastRollText, itemEventTexts, item history text, station/line/direction resolvers). S5 will reuse it for captions, so
  export a typed row model. Classic and item saves both supported.
- Desktop: columns as in the mock. 320px: same DOM stacked, names wrap in full, no horizontal overflow, ≥44px targets.
- Phone sheet max-height 65%; at 320x568 with scrollTop 0 the three numbers, 結果をコピー, もう一度遊ぶ, タイトルへ and
  移動履歴を見る must be fully inside the sheet; also check 390px and landscape 667x375, and the save-warning case for
  reachability and no horizontal overflow. If 65% cannot fit, adjust spacing first and report measurements instead of
  silently raising the cap.
Tests first: port every history assertion listed in "Ported history assertions" into the dialog (update the
openClearHistory helper in tests/e2e/support/app.ts to click 移動履歴を見る and return the dialog); keep every original
check (20/20/20/20/16 pages for the 96-turn fixture, paging both ways and disabled ends, scroll reset, final entry
exact text and wrapping at 320x568, history equality across reload, full-game turn matching then 閉じる and restart).
Add unit tests for the formatter (classic, item, roll adjust, effects, deadhead, transfer, truncation) and the dialog
(focus, Escape, page persistence, generation reset). Replace the old visible arrival-log checks with absence on the card
+ one ClearAnnouncements announcement. Never weaken or delete assertions without a stronger replacement.
Acceptance (report counts): npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build;
npm run test:e2e -- tests/e2e/{clear-replay-share,text-wrapping,hud-layout,capital-region,items,tokyo-suburban,full-game,accessibility}.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/{clear-replay-share,text-wrapping,hud-layout,capital-region,accessibility}.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
Screenshots (not committed, env-gated, off in CI): clear card at 1280x800, 390x844, 320x568 and the open history dialog
at 1280x800 and 320x568 to .claude/logs/screenshots/issue69-s3-{desktop,phone390,phone320,dialog-desktop,dialog-phone320}.png.
```

## S4 (Revision 4) — full-route layer and clear camera (Claude subagent: general-purpose-sonnet)

```
Implement plan step "S4 — 全経路レイヤーとカメラ" in "Revision 4 changes (user 2026-11-23)" exactly (visible: yes).
It ships the old Revision 2/3 "S3 — 全経路レイヤーとカメラ" content: read that old S3 section and the Architecture
"地図と読み上げ", Interface "リプレイと地図" (only the full-route parts; partial drawing/replay store is S5),
Error Handling, and Revision 3 changes ("S3 ships the full-route GeoJSON builder and a static full-route input").
S1-S3 are committed (e218c98, 7b54daa, 0aad2a3). Use publishedClear.result.route (ClearRoute | null) from
usePublishedClearResult; route ownership keyed by the same generation.
Scope:
- src/features/map/clearRouteLayers.ts: one GeoJSON source + casing and main line layers built from ClearRoute legs
  (ridden-service colour per leg; separate LineStrings at leg breaks; never draw deadhead jumps), inserted below the
  station circles/labels with a defined fallback anchor when those layers are absent; re-added after style reload
  (RailwayMap's existing style-restore point) with the latest data.
- src/features/game/clearRoute.ts (or a small new module): pure full-route GeoJSON builder (no partial cursor yet).
- src/features/map/clearRouteCamera.ts + useClearRouteMap.ts: on clear (fresh clear and reopening a cleared save,
  including after reload), fit route.bounds immediately (no animation) into the map area not covered by the clear card:
  padding from the measured card rect vs the map container (desktop centred card, phone 65% bottom sheet), refit on
  resize/orientation/visualViewport and card size changes (rAF-coalesced, ResizeObserver), sensible min padding and
  max zoom, a one-point / zero-space fallback, keep the previous camera while measurements are unavailable, restore
  padding and gameplay layers/controls when leaving clear (restart, title, edition switch). The history dialog (top
  layer) must not change the measured card.
- Clear mode keeps map controls hidden and the map inert (DESIGN row 289); the progress/current-position/goal gameplay
  layers stay hidden or unchanged per the plan; map credits stay readable. route === null (geometry fault) or a failed
  map: no route layer, the clear card still works, any message goes through ClearAnnouncements (no new live region).
- GameApp.tsx / RailwayMap.tsx edits are wiring only (pass route + card ref / mode; call the hook at the existing
  style-restore point). Keep files ~200-400 lines.
Tests first: tests/unit/clear-route-map.test.ts (source/layer ids and order, insertion anchor with and without station
layers, style restore re-adds with latest data, padding computation for desktop card / phone sheet / no-space, one-point
fit, padding restore and gameplay layer restore on exit, route null), extend tests/unit/title-map-mode.test.ts and the
existing map double only as needed. E2E in tests/e2e/clear-replay-share.spec.ts: after the pinned one-roll clear the
route source exists with the expected feature count and its rendered bounds lie inside the uncovered map area
(desktop 1280x800 and phone 320x568/390x844 @layout), reload and reopen keep it, restart restores gameplay layers and
controls. Use the existing e2e map hook (src/features/map/e2eHook.ts) to read map state; keep it e2e-build only.
Acceptance (report counts): npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build;
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/title-screen.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
(if title-screen.spec.ts does not exist, use the spec that covers the title map overview instead and say which).
Screenshots (env-gated, off in CI, not committed): clear screen with the route at 1280x800, 390x844 and 320x568 using
the real-data pinned save to .claude/logs/screenshots/issue69-s4-{desktop,phone390,phone320}.png.
```

## S4b — clear map shows only the travelled route in colour (Claude subagent: general-purpose-sonnet)

User decision 2026-11-23 after S4 review: on the clear screen colour only the travelled route; every other line looks
like a line whose legend checkbox is unchecked (i.e. only the basemap's own grey railway remains), and the route line
is a bit wider.

```
Implement S4b (visible: yes). S4 is committed (d92ca68).
- In clear mode, apply the same mechanism the legend uses for unchecked line groups (src/features/map/lineVisibility.ts
  updateLineGroupVisibility / filters on railway-base and railway-services) as if NO group were selected, so all coloured
  network overlays disappear and only the basemap's grey railways remain; also hide railway-current-service in clear.
  Keep station circles/labels, the goal ring and the clear route. Restore the player's legend selection, filters and the
  current-service layer exactly when leaving clear (restart, title, edition switch) and re-apply after style reload
  (layersRevision). Check how the completed/pending Yamanote progress layers look in clear; if they overlap or compete
  with the route, hide them in clear too and restore on exit — report what you chose and why.
- Route line width: main 5 -> 7 px, casing 9 -> 11 px (constants in clearRouteLayers.ts).
- Also from the S4 review: in applyClearRouteLayers check getSource before calling map.getStyle(); guard
  applyClearRouteFit against a removed map.
- Wiring only in RailwayMap.tsx / GameApp.tsx; put the clear-mode visibility logic in a small module or in
  useClearRouteMap.ts.
Tests first: unit tests for entering clear (filters/visibility set), leaving clear (exact restore incl. a custom legend
selection), style reload while in clear, and the getSource-before-getStyle change; extend clear-replay-share.spec.ts
to assert in clear that railway-services/railway-base render no features (queryRenderedFeatures or filter state via
the e2e hook) while clear-traveled-route does, and that after もう一度遊ぶ the network lines are back.
Acceptance (report counts): npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build;
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts tests/e2e/title-map.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
Screenshots (env-gated, off in CI): .claude/logs/screenshots/issue69-s4b-{desktop,phone390,phone320}.png.
```

## S5 (Revision 4) — per-turn replay, caption, speed, pause; short history roll form (Codex Luna xhigh)

From S5 the user switched back to Codex (2026-11-23): Luna xhigh implements, Sol low reviews.

```
Implement plan step "S5 — ターン同期リプレイ、速度、一時停止" in "Revision 4 changes (user 2026-11-23)" exactly
(visible: yes), plus the carried decisions in .claude/docs/plans/clear-replay-share-handoff.md ("User requests carried"
and the S3/S4 review notes). S1-S4b are committed (latest 3a57981). Read the Revision 4 "Proposals" rows 字幕 and
速度と停止 (approved by the user) and the older Interface "リプレイと地図" / Data Flow / Error Handling for the store.
Scope:
1. Structured history rows (src/features/game/historyRows.ts): add typed fields shared by captions and the dialog —
   kind (ride / item-ride / deadhead), recordIndex, turn, rawRoll, effectiveRoll, adjusted, effect kinds, from/to station
   names, hop count, line/direction text, notes. The dialog roll column uses the SHORT form (user 2026-11-23):
   「出目4」, 「出目3→4」 (roll adjustment), 「出目4・快速」 (effects, item display names joined by ・), 「回送」 (deadhead).
   The move column carries the station count: 「永田町 → 半蔵門（3駅）」. Unused pips / early stop become ONE consistent
   note for classic and item saves (no double 「停止」). Remove or deliberately keep itemHistoryText (presentation.ts) and
   say which. Add the missing suspension-note unit test. Port full-game / text-wrapping / items / capital-region history
   assertions to the new fields with exact toHaveText (never weaker).
2. Replay store (src/features/game/clearReplayStore.ts): external store with subscribe/getSnapshot, start, pause,
   resume, finish (全経路を表示), setSpeed, dispose; per-turn pacing ゆっくり 900 / ふつう 550 (default) / はやい 250 ms per
   saved turn, distributed over that turn's hops by the existing distance weighting; no overall cap; speed change keeps
   the current position; speed kept while the same result generation is shown, reset on reload/new publication.
   Zero-hop turns and deadheads still show one turn's caption and keep the drawn route (no line across a deadhead).
   Snapshot = { phase: idle|playing|paused|done, recordIndex, stepIndex, fraction }. Injectable scheduler; stale run
   callbacks ignored; visibilitychange hidden -> pause (not finish; the user resumes); OS reduced motion -> full route at
   once and the play control reads 「全経路を表示」 semantics per plan; opening the history dialog pauses.
   Add turnSpans (recordIndex -> half-open step range) to the result/route model as the plan says; keep steps/legs/bounds
   and route===null behaviour.
3. Map: partial GeoJSON (completed legs + current leg prefix by cumulative distance; never a 1-point LineString) applied
   through applyClearRouteLayers' setData path from an imperative store subscription in useClearRouteMap (never remove /
   re-add layers per frame; React state changes only on phase/recordIndex changes). After style reload re-apply the
   latest snapshot. When idle/done the full route is shown (as in S4).
4. UI: a 「軌跡を再生」 button on the clear card (desktop and phone), and while playing/paused compact controls:
   一時停止/再開, speed (3 presets, a native radio group or segmented buttons with accessible names), 全経路を表示.
   Caption: one line over the map in the uncovered area (not under the card or the credit button), format per the
   approved proposal (「12ターン目：出目4 → 半蔵門」 etc., derived from the structured rows), station part ellipsised on
   320px, full text kept in the DOM; captions are NOT live-announced per turn. Announce only start / pause / finish via
   ClearAnnouncements. If route === null, the replay button is not shown and a short non-live note explains that the route
   cannot be drawn (or announce once via ClearAnnouncements — pick one and say why). Keep the caption slot out of the
   camera fit area (add it to padding). Re-measure the phone sheet: at 320x568 with scrollTop 0 the three numbers,
   結果をコピー, もう一度遊ぶ, タイトルへ, 移動履歴を見る and 軌跡を再生 should be inside the 65% sheet; if they cannot fit,
   report measurements and the smallest change you propose instead of raising the cap silently.
5. GameApp.tsx / RailwayMap.tsx wiring only; files ~200-400 lines.
Tests first: unit (store: exact turn/step boundaries, multi-hop, zero-hop, same-station deadhead, trailing empty turn,
speed change mid-turn, pause/resume, finish, natural end, replay again, hidden tab, reduced motion, style restore, stale
callbacks, a long fixture past 12 s of virtual time; history rows short form for classic/item/adjust/effects/deadhead/
transfer/truncation/suspension; caption text incl. 320px truncation class), and E2E in clear-replay-share.spec.ts with
reducedMotion 'no-preference' for playing cases (caption and drawn feature count advance together; pause holds;
はやい speeds up; 全経路を表示 completes; replay again works; history open pauses; reduced-motion case shows full route
at once); phone cases @layout.
Acceptance (report counts): npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build;
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts tests/e2e/text-wrapping.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/items.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/full-game.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/title-map.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts tests/e2e/text-wrapping.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
Screenshots (env-gated, off in CI, not committed): mid-replay at 1280x800 and 390x844 and 320x568, paused state at
320x568, history dialog with the short roll form at 1280x800 and 320x568 ->
.claude/logs/screenshots/issue69-s5-{replay-desktop,replay-phone390,replay-phone320,paused-phone320,dialog-desktop,dialog-phone320}.png.
```
