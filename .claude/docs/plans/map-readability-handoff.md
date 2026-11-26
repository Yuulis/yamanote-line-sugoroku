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
| 1.1 | done | a5487da (CI green) | Luna xhigh; lead: 76 removed lines verbatim in railwayMapCamera.ts, typecheck, vitest 2746 pass / 1 pre-existing skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 1,022 -> 945 lines |
| 1.2 | done | (this commit) | Luna xhigh (1st run stopped correctly on shared deps ZERO_MAP_PADDING/positionsBounds; prompt relaxed, 2nd run moved them too); lead: removed lines verbatim except 3 import specifiers, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 945 -> 787 lines |
| 1.3 | next | — | — |

## Next action

Write the Step 1.3 prompt (pure move of title/overview/follow camera helpers) and run it with Luna xhigh. Pre-empt shared dependencies in the prompt (move + import back, as in 1.2).
Open question for PR2: what 次 does from the done view (lead default: disabled); ask the user before Step 2.1.
