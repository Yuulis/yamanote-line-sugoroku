# M1 Game Engine — Design Notes

Status: implemented on `feature/m1-game-engine` (2026-10-11). Spec: `railway_sugoroku_mvp_spec.md` §3, §5, §8.

## Layout

```
src/features/game/engine/   pure TS, no React / DOM / MapLibre / clock / Math.random
  errors.ts    GameEngineError { code }  (single error type)
  rng.ts       sfc32 + cyrb128 seeding, rollDie, faceFromDraw
  network.ts   buildRailwayNetwork, findSegment, nextStationId, requiredSegmentIds
  config.ts    validateConfig, GOAL_ARRIVAL_POLICIES
  goal.ts      checkGoal, stopsAtGoal, targetSegmentIds
  game.ts      createGame, moveByRoll, playTurn, SAVE_VERSION
  save.ts      serializeGame, restoreGame
  types.ts     MoveEvent, MoveResult
src/features/game/          React wiring (useReducer), seed generation, panel
src/features/map/           progressStyle.ts + two filtered segment layers + marker
```

## Public API

```ts
buildRailwayNetwork(input: { dataVersion; stations; services; segments },
                    options?: { expectedStationCount?: number }): RailwayNetwork
createGame(config: GameConfig, seed: string, network): GameState
moveByRoll(state: GameState, roll: number, network): MoveResult
playTurn(state: GameState, network): MoveResult          // rollDie + moveByRoll
checkGoal(state: GameState, network): boolean             // at start && all target segments done
serializeGame(state): string
restoreGame(json: string, network): GameState
seedRng(seed: string): string
rollDie(rngState: string): { value: 1..6; nextRngState: string }

interface MoveResult { state; events: MoveEvent[]; roll: DieFace; unusedPips: number }
type MoveEvent =
  | { type: "segment-traversed"; step; serviceId; direction; segmentId;
      fromStationId; toStationId; newlyCompleted }
  | { type: "goal-reached"; step; stationId }   // right after the step that reached it
```

Deviations from the §8.1 example signatures (the spec calls them examples):
`createGame` / `checkGoal` / `restoreGame` take the network (dataVersion,
validation, target segment set), and `moveByRoll` returns `MoveResult`.

Error codes: `INVALID_ROLL`, `GAME_NOT_PLAYING`, `INVALID_STATE`,
`INVALID_NETWORK`, `INVALID_CONFIG`, `INVALID_SEED`, `INVALID_SAVE`,
`UNSUPPORTED_SAVE_VERSION`, `DATA_VERSION_MISMATCH`, `INVALID_RNG_STATE`.

## Movement and goal

Per step: look up the directed segment → add to the completed set (first-
completion order kept in `completedSegmentIds`) → emit `segment-traversed` →
move → goal check. The move stops at the goal when
`checkGoal && (lastStep || policy == pass-through || (policy == truncate-on-target-service && riding == targetService))`.
`exact-stop` therefore only clears on the last step. The service that ran the
step is used, not one chosen after arrival (future transfers). `turn` grows by
one per roll; `MoveRecord.roll` keeps the die value even when truncated.

Status: the engine only produces `playing` and `completed`. `ready` / `moving`
are UI phases; `moveByRoll` rejects them and `restoreGame` refuses to load them.

## PRNG

sfc32 (128-bit state, the 4th word is a counter, so no fixed points incl. all-
zero; passes PractRand/BigCrush), seeded via cyrb128 over UTF-16 code units:
`a,b,c = hash words 0-2`, counter = 1, 15 warm-up outputs (standard sfc32
seeding). Serialised as `sfc32-v1:aaaaaaaa:bbbbbbbb:cccccccc:dddddddd`.
Die: rejection sampling — draws `>= 4294967292` (largest multiple of 6 below
2^32) are discarded, so each face has exactly 715827882 accepted draws.
Rejected draws still advance the state. Chosen over mulberry32 (32-bit state,
known missing outputs), xoshiro128** (needs all-zero rejection), PCG32 (needs
BigInt). A fixed-seed inline snapshot locks the sequence; changing algorithm or
seeding requires a new prefix and save version.

## Save / restore

`restoreGame` = JSON parse → `saveVersion` (non-integer → `INVALID_SAVE`,
other integer → `UNSUPPORTED_SAVE_VERSION`) → strict shape parse into a fresh
object (unknown keys dropped, nothing defaulted) → `dataVersion` must equal the
network's → **replay**: `createGame(config, rngSeed)` then `moveByRoll` for
each history roll, requiring identical records, position, completed list,
status and turn. This verifies route, policy truncation, and goal status with
the engine's own logic. At turn 0 the `rngState` must equal `seedRng(rngSeed)`;
mid-game `rngState` is trusted because history does not record whether a roll
came from `playTurn` or an injected `moveByRoll`.

## UI wiring

`useReducer` over `GameSession { game, phase: idle|applying, lastMove }`.
Roll action carries `(rngSeed, turn)`; the reducer ignores it unless phase is
idle, status playing and both match — repeated clicks, stale clicks after a
restart, and StrictMode double reducer calls cannot apply a turn twice. A
`MOVE_SETTLE_MS` (400 ms) timer releases the lock (placeholder for M2
animation). Seeds: `crypto.getRandomValues` (128-bit hex) outside the engine.

Map: segment layer split into `railway-segments-pending` (grey `#8a8a8a`,
dashed, 3 px) and `railway-segments-completed` (service colour, solid, 5 px)
with complementary `["in", ["get","segmentId"], ["literal", ids]]` filters, plus
a `game-current-position` circle (red, white stroke) above the stations.
Progress is applied by an effect once the map has loaded and re-applied after
a style retry.

## Codex consultation log

Design (`.claude/logs/codex/20261011T052844Z-m1-engine-design.md`) — adopted:
sfc32 without all-zero rejection; standard seeding; versioned state prefix;
one event per segment + goal event with `roll`/`unusedPips` on the result;
required network argument on `restoreGame`; reject `ready`/`moving` saves;
`INVALID_STATE` code; reject duplicate `(service, from, to)`; target service
must be circular with all directed segments; seed/turn guard in the UI action.
Not adopted: removing the 30-station check entirely (kept as an opt-in
`expectedStationCount` passed by the app, since the lead asked for it);
`DeepReadonly` parameter types (tests deep-freeze inputs instead).

Review (`.claude/logs/codex/20261011T054018Z-m1-engine-review.md`) — adopted:
turn-0 rngState/seed consistency check; fresh fixture objects; tests for
non-target-service goal behaviour, goal boundaries, out-of-range history roll,
move after completion, restart during `applying`, rolls after completion.
Not adopted: recording RNG consumption per move (save-format change, deferred
to M2 save work); React timer / MapLibre load-order tests (needs jsdom +
Testing Library or a WebGL stub; covered by E2E in M3).

## Open items for M2+

- Save format may need per-move RNG provenance for full replay verification.
- `dataVersion` mismatch handling in the UI (offer reset).
- Animation should consume `MoveResult.events` and replace the settle timer.
- `rulesetVersion` is only checked as non-empty; no ruleset migration yet.
