# Issue #72 handoff: map readability

Resume point for Claude or Codex sessions. Update this file after every step.

- Plan: `.claude/docs/plans/map-readability-plan.md`. It has 23 steps over 3 PRs. Codex
  validated it PASS in round 3, and it was then revised for the user's default changes on
  2026-11-26.
- Prompts: `.claude/docs/plans/map-readability-prompts.md`
- Research: `.claude/docs/research/feature-map-readability-brief.md` and
  `.claude/docs/research/feature-map-readability-codebase.md`
- Pacing (user 2026-11-26): stop after every step. Codex Luna xhigh implements, and Codex Sol
  low reviews. For each step the lead runs verify, commit, push and branch CI, updates this
  file, reports, and then waits.
- Lead re-verification: typecheck, touched vitest, full vitest, build, the diff check, and phone
  `@layout`. Desktop E2E is left to branch CI.

## Branches

| PR | Branch | Base | Status |
|---|---|---|---|
| PR1 | `feature/map-focus-goal` | develop `c7af52a` | in progress |
| PR2 | `feature/replay-camera-strip` | develop after PR1 | not started |
| PR3 | `feature/shared-track-offsets` | develop after PR2 | not started |

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1.1 | next | — | — |

## Next action

Run Step 1.1 (pure move of the camera layout observer) with the prompt in the prompts file.
