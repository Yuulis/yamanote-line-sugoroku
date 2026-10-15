# S6P Kanagawa stage

This is a built and validated **stage-profile dataset** from raw N02. It contains
13 of the 14 product services that touch Kanagawa and 97 of 103 Kanagawa
stations. Twelve services contain their complete contiguous Kanagawa run;
`jr-yokohama` contains the eastern run 東神奈川–長津田. The six Kanagawa
stations and additional Tokyo enclaves listed below remain for the combined S6
dataset.

The stage profile uses 横浜 as an interior two-way-reachability seed. It omits
gameplay start/target fields and is not a playable release or a live dataset.
The expected-catalog oracle is derived only from the frozen product catalogue;
its SHA-256 is pinned in `overrides/dataset.json`.

## Included service runs

- 京浜東北線・根岸線: 川崎–大船
- 相鉄線直通 (JR区間): 武蔵小杉–羽沢横浜国大
- 南武線: 川崎–稲田堤
- 南武線 浜川崎支線: 尻手–浜川崎
- 鶴見線: 鶴見–扇町
- 鶴見線 海芝浦支線: 浅野–海芝浦
- 鶴見線 大川支線: 安善–大川
- 横浜線: 東神奈川–長津田 only
- 相模線: 茅ケ崎–橋本
- 東海道線: 川崎–湯河原
- 横須賀線: 武蔵小杉–久里浜
- 湘南新宿ライン (宇都宮線・横須賀線系統 普通): 武蔵小杉–逗子
- 湘南新宿ライン 快速 (高崎線・東海道線系統): 武蔵小杉–小田原

## Deferred to combined S6

- Kanagawa stations `相模湖`, `藤野`, `古淵`, `淵野辺`, `矢部`, and `相模原`.
- Tokyo enclaves `成瀬`, `町田`, and `高尾`, which split the Yokohama and Chuo
  line runs across prefecture boundaries.
- Tokyo stations `綾瀬`, `亀有`, and `金町`, as directed for the combined
  four-prefecture dataset.
- The Yokohama Line western run `古淵–淵野辺–矢部–相模原–橋本`. `橋本` is
  already present in this stage through the Sagami Line; the Yokohama Line run
  remains partial rather than bridging `成瀬` and `町田` outside the area.
- The Chuo Line run `高尾–相模湖–藤野`. Its two Kanagawa stops form a separate
  component in this stage, so the whole product-service run is deferred.

`cross-border-pairs.csv` preserves 11 frozen-product adjacent pairs plus two
external regional boundary neighbours. None is routed in this stage.
`n02-routing-evidence.csv` records each routed pair, N02 line, section keys,
composition owner, and raw-geometry evidence. `overrides/services/*/sections.csv`
pins the reviewed N02 sections used by each direct route owner.

Two track-ownership decisions need attention in this stage. Rapid 湘南新宿
`横浜–戸塚` composes the three 横須賀線 owner primitives through 保土ケ谷 and
東戸塚. Rapid `戸塚–大船` is a rapid-owned direct route: the train leaves from
the 横須賀線 side at 戸塚 and crosses to the 東海道線 south of the station.
Raw N02 exposes only a 戸塚 platform candidate labelled 東海道線 and does not
represent the crossover as a separate feature, so its direct route is pinned to
the available 東海道線 sections and that limitation is recorded in the pair
evidence.

The two 湘南新宿 local pairs around 大船 remain separately routed: the N02
approach for 横須賀線 `戸塚–大船` ends 22.974 m from the 横須賀線 departure
alignment for `大船–北鎌倉`. An attempted platform-transfer override is rejected
as unused by the current route optimizer. See the evidence document for the
measured route geometry and the precise pipeline functions involved.

## Reproduction

From the repository root:

```bash
/usr/bin/time -p uv run python -m scripts.data_pipeline.build --raw-dir /home/yuulis/yamanote-line-sugoroku/N02-25_GML/UTF-8 --overrides-dir data/staging/jr-east-capital-region/kanagawa/overrides --out-dir /tmp/jrcr-s6p-kanagawa
uv run python -m scripts.data_pipeline.validate --overrides-dir data/staging/jr-east-capital-region/kanagawa/overrides --data-dir /tmp/jrcr-s6p-kanagawa
```

Detailed build, determinism, validation, simplification, size, oracle, and
protected-live-data results are recorded in
`.claude/docs/research/jr-east-capital-region-s6p-kanagawa.md`.
