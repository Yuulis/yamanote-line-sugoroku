# S1 implementation plan (Codex Sol low, 2026-10-16)

Source: Codex run `20261016T024135Z-s1-plan` (read-only). Lead-reviewed; no user decisions required. Executed by Luna in three runs (plan runs 1–2, 3–4, 5–6).

## TL;DR

- S1はoverrideに事業者・照合名・取得元を追加し、選択と検証を事業者単位にします。既存40サービスの5ファイルは全バイト維持します。
- Luna向けに6ランへ分割します。新規営業データの投入、runtime/UI変更、出力スキーマ変更は不要です。
- 生N02を確認済みです。都営の表示事業者は「東京都交通局」ですが、N02取得元は **「東京都」** です。

## Current single-operator assumptions

| File:line | 現在の前提と変更理由 |
|---|---|
| `override_models.py:29` | 表示事業者とN02事業者がdatasetにのみ存在する。 |
| `build.py:354` | `generate_build`がdatasetの事業者で単一`N02Source`を生成する。 |
| `n02.py:77` | ホーム・線路とも単一事業者に限定する。複数インスタンスではraw読込も重複する。 |
| `build.py:124` | 候補の絞り込みにregistryの照合名を使い、registry selectorも常に適用する。 |
| `build.py:217` | 候補の事前探索もregistry名だけを使う。片側だけの変更では異名統合駅に対応できない。 |
| `registry.py:245` | 同名identityの区別がline/group/codeのみで、事業者を考慮しない。 |
| `registry.py:262`、`override_parsing.py:107` | registryとdatasetが1都3県に固定されている。 |
| `export.py:81`、`validate.py:224`、`rules.py:131` | 全サービスの出力operatorと期待operatorがdataset共通。 |
| `composition.py:229`、`composition_build.py:45` | 共有線路の証拠と継承anchorが線名中心で、取得元事業者を保持しない。 |

パスは上表すべて `scripts/data_pipeline/` 基準です。`catalogue.py`のhash固定と順序検証、既存の距離・wrong-track検証は維持します。

## Schema changes

追加列はoptional。既存CSVヘッダ、JSON、Python fixtureを有効のまま残します。

| Override | 追加フィールドと例 | 省略時 |
|---|---|---|
| `services.json` service | `"operator":"東京都交通局","n02Operator":"東京都"` | 各dataset値を継承。明示した空文字・非文字列は拒否。 |
| `stations.csv` | `aliases`をJSON文字列配列にする。例：`["後楽園","春日"]` | 空tuple。`name`はcurated表示名で、例は`後楽園・春日`。 |
| `stations.csv` | `n02_operator`。例：`東京都` | representative serviceの実効N02事業者。registryの既存照合名・selectorの適用先。 |
| `services/<id>/stops.csv` | `original_name,n02_name,n02_operator,source_reason`。例：`春日,春日,東京都,` | 原名はregistry名、照合名はregistry `n02_name`、取得元はservice値。 |
| 同上 | 既存`platform_selector`を継続。例：`line=6号線三田線;code=003529` | 既存の空selector。別事業者取得には非空`source_reason`必須。 |
| `line_mapping.csv` | `n02_operator,source_reason`。例：`東京都,Reviewed boundary track ownership` | service値。`compose`行との併記は禁止。 |
| 同上の`route` JSON | optional `operators`配列。例：`{"lines":["L1","L2"],"operators":["A","B"],"joints":[[139.7,35.7]],"reason":"Reviewed ownership transition"}` | 各legに行の実効事業者。指定時はlinesと同数。座標例は合成fixture専用。 |
| `sections.csv` | `n02_operator`。例：`東京都` | service値。filterキーを`(operator,line)`へ変更。 |
| compose `shared_track_evidence` | optional `n02Operator`。例：`"n02Operator":"東京都"` | consumer serviceの実効取得元。同一leg内の複数取得元は拒否し、legを分割する。 |
| service scope設定 | optional `"areaPrefectures":["東京都","神奈川県"]` | datasetのareaを継承。指定時はdataset範囲の非空部分集合。 |
| `dataset.json` | 既存`areaPrefectures`で11都県まで指定可能。例：`["東京都","山梨県"]` | 現行1都3県のまま。 |

- 11都県の許容値はfreezeの`counts.perPrefectureStationGroups`のキーを定数化します。S1ではlive設定を変更しません。
- 拡張scopeでも独立`scope.csv`の連続性・境界隣駅・完全一致とhash固定catalogueを必須にします。都県の追加だけで駅の採用は認めません。
- registry照合条件は、その実効`(operator, normalized n02_name)`に一致するstopへ常に追加ANDします。他の明示的stop照合先にはstop自身の条件を適用します。
- registryと異なる照合名・取得元を使うstopは原名・照合名を明示し、原名がregistry名またはaliasesに含まれることを検証します。aliasを探索候補へ自動展開しません。
- 異名グループの全stopに原名・照合名を明記します。表示名をN02照合名へ流用しません。
- aliasesと原名はS1ではoverride内に保持します。公開stationの既存`name`にcurated表示名を出せるため、新しい公開JSON項目は不要です。原名のUI利用は後続工程です。

## Code changes

1. **Run 1 — schemaと後方互換**
   - `override_models.py`：上記optional値を末尾default付きで追加。実効operator・stop照合先・range取得元を解決する小さなtyped helperを追加。
   - `override_parsing.py`、`override_loading.py`、`registry.py`：追加列を`.get()`で読む。aliases、route operators、明示空値、理由、未使用取得元指定を検証。
   - `overrides.py`：必要な型・parserを既存方式で再公開。新規parserテストと既存overrideテストを通す。
2. **Run 2 — scopeとidentity**
   - `config.py`、`registry.py`、`override_parsing.py`：許容都県とデフォルト対象都県を分離。service別areaを解決し、`check_scope`の既存規則へ渡す。
   - `override_checks.py`：原名/alias整合、実効照合先の衝突を検証。同一照合先を異なるidentityへ割り当てる場合はdisjoint selector必須。
   - registryだけではserviceの実効取得元が判明しないため、homonym検証をload後のconsistency検証へ移す。
   - 同一service内重複id拒否とcatalogue固定を維持。D1に基づくidentityの採用判断自体はS4へ残す。
3. **Run 3 — N02取得と候補選択**
   - `n02.py`：rawの2frameを一度読み、operator別`N02Source` viewを遅延cacheするproviderを追加。既存単一source入口は維持。
   - `PlatformCandidate`に取得元operatorを保持。安定sort/dedupキーにoperatorを追加し、同一事業者内の既存順序を維持。
   - `build.py`：探索・filter双方で実効stop照合名と取得元を使用。registry条件の適用規則を共通helperで統一。
   - homonym group検査は座標dedup前に実行。空候補時に他事業者・近傍へfallbackしない。
4. **Run 4 — 線路取得元と継承**
   - `build.py`、`routing.py`：各range/route legを実効`(operator,line)`のgraphへ接続。cacheキーは取得元とsection filterを含める。
   - `constraints.py`、`override_parsing.py`：route operatorsと事業者別section指定を実装。
   - `composition.py`：共有証拠をownerの実効取得元・線名・filterすべてと比較。同名線路や重なる座標だけでは共有を認めない。
   - `composition_build.py`：継承anchorにowner primitive端のoperatorとlineを保持し、隣接routeも両方検証。
   - snap 30 m、joint `1e-6 m`、exact anchor、transfer、offset、detour条件は変更しない。
5. **Run 5 — exportとartifact validation**
   - `export.py`：service別実効表示operatorを出力。station表示名は既存`name`を使用。
   - `validate.py`、`rules.py`：operator期待値を同じresolverへ変更。registry・scope・metadataの整合を検証。
   - `catalogue.py`、公開schema、`src/types/**`は変更不要。D3のOedo UI groupもS1では出力しない。
6. **Run 6 — 統合fixtureと文書**
   - `tests/data_pipeline/test_multi_operator.py`、`test_multi_operator_raw.py`、必要なfixture/helperを追加。
   - `data/README.md`にschema、既定値、取得元優先順位、異名駅・境界例を記述。
   - 下記全gateを実施。live override、raw、公開データ、oracleを更新して差分を消す方法は禁止。

## Tests

- `test_legacy_optional_fields_preserve_defaults`：追加項目なし、明示空値、malformed aliases、route配列不一致を検証。
- `test_korakuen_kasuga_select_real_platforms`：rawで東京地下鉄の後楽園`003550/003542`、東京都の春日`003529/003539`を選ぶ。共通id・表示名、独立した原名・照合名・事業者をassert。
- `test_hamamatsucho_daimon_select_real_platforms`：JR浜松町`003949`、東京都の大門`003940/003939`を同様に検証。全国の大門を拾わない。
- `test_oshiage_same_group_keeps_operator_membership`：京成`003527`、Metro`003540`、東京都`003526`、東武`003541`。共通group`003526`だけで事業者選択を代用しない。
- `test_ayase_boundary_requires_explicit_platform_source`：JR常磐線`003215`とMetro千代田線`003214`を独立取得。指定なしの相手側取得・理由なしoverrideを拒否。
- 上記rawテストは本物のfeature属性と選択点を照合。合成N02 fixtureでは各駅の前後stopと接続線路も設け、`route_service`まで通す。
- `test_source_qualified_tracks_do_not_mix`：同名線・同座標の別operatorを用意。section deny、30 m超snap、欠損joint、誤operatorの継承anchorを拒否。
- `test_compose_requires_owner_operator_evidence`：線名/filter一致でもoperator不一致なら拒否。正しい証拠とexact jointでは成功。
- `test_registry_identity_cannot_be_overridden_by_stop_selector`：既存のregistry selector迂回拒否を維持。
- `test_extended_scope_preserves_exact_catalogue`：山梨県の明示許可は成功。未許可都県、service範囲外、in-area欠落、中間範囲外、境界隣駅不足は失敗。
- `test_aliases_do_not_merge_station_ids`：alias一致による自動統合なし。同一service重複id拒否、JRの既存id/order維持を確認。
- 既存`test_build_reproduces_published_files_byte_for_byte`、core候補固定、live track assignments、composition/transfer回帰を全実行。

## Acceptance commands

実装環境で実行するコマンドです。本read-only計画タスクでは実装・テスト実行はしていません。

```bash
sha256sum -c data/n02-2025.sha256
uv run ruff check scripts/data_pipeline tests/data_pipeline
uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q
uv run pytest tests/data_pipeline/test_multi_operator_raw.py -q -rs
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s1-build-a --quiet
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s1-build-b --quiet
diff -r public/data .claude/logs/s1-build-a
diff -r .claude/logs/s1-build-a .claude/logs/s1-build-b
uv run python -m scripts.data_pipeline.validate --overrides-dir data/overrides --data-dir .claude/logs/s1-build-a
git diff --exit-code -- public/data data/overrides src N02-25_GML
```

raw専用テストがskipなら受入未完了です。40サービス・472駅・全5ファイル・`dataVersion`の一致を必須にします。

## Risks

- 最大の危険は取得元の欠落による同名線路混入です。platform、graph、compose証拠、anchorで同じ取得元を保持・検査します。
- D1の600 mはidentity判断の上限であり、routing/offset許容値ではありません。既存offsetを超える新駅は後続stageで個別reviewが必要です。
- raw候補テストは実路線全区間の接続を証明しません。S2/S3で全pair routingを実施します。
- scopeの都県許容は商品の駅範囲を証明しません。独立scopeとhash固定oracleを維持します。
- ラン間のschema依存を避けるため順番どおり実装し、各ランで担当テストを通して引き渡します。

## Decisions needing the user

none。D1とD3はS0で確定済みです。S1に新しい商品判断はありません。
