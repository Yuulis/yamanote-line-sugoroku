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
