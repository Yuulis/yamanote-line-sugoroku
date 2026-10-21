# C2 CI Speedup Analysis

Date: 2026-10-20. Branch: `feature/ci-speedup` (from `develop` at `7c754e6`).
Scope: investigation only; no workflow, test, or config file was changed.
Repository visibility: **PUBLIC** (`gh repo view --json visibility`), so
standard GitHub-hosted runner minutes are free; extra jobs cost runner
concurrency (Free plan: 20 concurrent jobs), not money.

Raw inputs (not committed): per-run job JSON and E2E job logs under
`/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/f7711c87-aeb5-43c6-99f5-c547ac553170/scratchpad/ci-analysis/`
(about 2 MB total; no artifacts were downloaded because the report/trace
artifact is uploaded only on failure).

## 1. Current pipeline

`.github/workflows/ci.yml` has three independent jobs on `ubuntu-latest`
(Ubuntu 24.04 image 20261012.334.1). All three are required status checks
in both rulesets (`protect-develop`, `protect-master`) under the exact
contexts `Frontend (typecheck, unit tests, build)`,
`Data pipeline (ruff, ty, pytest, validate)`, `E2E (Playwright)`.

| Job | Steps |
|-----|-------|
| Frontend | checkout, setup-node (npm cache), `npm ci`, `tsc -b`, `vitest run`, `npm run build`, grep bundle for E2E hook |
| Data pipeline | checkout, setup-uv (cache), `uv sync --locked`, ruff check/format, `ty check scripts/`, `pytest -q`, validate |
| E2E | checkout, setup-node, `npm ci`, read PW version, cache `~/.cache/ms-playwright`, `playwright install --with-deps chromium firefox webkit`, `xvfb-run npm run test:e2e`, upload artifacts on failure |

Playwright (`playwright.config.ts`): 4 projects (`desktop-chromium`,
`phone-chromium` = Pixel 7, `desktop-firefox`, `desktop-webkit` on CI),
`fullyParallel: true`, `workers: 2` on CI, `retries: 1` on CI, 30 s test
timeout, webServer = `vite build --mode e2e` + `vite preview`.
Suite size: 55 tests x 4 projects = 220 (3 skipped by design: the
phone-only `map-visual.spec.ts:166` on the three desktop projects).

### 1.1 Job durations (seconds, from the GitHub Jobs API)

Wall = first job created to last job completed.

| Run id | Event / branch | Tests | Frontend | Pipeline | E2E job | E2E test step | Browser install step | E2E job minus test step | Wall (min) |
|--------|----------------|-------|----------|----------|---------|---------------|----------------------|-------------------------|-----------|
| 39269499995 | PR develop->master | 220 | 27 | 89 | 716 | 658 | 37 | 58 | 11.97 |
| 39269452441 | push develop | 220 | 24 | 87 | 699 | 654 | 27 | 45 | 11.68 |
| 39265664368 | PR feature->develop | 220 | 22 | 83 | 706 | 659 | 32 | 47 | 11.80 |
| 39265658563 | push feature | 220 | 25 | 54 | 702 | 644 | 38 | 58 | 11.73 |
| 39274442634 | push master | 220 | 23 | 90 | 607 | 537 | 50 | 70 | 10.15 |
| 39280515799 | PR (docs-only) | 220 | 18 | 158 | 627 | 543 | 55 | 84 | 10.50 |
| 39264108613 | push feature | 220 | 24 | 58 | 583 | 522 | 49 | 61 | 9.75 |
| 39217068153 | PR develop->master | 164 | 22 | 88 | 408 | 360 | 31 | 48 | 6.83 |
| 39217053590 | push develop | 164 | 20 | 65 | 510 | 440 | 52 | 70 | 8.53 |
| 39211958487 | PR feature->develop | 164 | 22 | 73 | 389 | 344 | 28 | 45 | 6.52 |

Notes:
- `gh run list` shows 35.0 min for 39280515799; that is an `updated_at`
  artifact. Its jobs span 10.5 min (attempt 1, queue 3 s).
- Inside the frontend and pipeline jobs, every setup step is 0-6 s;
  caches (npm, uv, Playwright browsers) all hit. In the E2E job,
  `npm ci` is 1-4 s and the Playwright browser cache restores in 4-8 s
  (`Cache restored from key: playwright-Linux-1.63.0` in all four logs).
- The browser-install step is cached for browsers but still runs apt:
  181 packages, 12.5 MB + 114 MB downloaded (all four E2E logs). That is
  the whole 27-55 s.
- Pipeline `pytest -q` is 41-71 s; it is never on the critical path.

### 1.2 Critical path

`E2E` job -> `Run E2E tests` step. It is 89-92% of wall time in every run
(e.g. 658 of 716 s in 39269499995). Frontend (~20 s) and pipeline (~55-90 s)
finish long before it.

Inside the test step (from timestamps in the E2E log of 39269499995):
- Step start 14:31:01.75, `Running 220 tests using 2 workers` 14:31:05.8,
  first result 14:31:12.3. Build + preview server startup costs well under
  10 s, so reusing a shared build saves almost nothing.
- Tests run project by project (fullyParallel orders by project). Per-project
  wall spans (end of previous project to end of this one):

| Run id | desktop-chromium | phone-chromium | desktop-firefox | desktop-webkit | Step total |
|--------|------------------|----------------|-----------------|----------------|-----------|
| 39269499995 | 152 s | 201 s | 122 s | 176 s | 658 s |
| 39269452441 | 151 s | 203 s | 120 s | 174 s | 654 s |
| 39274442634 | 127 s | 164 s | 98 s | 142 s | 537 s |

- Sum of per-test durations: 1285 s (39269499995), 1279 s (39269452441),
  1045 s (39274442634). Divided by 2 workers this equals the step time
  within ~2%, so the 2 workers are saturated and the suite is purely
  throughput-bound: wall time scales with test-seconds / parallel slots.
- Growth: test-seconds went from 693 s (164 tests, 39217068153) to
  1285 s (220 tests, 39269499995): +34% tests, +85% test-seconds.
  `accessibility.spec.ts` (new in C1/C3) alone is 267 s (21%).
- Run-to-run variance for the identical suite is ~20% (537-659 s),
  attributable to runner noise.
- No retries occurred in any of the four parsed logs (`retry #` count 0).

## 2. Slowest tests

Per-test mean over runs 39269499995, 39269452441, 39274442634 (seconds):

| # | Spec | Test | d-chromium | phone | firefox | webkit | Sum |
|---|------|------|-----------|-------|---------|--------|-----|
| 1 | real-data.spec.ts | the shipped Tokyo suburban product network starts, moves and restores (test.slow) | 31.2 | 31.3 | 23.5 | 31.9 | 117.8 |
| 2 | map-visual.spec.ts | at overview zoom only transfer and target stations are marked | 9.1 | 10.3 | 11.1 | 9.6 | 40.1 |
| 3 | full-game.spec.ts | [8.3-2/3] play a full game to the clear screen, then play again | 9.6 | 12.4 | 6.5 | 11.5 | 40.1 |
| 4 | map-visual.spec.ts | real Japanese labels follow overview and zoom density | 8.8 | 13.7 | 6.4 | 9.3 | 38.3 |
| 5 | save-errors.spec.ts | captured pre-S5 save against the live product bundle | 9.2 | 11.3 | 6.1 | 10.6 | 37.2 |
| 6 | tokyo-suburban.spec.ts | the product game's actual clearing turn saves the exact result | 8.3 | 11.2 | 5.8 | 7.8 | 33.1 |
| 7 | save-errors.spec.ts | [8.3-4] tampered rngSeed shows the Japanese message | 7.2 | 9.3 | 5.9 | 8.5 | 31.0 |
| 8 | tokyo-suburban.spec.ts | the real Korakuen transfer shows joined station names | 7.5 | 10.3 | 5.0 | 7.3 | 30.1 |
| 9 | accessibility.spec.ts | restoring a game starts with an empty announcement | 7.8 | 9.7 | 5.0 | 7.4 | 29.9 |
| 10 | save-errors.spec.ts | [8.3-4] previous ruleset shows the Japanese message | 7.4 | 9.6 | 4.1 | 8.7 | 29.7 |

Distribution (39269499995): median per test 4.6 s desktop-chromium,
6.1 s phone-chromium, 3.4 s firefox, 5.5 s webkit; minimum ~0.9 s.
Per file (test-seconds, 39269499995): accessibility 267, real-data 191,
save-errors 174, capital-region 167, map-visual 140, map-failure 71,
tokyo-suburban 70, dice 64, full-game 43, resume 38, lottery 32, layout 23,
map-unsupported 5.

Observations:
- The tail is flat: the top 10 tests are 35% of test-seconds; #1 alone is
  10%. Per-test optimisation therefore has limited leverage compared with
  adding parallel slots.
- phone-chromium is the slowest project (+30% over desktop-chromium).
  Hypothesis (not measured): Pixel 7 emulation has deviceScaleFactor 2.625,
  so software WebGL renders ~2.3x the pixels of the 1280x800 desktop.
  Changing that would weaken verification, so it is out of scope.
- There are **no fixed sleeps**: `grep waitForTimeout` finds nothing in
  `tests/e2e`; waits are `expect`/`expect.poll`-based. Only one
  `test.slow()` exists (real-data.spec.ts:209). "Replace sleeps with readiness
  waits" has ~0 s to gain.
- The auto fixture `railwayBundle` calls `loadBundle(dataset)` per test.
  Measured locally: 116 ms/call for `real`, ~2.5 ms for the fixtures.
  About half the specs use `real`, so the upper bound is ~110 x 0.15 s
  = ~17 test-seconds, ~8 s wall. Not worth a change on its own.

## 3. Options ranked

Saving estimates are against 39269499995 (wall 11.97 min, test step 658 s)
unless stated. "Fixed job overhead" = E2E job duration minus test step,
measured at 45-84 s (median ~58 s) across the 10 runs above.

| Rank | Option | Est. wall saving | Risk | Files | Size |
|------|--------|------------------|------|-------|------|
| 1 | E2E matrix per Playwright project (4 legs) + aggregator job named `E2E (Playwright)` | ~6.5-7.5 min (12.0 -> ~4.5) | Low | ci.yml | S |
| 2 | Add sharding inside the heavy legs (e.g. 2 shards each for the two Chromium projects and WebKit) | further ~1-1.5 min (-> ~3-3.5) | Low-Med | ci.yml | S |
| 3 | Install only the leg's browser (`--with-deps <browser>`) | ~10-30 s per leg (est.) | Low | ci.yml | S (bundled with 1) |
| 4 | Experiment: `workers: 3` on CI | 0 to ~30% of test step; unknown | Med | playwright.config.ts | S + experiment |
| 5 | De-duplicate push + pull_request runs of the same SHA | 0 wall; halves runner load per push to an open PR | Med (policy) | ci.yml | S |
| 6 | Docs-only change detection (skip E2E legs, aggregator still reports) | ~10 min on docs-only PRs only | Med (policy) | ci.yml | M |
| 7 | Memoise `loadBundle` per worker | ~8 s | Low | tests/e2e/fixtures.ts | S |
| 8 | Shared build artifact across jobs | ~5 s per leg, minus upload/download | Low | ci.yml, playwright.config.ts | M |
| 9 | Playwright Docker image to skip apt | 0 to -30 s (image pull ~2 GB may cost more than apt) | Med | ci.yml | M |
| - | Test-level rewrites (fewer map re-inits, merged tests) | uncertain, small per test | High (verification) | tests/e2e/** | L |

### Rationale

1. **Matrix per project.** The test step is throughput-bound at 2 workers;
   splitting the 4 projects onto 4 runners keeps each runner's load exactly
   as today (2 workers, same tests, same browser) while running them
   concurrently. Critical leg = phone-chromium: 201 s tests (39269499995)
   + ~6 s build/startup + ~58 s fixed overhead ≈ 265 s ≈ 4.4 min, versus
   11.97 min. On 39274442634: 164 + 6 + 70 ≈ 4.0 min vs 10.15 min.
   Required-check compatibility: matrix jobs are reported as
   `E2E (Playwright) (desktop-chromium)` etc., which would leave the required
   `E2E (Playwright)` context pending forever, so an aggregator job with that
   exact name is mandatory. `fail-fast: false` so every browser reports.
   Verification scope is unchanged: same 4 projects, same 220 tests, same
   assertions, same xvfb wrapper, same retries. Billed runner-minutes rise
   from ~15 to ~20-22 per run (4 x ~4 min legs + frontend + pipeline);
   free on this public repo. Concurrency: 7 jobs per run, 14 when push and
   PR runs overlap, under the 20-job Free plan cap.
2. **Shards on top of the matrix.** Once legs are ~2-3.5 min of tests,
   per-leg fixed overhead (~1 min) starts to dominate; splitting
   phone-chromium (201 s) into 2 shards gives ~100 s + overhead ≈ 2.7 min,
   and the critical path moves to whichever leg is next. Diminishing returns
   and more jobs (up to 8 legs), so do it only after 1 is measured.
   `--shard` balances by test count, not duration, so expect ±20% imbalance.
3. **Per-browser install.** Today every run installs apt deps for all three
   browsers (181 packages, 126 MB). A chromium-only leg needs fewer
   packages; the saving is an estimate (not measured) and only matters on
   the critical leg. Naturally falls out of option 1.
4. **workers: 3.** `ubuntu-latest` for public repos has 4 vCPU / 16 GB. The
   config comment records that 4 workers failed on a 7 GB WSL2 host; CI was
   never measured above 2. Software WebGL is CPU-bound, so gains are
   uncertain and timeouts are the risk (the `test.slow()` test already
   takes 25-35 s of its 90 s budget). Needs a workflow_dispatch experiment;
   do not change blindly.
5. **Duplicate runs.** Same-SHA pairs exist: 39265658563 (push) and
   39265664368 (PR), both 76747ba3, 14 + 15 billed job-minutes; 39269452441
   (push develop) and 39269499995 (PR develop->master), both 82abd2e3.
   The concurrency group keys on `github.ref`, which differs between the push
   and PR events, so neither cancels the other. Not a wall-time win and it
   changes what is verified (PR runs test the merge ref), so it is the
   user's call.
6. **Docs-only skip.** 39280515799 changed only
   `docs/manual/development-roadmap/proposal.md` yet ran the full 10.5 min.
   `paths-ignore` at workflow level would leave required checks pending and
   block merges; it must be job-level detection with the aggregator
   reporting success. It does reduce what runs on those commits, so it
   conflicts with the "no reduced verification" requirement unless the user
   explicitly accepts it for `docs/**`, `*.md`, `.claude/**`.
7-9. Measured or estimated gains are seconds; not worth a PR of their own.

## 4. Recommended first PR (option 1 + 3)

Change only `.github/workflows/ci.yml`; leave `frontend` and `pipeline`
untouched. Outline:

```yaml
  e2e-matrix:
    name: E2E (${{ matrix.project }})
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: false
      matrix:
        include:
          - { project: desktop-chromium, browser: chromium }
          - { project: phone-chromium,   browser: chromium }
          - { project: desktop-firefox,  browser: firefox }
          - { project: desktop-webkit,   browser: webkit }
    steps:
      # checkout, setup-node, npm ci, read PW version: unchanged
      - name: Cache Playwright browsers
        uses: actions/cache@<same pin>
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ steps.playwright.outputs.version }}-${{ matrix.browser }}
      - run: npx playwright install --with-deps ${{ matrix.browser }}
      - name: Run E2E tests
        run: xvfb-run --auto-servernum npx playwright test --project=${{ matrix.project }}
      - name: Upload Playwright report and traces
        if: failure()
        uses: actions/upload-artifact@<same pin>
        with:
          name: playwright-artifacts-${{ matrix.project }}
          path: |
            playwright-report/
            test-results/
          retention-days: 7
          if-no-files-found: ignore

  e2e:
    # Keeps the required status-check context "E2E (Playwright)".
    name: E2E (Playwright)
    needs: e2e-matrix
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: All E2E legs must succeed
        run: test "${{ needs.e2e-matrix.result }}" = "success"
```

Points to verify in the PR:
- The aggregator must fail on `failure`, `cancelled`, and `skipped`
  results; comparing to `success` covers all three.
- Each leg prints the test count; the four counts must sum to 220
  (217 passed + 3 skipped) so no project is silently dropped. Do not add
  `--pass-with-no-tests`: Playwright's default "No tests found" failure is
  what catches a mistyped project name.
- `xvfb-run` stays on every leg (harmless for Chromium/WebKit, required for
  Firefox); WebKit stays enabled via `GITHUB_ACTIONS`.
- Acceptance: CI green on the PR with the 4 legs + aggregator, wall time
  recorded from at least 2 runs, required check `E2E (Playwright)` shown
  as satisfied on the PR page. No ruleset change needed.
- Rollback: revert the single ci.yml commit.

## 5. Open questions for the user

1. Accept ~20-22 billed runner-minutes per run (was ~15) and up to 7-14
   concurrent jobs? Free on this public repo, but it would cost money if the
   repo ever goes private.
2. After the matrix lands, is ~3 min (option 2, more legs) worth it, or is
   ~4.5 min good enough?
3. May I run a `workers: 3` experiment via `workflow_dispatch` on the
   feature branch (option 4)? It does not change verification scope but
   could surface timeouts.
4. Policy questions (both reduce *runs*, not tests): keep push CI on
   `feature/**` when a PR is already open (option 5)? Skip E2E for
   docs-only changes (option 6)? Both are off by default given the
   "no reduced verification" requirement.
