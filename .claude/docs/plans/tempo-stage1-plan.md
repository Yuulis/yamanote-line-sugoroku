# Tempo Stage 1 (issue #64) — Implementation Plan

Status: **awaiting user approval** (nothing implemented). Branch to create: `feature/tempo-stage1` from `develop`.

- Brief (validated, COMPLEX): `.claude/docs/research/feature-tempo-fast-forward-auto-roll-brief.md`
- Codebase scan: `.claude/docs/research/feature-tempo-fast-forward-auto-roll-codebase.md`
- Codex consults (Sol, low effort, read-only): scope + architecture
  `.claude/logs/codex/20261108T042720Z-tempo-scope-arch.md`; plan `.claude/logs/codex/20261108T043125Z-tempo-plan.md`;
  validation: see "Codex Validation" at the end.
- Handoff: `.claude/docs/plans/tempo-stage1-handoff.md`
- DESIGN input (dry-run only, applied by the lead after approval): `.claude/logs/design-input-tempo-fast-forward-auto-roll.json`

## 1. Scope

In: (a) 4th speed 「とても速い」; (b)+(c) persisted 「演出」 level すべて / 重要なときだけ / なし; (e) one global settings key
for speed, follow and 演出; (f) Space/Enter roll, S/Escape skip, menu hint.
Out: auto-roll 「おまかせで進む」 (stage 2); any rule, RNG, engine, save-format or `SAVE_VERSION` change; analytics;
movement math (`hopDurationMs` distance scaling and `MAX_MOVE_DURATION_MS` stay).

### Decisions resolved during planning (Codex recommendations, within the settled scope)

1. **Segment flash survives without the arrival card** as a card-less reveal stage `segment-flash`. It exists only
   when the arrival card is absent (very-fast, or 重要なときだけ) **and** the accepted record newly completed target
   segments that have geometry. No new segments means no stage and no wait.
2. **Modifier stamps** (×2 / ±1 / 寝過ごし / 遅延 / 快速) are omitted in 重要なときだけ, together with the tumble,
   because they render on the dice card (`TurnMomentHost.tsx:265-276`). Their meaning stays in the HUD roll text,
   log and announcement.
3. **Goal:** ClearScreen and its announcement stay in every mode (assumption confirmed). The goal turn's arrival
   banner follows the mode and speed: すべて at slow/normal/fast shows it as today; すべて at very-fast and
   重要なときだけ show only the optional flash, then ClearScreen; なし shows ClearScreen right after the movement.
4. **Capture at roll:** speed and 演出 level are captured into the attempt at roll time together with the timing
   (extends DESIGN row "P2 の演出時間は速度設定に連動する"); a change applies from the next turn. OS reduced motion
   stays a live, sticky override.
5. **なし is not reduced motion:** the user level never feeds `reducedMotion`, `restoredOrOmitted` or
   `attemptMotionReduced`. Movement animation, map follow `immediate`, ToastHost motion and the menu stay as today;
   results stay masked and items locked while the movement runs.
6. **Menu:** 「演出: すべて」 is a cycle button next to 速度 (accessible name 「演出: すべて（押すと切り替え）」); under OS
   reduced motion it is disabled and shows 「演出: 省略」 without overwriting the stored value. The shortcut hint is
   plain, non-focusable text: 「Space / Enter: サイコロ　S / Escape: スキップ」.
7. **Analytics:** no change.

### Stage matrix (post-roll presentation per captured policy; OS reduced motion = today's full omission)

| Level | Speed | Tumble | Stamps | Arrival card | Segment flash | Lottery flip+settle | Pickup | Goal |
|-------|-------|--------|--------|--------------|---------------|---------------------|--------|------|
| すべて | slow / normal / fast | yes | if modifiers | yes (flash concurrent, as today) | inside arrival | if drawn | if picked up | banner → ClearScreen |
| すべて | very-fast | yes | if modifiers | **no** | card-less, if new segments | if drawn | if picked up | flash? → ClearScreen |
| 重要なときだけ | any | no | no | no | card-less, if new segments | if drawn | if picked up | flash? → ClearScreen |
| なし | any | no | no | no | no | no | no | ClearScreen |

Order after movement: `arrival` | `segment-flash` → `lottery-flip` → `lottery-settle` → `pickup`, absent stages skipped.
Adjust (`RollAdjustment`) and discard (`DiscardChoice`) decisions are never omitted in any level.

### Timing table (ms; slow/normal/fast reproduce today's `Math.round(base × stepMs / 450)` exactly)

| Speed | Hop input | Tumble | Stamps | Arrival | Lottery flip | Settle | Pickup | Flash |
|-------|----------:|-------:|-------:|--------:|-------------:|-------:|-------:|------:|
| slow | 600 | 800 | 320 | 1067 | 2133 | 533 | 667 | 1067 |
| normal | 450 | 600 | 240 | 800 | 1600 | 400 | 500 | 800 |
| fast | 300 | 400 | 160 | 533 | 1067 | 267 | 333 | 533 |
| very-fast | 120 | 160 | 64 | absent | 280 | 100 | 140 | 180 |

Very-fast lottery = 380 ms (≤ 400). Flash = arrival duration where the card exists (it runs inside the card's stage).
Speed cycle becomes normal → fast → very-fast → slow → normal.

## 2. Architecture

Three separate concepts:

- **User settings** (`GameSettings`): mutable preferences for future turns, persisted.
- **Captured turn policy** (`TurnPresentationPolicy`): immutable speed, level, timing and stage permissions owned by
  one roll attempt; the frozen reveal plan `{key, policy, stages}` is owned by one record key.
- **Live OS override**: today's sticky reduced-motion handling, unchanged.

`deriveTurnMomentDisplay` stays the single source of publication, permissions and announcements.

### Module structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/features/game/gameSettings.ts` | new | `PresentationLevel`, `GameSettings`, defaults (normal / follow on / all), labels, cycle helpers |
| `src/features/game/store/settings.ts` | new | `SETTINGS_STORAGE_KEY`, versioned parse (per-field fallback), guarded `readSettings` / `writeSettings`; imports `StorageLike` as a type only |
| `src/features/game/useGameSettings.ts` | new | lazy read, functional updates, idempotent persistence (StrictMode-safe) |
| `src/features/game/animation/turnMomentPolicy.ts` | new | per-speed timing table, `turnMomentTiming(speedId)`, `captureTurnPresentationPolicy` |
| `src/features/game/useGameShortcuts.ts` | new | pure `gameShortcutAction` filter + bubble-phase window listener |
| `src/features/game/gameConfig.ts` | modify | add `very-fast` 「とても速い」 120 ms after `fast` |
| `src/features/game/animation/turnMoments.ts` | modify | policy on attempts; selective tumble/stamps bypass that still enters `awaiting-adjust`; `buildTurnRevealStages(facts, policy)` incl. `segment-flash` |
| `src/features/game/animation/useTurnMoments.ts` | modify | capture policy at `begin`; build and freeze the reveal plan from the effective observed attempt (session + record turn match); fallback policy frozen once per unmatched record key; return frozen timing |
| `src/features/game/animation/useRevealSequence.ts` | modify | stage key typing; optional explicit `omit` (default false) |
| `src/features/game/turnMomentPresentation.ts` | modify | `segment-flash` publication phase; flash request independent of the card; omitted-stage announcements |
| `src/app/GameApp.tsx` | modify | settings from `useGameSettings`; drop `speedById`/`nextSpeedId`, the `revealStages` build and the current-speed fallbacks; stays ≤ 488 lines (expected ~465-480) |
| `src/features/game/components/GamePanel.tsx` | modify | forward 演出 props; mount `useGameShortcuts` (owns `activeSurface`, `itemDialog`) |
| `src/features/game/components/GameMenu.tsx` | modify | 演出 cycle button; shortcut hint text |
| `src/features/game/components/TurnMomentHost.tsx` | modify (S3) | `turnMomentDiceModel` reads durations from `attempt.policy.timing` (:274); `turnMomentArrivalModel` keeps its strict `arrival` check, so `segment-flash` never renders a banner |
| `src/features/map/RailwayMap.tsx` | unchanged | the flash runner works when the request stays non-null for the whole stage |

### Interfaces

```ts
// gameSettings.ts
export type PresentationLevel = "all" | "important" | "none";
export interface GameSettings {
  readonly speedId: AnimationSpeedId;
  readonly follow: boolean;
  readonly presentationLevel: PresentationLevel;
}
export const DEFAULT_GAME_SETTINGS: GameSettings;
export function nextPresentationLevel(level: PresentationLevel): PresentationLevel;

// store/settings.ts
export const SETTINGS_STORAGE_KEY = "yamanote-line-sugoroku:settings:v1";
export type SettingsReadStatus = "loaded" | "missing" | "invalid" | "unavailable";
export interface SettingsReadResult { readonly settings: GameSettings; readonly status: SettingsReadStatus }
export function parseSettings(json: string): SettingsReadResult;
export function readSettings(storage: StorageLike | null): SettingsReadResult;
export function writeSettings(storage: StorageLike | null, settings: GameSettings): "saved" | "unavailable" | "failed";

// useGameSettings.ts
export function useGameSettings(storage: StorageLike | null): {
  settings: GameSettings;
  cycleSpeed: () => void;
  toggleFollow: () => void;
  stopFollowing: () => void;
  cyclePresentation: () => void;
  writeStatus: "unchanged" | "saved" | "unavailable" | "failed";
};

// animation/turnMomentPolicy.ts
export interface TurnMomentTiming {
  readonly stepMs: number; readonly tumbleMs: number; readonly stampsMs: number;
  readonly arrivalMs: number | null;            // null = no arrival card at this speed
  readonly lotteryFlipMs: number; readonly lotterySettleMs: number;
  readonly pickupMs: number; readonly flashMs: number;
}
export interface TurnPresentationPolicy {
  readonly speedId: AnimationSpeedId; readonly level: PresentationLevel; readonly timing: TurnMomentTiming;
  readonly showTumble: boolean; readonly showStamps: boolean; readonly showArrival: boolean;
  readonly showImportantMoments: boolean;       // segment flash, lottery, pickup
}
export function turnMomentTiming(speedId: AnimationSpeedId): TurnMomentTiming;
export function captureTurnPresentationPolicy(
  settings: Pick<GameSettings, "speedId" | "presentationLevel">): TurnPresentationPolicy;

// useGameShortcuts.ts
export interface GameShortcutContext {
  readonly canRoll: boolean; readonly canSkip: boolean;
  readonly surfaceOpen: boolean; readonly itemDialogOpen: boolean;
}
export function gameShortcutAction(event: KeyboardEvent, context: GameShortcutContext): "roll" | "skip" | null;
export function useGameShortcuts(context: GameShortcutContext,
  handlers: { onRoll: () => void; onSkip: () => void }): void;
```

`RollAttempt` and the `begin` action carry `policy` (timing moves into it; no long-lived `attempt.timing` alias).
`TurnRevealFacts` gains the captured new-segment ids.

### Data flow

1. GameApp gets guarded storage (`getBrowserStorage`) → `useGameSettings` (lazy read, no write on mount).
2. `guardedRoll` → `begin` snapshots `captureTurnPresentationPolicy(settings)` into the attempt.
3. Accepted observations release pre-move stages per policy (`awaiting-adjust` preserved).
4. Movement runs at the captured `stepMs` unless the OS override applies.
5. The matching accepted record + captured facts → one frozen reveal plan → `useRevealSequence`.
6. `deriveTurnMomentDisplay` publishes values, decisions, announcements, toasts and ClearScreen at the boundaries.
7. Settings changes persist immediately and affect the next attempt.

### Error handling

- Null storage or a throwing getter → `unavailable` + defaults. Invalid JSON, a non-object or an unsupported
  `version` → `invalid` + defaults. A supported version validates each field independently; unknown fields are
  ignored; nothing is coerced.
- `writeSettings` failures return `failed`; the in-memory preference stays for this mount; the next *effective*
  settings change retries (never per render, never on mount — a remount reads the last successfully stored value);
  no toast (save-failure toasts stay save-only). No storage access at module import.
- Payload rules: a JSON array, `null` or a primitive is `invalid`; a supported-version object with some bad fields is
  `loaded` with those fields defaulted (per-field fallback); `stopFollowing` is idempotent (repeated camera events
  while already OFF cause no write).
- Stage 2 can add an optional `autoRoll` field to payload `version: 1` (missing → false); a semantic change bumps the
  payload version under the same key.

### Keyboard filter contract (`gameShortcutAction`)

- Reject: `defaultPrevented`, `isComposing` or `keyCode === 229`, `repeat`, Ctrl/Alt/Meta/Shift; any open surface
  (menu, log, item card), the item dialog, or a native `dialog[open]` (`modalDialogOpen()`).
- Space / Enter → `roll` only when the target and its ancestors are not interactive (button, a[href], input, select,
  textarea, summary, contenteditable, interactive ARIA roles, `tabindex >= 0`). The mounted heading
  (`tabindex="-1"`) and `body` stay eligible. Accepted Space calls `preventDefault()` (no `.game-panel` scroll).
- `s` / `S` (semantic `key`, not `code`; full-width rejected) and Escape → `skip`; allowed from ordinary buttons,
  rejected in editable targets. Bubble-phase listener, so GameMenu/TurnLogDrawer capture-phase Escape and native
  dialog cancel keep priority; the draft-clear listener is inactive during presentations.
- Handlers and permissions are read from refs; the existing guarded `onRoll`/`onSkip` (canRoll/canSkip refs) stay
  authoritative.


## 3. Implementation steps (revision 3 — after Codex validation rounds 1 and 2)

Each step: user approval → implement (tests first) → its local checks → user review → its own commit. Steps never
leave a half-exposed control. LOC = touched production / test lines (not net growth). `npm run typecheck` covers
`tests/` too (`tsconfig.app.json` `include: ["src", "tests"]`), so every fixture a step's type change touches belongs
to that step. If a step exceeds 250 production LOC, split it at a releasable boundary and re-approve.

| Step | Title | Prod LOC | Test LOC |
|------|-------|---------:|---------:|
| S1 | Settings types and guarded storage (not wired) | 115 | 150 |
| S2 | Persist the existing speed and follow controls | 100 | 190 |
| S3 | Turn policy + speed-id timing table (attempt.policy replaces attempt.timing; no behaviour change) | 120-160 | 170 |
| S4 | Frozen reveal plan owned by `useTurnMoments` (no behaviour change) | 110 | 170 |
| S5 | Card-less `segment-flash` stage (not yet reachable) | 105 | 150 |
| S6 | Expose the 4th speed 「とても速い」 | 50 | 220-350 |
| S7 | 重要なときだけ / なし internals (GameApp still passes すべて) | 125 | 300-450 |
| S8 | Expose and persist the 演出 menu control | 60 | 170 |
| S9 | Keyboard shortcuts and menu hint | 110 | 200 |
| S10 | Final local validation and full diff review | 0 | 0 |
| | **Total** | **~895-935** | **~1,720-2,000** |

### S1 — Settings types and guarded storage (not wired)

- Files: new `src/features/game/gameSettings.ts`, new `src/features/game/store/settings.ts`, new
  `tests/unit/game-settings.test.ts`.
- Tests first: defaults are normal / follow on / all; presentation cycle returns to all; valid v1 round trip;
  invalid fields fall back independently (status `loaded`); invalid JSON / array / `null` / primitive / unknown
  version → defaults + `invalid`; unknown fields ignored without coercion (`"true"`, `1`); missing / null / throwing
  `getItem` storage → `missing` / `unavailable`; throwing `setItem` (quota) returns `failed` without throwing; a write
  touches only `SETTINGS_STORAGE_KEY`. Fresh memory storage per case. Accepted speed ids = current
  `ANIMATION_SPEEDS` (very-fast acceptance added in S6).
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/game-settings.test.ts tests/unit/persistence.test.ts`.
  No E2E (nothing wired).
- Risks: sharing the save write path; coercion. `persistence.test.ts:215` stays unchanged.

### S2 — Persist the existing speed and follow controls

- Files: new `src/features/game/useGameSettings.ts`; modify `src/app/GameApp.tsx` (replace `speedId`/`follow`
  state and `toggleFollow`/`stopFollowing`/`cycleSpeed` at GameApp.tsx:101-102, 270-272; the level is held but GameApp
  keeps passing すべて until S8); new `tests/unit/use-game-settings.test.ts`; settings-key cleanup in file-level
  `beforeEach`/`afterEach` (after unmount) of the jsdom suites that mount GameApp/EditionApp:
  `game-app-turn-moments`, `game-app-item-progress`, `map-flash`, `game-hud`, `edition-app`
  (`game-session-items` mounts only `useGameApp` with injected storage — no cleanup needed); new
  `tests/e2e/support/settings.ts` (`seedGameSettings(page, settings)` via `page.addInitScript`, guarded storage access,
  writes only when the key is absent so `reload()` keeps UI changes; independent of production modules); new
  `tests/e2e/game-settings.spec.ts`.
- Follow semantics (Q1, user decision 2026-11-08, overrides the Codex default): only the menu toggle persists
  追尾. A manual pan's 追尾 OFF is a transient, session-only state (separate from the stored value) and is never
  written; the next mount starts from the stored value. `stopFollowing` is idempotent and performs no storage write.
- Tests first: mount reads without writing; unchanged update does not write; StrictMode replay does not duplicate
  writes; failed write keeps state and the next effective change retries (also under StrictMode); repeated pan
  callbacks never write (pan OFF is transient; the menu toggle after a pan writes the toggled value); new game and edition remount keep speed and follow; E2E: change speed and follow in the menu,
  reload, labels and payload persist (also proves the seed helper does not overwrite UI changes).
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/use-game-settings.test.ts tests/unit/game-settings.test.ts tests/unit/persistence.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/map-flash.test.ts tests/unit/game-hud.test.ts tests/unit/edition-app.test.ts`;
  `npx playwright test tests/e2e/game-settings.spec.ts tests/e2e/resume.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: cross-test contamination; duplicate writes. Unit tests that click 速度 once still see 「はやい」.

### S3 — Turn policy + speed-id timing table (no behaviour change)

- Files: new `src/features/game/animation/turnMomentPolicy.ts` (`turnMomentTiming(speedId)` with the three legacy
  rows, `flashMs` = arrival, `captureTurnPresentationPolicy` returning すべて permissions); modify
  `animation/turnMoments.ts` (`RollAttempt.policy` and the `begin` action replace `timing`; remove the proportional
  `NORMAL_BASES` factor at :82-97), `animation/useTurnMoments.ts` (`begin` captures the policy from `speedId`;
  `durationForStage` reads `policy.timing`), `turnMomentPresentation.ts:281` (flash duration from
  `policy.timing`), `components/TurnMomentHost.tsx:274` (tumble/stamp durations — a runtime expression change),
  `src/app/GameApp.tsx` (pass `speedId`; the movement step read at :196 becomes `liveAttempt.policy.timing.stepMs`;
  GameApp still builds the reveal stages in S3 with `turnMomentTiming(speedId)` at :147/:351-361 until S4 moves them).
  `useTurnMoments` option `stepMs` becomes `speedId`; migrate `tests/unit/turn-moment-hooks.test.ts:58` (options),
  `:134`, `:403` (updates) and `:135` (`attempt.timing` assertion) in this commit.
  Nullable-arrival strategy (keeps S3 type-correct while all three rows still have numbers): the stage builder
  constructs an `arrival` stage only when `arrivalMs !== null`; `durationForStage` normalises a null duration (keeps
  the stage's own value); the flash request uses the non-null `flashMs`.
  Attempt fixtures: `tests/unit/turn-moment-presentation.test.ts:34`, `tests/unit/map-flash.test.ts:172`,
  `tests/unit/turn-moment-items.test.ts:27`; numeric callers `tests/unit/turn-moments.test.ts:78-82` (proportional
  `it.each` over every speed → literal legacy rows), `:278`, `:288`, `:309`, and `game-app-turn-moments.test.ts`.
  No `number | id` overload, no long-lived `attempt.timing` alias. New `tests/unit/turn-moment-policy.test.ts`.
- Tests first: legacy rows equal today's rounded values as independent literals; policy capture is immutable; a
  mid-turn speed change keeps the attempt's movement step and durations; existing publication and announcement
  assertions unchanged.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/turn-moment-policy.test.ts tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/turn-moment-components.test.ts tests/unit/turn-moment-items.test.ts tests/unit/map-flash.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/move-animation-gate.test.ts`;
  `npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: a missed `attempt.timing` consumer (typecheck catches it); rounding drift (literal rows catch it).

### S4 — Frozen reveal plan owned by `useTurnMoments` (no behaviour change)

- Files: modify `animation/turnMoments.ts` (`buildTurnRevealStages(facts, policy)`; facts gain captured new-segment
  ids), `animation/useTurnMoments.ts` (build and freeze `{key, policy, stages}` per reveal key from the **effective
  observed attempt** — the post-observe state of the same render, matched by session id and record turn; fallback
  policy captured once per unmatched record key; return the frozen timing), `src/app/GameApp.tsx` (remove the
  `revealStages` build at :139-147 and the S3-form `turnMomentTiming(speedId)` lottery/pickup fallbacks at :351-361;
  forward to the hook what GameApp used for that build — the latest record (`session.lastMove.itemRecord`, not only
  the phase-gated accepted record), the restoration classification (`latestRecord.turn <= entryTurn`), and the
  `turnMomentBoundary` seam flag that suppresses real stages at :142-147).
  Freeze eligibility: a reveal key's plan is frozen only once its record is present **and** either no attempt matches
  it (fallback policy) or the matching attempt (same session, `recordTurn`) has `recordAccepted` with its movement
  facts applied in the effective observed state; before that the hook exposes no frozen plan (stages are consumed only
  after movement completes, so deferring adds no wait). Test files:
  `tests/unit/turn-moment-hooks.test.ts`, `tests/unit/game-app-turn-moments.test.ts`, `tests/unit/turn-moments.test.ts`.
- Tests first: an earlier render (reveal key present, record not yet accepted by the attempt) cannot freeze an
  empty plan that suppresses the accepted record's reveal; the first accepted render supplies the frozen plan (later
  unrelated renders do not alter it); a new
  record does not inherit the previous attempt's policy; same turn number in a replacement session inherits no
  policy, flash, Skip or sticky OS omission; an unmatched record's fallback is frozen once; the boundary seam still
  suppresses real stages; a restored pending adjustment still gets its fresh arrival after resolution without a
  tumble (`turn-moment-hooks.test.ts:337-362`); restore / classic / Skip / OS override unchanged.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/reveal-sequence.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/map-flash.test.ts tests/unit/move-animation-gate.test.ts`;
  `npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/lottery.spec.ts tests/e2e/resume.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: freezing before accepted facts exist (an empty plan cannot repair itself); stale ownership; GameApp
  test-seam regression.

### S5 — Card-less `segment-flash` stage (not yet reachable)

- Files: modify `animation/turnMoments.ts` (conditional `segment-flash` from accepted segment facts and policy; pure
  geometry-eligibility helper), `animation/useTurnMoments.ts` (supply facts and eligibility),
  `turnMomentPresentation.ts` (new phase in `publicationPhase`; flash for `arrival` or `segment-flash` with the
  captured `flashMs`), `animation/useRevealSequence.ts` (typing), `components/TurnMomentHost.tsx` only if
  exhaustiveness needs it. `RailwayMap.tsx` unchanged.
- Tests first (synthetic policies with arrival disabled; no UI): flash requires new target segments with geometry;
  no new / renderable segments → no empty stage; arrival keeps its concurrent flash with no extra stage; card-less
  flash never renders a banner (not even one frame); flash masks results and locks items until its boundary; the
  request lasts until stage completion; Skip during the flash clears it, publishes results and keeps a pending
  discard mandatory; replacement and OS reduction clear it; one publication-safe announcement at the boundary.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/turn-moment-components.test.ts tests/unit/reveal-sequence.test.ts tests/unit/map-flash.test.ts`;
  `npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: early flash cancellation; a banner frame; early publication.

### S6 — Expose the 4th speed 「とても速い」

- Files: modify `gameConfig.ts` (append `very-fast`, 「とても速い」, 120 ms), `animation/turnMomentPolicy.ts` (fourth
  row); unit tests (`turn-moment-policy`, `game-settings`, `turn-moments`, `turn-moment-hooks`);
  `tests/e2e/support/turnMoments.ts`: **keep** the legacy exports (`NORMAL_STEP_MS`, `speedFactor`,
  `stageDurationMs`, valid for slow/normal/fast) so the 8 importing specs (`accessibility`, `capital-region`, `dice`,
  `items`, `lottery`, `resume`, `save-errors`, `ui-pop-turn-moments`) keep compiling, and **add** an independent
  literal per-speed oracle (`STAGE_MS_BY_SPEED`, `stageMsForSpeed(stage, speedId)`) plus stage helpers that handle an
  absent arrival and the conditional flash; never import production timing.
  `tests/e2e/ui-pop-turn-moments.spec.ts`: `SPEED_CASES` :749-753 → normal 0, fast 1, very-fast 2, slow 3 clicks;
  S16 (:781-860) — the mid-turn click from fast now selects very-fast while the active turn keeps fast; the stage
  loop at :839 must become a per-speed stage list (very-fast: no `arrival`, flash checkpoint on `segment-flash`),
  the timer evidence uses the per-speed oracle — both the lookup (:842-850) and the recorder (:795-801), which
  classifies a timer by overlay DOM and so cannot see the DOM-less `segment-flash` (classify it from the map flash
  state, e.g. non-empty `readMap(page).flashFilterIds` with no overlay; no test-only production DOM without
  approval), and the announcement-index
  assertions (:855-858) are named per stage instead of fixed indexes; add a very-fast → slow case proving no
  arrival until the next turn. `tests/e2e/game-settings.spec.ts`: very-fast survives reload.
- Tests first: cycle normal → fast → very-fast → slow; very-fast lottery totals 380 ms; very-fast omits arrival and
  keeps the new-segment flash; very-fast without new segments has no flash delay; **very-fast + 出目調整券: no
  dialog at 159 ms, usable dialog after the 160 ms tumble, then captured stamps/movement timing**; mid-turn speed
  change applies from the next turn. One-click 「はやい」 assertions unchanged.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/turn-moment-policy.test.ts tests/unit/game-settings.test.ts tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/map-flash.test.ts`;
  `npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/game-settings.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/dice.spec.ts --project=desktop-chromium --project=phone-chromium`
  (plus every other helper-importing spec if the shared helper exports change shape).
- Risks: wrong click counts; an oracle that mirrors a production bug; changed legacy rows; S16 rewrite weakening
  assertions (keep every existing check for the legacy speeds).

### S7 — 重要なときだけ / なし internals (GameApp still passes すべて)

- Files: modify `animation/turnMomentPolicy.ts` (level permissions), `animation/turnMoments.ts` (bypass tumble and
  stamps, mark tumble completed, enter `awaiting-adjust` when a decision is observed, release after record
  acceptance; do **not** set `motionOmitted` for 重要なときだけ because the flash rejects it at
  turnMomentPresentation.ts:275), `animation/useTurnMoments.ts` (captured level; movement gate unchanged),
  `animation/useRevealSequence.ts` (explicit `omit` if needed), `turnMomentPresentation.ts` (omitted-stage
  publication and announcements); integration tests inject the policy through existing hook mocks or harnesses
  (no public test control). Keep pure helpers for stage selection; the hook only coordinates capture and ownership.
- Tests first — named scheduling cases plus a parameterised policy table (not a full Cartesian product):
  重要なときだけ uneventful turn publishes at movement end; なし masks results and locks items during movement; both
  levels keep the adjust decision usable; restored pending adjustment under each level (no tumble, usable decision,
  correct later stages); oversleep and forced delay turns release movement without waiting for hidden stamps;
  deadhead releases as today; prior-engine-turn discard (`animation.turn === attempt.recordTurn - 1`) keeps the
  captured speed, no early item publication, discard visible after publication; goal with and without new segments
  in every level, ClearScreen announcement exactly once; omitted stages never announce hidden results; a mid-turn
  level change keeps the captured policy; a settings change while adjust/discard is open neither recreates the
  dialog nor moves focus nor changes the active policy; classic / Skip / OS override unchanged.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/turn-moment-policy.test.ts tests/unit/turn-moments.test.ts tests/unit/turn-moment-hooks.test.ts tests/unit/reveal-sequence.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/map-flash.test.ts tests/unit/move-animation-gate.test.ts`;
  `npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --project=phone-chromium`
  (すべて regression only; the new levels are unreachable in the browser until S8).
- Risks: premature publication; hidden adjust decision; stuck pre-move state on forced turns; lost discard; user
  omission confused with OS reduction. If test LOC exceeds ~450, split into S7a (重要なときだけ) and S7b (なし).

### S8 — Expose and persist the 演出 menu control

- Files: modify `src/app/GameApp.tsx` (pass the persisted level to policy capture), `components/GamePanel.tsx`
  (forward props), `components/GameMenu.tsx` (cycle button; disabled 「演出: 省略」 under OS reduced motion, stored
  choice kept); `tests/unit/game-hud.test.ts` :305-308 → exact five-button list
  `["追尾: ON","速度: ふつう","演出: すべて","新規","タイトル"]` and count 5; integration suites using real persisted
  settings (not injected policies) to prove the S7 paths; `tests/e2e/game-settings.spec.ts`,
  `tests/e2e/ui-pop-turn-moments.spec.ts` (animated cases use `reducedMotion: "no-preference"`; a separate
  OS-reduction case).
- Tests first: menu cycles すべて → 重要なときだけ → なし → すべて; reduced motion disables the control without
  overwriting the preference; the UI change survives reload, new game and edition switch; 重要なときだけ keeps only
  important moments; なし keeps movement and defers publication; a mid-turn change applies next turn; すべて at the
  legacy speeds is unchanged.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/game-hud.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/game-app-item-progress.test.ts tests/unit/edition-app.test.ts tests/unit/use-game-settings.test.ts`;
  `npx playwright test tests/e2e/game-settings.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: extra tab stops (closed-menu order `ui-pop.spec.ts:799-852` must stay unchanged); the OS preference
  overwriting the stored value.

### S9 — Keyboard shortcuts and menu hint

- Files: new `src/features/game/useGameShortcuts.ts`; modify `components/GamePanel.tsx` (context from
  `turnDisplay.canRoll/canSkip`, `activeSurface`, `itemDialog`; handlers `onRoll`/`onSkip`),
  `components/GameMenu.tsx` (hint text); new `tests/unit/game-shortcuts.test.ts` (pure filter **and** a mounted
  window-listener integration); modify `tests/unit/game-hud.test.ts`, `tests/e2e/accessibility.spec.ts`.
- Tests first: Space / Enter roll from non-interactive focus (heading, body); native button activation does not
  double-roll; an interactive ancestor blocks the global roll; S / Escape skip only during a presentation;
  editable / composing / repeating / modified / prevented events ignored; an open surface or dialog owns the keys;
  latest permissions and handlers are used; StrictMode cleanup prevents duplicate actions; the hint adds no tab stop.
  Must stay green: `accessibility.spec.ts:37, 63, 347-363, 410-454, 492-517`; `items.spec.ts:120-144` (tooltip
  before draft clear), `:257-263` (discard survives Escape), `:379` (adjust heading Escape); `real-data.spec.ts:113-132`
  (legend activation); `layout.spec.ts:193-206` (attribution button); `ui-pop.spec.ts:299-303`;
  `ui-pop-turn-moments.spec.ts:190, 805` (focused dice rolls). Codex grep found no E2E that presses these keys on
  body/heading focus and expects no action.
- Local checks: `npm run typecheck`; `npx vitest run tests/unit/game-shortcuts.test.ts tests/unit/game-hud.test.ts tests/unit/game-app-turn-moments.test.ts`;
  `npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/items.spec.ts tests/e2e/real-data.spec.ts tests/e2e/layout.spec.ts --project=desktop-chromium --project=phone-chromium`.
- Risks: double activation; Space scrolling; stolen dialog Escape; stale permissions.

### S10 — Final local validation and full diff review

- No planned production changes; any fix stays bounded and reruns the affected checks.
- Commands: `npm run typecheck`; `npm test`;
  `npx playwright test tests/e2e/game-settings.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/resume.spec.ts tests/e2e/save-errors.spec.ts tests/e2e/dice.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/real-data.spec.ts tests/e2e/layout.spec.ts --project=desktop-chromium --project=phone-chromium`;
  `git diff --check develop...HEAD`; `git diff --stat develop...HEAD`;
  `wc -l src/app/GameApp.tsx src/features/game/animation/turnMoments.ts src/features/game/animation/useTurnMoments.ts src/features/game/turnMomentPresentation.ts`
  (GameApp ≤ 488, expected ~465-480; the others below 400, `turnMomentPresentation.ts` (332 today) watched closest);
  `python3 .claude/skills/_shared/verify_delegation.py --base develop --forbid-outside src --forbid-outside tests --label tempo-stage1`.
- Diff checklist: legacy rows / すべて publication / announcements intact; `persistence.test.ts:215` and
  `ui-pop.spec.ts:799-852` unchanged; no deleted or weakened tests, placeholders, swallowed errors or
  production-derived E2E oracle; no engine / RNG / save / analytics change and no auto-roll; no settings-driven change
  to movement math, camera or toast motion. Firefox / WebKit and the full matrix are CI (check after every push).

## 4. Test plan — known breakages and invariants

| Item | Location | Handling | Step |
|------|----------|----------|------|
| Attempt fixtures with `timing` | `turn-moment-presentation.test.ts:34`, `map-flash.test.ts:172`, `turn-moment-items.test.ts:27` | migrate to `policy` | S3 |
| Proportional unit timing | `turn-moments.test.ts:78-82`, `:278`, `:288`, `:309` | literal legacy rows; speed-id API | S3 |
| `SPEED_CASES` click counts | `tests/e2e/ui-pop-turn-moments.spec.ts:749-753` | slow 2 → 3 clicks; add very-fast (2) | S6 |
| S16 composition test | `ui-pop-turn-moments.spec.ts:781-860` | per-speed stage list, flash checkpoint, oracle timers, named announcements | S6 |
| Proportional E2E helpers | `tests/e2e/support/turnMoments.ts:25-56` (8 importing specs) | keep legacy exports; add independent per-speed oracle | S6 |
| Exact menu buttons | `tests/unit/game-hud.test.ts:305-308` | 4 → 5 buttons (演出 after 速度) | S8 |
| Tab order from the dice | `tests/e2e/ui-pop.spec.ts:799-852` | **unchanged** (menu closed; hint non-focusable) | S8, S9 |
| Settings leakage | jsdom suites mounting GameApp/EditionApp (5 files) | file-level settings-key cleanup | S2 |
| Save key assertion | `tests/unit/persistence.test.ts:215` | **unchanged** (separate module) | S1 |
| One-click 「はやい」 | `game-app-item-progress.test.ts:720-763`, `map-flash.test.ts:618-628`, `game-app-turn-moments.test.ts:1486` | unchanged (very-fast inserted after fast) | S6 |
| Test seam | `GameApp.tsx:142-147` `turnMomentBoundary` | preserved through the hook | S4 |
| Restored adjustment arrival | `turn-moment-hooks.test.ts:337-362` | unchanged | S4 |
| E2E roll helpers | `tests/e2e/support/app.ts:168-257` | unaffected (fresh contexts = defaults; no auto-roll) | — |
| Keyboard regressions | accessibility / items / real-data / layout / ui-pop / ui-pop-turn-moments (lines in S9) | must stay green | S9 |

## 5. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| なし routed through `restoredOrOmitted` | results and items published during movement | keep the user level out of that flag; S7 masking tests |
| Selective omission hides the adjust decision | 出目調整 lost / stuck turn | explicit `awaiting-adjust` transition; held 出目調整券 tests per level, incl. restored adjustment and very-fast |
| Forced turns wait for hidden stamps | stuck pre-move state | named oversleep / delay / deadhead cases (S7) |
| Reveal plan frozen before accepted facts | wrong flash presence, previous turn's policy | freeze from the effective observed attempt matched by session + record turn (S4) |
| Flash request flips to null mid-stage | flash cut short | complete timed `segment-flash` stage; lifecycle test (S5) |
| Persisted settings leak between tests | flaky timing tests | file-level cleanup; the seed helper only writes when absent |
| Global Space/Enter vs native activation | double roll, stolen keys | interactive-target filter; bubble phase; guarded handlers; regression specs (S9) |
| E2E helper reshaping | 8 specs break | legacy exports kept; new oracle added alongside (S6) |
| File growth | maintainability | logic moves to hooks / pure helpers; `wc -l` gate in S10 |
| Real-device performance at very-fast | jank | not measurable locally (software WebGL); noted in the handoff |

## 6. Open questions for the user

- **Q1 (follow on manual pan) — resolved by the user 2026-11-08:** persist only the menu toggle. A manual pan's
  追尾 OFF stays session-only (separate saved and transient values), so the next game starts from the stored value.

## 7. Codex Validation

- Round 1 (`.claude/logs/codex/20261108T043626Z-tempo-validate.md`): **NEEDS_REVISION**. Applied in revision 2:
  S3 split into S3 (policy/timing migration incl. `TurnMomentHost.tsx:274`, `turnMomentPresentation.ts:281` and the
  three attempt fixtures) and S4 (frozen reveal plan, test seam, restored adjustment); S1 payload status for arrays /
  partial payloads; S2 retry-on-next-change (not on remount), idempotent pan-off, Q1 default; S6 S16 rewrite detail,
  very-fast adjustment case, legacy helper exports kept for 8 specs; S7 named forced-turn / prior-turn discard /
  restored-adjustment / modal-open cases and raised test budget; S8 real persisted-settings integration; S9 extra
  keyboard regression specs and a listener integration test; S10 `dice` / `capital-region` / `real-data` / `layout`
  specs and `wc -l` on all presentation modules. All file:line claims were checked against the tree.
- Round 2 (`.claude/logs/codex/20261108T044052Z-tempo-revalidate.md`): **NEEDS_REVISION** — every round-1 finding
  confirmed addressed; three new required edits, all verified against the tree and applied in revision 3:
  (1) S3 also migrates `turn-moment-hooks.test.ts:58, 134-135, 403` and `GameApp.tsx:196`; (2) S3's nullable
  `arrivalMs` strategy (guarded arrival stage, normalised `durationForStage`, flash from `flashMs`); (3) S4 forwards
  the latest record, restoration classification and seam flag, and defines freeze eligibility with a test that an
  early render cannot freeze an empty plan. Minor notes also applied: stale S4 fallback wording, the S16 timer
  recorder (:795-801) must see `segment-flash`, and `ui-pop-turn-moments.spec.ts` added to S9's command. S3 estimate
  raised to 120-160 production LOC (Codex: the touched-line gate decides; split again if it passes 250).
- No third validation round was run (the brief allowed one re-validation). Status: **revision 3, round-2 required
  edits applied, not re-validated**; the lead may request a final Codex check before user approval.
