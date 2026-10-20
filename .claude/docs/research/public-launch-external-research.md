# Public Launch — External Research (branding, engagement, launch in Japan)

- Date: 2026-10-20 (all web sources accessed on this date)
- Scope: external research only; no repository code was changed.
- Product: 「山手線すごろく 東京近郊版」 (https://yamanote-line-sugoroku.vercel.app) — solo,
  static (Vercel), seeded RNG, local save, no accounts/server.
- Cost scale used in every "Fit for this game" list: **S** ≤ 1 day, **M** 2–5 days,
  **L** > 1 week or a rule/architecture change. Impact: High / Med / Low.
- Legal notes are flags for the owner to check, **not legal advice**.

## 0. The one design fact that shapes everything below

The current rules give the player **no decisions**: the die and the landing lottery are
both drawn from the seeded RNG (`docs/manual/tokyo-suburban/rules.md`,
`src/features/game/engine/landing.ts`, `rng.ts`). Consequences:

1. A Wordle-style **daily seed would give every player the identical game**. A shared seed
   is still worth having as a *shared story* ("today everyone got sent to 成田空港"), but it
   cannot produce a *competitive* comparison like Wordle or Slay the Spire's Daily Climb.
   Making daily results differ per player needs either (a) a prediction/bet layer that does
   not change the run, or (b) a small amount of real agency (a rule change, cost L).
2. Because outcomes are deterministic and fixed before the animation, every "reveal" is
   presentation only. That makes honest reveals cheap and dishonest ones (fake near-misses)
   pointless — see 1.6.
3. The game's native emotional currency is **luck and detours**, not skill. Japanese
   railway-travel entertainment (サイコロの旅, 地獄旅, リアルすごろく) monetises exactly that:
   suffering and absurd detours are the content (section 2). Share formats should celebrate
   bad luck as much as good luck.

---

## 1. Engagement mechanics for a solo, static, seeded dice game

### 1.1 Daily shared seed + spoiler-free result grid (Wordle pattern)

- **Why it works.** Wordle's emoji grid was invented by a player (Elizabeth S, New Zealand)
  as a spoiler-free brag and then built in by Josh Wardle; it went viral in Dec 2021. The
  grid shows the *shape* of your game but not the answer, and because everyone played the
  same puzzle every grid was a conversation starter. One puzzle per day created scarcity;
  no app, signup or ads minimised friction. Reported growth: ~90 daily players (Nov 2021)
  → ~300k (late Dec 2021) → ~2–3M (Jan 2022); NYT bought it for "low seven figures"
  (Slate 2022-01; Wikipedia; Dinogame/Phrazle analyses).
- **Daily seeded runs in other games.** Slay the Spire's Daily Climb (Patch 14, Mar 2018):
  "The same seed is utilized by everyone so the Daily Climb allows players to see how well
  they stack up with the same choices"; only the first attempt counts; separate RNG streams
  per system so order of player actions does not desync the run (Into the Spine 2018;
  Steam discussions; STS2 daily guides 2026). Note the comparison only works because there
  *are* choices.
- **Japanese railway precedent.** ネスゴシ (independent dev Pocke, released 2026-09-04;
  AUTOMATON 2026-09-10) has 「今日の問題」 (one shared puzzle per day, consecutive-day count)
  and shares results **with station/line names hidden** — the Wordle pattern transplanted
  to railway fans. 駅名Wordle (Val Laboratory, April Fools' 2022, made permanent as
  駅すぱあとWordle in Feb 2023) had share/copy buttons (Famitsu).
- **Static-site cost.** Low: derive the seed from the JST date (e.g. `YYYY-MM-DD` +
  edition id). Must pin the date to `Asia/Tokyo`, not the device timezone.
- **Risks.** Spoilers (today's journey revealed in replies) — mitigate by keeping share
  text abstract. Data/rule updates change the daily outcome for the same seed; version the
  daily seed with the ruleset/data hash. Identical outcomes for everyone (section 0).
- **Mapping.** Use daily seed as 「今日の旅」: everyone rides the same journey; the social
  object is the story, not the score. Add individual variance with a **pre-run prediction**
  (e.g. guess the turn bracket or the farthest prefecture/operator reached) so the share is
  "予想 50ターン以内 → 結果 63ターン". Real agency (e.g. TV-show style 金のサイコロ(4–6)/
  銀のサイコロ(1–3) chosen a limited number of times — テレ東 2025-03-08 format) would make
  daily runs comparable but is a rule redesign; if done, follow STS: separate RNG streams
  for die and lottery so a choice does not reshuffle unrelated draws.

### 1.2 Emoji/text share card tuned for X

- X counts CJK characters and emoji as weight 2 and URLs as 23 → **~140 Japanese characters
  per post** (docs.x.com "Counting Characters"). A 55-turn per-turn emoji strip will not
  fit; a compact block will.
- Suggested shape (≈6 lines): title + date/seed id, turns/moves/transfers, a 30-cell
  Yamanote progress row (e.g. coloured by which tenth of the game each segment was taken),
  "最遠到達: ○○駅 (新橋から△km)", "乗った事業者 n/15", hashtag, URL.
- Risk: emoji colour-only encoding is inaccessible to screen-reader users (they read
  "green square" ×30). Keep a plain-text line carrying the same information.

### 1.3 Streaks vs. cumulative counts

- Streaks work through **loss aversion**; Duolingo's (blog-reported) numbers: 7-day streak
  users 3.6× more likely to finish a course; streak freezes cut abandonment after the first
  miss. Criticism: anxiety, "performative" engagement, guilt notifications labelled a dark
  pattern (UX Magazine; screenwiseapp; dev.to 2025–2026; industry blogs, not peer review).
- Static cost: S (localStorage).
- Mapping: no push notifications exist, so the worst Duolingo patterns are impossible.
  Prefer **cumulative** counters ("参加日数 12日", "総乗車駅数") over a fragile streak, or a
  streak with automatic forgiveness (one missed day free). Never shame a lost streak.

### 1.4 Collection: per-station "stamp book" / 乗りつぶし across games

- **Why it works.** Collection completion is a core Japanese railway hobby: JR East group's
  デジタル駅スタンプ app エキタグ had **87 operators/facilities by Apr 2025** and an official
  stamp-book (`全国デジタル駅スタンプ図鑑`, 2025-11-26) (鉄道コム; PR TIMES). Browser
  乗りつぶし tools (e.g. "JR全線制覇マップ", mach-tools.net) store progress in the browser
  only, show per-line/per-company completion %, and offer X sharing — exactly this game's
  architecture.
- **Static cost.** M: persist a set of visited station ids / ridden segment ids across games
  in localStorage (1,586 stations, 3,988 directed segments → a few KB as bitsets); a
  collection screen; a map overlay painting everything ever ridden.
- **Risks.** Never imitate real 駅スタンプ artwork (owned by railway companies). Generate
  original "stamps" (station name + operator-neutral colour + seeded pattern). Storage can
  be cleared by the browser; offer export/import of the collection as a code/file.
- **Mapping.** "駅コレクション 412/1,586", "事業者コンプ 11/15", "路線コンプ 37/134"; first
  arrival at a station in a game triggers a small "新駅!" stamp animation. This turns a
  55-turn luck game into a long-term meta-goal and gives a reason to replay.

### 1.5 Achievements / badges

- Cost S–M (pure functions over the existing movement history + localStorage).
- Mapping (examples that reward luck *and* misfortune, matching 地獄旅 culture):
  東京近郊区間の端に到達 (終点/エリア端 stops), 15事業者すべて乗車, 1ターンで山手線6区間,
  最短クリア (≤ N turns), 100ターン超の大冒険, 山手線から最も遠い駅 (distance bands),
  同じ駅に3回到着, 一度も山手線を降りずにクリア (if possible). Each badge's rarity can be
  computed offline by simulation (there is already a simulation harness:
  `vitest.simulation.config.ts`) and displayed honestly ("達成率 3%").

### 1.6 Variable-reward reveals, rarity, near-miss

- **Evidence.** Variable-ratio schedules are the most extinction-resistant (Skinner).
  Near-misses raise reward expectancy via dopamine D2 (Winstanley et al., Neuropsycho-
  pharmacology ~2010) and keep gamblers playing although they carry no information
  (near-miss review, PMC7214505). In gambling these are regulated because they exploit.
- **Static cost.** S–M (presentation layer only).
- **Risks.** This game has no money, gacha or ads, so the harm surface is small, but a
  **fabricated** near-miss (a reel that "almost" stopped on 山手線 when the draw was never
  close) is still deception. Because the result is fixed before animation, reveals can be
  fully honest at no cost.
- **Mapping.** Compute the real probability of each lottery draw (weights are known:
  山手線 2/3 when present, 2× weight toward 山手線 for direction). Tag draws below a
  threshold as レア抽選 and give them a bigger reveal; show the true odds ("この抽選 1/12").
  Honest "almost" moments exist naturally ("あと1駅で新橋だったのに終点で停止") and are
  great narrative beats without faking anything.

### 1.7 Slot-machine / split-flap lottery reveal

- A railway-native take on the slot reel is the **反転フラップ式 (ソラリー) departure board**:
  line names flip until the drawn one settles. It reads as "railway" rather than
  "casino", which matters for tone.
- Cost M (CSS 3D or canvas; ≤1.5 s; `Skip` already exists). Reduced motion → instant
  result with a short fade only.

### 1.8 "Juice": shake, particles, confetti, sound, haptics

- **Principles.** "Juice It or Lose It" (Jonasson & Purho, GDC 2012) and Vlambeer's "Art of
  Screen Shake" (2013): add generous feedback, then dial back; scale feedback to event
  size; shake decays fast ("a punch, not an earthquake"); hit-stop 40–80 ms; too much
  juice becomes noise (GDC Vault; valdemird.com "Game feel on the web").
- **Confetti.** `canvas-confetti` supports `disableForReducedMotion` but defaults to
  `false` — set it explicitly; tsParticles-confetti and konfetti.js (<7 KB gz claimed)
  default to `true` (npm/GitHub).
- **Photosensitivity.** WCAG 2.3.1 (Level A): nothing flashes more than 3×/s unless below
  the general/red flash thresholds (small area ≈ 341×256 px at 1024×768). 2.3.3 (AAA):
  interaction-triggered motion can be disabled; `prefers-reduced-motion` is the standard
  technique, but it does **not** exempt content from 2.3.1 (W3C Understanding 2.3.1).
  → No full-screen white/red flashes for rare reveals.
- **Sound.** Browsers start `AudioContext` suspended until a user gesture (Chrome ≥ 71
  autoplay policy; Safari/Firefox similar). Ship **sound off by default** with a visible
  toggle; create/resume the context on the toggle tap (Chrome for Developers blog).
  Free SFX: 効果音ラボ — commercial use free, no credit needed, modification OK; no
  redistribution as material, no hotlinking (official 利用規約/FAQ). **Do not use real
  発車メロディ/駅メロ** — assume they are copyrighted works (not verified per melody here;
  treat as a hard rule).
- **Haptics.** `navigator.vibrate` works on Android Chrome/Edge only; iOS/iPadOS Safari
  (all iOS browsers) do not implement it; hidden-switch workarounds exist but Apple
  narrowed them in iOS 26.5 and they require a direct tap (MDN BCD issue; haptics-web
  2026). Treat haptics as an Android-only nicety, opt-in.
- **Static cost.** S for each individually; keep each effect behind one global
  "演出" setting (full / reduced / off) that also honours `prefers-reduced-motion`.

### 1.9 Progress bars and milestones

- The game already shows Yamanote progress. Juice the **milestones** (10/20/30 segments,
  "残り3区間") rather than every step, per the scale-to-event rule. Cost S.

### Fit for this game (Section 1), ranked by impact/cost

| # | Recommendation | Impact | Cost |
|---|----------------|--------|------|
| 1 | Cross-game station/segment collection + 乗りつぶし map overlay + "新駅!" stamp | High | M |
| 2 | Rarity-tagged lottery with honest odds + split-flap reveal; reduced-motion = instant | High | M |
| 3 | Milestone juice (segment 10/20/30, last segment, clear) + confetti with reduced-motion disabled | Med-High | S |
| 4 | Achievements that reward misfortune as well as speed, with simulated rarity % | Med-High | S–M |
| 5 | Daily 「今日の旅」 seed (JST, versioned by data/rules hash) + pre-run prediction for per-player variance | Med | S–M |
| 6 | Sound off by default, original/効果音ラボ SFX, single 演出 setting | Med | S |
| 7 | Cumulative "参加日数" rather than a hard streak | Low-Med | S |
| 8 | Android-only opt-in vibration | Low | S |
| 9 | Real agency (金/銀のサイコロ-style limited choice) to make daily runs comparable | High (if wanted) | L, rule change |

---

## 2. Japanese railway hobby games and what makes them shareable

### 2.1 Comparable products and formats

- **ネスゴシ** (browser, 2026-09-04): station-guessing from a hidden route map, ~600 lines /
  8,800 stations from 駅データ.jp, daily shared puzzle + consecutive days, spoiler-free SNS
  share. Got AUTOMATON coverage within 6 days; AUTOMATON highlighted that it was built in
  just over a week with Claude Chat/Claude Code — **the dev story itself was news**.
- **駅名Wordle / 駅すぱあとWordle** (Val Laboratory, 2022 → permanent 2023): one-day
  April Fools' stunt turned evergreen; covered by Famitsu, 電撃オンライン, ウーマンエキサイト.
  Takeaway: a railway twist on a known viral format gets press pickup.
- **駅メモ!** (location game; 9,100+ stations; #1 in a 2026 電車ゲーム ranking): long-term
  collection + station "gyms" — evidence that station collection retains users for years.
- **乗りつぶし tools** (JR全線制覇マップ, 乗り鉄撮り鉄, エキタグ): per-line completion %,
  local storage, X share. Completion % is the hobby's lingua franca.
- **Video formats** (2025): 西園寺's 「日本縦断リアルすごろくの旅」 (Jan–Feb 2025; dice →
  move that many stations; 2万円 budget), 東海道新幹線リアルすごろく (JR東海 tie-up with event
  squares like グリーン車で移動/スタートに戻る), 「地獄のサイコロ旅」 (2025-11-29),
  テレ東 「金のサイコロ銀のサイコロすごろく旅」 (2025-03-08, 3rd in series), lineage back to
  水曜どうでしょう's サイコロの旅. Common thread: **chance-driven routes, suffering,
  reversals**, and narrated reactions — this game's exact engine.

### 2.2 What makes results shareable on X in Japan

- Spoiler-free summaries for daily content (ネスゴシ, Wordle).
- A **visual of the route** is the native artefact of railway fandom (route maps, 制覇マップ).
  A generated image of "today's journey traced on the map" is likely more striking in the
  timeline than text alone. Evidence for "image beats text" here is inferential (no
  Japan-specific A/B data found); treat as a hypothesis to test.
- Bad-luck brags: "63ターンかかった / 成田空港まで飛ばされた" fit 地獄旅 culture.
- Image share mechanics: Web Share API Level 2 shares files on iOS Safari 15+ and Android
  Chrome; on iOS the `File` must be prepared **before** the tap because awaiting canvas
  rendering consumes the user activation (dev.to 2026-09; web.dev). Desktop fallback:
  download the PNG + open the X intent with the text.
- Links: X's open-sourced ranking (2026-01) has no explicit link penalty and Musk said in
  July 2026 links haven't been throttled "for over a year", but independent measurements
  still show linked posts under-performing because clicks leave the platform (PPC Land;
  Kompozy 2026). For the **developer's own launch posts**, put a video/GIF + hook in the
  main post and the URL in the first reply. For **player shares**, keep the URL in the
  post (it is what spreads the game).
- OGP card: the site has **no OGP/Twitter Card tags today** (`index.html` checked), so a
  shared URL currently renders as a bare link. This is the cheapest share-quality fix.

### Fit for this game (Section 2), ranked by impact/cost

| # | Recommendation | Impact | Cost |
|---|----------------|--------|------|
| 1 | Static OGP/Twitter Card (1200×630) on the site | High | S |
| 2 | Client-side "旅の軌跡" result image (route trace + stats) shared via Web Share files / download fallback | High | M |
| 3 | Share text that celebrates misfortune (最遠到達駅, 迷子度, 事業者数) within 140 JP chars | Med-High | S |
| 4 | Seed-replay link (`?seed=` / result id) so friends can watch the same 地獄旅; reuses existing deterministic replay | Med-High | S–M |
| 5 | Pitch the dev story (国土数値情報 + MapLibre + seeded replay + AI-assisted dev) alongside the game | Med | S |

---

## 3. Branding: logo, favicon, manifest, OGP, fonts, trademarks

### 3.1 Logo / wordmark approach without a designer

- **Two assets, not one:** (1) a horizontal **wordmark** 「山手線すごろく」 + small
  「東京近郊版」 for the title screen/OGP; (2) a **symbol** that survives 16 px for the favicon
  (a die whose pips form a loop, or a ring + single kanji 「山」). Wordmarks are illegible at
  16 px.
- **Process:** set type in Figma/Inkscape → adjust kerning (Japanese display type needs
  manual 字間 tightening) → convert text to outlines → export SVG → optimise with SVGO →
  derive PNGs. Outlined SVG means no web-font download for the logo.
- **Motif cues (generic, not proprietary):** loop/circle (環状運転), die pips, a
  yellow-green accent (山手線 line colour per Wikipedia's ラインカラー list), station-sign
  inspired layout. Evoke, do not copy — see 3.5.

### 3.2 Japanese fonts for the logo (Google Fonts, SIL OFL 1.1)

- OFL 1.1 permits using a font in logos/images, commercially, without credit; restrictions
  apply to selling/redistributing the font files and to renamed modified fonts
  (general OFL terms; confirm on each font's Google Fonts license tab).
- Candidates: **Dela Gothic One** (ultra-heavy, punchy title; single weight),
  **M PLUS Rounded 1c** (7 weights, neat rounded), **Zen Maru Gothic** (softer rounded;
  OFL confirmed in googlefonts/zen-marugothic repo). For UI body text consider
  **BIZ UDPGothic** (UD readability) or the system font stack to avoid multi-MB downloads.
  Only Zen Maru Gothic's OFL was verified at the repo level in this research; verify the
  others' OFL.txt before shipping.

### 3.3 Favicon / icons / manifest (2025–2026 consensus)

Ship exactly (iconmaker.studio 2025; faviconbuilder 2026; icojoy 2026; sammapix 2026):

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#…">
```

- `favicon.ico`: 16/32/48 in one file (48 for Windows pinning; crawlers request it).
- `favicon.svg`: primary for Chromium/Firefox; can embed `@media (prefers-color-scheme:
  dark)`. Safari support for SVG favicons and for dark-mode CSS inside them is
  **conflicting across sources** — design colours that work on light and dark tabs.
- `apple-touch-icon.png`: **180×180, opaque PNG**, ~20 px padding (transparent areas
  render black on iOS).
- Manifest: 192×192 and 512×512 PNG, plus a 512×512 `"purpose": "maskable"` icon with the
  mark inside the ~409 px safe zone. Google Search favicon: square, multiple of 48 px or SVG.
- No WebP/AVIF favicons. Free generator without account: RealFaviconGenerator-type tools
  (not individually verified here).

### 3.4 OGP for X and LINE

- One **1200×630 (1.91:1)** PNG/JPG, < 1 MB, key text inside a centred ~1080×600 safe
  area; X limits 300×157 min, 4096² max, < 5 MB (samune-ai 2026; og-image.org 2026;
  bluetraff; cocorograph).
- Required tags: `og:title`, `og:description`, `og:image` (absolute https URL), `og:url`,
  `og:type`, `og:site_name`, `og:locale=ja_JP`, **`twitter:card=summary_large_image`**
  (X falls back to the small card without it), `twitter:image:alt`.
- LINE: same 1200×630 works (min 600×315). LINE caches aggressively; the Page Poker
  cache tool (https://poker.line.naver.jp/) is reported as unavailable at times — instead
  version the image URL (`ogp.png?v=2`) on every change (Zenn 2026).
- Per-result dynamic OGP (`@vercel/og`) needs a serverless function — a departure from
  "static only"; defer (cost L).

### 3.5 Railway trademark / design cautions (flag, not legal advice)

- JR East's site terms reserve trademarks/trade names; commercial merchandise using JR East
  railway assets is licensed through **jeki** (ジェイアール東日本企画) with a fee and
  「JR東日本商品化許諾済」 labelling; even JR East's free 「鉄道のまち大宮」 logo guideline
  says combining it with railway-asset imagery requires a (paid) license. No JR East
  fan-work guideline was found.
- Practical rules for this project: **do not** use the JR mark, company logos, the JY/JK
  station-numbering pictogram designs, 駅名標 or 発車標 replicas, train photos/vehicle
  liveries, or 駅スタンプ artwork; **do** use plain text line names, original pictograms, and
  colours as data-visualisation (colour alone is generally not the risk; the combination
  that implies endorsement is). Add a footer disclaimer: 「本作は非公式のファンゲームであり、
  各鉄道事業者とは関係ありません」. Whether 「山手線」 appears in any registered mark can be
  checked on J-PlatPat (not done here).
- Monetisation (ads, paid items) would raise the stakes and also conflicts with Vercel
  Hobby's non-commercial restriction (Vercel Hobby docs; zplatform guide 2026).

### Fit for this game (Section 3), ranked by impact/cost

| # | Recommendation | Impact | Cost |
|---|----------------|--------|------|
| 1 | OGP/Twitter Card tags + 1200×630 image (logo + stylised route map + tagline) | High | S |
| 2 | favicon.ico + favicon.svg + 180 apple-touch-icon + manifest 192/512/maskable + theme-color | Med-High | S |
| 3 | Outlined SVG wordmark (Dela Gothic One or M PLUS Rounded 1c) + 16 px-safe symbol | High | S–M |
| 4 | Non-affiliation disclaimer + asset rules above in README/credits | Med (risk reduction) | S |
| 5 | Per-result dynamic OGP via serverless | Med | L (architecture) |

---

## 4. UI richness for a map-based casual game

### 4.1 Patterns that read as "premium"

- **One coherent theme** drawn from the subject: departure-board typography for the
  lottery, ticket/切符-shaped cards for turn results, a stamp-book page for the collection.
  A strong theme does more than more effects.
- **Type system:** one display face (logo/headings only, outlined or subset) + one
  readable body face; tabular numerals for counters; Japanese line-height ~1.6–1.8.
- **Card UI** for the current turn (die → stations passed → lottery result) with a
  consistent motion grammar: enter 150–250 ms, settle, no looping idle animation.
- **Micro-interactions:** die press-down + roll, counter tick-up on progress, "新駅!" stamp,
  milestone pulse. Scale to event size (section 1.8).
- **Map styling:** dim the basemap (desaturate, lower label density) so the network and
  the player's trace are the hero; ridden segments brighter than unridden.
- **Light/dark themes** honouring `prefers-color-scheme`.

### 4.2 First 30 seconds (FTUE)

- Consensus: reach the core loop within ~30 s, show-don't-tell, one concept at a time,
  contextual teaching, an early win (Game Developer; Udonis; Supersonic; iABDI 2026-01;
  Mobile Game Doctor 2025-05). Trash Tycoon lost 60% of players in an over-dense tutorial
  (Supersonic).
- Mapping: title → one big 「サイコロを振る」 button; first roll explained in-place by a
  one-line coach mark ("出た目の数だけ進みます"), first lottery by a second one ("到着駅で次の
  路線を抽選"); the goal ring (30 segments) introduced at the first Yamanote segment. Move
  legend/filters/settings behind a menu until after the first few turns.

### 4.3 Performance on low-end phones

- Current baseline: main JS chunk ~1.33 MB + MapLibre worker ~0.5 MB (local `dist/`),
  physical-device performance not yet measured (README).
- MapLibre: cap `pixelRatio` (e.g. `Math.min(devicePixelRatio, 2)` or lower on weak GPUs);
  `antialias` is off by default — keep it off; minimise symbol layers (CPU-bound);
  animate overlays on a separate canvas/DOM layer rather than forcing full-map repaints
  (MapLibre docs; GitHub discussion #3590).
- Effects: CSS transforms/opacity only; particles on a small overlay canvas with a cap;
  pause effects when `document.hidden`. Japanese web fonts: avoid full CJK downloads
  (Google Fonts slices by `unicode-range`, but a logo should be SVG paths).

### Fit for this game (Section 4), ranked by impact/cost

| # | Recommendation | Impact | Cost |
|---|----------------|--------|------|
| 1 | Two-step in-place onboarding + hide secondary UI for the first turns | High | S |
| 2 | Railway-themed visual system (departure-board lottery, 切符 turn cards, stamp book) | High | M |
| 3 | Basemap de-emphasis + bright personal trace | Med-High | S |
| 4 | pixelRatio cap + effect budget + measure on a real low-end Android | Med (protects all others) | S–M |
| 5 | Dark theme | Low-Med | S–M |

---

## 5. Launch and promotion in Japan

### 5.1 Channels

- **X (primary).** Launch thread: 15–30 s screen recording of one 地獄旅 (video beats
  stills for a moving map), hook line, URL in first reply; reply to every response (in the
  open-sourced weights a reply the author answers is worth ~150 likes — creator-tool blog,
  treat as indicative). Hashtags: #山手線すごろく plus established tags such as #乗り鉄 /
  #鉄道好きと繋がりたい (popularity not measured here).
- **はてなブックマーク.** Japanese web-toy launches commonly travel via はてブ: ~3–5
  bookmarks within ~1 h → 新着; ~10 → category 人気; ~50–100 → 総合 top, then @hatebu on X
  (weblab heuristics; unofficial). A good Zenn/note write-up is the usual vehicle.
- **Dev write-ups.** Zenn/Qiita (technical: 国土数値情報 N02 processing, MapLibre on
  low-end phones, seeded deterministic replay, accessibility), note (making-of story).
  catnose's 「Webサービス公開前のチェックリスト」 (Zenn, 2024-07-04, 1,403 users on はてブ)
  is a useful pre-launch checklist.
- **Gaming/web press.** AUTOMATON covered ネスゴシ within a week of an indie's X post;
  Famitsu/電撃 covered 駅名Wordle. Send a short pitch (what / why fun / GIF / URL / dev
  story) to AUTOMATON, ねとらぼ, GIGAZINE, 窓の杜, 鉄道コム (submission routes not verified).
- **Streamers / railway YouTubers.** The real-life sugoroku format is established
  (西園寺, Shu＊Kura, テレ東). Publish a **配信ガイドライン** page (individuals may stream/
  upload; platform monetisation OK; corporate use by request; no need to ask) — templates in
  PlayBridge's indie guide; big publishers (Nintendo, Capcom 2021-01) set the norms
  streamers look for. Add a "配信モード" (larger text, compact HUD, longer reveals) later.
- **Game portals.** Japanese browser-game portals post-ゲームアツマール (closed 2023-06-28):
  PLiCy (no review, browser-only), ふりーむ! (reviewed, high traffic, crowded), itch.io
  (international). Mostly for engine-built games; a listing linking to the Vercel URL is
  optional.
- **Product Hunt / Show HN / Reddit.** Product Hunt typically yields a few hundred visits
  and favours funded launches (2025–2026 indie reports); Show HN is high-variance and
  wants technical substance; both need an English UI. Low priority for a Japanese-only
  game. Reddit communities (r/japanlife etc.) — rules not checked; low fit.

### 5.2 Timing (heuristics, not measured)

- Weekday evening JST or weekend morning for the X launch; avoid big-news days.
- Seasonal hooks: year-end/New Year holidays (idle time, 帰省 trains), Golden Week,
  railway anniversaries (鉄道の日 10/14 has just passed). A **staggered launch** (X → Zenn
  write-up a few days later → press pitch with early numbers) mirrors the multi-wave
  advice for indie launches.

### 5.3 Press kit (one page, `docs/` or `/press`)

One-paragraph pitch, 3–5 screenshots (PC + phone), one 15 s MP4/GIF, logo SVG/PNG,
facts (stations 1,586; services 135; median ~55 turns; free; no signup), data credits
(国土数値情報 N02, OpenFreeMap/OSM), unofficial-fan-game disclaimer, contact (X DM),
配信ガイドライン link.

### 5.4 Privacy-friendly analytics

| Option | Cost | Cookies | Custom events | Notes |
|--------|------|---------|---------------|-------|
| Vercel Web Analytics (Hobby) | Free, **50k events/month**; collection pauses after limit + 3-day grace | None; daily-rotating request hash, data not linkable across days | **No** on Hobby (Pro+) | Zero setup on Vercel; Hobby is non-commercial |
| Cloudflare Web Analytics | Free, no published cap | None | No | Script tag works without proxying through Cloudflare; adds Core Web Vitals |
| Plausible | Cloud from $9/mo (10k pv); self-host free (AGPL) | None | Yes (goals) | Only option here with game funnels (start → clear) |

- Recommendation: Vercel Web Analytics for pageviews/referrers; derive "clears" from
  shares/hashtag counts instead of custom events. Revisit Plausible only if funnel data
  becomes decision-critical. Note `@vercel/analytics` reports from mount — no consent gate
  is needed for cookieless analytics in Japan's hobby context, but document it.

### 5.5 Japanese privacy expectations for a hobby site (flag, not legal advice)

- **電気通信事業法 外部送信規律** (from 2023-06-16): per the MIC guidance (2nd ed., 2024-04)
  as summarised by Mori Hamada, sites run "for one's own needs" to publish one's own
  information are not 電気通信事業 and are outside the rule; MIC's examples of covered
  operators include news/matome sites. A solo free game is probably outside, but this is
  an inference.
- **個人情報保護法**: anyone using a personal-information database "for business"
  (営利・非営利を問わない, no size threshold since 2017) is covered (PPC guidelines/Q&A).
  The game stores nothing personal server-side and uses localStorage only, so exposure is
  minimal.
- Still publish a short **プライバシー・外部送信について** note: localStorage use (save,
  settings, collection), map tiles fetched from `tiles.openfreemap.org` (the visitor's IP
  reaches that host), the analytics provider and what it collects, no cookies, no
  advertising. This matches what users expect and costs nothing.

### Fit for this game (Section 5), ranked by impact/cost

| # | Recommendation | Impact | Cost |
|---|----------------|--------|------|
| 1 | X launch with 15–30 s 地獄旅 clip, URL in reply, reply-heavy follow-up | High | S |
| 2 | Zenn/note making-of article aimed at はてブ (data, MapLibre, deterministic replay, AI-assisted dev) | High | S–M |
| 3 | Press pitch to AUTOMATON / ねとらぼ / GIGAZINE / 窓の杜 with GIF and dev story | Med-High | S |
| 4 | 配信ガイドライン page + press kit | Med | S |
| 5 | Vercel Web Analytics + プライバシー・外部送信 note | Med | S |
| 6 | Staggered timing around year-end holidays | Med | S |
| 7 | Product Hunt / Show HN / portals | Low | S–M (needs English) |

---

## Cross-cutting top picks (impact ÷ cost)

1. OGP/Twitter Card + favicon set — High / S.
2. Two-step onboarding + secondary UI hidden early — High / S.
3. Cross-game station collection + 乗りつぶし overlay — High / M.
4. Honest rarity-tagged lottery with split-flap reveal — High / M.
5. "旅の軌跡" share image + misfortune-celebrating share text — High / M.
6. SVG wordmark + symbol (OFL font, no JR assets) + disclaimer — High / S–M.
7. Milestone juice with a single 演出 setting (reduced motion, sound off by default) — Med-High / S.
8. Seed-replay link for 地獄旅 sharing — Med-High / S–M.
9. Launch sequence: X clip → Zenn/note → press, with 配信ガイドライン — High / S.
10. Daily 「今日の旅」 seed + prediction (or later, real agency) — Med (High with agency) / S–M (L).

## Sources (accessed 2026-10-20)

Engagement and design
- Slate, Wordle creator interview (2022-01): https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html
- Wikipedia, Wordle: https://en.wikipedia.org/wiki/Wordle
- Dinogame, Why Wordle is so popular: https://dinogame.gg/blog/why-is-wordle-so-popular/
- Phrazle, History of Wordle: https://phrazle.co.uk/blog/history-of-wordle/
- Into the Spine, Slay the Spire Daily Climb (2018-03-05): https://intothespine.com/2018/03/05/slay-the-spire-daily-climb/
- Slay the Spire 2 Daily Climb guide (2026): https://bossdown.com/guides/slay-the-spire-2-daily-climb-guide/
- Steam discussion, daily climb scripting: https://steamcommunity.com/app/646570/discussions/0/1697168437880819040/
- UX Magazine, hot-streak design: https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame
- Screenwise, Duolingo streaks and loss aversion: https://screenwiseapp.com/guides/duolingo-streaks-and-anxiety-in-kids
- DEV, Why Duolingo's gamification works: https://dev.to/pocket_linguist/why-duolingos-gamification-works-and-when-it-doesnt-1d4
- Winstanley et al., near-miss and dopamine (Neuropsychopharmacology): https://www.nature.com/articles/npp2010230
- Near-miss effect review (PMC): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7214505/
- GDC Vault, Juice It or Lose It (2012): https://www.gdcvault.com/play/1016487/Juice-It-or-Lose
- Game feel on the web: https://valdemird.com/blog/game-feel-on-the-web/
- canvas-confetti (npm/GitHub): https://www.npmjs.com/package/canvas-confetti , https://github.com/catdad/canvas-confetti
- konfetti.js: https://github.com/andreabettich/konfetti.js
- W3C Understanding SC 2.3.1: https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html
- Chrome autoplay policy: https://developer.chrome.com/blog/autoplay ; Web Audio and games: https://developer.chrome.com/blog/web-audio-autoplay
- MDN BCD issue on iOS vibrate: https://github.com/mdn/browser-compat-data/issues/29166
- Web haptics on iOS 26.5+: https://haptics-web.vercel.app/
- Testmu, Vibration API support: https://www.testmuai.com/learning-hub/vibration-api-browser-support/
- 効果音ラボ 利用規約 / FAQ: https://soundeffect-lab.info/agreement/ , https://soundeffect-lab.info/faq/
- FTUE: https://www.gamedeveloper.com/design/best-practices-for-a-successful-ftue-first-time-user-experience- ; https://www.blog.udonis.co/mobile-marketing/mobile-games/first-time-user-experience ; https://supersonic.com/learn/blog/optimizing-ftue/ ; https://www.iabdi.com/designblog/2026/1/13/g76gpguel0s6q3c9kfzxwpfegqvm4k ; https://mobilegamedoctor.com/2025/05/30/ftue-onboarding-whats-in-a-name/
- MapLibre large-data guide: https://maplibre.org/maplibre-gl-js/docs/guides/large-data/ ; MapOptions: https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/ ; repaint discussion: https://github.com/maplibre/maplibre-gl-js/discussions/3590

Japanese railway games and formats
- AUTOMATON, ネスゴシ (2026-09-10): https://automaton-media.com/articles/newsjp/20260910-466518/
- Famitsu, 駅名Wordle (2022-04): https://www.famitsu.com/news/202204/01256967.html ; 駅すぱあとWordle (2023-02): https://www.famitsu.com/news/202302/22293758.html
- 電撃オンライン, 駅名Wordle: https://dengekionline.com/articles/126071/
- 電車ゲームアプリ ranking 2026: https://m-s-y.com/app/ranking/train-games/
- JR全線制覇マップ: https://www.mach-tools.net/map/jr/
- 鉄道コム, デジタルスタンプラリー column: https://www.tetsudo.com/column/1153/
- PR TIMES, エキタグ公式図鑑 (2025-11): https://prtimes.jp/main/html/rd/p/000000595.000041458.html
- 西園寺 (pixiv百科事典): https://dic.pixiv.net/a/%E8%A5%BF%E5%9C%92%E5%AF%BA(%E9%89%84%E9%81%93%E7%B3%BBYouTuber)
- YouTube, 日本縦断リアルすごろくの旅 day 3 (2025-02): https://www.youtube.com/watch?v=ohurj5-iywk ; 東海道新幹線リアルすごろく: https://www.youtube.com/watch?v=uMdcC30RCxY ; 地獄のサイコロ旅 (2025-11-29): https://www.youtube.com/watch?v=fngZcJXLlGA
- テレ東電鉄 note, 金のサイコロ銀のサイコロ (2025-03-08): https://note.com/dentetsu/n/nfa84cb347e80

Sharing, X, OGP
- X Counting Characters: https://docs.x.com/fundamentals/counting-characters
- PPC Land, X link penalty (2026): https://ppc.land/x-drops-year-old-link-penalty-musk-tells-zuckerberg-on-platform/
- Kompozy, X reach 2026: https://kompozy.io/news/x-algorithm-link-penalty-posting-signals
- Web Share files on iOS (DEV, 2026): https://dev.to/shibowen336/sharing-a-canvas-generated-image-on-ios-with-the-web-share-api-2j0m ; web.dev share files: https://web.dev/articles/files/share-files
- X OGP guide (2026): https://www.samune-ai.jp/blog/twitter-x-ogp-image-tsukurikata ; https://og-image.org/learn/twitter-card-size ; https://bluetraff.com/ogp_thumbnail/ ; https://cocorograph.co/knowledge/og-image-size/
- LINE OGP cache (Zenn): https://zenn.dev/kazuma_horiike/articles/497bd4899e0dd0

Branding and legal flags
- Favicon 2025–2026: https://iconmaker.studio/blog/favicon-best-practices-2025 ; https://faviconbuilder.com/guides/favicon-size-and-dimensions/ ; https://icojoy.com/blog/favicon-strategy-2026-minimal-files-web-manifests/ ; https://www.sammapix.com/blog/favicon-best-practices-2026 ; SVG favicon support: https://faviconbuilder.com/guides/svg-favicon-browser-support/ ; https://www.jwtoolbox.com/blog/svg-favicon-2026-browser-support-dark-mode-guide
- Zen Maru Gothic (OFL): https://github.com/googlefonts/zen-marugothic ; Google Fonts JP overview: https://goodfreefonts.com/3602/
- JR East site rules: https://www.jreast.co.jp/en/site/rules.html/ ; jeki property license: https://www.jeki.co.jp/field/property/ ; 鉄道のまち大宮 logo guideline: https://www.jreast.co.jp/multi/omiya/tetsumachi_omiya/logo/document/guideline.pdf ; JR Central policy: https://jr-central.co.jp/policy/
- 日本の鉄道ラインカラー一覧: https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E9%89%84%E9%81%93%E3%83%A9%E3%82%A4%E3%83%B3%E3%82%AB%E3%83%A9%E3%83%BC%E4%B8%80%E8%A6%A7

Launch, analytics, privacy
- Vercel Web Analytics docs: https://vercel.com/docs/analytics ; pricing/limits: https://vercel.com/docs/analytics/limits-and-pricing ; Hobby plan: https://vercel.com/docs/plans/hobby ; GA blog: https://vercel.com/blog/vercel-web-analytics-is-now-generally-available
- Cloudflare Web Analytics pricing (2026-09): https://rumcost.com/cloudflare-rum-pricing ; cookieless comparison: https://openpanel.dev/articles/cookieless-analytics
- Product Hunt reality (Indie Hackers; DEV 2025–2026): https://www.indiehackers.com/post/what-results-can-you-expect-from-product-hunt-launch-f80d1b139d ; https://dev.to/indiehackerksa/why-product-hunt-no-longer-works-for-indie-founders-aom ; https://builtbyindies.com/blog/7-best-product-hunt-alternatives-for-indie-makers-in-2026
- はてブ hotentry mechanics: https://www.weblab.co.jp/blog/staff/marketing/7896.html ; はてな interview: https://news.yahoo.co.jp/newshack/newshack/hatena_bookmark.html
- Game portals after アツマール: https://zenn.dev/noael_lab/articles/13e235479d581606edb2 ; https://note.com/cass_rpg/n/n1527a12fc287
- 配信ガイドライン template (indie): https://playbridge.jp/articles/game-haisin-guideline ; ITmedia, Capcom guideline (2021-01): https://www.itmedia.co.jp/news/articles/2101/07/news131.html
- 外部送信規律: MIC page https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin_kiritsu.html ; MIC pamphlet (2023-02) https://www.soumu.go.jp/main_content/000862755.pdf ; Mori Hamada guidance summary (2024-04) https://www.morihamada.com/sites/default/files/people/pdf/20240510-035859.pdf
- 個人情報保護委員会 guidelines / Q&A: https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/ ; https://www.ppc.go.jp/personalinfo/faq/APPI_QA/

## Unverified / to check before acting

- Safari's current SVG-favicon behaviour (sources conflict).
- OFL status of Dela Gothic One and M PLUS Rounded 1c at the license-file level.
- Whether 「山手線」 or line-symbol designs are registered marks (J-PlatPat).
- Copyright status of specific 発車メロディ (assumed protected; do not use).
- Press submission routes for 鉄道コム and others; Reddit community rules.
- Any Japan-specific evidence that image shares outperform text shares on X.
