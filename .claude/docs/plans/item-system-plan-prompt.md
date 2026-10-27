# Item system (A6): implementation plan request

## Objective
Produce a step-by-step implementation plan for the station item system so it can be built in reviewable steps (engine → save → UI) on branch `feature/item-system`.

## Decided (do not re-litigate)
- Read `.claude/docs/DESIGN.md` Key Decisions dated 2026-10-27 (two rows) and `docs/manual/development-roadmap/proposal.md` §8.
- Ruleset: on every station arrival, 30% chance of a random item; 30% of drops are harmful; inventory cap 3. Lottery weighting "mild": at a Yamanote station Yamanote wins 1/2 (rest uniform among other candidates); on other services the direction toward Yamanote has weight 3:2.
- Items, beneficial (held, 7): 路線指定券, 方向指定券, 出目調整券 (±1 after seeing the roll), 倍速券, 快速券, 回送列車, 遅延証明書 (passive, cancels the next harmful item). Harmful (automatic, 4): 遅延, 運休, 寄り道, 寝過ごし.
- The exact effects modelled in the simulation are the reference: `.claude/docs/research/item-system-simulation.md` (round 1 + "Round 2" sections, especially the modelling simplifications) and `tests/simulation/item-spike/{sim.ts,moves.ts}`. Where the simulation simplified something the product must decide, list it as an open question with a recommendation instead of silently choosing.
- Players can only play the item ruleset. The current ruleset `tokyo-suburban-1` ("classic") stays internal only (engine, config, tests, simulation); no UI to select it.
- New `rulesetVersion` and a new save version; old saves are rejected/discardable as in past ruleset changes (no migration).
- Item names and effects are original; do not borrow card names from existing games.

## What the plan must settle
1. Turn model: today `playTurn` is atomic (roll → move → landing lottery) and the app commits → saves → animates. 出目調整券 needs the roll visible before the decision. Compare (a) a two-phase turn with a saveable pending-roll state, and (b) a deterministic roll preview from a separate dice RNG stream (spike report suggests `peekRoll`), including how pre-roll items (路線指定券, 方向指定券, 倍速券, 快速券, 回送列車) are ordered relative to seeing the roll, and anti-peeking/fairness consequences. Recommend one.
2. RNG contract: separate streams (dice / landing / items?) and how classic keeps its existing draw sequence bit-for-bit (existing snapshot and S7 tests must stay green).
3. Lottery weight representation for 3:2 direction weighting while keeping classic's representation valid.
4. State & records: GameState additions (inventory, pending timed effects, suspensions, detour flag, certificate), `MoveRecord` additions, save v4 format, structural + seeded replay verification.
5. Config/edition wiring: how the item ruleset becomes the shipped default while classic remains constructible internally (`src/features/game/gameConfig.ts`, `src/features/editions/*`).
6. UI: inventory panel, item use flow (incl. the adjust-after-roll step), harmful-event notifications, hints that make items usable by first-time players (which ticket boards Yamanote, which direction is closer; rapid ticket only helps toward Yamanote), accessibility (screen-reader announcements, focus, reduced motion), mobile layout. Also title-screen rule text and result-share text updates.
7. Simulation: move from the spike re-implementation to the real engine and assert the product reproduces the spike's round-2 numbers for mild p0.30/h30 (greedy and random) within tolerance; keep classic's S7 numbers.
8. Step decomposition: ordered steps (S1, S2, …), each independently testable/committable, with files touched, tests to add, acceptance commands, and rough size (S/M/L). Note which steps suit a cheaper implementer (well-specified) vs need judgment.
9. Open questions for the user (only real product decisions), each with a recommendation. E.g. whether 運休 can hit Yamanote, item drop at the goal turn, inventory-full behaviour (discard new vs choose), whether 回送列車 counts as a move in result statistics.

## Relevant files (read as needed)
`src/features/game/engine/` (all), `src/features/game/gameConfig.ts`, `src/features/game/useGameApp.ts`, `src/features/game/gameSession.ts`, `src/features/game/store/`, `src/features/game/components/`, `src/features/game/presentation*.ts`, `src/features/game/shareText.ts`, `src/features/game/gameSummary.ts`, `src/features/editions/`, `tests/unit/`, `tests/simulation/`, `tests/e2e/`, `docs/manual/tokyo-suburban/rules.md`, `.claude/docs/plans/tokyo-suburban-s7-plan.md` (format reference for step plans).

## Constraints
- Follow `.claude/rules/coding-principles.md` and `.claude/rules/testing.md`; TypeScript strict; pure engine stays free of React/DOM.
- Do not modify any files (read-only planning).

## Output format (English, markdown)
## TL;DR · ## Analysis (current architecture facts with file:line refs) · ## Decisions recommended (items 1-5) · ## UI plan · ## Steps (table + per-step detail with acceptance commands) · ## Simulation parity plan · ## Open questions for the user (with recommendations) · ## Risks
