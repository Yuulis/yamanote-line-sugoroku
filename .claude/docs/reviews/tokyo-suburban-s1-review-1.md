# S1 review 1 (Codex Sol low, read-only, 2026-10-16)

Source: `.claude/logs/codex/20261016T031522Z-s1-review.md`. Verdict: fix first. Re-delegated once to Luna (xhigh) per the false-completion protocol.

## Verdict

**fix first**。S1完了としてのcommitは保留です。以下の問題を静的確認し、4件を小さな読み取り専用Python実行でも再現しました。フルビルド・全テストは再実行していません。

## Blocking findings

- **`scripts/data_pipeline/build.py:238` — stopの事業者既定値が誤り。**  
  `stop > registry > service`で取得元を決定しています。契約はstop省略時にservice値を使用し、registryの取得元はregistry照合条件の適用先を決めます。registryがMetro、serviceが都営の場合、都営stopがMetroを検索します。service=A・registry=Bで、存在するA候補が拒否されることを再現しました。**修正:** stop取得元とregistry照合条件の取得元を別々に解決する共通helperを導入してください。

- **`scripts/data_pipeline/build.py:140` — registry selectorを別の明示的照合先にも無条件適用。**  
  後楽園側のregistry code selectorを持つ共通駅で、都営の春日を明示してもregistry selectorに拒否されます。別名候補が`no N02 platform`になることを再現しました。**修正:** 実効`(operator, normalized name)`がregistry照合先と一致する場合だけregistry selectorをANDし、探索・filter・homonym判定で同じ条件を使用してください。

- **`scripts/data_pipeline/composition.py:253` — compose証拠の事業者省略時に誤ったownerを承認。**  
  省略値をconsumerではなくownerの既定事業者と比較します。consumerがJR、ownerが別事業者でも、同じ線名/filterなら省略証拠が通ることを再現しました。また、単一leg内の複数primitiveが各々異なる事業者でも、primitive単位の検査なので拒否できません。**修正:** consumerの実効事業者を渡して省略値を解決し、leg全体の取得元が単一か検証してください。nested recipeも各consumerで解決する必要があります。

- **`scripts/data_pipeline/override_checks.py:190` — stopの実効照合先のidentity衝突が未検証。**  
  衝突検査はregistry行だけです。異なるstation IDのstopに同じ取得元・同じ`n02_name`を指定しても、disjoint selectorなしで`check_consistency`が成功することを再現しました。同一ホームを複数identityへ割り当てられます。**修正:** 解決済みstop照合先と適用されるselectorも検査対象にしてください。

- **`scripts/data_pipeline/override_parsing.py:384` — routeと行の取得元指定を併記可能。**  
  READMEは禁止していますが、`route.operators=["A","B"]`と行の`n02_operator="IGNORED"`が受理され、行指定は黙って無視されます。受理を再現しました。**修正:** 文書どおりrouteとの併記を拒否し、理由だけが残る未使用指定も検証してください。

## Non-blocking

- `scripts/data_pipeline/override_parsing.py:413`：sectionsの明示事業者に追加の`source_reason`を必須化しています。計画のsections追加列は`n02_operator`のみで、既存`reason`があります。契約とparserを一致させてください。
- 事業者view・graph cacheには事業者キーがあり、通常のraw候補は正確な事業者でfilterされます。距離・joint許容値を緩める変更は確認しませんでした。
- `original_name`・aliasesを公開JSONへ出さない点は計画どおりです。ただしstop解決helperがなく、上記の取得元・selector・identity検査が別々の規則になっています。

## Plan coverage gaps

- `tests/data_pipeline/test_multi_operator_raw.py:9`：rawテストは`N02SourceProvider`の直接検索までです。override解決、共通station ID・表示名、原名、selector適用、選択点を検証していません。綾瀬テストも「明示必須」「理由なし拒否」を実際には検証しません。
- 計画の異名駅＋前後stop＋接続線路を使った`route_service`統合fixtureがありません。現在のrawテストでは上記blocking事項を検出できません。
- `tests/data_pipeline/test_operator_routing.py:106`：foreign sourceを呼ばない正常系だけです。同名線・同座標の複数取得元を同時使用するgraph分離、事業者別section deny、30 m超snap、欠損joint、誤事業者の継承anchorという計画の追加検証が不足しています。
- `tests/data_pipeline/test_overrides.py:132`：拡張scopeテストはdataset parserの成功のみです。拡張areaでの完全一致・欠落・中間範囲外・境界隣駅不足は検証しません。
- `tests/data_pipeline/test_overrides.py:144`：aliasテストは全行`[]`のため、実際のalias共有でもIDを統合しないことを検証していません。
- 都営の表示`東京都交通局`と取得元`東京都`を同じservice設定で通す統合検証がありません。既存40サービスのbyte identityでは新規事業者の解決不具合を検出できません。
