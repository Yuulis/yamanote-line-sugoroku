# HUD Progress Feedback (issue #65) — Handoff

Resume from here. Plan: `.claude/docs/plans/hud-progress-feedback-plan.md` (Codex validation NEEDS_REVISION, five
revisions applied by the lead, 2026-11-15; **awaiting user approval**). Brief:
`.claude/docs/research/feature-hud-progress-feedback-brief.md` (validate_doc feature-brief ok). Scan:
`.claude/docs/research/feature-hud-progress-feedback-codebase.md`. Step prompts:
`.claude/docs/plans/hud-progress-feedback-impl-prompts.md`. Codex consults (Sol, low, read-only): scope
`.claude/logs/codex/20261115T110512Z-hud65-scope.md` (COMPLEX), design `.claude/logs/codex/20261115T111604Z-hud65-design.md`,
validation `.claude/logs/codex/20261115T112140Z-hud65-validate.md` (NEEDS_REVISION → applied, no second round).

- Branch: `feature/hud-progress-feedback` — **to be created from develop** (`05cace4` at planning time); no upstream
  yet. Flow: feature → PR → develop → PR → master.
- Pacing: to be confirmed by the user at approval (#66 paused after every step).
- Implementer (proposed): Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config
  model_reasoning_effort=xhigh --timeout 2400`); reviews Sol low; lead verifies, commits, pushes, checks CI after every push.
- Local E2E: targeted titles only, `--workers=2`; full matrix in CI (feature push = desktop-chromium; PR = full matrix;
  phone runs `@layout` only).
- Hard constraints: presentation only (no engine/RNG/save/`src/types/network.ts`/share text/public/data edits);
  existing test files byte-identical except the seven listed in the plan ("Affected existing tests", Steps 12-13);
  budget tests unchanged (phone 252px, rows 18/34/34/18, short landscape 3×18px, desktop no-scroll).

## Decisions

User decisions 2026-11-15 (binding): brief "User Decisions" 1-7. Design decisions D1-D22: plan "Decisions". Open items
awaiting user confirmation: plan "Open items" 1-10 (deadhead counting, short-landscape placement, 10-11px desktop
counters, legend-ON interpretation, #62 residual fix via the once-only announcement, size/pacing).

## Step status

| Step | Unit | Status | Commit | Evidence |
|---|---|---|---|---|
| 1 | Proximity model | pending | — | — |
| 2 | Collection model | pending | — | — |
| 3 | Gated A+C publication | pending | — | — |
| 4 | Crossings + toast builder | pending | — | — |
| 5 | Milestone publication + once-only announcement | pending | — | — |
| 6 | Progress-bar flash | pending | — | — |
| 7 | Desktop A+C row | pending | — | — |
| 8 | Clear-screen counters | pending | — | — |
| 9 | Phone A cell + short-landscape A+C | pending | — | — |
| 10 | Embedded disclosure mode | pending | — | — |
| 11 | Phone hamburger wrapper (unmounted) | pending | — | — |
| 12 | Layout-aware E2E helpers | pending | — | — |
| 13 | Phone surface + pill integration | pending | — | — |
| 14 | Final acceptance | pending | — | — |

## Next

1. Present the plan and open items to the user; record approval (and any changed defaults) in the plan and here.
2. `git switch develop && git pull && git switch -c feature/hud-progress-feedback`.
3. Step 1: build the prompt from the impl-prompts doc (Common body + Step 1 block, `<BASE_SHA>` = branch HEAD), run
   Luna, Sol-low review, lead verification commands, commit, update this table.
4. After merge: DESIGN.md decision rows for D1-D22 via `update_design.py` (not yet drafted).
