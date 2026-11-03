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
| S1 | First-commit omission and future-key Skip support | pending | | |
| S2 | Pure timing, accepted facts, and roll-attempt reducer | pending | | |
| S3 | Shared movement, ride, and log publication model | pending | | |
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
