# S4 implementation plan — cross-operator assembly (Codex Sol `low`, 2026-10-17)

Source: `.claude/logs/codex/20261017T061025Z-s4-plan.md` (Sol answered in Japanese; kept verbatim below).

## Lead adjustments (binding; override the plan text where they differ)

1. **Display name = frozen canonical name only.** The freeze sets `sameNamePriority: true` and
   `retainOriginalNamesAsAliases: true`. The registry `name` of each merged station is the frozen group name
   (`station_name_ja` of the catalog) — never a `・`-joined concatenation such as `浜松町・大門`. Every distinct
   `station_name_original` of the group goes into `aliases` (frozen row order, deduplicated, excluding the name
   itself). Alias rendering is S6.
2. Code, identifiers, comments, README and report prose are written in English.
3. The "s3 standing lead decisions" in `tokyo-suburban-impl-prompts.md` still apply to any re-measured pair.
4. Any new shared-track composition, route recipe, junction, offset/detour exception, or a D1-merge representative
   change that breaks an existing S3/S2 check is a STOP for lead review with evidence — never resolved inside a run.
5. Lead verifier: `.claude/docs/plans/tokyo-suburban-s4-verify.sh <label> [gate]`.
6. **Count correction (lead, after R1).** The plan's "1,994 正方向pair" and "全JR 907 pair" are wrong (Sol halved
   3,988). The freeze definition (`check_freeze.py`) counts per-service route pairs, the target service `jr-yamanote`
   one way only: **2,009 service route pairs = JR 922 (627 shipped + 295 S2-added) + non-JR 1,087**, and
   (2,009 − 30) × 2 + 30 = **3,988 directed segments**. Live `public/data/segments.json` has 1,224 = (627 − 30) × 2 + 30.
   Evidence batches must cover 922 JR pairs and 1,087 non-JR. **Batches partition by service, never by pair** (R3d
   showed per-service length checks fail when a service is split): `jr-core` = the 40 shipped services (all their pairs,
   incl. S2 extensions), `jr-new` = the 15 new JR services, plus the eight S3 group names (as Sol's plan said).
   The oracle computes these counts from the frozen CSVs (lead fix in `_oracle`), never copies them from the freeze.
7. **D1-merge platform offsets (lead, after R3).** Merging D1 groups (≤ 600 m official interchanges) moves a member
   platform away from the group's registry point (e.g. Toei Mita 三田 → `tamachi` 291 m; S3 had 0 m). R3's first build
   reported 49 offsets over the global 250 m and 3 S3 exceptions made unused by the merge. Resolution: the global limit
   stays 250 m; the assembly generates per-row `offset_exceptions.csv` entries of class `d1-merge` only when (a) the
   station is a merged D1 group in the frozen identity map, (b) the same service platform passed its pre-merge S2/S3
   offset check (recorded value and limit), (c) the measured offset is ≤ 600 m (the frozen D1 bound); limit = measured
   rounded up to 10 m + 10 m (S3 rule). Pre-existing S3 exceptions that the merge makes unused are dropped and listed;
   ones the merge changes are replaced by the `d1-merge` row with the previous limit recorded. The audit re-derives and
   rejects any `d1-merge` row failing (a)–(c) or the formula. Anything else over 250 m is a STOP.
8. **Non-target loops are two-way (lead, after R3c).** `topology.directed_pairs` rides every loop +1 only, an
   assumption from the JR-only edition where Yamanote was the only loop. The approved R2/D3 representation
   (`tokyo-suburban-r2.md` §5: "Only Yamanote is restricted to its target direction; Oedo may be ridden in both
   directions") and the frozen 3,988 count require `toei-oedo-loop` segments in both directions. Only the target
   service (`jr-yamanote`) stays +1-only. The live bundle stays byte-identical (Yamanote is its only loop).
9. **Shared-track review rules (lead, after R3d).** Lead reviewed the 1,323 candidates: only the five Fukutoshin
   和光市–小竹向原 pairs share physical track (compose with owner `metro-yurakucho`, R4). Encode the rest in `review-shared`:
   `boundary-connection` → `keep-independent` (reason `transfer-boundary`); `same-station-pair` whose two pairs have
   disjoint N02 (operator, line) sets → `keep-independent` (reason `distinct-n02-lines`; covers the 48 reviewed cases such as
   JR 中央・総武 vs 南北 市ケ谷–飯田橋, 山手 vs 浅草 新橋–浜松町, 副都心 vs 有楽町 小竹向原–池袋). Anything still
   `needs-lead-review` after these rules is a STOP. The review `status` becomes `reviewed` only with zero open candidates.

---

## TL;DR

- S2/S3を読み取り専用入力として、`data/staging/tokyo-suburban-assembled/` に **135サービス・1,586駅・2,142停車行・3,988有向segment** を構築する。
- D1の凍結対応表だけでIDを統合し、サービス別ホーム・停車順・既存JR geometryを保全する。共有軌道は既存の厳密なcompose／routeで扱う。
- helper実装を先行する専用ランに分離し、以降は約30分以下の固定範囲で進める。公開bundle・ruleset・save・UIの変更はS5/S6へ残す。

## Assembly layout

- 新規ルートを `data/staging/tokyo-suburban-assembled/`（以下A）とする。既存S2/S3ディレクトリへ書き込まない。
- 入力：S0 freeze、そのhash対象catalog/services・R1 catalog・transfer evidence、S2 `combined/overrides` と地域証拠、S3 `handoff-index.json`・全成分override・証拠・gate/audit記録。
- `A/overrides/`：`dataset.json,services.json,stations.csv,expected-catalog.json`、例外CSV、サービス別の既存CSV。サービスの所属元は135件ちょうど一意にする。
- datasetはS2の11都県・bbox・1 m simplify・既存budgetを継承し、`validationProfile:"stage",stageStartStationId:"shimbashi"`、切断免除なし。各サービスの表示／N02事業者と既存scope範囲を明示する。
- `A/identity-map.csv`：`service_id,order,station_id_original,station_id_proposed` の2,142行。`A/station-groups.json`：1,586組の構成員・表示名・aliases・代表サービス・代表自治体・原資料参照。
- `A/service-stop-metadata.csv`：原ID・原名・原自治体・N02照合名／事業者・selectorを停車行単位で保存。実際の照合値は各`stops.csv`にも保持する。
- `A/ui-line-groups.json`：freezeの`representations.uiLineGroups`をそのまま保存する。`toei-oedo`＝大江戸線、loop/radialの2サービスを列挙し、公開schemaは変更しない。
- `A/{inputs-sha256,baseline-sha256,inventory,assembly-report,verification}.json`、`README.md`を保存する。入力・証拠・helper・出力hashと変換差分を追跡する。
- 証拠は`A/evidence/<batch>/pair-evidence.csv`、`A/{length-refs,length-ref-components}.csv`、`A/shared-track-review.json`。build A/Bは`.claude/logs/s4/{a,b}`へ出す。
- S5は監査済み`A/overrides`からproduct用overrideを作り、freezeのruleset設定を適用して再buildする。stage manifestの付け替えは禁止。S6は表示名・停車原名・UI groupを消費する。

## Identity merge

- hash検証した凍結catalogの`station_id_original → station_id_proposed`を唯一の変換規則とする。実データは **1,794元ID → 1,586ゲームID、純減208**。S2は746元ID、S3は1,048元ID。
- 全出現で同じ元IDが同じ先へ写ること、S3 identity-mapとの一致、採用サービス／停車行の完全被覆を検査する。600 m探索やtransfer再推論は実行しない。
- 元IDの複数先、未知ID、異なるD1組の同一出力ID、同一サービス内の重複先ID、異なるJR IDの統合はエラーにする。
- 472 shipped IDと40サービスIDを保全する。freezeの旧停車列が同方向の連続部分列として残り、全135サービスが凍結services CSVの順序・端点・閉路に一致することを独立検査する。
- 代表レコードは、統合先IDと同じ元IDの既存registryを採用する。JR既存駅はS2の代表サービス・座標を保つ。該当レコードなし／重複は自動選択せずエラー。
- 表示名は凍結canonical名を先頭に、異なる`station_name_original`を凍結行順で重複除去して`・`で連結する。aliasesにも全原名を保存する。例：`浜松町・大門`、`後楽園・春日`。
- `stops,scope,line_mapping,sections`の駅ID列、compose legの`from/to`、例外CSVの駅／pair IDを型別に変換する。サービスID・N02 code/group・section key・junction座標は変更しない。
- served scope行の地理値は統合registryへ合わせ、元のホーム側自治体はmetadataへ残す。非採用隣駅は既存値を維持し、scope境界を延長しない。
- outputは1,586 registry駅、2,142個のサービス別platformキー、1,994正方向pair、3,988有向segment。正逆双方で新橋から全駅へ到達することを検査する。

## Shared-track composition

- `shared-track-review.json`はcaseごとに対象pair、資料位置／URL、物理共有かN02代替か、owner、mechanism、line/operator、filter、source section列、両端platform、採否理由を記録する。
- 幾何一致・同じD1端点・直通運転だけではcomposeを採用しない。既存`flatten_recipe`のoperator／line／filter完全一致、exact joint、循環・逆走・途中停車検査を維持する。
- compose候補も、consumerのS2/S3選択ホーム座標とowner anchorの完全一致を要求する。異なる場合は各サービスの既存routeを保持し、共有不可理由を記録する。

| Case | 証拠・固定する機構 |
|---|---|
| 東急目黒線 田園調布–日吉（多摩川以南を含む借用） | R1-PW、S3 selector／pair証拠。東横線とは別軌道のN02代替表現なので、S3の独立routeを維持する。田園調布`004246/004245`の一致は共有根拠にしない。 |
| 大井町線 二子玉川–溝の口 | R1-PWとS3証拠。田園都市線のN02 coverageを借りる独立routeを維持する。二子新地・高津を削除せず、並行線をcomposeしない。 |
| 副都心線 和光市–小竹向原 | R1-SUBの共有記録とS3の5 pair。`metro-yurakucho`をownerとしてpair単位compose。小竹向原はconsumer pin `003294`とowner `003295`の同座標を検査し、南側13号線routeを維持する。 |
| 京成／北総 | R1-EXTRA／exceptions、S3空港証拠。凍結サービス間に重複pairはなく、印旛日本医大で接続する。北総32.3 kmと成田空港線19.1 kmを独立routeで保持し、高砂発サービスを新設しない。 |
| 京成本線／成田空港線 空港2駅間 | S3の別線・別code証拠を保持する。本線`003175/003205`と成田空港線`003174/003204`を共有扱いしない。JR空港支線も独立する。 |
| 南北線／三田線 目黒–白金高輪 | R1-SUBの同一複線・同一ホーム記録とS3の各2 pair。各事業者の厳密routeを維持する。現行composeはownerホームを継承し、隣接routeの他社anchorを拒否するため、cross-operator composeへの置換は行わない。 |
| 横浜Blue 関内 | S3の`004691/004692`・実経路証拠を保持し、1号線／3号線の境界routeを継続する。共有サービスを作らない。 |
| JR既存・S2追加共有 | S2 recipe・section・platformをそのまま継承。上野transfer、湘南新宿代替、倉賀野／高崎／新前橋のownerと注意事項を保持する。 |
| その他のcross-group候補 | 全135サービスの変換後pairとsource section証拠から候補一覧を生成し、並行・交差・境界接続を分類する。京王／小田急、地下鉄並行区間、東急／相鉄・JR／相鉄の境界を自動共有しない。新規採用はcallerの技術レビュー後に専用ラン化する。 |

## Carry-over closure

- S3のoffset例外8行をID変換後に再測定する。代表変更による全2,142ホームのoffsetも再検査し、既存例外の不要化・超過・参照先変化をreportへ列挙する。
- municipality、pair端点、range端点、compose leg、section filter、junctionの利用を全件照合する。Jヴィレッジ・押上は元section key／実頂点の完全一致を再検査する。
- mileage成分の`from/to`は「符号を適用する資料区間の端点」と定義する。サービスの採用端点は`length-refs.csv`に置く。
- 成田空港線の内訳は **＋51.4：京成高砂→成田空港、−32.3：京成高砂→印旛日本医大**。サービス区間は印旛日本医大→成田空港、合計19.1 km。修正はAの正規化コピーだけに行う。
- source class・資料頁・演算・出典連鎖を保持し、JRの二次資料と両毛線の加算根拠も区別する。S2 auditだけを距離証拠の承認根拠にしない。
- S2の295追加pair証拠を再測定値と照合し、全JR 907 pairはS4で完全被覆する。既存・新規lengthRefと内訳を検証する。
- S2/S3 baselineと現liveが違えばpreflightを失敗させる。該当S2/S3ツールで再測定・build・validate・auditし、変更ファイル一覧をcallerが確認してから再開する。
- S4測定はbatch別ファイルへ書き、他batchを上書きしない。統合時に完全被覆・重複ゼロを検査する。S3の成分限定測定による共有CSV置換を再利用しない。
- LFを全staged textで強制し、CRLFを拒否する。hashは読取り正規化前のバイトから算出する。

## Pipeline/helper changes

- 新規`stage_suburban_assembly.py`と専用テストに集約する。既存routing／compositionの許容値・公開schemaは変更しない。
- CLI契約：`preflight,assemble,review-shared,measure-pairs,check-evidence,gate,audit,handoff`。全て`--root`対応、測定／証拠確認は`--batch`必須、gateは`--out-dir`、auditは`--data-dir`必須。
- preflightはS3 handoffの検証ロジックを書込みなしで利用する。必要なら`stage_suburban_nonjr.py`でreport生成と保存を分離し、既存CLI挙動を保つ。S2/S3成果物は再生成しない。
- assembleはtyped ID変換・natural key衝突拒否・入力hash記録・oracle生成を行う。oracleは凍結CSVから独立生成する。再実行は入力一致時だけ同一内容を許す。
- 測定はrouteの独立計測、composeのultimate owner展開・exact chainを扱い、platformとtrack anchorを別記録する。override/raw/recipe/filter/距離資料hashを証拠へ結び付ける。
- gateは通常build A/B・両方validate・出力比較・証拠照合を必須化する。audit/handoffは証拠改変・未測定・stale入力／出力・欠落batchを拒否し、監査で期待値を書き直さない。

## Runs

各ランは約30分上限。時間切れは同じ所有範囲で継続し、未完を成功扱いしない。以下の新CLIはR0–R2で追加する契約である。

```bash
s4() { uv run python -m scripts.data_pipeline.stage_suburban_assembly "$@"; }
s4batch() { s4 measure-pairs --batch "$1" && s4 check-evidence --batch "$1"; }
```

| Run／依存 | ファイル・手順・テスト・受入コマンド |
|---|---|
| R0・直列 | helper preflightとS3検証／保存分離、`test_suburban_assembly_inputs.py`。入力hash、stale索引、距離CSV改変、LF、baseline不一致の拒否。`uv run pytest tests/data_pipeline/test_suburban_assembly_inputs.py tests/data_pipeline/test_staging_nonjr_inventory.py -q -rs` |
| R1・R0後 | helper assembly、`test_suburban_assembly_identity.py`。全typed変換・表示／scope metadata・oracle・衝突拒否。`uv run pytest tests/data_pipeline/test_suburban_assembly_identity.py tests/data_pipeline/test_multi_operator.py tests/data_pipeline/test_suburban_scope.py -q -rs` |
| R2a・R1後 | helper測定、`test_suburban_assembly_evidence.py`。batch保存、route／compose証拠、改変・未被覆拒否。`uv run pytest tests/data_pipeline/test_suburban_assembly_evidence.py tests/data_pipeline/test_composition_review.py -q -rs` |
| R2b・R2a後 | helper gate/audit/handoff、`test_suburban_assembly_gate.py`、`data/README.md`。A/B・platform保全・監査非書込みテスト。`uv run pytest tests/data_pipeline/test_suburban_assembly_gate.py tests/data_pipeline/test_stage_profile.py -q -rs` |
| R3・直列 | Aの初回生成・距離内訳正規化・共有候補表。`s4 preflight && s4 assemble && s4 review-shared`。1,794→1,586、135/2142/1994/3988、共有候補の全件分類をcallerが確認する。 |
| R4・R3後 | Aの副都心線recipeと`test_suburban_assembly_shared.py`のみ。上表どおり適用し、reverse・小竹境界・別事業者／別線／別filter拒否を固定。`uv run pytest tests/data_pipeline/test_suburban_assembly_shared.py -q -rs` |
| R5a/R5b・並列可 | 証拠`jr-core`＝freezeのshipped40サービス、`jr-new`＝残り15。各所有batchのみ。`s4batch jr-core`／`s4batch jr-new`。907 JR pairを分割完全被覆。 |
| R6・並列可 | S3の8group名をbatch名に使用し、1groupにつき1ラン。各担当`A/evidence/<group>/`だけを書き、`s4batch GROUP`。合計1,087 pairを被覆する。 |
| R7・全batch後、直列 | `test_suburban_assembly_network.py`、A全体の最終証拠。`s4 gate --out-dir .claude/logs/s4`、`s4 audit --data-dir .claude/logs/s4`。両buildで全駅双方向到達、旧geometry/platform、全サービスホーム保全を検査する。 |
| R8・直列 | A README・verification・handoff、計画handoffのS4行。`s4 handoff --data-dir .claude/logs/s4`と以下を実行。成功ログ・hash・差分をcallerが独立確認する。 |

並列可は読取り共通入力＋専有証拠のみ。索引更新・override編集・helper変更は禁止し、実行環境の編集追跡が競合する場合は直列化する。全rawテストのskipは未完了。

```bash
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
sha256sum -c data/n02-2025.sha256
uv run ruff check scripts/data_pipeline tests/data_pipeline
uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
diff -r .claude/logs/s4/a .claude/logs/s4/b
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s4/live --quiet
diff -r public/data .claude/logs/s4/live
git diff --exit-code -- public/data data/overrides data/staging/tokyo-suburban-jr data/staging/tokyo-suburban-nonjr N02-25_GML src
```

## Risks

- D1統合で代表駅が変わると、S3で通ったoffset・scopeが失敗し得る。ID統合を取り消さず、測定証拠をcallerへ返す。許容値を自動拡大しない。
- cross-operator composeの強制はホーム取得元を変える。南北／三田は独立routeで保全し、primitive共通化のために検証規則を緩和しない。
- 新規経路・例外・budget超過は技術上の未解決事項として停止・報告する。サービス削減、人工connector、cap拡大で通さない。
- 本回答は読取りによる計画であり、統合build・全pair再測定・性能検証は未実施。最終bundle、save互換性、UI性能はS5–S7の受入対象である。

## Decisions needing the user

none。D1–D4と凍結範囲を維持する。追加の経路／例外判断はcallerの技術レビュー対象とし、Lunaに商品判断を委ねない。
