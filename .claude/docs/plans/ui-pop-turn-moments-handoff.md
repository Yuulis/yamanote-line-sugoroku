# UI Pop P2 (Turn Moments) — Handoff

Resume point for any session (Claude or Codex). **Update after every step** (status, commit, commands and
results, open findings, constraints for the next step) before reporting the step done.

## Goal

Per-turn presentation moments on top of the P0+P1 HUD: pseudo-3D dice tumble with modifier stamps, arrival
banner with a completed-segment flash, a split-flap (パタパタ) lottery board at the visible map centre that settles
into the HUD ride row, and an item pickup flight before DiscardChoice. Presentation only: no
engine/RNG/save/`src/types/network.ts`/public-data change.

## Documents

- Plan (Codex validated PASS): `.claude/docs/plans/ui-pop-turn-moments-plan.md`
- Brief / scan: `.claude/docs/research/feature-ui-pop-turn-moments-{brief,codebase}.md`
- Architecture: `.claude/docs/plans/ui-pop-turn-moments-architecture.md`
- Design rows: `.claude/docs/DESIGN.md` (2026-11-03 UI pop P2 rows)

## Decisions (user, 2026-11-03)

- All four moments are in P2. Durations scale with 速度 (factor = stepMs / 450, captured at the roll).
- Flap board overlays the visible map centre, then settles into the HUD; only when a draw happened; no probabilities.
- Pseudo-3D CSS cube dice.
- During post-move reveal stages the dice is disabled (focusable, `aria-disabled`); overlay tap and スキップ end the reveal; one Skip ends tumble + movement + reveal.
- Goal turn: arrival banner, then ClearScreen.
- Reduced motion and resumed results: no moments.
- Pause after every step for user review. Codex Luna high implements, Sol low reviews, lead verifies; targeted local E2E per step, full 4-browser suite in CI.

## Step Status

| Step | Title | Status | Commit | Notes |
|---|---|---|---|---|
| S1 | First-commit omission and future-key Skip support | done | (this commit) | Luna high (`.claude/logs/codex/20261103T135325Z-p2-s1.md`): `useRevealSequence` gains optional `skipRequested`; `observe` takes `omit = reducedMotion || skipRequested` in both new-key and same-key branches; the post-commit reduced-motion effect is removed, so an omitted key commits `stage: "done"`, `busy: false`, `ready: movementComplete` from its first render; completion is sticky per key. Callers must hold `skipRequested` until the record key appears and reset it for the next roll (S5). +5 tests in `U/reveal-sequence.test.ts` (30 total). Review Sol low ACCEPT, 0 blocking (non-blocking: the new deadline test only counts timers; the existing stage-identity test proves the deadline). Lead: typecheck PASS; `npx vitest run` 62 files / 1,238 passed, 1 skipped; build PASS (existing >500 kB chunk warning); forbidden-path audit empty; `verify_delegation` 0 actionable (3 deletions = replaced effect + this row). Production still passes empty stages: no behaviour change. Baseline screenshot `.claude/logs/screenshots/p2-s01-desktop-baseline.png` (turn 3, 品川). Next: S2. |
| S2 | Pure timing, accepted facts, and roll-attempt reducer | done | (this commit) | Luna high round 1 (`.claude/logs/codex/20261103T140253Z-p2-s2.md`) → Sol low CHANGES_REQUIRED, 4 blocking (stamps started while the adjust dialog was still open; facts from other turns/sessions mutated the attempt; stamps unconditional; thin tests) + lead finding (tumble always advanced to `awaiting-adjust`). Round 2 Luna (`.claude/logs/codex/20261103T140653Z-p2-s2-r2.md`) fixed all → Sol low ACCEPT, 0 blocking. New `G/animation/turnMoments.ts` (pure, unwired): `turnMomentTiming(stepMs)` (factor vs the `"normal"` `ANIMATION_SPEEDS` entry; normal 600/240/800/1,600/400/500 ms), `observeTurnFacts`, `turnMomentsReducer` (begin/observe/advance/skip/reset; attempt key `${sessionId}:roll:${turn+1}:${decisionRevision}`; record, adjust decision (by `decision.turn`) and movement events (by movement session/turn) accepted only for the attempt; `awaiting-adjust` holds until the matching record; tumble → `awaiting-adjust` / `stamps` / `released` / `waiting-record`; Skip latches until the next accepted begin; restored roll omits tumble but attaches its later record; deadhead releases). `hudPresentation.ts`: pure `itemRideModifierWording` / `itemRideHasModifierWording` extracted from `compactItemRoll` (same order and wording). Lead fix: 寝過ごし also requires stamps (user decision; test row re-pointed to `true`). Tests: `U/turn-moments.test.ts`. Lead: typecheck PASS; `npx vitest run` 63 files / 1,263 passed, 1 skipped; build PASS; forbidden-path audit empty; `verify_delegation` 0 actionable. Non-blocking for S5: add mid-stage reduced-motion on→off and a direct `advance(tumble)` → `waiting-record` test. Screenshot: none (no UI). Next: S3. |
| S3 | Shared movement, ride, and log publication model | done | (this commit) | Luna high round 1 → Sol low CHANGES_REQUIRED, 3 blocking (raw face shown during the tumble; with no attempt the committed next ride leaked during arrival/lottery; boundary tests thin and expectations computed by helpers). Round 2 Luna (`.claude/logs/codex/*-p2-s3-r2.md`) fixed all → Sol low ACCEPT, 0 blocking. New `G/turnMomentPresentation.ts` (pure, unwired): `deriveTurnMomentDisplay(input)` with `TurnPublicationPhase` (`pre-move` → `moving` → `arrival` → `lottery-flip` → `lottery-settle` → `published`; restored/omitted = published) returning `phase`, `turn`, `progress`, `ride`, `compactRoll`, `rollText`, `arrivalText`, `lotteryText`, `candidateRows`, `showClear`. Input: session, network, presentation resolver, displayed `progress` (single progress input; no `animation`), S2 attempt, reveal stage, `restoredOrOmitted`. Rules: compact roll `—` during `waiting-roll`/`tumble`, raw face after, modifier wording from `stamps`; ride = origin/ridden service until publication; marker on the ridden service's arrival platform; ride, lottery text and candidates publish together at `done`; detailed roll text from arrival; `showClear` only when published. Tests `U/turn-moment-presentation.test.ts` with literal expectations. Lead: typecheck PASS; `npx vitest run` 64 files / 1,275 passed, 1 skipped; build PASS; forbidden-path audit empty; `verify_delegation` 0 actionable. Non-blocking: goal-segment check at test L250 still derives from `targetSegmentIds()`. Screenshot: none (no UI). Next: S4. |
| S4 | Safe item view, decisions, and announcements | pending | | |
| S5 | Movement start gate and sequence hook | pending | | |
| S6 | Adopt the shared display model across consumers | pending | | |
| S7 | Presented-decision handoffs and action guards | pending | | |
| S8 | Overlay placement and animation target refs | pending | | |
| S9 | E2E readiness and explicit checkpoint helpers | pending | | |
| S10 | Dice cube and modifier visuals, unmounted | pending | | |
| S10b | Integration fixtures and timing-sensitive test preparation | pending | | |
| S11 | Enable tumble, adjustment, stamps, and one Skip | pending | | |
| S12 | Enable arrival and delayed goal presentation | pending | | |
| S13 | Concurrent completed-segment flash | pending | | |
| S14 | Enable lottery flip, settle, and atomic ride publication | pending | | |
| S15 | Enable pickup and delayed discard handoff | pending | | |
| S16 | Combined lifecycle and responsive browser verification | pending | | |
| S17 | Lead-owned design and final handoff documentation | pending | | |

## Current

- 2026-11-03: plan approved by the user (pause after every step, S1–S17 including invisible plumbing). Next: S1.
- 2026-11-03: S1 done; paused for user review. Capture helper: `scratchpad/p2-shot.spec.ts` copied to `tests/e2e/zz-p2-shot.spec.ts`, run with `P2_SHOT=<png>` on desktop-chromium, then removed (never committed).
- 2026-11-03: S1 CI 41649779582 success (4 E2E legs). S2 done; paused for user review.
- 2026-11-03: S2 CI 41651944687 success. S3 done; paused for user review.
