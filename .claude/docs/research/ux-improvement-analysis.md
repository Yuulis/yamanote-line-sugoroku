# UX Improvement Analysis (v0.12.0, Tokyo-suburban edition)

Date: 2026-11-08. Author: general-purpose-opus (read-only analysis; no source changes).
Scope: first-time readability, mid-game drop-off, "how to play" clarity, mobile,
accessibility, end-game. Excludes everything already filed in #60-#63; items that
build on one are labelled "extends #N".

## Method and evidence base

- Source read: `src/features/game/components/*`, `src/app/GameApp.tsx`,
  `src/features/game/{gameConfig,toastQueue,presentation,hudPresentation,shareText}.ts`,
  `src/features/game/animation/{turnMoments,timeline}.ts`, `src/features/analytics/analytics.ts`,
  `src/features/editions/registry.ts`, `index.html`, `public/site.webmanifest`,
  `docs/manual/tokyo-suburban/rules.md`, `.claude/docs/DESIGN.md` (TODO section).
- App run locally: `vite` dev server on `localhost:5199`, driven by a Playwright
  (Chromium, SwiftShader WebGL) script at 1280x800 and 390x844 (touch, DPR 2), with the
  real OpenFreeMap basemap (internet available). Played ~16 random-seed turns per width at
  normal motion, then resumed the E2E fixture `tests/e2e/fixtures/tokyo-suburban-before-clear-save.json`
  and played to the clear screen.
- Screenshots: `.claude/logs/screenshots/ux-analysis/` (file names cited per finding).
- Measured:
  - Title ready ~1.1 s, panel ready 0.3-0.6 s after "はじめから" (local dev server, so not representative of mobile networks).
  - Turn duration at default speed "ふつう", click to dice re-enabled: 4.3-8.3 s, typically ~5.5 s
    (14 consecutive turns on desktop: 6975, 6649, 4843, 4437, 4294, 5734, 5775, 8298, 6903, 6451, 5506, 4948, 6408, 5216 ms).
    This was measured under software WebGL, so a real device may be somewhat faster.
  - HUD font sizes: 14 px desktop / 13 px phone; subtitle and save status 12 px; version 11 px.
  - Tap targets on phone: all game controls are at least 44 px tall (good). Desktop map zoom buttons are 29x44 px.
- Game-length note: the brief's 52 / 114 / 189 turns come from the 23-ward edition
  (`.claude/docs/DESIGN.md:267-270`). The Tokyo-suburban D2 decision records median 55,
  p90 146 and p99 261 (`DESIGN.md:209`, measured before items existed). The E2E clear fixture is a
  96-turn game. Drop-off risk is therefore at least as high as the brief assumes.
- Approximate animation-only time per game at ~5.5 s/turn: median ~5 min, p90 ~11-13 min,
  p99 ~17-24 min. The player also clicks "サイコロを振る" once per turn, so a p90 game needs
  roughly 115-146 clicks.

Already known and recorded in `DESIGN.md` TODO (so not proposed again here): the lottery board
covers most of the phone map, the pickup icon is small and faint, the arrival card overlaps station
labels on desktop, the segment-flash colour washes out green lines, and `game_clear` is not sent
when the player leaves during the goal banner.

---

## Findings

### UX-01 No guided first turn or first-occurrence explanations
- Category: onboarding
- Current behaviour: the only explanation is the rules text on the title screen
  (`TitleScreen.tsx:213-219`, `registry.ts:27-31`). Once the game starts, nothing tells the player
  what each HUD row means, why the line changed, or what an item does. The first lottery, the first
  ride off the Yamanote line, and the first bad item all happen without context. For example, the
  turn-1 toast only says 「遅延を拾ってしまった！」 (`toastQueue.ts:73`; `desktop-30-fast-03.png`).
- Why it hurts: #60 makes the rules shorter and moves them, but a static rules page is still read
  before the player has context. A first-time player ends turn 1 on 大江戸線 heading 都庁前方面
  (`desktop-10-turn1-t02800.png`) without knowing that this is normal and that the lottery favours
  returning to the Yamanote line.
- Proposed fix: (a) a three-step coach mark on the first game: dice button → "踏破区間" bar →
  map loop, each with one sentence. (b) First-occurrence tips that appear once each and are stored
  in `localStorage`: first lottery, first time off the Yamanote line ("他の路線は山手線に近づく向きが
  出やすい"), first item, first bad item, first arrival at a terminus with unused pips.
  Each tip has a "もう表示しない" control. Reuse the OGP tagline 「サイコロと抽選まかせで、山手線を
  一周して新橋へ。」 (`index.html`) as the one-line hook.
- Effort: M. Priority: **P0**. #60 fixes the reading cost of the rules; this fixes understanding at the
  moment it matters, and it is the main lever for the first two minutes.

### UX-02 The last turn's outcome is not visible once the animations end
- Category: feedback
- Current behaviour: after the moments finish, the panel shows only the stat values. The sentence
  that explains the turn (「15ターン目：半蔵門に到着。踏破 5/30」 plus 「抽選: … / 方向抽選 → 渋谷方面」)
  lives inside the ログ drawer, which is collapsed by default (`TurnLogDrawer.tsx:186-221`,
  `GamePanel.tsx:293-326`; compare `desktop-13-after-15-turns.png` with `desktop-15-log.png`).
  On desktop, ~280 px of the panel below the drawers is empty.
- Why it hurts: if the player looks away during the ~5 s of moments, or skips them, they cannot see
  why they are on a different line. Missing causality makes the game feel random and pointless,
  which is a classic cause of drop-off.
- Proposed fix: add an always-visible one- or two-line "前のターン" card under the dice button, for
  example 「出目3 → 半蔵門（+0区間）｜抽選：半蔵門線・渋谷方面」, with small chips for "+N区間",
  "乗換", and the item picked up. Keep the drawer for detail.
- Effort: S. Priority: **P0**. Low cost, and it addresses the feeling that "nothing makes sense".

### UX-03 Long games have no fast-forward or auto-roll mode
- Category: drop-off
- Current behaviour: there are three speeds, 600 / 450 / 300 ms per hop (`gameConfig.ts:61-65`), and
  every other moment scales with the same factor (`turnMoments.ts:83-97`). A lottery alone costs
  1.6 s + 0.4 s on almost every landing off the Yamanote line, the arrival card 0.8 s, and the dice
  0.6 s. A measured turn takes ~5.5 s, and every turn needs a click. "はやい" is only 1.5x faster than
  normal. "スキップ" exists but has to be pressed every turn.
- Why it hurts: p90 is 114-146 turns. The most repetitive part of the game (landing on a
  non-Yamanote line, lottery, move further away) is also the slowest. Long, click-heavy stretches
  with no decision to make are the most likely place for players to quit.
- Proposed fix: (a) add a fourth speed, "とても速い" (~120 ms per hop, lottery ≤ 400 ms, no arrival
  card). (b) Add an "おまかせで進む" toggle that rolls automatically until something needs a
  decision (usable item available, discard, adjust, near the goal) or until the player stops it.
  Pause it when the tab is hidden. (c) Optionally skip moments automatically on turns that changed
  nothing important (no new segment, no item). (d) The cheapest first step: a persistent
  「演出: すべて／重要なときだけ／なし」 setting. No rule change is involved, so this is compatible with
  the R6 / D2 decisions not to add length levers.
- Effort: M. Priority: **P0**. This is the biggest lever on the length-driven drop-off the brief describes.

### UX-04 Speed and follow settings reset on every visit and every new game
- Category: drop-off
- Current behaviour: `GameApp.tsx:101-102` keeps `speedId` and `follow` in `useState` with
  defaults; nothing is written to storage (grep: the only `localStorage` users are the save and the
  analytics opt-out).
- Why it hurts: a returning player who chose "はやい" is back at "ふつう" after every reload. Resuming
  is the main pattern in long games, so the player pays this cost every time.
- Proposed fix: persist the speed and follow choices (and the UX-03 auto-roll toggle) in a small
  `localStorage` preferences key, separate from the save format so `SAVE_VERSION` is untouched.
- Effort: S. Priority: P1. A quick win that UX-03 depends on.

### UX-05 No "getting closer" feedback while away from the Yamanote line
- Category: feedback / drop-off
- Current behaviour: the HUD shows only 「踏破区間 n/30」 with a 30-cell bar (`GameHud.tsx:79-80`).
  When the player is carried out to 横浜 or 大宮 (the clear fixture went 蒲田 → 横浜 on turn 5),
  nothing says how far away the Yamanote line is, or whether the current direction heads back. The
  engine already computes this (`engine/proximity.ts:38` `nearestTargetStation`, `:72`
  `targetHopDistances`), but it is shown only inside the route and direction ticket dialogs
  (`rules.md`, item section). There are no milestone moments at 10, 20, or 25 of 30.
- Why it hurts: long detours feel like regression with no end in sight, which is the main emotional
  driver of mid-game quitting. #62 covers map styling and what to do after 30 segments; this finding
  is about HUD feedback during the game.
- Proposed fix: (a) add a HUD row 「山手線まで あとN駅（近づく／遠ざかる）」, shown only off the
  Yamanote line. (b) Add milestone toasts and a progress-bar pulse at 10, 20, 25, and 29 of 30
  (「あと1区間！」). (c) Optionally show the next untraveled segment's name under the bar.
- Effort: M. Priority: **P0**.

### UX-06 Auto-save is not explained, and the resume button hides progress
- Category: drop-off
- Current behaviour: after a successful save, the only cue is a small ✓ icon with a hover-only
  `title` (`GameHud.tsx:65-67`). Nothing tells a first-time player that they can close the tab and
  continue later. The resume button reads 「つづきから（95ターン目・有楽町・日比谷）」
  (`TitleScreen.tsx:47-50`; `desktop-32-title-with-save.png`). It shows no progress, even though
  that save is at 30/30, one step from clearing.
- Why it hurts: in a 15-25 minute game, "I can stop now and keep my progress" turns an abandoned
  game into a paused one. Showing progress on the resume button is a strong reason to come back.
- Proposed fix: (a) show a one-time toast on the first saved turn: 「自動で保存しています。いつでも
  閉じて、続きから遊べます」. (b) Change the resume label to 「つづきから　踏破 30/30・95ターン・
  有楽町・日比谷」, optionally with the last-played date. (c) Make the ✓ tappable so it explains itself on touch.
- Effort: S. Priority: P1.

### UX-07 Rules cannot be opened during a game (extends #60)
- Category: onboarding
- Current behaviour: the in-game menu contains only 追尾 / 速度 / 新規 / タイトル and the legend
  (`GameMenu.tsx:320-343`; `desktop-16-menu.png`). The only way to re-read the rules is to go back to
  the title screen.
- Why it hurts: questions such as "why did I stop at the terminus?" or "how does 3:2 work?" come up
  mid-game, and leaving to the title feels risky to players.
- Proposed fix: once #60's rules screen exists, open it from a 「遊び方」 menu entry as a modal over
  the game, deep-linking to the relevant section (lottery, items, goal).
- Effort: S (after #60). Priority: P1.

### UX-08 The clear screen gives little reward and no reason to replay
- Category: end-game
- Current behaviour: the clear screen shows a plain 「クリア！」 heading, three numbers, and a text
  history paged 20 entries at a time (`ClearScreen.tsx:68-131`; `desktop-34-clear.png`). Nothing
  stores past results, so there is no personal best or play count. The map behind the card is inert
  and is not fitted to the route. On a phone, the share and 「もう一度遊ぶ」 buttons are below the fold
  inside the card (`phone-34-clear.png`).
- Why it hurts: after a 15-minute game the payoff is a spreadsheet. With nothing to beat, there is
  little reason to play again or to share.
- Proposed fix: (a) store the last N results in `localStorage`, and show 「自己ベスト更新！」 or
  「ベスト 48ターン」 plus a play count. (b) Show a percentile against the simulated distribution
  (「この結果は上位 30%」). (c) Add highlight facts: longest single ride, most-used line, farthest
  station reached, items used and bad items avoided. (d) Fit the map to the full route and draw it.
  (e) On phones, put the stats, share, and replay buttons first, and collapse 移動履歴 into a `<details>`.
- Effort: M. Priority: P1.

### UX-09 The map shows all 134 lines at full strength, which buries the board
- Category: readability
- Current behaviour: at the start, every line group is drawn at full saturation together with the
  basemap labels. The Yamanote loop (the actual board) is only a light green dashed overlay
  (`desktop-03-game-start.png`, `phone-03-game-start.png`).
- Why it hurts: a first-time player cannot tell which lines matter. #62 covers the styling of
  untraveled Yamanote segments; this finding is about the noise from everything else.
- Proposed fix: a default "focus" style. Draw non-current, non-Yamanote lines at 25-40 % opacity and
  thinner, highlight only the lottery candidates while a lottery runs, and mute basemap labels. Keep
  the existing per-line visibility settings for enthusiasts.
- Effort: M. Priority: P1.

### UX-10 「スキップ」 is ambiguous, especially in the roll-adjust dialog
- Category: readability
- Current behaviour: the HUD button reads 「スキップ」 (`GameHud.tsx:94`) and is greyed out most of
  the time. The roll-adjust dialog puts 「スキップ」 next to 「そのまま続ける」 (`RollAdjustment.tsx`;
  `desktop-21-dialog-t1.png`, `phone-21-dialog-t8.png`), where it reads like "skip the adjustment" or
  "skip the turn".
- Proposed fix: rename it to 「演出をスキップ」 or use a ⏩ icon with that `aria-label`. Hide it
  while no animation is running instead of showing it disabled, and remove it from the adjust dialog,
  where tapping the moment already skips.
- Effort: S. Priority: P1.

### UX-11 The Escape-key hint is shown on touch devices
- Category: mobile
- Current behaviour: the adjust dialog says 「Escapeキーでも「そのまま」で続けます。」 on phones
  (`RollAdjustment.tsx:80`; `phone-21-dialog-t8.png`).
- Proposed fix: show it only under `(pointer: fine)`, or rephrase it as a hint shown only to keyboard users.
- Effort: S. Priority: P2.

### UX-12 The phone bottom sheet takes about 45 % of the screen and has dead space
- Category: mobile
- Current behaviour: at 390x844 the panel starts at y≈456 (`phone-03-game-start.png`). It contains
  an empty 持ち物 row about 56 px tall from turn 0, and about 80 px of blank space below ログ / メニュー.
  The visible map, which is where the action is, is less than the top half of the screen.
- Proposed fix: collapse the empty inventory into one line (「持ち物 0/3」) until the first pickup,
  remove the trailing space, and consider a two-state sheet (peek / expanded) with a drag handle.
- Effort: M. Priority: P1.

### UX-13 The desktop panel stretches to the bottom with ~280 px blank
- Category: readability
- Current behaviour: the panel runs from y=92 to about 770 while its content ends at about 490
  (`desktop-03-game-start.png`).
- Proposed fix: size the panel to its content, or use the space for UX-02 and UX-05. Fold this into those findings.
- Effort: S. Priority: P2.

### UX-14 Phone HUD text is small
- Category: accessibility / mobile
- Current behaviour: the HUD labels and values are 13 px on phones, the subtitle and save status
  12 px, and the version 11 px (measured with `getComputedStyle`).
- Proposed fix: on phones, make the values 15-16 px and the labels 13 px. The key values
  (現在駅 / 乗車中 / 踏破) are what a player glances at during a long game.
- Effort: S. Priority: P2.

### UX-15 The log shows only the current turn; the history appears only after clearing
- Category: feedback
- Current behaviour: the ログ drawer renders only 「このターン」 (`TurnLogDrawer.tsx:205-221`;
  `desktop-15-log.png`). The turn-by-turn history (`movementHistory`) is shown only on the clear screen.
- Proposed fix: add the last 10 turns to the log in reverse order, using the same row format as the
  clear screen, with "もっと見る".
- Effort: S-M. Priority: P2.

### UX-16 Bad items and effect chips don't say what they do (extends #61)
- Category: feedback
- Current behaviour: the bad-item toast says only 「{名前}を拾ってしまった！」 (`toastQueue.ts:73`).
  The effect chip reads 「遅延 あと3」 (`hudPresentation.ts:103`), and its full text is only in a
  hover `title` (`EffectChips.tsx:14`), which touch users never see. The full text is in the log
  under 効果の説明.
- Proposed fix: add a second line to the toast with the consequence (「3ターン後の出目が1になります」,
  reusing `presentation.ts:138`). Make the chips tappable so they open the same explanation; this
  fits #61's tap-tooltip work.
- Effort: S. Priority: P1.

### UX-17 Analytics cannot show where players quit
- Category: other (measurement)
- Current behaviour: the only events are `game_start`, `game_clear`, and `result_share`
  (`analytics.ts:7, 28-32`). There is no turn or progress milestone, so the drop-off this analysis is
  about cannot be measured, and the effect of any fix cannot be checked.
- Proposed fix: add whitelisted, privacy-safe milestone events, for example `game_progress {turn_bucket:
  10|25|50|100|150, segments_bucket}` and `game_resume {segments_bucket}`, plus a setting snapshot
  (speed, auto-roll). Update `public/privacy.html` to match.
- Effort: S. Priority: P1. Recommend shipping it before or with UX-03 and UX-05 so their impact can be measured.

### UX-18 There is no keyboard shortcut to roll or skip
- Category: accessibility
- Current behaviour: rolling with the keyboard depends on focus returning to the dice button
  (`GamePanel.tsx:228-243`). There is no global key, and no visible hint that Enter or Space works.
- Proposed fix: make Space or Enter roll when no dialog or disclosure is open, and make S (or Escape
  during a moment) skip. Show the hint in the menu.
- Effort: S. Priority: P2.

### UX-19 The title screen's first impression: grey backdrop and live-looking map controls
- Category: onboarding / readability
- Current behaviour: behind the title card, the map is flat grey while it loads, and the zoom and
  全体 / 目標路線 buttons are visible although they are inert (`GameApp.tsx:486`;
  `desktop-01-title.png`, `desktop-32-title-with-save.png`).
- Proposed fix: hide the map controls on the title screen, and show the Yamanote loop overview, or a
  static hero image of the loop with the dice, behind the card so the game's idea reads at a glance.
- Effort: S. Priority: P2.

### UX-20 「セーブを削除」 sits between the two main choices
- Category: readability
- Current behaviour: the title screen lists つづきから / セーブを削除 / はじめから / クレジット, all
  full-width at nearly equal weight (`TitleScreen.tsx:82-88`; `desktop-32-title-with-save.png`). A
  confirmation dialog exists (`GameApp.tsx:465-472`), so this is clutter, not data loss.
- Proposed fix: demote it to a small text link under the resume button, or move it into a settings screen.
- Effort: S. Priority: P2.

### UX-21 Lines are identified by colour alone on the map
- Category: accessibility
- Current behaviour: the HUD badge carries a line code (JY, E, Z) (`LineBadge`), but on the map the
  current ride and the lottery candidates are told apart only by colour and width. Yamanote progress
  uses solid versus dashed lines, which is good.
- Proposed fix: put a small line-code badge next to the current-position marker, and show codes on
  the candidate lines during a lottery. Check the palette with a CVD simulator; this was not done here.
- Effort: M. Priority: P2.

### UX-22 Long detours give the player nothing to collect
- Category: drop-off
- Current behaviour: the only goal is 30 Yamanote segments. Being sent to 大宮 or 千葉 is pure loss.
- Proposed fix: add cosmetic collection counters with no rule change: 「訪れた駅 123/1,586」,
  「乗った路線 24/134」, and 「新しく訪れた駅」 as a small "+1" pop on arrival. Show them on the HUD
  (secondary) and on the clear screen. This turns detours into discovery for rail fans, the game's
  core audience. It is compatible with the R6 / D2 decision against length levers.
- Effort: M. Priority: P1.

### Findings added after the Codex second pass (evidence re-checked by reading the cited lines)

### UX-23 No one-tap way back to the current position after exploring the map
- Category: readability / mobile
- Current behaviour: panning, zooming, 「全体」, or 「目標路線」 turns follow off (`GameApp.tsx:270`
  `stopFollowing`). The only way to turn it back on is 「追尾: OFF」 inside the collapsed メニュー
  (`GameMenu.tsx:321-323`). There is no 「現在地」 button on the map, next to 全体 / 目標路線.
- Why it hurts: exploring the large network is part of the fun, and losing your own marker
  afterwards is frustrating, especially on a phone.
- Proposed fix: add a 「現在地」 button beside 全体 / 目標路線 that re-centres the map and turns
  follow back on. Show a small "追尾OFF" state on the map itself.
- Effort: S. Priority: P1.

### UX-24 Loading can hang forever, and a failed load has no retry
- Category: other (error and empty states)
- Current behaviour: `loadRailwayData` waits for all five files with `Promise.all`, with no timeout
  (`src/data/loaders.ts:49-52, 71-80`). While that runs, single-edition builds show only a bare
  「読み込み中…」 (`EditionApp.tsx:64`). `segments.geojson` is about 1.29 MB. When required data
  fails, the title shows 「ゲームを開始できません: …」 with the start button disabled and no retry
  control (`TitleScreen.tsx:220-224, 240-247`).
- Why it hurts: on a slow mobile connection, a first-time visitor cannot tell "loading" from
  "broken" and leaves. This was not reproduced here because loading was local.
- Proposed fix: show a progress or "大きなデータを読み込んでいます" message after about 3 s, a
  timeout of about 20 s that offers 「再読み込み」, and a retry button on the failure notice. Let the
  game start when only the geometry or manifest is still pending, if the game logic does not need it.
- Effort: S-M. Priority: P1 for the retry and long-wait message, P2 for splitting required and optional data.

### UX-25 Truncated HUD values cannot be read in full on touch devices
- Category: mobile / accessibility
- Current behaviour: HUD values are a single line with `white-space: nowrap; overflow: hidden`
  (`styles.css:635-650`). The full text is only in a `title` attribute (`GameHud.tsx:72-82`), which
  touch devices do not show. Long service names and 「…方面」 labels are exactly what the player
  needs to read. Truncation was not seen in the screenshots taken; this finding comes from the code.
- Proposed fix: let the 乗車中 and 進行方向 values wrap to two lines on phones, or expand a value
  when it is tapped.
- Effort: S. Priority: P2.

### UX-26 Discarding happens on a single tap with no confirmation
- Category: mobile
- Current behaviour: each of the four cards has its own 「このアイテムを捨てる」 button, which
  discards immediately (`DiscardChoice.tsx:49-57`; `desktop-20-discard.png`). On a phone, the
  dialog is long and scrolls.
- Proposed fix: select a card first, then confirm with one 「○○を捨てる」 button. Alternatively,
  make the new item's button visually distinct, since discarding the new item is the most common choice.
- Effort: S. Priority: P2.

### Findings added by the user (2026-11-08)

### UX-27 No one-tap way to post the result to X
- Category: end-game
- Current behaviour: the clear screen offers 「コピー」 and, only where the Web Share API is available,
  「共有」 (`ClearScreen.tsx:111-113`, `canShare` from `resultShareActions`). On desktop browsers
  without Web Share, posting means copying, opening X, and pasting. That friction lands at the
  exact moment the player is most motivated to share.
- Why it hurts: every share is free acquisition. A multi-step share loses most of those posts.
- Proposed fix: add an 「Xでシェア」 button that opens
  `https://x.com/intent/post?text=<encodeURIComponent(shareText)>` (optionally `&url=` and
  `&hashtags=`) with `window.open(..., "_blank", "noopener,noreferrer")`. Show it on every device,
  next to the existing buttons. Reuse `buildShareText`, and check that its weighted length
  stays within X's 280 limit (each Japanese character counts as 2). Track it as
  `result_share` with `method: "x"`. Unit-test the URL builder, and add an E2E test that asserts
  the opened URL without hitting the network.
- Effort: S. Priority: P1. It sits naturally with UX-08.

### UX-28 Unnatural line breaks in dialogs, buttons, and long service names
- Category: readability
- Current behaviour: Japanese text breaks mid-word in several places. The user reported it when
  rolling the die during item use (the item and roll-adjust dialogs) and wherever a long service
  name is shown. The menu speed button breaking as 「速度: ふつ / う」 at 1280 px
  (`desktop-16-menu.png`, listed below under the incidental bugs) is the same class of problem.
  Default CSS lets Japanese break between any two characters, so narrow grid cells and buttons
  split words such as 路線名 or ふつう.
- Why it hurts: the text looks broken, and it reads as unpolished at the moments that are meant
  to be exciting.
- Proposed fix: audit every affected component at 390 px and 1280 px. Then:
  (a) keep short labels such as button text, chips, and die values on one line
  (`white-space: nowrap`), and give their containers a sensible `min-width`, or let the grid wrap
  whole cells instead;
  (b) for longer Japanese text, use `word-break: auto-phrase` (Chromium) with a `keep-all` plus
  `overflow-wrap: anywhere` fallback, or insert `<wbr>` at natural boundaries in service names
  (for example between the operator and the line name, and before 「方面」);
  (c) use `text-wrap: balance` on headings and short multi-line messages.
  Keep UX-25 consistent: HUD values may wrap to two lines on phones, but only at those natural
  boundaries. Add a layout E2E test that renders the longest service name and the item and
  roll dialogs, and asserts that labels do not break mid-word, for example by checking that the
  button's height stays one line.
- Effort: S-M, depending on how many components the audit finds. Priority: P1. It is cheap and
  visible on every playthrough.

---

## Top-5 recommendation

1. **UX-03 auto-roll and a faster speed, with UX-04 persisted settings.** This is the largest and
   most direct lever on length-driven drop-off, and it needs no rule change.
2. **UX-05 "getting closer" feedback and milestones.** It turns a long detour from despair into
   anticipation.
3. **UX-02 an always-visible last-turn summary.** It is cheap and makes randomness readable.
4. **UX-01 first-run coach marks and first-occurrence tips.** They complement #60, and together
   they solve "how do I play?".
5. **UX-17 drop-off analytics.** Without it, none of the above can be shown to work. Ship it first or alongside.

Close runners-up: UX-08 (records and personal best) and UX-22 (collection counters) for replay
motivation, and UX-06 (explain auto-save) as a cheap retention fix.

## Suspected bugs found incidentally

- **Menu speed button wraps mid-word**: 「速度: ふつ / う」 at 1280 px (`desktop-16-menu.png`;
  `.game-panel__options` grid in `styles.css`). Cosmetic. Now tracked under UX-28.
- **Ambiguous turn number on the resume button**: after 95 completed turns, the button reads
  「95ターン目」 (`TitleScreen.tsx:49`, `game.turn` counts completed turns). The next roll is the
  96th turn, which is how the clear screen numbers it (「96ターン目：…」). Consider
  「95ターン終了」 or 「96ターン目から」.
- **Stale README header**: `README.md:3` still says 「`feature/item-system` の現行ルールは…（未リリース）」,
  although items shipped in v0.10.0 to v0.12.0.
- **Two figures for game length**: the brief uses the 23-ward numbers (52/114/189). The
  Tokyo-suburban D2 record (`DESIGN.md:209`) says 55/146/261 and predates items. A fresh simulation
  with items would make the drop-off discussion concrete (`npm run sim`).
- **The map-failure state may stick after recovery** (raised by Codex, code-read only). In
  `RailwayMap.tsx:388-394`, any basemap error before the first `load` calls `setStyleFailed(true)`,
  and nothing clears it if `load` succeeds afterwards. A transient tile error during start-up could
  leave the failure UI on top of a working map. Needs a repro, for example failing one tile request
  in Playwright.
- Already in `DESIGN.md` TODO (re-confirmed, not new): `game_clear` is skipped if the player leaves
  during the goal banner.

## Codex second pass

Sol at low effort, read-only (`.claude/logs/codex/20261108T035725Z-ux-gap-review.md`). It added
UX-23 to UX-26 and the map-failure suspicion. Its disagreements, and how they were applied:

- UX-03: Codex prefers a persistent "演出を省略" setting before a full auto-roll, because items need
  decisions. Both remain in the proposal: ship the faster speed or skip-by-default first, and treat
  auto-roll, which stops at every decision, as the second step.
- UX-08: the clear screen already has a full text history. The gap is a map recap and highlights;
  the wording was adjusted.
- UX-18: the roll button already works with Enter or Space while focused. The finding is only about
  the missing global key; it stays P2.
- UX-20: a confirmation dialog exists, so this is layout clutter, not data loss; it stays P2.
- A keyboard-accessible station search was suggested at P2. It is not included here as a separate
  finding because it is niche.

## Not verified

- Real-device performance, touch panning, and network load time. Everything was run on local
  `vite dev` with software WebGL, so the per-turn timings are an upper-bound estimate.
- Colour-vision-deficiency simulation of the line palette.
- Screen-reader behaviour (only the code-level `aria-live` and `role` structure was read).
- WebKit / iOS Safari specifics, such as safe areas and sticky hover after a tap.
