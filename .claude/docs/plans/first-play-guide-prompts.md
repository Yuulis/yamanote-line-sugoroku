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

## Step 6 — coach dialog and placement model

```
Implement plan "Step 6 — コーチの dialog と配置モデル" exactly (Steps 1-5 are committed; the latest is c98296c).
Build the coach as a standalone component (native modal <dialog>, transparent full-screen, a non-interactive highlight
frame and an interactive bubble) plus a pure placement function that clamps the bubble into the viewport from a target
rect and handles a missing / zero-size target by centring. Steps: dice -> progress -> map (copy from the Step 3 model:
buildCoachSteps / the coach-* copy), buttons 前へ / 次へ / とばす and はじめる on the last step; 前へ hidden or disabled
on step 1 per the plan; Escape (dialog cancel) is preventDefault-ed and never closes, advances or skips the game;
focus enters the bubble on open and is restored by the caller-provided callback on close; text fallback for step 3
when the map target is unavailable (WebGL failure). Japanese copy through PhraseText. Not wired into GameApp/GamePanel
yet (visible: no). Unit-test the placement function (all four sides, clamping at 320x568 and short landscape, missing
target) and the component (navigation, Escape, focus, fallback).
Memory is limited: Vitest `--maxWorkers=2`.
Acceptance: exactly the commands under Step 6 in the plan (with the worker limit above).
```

## Step 7 — wire the coach and block input

```
Implement plan "Step 7 — 初回コーチを接続し、入力をブロックする" exactly (Steps 1-6 are committed; the latest is a1613fc).
Wire FirstPlayCoach (Step 6) into the game for an eligible session (Step 5 eligibility): it opens on the first render of
that session, registers as an open surface at render time so dice click, Space/Enter, S/Escape, map-tap skip and the
#68 notice/ToastHost are suppressed until it closes; the coach-seen flag is written only after the coach was actually
shown; とばす / はじめる close it and restore focus to the dice (or the plan's fallback order). Targets: dice button,
the 踏破区間 progress bar, the map area (text fallback when the map/WebGL is unavailable). Resume never shows it.
E2E (new spec, `firstPlayGuideSeen: false` and `firstTurnNoticeSeen: false` explicitly): 3 steps with 前へ/次へ/とばす/
はじめる, input blocked while open (click + each shortcut), Tab / Shift+Tab never leave the open coach (Step 6 review),
focus restored on close, not shown on resume or for a browser with an existing save, coach not shown again after
reload, the #68 notice appears only after the coach closes. Tag phone geometry checks @layout (320x568 and 667x375:
bubble and buttons inside the viewport, HUD 252px unchanged).
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`, only the listed specs.
Acceptance: exactly the commands under Step 7 in the plan (with the worker limits above), including the new spec on
desktop-chromium and its @layout cases on phone-chromium.
```

## Step 8 — replay the coach from 遊び方

```
Implement plan "Step 8 — 遊び方からコーチを再表示する" exactly (Steps 1-7 are committed; the latest is 905ef6c).
Add 「最初のガイドをもう一度見る」 to the in-game 遊び方 (RulesGuide / RulesDialog) that closes the rules dialog and opens
the coach in the same commit, for any player (eligible or not), without camera movement. The rules dialog's deferred
focus restore must not steal focus from the coach. Re-show is refused (button disabled or no-op, checked both at render
and inside the handler) while a pending decision (roll adjustment, discard), item-use dialog, confirmation, or a
playing turn moment exists; a mandatory decision that appears behind the rules dialog wins over the replay. Closing a
replayed coach restores focus to the dice (or the plan's fallback). Replay does not touch first-play eligibility, hints
or the coach-seen flag semantics beyond what the plan says. The title-screen 遊び方 sub-screen: follow the plan (show or
omit the button there exactly as specified).
Tests: unit (RulesGuide button, handler guards, rules->coach handoff and focus) and E2E in first-play-coach.spec.ts
(replay from the menu's 遊び方, guards, focus); @layout for phone if the button changes layout.
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`, only the listed specs.
Acceptance: exactly the commands under Step 8 in the plan (with the worker limits above).
```

## Step 9 — published hint candidates

```
Implement plan "Step 9 — 公開済みヒント候補を生成する" exactly (Steps 1-8 are committed; the latest is f6958fb).
Add `guideCandidates` to TurnMomentDisplay from deriveTurnMomentDisplay only (no UI reads raw lastMove/itemRecord):
every candidate publishes at resultPublished (end of pickup; DESIGN row 244 — NOT lotteryPublished), keyed
`${sessionId}:${turn}:${id}`, turn > entryTurn so resumed turns never produce candidates, while presentation level
なし / reduced motion / skip still produce them once published. Use the Step 3 builders for the lottery variants (by the
actual draw kind, after detour/suspension filtering), the Revision 3 off-target condition (one sentence; no candidate
when it does not apply), item / pending-discard, harmful / certificate-cancelled, terminus (stopReason endpoint,
endpointKind terminus, unusedPips > 0; never area or service boundaries). Nothing renders yet (visible: no).
Tests in turn-moment presentation / first-play-guide unit suites: pickup in progress -> no candidates even though the
lottery is visible; fixed same-turn order; resume; skip / なし / reduced motion; each event and each excluded case.
Memory is limited: Vitest `--maxWorkers=2`.
Acceptance: exactly the commands under Step 9 in the plan (with the worker limit above).
```

## Step 10 — hint card and announcement arbitration

```
Implement plan "Step 10 — ヒントカードと汎用読み上げ調停" exactly (Steps 1-9 are committed; the latest is the Step 9 commit).
Build FirstPlayHint as a persistent non-modal card component (a sibling of ToastHost, never inside the aria-hidden host,
never steals focus; buttons 閉じる / もう表示しない / 詳しく; Japanese copy via PhraseText) and generalise
selectAnnouncement in saveNotice.ts so a notice carries its key together with the text chosen at selection time, with
the existing #68 behaviour unchanged (ordinary turn summary first, then #68, then the current hint; re-insert/double
read prevention as today). decisionOwned must include the local itemDialogOpen and the coach. Acknowledgement follows the
Step 4 contract (session + key + display generation; stale acks rejected). Not wired into the running game in this step
unless the plan's Step 10 says so (visible per the plan).
Tests: component (buttons, no focus steal, keyboard S/Escape inside the card do not trigger game skip, Space/Enter
activate the card buttons), selectAnnouncement table (#68 -> hint handover, stale ack, item dialog ownership, StrictMode).
Memory is limited: Vitest `--maxWorkers=2`.
Acceptance: exactly the commands under Step 10 in the plan (with the worker limit above).
```

## Step 11 — wire hints: display, 詳しく, seen

```
Implement plan "Step 11 — ヒントの表示・詳細・既読を接続する" exactly (Steps 1-10 are committed; the latest is cf728c8).
Connect Step 9 candidates -> Step 4 hook/queue -> Step 10 FirstPlayHint + announcement for eligible sessions only. One card
at a time in the fixed order; the card stays until 閉じる / もう表示しない; seen is persisted only after visible display
AND status announcement of the same generation; 「もう表示しない」 clears current + queued and persists disabled (memory
survives a failed write); 詳しく opens openRules(sectionId, opener) without closing the card, and on rules close the card
is restored and focus returns to the 詳しく button. The card is withdrawn (state kept, no ack) while a modal decision
(adjust, discard, item-use, confirmation), rules, the coach, a playing turn moment that overlaps it, or a hidden tab is
active, and restored afterwards with a new generation (no re-announce/re-persist of an acknowledged hint). showClear
discards the queue and pending announcements without marking anything seen. Placement: outside the HUD, not covering the
#66 phone pill, map controls or TurnMomentHost; phone HUD 252px at 320x568 unchanged.
E2E (new spec or extend first-play-coach.spec.ts; `firstPlayGuideSeen: false` with the coach closed first): first
lottery / item / harmful / terminus hints appear after the pickup boundary in order; 閉じる advances; もう表示しない stops
all hints across reload; 詳しく opens the right rules section and returns; Space and Enter on each focused card button
activate it exactly once (Step 10 review); a roll-adjust dialog over a visible card withdraws and restores it; goal ->
ClearScreen with a queued hint does not mark it seen; resume shows no hints; existing players see none. @layout for phone
(320x568, 390x844, 667x375): card inside the viewport, no overlap with the #66 pill / HUD / map controls.
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`, only the listed specs.
Acceptance: exactly the commands under Step 11 in the plan (with the worker limits above), including the new/extended
spec on desktop-chromium and its @layout cases on phone-chromium.
```

## Step 12 — compact viewports and presentation-path integration

```
Implement plan "Step 12 — コンパクト画面と演出経路の統合検証" exactly (Steps 1-11 are committed; the latest is c697fd8).
This is mainly an integration-test step: add the cross-feature E2E cases the plan lists (and the Revision 2 additions:
a visible hint followed by the next turn's roll-adjust dialog; goal -> ClearScreen with a visible and a queued hint;
a pending decision appearing behind the rules dialog opened from 詳しく; coach replay vs a visible hint) on
desktop-chromium, and the compact-viewport @layout cases on phone-chromium (320x568, 390x844, 667x375, 601x501): coach
bubble and hint card inside the viewport, no overlap with the HUD / #66 pill / map controls / TurnMomentHost, HUD <= 252px
at 320x568, the action row 2 equal columns with 「演出をスキップ」 fitting, the Escape hint hidden on coarse pointers.
Cover presentation level すべて / 重要なときだけ / なし, reduced motion and skip for the coach and the hints.
Fix product code only for real bugs these tests expose (red-first, say so). Do not loosen existing assertions.
Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=1`; never run the whole E2E suite.
Acceptance: exactly the commands under Step 12 in the plan (with the worker limits above). When a step adds or touches
HUD/panel controls, also run tests/e2e/ui-pop.spec.ts and tests/e2e/accessibility.spec.ts in full on desktop-chromium.
```

## Step 13 — acceptance record and final checks

```
Implement plan "Step 13 — 決定記録と最終受入を完了する" (Steps 1-12 are committed; the latest is ca738df), EXCEPT the
DESIGN.md update, which the lead does separately — do not edit .claude/docs/DESIGN.md.
1. Fill the plan's retained-contract table with the ACTUAL test file + test name (+ the key assertion) for every row:
   DESIGN row 244, 262, 272, #60, #68, #113, first-play eligibility/cancel. Write it as a new section
   "## Step 13 acceptance record" at the end of .claude/docs/plans/first-play-guide-handoff.md (keep everything else).
   If a row has no real covering assertion, add the minimal regression assertion in the owning spec (say which), never
   loosen anything.
2. Run `rg -n 'useAutoRoll|autoRoll|おまかせ' src tests docs/manual` and classify every hit (product code must have none;
   allowed: absence assertions, the legacy-setting compatibility test, release notes/history docs). Record the result.
3. Sync user-facing docs only where they describe changed behaviour: docs/manual (Japanese) — the skip label is already
   done in Step 2; mention the first-play coach/hints and the removal of おまかせ only if the manual describes the play
   controls at that level. No product behaviour changes in this step.
4. Run the acceptance commands under Step 13 in the plan (Playwright `--workers=1` because of memory) plus
   npm run typecheck, npx vitest run --maxWorkers=2, npm run build. Record results with counts in the acceptance record.
```
