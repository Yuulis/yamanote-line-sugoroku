# Troubleshoot context: WebKit turn stall in first-turn-notice E2E (issue #111)

Phase 1 error-context analysis. Date: 2026-11-21. No repository file other than
this note was changed; no CI was triggered.

## TL;DR

- Most likely a **test-timing bug**, not an app bug. In both failing WebKit
  traces, `page.clock.runFor(30_000)` returned after **42 ms and 6 ms of wall
  time**. In three local Chromium passes it took **9.1-11.7 s**, because it
  drives hundreds of movement animation frames. In WebKit the movement's first
  `requestAnimationFrame` did not yet exist when the 30 s advance ran. After
  that, the clock stays paused and the movement can never progress, so the HUD
  turn stays `0`.
- The test is the only spec that calls `runFor` straight after `advanceTumble`
  without the documented `awaitMovementRelease` / `primeMovementFrame` wait
  (`tests/e2e/support/turnMoments.ts:152-172`).
- Missing evidence: a direct timestamp showing that the movement rAF was
  requested *after* `runFor(30_000)` returned, and a check that the page
  recovers when the test waits for the release.

## 1. Failing runs and artifacts

| PR | Run | Attempt / job | Result | Artifacts |
|----|-----|---------------|--------|-----------|
| #110 (develop, v0.17.1, head `ac50ad7`) | 44679961318 | attempt 1, job 136100805159 `E2E leg (desktop-webkit 1/3)` | failed, first try and retry #1 | `playwright-artifacts-desktop-webkit-1` (artifact 14603439814) |
| #110 | 44679961318 | attempt 2 | passed | none |
| #106 (`ci/webkit-playwright-container`, head `f4d2e93`) | 44554263911 | attempt 1, job 135666032116 `E2E leg (desktop-webkit 1/3)` | flaky (`✘ 73 ... (11.2s)`, then passed on retry; log line 395, `1 flaky` at line 457) | **none**: upload is `if: failure()` (`.github/workflows/*.yml` ~l.278/339), and the job passed |

Local copies (untrusted data, scratchpad):

- `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/b41c896f-42e3-4d6f-9a82-be60cf757aa5/scratchpad/ci-111/logs/job-136100805159.log`
- `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/b41c896f-42e3-4d6f-9a82-be60cf757aa5/scratchpad/ci-111/run-44679961318/` (report and test-results)
- Unzipped traces: `.../scratchpad/ci-111/trace-a1/` (first try) and `.../scratchpad/ci-111/trace-a1r1/` (retry #1)
- Local Chromium comparison traces: `.../scratchpad/local-111/t/`
- Analysis scripts: `.../scratchpad/scripts/{summ,snaps,snapat,runfor}.py`

Failure, both attempts (`first-turn-notice.spec.ts:270` at `ac50ad7`, which is
`:294` at HEAD, same code):
`expect(getByRole('main',{name:'ゲーム操作'}).locator('[data-stat="turn"]')).toHaveText("1")`.
The locator resolved 18 times, always to
`<span title="0" data-stat="turn" ...>0</span>`, with a 7000 ms timeout.

## 2. What the trace shows

The action timeline of the first try (`trace-a1/1-trace.trace`, wall-clock ms):

```
224763 clockPauseAt                      (freezeClock)
224854 click サイコロを振る               -> 225055
225072 expect dice-tumble data-stage=tumble  ok
225279 click メニュー; 225615 click 遊び方 -> dialog 遊び方 visible at 225842
225845 expect data-stage=tumble ok; 225861 MessageChannel flush (awaitStage)
225875 clockRunFor 600    -> 226095   (220 ms wall)
226096 clockRunFor 30000  -> 226138   (42 ms wall)   <-- nothing ran
226140 expect turn == "1" -> 233151 Expect failed
```

The retry (`trace-a1r1`) shows the same shape: `runFor(600)` took 385 ms, and
`runFor(30000)` took **6 ms**.

Page state at failure (frame-snapshot at 226150, after `runFor(30000)`, and at
233155):

- `.turn-moment-host` / `.dice-tumble` were gone, so the tumble had ended and
  the pre-move moment had released.
- The lottery row text was `移動中…`.
- The live status was `出目は4です。移動中です。スキップできます。`.
- The compact roll was `4マス`, and the turn was `0`.
- The 遊び方 dialog was still open (it was carried by reference in the
  snapshot).
- So the roll was registered and accepted, and the session sat in the
  `animating` phase with the movement not finished.

Console: the trace has no console or page-error events.

Local Chromium baseline: `--trace on --repeat-each 3` gave 3 passes.

| Trace | `runFor(600)` wall | `runFor(30000)` wall |
|-------|--------------------|----------------------|
| chromium #1 | 28 ms | 11 726 ms |
| chromium #2 | 9 ms | 11 478 ms |
| chromium #3 | 59 ms | 9 084 ms |
| **webkit CI try** | 220 ms | **42 ms** |
| **webkit CI retry** | 385 ms | **6 ms** |

## 3. Execution flow, from test step to turn increment

1. `advanceTumble` (`tests/e2e/support/turnMoments.ts:139`) does two things:
   - It calls `awaitStage("tumble")` (`:119`), which waits for
     `data-stage=tumble` and then `flushQueuedTasks` (`:101`). This ensures the
     tumble timer exists.
   - It then calls `page.clock.runFor(600)`.
2. The tumble timer is a `window.setTimeout` set in a React effect
   (`src/features/game/animation/useTurnMoments.ts:135`). It dispatches
   `advance`, and the attempt stage becomes `released`, which sets
   `movementStartAllowed` (`useTurnMoments.ts:222-223`). It does not use CSS
   `animationend`.
3. Playwright fake clock, `_runTo` / `_callFirstTimer`
   (`node_modules/playwright-core/lib/coreBundle.js:12023`, injected clock):
   - It fires each due fake timer, then yields **one real `setTimeout(0)`**.
   - When no due timer is left, it returns immediately and only advances `now`.
   - Fake rAF is a timer at `now + 16`, and it fires only during a later
     `runFor` or `fastForward`, because the clock is paused.
4. The `dispatch` from inside the fake timer schedules a React 19.3 render.
   This is a default lane, delivered as a real MessageChannel task that the
   clock does not fake. Then:
   - The commit happens.
   - The passive `useEffect` runs in `useMoveAnimation`
     (`src/features/game/animation/useMoveAnimation.ts:70-87`). It only does
     work once `startAllowed` (`GameApp.tsx:351`) is true.
   - That effect calls `runMoveAnimation`, which calls
     `requestAnimationFrame` (`src/features/game/animation/runner.ts:13,51`).
5. Each rAF tick (`runner.ts:41-50`) calls `frameAt`. When the move is done it
   calls `onDone`, which is `app.finishAnimation`.
6. The arrival stage starts. The HUD turn switches from `attempt.origin.turn`
   (0) to the record's turn (1) once it is past `isBeforeArrival`
   (`src/features/game/turnMomentPresentation.ts:473-474`, rendered at
   `GameHud.tsx:104`).

**Divergence point:** between steps 3 and 4. The test's next call,
`page.clock.runFor(30_000)` (`first-turn-notice.spec.ts:293`), can run before
the real render task and the passive-effect task have executed, so before the
movement rAF exists. In that case, the 30 s advance fires nothing. The later
rAF is queued on a paused clock and never runs.

The helper contract states this exact hazard. `awaitMovementRelease`
(`turnMoments.ts:152-162`) says: "the release renders asynchronously after the
clock advance that ended the tumble ... the frame is requested in an effect
after that render; priming before then would be lost."

## 4. Key findings

1. In the failing runs, `runFor(30000)` lasted 6-42 ms. In passing runs it
   lasted 9-12 s. This is the strongest evidence that no movement frames were
   scheduled during the advance.
2. The app had already moved past the tumble when the test failed: the dice
   moment was hidden, the status said "移動中", and the roll was 4. The stall
   is in the movement start, not in the tumble, the dialog, or the save.
3. Turn progress has no gate tied to a modal. `startAllowed` depends only on
   the attempt stage (`useTurnMoments.ts:222`). `rulesOpen` affects only
   `toastObscured` and dialog deferral (`GameApp.tsx:531,584`). The
   adjust/discard deferral under the rules dialog is a separate feature
   (`rules-guide.spec.ts:218-275`).
4. `first-turn-notice.spec.ts:292-293` is the **only** spec where
   `advanceTumble` is followed directly by a clock advance. Every other spec
   inserts `awaitMovementRelease`, a `readSave`, or an `expect` round trip
   first. The similar `rules-guide.spec.ts:253-264` discard path makes several
   round trips before its `runFor(30_000)`.
5. WebKit CI is slow on the page's main thread (`runFor(600)` took 220-385 ms
   against 9-59 ms locally). This widens the window in which React's
   MessageChannel work lags behind the next protocol-driven `runFor`. The open
   native `<dialog>` may add rendering cost, but this is unproven.
6. No CSS `animationend` is involved in the tumble-to-movement handoff: the
   timers are JS `setTimeout` and rAF. The seam is fake timers against real
   MessageChannel tasks.
7. The test was added in `ac9bd5d` (2026-11-18, #60/#68 step 14, PR #101).
   It has flaked since its first WebKit runs, in PR #106 and PR #110. The
   relevant helpers have been unchanged since then.

## 5. Ranked hypotheses

| # | Hypothesis | For | Against |
|---|------------|-----|---------|
| H1 (most likely) | **Test timing:** `runFor(30_000)` runs before the movement's first rAF is registered. The rAF then waits forever on the paused clock. | 6/42 ms against 9-12 s wall duration; state frozen at "移動中"; the helper docs name this race; the spec is unique in skipping the wait; WebKit only (slow main thread) | No direct timestamp of the rAF registration yet |
| H2 | A WebKit-specific ordering issue: the real `setTimeout(0)` yield in the Playwright clock or inspector-dispatched evaluation preempts MessageChannel tasks, so React's commit and effects never run in time. | Fits WebKit-only; explains why Chromium always wins the race | This is the mechanism of H1, not a separate bug; it has no product impact |
| H3 (unlikely) | An app bug: the movement does not start in WebKit while a modal is open (for example, rAF suppressed or the effect not run under the dialog). | The failure happens only with the dialog open | No modal gate in code; real rAF runs with a dialog open; the release had already happened; Chromium and Firefox pass. It would show as `turn` staying 0 even after a wait plus another `runFor`, which H1 predicts will not happen. |
| H4 (unlikely) | The movement starts but the reveal or arrival chain stalls under the dialog. | None | The 42 ms wall time cannot contain a move; the status is still "移動中", not arrival |

**Assessment:** a test-timing bug, with no expected Safari user impact. In
real Safari, time runs and rAF fires, so the movement completes.

## 6. How #95 was diagnosed (reusable)

- The work used temporary commits on the fix branch:
  - `93a57db` added `.github/workflows/diag-95.yml` and
    `tests/e2e/diag-95.spec.ts`.
  - `949ef18` set 2 workers.
  - `9e09e96` removed both before the fix PR (#108).
- Workflow (`git show 949ef18:.github/workflows/diag-95.yml`):
  - Trigger: `push` on the fix branch, plus `workflow_dispatch`.
  - Chromium job: `ubuntu-24.04`.
  - WebKit job: container `mcr.microsoft.com/playwright:v1.63.0-noble` with
    `--ipc=host`, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, and an image and
    package version check.
  - Run command:
    `DIAG_95=1 xvfb-run --auto-servernum npx playwright test tests/e2e/diag-95.spec.ts <original spec> --project=desktop-webkit --grep "<orig>|diag" --repeat-each=30 --retries=0 --workers=2`.
  - Upload: `if: always()`, artifact `diag-95-<project>`, 7-day retention.
- The diagnostic spec installed a recorder through an init script, exposed as
  `window.__diag95`. It recorded events and samples with `performance.now()`
  and attached the results as JSON.
- The results were analysed with `.claude/logs/issue102/analyze_diag95.py`.
  Root-cause note: `.claude/docs/research/issue95-lottery-landing-root-cause.md`.

For #111 the same setup works:

- Repeat this test plus a `diag-111` variant 30× on WebKit with 2 workers.
- Record:
  - wall time before and after each `runFor`;
  - a wrapper around `window.requestAnimationFrame` installed *after*
    `page.clock.install`, logging the call time and `performance.now()`;
  - markers set by `page.evaluate` immediately before and after
    `runFor(30_000)`;
  - the dice stage and attempt stage, and the saved `turn` and `pending`.
- A/B variant: insert `await awaitMovementRelease(page)` (or
  `primeMovementFrame`) between `advanceTumble` and `runFor`.

## 7. Evidence still missing

1. Direct proof that the movement `requestAnimationFrame` was registered after
   `runFor(30_000)` returned in the failing case. The rAF timestamp against the
   runFor markers is the deciding measurement.
2. A recovery check. After the stall, run `flushQueuedTasks` and then
   `runFor(30_000)` again. If the turn reaches 1, H1 is confirmed and H3 is
   excluded.
3. The A/B failure rate on WebKit CI: the current test against a variant with
   `awaitMovementRelease`. Expect roughly 0/60 failures for the variant.
4. Whether the open dialog is necessary for the race. Run the same sequence
   without opening 遊び方 and compare failure rates. This matters only for
   explaining why the race is WebKit- and dialog-correlated, not for the fix.
5. A trace for the PR #106 flake. It was not uploaded because the job passed.
   A diagnostic run should use `if: always()`.
6. Real-time behaviour on Safari or WebKit with the dialog open (no fake
   clock). A one-shot manual or diagnostic check would close out any user
   impact; it is expected to show no stall.

## Diagnostic results (2026-11-21, added by the lead)

Temporary workflow `diag-111.yml` (commit on `fix/issue-111-webkit-rules-turn`,
removed before the PR), run 44872745646, desktop-webkit, `--repeat-each=30
--retries=0 --workers=2`:

| Case | Runs | Turn stayed 0 |
|------|------|---------------|
| Original test (unchanged) | 30 | 7 |
| V0: original steps + two `page.evaluate` markers between `advanceTumble` and `runFor(30_000)` | 30 | 0 |
| V1: `awaitMovementRelease` before `runFor(30_000)` (asserted) | 30 | 0 |
| V2: V0 without opening 遊び方 | 30 | 0 |

- All 60 dialog-open diagnostic runs moved and reached turn 1, with 519+
  movement rAF calls inside the first `runFor`. No app-side gate on the open
  dialog (H3) is consistent with this.
- Adding any page round trip between the two calls removed the stall, which
  matches H1: the 30 s advance ran before the released movement requested its
  first frame.
- Fix: `await awaitMovementRelease(page)` between `advanceTumble` and
  `runFor(30_000)` in `tests/e2e/first-turn-notice.spec.ts`. No assertion was
  changed.
