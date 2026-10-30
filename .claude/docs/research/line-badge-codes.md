# Line-badge letter codes (UI pop overhaul step S2A)

- Date: 2026-10-30. Sources accessed 2026-10-30 unless noted.
- Purpose: the reviewed, source-verified mapping from every UI line group
  (`public/data/manifest.json` `uiPresentation.lineGroups`) to the official
  line letter code shown on the original line badge (案C), or `none`.
  Step S2B transcribes this table into `src/features/game/lineBadge.ts`.
- Plan: `.claude/docs/plans/ui-pop-hud-inventory-plan.md` §4 S2;
  prompt: `.claude/docs/plans/ui-pop-hud-inventory-prompts.md` §S2A.
  Background and operator symbol sets:
  `.claude/docs/research/official-line-symbols-usage.md` §2.
- Authoring: Codex Sol (`gpt-6.1-sol`, reasoning high, read-only sandbox,
  live web search) drafted the table; the lead derived an independent
  expectation from primary sources before reading the draft, diffed the two,
  spot-checked 31 rows against operator pages and press releases, replaced one
  dead source URL, and translated the notes to English. The code column is
  identical to the Codex draft.

## Rules applied (user decisions, 2026-10-28)

1. One code per group. A group spanning several official codes shows the
   **Tokyo-side** code; the others are named in the note (**Multi-code**).
2. A code that covers only part of the group's service keeps the code; the
   note states which section is numbered (**Partial**).
3. A group with no official letter code is `none` (colour-only badge with the
   line name). Bare station numbers without letters (大糸線) count as `none`.
4. Never invent a code, never borrow the code of a connecting line at a
   junction station, and never derive codes from ids, names, or operators.
5. Codes are unique per operator, not globally (`metro-ginza` G and
   `yokohama-green` G are both correct).

## Mapping

Columns `name` and `operator` are the manifest values verbatim. Source keys
resolve to the URL list below the table.

| group id | name | operator | code | sources | note |
|---|---|---|---|---|---|
| `jr-yamanote` | 山手線 | 東日本旅客鉄道 | JY | [jr2016] | Whole loop. |
| `jr-keihin-tohoku` | 京浜東北線 | 東日本旅客鉄道 | JK | [jr2016] | Ōmiya–Ōfuna (Negishi Line section also JK). |
| `jr-chuo-sobu-local` | 中央・総武線各駅停車 | 東日本旅客鉄道 | JB | [jr2016] | Mitaka–Chiba. |
| `jr-chuo-rapid` | 中央線快速 | 東日本旅客鉄道 | JC | [jr2016] | Tokyo–Takao. |
| `jr-chuo-takao-fujino` | 中央本線 高尾–藤野 | 東日本旅客鉄道 | JC | [jr-chuo2020], [jr-nagano], [wiki-numbering] | **Multi-code.** The service actually runs Takao–Shiojiri (38 stations) despite the display name: Takao–Ōtsuki is JC (JC24–32), Hatsukari–Shiojiri is CO (CO33–61). Tokyo-side JC chosen; CO noted. |
| `jr-ome` | 青梅線 | 東日本旅客鉄道 | JC | [jr2016] | Tachikawa–Okutama, JC51–74. |
| `jr-itsukaichi` | 五日市線 | 東日本旅客鉄道 | JC | [jr2016], [jr-itsukaichi] | Haijima–Musashi-Itsukaichi, JC81–86; current JR service-status page also shows JC. |
| `jr-hachiko` | 八高線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code; do not borrow JC/JH from Hachiōji or Haijima. |
| `jr-kawagoe-west` | 川越線 川越–高麗川 | 東日本旅客鉄道 | none | [jr-live], [jr2016] | JA is not extended west of Kawagoe. |
| `jr-saikyo` | 埼京線 | 東日本旅客鉄道 | JA | [jr2016] | **Partial.** Ōsaki–Ōmiya is JA (JA08–26); the service continues on the Kawagoe Line Nisshin–Kawagoe, which has no JA numbers. |
| `jr-sotetsu-direct` | 相鉄線直通 (JR区間) | 東日本旅客鉄道 | JA | [wiki-numbering], [jr2016], [sotetsu2022] | **Multi-code.** Service Shinjuku–Hazawa yokohama-kokudai: JA north of Ōsaki, JS Ōsaki–Musashi-Kosugi; Hazawa yokohama-kokudai carries only Sotetsu SO51. Tokyo-side JA chosen. The JA/JS split for through trains is stated by Wikipedia; the codes themselves are in the JR 2016 release. |
| `jr-keiyo` | 京葉線 | 東日本旅客鉄道 | JE | [jr2016], [wiki-numbering] | **Partial.** Tokyo–Chiba-minato is JE (JE01–17); the service terminus Soga is not JE-numbered. |
| `jr-musashino` | 武蔵野線 | 東日本旅客鉄道 | JM | [jr2016] | Fuchū-hommachi–Nishi-Funabashi (JM10–35). |
| `jr-musashino-takaya` | 武蔵野線直通 西船橋–市川塩浜 (京葉線高谷支線) | 東日本旅客鉄道 | JM | [jr-nishifunabashi], [jr-ichikawa-time], [wiki-numbering] | **Judgement (see Open Questions).** Two-station Musashino through service on the Keiyō Takaya branch: Nishi-Funabashi is JM10, Ichikawa-shiohama is Keiyō JE09. No branch-specific code exists; JM chosen because the service is signed as the Musashino Line. |
| `jr-musashino-futamata` | 武蔵野線直通 西船橋–南船橋 (京葉線二俣支線) | 東日本旅客鉄道 | JM | [jr-nishifunabashi], [jr-musashino-time], [jr2016] | **Judgement (see Open Questions).** Two-station Musashino through service on the Keiyō Futamata branch: Nishi-Funabashi is JM10, Minami-Funabashi is Keiyō JE11. JM chosen for the same reason as the Takaya branch. |
| `jr-nambu` | 南武線 | 東日本旅客鉄道 | JN | [jr2016] | Kawasaki–Tachikawa. |
| `jr-nambu-branch` | 南武線 浜川崎支線 | 東日本旅客鉄道 | JN | [jr2016] | Branch also JN: Shitte JN02, Hatchōnawate–Hama-Kawasaki JN51–54. |
| `jr-tsurumi` | 鶴見線 | 東日本旅客鉄道 | JI | [jr2016] | Tsurumi–Ōgimachi. |
| `jr-tsurumi-umishibaura` | 鶴見線 海芝浦支線 | 東日本旅客鉄道 | JI | [jr2016] | Branch also JI: Asano JI05, Shin-Shibaura/Umi-Shibaura JI51–52. |
| `jr-tsurumi-okawa` | 鶴見線 大川支線 | 東日本旅客鉄道 | JI | [jr2016] | Branch also JI: Anzen JI06, Ōkawa JI61. |
| `jr-yokohama` | 横浜線 | 東日本旅客鉄道 | JH | [jr2016] | Higashi-Kanagawa–Hachiōji. |
| `jr-sagami` | 相模線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code (unrelated to Sotetsu SO). |
| `jr-tokaido` | 東海道線 | 東日本旅客鉄道 | JT | [jr2016], [wiki-numbering] | Tokyo–Atami (JT01–21). |
| `jr-yokosuka` | 横須賀線 | 東日本旅客鉄道 | JO | [jr2016] | Tokyo–Kurihama (shared JO with the Sōbu Rapid Line). |
| `jr-sobu-rapid` | 総武快速線 | 東日本旅客鉄道 | JO | [jr2016] | Tokyo–Chiba. |
| `jr-utsunomiya` | 宇都宮線 (上野東京ライン) | 東日本旅客鉄道 | JU | [jr2016] | **Partial.** JU covers Tokyo–Ōmiya only (JU01–07); Toro–Kuroiso has no JU numbers. |
| `jr-takasaki` | 高崎線 (上野東京ライン) | 東日本旅客鉄道 | JU | [jr2016] | **Partial.** JU covers Tokyo–Ōmiya only; Miyahara–Takasaki has no JU numbers. No separate Takasaki code exists. |
| `jr-shonan-shinjuku-local` | 湘南新宿ライン (宇都宮線・横須賀線系統 普通) | 東日本旅客鉄道 | JS | [jr2016] | **Partial.** Zushi–Ōmiya is JS (JS06–24); the Toro–Utsunomiya part of the service has no JS numbers. |
| `jr-shonan-shinjuku-rapid-takasaki` | 湘南新宿ライン 快速 (高崎線・東海道線系統) | 東日本旅客鉄道 | JS | [jr2016] | **Partial / multi-code.** Service Takasaki–Odawara: Ōfuna–Ōmiya is JS, Ōfuna–Odawara stations are JT, north of Ōmiya is unnumbered. Central-Tokyo JS chosen. |
| `jr-joban-rapid` | 常磐線快速 (上野東京ライン) | 東日本旅客鉄道 | JJ | [jr2016], [jr-live] | **Partial.** Service Shinagawa–Namie: Ueno–Toride is JJ (JJ01–10); north of Toride is unnumbered; Shinagawa–Ueno stations carry JT/JU. JJ is the line's own code. |
| `jr-joban-local` | 常磐線各駅停車 | 東日本旅客鉄道 | JL | [jr2016] | Ayase–Toride (JL19–32). |
| `jr-narita-abiko` | 成田線 我孫子支線 | 東日本旅客鉄道 | none | [jr-chiba2018], [jr-live] | No line letter code; JJ/JL at Abiko and JO at Narita are not borrowed. |
| `jr-narita` | 成田線 (佐倉–松岸) | 東日本旅客鉄道 | JO | [jr-chiba2018] | **Partial.** Sakura–Narita is JO (JO33–35); Narita–Matsugishi is unnumbered. |
| `jr-narita-airport-branch` | 成田線 空港支線 | 東日本旅客鉄道 | JO | [jr-chiba2018] | Narita JO35, Airport Terminal 2 JO36, Narita Airport JO37. |
| `jr-kashima` | 鹿島線 (香取–十二橋) | 東日本旅客鉄道 | none | [jr-live], [jr-boso-map] | No line letter code. Service actually runs to Kashima-jingū despite the display name. |
| `jr-sobu-main` | 総武本線 (千葉–銚子) | 東日本旅客鉄道 | JO | [jr-chiba2018] | **Partial.** Chiba–Sakura is JO (JO28–33); Minami-Shisui–Chōshi is unnumbered. |
| `jr-sotobo` | 外房線 | 東日本旅客鉄道 | none | [jr-live], [jr-boso-map] | No line letter code; JO/JB at Chiba not borrowed. |
| `jr-uchibo` | 内房線 | 東日本旅客鉄道 | none | [jr-live], [jr-boso-map] | No line letter code. |
| `jr-kururi` | 久留里線 | 東日本旅客鉄道 | none | [jr-live], [jr-boso-map] | No line letter code found. |
| `jr-togane` | 東金線 | 東日本旅客鉄道 | none | [jr-live], [jr-boso-map] | No line letter code found. |
| `jr-ito` | 伊東線 | 東日本旅客鉄道 | JT | [wiki-numbering], [jr-live] | Atami–Itō, JT21–26 (JT extended in 2018). |
| `jr-chuo-tatsuno` | 中央本線 辰野支線 (岡谷–辰野–塩尻) | 東日本旅客鉄道 | none | [jr-nagano], [wiki-numbering] | The 2025 CO rollout covers the Midoriko main line only; the Tatsuno branch is explicitly excluded. CO at Okaya/Shiojiri is not borrowed. |
| `jr-koumi` | 小海線 (小淵沢–野辺山) | 東日本旅客鉄道 | none | [jr-nagano], [jr-live] | No line letter code; CO at Kobuchizawa belongs to the Chūō Main Line. |
| `jr-shinonoi` | 篠ノ井線 | 東日本旅客鉄道 | SN | [jr-nagano] | Shiojiri–Shinonoi; introduced from 2025-02. |
| `jr-shinetsu-nagano` | 信越本線 篠ノ井–長野 | 東日本旅客鉄道 | SE | [jr-nagano] | Shinonoi–Nagano (SE09–13); introduced from 2025-02. |
| `jr-oito` | 大糸線 (松本–白馬) | 東日本旅客鉄道 | none | [jr-oito], [jr-nagano], [wiki-numbering] | Ōito Line uses bare station numbers without letters (user rule: number-only = no letter code). |
| `jr-shinetsu-yokokawa` | 信越本線 高崎–横川 | 東日本旅客鉄道 | none | [jr-live], [jr-nagano] | SE applies only to Shinonoi–Nagano; not extended to Takasaki–Yokokawa. |
| `jr-joetsu` | 上越線 (高崎–水上) | 東日本旅客鉄道 | none | [jr-live] | No line letter code found. |
| `jr-agatsuma` | 吾妻線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code found. |
| `jr-ryomo` | 両毛線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code; an unofficial 'RY' seen on fan sites is not adopted. |
| `jr-mito` | 水戸線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code found. |
| `jr-nikko` | 日光線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code (unrelated to Tobu Nikkō TN). |
| `jr-karasuyama` | 烏山線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code found. |
| `jr-suigun` | 水郡線 (水戸–常陸大子) | 東日本旅客鉄道 | none | [jr-live] | No line letter code. |
| `jr-suigun-ota` | 水郡線 常陸太田支線 | 東日本旅客鉄道 | none | [jr-live] | No line letter code. |
| `metro-ginza` | 東京メトロ銀座線 各停 | 東京地下鉄 | G | [metro-ci], [wiki-numbering] | Same letter as Yokohama Green Line G; different operator and line. |
| `metro-marunouchi` | 東京メトロ丸ノ内線 各停 | 東京地下鉄 | M | [metro-marunouchi] | Main line. |
| `metro-marunouchi-honancho` | 東京メトロ丸ノ内線 方南町支線 各停 | 東京地下鉄 | M | [metro-marunouchi], [metro-honancho], [metro-mb] | Badge uses the line code M (plan decision). Branch station numbers are Mb03–05 (station page title 'Mb03'; line page alt text 'm03'–'m05'); Nakano-sakaue is M06. |
| `metro-hibiya` | 東京メトロ日比谷線 各停 | 東京地下鉄 | H | [metro-ci], [wiki-numbering] |  |
| `metro-tozai` | 東京メトロ東西線 各停 | 東京地下鉄 | T | [metro-ci], [wiki-numbering] |  |
| `metro-chiyoda` | 東京メトロ千代田線 各停 | 東京地下鉄 | C | [metro-ci], [wiki-numbering] | Includes the Kita-Ayase branch. |
| `metro-yurakucho` | 東京メトロ有楽町線 各停 | 東京地下鉄 | Y | [metro-ci], [wiki-numbering] | Y even on the section shared with the Fukutoshin Line. |
| `metro-hanzomon` | 東京メトロ半蔵門線 各停 | 東京地下鉄 | Z | [metro-ci], [wiki-numbering] |  |
| `metro-namboku` | 東京メトロ南北線 各停 | 東京地下鉄 | N | [metro-ci], [wiki-numbering] | N even on the section shared with the Mita Line. |
| `metro-fukutoshin` | 東京メトロ副都心線 各停 | 東京地下鉄 | F | [metro-ci], [wiki-numbering] |  |
| `toei-asakusa` | 都営浅草線 各停 | 東京都交通局 | A | [toei-stations], [wiki-numbering] |  |
| `toei-mita` | 都営三田線 各停 | 東京都交通局 | I | [toei-stations], [wiki-numbering] |  |
| `toei-shinjuku` | 都営新宿線 各停 | 東京都交通局 | S | [toei-stations], [wiki-numbering] |  |
| `toei-oedo` | 大江戸線 | 東京都交通局 | E | [toei-tochomae], [toei-stations] | Both services (`toei-oedo-loop`, `toei-oedo-radial`) are E; Tochōmae is E28. |
| `yokohama-blue` | 横浜市営地下鉄ブルーライン 各停 | 横浜市交通局 | B | [yokohama-map], [wiki-numbering] |  |
| `yokohama-green` | 横浜市営地下鉄グリーンライン 各停 | 横浜市交通局 | G | [yokohama-map], [wiki-numbering] | Nakayama G01. Distinct from Tokyo Metro Ginza G; codes are not unique across operators. |
| `tobu-isesaki` | 東武スカイツリーライン・伊勢崎線 普通 | 東武鉄道 | TS | [tobu2012], [tobu-stations] | **Multi-code.** Asakusa/Oshiage–Tōbu-dōbutsu-kōen is TS (TS01–30), Wado–Isesaki is TI (TI01–25). Tokyo-side TS chosen. |
| `tobu-nikko` | 東武日光線 普通 | 東武鉄道 | TN | [tobu2012], [tobu-stations] | Sugito-takanodai–Tōbu-Nikkō TN01–25; the junction Tōbu-dōbutsu-kōen is TS30. |
| `tobu-kinugawa` | 東武鬼怒川線 普通 | 東武鉄道 | TN | [tobu2012], [tobu-stations] | Nikkō-line group TN (TN51–58). |
| `tobu-utsunomiya` | 東武宇都宮線 普通 | 東武鉄道 | TN | [tobu2012], [tobu-stations] | Nikkō-line group TN (TN31–40). |
| `tobu-sano` | 東武佐野線 普通 | 東武鉄道 | TI | [tobu2012], [tobu-stations] | Isesaki-line group TI (TI31–39). |
| `tobu-kiryu` | 東武桐生線 普通 | 東武鉄道 | TI | [tobu2012], [tobu-stations] | Isesaki-line group TI (TI51–57). |
| `tobu-koizumi` | 東武小泉線 普通 (館林-西小泉) | 東武鉄道 | TI | [tobu2012], [tobu-stations] | Tatebayashi–Nishi-Koizumi TI41–46. |
| `tobu-koizumi-ota` | 東武小泉線 普通 (太田-東小泉) | 東武鉄道 | TI | [tobu2012], [tobu-stations] | Ōta–Higashi-Koizumi; Ryūmai is TI47. |
| `tobu-kameido` | 東武亀戸線 普通 | 東武鉄道 | TS | [tobu2012], [tobu-stations] | Skytree-line group TS (TS41–44). |
| `tobu-daishi` | 東武大師線 普通 | 東武鉄道 | TS | [tobu2012], [tobu-stations] | Nishiarai TS13, Daishimae TS51. |
| `tobu-urban-park` | 東武アーバンパークライン 普通 | 東武鉄道 | TD | [tobu2012], [tobu-stations] | Noda Line group TD. |
| `tobu-tojo` | 東武東上線 普通 | 東武鉄道 | TJ | [tobu2012], [tobu-stations] |  |
| `tobu-ogose` | 東武越生線 普通 | 東武鉄道 | TJ | [tobu2012], [tobu-stations] | Tōjō-line group TJ (TJ41–47). |
| `seibu-ikebukuro` | 西武池袋線 各停 | 西武鉄道 | SI | [seibu-stations], [seibu-timetable] | Ikebukuro–Agano. |
| `seibu-chichibu` | 西武秩父線 各停 | 西武鉄道 | SI | [seibu-stations], [seibu-timetable] | Agano–Seibu-Chichibu (SI36); shares SI with the Ikebukuro Line. |
| `seibu-yurakucho` | 西武有楽町線 各停 | 西武鉄道 | SI | [seibu-stations], [seibu-timetable] | Kotake-mukaihara SI37, Shin-sakuradai SI38. |
| `seibu-toshima` | 西武豊島線 各停 | 西武鉄道 | SI | [seibu-stations], [seibu-timetable] | Toshimaen SI39. |
| `seibu-sayama` | 西武狭山線 各停 | 西武鉄道 | SI | [seibu-stations], [seibu-timetable] | Shimo-yamaguchi SI40, Seibu-kyūjō-mae SI41. |
| `seibu-yamaguchi` | 西武山口線 (レオライナー) | 西武鉄道 | SY | [seibu-stations], [seibu-timetable] | Tamako SY01 – Seibu-kyūjō-mae SY03. |
| `seibu-shinjuku` | 西武新宿線 各停 | 西武鉄道 | SS | [seibu-stations], [seibu-timetable] |  |
| `seibu-haijima` | 西武拝島線 各停 | 西武鉄道 | SS | [seibu-stations], [seibu-timetable] | Hagiyama–Haijima SS30–36 (not ST). |
| `seibu-tamako` | 西武多摩湖線 各停 | 西武鉄道 | ST | [seibu-stations], [seibu-timetable] | Kokubunji ST01 – Tamako ST07. |
| `seibu-kokubunji` | 西武国分寺線 各停 | 西武鉄道 | SK | [seibu-stations], [seibu-sk] | Kokubunji SK01 – Higashi-Murayama SK05. |
| `seibu-seibuen` | 西武園線 各停 | 西武鉄道 | SK | [seibu-seibuen], [seibu-sk] | Seibuen SK06; Kokubunji-line group SK, not Shinjuku SS. |
| `seibu-tamagawa` | 西武多摩川線 各停 | 西武鉄道 | SW | [seibu-stations], [seibu-timetable] | Koremasa SW06; distinct from Tokyu Tamagawa TM. |
| `keisei-main` | 京成本線 普通 | 京成電鉄 | KS | [keisei-numbering] | Keisei-Ueno–Narita Airport. |
| `keisei-oshiage` | 京成押上線 普通 | 京成電鉄 | KS | [keisei-numbering] | Oshiage KS45 (also Toei A20). |
| `keisei-kanamachi` | 京成金町線 普通 | 京成電鉄 | KS | [keisei-numbering] |  |
| `keisei-chiba` | 京成千葉線 普通 | 京成電鉄 | KS | [keisei-numbering] |  |
| `keisei-chihara` | 京成千原線 普通 | 京成電鉄 | KS | [keisei-numbering] |  |
| `keisei-higashi-narita` | 京成東成田線 普通 | 京成電鉄 | KS | [keisei-numbering] | Higashi-Narita KS44. |
| `keisei-matsudo` | 京成松戸線 普通 | 京成電鉄 | KS | [keisei-matsudo-news], [keisei-matsudo] | KS since 2025-04-01 (Shin-Tsudanuma KS66 – Matsudo KS88); former Shin-Keisei SL is not used. |
| `tx` | つくばエクスプレス 普通 | 首都圏新都市鉄道 | TX | [tx-akihabara] | Akihabara TX01 – Tsukuba TX20. |
| `keikyu-main` | 京急本線 普通 | 京浜急行電鉄 | KK | [keikyu-stations] | Shinagawa–Uraga is KK; the service origin Sengakuji carries only Toei A07. |
| `keikyu-airport` | 京急空港線 普通 | 京浜急行電鉄 | KK | [keikyu-stations] |  |
| `keikyu-daishi` | 京急大師線 普通 | 京浜急行電鉄 | KK | [keikyu-stations] |  |
| `keikyu-zushi` | 京急逗子線 普通 | 京浜急行電鉄 | KK | [keikyu-stations] |  |
| `keio-main` | 京王線 各停 | 京王電鉄 | KO | [keio-guide], [keio-map] | Includes the Keiō New Line part. |
| `keio-sagamihara` | 京王相模原線 各停 | 京王電鉄 | KO | [keio-map] |  |
| `keio-takao` | 京王高尾線 各停 | 京王電鉄 | KO | [keio-map] |  |
| `keio-keibajo` | 京王競馬場線 各停 | 京王電鉄 | KO | [keio-map] |  |
| `keio-dobutsuen` | 京王動物園線 各停 | 京王電鉄 | KO | [keio-map] |  |
| `keio-inokashira` | 京王井の頭線 各停 | 京王電鉄 | IN | [keio-kichijoji], [keio-guide] | Shibuya IN01 – Kichijōji IN17. |
| `odakyu-odawara` | 小田急小田原線 各停 | 小田急電鉄 | OH | [odakyu2014] |  |
| `odakyu-enoshima` | 小田急江ノ島線 各停 | 小田急電鉄 | OE | [odakyu2014] | Higashi-Rinkan–Katase-Enoshima OE01–16; junction Sagami-Ōno is OH28. |
| `odakyu-tama` | 小田急多摩線 各停 | 小田急電鉄 | OT | [odakyu2014] | Satsukidai–Karakida OT01–07; junction Shin-Yurigaoka is OH23. |
| `tokyu-toyoko` | 東急東横線 各停 | 東急電鉄 | TY | [tokyu2012] |  |
| `tokyu-meguro` | 東急目黒線 各停 | 東急電鉄 | MG | [tokyu2012] |  |
| `tokyu-shin-yokohama` | 東急新横浜線 各停 | 東急電鉄 | SH | [shin-yokohama], [sotetsu2022] | Shin-Yokohama SH01 – Hiyoshi SH03 (2023 line). |
| `tokyu-den-en-toshi` | 東急田園都市線 各停 | 東急電鉄 | DT | [tokyu2012] |  |
| `tokyu-oimachi` | 東急大井町線 各停 | 東急電鉄 | OM | [tokyu2012], [tokyu-map] | Futako-shinchi and Takatsu carry only DT numbers on the shared section. |
| `tokyu-ikegami` | 東急池上線 各停 | 東急電鉄 | IK | [tokyu2012] |  |
| `tokyu-tamagawa` | 東急多摩川線 各停 | 東急電鉄 | TM | [tokyu2012] |  |
| `tokyu-setagaya` | 東急世田谷線 | 東急電鉄 | SG | [tokyu2012] |  |
| `tokyu-kodomonokuni` | 東急こどもの国線 各停 | 東急電鉄 | KD | [tokyu2012], [tokyu-kodomonokuni] | Kodomonokuni KD03 (track owned by Yokohama Minatomirai Railway, operated and signed by Tokyu). |
| `sotetsu-main` | 相鉄本線 各停 | 相模鉄道 | SO | [sotetsu2014] |  |
| `sotetsu-izumino` | 相鉄いずみ野線 各停 | 相模鉄道 | SO | [sotetsu2014] |  |
| `sotetsu-shin-yokohama` | 相鉄新横浜線 各停 | 相模鉄道 | SO | [sotetsu2022] | Hazawa yokohama-kokudai SO51, Shin-Yokohama SO52. |
| `mm-minatomirai` | みなとみらい線 各停 | 横浜高速鉄道 | MM | [mm-map], [mm-motomachi] | Yokohama MM01 – Motomachi-Chūkagai MM06. |
| `hokuso-main` | 北総線 普通 | 北総鉄道 | HS | [hokuso-stations], [hokuso-numbering] | Shin-Shibamata HS01 – Imba Nihon-idai HS14; the service origin Keisei-Takasago is Keisei KS10. |
| `keikyu-kurihama` | 京急久里浜線 普通・実質各停 | 京浜急行電鉄 | KK | [keikyu-stations], [keikyu-misakiguchi] | Horinouchi–Misakiguchi (KK72). |
| `tobu-oshiage` | 東武伊勢崎線 押上支線・実質各停 | 東武鉄道 | TS | [tobu2012], [tobu-stations] | Oshiage TS03 – Hikifune TS04; Metro Z / Keisei KS at Oshiage not borrowed. |
| `keisei-narita-airport-access` | 京成成田空港線 アクセス特急・実質各停 | 京成電鉄 | KS | [keisei-numbering], [keisei-yukawa-fare], [keisei-hs] | Service is Imba Nihon-idai (Hokusō HS14) – Narita-yukawa KS43 – Airport stations (KS). Keisei's own code KS chosen. |

[jr2016]: https://www.jreast.co.jp/press/2016/20160402.pdf
[jr-live]: https://traininfo.jreast.co.jp/train_info/kanto.aspx
[jr-boso-map]: https://www.jreast.co.jp/chiba/pdf/soubu.pdf
[jr-chuo2020]: https://www.jreast.co.jp/hachioji/info/20200323/20200323_info001.pdf
[jr-nagano]: https://www.jreast.co.jp/press/2024/nagano/20241213_na02.pdf
[jr-itsukaichi]: https://traininfo.jreast.co.jp/train_info/line.aspx?gid=1&lineid=itsukaichiline
[jr-nishifunabashi]: https://www.jreast.co.jp/estation/station/info.aspx?StationCD=1171
[jr-ichikawa-time]: https://timetables.jreast.co.jp/timetable/list0138.html
[jr-musashino-time]: https://timetables.jreast.co.jp/2611/timetable-v/708d1.html
[jr-chiba2018]: https://www.jreast.co.jp/chiba/news/pdf/pre1801_number.pdf
[jr-oito]: https://www.jreast.co.jp/nagano/pdf/161207.pdf
[wiki-numbering]: https://ja.wikipedia.org/wiki/駅ナンバリング
[metro-ci]: https://www.tokyometro.jp/support/trademark/pdf/guideline.pdf
[metro-marunouchi]: https://www.tokyometro.jp/station/line_marunouchi/index.html
[metro-honancho]: https://www.tokyometro.jp/station/honancho/index.html
[metro-mb]: https://www.tokyometro.jp/news/images_h/metroNews20161104_1.pdf
[toei-stations]: https://www.kotsu.metro.tokyo.jp/subway/stations/
[toei-tochomae]: https://www.kotsu.metro.tokyo.jp/subway/stations/tochomae.html
[yokohama-map]: https://navi.hamabus.city.yokohama.lg.jp/koutuu/pc/map/Top
[tobu2012]: https://www.railforum.jp/ftrain/public/dl/opencontents/imagedata/tobu_120209_1.pdf
[tobu-stations]: https://www.tobu.co.jp/railway/guide/childcare_support/station/
[seibu-stations]: https://www.seiburailway.jp/railway/station/
[seibu-seibuen]: https://www.seiburailway.jp/railway/station/seibuen/
[seibu-timetable]: https://seibu.ekitan.com/english/timetable
[seibu-sk]: https://www.seiburailway.jp/company/file/kawaraban_202502.pdf
[keisei-numbering]: https://www.keisei.co.jp/keisei/kouhou/news/22-034.pdf
[keisei-matsudo-news]: https://www.keisei.co.jp/news/detail.php?CN=6808
[keisei-matsudo]: https://www.keisei.co.jp/cms/files/keisei/MASTER/0110/Y6GBPH35.pdf
[keisei-yukawa-fare]: https://www.keisei.co.jp/keisei/tetudou/fare/pdf/642b.pdf
[keisei-hs]: https://www.keisei.co.jp/keisei/tetudou/accessj/vmap/facility.php
[tx-akihabara]: https://www.mir.co.jp/route_map/akihabara/
[keikyu-stations]: https://www.keikyu.co.jp/ride/kakueki/
[keikyu-misakiguchi]: https://www.keikyu.co.jp/ride/kakueki/KK72.html
[keio-guide]: https://www.keio.co.jp/global/howto/railwaymap/
[keio-map]: https://www.keio.co.jp/company/corporate/summary/corporate_manual/pdf/2022/2022_p017_p018.pdf
[keio-kichijoji]: https://www.keio.co.jp/train/station/in17_kichijoji/
[odakyu2014]: https://www.odakyu.jp/program/info/data.info/8052_1284200_.pdf
[tokyu2012]: https://www.tokyu.co.jp/image/news/pdf/120126-1.pdf
[tokyu-map]: https://www.tokyu.co.jp/railway/map/pdf/rosen-japanese.pdf
[tokyu-kodomonokuni]: https://www.tokyu.co.jp/area/kodomonokuni/station/
[shin-yokohama]: https://www.tokyu.co.jp/image/information/pdf/k-info20220916-1.pdf
[sotetsu2014]: https://www.sotetsu.co.jp/news_release/pdf/140225_01.pdf
[sotetsu2022]: https://cdn.sotetsu.co.jp/media/2022/pressrelease/pdf/r22-136-qr6.pdf
[mm-map]: https://www.mm21railway.co.jp/global/english/info/pdf/map.pdf?202403=
[mm-motomachi]: https://www.mm21railway.co.jp/station/motomachi/
[hokuso-numbering]: https://www.hokuso-railway.co.jp/hokuso-railwaycms/wp-content/uploads/2025/06/250625_777ticket-1.pdf
[hokuso-stations]: https://www.hokuso-railway.co.jp/railway/station/

Access notes: `www.jreast.co.jp` and `www.tokyometro.jp` return HTTP 403 to
scripted clients (browsers work). The lead read the JR East 2016, 2018 (Chiba)
and 2024 (Nagano) releases through their Internet Archive copies
(`web.archive.org/web/20160406060044/…/20160402.pdf`,
`…/20180127004443/…/pre1801_number.pdf`,
`…/20241213055515/…/20241213_na02.pdf`). `tobu2012` is a third-party copy of
Tobu's 2012-02-09 release (the official URL is gone); `tobu-stations` is the
official page and lists TS/TI/TN/TD/TJ station numbers.

## Counts

| operator | groups | coded | uncoded |
|---|---:|---:|---:|
| 東日本旅客鉄道 | 55 | 34 | 21 |
| 東京地下鉄 | 10 | 10 | 0 |
| 東京都交通局 | 4 | 4 | 0 |
| 横浜市交通局 | 2 | 2 | 0 |
| 東武鉄道 | 14 | 14 | 0 |
| 西武鉄道 | 12 | 12 | 0 |
| 京成電鉄 | 8 | 8 | 0 |
| 首都圏新都市鉄道 | 1 | 1 | 0 |
| 京浜急行電鉄 | 5 | 5 | 0 |
| 京王電鉄 | 6 | 6 | 0 |
| 小田急電鉄 | 3 | 3 | 0 |
| 東急電鉄 | 9 | 9 | 0 |
| 相模鉄道 | 3 | 3 | 0 |
| 横浜高速鉄道 | 1 | 1 | 0 |
| 北総鉄道 | 1 | 1 | 0 |
| **Total** | **134** | **113** | **21** |

The manifest has 134 groups for 135 services: `toei-oedo` groups the two
services `toei-oedo-loop` and `toei-oedo-radial` (both E). This reconciles
with the research note's "114 of 135 lines coded" (113 coded groups + 1 extra
Ōedo service; 21 uncoded). The 21 `none` ids are exactly the research note's
list.

Choices made under the rules:

- **Multi-code, Tokyo-side chosen (4):** `tobu-isesaki` TS (TI),
  `jr-sotetsu-direct` JA (JS; SO51 at Hazawa), `jr-chuo-takao-fujino` JC (CO),
  `jr-shonan-shinjuku-rapid-takasaki` JS (JT on Ōfuna–Odawara).
- **Partial (9):** `jr-utsunomiya` JU, `jr-takasaki` JU, `jr-narita` JO,
  `jr-sobu-main` JO, `jr-saikyo` JA, `jr-keiyo` JE, `jr-shonan-shinjuku-local` JS,
  `jr-shonan-shinjuku-rapid-takasaki` JS, `jr-joban-rapid` JJ.
- **Judgement, no rule applies cleanly (2):** `jr-musashino-takaya` and
  `jr-musashino-futamata` JM (see Open Questions).

## Conflicts and findings

1. **No uncoded JR line gained a letter code in 2024–2026.** The 2025 Nagano
   rollout (`jr-nagano`) adds CO (Chūō Main Line Shinano-sakai–Shiojiri), SN
   (Shinonoi Line) and SE (Shin'etsu Main Line Shinonoi–Nagano) only; the
   Tatsuno branch, the Koumi Line and the Ōito Line are not included. SE is
   not extended to Takasaki–Yokokawa.
2. **Service ranges are wider than some display names.**
   `jr-chuo-takao-fujino` runs Takao–Shiojiri (JC then CO) and `jr-kashima`
   runs to Kashima-jingū. `jr-saikyo` (to Kawagoe), `jr-keiyo` (to Soga),
   `jr-shonan-shinjuku-local` (to Utsunomiya) and `jr-joban-rapid` (to Namie)
   include unnumbered stations. Codes are unchanged; the notes say so. The
   display names are data, out of scope here.
3. **Ōedo, Marunouchi branch:** see the notes. The badge shows M for the
   Hōnanchō branch as the plan specifies, while its station numbers are Mb.
4. **Junction-station codes are not line codes.** Sengakuji A07 on
   `keikyu-main`, Keisei-Takasago KS10 on `hokuso-main`, Sagami-Ōno OH28 on
   `odakyu-enoshima` and Imba Nihon-idai HS14 on
   `keisei-narita-airport-access` do not change those groups' codes.
5. **Unofficial codes rejected.** Fan sites show codes such as JW
   (Hachikō/Kawagoe) and RY (Ryōmō); no operator source supports them.

## Uncertain

- `jr-musashino-takaya`, `jr-musashino-futamata`: no official code exists for
  these two-station branch services. JM follows the service identity; JE would
  follow the non-junction station (Ichikawa-shiohama JE09 / Minami-Funabashi
  JE11).
- `jr-sotetsu-direct`: JA and JS are both official. The rule that through
  trains use JA north of Ōsaki and JS south of it is stated by Wikipedia, not
  by a current JR page. JA (Tokyo side) is unaffected either way.
- The 20 `none` JR rows other than `jr-oito` rest on negative evidence: no
  numbering announcement was found, and none of these lines appears in the
  official rollout scopes (2016 capital area, 2018 Chiba, 2025 Nagano). `jr-oito`
  is positively documented as number-only (`jr-oito`).
- `metro-ci` (Tokyo Metro CI guideline PDF) could not be fetched by the lead
  (HTTP 403); the Metro letters are also confirmed by `wiki-numbering` and the
  Tokyo Metro station page `metro-honancho`.

## Open Questions (user)

- Musashino branch badges: keep **JM** (default here; the trains are Musashino
  Line through services and the manifest names them 武蔵野線直通) or use
  **JE** (the branch track belongs to the Keiyō Line)? Either value is inside
  the JR symbol set the S2B test encodes.

## Lead verification (2026-10-30)

Independent expectation: written from the JR/Tobu/Odakyu/Sotetsu releases and
`wiki-numbering` before the Codex draft was read; the diff against the draft
was empty for all 134 rows (two rows were flagged as judgement calls on both
sides). Reconciliation: 134 rows in manifest order, no missing or extra ids,
113 coded / 21 `none`, every coded row has at least one source.

Spot checks against operator pages or operator releases (31 rows, all agree):

| # | group id | code | evidence checked by the lead |
|---:|---|---|---|
| 1 | `jr-utsunomiya` | JU (partial) | JR 2016 release table: JU01 Tokyo – JU07 Ōmiya only |
| 2 | `jr-takasaki` | JU (partial) | same table (宇都宮線・高崎線 JU) |
| 3 | `jr-sotetsu-direct` | JA (JS) | JR 2016: JA08 Ōsaki–JA26 Ōmiya, JS15 Musashi-Kosugi; Sotetsu 2022 release: Hazawa SO51 |
| 4 | `jr-narita` | JO (partial) | JR Chiba 2018 release: JO34 Shisui, JO35 Narita, nothing east of Narita |
| 5 | `jr-sobu-main` | JO (partial) | same release: JO29 Higashi-Chiba – JO33 Sakura |
| 6 | `jr-narita-airport-branch` | JO | same release: JO36, JO37 |
| 7 | `jr-shinonoi` | SN | JR Nagano 2024-12-13 release: 篠ノ井線 SN |
| 8 | `jr-shinetsu-nagano` | SE | same release: 信越本線 篠ノ井～長野 SE |
| 9 | `jr-chuo-tatsuno` | none | same release scopes CO to 信濃境～塩尻 (main line); Wikipedia: Tatsuno branch excluded |
| 10 | `jr-oito` | none | Wikipedia: number-only 駅ナンバー since 2016-12 (JR Nagano release cited there) |
| 11 | `jr-ome` | JC | JR 2016: JC51 Nishi-Tachikawa – JC74 Okutama |
| 12 | `jr-itsukaichi` | JC | JR 2016: JC81 Kumagawa – JC86 Musashi-Itsukaichi |
| 13 | `jr-nambu-branch` | JN | JR 2016: JN51–54 |
| 14 | `jr-tsurumi-okawa` | JI | JR 2016: Ōkawa JI61 |
| 15 | `tobu-isesaki` | TS (TI) | Tobu 2012 release: TS = Asakusa/Oshiage–Tōbu-dōbutsu-kōen, TI = Wado–Isesaki |
| 16 | `tobu-utsunomiya` | TN | same release: TN = Nikkō, Utsunomiya, Kinugawa lines; TN31 Yashū-Hirakawa |
| 17 | `tobu-koizumi` | TI | same release: TI = Sano, Koizumi, Kiryū lines |
| 18 | `metro-marunouchi-honancho` | M | Tokyo Metro station page title 方南町駅/Mb03; line page m03–m05, M06 |
| 19 | `toei-oedo` | E | Toei Tochōmae page: E28 |
| 20 | `yokohama-green` | G | Yokohama Transportation Bureau station page: G01 Nakayama |
| 21 | `seibu-seibuen` | SK | Seibu station page: SK06 西武園 (西武園線) |
| 22 | `seibu-yamaguchi` | SY | Seibu station list: Tamako SY01, Seibu-kyūjō-mae SY03 |
| 23 | `seibu-yurakucho` | SI | Seibu station list: SI37, SI38 |
| 24 | `keisei-matsudo` | KS | Keisei news CN=6808: KS66–KS88 from 2025-04-01 |
| 25 | `keisei-narita-airport-access` | KS | Keisei fare table: KS43 成田湯川 |
| 26 | `tokyu-kodomonokuni` | KD | Tokyu station page: kd03 こどもの国 |
| 27 | `tokyu-shin-yokohama` | SH | Sotetsu/Tokyu 2022-09-16 release: SH01–SH03 |
| 28 | `odakyu-tama` | OT | Odakyu 2014 release: OH/OE/OT definitions |
| 29 | `keio-inokashira` | IN | Keio station page: IN17 吉祥寺 |
| 30 | `keikyu-kurihama` | KK | Keikyu station page KK72 三崎口 (久里浜線) |
| 31 | `hokuso-main` / `tx` / `mm-minatomirai` | HS / TX / MM | Hokusō HS14, TX TX01 秋葉原, Minatomirai MM06 station pages |

Additional checks: Tobu's official station page carries TS/TI/TN/TD/TJ
numbers; the Seibu timetable page carries SI/SS/SK/ST/SW/SY; the Tokyu 2012
release lists TY/DT/MG/OM/IK/TM/KD/SG; the Sotetsu 2014 release defines SO.

Correction to the Codex draft: its Odakyu source
(`odakyu.jp/wordpress/wp-content/uploads/HakoneKamakuraPass_en202504.pdf`)
returned HTTP 404; it is replaced by the Odakyu 2014 numbering release
(`odakyu2014`). Other source additions (`tobu2012`, `seibu-stations`,
`toei-tochomae`, `keisei-matsudo-news`, `keio-kichijoji`, `sotetsu2022`, and
others) are pages the lead read. No code value was changed.
