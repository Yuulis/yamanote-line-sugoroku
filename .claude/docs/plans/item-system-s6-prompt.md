# Item system S6 — save v4 with item state, pending transcripts and replay validation

## Objective
Introduce save format v4 so item-mode games (including the pending-roll and pending-discard decision points) save, restore and verify by structural and seeded replay through the S5 turn kernel, while classic games keep saving/restoring under the v4 envelope with unchanged gameplay, and every v1–v3 save is rejected without migration.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — section 4 "State, records and save v4" (the 7 numbered save requirements and the note about literal `SAVE_VERSION === 3` assertions), "S6", "Risks", and the "Addendum (2026-10-27)" (player-chosen discard is a second saveable decision whose choice is recorded). Handoff: `.claude/docs/plans/item-system-handoff.md`.
- Engine already in place (committed): S2 `itemPolicy` parsing + `sameConfig`; S4 item state (`items.ts`, `itemEffects.ts`); S5 kernel `createItemGame`, `beginItemTurn`, `finishItemTurn`, `resolveItemDiscard`, `playItemTurn`, records `ItemRideRecord` / `ItemDeadheadRecord`, deep-frozen pending `roll` / `discard` transcripts (`engine/itemTurn.ts`, `engine/itemTurnPreparation.ts`, types in `src/types/network.ts`). Current save code: `src/features/game/engine/save.ts` (v3, structural + seeded replay for classic), `SAVE_VERSION` in `engine/game.ts`, app persistence in `src/features/game/store/persistence.ts`.
- The shipped product still plays classic until S11; this step must keep the app working end-to-end for classic under v4 (same storage key, same invalid-save discovery and explicit discard UX).
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In: `engine/game.ts` (`SAVE_VERSION = 4`), `engine/save.ts` and new focused parser/replay modules if `save.ts` would exceed ~800 lines, `store/persistence.ts` only if needed, `engine/index.ts` exports, tests: new `tests/unit/engine-save-v4.test.ts`, updates to existing save/persistence tests and fixtures.
1. Serialize/parse v4: classic games (current record shape) and item games (inventory, effects, `itemRngState`, item record variants, pending transcript `null | roll | discard`). Strict parsing: unknown/missing fields, capacity, instance ids, known kinds and services, timer bounds, legal pending combinations, record variants. JSON-safe (no Map/Set).
2. Restore = structural replay (recorded commands + recorded outcomes, through the S5 kernel's validation) AND seeded replay (same commands from the seed, regenerating every die, landing, drop, suspension target), comparing records, final position, inventory, effects, flags, pending transcript and all RNG states (main + item). Replay completed history first, then reconstruct/verify the pending transcript. Keep restore linear in history length. Restored pending transcripts must again be deep-frozen as in S5.
3. Errors keep existing typed categories (e.g. `INVALID_SAVE`, `RNG_MISMATCH`, `CONFIG_MISMATCH`, unsupported version); v1–v3 payloads are rejected before replay and the stored bytes are preserved until the user discards (existing behaviour).
4. Update literal version assertions and "future version" fixtures (4 is now current; use 5 as the future version) with equivalent or stronger rejection tests. Do NOT edit gameplay/RNG snapshots or `tests/unit/item-classic-regression.test.ts`.
5. E2E/fixture impact: search `tests/e2e/` and `tests/unit/` for saved-payload fixtures and seeds that assume v3 (e.g. `save-errors.spec.ts`, fixture save files, `e2e-fixture-seeds`). Regenerate current-format fixtures as v4 where they represent a valid current save (record how in a comment or README beside them), and keep historical v3 payloads as old-format rejection fixtures. Do not run Playwright locally unless quick; list the e2e specs you touched so the lead can rely on CI.
Tests (`engine-save-v4.test.ts` + updates): settled / pending-roll / pending-discard / completed round-trips for item games; pending at turn 0; classic round-trip under v4; illegal item use in a save; forged raw die, landing, drop, suspension target, certificate cancellation, delay/suspension timers, inventory, discard choice and each RNG state are rejected with the right error; missing required fields; v3 rejection with bytes preserved.
Out / must not touch: turn kernel behaviour (fix only genuine bugs you hit, and report them), simulation port (S7), UI/session flow (S8), `gameConfig.ts` values, editions, existing gameplay snapshots.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`, `.claude/rules/security.md` (save payloads are untrusted input). Match surrounding naming and comment density.

## Acceptance checks (all must pass)
```bash
npm run typecheck
npx vitest run tests/unit/engine-save.test.ts tests/unit/engine-save-v2.test.ts tests/unit/engine-save-v3.test.ts tests/unit/engine-save-v4.test.ts tests/unit/persistence.test.ts tests/unit/item-classic-regression.test.ts
npm test
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
npm run build
git status --short
```
(If a listed test file does not exist, say so and name the equivalent you ran.)

## Output (English, under 45 lines)
Files changed; v4 envelope shape; replay design (what structural vs seeded replay each check); error mapping; fixtures regenerated vs kept as historical (with paths); e2e specs touched; any kernel bug found; acceptance results with pass counts; anything left for S7/S8.
