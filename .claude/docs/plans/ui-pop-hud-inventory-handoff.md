# UI Pop Overhaul P0+P1 (HUD + Inventory) — Handoff

Resume point for any session (Claude or Codex). **Update after every step** (status, commit, commands and
results, open findings, constraints for the next step) before reporting the step done.

## Goal

Turn the in-game sidebar into a brand-coloured HUD (riding line badge + direction, station, turn, straight
30-segment progress bar, dice CTA, icon inventory, effect chips), move per-turn text into a "ログ" disclosure and
settings + legend into a "メニュー" disclosure, and build the P0 foundations (tokens, line badges, item icons,
reveal hook, toast host) for P2. Presentation only: no engine/RNG/save/public-data change.

## Decisions (user, 2026-10-28; DESIGN.md Key Decisions)

- Brand palette vermilion `#d9502f` / ink `#263238` / cream `#faf7ef` replaces the green UI primary.
- HUD + log + menu as above; sound deferred (default off if ever added).
- Original line badges with official letter codes (案C); 21 uncoded JR lines colour-only with the name; never
  invent codes; no monetisation planned.
- P2 lottery display will be split-flap (パタパタ), ~2 s, skippable, omitted on reduced motion/resume — out of
  scope here; the reveal hook is its foundation.
- Answered (user 2026-10-28/30): multi-code groups → one Tokyo-side code; partial JU/JO lines → show code;
  toast reading time 4,000 ms; all canonical item outcomes toast (max 3); Musashino through services JM;
  S3 badge shape/icons/accents unchanged.
- 2026-10-30 (user): S4 compact-roll wordings (`N駅`+`快速`, `調整±1`, `遅延`) are accepted as-is. Effect chips must be SHORT in the HUD (e.g. `遅延 あと1`, `運休 山手線 あと3`, `寄り道`, `寝過ごし`): S10 adds a short chip label and moves the full sentence to a tooltip/accessible description; the current long sentence must not be the visible chip text.

## Documents

- Brief: `.claude/docs/research/feature-ui-pop-hud-inventory-brief.md`
- Codebase scan: `.claude/docs/research/feature-ui-pop-hud-inventory-codebase.md`
- Plan (25 steps, architecture contracts, risks): `.claude/docs/plans/ui-pop-hud-inventory-plan.md`
- Executor prompts (§0 common contract + per step, reviewer §R, build snippet at the top):
  `.claude/docs/plans/ui-pop-hud-inventory-prompts.md`
- Audit: `.claude/docs/research/ui-pop-overhaul-audit.md`; badge research:
  `.claude/docs/research/official-line-symbols-usage.md`
- Codex record: `.claude/logs/codex/*uipop-*.md` (scope, arch, plan, validate, validate2)

## Branch

`feature/ui-pop-hud-inventory` from develop `4368673` (v0.10.0); PR target `develop`.
`UI_POP_BASE` (commit before S1): `81454df` (planning docs commit, recorded 2026-10-28 when S1 started).
The DESIGN.md 2026-10-28 decisions and the research notes were committed in `81454df`; the tree was clean
when S1 started.

## How to resume

1. `git status --short` and `git log --oneline -5`; find the first step below that is not `done`.
2. Read plan §2–§4 and the step's prompt section; build the prompt with the snippet at the top of the prompts
   doc; run the lane given in plan §4 (Luna high default; S2A Sol high read-only; Sonnet fallback).
3. Lead verification: the step's acceptance commands (`ui_gate`, `ui_e2e …`), `verify_delegation.py` (plan §3),
   read the diff, run the Sol-low reviewer (§R), then commit (one commit per step) and update this file.
4. Push per the branch flow; check GitHub CI after every push.

## Step Status

| Step | Title | Lane (impl / review) | Status | Commit | Evidence |
|---|---|---|---|---|---|
| Plan | Phases 1E/2E, Codex-validated | Sol | done (awaiting user approval) | — | validate_doc exit 0; workspace --verify exit 0; Codex validation round 1 NEEDS_REVISION → revised; round 2 PASS (`.claude/logs/codex/20261028T044343Z-uipop-validate2.md`) |
| S1 | Tokens + accessible brand buttons | Luna high / Sol low | done | `96705f6` | Baseline @81454df: `ui_gate` 52 files / 977 passed, 1 skipped; full `ui_e2e` 226 passed, 2 skipped (13.3 min). After: `ui_gate` 53 files / 985 passed, 1 skipped; full `ui_e2e` 225 passed, 2 skipped, 1 failed (`save-errors.spec.ts:142` desktop-chromium, 30 s test timeout under CPU contention from a concurrent pytest run; idle page, dice ready) → rerun `save-errors.spec.ts --repeat-each=3` on all 3 projects 81 passed (that test 7.9–12.3 s); final tree `ui_gate` 985 passed + `layout`/`accessibility` 45 passed. Review: Sol low round 1 CHANGES_REQUIRED (base `:active` rule beat `.button-primary`/`.dialog__confirm` pressed fill → white on cream; disabled buttons looked enabled) → lead fixed (`:where()`, disabled tokens, `.dialog__confirm:active`); round 2 ACCEPT; its non-blocking note (aria-disabled CTA pressed fill) also fixed. `verify_delegation` exit 0: 0 out-of-scope, 0 placeholders, 0 weakened tests; forbidden-path diff empty. Logs: `.claude/logs/uipop-s1/`. |
| S2 | Line-badge catalogue (S2A mapping research, S2B code) | Sol high + Luna high / Sol low | done | S2A `af0bf2a`; S2B `d2dcfec` | S2A: Codex Sol high read-only + live web (752 s, `.claude/logs/codex/20261030T022127Z-uipop-s2a.md`, 0 files edited) → mapping `.claude/docs/research/line-badge-codes.md`: 134 groups (manifest order) = 113 coded + 21 `none` (exactly the research-note 21; 135 services because `toei-oedo` has 2). Lead verification: independent expectation written before reading the draft, diff empty on all 134 codes; every coded row has a source; 31 spot checks vs operator pages/releases (JR 2016/2018/2024 via Internet Archive, Tobu 2012, Odakyu 2014, Sotetsu 2014/2022, Tokyu 2012, Seibu/Keisei/Keio/Keikyu/Toei/Metro/Hokuso/TX/MM station pages) all agree; all codes inside the S2B operator symbol sets. Correction: one dead Codex source (Odakyu, 404) replaced; notes translated to English. Multi-code Tokyo-side: `tobu-isesaki` TS, `jr-sotetsu-direct` JA, `jr-chuo-takao-fujino` JC (service runs to Shiojiri, CO beyond Ōtsuki), `jr-shonan-shinjuku-rapid-takasaki` JS. S2B: Codex Luna high (141 s, `.claude/logs/codex/20261030T025709Z-uipop-s2b.md`) → `src/features/game/lineBadge.ts` (`LINE_BADGE_CODES` 113, `NO_CODE_LINE_GROUP_IDS` 21, `lineBadgeFor`, `badgeTextColor`) + `tests/unit/line-badge.test.ts` (11 tests). Musashino through services JM (user decision 2026-10-30, final). Lead verification: script diff of all 134 codes vs the research table = 0 mismatches; mutation check (2 wrong codes) fails the symbol-set and literal-spot tests. Lead fixes: own-property lookup (`Object.hasOwn`; `constructor`/`toString` previously resolved to a function), tests for inherited keys, coded/uncoded resolution and exactly-one-prefix coverage. Review: Sol low ACCEPT, 0 blocking; non-blocking (stale Musashino comment, stale count) fixed. Gates: `ui_gate` 54 files / 996 passed, 1 skipped; build pass (pre-existing >500 kB chunk warning). No E2E for this step. `verify_delegation --base 0359f01` exit 0: 0 out-of-scope, 0 placeholders, 0 weakened tests (1 deletion = this row). Next: S3. |
| S3 | `LineBadge` + 11 item icons | Luna high / Sol low | done | `00b33a1` | Codex Luna high (~3 min, `.claude/logs/codex/20261030T031019Z-uipop-s3.md`) → `C/LineBadge.tsx` (pennant via `clip-path: polygon(0 0,100% 0,88% 100%,0 100%)`, unskewed code in the inherited app font, `model.textColor` on `model.color`, null colour → `--color-border`; mark `aria-hidden`, name as plain text; sizes sm/md/lg), `C/ItemIcon.tsx` (11 self-drawn 48×48 drawings, `currentColor` stroke + `.item-icon__accent(-stroke)`), `src/styles.css`, new `U/item-icon.test.ts` (2 tests), `U/line-badge.test.ts` +4 renderer tests. Review: Sol low round 1 CHANGES_REQUIRED (3 blocking: `double` lacked ×2; `oversleep` drew loops not zzz; inline `--item-icon-accent` on the SVG blocked container overrides) → lead fixed (×2 and Z paths, accent now `var(--item-icon-accent, var(--color-brand))` with no inline style, `detour` redrawn as a zigzag after the lead's preview check, new tests: every kind has an accent element, no inline style; every manifest service renders exactly the catalogue letters `^[A-Z]{0,2}$` (no station numbers) + its name); round 2 ACCEPT, 0 blocking; guardrails confirmed (no rounded square/ring, no station numbers, no invented codes, app font, no third-party/operator/rolling-stock artwork). Gates on the final tree: typecheck pass; `vitest run` 55 files / 1,002 passed, 1 skipped; build pass (pre-existing >500 kB chunk warning); `ui_e2e tests/e2e/layout.spec.ts` 6 passed (3 projects). `verify_delegation --base 9587d05` exit 0: 0 out-of-scope, 0 missing, 0 placeholders, 0 weakened tests (1 deletion = this row). Visual preview (not committed) rendered badges + icons at 1x desktop/phone and 3x. Not wired into any screen yet (S7/S10/S18/S20). Next: S4. |
| S4 | HUD pure models, progress bar, effect chips | Luna high / Sol low | done | `cce1be9` | Codex Luna high (~4 min, `.claude/logs/codex/20261030T033714Z-uipop-s4.md`) → `G/hudPresentation.ts` (`compactRollFor`, `progressSegments`, `effectChipModels`), `C/TargetProgressBar.tsx`, `C/EffectChips.tsx`, `src/styles.css` (straight flex row of segments: `--color-brand` done / `--color-border` remaining, transition off under reduced motion; chips cream with border, wrap), new `U/hud-presentation.test.ts`. Review: Sol low round 1 CHANGES_REQUIRED (3 blocking: chip keys used the array index, so an earlier delay/suspension expiring re-keyed later chips; `aria-valuenow`/`aria-valuemax` unclamped while segments and `aria-valuetext` were clamped; compact-roll tests patched one base record instead of engine-built records, rapid had `pips = hopBudget`) → lead fixed: keys `delay:<due>#n`, `suspension:<service>:<expires>#n`, `detour:pending#0`, `oversleep:pending#0` (rank among identical entries only); all ARIA values from the clamped segments (0 segments → 0/0); tests replay `tests/e2e/fixtures/itemScenarios.ts` through the engine (plain, double, adjust ±1, delay, rapid-long with `hopBudget ≠ pips`, oversleep, deadhead) plus a legacy `moveByRoll` move; key stability across expiry; out-of-range ARIA (40/30, −2, 2.7, NaN, 0 segments). Lead deviations: rapid label `${hopBudget}駅` (the budget counts stations; `マス` means pips in `lastRollText`); adjustment cue `調整+1`/`調整-1`; `遅延` cue when a due delay forced the face (unlisted case). The test file runs in the node environment (jsdom's `URL` breaks `loadBundle("fixture")`), asserting on `renderToStaticMarkup` strings like `game-legend.test.ts`. Mutation check (index keys, unclamped `aria-valuenow`, rapid from pips) fails 8 tests. Round 2 ACCEPT, 0 blocking. Gates: typecheck pass; `vitest run` 56 files / 1,034 passed, 1 skipped (+32 in `hud-presentation.test.ts`); build pass (pre-existing >500 kB chunk warning). No E2E for this step. `verify_delegation --base 500e977` exit 0: 0 out-of-scope, 0 missing, 0 placeholders, 0 weakened tests (1 deletion = this row); forbidden-path diff empty. Visual preview (not committed): 0/30, 7/30, 29/30, 30/30, 2/4 bars and five chips at 1x desktop / 3x phone. Open: phone chip horizontal scrolling (plan §2) is S23. Not wired into any screen yet (S10). Next: S5. |
| S5 | Reveal reducer + hook | Luna high / Sol low | done | `3a1754b` | Codex Luna high (~3 min, `.claude/logs/codex/20261030T040224Z-uipop-s5.md`) → `G/animation/useRevealSequence.ts` (pure `revealReducer` with observe/reset/movementComplete/advance/skip; `useRevealSequence({ observation, stages, reducedMotion })` → `{ key, stage, busy, ready, skip }`; `RevealObservation = { sessionId, recordTurn, gameTurn, pendingDecisionTurn, movementComplete }`, key `${sessionId}:${recordTurn}`, baseline = max(game turn, record turn, pending decision turn) captured on session change; stage names are the caller's `RevealStage.key`, plus `waiting` / `done`) + new `U/reveal-sequence.test.ts`. Review: Sol low round 1 CHANGES_REQUIRED (1 blocking: `stages` identity was a timer-effect dependency, so a same-content array restarted the active stage's timer) → lead fixed: only the current stage's `durationMs` is a dependency; also (round-1 non-blocking) the observation is folded into the reducer during render (duplicate observe returns the same state object), so the first commit of a key / first mount never shows stale `busy`/`ready` and `skip` targets the current key. Round 2 CHANGES_REQUIRED (1 blocking, pre-existing in the Luna draft: reduced motion was ignored while the move was still running) → lead fixed: reduced motion completes a pending key independently of movement (`ready` still waits for movement). Round 3 ACCEPT, 0 blocking (`.claude/logs/codex/20261030T041035Z-uipop-s5-review3.md`). Tests: 25 (8 reducer table rows + 2 reducer tests, 15 stable-identity `Harness` hook tests with `vi.useFakeTimers()` and `vi.getTimerCount()`; commits recorded via `useLayoutEffect`): empty stages/no timers; natural multi-stage completion; skip while armed/active; repeated skip; reduced motion live (active stage and during movement); stale key/stage-index advance; unmount and record/session change mid-stage cancel timers; duplicate observations and new stage-array identity do not replay or restart; idle / pending-roll / pending-discard resume start done; record turn ≠ game turn; first-commit consistency. Mutation checks (stage identity in deps, observe via effect, reduced motion gated on movement) each fail exactly the new test. Gates: typecheck pass; `vitest run` 57 files / 1,059 passed, 1 skipped (+25); build pass (pre-existing >500 kB chunk warning). No E2E for this step. `verify_delegation --base 9747f90` exit 0: 0 out-of-scope, 0 missing, 0 placeholders, 0 weakened tests (1 deletion = this row). Open (non-blocking, S8/P2): with non-empty stages, reduced-motion completion is dispatched from an effect, so one commit may show `busy: true`; harmless with the empty production stages. Not wired yet (S8 passes an empty module-constant `stages`). Next: S6. |
| S6 | Toast conversion + queue | Luna high / Sol low | not started | — | — |
| S7 | `ToastHost` | Luna high / Sol low | not started | — | — |
| S8 | GameApp integration (reveal, skip, toasts, obscured) | Luna high / Sol low | not started | — | — |
| S9 | Stat markers + shared E2E helpers | Luna high / Sol low | not started | — | — |
| S10 | `GameHud` extraction | Luna high / Sol low | not started | — | — |
| S11 | Map observes the real panel | Luna high / Sol low | not started | — | — |
| S12 | Menu disclosure (expanded) | Luna high / Sol low | not started | — | — |
| S13 | Migrate menu consumers | Luna high / Sol low | not started | — | — |
| S14 | Menu closed by default | Luna high / Sol low | not started | — | — |
| S15 | Turn log disclosure (expanded) | Luna high / Sol low | not started | — | — |
| S16 | Migrate log consumers | Luna high / Sol low | not started | — | — |
| S17 | Log closed; compact roll | Luna high / Sol low | not started | — | — |
| S18 | Shared `ItemCard` + metadata | Luna high / Sol low | not started | — | — |
| S19 | `ItemCardPopover` lifecycle | Luna high / Sol low | not started | — | — |
| S20 | Inventory visuals + tooltips | Luna high / Sol low | not started | — | — |
| S21 | Inspect-then-use interaction | Luna high / Sol low | not started | — | — |
| S22 | Discard dialog cards | Luna high / Sol low | not started | — | — |
| S23 | Populated phone/landscape layouts | Luna high / Sol low | not started | — | — |
| S24 | Phone attribution collapsed | Luna high / Sol low | not started | — | — |
| S25 | Regression + validation record | Luna high / Sol low + lead | not started | — | — |

## Notes

- Local E2E: `env -u WAYLAND_DISPLAY npx playwright test …` (WSL WAYLAND quirk), 2 workers; WebKit CI-only.
  Never `pkill -f`; stop servers by port.
- Luna implementation runs need `--timeout 2400`; watch long runs every ~5 minutes.
- Full local E2E gates at S1, S8, S9, S10, S14, S17, S21, S23, S25. First full run (S1 baseline): 228 tests,
  13.3 min; S1 after-run 17.4 min. Do not run `verify.sh` (its 14 min pytest) concurrently with Playwright:
  it caused the one S1 timeout.
- `verify.sh` (run at S1) is red only on pytest: `tests/data_pipeline/` 4 failed + 5 errors ("audited output
  hash is stale" in the local N02 staging handoff); ruff/ty pass. S1 touches no Python, `scripts/` or data, so
  this is unrelated to the UI work; pytest was not run at `81454df` to prove it pre-existed.
- S1 tokens available to later steps: `--color-brand`, `--color-brand-strong`, `--color-brand-tint`,
  `--color-ink`, `--color-cream`, `--color-surface(-raised|-disabled)`, `--color-text(-muted|-disabled)`,
  `--color-border`, `--color-good|bad|warning`, `--color-focus-ring`, `--radius-sm|md|lg|pill`,
  `--shadow-sm|md`, `--motion-fast|normal|slow` (0 ms under reduced motion). `.button-cta` is defined
  (brand fill, 18.7px/700, disabled + aria-disabled styles) but not applied — S10 applies it to the dice button.
- Next: S6 (toast conversion + queue). S5 is done: `useRevealSequence({ observation, stages, reducedMotion })` → `{ key, stage, busy, ready, skip }` with `RevealObservation = { sessionId, recordTurn (= lastMove.itemRecord.turn or null), gameTurn, pendingDecisionTurn, movementComplete }`; S8 must pass a stable empty `stages` constant. S4 is done: `compactRollFor(lastMove)`, `progressSegments`, `effectChipModels(effects, turn, network, presentation)`, `TargetProgressBar({ completed, required, label })`, `EffectChips({ models })`. S3 is done: `LineBadge({ model, showName, size })` and `ItemIcon({ kind, size })`; set `--item-icon-accent` on a container to recolour icon accents (default brand). S2 (S2A + S2B) is done; Musashino through services stay JM (user decision 2026-10-30). Known pre-existing <44px controls (staged summary
  36px, item select 40px, legend 32px) are fixed in S12/S23, not S1.
