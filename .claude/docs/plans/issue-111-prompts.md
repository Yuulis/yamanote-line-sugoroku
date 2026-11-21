# Issue #111 — implementation prompts

Branch: `fix/issue-111-webkit-rules-turn` (from develop 3acaf9a).
Context: `.claude/docs/research/troubleshoot-webkit-first-turn-notice-turn-stall-context.md`.

## D1 — temporary WebKit diagnostics (Codex Luna xhigh)

Objective: add a temporary, #95-style WebKit diagnostic (spec + workflow) that
proves or refutes hypothesis H1 for issue #111: in
`tests/e2e/first-turn-notice.spec.ts` "combined notice delivery › notice waits
through rules and announces after ordinary progress", `page.clock.runFor(30_000)`
(line ~293) runs before the movement's first `requestAnimationFrame` is
registered, so no movement runs and ターン数 stays 0 on CI WebKit. H3 (the app
really does not move while the 遊び方 dialog is open) must be ruled in or out.

Scope:
- IN: create `tests/e2e/diag-111.spec.ts` and `.github/workflows/diag-111.yml`.
  Model both on the #95 diagnostics: `git show 93a57db 949ef18`
  (`.github/workflows/diag-95.yml`, `tests/e2e/diag-95.spec.ts`; they were removed
  in 9e09e96). Reuse the container image tag that the current
  `.github/workflows/ci.yml` `e2e-webkit` job uses (do not hard-code a different
  Playwright version), `--ipc=host`, xvfb-run, `--project=desktop-webkit`,
  `--repeat-each=30 --retries=0 --workers=2`, artifact upload `if: always()`.
  Trigger on push to `fix/issue-111-webkit-rules-turn` only (plus
  workflow_dispatch). Gate the spec with an env flag (e.g. `DIAG_111=1`,
  `test.skip` otherwise) so normal CI runs skip it.
- The diag spec reuses the real helpers from `tests/e2e/support/*` and the exact
  setup of the original test (`page.clock.install`, `openTitle`, `startNewGame`,
  `freezeClock`, `observeStatusAnnouncements`, dice click, tumble stage, open game
  menu, open 遊び方, `advanceTumble`). Three variants:
  - `V0 original`: then `page.clock.runFor(30_000)` exactly as the original test.
  - `V1 fixed`: `await awaitMovementRelease(page)` between `advanceTumble` and
    `runFor(30_000)`.
  - `V2 no-dialog`: like V0 but without opening the game menu / 遊び方.
  For each variant record, with `performance.now()` timestamps: markers just
  before/after `advanceTumble` and `runFor(30_000)` (via `page.evaluate`), the
  wall time each `runFor` took (Node side), every `requestAnimationFrame` call
  made by app code (install the wrapper *after* `page.clock.install` so it wraps
  the fake rAF — verify this on desktop-chromium locally; if a wrapper cannot see
  the calls, record instead the first time the moving marker / `移動中` status
  appears), the dice-moment stage, whether the rules dialog is open, and the HUD
  ターン数 right after `runFor(30_000)`.
  Recovery probe (V0 and V2 only, when ターン数 is still 0): `flushQueuedTasks`
  then `runFor(30_000)` again; record ターン数 after it.
  Attach all records as JSON (`testInfo.attach`). V0/V2 must not fail on a stall
  (it is the measurement); V1 asserts ターン数 becomes 1 (a real failure there
  is a finding). Also run the original test in the same workflow
  (`first-turn-notice.spec.ts --grep "notice waits through rules"`) with the same
  repeat settings, so the baseline failure rate is measured in the same run.
- Add an analysis script `.claude/logs/issue111/analyze_diag111.py` (stdlib only,
  modelled on `.claude/logs/issue102/analyze_diag95.py` if present) that reads the
  downloaded artifact JSON and prints per-variant: runs, stalls after the first
  runFor, recovered-after-probe count, runFor wall-time distribution, rAF-before
  vs after runFor counts.
- OUT: do not modify `tests/e2e/first-turn-notice.spec.ts`, any `src/` file,
  `.github/workflows/ci.yml`, or `playwright.config.*` (if the WebKit project is
  gated by `GITHUB_ACTIONS`/`E2E_WEBKIT`, set the env in the diag workflow). Do not
  commit, push, or run the full E2E suite.

Rules: `AGENTS.md`, `.claude/rules/testing.md`, `.claude/rules/coding-principles.md`.
Local notes: WebKit cannot run locally. Run Playwright as
`env -u WAYLAND_DISPLAY npx playwright test …`; never `pkill -f`.

Acceptance checks:
- `npm run typecheck` (or the repo's typecheck script) passes.
- `DIAG_111=1 env -u WAYLAND_DISPLAY npx playwright test tests/e2e/diag-111.spec.ts --project=desktop-chromium --repeat-each=2 --workers=2` passes and the attached JSON contains rAF/marker records for all three variants.
- `npx playwright test tests/e2e/diag-111.spec.ts --project=desktop-chromium` without `DIAG_111` reports all tests skipped.
- `python3 -I .claude/logs/issue111/analyze_diag111.py <local test-results dir>` prints the summary for the local run.
- `git status --short` lists only the three new files (plus this prompt file).

Output: changed files; how the rAF wrapper was verified; the exact workflow
command; local command results; anything that could not be done.
