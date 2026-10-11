# M3 License, Attribution and Free-Tier Audit

- Date: 2026-10-11 (sources fetched the same day)
- Scope: spec §0.3 item 5, §6.2 ("著作権表示・帰属表示は常に確認可能"), §9 M3, §12
- Branch audited: `feature/m3-quality-release` @ 16143e8 (code), live site
  https://yamanote-line-sugoroku.vercel.app/ (headers and bundle)
- Not legal advice. Each requirement quotes the primary source; the audit
  maps it onto the code.

## 0. Summary

| # | Requirement | Status | Fix |
|---|-------------|--------|-----|
| 1a | N02 credit + "processed" statement (MLIT terms) | OK | – |
| 1b | Hyperlink to CC BY 4.0 licence (CC BY §3(a)(1)(C)) | GAP | Link "CC BY 4.0" to the licence in map + title credits + data/README |
| 1c | URI to source dataset "to the extent reasonably practicable" | OK on title screen / GAP-minor in map | Make the in-map credit a link to the dataset page |
| 1d | Redistribution of processed subset in public repo / site | OK | (nice) LICENSE/NOTICE for the data |
| 2a | OpenFreeMap attribution (auto via MapLibre) | OK | – |
| 2b | OpenFreeMap ToS (no scraping, ≥18 integrator, no SLA) | OK / UNVERIFIED (age) | Owner confirms ≥18; stub tiles in E2E |
| 3 | OSM ODbL credit, visibility, collapse rules | OK (desktop/phone at load) | – |
| 3b | Credit "always checkable" after resize/rotation (spec §6.2) | GAP | Re-place attribution control on media-query change |
| 4 | Vercel Hobby: non-commercial, quotas | OK | (nice) immutable cache headers for `/assets/*` |
| 4b | Production deployment is the M0 build | INFO | Release = merge to `master` and redeploy, then re-run checks |
| 5a | MapLibre GL JS BSD-3 notice in "binary" redistribution | GAP | Emit bundled-licence file (Vite `build.license`) and link it |
| 5b | React / other MIT/ISC deps notices | GAP (same fix) | Same file |
| 5c | Noto Sans glyphs (OFL 1.1), Liberty style design (CC BY 4.0) | OK | Served by OpenFreeMap; credited via "© OpenMapTiles" |
| 6 | Original-work: no borrowed title/characters/text | OK (flag only) | (nice) "not affiliated with JR East" line; trademark check UNVERIFIED |

Release blockers (strict reading, all small): 1b, 5a/5b, and redeploying
the M3 build (4b). Should-fix: 3b. Nice-to-have: 1c (map link), 1d, 2b E2E
stubbing, 4 cache headers, 6 disclaimer, attribution-button size.

---

## 1. 国土数値情報 鉄道データ N02 (2025)

### Sources and quoted clauses

Dataset page — https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html

> このデータの使用許諾条件
> 2020年（令和2年）以降：オープンデータ（CC_BY_4.0）
> 上記以外：商用可

> 原典資料 国土地理院「数値地図25000（空間データ基盤）」「電子地形図（タイル）」
> （株）電気車研究会・鉄道図書刊行会「鉄道要覧」（国土交通省鉄道局監修） 各鉄道事業者の公式HP等
> この地図の作成にあたっては、国土地理院がウェブ公開している電子地形図（タイル）を使用しました。

The "使用許諾条件" link goes to the government-standard terms —
https://nlftp.mlit.go.jp/ksj/other/agreement_01.html
(国土数値情報ダウンロードサイトコンテンツ利用規約（政府標準利用規約準拠版）, 制定 令和2年4月1日):

> どなたでも以下の１）～６）に従って、複製、公衆送信、翻訳・変形等の翻案等、自由に利用できます。商用利用も可能です。

> イ　コンテンツを編集・加工して利用する場合は、上記出典とは別に、編集・加工等を行ったことを記載してください。なお、編集・加工した情報を、あたかも国（又は府省等）が作成したかのような態様で公表・利用してはいけません。
> （コンテンツを編集・加工等して利用する場合の記載例）
> 「国土数値情報（○○データ）」（国土交通省）（当該ページのURL）を加工して作成

> ウ　本利用ルールは、クリエイティブ・コモンズ・ライセンスの表示4.0国際（…）と互換性があり、本利用ルールが適用されるコンテンツはCCBYに従うことでも利用することができます。

The site-wide terms page https://nlftp.mlit.go.jp/ksj/other/agreement.html
was revised (施行 2026-03-23) to the Public Data License:

> 権利表記の記載がない限り（「公共データ利用規約（第1.0版）」（PDL1.0）が適用されています。

> コンテンツを編集・加工等して利用する場合は、以下の出典とは別に、利用したコンテンツの名称及び編集・加工等を行ったことを記載してください。

PDL 1.0 — https://www.digital.go.jp/resources/open_data/public_data_license_v1.0

> URLリンクが使える場合は（）内のURLは該当する文言からリンクを張る形にすることもできます。
> （出典記載例）出典：D庁ウェブサイト（当該ページのURL）、PDL1.0（規約原文ページのURL）

> 本利用ルールは、クリエイティブ・コモンズ・ライセンスの表示4.0　国際ライセンスに規定される著作権利用許諾条件（以下「CC BY」といいます。）と互換性があります。…利用者がCC BYに従って利用することを許諾します。

CC BY 4.0 legal code — https://creativecommons.org/licenses/by/4.0/legalcode.en §3(a)(1):

> retain … identification of the creator(s) … a copyright notice; a notice that refers to this Public License; a notice that refers to the disclaimer of warranties; a URI or hyperlink to the Licensed Material to the extent reasonably practicable;
> indicate if You modified the Licensed Material …; and
> indicate the Licensed Material is licensed under this Public License, and include the text of, or the URI or hyperlink to, this Public License.

§3(a)(2):

> You may satisfy the conditions in Section 3(a)(1) in any reasonable manner based on the medium, means, and context … it may be reasonable to satisfy the conditions by providing a URI or hyperlink to a resource that includes the required information.

Note on the dataset metadata: `N02-25_GML/KS-META-N02-25.xml` still says
`利用に当たっての制限は、国土情報利用約款を参照してください。` (legacy wording).
The dataset page's current licence label (CC BY 4.0, linked to the
government-standard terms) is the operative statement; both current terms
are CC BY-compatible, so complying with CC BY 4.0 satisfies every path.

### Interpretation

- Any of the three paths (政府標準利用規約 2.0, PDL 1.0, CC BY 4.0) permits
  copying, public transmission and adaptation, including commercial use.
  Redistributing the processed subset (`public/data/*.json`, the public
  GitHub repo, the tracked `KS-META` XML/XSD) is allowed with attribution.
- Required: creator credit (国土交通省), dataset name, statement that it was
  processed, no implication that MLIT made it. The current wording
  「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 matches the
  official example verbatim except for the URL.
- URL: the examples include （当該ページのURL）; PDL allows a hyperlink
  instead. CC BY wants a URI to the material "to the extent reasonably
  practicable" and a URI/hyperlink to the licence (no "practicable" softener).
- 原典表示 sentence about 国土地理院 tiles: MLIT's own provenance note.
  GSI is part of 国, not a 第三者 under 2)ア, so downstream repetition is not
  required. UNVERIFIED as a hard requirement; optional to add.

### Audit

| Location | Current | Status |
|----------|---------|--------|
| `public/data/manifest.json` `source` | name, url, `license: "CC BY 4.0"`, attribution string | OK |
| Map control (`RailwayMap.tsx` → `buildDataAttribution`) | `「国土数値情報（鉄道データ）」（国土交通省）を加工して作成（CC BY 4.0）` — plain text, no links | Credit OK; licence link missing; dataset link missing |
| Title screen `Credits` (`TitleScreen.tsx`) | attribution text linked to dataset page, `（CC BY 4.0、基準日 2025-12-31）` plain text | Dataset link OK; licence link missing |
| `data/README.md` | dataset, page URL, "CC BY 4.0", attribution | Licence not linked (minor) |
| Repo root | no LICENSE / NOTICE | No obligation; nice-to-have |
| Fallback | if `manifest.json` fails but stations/segments load, the map shows N02 geometry with no data credit | Edge case, nice-to-have |

### Fixes

1. `public/data/manifest.json` (via `data/overrides/service.json` / pipeline
   `scripts/data_pipeline/export.py`): add `"licenseUrl":
   "https://creativecommons.org/licenses/by/4.0/deed.ja"` (and type/guard in
   `src/types/data.ts`, `src/data/guards.ts`). Or, smaller: a constant in
   `src/features/map/attribution.ts`.
2. `src/features/map/attribution.ts` `buildDataAttribution`: emit
   `<a href="{dataset url}" target="_blank" rel="noopener">{attribution}</a>（<a href="{licence url}" …>CC BY 4.0</a>）`,
   URLs passed through `safeExternalUrl` and `escapeHtml` (MapLibre runs
   `DOM.sanitize` on attribution HTML, anchors survive). Update
   `tests/unit/map-helpers.test.ts`.
3. `src/features/game/components/TitleScreen.tsx` `Credits`: wrap
   `manifest.source.license` in an anchor to the licence URL.
4. `data/README.md`: link "CC BY 4.0" to the licence. Optionally a root
   `README.md` "出典・ライセンス" section stating code vs data licensing.
5. Optional: hard-coded fallback attribution in `attribution.ts` used when the
   manifest fails to load.

## 2. OpenFreeMap

Home/FAQ — https://openfreemap.org/

> Using our public instance is completely free: there are no limits on the number of map views or requests. There’s no registration, no user database, no API keys, and no cookies.

> Is commercial usage allowed? Yes.

> Attribution is required. If you are using MapLibre, they are automatically added, you have nothing to do.
> If you are using alternative clients, or if you are using this in printed media or video, you must add the following attribution:
> OpenFreeMap © OpenMapTiles Data from OpenStreetMap
> You do not need to display the OpenFreeMap part, but it is nice if you do.

> At the moment, I don’t offer SLA guarantees or personalized support.

ToS — https://openfreemap.org/tos/ (Last Updated: September 9, 2026)

> You must be at least 18 years old and legally able to enter into this Agreement to integrate our public service into a website or application.
> … Websites and applications using OpenFreeMap may serve users of any age.

> You will not: Use it for illegal activities / Disrupt the service or introduce harmful code / Violate intellectual property rights / Attempt to collect data from the service in automated ways without permission

> We aim to maintain the Site’s availability but may discontinue it at any time without notice.

> By using the Site, you consent to Cloudflare’s processing of your requests.

Privacy — https://openfreemap.org/privacy/ (Last Updated: October 8, 2026):
"This policy also covers our public tile service at https://tiles.openfreemap.org, including when our maps are embedded in other websites or apps." Access logs contain no IP by default. No obligation on integrators.

Caching: neither page states a caching rule. Observed headers (2026-10-11):
style `cache-control: public, max-age=86400`; versioned tiles
`/planet/20261004_113936_pt/...` `max-age=315360000`; glyphs `max-age=604800`.
Browser caching via MapLibre is therefore the provider's own policy; no
app-side tile caching/prefetch exists or is needed.

TileJSON `https://tiles.openfreemap.org/planet` attribution (verified):

```
<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>
```

### Audit

- `RailwayMap.tsx` sets `attributionControl: false` and adds its own
  `AttributionControl({ compact: true, customAttribution })`. MapLibre
  6.11.2 `_updateAttributions()` still appends every used source's
  `attribution` (checked in `node_modules/maplibre-gl/src/ui/control/attribution_control.ts`),
  so the OpenFreeMap/OpenMapTiles/OSM credit is shown. OK.
- Title screen lists OpenFreeMap / © OpenMapTiles / © OpenStreetMap
  contributors with links (`MAP_CREDITS`). OK.
- Load: one style + normal tile traffic per player, zoom 9–17; no scraping,
  no prefetch. OK. Planned M3 E2E tests should stub `tiles.openfreemap.org`
  (Playwright `route`) so CI does not generate automated traffic — nice-to-have.
- Resilience to discontinuation: style failure shows `map-error` with retry
  and the game panel stays usable. OK.
- Eligibility (≥18 for the integrator): UNVERIFIED — owner to confirm.

## 3. OpenStreetMap (ODbL)

https://www.openstreetmap.org/copyright

> Where you use OpenStreetMap data, you are required to do the following two things:
> Provide credit to OpenStreetMap by displaying our attribution notice.
> Make clear that the data is available under the Open Database License.
> … you may link to this copyright page.

Attribution Guidelines — https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
(adopted 2021-06-25, page last edited 10 September 2026):

> Attribution must be presented to anyone who uses, views, accesses, interacts with, or is otherwise exposed to the map or produced work. The attribution format should not require individuals to interact with the map or produced work to see the attribution.

> This may be done by making the text “OpenStreetMap” a link to openstreetmap.org/copyright …

> For a browsable map … the credit should typically appear in a corner of the map. While the lower right corner is traditional, any corner of the map is acceptable.
> You may use a mechanism to fade/collapse the attribution under certain conditions: immediately with a dismiss interaction … automatically on map interaction such as panning, clicking, or zooming … automatically after five seconds.
> If the attribution has been collapsed, the user must still be able to find the licence information if they look for it, for example from an ‘(i)’ button in the corner of the map …

> The text must be easily readable and understandable, taking into consideration the font, size, colour, contrast, positioning and amount of time that it is visible. We recommend you follow accessibility guidelines such as WCAG …

> For video or computer games, attribution can be provided either by a splash screen on application startup, in the game view, during gameplay, on the credits page, in the menu, or in another suitable location.

### Audit

- Text: "OpenStreetMap" linked to `/copyright` (TileJSON). OK.
- Collapse behaviour (MapLibre 6.11.2 source): with `compact: true` the
  control is created `open` with `maplibregl-compact-show` (expanded) and
  collapses only on the map `drag` event; an "(i)" `<summary>` button stays.
  This matches the "collapse on map interaction" + "(i) button" safe harbour.
  Programmatic follow (`easeTo`/`jumpTo`) does not fire `drag`. OK.
- Position: desktop bottom-right (game panel is bottom-left); phone
  (`(max-width: 600px)` at mount) top-left with `max-width: calc(100vw - 80px)`.
  Corner placement OK. Title screen credits additionally satisfy the
  "credits page / menu" route for games.
- "i" button is 24×24 CSS px (`.maplibregl-ctrl-attrib-button`). Meets WCAG
  2.2 SC 2.5.8 minimum (24 px) exactly, below the 44 px used for the zoom
  buttons. Nice-to-have: enlarge to 44 px under the phone media query in
  `src/styles.css`.
- GAP (spec §6.2 "常に確認可能"): the corner is chosen once in the mount
  effect via `isPhoneWidth()`. A page loaded wider than 600 px (e.g. phone in
  landscape, tablet, resized desktop) and then narrowed keeps the control at
  bottom-right, where the full-width phone `.game-panel` (fixed, z-index 10,
  `bottom: 8px`) covers it. Legally still mitigated by the title-screen
  credits, but it breaks the spec. Fix in `src/features/map/RailwayMap.tsx`:
  subscribe to `matchMedia(PHONE_MEDIA_QUERY)` `change`, and
  `map.removeControl(ctrl)` / `map.addControl(ctrl, newPosition)` (or always
  use `top-left` on every width). Add a manual check at 600–900 px widths
  that the expanded desktop attribution does not slide under the 260 px
  game panel (UNVERIFIED visually).
- Minor: `.data-error-banner` (top-centre, z-index 40) can overlap the
  phone top-left attribution while a data error is shown. Acceptable.

## 4. Vercel Hobby

https://vercel.com/docs/plans/hobby (Last updated September 14, 2026)

> The Hobby plan is free and aimed at developers with personal projects, and small-scale applications.

> Fast Data Transfer First 100 GB · Fast Origin Transfer First 10 GB · CDN Requests First 1,000,000 · Function Invocations First 1,000,000 · Deployments per day 100

> In most cases, if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again.

> As stated in the fair use guidelines, the Hobby plan restricts users to non-commercial, personal use only.

https://vercel.com/docs/limits/fair-use-guidelines (Last updated September 14, 2026)

> Examples of fair use: Static sites … Single page applications …
> Never fair use: Proxies and VPNs / Media hosting for hot-linking / Scrapers / Crypto Mining …

> Hobby teams are restricted to non-commercial personal use only. … Commercial usage is defined as any Deployment that is used for the purpose of financial gain … Examples …: Any method of requesting or processing payment from visitors …; The inclusion of advertisements …
> Asking for Donations does not fall under commercial usage.

### Audit

- Non-commercial personal static SPA, no ads/payments/functions. OK.
- Measured live transfer per cold visit (brotli): JS 354,768 B, worker
  146,668 B, CSS 10,509 B, data ≈ 5.5 KB, HTML < 1 KB → ≈ 0.52 MB, ~9 CDN
  requests. Budget: 100 GB ≈ 190k cold visits/month; 1M CDN requests ≈
  110k visits/month (the binding limit). Tiles are not served by Vercel.
  Comfortable for a personal project.
- Live headers: every file, including hashed `/assets/*`, is
  `cache-control: public, max-age=0, must-revalidate` (Vercel static
  default), so repeat visits revalidate each asset (cheap 304s, but each is a
  CDN request). Nice-to-have `vercel.json` at repo root:

  ```json
  {
    "headers": [
      { "source": "/assets/(.*)",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
    ]
  }
  ```

  Keep `/data/*.json` on the default revalidating policy: the filenames are
  not content-hashed, and a stale `manifest.dataVersion` would invalidate
  saves (`路線データが更新されたため…`). A short `max-age=300` is possible
  but not needed.
- INFO: production (`master` = `e934390`, M0 release) serves the M0 spike
  bundle: the live `index-DG3A7u7g.js` contains no title screen, no
  「出典・ライセンス」 section and no data credits beyond the map control.
  Public release = merge M3 to `master` and redeploy; re-run this audit's
  live checks (attribution visible, links work) on the new deployment.

## 5. Third-party software and fonts

MapLibre GL JS — `node_modules/maplibre-gl/LICENSE.txt` (BSD-3-Clause,
"Copyright (c) 2023, MapLibre contributors", also bundles Mapbox GL JS ≤1.13
BSD-3 and glfx.js MIT notices):

> Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

Runtime deps (package-lock, non-dev): react, react-dom, scheduler (MIT);
maplibre-gl's own deps (BSD-2/3, ISC, MIT) are already inside its dist
bundle and covered by its LICENSE.txt. MIT requires "The above copyright
notice and this permission notice shall be included in all copies or
substantial portions of the Software."

Audit: live `index-*.js` has no `@license` comment (0 matches; Vite/Oxc
minifier drops them); the worker keeps only
`@license 3-Clause BSD. Full text of license: https://github.com/maplibre/maplibre-gl-js/blob/v6.11.2/LICENSE.txt`
(a URL, not the notice text). No notices file is shipped. GAP.

Fix: `vite.config.ts` → `build: { license: { fileName: "third-party-licenses.md" } }`
(Vite 8.3.1 option, typed in `node_modules/vite/dist/node/index.d.ts`:
"Whether to emit a `.vite/license.md` file that includes all bundled
dependencies' licenses"; the default path is under a dot-directory, so set
`fileName` to land at the site root). Link it from `TitleScreen` `Credits`
("使用ソフトウェアのライセンス"). Verify after build that maplibre-gl,
react, react-dom and scheduler appear.

Fonts / style (served by OpenFreeMap, not bundled by us):
- https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md:
  "Noto Sans is released under the SIL Open Font License, Version 1.1";
  Liberty: "OSM Liberty is a fork of OSM Bright … design is released under
  CC BY 4.0"; OpenMapTiles "design under CC BY 4.0"; Natural Earth "public
  domain"; Maki icons CC0.
- https://github.com/maputnik/osm-liberty/blob/gh-pages/LICENSE.md:
  "The products or services using this map style need to visibly credit
  "OpenMapTiles.org" or reference "OpenMapTiles" with a link to
  http://openmaptiles.org/." → satisfied by the TileJSON "© OpenMapTiles"
  link and `MAP_CREDITS`. OK.
- The app's own label layer uses `LABEL_FONT = ["Noto Sans Regular"]` from
  the same glyph endpoint. OFL permits use; no notice obligation when merely
  rendering remotely served glyphs. OK.

## 6. Original-work concern (flag only)

Spec §1.1: "原作の題名、キャラクター、イラスト、セリフ、指令カード等を使用しない".
All user-visible strings in `src/**/*.ts(x)` were listed and reviewed:
title 「山手線すごろく」 (user-decided, DESIGN.md), rules text in
`TitleScreen.tsx`, `GamePanel.tsx`, `ClearScreen.tsx`, dialogs and save
messages are functional/generic. No character names, catchphrases, card
mechanics or other work's title found. The credits say
「本作品は既存作品から着想を得た独立したオリジナルゲームです。」 without
naming the work. Nothing flagged.

Related, not legal judgement:
- 「山手線」, station names, operator 東日本旅客鉄道 (in
  `public/data/services.json`) and the line colour `#9ACD32` are factual
  references. Whether JR East holds a relevant trademark for 「山手線」 in
  game classes (9/28/41) is UNVERIFIED (J-PlatPat not searched; secondary
  sources found nothing). No logos, train imagery or station signage are
  used.
- Nice-to-have: add 「東日本旅客鉄道株式会社および国土交通省とは関係のない
  非公式の個人制作です。」 to the title-screen credits; this also addresses
  the MLIT clause against implying government authorship.

## 7. Fix checklist (file → change)

Blockers (strict licence reading):
- [ ] `src/features/map/attribution.ts` + `TitleScreen.tsx` + `data/README.md`:
      hyperlink "CC BY 4.0" to https://creativecommons.org/licenses/by/4.0/deed.ja
      (and dataset link inside the map attribution).
- [ ] `vite.config.ts`: `build.license.fileName`; `TitleScreen.tsx`: link to it.
- [ ] Deploy the M3 build to production and re-verify on the live URL.

Should fix:
- [ ] `src/features/map/RailwayMap.tsx`: move the attribution control on
      `matchMedia(PHONE_MEDIA_QUERY)` change (spec §6.2).

Nice-to-have:
- [ ] `vercel.json`: immutable cache for `/assets/(.*)`.
- [ ] `src/styles.css`: 44 px attribution button on phones.
- [ ] Title-screen "unofficial / not affiliated" line.
- [ ] Root README "出典・ライセンス" section; decide a code LICENSE (owner).
- [ ] Fallback data credit when `manifest.json` fails.
- [ ] Stub OpenFreeMap requests in E2E tests.

## 8. Unverified items

- JR East trademark scope for 「山手線」 (J-PlatPat search needed).
- Integrator age requirement (OpenFreeMap ToS ≥18) — owner confirmation.
- Visual overlap of the expanded desktop attribution with the game panel at
  600–900 px widths — manual check on the M3 build.
- Whether the 国土地理院 原典表示 sentence must be carried downstream
  (reading of the terms says no; not confirmed with MLIT).
