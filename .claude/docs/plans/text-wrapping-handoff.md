# Text Wrapping and HUD Readability (issue #70) — Handoff

Resume from here. Plan: `.claude/docs/plans/text-wrapping-plan.md` (Revision 3 lean section overrides §3). Brief: `.claude/docs/research/feature-text-wrapping-readability-brief.md`. Scan: `.claude/docs/research/feature-text-wrapping-readability-codebase.md`. Step prompts: `.claude/docs/plans/text-wrapping-prompts.md`.

- Branch: `feature/text-wrapping` (from develop a375384, v0.13.0); no upstream yet.
- Pacing: stop after every step for user review (user 2026-11-10).
- Implementer: Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --timeout 2400`); reviews Sol low; lead verifies, commits, pushes, checks CI.
- Local E2E: targeted specs only, `--workers=2`; full 4-project matrix in CI.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1 layout helper | pending | | |
| 2 phone HUD budget | pending | | |
| 3 PhraseText | pending | | |
| 4 HUD + LineBadge | pending | | |
| 5 dialogs + clear screen | pending | | |
| 6 GamePanel | pending | | |
| 7 longest real data + fallback | pending | | |
| 8 regression + release note | pending | | |

## Next

Step 1.
