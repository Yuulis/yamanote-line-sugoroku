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

## Step 3 — first-play pure model, copy and storage

```
Implement plan "Step 3 — 初回判定・文言・storage の純粋モデル" exactly (Steps 1-2 are committed: 2d36dc3, 60fc239).
Apply "Revision 3 changes": the off-target hint is ONE sentence
「{target}以外の路線では、{target}に近づく向きが抽選で出やすくなっています。」 and is a candidate only when the published
landing is off the target line, two directions are possible, their distances to the target differ, and the resolved
config has towardTargetWeight > awayFromTargetWeight; otherwise no candidate (the id stays unseen). No other off-target
variants. All other copy exactly as in the plan's "Verified copy" table; Japanese copy goes through PhraseText where
rendered. Storage keys exactly yamanote-line-sugoroku:guide:{started,coach,hints-disabled,hint:<id>}:v1 with value "1",
every access in try/catch (no key contains "save"). Eligibility table must cover unknown/invalid save state and
storage-read failure as the plan specifies. Pure functions only plus the storage adapter and the rules-guide copy this
step lists; nothing is wired into the running UI yet except the rules copy changes the plan names.
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`, only the listed specs.
Acceptance: exactly the commands under Step 3 in the plan (with the worker limits above).
```

## Step 4 — queue reducer and session state hook

```
Implement plan "Step 4 — キュー reducer とセッション状態 hook" exactly (Steps 1-3 are committed; the latest is 62b7c2f).
Build on src/features/game/firstPlayGuide.ts and src/features/game/store/guide.ts from Step 3. Nothing is wired into the
running UI in this step (visible: no). Requirements from the plan's Revision 2 that must be covered by tests:
fixed same-turn order lottery -> off-target -> item -> harmful-item -> terminus; dedupe against current, queued, seen and
closed-this-session ids; candidates survive later turns; 「もう表示しない」 clears current and queued and disables all
hints in memory even when the storage write fails; acknowledgement bound to session + candidate key + display
generation, and late callbacks after withdraw / discard / disable / session change are rejected; the notice key and the
text chosen at selection time are kept together; StrictMode double effects and repeated renders do not duplicate.
Memory is limited: Vitest `--maxWorkers=2`.
Acceptance: exactly the commands under Step 4 in the plan (with the worker limit above).
```

## Step 5 — pre-start eligibility and test isolation seeds

```
Implement plan "Step 5 — セッション開始前の判定とテスト隔離" exactly (Steps 1-4 are committed; the latest is 3328396).
Use the Step 3 model (firstPlayGuide.ts, store/guide.ts) and the Step 4 hook (useFirstPlayGuide.ts). Eligibility is
decided in startNewGame BEFORE the new game's first auto-save and bound to the new sessionId; resume is never eligible;
`guide:started:v1` is written only after eligibility is fixed, and a failed write is remembered in memory for the rest of
this GameApp mount so a second new game in the same mount is not first-time again; StrictMode must not recompute it.
Nothing is rendered yet (the coach/hints come in later steps) — visible: no.
Test isolation: add an independent E2E fixture option `firstPlayGuideSeen` (default true) that seeds guide started +
coach + all hint keys via addInitScript, WITHOUT touching the #68 `firstTurnNoticeSeen` seed; add a separate unit helper
(e.g. seedFirstPlayGuide in tests/unit/helpers/) without side effects on the #68 helper. Existing suites must keep
passing unchanged in behaviour; #68 suites must still exercise unread -> shown -> announced -> persisted.
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`, only the listed specs.
Acceptance: exactly the commands under Step 5 in the plan (with the worker limits above).
```
