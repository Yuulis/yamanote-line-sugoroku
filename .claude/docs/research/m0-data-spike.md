# M0 Data Spike — Yamanote Line from MLIT N02 (2025)

Date: 2026-10-11 · Branch: `feature/m0-data-spike` · Spec: `railway_sugoroku_mvp_spec.md` §0.2, §3.1, §5, §5.1, §5.2

## Result

A deterministic uv/Python pipeline (`scripts/data_pipeline/`) turns N02-25 + `data/overrides/`
into `public/data/{stations,services,segments}.json`, `segments.geojson`, `manifest.json`.
All §5.2 checks pass; two consecutive builds are byte-identical.

| Command | Result |
|---------|--------|
| `uv run python -m scripts.data_pipeline.build` (x2) + `sha256sum public/data/*` | identical checksums; also identical to an earlier build written to a scratch dir (`git diff --no-index` empty) |
| `uv run python -m scripts.data_pipeline.validate` | `OK` (exit 0) |
| `uv run pytest -q` | 48 passed (~1.5 s; `test_build.py` skips without raw data) |
| `uv run ruff check .` / `uv run ruff format --check .` | pass / 21 files already formatted |
| `uv run ty check scripts/` (ty 0.0.86) | All checks passed (no suppressions); `ty check tests/` also passes |

Output sizes: `segments.geojson` 12,992 B · `segments.json` 5,619 B · `stations.json` 3,463 B ·
`services.json` 715 B · `manifest.json` 405 B. `dataVersion` = `n02-2025-83215bcd195d`
(sha256 of the four game-data files, sorted by name; no clock involved).

## Source

- 国土数値情報（鉄道データ）N02 2025年度版, base date 2025-12-31, `N02-25_GML.zip` (全国, 14.2 MB),
  JGD2011 (B, L), license CC BY 4.0 (confirmed on
  https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html). `KS-META-N02-25.xml` date 2026-03-06,
  product spec 第3.1版.
- Files read: `N02-25_GML/UTF-8/N02-25_Station.geojson` (10,234 features),
  `N02-25_RailroadSection.geojson` (21,933 features). Both declare EPSG:6668.

## N02 line-name finding (the "山手線 is not the service" pitfall)

Confirmed in the data. N02 `N02_003` is the *physical/official* line:

| Corridor (outer loop) | N02 line carrying the Yamanote stations | Platforms (N02_005) |
|---|---|---|
| 新橋 → 浜松町 → 田町 → 高輪ゲートウェイ → 品川 | 東海道線 | 新橋 x2, 浜松町, 田町, 高輪GW, 品川 x3 (東海道線) |
| 品川 → 大崎 → … → 駒込 → 田端 | 山手線 | 17 stations 品川..田端 (新宿 has 4 山手線 platforms) |
| 田端 → 西日暮里 → … → 神田 → 東京 | 東北線 | 西日暮里..神田, 日暮里 x2, 上野 x4, 東京 x3 |
| 東京 → 有楽町 → 新橋 | 東海道線 | 有楽町, 東京 x4 (some share geometry with 東北線) |

Other traps observed:
- `N02_003 == "山手線"` also matches 神戸市営地下鉄 山手線 (8 stations, 15 sections). The pipeline always filters
  `N02_004 == "東日本旅客鉄道"` (from `data/overrides/service.json`).
- N02 山手線 sections between 品川 and 大崎 have geometry identical to 東海道線 sections (shared corridor).
- Within the 2 km search box: 山手線 50 sections (23.5 km), 東北線 48 (24.0 km; includes the 尾久 branch and the
  line north toward 赤羽), 東海道線 38 (24.4 km; two parallel alignments 品川–新橋, only one carries the
  浜松町/田町/高輪GW platforms, plus the 品鶴 direction).
- Boundary stations have platforms on both lines (品川: 山手線+東海道線, 田端: 山手線+東北線 with identical
  geometry, 東京: 東北線+東海道線, partly identical geometry).

Resolution: `data/overrides/yamanote_line_mapping.csv` maps segment runs to N02 lines
(新橋→品川 東海道線, 品川→田端 山手線, 田端→東京 東北線, 東京→新橋 東海道線). The loader rejects gaps,
overlaps, and unknown stations. Each segment is routed only on its mapped line's sections.

## Station order verification

Fixed in `data/overrides/yamanote_stations.csv` (order, id, name, JR East number). The loader checks that JY
numbers descend cyclically (JY29 新橋 → … → JY01 東京 → JY30 有楽町 → JY29), i.e. the outer-loop direction.

Sources (all agree with the expected list; **no discrepancy**):
- JR East official timetable, Yamanote outer loop at 有楽町 ("品川・渋谷方面 (外回り)"):
  https://timetables.jreast.co.jp/2610/timetable/tt1617/1617011.html
- JR East official train page for train 461G (one outer-loop lap 池袋 → … → 東京 → 有楽町 → 新橋 → 浜松町 → 田町 →
  高輪ゲートウェイ → 品川 → 大崎 → … → 池袋 → … → 大崎): https://timetables.jreast.co.jp/2610/train/055/056741.html
- JR East station page 有楽町 (JY30; 外回り = 品川・渋谷方面): https://www.jreast.co.jp/estation/station/info.aspx?StationCd=1617
  and 高輪ゲートウェイ (JY26): https://www.jreast.co.jp/estation/station/info.aspx?StationCd=1750 (both seen via
  search index; direct fetch from this environment returned HTTP 403).
- Third-party numbering lists consistent with JY01 東京 … JY30 有楽町: https://cross-hatch.wixsite.com/numbering/jy ,
  https://ekiview.nanaichi-lab.com/line/yamanote.html
- Geometry cross-check (not inference): every segment passes ≥ 653 m from every non-endpoint station, so no
  station is skipped or swapped; loop length 34.45 km vs official 34.5 km.

Note: the timetable URLs contain the edition (`2610`) and will move when JR East publishes a new edition.

## Representative point and station dedupe

1. Candidates for station S[i] = JR East Station features with `N02_005 == name` and `N02_003` in the N02 lines of
   E[i-1] and E[i]. Candidates with identical midpoints (same geometry under two line names) are deduplicated.
2. Candidate point = midpoint along the platform LineString (`interpolate(0.5, normalized=True)`) in
   EPSG:6677 (JGD2011 / Japan Plane Rectangular CS IX, metres).
3. One candidate per station is chosen by dynamic programming over the cycle: minimise the total closed-loop track
   length (sum of shortest paths, costs quantised to integer mm; ties → lexicographically smallest candidate
   indices). Parallel-alignment platforms (e.g. 新宿 x4, 上野 x4, 東京 x4) are 17–166 m off the through route, so the
   minimum picks the platform on the track that the single-platform neighbours (代々木, 新大久保, 御徒町, 有楽町 …)
   also sit on. Every chosen platform lies on both its incoming and outgoing path (distance 0.0 m).
4. Output coordinate = that midpoint → EPSG:4326, rounded to 6 decimals. One station per name.

## Segment geometry

- Graph per N02 line: sections (exploded LineStrings) within 2 km of all candidates; nodes = endpoints rounded to
  1 cm; undirected; parallel edges kept.
- Query points are snapped to the nearest section (lowest index on ties; sections sorted by coordinates) and
  Dijkstra runs from both ends of the snapped edge; same-edge paths are handled directly.
- Path geometry = concatenated section pieces oriented from `from` to `to`, simplified with Douglas-Peucker
  (1 m, metric CRS; endpoints preserved), transformed to WGS84, rounded to 6 decimals.
- Transformation pipelines (pyproj 3.7.2): EPSG:6668→6677 is the TM projection only; 6677→4326 is inverse TM +
  "JGD2011 to WGS 84 (1)" (null shift). No grid files involved.

| E | from -> to | N02 line (sections) | track m | straight m | ratio | platform chosen for `from` (N02_003 / N02_005c) |
|---|---|---|---:|---:|---:|---|
| 0 | 新橋 -> 浜松町 | 東海道線 | 1233 | 1222 | 1.009 | 東海道線 / 003872 |
| 1 | 浜松町 -> 田町 | 東海道線 | 1460 | 1376 | 1.061 | 東海道線 / 003949 |
| 2 | 田町 -> 高輪ゲートウェイ | 東海道線 | 1369 | 1311 | 1.044 | 東海道線 / 004000 |
| 3 | 高輪ゲートウェイ -> 品川 | 東海道線 | 836 | 826 | 1.012 | 東海道線 / 004061 |
| 4 | 品川 -> 大崎 | 山手線 | 2081 | 1302 | 1.599 | 山手線 / 004097 |
| 5 | 大崎 -> 五反田 | 山手線 | 824 | 823 | 1.000 | 山手線 / 004135 |
| 6 | 五反田 -> 目黒 | 山手線 | 1059 | 1014 | 1.044 | 山手線 / 004110 |
| 7 | 目黒 -> 恵比寿 | 山手線 | 1621 | 1611 | 1.006 | 山手線 / 004071 |
| 8 | 恵比寿 -> 渋谷 | 山手線 | 1490 | 1483 | 1.005 | 山手線 / 003992 |
| 9 | 渋谷 -> 原宿 | 山手線 | 1478 | 1468 | 1.007 | 山手線 / 003932 |
| 10 | 原宿 -> 代々木 | 山手線 | 1423 | 1385 | 1.027 | 山手線 / 003828 |
| 11 | 代々木 -> 新宿 | 山手線 | 767 | 763 | 1.005 | 山手線 / 003743 |
| 12 | 新宿 -> 新大久保 | 山手線 | 1172 | 1161 | 1.010 | 山手線 / 003701 |
| 13 | 新大久保 -> 高田馬場 | 山手線 | 1371 | 1367 | 1.003 | 山手線 / 003601 |
| 14 | 高田馬場 -> 目白 | 山手線 | 860 | 860 | 1.000 | 山手線 / 003508 |
| 15 | 目白 -> 池袋 | 山手線 | 1181 | 1180 | 1.001 | 山手線 / 003470 |
| 16 | 池袋 -> 大塚 | 山手線 | 1822 | 1534 | 1.188 | 山手線 / 003390 |
| 17 | 大塚 -> 巣鴨 | 山手線 | 1211 | 1143 | 1.059 | 山手線 / 003375 |
| 18 | 巣鴨 -> 駒込 | 山手線 | 781 | 779 | 1.002 | 山手線 / 003356 |
| 19 | 駒込 -> 田端 | 山手線 | 1462 | 1225 | 1.193 | 山手線 / 003343 |
| 20 | 田端 -> 西日暮里 | 東北線 | 765 | 761 | 1.005 | 山手線 / 003335 |
| 21 | 西日暮里 -> 日暮里 | 東北線 | 656 | 653 | 1.004 | 東北線 / 003373 |
| 22 | 日暮里 -> 鶯谷 | 東北線 | 913 | 909 | 1.005 | 東北線 / 003420 |
| 23 | 鶯谷 -> 上野 | 東北線 | 1062 | 935 | 1.137 | 東北線 / 003460 |
| 24 | 上野 -> 御徒町 | 東北線 | 694 | 676 | 1.027 | 東北線 / 003504 |
| 25 | 御徒町 -> 秋葉原 | 東北線 | 974 | 973 | 1.002 | 東北線 / 003555 |
| 26 | 秋葉原 -> 神田 | 東北線 | 781 | 776 | 1.007 | 東北線 / 003625 |
| 27 | 神田 -> 東京 | 東北線 | 1257 | 1257 | 1.000 | 東北線 / 003678 |
| 28 | 東京 -> 有楽町 | 東海道線 | 742 | 727 | 1.021 | 東北線 / 003766 |
| 29 | 有楽町 -> 新橋 | 東海道線 | 1106 | 1063 | 1.040 | 東海道線 / 003798 |

Loop track length 34.454 km (official 営業キロ 34.5 km). 品川 → 大崎 has the largest detour ratio (1.599): the real
track bends south then west, matching its 2.0 km 営業キロ vs ~1.3 km straight line.

## Validation (`scripts/data_pipeline/validate.py`)

Checks: 30 stations / 30 segments; unique station ids, names, segment ids; kebab-case ids; stations
`(id, name)` sequence equals the override; service shape (`jr-yamanote`, circular, starts at shimbashi, start
not repeated, same order as stations.json); segment id = `jr-yamanote:<from>:<to>`, `geometryFeatureId == id`,
E[i] = S[i] → S[i+1], chain continuity, closes to shimbashi, every station referenced; 30-step walk from shimbashi
returns to shimbashi covering all 30 segments; GeoJSON is a FeatureCollection without `crs`, features are
`Feature`s in segment order with exact properties, LineString/MultiLineString (parts checked separately, gaps
between parts ≤ 30 m), coordinates inside the Tokyo bbox and ≤ 6 decimals; manifest has exactly
`dataVersion` + the contract `source`, and `dataVersion` matches the hash of the files on disk.

| Metric | Threshold | Measured |
|---|---|---|
| Segment endpoint ↔ station point | ≤ 30 m | 0.0 m (platform midpoints lie on N02 sections; max snap offset 1.5e-12 m) |
| Non-endpoint station ↔ segment | ≥ 100 m | 653.3 m |
| Track / straight-line ratio | ≤ 1.8 | 1.599 (品川→大崎) |
| Loop length | 34.5 ± 1.5 km | 34.453 km |
| `segments.geojson` size | ≤ 300,000 B | 12,992 B |

## Codex review (read-only, gpt-6.1-sol)

Network routing and the cycle DP were cross-checked by Codex against independent Bellman-Ford (250 cases) and
brute-force enumeration (200 cases): no bugs. Findings fixed: validator now checks names against the override,
Feature `type`, MultiLineString parts separately, recomputes `dataVersion`, and reports (not crashes) on
null/odd types; builder writes atomically with the manifest last; sections sorted by coordinates instead of
native-endian WKB; DP costs quantised to mm; build test asserts the exact five output files.
Not changed: (a) node rounding can join endpoints ≤ 1 cm apart without adding that distance to the cost (no
effect at current data, max snap offset ~0); (b) spec §5.1 lists "更新日" for the manifest, but the task contract
forbids timestamps — left out, see Open issues.

## Open issues / risks

- Spec §5.1 mentions 更新日 in the manifest; contract says no timestamps. If needed, add a fixed release date
  from an override file (keeps determinism) — needs a lead decision and a frontend contract update.
- Station markers sit on the chosen N02 platform's track centre. For multi-platform stations (東京, 上野, 新宿,
  品川, 日暮里, 新橋) N02 does not say which platform the Yamanote uses; the choice is the one on the through route.
- Per-segment track lengths between platform midpoints differ from 営業キロ by up to ~0.3 km (e.g. 渋谷→原宿 1.48 km
  vs 1.2 km per common tables); the loop total matches. Per-station 営業キロ were not verified against JR East.
- Determinism is verified on one machine (Python 3.13.16, Linux). Cross-machine byte equality depends on the
  pinned GEOS/PROJ wheels in `uv.lock`; Python 3.11/3.12 were not exercised.
- `pyproject.toml` excludes `.claude`, `.codex`, `.agents`, `N02-25_GML` from ruff, because ruff 0.17 formats
  Python blocks inside the template's Markdown files (9 would be reformatted). Template files were not touched.
- pyproj is pinned to 3.7.2 because 3.8.0 drops Python 3.11 (the lock split on `python_version`).
