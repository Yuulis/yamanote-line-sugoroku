# Turn-Result Card (issue #66) — Handoff

Resume from here. Plan: `.claude/docs/plans/turn-result-card-plan.md` (Codex validated PASS after one revision, 2026-11-12; Revision 2
phone slimming re-validated by Codex PASS; Revision 3 roll wording (no modifier marks) 2026-11-12; **approved by the user 2026-11-12**). Brief: `.claude/docs/research/feature-turn-result-card-brief.md`. Scan:
`.claude/docs/research/feature-turn-result-card-codebase.md`. Step prompts: `.claude/docs/plans/turn-result-card-prompts.md`.
Codex consults: scope `.claude/logs/codex/20261112T072202Z-turn-result-card-scope.md`, architecture
`.claude/logs/codex/20261112T072821Z-turn-result-card-arch.md`, plan `.claude/logs/codex/20261112T073147Z-turn-result-card-plan.md`,
validation `.claude/logs/codex/20261112T073626Z-turn-result-card-validate.md` (NEEDS_REVISION) → `.claude/logs/codex/20261112T074010Z-turn-result-card-revalidate.md` (PASS) → Revision 2 `.claude/logs/codex/20261112T075926Z-turn-result-card-revalidate2.md` (PASS). DESIGN.md input (not yet applied): `.claude/logs/design-input-turn-result-card.json`
(11 decision rows dated 2026-11-12; apply with `python3 .claude/skills/_shared/update_design.py --input .claude/logs/design-input-turn-result-card.json --apply`).

- Branch: `feature/turn-result-card` (from develop 4174377); no upstream yet. Flow: feature → PR → develop → PR → master.
- Pacing: stop after every step for user review (user 2026-11-12).
- Implementer: Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --timeout 2400`); reviews Sol low; lead verifies, commits, pushes, checks CI after every push.
- Local E2E: targeted specs only, `--workers=2`; full 4-project matrix in CI (working-branch push runs desktop-chromium only; PR runs the full matrix; phone runs `@layout` only).
- Hard constraints: presentation only (no engine/RNG/save/`src/types/network.ts`/public/data edits); existing test files byte-identical; `.turn-result*` classes; phone panel budget 252px / 255.6px at 320x568 and desktop no-scroll at 1280x800 unchanged.

## Decisions (user 2026-11-12, binding)

1. Desktop: 2-line card + chips under the dice; 「前のターン（Nターン目）」 / 「出目3 → 半蔵門」 / 「抽選: 半蔵門線・渋谷方面」 or 「乗車: …」 without a draw; chips +N区間, 乗換, picked item, triggered effect; fixed panel height; ~48px reserve for #65 (slot only).
2. Phone (Revision 2): small content-width pill at the bottom-left of the map, fixed sibling above `.game-panel`, no panel
   budget, tap opens and reveals the log. Content only 「3 → 半蔵門 +1区間」 (face, station, +N区間 when N ≥ 1); no ride,
   乗換, item chips or modifier wording.
3. Pill visible during moments; TurnMomentHost and roll-adjust preview avoid it; position measured, no 45% literal.
4. Pill max-width always leaves the overview column free (right inset 84px + 8px gutter + safe area); no collision
   narrowing; long station names ellipsize inside the station segment.
5. Short landscape: one compact line (same content as the pill) under the dice inside the panel (user confirmed 2026-11-12);
   the pill has no visible 「前のターン」 label (accessible name only).
5a. Phone HUD hides 出目 (`roll-compact`) by CSS only; freed cells stay empty; 252px budget unchanged; other phone
   trimming is #71. Desktop/tablet and short landscape keep 出目.
6. Turn 0: hidden.
7. Reveal gating like #62 (`lotteryPublished ? current : previousLastMove`; item chips at `resultPublished`, own turn only); immediate under なし/Skip/resume/auto-roll; classic fallback.
8. 「Nターン目」 wording; no 10-turn history; presentation only.
9. 出目 = effective face with **no modifier marks** (Revision 3): 「出目N → 駅」, 「回送 → 駅」 for deadhead; modifiers only via chips
   (快速券/倍速券/回送列車 `consumed`, 「出目調整 +1/-1」 from `adjustment.delta`, 遅延/寝過ごし `effect-activated`); +N区間 by history
   replay (resume-safe). Details in the plan.
10. Existing tests unmodified; new `.turn-result*` classes.
11. Pause after every step; Luna xhigh / Sol low / lead verifies; targeted local E2E.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1 model contracts + roll/ride wording | done, committed | 8b3d119 (base 4174377) | Luna `.claude/logs/codex/20261112T080801Z-turn-result-card-s1.md`; Sol low APPROVE, no findings `.claude/logs/codex/20261112T081640Z-turn-result-card-s1-review.md`; lead: typecheck 0, new file 17/17, `npx vitest run` 82 files 2054 passed + 1 skipped (baseline 81 / 2037 + 1), build 0; verify_delegation no weakened tests / out-of-scope (5 placeholder hits = 'TODO' prose in untracked .claude docs only); tracked diff empty |
| 2 history replay (+N区間, 乗換) | done, committed | d34c657 (base 8b3d119) | Luna `.claude/logs/codex/20261112T082450Z-turn-result-card-s2.md` (replay + normalization, no chip builders); Sol low REQUEST_CHANGES (2×P2: missing `segments`/`transfer` chip builders, missing resume/order tests; P3: local pending type) `.claude/logs/codex/20261112T083207Z-turn-result-card-s2-review.md` → fixed by lead direct edit (`turnResultHistoryChips`, `DeepReadonly<PendingItemTurn>`, engine-derived pending-discard and summarizeGame cross-check tests); lead: typecheck 0, file 25/25, `npx vitest run` 82 files 2062 passed + 1 skipped, build 0; verify_delegation no weakened tests / out-of-scope (exit 2 = 4 'TODO' prose hits in untracked .claude research docs only); forbidden-path diff empty; +160/−3 lines (slightly over the ~150 cap, from review-requested tests) |
| 3 item chips + complete model | done, verified, **uncommitted** (awaiting user review) | — (base d34c657) | Luna `.claude/logs/codex/20261114T093907Z-turn-result-card-s3.md` (all deliverables: `turnResultItemChips`, `turnResultCompact`, `deriveTurnResult`, optional `TurnResultInput.pending`); Sol low REQUEST_CHANGES (P2 self-referential modifier `moveText` assertions; P3 string concatenation/long lines; P3 `?? ""` text fallback) `.claude/logs/codex/20261114T101601Z-turn-result-card-s3-review.md` → fixed by lead direct edit (template literals, `ItemChipContext`, `rollAdjustWording`, label fallback; modifier cases assert `出目N → 駅`/`回送 → 駅` from inputs + no marks; deadhead fixture moved to a real station, which the old assertion hid) → Sol low APPROVE `.claude/logs/codex/20261114T102047Z-turn-result-card-s3-review2.md`; lead: typecheck 0, file 49/49, `npx vitest run` 82 files 2086 passed + 1 skipped (baseline 2062 + 1), build 0; mutation (mark in `moveText`) fails 7/7 modifier cases; verify_delegation no weakened tests / out-of-scope (exit 2 = 4 'TODO' prose hits in untracked .claude research docs only); forbidden-path diff empty; +211/−5 lines (over the ~150 cap from readability reformatting; Sol judged none unnecessary) |
| 4 reveal-gated publication + classic fallback | pending | | |
| 5 desktop card + HUD slot + #65 reserve | pending | | |
| 6 short-landscape compact row | pending | | |
| 7 pill position calculator + measured layout hook | pending | | |
| 8 phone pill shell + width cap + phone 出目 omission | pending | | |
| 9 pill → log reveal + focus return | pending | | |
| 10 TurnMomentHost avoidance (+ desktop chip gating) | pending | | |
| 11 map adjust-preview avoidance | pending | | |
| 12 responsive / a11y / lifecycle acceptance | pending | | |
| 13 final integration + acceptance | pending | | |

## Next

Step 3 completes `src/features/game/turnResultCard.ts`: `turnResultItemChips(move, turn, network, presentation)` (selected move's own `itemRecord.itemEvents` only; pickup retained/pending-discard 「…（選択待ち）」/harmful/cancelled 「…（打ち消し）」, effect consumed (roll-adjust 「出目調整 ±1」 + 「出目調整券を使いました（出目3 → 4）」) / activated; no chip for `discarded`/`effect-expired`; keys `${turn}:${type}:${id-or-effect[:index]}`), `turnResultCompact(heading, face, station, n)` and `deriveTurnResult(input)` (normalize → replay → history chips; item chips only when `itemsPublished`; unknown station 「駅不明」). `TurnResultInput` gained optional `pending?: DeepReadonly<PendingItemTurn> | null` — Step 4 passes `movementHistory` plus the session pending turn there instead of pre-normalizing. After user review: commit Step 3, push, check CI, then Step 4 (publication integration in `turnMomentPresentation.ts`, new `tests/unit/turn-result-publication.test.ts`) with `<BASE_SHA>` = the Step 3 commit.

## How to resume

1. `git switch feature/turn-result-card && git log --oneline -3` — the last done step's commit is the next `<BASE_SHA>`.
2. Read the next pending step in the plan (plus "Validation amendments"), fill the prompt template in
   `turn-result-card-prompts.md`, run Luna xhigh.
3. Verify: the step's acceptance commands, `verify_delegation.py`, the forbidden-path diff, existing test files unchanged.
4. Sol-low review; fix or re-delegate once on REQUEST_CHANGES.
5. Commit, push, check CI; update this table (status, commit, evidence); stop for user review.

## Follow-ups (out of scope)

- #65 progress feedback uses the reserved desktop slot.
- #71 phone sheet: the pill follows the measured panel top, re-check its tests when #71 lands; #71 owns any further phone
  HUD trimming (empty inventory row, other stats) and any reuse of the freed 出目 cells.
- 10-turn log history (「もっと見る」) deferred.
