# S1 review 2 (Codex Sol low, read-only, 2026-10-16)

Source: `.claude/logs/codex/20261016T034656Z-s1-review2.md`. Verdict: commit.

**Verdict**
commit。初回の5件のblockingは修正済みです。追加のblockingはありません。重点回帰8件を独立実行し、全件成功しました。フルビルドは再実行していません。

**Review-1 findings status**
1. **修正済み** — `override_models.py:130`の`resolve_stop_target`がstop省略時にservice事業者を採用。`test_omitted_stop_operator_uses_service_operator_not_registry`は旧規則ではA候補を選択できず失敗します。
2. **修正済み** — 同helperが実効`(operator, normalized name)`一致時だけregistry selectorを適用し、探索・filter・homonym判定で共有。`test_registry_selector_is_skipped_for_an_alternate_stop_match`は旧filterでは候補が消えて失敗します。
3. **修正済み** — `composition.py:214`以降でconsumer既定値、nested consumer、leg全体の単一事業者を検証。consumer不一致・複数primitive事業者・nested既定値の各回帰は、それぞれ旧規則の誤承認／誤拒否を検出します。
4. **修正済み** — `override_checks.py:182`以降が解決済みstop照合先と適用selectorを収集し、identity間の衝突を検証。`test_identity_collision_checks_resolved_stop_targets_and_selectors`は旧コードでは例外が出ず失敗します。
5. **修正済み** — `override_parsing.py:380`以降がrouteと行事業者の併記、孤立した理由を拒否。`test_route_operator_list_rejects_row_operator_and_orphan_source_reason`は旧parserの受理を検出します。

**Anchor-rule verdict**
builderの拒否は、現在のfixtureに対して妥当です。正当な同一事業者の線名変更を一律には拒否しません。

`composition_build.py:48`以降でowner primitive端の線名・事業者をanchorへ保持し、`build.py:368`以降から`check_inherited_route_sources`へ渡します。`composition_build.py:151–159`は、同一事業者・同一group・中点完全一致の別線候補があれば線名変更を許可します。座標一致だけで別事業者へ移ることは許可しません。

本物のN02候補で独立確認した結果、小竹向原の有楽町線／副都心線はgroup `003294`と中点が一致し、関内の1号線／3号線もgroup `004691`と中点が一致しました。両方とも同関数が受理しました。したがって、指定されたMetro・横浜の境界はこの規則で扱えます。

一方、変更された合成fixtureではL1のcはgroup `"1"`、L2のcはgroup `"0"`です。接続座標は同じでも、同じ駅groupでの線変更という証拠がなく、拒否は妥当です。旧テストの後段tampering拒否はgeometry ownerの改変検出であり、別線設定そのものが不正である根拠ではありません。

**Blocking findings**
none

**Non-blocking**
- 初回のplan-coverage gapsは**すべて閉じたとは言えません**。raw選択・原名・共通ID、異名駅routing、graph分離、section deny、snap上限、欠損joint、誤事業者anchor、実alias共有の検証は追加されています。
- `test_overrides.py:137`の拡張scopeテストはdatasetへ山梨県を追加しますが、各serviceは従来範囲に限定しています。拡張service範囲での欠落・中間範囲外・境界隣駅不足の組合せはS2へ持ち越せます。既存scope検証は維持されており、今回のcommitを止める不具合は確認しませんでした。
- 同一事業者の別線anchorを許可する**成功回帰テスト**をS2で追加してください。今回、小竹向原・関内は直接確認しましたが、JRの各境界は個別未検証です。
- 距離・joint・exact anchorの許容値緩和、通常raw経路での暗黙の別事業者fallbackは確認しませんでした。
