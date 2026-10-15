# S6P Kanagawa stage evidence

**Status: built and validated from raw N02 under `validationProfile: stage`.** The
stage contains 13 of the 14 product services touching Kanagawa and 97 of 103
Kanagawa stations. Twelve service IDs carry their complete contiguous
Kanagawa run; `jr-yokohama` carries the eastern run 東神奈川–長津田 only. Every
included service and station is present in the generated and validated stage
artifacts.

This stage is a validation artifact, not a playable or live release. Its
interior reachability seed is 横浜. The dataset intentionally has no gameplay
`startStationId` or `targetServiceId`; the expected-catalog oracle remains
product-catalog-only and is pinned at
`dea41cf1274218c44ca59326d4a2645b80c419bfa4f2c72b60592a077a81de9e`.

## 1. Scope and deferred runs

| Coverage | Count | Treatment |
|---|---:|---|
| Product services touching Kanagawa | 14 | Frozen product catalogue total |
| Services staged and built | 13 | 12 complete Kanagawa runs plus partial 横浜線 |
| Services fully deferred | 1 | `jr-chuo-takao-fujino` |
| Kanagawa stations in product catalogue | 103 | Frozen product catalogue total |
| Kanagawa stations staged and validated | 97 | Product subset used by the 13 staged services |
| Kanagawa stations deferred | 6 | `sagamiko`, `fujino`, `kobuchi`, `fuchinobe`, `yabe`, `sagamihara` |

The lead decision is to defer Tokyo enclaves `成瀬`, `町田`, and `高尾`, as well
as `綾瀬`, `亀有`, and `金町`, to the combined four-prefecture S6 dataset. The
first three interrupt the Yokohama and Chuo Line runs. The other three are also
reserved for combined S6 and are outside the Kanagawa station total.

The Yokohama Line stage stops at 長津田 before the out-of-area run through
成瀬・町田. Its deferred western Kanagawa run is 古淵–淵野辺–矢部–相模原–橋本;
橋本 is already in this stage through the Sagami Line. The Chuo Line's
相模湖–藤野 component cannot connect to the selected network with 高尾 excluded,
so `jr-chuo-takao-fujino` is wholly deferred. No out-of-area gap is bridged and
no service identity is split into multiple runs.

The scope tables retain the immediate excluded neighbour at every
`area-boundary`. The separate `cross-border-pairs.csv` keeps **11 adjacent pairs
from the frozen product catalogue plus two external regional neighbours**.
None is routed in this stage.

## 2. N02 routing, ownership, and exceptions

`data/staging/jr-east-capital-region/kanagawa/n02-routing-evidence.csv` records
all 123 canonical +1 stop pairs, their selected N02 line or composition owner,
and the section keys seen on the raw-N02 path. Every direct route owner has a
`sections.csv` allow-list, including the nearest N02 sections at its selected
station platforms. These are raw feature keys produced by the pipeline's
orientation-free `section_key`; the evidence file preserves the pair-level
association.

| Pair recipe class | Count | Notes |
|---|---:|---|
| Direct single-N02-line routes | 105 | N02 line and section evidence pinned; includes the rapid-owned 戸塚–大船 route |
| Ordered via recipes | 0 | No accepted pair required a forced via point |
| Multi-N02-line route recipes | 0 | The N02 source does not represent the 戸塚 crossover as a separate feature |
| Composed pairs | 18 | 7 湘南新宿 local pairs and 11 湘南新宿 rapid pairs |

The physical-track review for every composed pair is below. Geometry equality and
shared section keys are supporting route checks; they do not establish that the
services use the same track. The owner's physical track and served stops govern
each decision. N02 names several 品鶴線 / 横須賀線 owner sections `東海道線`,
so its line label alone is not treated as a track-ownership claim.

| Service | Pair | Owner expansion | Physical-track basis |
|---|---|---|---|
| local | 武蔵小杉–新川崎 | `jr-yokosuka:musashi-kosugi~shin-kawasaki` | Runs on the 品鶴線 alignment also used by 横須賀線; 新川崎 is served by this local service. |
| local | 新川崎–横浜 | `jr-yokosuka:shin-kawasaki~yokohama` | Follows the 品鶴線 via 鶴見 to 横浜, separate from the 東海道旅客線 via 川崎. |
| local | 横浜–保土ケ谷 | `jr-yokosuka:yokohama~hodogaya` | Uses the 横須賀線 track and serves 保土ケ谷. |
| local | 保土ケ谷–東戸塚 | `jr-yokosuka:hodogaya~higashi-totsuka` | Uses the same 横須賀線 track and serves 東戸塚. |
| local | 東戸塚–戸塚 | `jr-yokosuka:higashi-totsuka~totsuka` | Continues on the 横須賀線 track to 戸塚. |
| local | 北鎌倉–鎌倉 | `jr-yokosuka:kita-kamakura~kamakura` | Uses the 横須賀線 south of 大船. |
| local | 鎌倉–逗子 | `jr-yokosuka:kamakura~zushi` | Uses the same 横須賀線 track south of 鎌倉. |
| rapid | 武蔵小杉–横浜 | `jr-yokosuka:musashi-kosugi~shin-kawasaki` + `jr-yokosuka:shin-kawasaki~yokohama` | Uses the 品鶴線 / 横須賀線 alignment, passing through 新川崎 without stopping; the owner chain expands to two primitives. |
| rapid | 横浜–戸塚 | `jr-yokosuka:yokohama~hodogaya` + `jr-yokosuka:hodogaya~higashi-totsuka` + `jr-yokosuka:higashi-totsuka~totsuka` | Uses the 横須賀線 side and passes 保土ケ谷・東戸塚. The 東海道旅客線 path is distinct (Hausdorff distance 218.317 m; length difference 148.059 m), so the 東海道線 owner is incorrect for this pair. |
| rapid | 大船–藤沢 | `jr-tokaido:ofuna~fujisawa` | The rapid has joined the 東海道線 south of 戸塚 and shares the passenger main track from 大船 onward. |
| rapid | 藤沢–辻堂 | `jr-tokaido:fujisawa~tsujido` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 辻堂–茅ケ崎 | `jr-tokaido:tsujido~chigasaki` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 茅ケ崎–平塚 | `jr-tokaido:chigasaki~hiratsuka` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 平塚–大磯 | `jr-tokaido:hiratsuka~oiso` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 大磯–二宮 | `jr-tokaido:oiso~ninomiya` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 二宮–国府津 | `jr-tokaido:ninomiya~kozu` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 国府津–鴨宮 | `jr-tokaido:kozu~kamonomiya` | Uses the shared 東海道旅客線 and serves both stops. |
| rapid | 鴨宮–小田原 | `jr-tokaido:kamonomiya~odawara` | Uses the shared 東海道旅客線 and serves both stops. |

Rapid `戸塚–大船` is deliberately absent from the composition table because its
whole pair is not a shared-track segment. The train departs from the 横須賀線
side at 戸塚 and crosses to the 東海道線 south of 戸塚; after the merge it
continues to 大船 on the 東海道線 side. It is now a rapid-owned direct route
using N02 line `東海道線` and the pair-level section keys
`139.53164 35.35542~139.53470 35.39917#5100ea0f` and
`139.53392 35.40170~139.53470 35.39917#30bf9182`. The additional allow-listed
section `139.53069 35.35289~139.53164 35.35542#41ba2b37` reaches the selected
大船 anchor. Raw N02 exposes one 戸塚 platform candidate, labelled `東海道線`,
and line-labelled section geometry; it does **not** contain a distinct
crossover feature that can show the 横須賀線-side departure and the change
south of 戸塚 separately. The direct owner records the rapid's own pair; its
emitted N02 geometry cannot encode that crossover separately. The full pair
and line evidence is in `n02-routing-evidence.csv` and the raw candidate check is
in `.claude/logs/jrcr-s6p-kanagawa/totsuka-n02-inspection.txt`.

The two 東海道線 / 横須賀線 service routes at 戸塚–大船 still must not be
conflated. Their N02-routed paths overlap for 5,179.03 m but have a Hausdorff
distance of 10.53 m; the complete service paths use different station-side
alignments. The common section keys
`139.53164 35.35542~139.53470 35.39917#5100ea0f` and
`139.53392 35.40170~139.53470 35.39917#30bf9182` do not prove whole-pair
physical-track identity. The rapid route remains direct even though its N02
section geometry is similar to the 東海道線 pair.

At 大船, the 横須賀線 pair 戸塚–大船 ends 22.974 m from the 横須賀線 departure
alignment for 大船–北鎌倉. A `platform_transfers.csv` row was tested for this
genuine station-platform separation, but the routing optimizer selected the
same anchor because its 22.974 m snap cost ties the 22.974 m transfer cost; the
configured transfer then fails as unused. The accepted inputs therefore keep
the two 湘南新宿 local pairs around 大船 as direct N02 routes instead of
composing either side. The remaining seven local pairs compose from
`jr-yokosuka`.

This is a concrete pipeline gap, not an accepted transfer exception:
`routing.py:route_path` resolves the equal-cost case without using the transfer,
and `composition_build.py:inherited_candidates` requires exact anchors when
composed and routed hops meet. Until the pipeline supports an explicitly
reviewed transfer that remains meaningful at equal cost, those two local pairs
remain independent. There are **0 platform-transfer rows** and **0 detour
exceptions**. The one platform-offset exception is
`jr-nambu/musashi-kosugi`, with a 400 m limit for the measured 393.4 m Nambu
platform-to-representative-point offset; the reason is recorded inline in
`offset_exceptions.csv`.

All 13 service definitions have length references, endpoint/scope metadata, and
station-number sequences. Blank cells in the two-line Sagami Line sequence and
the Sotetsu direct service are explicit: only published JR East station codes
are assigned to a JR East stop. The JR East Metropolitan Station Numbering Map
and the Chigasaki/Hashimoto station pages were consulted on 2026-10-15:

- https://www.jreast.co.jp/e/downloads/pdf/numbering_e.pdf
- https://www.jreast.co.jp/estation/station/info.aspx?StationCD=982
- https://www.jreast.co.jp/estation/station/info.aspx?StationCD=1224

Mileage references and their source URLs are recorded per service in
`overrides/services.json`; built lengths fall within their configured
1.5 km tolerance.

## 3. Measurements

| Metric | Result |
|---|---:|
| Canonical +1 stop pairs | 123 |
| Direct single-line / via / multi-line / compose | 105 / 0 / 0 / 18 |
| Owned N02 geometry features | 105 |
| Services owning at least one primitive | 13 of 13 |
| Directed segments | 246 |
| Geometry references / maximum chain length | 252 / 3 |
| Maximum compose dependency depth | 1 |
| Platform transfers / detour exceptions | 0 / 0 |
| Platform-offset exceptions | 1 (`jr-nambu/musashi-kosugi`, 400 m limit) |
| Maximum measured platform offset | 393.4 m, within the exception |
| Maximum endpoint offset | 23.012 m (30 m limit) |
| Maximum detour ratio | 1.455 (1.8 limit) |
| Minimum skipped-stop distance | 532.6 m (100 m limit) |
| Built-segment reachability from 横浜 | 97/97 outward and 97/97 return |
| Product-only oracle SHA-256 | `dea41cf1274218c44ca59326d4a2645b80c419bfa4f2c72b60592a077a81de9e` |

The oracle equals the built station order, service order, and every built stop
list; its SHA-256 is unchanged because no stop lists changed. The 1 m
simplification report equals the default 1 m output. The 3 m and 5 m comparisons,
raw/gzip sizes, per-file bytes, and timings below come from the final acceptance
commands.

| Tolerance | Coordinates | Maximum Hausdorff distance | Raw bytes | Gzip bytes |
|---:|---:|---:|---:|---:|
| 1 m | 2,278 | 0.999616 m | 149,326 | 25,240 |
| 3 m | 1,382 | 2.990751 m | 130,585 | 20,511 |
| 5 m | 1,118 | 4.988670 m | 125,070 | 18,914 |

| Output file | Raw bytes | Gzip bytes |
|---|---:|---:|
| `manifest.json` | 533 | 383 |
| `segments.geojson` | 74,791 | 15,714 |
| `segments.json` | 41,295 | 3,603 |
| `services.json` | 21,430 | 3,226 |
| `stations.json` | 11,277 | 2,314 |
| **Five-file total** | **149,326** | **25,240** |

| Command | Wall time |
|---|---:|
| Raw N02 stage build (first run) | 1.82 s |
| Raw N02 stage build (determinism run) | 1.88 s |
| Stage validation | 0.47 s |
| Simplification report (1 m / 3 m / 5 m) | 2.15 s |
| Untouched live rebuild | 2.69 s |

Machine input: section GeoJSON 14,239,859 B plus station GeoJSON 3,261,590 B,
17,501,449 B total. The stage fits the configured `capital-region` output
budgets.

## 4. Cross-border pair inventory

The 13 inventory rows are retained in
`data/staging/jr-east-capital-region/kanagawa/cross-border-pairs.csv`; every row
is inventory only and is absent from the routed stage pairs.

| Service | Pair | Prefectures | Proposed N02 line / later review |
|---|---|---|---|
| keihin-tohoku | 蒲田–川崎 | 東京→神奈川 | 東海道線; 京浜東北電車線 remains a separate physical track |
| chuo-takao-fujino | 高尾–相模湖 | 東京→神奈川 | 中央線; deferred with the full Chuo run |
| chuo-takao-fujino | 藤野–上野原 | 神奈川→山梨 | 中央線; external regional neighbour, never an S6 play pair |
| sotetsu-direct | 西大井–武蔵小杉 | 東京→神奈川 | 東海道線/品鶴線; review exact shared track in combined S6 |
| nambu | 稲田堤–矢野口 | 神奈川→東京 | 南武線 |
| yokohama | 長津田–成瀬 | 神奈川→東京 | 横浜線; enclave deferred |
| yokohama | 町田–古淵 | 東京→神奈川 | 横浜線; enclave and western run deferred |
| yokohama | 橋本–相原 | 神奈川→東京 | 横浜線; deferred run |
| tokaido | 品川–川崎 | 東京→神奈川 | 東海道線 passenger main tracks |
| tokaido | 湯河原–熱海 | 神奈川→静岡 | 東海道線; external regional neighbour, never an S6 play pair |
| yokosuka | 西大井–武蔵小杉 | 東京→神奈川 | 東海道線/品鶴線 |
| shonan-shinjuku-local | 西大井–武蔵小杉 | 東京→神奈川 | 東海道線/品鶴線; possible owner after combined-S6 review |
| shonan-shinjuku-rapid-takasaki | 大崎–武蔵小杉 | 東京→神奈川 | 山手線→東海道線 at the reviewed 大崎 junction, then 品鶴線; skips 西大井 |

The inventory has 11 frozen-product adjacent pairs and the two non-catalogue
regional witnesses 藤野–上野原 and 湯河原–熱海. Tokyo–Saitama pairs on
Kanagawa-touching through services remain outside this prefecture-stage
inventory.

## 5. Acceptance results

The commands and final output summaries are recorded in
`.claude/logs/jrcr-s6p-kanagawa/acceptance-results.json`. Required checks:

1. Build twice from `/home/yuulis/yamanote-line-sugoroku/N02-25_GML/UTF-8`,
   compare output trees byte-for-byte, validate, and generate the simplification
   report.
2. Compare the oracle to built stations/services and check two-way reachability
   from `stageStartStationId` on the emitted directed segments.
3. Rebuild the untouched live dataset to a temporary directory, compare it to
   `public/data`, and verify protected paths are unchanged.
4. Run `uv run ruff check .`, `uv run ruff format --check .`, and
   `uv run pytest`: lint and format pass; 340 tests pass and 9 are skipped by
   existing raw-data/test conditions.

The live rebuild and protected-path check are regression checks only. No
`public/data`, `data/overrides`, `src`, `scripts`, or other stage was modified.

## 6. Files and local evidence

Durable stage inputs live under
`data/staging/jr-east-capital-region/kanagawa/**`; the converted no-raw-N02
coverage is in `tests/data_pipeline/test_staging_kanagawa.py`. Local generators,
raw route diagnostics, simplification output, command logs, and acceptance
summaries are under `.claude/logs/jrcr-s6p-kanagawa/`.
