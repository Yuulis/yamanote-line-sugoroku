# Public Launch Readiness Audit

- Date: 2026-10-20. Branch `docs/public-launch-plan` (from develop `82c2e40`).
- Scope: how ready the site (https://yamanote-line-sugoroku.vercel.app) is for
  broad public promotion. Investigation only; no source changed.
- Evidence: source reading, `npm run build`, `vite preview` + Playwright
  Chromium screenshots with **live** OpenFreeMap tiles, `curl` against the
  production deployment (headers, 404 probes, transfer sizes). Prior audits
  reused and cited: `.claude/docs/research/m3-license-terms.md` (licences,
  Vercel Hobby terms), `c1-map-performance-baseline.md`, `c3-accessibility-audit.md`.
- Not done: Lighthouse (not installed locally; skipped rather than pulled from
  the network), real-device testing, link-preview tests inside X/LINE/Discord
  themselves (inferred from the served HTML, which those crawlers read without
  running JS), trademark searches. Nothing here is legal advice.

Tag legend: **[blocker for promotion]** = fix before actively promoting the
link; **[should]** = noticeably hurts first impressions or reach; **[nice]** = polish.

## Screenshots

Directory: `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/f7711c87-aeb5-43c6-99f5-c547ac553170/scratchpad/launch-audit/`
(scratchpad, not committed). Desktop = 1280x800 DPR 1; phone = 390x844 DPR 3,
touch. Driver: `.../scratchpad/shoot.cjs`. Random seeds; both runs happened to be
short games (23 and 21 turns).

| File (prefix `desktop-` / `phone-`) | Content |
|---|---|
| `00-loading.png` | First paint: title card over a grey, tile-less map |
| `01-title.png`, `01-title-full.png` | Title screen with tiles rendered |
| `02-play-turn0.png` | Game screen right after はじめから |
| `03-moving.png` | Mid-move, 2nd roll (normal speed, 450 ms/hop) |
| `04-lottery.png` | Panel right after an arrival lottery ("抽選: …から抽選 → …") |
| `05-play-after-4-rolls.png` | Game screen after 4 rolls |
| `06-clear.png` | Clear screen |

No console errors were logged in either run.

## 1. Branding assets

What exists:
- `index.html` contains only charset, viewport, `<title>山手線すごろく — 東京近郊版</title>`
  and a tile preconnect (`index.html:4-8`). `lang="ja"` is set (`index.html:2`).
- `document.title` is re-set from the edition registry (`src/app/App.tsx:16`).
- `public/` contains only `public/data/` (five data files). There is no favicon,
  no `apple-touch-icon`, no web manifest, no `theme-color`, no logo or wordmark
  image anywhere in the repo.
- Production confirms it: `/favicon.ico`, `/apple-touch-icon.png`,
  `/manifest.webmanifest` all return **404** (probed 2026-10-20). Browsers show
  the generic globe icon in tabs, bookmarks, history and iOS home-screen
  shortcuts; iOS takes a page screenshot as the home-screen icon.
- Title treatment: a plain `<h1>` in the system font, 26 px, centred
  (`src/styles.css:341-345`, `TitleScreen.tsx:146-149`); subtitle 東京近郊版 as
  grey bold text. No logo, mark, illustration or brand colour beyond the
  green primary button (`src/styles.css:35-41`).

Gaps:
- [blocker for promotion] No favicon / app icon at all (404). Every shared tab,
  bookmark and home-screen shortcut looks unfinished. Needs an SVG favicon +
  32 px ICO/PNG + 180 px `apple-touch-icon`.
- [should] No logo/wordmark; the title is unstyled system text. A simple mark
  (e.g. the 山手線 ring + a die pip) would also serve as favicon, OGP image base
  and social avatar.
- [should] No `theme-color` meta (browser chrome on Android/Safari stays default).
- [nice] No web manifest (needed only if PWA install is wanted; see §8).

## 2. Discoverability and share previews

What a crawler receives (`curl /` on production): the 15-line Vite shell —
`<title>` plus an empty `<div id="root">`. There is no `<meta name="description">`,
no Open Graph (`og:title/description/image/url/type/site_name/locale`), no
Twitter card, no canonical link, no structured data, and no `<noscript>` text.
`/robots.txt` and `/sitemap.xml` are 404 (absence of robots.txt means "crawl
everything", so this is not blocking indexing).

What a pasted link shows today (inferred; X, LINE, Discord, Slack and Facebook
scrapers read static HTML and do not run JS):
- X: no card, or at best a bare link titled 「山手線すごろく — 東京近郊版」; no image.
- LINE / Discord / Slack: title only, no description, no thumbnail.
- Google: renders JS, so the title card's rules text can be indexed, but the
  snippet is whatever Google picks; no description to control it.

The A1 share text (`src/features/game/shareText.ts:4-14`) ends with the site URL
(`shareText.ts:5`), so **every shared result inherits this bare preview** —
the feature built to spread the game currently produces the weakest possible
unfurl.

Gaps:
- [blocker for promotion] No OGP / Twitter card tags and no 1200x630 OGP image.
  Static tags in `index.html` are enough (single page, single URL); no SSR needed.
- [blocker for promotion] No `<meta name="description">` (search snippet and the
  description line in LINE/Discord unfurls).
- [should] No canonical URL (`https://yamanote-line-sugoroku.vercel.app/`);
  Vercel also serves preview-deployment URLs that may get shared/indexed.
- [should] The share link is hard-coded to the `vercel.app` host
  (`shareText.ts:5`). Moving to a custom domain later breaks every previously
  shared post's continuity unless the old host redirects; decide the final
  domain before promotion.
- [nice] `robots.txt` + `sitemap.xml` (one URL) — mostly hygiene.
- [nice] `<noscript>` text and JSON-LD (`VideoGame`/`WebApplication`) for richer
  search results.

## 3. Visual design state

Design system as it actually is:
- Colours: hard-coded hex values, no CSS custom properties except z-index layers
  (`src/styles.css:14-19`). Primary green `#2e7d32` (`styles.css:37`), danger red
  `#b71c1c` (`styles.css:546`), warning yellow `#fff3cd`, greys `#555`/`#aaa`;
  marker red `#e53935` (`src/features/map/mapConfig.ts:86`), Yamanote completed
  colour from data (`#9ACD32`). Panels are white 94-96% over the map.
- Typography: system font stack only, no web font loaded
  (`styles.css:9`: `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP"`).
  Map labels use OpenFreeMap's `Noto Sans Regular` glyphs with local TinySDF for
  kanji (`mapConfig.ts:101`). Sizes are ad hoc (11-26 px).
- Components: native `<button>`s with **browser-default grey styling** except
  `.button-primary` (`styles.css:21-25`, `35-41`); card, panel, bottom sheet, native
  `<dialog>` (`styles.css:506-550`), `<details>` disclosures, `<dl>` stat grids.
  Layout is responsive (phone ≤600 px, short-landscape grid at
  `styles.css:740-824`).
- Motion: marker hops along real track geometry via `requestAnimationFrame`
  (`src/features/game/animation/runner.ts:13`, `timeline.ts:22-26`; 300/450/600 ms
  per hop, `src/features/game/gameConfig.ts:28-32`), follow-camera `easeTo`
  (`src/features/map/RailwayMap.tsx:141-142`), completed Yamanote segments turn solid
  green. Reduced motion is honoured (`usePrefersReducedMotion.ts:3`).
  **There is no dice animation or die graphic** — the roll is the number in the
  stats list (`GamePanel.tsx:176-177`) and the button label switches to 移動中…
  (`GamePanel.tsx:186`). **There is no lottery reveal** — the result is one text
  line 「抽選: 品川：6系統から抽選 → 山手線 ／ 外回りに固定」 (`GamePanel.tsx:212-214`;
  see `*-04-lottery.png`). No CSS transitions or keyframes exist in `styles.css`.
- Sound: none (no audio code or assets).
- Dark mode: none (no `prefers-color-scheme` rule; the Liberty basemap is light-only).
- Clear screen: a text card 「クリア！」 with three stats and a paginated history
  (`ClearScreen.tsx:64-125`); no celebration, no overview of the completed loop
  (on desktop the card covers the loop: `desktop-06-clear.png`).

Weak spots a first-time visitor notices (from the screenshots):
1. The title card is a ~315-character, 3-paragraph rules wall containing
   probabilities (「3分の2の確率」「抽選重みが反対方向の2倍」) before the start button
   (`src/features/editions/registry.ts:23-27`; `phone-01-title.png`). Reads like a spec.
2. First paint is a grey void behind the card until tiles arrive
   (`desktop-00-loading.png`); with a single edition the pre-data state is a bare
   「読み込み中…」 text node (`src/app/EditionApp.tsx:54`).
3. The game's core moments — rolling and the station lottery — have no visual
   payoff; a newcomer sees a number change and a sentence.
4. Default grey OS buttons (サイコロを振る, options row) make the panel look like a
   debug form; the main action is not visually dominant (`*-05-play-after-4-rolls.png`).
5. Busy basemap: Liberty shows bilingual district labels (Shibuya/渋谷区), roads
   and shields competing with 134 coloured lines; on phones the station labels
   collide with English place names (`phone-05-play-after-4-rolls.png`).
6. Phone: the expanded MapLibre attribution occupies the top ~10% of the screen
   and the panel ~45%, leaving a narrow map band (`phone-05-*.png`, `phone-04-*.png`).
7. Clear moment is anticlimactic and hides the completed ring (desktop).

Gaps:
- [should] Dice roll animation / die graphic (respecting reduced motion and
  skip, per roadmap §2 A-section constraint).
- [should] Lottery reveal (short roulette or highlight of candidate lines on the
  map) — must not lengthen turns; keep skippable.
- [should] Clear celebration: fit the map to the completed loop behind/beside the
  result, simple confetti/flash, larger turn count.
- [should] Shorten title rules to 2-3 lines ("新橋から山手線を一周するすごろく…") with
  details behind a 「くわしいルール」 disclosure.
- [should] Styled button set (primary/secondary/toggle), consistent radii,
  colour tokens as CSS variables; branded loading state.
- [nice] Sound effects (off by default, toggle).
- [nice] Dark mode (would need a dark basemap; low priority).
- [nice] Global `:focus-visible` ring (C3 K1, still open: only 4 scoped rules, `styles.css:213,479-480`).

## 4. Engagement mechanics present, and constraints for new ones

Present:
- Auto-save after every turn to `localStorage`, one slot per edition
  (`src/features/game/store/persistence.ts:19`, `121`); resume label shows turn and
  station (`TitleScreen.tsx:42-45`).
- Full movement history on the clear screen, 20 per page (`ClearScreen.tsx:24`, `83-104`).
- A1 result sharing: clipboard copy plus Web Share (`ClearScreen.tsx:106-107`,
  `resultShareActions.ts:16-60`), text only: title, turns, moves, transfers,
  `#山手線すごろく`, URL (`shareText.ts:7-14`). Web Share is offered only where
  `navigator.share` exists (mobile, Safari, some desktop Chrome); headless/desktop
  Linux Chromium showed only 結果をコピー.
- Seeded RNG: 128-bit seed from `crypto.getRandomValues` (`src/features/game/seed.ts:6`),
  replay-verified on restore (`src/features/game/engine/save.ts:313`, `345-361`).
- Edition registry (B1) with per-edition save keys (`src/features/editions/registry.ts:7-11`).

Constraints that shape any new mechanic:
- Save format v3 (`engine/game.ts:23`) and `rulesetVersion: "tokyo-suburban-1"`
  (`gameConfig.ts:15`): any rule change needs a new ruleset id; old saves are
  rejected, never migrated (`persistence.ts:51-57`).
- A data update changes `dataVersion` and invalidates every in-progress save
  (`save.ts:361`, message 「路線データが更新されたため…」 `persistence.ts:54`). After a
  promotion push, shipping a data fix would wipe players' running games.
- Static site only; accounts, online ranking, server saves are out of scope
  (roadmap `docs/manual/development-roadmap/proposal.md:132`).
- Seeds enable server-free mechanics: a "daily seed" (date-derived seed, everyone
  plays the same dice) and "challenge this seed" links are possible without a
  server, but a seed-in-URL changes the A1 decision (`proposal.md:43`: 「まずシード
  再生リンクは含めない」) and needs a seed-source contract (today seeds only come from
  the CSPRNG).

Gaps:
- [should] Shared results are text only; no image (result card) that renders well
  on X/Instagram/LINE. Could be generated client-side with `<canvas>` (map ring
  + turns) and shared via Web Share `files` where supported.
- [should] No reason to come back: no personal best / history (A2), no daily
  challenge. A daily seed is the cheapest server-free hook and fits the seeded
  engine; requires a design decision on seed derivation and save keying.
- [should] Data-update policy before promotion: a data fix silently ends every
  running game. Decide freeze period or per-dataVersion save retention (roadmap §4).
- [nice] Turns are reported without comparison context ("中央値55ターン" or rank vs
  the 5,000-game simulation) — static percentile table gives meaning to the number.

## 5. First-time UX

- Path to first roll: page → title card → はじめから → サイコロを振る = **2 clicks**.
  The start button is rendered as soon as data loads, before the map
  (`desktop` local run: title button at ~1.9 s; C1 mobile-throttled profile: title
  in DOM ~2.0 s, railway lines ~2.5 s, fully rendered ~6.8 s, TBT ~3.7 s —
  `c1-map-performance-baseline.md` "C1 implementation result").
- Rules: ~315 Japanese characters in 3 paragraphs (`registry.ts:23-27`), mixing the
  goal with lottery probability details. The goal (山手線外回り30区間を踏破→新橋) is
  stated twice; what the player *does* (just press the die) is never said.
- Is the goal understandable? Partly. The panel shows 踏破区間 n/30 and the legend
  explains solid vs dashed Yamanote line, which works once play starts. But the
  player has no agency (no choices: lotteries are automatic), and this is not
  said up front, so newcomers may look for decisions.
- Game length: median 55 turns, p90 146, p99 261, max 446 (5,000 seeds,
  `docs/manual/tokyo-suburban/implementation-status.md:18`); 3.26 hops per turn.
  Estimate (not measured with users): ~1.5 s animation at normal speed + ~2-3 s
  reading/clicking per turn ⇒ **median ~4-5 min, p90 ~10-12 min, p99 ~20 min**.
  The long tail is a zero-agency click loop; there is no "auto-roll".

Gaps:
- [should] Rewrite the title copy: one-line hook + "サイコロを振るだけ。路線は自動で
  抽選されます" + expandable detailed rules.
- [should] Auto-roll / fast-forward option for long games (reduce the p90 tail
  fatigue); must stay deterministic (it only presses the same button).
- [nice] One-time onboarding hint on turn 0 pointing at the die and the 0/30 counter.
- [nice] Show expected length ("平均5分前後") on the title once measured with real plays.

## 6. Legal / attribution

Present (verified in code and screenshots):
- Railway data credit 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成, linked to
  the MLIT dataset page, CC BY 4.0 linked, base date (`TitleScreen.tsx:87-133`;
  map control via `src/features/map/attribution.ts:151-156`, `RailwayMap.tsx:229`).
- Background map: OpenFreeMap / © OpenMapTiles / © OpenStreetMap contributors
  (`mapConfig.ts:23-27`) on title and in the map control.
- Bundled library licences file (`vite.config.ts:33`), linked from the title
  (`TitleScreen.tsx:126-127`). Repo is MIT (`LICENSE`).
- Privacy: no analytics, no cookies, no third-party scripts in the bundle
  (grep for analytics/gtag/sentry/cookie: none). Storage is `localStorage` for the
  save only. Third-party requests: OpenFreeMap tiles/style/glyphs (the visitor's IP
  reaches OpenFreeMap) and Vercel itself.

Gaps:
- [should] Unofficial disclaimer is missing from the UI. README has
  「東日本旅客鉄道株式会社および国土交通省とは関係のない、非公式のファンメイド作品です」
  (`README.md:89`) and older manuals have it, but the title credits do not
  (`TitleScreen.tsx:87-133`). For broad promotion this matters (MLIT terms forbid
  implying government authorship; avoids implied JR East endorsement). Should now
  name all 15 operators generically ("各鉄道事業者").
- [should] Trademark / trade-dress flag (not legal advice, unverified):
  「山手線」 in the product title, operator names in data, and colours approximating
  official line colours (e.g. 山手線 `#9ACD32`). No logos, line symbols (e.g. Tokyo
  Metro circle marks), train imagery or signage are used — keep it that way in the
  new logo/OGP image. Whether 「山手線」 is registered for games (classes 9/28/41) was
  not searched (J-PlatPat) — worth a check before branding the logo around it.
- [should] A short privacy note (「アクセス解析なし・Cookieなし・セーブは端末内のみ。地図
  表示のためOpenFreeMapに接続します」). Not strictly required in Japan when no
  personal information is collected (APPI) — but becomes required once analytics
  are added (§7), together with the 電気通信事業法 external-transmission notice
  (外部送信規律) if the operator is in scope. Decide analytics first, then write
  the note once.
- [should] Contact route: none in the UI. A link to GitHub Issues (or a form/X
  account) is expected for bug reports and takedown requests from rights holders.
- [nice] Vercel Hobby is non-commercial only (m3 audit §4): ads, paid tiers or
  sponsorship would require Pro. Donations are allowed. Decide before promotion.
- [nice] OpenFreeMap has no SLA and asks heavy users to self-host or sponsor;
  a traffic spike shifts load to them (m3 audit §2).

## 7. Operations

- Analytics: none. Error monitoring: none (no `window.onerror`/
  `unhandledrejection` reporter, no error boundary; map failures only
  `console.warn`, `RailwayMap.tsx:172`). After promotion there will be no signal on
  visits, completion rate, share usage, or real-device failures (WebGL missing,
  iOS Safari).
- Caching (production, 2026-10-20): every file including hashed
  `/assets/index-*.js` is `cache-control: public, max-age=0, must-revalidate`;
  no `vercel.json` exists. Data files are revalidated too (correct for unhashed
  data). Repeat visits cost one 304 round-trip per asset.
- Transfer per cold visit (production, brotli as served): JS 379 KB + worker
  ~145 KB + CSS 13 KB + data 435 KB (geojson 275 KB) ≈ **~0.97 MB, ~10 Vercel
  requests**, plus OpenFreeMap tiles (not Vercel). Vercel Hobby quotas (100 GB
  transfer, 1 M CDN requests / month, m3 audit §4) ⇒ roughly 100 k cold visits per
  month; exceeding Hobby limits can suspend the feature for up to 30 days —
  a real risk if a post goes viral.
- Bundle: `npm run build` (2026-10-20) still warns: main chunk 1,333 KB (374 KB
  gzip), worker 510 KB, CSS 93 KB. MapLibre is statically imported and its shared
  code is duplicated in the worker (~140 KB gzip, C1 report).
- Lighthouse: not run (not installed; skipped). Locally detectable issues an
  audit would flag: missing meta description, missing favicon/manifest/
  theme-color, large unused JS on first paint, TBT ~3.7 s on mobile profile, no
  long-cache headers.

Gaps:
- [blocker for promotion] No visibility at all: add privacy-friendly, cookieless
  analytics (Vercel Web Analytics, or Cloudflare/Plausible-class) with a few
  custom events (start, clear, share). Without it the promotion cannot be judged.
- [should] Client error reporting (even a minimal `onerror` → analytics event,
  or Sentry free tier) — real-device WebGL/Safari failures are otherwise invisible.
- [should] Traffic-spike plan: know the Hobby quota numbers, set a usage alert,
  and decide whether to move to Pro or another static host if a post takes off.
- [should] `vercel.json` with `immutable, max-age=31536000` for `/assets/*`
  (keep `/data/*` revalidating; m3 audit §4 has the snippet).
- [nice] Code-split/lazy-load MapLibre and remove the worker duplication (C1 next
  step; roadmap §7 item 2).

## 8. Mobile

- PWA: not installable (no manifest, no service worker, no icons). "Add to Home
  Screen" on iOS yields a screenshot icon and a browser-chrome window.
- Offline: none; the game needs Vercel for data and OpenFreeMap for tiles. The
  game can continue without the map (map-failure banner path, `map-error` in
  `styles.css:76-91`), but not without data.
- Orientation: portrait phone layout (`styles.css:554-628`) and a dedicated
  short-landscape grid (`styles.css:738-824`, from C3 M1). Works, verified by C3;
  not re-tested here on devices.
- Performance (C1, software GL, Pixel-7-class profile with 4x CPU throttle and
  Fast-4G, live tiles): railway lines visible at ~2.5 s (was 5.5 s), fully rendered
  ~6.8 s, TBT ~3.7 s; pan/move ~5 fps under software GL (basemap-bound; real GPUs
  should be far better, unverified). Real-device check is still the open item in
  roadmap §7 #1.
- Phone layout cost: expanded attribution at top + 45%-height panel leave a narrow
  map band (`phone-05-play-after-4-rolls.png`); C3 M3 notes clipping at 320 px.

Gaps:
- [should] Real-device smoke test on iPhone Safari and a mid-range Android before
  promotion (roadmap §7 #1, still open): load time, landscape, share sheet, save.
- [should] Collapse the map attribution by default on phones after first show,
  to free the top of the map (keep it reachable — spec §6.2).
- [nice] Installable PWA (manifest + icons; optional service worker caching the
  app shell and the five data files keyed by `dataVersion`). Offline tiles are
  out of reach; offline play would need a "map unavailable" mode, which exists.
- [nice] Lighter basemap option (roadmap §7: main cause of pan/zoom cost; visual
  change needs the user's decision).

## Ranked top gaps (cross-section)

1. [blocker] OGP/Twitter card tags + OGP image + meta description (§2) — every
   shared link and A1 result unfurls as a bare title.
2. [blocker] Favicon / apple-touch-icon / theme-color (§1).
3. [blocker] Cookieless analytics with start/clear/share events (§7).
4. [should] Title copy: short hook, "just roll", rules behind a disclosure (§3, §5).
5. [should] Dice + lottery reveal + clear celebration visuals (§3).
6. [should] UI disclaimer, contact link, short privacy note (§6).
7. [should] Final domain decision before promotion; share URL is hard-coded (§2).
8. [should] Result image card for sharing (§4).
9. [should] Real-device smoke test, error reporting, traffic-spike/quota plan (§7, §8).
10. [should] Data-update/save policy during promotion (§4); daily-seed mode as the
    cheapest server-free retention hook (needs design decision).
