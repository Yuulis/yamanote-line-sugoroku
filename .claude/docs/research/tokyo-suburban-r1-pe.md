# R1-PE: 東武・西武・京成・つくばエクスプレス research inventory

Status: complete for R1 (2026-10-15). Follows the "R1 shared conventions" in
`.claude/docs/plans/tokyo-suburban-network-handoff.md`. Full lines are catalogued; the
area cut is NOT applied (every row carries `prefecture` + `municipality`).

Outputs:

- `.claude/docs/research/tokyo-suburban-r1-pe-catalog.csv`: 33 services, 435 rows, 404 unique station ids
- `.claude/docs/research/tokyo-suburban-r1-pe-transfers.csv`: 103 official cross-operator transfer rows
- Generator + check: `.claude/logs/r1-pe/` (`services_data.py`, `transfers_data.py`, `build_catalog.py`,
  `check_r1_pe.py`, `build_report.json`, `gsi_cache.json`). `python3 -I .claude/logs/r1-pe/build_catalog.py --offline`
  rebuilds both CSVs deterministically from the cache; `python3 -I .claude/logs/r1-pe/check_r1_pe.py` → exit 0.

## Method

- Membership, order and station codes: ja.wikipedia 駅一覧 tables of every line (extracted by
  `extract_wiki.py`), then cross-checked 1:1 against raw N02-25 station sets per (`運営会社`, `路線名`);
  station counts were cross-checked against operator totals (see below). Order = legal 起点 → 終点.
- Prefecture/municipality: GSI reverse geocoder (`mreversegeocoder.gsi.go.jp`) on the centroid of each N02
  station geometry, muni code → name via GSI `muni.js`; cross-checked with wiki 所在地. 10 disagreements,
  all reviewed: 9 were wiki carry-forward errors (鶴ヶ島 is in 川越市, 若葉 in 鶴ヶ島市, 芦ヶ久保/横瀬 in 横瀬町,
  入曽/狭山市/新狭山 in 狭山市, 一橋学園/青梅街道 in 小平市), 1 was a border-geocode error fixed by override
  (秋津 → 東村山市, official address). Independent validation: 西武 comes out 東京都 62 / 埼玉県 30, exactly
  the official split.
- Ward-level municipality for designated cities (`さいたま市大宮区`, `千葉市中央区`).
- Romaji: official-style Hepburn without macrons. The official English name is used where it is not
  romaji: Tokyo Skytree, Tobu World Square, Airport Terminal 2, Narita Airport Terminal 1.

## Catalog per operator

`endpoint_kind` convention used: `terminus` = physical end of the operator's line, with no regular
through-running beyond it; `service-boundary` = the line ends at a junction with another line of the same
operator, or at an operator boundary where track/through-running continues. No `area-boundary` yet
(the area cut is not applied).

| Operator | Services (stations) | Unique stations | Official count (source) |
|---|---|---|---|
| 東武鉄道 | isesaki 54, nikko 26, kinugawa 9, utsunomiya 11, sano 10, kiryu 8, koizumi 7 + koizumi-ota 3, kameido 5, daishi 2, urban-park 35, tojo 39, ogose 8 | 205 (+押上 excluded) | 旅客駅 205 / 駅数 207 incl. 2 non-passenger (tobu.co.jp 路線概要) |
| 西武鉄道 | ikebukuro 31, chichibu 6, yurakucho 3, toshima 2, sayama 3, yamaguchi 3, shinjuku 29, haijima 8, tamako 7, kokubunji 5, seibuen 2, tamagawa 6 | 92 | 12路線 92駅 (seiburailway.jp 企業概要) |
| 京成電鉄 | main 42, oshiage 6, kanamachi 3, chiba 10, chihara 6, higashi-narita 2, matsudo 24 | 87 (+成田湯川 and 3 北総-shared stations excluded) | 91駅 incl. the 4 北総-shared 成田空港線 stations (ja.wikipedia 京成電鉄, 2025-04-01; the official company page did not resolve) |
| 首都圏新都市鉄道 | tx 20 | 20 | 20駅 58.3 km (mir.co.jp 概要) |

Per-line counts equal the ja.wikipedia infobox 駅数 and the N02 per-line sets. Tobu's official per-line
counts (伊勢崎線 54, 日光線 25, 亀戸線 4, 大師線 1, アーバンパークライン 34, 佐野線 9, 桐生線 7, 小泉線 7,
宇都宮線 10, 鬼怒川線 9, 東上本線 40, 越生線 7) exclude the junction 起点 counted on the parent line and
押上, and include one 信号場 (鬼怒川線) and one non-passenger station (東上本線). They reconcile exactly
(per-line expectations are documented in `check_r1_pe.py`).

Prefecture spread (for the area cut): 東武 東京28/埼玉76/千葉23/栃木49/群馬29; 西武 東京62/埼玉30;
京成 東京19/千葉68; TX 東京7/埼玉2/千葉5/茨城6. Services lying wholly outside 1都3県: tobu-kinugawa,
tobu-utsunomiya, tobu-kiryu, tobu-koizumi(-ota), and most of tobu-sano. tobu-isesaki leaves 埼玉 after 羽生,
and tobu-nikko leaves 埼玉 after 柳生.

`line_official` uses the legal names: 野田線 (brand 東武アーバンパークライン), 東上本線, and つくばエクスプレス
(legal/N02 name 常磐新線, noted in the row).

## 各停 (weekday) coverage

The user rule is 各停 only, so every station must be a 普通/各停 stop. Result:

**Excluded candidates (no 各停 at all):**

1. 東武 押上 (TS-03), on the 伊勢崎線 branch 押上–曳舟. ja.wikipedia 東武伊勢崎線 駅一覧: "普通列車（各駅停車）は各駅に停車する（普通列車の設定のない押上駅を除く）".
   Only 半蔵門線-through 急行/準急 run on the branch. They stop at both of its stations, so the stop pattern
   itself is all-stop. For fares, 押上 counts as part of とうきょうスカイツリー; that is why Tobu's official
   total of 205 omits it. Proposed service `tobu-isesaki-oshiage` (押上, 曳舟) is kept OUT of the CSV.
   Physically 押上 is still an important hub (Metro, 都営, 京成).
2. 京成 成田空港線 (成田スカイアクセス線), the whole service. It has no 普通. アクセス特急 stops at all
   8 京成 passenger stations of the line (京成高砂, 東松戸 HS05, 新鎌ヶ谷 HS08, 千葉ニュータウン中央 HS12,
   印旛日本医大 HS14, 成田湯川 KS43, 空港第2ビル, 成田空港); between 京成高砂 and 成田湯川, スカイライナー stops only at 新鎌ヶ谷, and only some
   trains. The all-stop service on 京成高砂–印旛日本医大 is 北総鉄道's 北総線, which is outside
   the operator list. Station only reachable via this line: 成田湯川. The HS-numbered stations are
   北総-managed stations that 京成 shares. Proposed service `keisei-narita-sky-access` is kept OUT of the CSV.
   Ids are in `build_report.json` → `excluded_station_meta`.

**No other gaps.** Lines where 各停 does not run end-to-end in one train, though every station is still
a 各停 stop:

- 伊勢崎線: 浅草–北千住 (浅草 普通), 北千住–北越谷/東武動物公園/南栗橋 (日比谷線-through 普通; on the
  複々線 the 緩行線 serves every station), 久喜–館林, 館林–伊勢崎 (ワンマン).
- 日光線: split at 南栗橋 and 新栃木. 東上本線: split at 小川町. アーバンパークライン: split at 春日部/柏.
- 西武池袋線/西武秩父線: switchback at 飯能; 各停 run 飯能–吾野/西武秩父. 多摩湖線: split at 萩山.
- 京成本線: midday 普通 run 京成上野–京成津田沼/臼井/佐倉 only; 普通 to 京成成田/成田空港/芝山千代田 run
  outside midday. 京成成田–空港第2ビル–成田空港 has no intermediate station.
- TX: many 普通 terminate at 守谷, but 普通 to つくば exist. 守谷–つくば is also served by the all-stop 区間快速.
- 鬼怒川線: 普通 continue onto 野岩鉄道 at 新藤原.
- 山口線 is an AGT with no 種別 (all trains stop at all 3 stations). Its inclusion as a "railway line" is a
  product question (see Open questions).

## Station identity (within operator)

One id per physical station: `tobu-`/`seibu-`/`keisei-`/`tx-` + romaji slug (the full romaji is kept, so
`tobu-tobu-dobutsu-koen` and `keisei-keisei-ueno` stay unambiguous against JR/other operators).

Shared ids:

- 東武: 曳舟, 西新井, 東武動物公園, 館林, 太田, 春日部, 新栃木, 下今市, 東小泉, 坂戸.
- 西武: 練馬, 西所沢, 吾野, 所沢, 小平, 萩山, 小川, 東村山, 国分寺 (国分寺線/多摩湖線, separate platforms in
  one station), 多摩湖, 西武球場前.
- 京成: 青砥, 京成高砂, 京成津田沼 (3 lines), 千葉中央, 京成成田, 空港第2ビル, 成田空港. 新鎌ヶ谷 is one
  京成 station for 松戸線 and 成田空港線.

Cross-operator same-name/adjacent pairs that R2 must decide: 北千住 (東武/TX), 池袋 (東武/西武), 押上
(東武/京成), 新鎌ヶ谷 (東武/京成), 流山おおたかの森 (東武/TX), 船橋 ↔ 京成船橋, 牛田 ↔ 京成関屋. Also
浅草 (東武/TX): same name, but different stations about 600 m apart, and not an official transfer.

## N02 coverage

- Every service line and every catalogued station exists in raw N02-25, including 2025 changes: 京成
  `松戸線` (ex-新京成), 東武 つきのわ/みなみ寄居/東武ワールドスクウェア, and 西武園ゆうえんち. No missing
  geometry. `n02_missing_station = 0` and `n02_missing_line_geometry = 0` in `build_report.json`.
- Naming deltas: N02 `常磐新線` = つくばエクスプレス; N02 `江曾島` vs official 江曽島 (alias in `N02_NAME_ALIASES`);
  N02 `野田線` = アーバンパークライン.
- N02 `成田空港線` carries only the 8 京成 stops; the 北総 intermediate stations are under `北総鉄道/北総線`.
  N02 `日光線` has a duplicated 東武日光 record (27 features / 26 names).
- Reminder from the 1都3県 lessons: N02 geometric agreement is not shared-track evidence.

## Transfers

The CSV has 103 rows, one per (station, other operator); line names are in `walking_note` as `lines: …`.
Basis: each line's ja.wikipedia 駅一覧 connection column, plus the official 京成 route map PDF (2025-04-01)
for 京成 stations. Intra-operator links are omitted. Through-running points are marked `(through-running)`.
The following walkable pairs are NOT included, because no operator lists them as transfers:

- 東武 川越市 ↔ 西武 本川越. The wiki says 東武 does not guide it officially.
- 西武 本川越 ↔ JR 川越 / 東武 川越.
- 東武 曳舟 ↔ 京成曳舟.
- TX 浅草 ↔ the other 浅草 stations.
- 京成西船 ↔ JR 西船橋, 京成幕張 ↔ JR 幕張, みどり台 ↔ JR 西千葉.
- 東武 足利市 ↔ JR 足利.

Not individually verified against each operator's station page. Treat the rows as wiki-grade (TODO for R2:
spot-check the 15 different-name pairs).

## Open questions (for lead / user)

1. 京成成田空港線: exclude it (strict 各停 rule, which loses 成田湯川 and leaves only 北総 serving the corridor),
   or allow it as a special case? Its アクセス特急 serves every 京成 station on the line.
2. 東武 押上: excluding it under the strict rule leaves 押上 without a 東武 node. The 京成/Metro/都営 押上
   stations remain, and 東武 とうきょうスカイツリー is adjacent and fare-identical. R2 could merge 押上 into
   とうきょうスカイツリー as one transfer node.
3. 西武山口線 (AGT/レオライナー): include it as a normal line? It is a 鉄道事業法 line operated by 西武.
4. 北総鉄道 and 芝山鉄道 are not in the operator list, but 京成 through-runs onto both. Confirm they stay out.
5. Area boundary: 東武 extends deep into 栃木/群馬. The cut rule from the R1-JR agent decides which
   `area-boundary` endpoints replace the current terminus/service-boundary kinds.

## Sources

- Tobu 路線概要 (per-line and total station counts): https://www.tobu.co.jp/corporation/rail/route/
- Seibu 企業概要 (92 stations, 12 lines): https://www.seiburailway.jp/company/profile/
- Keisei route map 2025-04-01 (KS66–KS88 松戸線 codes, transfers): https://www.keisei.co.jp/keisei/tetudou/railmap/railmap_250401.pdf
- TX 概要 / 路線図: https://www.mir.co.jp/feature/about_tx/ , https://www.mir.co.jp/route_map/
- ja.wikipedia line articles (駅一覧, stop-pattern notes), e.g. https://ja.wikipedia.org/wiki/東武伊勢崎線 ,
  https://ja.wikipedia.org/wiki/京成成田空港線 , https://ja.wikipedia.org/wiki/京成本線 (each catalog row cites its line page)
- GSI reverse geocoder + muni.js: https://mreversegeocoder.gsi.go.jp/ , https://maps.gsi.go.jp/js/muni.js
- N02-25 (国土数値情報 鉄道), local `N02-25_GML/UTF-8` (read-only)
