# In-Game UI "Pop" Overhaul — Audit and Improvement Inventory

Date: 2026-10-28 · Branch inspected: `develop` @ `4368673` (v0.10.0, item ruleset `tokyo-suburban-items-1`)
Scope: analysis only, no source changes. Screenshots taken from a scratch build
(desktop 1280x800, phone 400x860, `reducedMotion: reduce`, real map tiles).

## 0. Constraints that shape every proposal

| Constraint | Source | Consequence for UI work |
|---|---|---|
| Lottery/roll are committed before any presentation; animation only reveals | `.claude/docs/DESIGN.md` L129, L182, L185 ("演出は既に確定した結果を見せるだけで抽選には関与しない"); `src/features/game/presentation.ts` header | Roulette, dice tumble, toasts must read `session.lastMove` / `ItemTurnRecord` only. Never call `drawLanding`, `rollDie`, `playTurn`, or any engine RNG from UI. No reducer/save change needed. |
| Data, rules and save format are frozen after launch; display/text/effects may change | DESIGN.md L222 (公開告知 D5 残り) | Do **not** add fields to `public/data/manifest.json` (`uiPresentation`) for badges; keep new presentation tables in `src/` (frontend-only). |
| Brand deliberately avoids JR marks | `brand/README.md` L35-38: avoided "the JY station-numbering sign (rounded square with line letters)", "a line-colour ring with a letter inside (metro station numbering)", "a ring made of 30 parts (JR East's 2025 loop-centenary logo)" | Line badges must not reproduce station-numbering signs (no `JY`/`JK`/`G`/`M` letter codes in squares or coloured rings). 30-segment progress gauge must not look like a 30-part ring logo. |
| Brand palette | `brand/README.md` L39-40 | vermilion `#d9502f` (primary, theme-color), ink `#263238`, cream `#faf7ef`. Logo font Zen Maru Gothic is outlined at build time (no runtime webfont). |
| Accessibility NFR | DESIGN.md L109; `src/features/game/usePrefersReducedMotion.ts` | Every new animation must collapse to instant under `prefers-reduced-motion` and be skippable; outcome must stay available as text (live region). |
| Layout NFR | DESIGN.md L108; `tests/e2e/layout.spec.ts` L39-61 | Panel must stay inside the viewport and cover < `MAX_PANEL_SHARE_OF_MAP` of the map; must not overlap zoom controls. |
| E2E runs with `reducedMotion: "reduce"` by default | `playwright.config.ts` `use.reducedMotion` | Animations gated on reduced motion are invisible to most specs. Only specs that opt out (`accessibility.spec.ts` L19, `dice.spec.ts` L125, `lottery.spec.ts` L36, `items.spec.ts` L174/L260, `capital-region.spec.ts` L208/L292, `resume.spec.ts` L73) see them; there the existing Skip button must also skip new reveals. |

## A. Current UI inventory

### A.1 Shell and data flow

- `src/app/GameApp.tsx`: one persistent `RailwayMap` behind three screens (Title, GamePanel, ClearScreen) plus `ConfirmDialog`. Computes `progress` for the map, the animation (`useMoveAnimation`), speed/follow state.
- State machine: `src/features/game/gameSession.ts` (`SessionPhase = idle | committing | awaiting-adjust | resolving | animating | awaiting-discard`) and `src/features/game/itemSession.ts` (item flow; `itemSessionView()` is the UI-facing view: inventory, usableItems with `reason`, hints, decision, effects, events).
- Turn flow (item mode, the only playable mode):
  1. `idle` → click roll → `item-commit` → `beginItemTurn` draws the raw die (engine) → `committing` (save) → `awaiting-adjust` if a 出目調整券 is legal, else straight to `finishItemTurn`.
  2. `finishItemTurn` resolves movement **and** the landing lottery (`ItemTurnRecord.landing` + `landingSnapshot` with per-service `weight`, `directions`, `directionWeights`) → `resolving` (save) → `animating` with `stagedAnimation`.
  3. `animation-finished` → `idle` (or `awaiting-discard` if inventory full) → the lottery text is revealed.
- So every number a roulette/dice needs (raw roll, adjustment, effective face, service candidates with weights, direction candidates with weights, chosen result, item events) already exists in `session.lastMove.itemRecord` before the reveal moment. Weighted wheels are possible without engine calls.
- Text is produced by pure helpers in `src/features/game/presentation.ts` (`lastRollText`, `landingText`, `arrivalSummary`, `itemEventTexts`, `activeItemEffectTexts`, `itemTurnAnnouncement`, `itemHistoryText`) and `src/features/game/itemPresentation.ts` (`ITEM_DESCRIPTIONS`, `itemTiming`, unavailable labels, `directionGuidance`).
- Line names/colours: `src/features/game/presentationResolver.ts` (`serviceName`, `lineGroupColor`, `candidateRows` which merges the 大江戸線 two-slot case into "大江戸線（抽選枠2）").

### A.2 Components

| Component | File | What it shows | Styling | A11y / responsive | E2E/unit dependencies (blast radius) |
|---|---|---|---|---|---|
| GamePanel | `src/features/game/components/GamePanel.tsx` (340 lines) | `<main aria-label="ゲーム操作">`; title + subtitle; `<dl>` stats 現在駅/乗車中 (10px swatch)/進行方向/ターン数/踏破区間/出目; roll + スキップ; staged item summary; InventoryPanel; options row 追尾/速度/新規/タイトル; `.item-arrival` arrival sentence; ItemEventNotice; `.game-panel__lottery` "抽選: …"; visually-hidden live region; `<details>` 地図なしで確認 (remaining sections + next 5 stations); `<details>` all candidates (>4); `.game-panel__save` "セーブ: …"; GameLegend; item dialogs | Plain CSS `src/styles.css` BEM-ish classes. Desktop fixed bottom-left 310px, max-height `100% - 120px`, scrolls. Phone ≤600px full-width bottom sheet, `max-height: 45%`. Landscape ≤500px tall: 2-column grid areas. | Focus heading on mount, roll-focus restore after dialogs, single polite live region, Escape clears draft. | **Heavy.** `tests/e2e/support/app.ts` `panelStat()` reads `<dt>`→`<dd>` by exact label: ターン数 (22 uses), 現在駅 (12), 乗車中 (11), 踏破区間 (9), 出目 (7), 進行方向 (6). `diceButton()` matches `/サイコロを振る|移動中…/`; `toHaveText("サイコロを振る")`, `"移動中…"`. `.game-panel__lottery` exact text (12 uses, e.g. `"抽選: 品川：6系統から抽選 → 京急本線 普通 ／ 方向抽選 → 浦賀方面"`, `"抽選: 移動中…"`). `.item-arrival`, `.game-panel__save` ("セーブ:"), `.game-panel__options`, `.game-panel__route-summary > summary`, `getByText("地図なしで確認")`, region "山手線の未踏破区間", heading "乗車中の次の駅", buttons スキップ / 追尾: ON / タイトル, `.visually-hidden[role=status][aria-live=polite]` and `^\d+ターン目` announcement format (`accessibility.spec.ts` L81-175), "サイコロを振れます". Layout share/overlap assertions in `layout.spec.ts`, landscape 667x375 visibility (`accessibility.spec.ts` L220). |
| InventoryPanel | `src/features/game/components/InventoryPanel.tsx` (67) | "アイテム（3枠）" heading; 3 list rows, each: slot number, item name `<h3>`, effect sentence, timing sentence, rapid/deadhead recommendation hint, "replaces current selection" note, full-width "このアイテムを使う / 選択中・変更する" button, disabled reason text; empty rows say "空き枠" | Text rows with borders; selected = green border. **No icons.** | Buttons with `aria-pressed`, `aria-describedby` reason. One item row is ~150px tall on desktop and fills the entire visible phone sheet (screenshot `phone-3-after-rolls.png`). | `items.spec.ts` L48 `inventoryItem()` = `.item-slot` filtered by `heading` name (e.g. 快速券, 回送列車, 路線指定券), then `getByRole("button")` + `aria-pressed`; heading "アイテム（3枠）" (L55, L247). `tests/unit/item-controls.test.ts` L81-125 (three slots, selected state, disabled reason, passive certificate). |
| ItemUseDialog | `ItemUseDialog.tsx` (187) | Native modal `<dialog>`: route ticket → radio list grouped by line group with long guidance text per direction; direction ticket → 2 radios | Text radios, green tint for 山手線 option | Focus first/checked radio; Escape cancels | `items.spec.ts` L204-208 (dialog radio, "この路線に決める"/"この方向に決める"); unit `item-controls.test.ts` L126-168. |
| RollAdjustment | `RollAdjustment.tsx` (82) | Modal "出目を調整しますか？", raw roll as bold digit, radios −1/そのまま/+1 | Text | Heading focus, Escape = continue | Dialog name used in `support/app.ts` `revealUnadjustedRoll`, `items.spec.ts` L83-100, 212, 250; radio names `/−1/`, `/\+1/`; button `出目N で続ける`, "そのまま続ける". |
| DiscardChoice | `DiscardChoice.tsx` (50) | Modal "捨てるアイテムを選ぶ", 4 text buttons, "新しく拾った" tag | Text | Non-cancellable | Dialog name + `getByRole("button")` count 4 (`items.spec.ts` L108-115, support `rollOnce`). |
| ItemEventNotice | `ItemEventNotice.tsx` | `<section aria-label="アイテムのお知らせ">`: "Nターン目のアイテム" list (pickups, uses, activations), "続いている効果" countdown list | Bulleted text | Region | `items.spec.ts` L44 region; texts "倍速券を使いました", "遅延証明書で打ち消しました", "遅延が発動しました" (also checked via live region). |
| GameLegend | `GameLegend.tsx` (127) | Always: 3 legend rows + note; toggle for 134-line per-operator checkbox tree; すべて表示 | Text + CSS swatches | Checkbox tree with mixed state | `getByRole("list", {name:"凡例"})`, `/路線の凡例/`, `.game-panel__legend-operator`, checkbox "京浜東北線を表示", "山手線 踏破済み"; `tests/unit/game-legend.test.ts`. |
| TitleScreen | `TitleScreen.tsx` (255) | Logo, 3 paragraphs of rules text, はじめから / つづきから / クレジット, version | Card over dimmed map | Focus management | `titleScreen()` = main named 山手線すごろく; buttons はじめから, `/つづきから/`, クレジット, `getByRole("img",{name:"山手線すごろく"})`, `getByText("東京近郊版")`. |
| ClearScreen | `ClearScreen.tsx` (133) | "クリア！" heading, sentence, stats dl (turns/moves/transfers), paged text history (20/page), copy/share, play again / title | Card, phone bottom sheet 60% | Focus heading | region "クリア！", heading, 前のページ/次のページ, `.clear-screen__history`, share buttons; `tests/unit/result-share.test.ts`, `credits-screen.test.ts`. |
| ConfirmDialog | `ConfirmDialog.tsx` | alertdialog new game / delete save | `.dialog` | | alertdialog "セーブデータの削除", 削除する, キャンセル. |
| RailwayMap | `src/features/map/RailwayMap.tsx`, `railwayLayers.ts`, `mapConfig.ts` | Track layers (opacity 0.5), Yamanote completed solid / pending dashed, current service highlight (width 7), station circles, labels, player marker = **plain red circle** (`CURRENT_POSITION_COLOR #e53935`, radius 10), overview buttons 全体 / 目標路線 | MapLibre paint props | Map inert on title/clear | `support/app.ts` `readMap()` reads `LAYER_IDS.currentPosition` circle layer (`markerRendered`), completed/pending paint; `map-visual.spec.ts`, `dice.spec.ts` L39-122. Changing the marker layer type requires updating `src/features/map/e2eHook.ts` + `readMap`. |

### A.3 Styling system

- Single global stylesheet `src/styles.css` (1,144 lines). Only custom properties are z-index layers (`--layer-panel` etc.) and `--completed-line-color`. All colours hard-coded (`#2e7d32` green primary, `#555`, `#8a3b00`, …). The app's "primary" green is unrelated to the brand vermilion.
- Buttons are browser-default grey with only `min-height: 44px` (the dice button `.game-panel__roll` is merely bold, not a primary/CTA style — visible in `desktop-3-after-rolls.png`).
- Fonts: system-ui stack; no display font in game UI (brand font only in the outlined logo).
- Icon assets: none besides `public/logo.svg`, `public/favicon.svg`, PNG icons/OGP. No SVG sprite, no icon component, no emoji usage. Only glyph icons are "▶/▼" in the legend toggle.
- Motion: only the map marker animation; no CSS transitions/keyframes anywhere in `styles.css`.
- Line metadata: `public/data/manifest.json` `uiPresentation.lineGroups` gives `{id, name, operatorId, color, serviceIds}` for 134 groups / 15 operators. **No short names or line symbols.** Colours collide (e.g. 中央線快速, 青梅線, 五日市線 all `#F15A22`; 埼京線, 川越線, 相鉄線直通 all `#00AC9A`), so a colour-only icon cannot distinguish lines.

### A.4 Observed problems (screenshots in scratchpad, see §E)

1. Wall of text: after 3 turns the desktop panel is 926px of content in a 680px box. The same lottery sentence is rendered twice visibly (`.item-arrival` "3ターン目：出目6…目黒：山手線・東京メトロ南北線 各停・都営三田線 各停・東急目黒線 各停から抽選 → 東京メトロ南北線 各停 ／ 乗車方向は赤羽岩淵方面のみ。踏破 7/30" and `.game-panel__lottery` "抽選: 目黒：…" — `GamePanel.tsx` L273-282).
2. Phone: the bottom sheet (45% height) is filled by stats + roll + one inventory row; the lottery result, item notices and save state are below the fold (`phone-3-after-rolls.png`; scrollHeight 916 vs clientHeight 387). The attribution box takes 3 lines at the top of the map on phone.
3. Information the player does not need every turn is always visible: "セーブ: 自動保存済み", legend note "現在地・乗車中の路線・山手線の進捗は常に表示します。", the 速度/追尾/新規/タイトル row, slot numbers, item "timing" sentence on every slot.
4. No visual hierarchy: CTA (サイコロを振る) is the same grey as スキップ; the result of the turn (what line/direction I'm on now) is a 10px swatch + text in a definition list.
5. The lottery — the main "game moment" of each turn — is a single sentence with arrows and slashes, revealed silently when the marker stops.
6. Dice: no die visual; "出目" is a string such as `3（3マス、2駅移動、残り1は使わず）`.
7. Items look like form rows; harmful item effects and countdowns are a bulleted list with no iconography or severity colour.
8. Progress 7/30 is only a number (map shows it, but the panel gives no feeling of progress).
9. Title screen is three paragraphs of rules before the start button (`desktop-1-title.png`).
10. Clear screen is a text card ("クリア！") with a text log; no celebration.
11. Player marker is a red dot with no direction or "train" identity.

## B. Proposals for the three requested items

Shared building blocks (used by all three; build first):

- **Design tokens** in `src/styles.css` `:root`: `--color-brand: #d9502f`, `--color-ink: #263238`, `--color-cream: #faf7ef`, `--color-surface`, `--color-good`, `--color-bad`, `--radius-*`, `--shadow-*`, `--motion-fast/normal/slow`, plus `@media (prefers-reduced-motion: reduce) { --motion-*: 0ms }`. Restyle `button` and `.button-primary` (vermilion, rounded, pressed state).
- **`LineBadge` component** (`src/features/game/components/LineBadge.tsx` + `src/features/game/lineBadge.ts`): original-styled "ticket/tag" pill — colour bar or colour-filled rounded rectangle with a short **kanji** label (e.g. 山手, 京浜東北, 南北, 三田, 目黒), white/ink text chosen by contrast. Short label table is a frontend constant keyed by line-group id with an algorithmic fallback (strip operator prefix such as 東京メトロ/都営/東急/京王…, strip 線/各停/快速 suffixes, cap at 4 chars). Do **not** use alphabetic line codes (JY/JK/G/M) or a coloured ring with a letter (avoided by `brand/README.md`).
- **Item icon set** (`src/features/game/components/ItemIcon.tsx`): 11 self-made inline SVGs (path data in TS, `currentColor` + accent), e.g. 路線指定券 = ticket with a branching track, 方向指定券 = ticket with arrow, 出目調整券 = die with ±, 倍速券 = "×2" bolt, 快速券 = express chevrons, 回送列車 = train with "回送" plate, 遅延証明書 = shield/paper; harmful: 遅延 = clock, 運休 = barrier/✕, 寄り道 = zigzag path, 寝過ごし = "zzz". Beneficial = cream card with brand border; harmful = dark/red card. No external icon library needed (keeps the bundle small and avoids licence review).
- **`useRevealSequence` hook** (`src/features/game/animation/useRevealSequence.ts`): a presentational timeline keyed by `(sessionId, turn)`; stages complete instantly when reduced motion is on, when the record is restored from a save (no replay on resume), or when the player presses Skip / the roll button. Exposes `stage` and `skip()`; never touches the reducer.

### B.1 Request 1 — Line + direction lottery roulette popup

**What appears, when**

- Trigger: the moment the move animation finishes (`phase` leaves `animating`) **and** `lastMove.landing` exists with `serviceDrawRequired || directionDrawRequired`. Not on resume (use the same "turn advanced" guard as `GamePanel.tsx` `knownTurn`), not on goal turn (`landing === null`), not on 回送列車 (`stopReason === "relocation"`).
- A centred overlay card over the map (non-modal `role="dialog"`-free `<section aria-label="乗換抽選">`, so focus stays on the dice button and existing modal dialogs are unaffected). Header: "目黒で乗換抽選！" with the station name.
- **Stage 1 — line roulette** (only when `serviceDrawRequired`): candidate `LineBadge`s laid out as a ring/strip (use `presentation.candidateRows(...)` so 大江戸線 stays one row labelled "抽選枠2"). A highlight cursor runs over badges, decelerating (ease-out, ~1.4 s, 2–3 laps), and stops on the committed `landing.serviceId`. The cursor path is precomputed deterministically from the result index (no `Math.random`, so screenshots/tests are stable). Option (user decision): render as a pie/wheel whose slice sizes use `landingSnapshot.services[].weight` so "山手線 1/2" is visibly true; or keep equal tiles with a "当たりやすさ" mini-bar. Equal-size tiles with a weighted lottery would visually misrepresent odds.
- **Stage 2 — direction** (only when `directionDrawRequired`): two big arrow cards "◀ 品川方面" / "赤羽岩淵方面 ▶" (labels from `directionLabel`), with `directionWeights` shown as "山手線に近い向き" tag on the toward-target side; a coin-flip/flicker for ~0.8 s lands on `landing.direction`.
- **Result stamp**: "乗換！ [南北 badge] 東京メトロ南北線 → 赤羽岩淵方面" (or "そのまま 山手線 外回り") pops with a scale bounce; auto-dismiss after ~1.2 s or on tap/click/Enter/roll.
- Forced outcomes (single candidate, Yamanote fixed 外回り, endpoint reversal) show **no roulette** — just a small toast chip "山手線 外回りに固定" / "終点のため折り返し" (see C.4).
- Suspended services (item mode): show them as greyed badges with a "運休" strap and excluded from the cursor (data: `view.hints.suspendedServiceIds` at arrival time, or diff of `landingOptions` vs `landingSnapshot`); `suspensionIgnored` → banner "全路線運休中のため運休を無視".
- Ordering with item events: arrival → roulette → pickup toast → discard dialog. `DiscardChoice` must mount only after the reveal finishes (it uses `showModal()`; mounting it during the roulette would cover it).

**Info kept / moved / dropped**

- Keep: final ride (line + direction) — becomes the HUD "now riding" card (B.3).
- Move: the full candidate sentence (`landingText`) goes into the turn log drawer (C.9) and the live-region announcement; the "抽選候補をすべて表示" `<details>` becomes unnecessary (the roulette shows all candidates).
- Drop from the panel: the duplicated `.game-panel__lottery` + `.item-arrival` pair.

**Hooks**: `session.phase`, `session.lastMove.landing` (`LandingResolvedEvent`: `serviceCandidates`, `serviceId`, `serviceDrawRequired`, `directionCandidates`, `direction`, `directionDrawRequired`, `changedService`), `lastMove.itemRecord.landingSnapshot` (weights), `presentation.candidateRows/lineGroupColor/serviceName`, `directionLabel`.

**Files**: new `LotteryReveal.tsx`, `LineBadge.tsx`, `lineBadge.ts`, `useRevealSequence.ts`; edit `GamePanel.tsx` (mount, gate DiscardChoice, drop duplicate paragraphs), `GameApp.tsx` (overlay placement outside the panel so it is centred on the map; Skip wiring), `styles.css` (keyframes). Unit tests for the deterministic cursor path and weighted slice maths.

**Size**: L (M without the weighted wheel).

**Risks**

- Determinism: safe as long as the component only reads the record — add a unit test asserting no engine module except types/`directionLabel` is imported, or keep it in `components/` with no `engine` value imports.
- E2E: `.game-panel__lottery` exact-text assertions (12) and `lottery.spec.ts` "skip reveals the committed transfer" (runs with motion). Keep a single text line with the same class and copy, or update the specs in the same PR. Make スキップ also finish the reveal.
- A11y: announce the outcome once in the existing live region **at reveal end** (or immediately under reduced motion); the roulette itself `aria-hidden`. Do not add a second live region (`items.spec.ts` L56 asserts exactly one `[role=status]` in the panel).
- Pace: 55-turn median game (DESIGN.md L25) × ~2 s extra per turn ≈ +2 min per game. Provide a speed setting coupling (はやい → 0.6 s; existing speed button) and tap-to-skip.
- Phone: overlay must sit above the bottom sheet and not hide the marker; cap to ~8 visible badges and scroll/wrap for stations like 品川 (6) / 新宿 (many).

### B.2 Request 2 — Icon inventory box with hover/touch details

**Design**

- A horizontal "持ち物" box of 3 square slots (≈64px desktop, ≈56px phone) inside the HUD: each filled slot shows the `ItemIcon`, a short name under it (路線指定 / 倍速 …), a corner badge for status (✓ selected, 🔒-style lock glyph drawn in SVG for unusable, "おすすめ" star for `recommended`). Empty slots are dashed outlines (no "空き枠" text needed visually; keep it as `aria-label`).
- Interaction:
  - Desktop: hover/focus shows a tooltip card (name, effect, timing, hint/reason). Click opens a small **item card popover** with the full description and a primary "使う" button (route/direction tickets open the existing ItemUseDialog from there).
  - Touch: first tap opens the same item card (bottom sheet on phone); "使う" in the card confirms. Avoid hover-only information (iOS has no hover). Long-press is not needed.
  - Selected item: slot glows (brand vermilion ring, gentle pulse unless reduced motion); the dice button label stays "この内容でサイコロを振る" (E2E matches `/^サイコロを振る|この内容で/`).
  - Passive 遅延証明書: shield icon with "持っているだけで効く" in the card; not clickable to "use".
- Pickup feedback: newly picked item flies/pops into its slot (scale-in) with a toast (C.4); harmful pickups show a red flash and move to an "効果" row of status chips (時計 遅延 あと2, 運休 [badge] あと4, 寄り道, 寝過ごし) directly under the inventory — replaces the "続いている効果" bulleted list.
- Discard dialog reuses the same item cards (4 tiles, "NEW" ribbon on the new pickup).
- RollAdjustment dialog: show a big die face with −1 / そのまま / +1 as three die buttons.

**Info kept / moved / dropped**: keep name + icon + state on the slot; move effect/timing/hint/reason sentences into the tooltip/card (still `aria-describedby`); drop slot numbers and the "アイテム（3枠）" visual heading (keep it visually hidden — E2E uses it).

**Hooks**: `ItemSessionView.inventory`, `usableItems[].{usable, reason, selected, recommended}`, `hints.rapidHeadsTowardYamanote/deadheadRecommended`, `effects`, `events` (pickup), `decision`.

**Files**: rewrite `InventoryPanel.tsx`; new `ItemIcon.tsx`, `ItemCard.tsx` (tooltip/popover), `EffectChips.tsx`; restyle `DiscardChoice.tsx`, `RollAdjustment.tsx`; `itemPresentation.ts` gains `shortName`; `styles.css`.

**Size**: M.

**Risks**: `items.spec.ts` `inventoryItem()` filters `.item-slot` by an item-name **heading** then clicks its only button — keep a `.item-slot` element with a (visually hidden if needed) `<h3>` name and a single button, or update the helper and `tests/unit/item-controls.test.ts`. Tooltip must not be the only place the disabled reason lives for screen readers (keep `aria-describedby`). Touch: 44px minimum targets (existing global rule). Popover must not trap focus incorrectly next to native `<dialog>`s.

### B.3 Request 3 — Simplify the sidebar into a game HUD

**Design** (one compact HUD, ~40% of today's height):

```
┌──────────────────────────────────────┐
│ [山手 badge] 山手線  外回り ▶        │  ← now riding (big)
│ 📍 目黒                ターン 6      │
│ 山手線 ███████░░░░░░░░░  7 / 30      │  ← progress bar (C.3)
│ [ 🎲 サイコロを振る ]  [スキップ]    │  ← vermilion CTA
│ 持ち物 [▣][▣][ ]   効果 ⏰2  ⛔4     │
│ ≡ ログ   ⚙ 設定                      │
└──────────────────────────────────────┘
```

- **Keep visible**: current station, current line badge + direction, turn, progress X/30, the dice CTA (with last die face shown on the die icon), inventory box, active-effect chips.
- **Move behind a "ログ" drawer** (C.9): arrival sentence, lottery sentence, item event transcript, 地図なしで確認 content (remaining sections, next stations), full candidate list.
- **Move behind a "設定/メニュー" button** (gear): 追尾, 速度, 新規, タイトル, line legend tree (134 lines), save status detail.
- **Drop or minimise**: subtitle "東京近郊版" in-game, legend note sentence, "セーブ: 自動保存済み" (show only a small check icon; surface failures as a warning toast + persistent red icon — failures must stay visible, `GamePanel.tsx` L295-300 / `ClearScreen` save warning), slot numbers, the duplicated lottery paragraphs, the long 出目 string (die face + "6マス" is enough; the "残り1は使わず" detail goes to the log).
- The roulette (B.1) and toasts (C.4) take over the job of "telling what just happened", so the HUD only answers "where am I, what am I riding, what can I do".
- Phone: HUD becomes a 2-row bottom bar (~150px) + inventory row; drawer/menu open as bottom sheets. Landscape-short: single row.

**Hooks**: same data as today (`displayedRide`, `displayedStationId`, `displayedCompletedCount`, `itemView`); no new state except `drawerOpen`/`menuOpen`.

**Files**: `GamePanel.tsx` split into `GameHud.tsx`, `TurnLogDrawer.tsx`, `GameMenu.tsx`; `GameLegend.tsx` moves into the menu; `styles.css` layout sections for ≤600px and ≤500px-tall.

**Size**: M–L (mostly test churn).

**Risks / blast radius**: largest of the three for tests.

- `panelStat(label)` relies on a `<dt>`/`<dd>` pair with exact labels 現在駅/乗車中/進行方向/ターン数/踏破区間/出目 (≈67 call sites). Cheapest path: keep a `<dl>` with the same `<dt>` labels rendered in the HUD (labels can be visually hidden with `.visually-hidden`; Playwright `toHaveText` on the `<dd>` still works). Note: `dd` text must stay e.g. "7/30" and the bare roll text for `出目` (`"3（3マス、2駅移動、残り1は使わず）"` is asserted in `items.spec`/`dice.spec`) — either keep that exact text in a visually-hidden `<dd>` or update those specs.
- `.game-panel__options` buttons (追尾: ON, タイトル, スキップ) are asserted visible (`layout.spec.ts` L33-35, `accessibility.spec.ts` L220-247 "landscape keeps the lottery and options visible"). Moving them into a menu requires spec edits.
- "地図なしで確認" `<details>` is a deliberate accessibility affordance (text alternative to the map, DESIGN.md L109); it must remain reachable (in the log drawer) and its region/heading names kept or the specs (`accessibility.spec.ts` L180, `items.spec.ts` L222) updated.
- Layout/follow-camera specs compute padding from the panel box (`accessibility.spec.ts` L249-340); a smaller HUD helps but camera padding code in `RailwayMap`/`camera.ts` reads the panel size — re-verify.

## C. Additional improvement candidates

Value H/M/L = player-visible fun/clarity; Cost S/M/L.

| # | Candidate | Problem observed (evidence) | Proposal | Value | Cost |
|---|---|---|---|---|---|
| C.1 | Dice roll animation | No die visual; `lastRollText` string (`presentation.ts` L60-79); CTA is grey (`styles.css` `.game-panel__roll`) | Big vermilion "🎲" CTA (SVG die matching the brand mark). On click: 3D-ish CSS die tumble ~0.6 s landing on `rawRoll` (known after `item-commit`/`awaiting-adjust`), then ×2/±1/寝過ごし modifiers animate as stamps ("×2 → 8マス"). Delay passing `session.animation` to `useMoveAnimation` until the tumble ends (UI-only). Reduced motion: instant. | H | M |
| C.2 | Player piece on the map | Marker is a red circle (`mapConfig.ts` L85-88) | Brand-styled pawn/train-head icon (`map.addImage` SVG → symbol layer) with direction arrow and the current line colour ring; pulse when idle. Keep the circle layer id or update `e2eHook.ts`/`readMap` (`markerRendered`). | H | M |
| C.3 | Progress visualisation | Only "7/30" text in the panel | Segmented progress bar (30 ticks, straight bar — not a 30-part ring, see brand caution) with the next-uncompleted section label; milestone toasts at 10/20/30 and "あと新橋だけ！" after 30/30. Optional mini schematic of the loop drawn as a rounded rectangle line (not a segmented ring). | H | S |
| C.4 | Event toasts | Item events and forced-ride notes are bullet lists (`ItemEventNotice.tsx`); save failures are a grey line | Top-centre toast stack with icons: pickup (good/bad colour), item used, effect activated, effect expired, "折り返し", "山手線に乗った！", save failed (sticky). Toasts are visual; the single live region keeps the text. | H | M |
| C.5 | Landing / arrival feedback | Marker just stops | Station name "ご当地" banner pop ("目黒 に到着！") 0.8 s; Yamanote segments flash when newly completed (the map already updates progress per hop via `visibleCompletedSegmentIds`). | M | S |
| C.6 | Title screen onboarding | Three dense rule paragraphs before the start button (`TitleScreen.tsx`, `desktop-1-title.png`) | Big はじめから CTA first; rules into a "遊び方" 3-step illustrated carousel (roll → lottery roulette → collect 30 sections), item list with icons. Keep the current text in a `<details>` (DESIGN.md L214 fixes the rule wording). | M | M |
| C.7 | Clear celebration | Plain "クリア！" card (`ClearScreen.tsx`) | Confetti/train-horn style burst (reduced-motion: static), big stat tiles with icons (turns/moves/transfers), share button prominent, history as a compact timeline with line badges per turn. Share text unchanged (DESIGN.md A1 decision). | M | M |
| C.8 | Visual design system | No tokens, browser-default buttons, green primary unrelated to brand (`styles.css` L23-47) | Tokens (§B shared), brand vermilion/ink/cream, rounded "pop" cards, Zen Maru Gothic-like feel via system rounded fonts (no webfont, or self-host a subset only if user accepts the size). | H | S–M |
| C.9 | Turn log drawer | History visible only on the clear screen; per-turn text duplicated in the panel | "ログ" drawer listing past turns (reuse `itemHistoryText`) newest first, each with die face, line badges, item icons. Hosts the text-only route view. | M | M |
| C.10 | Mobile layout | Phone sheet 45% height filled by one item row; attribution 3 lines at the top (`phone-3-after-rolls.png`) | HUD bar (B.3); collapse MapLibre attribution to the (i) button by default on phone (`compact: true`) — keep it reachable for CC BY / ODbL compliance. | H | S–M |
| C.11 | Sound effects (opt-in) | None | Dice rattle, roulette ticks, pickup chime, clear fanfare; off by default, toggle in menu, honour reduced motion? (sound is separate; just default-off). Self-made or CC0 sources only; record licences in credits. | L–M | M |
| C.12 | Empty states / hints | "空き枠" text rows; "この路線に次の駅はありません" | Friendly empty slot art; first-time coach marks (first roll, first lottery, first item) stored in localStorage (separate key from save). | M | S |
| C.13 | Item use dialogs | Route ticket dialog is radio rows with long distance sentences (`ItemUseDialog.tsx` L120-140) | Line badge cards with "山手線まであとN駅" chip and arrow per direction; same LineBadge as the roulette. | M | M |
| C.14 | Map overview buttons | "全体"/"目標路線" text buttons (`styles.css` `.map-overview`) | Icon buttons (globe / loop) with tooltips; consistent with menu style. | L | S |
| C.15 | Dark/night theme | Map and panel light only | Optional; defer. | L | M |

Ranking for "pop" impact per cost: C.8 tokens → C.1 dice → C.3 progress bar → C.4 toasts → C.2 pawn → C.10 mobile → C.7 clear → C.6 onboarding → C.9 log → C.13 → C.12 → C.11 → C.14/C.15.

## D. Suggested implementation order

| Phase | Content | Why first | Size |
|---|---|---|---|
| P0 Foundation | Tokens + button restyle (C.8), `LineBadge` + short-label table, `ItemIcon` SVG set, `useRevealSequence` hook, toast host (C.4 skeleton) | Every later phase depends on them; zero test churn | M |
| P1 HUD + inventory (Requests 3 and 2) | `GameHud`, inventory box with item cards, effect chips, menu + log drawer, phone bottom bar, attribution compaction (C.10), progress bar (C.3) | Both live in the panel and share the test migration (panelStat, options, item-slot); do the E2E selector migration once | L |
| P2 Turn "moments" (Request 1 + dice) | Lottery roulette + result stamp, dice tumble (C.1), arrival banner (C.5), pickup animations, sequencing with DiscardChoice | Biggest fun gain; needs P0 badges/hook and P1 HUD to land into | L |
| P3 Map + screens | Player pawn (C.2), clear celebration (C.7), title onboarding (C.6), item dialog cards (C.13), coach marks (C.12) | Independent, can parallelise | M each |
| P4 Optional | Sound (C.11), overview icons (C.14), dark theme (C.15) | Nice-to-have | S–M |

Each phase: presentation-only, no change to `src/features/game/engine/**`, `src/types/network.ts`, saves, or `public/data/**`. Release under the D5 policy as a display update (no minor bump needed for rules/data).

**Assets**: no external icon set required. Prefer self-made inline SVG (TS path constants) and CSS-drawn badges. Do not reproduce official JR/metro line symbols, station-numbering signs, operator logos or train imagery (brand README already avoids them; railway companies hold trademark/design rights on these marks). Line colours themselves are already used on the map and are fine as colour fills. If a third-party icon set is ever used, choose a permissive licence (MIT/ISC/CC0, e.g. Lucide/Tabler) and add it to the credits and `third-party-licenses.txt`; fonts must be OFL and should stay outlined/subsetted.

**Testing impact (testing.md)**: new pure helpers (badge label derivation, cursor path, weighted slice angles, reveal-stage reducer) get Vitest unit tests; component behaviour in jsdom tests (`tests/unit/helpers/reactDom.ts` pattern). E2E: migrate `tests/e2e/support/app.ts` helpers (`panelStat`, `diceButton`, `inventoryItem`) once in P1; add one motion-enabled spec that the roulette lands on the saved `landing.serviceId` and that Skip ends it; keep the reduced-motion default so the rest of the suite is unaffected. Never loosen assertions to pass — re-point them.

## E. Screenshots (scratch, not committed)

Directory: `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/ac4c20c7-818a-4bdd-997d-b90db1b06085/scratchpad/shots/`

- `desktop-1-title.png` — title card with three rule paragraphs.
- `desktop-3-after-rolls.png` — turn 3, panel with one item (快速券) and the arrival sentence; grey dice button.
- `desktop-5-panel-scrolled-bottom.png` — duplicated arrival + "抽選:" sentences, save line, legend.
- `phone-3-after-rolls.png` — 400px: sheet filled by stats + one item row; result text off-screen; attribution 3 lines at top.
- also `*-2-game-start.png`, `*-4-panel-scrolled-mid.png`, `phone-5-panel-scrolled-bottom.png`.

## F. Open questions for the user

1. Roulette odds: weighted wheel (slice size = real probability, e.g. 山手線 1/2) or equal tiles with an odds label? (Equal tiles without a label would misstate the weighted lottery.)
2. Reveal length vs pace: target total extra time per turn (proposal ≈1.5–2 s at ふつう, tap to skip; median game is ~55 turns).
3. Badge label style: kanji short names (山手/南北/三田) — acceptable, or line colour + full name only?
4. Settings/menu: OK to move 追尾/速度/新規/タイトル and the 134-line legend behind a menu button (changes several E2E specs)?
5. Sound: wanted at all? If yes, default off?
6. Brand direction for the in-game UI: adopt the logo's vermilion/ink/cream palette (replacing the current green primary)?
