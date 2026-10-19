# S2 range-scoped section filters (Codex Sol low, 2026-10-16)

Source: `.claude/logs/codex/20261016T055257Z-s2-sections-design.md`. User chose option A (2026-10-16). Executed by Luna (`s2-secfilter`).

### Recommendation

- **A：`sections.csv` に区間スコープを追加する。** staging内の旧allow行を旧停車範囲へ限定し、新区間の制約を独立させる。
- 旧区間ではallow/deny集合を完全維持し、compose証跡との**集合の完全一致**を引き続き要求する。
- Bは既存compose行の変更を必要とし、S2の保全条件に反するため採用しない。
- staging専用の暗黙動作にはせず、通常のloader/buildで解釈する。S5の新規product buildでも同じ契約を使う。

### Contract change

- 必須列は現行の `n02_line,action,section_key,reason`。既存optional `n02_operator` に加え、optional `from_id,to_id` を追加する。
- 両列なし／両セル空欄は従来どおりサービス全体。片列だけ、片セルだけの指定は拒否する。
- 両セル指定は、サービスの正方向停車順で `from_id` から `to_id` までの隣接pairに適用する。終点の次のpairは含まない。
- 最小実装として、スコープ指定は非環状サービスだけに許可する。不明駅、同一駅、逆順、該当operator/lineの直接routeを一つも含まないスコープは拒否する。
- pairごとの有効filterは、そのoperator/lineに一致する全体行＋当該pairを覆う行から構築する。allow集合の和、deny集合の和を使う。
- 有効集合内の重複key・allow/deny衝突は拒否する。別の非重複スコープで同じkeyを使うことは許可する。
- scoped行は全体filterを置換しない。新区間を旧allowから独立させるには、**旧allow行自体を旧範囲へ限定する**。
- composeはultimate ownerのcanonical pairごとの有効filterと証跡を完全比較する。逆向きでも同じcanonical pairを使い、keyの窓内切り詰めや部分集合比較はしない。
- 同じlineでも有効filterが異なる複数pairを一つのcompose legにまとめられない。必要なら既存形式のlegを分割する。

### Code changes

- **一回のLuna実装ラン**で以下のpipeline変更・回帰テスト・仕様更新を完了し、その後に地域データ編集へ進む。
- `constraints.py`：immutableなscoped-filter型を追加。既存 `SectionFilter` と既存filter構築規則は維持する。
- `override_parsing.py`：既存 `parse_section_filters` はlegacy互換として残し、スコープを保持するparserを追加する。列・セル対、reason、action、重複を検査する。
- `override_models.py`：default空のscoped-filterフィールドを追加。canonical pairを受け取る共通resolverを追加し、既存 `section_filter()` のlegacy動作を維持する。
- `override_loading.py`：両parserを接続し、停車順・operator・route-lineに対するスコープ検証と有効filterの衝突検査を行う。
- `overrides.py`：新しい型／parserの公開が既存呼出規約上必要な場合だけ再公開する。
- `build.py`：隣接pairとrangeを対応づけ、共通resolverを呼ぶ。サービス全体のsection探索窓、stale-key拒否、filterを含むgraph cache keyは維持する。
- `composition.py`：`flatten_recipe` の既存owner検査をpair resolverへ切り替える。比較演算・operator・line・nested検査は維持する。
- `composition_build.py`：変更不要。現在のflatten経由で新検査を受け、幾何・anchor構築を維持する。
- `stage_suburban_jr.py`：明示的スコープのある制約はpair resolverで測定する。未移行legacyの追加pair調査だけ現行互換経路を残す。
- 同helperのreviewed-key検査は、keyが**適用対象pairの窓**に存在することを要求する。旧allowのスコープ付与を「新規key」と誤判定しない。
- 同helperのauditへ、全shipped直接route pairの有効filterがliveと完全一致する検査を追加する。既存recipe・geometry・platform検査は維持する。
- `data/README.md` とhelper生成README：契約、移行例、測定／buildの区別を記述する。live override・公開物は編集しない。

### Tests

- 新規 `test_range_section_filters.py`：旧範囲限定allowで旧pairのfilterを維持し、新pairだけ別allowでrouteできる。現行はスコープを無視してfilterを混合するため失敗する。
- 同ファイル：片列／片セル、不明駅、逆順、環状、未使用スコープ、有効集合の衝突を拒否するparameterized tests。現行はスコープ検証がなく失敗する。
- `test_composition.py`：旧filter証跡を持つforward/reverse/nested consumerが、ownerの新区間filter追加後も通る。現行は全体filter比較で失敗する。
- 同ファイル：旧pairだけのfilter改変を拒否し、異なるfilterを跨ぐlegを拒否するfixtureを、まずスコープ付き正常系が通る構成にする。現行は正常系で失敗する。
- stagingテスト：新区間専用keyが別pair窓にしか存在しない場合を拒否する。現行の窓の全体和による検査では見逃す。
- staging auditテスト：幾何・recipeを変えず旧pairのfilterだけ変えると拒否する。現行auditはfilterを比較せず失敗する。
- raw統合テスト：一時overrideで東海道・高崎・宇都宮の旧allowを旧範囲へ限定し、新pair buildと旧証跡・幾何の一致を確認する。現行はowner filter混合で失敗する。

### Acceptance commands

```bash
uv run pytest tests/data_pipeline/test_range_section_filters.py tests/data_pipeline/test_composition.py tests/data_pipeline/test_suburban_stage_support.py tests/data_pipeline/test_suburban_stage_measure_raw.py -q -rs
uv run ruff check scripts/data_pipeline tests/data_pipeline
uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s2/range-filter-live --quiet
diff -r public/data .claude/logs/s2/range-filter-live
git diff --exit-code -- public/data data/overrides src N02-25_GML
```

- rawテストのskipは未完了。地域データ編集後は計画書の `s2gate` を各地域とcombinedで実行する。

### Effect on R3–R7

- R3：stagingの `jr-utsunomiya` 旧allowを旧始終駅へ限定する。旧denyは全体のまま保持し、北側追加pairへレビュー済み制約を追加する。
- R4：`jr-takasaki` を同様に移行する。非担当の宇都宮は変更不要。湘南新宿の追加compose証跡だけ新owner pairの有効filterに合わせる。
- R5：中央なども旧allowが追加範囲を閉じる場合に同じデータ移行を適用する。
- R6：`jr-tokaido` の旧allowを旧始終駅へ限定し、湯河原–熱海へ独立した制約を設定する。
- 各地域：既存 `line_mapping.csv` 行とcompose証跡は保持する。移行後にmeasure-pairsを再実行する。
- R7：担当サービス差分をassembleし、combinedでも旧filter・recipe・geometryを照合する。S5にはscoped CSVをそのまま引き渡す。

### Risks

- filter維持だけでは候補最適化による旧geometry変更を防げない。既存auditと旧platform固定手順を必須とする。
- 既存seedは自動上書きしない。地域内の明示的なCSV移行とする。距離許容・接続規則は変更しない。
- 本回答は読み取りによる設計提案。実装・テスト・buildは未実行。

### Needs user decision?

いいえ。凍結済み範囲を実現するpipeline契約の追加で、商品仕様の変更はない。
