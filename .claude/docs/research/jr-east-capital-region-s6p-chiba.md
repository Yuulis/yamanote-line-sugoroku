# S6P Chiba stage — validated stage inputs and measured output (2026-10-15)

Status: **BUILT AND VALIDATED**. The stage contains all **17/17 Chiba-touching product services and
152/152 Chiba stations** in the frozen product catalogue. Two raw-N02 builds are byte-identical;
artifact validation, catalogue comparison and two-way reachability from 船橋 (funabashi) pass.
This is a prefecture stage using validationProfile: stage, not a live gameplay dataset.

The six Tokyo enclave stations and prefecture-split service runs listed below are deferred to the
combined S6 dataset as directed. The three 茨城県 neighbour stations remain outside the approved
playable area. No pipeline source, live overrides, live artifacts, Tokyo stage, handoff, DESIGN or
STATE was edited.

## 1. Inputs, oracle and stage boundary

Inputs are the frozen `jr-east-capital-region-product-{catalog,services}.csv`, S0 id map,
Tokyo stage and its G1/G2 follow-up. The product catalog exclusively determines service order, exact
Chiba stop lists and first-appearance station order. Every selected Chiba run is contiguous; there is
no filtering across an out-of-prefecture gap. No service was dropped to make routing pass.

`expected-catalog.json` was authored separately by `gen_oracle.py`, before route diagnostics;
`gen_stage.py` reads and hashes it but never reads generated game output. Its hash is
`c752d29aec3048224c38f806f6c84f2d5a9a91dbf8ce1579882fe3b4bbb7dfb9`.
The raw-free tests compare this oracle with the frozen product catalogue and reject edited bytes; built-output equality is independently verified below.

`dataset.json` keeps `areaPrefectures: ["千葉県"]`, `budgetProfile: "capital-region"`,
`simplifyToleranceM: 1`, and the existing regional output/search bounding boxes. Registry order equals
the oracle station order. Representative service = first service stopping at each station. Municipalities
are curated explicitly; they were not inferred from routes. Municipality spot-checks include [倉橋 = 旭市](https://en.wikipedia.org/wiki/Kurahashi_Station)
and [馬来田 = 木更津市](https://en.wikipedia.org/wiki/Makuta_Station). `空港第２ビル` becomes display/N02 spelling
`空港第2ビル` through the existing registry normalization; product identities and stop IDs remain unchanged.

Stage start = **船橋 (`funabashi`)**, interior to both 中央・総武線各駅停車 and 総武快速線.
`dataset.json` uses `validationProfile: "stage"` and `stageStartStationId: "funabashi"`, with no
gameplay start or target fields. The generated `3-stage` manifest is validated, including the full
catalogue and two-way reachability checks. One line metadata entry per service follows Tokyo decision
D5; S6 owns grouping.

Immediate excluded neighbours are recorded in each `scope.csv`. Tokyo/Saitama neighbours are 小岩,
葛西臨海公園, 三郷, 新小岩, 北千住 and 金町. At the final regional boundaries, 取手 (茨城県取手市)
and 潮来 (茨城県潮来市) are scope-only neighbours, not registry or product stations. Source stop sequences
are corroborated by [Joban station tables](https://en.wikipedia.org/wiki/J%C5%8Dban_Line) and
[Kashima station tables](https://en.wikipedia.org/wiki/Kashima_Line); the approved in-region endpoints
continue to come from the frozen product catalog. The internal 綾瀬–亀有–金町 run is not hidden in the
Chiba oracle; it is deferred to combined S6.

## 2. Deferred scope and remaining S6 work

There is no unresolved pipeline gap for this Chiba stage. The stage profile supports an interior
start without a gameplay target while retaining catalogue, scope, route, geometry, budget and
two-way reachability checks. Raw build and artifact validation both pass.

The following are deferred to the combined four-prefecture S6 dataset, per the lead decision:

- Tokyo enclave stations **成瀬・町田・高尾** and **綾瀬・亀有・金町** (six stations total).
  They are not Chiba-prefecture product stops and are not added to this stage's oracle.
- The Kanagawa run of 横浜線 **古淵–淵野辺–矢部–相模原–橋本**, split from the adjacent route by Tokyo
  stations 成瀬・町田 and 相原; review it with the Tokyo sections in combined S6.
- 中央本線 **相模湖・藤野**, reached west of 高尾 across the Tokyo/Kanagawa boundary; review the
  boundary run in combined S6.
- 金町–松戸 on 常磐線各駅停車, retained in the cross-border inventory but deferred with the Tokyo
  enclave so the local run can be curated together.

Five S6 product-boundary pairs remain in the inventory for their own physical service tracks:
小岩–市川, 葛西臨海公園–舞浜, 三郷–南流山, 新小岩–市川 and 北千住–松戸. 金町–松戸 is also
retained for S6 but deferred with the enclave. The three 茨城 boundary rows (two 天王台–取手 services
and 十二橋–潮来) are scope evidence only; 茨城県 is outside the approved four-prefecture product
and these are not S6 routes.

Remaining S6 work is review of cross-prefecture N02 paths and visual route geometry. No composition
is inferred from coincident coordinates. The machine-readable inventory is
`data/staging/jr-east-capital-region/chiba/cross-border-pairs.csv`.

## 3. Route and composition curation

All route tables are real N02 tracks. **No transfer rows and no detour or offset exceptions** are used.
Local and rapid systems stay separate even where N02 represents their alignments with coincident
coordinates. In particular, neither 総武快速 nor 常磐快速 composes from the respective local service.
No claim is made that N02 can resolve every parallel rail physically; identical coordinates do not
establish track sharing.

The only composition is **内房線 千葉→本千葉→蘇我**, owned by `jr-sotobo` on N02 **外房線**.
Both trains use the Sotobo corridor on that common section (the Uchibo table explicitly lists the
Chiba–Soga section under Sotobo; [station/line table](https://en.wikipedia.org/wiki/Uchib%C5%8D_Line)).
Owner section filters: `allow: []`, `deny: []` throughout. The owner is in the stage dependency closure.
`composition.check_recipes` and raw `route_service` validate the recipes, exact inherited endpoints and
mixed compose/route anchor at 蘇我. Each of the two consumer paths equals its owner path coordinate by
coordinate in metric CRS. N02 section keys with positive-length overlap are:

- 千葉→本千葉: `140.11396 35.61259~140.12093 35.60167#049aa269`.
- 本千葉→蘇我: `140.12093 35.60167~140.12193 35.59958#dd1631cf`, `140.12193 35.59958~140.12794 35.58760#80b4994a`, `140.12794 35.58760~140.13012 35.58341#d430a601`, `140.13012 35.58341~140.13023 35.58318#4f13a222`, `140.13023 35.58318~140.13124 35.58113#e7c3fa1a`.

**成田空港支線 via:** `成田→空港第2ビル` uses `140.31684 35.79727`, an actual raw N02 coordinate
on the northern excursion. Without it, `build.route_service` queries sections only within 2 km of the
three station candidates: the two resulting components have nearest endpoint nodes 1,054.48 m apart.
The omitted northern piece reconnects them. A diagnostic source query including 久住 finds the real
9,995.314 m first-hop path; its northernmost raw coordinate is the via above. Supplying this on-track via
also expands the normal section query; the standard routing function then succeeds without a connector,
platform transfer, wider snap tolerance, foreign operator track or source edit. This is a curation choice,
**not an unresolved pipeline gap**. The full airport branch measures 10.884 km against 10.8 km operating
reference. `airport-probe.log` and the per-pair table below preserve the evidence.

Station numbers: JB27–39, JO24–28, JJ06–09, JL22–31, JM16–10, plus 京葉 JE07–17 and an unnumbered 蘇我.
The latter sequence matches the current [Keiyo station table](https://en.wikipedia.org/wiki/Keiy%C5%8D_Line),
including 幕張豊砂 JE13. Explicit `stationNumberRules` pin these sequences. Other sequences are left
all-empty, explicitly meaning numbering is uncurated, rather than asserting no official numbers.
Numbers are secondary evidence; the frozen product stop order remains authoritative.

Operating-distance references are independent of raw routing. Differences are within the existing
1.5 km tolerance; it was not enlarged. Derivations and source tables (accessed 2026-10-15):

- 市川–千葉: 39.2 − 15.4 = 23.8 km for local and rapid
  ([Chuo-Sobu table](https://en.wikipedia.org/wiki/Ch%C5%AB%C5%8D-S%C5%8Dbu_Line)).
- 舞浜–蘇我: 43.0 − 12.7 = 30.3 km; 高谷 5.9 km, 二俣 5.4 km
  ([Keiyo table](https://en.wikipedia.org/wiki/Keiy%C5%8D_Line)).
- 南流山–西船橋: 71.8 − 55.4 = 16.4 km
  ([Musashino table](https://en.wikipedia.org/wiki/Musashino_Line)).
- 松戸–天王台: 34.0 − 15.7 = 18.3 km for both track systems
  ([Joban table](https://en.wikipedia.org/wiki/J%C5%8Dban_Line)).
- 我孫子–成田 32.9 km; 成田–成田空港 10.8 km
  ([Narita branch tables](https://en.wikipedia.org/wiki/Narita_Line)).
- 香取–十二橋 3.0 km ([Junikyo station](https://en.wikipedia.org/wiki/J%C5%ABniky%C5%8D_Station));
  千葉–銚子 120.5 − 39.2 = 81.3 km
  ([Sobu Main table](https://en.wikipedia.org/wiki/S%C5%8Dbu_Main_Line)).
- 佐倉–松岸 75.4 km, 外房 93.3 km, 内房 119.4 + 千葉–蘇我 3.8 = 123.2 km, 東金 13.8 km:
  [JR East operating-distance appendix](https://www.jreast.co.jp/youran/pdf/2017-2018/jre_youran_shogen_p86.pdf),
  plus [Chiba–Soga table](https://en.wikipedia.org/wiki/Uchib%C5%8D_Line).
- 木更津–久留里 22.6 km ([Kururi station table](https://en.wikipedia.org/wiki/Kururi_Line)).
  The frozen product's 久留里 endpoint is preserved; no 平山/上総松丘/上総亀山 is included.

## 4. Cross-border pair inventory

**9 service/pair records, 8 distinct station pairs**: six product-internal cross-prefecture records
for combined S6, plus three regional-boundary neighbours outside the approved product (two services
at 天王台–取手 and one at 十二橋–潮来). None is routed in this stage. The first five product-boundary
pairs are retained for S6; 金町–松戸 is deferred with the enclave. The 茨城県 rows are scope-only
and must not be routed in the approved four-prefecture dataset.

| Service | Pair | Prefectures | Proposed N02 line | Disposition |
|---|---|---|---|---|
| `jr-chuo-sobu-local` | 小岩–市川 | 東京都→千葉県 | 総武線 | S6 retained; own local track, never compose from rapid |
| `jr-keiyo` | 葛西臨海公園–舞浜 | 東京都→千葉県 | 京葉線 | S6 retained; own Keiyo route |
| `jr-musashino` | 三郷–南流山 | 埼玉県→千葉県 | 武蔵野線 | S6 retained; own Musashino route |
| `jr-sobu-rapid` | 新小岩–市川 | 東京都→千葉県 | 総武線 | S6 retained; own rapid track, never compose from local |
| `jr-joban-rapid` | 北千住–松戸 | 東京都→千葉県 | 常磐線 | S6 retained; own rapid track, never compose from local |
| `jr-joban-local` | 金町–松戸 | 東京都→千葉県 | 常磐線 | Deferred to combined S6 with the Tokyo enclave; own local track |
| `jr-joban-rapid` | 天王台–取手 | 千葉県→茨城県 | 常磐線 | Scope-only neighbour outside approved 1都3県; never route |
| `jr-joban-local` | 天王台–取手 | 千葉県→茨城県 | 常磐線 | Scope-only neighbour outside approved 1都3県; never route |
| `jr-kashima` | 十二橋–潮来 | 千葉県→茨城県 | 鹿島線 | Scope-only neighbour outside approved 1都3県; never route |

## 5. Measurements

These are measurements from the successful raw-N02 build, artifact validator and simplification report, except where marked as catalogue/reachability checks.

| Metric | Result |
|---|---|
| Staged / Chiba product totals | 17/17 services; 152/152 unique Chiba stations |
| Adjacent service pairs | 166 = 163 ordinary single-line routes + 1 via route + 0 multi-N02 routes + 2 composed |
| Owned primitives / services | 164 primitives / 17 owner services |
| Directed references / maximum chain | 332 / 1 |
| Composition dependency depth | 1 (uchibo → sotobo) |
| Platform transfers / detour exceptions / offset exceptions | 0 / 0 / 0 |
| Maximum detour ratio | 1.491 (limit 1.8) |
| Maximum station-platform offset | 159.0 m (limit 250 m); pair snap offsets are 0.00 m |
| Two-way reachability from 船橋 | 152/152 reachable from start and 152/152 can return |
| Oracle versus parsed inputs | Exact service order, stop lists, first-appearance station order |
| Oracle vs built output | Exact service order, stop lists, station order and 152 stations |
| Oracle SHA-256 | `c752d29aec3048224c38f806f6c84f2d5a9a91dbf8ce1579882fe3b4bbb7dfb9` |
| Raw build wall time | 2.00 s first build; 2.04 s second build |
| Geometry references / maximum geometry chain | 332 / 1 |

Default 1 m output file sizes (raw / gzip bytes):

| File | Raw | Gzip |
|---|---:|---:|
| `stations.json` | 17,662 | 3,452 |
| `services.json` | 28,459 | 4,402 |
| `segments.json` | 53,503 | 4,901 |
| `segments.geojson` | 127,845 | 28,256 |
| `manifest.json` | 534 | 384 |
| **Five-file total** | **228,003** | **41,395** |

The 1/3/5 m output comparison follows. stations.json, services.json and segments.json stay identical
at every tolerance. manifest.json keeps the same raw size; its gzip size is 384/384/383 bytes as the
dataVersion changes with the geometry. All three runs have no budget errors; the 1 m run equals the
default output.

| Tolerance | Coordinates | Max Hausdorff m | GeoJSON raw/gzip | Five-file raw/gzip |
|---:|---:|---:|---:|---:|
| 1 m | 4,122 | 1.000830 | 127,845 / 28,256 | 228,003 / 41,395 |
| 3 m | 2,378 | 2.995822 | 91,646 / 18,792 | 191,804 / 31,931 |
| 5 m | 1,865 | 4.994164 | 80,968 / 15,931 | 181,126 / 29,069 |

Maximum measured detour ratio: **1.491447** (成田→空港第２ビル), below 1.8. Pair snap offsets are 0.000 m; no artificial platform jump is introduced.
Raw input: 17,501,449 B (sections 14,239,859 B + stations 3,261,590 B), both SHA-256 values match
`data/n02-2025.sha256`. Machine: x86_64 WSL2 Linux 6.18.54.1, 12 logical CPUs, Python 3.13.16;
warm, uncontrolled cache (no cold-cache claim).

No browser, Playwright or device parse/build/render/overview/zoom/save/restore checks were run.
The evidence is numeric; per-segment visual review remains an S6 gate.

## 6. Acceptance commands and outputs

Full commands and outputs are retained in .claude/logs/jrcr-s6p-chiba/; acceptance-stage.json,
acceptance-live.json and acceptance-tests.json record argv and exit codes.

1. The requested stage build exits 0 (real 2.00 s). A second build exits 0 (real 2.04 s);
   diff -r /tmp/jrcr-s6p-chiba /tmp/jrcr-s6p-chiba-second exits 0. Artifact validation reports
   **OK**. The simplification command exits 0; its 1/3/5 m report is simplification.json.
2. Independent artifact check: oracle exactly equals built service IDs/stop lists and station order;
   its SHA-256 matches. The 3-stage manifest names 船橋. Graph traversal over built directed segments
   reaches all 152 stations from 船橋 and reaches 船橋 from all 152.
3. Live rebuild with the same absolute --raw-dir exits 0; diff -r against public/data exits 0;
   live validation reports **OK**. The requested git diff --quiet HEAD -- public data/overrides src
   scripts data/staging/jr-east-capital-region/tokyo exits 0.
4. uv run ruff check . exits 0, **All checks passed**. uv run ruff format --check . exits 0,
   **54 files already formatted**. uv run pytest exits 0, **339 passed, 9 skipped**. Seven raw-build
   tests, one raw stage-profile test and one Tokyo G1/G2 raw test skip because the worktree-default
   N02 path is absent; stage and live builds above used the supplied read-only absolute N02 path.
   An initial format check found formatting-only differences in the rewritten Chiba test; the file
   was formatted and the final full check passed.

The route/build and artifact checks use the real pipeline. No test or validator was bypassed, no raw N02
was copied into the worktree, and no live output was modified.

## 7. Per-service measured route coverage

This table reports built stop counts and measured N02 route lengths; catalogue equality is checked separately.

| Service | Stops | Routed km | Operating reference km | Diagnostic errors |
|---|---:|---:|---:|---|
| `jr-chuo-sobu-local` | 13 | 23.656 | 23.8 | none |
| `jr-keiyo` | 12 | 30.207 | 30.3 | none |
| `jr-musashino` | 7 | 16.387 | 16.4 | none |
| `jr-musashino-takaya` | 2 | 5.892 | 5.9 | none |
| `jr-musashino-futamata` | 2 | 5.404 | 5.4 | none |
| `jr-sobu-rapid` | 5 | 23.656 | 23.8 | none |
| `jr-joban-rapid` | 4 | 18.396 | 18.3 | none |
| `jr-joban-local` | 10 | 18.396 | 18.3 | none |
| `jr-narita-abiko` | 10 | 32.999 | 32.9 | none |
| `jr-narita` | 16 | 75.311 | 75.4 | none |
| `jr-narita-airport-branch` | 3 | 10.884 | 10.8 | none |
| `jr-kashima` | 2 | 2.966 | 3.0 | none |
| `jr-sobu-main` | 22 | 80.838 | 81.3 | none |
| `jr-sotobo` | 27 | 92.387 | 93.3 | none |
| `jr-uchibo` | 32 | 123.167 | 123.2 | none |
| `jr-kururi` | 11 | 22.565 | 22.6 | none |
| `jr-togane` | 5 | 14.396 | 13.8 | none |

## 8. Per-pair raw-N02 route measurements

Metric raw N02 lengths and snap offsets; `compose` means an exact inherited owner path. These are
in-stage adjacent pairs; cross-border pairs are listed separately and are not routed in Chiba.

| Service | Pair | N02 line / recipe | Track m | Snap from/to m | Detour |
|---|---|---|---:|---:|---:|
| `jr-chuo-sobu-local` | 市川→本八幡 | 総武線 | 1954.6 | 0.00/0.00 | 1.000 |
| `jr-chuo-sobu-local` | 本八幡→下総中山 | 総武線 | 1593.6 | 0.00/0.00 | 1.000 |
| `jr-chuo-sobu-local` | 下総中山→西船橋 | 総武線 | 1524.9 | 0.00/0.00 | 1.000 |
| `jr-chuo-sobu-local` | 西船橋→船橋 | 総武線 | 2579.8 | 0.00/0.00 | 1.029 |
| `jr-chuo-sobu-local` | 船橋→東船橋 | 総武線 | 1768.0 | 0.00/0.00 | 1.000 |
| `jr-chuo-sobu-local` | 東船橋→津田沼 | 総武線 | 1810.1 | 0.00/0.00 | 1.042 |
| `jr-chuo-sobu-local` | 津田沼→幕張本郷 | 総武線 | 2848.2 | 0.00/0.00 | 1.000 |
| `jr-chuo-sobu-local` | 幕張本郷→幕張 | 総武線 | 2056.4 | 0.00/0.00 | 1.000 |
| `jr-chuo-sobu-local` | 幕張→新検見川 | 総武線 | 1681.6 | 0.00/0.00 | 1.021 |
| `jr-chuo-sobu-local` | 新検見川→稲毛 | 総武線 | 2550.4 | 0.00/0.00 | 1.076 |
| `jr-chuo-sobu-local` | 稲毛→西千葉 | 総武線 | 1899.3 | 0.00/0.00 | 1.001 |
| `jr-chuo-sobu-local` | 西千葉→千葉 | 総武線 | 1389.3 | 0.00/0.00 | 1.015 |
| `jr-keiyo` | 舞浜→新浦安 | 京葉線 | 3307.7 | 0.00/0.00 | 1.102 |
| `jr-keiyo` | 新浦安→市川塩浜 | 京葉線 | 2160.2 | 0.00/0.00 | 1.012 |
| `jr-keiyo` | 市川塩浜→二俣新町 | 京葉線 | 4359.0 | 0.00/0.00 | 1.023 |
| `jr-keiyo` | 二俣新町→南船橋 | 京葉線 | 3484.3 | 0.00/0.00 | 1.012 |
| `jr-keiyo` | 南船橋→新習志野 | 京葉線 | 2296.0 | 0.00/0.00 | 1.032 |
| `jr-keiyo` | 新習志野→幕張豊砂 | 京葉線 | 1637.5 | 0.00/0.00 | 1.000 |
| `jr-keiyo` | 幕張豊砂→海浜幕張 | 京葉線 | 1732.1 | 0.00/0.00 | 1.000 |
| `jr-keiyo` | 海浜幕張→検見川浜 | 京葉線 | 1988.3 | 0.00/0.00 | 1.001 |
| `jr-keiyo` | 検見川浜→稲毛海岸 | 京葉線 | 1624.6 | 0.00/0.00 | 1.026 |
| `jr-keiyo` | 稲毛海岸→千葉みなと | 京葉線 | 3740.6 | 0.00/0.00 | 1.027 |
| `jr-keiyo` | 千葉みなと→蘇我 | 京葉線 | 3876.5 | 0.00/0.00 | 1.042 |
| `jr-musashino` | 南流山→新松戸 | 武蔵野線 | 2067.6 | 0.00/0.00 | 1.015 |
| `jr-musashino` | 新松戸→新八柱 | 武蔵野線 | 4249.1 | 0.00/0.00 | 1.031 |
| `jr-musashino` | 新八柱→東松戸 | 武蔵野線 | 2357.4 | 0.00/0.00 | 1.000 |
| `jr-musashino` | 東松戸→市川大野 | 武蔵野線 | 1820.9 | 0.00/0.00 | 1.010 |
| `jr-musashino` | 市川大野→船橋法典 | 武蔵野線 | 3102.7 | 0.00/0.00 | 1.001 |
| `jr-musashino` | 船橋法典→西船橋 | 武蔵野線 | 2789.0 | 0.00/0.00 | 1.048 |
| `jr-musashino-takaya` | 西船橋→市川塩浜 | 京葉線 | 5892.4 | 0.00/0.00 | 1.059 |
| `jr-musashino-futamata` | 西船橋→南船橋 | 京葉線 | 5403.9 | 0.00/0.00 | 1.248 |
| `jr-sobu-rapid` | 市川→船橋 | 総武線 | 7652.8 | 0.00/0.00 | 1.014 |
| `jr-sobu-rapid` | 船橋→津田沼 | 総武線 | 3578.2 | 0.00/0.00 | 1.047 |
| `jr-sobu-rapid` | 津田沼→稲毛 | 総武線 | 9136.7 | 0.00/0.00 | 1.029 |
| `jr-sobu-rapid` | 稲毛→千葉 | 総武線 | 3288.6 | 0.00/0.00 | 1.011 |
| `jr-joban-rapid` | 松戸→柏 | 常磐線 | 11172.7 | 0.00/0.00 | 1.046 |
| `jr-joban-rapid` | 柏→我孫子 | 常磐線 | 4320.0 | 0.00/0.00 | 1.149 |
| `jr-joban-rapid` | 我孫子→天王台 | 常磐線 | 2903.3 | 0.00/0.00 | 1.008 |
| `jr-joban-local` | 松戸→北松戸 | 常磐線 | 2025.0 | 0.00/0.00 | 1.011 |
| `jr-joban-local` | 北松戸→馬橋 | 常磐線 | 1371.8 | 0.00/0.00 | 1.011 |
| `jr-joban-local` | 馬橋→新松戸 | 常磐線 | 1563.3 | 0.00/0.00 | 1.000 |
| `jr-joban-local` | 新松戸→北小金 | 常磐線 | 1260.8 | 0.00/0.00 | 1.033 |
| `jr-joban-local` | 北小金→南柏 | 常磐線 | 2480.8 | 0.00/0.00 | 1.000 |
| `jr-joban-local` | 南柏→柏 | 常磐線 | 2470.9 | 0.00/0.00 | 1.009 |
| `jr-joban-local` | 柏→北柏 | 常磐線 | 2245.5 | 0.00/0.00 | 1.041 |
| `jr-joban-local` | 北柏→我孫子 | 常磐線 | 2074.5 | 0.00/0.00 | 1.015 |
| `jr-joban-local` | 我孫子→天王台 | 常磐線 | 2903.3 | 0.00/0.00 | 1.008 |
| `jr-narita-abiko` | 我孫子→東我孫子 | 成田線 | 3504.7 | 0.00/0.00 | 1.035 |
| `jr-narita-abiko` | 東我孫子→湖北 | 成田線 | 2769.4 | 0.00/0.00 | 1.008 |
| `jr-narita-abiko` | 湖北→新木 | 成田線 | 2772.1 | 0.00/0.00 | 1.034 |
| `jr-narita-abiko` | 新木→布佐 | 成田線 | 3028.8 | 0.00/0.00 | 1.100 |
| `jr-narita-abiko` | 布佐→木下 | 成田線 | 1947.9 | 0.00/0.00 | 1.091 |
| `jr-narita-abiko` | 木下→小林 | 成田線 | 4305.8 | 0.00/0.00 | 1.031 |
| `jr-narita-abiko` | 小林→安食 | 成田線 | 4967.6 | 0.00/0.00 | 1.110 |
| `jr-narita-abiko` | 安食→下総松崎 | 成田線 | 4553.3 | 0.00/0.00 | 1.024 |
| `jr-narita-abiko` | 下総松崎→成田 | 成田線 | 5149.0 | 0.00/0.00 | 1.094 |
| `jr-narita` | 佐倉→酒々井 | 成田線 | 6308.8 | 0.00/0.00 | 1.253 |
| `jr-narita` | 酒々井→成田 | 成田線 | 6642.9 | 0.00/0.00 | 1.088 |
| `jr-narita` | 成田→久住 | 成田線 | 6974.6 | 0.00/0.00 | 1.071 |
| `jr-narita` | 久住→滑河 | 成田線 | 5476.2 | 0.00/0.00 | 1.086 |
| `jr-narita` | 滑河→下総神崎 | 成田線 | 6121.7 | 0.00/0.00 | 1.020 |
| `jr-narita` | 下総神崎→大戸 | 成田線 | 4437.8 | 0.00/0.00 | 1.036 |
| `jr-narita` | 大戸→佐原 | 成田線 | 3947.5 | 0.00/0.00 | 1.196 |
| `jr-narita` | 佐原→香取 | 成田線 | 3682.6 | 0.00/0.00 | 1.051 |
| `jr-narita` | 香取→水郷 | 成田線 | 3866.4 | 0.00/0.00 | 1.051 |
| `jr-narita` | 水郷→小見川 | 成田線 | 5148.1 | 0.00/0.00 | 1.026 |
| `jr-narita` | 小見川→笹川 | 成田線 | 5046.4 | 0.00/0.00 | 1.057 |
| `jr-narita` | 笹川→下総橘 | 成田線 | 5151.0 | 0.00/0.00 | 1.080 |
| `jr-narita` | 下総橘→下総豊里 | 成田線 | 3353.5 | 0.00/0.00 | 1.009 |
| `jr-narita` | 下総豊里→椎柴 | 成田線 | 4751.5 | 0.00/0.00 | 1.029 |
| `jr-narita` | 椎柴→松岸 | 成田線 | 4402.1 | 0.00/0.00 | 1.010 |
| `jr-narita-airport-branch` | 成田→空港第２ビル | 成田線 | 9995.3 | 0.00/0.00 | 1.491 |
| `jr-narita-airport-branch` | 空港第２ビル→成田空港 | 成田線 | 889.1 | 0.00/0.00 | 1.096 |
| `jr-kashima` | 香取→十二橋 | 鹿島線 | 2966.4 | 0.00/0.00 | 1.214 |
| `jr-sobu-main` | 千葉→東千葉 | 総武線 | 962.1 | 0.00/0.00 | 1.067 |
| `jr-sobu-main` | 東千葉→都賀 | 総武線 | 3206.0 | 0.00/0.00 | 1.000 |
| `jr-sobu-main` | 都賀→四街道 | 総武線 | 3513.7 | 0.00/0.00 | 1.067 |
| `jr-sobu-main` | 四街道→物井 | 総武線 | 4180.1 | 0.00/0.00 | 1.021 |
| `jr-sobu-main` | 物井→佐倉 | 総武線 | 3820.3 | 0.00/0.00 | 1.066 |
| `jr-sobu-main` | 佐倉→南酒々井 | 総武線 | 3932.9 | 0.00/0.00 | 1.043 |
| `jr-sobu-main` | 南酒々井→榎戸 | 総武線 | 2939.2 | 0.00/0.00 | 1.016 |
| `jr-sobu-main` | 榎戸→八街 | 総武線 | 3586.9 | 0.00/0.00 | 1.018 |
| `jr-sobu-main` | 八街→日向 | 総武線 | 5819.2 | 0.00/0.00 | 1.035 |
| `jr-sobu-main` | 日向→成東 | 総武線 | 5188.6 | 0.00/0.00 | 1.068 |
| `jr-sobu-main` | 成東→松尾 | 総武線 | 5746.1 | 0.00/0.00 | 1.081 |
| `jr-sobu-main` | 松尾→横芝 | 総武線 | 4154.2 | 0.00/0.00 | 1.016 |
| `jr-sobu-main` | 横芝→飯倉 | 総武線 | 3829.1 | 0.00/0.00 | 1.010 |
| `jr-sobu-main` | 飯倉→八日市場 | 総武線 | 3222.4 | 0.00/0.00 | 1.002 |
| `jr-sobu-main` | 八日市場→干潟 | 総武線 | 5117.5 | 0.00/0.00 | 1.010 |
| `jr-sobu-main` | 干潟→旭 | 総武線 | 4688.8 | 0.00/0.00 | 1.005 |
| `jr-sobu-main` | 旭→飯岡 | 総武線 | 2730.4 | 0.00/0.00 | 1.002 |
| `jr-sobu-main` | 飯岡→倉橋 | 総武線 | 2934.4 | 0.00/0.00 | 1.004 |
| `jr-sobu-main` | 倉橋→猿田 | 総武線 | 2589.6 | 0.00/0.00 | 1.094 |
| `jr-sobu-main` | 猿田→松岸 | 総武線 | 5511.8 | 0.00/0.00 | 1.039 |
| `jr-sobu-main` | 松岸→銚子 | 総武線 | 3165.0 | 0.00/0.00 | 1.013 |
| `jr-sotobo` | 千葉→本千葉 | 外房線 | 1611.8 | 0.00/0.00 | 1.019 |
| `jr-sotobo` | 本千葉→蘇我 | 外房線 | 2216.2 | 0.00/0.00 | 1.000 |
| `jr-sotobo` | 蘇我→鎌取 | 外房線 | 5218.5 | 0.00/0.00 | 1.074 |
| `jr-sotobo` | 鎌取→誉田 | 外房線 | 3639.8 | 0.00/0.00 | 1.005 |
| `jr-sotobo` | 誉田→土気 | 外房線 | 5427.9 | 0.00/0.00 | 1.009 |
| `jr-sotobo` | 土気→大網 | 外房線 | 4123.0 | 0.00/0.00 | 1.065 |
| `jr-sotobo` | 大網→永田 | 外房線 | 2233.1 | 0.00/0.00 | 1.046 |
| `jr-sotobo` | 永田→本納 | 外房線 | 2362.6 | 0.00/0.00 | 1.000 |
| `jr-sotobo` | 本納→新茂原 | 外房線 | 3701.9 | 0.00/0.00 | 1.000 |
| `jr-sotobo` | 新茂原→茂原 | 外房線 | 2919.3 | 0.00/0.00 | 1.150 |
| `jr-sotobo` | 茂原→八積 | 外房線 | 4527.6 | 0.00/0.00 | 1.000 |
| `jr-sotobo` | 八積→上総一ノ宮 | 外房線 | 4016.4 | 0.00/0.00 | 1.077 |
| `jr-sotobo` | 上総一ノ宮→東浪見 | 外房線 | 3358.3 | 0.00/0.00 | 1.031 |
| `jr-sotobo` | 東浪見→太東 | 外房線 | 3051.3 | 0.00/0.00 | 1.021 |
| `jr-sotobo` | 太東→長者町 | 外房線 | 2712.1 | 0.00/0.00 | 1.018 |
| `jr-sotobo` | 長者町→三門 | 外房線 | 1600.9 | 0.00/0.00 | 1.002 |
| `jr-sotobo` | 三門→大原 | 外房線 | 3561.4 | 0.00/0.00 | 1.006 |
| `jr-sotobo` | 大原→浪花 | 外房線 | 3386.4 | 0.00/0.00 | 1.017 |
| `jr-sotobo` | 浪花→御宿 | 外房線 | 4948.7 | 0.00/0.00 | 1.067 |
| `jr-sotobo` | 御宿→勝浦 | 外房線 | 5434.4 | 0.00/0.00 | 1.028 |
| `jr-sotobo` | 勝浦→鵜原 | 外房線 | 3494.8 | 0.00/0.00 | 1.072 |
| `jr-sotobo` | 鵜原→上総興津 | 外房線 | 2819.5 | 0.00/0.00 | 1.070 |
| `jr-sotobo` | 上総興津→行川アイランド | 外房線 | 3225.4 | 0.00/0.00 | 1.046 |
| `jr-sotobo` | 行川アイランド→安房小湊 | 外房線 | 3812.3 | 0.00/0.00 | 1.098 |
| `jr-sotobo` | 安房小湊→安房天津 | 外房線 | 3409.4 | 0.00/0.00 | 1.063 |
| `jr-sotobo` | 安房天津→安房鴨川 | 外房線 | 5574.6 | 0.00/0.00 | 1.100 |
| `jr-uchibo` | 千葉→本千葉 | compose jr-sotobo (外房線) | 1611.8 | 0.00/0.00 | 1.019 |
| `jr-uchibo` | 本千葉→蘇我 | compose jr-sotobo (外房線) | 2216.2 | 0.00/0.00 | 1.000 |
| `jr-uchibo` | 蘇我→浜野 | 内房線 | 3430.2 | 0.00/0.00 | 1.028 |
| `jr-uchibo` | 浜野→八幡宿 | 内房線 | 2128.8 | 0.00/0.00 | 1.022 |
| `jr-uchibo` | 八幡宿→五井 | 内房線 | 3754.3 | 0.00/0.00 | 1.000 |
| `jr-uchibo` | 五井→姉ケ崎 | 内房線 | 5833.0 | 0.00/0.00 | 1.008 |
| `jr-uchibo` | 姉ケ崎→長浦 | 内房線 | 5298.4 | 0.00/0.00 | 1.007 |
| `jr-uchibo` | 長浦→袖ケ浦 | 内房線 | 4028.6 | 0.00/0.00 | 1.001 |
| `jr-uchibo` | 袖ケ浦→巌根 | 内房線 | 2966.1 | 0.00/0.00 | 1.041 |
| `jr-uchibo` | 巌根→木更津 | 内房線 | 3806.1 | 0.00/0.00 | 1.017 |
| `jr-uchibo` | 木更津→君津 | 内房線 | 7110.3 | 0.00/0.00 | 1.184 |
| `jr-uchibo` | 君津→青堀 | 内房線 | 3521.9 | 0.00/0.00 | 1.046 |
| `jr-uchibo` | 青堀→大貫 | 内房線 | 4675.8 | 0.00/0.00 | 1.080 |
| `jr-uchibo` | 大貫→佐貫町 | 内房線 | 4161.8 | 0.00/0.00 | 1.047 |
| `jr-uchibo` | 佐貫町→上総湊 | 内房線 | 4468.0 | 0.00/0.00 | 1.049 |
| `jr-uchibo` | 上総湊→竹岡 | 内房線 | 4997.7 | 0.00/0.00 | 1.087 |
| `jr-uchibo` | 竹岡→浜金谷 | 内房線 | 3841.6 | 0.00/0.00 | 1.151 |
| `jr-uchibo` | 浜金谷→保田 | 内房線 | 3455.0 | 0.00/0.00 | 1.047 |
| `jr-uchibo` | 保田→安房勝山 | 内房線 | 3293.6 | 0.00/0.00 | 1.073 |
| `jr-uchibo` | 安房勝山→岩井 | 内房線 | 2922.1 | 0.00/0.00 | 1.054 |
| `jr-uchibo` | 岩井→富浦 | 内房線 | 5994.2 | 0.00/0.00 | 1.129 |
| `jr-uchibo` | 富浦→那古船形 | 内房線 | 2332.6 | 0.00/0.00 | 1.024 |
| `jr-uchibo` | 那古船形→館山 | 内房線 | 3916.5 | 0.00/0.00 | 1.031 |
| `jr-uchibo` | 館山→九重 | 内房線 | 5812.1 | 0.00/0.00 | 1.288 |
| `jr-uchibo` | 九重→千倉 | 内房線 | 4803.2 | 0.00/0.00 | 1.052 |
| `jr-uchibo` | 千倉→千歳 | 内房線 | 2030.7 | 0.00/0.00 | 1.045 |
| `jr-uchibo` | 千歳→南三原 | 内房線 | 3673.0 | 0.00/0.00 | 1.046 |
| `jr-uchibo` | 南三原→和田浦 | 内房線 | 4554.0 | 0.00/0.00 | 1.049 |
| `jr-uchibo` | 和田浦→江見 | 内房線 | 4638.9 | 0.00/0.00 | 1.046 |
| `jr-uchibo` | 江見→太海 | 内房線 | 4468.2 | 0.00/0.00 | 1.166 |
| `jr-uchibo` | 太海→安房鴨川 | 内房線 | 3422.2 | 0.00/0.00 | 1.149 |
| `jr-kururi` | 木更津→祇園 | 久留里線 | 2603.3 | 0.00/0.00 | 1.129 |
| `jr-kururi` | 祇園→上総清川 | 久留里線 | 1610.7 | 0.00/0.00 | 1.026 |
| `jr-kururi` | 上総清川→東清川 | 久留里線 | 1860.5 | 0.00/0.00 | 1.010 |
| `jr-kururi` | 東清川→横田 | 久留里線 | 3199.5 | 0.00/0.00 | 1.020 |
| `jr-kururi` | 横田→東横田 | 久留里線 | 1436.4 | 0.00/0.00 | 1.000 |
| `jr-kururi` | 東横田→馬来田 | 久留里線 | 3129.8 | 0.00/0.00 | 1.054 |
| `jr-kururi` | 馬来田→下郡 | 久留里線 | 1351.0 | 0.00/0.00 | 1.006 |
| `jr-kururi` | 下郡→小櫃 | 久留里線 | 3017.8 | 0.00/0.00 | 1.008 |
| `jr-kururi` | 小櫃→俵田 | 久留里線 | 1811.2 | 0.00/0.00 | 1.193 |
| `jr-kururi` | 俵田→久留里 | 久留里線 | 2545.1 | 0.00/0.00 | 1.037 |
| `jr-togane` | 大網→福俵 | 東金線 | 3846.5 | 0.00/0.00 | 1.020 |
| `jr-togane` | 福俵→東金 | 東金線 | 2523.6 | 0.00/0.00 | 1.008 |
| `jr-togane` | 東金→求名 | 東金線 | 3705.5 | 0.00/0.00 | 1.008 |
| `jr-togane` | 求名→成東 | 東金線 | 4320.4 | 0.00/0.00 | 1.260 |
