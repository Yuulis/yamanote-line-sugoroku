# Item system S5 — the item turn kernel

## Objective
Compose S2–S4 into the item-mode turn: a phased, saveable turn (pre-roll item → revealed roll → optional adjust → movement/landing/drop → optional discard choice) plus an atomic composition for noninteractive callers, with classic `playTurn`/`moveByRoll` behaviour and records unchanged.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — section 1 (turn model A: saveable two-phase turn, canonical order, pending-state representation and its rules), section 2 (RNG contract, item-mode main stream: optional route-direction draw → die → landing service → landing direction; item stream separate), section 4 (state & record variants: item ride record, deadhead record, tagged item events, pips vs physical hops, `landing: null` no longer implies cleared), "S5", and the "Addendum (2026-10-27)". Handoff: `.claude/docs/plans/item-system-handoff.md`.
- Product rules: `.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27 (three rows). The addendum overrides the plan where they differ:
  - **At most ONE active item per turn in total**, including `roll-adjust` (a turn that used a pre-roll item cannot adjust; a turn that wants to adjust uses no pre-roll item). `deadhead` is exclusive and replaces the turn. `delay-certificate` is passive.
  - **Full inventory → the player chooses which one of the four to discard.** This is a second saveable decision point after the drop; the turn's record must capture the choice and replay must validate it.
  - Pickups only at the turn's final stop; no drop on the clearing turn; deadhead arrival drops.
  - `route-ticket` chooses the service only (current service allowed when a choice exists); a non-Yamanote choice draws its direction on the main stream before the die.
  - Delay/oversleep turns: no active item; die still drawn; delay forces face 1; oversleep carries to endpoint / 6 hops on loops and overrides a coincident delay.
  - Deadhead: no die, no landing lottery, no segments, no clear by relocation; counts one turn, zero moves.
  - Suspension filters route-ticket candidates and landing candidates; detour applies at the next landing that has another candidate.
- Building blocks already merged: S2 `ITEM_GAME_CONFIG`/`itemPolicy`, 3:2 direction weights; S3 `advanceWithMode`, `filterLandingOptions`/`itemLandingOptions`, `nearestTargetStation`, hint queries (`engine/itemMovement.ts`, `engine/itemOptions.ts`, `engine/landing.ts`, `engine/proximity.ts`); S4 `seedItemRng`, `drawItemDrop`, `resolvePendingItemDiscard`, effect reducers (`engine/items.ts`, `engine/itemEffects.ts`).
- Behavioural reference for draw order and effect timing: `tests/simulation/item-spike/sim.ts` (round 3).
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In: new `src/features/game/engine/itemTurn.ts` (split further if it would exceed ~400 lines), `engine/game.ts`, `engine/types.ts`, `engine/index.ts`, shared state/record types in `src/types/network.ts`; new `tests/unit/engine-item-turn.test.ts`.
1. Item-mode game creation from `ITEM_GAME_CONFIG` (item state: inventory, effects, `itemRngState`, pending transcript = null). Classic creation unchanged.
2. Phased API (names your choice, e.g. `beginItemTurn(state, command, network)` → pending roll; `finishItemTurn(state, adjustment, network)` → completed turn or pending discard; `resolveItemDiscard(state, instanceId)` → completed turn) and an atomic composition (e.g. `playItemTurn(state, decisions, network)`) for simulation/tests that calls the same functions — no second turn loop.
3. Validation: instance ownership, one-item limit, item legality for the current position (e.g. direction ticket only on non-Yamanote with two movable directions, route ticket only where a choice exists after suspension), forced-turn restrictions, ±1 adjust bounds (face stays 1–6), no new commands while pending, no duplicate completion, no changing pre-actions after reveal, no turns after the goal. Errors via `GameEngineError` with existing codes where they fit.
4. Records/events: item ride record and deadhead record variants per plan section 4 (raw die, effective face, movement mode, pips, hop budget, physical hops, segments, unused pips, the command, resolved ride, landing snapshot after filtering, item outcomes incl. discard choice). Classic record shape unchanged.
5. Tests: phased vs atomic equality; exact main- and item-stream draw sequences for a fixed seed; each active item individually; two-item command rejected; adjust after pre-roll item rejected; adjust bounds; delay/oversleep collision; deadhead exclusivity and no-clear relocation; clearing turn (no drop); suspension filtering a route ticket; detour consumption; full-inventory pending discard (each choice incl. discarding the new item) and blocking the next turn until resolved; input immutability; classic `playTurn` results unchanged (S1 regression stays green and untouched).
Out / must not touch: save format/version and replay (S6), simulation port (S7), app/session/UI, `gameConfig.ts` values, editions, `tests/unit/item-classic-regression.test.ts`, existing snapshots.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Pure engine only. Match surrounding naming and comment density.

## Acceptance checks (all must pass)
```bash
npm run typecheck
npx vitest run tests/unit/engine-item-turn.test.ts tests/unit/item-classic-regression.test.ts tests/unit/engine-game.test.ts tests/unit/engine-landing.test.ts
npm test
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
git status --short   # only files implied by Scope
```

## Output (English, under 45 lines)
Files changed; public API (names + purpose); state/pending/record shapes chosen; rule interpretations you had to make (with reasons); any place the product rules above contradicted the plan and how you resolved it; acceptance results with pass counts; anything left for S6/S7.
