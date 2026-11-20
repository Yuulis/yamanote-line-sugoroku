# First-play guide (#67) + remove おまかせ (#113) — Step prompts

Shared preamble for every implementation step (prepend to each step prompt):

```
You are implementing one step of an approved plan in /home/yuulis/yamanote-line-sugoroku (branch feature/first-play-guide).
Read first: .claude/docs/plans/first-play-guide-plan.md (the whole "Revision 3 changes", "Verified copy" and your step section),
.claude/docs/research/feature-first-play-guide-brief.md, and .claude/rules/{coding-principles,testing}.md.
Rules:
- Implement ONLY the named step. Do not start later steps. Do not commit, push or touch git history.
- Presentation only: do not change engine/, RNG, save format, src/types/network.ts, public/, data/, package.json/lock.
- Do not delete, skip or weaken tests except where the step explicitly removes the おまかせ feature; port every behaviour the plan says to keep.
- No placeholders, TODOs, swallowed errors or hard-coded shortcuts.
- Run the step's acceptance commands yourself and report the exact results (counts). Local E2E: only the listed specs, --workers=2.
Output format:
## Changes Made (file: summary)
## Tests (added / updated / removed, with the porting table when tests are removed)
## Validation Results (each command + result)
## Deviations from the plan (with reason)
## Remaining Risks
```

## Step 1 — remove おまかせ (#113)

```
Implement plan "Step 1 — おまかせを完全に削除する（#113）".
Before deleting any auto-roll test file, write a case-porting table into your report: for every test case in the removed
unit/E2E files, classify it as (a) おまかせ-only, dropped; (b) ported, with the destination test name; or (c) already covered
elsewhere, with the covering test name. Ported cases must cover at least: manual same-ready double-submit guard (click and
keyboard), non-ready key not consumed, roll-adjust draft applied, a changed decision revision re-enables a roll on the same
turn, a single status owner while adjust/discard dialogs are open, and normal announcements never crossing the reveal
boundary. The #68 first-turn-notice cases that used auto-roll are rewritten with manual turns only (no hint dependency).
Old settings JSON containing an autoRoll-like field must still load (keep/extend the settings test).
The HUD action row becomes dice + skip (skip label is NOT renamed in this step; that is Step 2), phone 2 equal columns,
56px height kept, HUD 252px budget at 320x568 kept.
Acceptance commands: exactly those listed under Step 1 in the plan (typecheck, vitest, build, the listed E2E with
--project=desktop-chromium --workers=2 and the phone @layout grep).
```

## Step 2 — skip labels and the roll-adjustment dialog

```
Implement plan "Step 2 — スキップ表記と出目調整画面を整える" exactly (Step 1, the おまかせ removal, is committed: 2d36dc3).
Both skip buttons (HUD and RollAdjustment) read 「演出をスキップ」; the HUD skip keeps its native disabled state when idle;
the dialog keeps its skip, visually separated from 「そのまま続ける」. Split the Escape sentence from
「出目を見た後はターンを取り消せません。」 and show it only under (pointer: fine). Menu/rules copy follows the new name
(see the plan's Verified copy rows skip-label, skip-help, shortcut-help, adjustment-escape, adjustment-caution).
Update exact-text lookups in existing tests to the new label instead of loosening them. Phone 2-column action row,
56px height and HUD 252px at 320x568 stay; the longer label must fit (the plan allows PhraseText wrapping; no smaller font).
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`, only the listed specs.
Acceptance: exactly the commands under Step 2 in the plan (with the worker limits above).
```
