# S2 implementation plan (Codex Sol low, 2026-10-16)

Source: Codex run `20261016T040340Z-s2-plan` (read-only). Lead-reviewed; no user decisions required. Execution groups: [R0+R1] → [R2] → [R3 ∥ R4] → [R5 ∥ R6] → [R7]. Region runs (R3–R6) must not modify `scripts/` or shared test helpers; a needed pipeline change stops the run and is reported.

## TL;DR
- S2 は **55 JRサービス・746駅・976停車行・1,814有向segment** を staging に作成する。公開データと live override は変更しない。
- 既知の小山・水戸の gap はサービス固有ホームの選択で解消する。追加発見の Jヴィレッジでは、完全一致する既存頂点の明示的な graph 分割が必要。
- 以下の8ランを順に実行する。各ランは約30分を上限とし、地域別ビルドと既存 geometry の一致検査で受け入れる。

## Staging layout
- ルートを `data/staging/tokyo-suburban-jr/` とし、地域は `tohoku,takasaki,chuo,tokaido`、統合結果は `combined` に置く。
- 各地域の `overrides/` は live override の完全コピーから開始し、担当サービスだけを拡張・追加する。既存40サービスを含むため、compose owner と首都圏の接続を維持できる。
- ファイルは既存構成の `dataset.json,services.json,stations.csv,expected-catalog.json`、例外CSV、`services/<id>/{stops,scope,line_mapping,sections}.csv`。後述の `junctions.csv` は必要なサービスだけ追加する。
- 地域直下に `README.md,pair-evidence.csv,baseline-sha256.json`。証拠CSVは pair、operator、platform code/group、section key、距離、route/compose根拠を記録する。
- 全地域を `validationProfile:"stage",stageStartStationId:"shimbashi"` とし、gameplay の start/target は削除する。operator は表示・N02とも `東日本旅客鉄道`。
- dataset の area は freeze の11都県、`outputBbox:[137.7,34.8,141.2,37.7]`、探索bboxは `[137.5,34.6,141.4,37.9]`。既存の simplify・budget profile は維持する。
- **非担当サービスには元の4都県を service `areaPrefectures` として明示**する。dataset の拡張で旧 scope の除外隣駅が採用扱いになることを防ぐ。
- 新駅の代表サービスは frozen JR service順の最初の所属サービス。既存472駅の registry、代表サービス、座標は維持する。S4の他事業者identityは採用しない。
- oracle は override から逆生成せず、hash検証済み research catalog/services のJR行から作る。地域は担当サービスを frozen 全範囲、他は shipped 範囲にする。
- 新規 helper `scripts/data_pipeline/stage_suburban_jr.py` に `seed --region NAME`、`assemble`、`audit --region NAME --data-dir PATH` を実装する。再seedは既存出力を上書きせず拒否する。
- `assemble` は live を基底に、地域ごとの担当サービス差分を一度だけ採用する。共通駅の値不一致、担当重複、欠落を拒否する。
- S5 は `combined/overrides` の内容をS3/S4と統合し、gameplay設定へ戻して**新規ビルド**する。stage出力のmanifestを付け替えて公開してはいけない。

## Service inventory
停車数は凍結済み research catalog のJR行とR1を照合済み。`旧→新` は拡張、単独数は新設。
| 地域／ラン | 拡張サービス | 新設サービス |
|---|---|---|
| tohoku／R3 | `jr-utsunomiya` 15→34、`jr-shonan-shinjuku-local` 27→36、`jr-joban-rapid` 12→59、`jr-joban-local` 13→14、`jr-kashima` 2→5 | `jr-mito` 16、`jr-nikko` 7、`jr-karasuyama` 8、`jr-suigun` 20、`jr-suigun-ota` 6 |
| takasaki／R4 | `jr-takasaki` 22→25、`jr-shonan-shinjuku-rapid-takasaki` 36→39、`jr-hachiko` 20→24 | `jr-joetsu` 14、`jr-agatsuma` 18、`jr-ryomo` 22、`jr-shinetsu-yokokawa` 8 |
| chuo／R5 | `jr-chuo-takao-fujino` 3→38 | `jr-chuo-tatsuno` 6、`jr-koumi` 5、`jr-shinonoi` 15、`jr-shinetsu-nagano` 5、`jr-oito` 29 |
| tokaido／R6 | `jr-tokaido` 20→21 | `jr-ito` 6 |

- 合計15新設・10拡張・30無変更、追加274駅・310停車行・295個の新しい正方向pair。
- 湘南新宿2系統は北側が**先頭へ追加**される。旧停車列は同じ向きの連続部分列として維持する。それ以外の8拡張は旧列をprefixとして維持する。
- 常磐 品川–浪江、宇都宮 東京–黒磯、中央 高尾–塩尻を分割しない。水戸線は友部止まり、篠ノ井／信越は別サービス、中央の既存IDも維持する。

## Known geometry problems
- **小山／両毛線**：`line=両毛線;code=002411`、group `002407` を選ぶ。思川→小山は既存 `route_path` で成功、約5,583.785 m、snap実質0 m。
- **小山／水戸線**：`line=水戸線;code=002410`、同groupを選ぶ。小山→小田林は約4,811.758 m、snap実質0 m。
- **水戸／水郡線**：`line=水郡線;code=002317`、group `002319`。水戸→常陸青柳は約1,804.664 m、snap実質0 m。
- 上記3件は別サービスの代表ホームから測った距離を線路接続へ転用しない。service stopに実ホームselectorを指定し、registryの代表ホームを変更しない。connector・transfer例外は不要。
- **Jヴィレッジ**：南側section `140.99921 37.21210~141.00738 37.24077#de4dc6de` の端は `(141.0073806,37.24077448)`。
- この座標は駅section `141.00748 37.24274~141.00776 37.24270#9d1f3f94` の内部頂点index 1と元座標で完全一致する。現行graphの端点接続だけでは広野→Jヴィレッジが失敗する。
- `jr-joban-rapid/junctions.csv` に `n02_operator,n02_line,section_key,peer_section_key,lon,lat,reason` を記録し、上記駅sectionだけを当該内部頂点で分割する。
- 規則は「同operator・同lineの指定peer端点＝指定section内部の既存source頂点」。元座標で完全一致を要求し、section filter適用後に分割する。線分追加・近接noding・交差点の自動接続は禁止。
- 不明key、頂点不一致、peer非端点、除外済みsection、重複・未使用ruleは失敗させる。section keyは原形を維持して証拠・filterに使用する。
- **八高／両毛の線名境界**：倉賀野–高崎は高崎線、高崎–新前橋は上越線。八高・両毛の名称だけで全区間を検索しない。
- **表記差**：registry表示は既存normalizerに従い、`Jヴィレッジ`、`文挾`。文挾の `n02_name` は明示的に `文挟` とする。全体の文字正規化規則は変えない。
- **既存 caveat**：上野の150 m transfer設定、湘南新宿の田端側代替経路、既存section制約・compose証拠をコピーして保持する。
- 調査では追加pairを単一路線で試走し、上記Jヴィレッジ・文挾・2線名境界以外は成功した。ただし全サービス連続routing・wrong-track検証の代替にはしない。

## Runs
以下のshell関数はR2で追加するhelper・地域テストを前提とする。生成物は `.claude/logs/s2/` のみ。
```bash
s2gate() {
  region="$1"
  stage="data/staging/tokyo-suburban-jr/$region/overrides"
  out=".claude/logs/s2/$region"
  uv run pytest "tests/data_pipeline/test_staging_suburban_${region}.py" -q -rs || return
  uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir "$stage" --out-dir "$out-a" --quiet || return
  uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir "$stage" --out-dir "$out-b" --quiet || return
  diff -r "$out-a" "$out-b" || return
  uv run python -m scripts.data_pipeline.validate --overrides-dir "$stage" --data-dir "$out-a" || return
  uv run python -m scripts.data_pipeline.stage_suburban_jr audit --region "$region" --data-dir "$out-a"
}
```
1. **R0 — 凍結scope対応（20–30分）**
   - 対象：`registry.py`、必要なscope loader、`data/README.md`、新規 `test_suburban_scope.py`。
   - 現行の都県判定では黒磯→高久、浪江→桃内など同県内境界を表現できない。optional `scope.csv` 列 `in_area` を追加する。
   - 列なしは従来動作。列ありは全行に厳密な `true/false` を要求し、true列の連続性・stops完全一致・registry地理一致・許可都県を検査する。
   - area-boundaryには直近false隣駅を必須とし、frozen catalog＋R1境界証拠との独立照合を地域テストで固定する。既存scopeの意味は変えない。
   - テスト：拡張serviceの成功、欠落、中間false、隣駅欠落、混在空値、不許可都県、旧形式互換。
   - 受入：`uv run pytest tests/data_pipeline/test_suburban_scope.py tests/data_pipeline/test_overrides.py -q`。
2. **R1 — Jヴィレッジ限定noding（20–30分）**
   - 対象：`constraints.py,override_models.py,override_parsing.py,override_loading.py,n02.py,build.py`、必要な型再公開、`data/README.md`、`test_reviewed_junctions.py`。
   - 上記CSVと完全一致分割を実装する。指定なしのgraphは現在と同一にする。rawは変更しない。
   - テスト：実N02の広野–Jヴィレッジ–木戸連続成功、全rule拒否条件、1 mmでも離れた合成頂点の拒否、split前後の線分保存。
   - 受入：`uv run pytest tests/data_pipeline/test_reviewed_junctions.py tests/data_pipeline/test_network.py tests/data_pipeline/test_build.py -q -rs`。rawテストskipは未完了。
3. **R2 — staging準備・保全gate（20–30分）**
   - 対象：`stage_suburban_jr.py`、`test_suburban_stage_support.py`、地域別テスト共通helper、staging基底。
   - `seed` はliveをコピーし、担当列・oracle・scope・metadataをfreezeから投入する。追加stopの番号は空欄、旧番号は維持し、全sequenceを明示する。
   - 新設色はstaging暫定 `#808080`、名前はfrozen services CSV、方向表示は正方向終端／逆方向始端。既存色を維持する。
   - lengthRefは独立したpair調査のN02距離合計、許容1.5 kmと出典を記録する。拡張は旧reference＋追加pair距離。出力を見て自動追従する実装は禁止。
   - `audit` はfreeze hash、担当範囲、全stopのN02所属、旧station全record、旧pairのsegment参照・primitive geometry・compose recipe・旧platformを比較する。
   - 旧platformが全体最適化で変わる場合は、baseline buildの実candidate selectorをstaging内で固定する。旧geometryを新しい期待値へ更新しない。
   - 受入：`uv run pytest tests/data_pipeline/test_suburban_stage_support.py -q`。元データ改変、順序反転、担当外差分で失敗するテストを含める。
4. **R3 — Tohoku/Joban（25–30分）**
   - `uv run python -m scripts.data_pipeline.stage_suburban_jr seed --region tohoku`。対象はinventoryの10サービスと `test_staging_suburban_tohoku.py`。
   - 新pairを実routingし、小山水戸・水戸水郡selector、文挟照合、Jヴィレッジruleを投入。上野以南の全既存recipeを維持する。
   - 湘南新宿の追加北側は宇都宮線の逆向きcomposeを、共有線路証拠が確認できるpairに限定して採用する。確認できないpairは個別route。
   - 受入：`s2gate tohoku`。既知3gapのうち水戸線・水郡線と、Jヴィレッジ前後をraw成功回帰にする。
5. **R4 — Takasaki/Ryomo（20–30分）**
   - `uv run python -m scripts.data_pipeline.stage_suburban_jr seed --region takasaki`。inventoryの7サービスと `test_staging_suburban_takasaki.py`。
   - 高崎線を先に拡張し、八高 倉賀野–高崎、湘南新宿の追加区間を証拠付きcompose。両毛 高崎–新前橋は上越線ownerを使い、以東を両毛線でrouteする。
   - 新前橋はsame operator/group・同一midpointの別線candidateによるanchor成功回帰を追加。小山は両毛固有ホームを選ぶ。
   - 受入：`s2gate takasaki`。reverse compose、線名境界成功、誤group／誤operator拒否を含める。
6. **R5 — Chuo/Shinonoi/Shinetsu（25–30分）**
   - `uv run python -m scripts.data_pipeline.stage_suburban_jr seed --region chuo`。inventoryの6サービスと `test_staging_suburban_chuo.py`。
   - 中央旧2pairを維持し、藤野以西を中央線でroute。辰野経由を独立サービスにし、小海・篠ノ井・信越・大糸を順に追加する。
   - 塩尻はJR東日本の実candidateを固定。篠ノ井／長野で他事業者へfallbackしない。
   - 受入：`s2gate chuo`。塩尻・松本・篠ノ井接続、野辺山・白馬の除外隣駅を検査する。
7. **R6 — Tokaido/Ito（15–20分）**
   - `uv run python -m scripts.data_pipeline.stage_suburban_jr seed --region tokaido`。2サービスと `test_staging_suburban_tokaido.py`。
   - 湯河原–熱海を東海道線、熱海–伊東を伊東線でroute。JR東日本の熱海ホームを使う。
   - 受入：`s2gate tokaido`。JR東海候補の排除、熱海→函南のscope境界、伊東終端を検査する。
8. **R7 — 統合・引渡し（20–30分）**
   - `uv run python -m scripts.data_pipeline.stage_suburban_jr assemble`、`s2gate combined`。
   - `test_staging_suburban_combined.py` は55/746/976/1814、274追加駅、全停車順、全駅双方向到達、旧geometry/composition維持を固定する。
   - 全gateを実行し、地域証拠とS5へのmerge手順をstaging READMEへ記録する。
```bash
sha256sum -c data/n02-2025.sha256
uv run ruff check scripts/data_pipeline tests/data_pipeline
uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s2/live --quiet
diff -r public/data .claude/logs/s2/live
git diff --exit-code -- public/data data/overrides src N02-25_GML
```

## S1 carry-overs
- **a：拡張service scopeの組合せ不足**はR0の単体回帰＋R3/R5の実境界テストで完了する。
- **b：同一事業者の別線anchor成功回帰**はR4の新前橋で完了する。合成成功例と実N02例の両方を残す。

## Risks
- scopeと限定nodingは必要なpipeline拡張。raw・live override変更は不要。許容距離・joint・detour・wrong-track規則は一切変更しない。
- 地域別成功だけでは統合時のplatform最適化変更を検出できない。R7でも旧pair・primitive・platform比較を必須とする。
- 新composeは幾何一致だけで採用しない。既存の首都圏統合で誤共有が見つかった前例に従い、物理線路の証拠をレビューする。
- 本計画ではraw照合とpair試走を実施した。`uv run` はread-only環境のcache lock作成で失敗したため、調査は `.venv/bin/python` を使用した。実装後の全gateは未実行。

## Decisions needing the user
none。新しい商品判断はない。湘南新宿2系統の先頭追加は、凍結済み停車順をそのまま適用する。
