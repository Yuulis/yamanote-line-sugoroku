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
| S3 card-less fallback | done | (this commit) | Luna S3 stopped correctly on an existing exact-string assertion (`game-app-turn-moments.test.ts` discard hold test, arrival stages never rendered) -> lead authorised appending the suffix; S3b fixed the new segment-flash test fixture. Candidate now eligible at every `published` (`ARRIVAL_COPY_PHASES.has(phase) || isPublished`); S2 consumption prevents repeats. R3 (Sol low): product OK, P3 E2E race at `hud-progress-feedback.spec.ts:280` -> lead hardened it with a MutationObserver record + a settled exactly-once assertion (mutation ignoring `consumed` now fails with length 2). Vitest 2438 passed / 1 skipped / 0 expected-fail; typecheck, build pass; hud-progress-feedback + accessibility desktop-chromium 35 passed. Note: concurrent Codex runs caused unrelated 5 s Vitest timeouts; rerun alone was clean. |
| S4 verification | done | (this commit) | Lead on `882cf76`: typecheck pass; build pass; Vitest 2438 passed / 1 skipped in 2 clean runs (one earlier run under host load avg ~7 had 3 failures in unrelated + one #96 file, reasons not captured; the 3 files re-ran 179/179 alone; #96 tests take 80-300 ms vs the 5 s limit); hud-progress-feedback + accessibility desktop-chromium 35 passed; phone-chromium @layout 105 passed. Branch CI on `882cf76` green (webkit skipped on feature push by design). |

## Next

Open PR `fix/issue-96-milestone-announce-once` -> `develop` with `Closes #96` once the user approves; the PR runs the full E2E matrix (webkit included).
