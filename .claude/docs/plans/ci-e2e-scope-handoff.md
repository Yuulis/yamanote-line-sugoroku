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

## CI evidence (a0fb1c6, PR #88)

- Push run 43162081901: one leg (desktop-chromium 11m34s) + "E2E quick (desktop-chromium)", green.
- pull_request run 43162105876: four legs (chromium 9m13s, phone 6m22s, firefox 9m18s, webkit 11m45s) + "E2E (Playwright)", green. PR #88 mergeStateStatus CLEAN.
- Docs-only skip on a PR not exercised live yet (first docs-only PR will show it).

## WebKit shards (user 2026-11-12)

User: merge only if WebKit finishes in ~10 min like the others. History (55 legs): WebKit median 11.9 min, 13-14 min
recently, two 20 min timeouts on 2026-11-10; test step dominates (662-872 s), ~1.7x Chromium per test. User chose
sharding; two shards estimated ~11 min wall, so three shards (est. max ~6.5 min of tests + ~1.5 min setup).

## Next

Confirm the 3-shard WebKit legs on PR #88 CI (~10 min or less), then merge into develop (user-approved on that condition). Not run: actionlint
(unavailable), local E2E (tags select tests only; CI runs them).
