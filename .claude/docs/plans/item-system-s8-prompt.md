# Item system S8 — session state and persistence for item turns

## Objective
Teach the app's session layer to run item-mode games on top of the S5 phased engine and S6 save v4 — preparing a pre-roll command, committing it, persisting the pending roll before revealing it, adjusting, animating, choosing a discard, resuming any pending decision — while the shipped product (still classic until S11) behaves exactly as today.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — "S8", section 1 (turn model rules: pending survives leaving to the title and reload; closing the adjust UI never cancels the roll; deterministic single transition when no adjust decision is possible), "UI plan" (for the states the UI will need in S9/S10), and the "Addendum (2026-10-27)" (one active item per turn incl. adjust; player-chosen discard is a second saveable decision). Handoff: `.claude/docs/plans/item-system-handoff.md`.
- Engine API (committed): `createItemGame`, `beginItemTurn`, `finishItemTurn`, `resolveItemDiscard`, hint/option queries (`routeTicketOptions`, `directionHint`, `rapidHeadsTowardTarget`, `deadheadDestination`), `serializeGame` / `restoreGame` (v4, item saves always fully replayed), `ITEM_GAME_CONFIG`, `CLASSIC_GAME_CONFIG`, `MVP_GAME_CONFIG` (alias of classic until S11). Pending transcripts are deep-frozen; never mutate them.
- App layer today: `src/features/game/gameSession.ts`, `src/features/game/useGameApp.ts`, `src/app/GameApp.tsx`, persistence `src/features/game/store/persistence.ts`, presentation `presentation.ts` / `presentationResolver.ts`, animation under `src/features/game/animation/`. Classic flow: one atomic turn → save → animate.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In: `gameSession.ts` (or a new focused `itemSession.ts` beside it if `gameSession.ts` would exceed ~400 lines), `useGameApp.ts`, `src/app/GameApp.tsx` only as far as wiring requires, `store/persistence.ts` if needed, new `tests/unit/game-session-items.test.ts`, updates to `tests/unit/game-session.test.ts` / `tests/unit/game-app-state.test.ts` / `tests/unit/persistence.test.ts` where classic expectations must be extended (not weakened).
1. Session phases for item mode: idle (may edit a draft pre-roll choice) → committing (engine `beginItemTurn`, persist the pending roll BEFORE exposing the die value) → awaiting adjust (only when an adjust ticket is usable and no pre-roll item was used; otherwise finish immediately in one deterministic transition) → resolving (`finishItemTurn`, persist) → animating → awaiting discard (if pending discard; persist) → idle. Deadhead resolves without a roll. Editable drafts stay separate from committed pending choices.
2. Action identity: actions carry session id + completed turn + decision revision so stale callbacks (double clicks, StrictMode double effects, late animation callbacks) are ignored.
3. Persistence: attempt to write the pending state before revealing its roll; on write failure report it (reuse the existing save-failure reporting) and continue in memory. Resume: a pending roll resumes at the adjust decision with the same die; a pending discard resumes at the discard choice; a completed turn resumes without replaying its animation.
4. New-game overwrite guard: treat `turn > 0 || pending !== null` as progress.
5. Expose to the UI (S9) a typed, read-only view model for item mode: inventory, usable items with reasons/hints for the current position (route candidates incl. which is Yamanote, closer direction, whether rapid heads toward Yamanote, deadhead destination; mark deadhead on Yamanote as not recommended), pending decision kind and its options (adjust deltas allowed, discard candidates), active effects (delay due turn, suspensions, detour/oversleep flags). No React components in this step.
6. Classic product path unchanged: with `MVP_GAME_CONFIG` (classic) the app's behaviour, saves and existing tests are identical. The session chooses item vs classic by `config.itemPolicy`.
Tests (`game-session-items.test.ts`): each phase transition; no-adjust fast path; deadhead path; discard path incl. resume; persistence order (pending saved before roll exposed — assert via a storage spy); write-failure continues in memory; stale action ignored; resume of each pending kind; new-game guard with pending at turn 0; view-model hints on a fixture network; classic session unchanged.
Out / must not touch: React UI components (S9), notifications/animation visuals/a11y (S10), product default/editions/title text (S11), engine behaviour (report genuine bugs instead of fixing), gameplay snapshots, `tests/unit/item-classic-regression.test.ts`.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Keep StrictMode purity (no side effects in render/reducers). Match surrounding naming and comment density.

## Acceptance checks
```bash
npm run typecheck
npx vitest run tests/unit/game-session.test.ts tests/unit/game-app-state.test.ts tests/unit/game-session-items.test.ts tests/unit/persistence.test.ts tests/unit/item-classic-regression.test.ts
npm test
npm run build
git status --short
```
(If a listed test file does not exist, say so and name the equivalent you ran or created.)

## Output (English, under 40 lines)
Files changed; session phase model and action-identity scheme; persistence ordering; view-model shape for S9; classic-unchanged evidence; acceptance results with pass counts; anything left for S9/S10.
