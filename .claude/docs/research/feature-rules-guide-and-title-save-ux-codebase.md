# Codebase scan: rules guide (#60) and title/save UX (#68)

MODE=existing. Branch `feature/rules-guide-title-save` (clean, = develop a8fc2b7).
Read-only scan; no source file was edited. Line numbers are as of this commit.

---

## 1. Affected files: current locations and behaviour

### 1.1 `src/features/editions/registry.ts` (37 lines)

- L13-33 `EDITIONS`: the only edition entry (`tokyo-suburban`). Title copy lives in
  `display` L19-30; `ruleParagraphs` L25-29 = 3 paragraphs of `EditionTextPart[]`
  (`string | { strong: string }`).
- Type: `src/features/editions/types.ts` L11-18 `EditionDisplay { title, subtitle,
  documentTitle, logoUrl?, ruleParagraphs }`. `EditionTextPart` L9.
- `ruleParagraphs` consumers: only `TitleScreen.tsx` L213-219. `GamePanel`,
  `ClearScreen`, `shareText.ts` take `EditionDisplay` but do not read it.
- The numbers in the prose duplicate config: `src/features/game/gameConfig.ts`
  L43-52 `ITEM_GAME_CONFIG` (`serviceLottery.target` share 1/2, direction
  `towardTargetWeight: 3, awayFromTargetWeight: 2`) and `ITEM_POLICY` L28-40
  (`dropChancePerMille: 300`, `harmfulChancePercent: 30`, `inventoryCapacity: 3`,
  `maxActiveItemsPerTurn: 1`, `delayTurns: 3`, `suspensionTurns: 5`). A rules screen
  could derive numbers from `edition.config` instead of hard-coding them (decision
  for Codex; the current title prose is hard-coded).

### 1.2 `src/features/game/components/TitleScreen.tsx` (255 lines)

- Props L16-38: `manifest, network|null, presentation?, display?, editions?,
  editionId?, onEditionChange?, focusPicker?, onPickerFocusRestored?, loading?,
  saveLookup, unavailableReason, notice, focusOnMount?, onNewGame, onResume,
  onDeleteSave`.
- `resumeLabel` L47-50:
  - completed: `クリア結果を見る（${game.turn}ターンでクリア）`
  - playing: `つづきから（${game.turn}ターン目・${stationName(...)}）`
- `SaveSection` L52-90: `none` → null; `unavailable` → notice L62-67; `invalid` →
  `role=alert` with `セーブデータを破棄` button L69-77 (same `onDeleteSave`);
  `valid` → primary resume button L82-84 + plain `セーブを削除` button L85-87.
- `Credits` sub-screen L96-167: an in-card *screen swap* (not a modal):
  `showCredits` state L174; Escape via window keydown L177-184; focus to the
  credits `h1` on open L100 (`useLayoutEffect`), focus back to the trigger on close
  L185-188; `<main aria-labelledby>` switches between `credits-title` and
  `game-title` L193. This is the existing pattern a title-side 「遊び方」 screen can
  copy.
- Main body L192-254: logo `h1#game-title` L196-200 (focused when
  `focusOnMount`), subtitle L202, `EditionPicker` L203-211, loading status L212,
  **rules paragraphs L213-219**, unavailable alert L220-224, notice L225-229,
  actions grid L230-248 (`SaveSection` then `はじめから`; `はじめから` is primary
  only when no valid save L242), `クレジット` button L249, version L250.
- Rendered by `GameApp.tsx` L373-388 only while `app.state.screen === "title"`, and
  by `EditionApp.tsx` L66-78 (loading, multi-edition only) and L85-96 (network
  failed). It is a fixed full-viewport overlay (`.title-screen`, z 20,
  `background: rgb(0 0 0 / 35%)`, styles.css L1366-1377) over the always-mounted
  `RailwayMap`.

### 1.3 `src/app/GameApp.tsx` (482 lines)

- `PendingConfirm` L56: `{kind:"new-game",message} | {kind:"delete-save"} | null`.
- `titleSave` L175-178 strips `movementHistory` from item saves before passing them
  to the title; **any progress shown on 「つづきから」 must come from
  `completedSegmentIds` / `turn` / `currentStationId`, not history.** The real save
  is used on resume via `resumeSaved` L179-181.
- `requestNewGame` L298-309: confirm message for a title-side overwrite is
  `保存中のゲーム（${current.turn}ターン目）は上書きされます。…` L304 (same
  off-by-one wording as the resume label, see 1.9).
- `deleteSaveConfirmed` L311-314 sets the title notice.
- JSX: TitleScreen L373-388 (`onDeleteSave={() => setConfirm({kind:"delete-save"})}`
  L386), GamePanel L389-418 (`confirmationOpen={confirm !== null}` L405), TurnMomentHost
  L419-423, **ToastHost L424-430**, ClearScreen L431-446, new-game ConfirmDialog
  L447-455, **delete-save ConfirmDialog L456-464** (task brief said ~L465-472),
  **RailwayMap L465-479** (task brief said ~L486) with
  `inert={app.state.screen === "title" || showClear}` L478.
- Toast obscuring L428: `obscured={confirm !== null || turnDisplay?.decision != null
  || itemDialogOpen}`. A rules modal must be added here.
- `requiredIds` L106-109 = `targetSegmentIds(edition.config, network)` (30). The
  「踏破 30/30」 count is `completedSegmentIds.filter(id => requiredIds.has(id))`
  (also GamePanel L563); `completedSegmentIds` includes non-target segments.

### 1.4 `src/features/game/components/GameMenu.tsx` (154 lines)

- Props L7-28; desktop renders its own trigger (`aria-expanded`/`aria-controls`)
  L99-114; on phone it is `embedded` inside `PhoneGameMenu`'s 設定 section.
- `modalDialogOpen()` L31-33 = `document.querySelector("dialog[open]") !== null`;
  exported and reused by PhoneGameMenu, ItemCard, GamePanel draft-Escape,
  useGameShortcuts. (`autoRoll.ts` L9-11 has its own copy.)
- Escape (capture phase) closes the menu unless a native modal is open L61-74.
- `.game-panel__options` L116-141: exactly 5 buttons — `追尾: ON/OFF`
  (`aria-pressed`), `速度: …` (disabled under reduced motion, with title text),
  `演出: …` (`--wide`), `新規`, `タイトル`. Then `GameLegend` L142-149 and the
  shortcut hint `<p class="game-panel__shortcut-hint">Space / Enter: サイコロ　S /
  Escape: スキップ</p>` L150 (also shown on phones; no PC-only gating exists).
- Disclosure ownership: `GamePanel.tsx` keeps one `activeSurface` of
  `"log" | "menu" | "card" | "phone-menu"` (L79, L247-315); menu and log are
  mutually exclusive; closed regions stay mounted with `hidden`.
- No modal is opened from the menu today. A 「遊び方」 entry here that opens a
  native `<dialog>` keeps the session (GamePanel is not unmounted), so progress is
  not lost by construction.

### 1.5 Existing modal / popover implementations (patterns to reuse)

| Component | Mechanism | Escape | Focus |
|-----------|-----------|--------|-------|
| `ConfirmDialog.tsx` L16-69 | `<dialog role="alertdialog">` + `showModal()` in `useLayoutEffect`; backdrop click cancels | `onCancel` → `preventDefault` + `onCancel()` (React unmounts) | captures `document.activeElement` as opener, restores on unmount; `autoFocus` on キャンセル |
| `DiscardChoice.tsx` L12-64 | `<dialog>` + `showModal()`; reopens if closed (`onClose=reopenUnlessReleased`) | blocked (`preventClose`) | heading `tabIndex=-1` |
| `RollAdjustment.tsx` L26-94 | `<dialog class="dialog item-dialog item-adjustment">` + `showModal()` | `handleCancel` = continue as-is | heading ref |
| `ItemUseDialog.tsx` L22-28, L84 | `useOpenDialog` → `showModal()`, focus first checked input | native cancel | first input |
| `ItemCard.tsx` `ItemCardPopover` L93-272 | Popover API `popover="auto"` with `showPopover({source})`, inline `hidden` fallback; `role="dialog"`; sheet vs anchored placement (`placeItemCard` L48+, sheet ≤600px wide or ≤500px tall) | native light-dismiss | heading focus on open, opener (or dice) on close |

- CSS: `.dialog` L1615-1640 (`width: min(380px, …)`, `max-height: calc(100vh - safe
  insets - 32px)`, `::backdrop` 45%); `.item-card-popover*` L2062-2170.
- A long, scrollable rules modal will need a wider `.dialog` variant (380px is
  sized for confirmations) and internal scrolling; deep links need in-dialog
  anchors/`scrollIntoView` (no hash routing exists in the app).
- jsdom unit tests stub `HTMLDialogElement.prototype.showModal` per file
  (`tests/unit/turn-moment-components.test.ts` L47, `map-flash.test.ts` L629).

### 1.6 `src/features/game/components/GameHud.tsx` (153 lines)

- `SaveIcon` L53-63 (check or warning path, `aria-hidden`).
- `saveMark = saveStatus === "saved"` L76. Saved: inline mark in the header
  L81-83: `<p class="game-panel__save game-panel__save--inline" title="セーブ:
  ${message}"><SaveIcon/><span class="visually-hidden">セーブ: …</span></p>`
  (task brief said ~L65-67). Not focusable, not tappable; explanation is only the
  `title` tooltip (no touch equivalent).
- Not saved / failed / unavailable / null: full text paragraph after the effects
  L145-150 (`--warning` for failed/unavailable).
- `saveStatusMessage` (persistence.ts L65-75): `saved: 自動保存済み`, `unavailable:
  この環境では保存できません（プレイは続けられます）`, `failed:
  保存に失敗しました（この進行は未保存です）`, null → `未保存`.
- Layout: `.game-panel__header` is an absolutely positioned 16x16 box
  (styles.css L778-785, `--game-panel-save-mark-size: 16px` L617), reserved on
  desktop by `padding-right` on the station cell L813-820, phone/short landscape
  overrides L2410-2420 / L2855-2862. Global `button { min-height: 44px }` L453-454:
  turning the mark into a `<button>` needs a scoped override and an enlarged hit
  area that does not move the HUD (phone 252px budget).

### 1.7 Map controls (`src/features/map/RailwayMap.tsx`, 834 lines)

- Props L81-106; `inert` L103 doc: "Remove map controls from keyboard and assistive
  technology while another screen is active".
- Zoom: MapLibre `NavigationControl({showCompass:false})` added in the init effect
  L597 (lives inside `.map-container`, top-right; accessible names `Zoom in` /
  `Zoom out`).
- 全体 / 目標路線: React-rendered `<div class="map-overview" aria-label="地図表示範囲">`
  L801-814 inside the `inert` wrapper L799; both `disabled={!loadedMap}`.
- Readiness signal: `loadedMap` state L539, set on the **first `style.load`** after
  railway layers are added L640-661 (basemap tiles may still be loading); reset on
  unmount. `basemapLoaded` (`"load"`) L606-609 is a local, not exposed. `styleFailed`
  / `unsupported` states L534-536 show `.map-error` L816-830.
- On the title the map is inert (GameApp L478) but still *visible* under the 35%
  dim; `.map-overview` is z `--layer-panel` 10 (styles.css L2653-2660) and the
  title overlay is z 20, so they show through the dim, look clickable and do nothing.
  `.maplibregl-ctrl-top-right` is inside the map container.
- Overview camera for a title background already exists: at `style.load` the map
  runs `fitNetworkOverview(map, initialServices)` L654, with
  `initialOverviewServices` (`camera.ts` L257-267) returning **only the target
  service (Yamanote) for regional bundles** (span > 0.5°, which Tokyo suburban is).
  So the title already shows the Yamanote loop behind the dim; `overviewKey`
  L700-705 re-fits for turn-0 sessions. `fitNetworkOverview` L420-438 uses phone
  padding from the panel (`phonePanelBottomPadding`) — on the title there is no
  panel, so phone padding may be off. No static fallback image exists in `public/`
  (only logo/ogp/icons) for WebGL2-unsupported or loading states.
- `EditionApp.tsx` L64-65: single-edition loading shows `<div class="loading">
  読み込み中…</div>` with **no map and no title**; L84 network-failure path mounts a
  `RailwayMap` without `inert`, so its controls are live behind the title there.

### 1.8 Keyboard shortcuts (`src/features/game/useGameShortcuts.ts`, 85 lines)

- `gameShortcutAction` L54-67 returns null when `surfaceOpen`, `itemDialogOpen` or
  `modalDialogOpen()` (any `dialog[open]`), or for modifier/IME/repeat. Space/Enter
  roll (non-interactive target), S/Escape skip (non-editable target). Listener is
  bubble phase L70-85; wired in `GamePanel.tsx` L349-354 with
  `surfaceOpen: activeSurface !== null`.
- **A rules modal implemented as a native `showModal()` `<dialog>` is covered
  automatically** (shortcuts, GameMenu/PhoneGameMenu Escape, draft-clear Escape,
  ItemCard, and auto-roll `autoRoll.ts` L150-190 which polls/observes
  `dialog[open]`). A non-native overlay (div/popover) would need explicit wiring
  into `useGameShortcuts`, `useAutoRoll` (`surfaceOpen`/`confirmationOpen`), and
  ToastHost `obscured`.
- Escape inside a rules `<dialog>` closes it via the native `cancel` event; because
  shortcut S/Escape also maps to skip, the modal must stay open until React unmounts
  it in the same tick (ConfirmDialog pattern), otherwise the Escape keydown could
  reach the skip handler after `dialog[open]` disappears. Verify ordering in a test.

### 1.9 Turn-number semantics (#68 d)

- Engine: `game.turn` starts at 0 (`engine/game.ts` L54) and each completed turn
  produces a record with `turn = state.turn + 1` (L144); so `game.turn` = number of
  completed turns, and `record.turn` is 1-based.
- Users see: HUD `ターン数` = `turnDisplay.turn` (record turn or `game.turn`);
  ClearScreen history `{record.turn}ターン目` (ClearScreen.tsx L107) and summary
  `所要ターン数 {turns}ターン` (`summarizeGame` returns `game.turn`); announcements
  `${turn}ターン目：…に到着` (presentation.ts L165/L177, turnMomentPresentation.ts
  L460); turn result card `前のターン（${turn}ターン目）` (turnResultCard.ts L207).
- Mismatch: title `つづきから（${game.turn}ターン目・…）` and GameApp L304
  `保存中のゲーム（${current.turn}ターン目）` say "N-th turn" for N *completed* turns,
  while the next record is N+1. Completed label `（${game.turn}ターンでクリア）` is
  correct.
- Pending item saves (`pending: roll | discard`, see `engine/itemTurn.ts` L21-35 and
  GameApp L147 comment): `game.turn` lags the in-progress record by one. Any new
  wording ("95ターン終了") stays correct for these; "96ターン目から" would also be
  correct. `hasGameProgress` (gameSession.ts L226-228) treats `turn>0 || pending`.

---

## 2. Toast host and save signalling

### 2.1 Toast API

- Pure queue: `src/features/game/toastQueue.ts` (284 lines). `ToastInput` L14-23
  `{key, sessionId, turn, eventIndex, text, tone: neutral|good|bad, itemKind?,
  sticky}`. `MAX_VISIBLE_TOASTS = 3`, `TOAST_READING_MS = 4000` L9-10. Ordinary
  toasts use 2 slots, the 3rd is reserved for the sticky failure L204.
- Ordering/dedupe: a per-scope cursor `(turn, eventIndex)`; an input is accepted
  only if strictly newer than the cursor (`newerPosition` L207-214) and
  `turn`/`eventIndex` are non-null and `sticky` false. Waiting toasts from older
  turns are dropped (`dropWaitingBefore` L217-221). Milestones use negative
  eventIndex (-5..-1) to sort before item events of the same turn (L117-162).
  **A first-save toast must pick a `(turn, eventIndex)` that does not collide with
  or get rejected by this cursor** (e.g. a turn-0 position would be rejected once a
  later turn's toast is seen; an index colliding with a milestone drops one).
- Sticky save failure: `saveFailureToast` L164-174 (`保存に失敗しました`, bad,
  sticky); not enqueued — the reducer's `saveFailed` flag adds it in
  `visibleToasts` L256-259; `expire` refuses its key L241-244.
- Producer: toast inputs are derived in `turnMomentPresentation.ts` L326-345
  (`crossingToasts`, `milestoneToasts`, `itemToasts`) and exposed as
  `TurnMomentDisplay.toastInputs`; GameApp L229-245 filters out keys present when
  the session was entered (no replay on resume) and passes `acceptedToastInputs`.
- Host: `src/features/game/components/ToastHost.tsx` (117 lines). Props
  `{sessionId, inputs, saveFailed, obscured, reducedMotion}` L15-21; reset on session
  change L33-41; enqueue L43-45; save failed/succeeded transitions L49-51; reading
  clocks pause while `obscured` L75-80 and resume after; render is
  `<div class="toast-host" aria-hidden="true">` L105 (**visual only**, DESIGN row
  "UI pop P0: トーストは視覚のみ"). CSS `.toast-host` styles.css L79-110, phone
  L187-196, short landscape L161-180 (positions avoid the zoom group and
  `.map-overview`).
- Pause-while-dialog: only through the `obscured` prop (GameApp L428). ToastHost
  does not look at `dialog[open]` itself.

### 2.2 Save success signal

- `useGameApp.ts` L59 `saveStatus: SaveWriteResult | null` (`saved | unavailable |
  failed`). Writes happen in effects:
  - classic/any committed game without `pending` L68-70 — **this fires for the
    turn-0 state right after 「はじめから」**, so `saveStatus` is `"saved"` before
    any turn is played;
  - item sessions L71-87 (StrictMode-safe memo `saved` ref L67; dispatches
    `item-save-attempted` while `committing`/`resolving`).
- `writeSave` persistence.ts L117-128 returns the result; `saveStatus` flows to
  GamePanel (HUD) L400, ToastHost `saveFailed` L427, ClearScreen L442.
- There is no "first saved turn" event today; candidates: `saveStatus === "saved"`
  with `game.turn >= 1` (first completed turn) observed in GameApp, or the
  first `"saved"` of a session. Product must decide turn 0 vs turn 1 (see open
  questions).

### 2.3 Where a one-time flag could persist

- `src/features/game/store/settings.ts` (72 lines): key
  `yamanote-line-sugoroku:settings:v1`, `version: 1`. `parseSettings` L19-44 accepts
  only version 1 and **rebuilds the object from known fields** (unknown fields are
  dropped); `writeSettings` L59-72 writes exactly `{version, speedId, follow,
  presentationLevel}`. Adding a field means changing both plus `GameSettings`
  (`gameSettings.ts` L3-15) and `useGameSettings.ts` (write only when `revision`
  changes, L22-37). DESIGN rows (Issue #64, 2026-11-08 and 2026-11-09) fix the key
  and format ("settings のキーと形式は変えない" for auto-roll) — adding a field to
  v1 is not forbidden by the 11-08 row but the 11-09 row explicitly declined to.
- Alternative: a separate key, e.g. `yamanote-line-sugoroku:notice:...:v1`, written
  through the injected `StorageLike` like persistence/settings.
- **Test hazard:** several E2E specs stub `Storage.prototype.setItem` to throw when
  `key.includes("save")` (`tests/e2e/ui-pop.spec.ts` ~L70, `tests/e2e/support/
  turnResult.ts` ~L205, save-errors specs). A flag key containing "save" would also
  fail in those tests; avoid "save" in the key name or make the write failure-safe.
- Other storage users: `analytics.ts` L142, line visibility store, legend collapse
  (no shared settings registry).

---

## 3. Edition registry usage and tests to update

- Entry shape: see 1.1. Unit fixture `tests/unit/fixtures/editions.ts` L15/L24
  spreads `base.display` (inherits `ruleParagraphs`), so a type change propagates.
- No other edition exists in the registry; capital-region E2E uses its own fixture
  bundle but the same display.

### Tests that assert affected UI (by feature)

**Title rules text (#60)**
- `tests/unit/edition-registry.test.ts` L40-61: `toEqual` on the full `display`
  including all 3 `ruleParagraphs`.
- `tests/e2e/layout.spec.ts` L148-151 ([8.3-8], @layout): exact first paragraph
  text visible on the title.

**Resume label wording (#68 c, d)** — exact-prefix matches break if the label
changes; the 20+ `/つづきから/` regex users survive if 「つづきから」 stays the
leading text:
- `tests/e2e/resume.spec.ts` L64 (exact `つづきから（${N}ターン目・${station}）`),
  L111, L229 (`/^つづきから（1ターン目・/`).
- `tests/e2e/real-data.spec.ts` L363 (`/^つづきから（3ターン目・/`).
- `tests/e2e/map-failure.spec.ts` L60, `tests/e2e/lottery.spec.ts` L71,
  `tests/e2e/capital-region.spec.ts` L224, `tests/e2e/ui-pop-turn-moments.spec.ts`
  L248 (all `/^つづきから（1ターン目・/`).
- Completed label (likely unchanged): `tests/e2e/tokyo-suburban.spec.ts` L123
  (`クリア結果を見る（96ターンでクリア）`), `tests/e2e/full-game.spec.ts` L78,
  `capital-region.spec.ts` L392/L428 (`/^クリア結果を見る/`).
- Accessible-name note: if progress text is added inside the button, every
  `getByRole("button", { name: /^つづきから（…/ })` must still match.

**Delete save (#68 f)**
- No test clicks the valid-save 「セーブを削除」 button today. `tests/e2e/
  save-errors.spec.ts` L121-199 cover the invalid-save `セーブデータを破棄` alert and
  the `セーブデータの削除` alertdialog / `削除する` / notice text — keep those names.

**Menu buttons (#60 in-game entry)**
- `tests/unit/game-hud.test.ts` L376-390 (exactly 5 `.game-panel__options` buttons
  with labels), L446 (`nth-child(4)` = 新規), L355-369 (shortcut hint text is exactly
  `Space / Enter: サイコロ　S / Escape: スキップ`, a `<p>`, and opening the menu adds no
  tab stops; the count is taken over the whole region before and after opening, so a
  static extra button in the region does not break it, but changing the hint text
  does).
- `tests/e2e/accessibility.spec.ts` L631 (`.game-panel__options button` count 5),
  L92-93 (shortcut hint text).
- `tests/unit/phone-game-menu.test.ts` L80-87 (新規/タイトル inside
  `.game-panel__options`).
- Putting 遊び方 outside `.game-panel__options` avoids these; inside, update counts.

**Save mark (#68 b)**
- `tests/unit/game-hud.test.ts` L322-350: saved mark is a `.game-panel__save` inside
  `.game-panel__header`, has `title="セーブ: 自動保存済み"`, a `.visually-hidden`
  span, `svg[aria-hidden]`, and **no `role`** on `.game-panel__save` (L346). A
  button wrapper changes the element and possibly the title.
- `tests/unit/item-controls.test.ts` L1021-1047 (`.game-panel__save` has no role,
  text contains `セーブ: 自動保存済み`).
- `tests/unit/game-app-turn-moments.test.ts` L138, L379, L644-668, L1006 and
  `tests/unit/game-app-item-progress.test.ts` L314, L567, L666: `textContent` of
  `.game-panel__save` equals `セーブ: 自動保存済み` exactly — extra visible/hidden
  text inside that element (e.g. an explanation) breaks the exact `toBe`.
- `tests/e2e/hud-progress-feedback.spec.ts` L177-195: `.game-panel__save--inline`
  visible and not overlapping 現在駅 across `SAVE_MARK_VIEWPORTS`.
- `tests/e2e/save-errors.spec.ts` L223-296, `ui-pop.spec.ts` L77/L410-414,
  `auto-roll-lifecycle.spec.ts` L280, `turn-result-card.spec.ts` L1513/L1537,
  `tests/e2e/support/turnResult.ts` L211: `.game-panel__save` contains 失敗 /
  自動保存済み.

**First-save toast (#68 a)** — every fresh E2E context and every jsdom GameApp test
starts with empty storage, so a one-time toast would appear in the first game of
*every* test unless suppressed:
- Exact toast counts/texts: `tests/e2e/resume.spec.ts` L115/L147-148/L154-156/L212,
  `tests/e2e/ui-pop-turn-moments.spec.ts` L395/L420/L431/L1017,
  `tests/e2e/save-errors.spec.ts` L225/L231/L265/L277 (`toHaveText` on all
  `.toast-host__toast` — a second toast fails it), `tests/e2e/ui-pop.spec.ts` L390-412,
  L741-751 (layout of all toasts), `tests/e2e/turn-result-card.spec.ts` L560-562,
  `tests/e2e/map-visual.spec.ts` L545/L610, `hud-progress-feedback.spec.ts` L260.
- Unit: `tests/unit/game-app-item-progress.test.ts` L223-488 (many
  `toHaveLength(0)` / first-toast text), `tests/unit/game-app-turn-moments.test.ts`
  (13 toast assertions), `tests/unit/toast.test.ts`.
- Mitigation options: seed the flag in `tests/e2e/fixtures.ts` (an `addInitScript`
  like `installGameSeed` L17-31/L58) and in unit storage setup; add dedicated tests
  that clear it. DESIGN row "Issue #66 scope and process" set the precedent
  "existing tests pass unmodified (new cases go to new test files)".

**Map controls hidden on title / while loading (#68 e)**
- `tests/e2e/layout.spec.ts` L47-87 (safe-area: measures `.maplibregl-ctrl-zoom-in`,
  `-zoom-out`, `.map-overview` right after `startNewGame`, expects exactly 5 rects —
  **races if controls are hidden until the map loads**; add a wait for
  `styleLoaded`), L126-136 (Zoom in visible in game), L43-46 (`.map-overview` safe
  area CSS rule must keep `env(safe-area-inset-*)`).
- `tests/e2e/turn-result-card.spec.ts` L469-470 (`.map-overview` and zoom group
  count 1 in game) and L481-482.
- `tests/e2e/map-failure.spec.ts` L128 (Zoom in after load), L37 (title `はじめから`
  disabled when data fails).
- `tests/e2e/ui-pop.spec.ts` L464, L564, L741-751; `ui-pop-turn-moments.spec.ts`
  L226; `items.spec.ts` L73 (clip list).
- `tests/e2e/capital-region.spec.ts` L96/L154/L179, `map-visual.spec.ts`
  L187-267 (click 全体/目標路線 in game; fine if they appear once loaded, since
  `startReadyGame` waits for readiness — verify).
- `tests/unit/turn-moment-components.test.ts` L523-596 (synthetic `.map-overview`
  / `.maplibregl-ctrl-group` boxes for layout avoidance; not affected by hiding).

---

## 4. Map readiness and title background

See 1.7. Summary for design:
- "Ready" = `loadedMap !== null` (style + railway layers, not basemap tiles). Already
  used to disable 全体/目標路線; zoom buttons have no readiness gate.
- Hide options: (i) pass a `controlsVisible`/`showControls` prop from GameApp
  (`screen === "game" && !showClear`) and gate both `.map-overview` rendering and a
  CSS class on the container that hides `.maplibregl-ctrl-top-right`; (ii) CSS
  only, keyed off a class on the RailwayMap wrapper. Unmounting `.map-overview`
  changes `toHaveCount(1)` tests only on the title (they run in game).
- Toast positions are computed to avoid the zoom group and overview buttons on
  phone/short landscape (styles.css L161-196); hiding controls on the title does
  not affect in-game toasts.
- Title background already = Yamanote overview after `style.load`
  (`initialOverviewServices`). Phone fit padding assumes a bottom panel. Static
  image fallback would be a new asset.

---

## 5. Shortcuts vs rules modal

See 1.8. Native `<dialog>` + `showModal()` → no shortcut change needed. Title-side
rules screen: shortcuts are not mounted on the title (they live in GamePanel), so
only the title's own Escape handling (Credits pattern L177-184) matters. The
shortcut list for the rules screen can be taken from `useGameShortcuts.ts`
L60-65 (Space/Enter roll, S/Escape skip) and item-draft Escape (GamePanel ~L408-420, hint L552
「Escapeキーで選択を解除できます」) and RollAdjustment Escape (「Escapeキーでも
「そのまま」で続けます」 RollAdjustment.tsx L86). "PC-only": no pointer/hover media
query or touch detection exists anywhere in `src/` (grep for `hover: none` /
`pointer: coarse` is empty); the in-game hint is shown on phones too.

---

## 6. Phone layout and manual structure

- Breakpoints (`src/features/map/mapConfig.ts` L12 `PHONE_MEDIA_QUERY = "(max-width:
  600px)"`; CSS `@media (max-width: 600px)` L187, L2223, L2348; short landscape
  `(min-width: 601px) and (max-height: 500px)` L161, L2211, L2771; desktop
  `(min-width: 601px) and (min-height: 501px)` L815; tiny `max-width: 360px` L2340,
  `390px` L3076).
- Title on phone (styles.css L2620-2635): aligned to top, 8px padding, card padding
  14/16, title 22px. Card width `min(520px, 100%)` L1379-1387; `.title-screen` is
  `overflow-y: auto`.
- DESIGN constraints: phone HUD budget 252px at 320x568 must stay unchanged (#65,
  #66 rows); phone shows a reduced variant and trims duplicated info (memory
  `phone-slim-info`); `@layout`-tagged tests are the only ones run on
  phone-chromium (`playwright.config.ts` L77-79).
- Phone menu = `PhoneGameMenu.tsx` hamburger with ログ / 設定 sections (settings
  embeds `GameMenu` with `embedded`), Escape L27-39.
- `docs/manual/tokyo-suburban/rules.md` (52 lines) sections: intro L3 (goal +
  lottery summary), `## 収録範囲` L5-9, `## 1ターンの流れ` L11-20 (6 steps:
  item choice, roll/adjust, movement/stop rules, service lottery 1/2, direction 3:2,
  pickup 30% / harmful 30% / 7+4 kinds; goal stop rule L20), `## アイテム` L22-44
  (capacity 3, discard of 4, 1 per turn, table of 11 items L28-40, selection hints
  L42, result/share L44), `## 地図・セーブ` L46-52 (追尾, line visibility, スキップ,
  save/resume behaviour, save v4, data credit). It has no settings (速度/演出/
  おまかせ) or shortcut section; those must come from code (`ANIMATION_SPEEDS`
  gameConfig.ts L61-66, `PRESENTATION_LEVELS` gameSettings.ts L17-21, auto-roll
  DESIGN rows 64-67). Item prose in-app already exists as `ITEM_DESCRIPTIONS`
  (itemPresentation.ts L51-66, short effects), `itemTiming` L68-72,
  `ITEM_SHORT_NAMES` L4-16, `itemTone` L20-22; icons `ItemIcon.tsx`
  (`ItemIcon({kind,size})`, 11 drawings). Note the manual's item wording is longer
  than `ITEM_DESCRIPTIONS`; pick one source per string.

---

## 7. DESIGN.md Key Decisions that bind this feature (L187-352)

- **UI pop P0 toasts** (row ~236): visual only (`aria-hidden`), one existing live
  region, max 3 / 4 s, save failure sticky, timers pause during confirm/decision
  dialogs. → The first-save message needs a separate accessible path if SR users
  must learn it (e.g. the save-mark explanation), and its timer must pause while the
  rules modal is open.
- **UI pop P1 disclosures** (~231): log and menu are inline disclosures inside
  `.game-panel`, one open at a time, mounted while hidden. → A rules screen opened
  from the menu should be a modal over the panel, not a third inline disclosure,
  unless it joins `activeSurface`.
- **UI pop P1 item card** (~233): native Popover API with inline fallback; separate
  view and use. → Item overview in the rules screen should reuse `ItemIcon` and
  `ITEM_DESCRIPTIONS`, not item-card behaviour.
- **UI pop P0 contrast** (~234): white text on `--color-brand-strong #b83f24` only.
- **Settings storage** (~248, 2026-11-08) and **auto-roll not saved** (~251,
  2026-11-09): settings key/format fixed; auto-roll never persisted. Constrains
  where the one-time flag lives.
- **Tempo** (~246): 4 speeds ゆっくり 600 / ふつう 450 / はやい 300 / とても速い 120 ms,
  cycle ふつう→はやい→とても速い→ゆっくり; 演出 levels すべて / 重要なときだけ / なし;
  values fixed at roll time. → Copy source for the 速度/演出 meanings.
- **Auto-roll** (~250-253): stop/wait conditions, OFF on reload/new/title/resume,
  1,200 ms gap, toggle `おまかせ: ON/OFF`, name `おまかせで進む`. → Copy source for
  おまかせ meaning; must pause while the rules modal is open (native dialog does).
- **PhraseText / wrapping (#70)** (~254-259): line breaks via `PhraseText` `<wbr>`
  at render time only; strings, aria-labels, live regions stay byte-identical;
  `keep-all + overflow-wrap:anywhere`, `auto-phrase` in `@supports`; `text-wrap:
  balance` only on `.dialog__title` and `.item-dialog__hint--target`; no
  `text-align: justify`. → Rules prose and the new resume label should render
  through `PhraseText`.
- **#66 turn result card / scope** (~272-282): presentation only; existing tests
  pass unmodified, new cases in new files; new class prefixes; phone 252px budget;
  phone shows the reduced variant.
- **#65 HUD** (~283-285): phone ログ/メニュー merged into one hamburger; desktop
  no-scroll gates and phone budget unchanged.
- **#83 CI**: phone-chromium runs only `@layout`; working-branch push runs only
  desktop-chromium (2 shards). New phone layout checks need the `@layout` tag.

---

## 8. Conventions

- Components: `src/features/game/components/PascalCase.tsx`, named exports, props
  interface `XxxProps`, `React.JSX.Element` return types; pure presentation helpers
  in `src/features/game/*.ts` (camelCase file, e.g. `turnResultCard.ts`,
  `hudPresentation.ts`) with the component consuming a model.
- Strings: inline Japanese literals in components, plus shared tables in
  presentation modules (`ITEM_DESCRIPTIONS`, `TARGET_PROXIMITY_COPY`,
  `PRESENTATION_LEVELS`, `ANIMATION_SPEEDS`, `WRITE_RESULT_MESSAGES`). Edition-level
  copy lives in `EditionDisplay`. No i18n layer.
- CSS: single `src/styles.css` (3258 lines), BEM-like `block__element--modifier`
  (`title-screen__actions`, `game-panel__save--inline`, `item-card-popover--sheet`),
  CSS custom properties for layers (`--layer-*` L40-45), colours, radii, motion.
  Media blocks are grouped per breakpoint; reduced-motion blocks per feature.
- Accessibility patterns: native `<dialog>` + `showModal()`, `aria-labelledby` to a
  heading with `tabIndex={-1}`, focus restore to opener, one polite `role=status`
  per panel, `visually-hidden` class for SR-only text, 44px min targets (global
  `button` rule).
- Unit tests: Vitest + jsdom (`// @vitest-environment jsdom` header), files
  `tests/unit/kebab-case.test.ts`, React mounted via `tests/unit/helpers/reactDom.ts`
  (`mountReact`, `dispatchReactEvent`, `flushReact`), fixtures in
  `tests/unit/fixtures/` (`FIXTURE_EDITIONS`, railway/yamanote networks); dialogs
  need a `showModal` stub. Example: `tests/unit/credits-screen.test.ts` tests the
  title Credits sub-screen (focus to heading, Escape closes, focus restore).
- E2E: Playwright `tests/e2e/*.spec.ts` importing `test`/`expect` from
  `tests/e2e/fixtures.ts` (auto fixtures: data routing, map stub, seeded crypto);
  helpers in `tests/e2e/support/app.ts` (`openTitle`, `startNewGame`,
  `openGameMenu`, `closeGameMenu`, `rollOnce`, `titleScreen` = `main` named
  山手線すごろく, `gamePanel`, `readSave`, `writeSaveText`); role/name selectors;
  `{ tag: "@layout" }` for anything that must run on phone-chromium; local runs are
  targeted specs only (memory), full matrix in CI.
- Commands: `npm run typecheck` (`tsc -b`), `npm test` (`vitest run`),
  `npm run test:e2e` (`playwright test`), `npm run build`.
