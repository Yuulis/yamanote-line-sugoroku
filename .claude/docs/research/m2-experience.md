# M2 Game Experience — Design Notes

Status: implemented on `feature/m2-game-experience` (2026-10-11). Spec:
`railway_sugoroku_mvp_spec.md` §1.3, §3.4, §6, §9 M2, §11. Builds on
`.claude/docs/research/m1-engine.md`.

## Layout

```
src/features/game/
  engine/save.ts           restoreGame(json, network, { expectedConfig, requireSeededRolls })
                           verifySeededHistory(state, network)
  gameSession.ts           GameSession + AppState reducers (pure)
  useGameApp.ts            useReducer + save-after-commit effect + title save lookup
  gameSummary.ts           summarizeGame, unusedPipsOf
  usePrefersReducedMotion.ts
  store/persistence.ts     readSave / writeSave / deleteSave / parseSave (storage injected)
  store/browserStorage.ts  getBrowserStorage() (only impure storage access)
  animation/movePath.ts    geometry index, orientation, cumulative length, positionAlong
  animation/timeline.ts    frameAt, easeInOut, visibleCompletedSegmentIds
  animation/runner.ts      runMoveAnimation(steps, stepMs, scheduler, onFrame, onDone)
  animation/displayedProgress.ts   committed state vs. what the marker has covered
  animation/useMoveAnimation.ts    React wrapper (rAF scheduler)
  components/              GamePanel, TitleScreen, ClearScreen, ConfirmDialog
src/features/map/camera.ts isUserCameraEvent, needsRecentre, USER_CAMERA_EVENTS
src/app/GameApp.tsx        composes map + screens; App.tsx handles data failure
```

## State management: useReducer, no Zustand

One component tree consumes the state, the reducers are pure and unit-tested,
and persistence is a single effect. Zustand would add a dependency and a second
place for state without removing any code. Spec §7 allows React built-ins.

`AppState = { screen: "title", lastSessionId } | { screen: "game", session }`.
`GameSession = { sessionId, game, phase: idle|animating, lastMove, animation }`.
Actions: `roll {rngSeed, turn}`, `animation-finished {sessionId, turn}`,
`new-game {seed}`, `resume {game}`, `show-title`. `roll` carries
`{sessionId, rngSeed, turn}`. `sessionId` increments on
every new game / resume (also across the title screen), so a finish callback
from an earlier game — even one with the same seed and turn — is ignored.

Nothing is created or saved until the player chooses on the title screen, so
opening the page can never overwrite a save. Clear screen = status
`completed` and phase `idle` (after the clearing animation).

## Commit, save, animate

1. `roll` runs `playTurn` in the reducer and commits the new `GameState`
   immediately, with phase `animating` and `animation = {sessionId, turn,
   fromStationId, events}`.
2. The save effect (`useGameApp`) writes the committed game in the same React
   commit, before the first animation frame. A reload mid-animation therefore
   resumes from the committed, saved state.
3. The animation is presentation only. When it ends (or skip is pressed) it
   dispatches `animation-finished`; the reducer accepts only the current
   `(sessionId, turn)` while animating, so skip racing the last frame, StrictMode
   double effects and stale callbacks are all no-ops.
4. The dice are enabled only when `phase === "idle"` and `status === "playing"`;
   the roll action also carries `(rngSeed, turn)` (M1 guard kept).

Saves happen on every committed change: new game (turn 0), each turn, and the
clearing turn (spec §11). Resume / StrictMode may rewrite identical JSON; that
is harmless.

## Save format and RNG verification

`saveVersion` stays **1**: the format did not change. Every production move is
exactly one `playTurn`, and `rollDie` is deterministic given the state
(rejected draws included), so no per-move draw count is needed.

Production restore (`parseSave` → `restoreGame(json, network, { expectedConfig:
MVP_GAME_CONFIG, requireSeededRolls: true })`), in order:

1. JSON / object shape → `INVALID_SAVE`
2. `saveVersion` → `UNSUPPORTED_SAVE_VERSION`
3. strict field parse → `INVALID_SAVE`
4. `dataVersion` → `DATA_VERSION_MISMATCH`
5. config equals the app's rules (field-wise) → `CONFIG_MISMATCH` (new; before
   the replay so different rules are not reported as corruption)
6. `moveByRoll` replay of the history (M1) → `INVALID_SAVE`
7. `verifySeededHistory` (also covers turn 0 on this path): replay from `createGame(config, rngSeed)` with
   `playTurn`; every roll must equal the record and the final `rngState` must
   equal the saved one → `RNG_MISMATCH` (new)

`restoreGame(json, network)` without options behaves exactly as in M1, so
`moveByRoll` stays usable with arbitrary rolls in tests.

This proves reproducibility from the seed, not authenticity: a save forged with
another seed and its own consistent history passes. If future rules draw from
the RNG inside a turn (line / direction lotteries), step 6 must be folded into
a single `playTurn` replay that compares whole records.

## Persistence

- Key `yamanote-line-sugoroku:save:v1` (layout version); payload carries
  `saveVersion` (game format), so an unknown format is found and reported.
- `getBrowserStorage()` returns `window.localStorage` or null when touching it
  throws. No write probe: a full quota must not hide a readable save.
- `readSave` → `none | valid | invalid{problem} | unavailable`; problems:
  `corrupt`, `unsupported-version`, `data-version`, `rules`, `rng-mismatch`,
  each with a Japanese message. Unexpected exceptions map to `corrupt`.
- `writeSave` → `saved | unavailable | failed`; shown in the panel
  (「セーブ: 自動保存済み」 / 保存できません / 保存に失敗しました). The game always
  continues.
- `deleteSave` → boolean; the title screen reports success or failure.
- Invalid saves stay in storage until discarded (「セーブデータを破棄」) or
  overwritten by 「はじめから」.

## Animation

- `buildGeometryIndex` indexes LineString features by feature id.
  MultiLineString is skipped (joining parts would invent straight links; current
  data has none). `stepPath` orients the line from the departure station
  (reversing if the end is nearer) and falls back to the straight
  station-to-station line only when there is no geometry at all
  (`segments.geojson` failed; the data banner reports it).
- Distance: equirectangular, longitude scaled by cos(mean latitude).
- Timing: fixed time per hop (`ANIMATION_SPEEDS`: 600 / 450 (default) / 300 ms),
  sine ease-in-out per hop so the marker slows into every station. Speed is
  read when a move starts. `goal-reached` is not a hop; unused pips are not
  animated.
- `prefers-reduced-motion: reduce` → `stepMs = 0` → the move finishes
  synchronously (no animation); the speed button shows 「省略」.
- `runMoveAnimation` takes an injected scheduler; progress is computed from
  elapsed time, so a hidden tab (paused rAF) finishes on its first visible
  frame. Cancel stops all callbacks.
- Highlighting: segments completed by this move appear one by one as the marker
  finishes each hop (`visibleCompletedSegmentIds`), and the panel's 現在駅 /
  踏破区間 follow the marker. Chosen over end-of-move highlighting because it
  ties the solid line to the marker; it costs at most one `setFilter` per hop
  (the map effect is keyed by the id list's content).
- The marker moves by `setData` on the one-point GeoJSON source each frame.

## Auto-follow

- Default ON. While ON: `jumpTo({center})` on every animation frame, `easeTo`
  (500 ms; instant with reduced motion) when the idle position changes or when
  toggled ON. Zoom is never changed; map zoom is bounded to 9–17.
- Any camera event carrying `originalEvent` (`movestart`, `dragstart`,
  `zoomstart`, `rotatestart`, `pitchstart`: drag, wheel, pinch, keyboard,
  NavigationControl buttons) sets a ref synchronously (so no queued frame
  can call `jumpTo` and cancel the gesture) and switches the toggle OFF.
  Programmatic moves carry no `originalEvent`, so there is no event loop.
  Toggling ON clears the ref before the camera effect runs.

## Screens and layout

- Title: rules, 「つづきから（Nターン目・駅）」 or 「クリア結果を見る」 for a valid
  save, 「セーブを削除」, invalid-save message + 「セーブデータを破棄」,
  storage-unavailable notice, 「はじめから」 (disabled with a message when the
  data needed for the game failed), credits (data attribution with the
  manifest URL only if http(s); OpenFreeMap / OpenMapTiles / OSM).
- Map style failure: a banner (「地図の読み込みに失敗しました。」+ 再試行) above the
  title / clear screens; the game keeps running without the map.
- Play panel: 現在駅, 進行方向, ターン数, 踏破区間, 出目 (aria-live), dice,
  スキップ, 追尾 (aria-pressed), 速度, 新規, タイトル, save status, legend.
- Clear: turns, moves (station hops; always 30 under MVP rules), history with
  「（新橋で停止、残りN）」, 「もう一度遊ぶ」, 「タイトルへ」.
- Confirmation (`ConfirmDialog`: native modal `<dialog>`, role alertdialog,
  focus on キャンセル, Escape and backdrop cancel, focus back to the opener) for
  new game when a game is in progress (turn > 0) and for deleting a save.
- Game state lives above `RailwayMap`, and the animation does not depend on the
  map, so play continues while the map is down.
- ≤ 600 px: full-width bottom panel (≈ 32 % of a 667 px screen), 44 px buttons
  incl. MapLibre zoom buttons; the attribution control moves to the top-left
  (decided at map creation) because the panel spans the bottom edge.

## Codex consultation log

Design (`.claude/logs/codex/20261011T060400Z-m2-design.md`) — adopted: keep
saveVersion 1 with a `playTurn` replay; config check before replay; `sessionId`
+ cancel flag + frame ownership; separate read/write/delete without a probe;
no auto-created game before the title choice; synchronous follow-off ref and
`movestart`; no MultiLineString concatenation; delete UI for valid saves;
panel synced with the animation; completed save opens the clear screen.
Not adopted: cross-tab `storage` event handling (documented as
last-writer-wins); a hard cap on history length (replay stops at the first
move after completion, so valid histories are ≤ 30 moves).

Review (`.claude/logs/codex/*-m2-review.md`) — adopted: clear screen shows a
save failure of the clearing turn; ConfirmDialog became a native modal
`<dialog>` (focus containment, inert background, Escape, accessible name) with
explicit opener refocus in a layout-effect cleanup; map style error became a
banner above the title/clear screens so retry is always reachable; `roll`
carries `sessionId`; `box-sizing: border-box` on title card and dialog;
production path reports a turn-0 foreign `rngState` as `RNG_MISMATCH`;
turning on reduced motion mid-move finishes the move; tests tightened
(config-before-replay with a broken history, stale queued frame after cancel,
same-save resume click). Not adopted: React hook / RailwayMap integration tests
(need jsdom + Testing Library or a WebGL stub; covered by the CDP smoke run and
M3 Playwright).

## Open items

- Cross-tab: two tabs on the same save overwrite each other (last writer wins).
- MapLibre's own attribution "i" button stays at its default 24 px.
- Browser checks were done with a headless Chromium CDP script (not committed);
  Playwright E2E is M3.
