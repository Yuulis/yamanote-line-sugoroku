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
