# R1b exception addendum: effectively local services

This is an additive catalog. It does not modify any existing R1 CSV. Rule applied per user's 2026-10-15 decision: if a section has no 普通 and every regular train that serves the section stops at every station, count it as 各停.

## Included

- **京急久里浜線, 堀ノ内–三崎口 (`keikyu-kurihama`, 9 rows).** The existing R1-PW catalog covered 堀ノ内–京急久里浜; this addendum carries the full line service, replacing that service's addendum rows with all nine stations through 三崎口. 京急's weekday timetable at the southern stations shows 快特/特急 service, and its official 三崎口 station page lists those types. The timetable's stopping pattern serves each station on the distal segment, while 普通 service terminates before the segment. Thus it qualifies under the user rule. Endpoint is service-boundary at 堀ノ内; 三崎口 is the line terminus.
- **東武伊勢崎線 押上支線 (`tobu-oshiage`, 押上–曳舟, 2 rows).** A separate service is appropriate because ordinary/local trains do not originate on this branch, while the regular through trains serving it stop at both stations. It connects the Tokyo Metro through-running track at 押上 to the Isesaki main line at 曳舟. Both ends are service boundaries.

## 成田空港線 disposition

Add **京成 成田空港線 印旛日本医大–成田空港 (`keisei-narita-airport-access`, 4 rows)**, with the stop order 印旛日本医大 → 成田湯川 → 空港第2ビル → 成田空港. The operator boundary at 印旛日本医大 is explicit: `hokuso-main` covers the 北総鉄道 service to that point; the new service is the 京成 segment beyond it. Reuse the existing Keisei IDs `keisei-airport-terminal-2` and `keisei-narita-airport-terminal-1`; add `keisei-imba-nihon-idai` for the Keisei side of the operator boundary and `keisei-narita-yukawa` for the new station.

### Assessment and interpretation

Keisei's official station guides list the Access Express as stopping at Narita-Yukawa, Airport Terminal 2, and Narita Airport. Keisei's official Access Express stop list also shows Inba-Nihon-idai, Narita-Yukawa, Airport Terminal 2, and Narita Airport in that order. Since the service stops at all four stations, the user's exception rule applies.

This assessment treats the Access Express as eligible because it requires no limited-express surcharge; the reserved-seat Skyliner, which does require a limited-express surcharge, is normally excluded. Since 特急 appears in the Access Express name, a strictly literal reading of the user's rule—every train stops at every station on a section without 普通 service—could also exclude the Access Express. Following the request's criterion of eligible non-limited-express services, this addendum includes the Access Express because it requires no additional fare. Any future written rule should clarify whether 特急 exclusion refers to train names containing 特急 or only to services with a surcharge.

### Sources

- 京成 成田湯川駅（停車列車にアクセス特急のみを表示）: https://www.keisei.co.jp/keisei/tetudou/accessj/narita-yukawa.php
- 京成 空港第2ビル駅（停車列車にアクセス特急を表示）: https://www.keisei.co.jp/keisei/tetudou/accessj/narita-airport-terminal2-3.php
- 京成 成田空港駅（停車列車にアクセス特急を表示）: https://www.keisei.co.jp/keisei/tetudou/accessj/narita-airport-terminal-1.php
- 京成公式・アクセス特急停車駅と平日時刻（アクセス特急増発案内）: https://www.keisei.co.jp/keisei/kouhou/news/161006_02.pdf
- 京成 成田湯川の駅案内（成田空港方面の順序を確認）: https://www.keisei.co.jp/keisei/tetudou/stationmap/pdf/jp/642.pdf
- 京成 成田空港アクセスガイド（アクセス特急は特急料金不要と案内）: https://www.keisei.co.jp/keisei/tetudou/skyliner/jp/traffic/index.php?id=station_map
- 京成 空港第2ビル駅の運賃案内（北総線方面・成田湯川経由）: https://www.keisei.co.jp/keisei/tetudou/fare/pdf/144b.pdf
- 京成 成田スカイアクセス案内図（路線構成）: https://www.keisei.co.jp/keisei/quality/image/youran2025.pdf
- 京急 平日駅案内（南部の各駅と停車列車）: https://www.keikyu.co.jp/ride/kakueki/KK72.html
- 京急 平日時刻・列車停車順: https://norikae.keikyu.co.jp/transit/norikae/T5?SJ=1&USR=PC&d=2&dw=1&rsf=&slCode=250-38&tFlg=0 ; https://norikae.keikyu.co.jp/transit/norikae/T7?d=2&date=&dw=1&sf=2051&slCode=679-3&tm=0710&tx=830100-1300-680H
- 東武 曳舟駅: https://www.tobu.co.jp/railway/guide/station/info/1104/
- 北総 路線図（京成高砂–印旛日本医大）: https://www.hokuso-railway.co.jp/docs/railway/route_map.pdf
- 北総 会社概要（京成高砂の共同使用駅、15駅）: https://www.hokuso-railway.co.jp/hokuso/outline.html

### Remaining evidence limitation

Keisei's official station listings establish Access Express stops at all three stations after Inba; its published Access Express stop table explicitly includes Inba and Narita Yukawa. The linked timetable/stop table is a 2016 service notice, so current timetable details should be checked before implementation. Official station pages also corroborate the stop determination. The precise rule boundary for 特急 remains the substantive open question above.
