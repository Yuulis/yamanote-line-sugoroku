# Auto-roll 「おまかせで進む」 (issue #64, stage 2) — Handoff

Resume point for any session (Claude or Codex). **Update after every step** (status, commit, commands and results,
open findings, constraints for the next step) before reporting the step done.

## Goal

A toggle 「おまかせで進む」 in the HUD actions row that keeps rolling through the existing `guardedRoll` with a
1,200 ms ready gap, stops right after a published turn that picked up an item, waits on the adjust and discard
decisions, pauses while any surface / dialog / staged item is present, turns OFF on a hidden tab, and is never
persisted. No engine, RNG, save, settings-storage or analytics change.

## Documents

- Plan (Codex validation: round 1 and 2 NEEDS_REVISION, all edits applied; round 3 PASS): `.claude/docs/plans/auto-roll-plan.md`
- Brief (MODERATE) / scan: `.claude/docs/research/feature-auto-roll-{brief,codebase}.md`
- Codex consults: `.claude/logs/codex/20261109T033024Z-autoroll-scope-arch.md`, `20261109T033501Z-autoroll-plan.md`,
  `20261109T033934Z-autoroll-validate.md`, `20261109T034248Z-autoroll-revalidate.md`, `20261109T034436Z-autoroll-revalidate2.md`
- DESIGN input (dry-run only, not applied): `.claude/logs/design-input-auto-roll.json`

## Branch

`feature/auto-roll` from `develop` (created; contains tempo stage 1). Flow: feature → PR → `develop` → PR → `master`
(rulesets block direct pushes; never merge to `master` without explicit approval). Check CI after every push.

## Step status

| Step | Title | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| S1 | Pure scheduling and pickup-stop predicates (not wired) | done | `38f96ef` | Codex Luna xhigh; typecheck ok; vitest 75 files / 1907 passed (1 pre-existing skip); 32 new predicate tests |
| S2 | `useAutoRoll` hook and shared roll guard (not wired) | done | `24514b3` | Codex Luna xhigh; vitest 76 files / 1959 passed; hook tests 52 passed x3 runs. Deviation: DOM dialog recheck (100 ms x12) then MutationObserver so a long-open native dialog restarts the gap on close |
| S3 | Wire the toggle, manual inputs, confirm pause and 3-button layout | done | `52cb223` | Codex Luna xhigh + lead: ON tint CSS, opt-in E2E_SCREENSHOT_DIR; vitest 77 files / 1966 passed; E2E auto-roll+ui-pop+hud-layout+accessibility+layout desktop/phone chromium 104 passed, 4 existing skips; GameApp.tsx 477 |
| S4 | Coalesced announcements in the existing status | done | `fb3510b` | Codex Luna xhigh, redone once after lead review (first attempt parsed 「Nターン目：」 text and grew 7 refs). Now summaryTurn structural signal + pure selectAutoRollAnnouncement; useAutoRoll.ts 235 lines; vitest 78 files / 1977 passed; E2E auto-roll+accessibility+items+ui-pop-turn-moments desktop/phone chromium 215 passed |
| S5a | Browser coverage: decisions, pauses, input races | done | `ab13213` | Codex Luna xhigh; typecheck ok; auto-roll-decisions.spec desktop/phone chromium 28 passed (1.3 min). Adjust-then-resume is unit-covered only (use-auto-roll.test.ts:326): the adjust fixture picks up a harmful drop in the adjusted turn. Reduced test budget per user |
| S5b | Browser coverage: lifecycle, motion modes, save failure | pending | | |
| S6 | Final local validation and full diff review | pending | | |

## Decisions (details: plan section 2)

- Placement: dice → スキップ → おまかせ; visible 「おまかせ: OFF/ON」, name 「おまかせで進む」, `aria-pressed`, always enabled.
- Gap 1,200 ms from ready; restarts after any pause; independent of speed / 演出 / reduced motion.
- Stop after a published turn newer than the ON baseline with `pickup-retained`, `harmful-scheduled` or
  `cancelled-by-certificate`; pending discard: stop if the new item was kept, resume if it was discarded (Q1).
- Wait (ON) on adjust (Q2) and discard; pause on presentation, menu / log / item card, item dialog, confirm, other
  `dialog[open]`, staged draft (Q3); manual rolls stay allowed.
- OFF on `visibilitychange` → hidden; lifecycle resets come from the keyed `GamePanel` remount / unmount.
- Save failure: no stop / pause. No analytics, no toasts. Announcements coalesced in the single panel status.
- DESIGN 2026-11-08 settings row's "auto toggle may be added to settings v1" is superseded: not persisted.

## Open questions (need the user)

- Q1 discard rule; Q2 adjust wait-then-resume; Q3 staged-draft pause (plan section 7).

## Constraints for every step

- Tests first; targeted local checks per step (listed in the plan) — unit + only the affected Playwright specs on
  `desktop-chromium` and `phone-chromium`; Firefox / WebKit and the full matrix run in CI.
- `GameApp.tsx` ≤ 488 lines (476 now); `GamePanel.tsx` ≤ ~400 (383 now); new files ≤ 400.
- Unchanged invariants: one panel `role=status` (`accessibility.spec.ts:595`, `items.spec.ts:53`), panel fit
  (`accessibility.spec.ts:603`), `diceButton()` locators, shortcut tests, `persistence.test.ts:215`. No skipped or
  weakened tests; no production module as an E2E timing oracle; E2E helpers in `tests/e2e/support/autoRoll.ts`.
- Pacing per user choice at approval.

## Next step

1. Plan approved and Q1-Q3 answered with the defaults by the user 2026-11-09. Implementer: Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh`); pause after every step.
2. Lead applies the DESIGN rows:
   `python3 .claude/skills/_shared/update_design.py --input .claude/logs/design-input-auto-roll.json --apply --require-change`.
3. Start S1.
