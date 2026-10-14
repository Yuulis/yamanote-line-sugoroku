# S6P Tokyo stage — JR East 1都3県 regional staging evidence (2026-10-14)

Status: **validated**. The Tokyo stage builds from raw N02 and validates with **21 of the 23
Tokyo-touching product services, all with their complete Tokyo stop lists, and 137 of the 142 Tokyo stations**.
The 5 stations not staged are 成瀬, 町田, 綾瀬, 亀有 and 金町 (§1, D3).

Update 2026-10-14 (branch `feature/jrcr-s6p-tokyo-g1g2`, after pipeline PR #15 `111ff95`): decisions D1, D2 and D4
are applied (§8).
- `jr-joban-rapid` is now the full product run 品川–北千住, using a reviewed platform transfer at 上野
  (`platform_transfers.csv`).
- shonan-shinjuku-local composes 池袋→新宿 from saikyo.
- The 赤羽–池袋 surrogate stays.

Nothing under `data/overrides`, `public/data`, `src` or `scripts` was changed by the stage.

First stage: branch `feature/jrcr-s6p-tokyo` (merged as PR #14). Reviewed inputs:
`data/staging/jr-east-capital-region/tokyo/overrides/**`. Generated outputs: `/tmp/jrcr-s6p-tokyo/`,
`/tmp/jrcr-s6p-tokyo-simplification.json` (ephemeral). Generators and logs (gitignored, kept for the lead):
`.claude/logs/jrcr-s6p-tokyo/{gen_oracle,gen_stage,probe,pairdebug,measure,evidence}.py`,
`build-g1g2.log`, `validate-g1g2.log`, `measure-g1g2.log`, `probe-g1g2.log`, `hubs-g1g2.log` (current)
and the first-stage `*-final.log`,
`codex-review.json` (review: `.claude/logs/codex/20261014T010729Z-s6p-tokyo-review*.md`).

## 1. Stage contents and curation rules

The oracle (`expected-catalog.json`) is written by `gen_oracle.py` from the frozen product catalog only
(never from build output), then pinned in `dataset.json` (`expectedCatalogSha256`
`25bc9e50ef0bb67494b0c24c7b81610acdcb62d1374707cfcc50f81565d8d224`; the first stage, with the joban fragment, was
`747a78c9…2363`). Rules:

1. Product services in product order with at least two 東京都 stops; only 東京都 stops, product order.
2. `jr-chuo-takao-fujino` excluded: only 高尾 is in 東京都 (a service needs two stops). 高尾 stays via 中央線快速.
3. `jr-joban-local` excluded: 綾瀬–亀有–金町 reach the rest of the network only through 松戸 (千葉県);
   the stage would fail two-way reachability. Stations 綾瀬/亀有/金町 deferred.
4. `jr-yokohama`: Tokyo stops are not contiguous (成瀬–町田 | 古淵…橋本 in 神奈川県 | 相原–八王子).
   Staged run = 相原–八王子 (contains the 八王子 transfer). 成瀬/町田 deferred to the Kanagawa stage.
   The scope evidence starts at the excluded neighbour 橋本; no out-of-area gap is bridged.
5. `jr-joban-rapid`: full product Tokyo run 品川–新橋–東京–上野–日暮里–三河島–南千住–北千住 (8 stops).
   上野 is routed with a reviewed platform transfer (§5.2). The earlier 上野–北千住 fragment and its
   artificial 上野 endpoint are gone.

Services (output order = product order): yamanote 30, keihin-tohoku 22, chuo-sobu-local 26 (三鷹–小岩),
chuo-rapid 24, ome 25, itsukaichi 7, hachiko 6, saikyo 10, sotetsu-direct 5, keiyo 6, musashino 5,
nambu 10, yokohama 4, tokaido 3, yokosuka 4, sobu-rapid 5, utsunomiya 4, takasaki 4,
shonan-shinjuku-local 7, shonan-shinjuku-rapid-takasaki 6, joban-rapid 8.

Copied unchanged from live `data/overrides`: yamanote, keihin-tohoku, saikyo, keiyo (definition, stops,
scope, line mapping) and the 67 registry rows. Chuo-Sobu local is the live service extended to 三鷹
(`terminus`; JB01–JB26). New registry rows: 70 stations, `prefecture` 東京都, municipality per row,
representative = first stage service stopping there, N02 spelling from the S0 id map (箱根ヶ崎 etc.).
Line metadata: one line per service (line id = service id, JR colour); S6 owns legend grouping.
`dataset.json`: `areaPrefectures: ["東京都"]`, no municipality restriction, regional bboxes,
`budgetProfile: "capital-region"`, `simplifyToleranceM: 1`, start 新橋, target 山手線.

Endpoint kinds and scope evidence (first excluded neighbour at each `area-boundary`): chuo-sobu-local
三鷹 terminus / 小岩→市川; chuo-rapid 東京 terminus / 高尾 service-boundary; ome terminus/terminus;
itsukaichi 拝島 service-boundary / terminus; hachiko 八王子 terminus / 箱根ケ崎→金子 (入間市);
sotetsu-direct 新宿 service-boundary / 西大井→武蔵小杉; musashino 府中本町 terminus / 新秋津→東所沢;
nambu 稲田堤→矢野口 / 立川 terminus; yokohama 橋本→相原 / 八王子 terminus; tokaido 東京 service-boundary /
品川→川崎; yokosuka 東京 service-boundary / 西大井→武蔵小杉; sobu-rapid 東京 service-boundary / 新小岩→市川;
utsunomiya and takasaki 東京 service-boundary / 赤羽→浦和; shonan-shinjuku-local 浦和→赤羽 / 西大井→武蔵小杉;
shonan-shinjuku-rapid-takasaki 浦和→赤羽 / 大崎→武蔵小杉; joban-rapid 品川 service-boundary / 北千住→松戸.

Length references (`lengthRef`, tolerance 1.5 km; Wikipedia station tables accessed 2026-10-14) and
measured track length: chuo-sobu-local 33.8 / 34.21; chuo-rapid 53.1 / 53.05; ome 37.2 / 37.07;
itsukaichi 11.1 / 11.07; hachiko 15.7 / 15.84; sotetsu-direct 10.8 / 11.06 (8.6 + 大崎支線 2.2);
musashino 13.0 / 13.12; nambu 13.1 / 12.97; yokohama 6.9 / 6.67; tokaido 6.8 / 6.69; yokosuka 10.4 / 10.28;
sobu-rapid 10.0 / 9.94; utsunomiya, takasaki 13.4 (尾久経由) / 13.28; shonan-shinjuku-local 26.9 / 26.30;
shonan-shinjuku-rapid 24.7 / 23.72; joban-rapid 17.8 / 17.55 (品川–東京 6.8 + 東京–上野 3.6 + 上野–日暮里 2.2 +
日暮里–北千住 5.2). 大崎–西大井 uses the physical
大崎支線 distance 2.2 km (大崎–蛇窪 1.7 + 蛇窪–西大井 0.5, Wikipedia 蛇窪信号場), not the 5.6 km fare route.
Station numbers are pinned (`stationNumberRules`) where single-prefix and sourced: JB, JC, JN17–26,
JH29–32, JT01–03, JO19–16, JO19–23, JU01–04, JS22–16/17, and for joban-rapid an explicit sequence
(three unnumbered 上野東京ライン stops, then JJ01–JJ05); ome, itsukaichi, hachiko, musashino and
sotetsu-direct carry none (legacy empty rule).

## 2. Commands and results (current stage)

| Check | Result |
|---|---|
| `/usr/bin/time -p uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/staging/jr-east-capital-region/tokyo/overrides --out-dir /tmp/jrcr-s6p-tokyo` | exit 0, real 2.56 s |
| `uv run python -m scripts.data_pipeline.validate --overrides-dir … --data-dir /tmp/jrcr-s6p-tokyo` | `OK` (exit 0) |
| `uv run python -m scripts.data_pipeline.simplification --raw-dir N02-25_GML/UTF-8 --overrides-dir … --out-file /tmp/jrcr-s6p-tokyo-simplification.json` | exit 0, no budget errors |
| Second build into `/tmp/jrcr-s6p-tokyo-b`, `diff -r` | identical (deterministic) |
| Oracle vs built `services.json` / `stations.json` (`measure.py`) | service order, every stop list, station order: all equal |
| Two-way reachability over built directed segments | 137/137 from 新橋 and 137/137 back |
| Live rebuild `build --raw-dir N02-25_GML/UTF-8 --quiet --out-dir $(mktemp -d)` + `diff -r … public/data` | no differences |
| `git diff --quiet HEAD -- public data/overrides src scripts` | exit 0 |
| `uv run ruff check .` / `uv run ruff format --check .` | pass / 51 files formatted |
| `uv run pytest` | 306 passed (includes the raw-N02 G1/G2 proof and `test_staging_tokyo.py` unchanged) |
| Generators reproduce the committed first stage before the edit | regenerated files identical to HEAD |

## 3. Measurements

| Metric | Value |
|---|---|
| Canonical +1 pairs | 201 = 179 single-line route + 4 single-line route with via + 2 multi-N02 route + 16 compose (first stage: 198 = 177 + 4 + 2 + 15) |
| Multi-N02 routes | 湘南新宿 local 赤羽→池袋 (東北線→山手線), 大崎→西大井 (山手線→東海道線) |
| Compose pairs | takasaki 3 ← utsunomiya; shonan-shinjuku-local 4 (池袋→新宿→渋谷→恵比寿→大崎) ← saikyo; shonan-shinjuku-rapid 5 ← shonan-shinjuku-local; sotetsu-direct 4 ← shonan-shinjuku-local |
| Platform transfers | 1: joban-rapid at 上野, limit 150 m, chosen 131.0 m (arrival feature (-5170.8,-31796.5), departure (-5050.9,-31743.9), EPSG:6677) |
| Owned primitives / unique owners | 185 primitives (first stage 183: +3 joban 品川–上野 pairs, −1 duplicate 山手貨物線 池袋–新宿), 18 owner services of 21 (non-owners: takasaki, shonan-shinjuku-rapid, sotetsu-direct) |
| Directed segments / references / max chain | 372 / 372 / 1 (each composed hop maps one owner primitive) |
| Max compose dependency depth | 2 (shonan-shinjuku-rapid → shonan-shinjuku-local → saikyo; sotetsu-direct → shonan-shinjuku-local → saikyo) |
| Transfer stations (≥2 services) | 40; largest hubs 東京 10, 新宿 7, 赤羽 6, 新橋/品川/大崎/恵比寿/渋谷/上野 5 |
| Validator | max detour 1.964 (reviewed exception), max endpoint distance 130.956 m (the 上野 departure side, allowed 30 + 150 m; all other endpoints ≤ 24.5 m), max platform offset 386.0 m (東京 京葉, live exception), min same-service skipped-stop distance 653.3 m |

Payload at the 1 m default (capital-region profile: GeoJSON 1,572,864 / 460,800 B; total 3,145,728 / 921,600 B):

| File | Raw B | Gzip B |
|---|---:|---:|
| `segments.geojson` | 107,159 | 20,301 |
| `segments.json` | 60,731 | 5,608 |
| `services.json` | 34,158 | 4,665 |
| `stations.json` | 15,976 | 3,166 |
| `manifest.json` | 456 | 338 |
| **Five files** | **218,480** | **34,078** |

Simplification (`/tmp/jrcr-s6p-tokyo-simplification.json`; 372 references, max chain 1 at every tolerance):

| Tolerance | GeoJSON raw / gzip | Five-file raw / gzip | Coordinates | Max Hausdorff | Budget errors | = default output |
|---|---:|---:|---:|---:|---|---|
| 1 m | 107,159 / 20,301 | 218,480 / 34,078 | 2,844 | 0.999689 m | none | yes |
| 3 m | 86,114 / 14,982 | 197,435 / 28,760 | 1,833 | 2.990683 m | none | no |
| 5 m | 78,169 / 12,883 | 189,490 / 26,661 | 1,452 | 4.983988 m | none | no |

Build wall time (`/usr/bin/time -p`, whole command incl. `uv` start-up), current stage: 2.56 s (first run),
warm 2.48 / 2.33 / 2.37 s, and 2.40 s with "cold input". First stage: warm 3.39 / 2.82 / 2.91 / 2.80 s,
"cold input" 2.34 / 2.52 s. "Cold input" means the two raw GeoJSON files were evicted from the page cache with
`posix_fadvise(DONTNEED)` (Python/venv not evicted; true cold boot not measurable without root).
Raw input 17,501,449 B (`N02-25_RailroadSection.geojson` 14,239,859 + `N02-25_Station.geojson` 3,261,590).
Machine: 13th Gen Intel Core i5-1335U, 12 logical CPUs, 7 GiB RAM, WSL2 kernel 6.18.54.1, Python 3.13.16.
With depth 2 and 2.4–3.4 s total, a shared per-build flattening cache is **not needed** for this stage.

Not measured here (separate gates): device parse/build/render, map overview/zoom, save/restore.
Per-segment *visual* review was not performed in a browser; the evidence below is numeric
(path length, snap offsets, detour ratio, Hausdorff against neighbouring owners, platform offsets).

## 4. Shared-track and composition evidence

Composition is used only where trains physically share one track; every compose leg names the owner's
N02 lines with empty section filters (the owners have none), and the S3b check
(`composition.flatten_recipe`) verified each flattened owner's lines/filters.

| Consumer pairs | Owner | Physical evidence | N02 evidence |
|---|---|---|---|
| takasaki 東京→上野→尾久→赤羽 | utsunomiya | 上野東京ライン / 東北本線列車線 via 尾久 carry both 宇都宮線 and 高崎線 trains (Wikipedia 上野東京ライン) | owner routes N02 東北線; 13.28 km vs 実キロ 13.4 |
| shonan-shinjuku-local 池袋→新宿→渋谷→恵比寿→大崎 | saikyo | 山手貨物線 is one double track for 埼京線, 湘南新宿ライン, 相鉄直通 (Wikipedia 湘南新宿ライン) | owner (live saikyo) routes N02 山手線 |
| shonan-shinjuku-rapid all 5 pairs | shonan-shinjuku-local (nested to saikyo for 3) | both 湘南新宿 systems use 東北貨物線–田端信号場–山手貨物線 | lines 東北線+山手線 (赤羽→池袋), 山手線 |
| sotetsu-direct 新宿→…→大崎→西大井 | shonan-shinjuku-local (nested to saikyo for 3) | 相鉄・JR直通線 trains use 山手貨物線 and 大崎支線→品鶴線 like 湘南新宿 | lines 山手線; 山手線+東海道線 (大崎→西大井) |

Deliberately **not** composed (separate physical tracks even where N02 geometry coincides):

- 中央線快速 vs 中央・総武緩行 三鷹–中野/御茶ノ水: N02 中央線 is one polyline, so both owners' primitives are
  geometrically identical (Hausdorff 0.0 m on 三鷹–吉祥寺–西荻窪–荻窪–阿佐ケ谷–高円寺–中野). Separate owners kept.
- 東海道線 vs 京浜東北/山手 東京–品川, 東海道線 vs 横須賀線, 宇都宮/高崎 vs 京浜東北 東京–上野–赤羽,
  総武快速 vs 総武緩行 錦糸町–新小岩, 京浜東北 vs 埼京 赤羽: all separate tracks, all route-only.
- joban-rapid 品川–新橋–東京 and 東京–上野 physically share the 上野東京ライン tracks with tokaido and utsunomiya,
  but joban owns its own primitives there (lead decision: recipe 3 not adopted, see §8). Its 品川–東京 primitives
  equal tokaido's surface geometry (Hausdorff 0.0 m). Its 東京–上野 primitive is 64.2 m Hausdorff from utsunomiya's,
  because it uses a different 東京 platform feature.

Exact anchors: the build's `composition_build.composed_pairs` / `inherited_candidates` /
`check_inherited_route_anchors` and the validator's `check_composed_artifacts` passed for all 16 composed hops. This
includes the two mixed route/compose stops of shonan-shinjuku-local:
- 池袋: the routed 東北線→山手線 surrogate meets saikyo's inherited anchor exactly. This was enabled by G1: the anchor
  now carries 山手線, the line of the primitive it sits on, not saikyo's 赤羽線 platform line.
- 大崎: saikyo's anchor meets the routed 大崎→西大井 multi-line route.

It also includes the cross-owner
stop 大崎 for sotetsu-direct (saikyo-owned 恵比寿→大崎, shonan-owned 大崎→西大井). Composed consumers'
platform coordinates equal the owners' primitive endpoints (e.g. 大崎 all five services at the same point).

## 5. N02 findings

### 5.1 池袋–赤羽 (湘南新宿ライン): reviewed surrogate kept (D2(a)), N02 gap still open

N02 has no 駒込–田端信号場 freight curve. The staged route is `東北線 → 山手線` with joint
`(139.7585, 35.74006)`, the N02 vertex ~300 m north-west of 田端 where the 山手線 (from 駒込) and 東北線
(from 上中里) passenger corridors merge (shared vertex; both continue together to 田端). The path passes
0 m from 東十条/王子/上中里/駒込/巣鴨/大塚 and 400 m from the 田端 platforms (it does not enter 田端), but it
makes an **acute switchback at the merge vertex**: it is a surrogate, not the physical freight link (Codex
review finding, accepted). Length 10,472 m (actual 11.3 km per the Wikipedia 湘南新宿ライン station table;
fare route via 赤羽線 5.5 km; the earlier research estimate "~9.5 km" is superseded by that table). Detour
ratio 1.96 → reviewed exception 2.1 for both 湘南新宿 services (`detour_exceptions.csv`). Alternatives measured:
赤羽線 5,498 m (ratio 1.03; wrong physical track, passes 十条/板橋); other merge vertices 11,032 / 11,510 m.

### 5.2 上野: 上野東京ライン is disconnected from the 常磐線 tracks (joban-rapid) — resolved by a platform transfer

N02 東北線 near 上野 has two components (EPSG:6677 coordinates):
- the component reaching 東京 (上野東京ライン), with 上野 platform features (-5200.6,-31815.4) and (-5170.8,-31796.5);
- the 上野 tracks that join 常磐線 at 日暮里, with features (-5159.4,-31867.1) and (-5050.9,-31743.9).

The two components come within **17.0 m** of each other near (139.77962, 35.71797), without a shared vertex or crossing.
With one platform per stop the route failed with `no connected path reaches S[5]`. Actual through trains use
上野's elevated platforms (JR East station guide), so this is a source-geometry gap. D1(a) chose a pipeline
feature (PR #15), not a synthetic connector. `platform_transfers.csv` row:

```csv
jr-joban-rapid,ueno,150,"N02 東北線 at 上野: 上野東京ライン component and the component joining 常磐線 are disconnected (17 m); arrive on the former, depart from the latter"
```

The service now arrives at (-5170.8,-31796.5) and departs from (-5050.9,-31743.9), a 131.0 m transfer. No track is
drawn between the two platforms; the published platform point is the arrival feature. The full run is 17.545 km
against 17.8 km 営業キロ. 日暮里 itself is fine: the 常磐線 feature snaps 0.0 m to both lines.
Visual consequence: the animation jumps 131 m at 上野.

### 5.3 Other recipe facts

- 東京 has no N02 `中央線` platform; the nearest 中央線 section begins ~1.1 km away (south of 神田). chuo-rapid
  東京→神田 is routed on N02 東北線 (1,222 m; snap 0/0) — an **approximation**: the built primitive lies within
  3 m of the 東北縦貫線 path and shares utsunomiya's 東京 platform point; JR's separate 中央線 platforms are not
  in N02.
- 大崎支線 is N02 山手線 (大崎→旧蛇窪), 品鶴線 is N02 東海道線; they share vertex (139.7328, 35.61677).
  大崎→西大井 = 2,583 m (physical ≈ 2.2 km).
- 東京–品川 has two N02 東海道線 alignments ~195–219 m apart: the surface corridor shared with 山手/京浜東北
  geometry and the 総武・横須賀 tunnel (東京 underground feature co-located with 総武線 003760). Without via
  points the DP swapped them (tokaido took the tunnel). Via points now pin tokaido to the surface
  (139.765520 35.677800; 139.751530 35.647660) and yokosuka to the tunnel (139.764130 35.680140;
  139.750640 35.644960); yokosuka's 東京 point equals sobu-rapid's.
- 宇都宮/高崎 上野→尾久→赤羽 follows the 尾久 branch (4,689 + 4,896 m vs 営業キロ 4.8 + 5.0).
- No out-of-area gap is bridged; no 国立支線 recipe needed (武蔵野線 Tokyo stops are 府中本町–新秋津).

## 6. Hub and branch review

| Hub | Services | Notes |
|---|---:|---|
| 東京 | 10 | 京葉 386 m (live exception); yokosuka/sobu-rapid tunnel point 145 m from the 山手 representative; joban-rapid on the 東北縦貫線 feature |
| 新宿 | 7 | 山手貨物線 group (saikyo, 湘南 ×2, 相鉄) 184.9 m from the 山手 platform (unchanged live saikyo value) |
| 赤羽 | 6 | 湘南 starts on 東北線 feature 003157; utsunomiya/takasaki share owner geometry |
| 大崎 | 5 | single N02 feature; all five services at one exact point (cross-owner anchor) |
| 上野 | 5 | joban-rapid: platform transfer (arrives on the 上野東京ライン feature, departs from the 地平 feature 131.0 m away) |
| 新橋 / 品川 | 5 each | joban-rapid joins on tokaido's surface alignment; yokosuka stays in the tunnel (品川 128.7 m) |
| 立川 / 八王子 / 拝島 | 3 each | branch hubs (青梅/南武, 八高/横浜, 青梅/五日市/八高); offsets ≤ 139.1 m (横浜線 at 八王子) |

All other platform offsets are ≤ 74.1 m. Branches: 五日市線 (拝島), 八高線 (八王子/拝島), 青梅線 (立川) and
南武線 (立川) route on their own N02 lines; joins at 立川/拝島 are separate N02 components (known 24–25 m gaps)
and need no joint because each service stays on its own line.

## 7. Per-segment metrics (raw-build probe, one row per canonical +1 pair)

Track length and snap offsets of the metric routed path; detour = path / straight platform distance;
start platform = the departure N02 feature (line/station code). Composed rows show the inherited owner path; their
start-platform line is the line of the owner primitive (G1), with the owner feature's code.

| Service | Pair (+1) | Recipe | N02 line(s) | Track m | Snap m | Detour | Start platform |
|---|---|---|---|---:|---|---:|---|
| yamanote | shimbashi→hamamatsucho | route | 東海道線 | 1233 | 0.0/0.0 | 1.01 | 東海道線/003872 |
|  | hamamatsucho→tamachi | route | 東海道線 | 1460 | 0.0/0.0 | 1.06 | 東海道線/003949 |
|  | tamachi→takanawa-gateway | route | 東海道線 | 1369 | 0.0/0.0 | 1.04 | 東海道線/004000 |
|  | takanawa-gateway→shinagawa | route | 東海道線 | 836 | 0.0/0.0 | 1.01 | 東海道線/004061 |
|  | shinagawa→osaki | route | 山手線 | 2081 | 0.0/0.0 | 1.60 | 山手線/004097 |
|  | osaki→gotanda | route | 山手線 | 824 | 0.0/0.0 | 1.00 | 山手線/004135 |
|  | gotanda→meguro | route | 山手線 | 1059 | 0.0/0.0 | 1.04 | 山手線/004110 |
|  | meguro→ebisu | route | 山手線 | 1621 | 0.0/0.0 | 1.01 | 山手線/004071 |
|  | ebisu→shibuya | route | 山手線 | 1490 | 0.0/0.0 | 1.01 | 山手線/003992 |
|  | shibuya→harajuku | route | 山手線 | 1478 | 0.0/0.0 | 1.01 | 山手線/003932 |
|  | harajuku→yoyogi | route | 山手線 | 1423 | 0.0/0.0 | 1.03 | 山手線/003828 |
|  | yoyogi→shinjuku | route | 山手線 | 767 | 0.0/0.0 | 1.00 | 山手線/003743 |
|  | shinjuku→shin-okubo | route | 山手線 | 1172 | 0.0/0.0 | 1.01 | 山手線/003701 |
|  | shin-okubo→takadanobaba | route | 山手線 | 1371 | 0.0/0.0 | 1.00 | 山手線/003601 |
|  | takadanobaba→mejiro | route | 山手線 | 860 | 0.0/0.0 | 1.00 | 山手線/003508 |
|  | mejiro→ikebukuro | route | 山手線 | 1181 | 0.0/0.0 | 1.00 | 山手線/003470 |
|  | ikebukuro→otsuka | route | 山手線 | 1822 | 0.0/0.0 | 1.19 | 山手線/003390 |
|  | otsuka→sugamo | route | 山手線 | 1211 | 0.0/0.0 | 1.06 | 山手線/003375 |
|  | sugamo→komagome | route | 山手線 | 781 | 0.0/0.0 | 1.00 | 山手線/003356 |
|  | komagome→tabata | route | 山手線 | 1462 | 0.0/0.0 | 1.19 | 山手線/003343 |
|  | tabata→nishi-nippori | route | 東北線 | 765 | 0.0/0.0 | 1.00 | 山手線/003335 |
|  | nishi-nippori→nippori | route | 東北線 | 656 | 0.0/0.0 | 1.00 | 東北線/003373 |
|  | nippori→uguisudani | route | 東北線 | 913 | 0.0/0.0 | 1.00 | 東北線/003420 |
|  | uguisudani→ueno | route | 東北線 | 1062 | 0.0/0.0 | 1.14 | 東北線/003460 |
|  | ueno→okachimachi | route | 東北線 | 694 | 0.0/0.0 | 1.03 | 東北線/003504 |
|  | okachimachi→akihabara | route | 東北線 | 974 | 0.0/0.0 | 1.00 | 東北線/003555 |
|  | akihabara→kanda | route | 東北線 | 781 | 0.0/0.0 | 1.01 | 東北線/003625 |
|  | kanda→tokyo | route | 東北線 | 1257 | 0.0/0.0 | 1.00 | 東北線/003678 |
|  | tokyo→yurakucho | route | 東海道線 | 742 | 0.0/0.0 | 1.02 | 東北線/003766 |
|  | yurakucho→shimbashi | route | 東海道線 | 1106 | 0.0/0.0 | 1.04 | 東海道線/003798 |
| keihin-tohoku | akabane→higashi-jujo | route | 東北線 | 1633 | 0.0/0.0 | 1.02 | 東北線/003157 |
|  | higashi-jujo→oji | route | 東北線 | 1663 | 0.0/0.0 | 1.01 | 東北線/003210 |
|  | oji→kami-nakazato | route | 東北線 | 918 | 0.0/0.0 | 1.01 | 東北線/003241 |
|  | kami-nakazato→tabata | route | 東北線 | 1781 | 0.0/0.0 | 1.01 | 東北線/003277 |
|  | tabata→nishi-nippori | route | 東北線 | 765 | 0.0/0.0 | 1.00 | 東北線/003336 |
|  | nishi-nippori→nippori | route | 東北線 | 656 | 0.0/0.0 | 1.00 | 東北線/003373 |
|  | nippori→uguisudani | route | 東北線 | 913 | 0.0/0.0 | 1.00 | 東北線/003420 |
|  | uguisudani→ueno | route | 東北線 | 1062 | 0.0/0.0 | 1.14 | 東北線/003460 |
|  | ueno→okachimachi | route | 東北線 | 694 | 0.0/0.0 | 1.03 | 東北線/003504 |
|  | okachimachi→akihabara | route | 東北線 | 974 | 0.0/0.0 | 1.00 | 東北線/003555 |
|  | akihabara→kanda | route | 東北線 | 781 | 0.0/0.0 | 1.01 | 東北線/003625 |
|  | kanda→tokyo | route | 東北線 | 1257 | 0.0/0.0 | 1.00 | 東北線/003678 |
|  | tokyo→yurakucho | route | 東海道線 | 742 | 0.0/0.0 | 1.02 | 東北線/003766 |
|  | yurakucho→shimbashi | route | 東海道線 | 1106 | 0.0/0.0 | 1.04 | 東海道線/003798 |
|  | shimbashi→hamamatsucho | route | 東海道線 | 1233 | 0.0/0.0 | 1.01 | 東海道線/003872 |
|  | hamamatsucho→tamachi | route | 東海道線 | 1460 | 0.0/0.0 | 1.06 | 東海道線/003949 |
|  | tamachi→takanawa-gateway | route | 東海道線 | 1369 | 0.0/0.0 | 1.04 | 東海道線/004000 |
|  | takanawa-gateway→shinagawa | route | 東海道線 | 836 | 0.0/0.0 | 1.01 | 東海道線/004061 |
|  | shinagawa→oimachi | route | 東海道線 | 2399 | 0.0/0.0 | 1.00 | 東海道線/004095 |
|  | oimachi→omori | route | 東海道線 | 2115 | 0.0/0.0 | 1.02 | 東海道線/004207 |
|  | omori→kamata | route | 東海道線 | 3137 | 0.0/0.0 | 1.00 | 東海道線/004264 |
| chuo-sobu-local | mitaka→kichijoji | route | 中央線 | 1736 | 0.0/0.0 | 1.00 | 中央線/003587 |
|  | kichijoji→nishi-ogikubo | route | 中央線 | 1779 | 0.0/0.0 | 1.00 | 中央線/003584 |
|  | nishi-ogikubo→ogikubo | route | 中央線 | 1883 | 0.0/0.0 | 1.00 | 中央線/003579 |
|  | ogikubo→asagaya | route | 中央線 | 1414 | 0.0/0.0 | 1.00 | 中央線/003575 |
|  | asagaya→koenji | route | 中央線 | 1254 | 0.0/0.0 | 1.00 | 中央線/003574 |
|  | koenji→nakano | route | 中央線 | 1440 | 0.0/0.0 | 1.00 | 中央線/003573 |
|  | nakano→higashi-nakano | route | 中央線 | 1765 | 0.0/0.0 | 1.00 | 中央線/003568 |
|  | higashi-nakano→okubo | route | 中央線 | 1366 | 0.0/0.0 | 1.07 | 中央線/003563 |
|  | okubo→shinjuku | route | 中央線 | 1209 | 0.0/0.0 | 1.01 | 中央線/003604 |
|  | shinjuku→yoyogi | route | 中央線 | 1010 | 0.0/0.0 | 1.39 | 中央線/003693 |
|  | yoyogi→sendagaya | route | 中央線 | 984 | 0.0/0.0 | 1.10 | 中央線/003744 |
|  | sendagaya→shinanomachi | route | 中央線 | 877 | 0.0/0.0 | 1.00 | 中央線/003767 |
|  | shinanomachi→yotsuya | route | 中央線 | 1139 | 0.0/0.0 | 1.07 | 中央線/003774 |
|  | yotsuya→ichigaya | route | 中央線 | 787 | 0.0/0.0 | 1.05 | 中央線/003728 |
|  | ichigaya→iidabashi | route | 中央線 | 1263 | 0.0/0.0 | 1.01 | 中央線/003685 |
|  | iidabashi→suidobashi | route | 中央線 | 1032 | 0.0/0.0 | 1.10 | 中央線/003608 |
|  | suidobashi→ochanomizu | route | 中央線 | 1083 | 0.0/0.0 | 1.03 | 中央線/003591 |
|  | ochanomizu→akihabara | route | 総武線 | 760 | 0.0/0.0 | 1.01 | 中央線/003616 |
|  | akihabara→asakusabashi | route | 総武線 | 1026 | 0.0/0.0 | 1.00 | 総武線/003626 |
|  | asakusabashi→ryogoku | route | 総武線 | 829 | 0.0/0.0 | 1.01 | 総武線/003640 |
|  | ryogoku→kinshicho | route | 総武線 | 1903 | 0.0/0.0 | 1.00 | 総武線/003654 |
|  | kinshicho→kameido | route | 総武線 | 1114 | 0.0/0.0 | 1.00 | 総武線/003647 |
|  | kameido→hirai | route | 総武線 | 1903 | 0.0/0.0 | 1.09 | 総武線/003641 |
|  | hirai→shin-koiwa | route | 総武線 | 1796 | 0.0/0.0 | 1.00 | 総武線/003561 |
|  | shin-koiwa→koiwa | route | 総武線 | 2862 | 0.0/0.0 | 1.00 | 総武線/003486 |
| chuo-rapid | tokyo→kanda | route | 東北線 | 1222 | 0.0/0.0 | 1.01 | 東北線/003766 |
|  | kanda→ochanomizu | route | 中央線 | 1201 | 0.0/0.0 | 1.18 | 中央線/003677 |
|  | ochanomizu→yotsuya | route | 中央線 | 4164 | 0.0/0.0 | 1.19 | 中央線/003616 |
|  | yotsuya→shinjuku | route | 中央線 | 3727 | 0.0/0.0 | 1.35 | 中央線/003728 |
|  | shinjuku→nakano | route | 中央線 | 4340 | 0.0/0.0 | 1.20 | 中央線/003693 |
|  | nakano→koenji | route | 中央線 | 1440 | 0.0/0.0 | 1.00 | 中央線/003568 |
|  | koenji→asagaya | route | 中央線 | 1254 | 0.0/0.0 | 1.00 | 中央線/003573 |
|  | asagaya→ogikubo | route | 中央線 | 1414 | 0.0/0.0 | 1.00 | 中央線/003574 |
|  | ogikubo→nishi-ogikubo | route | 中央線 | 1883 | 0.0/0.0 | 1.00 | 中央線/003575 |
|  | nishi-ogikubo→kichijoji | route | 中央線 | 1779 | 0.0/0.0 | 1.00 | 中央線/003579 |
|  | kichijoji→mitaka | route | 中央線 | 1736 | 0.0/0.0 | 1.00 | 中央線/003584 |
|  | mitaka→musashi-sakai | route | 中央線 | 1548 | 0.0/0.0 | 1.00 | 中央線/003587 |
|  | musashi-sakai→higashi-koganei | route | 中央線 | 1792 | 0.0/0.0 | 1.00 | 中央線/003590 |
|  | higashi-koganei→musashi-koganei | route | 中央線 | 1615 | 0.0/0.0 | 1.00 | 中央線/003594 |
|  | musashi-koganei→kokubunji | route | 中央線 | 2272 | 0.0/0.0 | 1.00 | 中央線/003600 |
|  | kokubunji→nishi-kokubunji | route | 中央線 | 1352 | 0.0/0.0 | 1.00 | 中央線/003606 |
|  | nishi-kokubunji→kunitachi | route | 中央線 | 1767 | 0.0/0.0 | 1.00 | 中央線/003614 |
|  | kunitachi→tachikawa | route | 中央線 | 2961 | 0.0/0.0 | 1.00 | 中央線/003622 |
|  | tachikawa→hino | route | 中央線 | 3142 | 0.0/0.0 | 1.12 | 中央線/003634 |
|  | hino→toyoda | route | 中央線 | 2471 | 0.0/0.0 | 1.04 | 中央線/003779 |
|  | toyoda→hachioji | route | 中央線 | 4314 | 0.0/0.0 | 1.11 | 中央線/003921 |
|  | hachioji→nishi-hachioji | route | 中央線 | 2576 | 0.0/0.0 | 1.06 | 中央線/003947 |
|  | nishi-hachioji→takao | route | 中央線 | 3083 | 0.0/0.0 | 1.00 | 中央線/003942 |
| ome | tachikawa→nishi-tachikawa | route | 青梅線 | 2008 | 0.0/0.0 | 1.01 | 青梅線/003627 |
|  | nishi-tachikawa→higashi-nakagami | route | 青梅線 | 829 | 0.0/0.0 | 1.00 | 青梅線/003581 |
|  | higashi-nakagami→nakagami | route | 青梅線 | 859 | 0.0/0.0 | 1.00 | 青梅線/003562 |
|  | nakagami→akishima | route | 青梅線 | 1357 | 0.0/0.0 | 1.00 | 青梅線/003536 |
|  | akishima→haijima | route | 青梅線 | 1926 | 0.0/0.0 | 1.03 | 青梅線/003507 |
|  | haijima→ushihama | route | 青梅線 | 1701 | 0.0/0.0 | 1.00 | 青梅線/003465 |
|  | ushihama→fussa | route | 青梅線 | 1057 | 0.0/0.0 | 1.00 | 青梅線/003353 |
|  | fussa→hamura | route | 青梅線 | 2003 | 0.0/0.0 | 1.00 | 青梅線/003300 |
|  | hamura→ozaku | route | 青梅線 | 2382 | 0.0/0.0 | 1.00 | 青梅線/003226 |
|  | ozaku→kabe | route | 青梅線 | 1915 | 0.0/0.0 | 1.00 | 青梅線/003168 |
|  | kabe→higashi-ome | route | 青梅線 | 1161 | 0.0/0.0 | 1.00 | 青梅線/003134 |
|  | higashi-ome→ome | route | 青梅線 | 1391 | 0.0/0.0 | 1.05 | 青梅線/003113 |
|  | ome→miyanohira | route | 青梅線 | 2022 | 0.0/0.0 | 1.06 | 青梅線/003110 |
|  | miyanohira→hinatawada | route | 青梅線 | 842 | 0.0/0.0 | 1.18 | 青梅線/003127 |
|  | hinatawada→ishigamimae | route | 青梅線 | 1010 | 0.0/0.0 | 1.02 | 青梅線/003121 |
|  | ishigamimae→futamatao | route | 青梅線 | 1135 | 0.0/0.0 | 1.00 | 青梅線/003096 |
|  | futamatao→ikusabata | route | 青梅線 | 1001 | 0.0/0.0 | 1.15 | 青梅線/003080 |
|  | ikusabata→sawai | route | 青梅線 | 1370 | 0.0/0.0 | 1.05 | 青梅線/003074 |
|  | sawai→mitake | route | 青梅線 | 1306 | 0.0/0.0 | 1.19 | 青梅線/003076 |
|  | mitake→kawai | route | 青梅線 | 2775 | 0.0/0.0 | 1.29 | 青梅線/003087 |
|  | kawai→kori | route | 青梅線 | 1717 | 0.0/0.0 | 1.41 | 青梅線/003062 |
|  | kori→hatonosu | route | 青梅線 | 2120 | 0.0/0.0 | 1.05 | 青梅線/003053 |
|  | hatonosu→shiromaru | route | 青梅線 | 1385 | 0.0/0.0 | 1.04 | 青梅線/003058 |
|  | shiromaru→oku-tama | route | 青梅線 | 1800 | 0.0/0.0 | 1.10 | 青梅線/003065 |
| itsukaichi | haijima→kumagawa | route | 五日市線 | 1064 | 0.0/0.0 | 1.01 | 五日市線/003464 |
|  | kumagawa→higashi-akiru | route | 五日市線 | 2225 | 0.0/0.0 | 1.02 | 五日市線/003411 |
|  | higashi-akiru→akigawa | route | 五日市線 | 2275 | 0.0/0.0 | 1.00 | 五日市線/003433 |
|  | akigawa→musashi-hikida | route | 五日市線 | 1519 | 0.0/0.0 | 1.00 | 五日市線/003413 |
|  | musashi-hikida→musashi-masuko | route | 五日市線 | 1254 | 0.0/0.0 | 1.00 | 五日市線/003395 |
|  | musashi-masuko→musashi-itsukaichi | route | 五日市線 | 2733 | 0.0/0.0 | 1.07 | 五日市線/003383 |
| hachiko | hachioji→kita-hachioji | route | 八高線 | 3058 | 0.0/0.0 | 1.13 | 八高線/003948 |
|  | kita-hachioji→komiya | route | 八高線 | 2015 | 0.0/0.0 | 1.06 | 八高線/003841 |
|  | komiya→haijima | route | 八高線 | 4751 | 0.0/0.0 | 1.05 | 八高線/003726 |
|  | haijima→higashi-fussa | route | 八高線 | 2843 | 0.0/0.0 | 1.01 | 八高線/003462 |
|  | higashi-fussa→hakonegasaki | route | 八高線 | 3175 | 0.0/0.0 | 1.05 | 八高線/003282 |
| saikyo | osaki→ebisu | route | 山手線 | 3504 | 0.0/0.0 | 1.03 | 山手線/004135 |
|  | ebisu→shibuya | route | 山手線 | 1490 | 0.0/0.0 | 1.01 | 山手線/003992 |
|  | shibuya→shinjuku | route | 山手線 | 3485 | 0.0/0.0 | 1.02 | 山手線/003932 |
|  | shinjuku→ikebukuro | route | 山手線 | 4766 | 0.0/24.5 | 1.02 | 山手線/003701 |
|  | ikebukuro→itabashi | route | 赤羽線 | 1788 | 0.0/0.0 | 1.00 | 赤羽線/003391 |
|  | itabashi→jujo | route | 赤羽線 | 1767 | 0.0/0.0 | 1.02 | 赤羽線/003286 |
|  | jujo→akabane | route | 赤羽線 | 1943 | 0.0/0.0 | 1.01 | 赤羽線/003218 |
|  | akabane→kita-akabane | route | 東北線 | 1811 | 0.0/0.0 | 1.06 | 東北線/003157 |
|  | kita-akabane→ukima-funado | route | 東北線 | 1425 | 0.0/0.0 | 1.03 | 東北線/003130 |
| shonan-shinjuku-local | akabane→ikebukuro | route (multi-N02) | 東北線→山手線 | 10471 | 0.0/0.0 | 1.96 | 東北線/003157 |
|  | ikebukuro→shinjuku | compose ← saikyo | (owner) | 4766 | 0.0/0.0 | 1.02 | 山手線/003391 |
|  | shinjuku→shibuya | compose ← saikyo | (owner) | 3485 | 0.0/0.0 | 1.02 | 山手線/003701 |
|  | shibuya→ebisu | compose ← saikyo | (owner) | 1490 | 0.0/0.0 | 1.01 | 山手線/003932 |
|  | ebisu→osaki | compose ← saikyo | (owner) | 3504 | 0.0/0.0 | 1.03 | 山手線/003992 |
|  | osaki→nishi-oi | route (multi-N02) | 山手線→東海道線 | 2583 | 0.0/0.0 | 1.22 | 山手線/004135 |
| sotetsu-direct | shinjuku→shibuya | compose ← shonan-shinjuku-local | (owner) | 3485 | 0.0/0.0 | 1.02 | 山手線/003701 |
|  | shibuya→ebisu | compose ← shonan-shinjuku-local | (owner) | 1490 | 0.0/0.0 | 1.01 | 山手線/003932 |
|  | ebisu→osaki | compose ← shonan-shinjuku-local | (owner) | 3504 | 0.0/0.0 | 1.03 | 山手線/003992 |
|  | osaki→nishi-oi | compose ← shonan-shinjuku-local | (owner) | 2583 | 0.0/0.0 | 1.22 | 山手線/004135 |
| keiyo | tokyo→hatchobori | route | 京葉線 | 1226 | 0.0/0.0 | 1.02 | 京葉線/003785 |
|  | hatchobori→etchujima | route | 京葉線 | 1554 | 0.0/0.0 | 1.03 | 京葉線/003800 |
|  | etchujima→shiomi | route | 京葉線 | 2621 | 0.0/0.0 | 1.07 | 京葉線/003859 |
|  | shiomi→shin-kiba | route | 京葉線 | 1948 | 0.0/0.0 | 1.16 | 京葉線/003928 |
|  | shin-kiba→kasai-rinkai-koen | route | 京葉線 | 3182 | 0.0/0.0 | 1.01 | 京葉線/003995 |
| musashino | fuchuhommachi→kita-fuchu | route | 武蔵野線 | 1737 | 0.0/0.0 | 1.00 | 武蔵野線/003878 |
|  | kita-fuchu→nishi-kokubunji | route | 武蔵野線 | 2187 | 0.0/0.0 | 1.00 | 武蔵野線/003771 |
|  | nishi-kokubunji→shin-kodaira | route | 武蔵野線 | 3481 | 0.0/0.0 | 1.00 | 武蔵野線/003611 |
|  | shin-kodaira→shin-akitsu | route | 武蔵野線 | 5715 | 0.0/0.0 | 1.01 | 武蔵野線/003385 |
| nambu | yanokuchi→inaginaganuma | route | 南武線 | 1672 | 0.0/0.0 | 1.02 | 南武線/004032 |
|  | inaginaganuma→minami-tama | route | 南武線 | 1336 | 0.0/0.0 | 1.02 | 南武線/004011 |
|  | minami-tama→fuchuhommachi | route | 南武線 | 2349 | 0.0/0.0 | 1.09 | 南武線/003980 |
|  | fuchuhommachi→bubaigawara | route | 南武線 | 912 | 0.0/0.0 | 1.13 | 南武線/003876 |
|  | bubaigawara→nishifu | route | 南武線 | 1169 | 0.0/0.0 | 1.08 | 南武線/003853 |
|  | nishifu→yaho | route | 南武線 | 1626 | 0.0/0.0 | 1.08 | 南武線/003831 |
|  | yaho→yagawa | route | 南武線 | 1445 | 0.0/0.0 | 1.01 | 南武線/003765 |
|  | yagawa→nishi-kunitachi | route | 南武線 | 1305 | 0.0/0.0 | 1.10 | 南武線/003733 |
|  | nishi-kunitachi→tachikawa | route | 南武線 | 1155 | 0.0/0.0 | 1.20 | 南武線/003665 |
| yokohama | aihara→hachiojiminamino | route | 横浜線 | 2884 | 0.0/0.0 | 1.07 | 横浜線/004206 |
|  | hachiojiminamino→katakura | route | 横浜線 | 1360 | 0.0/0.0 | 1.04 | 横浜線/004082 |
|  | katakura→hachioji | route | 横浜線 | 2424 | 0.0/0.0 | 1.42 | 横浜線/004038 |
| tokaido | tokyo→shimbashi | route + via | 東海道線 | 1848 | 0.0/0.0 | 1.03 | 東海道線/003770 |
|  | shimbashi→shinagawa | route + via | 東海道線 | 4847 | 0.0/0.0 | 1.07 | 東海道線/003872 |
| yokosuka | tokyo→shimbashi | route + via | 東海道線 | 1855 | 0.0/0.0 | 1.02 | 東海道線/003770 |
|  | shimbashi→shinagawa | route + via | 東海道線 | 4801 | 0.0/0.0 | 1.07 | 東海道線/003872 |
|  | shinagawa→nishi-oi | route | 東海道線 | 3625 | 0.0/0.0 | 1.06 | 東海道線/004095 |
| sobu-rapid | tokyo→shin-nihombashi | route | 総武線 | 1235 | 0.0/0.0 | 1.08 | 総武線/003760 |
|  | shin-nihombashi→bakurocho | route | 総武線 | 888 | 0.0/0.0 | 1.01 | 総武線/003703 |
|  | bakurocho→kinshicho | route | 総武線 | 3002 | 0.0/0.0 | 1.03 | 総武線/003668 |
|  | kinshicho→shin-koiwa | route | 総武線 | 4814 | 0.0/0.0 | 1.07 | 総武線/003647 |
| utsunomiya | tokyo→ueno | route | 東北線 | 3693 | 0.0/0.0 | 1.01 | 東北線/003766 |
|  | ueno→oku | route | 東北線 | 4689 | 0.0/0.0 | 1.11 | 東北線/003504 |
|  | oku→akabane | route | 東北線 | 4896 | 0.0/0.0 | 1.08 | 東北線/003278 |
| takasaki | tokyo→ueno | compose ← utsunomiya | (owner) | 3693 | 0.0/0.0 | 1.01 | 東北線/003766 |
|  | ueno→oku | compose ← utsunomiya | (owner) | 4689 | 0.0/0.0 | 1.11 | 東北線/003504 |
|  | oku→akabane | compose ← utsunomiya | (owner) | 4896 | 0.0/0.0 | 1.08 | 東北線/003278 |
| shonan-shinjuku-rapid-takasaki | akabane→ikebukuro | compose ← shonan-shinjuku-local | (owner) | 10471 | 0.0/0.0 | 1.96 | 東北線/003157 |
|  | ikebukuro→shinjuku | compose ← shonan-shinjuku-local | (owner) | 4766 | 0.0/0.0 | 1.02 | 山手線/003391 |
|  | shinjuku→shibuya | compose ← shonan-shinjuku-local | (owner) | 3485 | 0.0/0.0 | 1.02 | 山手線/003701 |
|  | shibuya→ebisu | compose ← shonan-shinjuku-local | (owner) | 1490 | 0.0/0.0 | 1.01 | 山手線/003932 |
|  | ebisu→osaki | compose ← shonan-shinjuku-local | (owner) | 3504 | 0.0/0.0 | 1.03 | 山手線/003992 |
| joban-rapid | shinagawa→shimbashi | route | 東海道線 | 4847 | 0.0/0.0 | 1.07 | 東海道線/004095 |
|  | shimbashi→tokyo | route | 東海道線 | 1848 | 0.0/0.0 | 1.03 | 東海道線/003872 |
|  | tokyo→ueno | route | 東北線 | 3728 | 0.0/0.0 | 1.01 | 東北線/003766 |
|  | ueno→nippori | route (departs after platform transfer) | 東北線 | 1919 | 0.0/0.0 | 1.15 | 東北線/003504 |
|  | nippori→mikawashima | route | 常磐線 | 1281 | 0.0/0.0 | 1.60 | 常磐線/003417 |
|  | mikawashima→minami-senju | route | 常磐線 | 2284 | 0.0/0.0 | 1.11 | 常磐線/003359 |
|  | minami-senju→kita-senju | route | 常磐線 | 1638 | 0.0/0.0 | 1.00 | 常磐線/003352 |

## 8. Decisions (status 2026-10-14)

User decisions are recorded in `.claude/docs/DESIGN.md` Key Decisions and in the handoff.

| # | Topic | Decision | Status in this stage |
|---|---|---|---|
| D1 | joban-rapid 品川–上野 (N02 上野 gap) | (a) pipeline feature, no synthetic connector | **Resolved.** Platform transfer at 上野 (PR #15); full 8-stop run staged |
| D2 | 湘南新宿 赤羽–池袋 | (a) keep the marked surrogate, detour exception 2.1 | **Resolved**, unchanged (§5.1) |
| D3 | 成瀬–町田, 綾瀬–金町, 高尾–藤野 | defer to the Kanagawa / Chiba stages | Deferred; 137 of 142 Tokyo stations staged |
| D4 | duplicate 山手貨物線 owner 池袋–新宿 | fix G1, compose from saikyo | **Resolved.** shonan-shinjuku-local 池袋→新宿 ← saikyo; primitive removed |
| D5 | line metadata | one line per service in staging; S6 owns grouping | unchanged |
| D6 | detour exceptions | the two 湘南新宿 rows at 2.1 | unchanged |

**Optional later refinement (recipe 3, not adopted).** Compose joban-rapid 品川→新橋→東京 from tokaido and 東京→上野
from utsunomiya.
- Requirement: a second platform transfer at 東京 (64.3 m between tokaido's surface anchor and utsunomiya's
  東北縦貫線 anchor) in addition to 上野.
- Measured on raw N02 (`.claude/logs/jrcr-pipeline-g1g2/scratch-ov2`): builds and validates OK; 201 pairs with 19 compose;
  182 primitives (−3); 372 references, max chain 1; GeoJSON 104,708 B (−2,451 B); 137/137 two-way reachability.
- Lead decision: not adopted, to avoid a second transfer and animation jump at 東京. joban-rapid keeps its own 品川–上野
  geometry, physically the same tracks as tokaido and utsunomiya.

## 9. Pipeline gaps (resolved by PR #15)

- **G1 — composed anchor next to a multi-line route kept the owner's platform line.** Fixed in
  `composition_build.composed_pairs`: the inherited anchor carries the N02 line of the owner primitive's start or end.
  Anchors stay exact. The 0.48 m mismatch did not occur with inheritance.
- **G2 — one platform per stop.** Fixed by the reviewed `platform_transfers.csv` (`routing.route_path`, per-side
  inherited anchors, validator allowance on the departing side only, unused-row check).
- Evidence and tests: `.claude/docs/research/jr-east-capital-region-pipeline-g1g2.md`.

## 10. Files

- `data/staging/jr-east-capital-region/tokyo/overrides/{dataset.json,stations.csv,services.json,expected-catalog.json,offset_exceptions.csv,detour_exceptions.csv,platform_transfers.csv}`
- `data/staging/jr-east-capital-region/tokyo/overrides/services/<21 service ids>/{stops,scope,line_mapping}.csv`
- `tests/data_pipeline/test_staging_tokyo.py` (load + pinned oracle, stop-list two-way reachability, edited-oracle rejection; no raw N02)
