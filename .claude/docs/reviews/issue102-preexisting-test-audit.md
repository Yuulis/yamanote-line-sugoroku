# Issue #102 Part 2: Pre-existing Test Audit

Audit baseline: commit `a8fc2b7` (the test tree before PR #101). PR #101's newly added test files are out of scope. All file and line references below refer to the baseline tree unless stated otherwise.

## Summary

| Measure | Baseline / observation |
|---|---:|
| Front-end unit cases | 1,330, as recorded in issue #102; 93 `tests/unit/*.test.ts` files |
| Playwright E2E cases | 206, as recorded in issue #102; 24 `.spec.ts` files |
| Unit test-definition LOC | 24,993 nonblank lines |
| E2E test-definition LOC | 9,938 nonblank lines |
| Python data-pipeline tests | 57 modules, 536 test functions; 62 functions use `pytest.mark.parametrize`; 14,220 nonblank lines |
| Simulation test files | 5 `.test.ts` files; 518 nonblank lines |
| Total test-definition LOC | 49,669 nonblank lines |

LOC counts include test modules only. They exclude test helpers, Playwright fixtures, Python support modules, fixture data, and generated files.

There is a count discrepancy that should be resolved before treating unit-case reductions as exact. The issue's baseline is 1,330 unit / 206 E2E cases. An anchored source scan at `a8fc2b7` matches the E2E figure with 206 Playwright `test()` declaration sites; the unit tree has 1,404 `test`/`it` declaration sites, which is not the same as a runnable-case count. The allowed Vitest run against the current tree reported 2,362 tests, zero failures, and one pending test. It includes the post-baseline tree and expanded cases, so it cannot establish the baseline unit count. After excluding the new PR #101 E2E files and retry rows, the PR #106 list logs contain 221 distinct path/line/title identities on baseline-origin lines, reflecting runtime-expanded scenarios. Playwright was not run, as requested. This audit uses issue #102's 1,330 / 206 figures for planning and flags the unit-count mismatch rather than silently choosing a different denominator.

**Expected reduction from the safe, mechanical proposals:** two E2E cases and two unit case entries (one identity-only deletion and one test merge), about 50 nonblank test lines, and approximately 18 aggregate E2E test-seconds across the three desktop browsers. A unit-only change is below the resolution of useful CI-time estimates. The Python parametrization refactor preserves all five cases and their assertions.

**Additional reductions requiring a judgment call:** keeping one representative E2E in the seven-stage Skip matrix and one in the four-speed overflow matrix would remove nine E2E cases and about 177 aggregate test-seconds. Restricting WebKit to `@layout` plus explicitly tagged browser regressions would save approximately 947 WebKit test-seconds; restricting both WebKit and Firefox to that scope would save approximately 1,403 aggregate test-seconds. These scope estimates use PR #106's list logs and are aggregate worker time, not wall-clock time; CI legs run in parallel. They are alternatives and are not additive.

No assertions are proposed to be loosened. Suggested changes are whole-test deletion, moving a behavior check to an already-existing unit test, or merging tests while retaining every assertion. The Python pipeline and simulation suites have no safe whole-test deletion candidate in this audit.

The only execution was the authorized `npx vitest run --reporter=json --outputFile=.claude/logs/issue102/vitest-durations.json`. It exited successfully with one pending test. Playwright was not run. The current checkout showed concurrent edits in PR #101's new E2E and unit files plus a separate inventory document; all new test files were excluded by using the `a8fc2b7` baseline. This audit itself wrote only the requested review document and the explicitly permitted Vitest report.

### Cost and evidence method

- E2E cost is the sum of Playwright list-reporter durations across desktop Chromium, Firefox, and all WebKit shards. `@layout` cases also run in phone Chromium. The number is aggregate test time, not elapsed PR time.
- PR #106 logs are the source for per-test duration estimates. Retry attempts are included in cost when present. The candidates below had no retry in those logs.
- The project topology is from `playwright.config.ts` and `.github/workflows/ci.yml`: phone Chromium greps `@layout`; full PR E2E runs desktop Chromium, Firefox, and WebKit (WebKit is split into three shards).
- Historical regression references come from `git log --oneline -- <spec>` and the relevant fix commits. Keep-regression tests are called out even where their runtime is high.

## Area-by-area tables

### 1. Auto-roll and settings

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/e2e/auto-roll-lifecycle.spec.ts:115` — “[handler coverage] hidden turns auto-roll OFF, cancels the gap, and visible does not resume” | **DELETE** | `tests/unit/use-auto-roll.test.ts:242,269` covers hidden-to-off, no resume on visible, and stale timer cancellation. The E2E comment says its page-side visibility override exercises the event handler and does not emulate browser tab lifecycle. | 6.4 s across desktop Chromium, Firefox, and WebKit. The unit test covers the behavior more directly. |
| `tests/e2e/game-settings.spec.ts:31` — “very-fast menu speed survives reload with the existing settings payload” | **DELETE covered by unit + representative E2E** | `tests/unit/game-settings.test.ts:76` round-trips every supported speed; `tests/unit/use-game-settings.test.ts:66` cycles all four speeds and presentation while checking writes. `tests/e2e/game-settings.spec.ts:7` retains a real menu-edit/reload E2E. | 11.5 s across the three desktop browsers. The test is the only E2E dedicated to this boundary value, but the hook test already exercises its UI-facing settings state and persistence contract. |
| `tests/e2e/auto-roll-decisions.spec.ts:144,158,172,192,209` — pause/resume gap through menu, log, item card, item-use dialog, and new-game confirmation | **JUDGMENT: retain one E2E or keep all five** | `tests/unit/auto-roll.test.ts:141-147` covers the five pause states as a parameter table; `tests/unit/use-auto-roll.test.ts:195` covers cancelling elapsed time and restarting the full gap for five pause causes; `tests/unit/game-app-auto-roll.test.ts:162` covers the confirmation path. Unit coverage checks the pause policy, while each E2E checks a different UI entry point. | Removing four E2Es while keeping the menu case would save about 36.5 s. Risk: a specific surface could stop setting the pause state even though the shared hook remains correct. This is not a safe deletion. |
| `tests/e2e/auto-roll-lifecycle.spec.ts:192,205` — OS reduced-motion vs. stored “演出なし” do not shorten the ready gap | **MERGE candidate** | Both assert the same full-gap outcome under different sources. `tests/unit/auto-roll.test.ts:56-57` fixes the gap as a policy; the E2Es specifically prove neither motion preference changes it in the integrated app. | Keep both scenarios and all assertions in one E2E setup if the page can be reused without making the scenario harder to diagnose. Savings are setup-only and likely a few seconds; do not count the full 15.0 s as saved. |
| `tests/e2e/auto-roll-lifecycle.spec.ts:135,264` — new/resumed sessions start off; a save failure does not stop auto-roll | **KEEP-REGRESSION** | Distinct session lifecycle and failed persistence conditions; not replaced by the pure pause-policy table. | Preserve. These cover app/session wiring and failure behavior beyond the hook predicate. |
| `tests/unit/use-auto-roll.test.ts:226` — latest callback is used without restarting an unrelated render's gap | **KEEP** | It checks both the latest callback and the observable 1,200 ms deadline, not callback identity alone. | Do not classify this as an implementation-only identity assertion. |

### 2. Turn moments, animation, and result publication

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/e2e/ui-pop-turn-moments.spec.ts:947` — “S16 one Skip during [stage] reaches the same overflow result” for tumble, stamps, movement, arrival, lottery flip, lottery settle, and pickup | **JUDGMENT: merge to one representative browser path** | `tests/unit/turn-moments.test.ts:159-170` covers wrong/stale identities, duplicate observation, and Skip state; `tests/unit/turn-moment-hooks.test.ts:315,360,377` covers Skip through adjustment/save and stale animation completion; `tests/unit/game-app-turn-moments.test.ts` covers the app sequence and publication result. | Keeping pickup and removing the other six would save about 97.8 s. The phase-by-phase browser tests also exercise rendered controls and no-replay behavior, so retain all if those cross-browser UI failures are considered release-critical. |
| `tests/e2e/ui-pop-turn-moments.spec.ts:813` — “S16 complete overflow turn at [very-fast, fast, normal, slow] keeps captured deadlines and one live region” | **JUDGMENT: keep one representative speed in E2E** | `tests/unit/turn-moment-hooks.test.ts:196` covers captured durations and movement step across a speed change; `tests/unit/game-app-turn-moments.test.ts:849` covers the full tumble/adjustment/stamps/movement sequence. | Keeping the shortest very-fast path and deleting fast/normal/slow E2E variants would save about 79.3 s. The unit suite still covers the speed policy; the remaining risk is browser timing/rendering variation at the omitted speeds. |
| `tests/e2e/ui-pop-turn-moments.spec.ts:102` — saved raw roll, adjustment, stamps, then movement | **KEEP-REGRESSION** | `tests/unit/game-app-turn-moments.test.ts:849` covers the same sequence at app level, but this E2E is the browser-visible activation path for the tumble/adjustment flow. | Preserve at least one E2E for each distinct moment family. The history for the spec tracks the feature commits that activated tumble, lottery reveal, arrival, and pickup (`6af094f`, `06484f`, `d4467f`, `d5a2cdd`). |
| `tests/unit/turn-moment-hooks.test.ts:574` — “keeps callback identities stable while options change” | **DELETE (identity-only)** | The test body only compares `begin` and `skip` references. Observable stage timing and captured options are covered by `:169` and `:196`; there is no user-visible callback-identity contract. | Near-zero CI time saved; about 9 test lines and an internal implementation promise removed. This is the clearest unit implementation-coupling candidate. |
| `tests/e2e/ui-pop-turn-moments.spec.ts:974` — “S16 usable map placement through all moments” at 1280×800, 412×839, 320×720, 667×375, and 640×400 | **KEEP layout cases; browser scope is a judgment call** | No unit test can establish the real map/control/card geometry across these viewports. | Five cases are among the slowest layout checks; the 1280×800 case costs 69.9 s across the four projects. Restricting these five cases to Chromium desktop + phone Chromium would save about 63 s (Firefox + WebKit only), at the risk of missing engine-specific geometry. |
| `tests/e2e/resume.spec.ts:221` — “reload during lottery-flip/lottery-settle resumes the committed result without replay” | **KEEP; partial overlap only** | `tests/e2e/ui-pop-turn-moments.spec.ts:961` covers a lottery-flip reload in the more complex mandatory-discard flow, not the ordinary committed result; `tests/unit/turn-result-publication.test.ts:163` covers resume publication boundaries. | Do not delete the normal result path as an exact duplicate. The two fixtures differ at the persisted decision boundary. |
| `tests/unit/turn-moment-presentation.test.ts:609` — goal publication under all/important/none | **KEEP, already parameterized** | One `it.each` preserves all three presentation modes and their segment variants. | No pruning needed. The suite already handles a likely near-duplicate correctly. |

The `ui-pop-turn-moments` spec is a high-cost regression suite. Its per-file total is about 1,056 browser-seconds in the PR #106 logs. Its cost is driven by real-time UI stages, reloads, and viewport layouts rather than obvious duplicate assertions. Prune only the explicitly enumerated speed/Skip variants after deciding how much cross-browser scenario coverage to retain.

### 3. Item controls, accessibility, and notices

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/e2e/accessibility.spec.ts:43,75` — Space/Enter roll and skip shortcuts; `tests/e2e/accessibility.spec.ts:416` — disclosure keyboard behavior | **KEEP** | `tests/unit/game-shortcuts.test.ts` covers shortcut policy; browser tests cover native button activation, visible focus, and screen transitions. | Keyboard focus and browser semantics are not equivalent to pure shortcut predicates. |
| `tests/e2e/ui-pop.spec.ts:369` — ordinary item toast expires while failed-save status remains visible | **KEEP; unit overlap is partial** | `tests/unit/toast.test.ts:477,559,585` covers expiry, sticky failure, and reading pause; the E2E checks their coexistence through a real item action and failed write. | 7.5 s across the three desktop browsers. Deleting it would remove the only integrated stacking/failure scenario. |
| `tests/e2e/items.spec.ts` item dialogs and staged actions | **KEEP representative interaction E2Es** | `tests/unit/item-controls.test.ts`, `item-card.test.ts`, `game-session-items.test.ts`, and engine item tests cover state and decision logic. | Unit tests do not prove the dialog, pointer/keyboard entry, focus return, and save state are wired together in the browser. Keep at least one of each distinct interaction family. |
| `tests/unit/map-panel-observer.test.ts:107,127` — rebind on a panel replacement; avoid rebinding while map/key are stable | **MERGE** | Both exercise the observer lifecycle under the same harness; combine stable rerender then panel replacement in one test and keep every existing observer/callback assertion. | Saves one unit case and repeated mount setup; no measurable CI-time reduction. |

### 4. Map rendering and shipped product data

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/e2e/real-data.spec.ts:214` — shipped Tokyo suburban network starts, moves, restores, and has no console errors | **KEEP-REGRESSION** | Unit product/data contracts validate catalog and network structure, not app startup with the shipped 1,586-station bundle and map. | 72.3 s across four projects; the expensive full-product smoke is unique. |
| `tests/e2e/map-visual.spec.ts:508` — “30 of 30 return guidance” | **KEEP** | Pure progress tests cover counts; only the E2E verifies actual rendered map guidance and labels. | 61.6 s across four projects. Do not delete based on unit-count overlap. |
| `tests/e2e/map-failure.spec.ts:40,85,116,145` — failed style/tiles and style replacement | **KEEP-REGRESSION** | `map-helpers` tests cover helper logic, not MapLibre/browser recovery or continued playability. | Historical spec coverage traces to `bb8e5e5`; preserve one test per failure/recovery mode. |
| `tests/e2e/accessibility.spec.ts:726` — follow padding rebinds to replacement panels without recreating the map | **KEEP-REGRESSION** | `tests/unit/map-panel-observer.test.ts:107,127` covers observer ownership; the E2E covers map instance continuity and resulting camera placement. | Not a duplicate of the observer unit test. |

### 5. Save, resume, and full-game flow

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/e2e/full-game.spec.ts:26` — full game to clear, then play again | **KEEP-REGRESSION** | Engine and save units validate game logic and serialization, but no other E2E starts fresh and traverses the full game path. | 33.3 s across three desktop browsers. This is the only full fresh-game E2E. |
| `tests/e2e/tokyo-suburban.spec.ts:84` — shipped product's actual clearing turn, exact saved result, history, and restart | **KEEP-REGRESSION** | `real-data.spec.ts:214` is a startup/move/restore smoke, not the product clearing boundary. | Product-specific finish path; keep separate from the fixture full-game case. |
| `tests/e2e/save-errors.spec.ts` invalid-save and failed-write cases | **KEEP** | Persistence units cover parser/storage outcomes; E2Es cover Japanese recovery copy, cancellation, reload, and data retention. | Each error path has a different user recovery outcome; no safe whole-test duplicate found. |

### 6. Responsive layout and text wrapping

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/e2e/text-wrapping.spec.ts:574` — dialog wrapping | **KEEP-REGRESSION** | `tests/unit/phrase-text.test.ts` tests break opportunities; it does not test browser font metrics, wrapping, or control fit. | 66.9 s across four projects. The test history maps to fixes `74aa4f9` and `c54b456`. |
| `tests/e2e/text-wrapping.spec.ts:431` — longest real text | **KEEP-REGRESSION** | Text-model unit coverage is not a substitute for the longest shipped names in the rendered HUD. | 65.3 s across three desktop browsers. Added for the #70 long-name regression (`89195e7`). |
| `tests/e2e/turn-result-card.spec.ts:766` — moments preserve and avoid the previous result at 320×480 | **KEEP-REGRESSION** | No unit test can verify the real phone layout or lottery-row landing positions. | Known WebKit-only offset/flakiness tracked by #95; retain while its cause is unresolved rather than widening tolerance or deleting it. |
| `tests/e2e/hud-progress-feedback.spec.ts:194` — breakpoint changes preserve focus in the open log and settings | **KEEP-REGRESSION** | Component focus units do not reproduce a real responsive breakpoint change. | WebKit exposed a real focus-loss bug fixed by `281e35e`; if WebKit scope is narrowed, tag this case explicitly `@webkit`. |

### 7. Python data pipeline and simulation

| Finding | Verdict | Covered by / overlap | Cost and rationale |
|---|---|---|---|
| `tests/data_pipeline/test_overrides.py:326,333,340,345,353` — backward range, closed-chain gap, open-chain gap, overlap, unknown station | **MERGE / parameterize** | Same function and failure contract; use a table of inputs, `circular`, and expected error text. Keep all five parameter rows and their precise error matches. | Maintenance/LOC savings only; no test-case or CI-time reduction. The failure modes differ and must not be collapsed into one broad assertion. |
| `tests/data_pipeline/test_overrides.py:312-353` — line-range success and failure boundaries | **KEEP each boundary** | Adjacent cases distinguish wraparound, open-chain `n-1` mapping, bad direction, gaps, overlap, and unknown stations. | Do not remove edge cases as “duplicates”; each protects a different data invariant. |
| `tests/data_pipeline/test_suburban_historical_baseline.py`, `test_suburban_assembly_*`, `test_platform_transfers.py`, and `test_composition*.py` | **KEEP-REGRESSION** | These enforce frozen-source hashes, reviewed assembly evidence, route identity, and transfer limits. Similar assertion shapes generally validate different source rows or corruption modes. | No identical test names or exact AST-identical test bodies were found across the 536 pipeline test functions. No whole-test deletion is justified by overlap alone. |
| `tests/data_pipeline/test_build.py:146` — raw N02 source checksum | **KEEP, CI skip is documented** | `.github/workflows/ci.yml` documents that raw N02 data is ignored and the test skips in CI. | This is a local/raw-input guard, not a redundant passing CI case. Keep the skip rationale visible. |
| `tests/simulation/*.test.ts` | **KEEP** | Monte Carlo/product measurements and simulation reports have distinct goals from deterministic unit/E2E behavior. | No pruning candidate identified. Do not combine simulation evidence with normal correctness tests. |

## Top-20 ranked actions and guardrails

Savings below are aggregate Playwright test-seconds from the PR #106 logs, not expected PR wall-clock savings. Rows marked as alternatives are not additive. The ranking balances time/maintenance against the risk of losing distinct browser or regression coverage.

| Rank | Proposed action | Verdict / coverage | Estimated saving | Risk |
|---:|---|---|---:|---|
| 1 | On PRs, run WebKit only for `@layout` and explicitly tagged `@webkit` regressions; keep full WebKit on protected-branch runs. | **JUDGMENT ONLY.** Tag `hud-progress-feedback.spec.ts:194` before narrowing; keep the #95 320×480 result case. | About 947 s of non-layout WebKit test time | High; WebKit has found real regressions. |
| 2 | Alternative: run the full pre-existing E2E suite only in Chromium projects. | **JUDGMENT ONLY; do not combine with rank 1.** Would keep phone Chromium's current `@layout` coverage. | About 2,168 s (all Firefox + WebKit work) | Very high; would remove the browser engines that found #95 and the focus regression fixed by `281e35e`. |
| 3 | Reduce the S16 Skip-stage E2E matrix from seven stages to one representative stage, keeping pickup; rely on the existing unit stage matrix for the remaining transitions. | **JUDGMENT.** `ui-pop-turn-moments.spec.ts:947`; unit coverage at `turn-moments.test.ts:159-170` and `turn-moment-hooks.test.ts:315,360,377`. | About 97.8 s for six removed cases | Medium-high; UI button timing and no-replay checks are cross-browser. |
| 4 | Reduce the S16 full-overflow speed E2E matrix from four speeds to one very-fast representative. | **JUDGMENT.** `ui-pop-turn-moments.spec.ts:813`; unit duration matrix at `turn-moment-hooks.test.ts:196`. | About 79.3 s for fast/normal/slow | Medium; browser timing remains untested at the other speeds. |
| 5 | Keep the menu pause E2E and remove the four parallel log/card/use-dialog/new-confirmation pause E2Es. | **JUDGMENT.** `auto-roll-decisions.spec.ts:144,158,172,192,209`; shared policy cases are already parameterized in `auto-roll.test.ts:141-147`. | About 36.5 s for four cases | Medium-high; each UI surface has separate wiring. |
| 6 | Restrict the five S16 viewport-placement cases to desktop Chromium and phone Chromium. | **JUDGMENT.** Keep all five viewport assertions. `ui-pop-turn-moments.spec.ts:974`. | About 63 s (Firefox + WebKit only) | Medium; viewport is the point of the tests, and engine geometry can differ. |
| 7 | Delete the very-fast reload E2E. | **DELETE covered by** `game-settings.test.ts:76`, `use-game-settings.test.ts:66`, plus `game-settings.spec.ts:7` for real reload wiring. | 11.5 s; one E2E | Low. |
| 8 | Delete the synthetic hidden-visibility handler E2E. | **DELETE covered by** `use-auto-roll.test.ts:242,269`. | 6.4 s; one E2E | Low-medium; its comment explicitly says it does not emulate browser tab lifecycle. |
| 9 | Delete the identity-only `begin`/`skip` reference test. | **DELETE covered by observable timing tests** at `turn-moment-hooks.test.ts:169,196`. | No measurable time; one unit case and about 9 lines | Low. |
| 10 | Merge stable observer rerender and changed-panel rebind into one lifecycle unit test. | **MERGE** `map-panel-observer.test.ts:127` into `:107`, retaining both observer counts, disconnect state, and callback assertions. | Maintenance-only; no measurable time. The unit case count may drop by one. | Low. |
| 11 | Parameterize the five invalid line-range tests. | **MERGE** `test_overrides.py:326,333,340,345,353`; keep five separately reported parameter cases and all five message matches. | No test-time reduction; about 15–25 repeated setup/assertion lines | Low. |
| 12 | Merge the OS reduced-motion and stored “演出なし” ready-gap scenarios into one test setup. | **MERGE candidate**, `auto-roll-lifecycle.spec.ts:192,205`; retain both separate clock scenarios and assertions. | Setup-only, likely 1–3 s aggregate; not 15.0 s | Low-medium; avoid coupled state making failures hard to isolate. |
| 13 | Keep the complete `tests/e2e/full-game.spec.ts:26` path. | **KEEP-REGRESSION.** No other E2E plays a fresh fixture game all the way to clear. | No saving; 33.3 s retained | High value relative to cost. |
| 14 | Keep `tests/e2e/real-data.spec.ts:214`. | **KEEP-REGRESSION.** Unique full shipped-network startup/map smoke. | No saving; 72.3 s retained | High value relative to cost. |
| 15 | Keep `tests/e2e/map-visual.spec.ts:508` return guidance. | **KEEP.** Unit counts do not replace rendered guidance/map verification. | No saving; 61.6 s retained | High value relative to cost. |
| 16 | Keep `tests/e2e/text-wrapping.spec.ts:574` dialog wrapping. | **KEEP-REGRESSION.** Real browser text metrics; fix history `74aa4f9`, `c54b456`. | No saving; 66.9 s retained | High value relative to cost. |
| 17 | Keep `tests/e2e/text-wrapping.spec.ts:431` longest text. | **KEEP-REGRESSION.** Protects the #70 real-name wrapping issue (`89195e7`). | No saving; 65.3 s retained | High value relative to cost. |
| 18 | Keep `tests/e2e/turn-result-card.spec.ts:766` at 320×480. | **KEEP-REGRESSION.** #95 WebKit variance is unresolved; do not mask it with tolerance changes. | No saving; duration is included in the layout suite | High value despite flakiness. |
| 19 | Keep and explicitly tag `tests/e2e/hud-progress-feedback.spec.ts:194`. | **KEEP-REGRESSION.** WebKit found real breakpoint focus loss; fixed by `281e35e`. | No saving | High; required if browser scope changes. |
| 20 | Keep `tests/e2e/accessibility.spec.ts:726` map-panel replacement flow. | **KEEP-REGRESSION.** Unit observer coverage does not prove the map instance and camera survive a panel replacement. | No saving; about 30.4 s | Medium-high. |

## Judgment calls for the user

1. **How much WebKit to keep on every PR.** The least broad reduction measured is to run layout and explicitly tagged browser regressions in WebKit, saving about 947 aggregate seconds. The issue history argues for full WebKit: it found the focus bug fixed by `281e35e`, and the 320×480 result-card test is still tracked under #95. If WebKit is narrowed, tag the focus case explicitly and retain the #95 case in the layout scope. A Chromium-only suite would save about 2,168 aggregate seconds but carries the largest regression risk.
2. **Whether to keep every S16 Skip stage in a browser.** Unit tests cover the reducer/timer transitions; browser tests cover the actual Skip button, visible discard dialog, saved state, and no replay. Keep all seven if those UI transitions are independently release-critical. Otherwise, retain pickup as the representative E2E and rely on the unit stage matrix for the remaining six.
3. **Whether to E2E every animation speed.** Keep very-fast as the shortest-deadline browser path, while unit tests cover captured speed policy. Retain all four if the browser-specific timer/runtime combination is itself a release requirement.
4. **Whether to E2E each auto-roll pause surface.** The hook's policy is already table-tested, but the five surface paths have different component wiring. Keeping the menu plus the unit table is cheaper; keeping all five gives stronger wiring coverage.
5. **Which engines run the responsive placement matrix.** The five viewports are real layout assertions and are already tagged `@layout`. Running them only in Chromium projects saves about 63 aggregate seconds, but removes Firefox/WebKit geometry coverage for those cases.

## Proposed PR split

1. **Safe front-end duplicate removal:** delete the synthetic hidden-visibility E2E and the very-fast settings E2E. Keep `auto-roll-lifecycle`'s actual new/resume and save-failure cases. Run unit tests and the normal E2E matrix.
2. **Safe unit maintenance:** remove the callback-reference-only hook test; merge the map-panel observer lifecycle tests without losing assertions. Keep this separate from E2E deletion so review can verify behavior-preserving changes.
3. **Pipeline-only refactor:** parameterize the five invalid line-range cases in `test_overrides.py`; preserve their separate case IDs and error-message matches. Do not bundle data-pipeline test removals with UI test pruning.
4. **Optional S16 test-count reduction:** only after the user chooses the coverage level, reduce the Skip and speed E2E matrices while keeping their unit transition/speed coverage. Submit this by test area and review the resulting case list before merging.
5. **Optional CI scope change:** separate PR, independent of test deletions. Keep full Chromium/Firefox/WebKit validation during the change, explicitly tag `@webkit` regressions if WebKit scope changes, and compare PR #106 aggregate timings. Do not combine browser scope and case pruning in one diff; otherwise the source of any missing coverage is hard to review.


## Applied pre-existing changes

Candidates verified against the current tree before applying (rule: if in doubt, keep).

| Cand. | Result | Evidence |
|---|---|---|
| A. very-fast reload E2E (`game-settings.spec.ts`) | **Applied (deleted)** | Unit: `game-settings.test.ts` "round-trips supported v1 speed $id" (every speed incl. very-fast, payload shape + read-back), `use-game-settings.test.ts` "cycles all four speeds and presentation with exactly one write per change". E2E: "persists menu speed and follow through reload without the seed overwriting UI changes" (real reload wiring) and the `@layout` "presentation cycles and survives reload…" test, which still asserts the "速度: とても速い" label and the stored `very-fast` payload. |
| B. synthetic hidden-visibility E2E (`auto-roll-lifecycle.spec.ts`) | **Kept** | `use-auto-roll.test.ts` covers the `visibilitychange` handler only through the hook in isolation. The E2E is the only test that drives the listener through the real `GamePanel` -> `GameHud` toggle (`aria-pressed` goes false, the gap is cancelled, the save stays at turn 0). That wiring is not covered elsewhere, so it is not deleted. |
| C. `begin`/`skip` identity test (`turn-moment-hooks.test.ts`) | **Kept** | `GameApp.tsx` builds `guardedRoll`/`skip` with `useCallback` on `[roll, beginTurnMoment]`/`[finishAnimation, skipTurnMoment]`, and a `useEffect` depends on `beginTurnMoment`; the comment there says the memoised panel's callbacks keep their identity. The test guards that contract, and no other test checks it. |
| D. map-panel observer merge | **Applied (merged)** | "keeps one binding while the panel key and map stay the same" merged into "rebinds to the replacement panel…", now "keeps one binding across re-renders and rebinds to the replacement panel when the panel key changes". All assertions of both tests are kept (the original `onLayoutChange` is not called and `latest` is called once in the stable phase; bind count 2, two observers, first disconnected, replacement observed, one layout call after the rebind). |
| E. invalid line-range tests (`test_overrides.py`) | **Applied (parametrised)** | `test_expand_line_ranges_with_invalid_ranges_raises` with five `pytest.param` ids: `backward-range-on-open-chain`, `gap-on-closed-chain`, `gap-on-open-chain`, `overlap`, `unknown-station`. Inputs, `circular` flag and exact `match=` text are unchanged. |

Not applied: audit rank 12 (merge of the two ready-gap scenarios in `auto-roll-lifecycle.spec.ts`) was outside the requested candidates.


**Update after the final review:** candidate A was reverted (kept). The remaining reload E2E checks the speed label only before reload, so the very-fast label after reload was not covered elsewhere. Net applied changes: D (merge) and E (parametrise) only.
