# In-area service graph (23 wards) — input for the game-length simulation

Date: 2026-10-12 · Researcher · Status: **draft-final** (stop lists verified against JR East official timetables,
edition 2610; open items are user decisions, not data gaps). Evidence and URLs:
`.claude/docs/research/jr-east-tokyo-expansion.md` (§1 per-service sources, §2 station table, §3 boundary).

Conventions: one physical station = one name (JR East timetable spelling, large ケ); stops are already clipped to the
23 wards; segments exist only between consecutive stops in a row. Linear services are listed in one direction
(both directions are valid in play). `jr-yamanote` is listed in outer-loop order from 新橋 and closes back to 新橋.

## CSV

`status`: `core` = recommended; `optional` = user decision, default off; `excluded` = listed only so a simulation
can toggle it. `stops` are `|`-separated.

```csv
service_id,name_ja,circular,status,stop_count,stops
jr-yamanote,山手線,yes,core,30,新橋|浜松町|田町|高輪ゲートウェイ|品川|大崎|五反田|目黒|恵比寿|渋谷|原宿|代々木|新宿|新大久保|高田馬場|目白|池袋|大塚|巣鴨|駒込|田端|西日暮里|日暮里|鶯谷|上野|御徒町|秋葉原|神田|東京|有楽町
jr-keihin-tohoku,京浜東北線,no,core,22,赤羽|東十条|王子|上中里|田端|西日暮里|日暮里|鶯谷|上野|御徒町|秋葉原|神田|東京|有楽町|新橋|浜松町|田町|高輪ゲートウェイ|品川|大井町|大森|蒲田
jr-chuo-sobu-local,中央・総武線各駅停車,no,core,24,西荻窪|荻窪|阿佐ケ谷|高円寺|中野|東中野|大久保|新宿|代々木|千駄ケ谷|信濃町|四ツ谷|市ケ谷|飯田橋|水道橋|御茶ノ水|秋葉原|浅草橋|両国|錦糸町|亀戸|平井|新小岩|小岩
jr-saikyo,埼京線,no,core,10,大崎|恵比寿|渋谷|新宿|池袋|板橋|十条|赤羽|北赤羽|浮間舟渡
jr-keiyo,京葉線,no,core,6,東京|八丁堀|越中島|潮見|新木場|葛西臨海公園
jr-yokosuka-sobu-rapid,横須賀・総武快速線,no,optional,8,西大井|品川|新橋|東京|新日本橋|馬喰町|錦糸町|新小岩
jr-joban-rapid,常磐線快速,no,optional,5,上野|日暮里|三河島|南千住|北千住
jr-joban-local,常磐線各駅停車,no,excluded,3,綾瀬|亀有|金町
jr-musashino,武蔵野線(京葉線直通),no,excluded,6,東京|八丁堀|越中島|潮見|新木場|葛西臨海公園
jr-utsunomiya-takasaki,宇都宮線・高崎線,no,excluded,3,上野|尾久|赤羽
jr-chuo-rapid,中央線快速,no,excluded,10,東京|神田|御茶ノ水|四ツ谷|新宿|中野|高円寺|阿佐ケ谷|荻窪|西荻窪
```

Endpoint types (for terminus vs area-boundary handling):

| service_id | first stop | last stop |
|---|---|---|
| jr-keihin-tohoku | 赤羽: area boundary (next 川口) | 蒲田: area boundary (next 川崎) |
| jr-chuo-sobu-local | 西荻窪: area boundary (next 吉祥寺) | 小岩: area boundary (next 市川) |
| jr-saikyo | 大崎: JR terminus (through to TWR りんかい線 / 相鉄直通 out of scope) | 浮間舟渡: area boundary (next 戸田公園) |
| jr-keiyo | 東京: terminus | 葛西臨海公園: area boundary (next 舞浜) |
| jr-yokosuka-sobu-rapid | 西大井: area boundary (next 武蔵小杉) | 新小岩: area boundary (next 市川) |
| jr-joban-rapid | 上野: service end in area (上野東京ライン through out of scope) | 北千住: area boundary (next 松戸) |
| jr-joban-local | 綾瀬: JR terminus (千代田線 through) | 金町: area boundary (next 松戸) |

Core set: 5 services, 67 stations, 92 service-stops, 88 undirected segments, 22 transfer stations.

## Flags

**(a) Services split into 2+ disconnected in-area pieces:** none. No candidate leaves and re-enters the 23 wards.

**(b) Branching services:** none inside the area. 京葉線's branches (市川塩浜/南船橋–西船橋) and the 武蔵野線 split are
outside. 埼京線's continuation beyond 大崎 (TWR, 相鉄直通) is out of scope, so 大崎 is a dead end.

**(c) Uncertain or checked inclusions:**

| Item | Finding | Proposal |
|---|---|---|
| 常磐線各駅停車 | JR's 各停 begins at **綾瀬**: 北千住–綾瀬 is the 東京メトロ千代田線 section, and 北千住 is not a JR 各停 stop. In-area stops are 綾瀬, 亀有, 金町. It shares **no** station with any other in-scope service in the area, so it is unreachable. | exclude; if kept, the simulation should show it is never boarded |
| 南武線 | 0 stations in the 23 wards (川崎–立川; first Tokyo station 矢野口 is in 稲城市) | n/a |
| 武蔵野線 | 0 own stations in the area. Its 東京-through trains stop at exactly the 京葉線 6. | exclude (it would only double the 京葉線 weight at 東京) |
| 京葉線 | in-area 各停 = 6 stops; 快速 skips 越中島, 潮見, 葛西臨海公園 | core, all-stop pattern |
| 横須賀線 / 総武快速 | 中距離 (普通) + 快速 through-running at 東京. In the area it stops at every station on its own tracks. | optional, default off |
| 宇都宮線 / 高崎線 | medium-distance; the only orphan is 尾久 | exclude |
| 赤羽線 | = 埼京線 池袋–赤羽 (板橋, 十条) | inside `jr-saikyo` |
| 埼京線 大崎–池袋 | uses the 山手貨物線 and stops at 大崎, 恵比寿, 渋谷, 新宿, 池袋 only (no platforms at the other Yamanote stations). 快速 and 通勤快速 make the same stops 大崎–赤羽 and skip 北赤羽 and 浮間舟渡. | core, 普通 pattern |
| 常磐線快速 | stops at all of 上野–北千住 in the area | optional, default off |
| 中央線快速 | rapid; orphans no station | exclude |
| 京浜東北 快速 | daytime 快速 skips 西日暮里, 日暮里, 鶯谷, 御徒町, 有楽町, 新橋 | ignored; all-stop pattern |

## Transfers

- **Transfers between differently named JR East stations: none** in the area. The 有楽町 ↔ 東京(京葉線) slip
  transfer is handled by station staff and not published by JR East, so it is not modelled. 浜松町↔大門 and
  similar pairs are non-JR.
- **Same-name stations with platforms far apart** (N02 platform midpoints, JR East only, ≥ 100 m):

| Station | Max spread | Between | Note |
|---|---:|---|---|
| 東京 | 459 m | 京葉線 ↔ 東北新幹線 platforms | JR lists 京葉線 under station 東京, so it is the same station. N02 group code differs (`003785` vs `003766`), so join them by override. Using one shared point puts the 京葉線 segment start ~450 m off its track; consider a per-service platform point for geometry. |
| 新宿 | 216 m | 山手線 ↔ 山手線 (5 features) | one station |
| 上野 | 166 m | 東北線 ↔ 東北線 (5 features) | one station |
| 品川 | 130 m | 東海道線 ↔ 東海道線 (4 features) | one station |
| 池袋, 秋葉原, 代々木, 赤羽, 御茶ノ水, 神田, 田端, 日暮里, 中野 | < 100 m | — | one station |

The shared-Station-id assumption holds for every core station. 東京 is the only case where the geometry endpoint
needs care.

## 営業キロ references for the validator length check

**Not from an official source.** JR East's own pages are HTTP 403 from this environment, the JR East timetable site
does not publish distances, and MLIT 鉄道要覧 is not online. The values below come from Japanese Wikipedia station
tables (cross-check only), and every one agrees with the independent N02 chord-sum estimate. Use them as references
with a tolerance, e.g. measured track length within ±1.5 km, the same tolerance M0 used for the loop.

| service_id | In-area span | 営業キロ | Derivation (cumulative km on the legal line) | N02 chord sum |
|---|---|---:|---|---:|
| jr-yamanote | loop | 34.5 | 山手線 loop (unchanged, M0) | 32.6 |
| jr-keihin-tohoku | 赤羽–蒲田 | 27.6 | 東北本線 東京→赤羽 13.2 + 東海道本線 東京→蒲田 14.4 | 27.0 |
| jr-chuo-sobu-local | 西荻窪–小岩 | 30.3 | 中央本線 御茶ノ水 2.6 → 西荻窪 20.6 (18.0) + 総武本線支線 御茶ノ水–錦糸町 4.3 + 総武本線 錦糸町 4.8 → 小岩 12.8 (8.0); also 千葉起点 56.7 − 26.4 | 29.8 |
| jr-saikyo | 大崎–浮間舟渡 | 22.0 | 埼京線 km from 大崎: 池袋 13.4, 赤羽 18.9, 浮間舟渡 22.0 | 21.5 |
| jr-keiyo | 東京–葛西臨海公園 | 10.6 | 京葉線 km from 東京 | 10.0 |

Sources (Wikipedia, cross-check): https://ja.wikipedia.org/wiki/京浜東北線 (赤羽 13.2, 蒲田 14.4),
https://ja.wikipedia.org/wiki/中央・総武緩行線 (西荻窪 20.6 / 56.7, 御茶ノ水 2.6 / 38.7, 錦糸町 4.8 / 34.4, 小岩
12.8 / 26.4), https://ja.wikipedia.org/wiki/埼京線 (大崎 0.0 … 浮間舟渡 22.0), https://ja.wikipedia.org/wiki/京葉線
(葛西臨海公園 10.6).

Caveat: 営業キロ is measured along the legal line, not the track a service actually uses. 京浜東北 runs on the parallel
電車線, and 埼京 on the 山手貨物線 and 赤羽線. Measured lengths between platform midpoints can also differ per segment
by ~0.3 km, as M0 found, so check per-service totals, not per-segment values.
