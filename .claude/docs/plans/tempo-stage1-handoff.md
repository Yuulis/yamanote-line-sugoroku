# Tempo Stage 1 (issue #64) — Handoff

Resume point for any session (Claude or Codex). **Update after every step** (status, commit, commands and results,
open findings, constraints for the next step) before reporting the step done.

## Goal

Shorten long games without rule changes: a 4th speed 「とても速い」, a persisted 「演出」 level
(すべて / 重要なときだけ / なし), speed / follow / 演出 persisted under one global localStorage key, and Space/Enter roll
plus S/Escape skip shortcuts. Out: auto-roll 「おまかせで進む」 (stage 2), engine / RNG / save / analytics changes.

## Documents

- Plan (revision 3; Codex validation round 1 and 2 NEEDS_REVISION, all required edits applied, not re-validated
  after round 2): `.claude/docs/plans/tempo-stage1-plan.md`
- Brief (COMPLEX) / scan: `.claude/docs/research/feature-tempo-fast-forward-auto-roll-{brief,codebase}.md`
- Codex consults: `.claude/logs/codex/20261108T042720Z-tempo-scope-arch.md`, `20261108T043125Z-tempo-plan.md`,
  `20261108T043626Z-tempo-validate.md`, `20261108T044052Z-tempo-revalidate.md`
- DESIGN input (dry-run only, not applied): `.claude/logs/design-input-tempo-fast-forward-auto-roll.json`

## Branch

`feature/tempo-stage1` from `develop` — **not yet created**. Flow: feature → PR → `develop` → PR → `master`
(rulesets block direct pushes; never merge to `master` without explicit approval). Check CI after every push.

## Step status

| Step | Title | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| S1 | Settings types and guarded storage (not wired) | done | `e609f55` | Codex Sol; typecheck ok; vitest 71 files / 1689 passed (1 pre-existing skip) |
| S2 | Persist the existing speed and follow controls | pending | — | |
| S3 | Turn policy + speed-id timing table (no behaviour change) | pending | — | split again if > 250 prod LOC |
| S4 | Frozen reveal plan owned by `useTurnMoments` (no behaviour change) | pending | — | |
| S5 | Card-less `segment-flash` stage (not yet reachable) | pending | — | |
| S6 | Expose the 4th speed 「とても速い」 | pending | — | S16 / helper migration |
| S7 | 重要なときだけ / なし internals | pending | — | split S7a/S7b if tests > ~450 LOC |
| S8 | Expose and persist the 演出 menu control | pending | — | |
| S9 | Keyboard shortcuts and menu hint | pending | — | |
| S10 | Final local validation and full diff review | pending | — | |

## Decisions (details: plan sections 1-2)

- Timing table per speed; slow/normal/fast equal today's rounded values; very-fast 120 / tumble 160 / stamps 64 /
  no arrival / lottery 280 + 100 / pickup 140 / flash 180. Cycle normal → fast → very-fast → slow.
- Card-less `segment-flash` stage keeps the new-segment flash when there is no arrival card.
- 重要なときだけ omits tumble, modifier stamps and arrival card; なし omits every stage; neither touches
  `reducedMotion` / `restoredOrOmitted`; adjust and discard are never omitted; ClearScreen stays in every level.
- Speed + level + timing captured at roll (`attempt.policy`); changes apply from the next turn.
- Settings key `yamanote-line-sugoroku:settings:v1` (`{version: 1, speedId, follow, presentationLevel}`), global,
  separate from saves; only the menu toggle persists 追尾 — a manual-pan OFF is session-only (Q1, user 2026-11-08).
- Shortcuts in `useGameShortcuts` (GamePanel, bubble phase); hint is non-focusable menu text; tab order unchanged.

## Constraints for every step

- Tests first; targeted local checks per step (listed in the plan) — unit + only the affected Playwright specs on
  `desktop-chromium` and `phone-chromium`; Firefox / WebKit and the full matrix run in CI.
- `persistence.test.ts:215` and `ui-pop.spec.ts:799-852` stay unchanged; no weakened or skipped tests; no
  production-derived E2E timing oracle.
- `GameApp.tsx` ≤ 488 lines; `turnMoments.ts` / `useTurnMoments.ts` / `turnMomentPresentation.ts` below 400.
- One step per user approval; pause after each step for review.

## Next step

1. Plan approved by the user 2026-11-08 (implementer: Codex Sol, default effort; pause after every step) → lead applies the DESIGN rows:
   `python3 .claude/skills/_shared/update_design.py --input .claude/logs/design-input-tempo-fast-forward-auto-roll.json --apply --require-change`.
2. Branch `feature/tempo-stage1` created; S1 done. Next: **S2** after user go-ahead.
