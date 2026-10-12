# JR East all-stop services inside Tokyo's 23 wards — research for the expansion

Date: 2026-10-12 · Researcher (Agent Teams `feature-jr-east-tokyo-expansion`) · Read-only research, no code changed.
Brief: `.claude/docs/research/feature-jr-east-tokyo-expansion-brief.md` · Codebase scan:
`.claude/docs/research/feature-jr-east-tokyo-expansion-codebase.md` · M0: `.claude/docs/research/m0-data-spike.md`
· Spec `railway_sugoroku_mvp_spec.md` §2, §4.

## 0. Result (decision summary)

| # | Service id (proposal) | Official service name | Shape in area | In-area stations | Ends (in area) | First station outside |
|---|---|---|---|---:|---|---|
| 1 | `jr-yamanote` | 山手線 | loop | 30 | — | — |
| 2 | `jr-keihin-tohoku` | 京浜東北線・根岸線 | linear | 22 | 赤羽 (JK38) … 蒲田 (JK17) | 川口 (Saitama) / 川崎 (Kanagawa) |
| 3 | `jr-chuo-sobu-local` | 中央・総武線各駅停車 | linear | 24 | 西荻窪 (JB03) … 小岩 (JB26) | 吉祥寺 (武蔵野市) / 市川 (Chiba) |
| 4 | `jr-saikyo` | 埼京線・川越線 | linear | 10 | 大崎 (JA08, JR terminus) … 浮間舟渡 (JA17) | — / 戸田公園 (Saitama) |
| 5 | `jr-keiyo` | 京葉線 (・武蔵野線直通) | linear | 6 | 東京 (JE01, terminus) … 葛西臨海公園 (JE06) | — / 舞浜 (Chiba) |

- **Core set = 5 services, 67 unique stations, 22 transfer stations** (≥ 2 core services), 92 service-stops,
  88 undirected segments (30 Yamanote + 58 others), all in-area services are **linear without branches**.
- **JR East has 77 passenger stations inside the 23 wards** (N02 2025 × N03 2026 point-in-polygon, §3.3). The 10 not
  covered by the core set are reachable only by excluded services: 新日本橋, 馬喰町 (総武快速), 西大井 (横須賀線 /
  湘南新宿ライン / 相鉄直通), 三河島, 南千住, 北千住 (常磐線快速), 尾久 (宇都宮・高崎線), 綾瀬, 亀有, 金町
  (常磐線各駅停車 — see the "island" problem in §1.3).
- **Boundary**: use a curated per-service in-area station list (override CSV) as the source of truth; N03 is the
  verification evidence, not a pipeline input (§3).
- **Every in-area transfer is a same-name, same-station transfer.** No officially published JR-to-JR transfer between
  differently named stations is needed (§2.3).

Items needing a **user decision** are collected in §5.

---

## 1. Services

### 1.1 Method and sources

All stop lists come from JR East's official timetable site, edition `2610` (URLs contain the edition and will move
when a new edition is published):

- Per-line ordered station lists with prefecture (`st_search.cgi?mode=1&rosen=<id>`):
  京浜東北線 https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&rosen=24 ,
  京葉線 `rosen=25`, 埼京線 `rosen=29`, 常磐線 `rosen=34`, 常磐・成田線 `rosen=33`, 総武線 `rosen=39`,
  総武線快速 `rosen=40`, 高崎線 `rosen=43`, 中央本線 `rosen=46`, 東海道線 `rosen=49`, 南武線 `rosen=53`,
  武蔵野線 `rosen=63`, 山手線 `rosen=66`, 横須賀線 `rosen=67`, 宇都宮線 `rosen=82`
  (same base URL, replace the `rosen` value).
- Per-station service/direction lists: `https://timetables.jreast.co.jp/timetable/list<code>.html` (codes in §2.1).
- Per-train stop lists (one representative train per service, weekday, timetable 2610) — cited per service below.
- `www.jreast.co.jp` station pages and route map return HTTP 403 from this environment (also seen in M0); they were
  not used. Station numbers (JK/JB/JA/JE/JL/JO/JJ) are **cross-checks from Japanese Wikipedia** (labelled), not from
  JR East pages: https://ja.wikipedia.org/wiki/京浜東北線 , https://ja.wikipedia.org/wiki/中央・総武緩行線 ,
  https://ja.wikipedia.org/wiki/埼京線 , https://ja.wikipedia.org/wiki/京葉線 , https://ja.wikipedia.org/wiki/常磐緩行線 ,
  https://ja.wikipedia.org/wiki/横須賀・総武快速線 , https://ja.wikipedia.org/wiki/常磐線 . The numbers are
  consistent with the official station order in every case.

"All-stop pattern" below = the stops of a train JR East labels 普通 on its timetable. Where rapid trains share the
service (京浜東北 快速, 京葉線 快速, 埼京線 快速/通勤快速) the game uses the 普通 pattern, per spec §2
(対象駅 = 各駅停車相当の停車駅).

### 1.2 Core services (recommended)

#### 1.2.1 山手線 — `jr-yamanote` (loop, 30)
Unchanged from M0 (`.claude/docs/research/m0-data-spike.md`), official list
https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&rosen=66 (30 stations, all 東京都 / 23 wards).

#### 1.2.2 京浜東北線・根岸線 — `jr-keihin-tohoku` (linear, 22 in area)

| # | Station | No. (wiki) | Ward (N03) | N02 line | Other core services |
|---:|---|---|---|---|---|
| 1 | 赤羽 | JK38 | 北区 | 東北線 | 埼京 |
| 2 | 東十条 | JK37 | 北区 | 東北線 | |
| 3 | 王子 | JK36 | 北区 | 東北線 | |
| 4 | 上中里 | JK35 | 北区 | 東北線 | |
| 5 | 田端 | JK34 | 北区 | 東北線 | 山手 |
| 6 | 西日暮里 | JK33 | 荒川区 | 東北線 | 山手 |
| 7 | 日暮里 | JK32 | 荒川区/台東区 (edge) | 東北線 | 山手 |
| 8 | 鶯谷 | JK31 | 台東区 | 東北線 | 山手 |
| 9 | 上野 | JK30 | 台東区 | 東北線 | 山手 |
| 10 | 御徒町 | JK29 | 台東区 | 東北線 | 山手 |
| 11 | 秋葉原 | JK28 | 千代田区 | 東北線 | 山手, 中央総武 |
| 12 | 神田 | JK27 | 千代田区 | 東北線 | 山手 |
| 13 | 東京 | JK26 | 千代田区 | 東北線 | 山手, 京葉 |
| 14 | 有楽町 | JK25 | 千代田区 | 東海道線 | 山手 |
| 15 | 新橋 | JK24 | 港区 | 東海道線 | 山手 |
| 16 | 浜松町 | JK23 | 港区 | 東海道線 | 山手 |
| 17 | 田町 | JK22 | 港区 | 東海道線 | 山手 |
| 18 | 高輪ゲートウェイ | JK21 | 港区 | 東海道線 | 山手 |
| 19 | 品川 | JK20 | 港区 | 東海道線 | 山手 |
| 20 | 大井町 | JK19 | 品川区 | 東海道線 | |
| 21 | 大森 | JK18 | 大田区 | 東海道線 | |
| 22 | 蒲田 | JK17 | 大田区 | 東海道線 | |

- Beyond: 川口 (Saitama, after crossing 荒川) and 川崎 (Kanagawa, after crossing 多摩川).
- Official order/prefectures: https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&rosen=24 .
- 普通 train 赤羽 09:05 → 大船, stops at every station above in order, then 川崎:
  https://timetables.jreast.co.jp/2610/train/065/066981.html .
- 快速 (daytime) skips 西日暮里, 日暮里, 鶯谷, 御徒町, 有楽町, 新橋 (stops 神田 and 高輪ゲートウェイ):
  https://timetables.jreast.co.jp/2610/train/100/103921.html — ignored by the game (all-stop pattern).
- Overlap: same 15 stations as 山手線 between 田端 and 品川 on separate, parallel tracks (all 15 become transfer
  stations). In N02 both services sit on 東北線 (田端–東京) and 東海道線 (東京–品川) — the M0 Yamanote mapping already
  routes Yamanote on those N02 lines, so **the two services' segment geometries will (nearly) coincide**; the map
  needs a visual offset or draw-order rule.
- N02 lines per run: 東北線 赤羽→東京, 東海道線 東京→蒲田 (same split as the M0 Yamanote mapping).

#### 1.2.3 中央・総武線各駅停車 — `jr-chuo-sobu-local` (linear, 24 in area)

| # | Station | No. (wiki) | Ward | N02 line / name | Other core services |
|---:|---|---|---|---|---|
| 1 | 西荻窪 | JB03 | 杉並区 | 中央線 | |
| 2 | 荻窪 | JB04 | 杉並区 | 中央線 | |
| 3 | 阿佐ケ谷 | JB05 | 杉並区 | 中央線 / **阿佐ヶ谷** | |
| 4 | 高円寺 | JB06 | 杉並区 | 中央線 | |
| 5 | 中野 | JB07 | 中野区 | 中央線 (3 platform features) | |
| 6 | 東中野 | JB08 | 中野区 | 中央線 | |
| 7 | 大久保 | JB09 | 新宿区 | 中央線 (**homonym** on 奥羽線, Akita) | |
| 8 | 新宿 | JB10 | 新宿区/渋谷区 (edge) | 中央線 | 山手, 埼京 |
| 9 | 代々木 | JB11 | 渋谷区 | 中央線 | 山手 |
| 10 | 千駄ケ谷 | JB12 | 渋谷区 | 中央線 / **千駄ヶ谷** | |
| 11 | 信濃町 | JB13 | 新宿区 | 中央線 | |
| 12 | 四ツ谷 | JB14 | 千代田区 | 中央線 | |
| 13 | 市ケ谷 | JB15 | 千代田区 | 中央線 / **市ヶ谷** | |
| 14 | 飯田橋 | JB16 | 千代田区 | 中央線 | |
| 15 | 水道橋 | JB17 | 千代田区 | 中央線 | |
| 16 | 御茶ノ水 | JB18 | 千代田区 | 中央線 + 総武線 | |
| 17 | 秋葉原 | JB19 | 千代田区 | 総武線 | 山手, 京浜東北 |
| 18 | 浅草橋 | JB20 | 台東区 | 総武線 | |
| 19 | 両国 | JB21 | 墨田区 | 総武線 | |
| 20 | 錦糸町 | JB22 | 墨田区 | 総武線 | |
| 21 | 亀戸 | JB23 | 江東区 | 総武線 | |
| 22 | 平井 | JB24 | 江戸川区 | 総武線 | |
| 23 | 新小岩 | JB25 | 葛飾区 | 総武線 | |
| 24 | 小岩 | JB26 | 江戸川区 | 総武線 | |

- Beyond: 吉祥寺 (武蔵野市, 1.1 km outside) and 市川 (Chiba, after 江戸川).
- 普通 train 三鷹 09:00 → 千葉: 三鷹, 吉祥寺, then all 24 stations above, then 市川:
  https://timetables.jreast.co.jp/2610/train/165/169471.html .
- Official line lists split it: 中央本線 (`rosen=46`, 東京…西荻窪… includes rapid-only 東京/神田) and 総武線
  (`rosen=39`, 御茶ノ水…千葉). The service name 「中央・総武線各駅停車」 is what every station page uses, e.g. 西荻窪
  https://timetables.jreast.co.jp/timetable/list1152.html , 秋葉原 https://timetables.jreast.co.jp/timetable/list0041.html .
- Overlaps: 中央線快速 runs parallel 御茶ノ水–西荻窪 (excluded; its in-area stops 東京, 神田, 御茶ノ水, 四ツ谷, 新宿,
  中野, 高円寺, 阿佐ケ谷, 荻窪, 西荻窪 are all covered by core services, so excluding it orphans no station);
  総武快速 parallel 錦糸町–小岩. **N02 `中央線` contains both the rapid and local track pairs**, so shortest-path
  routing between local-only stations can hop onto the rapid tracks; check per-segment geometry (via-points or
  section allowlist if needed, as flagged in the codebase scan §1.3).
- Through-running at 中野 to 東京メトロ東西線 (station page lists 「東京メトロ東西線 西船橋方面（ＪＲ線直通列車のみ表示）」,
  https://timetables.jreast.co.jp/timetable/list1104.html ) is out of scope (subway).

#### 1.2.4 埼京線 — `jr-saikyo` (linear, 10 in area)

| # | Station | No. (wiki) | Ward | N02 line | Other core services |
|---:|---|---|---|---|---|
| 1 | 大崎 | JA08 | 品川区 | 山手線 (single N02 platform feature shared with Yamanote) | 山手 |
| 2 | 恵比寿 | JA09 | 渋谷区 | 山手線 (single feature) | 山手 |
| 3 | 渋谷 | JA10 | 渋谷区 | 山手線 (single feature) | 山手 |
| 4 | 新宿 | JA11 | 新宿区/渋谷区 | 山手線 (5 features at 新宿) | 山手, 中央総武 |
| 5 | 池袋 | JA12 | 豊島区 | 山手線 + 赤羽線 | 山手 |
| 6 | 板橋 | JA13 | 豊島区 (platform midpoint; the station sits near the 豊島区/北区/板橋区 junction) | 赤羽線 | |
| 7 | 十条 | JA14 | 北区 | 赤羽線 | |
| 8 | 赤羽 | JA15 | 北区 | 赤羽線 + 東北線 | 京浜東北 |
| 9 | 北赤羽 | JA16 | 北区 | 東北線 | |
| 10 | 浮間舟渡 | JA17 | 北区 | 東北線 | |

- Beyond: 戸田公園 (Saitama, after 荒川). South: 大崎 is the **JR terminus** — the 埼京線 timetable at 大崎 has only the
  下り direction (https://timetables.jreast.co.jp/timetable/list0319.html); trains continue as TWR りんかい線 (non-JR)
  or as 「相鉄線直通」 via 西大井 – 武蔵小杉 (shown as a separate service by JR).
- 普通 train 浮間舟渡 09:07 → 新木場 stops at all 10 in order, then TWR stations (大井町 [TWR], 品川シーサイド …):
  https://timetables.jreast.co.jp/2610/train/150/153631.html . Note the TWR 大井町 is a different operator's
  station with the same name as JR 大井町 (京浜東北) — do not merge them.
- 相鉄直通 example (大宮 07:05 → 海老名): JR column switches at 新宿 to the 相鉄直通 column 渋谷, 恵比寿, 大崎, 西大井,
  武蔵小杉: https://timetables.jreast.co.jp/2610/train/080/081771.html . Recommendation: 埼京線 ends at 大崎; 西大井 is
  not part of the 埼京線 all-stop pattern.
- 快速 and 通勤快速 stop at every station 大崎–赤羽 and skip 北赤羽, 浮間舟渡:
  https://timetables.jreast.co.jp/2610/train/080/084371.html , https://timetables.jreast.co.jp/2610/train/060/060111.html
  — game uses 普通.
- Overlaps: parallel to 山手線 大崎–池袋 on the 山手貨物線 (shared with 湘南新宿ライン). **N02 puts the 山手貨物線 under
  `山手線`**, and at 大崎/恵比寿/渋谷 there is only one N02 platform feature, so the 埼京線 station marker and route
  will snap onto the same N02 line as the Yamanote. Route 池袋→赤羽 on N02 `赤羽線`, 赤羽→浮間舟渡 on `東北線`.

#### 1.2.5 京葉線 — `jr-keiyo` (linear, 6 in area)

| # | Station | No. (wiki) | Ward | N02 line / group | Other core services |
|---:|---|---|---|---|---|
| 1 | 東京 | JE01 | 千代田区 | 京葉線, group `003785` (≠ 東京 main `003766`) | 山手, 京浜東北 |
| 2 | 八丁堀 | JE02 | 中央区 | 京葉線 | |
| 3 | 越中島 | JE03 | 江東区 | 京葉線 | |
| 4 | 潮見 | JE04 | 江東区 | 京葉線 | |
| 5 | 新木場 | JE05 | 江東区 | 京葉線 | |
| 6 | 葛西臨海公園 | JE06 | 江戸川区 | 京葉線 | |

- Beyond: 舞浜 (浦安市, Chiba, after 旧江戸川). 東京 is the terminus.
- 普通 東京 09:10 → 蘇我: https://timetables.jreast.co.jp/2610/train/115/117501.html .
  快速 skips 越中島, 潮見, 葛西臨海公園: https://timetables.jreast.co.jp/2610/train/160/164951.html .
- 武蔵野線 through trains (東京 09:05 → 府中本町) stop at exactly the same 6 stations, then 舞浜, 新浦安, 市川塩浜,
  西船橋 …: https://timetables.jreast.co.jp/2610/train/130/133801.html . JR's station pages name the service
  「京葉線・武蔵野線」 (e.g. 越中島 https://timetables.jreast.co.jp/timetable/list0286.html ).
- 東京's 京葉線 platform is listed under the same station 東京 (list code 1039,
  https://timetables.jreast.co.jp/timetable/list1039.html ) → **same station group** as 東京 (Yamanote/京浜東北), even
  though N02 gives it a different group code (`003785`) and it lies ~448 m away (codebase scan §0.4).
- Branches (市川塩浜–西船橋, 南船橋–西船橋 二俣支線) and the 武蔵野線 split are all **outside** the area — no branch
  handling needed in-area.

### 1.3 Services evaluated and not recommended (default)

| Service | In-area stops (official order) | Why excluded | Orphaned stations if excluded |
|---|---|---|---|
| 常磐線各駅停車 (JL) | 綾瀬 JL19, 亀有 JL20, 金町 JL21 → 松戸 (Chiba) | All-stop service, but an **island**: JR's 各停 begins at 綾瀬 (北千住–綾瀬 is the 東京メトロ千代田線 column on JR's own train page https://timetables.jreast.co.jp/2610/train/175/178871.html ; 綾瀬 page lists only 「常磐線各駅停車 取手方面」 + 千代田線 https://timetables.jreast.co.jp/timetable/list0078.html ). It shares no station with any other JR service inside the 23 wards; its only JR connection is 松戸 (outside). A player could never board it. | 綾瀬, 亀有, 金町 |
| 武蔵野線 | own stations: none in the 23 wards (府中本町 … 西船橋, https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&rosen=63 ); in-area only as 京葉線 through trains | Same 6 in-area stops as 京葉線 → would only double 京葉線's lottery weight at 東京 | none |
| 南武線 | none (川崎 … 立川; first Tokyo station 矢野口 is 稲城市) https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&rosen=53 | outside area | none |
| 横浜線, 青梅線, 五日市線, 鶴見線 | none | outside area | none |
| 横須賀・総武快速線 (JO) | 西大井 JO16, 品川 JO17, 新橋 JO18, 東京 JO19 \| 東京, 新日本橋 JO20, 馬喰町 JO21, 錦糸町 JO22, 新小岩 JO23 → 武蔵小杉 / 市川 | 横須賀線 trains are labelled 普通 but it is a 中距離 service; 総武線快速 trains are 快速 (timetable legend at 東京: https://timetables.jreast.co.jp/2610/timetable/tt1039/1039080.html ). Through-running at 東京 (e.g. https://timetables.jreast.co.jp/2610/train/115/115281.html ). Within the area it stops at every station that has platforms on its own tracks. **User decision** (§5). | 西大井, 新日本橋, 馬喰町 |
| 常磐線快速 (JJ) | 上野 JJ01, 日暮里 JJ02, 三河島 JJ03, 南千住 JJ04, 北千住 JJ05 → 松戸 | Brief excludes it as rapid, but inside the area it stops at **every** station on its tracks (快速 上野 09:12: https://timetables.jreast.co.jp/2610/train/105/106321.html ) — arguably 各駅停車相当. **User decision** (§5). Including it does **not** connect 常磐線各駅停車 (no shared in-area station). | 三河島, 南千住, 北千住 |
| 宇都宮線・高崎線 (上野東京ライン) | (品川, 新橋,) 東京, 上野, 尾久, 赤羽 → 浦和 | medium-distance (https://timetables.jreast.co.jp/2610/train/045/047911.html ) | 尾久 |
| 中央線快速 | 東京, 神田, 御茶ノ水, 四ツ谷, 新宿, 中野, 高円寺*, 阿佐ケ谷*, 荻窪, 西荻窪* (*weekday only per station pages, e.g. https://timetables.jreast.co.jp/timetable/list0045.html ) | rapid (brief) | none |
| 東海道線, 湘南新宿ライン, 成田エクスプレス, 相鉄線直通 | — | medium-distance / limited express / through service | 西大井 is also served by 湘南新宿ライン and 相鉄直通 |

Note on "各駅停車相当": "stops at every station that has a platform on its own tracks inside the area" is **not** a
usable rule — it also admits 東海道線 (東京, 新橋, 品川), 宇都宮/高崎線, 横須賀線 and weekday 中央線快速. The scope
must be an explicit service list (recommended: §0 core set).

---

## 2. Stations, services per station, transfers, groups

### 2.1 All 77 JR East stations in the 23 wards

Legend for "Served by" (from each station's official page `https://timetables.jreast.co.jp/timetable/list<code>.html`):
Y 山手, K 京浜東北, B 中央・総武各停, A 埼京, E 京葉(・武蔵野), L 常磐各停, O 横須賀/総武快速, J 常磐快速,
U 宇都宮・高崎/上野東京ライン, S 湘南新宿, C 中央線快速/中央本線, T 東海道線, X 相鉄線直通, R りんかい線直通,
M 東京メトロ直通, N 成田エクスプレス. "Core" = number of core services (Y K B A E). Ward from N03 2026.
N02 = JR East N02 2025 line(s) / group code(s) / platform-feature count; N02 spelling given when it differs.

| Station | code | Ward | Served by | Core | N02 lines / group / n | N02 name |
|---|---|---|---|---:|---|---|
| 新宿 | 0866 | 新宿区\|渋谷区 | YBASCXN | 3 | 中央線 山手線 / 003700 / 5 | |
| 東京 | 1039 | 千代田区 | YKEOUCN | 3 | 京葉線 東北新幹線 東北線 東海道線 総武線 / 003766,003785 / 10 | |
| 秋葉原 | 0041 | 千代田区 | YKB | 3 | 東北線 総武線 / 003624 / 2 | |
| 上野 | 0204 | 台東区 | YKJU | 2 | 東北新幹線 東北線 / 003505 / 5 | |
| 代々木 | 1654 | 渋谷区 | YB | 2 | 中央線 山手線 / 003743 / 2 | |
| 品川 | 0788 | 港区 | YKOUTN | 2 | 山手線 東海道線 / 004095 / 4 | |
| 大崎 | 0319 | 品川区 | YASXR | 2 | 山手線 / 004135 / 1 | |
| 御徒町 | 0355 | 台東区 | YK | 2 | 東北線 / 003555 / 1 | |
| 恵比寿 | 0290 | 渋谷区 | YASX | 2 | 山手線 / 003991 / 1 | |
| 新橋 | 0877 | 港区 | YKOUT | 2 | 東海道線 / 003872 / 2 | |
| 日暮里 | 1184 | 台東区\|荒川区 | YKJ | 2 | 常磐線 東北線 / 003417 / 3 | |
| 有楽町 | 1617 | 千代田区 | YK | 2 | 東海道線 / 003795 / 1 | |
| 池袋 | 0108 | 豊島区 | YAS | 2 | 山手線 赤羽線 / 003390 / 2 | |
| 浜松町 | 1248 | 港区 | YK | 2 | 東海道線 / 003949 / 1 | |
| 渋谷 | 0808 | 渋谷区 | YASXN | 2 | 山手線 / 003922 / 1 | |
| 田町 | 0976 | 港区 | YK | 2 | 東海道線 / 004000 / 1 | |
| 田端 | 0972 | 北区 | YK | 2 | 山手線 東北線 / 003335 / 2 | |
| 神田 | 0538 | 千代田区 | YKC | 2 | 中央線 東北線 / 003677 / 2 | |
| 西日暮里 | 1167 | 荒川区 | YK | 2 | 東北線 / 003368 / 1 | |
| 赤羽 | 0034 | 北区 | KAUS | 2 | 東北線 赤羽線 / 003155 / 3 | |
| 高輪ゲートウェイ | 1750 | 港区 | YK | 2 | 東海道線 / 004061 / 1 | |
| 鶯谷 | 0209 | 台東区 | YK | 2 | 東北線 / 003460 / 1 | |
| 上中里 | 0493 | 北区 | K | 1 | 東北線 / 003277 / 1 | |
| 両国 | 1691 | 墨田区 | B | 1 | 総武線 / 003654 / 1 | |
| 中野 | 1104 | 中野区 | BCM | 1 | 中央線 / 003568 / 3 | |
| 亀戸 | 0508 | 江東区 | B | 1 | 総武線 / 003635 / 1 | |
| 五反田 | 0695 | 品川区 | Y | 1 | 山手線 / 004110 / 1 | |
| 信濃町 | 0798 | 新宿区 | B | 1 | 中央線 / 003774 / 1 | |
| 八丁堀 | 1236 | 中央区 | E | 1 | 京葉線 / 003797 / 1 | |
| 北赤羽 | 0548 | 北区 | A | 1 | 東北線 / 003130 / 1 | |
| 十条 | 0834 | 北区 | A | 1 | 赤羽線 / 003218 / 1 | |
| 千駄ケ谷 | 0914 | 渋谷区 | B | 1 | 中央線 / 003767 / 1 | 千駄ヶ谷 |
| 原宿 | 1256 | 渋谷区 | Y | 1 | 山手線 / 003828 / 1 | |
| 四ツ谷 | 1647 | 千代田区 | BC | 1 | 中央線 / 003728 / 1 | |
| 大井町 | 0307 | 品川区 | K | 1 | 東海道線 / 004197 / 1 | |
| 大久保 | 0316 | 新宿区 | B | 1 | 中央線 / 003604 / 1 (+ 奥羽線 homonym 000759) | |
| 大塚 | 0330 | 豊島区 | Y | 1 | 山手線 / 003375 / 1 | |
| 大森 | 0351 | 大田区 | K | 1 | 東海道線 / 004264 / 1 | |
| 小岩 | 0660 | 江戸川区 | B | 1 | 総武線 / 003360 / 1 | |
| 巣鴨 | 0896 | 豊島区 | Y | 1 | 山手線 / 003354 / 1 | |
| 市ケ谷 | 0135 | 千代田区 | B | 1 | 中央線 / 003671 / 1 | 市ヶ谷 |
| 平井 | 1331 | 江戸川区 | B | 1 | 総武線 / 003561 / 1 | |
| 御茶ノ水 | 0384 | 千代田区 | BC | 1 | 中央線 総武線 / 003615 / 2 | |
| 新大久保 | 0857 | 新宿区 | Y | 1 | 山手線 / 003601 / 1 | |
| 新小岩 | 0862 | 葛飾区 | BO | 1 | 総武線 / 003486 / 1 | |
| 新木場 | 0859 | 江東区 | E | 1 | 京葉線 / 003997 / 1 | |
| 東中野 | 1295 | 中野区 | B | 1 | 中央線 / 003549 / 1 | |
| 東十条 | 1285 | 北区 | K | 1 | 東北線 / 003210 / 1 | |
| 板橋 | 0132 | 豊島区 | A | 1 | 赤羽線 / 003286 / 1 | |
| 水道橋 | 0891 | 千代田区 | B | 1 | 中央線 / 003580 / 1 | |
| 浅草橋 | 0047 | 台東区 | B | 1 | 総武線 / 003636 / 1 | |
| 浮間舟渡 | 0208 | 北区 | A | 1 | 東北線 / 003107 / 1 | |
| 潮見 | 0776 | 江東区 | E | 1 | 京葉線 / 003928 / 1 | |
| 王子 | 0301 | 北区 | K | 1 | 東北線 / 003236 / 1 | |
| 目白 | 1553 | 豊島区 | Y | 1 | 山手線 / 003470 / 1 | |
| 目黒 | 1552 | 品川区 | Y | 1 | 山手線 / 004072 / 1 | |
| 荻窪 | 0362 | 杉並区 | BC | 1 | 中央線 / 003575 / 1 | |
| 葛西臨海公園 | 0424 | 江戸川区 | E | 1 | 京葉線 / 004012 / 1 | |
| 蒲田 | 0478 | 大田区 | K | 1 | 東海道線 / 004330 / 1 | |
| 西荻窪 | 1152 | 杉並区 | BC | 1 | 中央線 / 003579 / 1 | |
| 越中島 | 0286 | 江東区 | E | 1 | 京葉線 / 003859 / 1 | |
| 錦糸町 | 0609 | 墨田区 | BO | 1 | 総武線 / 003639 / 1 | |
| 阿佐ケ谷 | 0045 | 杉並区 | BC | 1 | 中央線 / 003574 / 1 | 阿佐ヶ谷 |
| 飯田橋 | 0099 | 千代田区 | B | 1 | 中央線 / 003595 / 1 | |
| 駒込 | 0712 | 豊島区 | Y | 1 | 山手線 / 003343 / 1 | |
| 高円寺 | 0663 | 杉並区 | BC | 1 | 中央線 / 003573 / 1 | |
| 高田馬場 | 0938 | 新宿区 | Y | 1 | 山手線 / 003508 / 1 | |
| 三河島 | 1456 | 荒川区 | J | 0 | 常磐線 / 003359 / 1 | |
| 南千住 | 1487 | 荒川区 | J | 0 | 常磐線 / 003363 / 1 | |
| 北千住 | 0571 | 足立区 | JM | 0 | 常磐線 / 003260 / 1 | |
| 綾瀬 | 0078 | 足立区 | LM | 0 | 常磐線 / 003214 / 1 | |
| 亀有 | 0507 | 葛飾区 | L | 0 | 常磐線 / 003199 / 1 | |
| 金町 | 0462 | 葛飾区 | L | 0 | 常磐線 / 003191 / 1 | |
| 尾久 | 0367 | 北区 | U | 0 | 東北線 / 003278 / 1 | |
| 新日本橋 | 0875 | 中央区 | O | 0 | 総武線 / 003703 / 1 | |
| 馬喰町 | 1220 | 中央区 | O | 0 | 総武線 / 003668 / 1 | |
| 西大井 | 1149 | 品川区 | OSX | 0 | 東海道線 / 004235 / 1 | |

Counts: 77 stations; 67 served by the core set; **22 core transfer stations** (Core ≥ 2): 新宿, 東京, 秋葉原 (3
services each) and 上野, 代々木, 品川, 大崎, 御徒町, 恵比寿, 新橋, 日暮里, 有楽町, 池袋, 浜松町, 渋谷, 田町, 田端, 神田,
西日暮里, 赤羽, 高輪ゲートウェイ, 鶯谷 (2 each). Only 赤羽 is a transfer station off the Yamanote loop.

### 2.2 N02 name/line mismatches (pitfalls for the pipeline)

1. **Small ヶ vs ケ**: N02 `阿佐ヶ谷`, `千駄ヶ谷`, `市ヶ谷`; JR East timetable `阿佐ケ谷`, `千駄ケ谷`, `市ケ谷`. Overrides
   should carry the official spelling and an explicit N02 name column (or NFKC + ヶ→ケ normalisation).
2. **Homonym**: N02 JR East `大久保` exists on 中央線 (Tokyo, group 003604) and 奥羽線 (Akita, group 000759). Select
   by N02 line + bbox, never by name alone. (The codebase scan's "no homonyms" holds only inside its Tokyo bbox.)
3. **Physical line ≠ service** (extends M0): 京浜東北 = 東北線 + 東海道線; 中央・総武各停 = 中央線 + 総武線
   (御茶ノ水 has both); 埼京線 = 山手線 (山手貨物線) + 赤羽線 + 東北線; 京葉線 = 京葉線; 常磐各停/快速 = 常磐線;
   西大井 is on N02 `東海道線` (品鶴線); 尾久 on `東北線`.
4. **Single platform feature shared by two services**: 大崎, 恵比寿, 渋谷 (山手線 + 埼京線), 錦糸町, 新小岩 (総武線
   各停 + 快速), 新橋 (2 features for 山手/京浜東北/横須賀/東海道). Station points for different services coincide.
5. **Group code split**: 東京 (`003766` main vs `003785` 京葉線, ~448 m apart) — override must join them. 武蔵小杉
   split (004297/004301) is outside the area. Otherwise N02 `N02_005g` is consistent for all 77 stations, but it is a
   **cross-operator** code (e.g. 新宿 003700 also groups 京王/小田急/都営/メトロ) — filter to JR East.
6. **Rapid and local tracks on one N02 line** (中央線 御茶ノ水–西荻窪, 総武線 錦糸町–小岩, 東北線 赤羽–日暮里 with the
   尾久 route) — shortest-path routing can jump track pairs; validate per segment.
7. Same-name non-JR stations met by JR through trains: TWR `大井町` (りんかい線) vs JR `大井町`; Metro `北千住`/`綾瀬`
   platforms. Always filter `N02_004 == "東日本旅客鉄道"`.

### 2.3 Transfers and station groups

- Spec §2 乗換可否 = 同一駅構内 or 公式に案内される乗換. Every core transfer station is one JR East station with one
  timetable station page listing all the services (e.g. 秋葉原 list0041 lists 中央・総武線各駅停車, 山手線, 京浜東北線;
  東京 list1039 lists 京葉線・武蔵野線 together with 山手線 and 京浜東北線). → **Group = same JR station name**
  (after spelling normalisation), with 東京 京葉線 platforms explicitly joined.
- No officially announced JR-to-JR transfer between differently named stations exists in the core area.
  有楽町 ↔ 東京(京葉線) is handled by station staff with a paper slip at manned gates, reported only by third-party
  sites (e.g. https://tetsudo-ch.com/12352948.html , https://trafficnews.jp/post/123219 ); one of them states JR East
  does not publish it. **Do not model** (東京 is already a 京葉線 transfer point).
- Not JR-to-JR (out of scope): 浜松町↔大門, 西日暮里↔千代田線, 新木場↔りんかい線/有楽町線, 新日本橋↔三越前, 原宿↔明治神宮前.
- Group counts: if `Station` = one physical station shared by services → 67 stations, 22 of them multi-service. If
  `Station` = one per (service, station) linked by `groupId` → 92 service-stations in 67 groups (30 + 22 + 24 + 10 + 6).

---

## 3. Area boundary ("inside the 23 wards")

### 3.1 Options

| | (a) N03 行政区域 polygons | (b) Curated in-area station list |
|---|---|---|
| Source | 国土数値情報 行政区域 N03, 2026 edition (base date 2026-01-01), Tokyo file `N03-20260101_13_GML.zip` 12.54 MB (13,153,227 B; GeoJSON inside 18.3 MB), https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html | Official station lists + per-station prefecture (§1.1), ward via N03 one-off check (§3.3) |
| License | オープンデータ（CC_BY_4.0） (same page; 2025 page identical) — compatible; credit 「国土数値情報（行政区域データ）」（国土交通省）を加工して作成 | no new data source; credit unchanged |
| Filter | `N03_007` 13101–13123 (23 codes present) or `N03_004` ends with 区 within 東京都 | — |
| Determinism | yes if the zip is pinned by sha256 | yes, trivially |
| CI | raw file must stay out of git → CI cannot re-check (same as N02 today) | validator can check membership from committed data |
| Pitfalls | `所属未定地` polygons (`N03_007` = 13000) in Tokyo Bay (≈2.36 km² near 139.819 E 35.588 N, ≈1.12 km² near 139.846 E 35.650 N) — not ward land; N03 notes corrections for 千代田区/中央区/港区 boundaries and 中央防波堤; boundary rivers mean track sections cross the edge mid-bridge | must be maintained by hand when the network changes |

### 3.2 Recommendation: (b) curated list, verified by (a) once

- The cut is a **station property**, not a geometry operation: a service's in-area pattern is simply its ordered stop
  list truncated at the last in-area station; segments beyond it are never built, so no track clipping is needed.
- 67 (or ≤ 77) stations are easy to review; every in-area station is ≥ 293 m from the 23-ward edge and every
  out-of-area cut station is ≥ 665 m outside (§3.3), so there is no borderline case where a polygon choice matters.
- Keep N03 as documented evidence (this file + `.claude/docs/libraries/mlit-n03.md`); optionally a local-only test like
  the existing `test_build.py` (skips without raw data) can re-run the point-in-polygon check if the raw zip is present.
- Per-service override columns proposed: `order, id, name, n02_name, n02_line, number (JK..), in_area (always true for
  listed rows)`, plus a per-service `ends` record (`terminus` vs `area-boundary`, with the official next station
  outside, e.g. 蒲田 → 川崎) so the UI can say 「エリア端」 vs 「終点」 and the validator can check it.

Per-service cut points:

| Service | End A (type) | End B (type) |
|---|---|---|
| 京浜東北 | 赤羽 (area boundary; next 川口) | 蒲田 (area boundary; next 川崎) |
| 中央・総武各停 | 西荻窪 (area boundary; next 吉祥寺) | 小岩 (area boundary; next 市川) |
| 埼京 | 大崎 (JR terminus; through to TWR/相鉄 out of scope) | 浮間舟渡 (area boundary; next 戸田公園) |
| 京葉 | 東京 (terminus) | 葛西臨海公園 (area boundary; next 舞浜) |
| (opt) 横須賀・総武快速 | 西大井 (area boundary; next 武蔵小杉) | 新小岩 (area boundary; next 市川) |
| (opt) 常磐快速 | 上野 (service start; 上野東京ライン through out of scope) | 北千住 (area boundary; next 松戸) |

### 3.3 Verification run (N02 2025 × N03 2026, local, scripts in session scratchpad)

Platform midpoints of every JR East N02 station were tested against the union of the 23 ward polygons
(`N03_007` 13101–13123), distances in EPSG:6677:

- 77 JR East station names inside; none of them is Shinkansen-only. Matches the JR timetable Tokyo stations minus
  Tama stations.
- Closest in-area stations to the outer 23-ward edge: 新木場 293 m (coast), 西荻窪 403 m (武蔵野市), 葛西臨海公園 607 m,
  北赤羽 627 m, 金町 828 m, 浮間舟渡 979 m, 赤羽 1,109 m, 小岩 1,455 m, 蒲田 1,553 m.
- Out-of-area neighbours: 松戸 665 m, 川崎 792 m, 武蔵小杉 815 m, 舞浜 818 m, 市川 977 m, 戸田公園 985 m, 川口 1,098 m,
  吉祥寺 1,134 m outside.
- Ward of 新宿 and 日暮里 platforms straddles two wards (both inside); 大久保 matched a second (Akita) feature, see §2.2.

---

## 4. Rough totals and size budget

| Item | Core (5) | + 横須賀・総武快速 | + 常磐快速 |
|---|---:|---:|---:|
| Services | 5 | 6 | 7 |
| Unique stations | 67 | 70 | 73 |
| Transfer stations (≥ 2 services) | 22 | 24 (+錦糸町, 新小岩) | 24 (上野, 日暮里 already counted) |
| Service-stops | 92 | 100 | 105 |
| Undirected segments | 88 | 95 | 99 |
| Chord length, km (straight lines between consecutive N02 points) | 121 (Y 32.6, K 27.0, B 29.8, A 21.5, E 10.0) | +19.1 | +6.2 |
| Track km estimate (× 1.06, the Yamanote track/chord ratio 34.45/32.6) | ≈ 128 | ≈ 148 | ≈ 155 |
| `segments.geojson` at M0 density (~377 B/km, one feature per undirected segment) | ≈ 48 KB | ≈ 56 KB | ≈ 59 KB |

Directed segments if exported per direction: Yamanote 30 (outer only) + 2 × 58 = 146 (core). Well under the current
300,000 B GeoJSON limit either way. Note: Yamanote/京浜東北 share N02 lines, so ~13 km of geometry is near-duplicate.

---

## 5. Items needing a user decision

1. **Core service list** — confirm the 5 services in §0 (山手, 京浜東北, 中央・総武各停, 埼京, 京葉).
2. **常磐線各駅停車** (綾瀬, 亀有, 金町) — recommend **exclude**: unreachable island inside a JR-only 23-ward area.
3. **横須賀・総武快速線** — recommend **exclude** (中距離/快速; matches the brief's rapid exclusions). Including it adds
   西大井, 新日本橋, 馬喰町 and makes 錦糸町/新小岩 transfer stations, and it through-runs at 東京 (one service or two?).
4. **常磐線快速 上野–北千住** — brief excludes it; inside the area it stops everywhere on its tracks. Recommend
   **exclude** for consistency (adds 三河島, 南千住, 北千住 if included).
5. **武蔵野線** — recommend **not** a separate service (identical in-area stops to 京葉線; it would double the 京葉線 draw
   weight at 東京 under a uniform per-service lottery).
6. **埼京線 south end** — recommend 大崎 (JR terminus); 相鉄直通's 西大井 stop is not part of 埼京線.
7. **Stations left unreachable** with the recommended set: 10 of 77 (listed in §0); accept, or revisit at the
   "首都圏近郊" roadmap stage.
8. **Rapid patterns** — confirm the game always uses the 普通 pattern for 京浜東北, 京葉, 埼京 (快速 trains ignored).

## 6. Caveats

- Timetable edition `2610` URLs will move; station list pages (`/timetable/list<code>.html`) and `st_search.cgi` are
  edition-independent.
- JR East numbering is a Wikipedia cross-check (JR East station pages are 403 from this environment).
- N03 checks use platform midpoints; the N03 file was downloaded to the session scratchpad only (sha256
  `94f10b26256566db970dd74b09d614f059c1e8a432f9244ac9c4add76c32ff16`), not committed.
- Track-km figures are estimates from chords; real per-segment routing is a pipeline task.
