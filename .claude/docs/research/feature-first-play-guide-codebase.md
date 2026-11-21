# Codebase scan: first-play guide and control labels (#67)

MODE=existing. Branch `feature/first-play-guide` (clean, = 3b048f4, v0.17.1).
Read-only scan; no source file was edited. Line numbers are as of this commit.
The issue was written against v0.12.0; every claim below was re-checked against
the current code.

---

## 1. Current State vs Issue Claims

| # | Issue claim (v0.12.0) | Still true? | Current location / evidence |
|---|---|---|---|
| 1 | Only explanation is the title rule text (`TitleScreen.tsx:213-219`, `registry.ts:27-31`) | **Stale.** #60 added a shared 遊び方 guide: title sub-screen + in-game native `<dialog>` with deep links | `src/features/game/rulesGuide.ts:6-8,207-229`, `components/RulesDialog.tsx:44-117`, `app/GameApp.tsx:116-120,130-135,509-517`; entry points: menu (`GameMenu`), lottery 「詳しく」 `GamePanel.tsx:543-544`, item card 「詳しく」 (`InventoryPanel` `onOpenRules`) |
| 2 | Nothing explains, in game, why the ride changed / what items do | **Partly true.** Explanations exist but only on demand (rules dialog). Nothing proactive, no first-time context | same as above; no hint/coach code anywhere (`grep coach|hint` finds only `item-dialog__hint`, `shortcut-hint`) |
| 3 | 1st-turn toast is only 「遅延を拾ってしまった！」 at `toastQueue.ts:73` | **True in substance, line stale.** Line 73 is now `…を使った`; the harmful copy is `toastQueue.ts:78-81` (`harmful-scheduled` → `${name}を拾ってしまった！`, or `…が運休！`) | `src/features/game/toastQueue.ts:63-89` |
| 4 | Ending turn 1 on Oedo toward 都庁前 gives no hint that this is normal / that directions lean toward Yamanote | **True.** Rule exists only in the guide's lottery section (`directionText`, `rulesGuide.ts:92-103`). Current weights: toward 3 : away 2 (`gameConfig.ts:50`), target share 1/2 (`gameConfig.ts:48`) | — |
| 5 | Skip label ambiguous, `GameHud.tsx:94` | **True, line stale.** Now `GameHud.tsx:135`: `<button className="game-panel__skip" onClick={onSkip} disabled={!canSkip}>スキップ</button>` (visible text = accessible name, native `disabled`) | `components/GameHud.tsx:125-145` |
| 6 | Skip is greyed out most of the time | **True.** `canSkip = session.phase === "animating" \|\| (active && (preMoveActive \|\| revealActive))` (`turnMomentPresentation.ts:381`) → disabled whenever idle; always disabled under reduced motion (no moments) | — |
| 7 | Skip sits next to 「そのまま続ける」 in the adjust dialog | **True.** `RollAdjustment.tsx:87-92`; it is `aria-disabled` (focusable), not `disabled`, and only rendered when `onSkip` is passed (`GamePanel.tsx:676-677` always passes it) | — |
| 8 | Removing it from the dialog is fine because "tapping the moment skips" | **False premise.** The dialog is native modal (`showModal`, `RollAdjustment.tsx:33-39`), which makes the map and `TurnMomentHost` (`onClick={onTap}`, `TurnMomentHost.tsx:542-544`) inert; Escape is the dialog's `cancel` = 「そのまま」 (`RollAdjustment.tsx:50-53`); the S/Escape shortcut is suppressed by `modalDialogOpen()` (`useGameShortcuts.ts:57`). The comment at `RollAdjustment.tsx:14-18` states this is why the dialog Skip exists. Removing it means the remaining stamps/movement/reveal can only be skipped *after* 「…続ける」 | DESIGN row 262 (#62): "modality keeps focus containment, **Skip** and Escape contracts" |
| 9 | Escape hint 「Escapeキーでも「そのまま」で続けます。」 at `RollAdjustment.tsx:80`, shown on phones too | **True, line stale.** Now `RollAdjustment.tsx:86`, and it is one `PhraseText` together with 「出目を見た後はターンを取り消せません。」 — must be split before gating | Gate precedent: `.game-panel__shortcut-hint` + `.rules-guide__shortcuts` use `@media (hover: hover) and (pointer: fine)` (`styles.css:1227-1232, 3539-3550`); DESIGN row 289 already decided "in-game shortcut hint and the rules shortcut list are hidden on touch devices" |
| 10 | One-line pitch from OGP 「サイコロと抽選まかせで、山手線を一周して新橋へ。」 in `index.html` | **Partly.** That exact sentence is only in `og:image:alt` / `twitter:image:alt` (the text baked into `ogp.png`), `index.html:33,44`. `og:description` (L25) is a longer variant. Not present anywhere in `src/` | `index.html:25,33`; title copy lives in `src/features/editions/registry.ts:25-29` (`ruleParagraphs`) |

Other drift since v0.12.0 that matters for #67:
- #64 added the S/Escape skip shortcut (`useGameShortcuts.ts:63-65`), おまかせ toggle in the
  same row (`GameHud.tsx:136-144`), and a menu hint 「Space / Enter: サイコロ　S / Escape: スキップ」
  (`GameMenu.tsx:156`).
- #66 turn result card / phone pill; #62 roll-adjust map bubbles; #68 one-time auto-save notice
  (the show-once precedent, section 5).

---

## 2. Affected Files

| File | Lines | Role for #67 |
|---|---|---|
| `src/features/game/components/GameHud.tsx` | 157 | Skip button L135 (label, `disabled={!canSkip}`), action row L125-145, 踏破区間 `dt/dd` + `TargetProgressBar` L99-104 (coach step 2 target), dice `rollButtonRef` L126-134 (coach step 1 target) |
| `src/features/game/components/RollAdjustment.tsx` | 96 | Escape hint L86; dialog Skip L91; props `onSkip`/`canSkip` L14-20 |
| `src/features/game/components/GamePanel.tsx` | 689 | Coordinator: computes `canSkip` pass-through L647, renders RollAdjustment with `onSkip` L671-678, owns the single `role=status` live region L656-658 and notice arbitration L367-399, shortcut wiring L400-405, `openRules` binding L414-423, keyed by `sessionId` in GameApp (state resets per game) |
| `src/app/GameApp.tsx` | 554 | Owns `storage` (L94), `useFirstTurnNotice` (L394-410), `ToastHost` (L483-492), `RulesDialog` (L509-517), shared `skip` (L345-350), `TurnMomentHost` (L478-481), new/resume split (`startNewGame` L318, `resumeSaved` L205) |
| `src/features/game/turnMomentPresentation.ts` | 491 | `deriveTurnMomentDisplay` (L238-423): `phase`, `lotteryPublished` (L243), `resultPublished` (L308), `canSkip` (L381), `toastInputs` (L328-345) — the reveal-gated place to derive "this turn's first-time facts" |
| `src/features/game/toastQueue.ts` | 318 | Toast copy, `NoticeToastInput` (`kind:"notice"`, L27-30), `enqueueNotice` dedupe by key (L250-254), 2 ordinary slots (`ORDINARY_TOAST_SLOTS`, L216) |
| `src/features/game/components/ToastHost.tsx` | 177 | Renders notices; **host is `aria-hidden="true"` and CSS `pointer-events: none`** (L165, `styles.css:79-90`) → a toast cannot carry a 「もう表示しない」 button |
| `src/features/game/saveNotice.ts` | 92 | `selectAnnouncement` (L119-132) — **hard-codes `FIRST_TURN_NOTICE_TEXT`** as the only notice text |
| `src/features/game/useFirstTurnNotice.ts` | 89 | Show-once hook precedent |
| `src/features/game/store/notices.ts` | 26 | Show-once storage precedent |
| `src/features/game/rulesGuide.ts` | 229 | `RulesSectionId = "goal"\|"lottery"\|"items"\|"controls"\|"save"`; copy mentioning 「スキップ」 L67 and L146 |
| `src/features/game/components/GameMenu.tsx` | — | Shortcut hint text L156 (mentions スキップ); `modalDialogOpen()` L34-36 |
| `src/features/game/presentation.ts` / `turnMomentPresentation.ts:443` | — | Live-region copy 「移動中です。スキップできます。」 (L193,196,237-238 / L443) — wording consistency with a renamed button |
| `src/styles.css` | 3741 | Action row desktop L1170-1206; phone ≤600px L2698-2733 (`grid-template-columns: 1.5fr 0.85fr 1.35fr`, height 56px); short landscape L3064-3107; pointer-fine gates L1227, L3543; layers L40-45 |
| `src/features/map/RailwayMap.tsx` | — | Map overlay for coach step 3: `目標路線` fit button L921-926 (`fitNetworkOverview` filtered to target), `map.project` helpers L309-333, WebGL-unsupported fallback L929-934; overview camera at turn 0 (`overviewKey`, GameApp L549; follow disabled until turn > 0, GameApp L289-296) |
| `src/features/editions/registry.ts` | 37 | Title copy; pitch could live in `EditionDisplay` if per-edition |
| `index.html` | — | OGP pitch source |

---

## 3. Existing Patterns (conventions to follow)

- **Layout**: feature code in `src/features/game/`; pure model `*.ts` beside a `use*.ts` hook and
  a `components/*.tsx` view (e.g. `rulesGuide.ts` + `RulesDialog.tsx`; `saveNotice.ts` +
  `useFirstTurnNotice.ts` + `store/notices.ts`; `autoRoll.ts` + `useAutoRoll.ts`). Storage
  adapters in `src/features/game/store/` take an injected `StorageLike | null`
  (`store/persistence.ts:24-28`), browser access only via `getBrowserStorage()`
  (`store/browserStorage.ts`).
- **Reveal gating**: components read only `TurnMomentDisplay`; anything result-dependent is
  derived in `deriveTurnMomentDisplay` against `phase` / `lotteryPublished` / `resultPublished`
  (DESIGN row 244). Toasts additionally wait for `movementComplete` (L327-329). Restored history
  (`entryTurn`, `restoredHistory`) never re-announces.
- **Japanese UI text**: wrap in `<PhraseText text=…>` (phrase-boundary line breaking,
  `components/PhraseText.tsx`); notice toasts use PhraseText (`ToastHost.tsx:172`).
- **Live region**: exactly one `role=status aria-live=polite` in the panel (`GamePanel.tsx:656`),
  hidden while a decision dialog owns its own status (`RollAdjustment.tsx:63`). Notices are
  arbitrated by `selectAnnouncement` so they never overwrite a fresh turn summary.
- **Dialogs**: native `<dialog>` + `showModal()` in `useLayoutEffect`, `onCancel`
  `preventDefault` + React-controlled close, focus restore via `isFocusRestorable` with fallbacks
  (`RulesDialog.tsx:19-79`); backdrop click guarded by pointerdown origin (L85-93).
- **Popovers**: native Popover API with a non-native fallback, detected once via
  `typeof HTMLElement.prototype.showPopover === "function"` (`ItemCard.tsx:94-160`,
  `SaveStatusPopover.tsx:48-60`); placement helper `placeSaveStatus` keeps it inside the viewport.
  Open popovers count as a "surface" that pauses auto-roll and shortcuts (`activeSurface`).
- **Disabled conventions**: dice uses `aria-disabled` + guarded handler (focusable); panel Skip
  uses native `disabled`; dialog Skip uses `aria-disabled`.
- **Keyboard**: `gameShortcutAction` (`useGameShortcuts.ts:54-67`) ignores keys when
  `surfaceOpen`, `itemDialogOpen` (GamePanel passes `itemDialogOpen || rulesOpen`) or any
  `dialog[open]`; window bubble-phase listener so native dialog/menu Escape wins (DESIGN row 249).
  Any new coach-mark/hint surface must feed one of these flags or its Escape will also Skip.
- **Auto-roll** pauses on `surfaceOpen`, `itemDialogOpen`, `confirmationOpen`
  (`autoRoll.ts:126-129`) and already stops on pickups incl. `harmful-scheduled`
  (`autoRoll.ts:98`) — first-item hints coincide with an auto-roll stop.
- **Phone**: `PHONE_MEDIA_QUERY = "(max-width: 600px)"` (`map/mapConfig.ts:12`); panel is the
  bottom 45% (`styles.css:2535-2560`); at 320x568 the HUD budget is 252px of 255.6px, asserted in
  `text-wrapping.spec.ts:16,199`, `save-status.spec.ts:9,274`, `first-turn-notice.spec.ts:35`.
  Short landscape = `(min-width: 601px) and (max-height: 500px)`.
- **Layers**: `--layer-panel 10`, `--layer-turn-moment 15`, `--layer-screen 20`,
  `--layer-map-error 25`, `--layer-toast 30`, `--layer-banner 40` (`styles.css:40-45`).
- **Constants**: magic numbers named (`TOAST_READING_MS`, `MAX_VISIBLE_TOASTS`); copy as named
  constants (`DIALOG_TITLE`, `FIRST_TURN_NOTICE_TEXT`).

---

## 4. Integration Points

### 4.1 Coach mark (first game, 3 steps)
- Trigger: new game only — `reduceAppState` `new-game` vs `resume` (`gameSession.ts:201-207`);
  `useGameApp.newGame/resume` (`useGameApp.ts:155-162`, analytics `mode: "new"|"resume"`).
  There is **no persisted "has ever played" flag**; options are a new storage key, or deriving
  from existing keys (save present / `notice:auto-resume:v1 = "1"`).
- Turn 0 state: `startNewGame` E2E helper asserts ターン数 0; map stays on network overview at
  turn 0 (GameApp L289-296, `overviewKey` L549); `GamePanel` initial focus goes to the heading
  (`GamePanel.tsx:516-520`).
- Targets: dice `rollButtonRef` (`GamePanel.tsx:411`), 踏破区間 dd (`GameHud.tsx:99-104`; phone
  layout differs), map loop — needs projection of the target service's geometry
  (`RailwayMap.tsx:309-333` pattern) or reuse of the 目標路線 fit (L921-926). WebGL-unsupported
  and title→game camera transition must be handled; the map is `inert` on title/clear only.
- Must suspend: auto-roll (cannot be ON at turn 0 — DESIGN row 251 — but the dice and Space/Enter
  are live), shortcuts, notice/toast announceability (`ToastHost obscured`/`announceable`,
  GameApp L487-490).

### 4.2 One-time contextual hints (reveal-gated)
Engine facts available on `session.lastMove` (`gameSession.ts:39-52`) and its `itemRecord`:

| Hint | Detectable from | Safe publication boundary |
|---|---|---|
| First lottery | `lastMove.landing` (`LandingResolvedEvent`, `engine/types.ts:52-62`: `serviceDrawRequired`, `directionDrawRequired`, `serviceCandidates`, `directionCandidates`, `changedService`); reveal uses `landingSnapshot` to decide `drawsLottery` (`animation/turnMoments.ts:141-147`) | `lotteryPublished` (= `published` or `pickup`, `turnMomentPresentation.ts:243`) — after lottery-settle; with 演出 なし no lottery stage, so `published` |
| First time off Yamanote | `lastMove.landing.serviceId !== config.targetServiceId` with the previous ride on target (or `changedService`) | `lotteryPublished` |
| First item | `itemRecord.itemEvents` `pickup-retained` / `pickup-pending-discard` (`types/network.ts:114-124`) | `resultPublished` (after pickup stage) |
| First unfavourable item | `harmful-scheduled` (kinds `delay`,`suspension`,`detour`,`oversleep`, `HARMFUL_ITEM_KINDS`); also `effect-activated`, `cancelled-by-certificate`; `itemTone(kind)` (`itemPresentation.ts:21`) | `resultPublished` |
| Terminus with leftover pips | `lastMove.stopReason === "endpoint"` and `unusedPips > 0`, `endpointKind` (`terminus`/`area-boundary`/`service-boundary`, `types/network.ts:26,58`); copy already in `lastRollText` (`presentation.ts:65-79`) | arrival (`!isBeforeArrival`) is already public for the roll text; `published` is the conservative choice |

- Natural derivation point: alongside `toastInputs` in `deriveTurnMomentDisplay`
  (L325-345), reusing `entryTurn`/`restoredOrOmitted` so restored turns never hint.
- Delivery surface options: (a) `NoticeToastInput` via ToastHost — non-interactive, aria-hidden,
  2 ordinary slots shared with turn toasts and the auto-save notice; (b) a new interactive
  popover/inline card (needed for 「もう表示しない」 and 「詳しく」 → `openRules(sectionId)`).
- Deep links: `openRules("lottery")`, `openRules("items")`, `openRules("goal")` (the goal section
  already says 「終点や収録範囲の端に着いたときは、そこで止まります。残りの出目は使いません。」,
  `rulesGuide.ts:137`). `OpenRules` requires an `opener: HTMLElement` from the event
  (`rulesGuide.ts:7-8`), so a hint with a 詳しく button fits; a toast does not.
- Live region: `selectAnnouncement` returns the constant `FIRST_TURN_NOTICE_TEXT`
  (`saveNotice.ts:125,129`) — a second notice type needs this generalised to carry its text.

### 4.3 Skip button
- Producer: `turnDisplay.canSkip` (`turnMomentPresentation.ts:381`) → `GamePanel.tsx:647` →
  `GameHud.tsx:135`; handler `GameApp.tsx:345-350` (one shared skip: panel, card tap, dialog).
- Phone row is a 3-column grid (`styles.css:2698-2708`); hiding the middle button with
  `display:none` would put おまかせ in the 0.85fr column. Reserving the slot
  (`visibility:hidden`) or re-flowing the grid are the options; DESIGN row 253 mandates dedicated
  classes, no `:last-child`.
- Native `disabled` already removes it from the tab order when idle, so hide-vs-grey does not
  change idle tab order; focus loss when it disappears while focused must be handled (today a
  focused Skip that becomes disabled also drops focus).

### 4.4 Escape hint
- `RollAdjustment.tsx:86` → split into two `<p>`/`PhraseText`, gate the Escape sentence with the
  existing `(hover: hover) and (pointer: fine)` CSS (or `(pointer: fine)` per the issue). The
  rules guide shortcut list (`rulesGuide.ts:69` 「Escape：出目調整の画面で「そのまま」を選ぶ」) is
  already gated. A visually-hidden keyboard sentence precedent exists:
  `GamePanel.tsx:620` 「Escapeキーで選択を解除できます。」.

---

## 5. Show-once persistence precedent (#68 auto-save notice)

- Key: `yamanote-line-sugoroku:notice:auto-resume:v1` (`store/notices.ts:3`), value exactly `"1"`.
  Naming scheme `yamanote-line-sugoroku:<area>:<name>:v<N>`; others:
  `…:settings:v1` (JSON with inner `version: 1`, `store/settings.ts:3-4`),
  `…:save:v1` (+ per-edition suffix, `registry.ts:7-10`). The notice and settings keys are global (not per edition); only the save key is per edition.
- **Key must not contain the word "save"**: E2E storage stubs throw on such keys
  (`store/notices.ts:2` comment) — new keys must follow this.
- Read: `readFirstTurnNotice(storage)` → true only for `"1"`; null storage / throw / other value →
  false (L6-13). Write: `writeFirstTurnNotice` returns boolean, try/catch (L16-24). No JSON, no
  inner version (the `v1` suffix is the version).
- Hook (`useFirstTurnNotice.ts`): reads once on mount (`useState(() => read…)`), in-memory
  `delivered` ref prevents repeats within the page; eligibility is a pure function
  (`saveNotice.ts:65-77`); gated by `publicationReady && !decisionOpen && !confirmOpen &&
  !rulesOpen` (L69); `onNoticeShown` (ToastHost displayed it unobscured + document visible) marks
  delivered; **storage write happens only in `onNoticeAnnounced`** — after the live region actually
  spoke it (L82-86), wired through `GamePanel` `noticeAnnouncementKey`/`onNoticeAnnounced`.
- Tests: pure `tests/unit/save-notice.test.ts` (eligibility, storage absent/invalid/throwing,
  copy, arbitration); mounted `tests/unit/game-app-save-notice.test.ts` (asserts
  `store.getItem(FIRST_TURN_NOTICE_KEY)` null→"1"); `tests/unit/toast-notice.test.ts`;
  helper `tests/unit/helpers/notices.ts` `seedFirstTurnNotice(storage)` used by 4 mounted suites;
  E2E `tests/e2e/first-turn-notice.spec.ts` (`firstTurnNoticeSeen: false`, reload once-only,
  hidden tab, auto-roll interplay, rules dialog wait, `@layout` 320x568 fit with
  `PHONE_HUD_BUDGET_PX = 252`, screenshots to `.claude/logs/screenshots`).
- E2E isolation: `tests/e2e/fixtures.ts` option `firstTurnNoticeSeen` **defaults to true** and
  seeds the key with `context.addInitScript` (L36-38, L67) "so unrelated scenarios stay
  independent". Each Playwright test gets a fresh context (empty localStorage); settings are
  seeded by `support/settings.ts:9-13`. #67 needs the same kind of default-seen option(s), since
  27 of 29 E2E specs start a new game (`startNewGame`, ~68 calls).

---

## 6. Tests that will be affected

### Skip rename (text change)
Exact-text matches break on any label change (`textContent === "スキップ"` / `exact: true`):
- Unit: `game-hud.test.ts:262,308,378(hint),713`; `game-app-turn-moments.test.ts:327,333,827,832`;
  `game-app-item-progress.test.ts:146,225,242,299,332,463,480,488,534,678` (`click("スキップ")`);
  `item-controls.test.ts:1106`; `map-flash.test.ts:595`; `rules-entry-points.test.ts:181,194`;
  `rules-guide.test.ts:268` (shortcut copy).
- E2E `exact: true`: `ui-pop-turn-moments.spec.ts:167,398,587,949`; `capital-region.spec.ts:271,309`;
  `ui-pop.spec.ts:394`. Non-exact `{ name: "スキップ" }` still matches 「演出をスキップ」 or an
  `aria-label` containing it: `support/turnMoments.ts:236` (shared helper), `dice.spec.ts:184`,
  `resume.spec.ts:145`, `lottery.spec.ts:65`, `items.spec.ts:574,644,700`, `layout.spec.ts:110`.
- Label text arrays: `hud-layout.spec.ts:168,174` (`["サイコロを振る","スキップ","おまかせ: OFF"]`
  plus every label fits one line at 320/390/640x400/667x375, and dice x/y unchanged ±1px).
- Hint copy: `accessibility.spec.ts:93`, `game-hud.test.ts:378`.
- Live-region copy 「…スキップできます。」 if changed: `turn-moment-items.test.ts:354`,
  `game-presentation.test.ts:260,366`, `turn-moment-presentation.test.ts:437`,
  `game-app-turn-moments.test.ts:1364`, `ui-pop-turn-moments.spec.ts:381`.

### Skip hidden when not playing
- Assume presence while idle: `layout.spec.ts:110` (`toBeVisible` right after new game),
  `hud-layout.spec.ts:158-174` (3 buttons, idle), `items.spec.ts:644` (`toBeDisabled` after a
  reduced-motion turn), `game-hud.test.ts:274,279,312` (`skip.disabled === true`),
  `game-app-turn-moments.test.ts:333`.
- Layout: phone 3-column grid and short-landscape full-width row (`styles.css:2698,3064`);
  `text-wrapping.spec.ts` / `save-status.spec.ts` HUD budget (252px) — a hidden button must not
  change row height; dice position stability assertion in `hud-layout.spec.ts:176-178`.
- No tab-order test walks through Skip (`accessibility.spec.ts:409-412,430`, `layout.spec.ts:205`
  stay on menu/attribution).

### Dialog Skip removed
- `ui-pop-turn-moments.spec.ts:158-185` ("Skip inside the adjustment keeps the chosen die…"),
  `game-app-turn-moments.test.ts:905-935+` (`dialogSkip()` aria-disabled, focus stays inside),
  any `panelSkip()` filter `!button.closest("dialog")` becomes moot. Rules copy
  「Escape：出目調整の画面で「そのまま」を選ぶ」 unaffected.

### Escape hint
- No test asserts 「Escapeキーでも」 (grep: none). New `@layout`/unit checks needed.

### Coach mark / hints
- Every mounted GameApp unit suite that starts a game (`game-app-*.test.ts`, `map-flash`,
  `rules-entry-points`, `edition-app`, `game-session-items`, `game-hud`) uses real jsdom
  `localStorage` (often `localStorage.clear()` in `beforeEach`) — they would see the coach mark
  unless seeded like `seedFirstTurnNotice`. Same for all E2E via a new fixture option.
- `@layout` specs run on phone-chromium only (Issue #83, `playwright.config.ts:78-79`), so any
  phone geometry assertion for coach marks must be tagged `@layout`.

---

## 7. DESIGN.md constraints (`.claude/docs/DESIGN.md`)

| Row | Constraint for #67 |
|---|---|
| 240 | Moments end by map tap or **the existing Skip**; one Skip ends dice + movement + reveal; dice stays focusable `aria-disabled` during moments. |
| 244 | Publication boundaries: ride/log/candidates at lottery-settle end; items/effects/**hints**/notices/item toasts at pickup end. A hint must never reveal a result earlier. |
| 249 | Shortcuts S/Escape skip; native dialog/menu Escape wins; hint text in the menu is non-focusable; **tab order must not change**. |
| 251 | おまかせ never persisted, always OFF at start. |
| 253 | おまかせ to the right of Skip in the same row; phone 3 columns; short landscape full-width row; dedicated classes, no `:last-child`. A hidden Skip reopens this decision. |
| 262 | #62 adjust dialog stays native modal; "modality keeps focus containment, **Skip** and Escape contracts" — removing the dialog Skip revises this row. |
| 272 | Phone HUD budget 252px of 255.6px at 320x568 must stay unchanged; the phone pill is an obstruction that overlays must avoid. |
| 286 | Rules guide built from config, `openRules(sectionId)` explicitly "reusable by #67". |
| 288 | Show-once notice: once per browser, key `…:notice:auto-resume:v1`, **written only after shown and announced**. |
| 289 | Shortcut hint and rules shortcut list hidden on touch devices (gate precedent for the Escape hint). |
| 248 | Settings key `…:settings:v1` separate from save; `SAVE_VERSION` unchanged — guide flags should likewise stay out of the save. |
| 357 | Residual: Skip during arrival announces the 30/30 guidance twice — touching Skip may intersect. |

---

## 8. Open questions for the user

1. **Who counts as "first game"?** Only browsers with no flag at all, or also exclude players who
   already have a save / the auto-save notice flag (existing v0.17.1 players)? Should resuming a
   turn-0 save show it?
2. **Coach mark interaction model**: blocking (modal/step-through with 次へ/閉じる) or
   non-blocking (dice usable; rolling dismisses)? Can it be re-opened later (e.g. from 遊び方)?
3. **Map step (loop)**: point at the loop on the current overview, or move the camera (目標路線
   fit)? What when the map is unavailable (WebGL fallback) — skip the step or describe in text?
4. **「もう表示しない」 scope**: one switch that turns off *all* hints, or per hint? Since each
   hint is already once-only, is a per-hint opt-out needed at all?
5. **Hint surface**: reuse the toast (non-interactive, auto-expire 4s, no buttons, 2 slots
   shared with turn toasts) or a new tappable card with 「詳しく」 deep links into 遊び方?
   Phone placement must not use HUD budget.
6. **Skip hidden vs greyed**: accept a reserved invisible slot (no layout shift, dice stays put)
   or a re-flow of the action row each time a moment starts? Label: 「演出をスキップ」 text or
   ⏩ icon (accessible name then 「演出をスキップ」?). Should the menu hint/rules copy/live-region
   copy 「スキップできます」 follow the new name?
7. **Dialog Skip removal**: accept that during the adjust dialog the rest of the turn can only be
   skipped after 「…続ける」 (the modal makes map tap and S/Escape unavailable)? This revises
   DESIGN row 262.
8. **Pitch copy**: use 「サイコロと抽選まかせで、山手線を一周して新橋へ。」 verbatim (edition-
   specific: 新橋/山手線) — store it in `EditionDisplay` or derive from config like the rules guide?
