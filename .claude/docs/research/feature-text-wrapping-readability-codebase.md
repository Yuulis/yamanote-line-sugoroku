# Issue #70 — Japanese text wrapping and HUD readability: codebase scan

Scope: read-only scan of `develop` at v0.13.0 (`a375384`). The issue was written against
v0.12.0; differences are called out. Related prior analysis: UX-25 and UX-28 in
`.claude/docs/research/ux-improvement-analysis.md` (lines 321-377, 400).

## Summary of decision-relevant findings

1. **The menu speed-button wrap (「速度: ふつ / う」) is already fixed in v0.13.0.** Commit
   `ab9213d` added `white-space: nowrap` to `.game-panel__options button`
   (`src/styles.css:958-962`); v0.12.0 had none on desktop and `overflow-wrap: anywhere` in
   short landscape. `tests/e2e/game-settings.spec.ts:52-76` already asserts one line and
   `scrollWidth <= clientWidth` for the 速度 and 演出 buttons at 1280 px and 390 px. Note: the
   default Playwright config uses `reducedMotion: "reduce"`, where these buttons read 「速度: 省略」,
   so any repro needs `reducedMotion: "no-preference"`, as that spec sets.
2. **No phrase-aware wrapping exists anywhere.** There is no `word-break`, `line-break`,
   `text-wrap`, `<wbr>`, or `keep-all` in `src/`. The only wrapping control is
   `overflow-wrap: anywhere` on 12 long-text selectors. For CJK it adds nothing over the default
   break-anywhere behaviour, but it does let Latin runs split.
3. **The HUD truncates real data on every viewport.** Values are single-line ellipsis with a
   fixed row height (`styles.css:628-654`, phone rows `repeat(4, 24px)` at `:1895`). The full
   text is only in `title` (`GameHud.tsx:74-84`). Real-data maxima: ride name 25 chars,
   direction 16 chars (「羽田空港第1・第2ターミナル方面」), station 20 chars
   (「御徒町・上野広小路・仲御徒町・上野御徒町」). Estimated capacity: desktop about 13 ride
   chars and 15 direction or station chars; phone at 390 px about 9 chars for
   station and direction (half-width columns), about 20 for ride.
4. **Two existing tests hard-code the dice-button position and the `title` contract.** HUD
   values wrapping to two lines, or a bigger font, would move the dice button unless the row
   height is reserved for both states. See "Risks / Tests That May Break".
5. **Service names are atomic data strings, not composed.** The operator is not prepended in
   code: names like 「東京メトロ丸ノ内線 方南町支線 各停」 come verbatim from
   `manifest.uiPresentation.lineGroups[].name` or `services[].name`. A `<wbr>` between operator
   and line would therefore need string heuristics or a data-pipeline field. Real names already
   contain ASCII spaces, `(`, `–`, and `・`, which are break opportunities even under `keep-all`.
   「方面」 is a suffix inside `directionLabels` data (196 of 198 labels).
6. **The E2E matrix limits what a layout test can prove.** The phone project is Chromium only
   (Pixel 7, 412x839). Firefox runs at desktop size 1280x800, and WebKit only on GitHub Actions
   (desktop). `word-break: auto-phrase` therefore works in every phone run but on no real
   iPhone, and the `keep-all` fallback is exercised only at desktop width.

## Affected Files

### Components that render the affected text

| File:line | Text | Container / class |
|---|---|---|
| `src/features/game/components/GameHud.tsx:72-85` | HUD stats: 現在駅 / 乗車中 / 進行方向 / ターン数 / 踏破区間 / 出目. Each value is `<span class="hud-stat__value" data-stat=… title={full}>` | `.game-panel__stats dt/dd`, `.hud-stat__value` |
| `GameHud.tsx:76` | Ride = `LineBadge` (code only, `showName={false}`) + `serviceName()` | `.line-badge--sm` + `.hud-stat__value[data-stat=ride]` |
| `GameHud.tsx:87-105` | Action buttons 「サイコロを振る」 / 「この内容でサイコロを振る」 (draft) / 「移動中…」, 「スキップ」, 「おまかせ: ON/OFF」 | `.game-panel__roll(--draft)`, `.game-panel__skip`, `.game-panel__auto-roll` |
| `GameHud.tsx:66-71, 109-114` | Title (desktop only), subtitle (desktop only), save status 「セーブ: …」 | `.game-panel__title`, `.game-panel__subtitle`, `.game-panel__save` |
| `src/features/game/components/GamePanel.tsx:280-287` | Staged item summary 「選択中：路線指定券（{serviceName}。向きは抽選）」 / direction | `.item-staged-summary` (flex-wrap, `overflow-wrap:anywhere`) |
| `GamePanel.tsx:321, 326-347` | Log: 抽選 line, 地図なしで確認 (remaining sections, 「{service}・{direction}」, next stations), candidate list | `.game-panel__lottery`, `.game-panel__route-summary`, `.game-panel__candidates` |
| `src/features/game/components/GameMenu.tsx:102-136` | Menu options 追尾/速度/演出/新規/タイトル, shortcut hint | `.game-panel__options button`, `.game-panel__shortcut-hint` |
| `src/features/game/components/GameLegend.tsx:51-120` | Legend note, toggle 「路線の凡例（N路線）」, すべて表示, per-line labels (`line.name`) | `.game-panel__legend*` |
| `src/features/game/components/TurnLogDrawer.tsx:72-87` | 出目 full text, arrival, effect explanations | `.game-panel__turn-facts`, `.game-panel__log-value`, `.item-arrival` (no CSS rule), `.game-panel__effect-texts` |
| `src/features/game/components/ItemUseDialog.tsx:180-273` | Route-ticket dialog: title, hints, `<legend>{group.name}</legend>`, option name `{group.name} — {specific}（山手線）`, guidance `{direction}：{station}、{closer text}` joined by 「。 」; direction-ticket dialog; actions キャンセル / この路線に決める / この方向に決める | `.dialog`, `.item-dialog__hint`, `.item-dialog__group legend`, `.item-route-option__name/__guidance`, `.item-direction-option` |
| `src/features/game/components/RollAdjustment.tsx:57-88` | Dice-adjust dialog: 「出目を調整しますか？」, 「出目：N」, hints, choices 「−1：出目 N、Nマス進む」, buttons 「そのまま続ける」 / 「出目Nで続ける」 / スキップ | `.item-adjustment`, `.item-adjustment__choice`, `.item-adjustment .dialog__actions button` |
| `src/features/game/components/DiscardChoice.tsx:46-62` | Discard dialog with `ItemCard`s | `.item-discard`, `.item-card` |
| `src/features/game/components/ItemCard.tsx:302-332` | Card name, markers 選択中/新しく拾った, effect/timing/hint/note/reason, 使う / 閉じる | `.item-card*`, `.item-card-popover*` |
| `src/features/game/components/InventoryPanel.tsx:206-310` | 持ち物 label, slot short names (`ITEM_SHORT_NAMES`), 空き枠, tooltip | `.item-inventory__label`, `.item-slot__short`, `.item-slot__tooltip` |
| `src/features/game/components/EffectChips.tsx:275-283` | Chips 「遅延 あと2」 / 「運休」+badge+「あと3」 / 寄り道 / 寝過ごし. Full text in `title` and visually-hidden | `.effect-chip__label`, `.effect-chip__countdown` |
| `src/features/game/components/TurnMomentHost.tsx:301-306` | Arrival banner 「到着」 + station name | `.arrival-banner__kicker`, `.arrival-banner__station` |
| `src/features/game/components/DiceTumble.tsx:166-170` | Stamps 快速 / 調整+1 / ×2 / 遅延 / 寝過ごし | `.dice-tumble__stamp` |
| `src/features/game/components/LotteryReveal.tsx:144-153` | 「次の乗車」, `LineBadge size="lg"` with name, direction label | `.lottery-reveal__*`, `.lottery-reveal .line-badge__name` |
| `src/features/game/components/ToastHost.tsx:105-115` | Toast text (`toastQueue.ts:63-121`, e.g. 「{serviceName}が運休！」) | `.toast-host__toast`, `.toast-host__text` |
| `src/features/game/components/ItemEventNotice.tsx:26` | Item notices (`itemEventTexts`) | `.item-event-notice` |
| `src/features/game/components/ClearScreen.tsx:68-131` | Clear title, stats, history rows 「Nターン目 出目N：A → B（{service}・{direction}）」, share/paging/actions | `.clear-screen*` |
| `src/features/game/components/TitleScreen.tsx:47-50, 193-250` | Resume button 「つづきから（Nターン目・{station}）」, notices, credits, version `v0.13.0` | `.title-screen*` |
| `src/features/game/components/ConfirmDialog.tsx:46-66` | 新規 confirmation | `.dialog`, `.dialog__confirm` |
| `src/app/DataErrorBanner.tsx:13-15` | 「データの読み込みに失敗しました: …」 | `.data-error-banner` |
| `src/features/map/stationPopup.ts:1-12` | Map popup station + line names. Built with `textContent` only and unstyled; out of scope unless desired | MapLibre popup |

### Presentation / composition modules

- `src/features/game/presentation.ts` — `stationName`, `serviceName`, `directionLabel`,
  `landingTransitionText`, `lastRollText`, `landingText`, `itemEventTexts`,
  `activeItemEffectTexts`, `arrivalLogText`, `arrivalSummary`, `itemHistoryText`.
- `src/features/game/presentationResolver.ts:95-137` — `serviceName` (line group name, falling
  back to the service name), `stationName` (primary plus aliases joined by 「・」),
  `serviceStationName`, `candidateRows` (labels `{name}（抽選枠N）`).
- `src/features/game/hudPresentation.ts:148-238` — compact roll (`compactRollText`), effect
  chip labels.
- `src/features/game/itemPresentation.ts:4-60` — `ITEM_SHORT_NAMES`, `ITEM_DESCRIPTIONS`, hints.
- `src/features/game/lineBadge.ts` — `lineBadgeFor` gives the badge `name`, the same string as
  `serviceName`.
- `src/features/game/gameConfig.ts:61-66` — speed labels ゆっくり/ふつう/はやい/とても速い.
- `src/features/game/gameSettings.ts:17-21` — presentation labels すべて/重要なときだけ/なし.
- `src/features/game/toastQueue.ts:63-121` — toast strings.
- `index.html:2` — `<html lang="ja">`, which `word-break: auto-phrase` requires.

## Current CSS (wrapping / overflow / font sizes)

Base `body` font: `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`
(`styles.css:9`). Global `button` uses 14px with `min-height: 44px` (`:453-462`).

### Breakpoints

| Media query | Lines | Purpose |
|---|---|---|
| `(max-width: 600px)` | `:187-196` (toasts), `:1819-2004` (phone panel) | Phone bottom strip, panel `height: 45%`, `font-size: 13px` |
| `(max-width: 360px)` | `:1811-1815` | Dialog body padding 12px |
| `(min-width: 601px)` | `:2105-2114` | Desktop legend |
| `(min-width: 601px) and (max-height: 500px)` | `:161-180` (toasts 13px), `:2118-2373` | Short landscape: two-column panel, HUD rows 18px |
| `(prefers-reduced-motion: reduce)` | several | Motion only |

### HUD (`.game-panel`)

| Selector (line) | Declarations |
|---|---|
| `.game-panel` (`:571-589`) | `width: 310px; padding: 10px 12px; font-size: 14px; --hud-row-height: 24px; height: calc(100% - 120px); overflow-y: auto` |
| `.game-panel__title` (`:603-610`) | 16px, `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. Visually hidden on phone and short landscape |
| `.game-panel__subtitle` (`:729-738`) | 12px, height 18px, nowrap + ellipsis. **`display:none` on phone (`:1888`) and short landscape (`:2175`)**, so the issue's "phone subtitle 12px" point applies only to desktop |
| `.game-panel__stats` (`:621-626`) | grid `auto minmax(0,1fr)`, `gap: 2px 10px` |
| `.game-panel__stats dt` (`:628-633`) | height/line-height `var(--hud-row-height)`, `#555`, `white-space:nowrap`. Font inherits 14px (desktop) or 13px (phone) |
| `.game-panel__stats dd` (`:635-645`) | flex, **fixed `height: var(--hud-row-height)`**, bold, `min-width:0; overflow:hidden; white-space:nowrap` |
| `.hud-stat__value` (`:647-654`) | `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0` |
| Phone `.game-panel__stats` (`:1892-1915`) | 4 columns `auto minmax(0,1fr) auto minmax(0,1fr)`, **`grid-template-rows: repeat(4, 24px)`**, `gap: 0 6px`. Placement: row 1 station \| turn; row 2 ride spanning cols 2-4; row 3 direction (col 2 only, half width) \| roll; row 4 progress spanning. The turn cell gets `padding-right: 24px` for the save mark |
| Short-landscape stats (`:2179-2203`) | 3 rows of 18px, `--hud-row-height: 18px`, 2 label/value pairs per row |
| `.game-panel__actions` desktop (`:794-831`) | flex. roll `flex 2.3`, 16px, nowrap; draft: `white-space: normal; 13px`; skip `flex 1`, 12px, nowrap; auto-roll `flex 1.7`, 12px, nowrap |
| Phone actions (`:1917-1952`) | grid `1.5fr .85fr 1.35fr`, fixed 56px height; roll 14px, `overflow:hidden`; draft 12px, wraps |
| `.game-panel__save` (`:975-983`) | 12px, `#555`, `overflow-wrap:anywhere` |
| `.game-panel__options` (`:833-838`, `:958-966`) | grid `repeat(2, minmax(0,1fr))`; buttons 12px, **`white-space:nowrap` (new in v0.13.0)**. Short landscape: `repeat(5, auto)`, 11px (`:2285-2300`) |
| `.game-panel__shortcut-hint` (`:844-848`) | 11px |
| `.game-panel__legend` (`:1003-1011`) | 12px; phone 11px (`:1969-1972`) |
| `.game-panel__lottery` (`:740-745`) | 12px, `overflow-wrap:anywhere` |
| `.game-panel__route-summary`, `.game-panel__effect-texts`, `.game-panel__candidates` | 12px |
| `.game-panel__log-value` (`:925-928`) | `overflow-wrap:anywhere` |
| `.effect-chip__label`, `.effect-chip__countdown` (`:713-721`) | `white-space:nowrap`. Phone/short landscape: chips row `flex-wrap:nowrap; overflow-x:auto` (`:1957-1965`, `:2266-2274`) |
| `.item-slot__short` (`:1411-1419`) | 12px bold, nowrap + ellipsis |
| `.item-inventory__label` (`:1365-1370`) | 13px bold |
| `.item-staged-summary` (`:1336-1353`) | flex-wrap, `overflow-wrap:anywhere` |
| `.item-slot__tooltip` (`:1445-1464`) | 12px, `overflow-wrap:anywhere` |
| `.line-badge__name` (`:2418-2428`) | sm 12px / md inherit / lg 16px; no wrap rule |

### Dialogs, cards, banners

| Selector (line) | Declarations |
|---|---|
| `.dialog` (`:1284-1293`) | `width: min(380px, calc(100% - 32px))`. Body padding 16px (12px at ≤360px). Title 17px. `.dialog p` line-height 1.6 |
| `.dialog__actions` (`:1313-1321`) | flex end, `gap: 8px`; buttons `min-width: 112px`; no nowrap |
| `.item-adjustment .dialog__actions button` (`:1806-1809`) | `width: 100%` (both buttons shrink to share the row) |
| `.item-dialog` (`:1475-1479`) | scrollable, `overflow-x:hidden` |
| `.item-dialog__hint` (`:1481-1483`) | `overflow-wrap:anywhere` |
| `.item-route-option, .item-direction-option, .item-adjustment__choice` (`:1503-1516`) | flex, `overflow-wrap:anywhere` |
| `.item-route-option__name/__guidance` (`:1541-1556`) | block, `overflow-wrap:anywhere`; guidance 12px |
| `.item-dialog__group legend` (`:1498-1501`) | bold; no wrap rule (holds the line-group name) |
| `.item-discard` (`:1567-1569`) | `width: min(640px, calc(100% - 32px))`; list `repeat(auto-fit, minmax(min(100%,240px),1fr))` |
| `.item-card` (`:1594-1606`) | `overflow-wrap:anywhere`; name 15px; markers 12px |
| `.toast-host` / `__toast` (`:79-109`) | `width: min(420px, calc(100vw - 120px))`, 14px (13px short landscape), `overflow-wrap:anywhere` |
| `.arrival-banner__station` (`:432-440`) | **28px, nowrap + ellipsis**. Card `min-width: min(208px,100%)`. A 20-char station (≈560px) truncates on every viewport |
| `.arrival-banner__kicker` (`:425-430`) | 14px, `letter-spacing: .2em` |
| `.dice-tumble__stamp` (`:337-348`) | 16px bold, flex-wrap container |
| `.lottery-reveal .line-badge__name` (`:2500-2504`) | nowrap + ellipsis; reveal `width: min(26rem,100%)` |
| `.clear-screen` (`:1178-1248`) | 440px; history 13px; stats grid `auto 1fr`; actions grid `2fr 1fr`. Phone bottom sheet (`:1991-2003`) |
| `.title-screen__version` (`:1171-1176`) | **11px**, `#888` |
| `.title-screen__credits` (`:1129-1138`) | 12px / h2 13px |
| `.data-error-banner` (`:527-540`) | 13px |
| `.item-event-notice` (`:2384-2390`) | `overflow-wrap:anywhere` |

### Approximate HUD value capacity (computed from CSS; to verify by measurement)

| Viewport | Station / direction column | Ride (after sm badge ≈34px) |
|---|---|---|
| Desktop 1280 (panel 286px content, 14px bold) | ≈220px → ~15 CJK chars | ≈186px → ~13 chars |
| Phone 412 (Pixel 7, 376px content, 13px bold) | ≈127px → ~9 chars | ≈284px → ~21 chars |
| Phone 390 | ≈116px → ~8-9 chars | ≈262px → ~20 chars |
| Phone 320 | ≈81px → ~6 chars | ≈192px → ~14 chars |

## Text Composition Points

Where `<wbr>`, phrase splitting, or a wrapping helper would go:

| Composition | Location | Notes |
|---|---|---|
| Service / line-group display name | `presentationResolver.ts:95-97` (`serviceName`), wrapped by `presentation.ts:20-26` | Returns a plain `string` used in ~20 places, including template literals for live-region announcements, `aria-label`s, share text, and `title`. **A `<wbr>` cannot be returned from here**: it must be a render-time React helper (e.g. a `<PhraseText text=…/>` that splits on spaces, 「・」, `(`, `–`, and before 「方面」), applied only at visual call sites. Do not use `innerHTML`: `stationPopup.ts` deliberately uses `textContent` only. |
| Operator prefix | Not composed. Operator lives in `services[].operator` / `uiPresentation.operators`; names already embed it (「東京メトロ丸ノ内線 …」, 「横浜市営地下鉄グリーンライン 各停」, 「東武…」) | An operator/line `<wbr>` needs either a known-prefix list or a new data field (pipeline change in `scripts/`, which also needs guard updates in `src/data/guards.ts`). |
| Direction label | `presentation.ts:28-31` reads `services[].directionLabels.forward/backward` from data | 「…方面」 is part of the data string (196/198). A render helper can insert `<wbr>` before a trailing 「方面」, and at the 「・」 in 「元町・中華街方面」. |
| Station name | `presentationResolver.ts:66-89, 125-129` joins primary + aliases with 「・」 | 「・」 is the natural break; `serviceStationName` likewise. |
| Route-ticket option name | `ItemUseDialog.tsx:196-198, 215` `{group.name} — {specific}（山手線）` | Longest real string: 43 chars (below). The 「 — 」 has spaces, which give a break opportunity. |
| Route-ticket guidance | `ItemUseDialog.tsx:199-202` joins `{direction}：{station}、{closer}` with 「。 」 | Long sentence; a candidate for `auto-phrase` / `keep-all`. |
| Closer text | `ItemUseDialog.tsx:126-140`, `itemPresentation.ts` `directionGuidance` | Sentence. |
| Adjust choices / buttons | `RollAdjustment.tsx:67, 76, 83` | Short. Keep buttons nowrap. |
| Draft dice label | `GameHud.tsx:94` 「この内容でサイコロを振る」 | Wraps by design (`--draft`, `white-space: normal`). Natural break: 「この内容で｜サイコロを振る」. |
| Compact roll | `hudPresentation.ts:148-185` 「Nマス 調整+1」, 「回送（サイコロなし）」 | Space-separated. |
| Landing / log / history | `presentation.ts:34-115, 259-271`; `ClearScreen.tsx:93-99` | Long sentences with 「／」, 「・」, and 「（…）」. |
| Toasts | `toastQueue.ts:63-77` | `{serviceName}が運休！`, etc. |
| Effect texts | `presentation.ts:146-157` | `運休：{serviceName}、あとNターン`. |
| Resume button | `TitleScreen.tsx:47-50` | `つづきから（Nターン目・{station}）`. |

## Longest Strings (real data `public/data/`, 135 services, 134 line groups)

Lengths are JavaScript string lengths (UTF-16 units; all BMP).

Displayed service names (`serviceName()`, i.e. the line-group name):

| Len | String |
|---|---|
| 25 | 武蔵野線直通 西船橋–市川塩浜 (京葉線高谷支線) |
| 24 | 湘南新宿ライン (宇都宮線・横須賀線系統 普通) |
| 24 | 武蔵野線直通 西船橋–南船橋 (京葉線二俣支線) |
| 23 | 湘南新宿ライン 快速 (高崎線・東海道線系統) |
| 20 | 中央本線 辰野支線 (岡谷–辰野–塩尻) |
| 19 | 東武スカイツリーライン・伊勢崎線 普通 |
| 19 | 京成成田空港線 アクセス特急・実質各停 |
| 18 | 東京メトロ丸ノ内線 方南町支線 各停 |
| 17 | 横浜市営地下鉄グリーンライン 各停 |

The raw `services[].name` is longer in 8 services. It is used by the route dialog's
`specific` and by `hud-layout.spec.ts`'s `longestRideGame`. The longest is 25 chars:
「常磐線快速・常磐線 (上野東京ライン) 品川–浪江」.

Route-ticket option names (`ItemUseDialog.tsx:215`):

| Len | String |
|---|---|
| 43 | 常磐線快速 (上野東京ライン) — 常磐線快速・常磐線 (上野東京ライン) 品川–浪江 |
| 37 | 宇都宮線 (上野東京ライン) — 宇都宮線 (上野東京ライン) 東京–黒磯 |
| 28 | 鹿島線 (香取–十二橋) — 鹿島線 (香取–鹿島神宮) |

Direction labels (198 unique, 196 end in 「方面」):

| Len | String |
|---|---|
| 16 | 羽田空港第1・第2ターミナル方面 |
| 9 | 府中競馬正門前方面 |
| 8 | 多摩動物公園方面, 東武動物公園方面, 印旛日本医大方面, 元町・中華街方面, 葛西臨海公園方面 |

Station display names (primary + aliases joined by 「・」):

| Len | String |
|---|---|
| 20 | 御徒町・上野広小路・仲御徒町・上野御徒町 |
| 18 | 京王多摩センター・小田急多摩センター |
| 14 | 羽田空港第1・第2ターミナル |
| 13 | 淡路町・新御茶ノ水・小川町 / 馬喰町・東日本橋・馬喰横山 |
| 12 | 南町田グランベリーパーク |

Other notable strings: operators (max 8, 首都圏新都市鉄道, not displayed in HUD); presentation
label 「演出: 重要なときだけ」 (wide grid cell); speed 「速度: とても速い」; item card hint
「おすすめしない：山手線の駅にいるため、同じ駅にとどまり1ターン使います」.

E2E fixture datasets have **short** names. `fixture` has 3 services (max 「テスト西線」, direction
「東中野方面」); `capital-region` has 8 (max 「幹線B 各駅停車」). A longest-name layout test must
therefore use `dataset: "real"`, or a purpose-built fixture served through the
`railwayBundle` route (`tests/e2e/fixtures.ts:36-50`).

## E2E & Test Conventions

### Playwright (`playwright.config.ts`)

- Projects:
  - `desktop-chromium` (1280x800).
  - `phone-chromium` (`devices["Pixel 7"]`, 412x839, touch, DPR 2.625).
  - `desktop-firefox` (1280x800; needs xvfb for WebGL2).
  - `desktop-webkit` (1280x800, only when `GITHUB_ACTIONS` or `E2E_WEBKIT` is set).
  - **There is no phone WebKit or Firefox project.**
- `locale: "ja-JP"`, `reducedMotion: "reduce"` by default, workers 2, `timeout: 30_000`, and a
  build via `vite build --mode e2e`. Local runs should be targeted (memory: full 4-browser runs
  are CI-only).
- Fixture options (`tests/e2e/fixtures.ts`): `dataset` (`"fixture" | "capital-region" | "old-edition" | "real"`,
  default `"real"`) and `gameSeed`. `mapStub` blocks external requests and asserts none leaked.
- Save injection pattern: `writeSaveText(page, serializeGame(state))`, reload, then click
  「つづきから」 (`hud-layout.spec.ts:31-37`, `items.spec.ts:16-28`). Item scenarios:
  `tests/e2e/fixtures/itemScenarios.ts` (`route`, `direction`, `adjust`, `discard`, … seeds for
  the **fixture** dataset). `ui-pop.spec.ts:56` `buildPopulatedState` scans real-data seeds.
- Opening dialogs:
  - Item route/direction dialogs: `useInventoryItem(page, "路線指定券" | "方向指定券")`
    (`support/app.ts:146-151`), which clicks the slot and then 「使う」. Then
    `page.getByRole("dialog")` (`items.spec.ts:363-374`).
  - Dice-adjust: restore the `adjust` scenario, `diceButton(page).click()`, then
    `page.getByRole("dialog", { name: "出目を調整しますか？" })` (`items.spec.ts:413-424`,
    `support/app.ts:237-252`).
  - Discard: `getByRole("dialog", { name: "捨てるアイテムを選ぶ" })`.
  - Menu: `openGameMenu` (`support/app.ts:120-126`). Log: `openGameLog`.
  - HUD values: `panelStat(page, label)` locates `[data-stat=…]` (`support/app.ts:97-101`).
- **Existing one-line helpers to reuse** (identical inline copies, no shared helper yet):
  - `hud-layout.spec.ts:182-190`, `auto-roll.spec.ts:111-121`, `game-settings.spec.ts:69-75`.
    Each uses `range.selectNodeContents(button)`, counts distinct rounded `top`s of
    `range.getClientRects()` as lines, and checks `scrollWidth <= clientWidth`. This is the
    natural basis for a shared `expectSingleLine(locator)` in `tests/e2e/support/`.
  - Overflow checks: `items.spec.ts:417-421` (`documentElement.scrollWidth <= innerWidth`,
    dialog `scrollWidth <= clientWidth` at 320/390).
  - Viewport sweeps via `page.setViewportSize` (320/390/412/640x400/667x375/1280).
  - Screenshots go to `.claude/logs/screenshots/…` (`game-settings.spec.ts:77`).
- A "no mid-word break" assertion has no existing helper. One option: for each text node,
  build Ranges per character and find the line-break offsets, then check that each break
  falls at an allowed boundary (space, 「・」, 「、」, 「。」, before `(`/「（」, before 「方面」).
  That is font- and engine-dependent, so the expected breakpoints must stay coarse.

### Browser-support caveats for the proposed CSS

- `word-break: auto-phrase` is **Chromium only** (Chrome/Edge 119+). It requires a `lang="ja"`
  ancestor (present: `index.html:2`). Firefox has no support, and Safari/iOS has no stable
  support. In the E2E matrix it is active in `desktop-chromium` and `phone-chromium`, and falls
  back in `desktop-firefox` and `desktop-webkit`. Real iPhones always get the fallback, and the
  suite never tests that at phone width.
- Fallback pattern: declare `word-break: keep-all` then `word-break: auto-phrase` (Firefox and
  WebKit drop the unknown value and keep `keep-all`), or use
  `@supports (word-break: auto-phrase)`. Combine with `overflow-wrap: anywhere`, so an unbroken
  CJK run under `keep-all` can still break instead of overflowing. Under `keep-all`, breaks
  remain at spaces, 「、」「。」, full-width 「（」, and en-dashes. Real names have these, but long
  space-free runs such as 「羽田空港第1・第2ターミナル方面」 (「・」 only) or
  「横浜市営地下鉄グリーンライン」 rely on `overflow-wrap: anywhere` and may still split
  arbitrarily in the fallback.
- `text-wrap: balance` is supported in Chromium 114+, Firefox 121+, and Safari 17.5+. It is
  safe across the matrix, but Chromium balances only blocks of ≤6 lines (Firefox ≤10), so it
  suits headings and toasts, not dialog bodies. `text-wrap: pretty` is not uniformly supported.
- `<wbr>` works in every browser and does not affect `textContent`.
- Rendering depends on fonts. CI (Ubuntu runner) and local WSL resolve `system-ui` / Noto
  differently, so pixel-capacity assertions (e.g. "fits 13 chars") will be flaky. Assert
  relative properties (one line, no overflow, break positions) instead.

### Unit tests (Vitest)

- `vite.config.ts:57-58`: `tests/unit/**/*.test.ts`, default environment `node`. DOM tests opt
  in per file with `// @vitest-environment jsdom`.
- React is rendered without Testing Library: `createElement` + `mountReact` / `flushReact` /
  `dispatchReactEvent` from `tests/unit/helpers/reactDom.ts`. Assertions use `querySelector`,
  `textContent`, and `getAttribute`.
- jsdom has no layout, so wrapping can only be checked in E2E. Unit tests can check helper
  output (e.g. a phrase-split function returning segments) and markup (`<wbr>` count, classes).
- CSS-contract tests read `src/styles.css` with regexes:
  - `game-hud.test.ts:539-549`: `.game-panel__menu[hidden]`, 44px targets.
  - `turn-moment-components.test.ts:280-300`: `rule()` expects `\nSELECTOR {` single-block
    rules, layer variables.
  - `turn-moment-components.test.ts:1030-1031, 1242-1262`: dice blocks.
  - `item-card.test.ts:238-245, 581-595`: **no `transition`/`animation` in any `.item-card*` /
    `.item-card-popover*` rule**; `.item-card-popover {` must not set `display`.
  - `item-controls.test.ts:370-382`: no transition/animation in `.item-slot*`/`.item-inventory*`
    rules; the tile rule keeps `height: 56px; box-sizing: border-box`.
  - `ui-contrast.test.ts`: colour pairs, including `#555555` on cream. Changing label colours
    or font sizes may interact with contrast tests if colours change.

## Risks / Tests That May Break

| Change | Test(s) at risk | Why |
|---|---|---|
| Removing or altering `title` on HUD values | `tests/unit/game-hud.test.ts:158-161` (every `.hud-stat__value` has `title`; ride and roll titles equal the text); `tests/e2e/hud-layout.spec.ts:91` (compact-roll `title` = `innerText`), `:154` (ride `title` = text); `tests/e2e/ui-pop.spec.ts:~503` (`rideTitle === rideText`) | `title` is part of the tested contract. Inserting `<wbr>` keeps `textContent` equal (so these still pass), but `innerText` must also stay equal. Keep `title` as plain text. |
| HUD values wrapping to 2 lines on phone, or larger phone font (15-16px) | `hud-layout.spec.ts:82-163` (dice `offset`/`viewportY` must stay within 1px across turn 0, after roll, failed save, saved, effect chips, long ride); `ui-pop.spec.ts:~446-505` (phone 320/390/400/412: panel ≤45% of viewport height, panel share <0.5, no horizontal overflow, `rideFits` `scrollWidth<=clientWidth`, dice offset equals idle offset within 1px, buttons ≥44px); `capital-region.spec.ts:183` (phone panel ≤45%) | Phone rows are a fixed `repeat(4, 24px)`; the dice button sits right below. Content-dependent wrapping moves the dice button. A fix must reserve constant height (e.g. always 2-line rows for ride/direction, or tap-to-expand as an overlay) and fit the 45% panel at 320x568 (≈255px). |
| Bigger desktop HUD text or 2-line values | `ui-pop.spec.ts:418-440` (desktop populated HUD: `scrollHeight <= clientHeight + 1`) | The desktop panel must still not scroll. |
| Short-landscape HUD (18px rows) | `accessibility.spec.ts:601-630` (667x375, 640x400: panel ≤75vh, lottery/options inside the panel) | Fixed 18px rows with 14px text; no room to wrap. |
| Menu option nowrap / sizing | `game-settings.spec.ts:52-76` (one line and fits at 1280/390) | Already passing in v0.13.0; keep it. |
| Action button labels | `hud-layout.spec.ts:165-206`, `auto-roll.spec.ts:~105-125` (one line and fits at 320/390/640x400/667x375; dice position stable when toggling) | Changing font or `min-width` on actions could break single-line or position. |
| Dialog width changes | `items.spec.ts:413-424` (adjust dialog no horizontal overflow at 320/390); `accessibility.spec.ts` dialog focus tests | Adding `nowrap` + `min-width` to dialog buttons can cause horizontal overflow at 320px (inner width ≈264px; two buttons ≥112px + gap). |
| Arrival banner wrapping instead of ellipsis | `ui-pop-turn-moments.spec.ts:943-990` (card within map/viewport, not overlapping panel/controls, width ≥112 at 1280/412/320/667x375/640x400); `turn-moment-components.test.ts` CSS contract | A taller banner changes placement fit. |
| Toast wrapping/balance | `layout.spec.ts:48-90` (toast top/safe-area), `ui-pop-turn-moments.spec.ts:~990` (toasts in viewport) | Taller toasts may overlap controls on phones. |
| Any new `.item-card*` / `.item-slot*` CSS | `item-card.test.ts`, `item-controls.test.ts` regex contracts | No `transition`/`animation`, and keep the tile height rule intact. |
| Moving phrase splitting into `serviceName()` / `directionLabel()` strings | Many unit tests compare exact strings (`presentation`, `toast`, `turn-moment-presentation`, `result-share`, announcements) | Keep data-layer strings unchanged; split only at render. |
| A layout E2E relying on `auto-phrase` | All four projects | Chromium passes through auto-phrase while Firefox/WebKit take the fallback; the same assertion may hold in one engine and fail in another. Phone width is never tested in a non-Chromium engine. |

Additional notes:

- `hud-layout.spec.ts:39-62` `longestRideGame` is not the real longest: it stops at the first
  ride name ≥5 chars within 64 seeds and uses raw `service.name`. A new layout test needs
  deterministic state with a known longest name. Options: (a) a seed search for a specific
  service id (e.g. `jr-musashino-takaya` or `jr-shonan-shinjuku-local`) in real data; (b) a
  synthetic save whose `currentServiceId` is set directly, if `serializeGame` validation
  allows it; (c) a fixture bundle with long names.
- The issue's "phone subtitle 12px" point does not apply: the subtitle is hidden on phones.
  Phone-visible small text: HUD labels/values 13px (inherited), save status 12px, legend 11px,
  shortcut hint 11px, item short names 12px, chip text 14px (button default is not applied;
  chips inherit 13px on phone). The 11px version string is on the title screen only.
- Speed/presentation labels were the only reported short-label wrap; inside the panel, the
  other short labels (actions, chips, slot short names) are already `nowrap`. Short labels
  still without nowrap: `.dialog__actions button`, `.clear-screen__actions`/`__share`/`__paging`
  buttons, `.item-card__action`, `.game-panel__legend-toggle`/`-reset`, the
  `.item-staged-summary` button, and `.map-error button`.
