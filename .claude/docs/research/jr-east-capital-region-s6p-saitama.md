# S6P Saitama — built and validated stage

Date: 2026-10-15. Worktree: `feature/jrcr-s6p-saitama`.

## Status and scope

**Stage validated: 9/9 services, 75/75 distinct stations, 113 service-stop
rows and 104 forward stop pairs.** The frozen Saitama product subset is kept
unchanged. All services are linear; this bundle uses the stage validation
profile with `stageStartStationId: musashi-urawa` and omits gameplay
`startStationId` and `targetServiceId`.

| Service | Stops | Official reference (km) | Built length (km) |
|---|---:|---:|---:|
| `jr-keihin-tohoku` | 9 | 14.5 | 14.485 |
| `jr-hachiko` | 14 | 59.5 | 59.588 |
| `jr-kawagoe-west` | 6 | 14.5 | 14.629 |
| `jr-saikyo` | 14 | 28.6 | 28.636 |
| `jr-musashino` | 14 | 37.7 | 37.836 |
| `jr-utsunomiya` | 11 | 33.0 | 32.959 |
| `jr-takasaki` | 18 | 65.8 | 66.031 |
| `jr-shonan-shinjuku-local` | 10 | 33.0 | 32.959 |
| `jr-shonan-shinjuku-rapid-takasaki` | 17 | 65.8 | 66.031 |

The length references use JR station-point distances in the Saitama
Prefecture's [official in-prefecture railway mileage table](https://www.pref.saitama.lg.jp/documents/2461/eigyoukiro.pdf).
The Urawa–Omiya highline contribution for Takasaki and rapid Shonan services is
6.1 km (Urawa 20.6 km to Omiya 26.7 km on the Utsunomiya line), plus 59.7 km
from Omiya to Jimbohara on the Takasaki line. The service tolerance is 1.5 km;
all nine built lengths pass it.

The expected-catalog oracle remains a product-catalog-only projection in the
frozen order. Its SHA-256 is
`09651aec08c4855a81b344fa9ee02059e20cb489df0f14be77e8a259e859dd30`.
Build output was compared to the oracle after generation; the service order,
all stop lists and first-appearance station order match exactly.

## Station numbers and routing decisions

Station-number evidence is the JR East 2016 [metropolitan station-numbering
map](https://www.jreast.co.jp/press/2016/20160402.pdf). The current JR East
station pages also list **浦和 JU05 / JS23** and **大宮 JU07 / JS24**:
[Urawa](https://www.jreast.co.jp/estation/station/info.aspx?StationCd=259),
[Omiya](https://www.jreast.co.jp/estation/station/info.aspx?StationCd=0350).
The two Shonan services use JS24 at Omiya and JS23 at Urawa, and use JU numbers
on the northern Utsunomiya/Takasaki branches. The Keihin–Tohoku sequence is
JK47–JK39; Saikyo is JA18–JA31; Musashino is JM30–JM17; Utsunomiya is
JU05–JU15; Takasaki is JU05–JU22. Hachiko stations have no number in the JR
East numbering source used here. The west-of-Kawagoe partial run has JA31 at
Kawagoe; its remaining stations have no number in that source.

All route maps use direct N02 `n02_line` mappings except the documented
same-track compositions below. No via points or multi-line route recipes were
needed. The pair classes are 81 direct N02 pairs, 23 composed pairs, 0 via
pairs and 0 multi-N02 route pairs.

- The Keihin–Tohoku, Hachiko, west Kawagoe, Saikyo, Musashino and Utsunomiya
  runs route directly on their mapped N02 line(s). Saikyo's Toda-Koen–Omiya
  route uses N02 `東北線`; Omiya–Kawagoe uses `川越線`. The Keihin–Tohoku and
  Saikyo services are not composed from the Tohoku passenger-line geometry:
  they remain independent routes even where N02 shares the `東北線` label.
- Utsunomiya has an explicit 30-key `東北線` allow filter in
  `overrides/services/jr-utsunomiya/sections.csv`. It pins the used route and
  junction sections from raw `N02-25_RailroadSection.geojson`.
- Takasaki routes Urawa–Omiya directly on N02 `東北線` and Omiya–Jimbohara on
  `高崎線`. The `高崎線` section filter lists the 36 candidate-window section
  keys for the reviewed Takasaki stops in
  `overrides/services/jr-takasaki/sections.csv`.
- Shonan local composes its eight pairs north of Omiya (Kurihashi–Omiya) from
  the Utsunomiya stage geometry; every recipe records N02 `東北線` and the exact
  Utsunomiya section allow filter. Its Omiya–Urawa pair is an independent
  direct route on N02 `東北線`: the real trains run on the 東北貨物線 (separate
  physical track; 浦和 has a dedicated 湘南新宿ライン platform on it), so the
  N02 geometry is a representative shape, not shared-track evidence. Corrected
  after the Sol read-only review (2026-10-15), which found the earlier
  composition from the Utsunomiya 列車線 primitives invalid.
- Shonan rapid composes its 15 north-of-Omiya pairs from Takasaki geometry on
  N02 `高崎線`, with the exact 36-key owner filter in every witness. Its
  Omiya–Urawa pair is routed directly on N02 `東北線`; that N02 shape represents
  the 東北貨物線 the trains actually use (not the 列車線).

Takasaki's Urawa–Saitama-Shintoshin pair stays a direct route. (Review note:
that pair's geometry is identical to Utsunomiya's, Hausdorff 0.0 m; the anchor
mismatch, 32.851 m at 大宮, is on the adjacent Saitama-Shintoshin–Omiya pair.) That pair stays directly routed on N02 `東北線`; it did not need a
platform transfer or a pipeline exception. The machine-readable section and
composition observations are in
`.claude/logs/jrcr-s6p-saitama/section-evidence.json`.

All stop numbering and station scope checks pass. `offset_exceptions.csv` and
`detour_exceptions.csv` are header-only. There are **zero platform transfers**;
no transfer was added because every selected N02 route is connected. There are
no area exceptions or extra service runs.

## Cross-border inventory kept for combined S6

`data/staging/jr-east-capital-region/saitama/cross-border-pairs.csv` remains a
14-row inventory of 9 distinct physical station pairs. The 9 rows that occur
at product-catalog prefecture boundaries and 5 expansion-boundary rows are
inventory only, not Saitama-stage route edges.

| Service | Pair | Boundary | Inventory source |
|---|---|---|---|
| Keihin–Tohoku | 川口–赤羽 | Saitama–Tokyo | Product adjacency |
| Hachiko | 箱根ケ崎–金子 | Tokyo–Saitama | Product adjacency |
| Hachiko | 丹荘–群馬藤岡 | Saitama–Gunma | Expansion boundary; outside product catalog |
| Saikyo | 浮間舟渡–戸田公園 | Tokyo–Saitama | Product adjacency |
| Musashino | 新秋津–東所沢 | Tokyo–Saitama | Product adjacency |
| Musashino | 三郷–南流山 | Saitama–Chiba | Product adjacency |
| Utsunomiya | 赤羽–浦和 | Tokyo–Saitama | Product adjacency |
| Utsunomiya | 栗橋–古河 | Saitama–Ibaraki | Expansion boundary; outside product catalog |
| Takasaki | 赤羽–浦和 | Tokyo–Saitama | Product adjacency |
| Takasaki | 神保原–新町 | Saitama–Gunma | Expansion boundary; outside product catalog |
| Shonan local | 古河–栗橋 | Ibaraki–Saitama | Expansion boundary; outside product catalog |
| Shonan local | 浦和–赤羽 | Saitama–Tokyo | Product adjacency |
| Shonan rapid | 新町–神保原 | Gunma–Saitama | Expansion boundary; outside product catalog |
| Shonan rapid | 浦和–赤羽 | Saitama–Tokyo | Product adjacency |

The labels in this inventory are proposed line names, not a claim that the
cross-border routes or freight-line sections have been routed. The outside
product neighbors `群馬藤岡`, `古河` and `新町` remain excluded from the
four-prefecture playable catalog.

## Deferred stations and split runs

Per the 2026-10-15 S6 lead decisions, these are reserved for the combined S6
dataset, which spans all four prefectures:

- Tokyo enclaves: 成瀬・町田・高尾 and 綾瀬・亀有・金町.
- Yokohama Line partial run: 古淵–相模原 / 橋本 side, whose service extent is
  split by another prefecture.
- Chuo Main Line partial run: 相模湖・藤野, also on a run split by another
  prefecture.

The documented partial Saitama product runs are kept as-is. No enclave
stations, area exceptions or multi-run service definitions were added here.

## Measurements

| Measurement | Result |
|---|---:|
| Pair classes | 81 direct N02; 23 compose; 0 via; 0 multi-N02 |
| Owned geometry primitives | 81 |
| Directed geometry references | 208 |
| Maximum chain length | 1 reference |
| Maximum composition dependency depth | 1 |
| Platform transfers / offset exceptions / detour exceptions | 0 / 0 / 0 |
| Maximum platform offset | 116.3 m (limit 250 m) |
| Maximum detour ratio | 1.472 (limit 1.8) |
| Stage-start reachability | 75/75 forward and 75/75 reverse from 武蔵浦和 |
| Oracle hash | `09651aec08c4855a81b344fa9ee02059e20cb489df0f14be77e8a259e859dd30` |
| Build duration (after the review fix) | 1.76 s (`/usr/bin/time -p`, real); repeat build byte-identical |

The table below gives **raw bytes / deterministic gzip bytes** for the
five-file output at each simplification tolerance. Gzip is level 9 with a
zeroed timestamp, as used by the pipeline budget report.

| File | 1 m | 3 m | 5 m |
|---|---:|---:|---:|
| `manifest.json` | 538 / 386 | 538 / 386 | 538 / 388 |
| `stations.json` | 8,711 / 1,774 | 8,711 / 1,774 | 8,711 / 1,774 |
| `services.json` | 16,772 / 2,654 | 16,772 / 2,654 | 16,772 / 2,654 |
| `segments.json` | 35,535 / 2,899 | 35,535 / 2,899 | 35,535 / 2,899 |
| `segments.geojson` | 57,434 / 12,622 | 41,466 / 8,170 | 37,383 / 7,048 |
| **Five-file total** | **118,990 / 20,335** | **103,022 / 15,883** | **98,939 / 14,763** |
| Coordinates / max Hausdorff error | 1,738 / 0.998 m | 971 / 2.997 m | 775 / 4.992 m |

All three payload sizes are within the `capital-region` budget. The default is
1 m; the simplification report says the 1 m result equals the normal build
output. The 3 m and 5 m figures are comparisons only.

Raw inputs were read-only and matched the repository checksum manifest:

| Input | Bytes | SHA-256 |
|---|---:|---|
| `N02-25_RailroadSection.geojson` | 14,239,859 | `4269b076c0689db13cadf0d07801418b7215b2160ebf1278c508031cd08c4da2` |
| `N02-25_Station.geojson` | 3,261,590 | `908e2c3036e9c80760ae3514be3682c77f81f0bd60ab5fb1b3da1aa9352bbd94` |

## Acceptance results

| Check | Result |
|---|---|
| Raw-N02 build, two runs | Both exit 0; real times 1.66 s / 1.60 s; output directories are byte-identical (`diff -r` empty) |
| Stage `validate` | Exit 0, `OK`; all nine length references and the geometry/budget/reachability rules pass |
| Product oracle vs built services and stops | Exact match; hash above unchanged |
| Built-graph two-way reachability | 75/75 in each direction from `musashi-urawa` |
| Live rebuild using the same raw directory vs `public/data` | Exit 0; `diff -r` empty; live `validate` is OK |
| Protected paths via `git diff --quiet` | Exit 0; `public`, live overrides, `src`, `scripts` and Tokyo stage are clean |
| `uv run ruff check .` | Exit 0, all checks passed |
| `uv run ruff format --check .` | Exit 0, 54 files already formatted |
| `uv run pytest` | Exit 0, 339 passed / 9 skipped in 5.35 s; skips are raw-N02 tests because this worktree's default raw-data path is absent |

The stage-profile change skips only gameplay target/goal checks. Oracle,
registry, scope, routed geometry, length, budget, topology and two-way
reachability remain validated. No blocking pipeline gap remains. The one
non-composed Takasaki pair described above uses direct N02 routing because its
source and destination platform anchors did not match the proposed owner
geometry exactly.
