# R1-SUB: subway inventory (東京メトロ / 都営地下鉄 / 横浜市営地下鉄)

Research for the 東京近郊版 edition (handoff: `.claude/docs/plans/tokyo-suburban-network-handoff.md`, "R1 shared
conventions"). Collected 2026-10-15. No code or data under `data/` was changed.

Outputs:

- `.claude/docs/research/tokyo-suburban-r1-sub-catalog.csv`: 17 services, 335 rows, schema exactly as in the handoff.
- `.claude/docs/research/tokyo-suburban-r1-sub-transfers.csv`: 227 rows,
  `station_id,operator,other_operator,other_station_name,walking_note,source_url`.
- Reproducible build + check (git-ignored): `.claude/logs/r1-sub/build_catalog.py`, `build_transfers.py`,
  `check_catalog.py`, `check-output.txt` (last run: PASS), `n02-gaps.json`, `gsi-cache.json`.

## Counts (all match the operators' official per-line counts)

| Line | Service(s) | Stations | Endpoints (first / last) |
|---|---|---|---|
| 銀座線 | `metro-ginza` | 19 | 渋谷 terminus / 浅草 terminus |
| 丸ノ内線 | `metro-marunouchi` + `metro-marunouchi-honancho` | 25 + 3 (m03–m05) = 28 | 荻窪 terminus / 池袋 terminus; branch 中野坂上 service-boundary / 方南町 terminus |
| 日比谷線 | `metro-hibiya` | 22 | 中目黒 terminus / 北千住 service-boundary (東武) |
| 東西線 | `metro-tozai` | 23 | 中野 service-boundary (JR) / 西船橋 service-boundary (JR, 東葉高速) |
| 千代田線 | `metro-chiyoda` | 20 | 代々木上原 service-boundary (小田急) / 北綾瀬 terminus |
| 有楽町線 | `metro-yurakucho` | 24 | 和光市 service-boundary (東武) / 新木場 terminus |
| 半蔵門線 | `metro-hanzomon` | 14 | 渋谷 service-boundary (東急) / 押上 service-boundary (東武) |
| 南北線 | `metro-namboku` | 19 | 目黒 service-boundary (東急) / 赤羽岩淵 service-boundary (埼玉高速) |
| 副都心線 | `metro-fukutoshin` | 16 | 和光市 service-boundary (東武) / 渋谷 service-boundary (東急) |
| 浅草線 | `toei-asakusa` | 20 | 西馬込 terminus / 押上 service-boundary (京成) |
| 三田線 | `toei-mita` | 27 | 目黒 service-boundary (東急) / 西高島平 terminus |
| 新宿線 | `toei-shinjuku` | 21 | 新宿 service-boundary (京王) / 本八幡 terminus |
| 大江戸線 | `toei-oedo-loop` (loop) + `toei-oedo-radial` | 28 + 10 (E29–E38) = 38 | loop: none; radial 都庁前 service-boundary / 光が丘 terminus |
| ブルーライン | `yokohama-blue` | 32 | 湘南台 terminus / あざみ野 terminus |
| グリーンライン | `yokohama-green` | 10 | 中山 terminus / 日吉 terminus |

Unique station ids: Metro 144, Toei 99, Yokohama 40 (283). Reconciliation with official totals:
Metro "180駅" = 185 per-line stations minus the 5 副都心線 stations on the shared 和光市–氷川台 track; Toei 106 =
20+27+21+38 (per line); Yokohama 42 per line (40 unique, センター南/北 shared). Every station lies inside the 東京近郊区間
area (incl. 湘南台 藤沢市, 西船橋 船橋市, 和光市), so no `area-boundary` endpoints are needed.

Station numbers: Metro from line pages (lower-case `m03`–`m05` for the 方南町 branch as Metro writes them); Toei and
Yokohama written without hyphen (`A01`, `B01`). Yokohama's official station page lists order only; B/G numbers are
the operator's signage numbers, confirmed via secondary sources.

## Representation proposals

- **大江戸線 (6-shape)**: trains run 光が丘 → 都庁前 → 新宿西口 → … → 六本木 → 代々木 → 新宿 → 都庁前 and terminate (and the
  reverse); they never circulate. Proposal (implemented in the CSV): two services — `toei-oedo-loop` (`is_loop=true`,
  28 stops E28, E01…E27, closing 新宿→都庁前) and `toei-oedo-radial` (linear 都庁前→光が丘, 11 stops). 都庁前 has one
  id in both, so the engine sees a loop with a tail. Rejected alternatives: one linear 38-stop service along the train
  path (needs 都庁前 twice, or drops the 新宿–都庁前 link); loop only (drops 10 stations).
- **丸ノ内線 方南町支線**: separate 4-stop service 中野坂上→方南町 sharing `metro-nakano-sakaue` with the main line.
- **千代田線 北綾瀬**: kept in one linear service (Metro's own line is linear: 綾瀬 forks into JR 常磐線 through-running
  vs the Metro branch). Alternative: split 綾瀬–北綾瀬 as a branch service (open question).
- **ブルーライン**: one service across legal 1号線 + 3号線 (operator runs one named line; N02 splits at 関内).
- Junction ends (中野坂上 branch, 都庁前 radial) use `service-boundary` because trains continue onto the other
  service; `terminus` is reserved for track ends.

## Shared-track sections and stations

- **南北線 / 三田線 目黒–白金高輪**: one double track and the same platforms at 目黒, 白金台, 白金高輪, managed by Tokyo
  Metro (目黒 station itself is Tokyu-managed). Both services list the 3 stations; ids are per operator
  (`metro-meguro` vs `toei-meguro` etc.) for R2 to merge. Legal ownership/第二種 status of Toei on this section is
  not verified.
- **有楽町線 / 副都心線 和光市–小竹向原**: one shared double track, 6 stations, same Metro ids in both services.
  **小竹向原–池袋**: separate parallel double tracks; 千川, 要町, 池袋 are single Metro stations serving both (池袋
  has separate 副都心線 platforms). 副都心線 急行/通勤急行 skip 千川, 要町 etc.; the 各停 stops everywhere.
- Same-name Toei stations treated as one id: 新宿 (S01 Keio-managed platforms + E27), 蔵前 (A17/E11: separate
  buildings, street transfer), 三田, 大門, 春日, 神保町, 森下. Metro distinct-but-connected pairs keep separate ids
  and are listed as intra-operator transfers (赤坂見附/永田町, 国会議事堂前/溜池山王, 銀座/銀座一丁目, 日比谷/有楽町,
  築地/新富町, 人形町/水天宮前, 上野広小路/仲御徒町, 虎ノ門/虎ノ門ヒルズ, 淡路町/新御茶ノ水).
- Cross-operator same physical structures to flag for R2: 九段下 (半蔵門線/新宿線 cross-platform), 押上 (Keisei-managed
  浅草線 station + Metro), 泉岳寺 (Toei-managed, 京急 through-running junction), 新宿 S01 (Keio), 中野/西船橋/綾瀬
  (JR-managed), 代々木上原 (Odakyu), 和光市 (Tobu), 目黒 (Tokyu).

## Through-running (split at operator boundaries)

日比谷線→東武 (北千住); 東西線→JR 中央・総武緩行 (中野), JR 総武緩行 / 東葉高速 (西船橋); 千代田線→小田急 (代々木上原),
JR 常磐緩行 (綾瀬, mid-line fork); 有楽町線・副都心線→東武東上 (和光市), 西武有楽町線 (小竹向原, mid-line junction);
副都心線→東急東横 (渋谷); 半蔵門線→東急田園都市 (渋谷), 東武 (押上); 南北線→東急目黒 (目黒), 埼玉高速 (赤羽岩淵);
浅草線→京急 (泉岳寺, mid-line junction), 京成 (押上); 三田線→東急目黒 (目黒); 新宿線→京王 (新宿). 東葉高速 and
埼玉高速 are not in the R1 operator list. Yokohama lines have no through-running.

## Stop pattern

All 17 services are weekday 各停 stopping at every station. Non-各停 types exist on 東西線 (快速), 副都心線
(急行/通勤急行), 浅草線 (エアポート快特 etc.), 新宿線 (急行), ブルーライン (快速); no station is served only by them.

## N02 (raw N02-25) coverage

Operators/lines: `東京地下鉄` (`3号線銀座線`, `4号線丸ノ内線`, `4号線丸ノ内線分岐線`, `2号線日比谷線`, `5号線東西線`,
`9号線千代田線`, `8号線有楽町線`, `11号線半蔵門線`, `7号線南北線`, `13号線副都心線`), `東京都` (`1号線浅草線`,
`6号線三田線`, `10号線新宿線`, `12号線大江戸線`, plus `日暮里・舎人ライナー`, `荒川線`), `横浜市` (`1号線`, `3号線`,
`4号線`). No line is missing; every catalog station has N02 geometry.

Gaps / quirks:

- `13号線副都心線` has no stations or sections for 和光市–氷川台 (5 stations; sections end at 小竹向原). Those rows use
  `n02_line=8号線有楽町線` and say so in `notes`. The pipeline must reuse 有楽町線 geometry for that segment.
- `6号線三田線` and `7号線南北線` both carry 目黒–白金高輪 (duplicate geometry for one track; matching geometry is
  not shared-track evidence on its own, per the 1都3県 lesson, but here sharing is a documented fact).
- ブルーライン is split into `1号線` (湘南台–関内) and `3号線` (関内–あざみ野); 関内 appears in both (`1号線;3号線`).
- Spelling: N02 uses ヶ where Metro uses ケ: 霞ヶ関 (×3 rows), 市ヶ谷 (×2), 西ヶ原, 南阿佐ヶ谷. Toei's own name is
  市ヶ谷. Names in the CSV follow each operator's official spelling; `notes` records the N02 form.

Municipality/prefecture: GSI reverse geocoder (`mreversegeocoder.gsi.go.jp`) at the midpoint of the N02 station
geometry for that line, codes resolved with GSI `muni.js`. A station shared by lines can therefore show different
wards per row (e.g. 飯田橋: 千代田区/新宿区/文京区; 大江戸線 新宿 E27 → 渋谷区). R2 should pick one per station id.

## Transfers CSV

- Metro rows (120): transcribed from the transfer icons on all 9 Tokyo Metro line pages (verified). Station names
  that the page shows only as "JR線" are inferred and marked (新日本橋, 原宿, 東京 from 大手町, 御茶ノ水 from 新御茶ノ水,
  都電 王子駅前/町屋駅前). Through-running-only points (綾瀬, 押上→東武 per 半蔵門線 page, 赤羽岩淵) are marked
  `through-running boundary only`.
- Toei (89) and Yokohama (18) rows are **UNVERIFIED**: the Toei site blocks automated fetches (Incapsula) and the
  Yokohama station list shows no transfers. Needs a manual check against station pages before R2 relies on them.
- Kinds in `walking_note`: same station name / different station name (official transfer) / same operator,
  different station / same physical platforms (shared track) / through-running only.

## Out-of-scope candidates (not catalogued)

- 日暮里・舎人ライナー (東京都交通局, 日暮里–見沼代親水公園, 13 stations; N02 `東京都`/`日暮里・舎人ライナー`).
- 都電荒川線 = 東京さくらトラム (the nickname of the same line, not a separate line; 三ノ輪橋–早稲田, 30 stops; N02
  `東京都`/`荒川線`). Tram stops; Metro lists it as a transfer at 町屋, 王子, 雑司が谷.
- Future extensions (not open as of 2026-10): 有楽町線 豊洲–住吉, 南北線 白金高輪–品川, ブルーライン あざみ野–新百合ヶ丘,
  大江戸線 光が丘–大泉学園町.
- Through-running partners outside the R1 operator list: 東葉高速鉄道, 埼玉高速鉄道 (and transfer-only: ゆりかもめ,
  りんかい線, 東京モノレール, みなとみらい線, JR東海).

## Open questions (for R2/R3)

1. 大江戸線: accept loop + radial (two services sharing 都庁前)? Does the engine handle a loop service whose junction
   station is also an endpoint of a linear service?
2. Cross-operator identity of shared stations (目黒/白金台/白金高輪 Metro↔Toei; 九段下, 押上, 新宿, 泉岳寺, …) and of
   Toei same-name but physically separate stations (蔵前, 新宿 S01/E27): one node or a transfer edge?
3. Should intra-operator different-name transfers (赤坂見附/永田町 etc.) become movement edges?
4. 千代田線 綾瀬–北綾瀬: keep in the main service or split as a branch?
5. Junction endpoints: is `service-boundary` the right kind for 中野坂上 (branch) and 都庁前 (radial)?
6. Toei/Yokohama transfer lists need verification; Toei 三田線 legal status on the shared section is unverified.
7. 方南町支線 weekday operation (shuttle vs through to 池袋) not re-verified for the current timetable.

## Sources

- Tokyo Metro line pages (station order, numbers, transfers), fetched 2026-10-15:
  https://www.tokyometro.jp/station/line_ginza/index.html, …/line_marunouchi/, …/line_hibiya/, …/line_tozai/,
  …/line_chiyoda/, …/line_yurakucho/, …/line_hanzomon/, …/line_namboku/, …/line_fukutoshin/ (each `index.html`).
- 東京都交通局 line pages (order/numbers via search index; direct fetch blocked):
  https://www.kotsu.metro.tokyo.jp/subway/asakusa/, …/mita/, …/shinjuku/, …/oedo/
  (三田線: 27 stations, 26.5 km as of 2025-04-01; 浅草線 20; 新宿線 21; 大江戸線 38, E01 新宿西口 … E28 都庁前 … E38 光が丘).
- 横浜市交通局 市営地下鉄駅: https://www.city.yokohama.lg.jp/kotsu/sub/norikata/eki.html (32 + 10 stations).
- N02-25 raw GeoJSON (`N02-25_GML/UTF-8`, read-only); GSI reverse geocoder and https://maps.gsi.go.jp/js/muni.js.
