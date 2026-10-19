# R1-JR — JR「東京近郊区間」 inventory for the Tokyo suburban edition

Date: 2026-10-15 · Researcher: general-purpose-opus (R1-JR) · Read-only research; no code or data changed.
Machine-readable catalog: `.claude/docs/research/tokyo-suburban-r1-jr-catalog.csv` (R1 shared schema, one row per
stop). It is the **complete JR part**: all 40 shipped services, 10 of them extended, plus 15 new services. It can replace
the JR part of the merged catalog as-is. Scripts: `.claude/logs/r1-jr/` (gitignored; see §9).

## 0. Result

| Item | Value |
|---|---:|
| Services | **55** = 40 shipped (30 unchanged + 10 extended) + 15 new |
| Distinct stations | **746** = 472 shipped (all kept, ids unchanged) + **274 new** |
| Rows (service-stops) | 976 (shipped catalog: 666) |
| Stations by prefecture | 千葉 152, 東京 142, 神奈川 103, 埼玉 75, 茨城 70, 長野 61, 群馬 49, 栃木 41, 山梨 28, 福島 19, 静岡 6 |
| Transfer stations (≥ 2 JR services) | 148 (27 of them new, e.g. 高崎 6 services, 小山 4, 塩尻 3, 宇都宮 3, 倉賀野 3) |
| New stations found in N02 2025 (JR East) | 274 / 274 (2 spelling variants, §7) |
| New hops with ≥ 2 weekday trains of evidence | all (minimum 9, on 吾妻線) |
| JR Central segments inside the area | **none** (§2.3) |
| Truncated in-scope non-JR stations under the recommended boundary rule | **0 of 1,177** (§8) |

Size warning: the area runs from 熱海/伊東 to 浪江 (Fukushima), 黒磯, 水上, 横川, 長野, 白馬 and 野辺山. The JR part grows
from 472 to 746 stations, and some single services become very long: 常磐線 品川–浪江 has 59 stops and 中央本線
高尾–塩尻 has 38. R2's Monte Carlo should test game length before R3 freezes the split rules (§10 Q2–Q3).

## 1. Official definition (旅客営業規則 第156条第2号イ)

The JR East 旅客営業規則 第156条 page is the source. `www.jreast.co.jp` returns HTTP 403 to automated clients, so the
text below was read from the Internet Archive copy of 2026-05-12. That copy already contains the 2026-03-14 白馬
extension, so it is the current text.

- Official page: https://www.jreast.co.jp/ryokaku/02_hen/04_syo/02_setsu/02.html
- Snapshot read: https://web.archive.org/web/20260512061412/https://www.jreast.co.jp/ryokaku/02_hen/04_syo/02_setsu/02.html

Verbatim (東京附近):

> 東海道本線中東京・熱海間及び品川・新川崎・鶴見・羽沢横浜国大間、山手線、赤羽線、南武線、鶴見線、武蔵野線、横浜線、根岸線、
> 横須賀線、相模線、伊東線、中央本線中東京・塩尻間及び岡谷・辰野・塩尻間、青梅線、五日市線、八高線、小海線中小淵沢・野辺山間、
> 篠ノ井線、大糸線中松本・白馬間、東北本線中東京・黒磯間（第16条の2の規定にかかわらず、東北本線（新幹線）東京・那須塩原間を除く。）、
> 日暮里・尾久・赤羽間及び赤羽・武蔵浦和・大宮間、常磐線中日暮里・浪江間、川越線、高崎線（第16条の2の規定にかかわらず、高崎線（新幹線）
> 大宮・高崎間を除く。）、上越線中高崎・水上間、吾妻線、両毛線、水戸線、日光線、烏山線、水郡線中水戸・常陸大子間及び上菅谷・常陸太田間、
> 信越本線中高崎・横川間及び篠ノ井・長野間、総武本線、京葉線、外房線、内房線、成田線、鹿島線、久留里線及び東金線
> （以下これらの区間を「東京近郊区間」という。） （注）東海道本線（新幹線）中東京・熱海間は、東京近郊区間に含まない。

### 1.1 Recent revisions

These come from the Wikipedia revision table, which cites JR East press releases. The press PDFs themselves were not
opened.

- **2025-03-15**: added 篠ノ井線 松本–篠ノ井, 信越本線 篠ノ井–長野 and 大糸線 松本–穂高, together with the Suica area
  extension in Nagano. Source: JR East 長野支社 press 2024-12-13,
  https://www.jreast.co.jp/press/2024/nagano/20241213_na03.pdf
- **2026-03-14**: added 大糸線 穂高–白馬. Source: press 2025-12-12,
  https://www.jreast.co.jp/press/2025/nagano/20251212_na02.pdf
- There was no change in 2024. The last change before 2025 was 2020-03-14 (常磐線 いわき–浪江).
- Cross-check: https://ja.wikipedia.org/wiki/大都市近郊区間_(JR). Its line list matches the official text, including
  白馬.

**Pending risk (unconfirmed).** JR East announced on 2026-09-08 that the six Suica areas will be merged at the end of
FY2026 (spring 2027): https://www.jreast.co.jp/press/2026/20260908_ho03.pdf, not opened. A blog summary
(https://railfromokayama2.com/2026/09/08/jr-east-six-suica-areas-to-merge-into-one-in-early-2030s-will-the-metropolitan-area-network-also-expand/)
says the release does not state how 大都市近郊区間 will change. Social-media posts claim the 近郊区間 rules would cover
all of JR East, but this is unverified. Recommendation: freeze the area on the **2026-03-14 definition** and state it in
the release notes (§10 Q1).

## 2. Segment inventory

### 2.1 Segments and catalog services

All segments are JR East (東日本旅客鉄道). "Shipped" means the segment was already fully inside the 1都3県 product.

| 旅規 segment | Shipped? | Catalog service(s) | Area edge (last in-area → first outside) |
|---|---|---|---|
| 東海道本線 東京–熱海; 品川–新川崎–鶴見–羽沢横浜国大 | to 湯河原 | `jr-tokaido` extended to 熱海; 品鶴線/羽沢線 shipped | 熱海 → 函南 (JR Central) |
| 山手線, 赤羽線, 南武線, 鶴見線, 武蔵野線, 横浜線, 根岸線, 横須賀線, 相模線 | yes | unchanged | — |
| 伊東線 熱海–伊東 | no | **`jr-ito`** (new) | 伊東 → 伊豆急行線 (not in operator scope) |
| 中央本線 東京–塩尻 | to 藤野 | `jr-chuo-takao-fujino` extended to 塩尻 | 塩尻 → 洗馬 (JR Central 中央西線) |
| 中央本線 岡谷–辰野–塩尻 | no | **`jr-chuo-tatsuno`** (new) | — |
| 青梅線, 五日市線 | yes | unchanged | — |
| 八高線 八王子–倉賀野 | to 丹荘 | `jr-hachiko` extended to 高崎 | — |
| 小海線 小淵沢–野辺山 | no | **`jr-koumi`** (new) | 野辺山 → 信濃川上 |
| 篠ノ井線 塩尻–篠ノ井 | no | **`jr-shinonoi`** (new) | — |
| 大糸線 松本–白馬 | no | **`jr-oito`** (new) | 白馬 → 信濃森上 |
| 東北本線 東京–黒磯 (+ 日暮里–尾久–赤羽, 赤羽–武蔵浦和–大宮) | to 栗橋 | `jr-utsunomiya` extended to 黒磯; `jr-shonan-shinjuku-local` extended to 宇都宮 | 黒磯 → 高久 |
| 常磐線 日暮里–浪江 | to 天王台 | `jr-joban-rapid` extended to 浪江; `jr-joban-local` extended to 取手 | 浪江 → 桃内 |
| 川越線 | yes | unchanged | — |
| 高崎線 大宮–高崎 | to 神保原 | `jr-takasaki` and `jr-shonan-shinjuku-rapid-takasaki` extended to 高崎 | — |
| 上越線 高崎–水上 | no | **`jr-joetsu`** (new) | 水上 → 湯檜曽 |
| 吾妻線 | no | **`jr-agatsuma`** (new) | — |
| 両毛線 | no | **`jr-ryomo`** (new) | — |
| 水戸線 | no | **`jr-mito`** (new) | — |
| 日光線 | no | **`jr-nikko`** (new) | — |
| 烏山線 | no | **`jr-karasuyama`** (new) | — |
| 水郡線 水戸–常陸大子; 上菅谷–常陸太田 | no | **`jr-suigun`**, **`jr-suigun-ota`** (new) | 常陸大子 → 下野宮 |
| 信越本線 高崎–横川 | no | **`jr-shinetsu-yokokawa`** (new) | 横川 (end of line) |
| 信越本線 篠ノ井–長野 | no | **`jr-shinetsu-nagano`** (new) | 長野 → しなの鉄道 北しなの線 |
| 総武本線, 京葉線, 外房線, 内房線, 成田線, 久留里線, 東金線 | yes | unchanged | — |
| 鹿島線 香取–鹿島サッカースタジアム | to 十二橋 | `jr-kashima` extended to 鹿島神宮 | (鹿島サッカースタジアム: §2.2) |

### 2.2 Stations in the area but not in the base pattern

- **偕楽園** (常磐線): a 臨時駅 served only in the plum-festival season, by down trains only. Excluded; `jr-joban-rapid`
  runs 赤塚 → 水戸.
- **鹿島サッカースタジアム** (鹿島線): a 臨時駅 served on match days only; regular JR trains end at 鹿島神宮. Excluded.
- **Ｊヴィレッジ** (常磐線): a regular weekday 普通 stop in edition 2610 (22 weekday trains on the Ｊヴィレッジ–木戸 hop, both
  directions). **Included.**

No other station in the area is served only by non-普通 trains. Every in-area JR East station on the official line
lists is a weekday 普通 stop.

### 2.3 JR Central and other edge cases

- **No JR Central segment is in 東京近郊区間.** 御殿場線 (国府津–沼津), 身延線, 飯田線 and 中央西線 beyond 塩尻 are all
  outside, and 東海道新幹線 is excluded by the (注). JR East operates every segment.
- **熱海** is a JR Central station, but the in-area 東海道本線 東京–熱海 and 伊東線 are JR East's. JR East 東海道線 trains
  also run through from JR Central's 沼津, beyond the area.
- **岡谷–辰野** (JR East track) is served mostly by JR Central 飯田線 through trains (天竜峡–岡谷). 辰野–塩尻 is a JR East
  shuttle.
- **篠ノ井–長野** (JR East track) carries more しなの鉄道 trains (from 軽井沢/小諸) than JR trains.
- **塩尻** is a JR East station; JR Central's 中央西線 begins there.
- **Through running onto out-of-scope operators:**
  - 伊豆急 at 伊東;
  - 富士急 at 大月 (trains from 河口湖 into 中央本線);
  - しなの鉄道 at 篠ノ井 and 長野;
  - 鹿島臨海鉄道 at 鹿島神宮;
  - 上信電鉄 at 高崎 (no through running).

  Every one is a service end or an interior junction in the catalog. No catalog service leaves JR.
- **久留里線 久留里–上総亀山 will be abolished on 2027-04-01** (carried over from the 1都3県 research). It is still in the
  catalog.

## 3. Modelling rules applied

These are the shipped 1都3県 rules, kept unchanged, plus the decisions needed for the new lines:

1. **Service extent.** The official line segment, or JR's own named through service. Lines are split at official
   junctions where JR's own line list splits them.
   - 篠ノ井線 stops at 篠ノ井. 信越本線 篠ノ井–長野 is its own service, even though JR 篠ノ井線 trains run through to 長野.
   - Two lines follow JR's operational line list (rosen) because nearly all their trains run that way:
     - **両毛線 is modelled 高崎–小山.** JR list rosen=72; trains run 高崎–小山, so 高崎–新前橋 overlaps `jr-joetsu`.
       This is the same pattern as the shipped 内房線 from 千葉.
     - **八高線 ends at 高崎** (rosen=57; every northern train runs to 高崎). Its 倉賀野–高崎 hop overlaps `jr-takasaki`.
   - **水戸線 ends at 友部**, the official end, as `service-boundary`. In the 2610 timetable, 24 of 48 trains end at
     友部 and the rest continue on 常磐線 to 水戸, 勝田 or 高萩.
   - **中央本線 ends at 塩尻**, as `service-boundary`. 塩尻–松本 belongs to `jr-shinonoi`, even though JR's 中央本線 list
     continues to 松本.
2. **Same line and same tracks means one service, even without through trains.** This follows the shipped 八高線
   precedent.
   - `jr-utsunomiya` runs 東京–黒磯. In edition 2610 no train runs through 宇都宮; 宇都宮–黒磯 is a separate shuttle.
   - `jr-joban-rapid` runs 品川–浪江. 上野東京ライン 普通 trains run to 土浦, 水戸, 勝田 or 高萩, and いわき–浪江 has
     its own locals.
   - `jr-chuo-tatsuno` runs 岡谷–辰野–塩尻 as one service, although its trains split at 辰野.
   - The split alternatives are in §10 Q2.
3. **Branches start at the junction stop** with `service-boundary`: `jr-suigun-ota` from 上菅谷, `jr-karasuyama` from
   宝積寺 (its trains really start at 宇都宮), `jr-agatsuma` from 渋川, `jr-ito` from 熱海, `jr-chuo-tatsuno` from 岡谷.
4. **Endpoint kinds.**
   - `terminus`: trains really end there.
   - `area-boundary`: the JR line continues outside the area: 熱海, 黒磯, 浪江, 水上, 野辺山, 白馬, 常陸大子.
   - `service-boundary`: trains continue on another catalog service.
   - JR line ends where only a non-JR operator continues (伊東, 長野) are `terminus`, with a note in this document.
5. **Stop pattern.** Weekday 普通. Every new hop is backed by real weekday trains of edition `2610` (JR時刻表 2026年10月号):
   - **2,851** non-特急 train pages were parsed from **629** weekday station timetables of the 290 affected stations;
   - CSV `notes` record `hop_evidence_trains=N`, the number of 普通/快速 trains stopping at both stations consecutively;
   - the minimum per service is: 吾妻線 9, 辰野支線 18, 大糸線 18, 小海線 21, 常磐線 north 22.
6. **Kinds.** All new services are `local`. Extended services keep their shipped kind. `jr-joban-rapid` stays `rapid`;
   north of 取手 its trains are 普通 with all stops.
7. **Ids.**
   - Shipped station and service ids are unchanged.
   - New station ids are slugs of JR's official English names (`timetables.jreast.co.jp/en/...`).
   - Three ids were disambiguated: 小野 `ono-nagano`, 大野 `ono-fukushima`, 河合 `kawai-ibaraki` (shipped 川井 keeps
     `kawai`).
   - `jr-chuo-takao-fujino` keeps its id although it now runs 高尾–塩尻. The id is reused per the handoff, and a rename
     to `jr-chuo-main` is §10 Q5.

## 4. Extended shipped services (full new stop lists; **bold** = added)

Min ev. = minimum `hop_evidence_trains` over the added hops.

| service_id | Name | Kind | Stops | Ends | Min ev. | Stops in travel order |
|---|---|---|---:|---|---:|---|
| `jr-tokaido` | 東海道線 | local | 21 | service-boundary → area-boundary | 108 | 東京 新橋 品川 川崎 横浜 戸塚 大船 藤沢 辻堂 茅ケ崎 平塚 大磯 二宮 国府津 鴨宮 小田原 早川 根府川 真鶴 湯河原 **熱海** |
| `jr-chuo-takao-fujino` | 中央本線 高尾–塩尻 | local | 38 | service-boundary → service-boundary | 39 | 高尾 相模湖 藤野 **上野原 四方津 梁川 鳥沢 猿橋 大月 初狩 笹子 甲斐大和 勝沼ぶどう郷 塩山 東山梨 山梨市 春日居町 石和温泉 酒折 甲府 竜王 塩崎 韮崎 新府 穴山 日野春 長坂 小淵沢 信濃境 富士見 すずらんの里 青柳 茅野 上諏訪 下諏訪 岡谷 みどり湖 塩尻** |
| `jr-hachiko` | 八高線 | local | 24 | terminus → terminus | 40 | 八王子 北八王子 小宮 拝島 東福生 箱根ケ崎 金子 東飯能 高麗川 毛呂 越生 明覚 小川町 竹沢 折原 寄居 用土 松久 児玉 丹荘 **群馬藤岡 北藤岡 倉賀野 高崎** |
| `jr-takasaki` | 高崎線 (上野東京ライン) | local | 25 | service-boundary → terminus | 128 | 東京 上野 尾久 赤羽 浦和 さいたま新都心 大宮 宮原 上尾 北上尾 桶川 北本 鴻巣 北鴻巣 吹上 行田 熊谷 籠原 深谷 岡部 本庄 神保原 **新町 倉賀野 高崎** |
| `jr-utsunomiya` | 宇都宮線 (上野東京ライン) 東京–黒磯 | local | 34 | service-boundary → area-boundary | 76 | 東京 上野 尾久 赤羽 浦和 さいたま新都心 大宮 土呂 東大宮 蓮田 白岡 新白岡 久喜 東鷲宮 栗橋 **古河 野木 間々田 小山 小金井 自治医大 石橋 雀宮 宇都宮 岡本 宝積寺 氏家 蒲須坂 片岡 矢板 野崎 西那須野 那須塩原 黒磯** |
| `jr-shonan-shinjuku-local` | 湘南新宿ライン (宇都宮線・横須賀線系統 普通) | local | 36 | terminus → terminus | 123 | **宇都宮 雀宮 石橋 自治医大 小金井 小山 間々田 野木 古河** 栗橋 東鷲宮 久喜 新白岡 白岡 蓮田 東大宮 土呂 大宮 浦和 赤羽 池袋 新宿 渋谷 恵比寿 大崎 西大井 武蔵小杉 新川崎 横浜 保土ケ谷 東戸塚 戸塚 大船 北鎌倉 鎌倉 逗子 |
| `jr-shonan-shinjuku-rapid-takasaki` | 湘南新宿ライン 快速 (高崎線・東海道線系統) | rapid | 39 | terminus → terminus | 128 | **高崎 倉賀野 新町** 神保原 本庄 岡部 深谷 籠原 熊谷 行田 吹上 北鴻巣 鴻巣 北本 桶川 北上尾 上尾 宮原 大宮 浦和 赤羽 池袋 新宿 渋谷 恵比寿 大崎 武蔵小杉 横浜 戸塚 大船 藤沢 辻堂 茅ケ崎 平塚 大磯 二宮 国府津 鴨宮 小田原 |
| `jr-joban-rapid` | 常磐線快速・常磐線 (上野東京ライン) 品川–浪江 | rapid | 59 | service-boundary → area-boundary | 22 | 品川 新橋 東京 上野 日暮里 三河島 南千住 北千住 松戸 柏 我孫子 天王台 **取手 藤代 龍ケ崎市 牛久 ひたち野うしく 荒川沖 土浦 神立 高浜 石岡 羽鳥 岩間 友部 内原 赤塚 水戸 勝田 佐和 東海 大甕 常陸多賀 日立 小木津 十王 高萩 南中郷 磯原 大津港 勿来 植田 泉 湯本 内郷 いわき 草野 四ツ倉 久ノ浜 末続 広野 Ｊヴィレッジ 木戸 竜田 富岡 夜ノ森 大野 双葉 浪江** |
| `jr-joban-local` | 常磐線各駅停車 | local | 14 | service-boundary → terminus | 258 | 綾瀬 亀有 金町 松戸 北松戸 馬橋 新松戸 北小金 南柏 柏 北柏 我孫子 天王台 **取手** |
| `jr-kashima` | 鹿島線 (香取–鹿島神宮) | local | 5 | service-boundary → terminus | 31 | 香取 十二橋 **潮来 延方 鹿島神宮** |

The extension was checked against real trains in each case:

- 湘南新宿ライン trains really run to 宇都宮 (45 weekday 新宿↔宇都宮 trains) and to 高崎 (34).
- The 中央本線 普通 run 高尾–甲府, 小淵沢 or 松本.

## 5. New services

| service_id | Name | Stops | Ends | Min ev. | Stops |
|---|---|---:|---|---:|---|
| `jr-ito` | 伊東線 | 6 | service-boundary → terminus | 66 | 熱海 来宮 伊豆多賀 網代 宇佐美 伊東 |
| `jr-chuo-tatsuno` | 中央本線 辰野支線 | 6 | service-boundary → service-boundary | 18 | 岡谷 川岸 辰野 信濃川島 小野 塩尻 |
| `jr-koumi` | 小海線 (小淵沢–野辺山) | 5 | terminus → area-boundary | 21 | 小淵沢 甲斐小泉 甲斐大泉 清里 野辺山 |
| `jr-shinonoi` | 篠ノ井線 | 15 | service-boundary → service-boundary | 32 | 塩尻 広丘 村井 平田 南松本 松本 田沢 明科 西条 坂北 聖高原 冠着 姨捨 稲荷山 篠ノ井 |
| `jr-shinetsu-nagano` | 信越本線 篠ノ井–長野 | 5 | service-boundary → terminus | 106 | 篠ノ井 今井 川中島 安茂里 長野 |
| `jr-oito` | 大糸線 (松本–白馬) | 29 | terminus → area-boundary | 18 | 松本 北松本 島内 島高松 梓橋 一日市場 中萱 南豊科 豊科 柏矢町 穂高 有明 安曇追分 細野 北細野 信濃松川 安曇沓掛 信濃常盤 南大町 信濃大町 北大町 信濃木崎 稲尾 海ノ口 簗場 南神城 神城 飯森 白馬 |
| `jr-shinetsu-yokokawa` | 信越本線 高崎–横川 | 8 | terminus → terminus | 44 | 高崎 北高崎 群馬八幡 安中 磯部 松井田 西松井田 横川 |
| `jr-joetsu` | 上越線 (高崎–水上) | 14 | terminus → area-boundary | 36 | 高崎 高崎問屋町 井野 新前橋 群馬総社 八木原 渋川 敷島 津久田 岩本 沼田 後閑 上牧 水上 |
| `jr-agatsuma` | 吾妻線 | 18 | service-boundary → terminus | 9 | 渋川 金島 祖母島 小野上 小野上温泉 市城 中之条 群馬原町 郷原 矢倉 岩島 川原湯温泉 長野原草津口 群馬大津 羽根尾 袋倉 万座・鹿沢口 大前 |
| `jr-ryomo` | 両毛線 | 22 | terminus → terminus | 52 | 高崎 高崎問屋町 井野 新前橋 前橋 前橋大島 駒形 伊勢崎 国定 岩宿 桐生 小俣 山前 足利 あしかがフラワーパーク 富田 佐野 岩舟 大平下 栃木 思川 小山 |
| `jr-mito` | 水戸線 | 16 | terminus → service-boundary | 48 | 小山 小田林 結城 東結城 川島 玉戸 下館 新治 大和 岩瀬 羽黒 福原 稲田 笠間 宍戸 友部 |
| `jr-nikko` | 日光線 | 7 | terminus → terminus | 39 | 宇都宮 鶴田 鹿沼 文挾 下野大沢 今市 日光 |
| `jr-karasuyama` | 烏山線 | 8 | service-boundary → terminus | 27 | 宝積寺 下野花岡 仁井田 鴻野山 大金 小塙 滝 烏山 |
| `jr-suigun` | 水郡線 (水戸–常陸大子) | 20 | terminus → area-boundary | 27 | 水戸 常陸青柳 常陸津田 後台 下菅谷 中菅谷 上菅谷 常陸鴻巣 瓜連 静 常陸大宮 玉川村 野上原 山方宿 中舟生 下小川 西金 上小川 袋田 常陸大子 |
| `jr-suigun-ota` | 水郡線 常陸太田支線 | 6 | service-boundary → terminus | 30 | 上菅谷 南酒出 額田 河合 谷河原 常陸太田 |

Low-frequency notes, as weekday trains on a hop in both directions: 吾妻線 万座・鹿沢口–大前 9, 大糸線 飯森–白馬 18,
小海線 小淵沢–甲斐小泉 21, 常磐線 双葉–浪江 22.

## 6. Municipality column

`municipality` comes from the GSI reverse geocoder (`mreversegeocoder.gsi.go.jp`, codes resolved with
`maps.gsi.go.jp/js/muni.js`), applied to the midpoint of the N02 2025 station geometry.

- Ordinance-designated cities carry the ward, e.g. 横浜市西区. District names (郡) are omitted, e.g. 白馬村.
- Every station's geocoded prefecture agrees with JR's prefecture.
- A station that sits on a municipal boundary may differ from its official postal address. Treat the column as
  approximate.

## 7. N02 2025 findings

- `n02_operator`/`n02_line` give the N02 line of the service at that station. All 274 new stations exist under
  `東日本旅客鉄道`.
- Spelling variants: **Ｊヴィレッジ** (JR, full-width) vs `Jヴィレッジ` (N02), and **文挾** vs `文挟`. Normalise NFKC and
  挾→挟.
- N02 line names to use: 中央線, 小海線, 篠ノ井線, 大糸線, 信越線, 上越線, 吾妻線, 両毛線, 水戸線, 日光線, 烏山線, 水郡線,
  伊東線, 東北線, 常磐線, 高崎線, 八高線, 鹿島線, 東海道線.
  - 塩尻 and 熱海 also exist under `東海旅客鉄道`: always filter by operator.
  - 中央線快速 東京 has no N02 中央線 station; use `東北線`.
- Geometry: every new hop has a path on the JR East N02 lines (15 m vertex snap), with three **junction gaps** of the
  kind already known from the 1都3県 project:

  | Hop | Gap |
  |---|---|
  | 両毛線 思川→小山 | 小山 is 26 m from the 両毛線 sections |
  | 水戸線 小山→小田林 | 41 m |
  | 水郡線 水戸→常陸青柳 | 25 m |

  The pipeline needs a junction tolerance or an explicit connector. No line is missing from N02.
- Multi-track N02 lines (東北線, 常磐線, 中央線) carry several track pairs, as before. North of 取手 and west of 高尾
  there is one pair.

## 8. Boundary rule for non-JR lines (proposal)

JR's definition is a set of JR line segments, not an area. Four operational rules were evaluated on **all 1,177 N02
stations** of the 12 in-scope operators: 東京地下鉄, 都営 (N02 `東京都`), 横浜市, 東急, 京王, 京急, 相鉄, 小田急, 東武, 西武,
京成 and TX (N02 `首都圏新都市鉄道`/`常磐新線`). Per-station results: `.claude/logs/r1-jr/boundary-rules.json`.

| Rule | Definition | Stations outside | Verdict |
|---|---|---:|---|
| A. Municipality | inside iff its municipality contains an in-area JR station | **313** | **Reject.** It excludes core areas with no JR station: 世田谷区, 練馬区, 文京区, 目黒区, 調布市, 狛江市, 草加市, 春日部市, 加須市, 守谷市, つくば市, 太田市, 館林市 … The result is disjoint (伊勢崎線 drops 草加–羽生 but keeps 足利市 and 伊勢崎市). |
| B. Prefecture | inside iff in 1都6県 (東京・神奈川・埼玉・千葉・茨城・栃木・群馬) | **0** | **Recommend.** 東京近郊区間 covers every JR East conventional (non-Shinkansen) station in these 7 prefectures except 6 in the far north: 湯檜曽 and 土合 (みなかみ町), 高久, 黒田原 and 豊原 (那須町), and 下野宮 (大子町). No in-scope non-JR line comes near them. |
| C. Convex hull | inside iff inside the convex hull of the 746 in-area JR stations | **0** | Same result as B. Useful as a geometric cross-check, but a hull over-includes for future operators (秩父, 富士五湖). |
| D. Buffer | inside iff within X km of an in-area JR station | X=5: 155, X=10: **18** | A size lever, not the JR definition. At X=10 it cuts the 鬼怒川線 tail, 西武秩父線 beyond 吾野, 伊勢崎線 at 羽生–川俣 (a hole in the middle of the line), 野田線 七光台–藤の牛島, TX at 万博記念公園 and 小田急 at 渋沢. |

Consequences for the named cases:

| Line | A municipality | B prefecture (recommended) | D 10 km |
|---|---|---|---|
| 東武日光線 / 鬼怒川線 | 日光線 loses 6 stations in 加須, 板倉, 幸手 and 杉戸; 鬼怒川線 stays | entire, to 東武日光 and 新藤原 | cuts 東武金崎 and 鬼怒川温泉–新藤原 |
| 東武伊勢崎線 beyond 館林 | 館林 and 太田市 out, 足利市 and 伊勢崎市 in (disjoint) | entire, to 伊勢崎 | holes at 一ノ割, 羽生, 南羽生, 川俣 |
| 小田急 to 小田原 | 24 stations out (世田谷区, 狛江, 厚木, 秦野 …) | entire | cuts 渋沢 (a hole) |
| 西武秩父線 | 芦ヶ久保, 横瀬, 西武秩父 out | entire, to 西武秩父 | cuts 正丸–西武秩父 |
| 京成 to 成田空港 | 3 stations in 八千代市 and 新鎌ヶ谷 out | entire | entire |
| TX to つくば | 八潮, 守谷, つくばみらい and つくば out | entire | cuts 万博記念公園 (a hole) |

**Recommendation: rule B (prefecture = 1都6県), with C as an automated cross-check.**

- In practice, **no in-scope non-JR line is truncated geographically.** Lines end only at operator boundaries, which
  the R1 through-running split already handles. Examples:
  - 野岩鉄道 at 新藤原;
  - 秩父鉄道 at 西武秩父 and 寄居;
  - 北総・芝山 at 京成高砂, 印旛日本医大 and 東成田;
  - 東葉高速 at 西船橋;
  - 埼玉高速 at 赤羽岩淵;
  - 横浜高速 at 横浜;
  - 箱根登山 at 小田原;
  - りんかい線 and 東京モノレール.
- This is the faithful reading of "truncate within 東京近郊区間": the JR area already encloses every in-scope line.
- It contradicts the user's expectation that lines would be cut, so it needs the user's confirmation (§10 Q4).
- If operators beyond the 12 are ever added (富士急, 伊豆急, しなの鉄道, 秩父鉄道 …), extend rule B: 山梨 in full;
  静岡, 長野 and 福島 only in municipalities that have an in-area JR station.

## 9. Reproduction and validation

Scripts are in `.claude/logs/r1-jr/` (gitignored). Raw caches live in the session scratchpad.

| Script | Purpose |
|---|---|
| `build_catalog.py`, `services_new.py` | Build the catalog from the shipped research CSVs, the JR line lists `st_search.cgi?mode=1&rosen=<id>`, scraped weekday timetables and train pages (edition 2610), official English names, N02 and GSI |
| `check_catalog.py` | Acceptance check |
| `boundary_rules.py` | §8 evaluation |

The rosen ids used are: 伊東 7, 東海道 49, 中央 46, 小海 27, 篠ノ井 31, 大糸 14, 信越 35, 宇都宮 82, 常磐 34, 高崎 43, 上越 32,
吾妻 1, 両毛 72, 水戸 62, 日光 54, 烏山 20, 水郡 36, 八高 57, 鹿島 18.

`python3 -I .claude/logs/r1-jr/check_catalog.py .claude/docs/research/tokyo-suburban-r1-jr-catalog.csv .claude/docs/research/jr-east-capital-region-product-catalog.csv`
reports **OK**. It checks:

- the exact column set;
- contiguous `order` from 0 in all 55 services;
- endpoint kinds only on the first and last rows of linear services, with valid values (the loop has none);
- one id per physical station (name + JR code) and one physical station per id;
- shipped ids unchanged, every shipped service present with its shipped stops kept as a contiguous run;
- no empty required field.

Unverified items:

- Press PDFs cited only through secondary sources (§1.1).
- The 2027 Suica-merger effect on 近郊区間.
- Municipalities near boundaries (§6).
- Frequencies quoted in §5 are approximate counts from the 2610 pages.

## 10. Open questions for the user / R3

1. **Area freeze.** Fix the area on the 2026-03-14 definition, even if the spring-2027 Suica merger changes 近郊区間?
   (Recommended: yes.)
2. **Long single-track services.** Keep `jr-joban-rapid` 品川–浪江 (59 stops) and `jr-utsunomiya` 東京–黒磯 (34) as one
   service each, as the track-system rule says? Alternatives:
   - split 常磐線 at 取手 (where the 快速 brand ends; precedent: 中央 at 高尾) and/or at いわき;
   - split 宇都宮線 at 宇都宮 (no through trains since 2022).

   Decide after the R2 game-length simulation.
3. **Junction splits.** Should 篠ノ井線 + 信越本線 篠ノ井–長野 merge into one 塩尻–長野 service? JR trains run through,
   which would remove a forced transfer at 篠ノ井. Should 水戸線 run to 水戸? Half its trains do.
4. **Boundary rule for non-JR lines.** Under the recommended rule B no in-scope private or subway line is truncated
   geographically. Is that acceptable? Or does the user want a size lever such as rule D (10 km buffer)? That lever is
   not the JR definition and creates holes inside lines.
5. **Ids.** Rename `jr-chuo-takao-fujino` to `jr-chuo-main` now that it runs 高尾–塩尻? Old saves are discarded anyway.
   Also confirm the disambiguated ids `ono-nagano`, `ono-fukushima` and `kawai-ibaraki`.
6. **久留里線.** Keep 久留里–上総亀山, which is to be abolished on 2027-04-01, if release slips past that date?
