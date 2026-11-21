# Issue #96 — milestone sentence announced once — handoff

- Plan: `milestone-announce-once-plan.md` (decisions recorded there).
- Prompts: `milestone-announce-once-prompts.md` (P0 plan consult, S1...).
- Branch: `fix/issue-96-milestone-announce-once` (from `develop` `66cf6e0`).
- Implementer: Codex Luna xhigh; reviews: Codex Sol low. Pacing: stop after every step.

## Step status

| Step | Status | Commit | Notes |
|------|--------|--------|-------|
| Plan | done | `ecf8267` | plan + prompts committed |
| S1 regression tests | done | (this commit) | 3 `it.fails` (Skip after arrival card; reduced-motion discard; card-less publication) + 1 passing 30/30 Skip case. Lead flipped them to `it` locally: all 3 fail at the #96 assertion (2 hits vs 1, or 0 vs 1). Vitest 2421 passed / 3 expected fail / 1 skipped; typecheck pass. Not covered: Skip during a lottery (no crossing fixture with a lottery); lower-milestone resume is covered only at the pure level (`progress-milestone-publication.test.ts` entryTurn guard) |
| S2 candidate + commit-time consumption | done | (this commit) | Luna S2 -> R2 fix first; Luna S2b -> R2b fix first (2nd failure); per user, Sol gpt-6.2-sol S2c -> R2c (Sol low) "commit", one P3 (no test for a consumed discard status remounting after rules reopen) fixed by the lead with a mutation check. Design: `deriveTurnMomentDisplay` returns base copy + `milestoneCandidate`; `GamePanel` composes via pure `composeMilestoneAnnouncement` (`milestoneAnnouncement.ts`) on the surface it mounts and reports commits from a layout effect; `GameApp` ref ledger {consumed, held}; blocked-but-mounted surfaces keep a matching hold; notice bookkeeping uses base copy; classic cache only from ordinary panel commits. Vitest 2436 passed / 1 expected fail (S3) / 1 skipped; typecheck, build, HUD spec (desktop-chromium, by Sol) pass. |
| S3 card-less fallback | todo | | user approved inclusion 2026-11-22 |
| S4 verification | todo | | typecheck, vitest, build, hud-progress-feedback + accessibility on chromium |

## Next

S3: card-less fallback — let an unconsumed candidate attach at the first eligible publication when the turn never passes the arrival-copy phases (no card, no renderable flash, no lottery); flip the last `it.fails` in `tests/unit/game-app-turn-moments.test.ts`; move the negative check at `progress-milestone-publication.test.ts` (flash -> result) to a GameApp status test, per plan.
