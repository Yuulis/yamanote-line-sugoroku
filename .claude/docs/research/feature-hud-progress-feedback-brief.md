## Feature Brief: Issue #65 HUD progress feedback (proximity, milestones, collection, phone hamburger)

Date: 2026-11-15. Base: `develop` at `05cace4` (v0.15.0; #66 turn-result card merged). MODE=existing.
Branch to be created: `feature/hud-progress-feedback` from develop.
Codebase scan: `.claude/docs/research/feature-hud-progress-feedback-codebase.md`.
Codex scope consult (Sol, low effort, read-only): `.claude/logs/codex/20261115T110512Z-hud65-scope.md`.
User decisions: 2026-11-15 (final), recorded in "User Decisions" below; lead defaults are listed separately under
"Assumptions" and must be confirmed with the plan.

### Current State
- Architecture: `GamePanel` (`src/features/game/components/GamePanel.tsx`) builds every HUD prop from the
  reveal-gated `turnDisplay` produced by the pure `deriveTurnMomentDisplay()`
  (`src/features/game/turnMomentPresentation.ts:207-…`); phases `pre-move` / `moving` / `arrival` / `segment-flash` /
  `lottery-flip` / `lottery-settle` / `pickup` / `published`. `GameHud.tsx` renders a `<dl class="game-panel__stats">`
  with six `dt/dd` pairs (現在駅, 乗車中, 進行方向, ターン数, 踏破区間 + `TargetProgressBar`, 出目) whose phone placement
  is by `nth-of-type` (`styles.css:2373-2384`). Toasts come from `toastQueue.ts` (30/30 milestone
  `targetSegmentsMilestoneToast`, `eventIndex = -1`, comment "#65 adds thresholds as further negative indexes") and
  resume suppression lives in `GameApp.tsx` (`toastBaseline`). Phone has two disclosure triggers 「ログ」
  (`TurnLogDrawer.tsx`, current turn only) and 「メニュー」 (`GameMenu.tsx`, settings + `GameLegend`), one surface open
  at a time via `GamePanel` `activeSurface`; the #66 phone pill opens the log. Clear screen (`ClearScreen.tsx`) shows
  所要ターン数 / 移動回数 / 乗換回数 from `summarizeGame()`.
- Relevant files: `turnMomentPresentation.ts`, `animation/displayedProgress.ts`, `hudPresentation.ts`,
  `mapGuidance.ts` (`firstTargetCompletionTurn`), `toastQueue.ts`, `engine/proximity.ts` (`targetHopDistances`,
  read-only use), `engine/itemOptions.ts` (`directionHint`, `rapidHeadsTowardTarget`, precedent only),
  components `GamePanel`, `GameHud`, `TargetProgressBar`, `TurnLogDrawer`, `GameMenu`, `GameLegend`, `ClearScreen`,
  `TurnResultCard` (phone pill), `src/app/GameApp.tsx`, `src/styles.css`.
- Patterns: pure presentation models in `src/features/game/*.ts` with Vitest under `tests/unit/*.test.ts`;
  components read only the model; Japanese literals in presentation modules, visible text through `PhraseText`;
  polite live `announcement` (toasts are `aria-hidden`); `prefers-reduced-motion` blocks next to each animation;
  Playwright `@layout` tags for phone-relevant E2E; engine/RNG/save/types/data untouched by presentation features.

### Feature Goal
While the player is off the Yamanote line, and throughout the 30-segment run, the HUD gives a sense of progress:
how far the Yamanote line is and whether the current direction helps, a celebration at 10/20/25/29 segments, and
how many stations and lines have been collected. On phones, the log and menu fold into one hamburger so the
controls take less space.

### Scope
- Include:
  - (A) HUD row 「山手線まで あとN駅（近づく／遠ざかる）」 only while off the Yamanote line. N = directed gameplay hops
    from `targetHopDistances`. 近づく／遠ざかる = the current riding direction: the distance of the next stop on the
    displayed ride and direction compared with the current station's distance (the same rule as
    `rapidHeadsTowardTarget` / `directionHint`), not a previous-turn delta.
  - (B) Milestone toast + progress-bar flash at 10/20/25/29 completed target segments, extending the existing 30/30
    milestone mechanism (history-derived crossing turns, negative event indexes before item events, live
    announcement, resume suppression via `toastBaseline`).
  - (C) Counters 訪れた駅 n/<`network.stationsById.size`> and 乗った路線 n/<`presentation.lineGroups().length`>.
    Visited = start station plus every station the train stopped at during movement (`segment.from/to` of traversed
    segments; stations a rapid train passes without stopping are excluded). Ridden lines counted by line group of
    each traversed segment's service. Derived from `movementHistory`; no `SAVE_VERSION` bump.
  - Placement. Desktop: ONE new HUD row (~24px) holding A (when off-Yamanote) with C small at the right end of the
    same row. Phone: A in the empty hidden-出目 cell (row 3, cols 3-4); C only inside the phone hamburger menu and on
    the clear screen. Clear screen shows C on all layouts.
  - (D) Phone only (≤600px): merge the 「ログ」 and 「メニュー」 triggers into ONE hamburger. Inside: the existing
    current-turn log content, the existing menu/settings items, and the legend toggle. Legend default stays ON.
- Exclude:
  - Rule, engine, RNG, save-format, `src/types/network.ts`, `public/data/**` changes.
  - A new multi-turn log history (UX-15); "+1" first-visit pops; next-segment name; map visuals (#62); the wider
    phone sheet redesign (#71); share-text changes.
  - Desktop and short-landscape disclosure changes (D is phone only unless the design shows it must change).

### User Decisions (2026-11-15, final)
1. A shows only while off the Yamanote line; direction label follows the current riding direction (forward).
2. B thresholds 10/20/25/29 with toast and progress-bar flash.
3. C counts stopped-at stations (rapid pass-through excluded) plus start; lines by line group; derived, no save bump.
4. Placement: desktop one ~24px row (A + C at its right end); phone A in the hidden-出目 cell, C in the hamburger
   and the clear screen; clear screen shows C on every layout.
5. D: one phone hamburger with current-turn log, settings items, legend toggle; legend default ON; no multi-turn
   history.
6. Keep the intent of the layout-budget tests (phone 252px top block, desktop no-scroll); any changed budget
   number must name the assertion and the reason.
7. Lean tests (#70 preference): ~150 LOC per step, focused Vitest per step, `@layout` E2E only on layout steps.

### Assumptions (lead defaults, to be confirmed by the user with the plan)
- A is hidden while riding the Yamanote line, at distance 0 (on a Yamanote station but riding another line), and
  after 30/30 (the #62 goal guidance 「新橋に着けばクリア」 takes over).
- A updates only from the gated `turnDisplay` (station = `progress.stationId`, ride = `turnDisplay.ride`), so it
  never leaks a lottery result before publication.
- 「駅」 means gameplay hops (a rapid segment is one hop).
- Tie or undeterminable direction (equal distance, no next stop, unknown ride) → no parenthetical.
- B: several thresholds crossed in one turn → only the highest is shown. Copy: 10「10区間突破！」,
  20「20区間突破！あと10区間」, 25「あと5区間！」, 29「あと1区間！」. Under 演出なし or OS reduced motion the toast and the live
  announcement stay and the bar flash is dropped. A jump straight to 30 shows only the existing 30/30 toast.
  Milestones reached before a reload do not replay on resume.
- C: share text unchanged. Deadhead handling is a design decision to be flagged (default proposal: the deadhead
  destination counts as visited; the relocation service does not count as ridden, since `physicalHops: 0`).
- D: phone breakpoint only (`(max-width: 600px)`); short landscape unchanged unless the design shows it must change.

### Complexity Classification (from Codex)
- Classification: COMPLEX (overall). Per sub-feature: A MODERATE, B MODERATE, C MODERATE, D COMPLEX as originally
  worded; the user's decision (no multi-turn history, existing content only) bounds D to moderate consolidation.
  Justification (Codex): several individually bounded additions intersect reveal timing, one-shot notifications,
  strict responsive budgets, and disclosure accessibility.
- Estimated files: about 14 source/CSS files (2 new modules, ~12 modified) plus 4-6 new test files.
- Estimated LOC: roughly 1,000-1,400 handwritten lines including tests (about 8-10 steps of ~150 lines).
- Implementation route: Codex + review (per-step Luna implementer prompt, Sol-low review, lead verification and
  commit), as for #66.

### Integration Points
- Publication boundary (`turnMomentPresentation.ts` `deriveTurnMomentDisplay`): proximity, collection and milestone
  models are exposed through `turnDisplay`, never computed from committed `session.game` in components.
- Partial movement (`animation/displayedProgress.ts`): exposes the displayed station and completed hops but not the
  visited-station prefix; collection needs a gated record prefix or partial-record projection.
- Proximity lookup (`engine/proximity.ts` `targetHopDistances`, cached per network) and next-stop resolution for the
  displayed ride/direction; read-only use of engine APIs.
- Milestone history (`mapGuidance.ts` `firstTargetCompletionTurn`): generalised to first crossing turns per
  threshold in a presentation helper.
- Toasts (`toastQueue.ts`): new thresholds get stable negative `eventIndex` values ordered before item events, 30
  stays at `-1`; queue capacity and save-failure priority are preserved. Resume suppression (`GameApp.tsx`
  `toastBaseline`) is extended to the new keys, and the flash/announcement must not replay on resume.
- HUD (`GamePanel.tsx` prop assembly, `GameHud.tsx`, `styles.css`): desktop row outside the `dl` ordinal grid or
  appended after 出目; phone A in the hidden-出目 cell without renumbering `nth-of-type` positions.
- Phone surfaces (`GamePanel` `activeSurface`, auto-roll pause, shortcut suppression, Escape handling, focus return):
  one hamburger surface replaces the log/menu pair on phone; the #66 pill must open a coherent destination.
- Clear screen (`ClearScreen.tsx`): reuses the collection helper with the completed history; `gameSummary.ts`
  transfer semantics unchanged.

### Risks
- Layout contract violation (phone 252px block, desktop populated no-scroll with ~24px slack, short landscape
  3×18px rows): one combined A+C desktop row sized to fit the slack; phone A only in the existing empty cell; any
  budget number change is named explicitly in the plan.
- Premature publication (lottery/landing leak through A or C): derive from `turnDisplay` and a gated record prefix;
  unit tests per phase (pre-move, moving, arrival, lottery publication, pickup, omitted animation, deadhead,
  pending discard).
- Lost or replayed milestones (queue cursor rejects lower indexes after item events; resume replays): stable keys
  and indexes, highest-only per turn, baseline suppression, tests for multi-threshold turns and resume.
- Animation replay / accessibility regression (flash retriggered by re-render; toasts hidden from AT): stable
  session/turn/threshold identity for the flash, live announcement text, flash off under 演出なし / reduced motion.
- Phone surface regression (auto-roll pause, focus return, pill destination, Escape order): keep one
  `activeSurface` value for the hamburger and test focus and auto-roll pause on phone.
- Misleading wording (hops vs physical stations, lottery-assigned but unridden lines): definitions above, totals
  derived at runtime.

### Success Criteria
- Off the Yamanote line, desktop and phone show 「山手線まで あとN駅」 with （近づく）／（遠ざかる） matching the
  current direction rule, hidden on Yamanote, at distance 0 and after 30/30, never revealing an unpublished lottery.
- Crossing 10/20/25/29 shows exactly one milestone toast per turn (highest crossed) with a polite announcement and a
  bar flash that is absent under 演出なし / reduced motion and never replays after reload.
- Counters match a pure helper over `movementHistory` (unit-tested against a hand-built history including rapid and
  deadhead records) and appear in the desktop row, the phone hamburger and the clear screen on all layouts.
- Phone shows one hamburger trigger containing the current-turn log, settings and legend toggle; auto-roll pauses
  and focus returns as before; the #66 pill still opens the log content.
- `npm run typecheck`, `npx vitest run`, `npm run build` pass; the phone 252px budget, desktop populated no-scroll
  and pill-layout regressions pass (unchanged, or with an explicitly named and justified assertion change).
