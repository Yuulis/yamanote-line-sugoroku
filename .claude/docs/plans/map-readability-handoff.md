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
| 1.2 | done | 2f43e99 (CI green) | Luna xhigh (1st run stopped correctly on shared deps ZERO_MAP_PADDING/positionsBounds; prompt relaxed, 2nd run moved them too); lead: removed lines verbatim except 3 import specifiers, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 945 -> 787 lines |
| 1.3 | done | ffbeeb5 (CI green) | Luna xhigh; lead: removed lines verbatim except the now-unused positionsBounds import specifier, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 787 -> 705, railwayMapCamera.ts 340 lines |
| 1.4 | done | 6078690 (CI green) | Luna xhigh; lead: 61 removed lines verbatim in useSegmentFlash.ts, test import path + comment only, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 705 -> 643 lines |
| 1.5 | done | (this commit) | Luna xhigh run 1 passed unit tests but Sol low REJECTED (High): one persistent RailwayMap starts in title mode, so the creation-time flag never reached gameplay (before/after screenshots were byte-identical). Re-delegation 1/1: modeRef + setBackgroundFocus in a layout effect on mode/layersRevision; new tests railway-layers-background-focus.test.ts and title-map-mode transition test. Runtime paint via __sugorokuE2E (e2e build): title 3/0.75, game 2/0.3, resumed 2/0.3. Lead: typecheck, vitest 2750 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. Screenshots .claude/logs/screenshots/issue72-s15-*.png |
| 1.6 | next | — | — |

## Next action

Write the Step 1.6 prompt (A2 candidate publication in deriveTurnMomentDisplay, TDD; not visible) and run it with Luna xhigh. Lesson from 1.5: verify visible steps from the running app (e2e build + window.__sugorokuE2E.map) and compare screenshot hashes.
Open question for PR2: what 次 does from the done view (lead default: disabled); ask the user before Step 2.1.
