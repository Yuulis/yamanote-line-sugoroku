# Rules guide (#60) + title / save UX (#68) — Handoff

Resume from here. Plan: `.claude/docs/plans/rules-guide-title-save-plan.md` (Codex validation: round 1 NEEDS_REVISION →
Revision 1 → round 2 NEEDS_REVISION → Revision 2 → **round 3 PASS**, 2026-11-17). **Approved by the user 2026-11-17.** Brief: `.claude/docs/research/feature-rules-guide-and-title-save-ux-brief.md`. Scan:
`.claude/docs/research/feature-rules-guide-and-title-save-ux-codebase.md`. Step prompts:
`.claude/docs/plans/rules-guide-title-save-prompts.md`.
Codex consults:
- scope `.claude/logs/codex/20261117T012737Z-rgts-scope.md` (COMPLEX)
- architecture `.claude/logs/codex/20261117T013256Z-rgts-arch.md`
- plan `.claude/logs/codex/20261117T013724Z-rgts-plan.md`
- validation `.claude/logs/codex/20261117T014327Z-rgts-validate.md` (NEEDS_REVISION)
- re-validation `.claude/logs/codex/20261117T015133Z-rgts-revalidate.md` (NEEDS_REVISION)
- final validation `.claude/logs/codex/20261117T015613Z-rgts-revalidate2.md` (**PASS**)

Process:
- Branch: `feature/rules-guide-title-save` (from develop a8fc2b7, v0.16.0); no upstream yet. Flow: feature → PR →
  develop → PR → master.
- Pacing: **continuous from Step 2A** until the user says otherwise (user 2026-11-17 after 1B: 「こちらから指示を出すまで作業は止めなくて良い」); still verify, review, commit, push and check CI per step. Earlier pacing (user 2026-11-17): stop for user review only after steps with a visible change. The no-visual steps 1A, 2A, 2B, 3, 5, 7A, 8A, 8B, 9 and 10A continue to the next step after verification, commit, push and CI.
- Roles (2026-11-17, from Step 2A): **Claude subagents** — `general-purpose-sonnet` implements, `general-purpose-opus` reviews, the lead verifies (user: 「Claudeサブエージェントを使うこと」). Steps 1A–1B used: Codex Luna implements (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh
  --timeout 2400`), Sol low reviews, and the lead verifies, commits, pushes and checks CI after every push.
- Local E2E: targeted specs only, `--workers=2`, tag-aware grep `'TITLE(?: @layout)?$'`. The full 4-project matrix
  runs in CI (a working-branch push runs desktop-chromium only; the PR runs the full matrix; phone runs `@layout`
  only).
- Hard constraints: presentation only (no engine / RNG / persistence serialization / settings format /
  `src/types/network.ts` / public / data / deps). Existing tests change only per the plan's
  deliberate-edit table. Phone HUD 252px at 320x568 and desktop no-scroll unchanged.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1A resume presentation model | done | (this commit) | Luna xhigh; 2 new files 129 LOC; typecheck/build pass; vitest 2219 passed / 1 skipped; verify_delegation 0 actionable; Sol low APPROVE (`.claude/logs/codex/20261117T022128Z-rgts-1a-review.md`) |
| 1B resume label + overwrite confirm + delete link | done | (this commit) | Interrupted once by the user, then finished by Luna xhigh from the partial tree. ~190 LOC; typecheck/build pass; vitest 2219 passed / 1 skipped; desktop-chromium E2E 77 passed (title-save-ux + six edited specs); phone @layout 1 passed; verify_delegation 0 actionable. Sol low REQUEST_CHANGES (P2: wrap test counted rects, not lines) fixed by the lead (distinct line tops + no overflow) and re-run green. Screenshots `.claude/logs/screenshots/rgts-1b-*.png`. |
| 2A rules model: interfaces + config figures | pending | — | — |
| 2B rules model: full sections, items, prose | pending | — | — |
| 3 shared RulesGuide body + phone reduction | pending | — | — |
| 4 title 遊び方 sub-screen + short title copy | pending | — | — |
| 5 RulesDialog lifecycle | pending | — | — |
| 6A menu + lottery entry points, rulesOpen suspension | pending | — | — |
| 6B item-card 詳しく handoff + pointer visibility | pending | — | — |
| 7A save-status model + standalone popover | pending | — | — |
| 7B HUD integration + hit area + geometry | pending | — | — |
| 8A save-attempt identity | pending | — | — |
| 8B notice store, eligibility, announcement arbitration | pending | — | — |
| 9 toast queue notice entry + host announceability | pending | — | — |
| 10A notice hook + fixture seeding | pending | — | — |
| 10B visible notice delivery + live region | pending | — | — |
| 11 map modes + title camera | pending | — | — |
| 12A paint readiness + SVG placeholder + retry | pending | — | — |
| 12B navigation visibility + layout readiness waits | pending | — | — |
| 13 EditionApp loading / failure title paths | pending | — | — |
| 14 final integration + boundary audit | pending | — | — |

## Next

1A and 1B done; user reviewed 1B and asked to drop 「から」 from the resume label (follow-up commit 「1B-2」). Next Step 2A. The DESIGN.md decision rows (dated 2026-11-17) and the STATE.md block are recorded. Approved extras: the in-game shortcut hint is hidden on touch devices, and single-edition loading shows the title with 遊び方.

## How to resume

1. `git switch feature/rules-guide-title-save && git log --oneline -3`. The last done step's commit is the next
   `<BASE_SHA>`.
2. Read the next pending step in the plan. Fill the common body plus that step's block from the prompts file, then
   run Luna.
3. Verify: the step's acceptance commands, `verify_delegation.py`, the forbidden-path diff, and that existing test
   edits match the plan's table. Feature test files created in an earlier step of this feature may be extended
   later. Only baseline test files (present at a8fc2b7) are restricted to the deliberate-edit table.
4. Sol-low review. On REQUEST_CHANGES, fix or re-delegate once.
5. Commit, push, check CI. Update this table (status, commit, evidence), then stop for user review.

## Follow-ups (out of scope)

- `tests/unit/credits-screen.test.ts`: its Escape case clicks the first button (the disabled はじめから) and never
  proves Credits opened. This false positive predates the feature; fix it with a precise selector and a positive
  heading assertion.

- #67 first-run hints reuse `OpenRules(sectionId)` / `RulesSectionId`.
- #71 phone sheet: re-check the save-mark hit box and the rules dialog on the sheet layout.
