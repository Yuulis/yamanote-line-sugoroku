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
| S2 candidate + commit-time consumption | todo | | |
| S3 card-less fallback | todo | | user approved inclusion 2026-11-22 |
| S4 verification | todo | | typecheck, vitest, build, hud-progress-feedback + accessibility on chromium |

## Next

S2: split the milestone candidate out of `deriveTurnMomentDisplay`, report live-region commits from `GamePanel`, record consumed `session:turn:threshold` keys in `GameApp`; flip the 3 `it.fails` in `tests/unit/game-app-turn-moments.test.ts` to `it` (S3's card-less test may stay `it.fails` until S3).
