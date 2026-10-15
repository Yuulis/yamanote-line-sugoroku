# JR East capital-region live dataset — S6 evidence

Date: 2026-10-15  
Branch: `feature/jrcr-s6`  
Scope: final data integration and edition copy; no changes to `scripts/`, engine behavior, or UI behavior.

## Product catalogue and live contract

`data/overrides/expected-catalog.json` was generated from the approved product catalog CSV only. It contains the 40 services and 472 station IDs in product order. Its SHA-256 is
`42bcd19b8407c6d80d45622f0589268b2b0dc7970fdd63fc6f3cc7352ba2a231`, pinned in
`data/overrides/dataset.json`. An independent reconstruction from
`.claude/docs/research/jr-east-capital-region-product-catalog.csv` matches the JSON byte-for-byte. All 67 shipped station IDs and all 5 shipped service IDs remain present.

The live dataset is `gameplay`, covers 東京都・千葉県・神奈川県・埼玉県, uses
`targetServiceId: jr-yamanote`, `startStationId: shimbashi`,
`budgetProfile: capital-region`, and `simplifyToleranceM: 1`. Service `kind` and
stop order match the approved product services/catalog CSVs. The Yamanote target,
start station, and all-equal game lottery values remain unchanged; the rule set is
still `local: 1`, `rapid: 1`, target weight `1`, and toward-target direction weight
`1`.

## Dataset and geometry metrics

| Measure | Result |
|---|---:|
| Services / shared stations | 40 / 472 |
| Directed gameplay segments | 1,224 |
| Owned GeoJSON primitives / flattened references | 568 / 1,230 |
| Maximum primitive chain | 3 |
| Stations served by 2 or more services | 121 |
| Reachability from 新橋 | 472/472 reachable from 新橋 and 472/472 can return |
| Maximum endpoint distance | 130.956 m (常磐線快速 上野 transfer) |
| Maximum platform offset | 393.4 m (南武線 武蔵小杉 exception) |
| Maximum measured detour ratio | 1.964 (below the reviewed 2.1 allowances) |
| Minimum distance to a same-line skipped station | 532.6 m |
| Other-service stations passed by routed tracks | 104 (diagnostic only) |

The first S6 publish build took 6.05 s. Two final acceptance builds took 5.04 s
and 4.56 s respectively; both produced byte-identical output to `public/data/`
and to each other. After the review corrections, a fresh independent raw-N02
build took **4.39 s** and again matched all five published files byte-for-byte.

| Public file | Raw bytes | Gzip bytes (level 9, mtime 0) |
|---|---:|---:|
| `manifest.json` | 456 | 341 |
| `stations.json` | 54,863 | 10,170 |
| `services.json` | 88,935 | 13,316 |
| `segments.json` | 202,155 | 17,523 |
| `segments.geojson` | 398,311 | 83,972 |
| **Five-file total** | **744,720 / 3,145,728 cap (23.7%)** | **125,322 / 921,600 cap (13.6%)** |

Additional capital-region caps: GeoJSON is 398,311 / 1,572,864 raw bytes (25.3%)
and 83,972 / 460,800 gzip bytes (18.2%); 1,230 / 20,000 geometry references
(6.2%); maximum chain 3 / 128 (2.3%). All are within the profile.

## Cross-prefecture pairs

There are 25 service-adjacent product pairs that cross prefecture boundaries:
Tokyo–Kanagawa 11, Tokyo–Saitama 8, Tokyo–Chiba 5, and Saitama–Chiba 1.
Each pair below was routed in its catalog service and has the listed number of
actually traversed N02 `RailroadSection` keys (excluding candidates and endpoint-only touches). The complete keys and raw-geometry evidence
are in [the N02 pair-evidence annex](jr-east-capital-region-s6-n02-pair-evidence.csv).

| Service | Adjacent pair | Prefecture transition | N02 line; section keys |
|---|---|---|---|
| `jr-keihin-tohoku` | 川口–赤羽 | 埼玉県→東京都 | 東北線; 4 |
| `jr-keihin-tohoku` | 蒲田–川崎 | 東京都→神奈川県 | 東海道線; 5 |
| `jr-chuo-sobu-local` | 小岩–市川 | 東京都→千葉県 | 総武線; 3 |
| `jr-chuo-takao-fujino` | 高尾–相模湖 | 東京都→神奈川県 | 中央線; 9 |
| `jr-hachiko` | 箱根ケ崎–金子 | 東京都→埼玉県 | 八高線; 3 |
| `jr-saikyo` | 浮間舟渡–戸田公園 | 東京都→埼玉県 | 東北線; 3 |
| `jr-sotetsu-direct` | 西大井–武蔵小杉 | 東京都→神奈川県 | 東海道線; 3 |
| `jr-keiyo` | 葛西臨海公園–舞浜 | 東京都→千葉県 | 京葉線; 3 |
| `jr-musashino` | 新秋津–東所沢 | 東京都→埼玉県 | 武蔵野線; 3 |
| `jr-musashino` | 三郷–南流山 | 埼玉県→千葉県 | 武蔵野線; 3 |
| `jr-nambu` | 稲田堤–矢野口 | 神奈川県→東京都 | 南武線; 3 |
| `jr-yokohama` | 長津田–成瀬 | 神奈川県→東京都 | 横浜線; 3 |
| `jr-yokohama` | 町田–古淵 | 東京都→神奈川県 | 横浜線; 3 |
| `jr-yokohama` | 橋本–相原 | 神奈川県→東京都 | 横浜線; 3 |
| `jr-tokaido` | 品川–川崎 | 東京都→神奈川県 | 東海道線; 14 |
| `jr-yokosuka` | 西大井–武蔵小杉 | 東京都→神奈川県 | 東海道線; 3 |
| `jr-sobu-rapid` | 新小岩–市川 | 東京都→千葉県 | 総武線; 5 |
| `jr-utsunomiya` | 赤羽–浦和 | 東京都→埼玉県 | 東北線; 12 |
| `jr-takasaki` | 赤羽–浦和 | 東京都→埼玉県 | 東北線; 12 |
| `jr-shonan-shinjuku-local` | 浦和–赤羽 | 埼玉県→東京都 | 東北線; 12 |
| `jr-shonan-shinjuku-local` | 西大井–武蔵小杉 | 東京都→神奈川県 | 東海道線; 3 |
| `jr-shonan-shinjuku-rapid-takasaki` | 浦和–赤羽 | 埼玉県→東京都 | 東北線; 12 |
| `jr-shonan-shinjuku-rapid-takasaki` | 大崎–武蔵小杉 | 東京都→神奈川県 | 山手線 2 + 東海道線 4 |
| `jr-joban-rapid` | 北千住–松戸 | 東京都→千葉県 | 常磐線; 12 |
| `jr-joban-local` | 金町–松戸 | 東京都→千葉県 | 常磐線; 6 |

`東海道線` is an N02 grouping in several rows, not a declaration that trains
use one physical track. Service-specific section filters and stage evidence keep
京浜東北・根岸線, 東海道線 and 横須賀線 choices separate. 総武線各駅停車
小岩–市川 and 総武快速線 新小岩–市川 are routed independently; they are not
composed across their separate local and rapid tracks.

## Deferred in-prefecture pairs and runs

These eight added pairs complete the deferred stations/runs. They use the same
annex key scheme as the boundary pairs above.

| Deferred run | Service / adjacent pair | Prefecture | N02 line; section keys |
|---|---|---|---|
| 成瀬・町田 | `jr-yokohama` 成瀬–町田 | 東京都 | 横浜線; 3 |
| 高尾–相模湖–藤野 | `jr-chuo-takao-fujino` 相模湖–藤野 | 神奈川県 | 中央線; 5 |
| 綾瀬・亀有・金町 | `jr-joban-local` 綾瀬–亀有 | 東京都 | 常磐線; 3 |
| 綾瀬・亀有・金町 | `jr-joban-local` 亀有–金町 | 東京都 | 常磐線; 3 |
| 古淵–淵野辺–矢部–相模原–橋本 | `jr-yokohama` 古淵–淵野辺 | 神奈川県 | 横浜線; 3 |
| 古淵–淵野辺–矢部–相模原–橋本 | `jr-yokohama` 淵野辺–矢部 | 神奈川県 | 横浜線; 3 |
| 古淵–淵野辺–矢部–相模原–橋本 | `jr-yokohama` 矢部–相模原 | 神奈川県 | 横浜線; 3 |
| 古淵–淵野辺–矢部–相模原–橋本 | `jr-yokohama` 相模原–橋本 | 神奈川県 | 横浜線; 3 |

綾瀬–亀有–金町 is routed as 常磐線各駅停車 and continues through 松戸. N02
has one generalized line for both local and rapid tracks on this span; this is
a representation limit, not verified separate-track geometry. The distinguishable
Edogawa bridge and east-bank branches are pinned separately (see below). The Chuo run is
高尾–相模湖–藤野 in product order. The Yokohama run is contiguous through
成瀬・町田 and 古淵・淵野辺・矢部・相模原・橋本; no out-of-area gap is bridged.

## Compositions, direct routes, transfers, and exceptions

There are **no new compositions** in S6, so the list of compositions for separate
review is empty. All 59 composed pairs are inherited from validated S6P stage
recipes: Shonan-Shinjuku local 19, Shonan-Shinjuku rapid (Takasaki) 31,
Sotetsu direct 4, Takasaki 3, Uchibo 2. The reviewed source owners and shared-track reasons remain in each `compose`
record. Thirty S6 integration witnesses expanded their filters to match the
combined live owner scope; the review correction updates 21 witnesses to match
the corrected owner filters. These are synchronized current-owner constraints,
not byte-identical copies of stage allow lists. No local/rapid parallel service pair is composed.

One new direct multi-N02 route recipe (not a composition) was needed for
`jr-shonan-shinjuku-rapid-takasaki` 大崎–武蔵小杉. It joins N02 `山手線` to
`東海道線` at `[139.7328, 35.61677]`; the physical route is the 大崎支線 joining
品鶴線 and continuing to 武蔵小杉, with no station transfer. The output follows
the same physical corridor as the 横須賀線 at 武蔵小杉 and southward; it does
not use the 東海道旅客線. The new pair's three 山手線 and three 東海道線 actually traversed section
keys are in the annex; the other two 東海道線 entries were endpoint-only touches. The N02 geometry is an explicit track representation at
this junction, with the shared path and joint named in the recipe reason.

Across the Shonan-Shinjuku runs, 武蔵小杉–戸塚 uses the physical 横須賀線/品鶴線
track. In the north, the actual service uses 東北貨物線 大宮–赤羽. The new
浦和–赤羽 geometry excludes the 京浜東北 platform branch at 南浦和; N02 merges
the passenger 列車線 and freight tracks on the bypass and the surrounding main
corridor. It therefore does not independently verify those two physical tracks.
Where Shonan services use reviewed shared physical tracks, their inherited
compositions retain their owners and reasons, with current-owner section filters.
No 東海道線 route is composed from 京浜東北・根岸線 or 横須賀線 geometry.

| Exception type | Count | Reviewed entries |
|---|---:|---|
| Platform transfer | 1 | `jr-joban-rapid` 上野, max 150 m; N02 東北線 has disconnected Ueno-Tokyo-Line and 常磐線 components. Arrive on the former, depart on the latter. |
| Platform offset | 2 | `jr-keiyo` 東京, max 500 m (distant Keiyo platform); `jr-nambu` 武蔵小杉, max 400 m (measured 393.4 m between the Nambu facility and representative point). |
| Detour limit | 2 | Shonan local and Shonan rapid 赤羽–池袋, each max ratio 2.1 for the reviewed freight-line surrogate. |

## Tests and browser evidence

| Test area | Previous 23-ward assumption | S6 expectation / behavior |
|---|---|---|
| Pipeline live override/catalogue | 5 service IDs / 67 registry rows | Service order and stop lists read from the pinned product oracle; 40 services / 472 rows. The separate core fixture remains 5 / 67. |
| Pipeline budget/validation | 146 geometry references, chain 1, 23ku byte cap, no platform transfer | 1,230 references, max chain 3, capital-region caps, one transfer and 104 other-station passes. |
| Runtime real-data unit test | Five service IDs, per-service 23-ward stop counts, 67 stations, 146 segments, 88 features | Exact order/stops from the approved catalog; 40 / 472 / 1,224 directed segments; every geometry primitive referenced; Every one of the 472 stations has its complete service-membership set and cardinality compared directly with the product catalog (including exact reverse-index key coverage). |
| Camera scaling unit test | The live bundle fit as a compact city dataset | The live regional bundle starts on `jr-yamanote`; the fixture-driven 8-service scaling case is unchanged. |
| Edition copy | `JR東日本 東京23区版`, Tokyo-ward / five-service description | `JR東日本 1都3県版`; title describes the four prefectures and 40 services. No UI behavior changed. |
| Real-data browser smoke | Four rendered services and every shipped stop fit in the 23-ward viewport | Exact 39 non-target service IDs rendered from the 40-service bundle, plus a rendered pending Yamanote target line; the APP’s 「全体」 button must put every platform of all 40 services in view outside the panel on desktop/phone/Firefox (no test-side fitBounds); Ueno zoom; fixed save/restore smoke remains. |
| Fixture-based E2E | Fixture data and assertions | Unchanged. |

Playwright screenshots (ignored local review artifacts):

- `.claude/logs/jrcr-s6/screenshots/network-overview-desktop.png`
- `.claude/logs/jrcr-s6/screenshots/network-overview-phone.png`
- `.claude/logs/jrcr-s6/screenshots/ueno-transfer-desktop.png`
- `.claude/logs/jrcr-s6/screenshots/ueno-zoom-desktop.png`
- `.claude/logs/jrcr-s6/screenshots/ueno-zoom-phone.png`

The transfer screenshot is a valid real-engine save at 上野 on `jr-joban-rapid`
(turn 280); the marker is at the rapid service's 上野 platform after restore.

## Playthrough, persistence, and startup measurements

All timings use the local test build and are observational, not timing assertions.

| Measurement | Result |
|---|---:|
| Fixed seed `real-alpha`, complete Yamanote target playthrough | 867 turns; completed and restored by the unit suite |
| Fixed seed `real-epsilon`, complete playthrough used for long-history samples | 1,034 turns |
| Serialize 300-turn history | 117,675 bytes; median 0.257 ms (7 runs) |
| Restore 300-turn history | median 17.507 ms (7 runs) |
| Serialize 1,000-turn history | 361,712 bytes; median 1.000 ms (7 runs) |
| Restore 1,000-turn history | median 74.666 ms (7 runs) |
| Browser `domInteractive` / `loadEventEnd` | 52.1 / 251.6 ms |
| Start new game → MapLibre style ready | 1,280.5 ms |
| JSON fetches | Five files; pre-correction measurement, 744,092 decoded bytes, resource durations 60–83 ms (concurrent) |

The browser timing does not isolate JavaScript parse time. `domInteractive` is the
available document startup proxy; `appStartToMapStyleReadyMs` includes loading the
data, constructing the runtime network, and waiting for the map style.

During the post-review all-project E2E run, desktop Chromium reported
`domInteractive` 65.5 ms, `loadEventEnd` 397.2 ms, and new-game-to-map-style-ready
3,272.2 ms. Its five concurrent JSON requests decoded **744,720 bytes** in
27.2–79.5 ms. This startup sample includes parallel full-suite load.

## Acceptance verification

All required acceptance commands completed successfully:

| Command | Result |
|---|---|
| `uv run ruff check .` | Pass; no lint findings |
| `uv run ruff format --check .` | Pass; 59 files already formatted |
| `uv run ty check scripts/` | Pass; no type errors |
| `uv run pytest` | Pass; 373 passed in 159.60 s |
| `uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --quiet --out-dir /tmp/jrcr-s6-review-fix-rebuild` | Pass; 4.39 s |
| `diff -r /tmp/jrcr-s6-review-fix-rebuild public/data` | Pass; no differences |
| `uv run python -m scripts.data_pipeline.validate` | Pass; `OK`, all five files, regional byte/reference/chain caps and route checks valid |
| `npm run typecheck` | Pass |
| `npx vitest run` | Pass; 24 files / 552 tests |
| `npm run build` | Pass; Vite build completed in 675 ms; existing >500 kB chunk warning |
| `npm run test:e2e` | Pass; 78 tests in 3.1 min: desktop Chromium 26, phone Chromium 26, desktop Firefox 26 (all pass) |
| `git diff --check` | Pass; no whitespace errors |

The all-project E2E run includes the real-data network overview through the APP’s
「全体」 control (every platform of all 40 services outside the panel), zoom, fixed save
and restore flow on desktop and phone, plus all fixture E2E cases unchanged. Five
screenshots were written to `.claude/logs/jrcr-s6/screenshots/` for visual review.

## Pipeline gaps and decisions

No pipeline-code gap was found; no file under `scripts/` was changed. The
catalogue hash, service kinds, ordered stop lists, stage evidence, boundaries,
and new route are pinned. The only S6-specific additions beyond copying stage
recipes are the combined product oracle, the reviewed full registry and scopes,
the direct Osaki–Musashi-Kosugi route, physically reviewed branch constraints
with explicit source-resolution limits, and N02 section evidence for 33 newly
routed stop pairs.

## S6 review correction: physical track assignments and limits

This section supersedes the initial routing claims. Section suffixes below are
unique within the relevant N02 line; full orientation-free keys, route order,
measured interior lengths and both travel directions are in the annex.

| Service / pair | Chosen candidates | Physical attribution / representation limit |
|---|---|---|
| 東海道線 品川–川崎 | `#a88144bb`; deny `#61967b18` | Downstream Tama River bridge, 東海道 passenger tracks. |
| 京浜東北線 蒲田–川崎 | `#61967b18`; deny `#a88144bb` | Upstream Tama River bridge, 京浜東北 tracks. |
| 常磐快速 北千住–松戸 | `#990bbe76` → `#eacbe1e8`; deny `#21d405a8`, `#6924bdce` | Southern/downstream bridge, then northern/western rapid alignment after the east-bank grade separation. |
| 常磐各停 金町–松戸 | `#21d405a8` → `#6924bdce`; deny `#990bbe76`, `#eacbe1e8` | Northern/upstream bridge, then southern/eastern local alignment after the grade separation. Do not preserve bridge-side ordering past the crossover. |
| 宇都宮・高崎 赤羽–浦和 | `#bd4cd661`; deny `#fb84d894`, `#a6459c6d`, `#5a0729ea` | Bypass west of 南浦和's 電車線 platforms. Actual trains use 列車線; N02 combines 列車線 and 貨物線 on this branch. |
| 湘南新宿 普通・快速 浦和–赤羽 | Same `#bd4cd661` bypass and exclusions | Actual trains use 東北貨物線. This is the sole N02 through-corridor branch here, not separately verified freight-track geometry. |
| 京浜東北 蕨–南浦和–浦和 | `#5a0729ea` → `#a6459c6d` → `#fb84d894`; deny `#bd4cd661` | Eastern 電車線/platform branch. Other services cannot select the 南浦和 platform detour. |
| 総武快速 新小岩–市川 / 総武緩行 小岩–市川 | Rapid: `#1bf85e39`, `#1a6da7cd`, `#a892172b`, `#930afb24`, `#d9b8a27b`; local: last three | Only one N02 corridor, including the 江戸川 bridge `#930afb24`. The raw source does not encode the physically separate rapid and local tracks here. Each service now pins its own available 総武線 sections; this is an explicit representation limit. |

Sources and attribution method (reviewed 2026-10-15):

- [MLIT Tama River bridge location plan, location 1](https://www.ktr.mlit.go.jp/ktr_content/content/000938104.pdf)
  identifies the upstream 京浜東北 and downstream 東海道 bridges. Comparing
  those positions with the two N02 interiors yields the Tama assignments.
- [MLIT river maintenance plan, bridge inventory appendix](https://www.ktr.mlit.go.jp/ktr_content/content/000854297.pdf#page=81)
  lists separate 常磐緩行 and 快速 facilities in its permitted-bridge table.
  The common river-km value alone does not determine which candidate is which;
  geographic positions and the east-bank crossover resolve the assignment.
- [GSI orthophoto, east bank and bridge](https://maps.gsi.go.jp/#17/35.7698/139.8889/&base=seamlessphoto&ls=seamlessphoto&disp=1)
  and [JR East Matsudo platform map](https://www.jreast.co.jp/estation/stations/1441.html)
  establish the rapid/local sides and east-bank crossover. Candidate attribution
  is an inference from this geographic layout and the raw N02 coordinates:
  `#21d405a8` is 32.6 m north of `#990bbe76` at their interior samples;
  `#eacbe1e8` is north of `#6924bdce` after the crossover. Local tracks change
  from the north bridge to the south/east approach; rapid tracks do the reverse.
  Local review overlays are saved under `.claude/logs/jrcr-s6/screenshots/`.
- [GSI orthophoto at Minami-Urawa](https://maps.gsi.go.jp/#17/35.8483/139.6686/&base=seamlessphoto&ls=seamlessphoto&disp=1)
  locates `#a6459c6d` on the eastern station platforms and `#bd4cd661` west of
  them; [JR East's track renewal plan](https://www.jreast.co.jp/press/2018/oomiya/20190214_o01.pdf)
  separately names 東北本線 川口–南浦和 and 東北貨物線 川口–浦和.
  The raw source has two branches here, rather than three: 電車線 versus the
  generalized 列車線/貨物線 bypass. Assigning that bypass independently to
  either real through-track pair would overstate the source's resolution.
- [GSI orthophoto at the Sobu Edogawa bridge](https://maps.gsi.go.jp/#17/35.7310/139.8960/&base=seamlessphoto&ls=seamlessphoto&disp=1)
  shows the separate bridge decks, whereas the raw N02 has only `#930afb24`.
  [MLIT N02 documentation](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html)
  describes railway sections, not a service-specific physical-track survey.

The remaining representation limits are geographically bounded:

- 常磐: from 綾瀬 through 亀有 and 金町 to the bridge branch node
  `[139.87591, 35.76954]`, N02 has one corridor (`#80d46d03`, `#f1ae8e2d`,
  `#3ba92e7a`, `#b5e5e3ed`, `#15e0b3af`, `#80f287a6`), used separately by
  the two service graphs. From the eastern branch endpoint
  `[139.89347, 35.77090]` to 松戸, `#66945aef` and `#f2862beb` are again
  generalized. Only the intervening bridge and east-bank branches are
  independently selected. 綾瀬–亀有–金町 is not verified separate local track.
- 東北: the two 南浦和 branches run from `[139.66635, 35.85033]` to
  `[139.68335, 35.83490]` (the through branch is 2,307.13 m). On the through
  branch, and between these branch endpoints and the shared N02 浦和/赤羽
  platform anchors, 列車線 and 貨物線 cannot be separated. The surrounding
  main corridor is also generalized with 電車線 wherever no parallel branch
  exists. The separate 埼京線 alternatives near 赤羽 are not that main corridor
  and remain excluded by the selected route.
- 総武: all five sections from 新小岩 to 市川, including the 小岩 station
  segment and 江戸川 bridge, form one generalized N02 corridor. No separate
  rapid/local physical track is verified anywhere on this new span.

These limitations authorize a source representation, not physical track sharing
or a new composition between services that actually use separate tracks.

## Corrected pair-evidence extraction

The annex now contains **516 rows across 66 directed pairs (33 product pairs)**:
**350 traversed**, **56 endpoint-touch**, and **110 candidate** rows. There are
**175 section traversals in product direction**; reverse direction has the same
sections in reverse order. Counts in the earlier pair tables count only
`status=traversed`; neither endpoint-touch nor candidate rows count as sections.

Extraction uses `route_network`'s unsimplified `TrackPath.geometry`, with raw
`N02Source.track_sections` as the provenance index. For each raw edge, its
positive interior length on the exact route is measured (1 micrometre numerical
tolerance for projection/substrings; length must exceed 1 cm). Shared endpoints
alone are labeled `endpoint-touch`. Other source sections within 100 m are
labeled `candidate` and make no route claim. The sum of traversed edge lengths
must match the pair's raw routed length within 1 cm before any row is emitted.
This checks every metre of each route, rather than accepting visual proximity
to a simplified public line. `traversal_order` orders the actual selected
sections for each direction; partial first/last station edges are retained with
their actual used lengths. Section keys identify source geometry, not a physical
track label independently of the sources and limits above.

## Chosen sections per travel direction

The suffixes below expand to the complete `section_key` values in the annex.
Direction follows each service’s product stop order. Both directions are printed
explicitly; these are traversed keys only.

| Service | From → to | Direction | Ordered section suffixes |
|---|---|---|---|
| `jr-utsunomiya` | akabane → urawa | +1 | #359198f0 → #70b0274d → #75356c83 → #bd6060f9 → #ed85b8b4 → #7582026e → #20bb3306 → #187ea946 → #6f8acc47 → #bd4cd661 → #ac00f850 → #c6264b2e |
| `jr-utsunomiya` | urawa → akabane | -1 | #c6264b2e → #ac00f850 → #bd4cd661 → #6f8acc47 → #187ea946 → #20bb3306 → #7582026e → #ed85b8b4 → #bd6060f9 → #75356c83 → #70b0274d → #359198f0 |
| `jr-tokaido` | shinagawa → kawasaki | +1 | #4c35f351 → #7b0d29a8 → #0f36108f → #d4d53e0e → #2a2d1c8a → #99c28973 → #d2154798 → #f4f2f130 → #b12fb6f0 → #b6b04326 → #de0dd57a → #a88144bb → #c0b85442 → #9a992e11 |
| `jr-tokaido` | kawasaki → shinagawa | -1 | #9a992e11 → #c0b85442 → #a88144bb → #de0dd57a → #b6b04326 → #b12fb6f0 → #f4f2f130 → #d2154798 → #99c28973 → #2a2d1c8a → #d4d53e0e → #0f36108f → #7b0d29a8 → #4c35f351 |
| `jr-joban-local` | kameari → kanamachi | +1 | #3ba92e7a → #b5e5e3ed → #15e0b3af |
| `jr-joban-local` | kanamachi → kameari | -1 | #15e0b3af → #b5e5e3ed → #3ba92e7a |
| `jr-shonan-shinjuku-rapid-takasaki` | urawa → akabane | +1 | #c6264b2e → #ac00f850 → #bd4cd661 → #6f8acc47 → #187ea946 → #20bb3306 → #7582026e → #ed85b8b4 → #bd6060f9 → #75356c83 → #70b0274d → #359198f0 |
| `jr-shonan-shinjuku-rapid-takasaki` | akabane → urawa | -1 | #359198f0 → #70b0274d → #75356c83 → #bd6060f9 → #ed85b8b4 → #7582026e → #20bb3306 → #187ea946 → #6f8acc47 → #bd4cd661 → #ac00f850 → #c6264b2e |
| `jr-sobu-rapid` | shin-koiwa → ichikawa | +1 | #1bf85e39 → #1a6da7cd → #a892172b → #930afb24 → #d9b8a27b |
| `jr-sobu-rapid` | ichikawa → shin-koiwa | -1 | #d9b8a27b → #930afb24 → #a892172b → #1a6da7cd → #1bf85e39 |
| `jr-takasaki` | akabane → urawa | +1 | #359198f0 → #70b0274d → #75356c83 → #bd6060f9 → #ed85b8b4 → #7582026e → #20bb3306 → #187ea946 → #6f8acc47 → #bd4cd661 → #ac00f850 → #c6264b2e |
| `jr-takasaki` | urawa → akabane | -1 | #c6264b2e → #ac00f850 → #bd4cd661 → #6f8acc47 → #187ea946 → #20bb3306 → #7582026e → #ed85b8b4 → #bd6060f9 → #75356c83 → #70b0274d → #359198f0 |
| `jr-joban-rapid` | kita-senju → matsudo | +1 | #a91158ab → #cb726616 → #80d46d03 → #f1ae8e2d → #3ba92e7a → #b5e5e3ed → #15e0b3af → #80f287a6 → #990bbe76 → #eacbe1e8 → #66945aef → #f2862beb |
| `jr-joban-rapid` | matsudo → kita-senju | -1 | #f2862beb → #66945aef → #eacbe1e8 → #990bbe76 → #80f287a6 → #15e0b3af → #b5e5e3ed → #3ba92e7a → #f1ae8e2d → #80d46d03 → #cb726616 → #a91158ab |
| `jr-joban-local` | kanamachi → matsudo | +1 | #15e0b3af → #80f287a6 → #21d405a8 → #6924bdce → #66945aef → #f2862beb |
| `jr-joban-local` | matsudo → kanamachi | -1 | #f2862beb → #66945aef → #6924bdce → #21d405a8 → #80f287a6 → #15e0b3af |
| `jr-chuo-sobu-local` | koiwa → ichikawa | +1 | #a892172b → #930afb24 → #d9b8a27b |
| `jr-chuo-sobu-local` | ichikawa → koiwa | -1 | #d9b8a27b → #930afb24 → #a892172b |
| `jr-keihin-tohoku` | kamata → kawasaki | +1 | #b6b04326 → #de0dd57a → #61967b18 → #c0b85442 → #9a992e11 |
| `jr-keihin-tohoku` | kawasaki → kamata | -1 | #9a992e11 → #c0b85442 → #61967b18 → #de0dd57a → #b6b04326 |
| `jr-shonan-shinjuku-local` | urawa → akabane | +1 | #c6264b2e → #ac00f850 → #bd4cd661 → #6f8acc47 → #187ea946 → #20bb3306 → #7582026e → #ed85b8b4 → #bd6060f9 → #75356c83 → #70b0274d → #359198f0 |
| `jr-shonan-shinjuku-local` | akabane → urawa | -1 | #359198f0 → #70b0274d → #75356c83 → #bd6060f9 → #ed85b8b4 → #7582026e → #20bb3306 → #187ea946 → #6f8acc47 → #bd4cd661 → #ac00f850 → #c6264b2e |
| `jr-joban-local` | ayase → kameari | +1 | #80d46d03 → #f1ae8e2d → #3ba92e7a |
| `jr-joban-local` | kameari → ayase | -1 | #3ba92e7a → #f1ae8e2d → #80d46d03 |
