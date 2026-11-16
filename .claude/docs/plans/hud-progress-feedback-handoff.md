# HUD Progress Feedback (issue #65) — Handoff

Resume from here. Plan: `.claude/docs/plans/hud-progress-feedback-plan.md` (Codex validation NEEDS_REVISION, five
revisions applied by the lead; **approved by the user 2026-11-15**, defaults unchanged). Brief:
`.claude/docs/research/feature-hud-progress-feedback-brief.md` (validate_doc feature-brief ok). Scan:
`.claude/docs/research/feature-hud-progress-feedback-codebase.md`. Step prompts:
`.claude/docs/plans/hud-progress-feedback-impl-prompts.md`. Codex consults (Sol, low, read-only): scope
`.claude/logs/codex/20261115T110512Z-hud65-scope.md` (COMPLEX), design `.claude/logs/codex/20261115T111604Z-hud65-design.md`,
validation `.claude/logs/codex/20261115T112140Z-hud65-validate.md` (NEEDS_REVISION → applied, no second round).

- Branch: `feature/hud-progress-feedback` — created from develop `05cace4` on 2026-11-15; planning docs `fd49772`. Flow: feature → PR → develop → PR → master.
- Pacing: **pause after every step** (user 2026-11-15): verify → commit → push → CI → handoff → report, then wait.
- Implementer (user-confirmed): Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config
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
| 1 | Proximity model | done | `ff204ca` | unit 4/4, full vitest 2166 pass, typecheck ok; verify_delegation actionable 0; Sol-low review APPROVE (`.claude/logs/codex/hud65-s1-review.json`) |
| 2 | Collection model | done | `9de1b0b` | unit 5/5, full vitest 2171 pass, typecheck ok; verify_delegation actionable 0; Sol-low review APPROVE (`.claude/logs/codex/hud65-s2-review.json`) |
| 3 | Gated A+C publication | done | `7dcefa8` | unit 42/42 (publication + turn-moment), full vitest pass, typecheck ok; verify_delegation actionable 0; Sol-low review REQUEST_CHANGES (2×P2 test gaps: A timing, pending-only discard) → one Luna test follow-up → re-review APPROVE (`.claude/logs/codex/hud65-s3-review2.json`); test file ~193 lines (cap waived for the reveal-boundary tests) |
| 4 | Crossings + toast builder | done | `6b899f7` | unit 70/70 (milestones + toast), full vitest 2184 pass, typecheck ok; verify_delegation actionable 0; Sol-low review APPROVE (`.claude/logs/codex/hud65-s4-review.json`); note: thresholds absolute, copy assumes 30 required (per D9/D11) |
| 5 | Milestone publication (stateless; once-only dropped by user) | done | `88f928f` | full vitest 2195 pass, typecheck + build ok, existing tests byte-identical. Attempts: Luna ×3 failed (S16 re-announcement; Sol 3×P2 on consumed keys; simplified rule still dropped suffix at lottery) → user: simplify, then escalate → Fable landed stateless rule (`.claude/docs/reviews/hud65-step5-fable.md`). Deviations from plan: toast only at arrival or card-less published; no historical <30 toasts (resume via entryTurn). Final Sol-low review REQUEST_CHANGES 1×P2 (re-read after item select/unselect in card-less published) → user accepted, filed #96 together with arrival→Skip repeat |
| 6 | Progress-bar flash | done | `c3b7e4b` | full vitest 2197 pass, build ok; verify_delegation actionable 0; Sol-low review APPROVE (`.claude/logs/codex/hud65-s6-review.json`). Lead fixes on top: GamePanel wires `turnDisplay.milestoneFlash` (step file list omitted it); flash rests at opacity 0 after its one-shot animation; reduced motion = display none |
| 7 | Desktop A+C row | done | `d9f6afb` | full vitest 2199 pass, build ok; E2E desktop row + 2 desktop no-scroll gates pass, text-wrapping @layout phone 8/8; Sol-low REQUEST_CHANGES 1×P2 (aria-label on generic div) → lead removed it. Measured populated (worst-case) panel: 1280x800 fits; at 1024/1366x768 base already overflowed 7px, now 23px; 1280x720 base 55px, now 71px. Screenshot `.claude/logs/screenshots/hud65-s7-desktop-panel.png` |
| 7b | Hide in-game title (user 2026-11-16) | done | `8e00a1d` | resumed from partial edits; full vitest 2199 pass, build ok; desktop E2E (hud-progress, accessibility, layout) 33/33, phone @layout 80 pass/5 skip, real-data start 2/2; populated panel scrollHeight/clientHeight: 1280x800 680/680, 1366x768 648/648, 1024x768 648/648, 1280x720 634/600 (34px, measure-only). Phone title was already hidden → phone budget 252 unchanged. Sol-low APPROVE (2×P3) → lead limited station padding to desktop. real-data.spec subtitle expectation updated visible/hidden → visually hidden everywhere. Screenshots `.claude/logs/screenshots/hud65-s7b-*.png`. CI on `73ec8cc` failed `ui-pop.spec.ts:293` light-dismiss (clicked the now-hidden heading under the save mark) → click target moved to the first stats `dt` in `85b4afa`; ui-pop.spec desktop+phone 23 pass/4 skip |
| 8 | Clear-screen counters | done | `39f48ec` | full vitest 2200 pass, build ok; E2E desktop full-game+text-wrapping+layout+accessibility 41 pass/1 skip, phone @layout (text-wrapping, layout, full-game) 11 pass/1 skip; Sol-low APPROVE; lead made `collection` an optional prop (dropped a compat union type); share text unchanged. Screenshots `.claude/logs/screenshots/hud65-s8-clear-*.png` |
| 9 | Phone A cell + short-landscape A+C | done | `df6fc2d` | full vitest 2200 pass, build ok; phone @layout (hud-progress, text-wrapping, hud-layout, layout, turn-result-card, ui-pop) 42 pass/4 skip; desktop (hud-progress, hud-layout, turn-result-card) 28 pass; phone cell 34px 2×17px at 320x568 (139px wide) and 412x839; dice rect unchanged ≤1px; short landscape stats 3×18px, log A+C row 24px; Sol-low APPROVE. Screenshots `.claude/logs/screenshots/hud65-s9-*.png`. CI on `974d8a7` failed `accessibility.spec.ts:603` landscape 667x375 (log-top progress row pushed the lottery line 23px past the panel edge) → row moved to the END of the log in `39dd93e` (deviation from D17 'top'); accessibility + hud-progress specs desktop+phone 43/43 |
| 10 | Embedded disclosure mode | pending | — | — |
| 11 | Phone hamburger wrapper (unmounted) | pending | — | — |
| 12 | Layout-aware E2E helpers | pending | — | — |
| 13 | Phone surface + pill integration | pending | — | — |
| 14 | Final acceptance | pending | — | — |

## Notes

- Local `uv run pytest tests/data_pipeline` shows 4 failed + 5 errors (`StageError: handoff is incomplete`) on 2026-11-15; branch has no Python/data change and CI Data pipeline is green → local environment issue, not investigated.
- Step 5 consumed-key / once-only announcement is out of scope → #96.
- Step 5 CI (`f2b6b16`) failed E2E `S15 … adds the discard toast without replay`: the discard fixture turn crosses 20, so the milestone toast takes one of the 2 ordinary toast slots and the discard toast waits ~4 s. User (2026-11-16) accepted the delay; test updated in `56ae830` (item-toast assertions scoped; milestone expiry then discard toast, pickup not replayed). Local: whole `ui-pop-turn-moments.spec.ts` 50/50 desktop-chromium.

## Next

1. Step 10 (Embedded disclosure mode): build the prompt from the impl-prompts doc (Common body + Step 10 block, `<BASE_SHA>` =
   branch HEAD), run Luna xhigh, Sol-low review, lead verification commands, commit, push, check CI, update this table.
2. After merge: DESIGN.md decision rows for D1-D22 via `update_design.py` (three summary rows already recorded 2026-11-15).
