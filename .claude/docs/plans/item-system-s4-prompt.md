# Item system S4 — inventory, drops and harmful-effect transitions

## Objective
Implement the pure item-state layer — inventory, drop draws from the item RNG stream, the player-chosen discard when full, certificate cancellation and the harmful-effect timers/flags — as immutable functions that S5 will call from the turn kernel, without touching classic behaviour.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — section 2 (RNG contract: item stream draw order), section 4 (state table: inventory instances with deterministic ids, sorted unique delay due turns, JSON-safe suspension entries, detour/oversleep booleans, certificate as an inventory kind, serialized `itemRngState`), "S4", and the "Addendum (2026-10-27)". Handoff: `.claude/docs/plans/item-system-handoff.md`.
- Product rules: `.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27. Behavioural reference: `tests/simulation/item-spike/sim.ts` (round 3).
- Already in place: `ItemPolicy` / `ITEM_GAME_CONFIG.itemPolicy` (dropChancePerMille 300, harmfulChancePercent 30, inventoryCapacity 3, maxActiveItemsPerTurn 1, delayTurns 3, suspensionTurns 5, fullInventoryPolicy "player-chooses-discard", ordered kind lists) and kind ids in `src/types/network.ts`; S3's `ServiceSuspension { serviceId, expiresTurn }` (inclusive expiry) and `LandingFilters` in `engine/landing.ts`; RNG helpers (`seedRng`, `drawIndex`, `drawWeightedIndex`) in `engine/rng.ts`.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Rules to implement
1. Drop draw order on the item stream (exactly): `drawIndex(1000)` → drop iff `< dropChancePerMille`; if dropped, `drawIndex(100)` → harmful iff `< harmfulChancePercent`; then uniform kind index within the beneficial or harmful list (list order from the policy); then, only for an uncancelled `suspension`, uniform index over the arrival station's candidate services (the station's services in canonical landing order — accept that list as an input). No other draws. The item stream is seeded `seedRng(seed + "|items")` (export a helper for this).
2. Beneficial pickup: append an instance `{ id, kind }` with a deterministic id derived from the acquisition turn (one pickup per turn at most). If the inventory is already at capacity, do not discard automatically: return a pending-discard outcome listing the 4 candidates (3 held + new), and provide a separate pure function that resolves it given the chosen instance id (validated; any of the 4 may be discarded, including the new one).
3. Harmful pickup: if the inventory holds a `delay-certificate`, consume the oldest one and cancel the harmful item (cancellation happens before any suspension-target draw, so a cancelled suspension consumes no target draw). Otherwise apply:
   - `delay` picked on turn t → due turn t + delayTurns added to a sorted, de-duplicated list.
   - `suspension` on turn t → entry `{ serviceId, expiresTurn: t + suspensionTurns }` (excluded on turns t+1..t+5 given S3's inclusive check); a repeated suspension of the same service refreshes its expiry; keep deterministic ordering.
   - `detour` → boolean pending flag (does not stack).
   - `oversleep` → boolean pending flag (does not stack).
4. Helpers for S5: query/consume a delay due on a given turn, prune expired suspensions, clear detour/oversleep flags, consume an inventory instance by id (validated). Everything returns new objects and typed events (pickup retained, pickup pending discard, discarded, harmful scheduled, cancelled by certificate, consumed) plus the next item RNG state.
5. Keep classic untouched: nothing in `game.ts` / `playTurn` / `moveByRoll` / save calls these yet.

## Scope
In: new `src/features/game/engine/items.ts` and `src/features/game/engine/itemEffects.ts` (split as you see fit, each ≤ ~400 lines), item domain types (in `src/types/network.ts` or the engine types file, matching existing placement), `engine/index.ts` exports, new tests `tests/unit/engine-items.test.ts` and `tests/unit/engine-item-effects.test.ts`.
Tests must cover: drop boundary 299 vs 300 and harmful boundary 29 vs 30 (construct RNG states or inject draws via the existing test patterns), every kind reachable from each pool, full-inventory pending discard and its resolution (each of the 4 choices, invalid id), duplicate certificates (oldest consumed, each protects one pickup), certificate cancelling a suspension consumes no target draw, delay exact t+3, suspension exact boundary with S3's `filterLandingOptions` (excluded on t+5, available on t+6), refresh of a repeated suspension, non-stacking detour/oversleep, immutability of inputs.
Out / must not touch: turn orchestration, movement, landing weights, save format, UI, gameConfig values, editions, `tests/unit/item-classic-regression.test.ts`, existing snapshots.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Pure engine: no React/DOM/clock/global randomness. Match surrounding naming and comment density.

## Acceptance checks (all must pass)
```bash
npm run typecheck
npx vitest run tests/unit/engine-items.test.ts tests/unit/engine-item-effects.test.ts tests/unit/engine-rng.test.ts tests/unit/item-classic-regression.test.ts
npm test
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
git status --short   # only files implied by Scope
```

## Output (English, under 35 lines)
Files changed; public API (names + one-line purpose); state shape chosen; any rule interpretation you had to make (with reason); acceptance results with pass counts; anything not done and why.
