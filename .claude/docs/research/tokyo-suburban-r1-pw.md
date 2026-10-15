# R1-PW: 東急・京王・小田急・京急・相鉄 inventory (東京近郊版)

Research inventory for the south/west private railways, produced for phase R1 of
`.claude/docs/plans/tokyo-suburban-network-handoff.md` (follows "R1 shared conventions").
Research date: 2026-10-15. Lines are catalogued in full; the area boundary is NOT applied
(every row carries `prefecture` + `municipality` so R2 can truncate).

Files:

- `.claude/docs/research/tokyo-suburban-r1-pw-catalog.csv` — 26 services, 364 rows.
- `.claude/docs/research/tokyo-suburban-r1-pw-transfers.csv` — 120 official transfers to other operators/JR.
- `.claude/logs/r1-pw/` — generator (`pw_data.py`, `pw_transfers.py`, `build_catalog.py`),
  acceptance check (`check_pw.py`), wiki-table helpers, and `excluded.csv` (the 5 excluded candidates below).

Rebuild / verify:

```bash
python3 -I .claude/logs/r1-pw/build_catalog.py .   # regenerates both CSVs + excluded.csv
python3 -I .claude/logs/r1-pw/check_pw.py .        # exit 0 = all checks pass
```

## Conventions applied (beyond the shared R1 rules)

- `endpoint_kind`: `terminus` = weekday 各停 end here; `service-boundary` = regular weekday 各停
  continue past this point onto another line of the same operator or onto another operator.
  `area-boundary` is not used (boundary not applied yet).
- Station ids: `<operator>-<romaji slug>`; one id per physical station within an operator, shared by all
  of that operator's services (e.g. `tokyu-hiyoshi` on 東横線/目黒線/東急新横浜線). An operator-name prefix
  inside the station name is not repeated (京急蒲田 → `keikyu-kamata`, 京王八王子 → `keio-hachioji`,
  小田急多摩センター → `odakyu-tama-center`); `station_name_ja` keeps the full official name.
- `municipality`: city + ward for designated cities (`横浜市港北区`, `川崎市中原区`, `相模原市南区`);
  towns with district (`足柄上郡松田町`). Source: 所在地 columns of the ja.wikipedia line tables, spot-checked
  against station-article infoboxes for doubtful rows (初台/幡ヶ谷 = 渋谷区, 代田橋 = 世田谷区, 西小山 = 品川区).
- `n02_operator` = N02 `運営会社` (`京浜急行電鉄`, not 京急電鉄); `n02_line` = N02 `路線名` whose geometry
  reaches the station (see N02 gaps).
- Station names follow the operator: 相鉄 writes 鶴ケ峰 / 希望ケ丘 / 保土ケ谷区 (N02: ヶ).

## Counts per operator and line (official counts cited)

| service_id | line | stops | official | how the official figure counts |
|---|---|---|---|---|
| tokyu-toyoko | 東横線 渋谷–横浜 | 21 | 21 | FACT BOOK 2025 |
| tokyu-meguro | 目黒線 目黒–日吉 | 13 | 13 | FACT BOOK 2025 |
| tokyu-shin-yokohama | 東急新横浜線 日吉–新横浜 | 3 | 3 | FACT BOOK 2025 |
| tokyu-den-en-toshi | 田園都市線 渋谷–中央林間 | 27 | 27 | FACT BOOK 2025 |
| tokyu-oimachi | 大井町線 大井町–溝の口 | 18 | 16 | 16 excludes 二子新地/高津 (田園都市線 stations served by 大井町線 各停) |
| tokyu-ikegami | 池上線 | 15 | 15 | FACT BOOK 2025 |
| tokyu-tamagawa | 東急多摩川線 | 7 | 7 | FACT BOOK 2025 |
| tokyu-setagaya | 世田谷線 (軌道) | 10 | 10 | FACT BOOK 2025 |
| tokyu-kodomonokuni | こどもの国線 | 3 | 3 | FACT BOOK 2025 |
| keio-main | 京王線 新宿–京王八王子 | 34 | 33 | 明大前 counted under 井の頭線 |
| keio-sagamihara / takao / keibajo / dobutsuen | 相模原線 / 高尾線 / 競馬場線 / 動物園線 | 12 / 7 / 2 / 2 | 11 / 6 / 1 / 1 | junction excluded |
| keio-inokashira | 井の頭線 | 17 | 17 | 会社概要 |
| odakyu-odawara / enoshima / tama | 小田原線 / 江ノ島線 / 多摩線 | 47 / 17 / 8 | 47 / 16 / 7 | station numbering; junction excluded |
| keikyu-main | 本線 泉岳寺–浦賀 | 50 | 50 | official station list incl. 泉岳寺 |
| keikyu-kurihama | 久里浜線 | 4 (+5 excluded) | 9 | official station list incl. 堀ノ内 |
| keikyu-airport / daishi / zushi | 空港線 / 大師線 / 逗子線 | 7 / 7 / 4 | 7 / 7 / 4 | incl. junction |
| sotetsu-main / izumino / shin-yokohama | 本線 / いずみ野線 / 新横浜線 | 18 / 8 / 3 | 18 / 8 / 3 | official station list |

Unique stations per operator (catalog + excluded): 東急 98 (official 99, see open question 3), 京王 69 (69),
小田急 70 (70), 京急 73 = official 72 excluding 泉岳寺 + 泉岳寺, 相鉄 27 (27). Total 337 unique ids, 364 stop rows.

Sources: 東急 FACT BOOK 2025 路線別データ
(https://ir.tokyu.co.jp/ja/ir/library/factsheets/main/01/teaserItems3/0/linkList/0/link/2%2020251112%20FACT%20BOOK2025%20j.pdf),
京王 会社概要 (https://www.keio.co.jp/global/company/corporate/), 小田急 当社路線の概要
(https://www.odakyu.jp/company/railroad/about/), 京急 路線図・各駅情報 (https://www.keikyu.co.jp/ride/kakueki/),
相鉄 駅・時刻表 / 運輸業 (https://www.sotetsu.co.jp/train/stations/, https://www.sotetsu.co.jp/about/companies/transportation/).
Station codes and 所在地: ja.wikipedia line articles (URLs per row in `source_url`).

## 各停 coverage

Every station of every line has weekday 各停/普通 service except one segment:

- **京急久里浜線 京急久里浜–三崎口 (5 stations): no weekday 普通.** Confirmed from Keikyu's own station timetables
  (2025-12-13 ダイヤ): YRP野比/京急長沢/津久井浜/三浦海岸/三崎口 list only 快特・特急 (+ウィング号), while 新大津/北久里浜/
  京急久里浜 list 普通 (weekday mornings only). Both 快特 and 特急 stop at every 久里浜線 station, so the segment is
  de facto all-stop. Per the user's "各停 only" decision these are **excluded candidates** (not in the catalog);
  `keikyu-kurihama` ends at 京急久里浜 as `service-boundary`. Rows ready to append (catalog schema subset):

```csv
line_official,station_name_ja,station_name_en_romaji,prefecture,municipality,station_id_proposed,station_code,n02_operator,n02_line
久里浜線,YRP野比,YRP Nobi,神奈川県,横須賀市,keikyu-yrp-nobi,KK68,京浜急行電鉄,久里浜線
久里浜線,京急長沢,Keikyu Nagasawa,神奈川県,横須賀市,keikyu-nagasawa,KK69,京浜急行電鉄,久里浜線
久里浜線,津久井浜,Tsukuihama,神奈川県,横須賀市,keikyu-tsukuihama,KK70,京浜急行電鉄,久里浜線
久里浜線,三浦海岸,Miurakaigan,神奈川県,三浦市,keikyu-miurakaigan,KK71,京浜急行電鉄,久里浜線
久里浜線,三崎口,Misakiguchi,神奈川県,三浦市,keikyu-misakiguchi,KK72,京浜急行電鉄,久里浜線
```

  Timetable evidence: `https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=0&slCode=679-5&d=1` (京急長沢),
  `...slCode=679-1...` (新大津). Wikipedia 京急久里浜線 §普通 states the same.

Thin-but-present 各停 (recorded in `notes`, kept in catalog):

- 京急 泉岳寺: weekday 普通 appear in the timetable legend, but most 普通 start at 品川.
- 京急空港線: 普通 only early morning / morning peak / evening; daytime 特急・急行 stop at all 空港線 stations.
- 京急久里浜線 堀ノ内–京急久里浜: 普通 weekday mornings only.
- 小田急 新松田–小田原: 6-car 各停 shuttles; 江ノ島線 各停 mostly split at 藤沢 (switchback), kept as one linear service.
- 小田急 複々線 (代々木上原–登戸): 各停 stop at all stations; no station is served only by 急行 types.
- 京王線: 初台/幡ヶ谷 exist only on 京王新線; the catalog follows the 新線 path (新宿=新線新宿 KO01). 各停 from
  京王線新宿 run non-stop to 笹塚.
- 東急大井町線: two 各停 patterns; the "blue" 各停 use 田園都市線 tracks and stop at 二子新地/高津 (included).
- 東急新横浜線: 各停 only as 目黒線 through trains; 東横線 through trains are 急行 but stop at all 3 stations.

## Through-running / operator boundaries (`service-boundary` endpoints)

| Station | Split | Partner |
|---|---|---|
| 泉岳寺 | keikyu-main | 都営浅草線 (泉岳寺 is 都営-managed) |
| 渋谷 | tokyu-toyoko / tokyu-den-en-toshi | 東京メトロ副都心線 / 半蔵門線 |
| 横浜 | tokyu-toyoko | 横浜高速鉄道みなとみらい線 (operator in no R1 scope — open question 1) |
| 目黒 | tokyu-meguro | 東京メトロ南北線 / 都営三田線 |
| 日吉 | tokyu-meguro → tokyu-shin-yokohama | same operator, separate named line |
| 新横浜 | tokyu-shin-yokohama ↔ sotetsu-shin-yokohama | shared station, operator boundary |
| 羽沢横浜国大 | mid-line on sotetsu-shin-yokohama | JR直通 trains leave for JR東日本 here |
| 新宿 (新線新宿) | keio-main | 都営新宿線 |
| 代々木上原 | mid-line on odakyu-odawara | 東京メトロ千代田線 (→ JR常磐線各停) |
| 小田原 | odakyu-odawara (terminus) | 小田急箱根 (箱根湯本) — not 各停; out of scope |
| junctions | 調布, 北野, 新百合ヶ丘, 堀ノ内, 京急蒲田, 金沢八景, 二俣川, 西谷 | same-operator branch starts |

## N02 (raw N02-25) findings

- Every catalog/excluded station exists as an N02 station point under the right operator, and every N02 station of the
  5 operators is in the inventory (reverse check in `check_pw.py`). No line is missing from N02.
- Geometry gaps (flagged `N02_GEOMETRY_GAP` in `notes`; `n02_line` set to the covering line):
  - 目黒線 田園調布–日吉 (多摩川, 新丸子, 武蔵小杉, 元住吉, 日吉): N02 `目黒線` ends at 田園調布; the parallel tracks
    are only drawn as N02 `東横線` (stations also filed under 東横線).
  - 大井町線 二子玉川–溝の口 (二子新地, 高津, 溝の口): N02 `大井町線` ends at 二子玉川; only N02 `田園都市線` covers it.
  - Pipeline impact: the multi-operator N02 selection must allow a service to borrow another line's geometry, and
    (lesson from 1都3県) geometric agreement is not shared-track evidence — 目黒線/東横線 are separate tracks.
- Name matching needs NFKC: N02 spells 笹塚 with U+FA10 (CJK compatibility 塚); plus ヶ/ケ (相鉄 鶴ケ峰, 希望ケ丘).
- N02 operator spellings: `京浜急行電鉄`, `東急電鉄` (incl. こどもの国線, whose infrastructure belongs to 横浜高速鉄道),
  `小田急箱根` is a separate operator; みなとみらい線 is N02 `横浜高速鉄道 / みなとみらい21線`.

## Transfers

120 rows: 東急 32, 小田急 28, 京王 23, 京急 22, 相鉄 15. Each pair between two R1-PW operators appears from both sides.
Same-operator transfers are not listed (shared ids cover them). Two rows are tagged "unverified on official page":
京急泉岳寺 ↔ JR高輪ゲートウェイ and 新宿 ↔ 西武新宿 (both from Wikipedia 接続路線). Walking notes are qualitative
(same name / different name); no walking times were collected.

Not recorded as transfers (no official listing found): 京急蒲田 ↔ JR/東急 蒲田 (~800 m), 綱島 ↔ 新綱島 (same operator,
separate stations), 片瀬江ノ島 ↔ 江ノ電江ノ島 / 湘南モノレール湘南江の島, 大崎広小路 ↔ JR大崎, 代々木八幡 ↔ 千代田線代々木公園.

## Open questions (for R2/R3 and the user)

1. **京急久里浜–三崎口**: include as a de-facto all-stop segment (all trains stop) or exclude per the literal 各停 rule?
   Excluding cuts 京急's southern end (三浦海岸/三崎口) — whether it is inside the area boundary is for R2.
2. **みなとみらい線 (横浜高速鉄道)** is 東横線's through partner at 横浜 but is in no R1 scope list (6 stations in N02).
3. **東急 station identity**: FACT BOOK total 99 vs 98 unique ids here. Most likely 東急 counts 世田谷線 三軒茶屋 (separate
   ground-level 軌道 stop) apart from 田園都市線 三軒茶屋; merged here into `tokyu-sangen-jaya`. Unverified — split it if
   R2 wants strict physical identity.
4. Cross-operator shared stations needing an R2 identity decision: 新横浜 (東急/相鉄), 泉岳寺 (京急/都営), 下北沢 (京王/小田急),
   中央林間, 大和, 海老名, 湘南台, 横浜, 渋谷, 新宿, 羽沢横浜国大 (相鉄/JR).
5. 京王線 新宿: 京王線新宿 and 新線新宿 are one id here (one official station KO01); the 各停 path chosen is the 新線 one.
6. 小田急 小田原 is a terminus for 各停, but 小田急箱根 (箱根湯本) is another operator not in any R1 scope.
