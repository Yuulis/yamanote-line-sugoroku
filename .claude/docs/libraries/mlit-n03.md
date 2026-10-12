# 国土数値情報 行政区域データ (N03) — MLIT administrative boundaries

> **Last Updated**: 2026-10-12
> **Version Checked**: N03 2026年（令和8年）版, base date 2026-01-01, Tokyo file `N03-20260101_13_GML.zip`

## Overview

Evaluated for deciding "inside Tokyo's 23 special wards" in the JR East expansion
(`.claude/docs/research/jr-east-tokyo-expansion.md` §3). Recommendation there: **not** a pipeline input; used once as
verification evidence for a curated in-area station list.

- License: 「オープンデータ（CC_BY_4.0）」 on both the 2026 and 2025 dataset pages. Same terms family as N02 (see
  `.claude/docs/research/m3-license-terms.md`). Credit if ever shipped:
  「国土数値情報（行政区域データ）」（国土交通省）を加工して作成 (+ dataset URL, CC BY 4.0).
- Original sources: 国土地理院「数値地図（国土基本情報）」, 地理院タイル, 総務省「全国地方公共団体コード一覧」;
  page states 「測量法に基づく国土地理院長承認（複製）R 7JHf 351」.
- CRS: JGD2011 geographic (EPSG:6668), polygons (`MultiPolygon` in GeoJSON).

## Core Features

Per-prefecture polygon files of every municipality, keyed by the national local-government code.

### Files (Tokyo, prefecture code 13)

- Download: `https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_13_GML.zip` — listed as 12.54 MB;
  measured 13,153,227 B, sha256 `94f10b26256566db970dd74b09d614f059c1e8a432f9244ac9c4add76c32ff16` (2026-10-12).
- Contents: `N03-20260101_13.geojson` (18.3 MB), `.shp/.shx/.dbf/.prj/.cpg`, `N03-20260101_13.xml` (GML),
  `KS-META-N03-20260101_13.xml`.

### Attributes

| Field | Meaning |
|---|---|
| `N03_001` | 都道府県名 |
| `N03_002` | 北海道の振興局名 (null elsewhere) |
| `N03_003` | 郡名 |
| `N03_004` | 市区町村名 (incl. 特別区) |
| `N03_005` | 政令指定都市の行政区名 |
| `N03_007` | 全国地方公共団体コード (5 digits) |

23 special wards = `N03_007` in 13101–13123 (all 23 present in the 2026 Tokyo file). A ward is split into many
features (islands, reclaimed land) — union by code before use.

## Constraints & Notes

- `所属未定地` features (`N03_007` = 13000) exist, including Tokyo Bay reclaimed land (≈2.36 km² near 139.819 E
  35.588 N; ≈1.12 km² near 139.846 E 35.650 N). They are not ward land; a polygon-based "in 23 wards" test excludes
  them.
- The page notes corrections to the 千代田区/中央区/港区 boundaries and the 中央防波堤 reclaimed land, and warns that
  some municipal boundaries are provisional (暫定境界).
- Ward boundaries follow rivers (荒川, 江戸川, 多摩川, 旧江戸川), so railway sections cross the edge mid-bridge — clip
  stations, not tracks.
- The union of ward polygons has 16 zero-area interior rings (sliver artefacts) — measure distances to the exterior
  ring only.
- Raw data must stay out of git (same policy as N02); CI cannot re-run a polygon check.

## References

- Dataset page (2026): https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html
- Dataset page (2025): https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html
- Tokyo file: https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_13_GML.zip
- Usage in this project: `.claude/docs/research/jr-east-tokyo-expansion.md` §3
