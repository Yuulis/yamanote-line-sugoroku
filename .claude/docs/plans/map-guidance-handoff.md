# Map Guidance and Direction (issue #62) — Handoff

Resume from here. Plan: `.claude/docs/plans/map-guidance-plan.md` (Codex validated PASS after one Step 5 revision; approved by the user 2026-11-10). Brief: `.claude/docs/research/feature-map-guidance-and-direction-brief.md`. Scan: `.claude/docs/research/feature-map-guidance-and-direction-codebase.md`. Step prompts: `.claude/docs/plans/map-guidance-prompts.md`. DESIGN.md rows dated 2026-11-10 (#62).

- Branch: `feature/map-guidance` (from origin/develop 33ff82c); no upstream yet.
- Pacing: stop after every step for user review (user 2026-11-10).
- Implementer: Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --timeout 2400`); reviews Sol low; lead verifies, commits, pushes, checks CI.
- Local E2E: targeted specs only, `--workers=2`; full 4-project matrix in CI.
- Accepted consequences: old in-progress saves are rejected (dataVersion change); `product_suburban verify` S4 pins are superseded, not edited.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1 labels + validator | in progress | | |
| 2 saves + classic fixture | pending | | |
| 3 guidance model | pending | | |
| 4 pending emphasis + heading | pending | | |
| 5 HUD guidance + goal ring | pending | | |
| 6 30/30 milestone toast | pending | | |
| 7 adjustment landing model | pending | | |
| 8 modal strip + named choices | pending | | |
| 9 speech bubbles | pending | | |
| 10 preview camera | pending | | |
| 11 browser integration | pending | | |
| 12 docs + final acceptance | pending | | |

## Next

Step 1.
