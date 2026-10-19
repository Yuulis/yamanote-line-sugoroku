# S3 implementation plan (Codex Sol low, 2026-10-17)

Source: Codex run `20261017T015016Z-s3-plan` (read-only). Lead-reviewed; no user decisions required. Lead adjustments: (1) parallel group runs share one workspace with strict per-group file ownership (worked in S2) instead of separate worktrees; the lead verifies after both finish. (2) E and B of a group run in one Luna run; the run stops for lead review only when it needs a new route recipe, junction, or exception not already listed below. Order: R0 (R0a+R0b) → waves 1–4 (two groups each, parallel) → Rfinal.

## TL;DR

- S3は **非JR 80サービス・1,166停車行・1,087正方向pair・2,174有向segment**。8事業者グループで作成し、同時実行は最大2ランとする。
- 最初にS2 helperを共通化し、その後はデータと専用テストだけを編集する。S4の事業者間identity統合は取り込まない。
- 全線の実routingは本計画では未実施。以下の証拠準備・境界検証を実装の前提gateとし、不明経路をLunaの判断で補完させない。

## Staging layout

- 新規ルートは `data/staging/tokyo-suburban-nonjr/<group>/`。グループ名は `metro,toei-yokohama,tobu,seibu,keisei-hokuso-tx,tokyu-mm,keio-odakyu,keikyu-sotetsu`。
- 各グループに `README.md,inventory.json,identity-map.csv,pair-evidence.csv,length-refs.csv,length-ref-components.csv,baseline-sha256.json,verification.json` を置く。
- **実ビルド単位は事業者ごとの接続成分**：`<group>/components/<component-id>/overrides/`。異なる事業者を同じ成分にしない。事業者内でも東武本線系／東上系、西武多摩川線などの分離を保持する。
- 成分はR1の事業者内identityと停車列から機械的に算出し、IDは所属サービス中の辞書順最小ID。全サービスを分割せず、各サービスは必ず1成分に所属する。
- これにより既存の全駅双方向到達性検査を維持できる。`reviewedDisconnectedServiceIds`で未到達を免除したり、JR・他社を追加して接続させたりしない。
- override構成は既存の `dataset.json,services.json,stations.csv,expected-catalog.json`、サービス別 `stops.csv,scope.csv,line_mapping.csv,sections.csv`。例外CSVと`junctions.csv`はレビュー済みの場合だけ追加する。
- datasetは `validationProfile:"stage"`、gameplay start/targetなし、`stageStartStationId`は成分内で凍結サービス順が最初のサービスの先頭駅。`schemaVersion:"3-stage"`を維持する。
- datasetの表示／N02事業者は下表の値。全serviceにも`operator,n02Operator`を明示する。areaは担当停車行に現れる都県集合、bboxはS2の出力・探索範囲、simplifyは1 m、budgetは`capital-region`を使用する。
- station IDは凍結catalogの **`station_id_original`**、原名は`station_name_original`を使用。`station_id_proposed`への対応を`identity-map.csv`に保存し、D1統合を先取りしない。
- 同事業者のR1共有IDは維持する。代表サービスは凍結サービス順の最初の所属サービス。registryの自治体はその代表行から採用し、各stopの照合名・取得元は独立させる。
- stopsには`original_name,n02_name,n02_operator,platform_selector`を明示。selectorは実N02のline/group/codeで固定し、境界で複数lineを許可する場合も対象を列挙する。
- oracleはhash検証済み凍結catalog/servicesから独立生成し、上記ID変換だけ適用する。overrideやbuild結果から逆生成しない。
- 色はS2同様のstaging暫定`#808080`、名前・kind・circular・endpoint kindは凍結値、方向名は両端駅、駅番号は凍結行を順序付きsequenceとして固定する。
- S4はinventoryとidentity-mapを使い、JR combinedと各成分のoverrideを統合してD1を適用する。S5はgameplay設定を復元して新規ビルドする。stage成果物のmanifest差替えは禁止。

## Service inventory

以下は`service suffix 停車数/正方向pair数`。prefix省略は表中に明記し、N02線名はサービス列と同順。`*`は複数線名を明示する境界。

| Group：サービス／停車／pair | 表示事業者 → N02事業者 | サービスと停車数／pair数 | N02線名 |
|---|---|---|---|
| metro：10／186／176 | 東京地下鉄 → 東京地下鉄 | `metro-`：ginza 19/18, marunouchi 25/24, marunouchi-honancho 4/3, hibiya 22/21, tozai 23/22, chiyoda 20/19, yurakucho 24/23, hanzomon 14/13, namboku 19/18, fukutoshin 16/15 | 3号線銀座線、4号線丸ノ内線、4号線丸ノ内線分岐線、2号線日比谷線、5号線東西線、9号線千代田線、8号線有楽町線、11号線半蔵門線、7号線南北線、8号線有楽町線＋13号線副都心線* |
| toei-yokohama：都営5／107／103 | 東京都交通局 → **東京都** | `toei-`：asakusa 20/19, mita 27/26, shinjuku 21/20, oedo-loop 28/28, oedo-radial 11/10 | 1号線浅草線、6号線三田線、10号線新宿線、12号線大江戸線、12号線大江戸線 |
| 同：横浜2／42／40 | 横浜市交通局 → **横浜市** | `yokohama-blue` 32/31, `yokohama-green` 10/9 | 1号線＋3号線*、4号線 |
| tobu：14／219／205 | 東武鉄道 → 東武鉄道 | `tobu-`：isesaki 54/53, nikko 26/25, kinugawa 9/8, utsunomiya 11/10, sano 10/9, kiryu 8/7, koizumi 7/6, koizumi-ota 3/2, kameido 5/4, daishi 2/1, urban-park 35/34, tojo 39/38, ogose 8/7, oshiage 2/1 | 伊勢崎線、日光線、鬼怒川線、宇都宮線、佐野線、桐生線、小泉線、小泉線、亀戸線、大師線、野田線、東上本線、越生線、伊勢崎線 |
| seibu：12／105／93 | 西武鉄道 → 西武鉄道 | `seibu-`：ikebukuro 31/30, chichibu 6/5, yurakucho 3/2, toshima 2/1, sayama 3/2, yamaguchi 3/2, shinjuku 29/28, haijima 8/7, tamako 7/6, kokubunji 5/4, seibuen 2/1, tamagawa 6/5 | 池袋線、西武秩父線、西武有楽町線、豊島線、狭山線、山口線、新宿線、拝島線、多摩湖線、国分寺線、西武園線、多摩川線 |
| keisei-hokuso-tx：京成8／97／89 | 京成電鉄 → 京成電鉄 | `keisei-`：main 42/41, oshiage 6/5, kanamachi 3/2, chiba 10/9, chihara 6/5, higashi-narita 2/1, matsudo 24/23, narita-airport-access 4/3 | 本線、押上線、金町線、千葉線、千原線、東成田線、松戸線、成田空港線 |
| 同：北総1／15／14、TX1／20／19 | 北総鉄道 → 北総鉄道；首都圏新都市鉄道 → 首都圏新都市鉄道 | `hokuso-main` 15/14；`tx` 20/19 | 北総線；常磐新線 |
| tokyu-mm：東急9／117／108 | 東急電鉄 → 東急電鉄 | `tokyu-`：toyoko 21/20, meguro 13/12, shin-yokohama 3/2, den-en-toshi 27/26, oimachi 18/17, ikegami 15/14, tamagawa 7/6, setagaya 10/9, kodomonokuni 3/2 | 東横線、目黒線＋東横線*、東急新横浜線、田園都市線、大井町線＋田園都市線*、池上線、東急多摩川線、世田谷線、こどもの国線 |
| 同：MM1／6／5 | 横浜高速鉄道 → 横浜高速鉄道 | `mm-minatomirai` 6/5 | みなとみらい21線 |
| keio-odakyu：京王6／74／68 | 京王電鉄 → 京王電鉄 | `keio-`：main 34/33, sagamihara 12/11, takao 7/6, keibajo 2/1, dobutsuen 2/1, inokashira 17/16 | 京王線、相模原線、高尾線、競馬場線、動物園線、井の頭線 |
| 同：小田急3／72／69 | 小田急電鉄 → 小田急電鉄 | `odakyu-`：odawara 47/46, enoshima 17/16, tama 8/7 | 小田原線、江ノ島線、多摩線 |
| keikyu-sotetsu：京急5／77／72 | 京浜急行電鉄 → 京浜急行電鉄 | `keikyu-`：main 50/49, airport 7/6, daishi 7/6, zushi 4/3, kurihama 9/8 | 本線、空港線、大師線、逗子線、久里浜線 |
| 同：相鉄3／29／26 | 相模鉄道 → 相模鉄道 | `sotetsu-`：main 18/17, izumino 8/7, shin-yokohama 3/2 | 相鉄本線、相鉄いずみ野線、相鉄新横浜線 |

グループ合計は順に `10/186/176,7/149/143,14/219/205,12/105/93,10/132/122,10/123/113,9/146/137,8/106/98`。大江戸loopの閉路pairを必ず含める。

## Known geometry problems

- **東急目黒線**：R1-PWに従い田園調布以北は目黒線、多摩川以南は東横線取得とする。境界は田園調布まで検証する。rawでは田園調布の目黒線`004246`／東横線`004245`はgroup`004245`、midpointが完全一致。各pairを独立routeし、東横線サービスのprimitiveをcomposeしない。N02の代表表現である旨を証拠に残す。
- **大井町線**：二子玉川まで大井町線、二子新地・高津・溝の口は田園都市線取得。二子玉川`004177`／`004178`はgroup`004177`、midpoint完全一致。青各停が二子新地・高津を含む凍結列を維持し、同座標だけを共有証拠にしない。初期S3は独立routeとする。
- **副都心線**：和光市–小竹向原は8号線有楽町線、小竹向原以南は13号線副都心線。小竹向原`003295`／`003294`はgroup`003294`、midpoint完全一致。千川・要町・池袋で有楽町線に流れないよう13号線の明示制約と実経路証拠を固定する。
- **横浜Blue**：湘南台–関内は1号線、関内–あざみ野は3号線。関内`004691`／`004692`はgroup`004691`、midpoint完全一致。両側の線路接続をrawで別途検証し、駅代表点一致だけで受け入れない。
- 上記境界のselectorは指定2コード／2線だけを許可する。連続routingが失敗した場合、完全一致する実線路jointを証明できたroute recipeだけを使う。証明不能なら失敗として返し、transfer例外やconnectorで埋めない。
- **京成空港側**：本線の空港第2ビル`003175`・成田空港`003205`と、成田空港線の`003174`・`003204`を区別する。成田空港線は印旛日本医大`003125`→成田湯川`003093`→空港2駅の4駅だけ。各到着経路のsectionと線名を証拠化する。
- **範囲の誤読防止**：北総線自体と上記4駅サービスは凍結対象。追加の京成高砂発Sky Accessサービス、芝山鉄道、その他の直通先を追加しない。京成高砂・印旛日本医大の北総／京成identityはS4まで別にする。
- **大江戸線**：28駅loop＋11駅radial、共通IDは都庁前。新宿→都庁前の閉路と都庁前→西新宿五丁目を別pairとして検査。UI group`toei-oedo`はhandoff metadataに保持し、公開schema/UIは変更しない。
- **西武山口線**：AGTも通常サービスとして含め、`西武鉄道/山口線`で2pairをroute。多摩湖`003202`と西武球場前`003182`を使用し、隣接する多摩湖線／狭山線のホームで代用しない。
- **京王新線**：初台・幡ヶ谷を通る凍結列を維持。N02「京王線」の新宿同コード複数geometryはcodeだけで一意にならないため、経路・section証拠で新線側を限定する。
- **表記・分類差**：江曽島は`n02_name:"江曾島"`。笹塚の互換漢字、ケ／ヶは既存normalizerを使用。野田線・常磐新線・松戸線・みなとみらい21線を正式なN02取得名として固定する。
- R1は上記東急の欠落表現以外に対象線・駅の欠落を報告していない。ただし全pairの接続保証ではない。新たな欠落・誤ラベルは証拠付き失敗として返し、他社fallbackは禁止する。
- 三軒茶屋、蔵前、新宿などの事業者内共有IDは維持する。代表ホームoffset超過は個別に測定し、根拠と対象service/stopをレビューするまで例外を投入しない。

## Pipeline/helper changes

- **R0a、専用ラン**：`stage_suburban_jr.py`からfreeze/hash、CSV、baseline、stop解決、pair測定の共通部分を`stage_suburban_support.py`へ抽出。旧CLI・import入口・JR出力を維持し、JR固有のseed/assemble規則は残す。
- **R0b、専用ラン**：同helperに`--operator-group` dispatchを追加し、非JR処理を`stage_suburban_nonjr.py`へ実装。`seed,measure-pairs,gate,audit,handoff`を提供する。下記CLIはこのランで追加する契約であり、現在は存在しない。
- 測定は`station_pairs`を使用してloop閉路にも対応。pair証拠は実buildで選ばれた両端platform・route leg別operator/line・section key列・距離・snap・filter/recipe hashを記録し、独立測定との相違を拒否する。
- `gate`は全成分に通常build A/B、`diff`、通常validate、証拠auditを実行する。出力は指定`--out-dir/<component-id>/{a,b}`。skip、未測定pair、未解決例外を成功扱いしない。
- lengthRefは**全80件を一次資料由来の営業キロ**にする。`length-ref-components.csv`にsource URL、資料名・頁／表、区間、加減算、値を保存し、service合計と対応させる。build距離やN02合計をreferenceにしない。
- 一次資料はR1出典の事業者路線概要・FACT BOOK・公式営業キロ／運賃距離表を使う。大江戸loop/radial、支線、境界部分は公式区間値の加減算を明記する。距離を記載しない駅一覧だけでは受け入れない。
- `lengthRef.toleranceKm`とN02 pair-sum差は既存S2の **1.5 km** を上限とする。超過時は経路・区間計算を調査し、referenceや許容値を自動調整しない。
- auditは現在のprotected treeとbaseline hashを比較し、証拠CSVのpair完全被覆・override/raw hash・実出力との一致も検査する。READMEの成功記述は実検証ログへの参照に限定する。
- pipelineの距離・wrong-track・joint・offset検証は変更しない。追加の機能変更が必要なら地域ランを停止し、専用ランと回帰検証を終えてから再開する。

## Runs

全ランは約30分上限。R0a→R0bを直列実行後、各グループを **E（証拠・入力固定）→B（実ビルド）** の2ランに分ける。長いグループは同一担当の継続ランとし、未完を完了報告しない。

```bash
# R0a acceptance: shared extraction must preserve JR behavior.
uv run pytest tests/data_pipeline/test_suburban_stage_support.py tests/data_pipeline/test_suburban_stage_measure_raw.py tests/data_pipeline/test_staging_suburban_combined.py -q -rs
# R0b acceptance: new group/component/evidence support and unchanged validators.
uv run pytest tests/data_pipeline/test_nonjr_stage_support.py tests/data_pipeline/test_stage_profile.py tests/data_pipeline/test_operator_routing.py tests/data_pipeline/test_range_section_filters.py tests/data_pipeline/test_reviewed_junctions.py -q -rs
```

- R0a files：`stage_suburban_jr.py,stage_suburban_support.py`と対応既存テストのみ。R0b files：同helper、`stage_suburban_nonjr.py`、`test_nonjr_stage_support.py`、`data/README.md`。成分分割、閉路、改ざん証拠、他社候補、stale baselineの拒否テストを追加する。
- **E(group)** files：担当group内の全入力・証拠、`tests/data_pipeline/test_staging_nonjr_<group_underscored>.py`のみ。seed→一次距離資料採録→明示selectorとpair mapping→measure→失敗箇所の証拠提出。既知境界以外は凍結N02 lineの単一路線routeを初期値とする。
- E受入：全stop/order/endpoint/source一致、全pair測定、80件の担当分lengthRefと計算内訳、未承認例外ゼロ。新たな経路・例外の判断はcallerが証拠レビューし、Lunaは推測で採用しない。
- **B(group)** files：同担当groupと専用テストのみ。確定入力で全サービスを連続routingし、境界・分岐・閉路・誤operator/line拒否回帰を固定し、次の共通gateを実行する。

```bash
s3e() {
  uv run python -m scripts.data_pipeline.stage_suburban_jr seed --operator-group "$1" &&
  uv run python -m scripts.data_pipeline.stage_suburban_jr measure-pairs --operator-group "$1"
}
s3gate() {
  local group="$1"
  local test_group="${group//-/_}"
  uv run pytest "tests/data_pipeline/test_staging_nonjr_${test_group}.py" -q -rs &&
  uv run python -m scripts.data_pipeline.stage_suburban_jr gate --operator-group "$group" --out-dir ".claude/logs/s3/$group" &&
  uv run python -m scripts.data_pipeline.stage_suburban_jr audit --operator-group "$group" --data-dir ".claude/logs/s3/$group"
}
```

- `s3e GROUP`は初回だけ実行する。seedは既存groupへの上書きを拒否し、継続ランは既存入力を編集して`measure-pairs --operator-group GROUP`から再開する。
- **Wave 1並列可**：`metro`／`toei-yokohama`。Eは`s3e GROUP`、Bは`s3gate GROUP`。Metroは副都心境界と千代田20駅、都営側はloop閉路・radial共有駅、横浜は関内両側を必須回帰にする。
- **Wave 2並列可**：`tobu`／`seibu`。同コマンド。東武は江曾島・小泉分岐・押上2駅、西武は山口AGT2pair・多摩川線独立成分を必須回帰にする。
- **Wave 3並列可**：`keisei-hokuso-tx`／`tokyu-mm`。同コマンド。前者は空港別線別コード・北総境界・常磐新線、後者は東急2代替区間・新横浜・三軒茶屋identityを必須回帰にする。
- **Wave 4並列可**：`keio-odakyu`／`keikyu-sotetsu`。同コマンド。前者は新線経由・藤沢前後、後者は泉岳寺取得元・久里浜9駅・羽沢横浜国大／新横浜を必須回帰にする。
- 並列実行は独立worktreeで最大2本。共有helper変更は禁止し、取り込みは直列。wrapperの全tree編集追跡が混ざる同一workspace内の並列書込みは行わない。
- **Rfinal、直列**：全groupのhandoff索引と`test_staging_nonjr_inventory.py`だけを追加。80/1166/1087/2174、担当重複／欠落ゼロ、R1 identity維持、S4変換表完全被覆を検査する。事業者間identityの統合ビルドは行わない。

```bash
uv run python -m scripts.data_pipeline.stage_suburban_jr handoff
uv run pytest tests/data_pipeline/test_staging_nonjr_inventory.py -q -rs
sha256sum -c data/n02-2025.sha256
uv run ruff check scripts/data_pipeline tests/data_pipeline
uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s3/live --quiet
diff -r public/data .claude/logs/s3/live
git diff --exit-code -- public/data data/overrides data/staging/tokyo-suburban-jr N02-25_GML src
```

## Risks

- 全1,087pairの連続routing、一次資料80件の距離確定、未知のsection問題は未検証。30分で終わらないE/Bは担当範囲を変えず継続し、未解決箇所を明示する。
- 今回確認した境界4駅のmidpoint完全一致は、経路の連続性や物理的共有の証明ではない。実build・section列・wrong-track検査がすべて必要。
- S2レビューの持越しは、一次資料の計算内訳、baselineの現況比較、証拠CSVの鮮度検査、ログに基づく成功表示として本計画に反映した。既存JR stagingは編集しない。
- 本計画タスクではファイル変更・テスト・全線buildを実行していない。実施したのは指定資料の読取り、凍結inventory集計、実N02の名前・境界コード・4駅の代表点照合。

## Decisions needing the user

none。S0の対象・D3表現を維持する。新たなgeometry欠落は実装上の証拠不足としてcallerへ返し、商品範囲の縮小や接続方式の変更で解決しない。
