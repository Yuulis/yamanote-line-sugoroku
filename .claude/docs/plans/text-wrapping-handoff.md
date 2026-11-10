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
| 2 phone HUD budget | done | (this commit) | Luna xhigh 1998 s; 252px budget holds at 320x568. Deviation: no JSX modifier class (unit HTML-equality contract) — CSS keys off existing `data-stat`. Lead fixes: layout.ts 1px paint tolerance (Firefox glyph rects overhang the line box → step-1 CI failure on desktop-firefox), panel 45% check +1px like ui-pop/capital-region. Lead: firefox spec 3/3, chromium desktop+phone targeted 16/16; screenshots .claude/logs/screenshots/ttw-step2/; CI run 42744698139 green on 07e526f (all 4 E2E legs) |
| 3 PhraseText | done | (this commit) | Luna xhigh 512 s; `phraseBreakOffsets` + `PhraseText` (Intl.Segmenter grapheme guard); lead hand-checked all 15 expected offsets; typecheck ok, unit 15/15; Codex full vitest 1,993 passed |
| 4 HUD + LineBadge | done | (this commit) | First Luna run killed by session end (partial edits, empty report; CSS used wrong `text-wrap: auto-phrase`); resumed run fixed it to `word-break: auto-phrase` (272 s). Lottery reveal name stays nowrap ellipsis (`.lottery-reveal .line-badge__name`). Codex: vitest 1,995 passed, chromium 14 + firefox 2 E2E. Lead: typecheck ok, unit 52/52, phone HUD E2E 2/2; CI run 42755060413 green on 06b4733 (all 4 E2E legs; also covers step 3, whose run was cancelled by the newer push) |
| 5 dialogs + clear screen | done | (this commit) | Luna xhigh 1457 s. Lead fixes: removed out-of-plan nowrap on `.game-panel__legend-operator label` (every legend line name; long names would overflow at 320px); layout.ts stops ancestor clipping at top-layer elements (`:modal, :popover-open`) so 1280px modal buttons use `expectSingleLine` instead of Codex's nowrap-only workaround. Lead: typecheck ok, unit 102/102, chromium desktop+phone 14/14 (incl. legend/adjust regressions), firefox spec 5/5. `ticket card opens` grep in the plan matches no test title |
| 6 GamePanel + clear screen | done | (this commit) | Luna xhigh 1230 s. Scope addition (user 2026-11-10): clear-screen summary + history get PhraseText; the goal-turn sentence comes from `ItemEventNotice` (live region) so it gets phrase CSS only. Codex: vitest 1,995 passed, chromium 4 + 6 regression, firefox 2. Lead: typecheck ok, full spec chromium desktop+phone 12/12, firefox 6/6 |
| 7 longest real data + fallback | pending | | |
| 8 regression + release note | pending | | |

## Next

Justify experiment done 2026-11-10: rejected by the user (left-aligned stays; DESIGN.md row; evidence .claude/logs/justify-experiment/report.md, screenshots .claude/logs/screenshots/ttw-justify/). Next: Step 7 (longest real data + fallback) — user approved.
