# Text Wrapping and HUD Readability (issue #70) — Handoff

Resume from here. Plan: `.claude/docs/plans/text-wrapping-plan.md` (Revision 3 lean section overrides §3). Brief: `.claude/docs/research/feature-text-wrapping-readability-brief.md`. Scan: `.claude/docs/research/feature-text-wrapping-readability-codebase.md`. Step prompts: `.claude/docs/plans/text-wrapping-prompts.md`.

- Branch: `feature/text-wrapping` (from develop a375384, v0.13.0); no upstream yet.
- Pacing: stop after every step for user review (user 2026-11-10).
- Implementer: Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --timeout 2400`); reviews Sol low; lead verifies, commits, pushes, checks CI.
- Local E2E: targeted specs only, `--workers=2`; full 4-project matrix in CI.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1 layout helper | done | (this commit) | Luna xhigh 715 s; lead: typecheck ok, `layout measurement` 1/1 desktop-chromium |
| 2 phone HUD budget | done | (this commit) | Luna xhigh 1998 s; 252px budget holds at 320x568. Deviation: no JSX modifier class (unit HTML-equality contract) — CSS keys off existing `data-stat`. Lead fixes: layout.ts 1px paint tolerance (Firefox glyph rects overhang the line box → step-1 CI failure on desktop-firefox), panel 45% check +1px like ui-pop/capital-region. Lead: firefox spec 3/3, chromium desktop+phone targeted 16/16; screenshots .claude/logs/screenshots/ttw-step2/ |
| 3 PhraseText | pending | | |
| 4 HUD + LineBadge | pending | | |
| 5 dialogs + clear screen | pending | | |
| 6 GamePanel | pending | | |
| 7 longest real data + fallback | pending | | |
| 8 regression + release note | pending | | |

## Next

Step 3 (PhraseText, unit TDD) — wait for user go-ahead.
