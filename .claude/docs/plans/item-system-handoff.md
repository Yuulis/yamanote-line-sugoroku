# Item system (A6) handoff

Branch: `feature/item-system` (branched from `docs/item-system-roadmap`, which is pushed but has no PR yet by user request).

## Status

| Step | State | Commit | Evidence |
|---|---|---|---|
| Plan | Done (Codex Sol, read-only) | this commit | `.claude/docs/plans/item-system-plan.md`; prompt `item-system-plan-prompt.md` |
| Open questions | Answered 2026-10-27 (DESIGN.md; plan addendum) | this commit | Round 3 simulation confirms targets with one-item-per-turn and choose-discard |
| S1 Isolate and freeze classic | Done (Codex Luna, verified by lead) | see git log | `CLASSIC_GAME_CONFIG` + `MVP_GAME_CONFIG` alias; classic simulation tests import classic explicitly; `tests/unit/item-classic-regression.test.ts` pins config literal, 12 die draws, 5-turn real-bundle trajectory with a landing lottery. typecheck ok; `npm test` 705 passed / 1 skipped; spike smoke (100-seed engine equivalence) ok; verify_delegation 0 actionable. `suburban-product` sim skips without `SIM_BUNDLE` (full classic 5,000-game check is S7). Prompt: `item-system-s1-prompt.md` |
| S2 Direction policy + item config | Done (Codex Luna, verified by lead) | see git log | Optional `awayFromTargetWeight` (absent ⇒ 1, strict validation, absent key preserved); `ItemPolicy` (`itemPolicy?` on `GameConfig`) with `parseItemPolicy`, `BENEFICIAL_ITEM_KINDS`/`HARMFUL_ITEM_KINDS` in spike draw order; save `sameConfig` compares both; `ITEM_GAME_CONFIG` (`tokyo-suburban-items-1`, share 1/2, 3:2) not wired to product. typecheck ok; `npm test` 736 passed / 1 skipped; S1 regression test untouched and green; spike smoke ok; verify_delegation 0 actionable. Prompt: `item-system-s2-prompt.md` |
| S3 Item movement + candidate queries | Done (Codex Sol, verified by lead) | see git log | `advanceWithMode` (normal/rapid/oversleep/deadhead, pips vs physical hops, deadhead `relocation` stop), `filterLandingOptions`/`itemLandingOptions` (suspension inclusive expiry, all-suspended fallback, detour consumption), `nearestTargetStation` (directed BFS, target-order ties), hints `routeTicketOptions`/`directionHint`/`rapidHeadsTowardTarget`/`deadheadDestination`. Shipped graph has another loop: `toei-oedo-loop` (28 stations) — oversleep moves 6 hops there (spike capped differently; S7 remeasure covers it). typecheck ok; `npm test` 779 passed / 1 skipped; regression untouched; spike smoke ok; verify_delegation 0 actionable. Prompt: `item-system-s3-prompt.md` |
| S4 Inventory, drops, harmful effects | Done (Codex Luna, verified by lead) | see git log | `items.ts`: `seedItemRng` (`<seed>|items`), `drawItemDrop` (draw order 1000 → 100 → kind → suspension target; certificate cancels before target draw), `resolvePendingItemDiscard` (full inventory → choose 1 of 4). `itemEffects.ts`: sorted unique `delayDueTurns`, suspensions `{serviceId, expiresTurn}` (refresh on repeat), `detourPending`/`oversleepPending`, `consumeInventoryInstance`. Instance id `item-<turn>`; single-entry pools are forced (no draw). Not called by turns/save yet. typecheck ok; `npm test` 791 passed / 1 skipped; regression untouched; spike smoke ok; verify_delegation 0 actionable. Prompt: `item-system-s4-prompt.md` |
| S5 Item turn kernel | Done (Codex Sol + Luna fix, Sol-low review, verified by lead) | see git log | `itemTurn.ts`/`itemTurnPreparation.ts`: `createItemGame`, `beginItemTurn` (freeze pre-roll command, reveal die or resolve deadhead), `finishItemTurn` (≤1 item incl. adjust, movement, filtered landing, drop), `resolveItemDiscard`, atomic `playItemTurn`; records `ItemRideRecord`/`ItemDeadheadRecord`; pending `roll`/`discard` transcripts are deep-frozen and discard results are independent copies (review P1/P2 fixed with tests). Classic `computeTurn` rejects item configs. typecheck ok; `npm test` 833 passed / 1 skipped; regression untouched; spike smoke ok; verify_delegation 0 actionable. Open UI question for S9: deadhead is legal on Yamanote (relocates to the same station, wasting a turn). Prompts: `item-system-s5-prompt.md`, `-review-prompt.md`, `-fix-prompt.md` |
| S6-S12 | Not started | — | — |

## Decisions in force

- DESIGN.md Key Decisions 2026-10-27: mild weighting (Yamanote 1/2, direction 3:2), drop 0.30, harmful 30%, cap 3, 11 items.
- Players see only the item ruleset; classic `tokyo-suburban-1` stays internal (engine, config, tests, simulation).

## Next

1. Wait for the user's go-ahead (they review after every step), then start S6 (save v4 parsing and structural + seeded replay incl. pending transcripts; judgment — Sol). S7 parity targets the round-3 "both rules" rows.
