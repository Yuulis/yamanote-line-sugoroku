## Feature Brief: Tempo stage 1 — very-fast speed, persisted 演出 level, settings persistence, keyboard shortcuts (issue #64)

Slug: `tempo-fast-forward-auto-roll` (workspace-resolved). Mode: existing. Base: `develop` @ a8e928e (v0.12.0).
Inputs: codebase scan `.claude/docs/research/feature-tempo-fast-forward-auto-roll-codebase.md`; Codex scope + architecture
consult `.claude/logs/codex/20261108T042720Z-tempo-scope-arch.md`.

### Current State
- Architecture: `GameApp.tsx` (488 lines) is the composition root. `speedId`/`follow` are plain `useState`
  (GameApp.tsx:101-102) and reset on every remount (one remount per edition). The P2 turn moments are a pure attempt
  reducer (`animation/turnMoments.ts`) plus `useTurnMoments` (pre-move tumble/stamps, movement gate) and
  `useRevealSequence` (post-move stages arrival → lottery-flip/settle → pickup). `turnMomentTiming(stepMs)`
  scales fixed normal bases by `stepMs / 450` (turnMoments.ts:83-97). Stage *presence* is built in GameApp from the
  **current** speed (GameApp.tsx:143-147) while *durations* are frozen from the attempt (useTurnMoments.ts:144-152).
  `deriveTurnMomentDisplay` (turnMomentPresentation.ts:145-259) is the single source of `canRoll`/`canSkip`/
  `itemUseLocked`, the publication phase and the announcements. The segment flash exists only inside the `arrival`
  stage (turnMomentPresentation.ts:267-282). Saves use `yamanote-line-sugoroku:save:v1` via guarded
  `StorageLike` calls (persistence.ts:21-28, 99-140). Keyboard rolling only works through native activation of the
  focused dice button.
- Relevant files: `src/features/game/gameConfig.ts`, `animation/turnMoments.ts`, `animation/useTurnMoments.ts`,
  `animation/useRevealSequence.ts`, `turnMomentPresentation.ts`, `components/TurnMomentHost.tsx`, `components/GameMenu.tsx`,
  `components/GamePanel.tsx`, `store/persistence.ts`, `store/browserStorage.ts`, `src/app/GameApp.tsx`,
  `map/RailwayMap.tsx` (`useSegmentFlash`).
- Patterns: pure reducers with thin hooks; one derivation function owns permissions and publication; storage failures
  become values (never throw); timing captured at roll and frozen per reveal key; tests are Vitest (jsdom per file,
  fake timers, `StorageLike` memory doubles) and Playwright (frozen clock, `reducedMotion: "reduce"` default, per-stage
  helpers in `tests/e2e/support/turnMoments.ts`).

### Feature Goal
Shorten the repetitive part of long games without changing any rule: a 4th speed 「とても速い」, a persisted 「演出」
level (すべて / 重要なときだけ / なし), speed/follow/演出 that survive reloads and new games, and global keyboard
shortcuts to roll and skip.

### Scope
- Include:
  - (a) Speed `very-fast` 「とても速い」 after `fast` in the cycle: 120 ms hop input, lottery flip+settle ≤ 400 ms,
    no arrival card. A per-speed timing table replaces the pure proportional factor (slow/normal/fast rows keep
    today's exact rounded values). The newly-completed-segment flash survives without the card as a card-less
    `segment-flash` reveal stage (Codex recommendation; only when new target segments exist).
  - (b)+(c) 「演出」 level, persisted, default 「すべて」:
    - 「すべて」: current behaviour unchanged (except very-fast drops the arrival card).
    - 「重要なときだけ」: keep lottery flip/settle, the new-segment flash, the pickup moment and the goal (ClearScreen);
      omit dice tumble, modifier stamps (they render on the omitted dice card) and the arrival card; map movement
      stays. A turn with nothing important ends with the movement.
    - 「なし」: omit every presentation stage; results publish when movement ends; movement animation, toasts and
      camera unchanged; not the same flag as OS reduced motion. OS reduced motion keeps overriding everything.
    - Goal: ClearScreen and its announcement stay in every mode; the goal-turn arrival banner follows the mode/speed
      (shown only in すべて at slow/normal/fast).
    - Speed and 演出 level are captured at roll time together with the timing; changes apply from the next turn.
  - (e) One global settings key `yamanote-line-sugoroku:settings:v1`, JSON `{version: 1, speedId, follow,
    presentationLevel}`, guarded read/write mirroring persistence.ts, per-field fallback to defaults, separate from
    saves, `SAVE_VERSION` unchanged, additive room for a later `autoRoll` field.
  - (f) `useGameShortcuts` in GamePanel: Space/Enter roll (no open dialog/surface, focus not on an interactive
    element); S or Escape skip during a presentation; non-focusable hint text in the menu.
  - A 「演出」 cycle button in the menu (disabled and 「省略」 under OS reduced motion, like 速度).
  - DESIGN.md decision rows for the timing table, the 演出 semantics, the settings key and the shortcut scope.
- Exclude:
  - Auto-roll 「おまかせで進む」 (stage 2, later PR).
  - Any rule, RNG, engine, save-format or `SAVE_VERSION` change.
  - Analytics changes (Codex: none needed).
  - Changing hop-distance movement math (120 ms is the `stepMs` input; `hopDurationMs` scaling stays).

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: 12-15 production files (5 new), 10-14 test files
- Estimated LOC: 450-660 production (touched lines), 620-930 test
- Implementation route: team-execute (Route C), run step by step at the user's pace — one plan step per approval,
  each step implemented, verified (unit + affected E2E specs locally; full 4-browser E2E in CI) and committed before
  the next.

### Integration Points
- `gameConfig.ts:60-69` `ANIMATION_SPEEDS`: add `very-fast`; default stays `normal`.
- `turnMoments.ts:83-97` `turnMomentTiming`: becomes a per-speed table lookup in a new `animation/turnMomentPolicy.ts`.
- `turnMoments.ts:138-156` `buildTurnRevealStages`: takes the captured policy and new-segment facts.
- `turnMoments.ts:178-235` begin/observe: selective bypass of tumble/stamps without hiding the adjust decision
  (`visibleDecision` only exposes it at `awaiting-adjust`, turnMomentPresentation.ts:130-137).
- `useTurnMoments.ts:134-160`: capture the policy at `begin`; freeze `{key, policy, stages}` per reveal key from the
  effective observed attempt; return frozen timing for overlay models.
- `turnMomentPresentation.ts:70-80, 183-228, 267-281`: `segment-flash` publication phase; flash independent of the card.
- `GameApp.tsx:101-102, 143-176, 348-368`: settings from `useGameSettings`; no current-speed fallback timing.
- `GamePanel.tsx:136-141`: mounts `useGameShortcuts` (owns `activeSurface`/`itemDialog`).
- `GameMenu.tsx:96-111`: 演出 button and shortcut hint.
- `store/persistence.ts` patterns reused by a new `store/settings.ts` (no shared write path with saves).

### Risks
- Premature publication if 「なし」 is routed through `restoredOrOmitted`: keep the user level out of that flag;
  phase `moving` must still mask results and lock items.
- Hidden adjust decision if omission reuses `motionOmitted` without an explicit `awaiting-adjust` transition: cover
  with reducer and integration tests for 重要なときだけ / なし with a held 出目調整券.
- Stage presence vs captured settings drift: build and freeze the reveal plan from the attempt's captured policy
  (match session and record turn), never from current settings.
- Flash cancelled early when the request turns null: the card-less stage keeps the request for its whole duration.
- Settings leakage between tests: settings-key cleanup in top-level hooks of every jsdom suite that mounts GameApp;
  E2E fresh contexts start clean; reload tests keep their state.
- Global Space/Enter double firing or stealing native activation: reject interactive targets/ancestors, composition,
  repeat, modifiers, open surfaces and dialogs; bubble-phase listener yields to menu/drawer capture listeners.
- Existing assertions that legitimately change: `SPEED_CASES` (slow = 3 clicks), proportional E2E helpers,
  the exact 4-button menu list (becomes 5). Closed-menu tab order and `persistence.test.ts:215` must stay unchanged.

### Success Criteria
- 「すべて」 at slow/normal/fast is behaviourally identical (existing unit and E2E suites pass, changed only where the
  speed cycle or menu list legitimately changed).
- `very-fast`: lottery flip+settle ≤ 400 ms, no arrival banner, new-segment flash still shown when segments complete.
- 重要なときだけ / なし produce the stage matrix above; adjust and discard decisions are never lost; results never
  publish during movement.
- Speed, follow and 演出 survive reload, new game and edition switch; corrupt or unavailable storage falls back to
  defaults without errors; saves untouched.
- Space/Enter roll and S/Escape skip work only in the allowed contexts, with no double rolls; existing keyboard
  a11y E2E tests stay green.
- `npm run typecheck`, `npm test` and the affected E2E specs pass locally; CI green on all four E2E legs.
