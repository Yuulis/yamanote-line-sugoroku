# C2 CI Speedup Handoff

Branch: `feature/ci-speedup`. Only `.github/workflows/ci.yml` changes.
Analysis: `.claude/docs/research/c2-ci-speedup-analysis.md`.

## Goal

Cut CI wall time (~10-12 min, 89-92% of it the single E2E test step) without
reducing what is verified and without touching the required status checks
`Frontend (typecheck, unit tests, build)`,
`Data pipeline (ruff, ty, pytest, validate)` and `E2E (Playwright)`
(rulesets `protect-develop`, `protect-master`; strict policy off).

## User Decisions (2026-10-20)

- **A.** E2E as a matrix, one leg per Playwright project (`desktop-chromium`,
  `phone-chromium`, `desktop-firefox`, `desktop-webkit`), `fail-fast: false`.
  No extra sharding, no workers change.
- **B.** Stop running the same commit twice (push + pull_request).
- **C.** Skip E2E when a change is docs-only.

## Design

### A: matrix + aggregator

- Job `e2e-matrix`, named `E2E leg (<project>)`, each leg installs only its
  browser (`--with-deps <browser>`; Playwright always adds its `tools` group:
  xvfb and CJK fonts), keeps `xvfb-run`, 2 workers, retries, and uploads
  `playwright-artifacts-<project>` on failure. Browser cache key gains the
  browser name (one-time cache miss on the first run).
- Job `e2e`, named exactly `E2E (Playwright)`, `needs: [changes, e2e-matrix]`,
  `if: always()`. Passes only if detection succeeded and either
  (`e2e=true`, legs `success`) or (`e2e=false`, legs `skipped`). Anything
  else (failed, cancelled, unexpectedly skipped legs, failed detection) fails.
- Leg names never collapse to `E2E (Playwright)` when the matrix is skipped.

### B: push-only triggers

- `on: push: branches: ["**"]` plus `workflow_dispatch`; no `pull_request`.
  Required checks are matched by name on the PR head SHA regardless of event,
  so a PR is gated by the push run of its head commit. Every push to every
  branch still runs, including before a PR exists.
- Rejected: keeping `pull_request` and skipping one side with job-level `if`.
  A skipped job reports "Success" under the same check name on the same SHA,
  and GitHub does not document which of several same-named check runs wins,
  so a skipped run could mask a failing one. Detecting "a PR exists" from the
  push run is also racy.
- Concurrency group includes `github.event_name`, so a manual dispatch never
  cancels the push run of the same branch. `cancel-in-progress` is off on
  `develop`/`master`, so post-merge runs are never cancelled while running.
- Lost: CI on fork PRs (they stay blocked; fail-closed) and the PR test merge
  commit (strict is off, so the head is tested, not head merged into the
  current base). Post-merge runs on develop/master always run the full suite
  and catch integration breaks after the merge. Enabling the strict policy in
  the rulesets would close that gap (user decision; ruleset change).

### C: docs-only detection (job `changes`)

- Full E2E for `workflow_dispatch`, for pushes to `develop`/`master`, and on
  any doubt (no merge base, git failure, empty diff, API failure).
- Otherwise diff `merge-base(origin/develop, sha)..sha` with `--no-renames`
  (the whole branch, as a PR base...head diff would see it; `before` is not
  used, so new branches and force pushes need no special case).
- Docs = `docs/**`, or `*.md` outside `public/ src/ tests/ data/ scripts/
  .github/`. `docs/` holds only `.md` today and nothing in build or tests reads
  it.
- The fork point must carry at least one GitHub Actions `E2E (Playwright)`
  check run and all of them `success` (`checks: read` on this job only), so a
  skip only inherits a verified result and a docs branch off a red develop
  cannot turn green.

## Local Validation (2026-10-20)

- YAML parses; actionlint 1.7.12 with shellcheck 0.11.0: no findings.
- `playwright test --list` with `GITHUB_ACTIONS=true`: 55 per project,
  4 x 55 = 220 total.
- Detection script, extracted from the workflow and run locally:
  22f88d4 vs parent -> skip; 80bcb33 vs parent -> run (src/);
  new docs-only branch on develop 7c754e6 -> skip; code then docs -> run;
  `public/notes.md` -> run; unverified fork point -> run; empty diff -> run;
  develop push, workflow_dispatch, missing baseline -> run.
- Aggregator: only (success,true,success) and (success,false,skipped) pass.

## To Verify on Real CI

1. The four leg counts sum to 220 (217 passed + 3 skipped by design).
2. The PR page shows all three required checks satisfied from the push run.
3. Wall time from at least two runs (expected ~4-5 min vs ~10-12 min).
4. A docs-only push skips the legs and `E2E (Playwright)` still passes.
5. Push + open PR produce exactly one run per SHA.
6. Per-browser cache keys are created and hit on the second run.

## Real CI Results

- Run 39348962157 (`2b2135d`, 2026-10-20): all jobs success, wall time
  4.5 min (previously 9.75-11.97 min). Legs: desktop-chromium 54 passed +
  1 skipped (2.6m), phone-chromium 55 passed (3.6m), desktop-firefox 54 + 1
  (1.5m), desktop-webkit 54 + 1 (2.1m) = 217 passed + 3 skipped = 220.
  Item 1 verified; phone-chromium is the critical leg.
- Item 4 cannot be proven on this branch: its diff against develop includes
  `ci.yml`, so every push here runs full E2E by design. Verify on the first
  docs-only branch after merge.

## Residual Risks

- `[skip ci]` in a commit message skips the whole workflow and leaves the
  required checks pending (unchanged from before).
- On develop/master a queued (not yet running) run can still be replaced by a
  newer one; the newest commit always runs.

## Next Steps

C2 done (after CI proves the items above) -> B1 -> A1
(`docs/manual/development-roadmap/proposal.md`).
