# R1b extra inventory: みなとみらい線・北総線

2026-10-15 addendum to R1. Full operator lines, weekday local/各停 service, no area cut. CSV follows the R1 18-column catalog schema.

## Counts and choices

| Line | Service | Stops | Official basis |
|---|---|---:|---|
| 横浜高速鉄道 みなとみらい線 | `mm-minatomirai` | 6 | Official station list: 横浜–元町・中華街 (six stations). |
| 北総鉄道 北総線 | `hokuso-main` | 15 | Company profile reports 15 stations and 京成高砂–印旛日本医大 (京成高砂 is shared use); official station list names HS01–HS14. |

Total: 2 services, 21 stop rows and 21 proposed IDs. The 北総線 catalog includes shared-use 京成高砂 as the service origin; it has no HS code. `北総鉄道 / 北総線` is the N02 operator/line pair. N02's みなとみらい線 entry is `横浜高速鉄道 / みなとみらい21線` (as recorded by R1-PW).

## Raw N02 audit (correction)

The raw 2025 N02 files are present in `N02-25_GML/UTF-8/`. Inspection of `N02-25_Station.geojson` confirms all 21 rows under the stated operator/line pairs: 6 `横浜高速鉄道 / みなとみらい21線` and 15 `北総鉄道 / 北総線`. `N02-25_RailroadSection.geojson` contains both corresponding line/operator pairs. The station feature names match all catalog names, including `京成高砂` under `北総鉄道 / 北総線`; its N02 station code is `003251`, while the separate Keisei records belong to Keisei. IDs therefore remain operator-prefixed (`hokuso-keisei-takasago` versus Keisei's own ID), as required before R2 identity merging. `python3 .claude/logs/r1b/check.py` performs the same per-row feature, line, ID-prefix, order, count, and endpoint checks.

Municipality is city + ward for Yokohama. 北総 addresses are assigned from the official station pages/addresses; the commuter map and official station codes establish order. Transfer rows only record selected official interchange points that the existing in-scope operators have: Yokohama, Keisei-Takasago, Higashi-Matsudo and Shin-Kamagaya. A complete cross-operator transfer audit remains for R2.

## Sources

- Yokohama Kosoku official station list: https://www.mm21railway.co.jp/sp/station/
- Official route map and through-running diagram: https://ftp.mm21railway.co.jp/info/route_map.html
- Hokuso official station list and HS codes: https://www.hokuso-railway.co.jp/railway/station/
- Hokuso official route map: https://www.hokuso-railway.co.jp/docs/railway/route_map.pdf
- Hokuso company profile (15 stations, route length, shared station and railway business sections): https://www.hokuso-railway.co.jp/hokuso/outline.html
- Hokuso station timetable / weekday local service example: https://www.hokuso-railway.co.jp/railway/station/yagiri.html

## Open questions

- Verify every extra transfer against the receiving operators' official station pages during R2; this CSV records the official-source candidates but is not an exhaustive transfer graph.
- R2 should retain the operator-specific identity boundary at shared-use 京成高砂, then decide cross-operator physical-station merging. The N02 audit confirms station/line membership, not track geometry or geometry quality.
