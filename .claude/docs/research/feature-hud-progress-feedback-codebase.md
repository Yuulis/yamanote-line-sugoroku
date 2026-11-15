# Feature #65 HUD progress feedback: affected-area codebase scan

Date: 2026-11-15. Author: general-purpose-opus (read-only scan; no source edits).
Base: `develop` at `05cace4` (v0.15.0 released; #66 turn-result card merged as PR #90 `de8d901`).
Issue: GitHub #65 「進捗の手応え・遠回り中の楽しみ」. Related UX findings: UX-05 (P0), UX-22 (P1), UX-12/UX-15
(`.claude/docs/research/ux-improvement-analysis.md`, written at v0.12.0 so some line refs there are stale).

Scope under study (user-approved ideas):

- (A) HUD row 「山手線まで あとN駅（近づく／遠ざかる）」, only while off the Yamanote line.
- (B) Milestone toast + progress-bar flash at 10/20/25/29 completed segments.
- (C) Collection counters 「訪れた駅 n/1,586」「乗った路線 n/134」 in the HUD (subtle) and on the clear screen.
- (D) Phone: fold ログ / メニュー / legend controls into one hamburger menu; the log shows only the last turn by
  default (full log behind the menu); legend usually ON.
- Out: rule changes, "+1" first-visit pops, next-segment name, map visuals (#62), wider phone sheet redesign (#71).

## 1. Code map

### HUD

- `src/features/game/components/GameHud.tsx` (130 lines). Pure props component. `<dl className="game-panel__stats">`
  with six `dt/dd` pairs in DOM order: 現在駅 (`data-stat="station"`, :81-82), 乗車中 (`ride`, :83-84), 進行方向
  (`direction`, :85-86), ターン数 (`turn`, :87-88), 踏破区間 (`progress` + bar or goal guidance, :89-94), 出目
  (`roll-compact`, :95-96). Then actions (dice / スキップ / おまかせ, :98-118), `turnResult` slot (:119),
  `inventory` slot (:120), `EffectChips` (:121), save status (:122-127).
- Phone CSS positions the stats by `dt/dd:nth-of-type(n)` (`src/styles.css:2373-2384`), so **inserting a new `dt/dd`
  pair anywhere but the end renumbers every phone cell**. Append new pairs after 出目, or give the new row its own
  element outside the `dl`.
- `src/features/game/components/TargetProgressBar.tsx` (34 lines): `role="progressbar"`, 30 `span` cells from
  `progressSegments()` (`hudPresentation.ts:74-81`). No animation hook today; CSS `.target-progress*`
  (`styles.css:823-870`, reduced-motion block `styles.css:905-910`).
- `GamePanel.tsx` builds every HUD prop from the reveal-gated `turnDisplay` (`GamePanel.tsx:327-371`); completed count
  = `turnDisplay.progress.completedSegmentIds ∩ requiredTargetIds` (:352).
- After 30/30 the bar is replaced in the same cell by goal guidance 「新橋に着けばクリア」 (`GameHud.tsx:90-94`,
  DESIGN.md row 261).

### Reveal gating (the single source of truth)

- `src/features/game/turnMomentPresentation.ts` `deriveTurnMomentDisplay` (:207-…) derives everything the panel may
  show: `progress` (displayed, per hop while animating), `ride` (gated until lottery publication), `goalGuidance`,
  `toastInputs`, `turnResult`, `announcement`. Phases: `pre-move` / `moving` / `arrival` / `segment-flash` /
  `lottery-flip` / `lottery-settle` / `pickup` / `published` (:82-93).
- Every new HUD value for #65 must be derived from `turnDisplay` (station = `progress.stationId`, ride =
  `turnDisplay.ride`), never from `session.game`, or it leaks the lottery result before the board settles (same rule
  #62 and #66 followed: DESIGN.md row 261, #66 decision 7).
- `src/features/game/animation/displayedProgress.ts`: while animating, `stationId` advances per hop and
  `completedSegmentIds` grows per hop (:43-73).

### Toasts / milestones (existing mechanism to extend for B)

- `src/features/game/toastQueue.ts`: `ToastInput {key, sessionId, turn, eventIndex, text, tone, itemKind?, sticky}`.
  `MAX_VISIBLE_TOASTS = 3` of which 2 ordinary + 1 reserved for the sticky save failure (:8, :180);
  `TOAST_READING_MS = 4000` (:9). Queue cursor accepts only inputs newer than `(turn, eventIndex)` (:183-190), and
  waiting toasts from older turns are dropped (:193-197).
- The 30/30 milestone already exists: `targetSegmentsMilestoneToast` (:124-138), key
  `${sessionId}:milestone:target-segments:30`, `eventIndex = -1` "so the milestone sorts before every item event";
  comment at :115 says **"#65 adds thresholds as further negative indexes"**.
- Producer: `turnMomentPresentation.ts:177-179` (milestone toasts only when `goalGuidance` is public and movement is
  complete) using `firstTargetCompletionTurn()` (`mapGuidance.ts:87-104`) — a pure history replay, no persisted flag
  (DESIGN.md row 261 explicitly rejected "persisted milestone flags").
- Resume safety: `GameApp.tsx:65-72, 230-245` snapshots the toast keys present when a session is entered
  (`toastBaseline`) and never shows them, so a milestone reached before a reload does not replay.
- Live region: toasts are `aria-hidden` (`ToastHost.tsx:105`); the 30/30 text is appended to the polite
  `announcement` once (`turnMomentPresentation.ts:200-206`, `milestoneAnnounced`). Milestones 10/20/25/29 need the
  same treatment to be accessible.
- `ToastHost` timers pause while `obscured` (confirm dialog, decision dialog, item dialog; `GameApp.tsx:428`).
- Toasts are **not** gated by 演出 level today; `reducedMotion` only removes the enter animation
  (`ToastHost.tsx:108`).

### Turn-result card (#66) — finished and released

- `git log`: steps 1–13 `8b3d119..c84fdb9`, merged `de8d901`, released v0.15.0 (`.claude/docs/plans/turn-result-card-handoff.md`
  "Released"). Components: `TurnResultCard.tsx` (card + short-landscape compact row + phone pill), `turnResultCard.ts`
  (model), `turnResultPillLayout.ts` / `useTurnResultPillLayout.ts` (measured pill position).
- Named empty **#65 slot**: `TurnResultCard.tsx:75-77` `<div className="turn-result__reserve" aria-hidden>`,
  CSS `styles.css:718-725` `--turn-result-reserve-height: 0px` ("#65 decides its own space later", user 2026-11-14).
  Hidden on phone and short landscape (`styles.css:2232-2235`, `:2629-2632`).
- Phone: the card is replaced by a fixed pill above the panel (`GamePanel.tsx:454-455`), tap → opens and reveals the
  log (`activateLogPill`, :194-198). The pill's position is measured from `.game-panel` top, so a different panel
  height is followed automatically, but its tests must be re-run (handoff "Follow-ups").
- Phone HUD hides 出目 (`roll-compact`) by CSS only and **the freed cells (row 3, columns 3-4) stay empty**
  (`styles.css:2335-2338`; #66 decision 5a: "any reuse of the freed 出目 cells is #71").

### Log, menu, legend

- `TurnLogDrawer.tsx` (121 lines): trigger 「ログ」 + `section.game-panel__log` (hidden). Content is **current turn
  only**: 「このターン」 出目, arrival text, 抽選, item notice, effect texts, 「地図なしで確認」 details (untraveled
  Yamanote sections + next 5 stations), lottery candidates (`TurnLogDrawer.tsx:101-117`, built in
  `GamePanel.tsx:372-407`). There is **no multi-turn history anywhere in-game**; `movementHistory` is only listed on
  the clear screen (UX-15).
- `GameMenu.tsx` (140 lines): trigger already uses a hamburger icon + 「メニュー」 (:85-100). Region: 追尾 / 速度 /
  演出 / 新規 / タイトル buttons (:102-127), then `GameLegend`, then the shortcut hint (:128-136).
- `GameLegend.tsx` (127 lines): static swatches (踏破済み / 未踏破 / 現在地 + note) always rendered inside the menu,
  then 「路線の凡例（134路線）」 toggle + 「すべて表示」 + per-operator `<details>` checkboxes controlling map line
  visibility (`lineVisibilityStore`). The group list starts collapsed because
  `defaultLegendExpanded(134)` is false (`legendCollapse.ts`, `MAX_EXPANDED_LEGEND_GROUPS = 6`). Expanded state is
  local `useState`, not persisted.
- `GamePanel` owns one-surface-at-a-time state `activeSurface: "log" | "menu" | "card" | null` (:182-203); auto-roll
  pauses while any surface is open (`useAutoRoll` `surfaceOpen`, :205-212); shortcuts are suppressed likewise
  (:213-218). Escape handling is per-disclosure in capture phase and yields to native `<dialog>`
  (`modalDialogOpen()`).
- Layout: `.game-panel__disclosures` is a 2-column grid 「ログ | メニュー」 with the opened region spanning below
  (`styles.css:1057-1065`); on phone it is the last grid area of the panel (`styles.css:2254-2261, 2439`).

### Clear screen

- `ClearScreen.tsx` (133 lines): stats `<dl>` 所要ターン数 / 移動回数（駅間）/ 乗換回数 (:80-87) from
  `summarizeGame()` (`gameSummary.ts:19-40`), then 移動履歴 paginated 20 per page, share buttons, actions. Phone:
  bottom sheet `max-height: 60%`, history `max-height: 120px` (`styles.css:2491-2504`). Share text from
  `shareText.ts` uses `{turns, moves, transfers}` only.
- `GameApp.tsx:431-445` passes `session.game` (full history) to it.

### Settings / effects (#64)

- `gameSettings.ts`: `PresentationLevel = "all" | "important" | "none"` (演出: すべて / 重要なときだけ / なし).
  `captureTurnPresentationPolicy` (`animation/turnMomentPolicy.ts`): `showImportantMoments = level !== "none"`.
- OS reduced motion: `usePrefersReducedMotion()`; when on, the menu shows 速度/演出 as 「省略」 and disables them
  (`GameMenu.tsx:55, 106-124`).
- Persistence: `store/settings.ts`, key `yamanote-line-sugoroku:settings:v1`, `{version:1, speedId, follow,
  presentationLevel}`; the parser picks known fields and defaults missing ones (:34-43), so **an extra optional
  preference (e.g. phone legend / log mode) can be added without a version bump**. Separate from the save format.

### Layout switching

- Breakpoints: phone `(max-width: 600px)` = `PHONE_MEDIA_QUERY` (`src/features/map/mapConfig.ts:12`), used in CSS and
  JS (`GamePanel.tsx:81-99` `usePhoneLayout` via `useSyncExternalStore`). Short landscape `(min-width: 601px) and
  (max-height: 500px)`. Narrow `(max-width: 390px)` and `(max-width: 360px)` tweaks.

## 2. Data for collection counters (C)

Measured from `public/data/*.json` (dataVersion `n02-2025-7974da15af8e`):

| Quantity | Value | Notes |
|---|---|---|
| `stations.json` entries | **1,586** | No `groupId` on any station: transfer complexes are already merged into one id (aliases such as 浜松町/大門 live in `uiPresentation.stations`, 46 entries). 1,581 distinct names (浅草, 入谷, 大和, 霞ケ関, 弘明寺 are genuinely different stations). |
| Stations served by ≥1 service | 1,586 | none orphaned |
| Forward-reachable from 新橋 | 1,586 | every station is reachable in principle |
| Stations that can reach Yamanote | 1,586 | `targetHopDistances` covers all; max 88 hops (白馬). 横浜 2, 大宮 3, 千葉 8, 八王子 16, 高崎 21, 浪江 53 |
| `services.json` services | 135 (131 local, 4 rapid) | |
| `services.json` lines | 135 | 1:1 with services |
| `uiPresentation.lineGroups` | **134** | 大江戸線 groups `toei-oedo-loop` + `toei-oedo-radial`; this is the legend's 「路線の凡例（134路線）」 |
| Operators | 15 | JR East 55 services |

Recommended denominators: **stations = `network.stationsById.size` (1,586)** and **lines =
`presentation.lineGroups().length` (134)**, both derived at runtime, not hard-coded (tests use a smaller fixture
dataset under `tests/e2e/fixtures/data`). Counting by line group keeps 「乗った路線」 consistent with the legend and
with `summarizeGame`'s transfer rule (`sameLineGroup`). All 1,586 are reachable, so no "unreachable" exclusion is
needed; in practice a game visits a small fraction (the analysis suggested ~100-200).

Derivation without a `SAVE_VERSION` bump: yes.

- Saves keep the full `movementHistory` (`engine/save.ts:201-211`; `turn === movementHistory.length` is validated and
  every record is replay-checked). Save shapes use `exactKeys`, so **adding fields would break saves; deriving does
  not** (`SAVE_VERSION = 4`, `engine/game.ts:24`).
- Classic `MoveRecord` (`types/network.ts:66-78`) and item records (`ItemRideRecord` / `ItemDeadheadRecord`,
  :192-231) all carry `traversedSegmentIds`; each `Segment` has `serviceId/from/to` (:48-55). Deadhead carries
  `relocation {fromStationId, toStationId, serviceId}` with `physicalHops: 0`. A pending discard record lives in
  `game.pending.record` (`sessionProgress`, `displayedProgress.ts:36-41`).
- Visited station definitions (product decision):
  1. **Passed-through stops**: start station + `segment.from/to` of every traversed segment. Rapid segments span one
     hop, so stations a rapid train skips are not counted (they are not stops of that service). Counts grow during a
     move.
  2. **Landing stops only** (「降りた駅」): start + `toStationId` of each record. Much smaller numbers; matches the
     "+1 when first alighting" idea from the issue that was deferred.
  3. Deadhead relocation: destination counts as visited under either rule; whether the relocation's Yamanote service
     counts as "ridden" is a decision (recommend no: nothing was ridden, `physicalHops: 0`).
- Ridden line definition: line group of `segment.serviceId` for each traversed segment (a service assigned by a
  lottery but not yet moved on does not count). Yamanote counts from the first Yamanote hop.
- Publication: counters must follow reveal gating — during `pre-move`/`moving` show the origin/previous records (or
  per-hop growth from `turnDisplay.progress`), never the committed record's landing. A pure helper taking
  `(records, network, presentation, upToTurn | displayed progress)` keeps this testable.
- Cost: O(total traversed segments), a few hundred per game; memoise on `movementHistory` identity.

## 3. Proximity (A)

- `targetHopDistances(network, targetServiceId)` (`engine/proximity.ts:72-102`): reverse multi-source BFS, cached per
  network identity → O(1) lookup of "directed hops to the nearest Yamanote stop" for any station. Fits "あとN駅".
  `nearestTargetStation` (:38-64) is a per-call forward BFS that also returns *which* Yamanote station (used by
  deadhead) — useful only if the row should name the station (「品川まで あと3駅」).
- Unit is a **gameplay hop**, not a physical station: a rapid segment is 1 hop (横浜 is 2). The wording 「駅」 reads as
  "stops"; 「最短」 might be worth adding because the real path depends on lotteries and the player cannot steer.
- 近づく／遠ざかる candidates:
  1. **Direction-based (forward-looking, recommended)**: compare `distances.get(next stop on the displayed ride and
     direction)` with `distances.get(current)`; `<` 近づく, `>` 遠ざかる, `=` neither (横ばい / no label). Existing
     precedent: `rapidHeadsTowardTarget` (`engine/itemOptions.ts:79-86`) and `directionHint` (:63-77), already worded
     in UI as 「現在の向きは山手線に近づきます／遠ざかります」 (`itemPresentation.ts:34-36`). Same rule as the
     direction lottery weights (`engine/landing.ts:97-117`). Answers the issue's "今の向きが戻る方向なのか".
  2. Turn-delta (backward-looking): compare with the distance at the previous turn's station; needs the previous
     record and reads oddly right after a lottery assigns a new ride.
- Edge cases: on the Yamanote ride → row hidden (turn 0 starts on Yamanote at 新橋, so turn 0 is hidden). On a Yamanote
  *station* but riding another line → distance 0 (decide: hide, or 「山手線の駅にいます」). Terminus / area boundary:
  `nextStationId` can be undefined before the landing re-draw; the landing always re-assigns ride/direction at an
  endpoint so the idle state normally has a next stop, but code must handle `undefined` (no label). Deadhead → lands on
  Yamanote (row disappears). Route/direction tickets change the ride only at roll time; the row should reflect the
  displayed ride, so a staged draft does not change it (decide whether it should preview). During animation the
  displayed station advances per hop; either update per hop or freeze until arrival (recommend freeze to
  `published`/arrival to avoid flicker and lottery leaks).
- 30/30 reached: goal guidance replaces the bar; the proximity row still applies off-Yamanote (now "to 新橋"? The
  goal is a specific station; `nearestTargetStation` ≠ distance to 新橋). Decide whether it stays "山手線まで".

## 4. Phone layout budget

- Phone panel: `height: 45%` fixed (`styles.css:2271-2272`), scrolls internally; grid areas stats / actions /
  inventory / staged / chips / save / disclosures (`:2254-2261`).
- 320x568: panel 255.6px tall (top 304.4). `tests/e2e/text-wrapping.spec.ts:317` 「phone HUD budget」 asserts the fixed
  top block = **252px exactly** (`PHONE_HUD_TARGET_BUDGET_PX`, :16): padding 16 + stats 104 (rows **exactly**
  `18px 34px 34px 18px`, asserted at :198 via `PHONE_HUD_STATS_ROWS`) + actions 56 + 2 margin + inventory ≈ 74
  (16px label + 56px slots). Only ~3.6px remain; save row, chips, and the ログ/メニュー triggers (44px) are below the
  fold at 320x568.
- 390x844: panel 379.8px; after the 252px block ≈ 128px for save, chips, disclosures (one 44px trigger row) and
  blank (UX-12 measured ~80px dead space at v0.12.0). Pixel 7 (412x839, the `phone-chromium` project) panel ≈ 377.6px.
- Phone stats grid (`styles.css:2311-2384`): row1 現在駅 | ターン数, row2 乗車中 (span), row3 進行方向 | (出目 hidden →
  **empty cells cols 3-4, 34px tall**), row4 踏破区間 (span). That empty cell is the only zero-budget place for a
  proximity value on phone, but #66 decision 5a reserved its reuse for #71.
- Any new stats row or taller inventory changes the 252px / rows assertions (test edit needed, plus `hud-layout.spec.ts`
  dice-position tests and the `ui-pop` phone populated tests). The pill tests (#66) follow the measured panel top.
- Desktop 1280x800: fixed panel `calc(100% - 120px)` = 680px (`styles.css:614-632`); stats rows 24px. In the
  populated state (3 items, ≥2 effects, staged, failed save) the panel is full: `turn-result-card.spec.ts:1495`
  「populated result preserves desktop budget」 and `ui-pop.spec.ts:439` assert `scrollHeight ≤ clientHeight + 1`;
  DESIGN.md row 281 measured **~24px slack** after the #66 card. So desktop has room for **one** 24px row at most;
  proximity + counters as two rows would break the no-scroll tests unless something is trimmed or counters go below the
  fold / into the log.
- Short landscape (667x375 etc.): stats rows asserted `3 × 18px` (`text-wrapping.spec.ts:63-66`), very tight.

## 5. Conventions

- Unit tests: Vitest, `tests/unit/*.test.ts` (flat, kebab-case per subject, e.g. `game-hud.test.ts`,
  `hud-presentation.test.ts`, `toast.test.ts`, `turn-moment-presentation.test.ts`, `game-legend.test.ts`,
  `game-settings.test.ts`); React rendered through `tests/unit/helpers/reactDom.ts`. `npm test` = `vitest run`;
  simulations under `tests/simulation` (`npm run sim`).
- E2E: Playwright `tests/e2e/*.spec.ts`, fixtures in `tests/e2e/fixtures` (fixture dataset + real dataset via
  `test.use({ dataset: "real" })`, saved games `*-save.json`), helpers `tests/e2e/support/`. Projects: desktop-chromium
  (1280x800), phone-chromium (Pixel 7, runs only `@layout`-tagged tests: `grep: /@layout/`), desktop-firefox
  (xvfb), desktop-webkit (CI only, 3 shards). Tag phone-relevant tests `{ tag: "@layout" }`.
- Text: no i18n library; Japanese literals in components / presentation modules (`presentation.ts`,
  `hudPresentation.ts`, `itemPresentation.ts`, `toastQueue.ts`). Long Japanese values go through `PhraseText` for
  natural line breaks (#text-wrapping).
- CSS: single global `src/styles.css` (3,112 lines), BEM-like `block__element--modifier`, layout per media query,
  `prefers-reduced-motion: reduce` blocks next to each animation, motion tokens `var(--motion-fast)`.
- Components: function components with explicit prop interfaces, pure presentation models in `*.ts`
  (`hudPresentation.ts`, `turnResultCard.ts`) with the component reading only the model; `memo` for heavy subtrees;
  engine stays pure and untouched by presentation features (#66 hard constraint: no engine/RNG/save/types/data edits).
- Process precedent (#66): plan → per-step Luna prompt → Sol-low review → commit; steps ~150 lines; existing test files
  byte-identical unless a decision changes them.

## 6. Open product questions (for the user)

1. (A) Hide when riding Yamanote only, or also while standing on a Yamanote station on another line (distance 0)?
2. (A) 近づく／遠ざかる by the current ride's next stop (forward, recommended) or by comparison with last turn? Label for
   equal distance (none / 「横ばい」)?
3. (A) Wording: 「あとN駅」 counts stops (rapid = 1); add 「最短」? Name the nearest Yamanote station?
4. (A) Placement: phone has zero budget — reuse the empty 出目 cell (row 3, cols 3-4; overrides #66 decision 5a), add a
   row (breaks the 252px budget test), or replace the progress row text while off-line? Desktop: the extra row uses the
   ~24px slack.
5. (A) Update per hop during movement, or only once the turn is published?
6. (B) Multiple thresholds crossed in one turn (e.g. 24→26, or ×2 dice): show only the highest? Copy per threshold
   (10 「1/3 踏破！」, 20, 25 「あと5区間！」, 29 「あと1区間！」)? Bar flash under 演出: なし / reduced motion (recommend
   none; toast still shown)? Should milestone toasts obey 演出 level?
7. (C) Visited = every stop passed through, or only stations where the turn ended? Does deadhead count?
8. (C) Where in the HUD: desktop has room for one row at most in the populated state; phone has none above the fold —
   inside the log/menu, below the fold, or replacing something? Clear screen: add to stats only, or also to share text?
9. (D) What does "legend usually ON" mean: the 3-swatch key always visible outside the menu, the 134-line group list
   expanded by default, or all lines visible on the map? Persist it in settings v1?
10. (D) "Full log behind the menu": today the log has only the current turn — is a multi-turn history (UX-15, last N
    turns) now in scope, or does "full log" mean the existing drawer content (lottery candidates, 地図なしで確認,
    effects)? The #66 pill currently opens the log directly; should it open the slim log or the menu?
11. (D) Phone only (≤600px) or also short landscape? Keep desktop unchanged?
12. Pacing / step split and implementer lane (as in #66).

## 7. Codex scope assessment (Sol, low effort, read-only)

Response file: `.claude/logs/codex/20261115T110512Z-hud65-scope.md` (prompt: `.claude/logs/codex/prompt-hud65-scope.md`). Verbatim below.

### Scope Assessment

Issue #65 is feasible as a presentation-only feature, but the combined scope requires layout and interaction decisions before a reliable implementation plan can be finalized.

- **A — Proximity:** Reuse cached directed hop distances and the displayed station/ride. No engine changes are necessary. The main blocker is placement: the phone HUD has no spare row, while desktop has approximately one row available.
- **B — Milestones:** Extend the existing 30-segment milestone mechanism with 10/20/25/29 thresholds. History-derived crossing turns, ordered toast inputs, live announcements, and a transient progress-bar effect are required.
- **C — Collection:** Derive unique station and presentation-line-group counts from movement records. No save-format change is needed. Counting semantics and HUD placement remain unresolved.
- **D — Phone controls:** Consolidating existing disclosures is bounded work. Adding a genuine multi-turn log materially expands scope because the current drawer contains only the current turn.

The phone menu consolidation does **not** solve the fixed HUD budget: its trigger row is below the measured 252px top block. The hidden 出目 cells are the only existing space within that block, and their reuse requires changing the #66/#71 boundary.

Assessment uses the supplied research document, read fully, plus targeted source inspection. No files were edited; executable tests were not run for this read-only assessment.

### Complexity Classification (SIMPLE / MODERATE / COMPLEX, with one-line justification; also per sub-feature A-D)

**Overall: COMPLEX** — several individually bounded additions intersect reveal timing, one-shot notifications, strict responsive budgets, and disclosure accessibility.

| Feature | Classification | Justification |
|---|---|---|
| A | MODERATE | Simple graph lookup; constrained placement and displayed-state timing require care. |
| B | MODERATE | Existing infrastructure fits, but threshold ordering, replay suppression, and motion policy must remain consistent. |
| C | MODERATE | Pure aggregation is straightforward; partial movement and pending records complicate publication. |
| D | COMPLEX as currently worded | Menu consolidation is moderate; undefined legend behavior and potentially new multi-turn history prevent a bounded design. |

### Integration Points

- **Publication boundary:** `src/features/game/turnMomentPresentation.ts:207` derives the public view. Proximity must use its `progress.stationId` and `ride`; collection and milestone models should be exposed through this boundary rather than computed from committed state inside components.
- **Partial movement:** `src/features/game/animation/displayedProgress.ts:43` exposes station and completed hops, but **does not expose full visited-station history**. Collection needs a separately gated record prefix or partial-record projection. `completedSegmentIds` alone cannot recover off-target visits.
- **Proximity semantics:** `src/features/game/engine/itemOptions.ts:63` compares legal next stops, and `:79` compares the selected next stop against the current distance. Reuse the underlying lookup and next-stop APIs; the boolean `rapidHeadsTowardTarget` cannot distinguish equal distance from moving away.
- **Milestone history:** `src/features/game/mapGuidance.ts:87` replays unique required segments to identify first completion. A presentation helper can generalize that technique to first crossing turns without altering engine code.
- **Toast ordering:** `src/features/game/toastQueue.ts:115` reserves negative indexes for milestones. Assign thresholds stable indexes increasing in display order, keep 30 at `-1`, and emit milestones before item events. The reducer consumes input order; it does not sort.
- **Milestone publication/accessibility:** Existing production and announcement logic is in `src/features/game/turnMomentPresentation.ts`, beside `toastInputs` and `milestoneAnnounced`. New thresholds cannot depend on `goalGuidance`, which becomes available only at full completion.
- **Resume behavior:** `src/app/GameApp.tsx:230` suppresses baseline toast keys. Extend that contract to new thresholds; separately suppress resumed flash effects and announcements.
- **HUD layout:** `src/features/game/components/GamePanel.tsx:327` assembles HUD props. `src/styles.css:2311` fixes phone stats rows, and `:2373` places pairs by ordinal position. Append new pairs or use separate elements.
- **Phone navigation:** `src/features/game/components/GamePanel.tsx:182` owns the active surface and pauses auto-roll while surfaces are open. `:454` connects the #66 pill directly to the log. Preserve a coherent surface state and focus return when changing menu navigation.
- **Clear screen:** `src/features/game/components/ClearScreen.tsx:80` renders summary stats. Reuse the collection helper with the completed history; existing transfer counts in `gameSummary.ts` should retain their meaning.

### Affected Files (New / Modify, with the reason per file)

Suggested new module names are provisional.

| Action | Files | Reason |
|---|---|---|
| New | `src/features/game/hudProgressFeedback.ts` | Pure proximity model and milestone crossing derivation. Split if it grows beyond a cohesive small module. |
| New | `src/features/game/collectionProgress.ts` | Unique station/group aggregation over explicitly visible records. |
| Modify | `src/features/game/turnMomentPresentation.ts` | Publish gated collection/milestone models and announcement text. |
| Modify | `src/features/game/toastQueue.ts` | Threshold toast construction and stable negative indexes. Preserve queue capacity and save-failure priority. |
| Modify | `src/features/game/components/GamePanel.tsx` | Connect models, motion permissions, and phone surface navigation. |
| Modify | `src/features/game/components/GameHud.tsx` | Render approved proximity/counter placement. |
| Modify | `src/features/game/components/TargetProgressBar.tsx` | Accept an eligible milestone event identity and render the flash state. |
| Modify | `src/features/game/components/ClearScreen.tsx` | Render collection counts with runtime totals. |
| Modify | `src/features/game/components/GameMenu.tsx`, `TurnLogDrawer.tsx`, `GameLegend.tsx` | Implement approved phone consolidation and legend/log behavior. |
| Modify | `src/styles.css` | Responsive placement, disclosure styling, milestone effect, reduced-motion handling. |
| Conditional | `src/app/GameApp.tsx` | Only if new effect-entry suppression or preference plumbing cannot use existing inputs. |
| Conditional | `src/features/game/gameSummary.ts` | Only if collection counts become part of the shared summary API. |
| Conditional | `src/store/settings.ts` and settings model | Only if the approved legend behavior requires persistence. |
| New / Modify | Corresponding `tests/unit/*.test.ts`, focused `tests/e2e/*` | Pure logic, publication phases, toast ordering, keyboard behavior, and `@layout` coverage. |

Engine, RNG, save schemas, `src/types/network.ts`, and `public/data/**` remain outside the change set. `TurnResultCard.tsx` need not change unless the approved placement explicitly uses its desktop reserve or changes pill behavior.

### Risks (ranked, with mitigation)

1. **Layout contract violation.** Phone rows already consume the top budget; desktop cannot absorb two ordinary new rows.  
   **Mitigation:** approve a combined placement design for A+C before either UI integration. Preserve the existing assertions unless the user explicitly changes the budget.

2. **Premature publication of committed outcomes.** History already contains moves that have not finished displaying; pending discard records also require handling.  
   **Mitigation:** derive visible collection input centrally, with tests for pre-move, moving, arrival, lottery publication, pickup, omitted animation, and deadhead.

3. **Lost or replayed milestone notifications.** A lower negative index arriving after an item event is rejected; queued notices can be dropped on a newer turn.  
   **Mitigation:** publish all eligible thresholds together in stable order before item events, and test multi-threshold turns, reload, fast turns, and save-failure coexistence. Do not promise every queued notice will display unless queue semantics change.

4. **D expands into a new history feature.** Movement records support reconstruction, but are not a ready-made historical copy of the current drawer’s notices and candidate details.  
   **Mitigation:** explicitly choose existing current-turn detail versus a newly specified historical log before estimating D.

5. **Misleading counts or distance wording.** Gameplay hops differ from intermediate physical stations; lottery-assigned lines have not necessarily been ridden.  
   **Mitigation:** define stops, deadhead, line-group deduplication, and zero-distance wording in the brief; derive totals dynamically.

6. **Animation replay or accessibility regression.** Re-rendering a milestone class can retrigger effects; toasts themselves are hidden from accessibility APIs.  
   **Mitigation:** use stable session/turn/threshold identity, suppress entry replay, extend live announcements, and disable decorative flash under reduced motion and 演出なし.

### Recommended Approach

Target approximately 150 changed lines per step, including tests; split wiring or responsive CSS into additional steps where needed.

| Order | Step and dependency | Decisions required before starting |
|---|---|---|
| 1 | Pure proximity helper and unit tests. Independent of other features. | Distance-zero behavior, tie wording, update timing. |
| 2 | Pure collection helper and unit tests. | Visited-station definition and deadhead policy. |
| 3 | Gated collection projection through `turnDisplay`; publication tests. Depends on 2. | Per-hop growth versus arrival-only publication. |
| 4 | Threshold crossing helper and toast generation; ordering tests. | All crossed milestones versus highest only; toast policy. |
| 5 | Milestone publication and live announcements. Depends on 4. | Announcement aggregation for multiple crossings. |
| 6 | Progress-bar effect and motion-policy tests; focused `@layout` E2E. Depends on 5. | Approved flash behavior; handling a jump to 30 where goal guidance replaces the bar. |
| 7 | Clear-screen counters and layout tests. Depends on 2. | Whether share text is included; recommend keeping it unchanged. |
| 8 | Desktop A+C composition and populated-state `@layout` tests. Depends on 1+3. | Shared placement fitting the available row or approved reserve. |
| 9 | Phone A+C composition and small-screen `@layout` tests. Depends on 8’s models. | Explicit space allocation without silently consuming the #71 reservation. |
| 10 | Phone menu/log consolidation and focus tests. Independent of counter logic. | Meaning of full log, legend behavior, and pill destination. Split history implementation into separate steps if approved. |

For each implemented slice, run targeted Vitest tests and its focused Playwright `@layout` coverage. Before completion, run `npm test`, `npm run typecheck`, and the existing phone-budget, populated-desktop, and pill-layout regressions. Exercise 320×568, normal phone, desktop 1280×800, and short landscape.

### Open Questions the user must decide (only those that block design)

1. **Where do A and C fit together?** Approve desktop and phone placement, including whether #65 may reuse the reserved 出目 cells or change the measured phone budget.
2. **What does “off the Yamanote line” mean at distance zero?** Hide on any Yamanote station, or show special text when riding another service there? Should the row retain the same purpose after 30/30?
3. **How should proximity read and update?** Accept directed shortest-hop wording, next-stop direction comparison, no label for ties, and either per-hop or arrival-only updates?
4. **What counts as visited/ridden?** Passed-through service stops or turn destinations; include deadhead destination; exclude deadhead-only service assignment from ridden groups?
5. **What happens when several thresholds are crossed?** Show every milestone or only the highest, and should toasts remain visible under 演出なし? How should a same-turn jump to 30 affect the bar flash?
6. **What is “full log”?** Existing current-turn details, or a new multi-turn history? Where should the #66 phone pill lead?
7. **What does “legend usually ON” mean?** Visible static key, expanded line selector, or map line visibility—and must that choice persist?
