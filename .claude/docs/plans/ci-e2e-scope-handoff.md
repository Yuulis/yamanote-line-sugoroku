# Issue #83 handoff: CI E2E scope

Branch `feature/ci-e2e-scope` (from `origin/develop` d5234c0). Prompts:
`ci-e2e-scope-prompts.md`. Pacing: continuous; implementer Codex Luna xhigh,
Sol low reviews, lead verifies (user 2026-11-12).

## Decisions (user 2026-11-12)

- Add `pull_request` (develop/master) trigger; supersedes decision B
  (push-only CI, 2026-10-20).
- Feature pushes: desktop-chromium only, aggregate named
  `E2E quick (desktop-chromium)` so it cannot satisfy the required check.
- PRs, develop/master pushes, `workflow_dispatch`: all four legs →
  `E2E (Playwright)`.
- phone-chromium runs only `@layout`-tagged tests; when in doubt, tag.

## Steps

| Step | Scope | Status |
|------|-------|--------|
| S1 | `.github/workflows/ci.yml` | done: scope/matrix in `changes`, aggregate name from github context; lead merged duplicate helper and restored rationale comments; 4 event cases simulated locally |
| S2 | `@layout` tags + phone `grep` | done: phone 218 → 66 tests (14 files), desktop 218 unchanged; tag-only diff; record `.claude/logs/ci-e2e-scope/s2-layout-tags.md` (git-ignored) |
| S3 | README E2E section, DESIGN.md decision D row; Sol low review: no findings | done; push + PR CI proof in progress |

Baseline: 218 tests in 22 files per project (lead, 2026-11-12).

## Next

Push (expect one leg + "E2E quick (desktop-chromium)") → PR to develop
(expect 4 legs + "E2E (Playwright)") → merge after green. Not run: actionlint
(unavailable), local E2E (tags select tests only; CI runs them).
