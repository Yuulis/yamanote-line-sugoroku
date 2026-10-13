# JR East conventional services in 東京・千葉・埼玉・神奈川 (1都3県) — service catalog research

Date: 2026-10-12 · Researcher (Agent Teams `feature-jr-east-capital-region-expansion`) · Read-only research, no code changed.
Brief: `.claude/docs/research/feature-jr-east-capital-region-expansion-brief.md` · Prior edition research:
`.claude/docs/research/jr-east-tokyo-expansion.md`, `.claude/docs/research/jr-east-tokyo-service-graph.md`.

**Status: v1 FINAL (research).** Machine-readable catalog: `.claude/docs/research/jr-east-capital-region-catalog.csv`
(965 rows, one per service-stop, 60 services) and its one-row-per-service view
`.claude/docs/research/jr-east-capital-region-services.csv` (columns: `service_id, line_name, service_type,
jr_train_type, circular, stops_ja, stop_ids, first_end_kind, last_end_kind, status, status_reason, frequency, source`;
stop separator `|`, stops in +1 order; `stops_ja` and `stop_ids` are consistent station identities across rows).
End kinds: `terminus | area-boundary | through-split`. The Architect was notified when the CSV existed. **v1 FINAL**
(Yamanote listed in 外回り order from 新橋 = shipped +1 direction). Every hop of every service is backed by
real trains from the JR East timetable edition `2610` (「JR時刻表」2026年10月号). Items that need a user decision are
in §8.

## 0. Result

| Item | Value |
|---|---:|
| JR East conventional stations in the 4 prefectures (official timetable lists) | **475** (東京 142, 千葉 155, 神奈川 103, 埼玉 75) |
| ... present in N02 2025 under the same name (ケ/ヶ and full-width digit normalised) | 475 / 475 |
| Services in the catalog | **60** = 36 local + 24 rapid |
| ... recommended `core` / `optional` | 51 / 9 (optional = rush-only, few-per-day or holiday-only) |
| Stations covered by the core set | 475 (every station; nothing depends on an optional service) |
| Stations covered by local services alone | 462; the other 13 are only on `chuo_rapid`, `sobu_rapid`, `joban_rapid` (§3.2) |
| Transfer stations: ≥ 2 line families / ≥ 2 core services / ≥ 2 local services | **150** / 202 / 78 |
| Service-stops (rows) / undirected service segments / distinct station pairs | 965 / 906 / 582 |
| Stations reachable only by excluded services (特急, subway/TWR through trains) | **0** |

- Excluding 特急 changes no reachability: every one of the 475 stations is a stop of at least one non-特急 train
  (checked over all 13,398 trains scraped, §1).
- The only station reachable only through a through service is **羽沢横浜国大** (`sotetsu_direct`, JR section of
  the 相鉄・JR直通線).
- Scale versus the 23-ward edition: 67 → 475 stations, 5 → 51–60 services, 22 → 150 transfer stations, about
  10× the segment count.

## 1. Method and sources

1. **Station universe.** JR East's timetable search by prefecture (`st_search.cgi?mode=1&token=13|12|11|14`) lists
   every JR East station in each prefecture. 本庄早稲田 (Shinkansen only) is dropped, leaving 475.
2. **Line order and prefectures.** These come from the per-line lists `st_search.cgi?mode=1&rosen=<id>` (30 lines,
   §2). 羽沢横浜国大 appears on no line list, only on its own station page as 「相鉄線直通」.
3. **Stop patterns.** All 2,383 direction timetables (weekday and Sat/holiday) of the 475 station pages
   (`/timetable/list<code>.html`) were parsed for each train's type label (`legend_train`, e.g. 快速, 中央特快,
   `快,ラ` = 快速ラビット). All **13,398** distinct train pages (`/2610/train/<n>/<id>.html`, the 停車駅一覧 for each
   train) were then fetched and parsed, and each service's stop list was taken from the dominant real pattern.
   Every hop in the CSV records `hop_evidence_trains`, the number of real trains of that service's type that stop at
   both stations consecutively. The minimum is 2, for few-per-day services. Representative train URLs are in the
   CSV `source_url`.
4. **N02 2025.** The local raw N02 (`N02-25_GML/UTF-8`) was checked: station names, line names (`N02_003`),
   group codes and line-graph connectivity between the stations each service links (§6).
5. **Cross-checks.** Wikipedia and the news were used only for the 湘南新宿ライン routing and the 久留里線
   abolition (§10).

Caveats: the timetable URLs carry the edition (`2610`) and will move at the next revision. Station list pages and
`st_search.cgi` are edition-independent. The `www.jreast.co.jp` station pages were not needed. The scripts and raw
cache live in the session scratchpad only.

## 2. Line inventory (official lines, in-area extent, truncation, branches)

| Official line (JR list id) | Operated as | In-area extent (stations on list / in area) | Boundary truncation (last in-area → first outside) | Branches / notes |
|---|---|---|---|---|
| 山手線 (66) | 山手線 loop (with 東北本線 田端–東京, 東海道本線 東京–品川) | 30 / 30 | — | 山手貨物線 = 埼京線, 湘南新宿ライン, 相鉄直通 |
| 東北本線 (51/82) | 宇都宮線 東京–栗橋; 京浜東北線 大宮–東京; 埼京線 赤羽–大宮 (別線); 湘南新宿ライン (東北貨物線); 上野東京ライン 東京–上野 | 34 / 15 on 宇都宮線 | 栗橋 → 古河 (茨城県) | 上野–尾久–赤羽 (中距離) vs 王子 route (京浜東北) |
| 高崎線 (43) | 高崎線 (上野東京ライン / 湘南新宿ライン) | 25 / 22 incl. 東京–大宮 | 神保原 → 新町 (群馬県) | — |
| 東海道本線 (49) | 東海道線 東京–湯河原; 京浜東北 東京–横浜; 横須賀線 品鶴線 (品川–西大井–新川崎–鶴見); 相鉄直通 (東海道貨物線 鶴見–羽沢横浜国大) | 21 / 20 | 湯河原 → 熱海 (静岡県) | 御殿場線 (JR Central, from 国府津) excluded |
| 横須賀線 (67) | 横須賀線 (東京–久里浜, through to 総武快速) | 19 / 19 | — | — |
| 根岸線 (55) | 京浜東北・根岸線, 横浜線 through trains | 12 / 12 | — | — |
| 中央本線 (46) | 中央線快速 東京–高尾 (+大月 through); 中央・総武各停 御茶ノ水–三鷹; 普通 高尾–藤野 | 78 / 34 | 藤野 → 上野原 (山梨県) | — |
| 総武本線 (39/40/41) | 各停 御茶ノ水–千葉; 快速 東京–千葉 (錦糸町–東京 underground); 総武本線 千葉–銚子 | all in area | — (銚子 terminus) | 錦糸町–御茶ノ水 (各停) vs 錦糸町–東京 (快速) |
| 京葉線 (25) | 京葉線 東京–蘇我; 武蔵野線 through trains | 19 / 19 | — | 高谷支線 市川塩浜–西船橋, 二俣支線 西船橋–南船橋 (only 武蔵野線/しもうさ trains) |
| 武蔵野線 (63) | 府中本町–西船橋 (passenger) | 26 / 26 | — | 大宮支線・西浦和支線 (しもうさ号/むさしの号), 国立支線 (むさしの号) |
| 常磐線 (34) | 常磐線快速 品川/上野–取手; 常磐線各停 綾瀬–取手 (北千住–綾瀬 = 東京メトロ千代田線) | 90 / 21 | 天王台 → 取手 (茨城県) | — |
| 成田線 (52) | 本線 佐倉–松岸 (operated 千葉–銚子); 我孫子支線 我孫子–成田; 空港支線 成田–成田空港 | 27 / 27 | — | 3 branches meet at 成田 |
| 鹿島線 (18) | 佐原/成田–鹿島神宮 | 7 / 3 (佐原, 香取, 十二橋) | 十二橋 → 潮来 (茨城県) | junction 香取 |
| 外房線 (42) / 内房線 (10) | both from 千葉 (千葉–蘇我 is officially 外房線) | 27 / 27, 32 / 32 | — | the two lines form a loop through 安房鴨川 |
| 久留里線 (23) | 木更津–上総亀山 | 14 / 14 | — | 久留里–上総亀山 to be abolished 2027-04-01 (§8 Q4) |
| 東金線 (50) | 大網–成東 (trains from 千葉 and 京葉線) | 5 / 5 | — | — |
| 八高線 (57) | south 八王子–高麗川 (through to 川越); north 高麗川–高崎 (diesel); no through trains | 24 / 20 | 丹荘 → 群馬藤岡 (群馬県) | junction 拝島, 高麗川 |
| 川越線 (21) | 大宮–川越 as 埼京線; 川越–高麗川 (through to 八高線) | 11 / 11 | — | — |
| 埼京線 (29) | 大崎–川越 (山手線 + 赤羽線 + 東北本線 + 川越線) | 24 / 24 | — | — |
| 青梅線 (13) / 五日市線 (6) | 立川–青梅, 青梅–奥多摩; 拝島–武蔵五日市 (through to 立川) | 25 / 25, 12 / 12 | — | junction 拝島 |
| 南武線 (53) | 川崎–立川; 浜川崎支線 尻手–浜川崎 | 30 / 30 | — | — |
| 鶴見線 (48) | 鶴見–扇町; 海芝浦支線 (浅野–海芝浦); 大川支線 (武蔵白石–大川, trains stop at 安善 not 武蔵白石) | 13 / 13 | — | — |
| 横浜線 (68) / 相模線 (30) | 東神奈川–八王子 (through to 根岸線); 茅ケ崎–橋本 | 20 / 20, 18 / 18 | — | — |

Excluded: Shinkansen, 伊東線 (begins at 熱海, outside), 御殿場線 (JR Central), 成田エクスプレス and every other 特急,
臨時 B.B.BASE trains, through running onto 東京メトロ (千代田線, 東西線), TWR りんかい線 and 相鉄 track.

## 3. Service catalog

### 3.1 Modelling rule used for the default catalog

- **A service** is a (line or JR-named through service, JR train type) pair. Its stops are the stops of that type,
  and its extent is the in-area part of the route where trains of that type run. Each service is an open chain,
  except `yamanote` (`is_loop=true`).
- **Through running is split at the line junction** (上野東京ライン at 東京/上野, 横須賀⇔総武快速 at 東京,
  総武快速⇔房総/成田 at 千葉, 京葉⇔外房/内房 at 蘇我, 横浜線⇔根岸線 at 東神奈川, 中央線快速⇔青梅線 at 立川, and so on).
  The exceptions are where JR runs one named service across official lines with one stop type:
  - 京浜東北・根岸線 大宮–大船 (JK);
  - 中央・総武線各駅停車 三鷹–千葉 (JB);
  - 埼京線・川越線 大崎–川越 (JA);
  - 湘南新宿ライン, at its full in-area extent;
  - 相鉄線直通, 新宿–羽沢横浜国大.

  The JR lists for 宇都宮線, 高崎線 and 常磐線 already start at 東京 or 品川, so the 上野東京ライン link is kept
  inside those services.
- **Branches are separate services that start at the junction stop**, not at the trains' real origin, so trunk stops
  are not duplicated: `itsukaichi` from 拝島, `tsurumi_umishibaura` from 浅野, `tsurumi_okawa` from 安善,
  `narita_abiko`, `narita_airport_branch`, `kashima` from 香取, `nambu_branch`, `musashino_takaya`,
  `musashino_futamata`.
- **Weekday patterns are canonical.** Sat/holiday differences are listed in notes (§3.3).
- **Endpoint kinds** (CSV `is_terminus_in_area` plus the `notes` prefix):
  - `terminus`: trains really end there;
  - `area_boundary`: the line continues outside the area, and the next station outside is named;
  - `through_split`: trains continue on another service in the catalog.

### 3.2 Services (generated from the CSV)

| # | service_id | Name | Type | JR type | Freq | Rec | Stops | First → Last (end kind) |
|---:|---|---|---|---|---|---|---:|---|
| 1 | `yamanote` | 山手線 | local | 普通 | regular | core | 30 | loop (外回り from 新橋) |
| 2 | `keihin_tohoku_negishi` | 京浜東北線・根岸線 | local | 普通 | regular | core | 47 | 大宮 (terminus) → 大船 (terminus) |
| 3 | `keihin_tohoku_rapid` | 京浜東北線 快速 | rapid | 快速 | daytime | core | 41 | 大宮 (terminus) → 大船 (terminus) |
| 4 | `chuo_sobu_local` | 中央・総武線各駅停車 | local | 普通 | regular | core | 39 | 三鷹 (terminus) → 千葉 (terminus) |
| 5 | `chuo_rapid` | 中央線快速 | rapid | 快速 | regular | core | 24 | 東京 (terminus) → 高尾 (through_split) |
| 6 | `chuo_special_rapid` | 中央特快 | rapid | 中央特快 | regular | core | 14 | 東京 (terminus) → 高尾 (through_split) |
| 7 | `chuo_commuter_rapid` | 中央線 通勤快速 | rapid | 通勤快速 | rush_weekday | optional | 16 | 東京 (terminus) → 高尾 (through_split) |
| 8 | `chuo_commuter_special_rapid` | 中央線 通勤特快 | rapid | 通勤特別快速 | few_per_day | optional | 9 | 東京 (terminus) → 高尾 (through_split) |
| 9 | `chuo_takao_fujino` | 中央本線 高尾–藤野 | local | 普通 | regular | core | 3 | 高尾 (through_split) → 藤野 (area_boundary) |
| 10 | `ome` | 青梅線 | local | 普通 | regular | core | 25 | 立川 (terminus) → 奥多摩 (terminus) |
| 11 | `ome_holiday_special_rapid` | 特別快速 ホリデー快速おくたま (青梅線内) | rapid | 特別快速 | holiday_only | optional | 5 | 立川 (through_split) → 青梅 (through_split) |
| 12 | `itsukaichi` | 五日市線 | local | 普通 | regular | core | 7 | 拝島 (through_split) → 武蔵五日市 (terminus) |
| 13 | `hachiko` | 八高線 | local | 普通 | regular | core | 20 | 八王子 (terminus) → 丹荘 (area_boundary) |
| 14 | `kawagoe_west` | 川越線 川越–高麗川 | local | 普通 | regular | core | 6 | 川越 (through_split) → 高麗川 (through_split) |
| 15 | `saikyo_kawagoe` | 埼京線・川越線 | local | 普通 | regular | core | 24 | 大崎 (terminus) → 川越 (terminus) |
| 16 | `saikyo_rapid` | 埼京線 快速 | rapid | 快速 | regular | core | 20 | 大崎 (terminus) → 川越 (terminus) |
| 17 | `saikyo_commuter_rapid` | 埼京線 通勤快速 | rapid | 通勤快速 | rush_weekday | optional | 15 | 大崎 (terminus) → 川越 (terminus) |
| 18 | `sotetsu_direct` | 相鉄線直通 (JR区間) | local | 普通 | regular | core | 7 | 新宿 (through_split) → 羽沢横浜国大 (through_split) |
| 19 | `keiyo` | 京葉線 | local | 普通 | regular | core | 18 | 東京 (terminus) → 蘇我 (terminus) |
| 20 | `keiyo_rapid` | 京葉線 快速 | rapid | 快速 | regular | core | 11 | 東京 (terminus) → 蘇我 (through_split) |
| 21 | `musashino` | 武蔵野線 | local | 普通 | regular | core | 26 | 府中本町 (terminus) → 西船橋 (through_split) |
| 22 | `musashino_takaya` | 武蔵野線直通 西船橋–市川塩浜 (京葉線高谷支線) | local | 普通 | regular | core | 2 | 西船橋 (through_split) → 市川塩浜 (through_split) |
| 23 | `musashino_futamata` | 武蔵野線直通 西船橋–南船橋 (京葉線二俣支線) | local | 普通 | regular | core | 2 | 西船橋 (through_split) → 南船橋 (through_split) |
| 24 | `musashino_shimousa` | しもうさ号 | rapid | 普通(愛称列車) | few_per_day | optional | 22 | 大宮 (terminus) → 海浜幕張 (terminus) |
| 25 | `musashino_musashino` | むさしの号 | rapid | 普通(愛称列車) | few_per_day | optional | 11 | 大宮 (terminus) → 八王子 (terminus) |
| 26 | `nambu` | 南武線 | local | 普通 | regular | core | 26 | 川崎 (terminus) → 立川 (terminus) |
| 27 | `nambu_rapid` | 南武線 快速 | rapid | 快速 | daytime | core | 12 | 川崎 (terminus) → 立川 (terminus) |
| 28 | `nambu_branch` | 南武線 浜川崎支線 | local | 普通 | regular | core | 5 | 尻手 (terminus) → 浜川崎 (terminus) |
| 29 | `tsurumi` | 鶴見線 | local | 普通 | regular | core | 10 | 鶴見 (terminus) → 扇町 (terminus) |
| 30 | `tsurumi_umishibaura` | 鶴見線 海芝浦支線 | local | 普通 | regular | core | 3 | 浅野 (through_split) → 海芝浦 (terminus) |
| 31 | `tsurumi_okawa` | 鶴見線 大川支線 | local | 普通 | few_per_day | core | 2 | 安善 (through_split) → 大川 (terminus) |
| 32 | `yokohama` | 横浜線 | local | 普通 | regular | core | 20 | 東神奈川 (through_split) → 八王子 (terminus) |
| 33 | `yokohama_rapid` | 横浜線 快速 | rapid | 快速 | daytime | core | 13 | 東神奈川 (through_split) → 八王子 (terminus) |
| 34 | `sagami` | 相模線 | local | 普通 | regular | core | 18 | 茅ケ崎 (terminus) → 橋本 (terminus) |
| 35 | `tokaido` | 東海道線 | local | 普通 | regular | core | 20 | 東京 (through_split) → 湯河原 (area_boundary) |
| 36 | `yokosuka` | 横須賀線 | local | 普通 | regular | core | 19 | 東京 (through_split) → 久里浜 (terminus) |
| 37 | `sobu_rapid` | 総武快速線 | rapid | 快速 | regular | core | 10 | 東京 (through_split) → 千葉 (through_split) |
| 38 | `sobu_rapid_narita_airport` | 総武快速 千葉–成田空港 | rapid | 快速 | regular | core | 9 | 千葉 (through_split) → 成田空港 (terminus) |
| 39 | `uchibo_rapid` | 総武快速 千葉–君津 (内房線快速) | rapid | 快速 | regular | core | 11 | 千葉 (through_split) → 君津 (through_split) |
| 40 | `sotobo_rapid` | 総武快速 千葉–上総一ノ宮 (外房線快速) | rapid | 快速 | regular | core | 9 | 千葉 (through_split) → 上総一ノ宮 (through_split) |
| 41 | `utsunomiya` | 宇都宮線 (上野東京ライン) | local | 普通 | regular | core | 15 | 東京 (through_split) → 栗橋 (area_boundary) |
| 42 | `utsunomiya_rapid_rabbit` | 快速ラビット | rapid | 快速 | few_per_day | optional | 8 | 東京 (through_split) → 久喜 (area_boundary) |
| 43 | `takasaki` | 高崎線 (上野東京ライン) | local | 普通 | regular | core | 22 | 東京 (through_split) → 神保原 (area_boundary) |
| 44 | `takasaki_rapid_urban` | 快速アーバン | rapid | 快速 | few_per_day | optional | 14 | 東京 (through_split) → 神保原 (area_boundary) |
| 45 | `shonan_shinjuku_local` | 湘南新宿ライン (宇都宮線・横須賀線系統 普通) | local | 普通 | regular | core | 27 | 栗橋 (area_boundary) → 逗子 (terminus) |
| 46 | `shonan_shinjuku_rapid_utsunomiya` | 湘南新宿ライン 快速 (宇都宮線・横須賀線系統) | rapid | 快速 | daytime | core | 22 | 久喜 (area_boundary) → 逗子 (terminus) |
| 47 | `shonan_shinjuku_rapid_takasaki` | 湘南新宿ライン 快速 (高崎線・東海道線系統) | rapid | 快速 | regular | core | 36 | 神保原 (area_boundary) → 小田原 (terminus) |
| 48 | `shonan_shinjuku_special_rapid` | 湘南新宿ライン 特別快速 | rapid | 特別快速 | daytime | core | 26 | 神保原 (area_boundary) → 小田原 (terminus) |
| 49 | `joban_rapid` | 常磐線快速 (上野東京ライン) | rapid | 快速 | regular | core | 12 | 品川 (through_split) → 天王台 (area_boundary) |
| 50 | `joban_special_rapid` | 常磐線 特別快速 | rapid | 特別快速 | few_per_day | optional | 8 | 品川 (through_split) → 柏 (area_boundary) |
| 51 | `joban_local` | 常磐線各駅停車 | local | 普通 | regular | core | 13 | 綾瀬 (through_split) → 天王台 (area_boundary) |
| 52 | `narita_abiko` | 成田線 我孫子支線 | local | 普通 | regular | core | 10 | 我孫子 (through_split) → 成田 (terminus) |
| 53 | `narita` | 成田線 (佐倉–松岸) | local | 普通 | regular | core | 16 | 佐倉 (through_split) → 松岸 (through_split) |
| 54 | `narita_airport_branch` | 成田線 空港支線 | local | 普通 | regular | core | 3 | 成田 (through_split) → 成田空港 (terminus) |
| 55 | `kashima` | 鹿島線 (香取–十二橋) | local | 普通 | regular | core | 2 | 香取 (through_split) → 十二橋 (area_boundary) |
| 56 | `sobu_main` | 総武本線 (千葉–銚子) | local | 普通 | regular | core | 22 | 千葉 (through_split) → 銚子 (terminus) |
| 57 | `sotobo` | 外房線 | local | 普通 | regular | core | 27 | 千葉 (terminus) → 安房鴨川 (through_split) |
| 58 | `uchibo` | 内房線 | local | 普通 | regular | core | 32 | 千葉 (terminus) → 安房鴨川 (through_split) |
| 59 | `kururi` | 久留里線 | local | 普通 | regular | core | 14 | 木更津 (terminus) → 上総亀山 (terminus) |
| 60 | `togane` | 東金線 | local | 普通 | regular | core | 5 | 大網 (through_split) → 成東 (terminus) |

Rapid services that are the **only** service at some station, and so are mandatory:

- `chuo_rapid`: 武蔵境, 東小金井, 武蔵小金井, 国分寺, 国立, 日野, 豊田, 西八王子;
- `sobu_rapid`: 新日本橋, 馬喰町;
- `joban_rapid`: 三河島, 南千住, 北千住.

Inside the area these three stop at every station on their own tracks. JR still labels them 快速, or 普通 for the
常磐線 中距離 trains, whose in-area stops are identical.

### 3.3 Rapid-type details and frequency flags (weekday counts per direction at a probe station)

| Service | Skips vs the local of the same line | Frequency |
|---|---|---|
| 京浜東北 快速 | 西日暮里 日暮里 鶯谷 御徒町 有楽町 新橋 (Sat/holiday stops 御徒町) | ~61, 10–15h only (`daytime`) |
| 中央線快速 | (vs 中央・総武各停 east of 三鷹: different tracks). Sat/holiday skips 高円寺 阿佐ケ谷 西荻窪 | ~230 (`regular`) |
| 中央特快 | 高円寺–吉祥寺, 武蔵境–武蔵小金井, 西国分寺, 国立 | 29–40 weekday, ~50 holiday |
| 通勤快速 (中央) | 高円寺 阿佐ケ谷 西荻窪 武蔵境–武蔵小金井 西国分寺 国立 | 20, weekday evening outbound only |
| 通勤特快 (中央) | 中野 三鷹 + the 中央特快 skips + 日野 豊田 西八王子 | 4, weekday morning inbound only |
| 青梅特快 | east of 立川 = 中央特快, west = all stations → not a separate service | 6–8 weekday, 16 holiday |
| 特別快速 ホリデー快速おくたま | on 青梅線 stops only 立川 西立川 拝島 福生 青梅 | 3 round trips, Sat/holiday |
| 埼京線 快速 | 北赤羽 浮間舟渡 戸田 北戸田 | 21–27 weekday (6–17h), ~48 holiday |
| 埼京線 通勤快速 | the 快速 skips + 戸田公園 中浦和 南与野 与野本町 北与野 | 25–30, weekday only |
| 京葉線 快速 | 越中島 潮見 葛西臨海公園 市川塩浜 二俣新町 新習志野 幕張豊砂 (all stations beyond 蘇我) | ~17 weekday, ~32 holiday. 通勤快速 no longer runs |
| しもうさ号 | 大宮→武蔵浦和 non-stop via 大宮支線, then all stations to 海浜幕張 via 二俣支線 | 3 |
| むさしの号 | 大宮→北朝霞 via 大宮/西浦和支線, 新小平→国立 via 国立支線, then 立川 日野 豊田 八王子 | 3–5 |
| 南武線 快速 | 14 stations, incl. 西府 谷保 矢川 西国立 (快速 now runs through to 立川) | 16–20, daytime |
| 横浜線 快速 | 大口 小机 十日市場 成瀬 古淵 淵野辺 矢部 | 17–26, daytime |
| 総武快速 beyond 千葉 | to 成田空港 skips 東千葉; to 君津 skips 巌根; to 上総一ノ宮 skips 永田 本納 新茂原 八積 | ~17–22 each |
| 快速ラビット (宇都宮線) | 尾久 さいたま新都心 土呂 白岡 新白岡 東鷲宮 栗橋 | 4, northbound only |
| 快速アーバン (高崎線) | 尾久 さいたま新都心 宮原 北上尾 北本 北鴻巣 吹上 行田 | 4, northbound only |
| 湘南新宿 快速 (宇都宮・横須賀系統) | on 宇都宮線: 土呂 白岡 新白岡 東鷲宮 栗橋 | ~9 |
| 湘南新宿 快速 (高崎・東海道系統) | 西大井 新川崎 保土ケ谷 東戸塚 (route) — all stations on 高崎線/東海道線 | ~25. No 普通 runs on this 系統 |
| 湘南新宿 特別快速 | 恵比寿, 西大井, 辻堂 大磯 二宮 鴨宮, 宮原 北上尾 北鴻巣 吹上 行田 | ~8, daytime |
| 常磐線 特別快速 | 三河島 南千住 我孫子 天王台 | 2 |

The 東海道線 has no rapid of its own any more (快速アクティー and 通勤快速 are gone). Rabbit and Urban stop at every
東海道 station. A few 総武快速 trains to 成東 skip 南酒々井, 榎戸 and 日向 (not modelled).

## 4. Through running — how it works and how it could be split (proposal, not a decision)

| System | Real operation | Default in CSV (option A: split) | Option B: as operated |
|---|---|---|---|
| 上野東京ライン | 東海道線 ⇔ 宇都宮線/高崎線 (almost all 普通), 常磐線快速/中距離 ⇔ 品川 | `tokaido` 東京–湯河原; `utsunomiya` 東京–栗橋; `takasaki` 東京–神保原; `joban_rapid` 品川–天王台 | `ueno_tokyo_utsunomiya` 湯河原–栗橋 (34), `ueno_tokyo_takasaki` 湯河原–神保原 (41); 東海道 portion appears twice |
| 湘南新宿ライン | 宇都宮線 ⇔ 横須賀線 (普通/快速), 高崎線 ⇔ 東海道線 (快速/特別快速) via 東北貨物線 + 山手貨物線 + 品鶴線 | full in-area extent: 4 services (`shonan_shinjuku_*`) | core-only: 大宮–大船, so the 宇都宮/高崎/東海道/横須賀 parts are left to the locals |
| 横須賀・総武快速 | 久里浜 ⇔ 東京 ⇔ 千葉 ⇔ 成田空港/君津/上総一ノ宮 (JO numbering continuous) | `yokosuka` + `sobu_rapid` + 3 `*_rapid` from 千葉 | `yokosuka_sobu` 久里浜–千葉 (28) + 3 extensions, or 3 long services from 久里浜 |
| 相鉄・JR直通 | 相鉄 ⇔ 羽沢横浜国大 ⇔ 武蔵小杉 ⇔ 西大井 ⇔ 大崎 ⇔ 新宿 ⇔ (埼京線 to 大宮/川越) | `sotetsu_direct` 新宿–羽沢横浜国大 | through to 川越 (duplicates 埼京線) |
| 東京メトロ / りんかい線 | 東西線 at 中野/西船橋, 千代田線 at 綾瀬 (北千住–綾瀬 is Metro track), りんかい線 at 大崎 | excluded; 常磐線各停 starts at 綾瀬 | — |
| 京葉線 ⇔ 武蔵野線 | 府中本町 ⇔ 西船橋 ⇔ 東京 (高谷支線) or ⇔ 海浜幕張 (二俣支線) | `musashino` + 1-segment `musashino_takaya`, `musashino_futamata` | `musashino_tokyo` 府中本町–東京 (35) + `musashino_kaihin` 西船橋–海浜幕張 (5) |
| 京葉線 ⇔ 外房/内房/東金 | 東京 ⇔ 蘇我 ⇔ 上総一ノ宮/君津/成東 | split at 蘇我 | — |
| 中央線 ⇔ 青梅線/中央本線 | 快速/特快/青梅特快/通勤快速 ⇔ 青梅; 快速/特快 ⇔ 大月 | split at 立川 and 高尾; `chuo_takao_fujino` 3 stops | append 高尾–相模湖–藤野 to `chuo_rapid` |
| 埼京線 ⇔ 川越線 ⇔ 八高線 | 大崎 ⇔ 川越; 川越 ⇔ 高麗川 ⇔ 八王子 | `saikyo_kawagoe`, `kawagoe_west`, `hachiko` (whole line) | `hachiko_kawagoe` 川越–八王子 + `hachiko_north` 高麗川–丹荘 |
| 横浜線 ⇔ 根岸線 | 八王子 ⇔ 東神奈川 ⇔ 横浜 ⇔ 桜木町/大船 | split at 東神奈川 | — |
| 常磐線快速 ⇔ 成田線 | 上野/品川 ⇔ 我孫子 ⇔ 成田 | split at 我孫子 | — |

Lottery effect: under option B, identical stop sequences repeat across services (for example 東海道線 東京–湯河原
twice), which raises their draw weight under a uniform per-service lottery.

### 4.1 Splits chosen in the v1 catalog (explicit list for the user question)

| # | Junction | Choice in CSV |
|---:|---|---|
| S1 | 上野東京ライン 東京/上野 | 東海道線 starts at 東京. 宇都宮線 and 高崎線 start at 東京 (they include 東京–上野). 常磐線快速 and 特別快速 start at 品川 (they include 品川–新橋–東京–上野). |
| S2 | 横須賀線 ⇔ 総武快速 at 東京 | Split: `yokosuka` 東京–久里浜 and `sobu_rapid` 東京–千葉. |
| S3 | 総武快速 beyond 千葉 | Split at 千葉 into `sobu_rapid_narita_airport`, `uchibo_rapid` and `sotobo_rapid`. |
| S4 | 湘南新宿ライン | Whole in-area through chains: 栗橋/久喜–逗子 and 神保原–小田原 (4 services). Not split at 大宮 or 大船. |
| S5 | 相鉄・JR直通 | `sotetsu_direct` 新宿–羽沢横浜国大, split from 埼京線 at 新宿. |
| S6 | 京浜東北 ⇔ 根岸線 | Merged 大宮–大船 (one JK service, rapid too). |
| S7 | 横浜線 ⇔ 根岸線 at 東神奈川 | Split. 横浜線 services end at 東神奈川. |
| S8 | 中央線 ⇔ 青梅線 at 立川, and 中央本線 at 高尾 | Split. Every 中央線 rapid ends at 高尾. 青梅特快, 青梅-bound 快速 and 通勤快速 are not separate services. 高尾–藤野 is its own service. |
| S9 | 中央・総武各停 at 御茶ノ水 | Merged 三鷹–千葉 (JB). |
| S10 | 埼京線 ⇔ 川越線 ⇔ 八高線 | 埼京線 merged 大崎–川越. 川越–高麗川 is separate. 八高線 is one service 八王子–丹荘 (not split at 高麗川). |
| S11 | 京葉線 ⇔ 武蔵野線 | Split. 武蔵野線 ends at 西船橋, plus 1-segment connectors 西船橋–市川塩浜 and 西船橋–南船橋. しもうさ号 is a whole chain 大宮–海浜幕張. |
| S12 | 京葉線 ⇔ 外房/内房/東金 at 蘇我 | Split. |
| S13 | 常磐線快速 ⇔ 成田線 at 我孫子 | Split. |
| S14 | Branches (五日市, 海芝浦, 大川, 浜川崎, 成田我孫子/空港, 鹿島) | Start at the junction stop, not at the trains' real origin. |
| S15 | 内房線 / 外房線 | Both start at 千葉 (as operated). |
| S16 | 青梅線 at 青梅, 総武本線 at 佐倉/成東, 成田線 | Not split. 成田線 follows the official 佐倉–松岸. |

### 4.2 Services whose inclusion I am unsure about

- `keihin_tohoku_rapid`: it differs from the local only between 田端 and 浜松町, but it adds a lottery ticket at about
  41 stations.
- `shonan_shinjuku_rapid_utsunomiya` (~9/direction) and `shonan_shinjuku_special_rapid` (~8/direction): marked
  core, but they are borderline.
- `chuo_takao_fujino`, `musashino_takaya` and `musashino_futamata`: legitimate, but very short (1–2 segments). They
  could instead be added to the end of neighbouring services.
- `kururi`, 久留里–上総亀山: abolition and suspension, see Q4.
- `musashino_musashino`: optional, and its route has an N02 geometry gap (国立支線).
- Every `optional` row: they add lottery tickets at the big hubs (東京 reaches k=18 with them, 13 without), and no
  station depends on them. My recommendation is to exclude them.

## 5. Station identity

- **One station id per JR station name** (the 23-ward convention) holds across the area. Each of the 475 names maps
  to one JR timetable station code. No two in-area JR stations share a name.
- **Same name, physically separate parts** (recommend one id each, as the 23-ward edition does for 東京):

  | Station | Situation | N02 |
  |---|---|---|
  | 東京 | 京葉線 platforms ~450 m from the main station | groups `003766` / `003785` |
  | 武蔵小杉 | 南武線 vs 横須賀線 (品鶴線) platforms ~400 m apart | groups `004297` / `004301` |
  | 浜川崎 | 南武線浜川崎支線 and 鶴見線 stations face each other across a road; one JR station page | same group `004488`, features ~80 m apart |
  | 尻手, 府中本町, 西船橋, 新松戸, 西国分寺, 南浦和, 武蔵浦和, 立川, 拝島, 八王子, 橋本, 高麗川, 大宮, 川越, 我孫子, 成田, 佐倉, 松岸, 香取, 千葉, 蘇我, 大網, 成東, 木更津, 安房鴨川, 東神奈川, 茅ケ崎, 大船, 鶴見 | ordinary multi-line JR stations | one group each |

  **Identity decisions flagged for the user (Q8):** 東京 (京葉線/武蔵野線 platforms), 武蔵小杉 (南武線 ↔
  横須賀線/湘南新宿/相鉄直通) and 浜川崎 (南武支線 ↔ 鶴見線). The catalog treats each as one station, so every
  service there can be transferred to. If any is split, these hubs lose their transfers:
  - 東京 (京葉): `keiyo`, `keiyo_rapid`;
  - 武蔵小杉: `nambu` and `nambu_rapid` against the 品鶴線 services;
  - 浜川崎: `tsurumi` against `nambu_branch`, after which 鶴見線 connects to the network only at 鶴見.

  Two further cases need no decision, because the catalog uses the JR-side station only:
  - 羽沢横浜国大 (JR/相鉄 shared);
  - 綾瀬 (JR 各停 starts here; 北千住–綾瀬 is Metro).
- **Non-JR neighbours that must not be merged:**
  - 新松戸 vs 幸谷 (流鉄);
  - 武蔵溝ノ口 vs 溝の口 (東急);
  - 新秋津 vs 秋津 (西武);
  - 尻手, 八丁畷 near 京急 stations;
  - TWR 大井町, Metro 北千住/綾瀬 platforms;
  - 羽沢横浜国大, a shared JR/相鉄 station (JR side only).

  Always filter `N02_004 == "東日本旅客鉄道"`.
- **Nearby, differently named JR stations with no official JR-to-JR transfer.** Do not link these pairs:
  - 船橋/南船橋/東船橋;
  - 稲毛/稲毛海岸;
  - 幕張/幕張豊砂/海浜幕張;
  - 新習志野/津田沼;
  - 千葉/千葉みなと;
  - 南浦和/武蔵浦和;
  - 西国分寺/国分寺;
  - 八丁畷/川崎;
  - 有楽町/東京 (京葉).
- **N02 spelling differences** (`n02_name` column): 保土ヶ谷, 北茅ヶ崎, 千駄ヶ谷, 姉ヶ崎, 市ヶ谷, 空港第2ビル
  (half-width), 箱根ヶ崎, 茅ヶ崎, 袖ヶ浦, 阿佐ヶ谷.
- **New or absent stations versus N02 2025** (base 2025-12-31): none. All 475 match by name inside the area bbox.
  Every N02 JR station near the area that is not in the catalog is outside the 4 prefectures (群馬/茨城/栃木/山梨/静岡).
  Recent openings 高輪ゲートウェイ (2020), 羽沢横浜国大 (2019) and 幕張豊砂 (2023) are present.
- `station_id_proposed` reuses the 67 existing registry ids. The rest are machine Hepburn from JR kana, with a
  hyphen after 東/西/南/北/新/上総/下総/安房/武蔵 and similar prefixes. **Review before freezing as ids.** All 475
  are unique.

## 6. N02 2025 geometry findings relevant to routing (for the Architect)

The checks used shortest paths on the JR East N02 RailroadSection graph, with vertices joined within 15 m:

1. **国立支線 is absent.** 新小平 → 国立 has no direct path, and it is needed only by `musashino_musashino`
   (optional). 大宮支線 and 西浦和支線 are present under `武蔵野線`: 北朝霞→大宮 is 14.2 km and 武蔵浦和→大宮 is
   7.5 km without 赤羽線 or 川越線.
2. **湘南新宿ライン 池袋–赤羽.** The trains really run 山手貨物線 → 駒込–上中里 short line → 東北貨物線, not
   赤羽線. N02 has no short line, so excluding 赤羽線 detours via 田端 (14.7 km vs ~9.5 km real). Use 赤羽線 or 田端
   via-points deliberately, and do not snap to 十条/板橋.
3. **常磐線 meets 東北線 at 日暮里 mid-segment** (0.0 m distance but no shared vertex). Routing must split the
   segment or tolerate a T-junction, which affects `joban_rapid` 上野→三河島.
4. **Disconnected components are acceptable as long as each service stays on its own lines:**
   - 鶴見線 has no N02 link to 東海道線 (27.8 m) or 南武線 (61.5 m);
   - 八高線 ↔ 青梅線 at 拝島: 24.8 m;
   - 南武線 ↔ 中央線 at 立川: 24.4 m;
   - 相模線 ↔ 東海道線 at 茅ケ崎: 38.8 m.
5. **Present:**
   - 京葉線 高谷支線 (市川塩浜→西船橋 5.95 km) and 二俣支線 (南船橋→西船橋);
   - 品鶴線 and 大崎→西大井;
   - 東海道貨物線 to 羽沢横浜国大 (武蔵小杉→羽沢 17.5 km, one gap < 15 m);
   - 成田空港支線;
   - 鹿島線 香取–十二橋;
   - 大川支線, 海芝浦支線, 浜川崎支線.
6. **As in the 23-ward edition, N02 lines carry several track pairs:** rapid and local on 中央線/総武線/東北線/東海道線,
   and 東海道 vs 横須賀 tracks 横浜–大船. A rapid's non-adjacent hops must be composed from per-pair geometry.

## 7. Counts by category

- Locals 36: 30 trunk/line services + 6 branch-connector services (`itsukaichi`, `nambu_branch`,
  `tsurumi_umishibaura`, `tsurumi_okawa`, `musashino_takaya`, `musashino_futamata`). 鹿島線, 成田空港支線 and 我孫子支線
  are counted as lines.
- Rapids 24: 15 core + 9 optional (`chuo_commuter_rapid`, `chuo_commuter_special_rapid`,
  `ome_holiday_special_rapid`, `saikyo_commuter_rapid`, `musashino_shimousa`, `musashino_musashino`,
  `utsunomiya_rapid_rabbit`, `takasaki_rapid_urban`, `joban_special_rapid`).
- Busiest stations by number of services: 東京 18, 大宮 15, 新宿 14, 赤羽 13, 浦和 10, then 大崎, 上野, 渋谷, 立川 9.
- If the user wants **locals only, plus the mandatory three rapids**: 39 services, 475 stations.

## 8. Open questions for the user (top 8)

1. **Through running:** keep the default split at line junctions (option A, §4)? The alternative is modelling
   上野東京ライン, 横須賀・総武快速 and 武蔵野⇔京葉 as operated (option B). This changes the service count by roughly
   ±5 and the lottery weights.
2. **Which rapid types:** include the 15 core rapids and drop the 9 optional ones? (Recommendation: drop them. No
   station depends on them.) Should 京浜東北快速, which differs from the local only between 田端 and 浜松町, count
   as a separate service?
3. **Pattern day:** use weekday patterns everywhere (recommended)? On Sat/holiday the 中央線快速 skips 高円寺,
   阿佐ケ谷 and 西荻窪.
4. **久留里線 久留里–上総亀山:** JR East has filed abolition for **2027-04-01**, and the whole line has been suspended
   by typhoon damage since 2026-09. Keep the 3 stations 平山, 上総松丘 and 上総亀山, or truncate at 久留里?
5. **Lines split in operation but one stop pattern:** one service each or split as operated?
   - 八高線: one service, or two split at 高麗川?
   - 青梅線: one service, or split at 青梅?
   - 成田線: official 佐倉–松岸, or as operated 千葉–成田–銚子?
   - 内房線: start at 千葉 (as operated) or at 蘇我 (official)?
6. **武蔵野⇔京葉 connectors:** keep the two 1-segment services, or use through services (option B)?
7. **中央本線 高尾–藤野:** keep it as its own 3-stop service, or append it to `chuo_rapid` and `chuo_special_rapid`?
8. **Station identity:** keep one station each for 東京 (京葉), 武蔵小杉 and 浜川崎 (two buildings), as in the
   23-ward edition?

Lower-priority follow-ups:
- 湘南新宿ライン at full extent or core-only.
- Whether むさしの号 is worth a geometry exception for the missing 国立支線.
- Whether 常磐線各停 should start at 北千住 via Metro track (currently 綾瀬).

## 9. Unresolved and uncertain items

- `line_official` per row is a reviewed run mapping (Section 2 runs). It is not an N02 line mapping, and the
  pipeline still needs per-run N02 lines and via hints (`n02_lines` lists the N02 lines at each station).
- Holiday timetables for 総武快速, 横須賀線 and 成田エクスプレス stations use a different markup. They were
  re-parsed after a fix, and the patterns did not change.
- Frequencies are station-level counts from one edition and are approximate. Some train pages concatenate split or
  combined trains (e.g. 成田空港 + 鹿島神宮 portions). Those were ignored for pattern definitions.
- `station_name_en_romaji` is not JR's official English spelling for every station. Hyphenation and long vowels
  follow a simple rule (e.g. 戸田公園 = Toda-Koen, 中浦和 = Naka-Urawa).
- The 久留里線 recovery after the 2026-09 typhoon is unconfirmed (reports say 木更津–久留里 targeted 10-03).

## 10. Sources (accessed 2026-10-12)

- JR East timetable site (edition 2610, 「JR時刻表」2026年10月号 basis): prefecture lists
  https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&token=13 (also `token=12`, `11`, `14`); line lists
  https://timetables.jreast.co.jp/cgi-bin/st_search.cgi?mode=1&rosen=24 (ids per line in §2: 6, 10, 13, 18, 21, 23,
  24, 25, 29, 30, 33, 34, 39, 40, 41, 42, 43, 46, 48, 49, 50, 51, 52, 53, 55, 57, 63, 66, 67, 68, 82); station pages
  `https://timetables.jreast.co.jp/timetable/list<code>.html` (code = CSV `jr_station_code`); train pages
  `https://timetables.jreast.co.jp/2610/train/<nnn>/<id>.html` (one per service in CSV `source_url`).
- MLIT 国土数値情報 N02 2025 (local raw copy, checksums `data/n02-2025.sha256`):
  https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html
- 湘南新宿ライン routing: https://ja.wikipedia.org/wiki/%E6%B9%98%E5%8D%97%E6%96%B0%E5%AE%BF%E3%83%A9%E3%82%A4%E3%83%B3 ,
  https://news.mynavi.jp/article/trivia-212/
- 久留里線 partial abolition: https://travel.watch.impress.co.jp/docs/news/2091803.html ,
  https://www.nikkei.com/article/DGXZQOCC0927G0Z00C26A2000000/ ,
  https://www.nikkei.com/article/DGXZQOCC254XR0V20C26A9000000/ (typhoon suspension)

## Appendix A. Stop lists per service (CSV order; reversed direction is implied)

- `yamanote` (30): 新橋 – 浜松町 – 田町 – 高輪ゲートウェイ – 品川 – 大崎 – 五反田 – 目黒 – 恵比寿 – 渋谷 – 原宿 – 代々木 – 新宿 – 新大久保 – 高田馬場 – 目白 – 池袋 – 大塚 – 巣鴨 – 駒込 – 田端 – 西日暮里 – 日暮里 – 鶯谷 – 上野 – 御徒町 – 秋葉原 – 神田 – 東京 – 有楽町
- `keihin_tohoku_negishi` (47): 大宮 – さいたま新都心 – 与野 – 北浦和 – 浦和 – 南浦和 – 蕨 – 西川口 – 川口 – 赤羽 – 東十条 – 王子 – 上中里 – 田端 – 西日暮里 – 日暮里 – 鶯谷 – 上野 – 御徒町 – 秋葉原 – 神田 – 東京 – 有楽町 – 新橋 – 浜松町 – 田町 – 高輪ゲートウェイ – 品川 – 大井町 – 大森 – 蒲田 – 川崎 – 鶴見 – 新子安 – 東神奈川 – 横浜 – 桜木町 – 関内 – 石川町 – 山手 – 根岸 – 磯子 – 新杉田 – 洋光台 – 港南台 – 本郷台 – 大船
- `keihin_tohoku_rapid` (41): 大宮 – さいたま新都心 – 与野 – 北浦和 – 浦和 – 南浦和 – 蕨 – 西川口 – 川口 – 赤羽 – 東十条 – 王子 – 上中里 – 田端 – 上野 – 秋葉原 – 神田 – 東京 – 浜松町 – 田町 – 高輪ゲートウェイ – 品川 – 大井町 – 大森 – 蒲田 – 川崎 – 鶴見 – 新子安 – 東神奈川 – 横浜 – 桜木町 – 関内 – 石川町 – 山手 – 根岸 – 磯子 – 新杉田 – 洋光台 – 港南台 – 本郷台 – 大船
- `chuo_sobu_local` (39): 三鷹 – 吉祥寺 – 西荻窪 – 荻窪 – 阿佐ケ谷 – 高円寺 – 中野 – 東中野 – 大久保 – 新宿 – 代々木 – 千駄ケ谷 – 信濃町 – 四ツ谷 – 市ケ谷 – 飯田橋 – 水道橋 – 御茶ノ水 – 秋葉原 – 浅草橋 – 両国 – 錦糸町 – 亀戸 – 平井 – 新小岩 – 小岩 – 市川 – 本八幡 – 下総中山 – 西船橋 – 船橋 – 東船橋 – 津田沼 – 幕張本郷 – 幕張 – 新検見川 – 稲毛 – 西千葉 – 千葉
- `chuo_rapid` (24): 東京 – 神田 – 御茶ノ水 – 四ツ谷 – 新宿 – 中野 – 高円寺 – 阿佐ケ谷 – 荻窪 – 西荻窪 – 吉祥寺 – 三鷹 – 武蔵境 – 東小金井 – 武蔵小金井 – 国分寺 – 西国分寺 – 国立 – 立川 – 日野 – 豊田 – 八王子 – 西八王子 – 高尾
- `chuo_special_rapid` (14): 東京 – 神田 – 御茶ノ水 – 四ツ谷 – 新宿 – 中野 – 三鷹 – 国分寺 – 立川 – 日野 – 豊田 – 八王子 – 西八王子 – 高尾
- `chuo_commuter_rapid` (16): 東京 – 神田 – 御茶ノ水 – 四ツ谷 – 新宿 – 中野 – 荻窪 – 吉祥寺 – 三鷹 – 国分寺 – 立川 – 日野 – 豊田 – 八王子 – 西八王子 – 高尾
- `chuo_commuter_special_rapid` (9): 東京 – 神田 – 御茶ノ水 – 四ツ谷 – 新宿 – 国分寺 – 立川 – 八王子 – 高尾
- `chuo_takao_fujino` (3): 高尾 – 相模湖 – 藤野
- `ome` (25): 立川 – 西立川 – 東中神 – 中神 – 昭島 – 拝島 – 牛浜 – 福生 – 羽村 – 小作 – 河辺 – 東青梅 – 青梅 – 宮ノ平 – 日向和田 – 石神前 – 二俣尾 – 軍畑 – 沢井 – 御嶽 – 川井 – 古里 – 鳩ノ巣 – 白丸 – 奥多摩
- `ome_holiday_special_rapid` (5): 立川 – 西立川 – 拝島 – 福生 – 青梅
- `itsukaichi` (7): 拝島 – 熊川 – 東秋留 – 秋川 – 武蔵引田 – 武蔵増戸 – 武蔵五日市
- `hachiko` (20): 八王子 – 北八王子 – 小宮 – 拝島 – 東福生 – 箱根ケ崎 – 金子 – 東飯能 – 高麗川 – 毛呂 – 越生 – 明覚 – 小川町 – 竹沢 – 折原 – 寄居 – 用土 – 松久 – 児玉 – 丹荘
- `kawagoe_west` (6): 川越 – 西川越 – 的場 – 笠幡 – 武蔵高萩 – 高麗川
- `saikyo_kawagoe` (24): 大崎 – 恵比寿 – 渋谷 – 新宿 – 池袋 – 板橋 – 十条 – 赤羽 – 北赤羽 – 浮間舟渡 – 戸田公園 – 戸田 – 北戸田 – 武蔵浦和 – 中浦和 – 南与野 – 与野本町 – 北与野 – 大宮 – 日進 – 西大宮 – 指扇 – 南古谷 – 川越
- `saikyo_rapid` (20): 大崎 – 恵比寿 – 渋谷 – 新宿 – 池袋 – 板橋 – 十条 – 赤羽 – 戸田公園 – 武蔵浦和 – 中浦和 – 南与野 – 与野本町 – 北与野 – 大宮 – 日進 – 西大宮 – 指扇 – 南古谷 – 川越
- `saikyo_commuter_rapid` (15): 大崎 – 恵比寿 – 渋谷 – 新宿 – 池袋 – 板橋 – 十条 – 赤羽 – 武蔵浦和 – 大宮 – 日進 – 西大宮 – 指扇 – 南古谷 – 川越
- `sotetsu_direct` (7): 新宿 – 渋谷 – 恵比寿 – 大崎 – 西大井 – 武蔵小杉 – 羽沢横浜国大
- `keiyo` (18): 東京 – 八丁堀 – 越中島 – 潮見 – 新木場 – 葛西臨海公園 – 舞浜 – 新浦安 – 市川塩浜 – 二俣新町 – 南船橋 – 新習志野 – 幕張豊砂 – 海浜幕張 – 検見川浜 – 稲毛海岸 – 千葉みなと – 蘇我
- `keiyo_rapid` (11): 東京 – 八丁堀 – 新木場 – 舞浜 – 新浦安 – 南船橋 – 海浜幕張 – 検見川浜 – 稲毛海岸 – 千葉みなと – 蘇我
- `musashino` (26): 府中本町 – 北府中 – 西国分寺 – 新小平 – 新秋津 – 東所沢 – 新座 – 北朝霞 – 西浦和 – 武蔵浦和 – 南浦和 – 東浦和 – 東川口 – 南越谷 – 越谷レイクタウン – 吉川 – 吉川美南 – 新三郷 – 三郷 – 南流山 – 新松戸 – 新八柱 – 東松戸 – 市川大野 – 船橋法典 – 西船橋
- `musashino_takaya` (2): 西船橋 – 市川塩浜
- `musashino_futamata` (2): 西船橋 – 南船橋
- `musashino_shimousa` (22): 大宮 – 武蔵浦和 – 南浦和 – 東浦和 – 東川口 – 南越谷 – 越谷レイクタウン – 吉川 – 吉川美南 – 新三郷 – 三郷 – 南流山 – 新松戸 – 新八柱 – 東松戸 – 市川大野 – 船橋法典 – 西船橋 – 南船橋 – 新習志野 – 幕張豊砂 – 海浜幕張
- `musashino_musashino` (11): 大宮 – 北朝霞 – 新座 – 東所沢 – 新秋津 – 新小平 – 国立 – 立川 – 日野 – 豊田 – 八王子
- `nambu` (26): 川崎 – 尻手 – 矢向 – 鹿島田 – 平間 – 向河原 – 武蔵小杉 – 武蔵中原 – 武蔵新城 – 武蔵溝ノ口 – 津田山 – 久地 – 宿河原 – 登戸 – 中野島 – 稲田堤 – 矢野口 – 稲城長沼 – 南多摩 – 府中本町 – 分倍河原 – 西府 – 谷保 – 矢川 – 西国立 – 立川
- `nambu_rapid` (12): 川崎 – 鹿島田 – 武蔵小杉 – 武蔵中原 – 武蔵新城 – 武蔵溝ノ口 – 登戸 – 稲田堤 – 稲城長沼 – 府中本町 – 分倍河原 – 立川
- `nambu_branch` (5): 尻手 – 八丁畷 – 川崎新町 – 小田栄 – 浜川崎
- `tsurumi` (10): 鶴見 – 国道 – 鶴見小野 – 弁天橋 – 浅野 – 安善 – 武蔵白石 – 浜川崎 – 昭和 – 扇町
- `tsurumi_umishibaura` (3): 浅野 – 新芝浦 – 海芝浦
- `tsurumi_okawa` (2): 安善 – 大川
- `yokohama` (20): 東神奈川 – 大口 – 菊名 – 新横浜 – 小机 – 鴨居 – 中山 – 十日市場 – 長津田 – 成瀬 – 町田 – 古淵 – 淵野辺 – 矢部 – 相模原 – 橋本 – 相原 – 八王子みなみ野 – 片倉 – 八王子
- `yokohama_rapid` (13): 東神奈川 – 菊名 – 新横浜 – 鴨居 – 中山 – 長津田 – 町田 – 相模原 – 橋本 – 相原 – 八王子みなみ野 – 片倉 – 八王子
- `sagami` (18): 茅ケ崎 – 北茅ケ崎 – 香川 – 寒川 – 宮山 – 倉見 – 門沢橋 – 社家 – 厚木 – 海老名 – 入谷 – 相武台下 – 下溝 – 原当麻 – 番田 – 上溝 – 南橋本 – 橋本
- `tokaido` (20): 東京 – 新橋 – 品川 – 川崎 – 横浜 – 戸塚 – 大船 – 藤沢 – 辻堂 – 茅ケ崎 – 平塚 – 大磯 – 二宮 – 国府津 – 鴨宮 – 小田原 – 早川 – 根府川 – 真鶴 – 湯河原
- `yokosuka` (19): 東京 – 新橋 – 品川 – 西大井 – 武蔵小杉 – 新川崎 – 横浜 – 保土ケ谷 – 東戸塚 – 戸塚 – 大船 – 北鎌倉 – 鎌倉 – 逗子 – 東逗子 – 田浦 – 横須賀 – 衣笠 – 久里浜
- `sobu_rapid` (10): 東京 – 新日本橋 – 馬喰町 – 錦糸町 – 新小岩 – 市川 – 船橋 – 津田沼 – 稲毛 – 千葉
- `sobu_rapid_narita_airport` (9): 千葉 – 都賀 – 四街道 – 物井 – 佐倉 – 酒々井 – 成田 – 空港第２ビル – 成田空港
- `uchibo_rapid` (11): 千葉 – 本千葉 – 蘇我 – 浜野 – 八幡宿 – 五井 – 姉ケ崎 – 長浦 – 袖ケ浦 – 木更津 – 君津
- `sotobo_rapid` (9): 千葉 – 本千葉 – 蘇我 – 鎌取 – 誉田 – 土気 – 大網 – 茂原 – 上総一ノ宮
- `utsunomiya` (15): 東京 – 上野 – 尾久 – 赤羽 – 浦和 – さいたま新都心 – 大宮 – 土呂 – 東大宮 – 蓮田 – 白岡 – 新白岡 – 久喜 – 東鷲宮 – 栗橋
- `utsunomiya_rapid_rabbit` (8): 東京 – 上野 – 赤羽 – 浦和 – 大宮 – 東大宮 – 蓮田 – 久喜
- `takasaki` (22): 東京 – 上野 – 尾久 – 赤羽 – 浦和 – さいたま新都心 – 大宮 – 宮原 – 上尾 – 北上尾 – 桶川 – 北本 – 鴻巣 – 北鴻巣 – 吹上 – 行田 – 熊谷 – 籠原 – 深谷 – 岡部 – 本庄 – 神保原
- `takasaki_rapid_urban` (14): 東京 – 上野 – 赤羽 – 浦和 – 大宮 – 上尾 – 桶川 – 鴻巣 – 熊谷 – 籠原 – 深谷 – 岡部 – 本庄 – 神保原
- `shonan_shinjuku_local` (27): 栗橋 – 東鷲宮 – 久喜 – 新白岡 – 白岡 – 蓮田 – 東大宮 – 土呂 – 大宮 – 浦和 – 赤羽 – 池袋 – 新宿 – 渋谷 – 恵比寿 – 大崎 – 西大井 – 武蔵小杉 – 新川崎 – 横浜 – 保土ケ谷 – 東戸塚 – 戸塚 – 大船 – 北鎌倉 – 鎌倉 – 逗子
- `shonan_shinjuku_rapid_utsunomiya` (22): 久喜 – 蓮田 – 東大宮 – 大宮 – 浦和 – 赤羽 – 池袋 – 新宿 – 渋谷 – 恵比寿 – 大崎 – 西大井 – 武蔵小杉 – 新川崎 – 横浜 – 保土ケ谷 – 東戸塚 – 戸塚 – 大船 – 北鎌倉 – 鎌倉 – 逗子
- `shonan_shinjuku_rapid_takasaki` (36): 神保原 – 本庄 – 岡部 – 深谷 – 籠原 – 熊谷 – 行田 – 吹上 – 北鴻巣 – 鴻巣 – 北本 – 桶川 – 北上尾 – 上尾 – 宮原 – 大宮 – 浦和 – 赤羽 – 池袋 – 新宿 – 渋谷 – 恵比寿 – 大崎 – 武蔵小杉 – 横浜 – 戸塚 – 大船 – 藤沢 – 辻堂 – 茅ケ崎 – 平塚 – 大磯 – 二宮 – 国府津 – 鴨宮 – 小田原
- `shonan_shinjuku_special_rapid` (26): 神保原 – 本庄 – 岡部 – 深谷 – 籠原 – 熊谷 – 鴻巣 – 北本 – 桶川 – 上尾 – 大宮 – 浦和 – 赤羽 – 池袋 – 新宿 – 渋谷 – 大崎 – 武蔵小杉 – 横浜 – 戸塚 – 大船 – 藤沢 – 茅ケ崎 – 平塚 – 国府津 – 小田原
- `joban_rapid` (12): 品川 – 新橋 – 東京 – 上野 – 日暮里 – 三河島 – 南千住 – 北千住 – 松戸 – 柏 – 我孫子 – 天王台
- `joban_special_rapid` (8): 品川 – 新橋 – 東京 – 上野 – 日暮里 – 北千住 – 松戸 – 柏
- `joban_local` (13): 綾瀬 – 亀有 – 金町 – 松戸 – 北松戸 – 馬橋 – 新松戸 – 北小金 – 南柏 – 柏 – 北柏 – 我孫子 – 天王台
- `narita_abiko` (10): 我孫子 – 東我孫子 – 湖北 – 新木 – 布佐 – 木下 – 小林 – 安食 – 下総松崎 – 成田
- `narita` (16): 佐倉 – 酒々井 – 成田 – 久住 – 滑河 – 下総神崎 – 大戸 – 佐原 – 香取 – 水郷 – 小見川 – 笹川 – 下総橘 – 下総豊里 – 椎柴 – 松岸
- `narita_airport_branch` (3): 成田 – 空港第２ビル – 成田空港
- `kashima` (2): 香取 – 十二橋
- `sobu_main` (22): 千葉 – 東千葉 – 都賀 – 四街道 – 物井 – 佐倉 – 南酒々井 – 榎戸 – 八街 – 日向 – 成東 – 松尾 – 横芝 – 飯倉 – 八日市場 – 干潟 – 旭 – 飯岡 – 倉橋 – 猿田 – 松岸 – 銚子
- `sotobo` (27): 千葉 – 本千葉 – 蘇我 – 鎌取 – 誉田 – 土気 – 大網 – 永田 – 本納 – 新茂原 – 茂原 – 八積 – 上総一ノ宮 – 東浪見 – 太東 – 長者町 – 三門 – 大原 – 浪花 – 御宿 – 勝浦 – 鵜原 – 上総興津 – 行川アイランド – 安房小湊 – 安房天津 – 安房鴨川
- `uchibo` (32): 千葉 – 本千葉 – 蘇我 – 浜野 – 八幡宿 – 五井 – 姉ケ崎 – 長浦 – 袖ケ浦 – 巌根 – 木更津 – 君津 – 青堀 – 大貫 – 佐貫町 – 上総湊 – 竹岡 – 浜金谷 – 保田 – 安房勝山 – 岩井 – 富浦 – 那古船形 – 館山 – 九重 – 千倉 – 千歳 – 南三原 – 和田浦 – 江見 – 太海 – 安房鴨川
- `kururi` (14): 木更津 – 祇園 – 上総清川 – 東清川 – 横田 – 東横田 – 馬来田 – 下郡 – 小櫃 – 俵田 – 久留里 – 平山 – 上総松丘 – 上総亀山
- `togane` (5): 大網 – 福俵 – 東金 – 求名 – 成東


## 11. Change log: v1 → revised catalog v2 (2026-10-13; user-approved 2026-10-13)

The user redefined services as track systems using their base train stop patterns. Catalog v2 is a
deterministic filter of v1 evidence; no timetable re-scrape was performed. The sections above and Appendix A
remain the **v1 research record**, including former recommendations and questions. Current rules and resolved
Q1–Q11 are in `jr-east-capital-region-expansion-design.md` §§2/12.

| Item | v1 | Revised v2 (user-approved 2026-10-13) |
|---|---:|---:|
| Service-stop rows | 965 | 666 |
| Services | 60 (36 local + 24 rapid) | 40 (36 local + 3 rapid-track bases + 1 rapid through-route base) |
| Stations | 475 | 472 |
| Undirected service segments | 906 | 627 |
| Distinct station pairs | 582 | 527 |
| Stations orphaned by service selection | — | 0 |
| Reachable from 新橋 / can return (undirected service graph) | 475 / 475 | 472 / 472 |

Keep every v1 `local` base pattern plus `chuo_rapid`, `sobu_rapid`, `joban_rapid` and
`shonan_shinjuku_rapid_takasaki`. The first three rapid patterns are the base trains of separate
中央快速線, 総武快速線 (東京–千葉) and 常磐快速線 tracks, preserving the 13 stations with no local pattern.
The fourth is the base of the 高崎線・東海道線 湘南新宿 route (神保原–小田原): that route has no 普通.
Keep both named 湘南新宿 base routes whole, with `shonan_shinjuku_local` representing 栗橋–逗子.
Exclude the 宇都宮線快速 and 特別快速 as upper types of their respective retained base routes.
Retained ids, service order, stop order, train evidence and source URLs are copied from v1.

### Removed services (20)

All removed services are upper train types within a represented track system. None was the only service
of any station. The removed rows total 296; Q6 removes a further 3 rows (965 − 296 − 3 = 666).

| Service id | v1 name | Reason for removal |
|---|---|---|
| `keihin_tohoku_rapid` | 京浜東北線 快速 | Upper type of keihin_tohoku_negishi. |
| `chuo_special_rapid` | 中央特快 | Upper type of chuo_rapid. |
| `chuo_commuter_rapid` | 中央線 通勤快速 | Upper type of chuo_rapid. |
| `chuo_commuter_special_rapid` | 中央線 通勤特快 | Upper type of chuo_rapid. |
| `ome_holiday_special_rapid` | 特別快速 ホリデー快速おくたま (青梅線内) | Upper type of ome. |
| `saikyo_rapid` | 埼京線 快速 | Upper type of saikyo_kawagoe. |
| `saikyo_commuter_rapid` | 埼京線 通勤快速 | Upper type of saikyo_kawagoe. |
| `keiyo_rapid` | 京葉線 快速 | Upper type of keiyo. |
| `musashino_shimousa` | しもうさ号 | Upper named through type over musashino and saikyo_kawagoe. |
| `musashino_musashino` | むさしの号 | Upper named through type over chuo_rapid, musashino and utsunomiya/takasaki. |
| `nambu_rapid` | 南武線 快速 | Upper type of nambu. |
| `yokohama_rapid` | 横浜線 快速 | Upper type of yokohama. |
| `sobu_rapid_narita_airport` | 総武快速 千葉–成田空港 | Upper through type over sobu_main, narita and narita_airport_branch. |
| `uchibo_rapid` | 総武快速 千葉–君津 (内房線快速) | Upper through type of uchibo. |
| `sotobo_rapid` | 総武快速 千葉–上総一ノ宮 (外房線快速) | Upper through type of sotobo. |
| `utsunomiya_rapid_rabbit` | 快速ラビット | Upper type of utsunomiya. |
| `takasaki_rapid_urban` | 快速アーバン | Upper type of takasaki. |
| `shonan_shinjuku_rapid_utsunomiya` | 湘南新宿ライン 快速 (宇都宮線・横須賀線系統) | Upper type of shonan_shinjuku_local. |
| `shonan_shinjuku_special_rapid` | 湘南新宿ライン 特別快速 | Upper type of shonan_shinjuku_rapid_takasaki. |
| `joban_special_rapid` | 常磐線 特別快速 | Upper type of joban_rapid. |

### 久留里 truncation and verification

Q6(b) changes `kururi` from 14 stops (木更津–上総亀山) to 11 (木更津–久留里). Drop 平山, 上総松丘 and
上総亀山; 久留里 keeps its original id and order (10) and becomes `is_terminus_in_area=true` with
`last_end_kind=terminus` in the service view. 木更津's historical note is updated to the decided extent;
source URLs and hop evidence remain unchanged. Endpoint metadata otherwise retains the v1 values
(`through-split` becomes product `service-boundary` in the later implementation).

All 472 remaining stations have a service and two-way reachability from 新橋; 鶴見線 remains connected via
浜川崎/鶴見. No ambiguity or coverage exception was found, so there is no new decision item for the user.

Artifacts: `jr-east-capital-region-catalog-v2.csv`, `jr-east-capital-region-services-v2.csv`;
`sim/build_catalog_v2.py`, `sim/verify_catalog_v2.py`, `sim/run-v2-manifest.json` under
`.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/`.
Catalog v2 SHA-256 (LF-normalized UTF-8 bytes): `ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4`.

Replica confirmation (50,000 games per rule, seed 20261012, cap 20,000): unchanged rules
394/962/1,647 (>500: 19,248); 山手線 1/2 only 98/337/700 (>500: 1,842); adopted Q1(c)
61/148/258 (>500: 4); Q1(c) + pass-through comparison 58/142/252 (>500: 3). No cap hits.
Full v2 results and historical comparisons are in design §8.4; real-engine confirmation remains S1M work.

### v2 selection revision after read-only validation (2026-10-13)

`.claude/logs/codex/20261013T002322Z-jrcr-v2-validation.md` returned **NEEDS_REVISION** for the
former 39-service / 630-row v2. The former filter wrongly treated the base 高崎線・東海道線 湘南新宿
快速 route as an upper type. The lead's correction restores `shonan_shinjuku_rapid_takasaki` and its
36 original v1 rows; all other selections stay. `shonan_shinjuku_rapid_utsunomiya` and
`shonan_shinjuku_special_rapid` remain excluded. The current tables above supersede that faulty v2
selection; v1 CSVs and the preceding v1 research sections are unchanged.

The independent verifier now explicitly classifies all 60 v1 service ids: 40 keep / 20 drop, with a
one-line base-track/base-route or upper-type reason for each. It retains coverage, evidence/order,
reachability, 久留里 and orphan checks and reports complete hub candidate lists. Revised v2 has
121 transfer stations, maximum k=10; 東京10 / 新宿7 / 大宮6 / 横浜5 / 千葉5. All three v2 networks and
the four 50,000-game outputs were rebuilt; the manifest records their new hashes. The old 39-service
outputs were overwritten. The separate v1 round-2 **APPROVE** applies only to the earlier design/v1
measurements. The user approved revised research catalog v2 on 2026-10-13. S0 now supplies the frozen product-ID
crosswalk and LF hashes; S0b product-catalog generation and S1M real-engine MC remain outstanding.
