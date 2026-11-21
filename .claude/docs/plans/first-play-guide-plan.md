# First-play guide (#67) + remove おまかせ (#113): implementation plan

## Summary

#113 のおまかせ削除を最初に完了し、続いて操作ラベル、初回判定、3ステップのコーチ、取得演出終了後の公開済みイベントに基づく5種類のヒントを追加する。エンジン、RNG、保存形式、公開データ、edition registry は変更しない。

根拠資料：

- `.claude/docs/research/feature-first-play-guide-brief.md`
- `.claude/logs/codex/20261120T060000Z-first-play-arch.md`
- `.claude/logs/codex/20261120T060707Z-first-play-validate.md`
- `.claude/docs/research/feature-first-play-guide-codebase.md`
- `.claude/docs/plans/rules-guide-title-save-plan.md`

Implementer: Codex Luna xhigh by default (user-authorised); a step whose judgment exceeds the spec escalates to Sol; Sol low reviews; the lead verifies, commits, pushes and checks CI per step.

Luna xhigh の既定利用は、2026-11-09 のユーザーによる明示承認に基づく。今回の計画作成・レビューの Codex lane は Sol low、read-only とする。

COMPLEX として、13ステップを順番に実施する。`visible: yes` はプレイヤーに見える変更があり、画面確認の区切りになる。各ステップでは先に関連テストを追加・更新し、実装後に共通受入コマンドと対象チェックを実行する。未接続の基盤・ビューは製品画面に露出させず、各ステップを独立して green にする。

本書は読み取り専用の計画成果物。ファイル変更、実装、テスト実行は行っていない。各ステップの green は受入条件であり、現時点で成功確認済みという意味ではない。

**共通受入コマンド G：全ステップ必須**

```bash
npm run typecheck
git diff --check
npm test
npm run build
```

`lint` は未構成のため受入コマンドに含めない。`git diff --check` は差分の空白検査であり、lint の代替ではない。linter の新規導入は本機能のスコープ外とする。

## Revision 2 changes

- 全ヒント候補の公開境界を `resultPublished` に統一し、pickup 中の抽選系ヒントも公開しない。
- 表示済みカードの modal／hidden 中の退避、詳細からの復帰、`showClear` 時の破棄を明文化した。
- `started` の記録時点、storage 失敗時の起動中メモリ、表示世代に結合した acknowledgement と取消条件を追加した。
- direction-only 抽選、現在路線の候補除外、方向1つ、距離同値、逆方向偏重に対応する本文を定義した。
- おまかせ専用 suite のケース移植、#60／#68 と DESIGN rows 244／262／272 の回帰確認を各ステップへ割り当てた。
- S3 を `visible: yes` に修正した。13ステップの順序、Brief のユーザー決定、ユーザー承認済み Luna xhigh の実装方針を維持した。

## Revision 3 changes (lead, user 2026-11-20)

- `off-target` は1文「{target}以外の路線では、{target}に近づく向きが抽選で出やすくなっています。」だけにした。variant `off-target-neutral` / `-single-direction` / `-equal-distance` / `-away-weighted` は廃止。本文中の他の箇所でこれらの variant に触れている記述は、この節が優先する。
- `off-target` の候補条件：公開された着地が目標路線外、進める向きが2つ、目標までの距離が異なる、`towardTargetWeight > awayFromTargetWeight`（config 解決値）。満たさない着地では候補を作らず、満たす後の着地まで未読のまま待つ。細かい条件は「詳しく」（`lottery` 節）に任せる。
- 進め方：毎ステップ後に止めてユーザー確認（user 2026-11-20）。実装は Codex Luna xhigh、Sol low レビュー、リードが検証・commit・push・CI 確認。

## Verified copy

以下は表示本文の確定案。`{target}`、`{start}` は既存 presentation resolver と config から解決する。variant は5種類の hint ID の本文差分であり、既読 ID は増やさない。

**抽選の根拠の整理：** `.claude/docs/DESIGN.md:195` の2026-10-13決定は山手線1/2・方向2:1。一方、現行東京近郊アイテム版は `src/features/game/gameConfig.ts:48,50` により1/2・3:2で、`docs/manual/tokyo-suburban/rules.md:3` と一致する。クラシック設定は `gameConfig.ts:23,25` の2/3・2:1。今回これらの値は変更しない。

| id / variant | final text | rules section id | evidence |
|---|---|---|---|
| `coach-dice` | サイコロを振ると、出た目の数だけ駅を進みます。 | `goal` | `rulesGuide.ts:134` |
| `coach-progress` | 踏破区間のバーを埋めて、{target}の全区間をめぐりましょう。 | `goal` | `rulesGuide.ts:135` |
| `coach-map-yamanote` | サイコロと抽選まかせで、山手線を一周して新橋へ。 | `goal` | `index.html:33`、`rulesGuide.ts:135` |
| `coach-map-other` | {target}の全区間をめぐって、{start}を目指しましょう。 | `goal` | `rulesGuide.ts:120–125,135` |
| `lottery-service` | 乗換駅で移動を終えると、候補の中から次に乗る路線を抽選します。 | `lottery` | `engine/landing.ts:130–183` |
| `lottery-direction` | 移動を終えた駅で、次に進む向きを抽選します。 | `lottery` | `engine/landing.ts:10–13,198–205` |
| `lottery-service-direction` | 乗換駅で移動を終えると、候補の中から次に乗る路線と進む向きを抽選します。 | `lottery` | `engine/landing.ts:130–205` |
| `off-target` | {target}以外の路線では、{target}に近づく向きが抽選で出やすくなっています。 | `lottery` | `engine/landing.ts:104–116`、`gameConfig.ts:50` |
| `item` | アイテムを手に入れました。使うタイミングは、持ち物の説明で確認できます。 | `items` | `toastQueue.ts:69–71`、`itemPresentation.ts:68–71`、`rulesGuide.ts:181–189` |
| `item-pending-discard` | 持ち物がいっぱいのときは、持っているものと新しいものから、捨てるものを1つ選びます。 | `items` | `rulesGuide.ts:202` |
| `harmful-item` | 不利なアイテムは持ち物には入らず、それぞれ決まったタイミングで自動で効きます。 | `items` | `rulesGuide.ts:161–163,199`、`engine/items.ts:73–103` |
| `harmful-item-cancelled` | 遅延証明書が、不利なアイテムを打ち消しました。 | `items` | `engine/items.ts:62–69`、`toastQueue.ts:76–77` |
| `terminus` | 終点に着くと、出目が余っていてもそこで止まります。 | `goal` | `rulesGuide.ts:137`、`engine/movement.ts:78–90` |
| `skip-label` | 演出をスキップ | `controls` | `rulesGuide.ts:146`、`components/RollAdjustment.tsx:91` |
| `skip-help` | 「演出をスキップ」で、移動の演出を飛ばせます。 | `controls` | `rulesGuide.ts:146` |
| `shortcut-help` | Space / Enter：サイコロを振る　S / Escape：演出をスキップ | `controls` | `rulesGuide.ts:66–69` |
| `adjustment-escape` | Escapeキーでも「そのまま」で続けます。 | `controls` | `components/RollAdjustment.tsx:50–53,86` |
| `adjustment-caution` | 出目を見た後はターンを取り消せません。 | `controls` | `components/RollAdjustment.tsx:86` |

上表の省略パスは `src/features/game/` 配下を指す。

適用条件：

- `lottery` は実際に行われた抽選の種類に応じ、service-only、direction-only、両方の variant を使う。非乗換駅の direction-only に乗換駅や路線抽選の説明を出さない。
- 「いまの路線も含めて」は無条件に使用しない。迂回・運休で現在路線が候補から除外される場合も、上記の「候補の中から」で成立させる。候補フィルタや抽選処理は変更しない。
- `off-target` は1文だけ（Revision 3）。公開された着地が目標路線外で、進める向きが2つあり、目標までの距離が異なり、実際の config 解決値で `towardTargetWeight > awayFromTargetWeight` のときだけ候補にする。条件を満たさない着地では候補を作らず、ID は未読のまま、条件を満たす後の着地で出す。
- 当該公開イベントに基づく方向数・距離関係・抽選種類の判定は presentation 層で行い、カードや hook が未公開の engine record を読まない。
- 有利アイテム全般を「振る前に使える」とは書かない。出目調整券は出目を見てから、遅延証明書は所持だけで働く。
- 不利アイテム取得と効果発動を区別する。遅延は予約され、運休は期限付き状態になる。既存 toast の取得通知は変更しない。
- `terminus` は `stopReason === "endpoint"`、`endpointKind === "terminus"`、`unusedPips > 0` の場合だけ。範囲端・系統境界は対象外。
- `item-pending-discard` は `item`、`harmful-item-cancelled` は `harmful-item` の variant。抽選・方向の各 variant も元の `lottery`／`off-target` ID を共有する。
- コーチ操作は「前へ」「次へ」「とばす」、最終完了は「はじめる」。ヒント操作は「閉じる」「もう表示しない」「詳しく」。再表示操作は「最初のガイドをもう一度見る」。

## Implementation Steps

### Step 1 — おまかせを完全に削除する（#113）

- **id:** `S1`
- **visible:** yes
- **goal:** おまかせの UI、実行経路、専用説明を削除し、手動操作だけで従来のゲームが成立する状態にする。このステップ単独で #113 を完結させる。

**File changes**

| change type | files | work |
|---|---|---|
| delete | `src/features/game/autoRoll.ts`、`useAutoRoll.ts` | 自動実行モデルと hook を削除 |
| modify | `components/GamePanel.tsx` | hook、toggle、専用 announcement を除去。手動 roll の guard と draft 適用を保持 |
| modify | `components/GameHud.tsx`、`src/styles.css` | toggle props/button と専用 selector を削除し、phone action row を2列にする |
| modify | `rulesGuide.ts` | おまかせ説明を削除 |
| delete/update | おまかせ専用 unit/E2E、`tests/e2e/support/autoRoll.ts` | 下記ケース移植表を確定してから専用 suite/helper を削除 |
| modify | `tests/e2e/support/turnResult.ts`、`turn-result-card.spec.ts`、`first-turn-notice.spec.ts` | 自動 roll を明示的な手動 roll に置換 |
| modify | `game-hud`、`hud-progress-components`、`turn-moment-components`、`rules-entry-points`、`rules-guide` の unit、`hud-layout.spec.ts`、`ui-pop.spec.ts` | 廃止 props、ボタン数、説明、tab 順を更新 |
| modify, lead | `.claude/docs/DESIGN.md` | shared writer で関連決定の supersede を記録 |

`GameSettings` におまかせフィールドはなく、専用 shortcut もない。旧 JSON の未知フィールドを無視する既存 parser/writer を利用し、settings key/version や起動時 migration は追加しない。

手動 `requestRoll` は dice と Space/Enter で共有する。最新の `canRoll` と session／turn／decision revision を確認し、同じ ready 状態への二重 dispatch を防ぐ。非 ready 時は未処理キーを消費せず、受理した操作では既存 draft を適用する。同じ turn でも新しい decision revision の正当な操作を拒否しない。

**削除前に確定するケース移植表**

削除する各 suite の各 test case を、下表の分類・移植先または既存の同等 test 名へ対応付けて lead のレビュー記録に残す。「既存で同等検証済み」は具体的な test 名と assertion を示す。

| source | case class | destination / disposition |
|---|---|---|
| `auto-roll.test.ts`、`use-auto-roll.test.ts` | toggle、timer、1200ms 間隔、自動停止・再開 | 廃止専用として削除 |
| 同上、`game-app-auto-roll.test.ts` | 同一 ready 二重 dispatch、次の ready、draft 適用、decision revision | `game-shortcuts.test.ts` と mounted GameApp の手動操作テストへ移植 |
| `auto-roll-announcements.test.ts`、`game-app-auto-roll.test.ts` | 通常本文と公開境界 | `game-app-turn-moments.test.ts`／`turn-moment-presentation.test.ts` へ移植または同等 assertion を特定 |
| `auto-roll-decisions.spec.ts`、`auto-roll-lifecycle.spec.ts` | adjust/discard 中の単一 status 所有、Escape、focus、未公開結果の抑制 | 手動進行の `ui-pop-turn-moments.spec.ts`／`accessibility.spec.ts` へ移植または既存ケースを特定 |
| `auto-roll.spec.ts` 等 | 自動化固有の進行 | 廃止専用として削除。共通操作の assertion は上記へ移植 |
| `turn-result-card.spec.ts`、`support/turnResult.ts` | 連続ターンの結果カード | 手動 roll fixture へ置換 |
| `first-turn-notice.spec.ts` | #68 とターン読み上げの調停 | 通常の手動ターンで完結させる。未実装の hint には依存させない |

**Tests to add/update first**

- クリック・Space/Enter 連打でも同じ ready 状態の roll は1回だけ。次の ready と新しい decision revision では操作できる。
- 非 ready 時の key 非消費、draft の適用。
- ボタン・ルールにおまかせがなく、待機だけではターンが進まない。
- 旧 `autoRoll` フィールド付き設定を読み込め、既存 writer は廃止フィールドを書かない。
- 通常 status 本文が `turnDisplay.announcement` と一致し、未公開情報を含まない。
- adjust/discard 中の status 所有者は1つ。#68 と手動ターンの調停を維持する。
- `hud-layout` の2ボタン配置と tab 順。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/game-hud.test.ts tests/unit/game-shortcuts.test.ts tests/unit/game-settings.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts
npm run test:e2e -- tests/e2e/turn-result-card.spec.ts tests/e2e/first-turn-notice.spec.ts tests/e2e/rules-guide.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
rg -n 'useAutoRoll|autoRoll|おまかせ' src tests docs/manual
```

最後の検索は残存箇所をレビューする。旧設定互換テストと履歴以外の製品参照は残さない。ケース移植表の未分類・移植漏れをゼロにする。

**Estimated LOC:** 削除900〜1,500、追加・更新150〜250。削除主体の例外ステップ。機能を半分残した中間 commit は作らない。

### Step 2 — スキップ表記と出目調整画面を整える

- **id:** `S2`
- **visible:** yes
- **goal:** 両 skip を「演出をスキップ」に統一し、調整確定との違いを見た目で示す。

**File changes**

- **modify:** `GameHud.tsx`、`RollAdjustment.tsx`、`GameMenu.tsx`、`rulesGuide.ts`。
- **modify:** `presentation.ts`、`turnMomentPresentation.ts` の操作名を参照する読み上げ。
- **modify:** `src/styles.css`。調整画面の skip を確定操作から別グループに分離。Escape 文だけ既定非表示、`(pointer: fine)` で表示。
- **modify:** `docs/manual/tokyo-suburban/rules.md` のボタン名。
- **modify:** scan の「Skip rename」に列挙された unit/E2E の完全一致期待値。

HUD skip は idle でも表示し native disabled を維持する。dialog 内 skip と既存 `aria-disabled`、native modal の契約を維持する。

**Tests to add/update first**

- 両ボタンの accessible name、idle disabled、dialog 内 skip。
- 確定操作と skip の別グループ。
- coarse pointer では Escape 文だけ非表示、取消不能の注意文は表示。
- 320×568 でもラベルが収まり、HUD 高さ252px以内。

**Acceptance commands:** G に加えて：

以下を実行する：

```bash
npx vitest run tests/unit/game-hud.test.ts tests/unit/item-controls.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/rules-guide.test.ts
npm run test:e2e -- tests/e2e/ui-pop-turn-moments.spec.ts tests/e2e/rules-guide.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/hud-layout.spec.ts tests/e2e/text-wrapping.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
```

**Estimated LOC:** 120〜200。

### Step 3 — 初回判定・文言・storage の純粋モデル

- **id:** `S3`
- **visible:** yes
- **goal:** 初回条件と永続化契約を固定し、ルールガイドの不利アイテム説明も正確にする。

**File changes**

- **add:** `src/features/game/firstPlayGuide.ts`。5 hint ID、coach step、適格性、設定・公開イベント依存の copy builder。
- **add:** `src/features/game/store/guide.ts`。注入された `StorageLike | null` を使う安全な adapter。
- **add:** `tests/unit/first-play-guide.test.ts`、`first-play-guide-storage.test.ts`。
- **modify:** `rulesGuide.ts` の不利アイテム説明を「決まったタイミングで自動で効く」趣旨にする。期間説明と item timing 表は維持。

storage キーは次のグローバル UI 設定とし、値は `"1"`、キーに `save` を含めない。

| key | purpose |
|---|---|
| `yamanote-line-sugoroku:guide:started:v1` | 初回対象セッションを開始済み |
| `yamanote-line-sugoroku:guide:coach:v1` | コーチを実際に表示済み |
| `yamanote-line-sugoroku:guide:hints-disabled:v1` | 全ヒント無効化 |
| `yamanote-line-sugoroku:guide:hint:<id>:v1` | 当該ヒントを表示・status 確認済み |

adapter は各アクセスを try/catch し、値と読み取り成功可否を区別する。未知の保存状態を単なる「セーブなし」に潰さない。

**開始前の適格性表**

上から優先する。全 edition の既知 save key を既存 lookup 経由で確認し、storage 全件走査や registry 変更はしない。

| condition | eligible | handling |
|---|---|---|
| resume（turn 0 を含む） | no | 常に対象外 |
| 起動中に既存 save の存在を一度でも確認済み | no | 削除・上書き後も保持 |
| 有効 save がある | no | 既存プレイヤー扱い |
| 不正・破損・非互換 save の payload が存在 | no | 存在の事実で除外。修復・削除は既存処理に任せる |
| save lookup が例外・読み取り不能で存在不明 | no | 判定不能として自動ガイドを抑制。ゲームは継続 |
| #68 既読、guide started、または起動中メモリの started が true | no | 既存／開始済みとして除外 |
| #68 または guide started の読み取りが例外で不明 | no | 自動ガイドを抑制。手動再表示は可能 |
| new、全 save key が不在、#68 未読、started 未設定 | yes | 開始前に固定 |
| guide 値が読み取り可能だが `"1"` 以外 | 上記の残り条件で判定 | 当該 guide 値は未設定として扱う |

`StorageLike | null` が null の場合も永続状態は不明として自動表示を抑制する。読み取りに成功し書き込みだけ失敗する場合は初回対象にでき、S5 のメモリ記録で同一起動中の再開始を抑制する。

**Tests to add/update first**

- 上記判定表、edition 横断、coach/hint preferences とセッション適格性の分離。
- null、読み取り例外、不正値、書き込み失敗。
- service-only／direction-only／両方の lottery、迂回・運休による現在路線除外。
- 3:2・2:1・均等・逆方向偏重、距離同値、方向1つ。
- edition ごとの名前、非ループ目標、item timing の例外。
- ルールガイドの不利アイテム説明と期間表示。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/first-play-guide.test.ts tests/unit/first-play-guide-storage.test.ts tests/unit/rules-guide.test.ts
```

**Estimated LOC:** 180〜260。

### Step 4 — キュー reducer とセッション状態 hook

- **id:** `S4`
- **visible:** no
- **goal:** 表示待ち、既読、退避、破棄、全無効化を純粋遷移で管理する。

**File changes**

- **modify:** `firstPlayGuide.ts`。queue reducer、表示・status acknowledgement、取消状態。
- **add:** `useFirstPlayGuide.ts`。
- **add:** `tests/unit/first-play-guide-queue.test.ts`、`use-first-play-guide.test.ts`。

同一ターンの順序は `lottery → off-target → item → harmful-item → terminus`。現在・待機・既読 ID に加え、当該セッションで閉じた ID も重複排除する。候補は次ターンでも保持する。

acknowledgement は `{ sessionId, candidateKey, displayGeneration }` に結合する。可視表示と status 反映の両方が同じ表示世代で確認された場合だけ既読を保存する。これはブラウザ上の表示・status 更新確認であり、音声の実聴完了を意味しない。

退避時は表示世代を無効化し、未完了の確認を取り消す。復帰時は新しい世代で確認し直す。閉じる、全無効化、session 変更、`showClear` への遷移では対象の未処理読み上げと callback を破棄する。callback 実行時にも現在の可視性・modal 状態・終了状態を検証する。

通知選択状態は key と選択時本文を一緒に保持する。最後の key に現在カードの本文を後付けしてはならない。

**Tests to add/update first**

- 繰り返し render、StrictMode、固定順、次ターン保持、ID 重複排除。
- 両確認前は既読を書かず、正常確認後も書き込みは一度。
- 可視表示後・status 確認前に hidden／modal／session 変更／閉じるが起きた場合の stale ack 拒否。
- 退避前の callback が復帰後の同一候補を確認済みにしない。
- 全無効化は現在・待機・未処理読み上げを同時に消す。
- `showClear` は未確認候補を既読にせず破棄する。
- storage 書き込み失敗でもメモリ上の既読・無効化を保持する。
- 通知交代時に key／本文／ack 対象が一致する。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/first-play-guide-queue.test.ts tests/unit/use-first-play-guide.test.ts
```

**Estimated LOC:** 220〜300。

### Step 5 — セッション開始前の判定とテスト隔離

- **id:** `S5`
- **visible:** no
- **goal:** 新規保存や storage 書き込み失敗で初回判定が反転しないよう、開始前の事実を session に固定する。

**File changes**

- **modify:** `GameApp.tsx`。開始前 snapshot、起動中の既存 save／started メモリ、session ID と entry turn への結合。
- **modify:** `tests/e2e/fixtures.ts`。独立した `firstPlayGuideSeen` option を追加、既定 true。
- **modify:** `tests/unit/helpers/notices.ts`。独立した `seedFirstPlayGuide` helper。
- **modify:** 必要な mounted GameApp unit の setup。既存 assertion は維持。
- **add:** `tests/unit/game-app-first-play-guide.test.ts`。

新規開始を受理した handler 内で、次の順序を守る。

1. 既存 save、#68、永続 started、起動中メモリから適格性を一度だけ固定する。
2. 適格な開始なら、まず起動中メモリの started を true にし、続いて永続 started の書き込みを試みる。
3. `newGame()` を実行し、固定した適格性を生成 session ID と entry turn に結び付ける。

started の書き込みは適格性固定後、`newGame()` と初回自動保存より前に行う。書き込み失敗でも同一 GameApp 起動中のメモリを保持し、2回目の新規開始を初回扱いしない。これは初回対象の予約であり、coach 表示済みフラグとは分ける。

effect の再実行や StrictMode の render によって適格性を再計算しない。#68 のキー・fixture option は変更しない。

**Tests to add/update first**

- turn 0 の自動保存と #68 更新後も対象 session の適格性は不変。
- 既存 save の確認後に削除・上書きしても既存プレイヤー扱い。
- resume、別 edition の save、不正・非互換 save、読み取り不能。
- 全書き込み失敗でも同一画面から2回新規開始した際、初回対象は最初だけ。
- started の保存前に適格性が固定され、StrictMode でも再計算されない。
- fixture false は何も消さず、default seed は #68 キーを触らない。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/game-app-first-play-guide.test.ts tests/unit/game-app-save-notice.test.ts
npm run test:e2e -- tests/e2e/first-turn-notice.spec.ts tests/e2e/resume.spec.ts --project=desktop-chromium --workers=2
```

**Estimated LOC:** 170〜240。

### Step 6 — コーチの dialog と配置モデル

- **id:** `S6`
- **visible:** no
- **goal:** 未接続のビューとして、3ステップと安全な fallback を完成させる。

**File changes**

- **add:** `components/FirstPlayCoach.tsx`。
- **modify:** `firstPlayGuide.ts` に viewport 内配置計算、`src/styles.css` に coach styles。
- **add:** `tests/unit/first-play-coach.test.ts`。

native modal dialog 内に操作不能の対象枠と操作可能な吹き出しを描く。本文は `PhraseText`。対象 rect がない・ゼロサイズなら中央配置し、WebGL 未対応・地図失敗時も文章で完了できる。

対象 rect は ref から測定し、resize・scroll・`ResizeObserver` で更新する。既存 overview の地図領域を示し、精密な路線投影やカメラ演出は追加しない。

**Tests to add/update first**

- 前へ、次へ、とばす、最終「はじめる」。
- Escape の cancel は `preventDefault()` し、進行・終了・ゲーム skip を起こさない。
- focus containment、opener 消失時の fallback。
- resize、対象消失、WebGL fallback、StrictMode cleanup。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/first-play-coach.test.ts
```

**Estimated LOC:** 180〜240。

### Step 7 — 初回コーチを接続し、入力をブロックする

- **id:** `S7`
- **visible:** yes
- **goal:** 初回新規ゲームだけで3ステップを表示する。

**File changes**

- **modify:** `GameApp.tsx`、`GamePanel.tsx`、`GameHud.tsx`、`RailwayMap.tsx`。
- **modify:** `useGameShortcuts.ts` は既存 surface flag で不足する場合のみ。
- **modify:** coach unit、GameApp unit。
- **add:** `tests/e2e/first-play-coach.spec.ts`。

dice、進捗、地図領域の refs を接続する。同じ render-time の coach-open 状態を入力、ToastHost の既存 obscured 契約、#68 の表示・読み上げ抑制へ渡す。effect による `showModal()` 前の隙間もブロックする。

coach 既読は可視状態で native dialog の初回表示を確認してから保存する。started の記録や component mount だけでは保存しない。表示前に hidden／終了／session 変更となった確認は拒否する。

**Tests to add/update first**

- 初回表示、既存プレイヤー非表示、reload 後非表示。
- 背景クリック、dice、Space/Enter、S/Escape、map skip が無効。
- 初回 render から入力と ToastHost／#68 の抑制が一致する。
- とばしても hints-disabled は立たない。
- 初回表示確認前に coach 既読を書かない。
- 完了時の focus 復帰。opener が利用不能なら dice、見出しの順に解決。
- E2E: Tab / Shift+Tab never move focus out of the open coach (Step 6 review).
- 地図失敗時も完了可能。
- `@layout`：320×568、390px幅、667×375 の対象枠・本文・全操作。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/first-play-coach.test.ts tests/unit/game-app-first-play-guide.test.ts tests/unit/game-shortcuts.test.ts
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
```

**Estimated LOC:** 180〜250。

### Step 8 — 遊び方からコーチを再表示する

- **id:** `S8`
- **visible:** yes
- **goal:** 既読・既存プレイヤーもゲーム中の遊び方からコーチを再確認できる。

**File changes**

- **modify:** `RulesGuide.tsx`、`RulesDialog.tsx`、`GameApp.tsx`。
- **modify:** `rules-guide-components.test.ts`、`rules-dialog.test.ts`、`first-play-coach.spec.ts`。

ゲーム中だけ optional callback を渡し、タイトルのルールには再表示操作を出さない。再表示は適格性、hint 既読、hints-disabled を変更しない。

pending engine decision、item-use、confirmation、終了状態では再表示を許可しない。有効条件は render 時と handler 実行時の両方で最新状態から確認する。

rules の背後で pending decision が発生した場合は必須 decision を優先する。再表示要求を受理せず、rules を閉じる際は必須 dialog の既存表示・focus 経路へ渡す。rules から coach に移る場合は一つの状態遷移で切り替え、RulesDialog が旧 opener に focus を戻して競合しないようにする。

**Tests to add/update first**

- 再表示、既存プレイヤー、hints-disabled 後の再表示。
- rules → coach → opener/dice の focus。
- 再表示後も各 hint の既読・無効化状態を維持。
- pending decision／item-use／confirmation 中は再表示不可。
- render 後・クリック前に禁止状態へ変わった場合も handler が拒否。
- rules 背後で pending decision が発生した場合、coach を開かず必須 dialog が focus を所有する。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/rules-guide-components.test.ts tests/unit/rules-dialog.test.ts tests/unit/game-app-first-play-guide.test.ts
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts tests/e2e/rules-guide.spec.ts --project=desktop-chromium --workers=2
```

**Estimated LOC:** 100〜160。

### Step 9 — 公開済みヒント候補を生成する

- **id:** `S9`
- **visible:** no
- **goal:** 取得演出終了後の公開済み候補だけを生成し、DESIGN row 244 を維持する。

**File changes**

- **modify:** `turnMomentPresentation.ts`。`TurnMomentDisplay.guideCandidates` を追加。
- **modify:** `firstPlayGuide.ts` の candidate 型。
- **modify:** `tests/unit/turn-moment-presentation.test.ts`。
- **add:** `tests/unit/first-play-guide-candidates.test.ts`。

**全候補を `resultPublished` まで公開しない。** `lotteryPublished` は抽選表示の既存用途を維持するが、ヒント候補の公開条件には使わない。pickup 中は抽選結果が見えていても `guideCandidates` は空とする。

| id | condition | boundary |
|---|---|---|
| `lottery` | 実際に service または direction 抽選が必要。抽選種類の variant を付与 | `resultPublished` |
| `off-target` | {target}以外の路線では、{target}に近づく向きが抽選で出やすくなっています。 | `resultPublished` |
| `item` | 当該ターンの有利取得・pending discard | `resultPublished` |
| `harmful-item` | 当該ターンの `harmful-scheduled` または `cancelled-by-certificate` | `resultPublished` |
| `terminus` | endpoint、terminus、unused pips > 0 | `resultPublished` |

過去に予約した効果の `effect-activated` だけでは harmful candidate を作らない。target 外に居続けるだけでは「最初の離脱」の候補を追加しない。

履歴除外は `turn > entryTurn` で行い、復元と演出省略を混同しない。candidate key は session／turn／ID を識別し、公開時の本文 variant と必要な公開データを保持する。

**Tests to add/update first**

- 全境界の前後。pickup 中は5種類すべて候補なし。
- pickup 終了後に同一ターンの候補を固定順で公開。
- service-only、direction-only、両方、実際には抽選不要のケース。
- target 離脱と target 外継続。
- 証明書打ち消し、遅延予約、過去効果の発動、pending discard。
- terminus、範囲端、service boundary、unused pips 0。
- skip、演出なし、reduced motion、resume。
- 本文選択のために未公開 record を下流へ渡さない。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/first-play-guide-candidates.test.ts tests/unit/turn-moment-presentation.test.ts
```

**Estimated LOC:** 180〜260。

### Step 10 — ヒントカードと汎用読み上げ調停

- **id:** `S10`
- **visible:** no
- **goal:** 未接続のカードと読み上げ契約を完成させ、#60／#68 の挙動を維持する。

**File changes**

- **add:** `components/FirstPlayHint.tsx`。
- **modify:** `saveNotice.ts`、`GamePanel.tsx`、`GameApp.tsx` の通知受け渡し型・所有状態。
- **modify:** `src/styles.css`。
- **add:** `tests/unit/first-play-hint.test.ts`。
- **modify:** `save-notice.test.ts`、`game-app-save-notice.test.ts`。

カードは ToastHost の兄弟の通常 `<section>` とし、新しい live region は作らない。まだ候補とカードは製品画面で接続しない。

`selectAnnouncement` に `{ key, text }` を渡せるよう一般化し、選択時の key と本文を一緒に保持する。通常ターン → #68 → hint の優先順を守り、既存の単一 status を利用する。

通知の所有・抑制条件に engine decision、rules、confirmation に加え、局所 `itemDialogOpen` と coach を含める。hidden、退避、取消、終了中の hint は選択も acknowledgement も行わない。通常ターンや #68 自体の既存所有権を壊さない。

**Tests to add/update first**

- 3操作、表示時に focus を奪わない。
- カード内 S/Escape が game skip へ伝播せず、Space/Enter の native button 操作は維持。
- 閉じる際はカード内に focus がある場合だけ適切な操作へ復帰。
- 通常本文が `turnDisplay.announcement` と一致し、未公開情報がない。
- #68 の表示後・status 確認時の既読契約。
- #68 → hint、hint → 次の通知で key／本文が混在しない。
- item-use／coach を含む modal と hidden 中の hint 抑制。
- 取消後の stale ack 拒否、同一通知の再読み上げ防止、単一 status 所有。

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/first-play-hint.test.ts tests/unit/save-notice.test.ts tests/unit/game-app-save-notice.test.ts tests/unit/game-app-turn-moments.test.ts
npm run test:e2e -- tests/e2e/first-turn-notice.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2
```

**Estimated LOC:** 200〜280。

### Step 11 — ヒントの表示・詳細・既読を接続する

- **id:** `S11`
- **visible:** yes
- **goal:** 対象セッションで5種類のヒントを一度ずつ表示し、詳細・全無効化・退避・終了を機能させる。

**File changes**

- **modify:** `GameApp.tsx`、`GamePanel.tsx`、`useFirstPlayGuide.ts`。
- **modify:** GameApp guide unit。
- **add:** `tests/e2e/first-play-hints.spec.ts`。

候補をキューへ流し、以下の状態遷移を接続する。

| trigger | current card / queue | announcement / acknowledgement |
|---|---|---|
| coach、rules、adjust、discard、item-use、confirmation、hidden | 新規提示しない。表示済みカードも退避し、候補を保持 | hint 読み上げを止め、未完了の表示世代を無効化 |
| modal 終了・visible 復帰 | 同じカードを新しい表示世代で復帰 | 未確認なら両確認をやり直す。確認済みなら重複保存・再読み上げしない |
| 演出との衝突 | カードを退避し、状態を保持 | 同じ取消・復帰契約 |
| 閉じる | 現在カードだけ除去。当該 session の重複提示を抑制 | 未処理読み上げと callback を取消 |
| もう表示しない | 現在・待機を消し、メモリと永続フラグで全無効化 | 未処理 hint 読み上げを同時に破棄 |
| session 変更・終了、`showClear` が true | 現在・待機・候補を破棄 | 未確認候補を既読にせず、古い callback を拒否 |

`showClear` では session ID が変わらなくても破棄する。GamePanel のアンマウント後に hint status を復活させず、完了の読み上げは既存 ClearScreen に任せる。

`詳しく` は `openRules(sectionId, opener)` に接続する。カードの状態と候補 key を保持して退避し、rules 終了時にカードを復元した後、同じ詳細操作へ focus を戻す。DOM を保持する場合も hidden 中は focus・操作対象にしない。アンマウントする場合は候補 key に基づき復元後のボタンを明示的に解決する。

rules 終了時に必須 decision があればそちらを優先し、カードへの focus 復帰を延期する。session 変更・全無効化・ゴールでカードがなくなった場合は古い opener を使わず、現在有効な dialog／dice／見出しの既存 fallback へ渡す。

**Tests to add/update first**

- 5種類と全本文 variant、section deep link。
- 同一ターン複数候補、次ターン保持、非自動消去、通常表示時の focus 非移動。
- 表示済み hint → 次ターン adjust。カード・hint status が止まり、Escape は調整なし続行を1回だけ実行。
- discard／item-use／confirmation の各 dialog 終了後、同じカードが復帰し ack は重複しない。
- 詳細 → rules → 復元した詳細ボタンへの focus。
- coach／hidden／演出との衝突中の退避・復帰。
- 表示中・待機中のゴール。ClearScreen だけが完了を読み上げ、未確認 hint は既読にならない。
- 可視表示後・status 確認前の hidden／modal／session 変更／閉じるで stale ack を拒否。
- 全無効化、reload、storage 失敗。
- #68 と競合しても通常本文を上書きせず、安定後に hint が提示される。
- E2E: Space and Enter on each focused hint-card button activate it exactly once (Step 10 review).

**Acceptance commands:** G に加えて：

```bash
npx vitest run tests/unit/game-app-first-play-guide.test.ts tests/unit/use-first-play-guide.test.ts tests/unit/game-app-save-notice.test.ts
npm run test:e2e -- tests/e2e/first-play-hints.spec.ts tests/e2e/first-turn-notice.spec.ts --project=desktop-chromium --workers=2
```

**Estimated LOC:** 220〜320。超過時は同じステップ内の小さな検証単位に分け、S12 開始前に全受入条件を満たす。

### Step 12 — コンパクト画面と演出経路の統合検証

- **id:** `S12`
- **visible:** yes
- **goal:** phone と短い横画面でカード・コーチ・既存操作を併用できる状態を保証する。

**File changes**

- **modify:** `src/styles.css`、必要な配置計算のみ。
- **modify:** `first-play-coach.spec.ts`、`first-play-hints.spec.ts`。
- **modify:** 必要なら `FirstPlayHint.tsx` の内部スクロール構造。

phone は action row を `minmax(0, 1fr)` の2列、既存56px高とする。HUD に新しい行を追加せず、文字を縮小しない。カードは HUD 外の地図側上部を基本とし、#66 pill、地図操作、結果表示を覆わない。高さ不足時はカード内部だけスクロール可能にし、全操作へ到達できるようにする。

**Tests to add/update first**

- `@layout`：320×568、390px幅、667×375。
- HUD 高さ252px以内、ページ横スクロールなし、カード全操作に到達可能。
- #66 pill、HUD、地図操作、TurnMomentHost との重なりと退避・復帰。
- full presentation、skip、演出なし、reduced motion。
- pickup 中は全候補なし、公開後は固定順。
- 表示済み hint → adjust／discard／item-use／confirmation と focus・status の所有権。
- カード表示中・待機中のゴールと ClearScreen の読み上げ。
- rules 背後の pending decision と coach 再表示の競合。
- rules とカードを往復した後の復元・focus。
- WebGL 未対応、地図失敗、resize 後もコーチ完了可能。
- coarse/fine pointer の Escape 文。

**Acceptance commands:** G に加えて：

```bash
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts tests/e2e/first-play-hints.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts tests/e2e/first-play-hints.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/text-wrapping.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
```

**Estimated LOC:** 120〜220。

### Step 13 — 決定記録と最終受入を完了する

- **id:** `S13`
- **visible:** no
- **goal:** 決定記録・互換性・回帰 assertion の対応を確定し、両 Issue の完了根拠を揃える。

**File changes**

- **modify, lead:** `.claude/docs/DESIGN.md`。shared writer で #67 の決定と #113 の supersede を確定。
- **modify:** 本計画または既存の受入記録に、下表の実際の test 名・assertion・実行結果・対象 SHA を記録。
- **modify:** 必要な既存手順・利用者向け説明だけを同期する。製品挙動はこのステップで追加しない。

DESIGN rows 250–253 相当のおまかせ動作・非永続化・1200ms 間隔は #113 で supersede する。row 249 の shortcut 動作は維持し、tab 順に関する記録だけおまかせ削除と追加操作に合わせる。

**Tests to add/update first**

新しい製品仕様のテストは追加せず、既存受入の追跡漏れを確認する。不足が見つかった場合は担当ステップの要件に沿う回帰 assertion を補い、該当チェックと G を再実行する。

| retained contract | required assertion / test mapping |
|---|---|
| DESIGN row 244 | S9 candidate unit と S12 E2E：pickup 中は全候補なし、`resultPublished` 後だけ公開 |
| DESIGN row 262 | S2/S12：native adjustment dialog と内側 skip が存在し、Escape は調整なし続行を1回実行 |
| DESIGN row 272 | S2/S12 `@layout`：320×568 等で HUD 252px以内、既存閾値を緩めない |
| #60 | S1/S10 の turn-moment・mounted unit：通常本文は `turnDisplay.announcement` と一致し未公開情報なし。decision 中の status 所有者は1つ |
| #68 | S1/S5/S7/S10/S11：専用キー・fixture 分離、表示・status 確認後の既読、通常本文優先、coach 中抑制、hint への正常な引き継ぎ |
| #113 | S1：ケース単位の削除・移植記録、参照検索、手動操作・旧設定互換 |
| 初回判定・取消 | S4/S5/S11：書き込み失敗時の2回開始、表示世代、stale ack、`showClear` 破棄 |

**Acceptance commands:** G に加えて：

```bash
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts tests/e2e/first-play-hints.spec.ts tests/e2e/first-turn-notice.spec.ts tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/first-play-coach.spec.ts tests/e2e/first-play-hints.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/text-wrapping.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
rg -n 'useAutoRoll|autoRoll|おまかせ' src tests docs/manual
```

lead は最終 head SHA の全4プロジェクト CI と、禁止スコープに変更がないことを確認する。実行していないチェックを成功扱いしない。

**Estimated LOC:** 60〜140。

## Dependencies Between Steps

```text
S1 → S2
S3 → S4 → S5
S3 → S6
S2 + S5 + S6 → S7 → S8
S3 → S9
S4 + S5 → S10
S7 + S8 + S9 + S10 → S11 → S12 → S13
```

実行順は S1〜S13 の通し順とする。依存関係上独立していても同時実装しない。各ステップについて、Sol low のレビュー、lead の差分・受入確認、G、対象 E2E、commit、push、対象 SHA の CI 確認を完了してから次へ進む。

S1 は単独で #113 が完了する。#68 の置換テストは手動ターンだけで成立させ、hint との調停は S11 で追加する。

S3 はルール本文を変更するため visible。S4〜S6、S9〜S10 は未接続の内部基盤として単独で green にする。S5 の started 記録は未接続期間も一貫した開始契約として扱い、基盤ステップを一般公開するリリースとは区別する。

新規ガイド suite は S7 以降、`firstPlayGuideSeen: false` と `firstTurnNoticeSeen: false` を明示する。

## Test Plan

テストは unit の純粋モデルを中心に条件分岐を網羅し、E2E は実際の modal、focus、公開境界、永続化、レイアウトを確認する。

| 対象 | 主な証明 |
|---|---|
| #113 | UI/実行経路の不在、ケース単位の回帰移植、手動二重 dispatch 防止、draft、key 非消費、decision revision、旧設定互換 |
| 初回判定 | 自動保存前の固定、既存・不正・非互換 save、読み取り不能、#68/started、resume、edition 横断 |
| 起動中メモリ | 全書き込み失敗時も同一 GameApp の2回目開始では初回ガイドなし |
| コーチ | 3ステップ、render-time 入力・通知抑制、表示確認後の既読、focus、再表示、WebGL fallback |
| 再表示競合 | render／handler の二重検証、rules 背後の pending decision 優先 |
| 候補 | 全5種類を `resultPublished` まで非公開、pickup 中は空、復元と省略演出の区別 |
| copy | direction-only、service-only、両方、現在路線除外、方向1つ、距離同値、均等・逆方向偏重、item timing、終点種別 |
| キュー | 固定順、ID 重複排除、次ターン保持、退避、全無効化、session reset、`showClear` 破棄 |
| ヒント | 3操作、deep link、非自動消去、通常表示時 focus 非移動、詳細からの復元 |
| modal | 表示済みカードの adjust/discard/item-use/confirmation/coach/rules 中退避と操作・hint status 停止 |
| 読み上げ | 既存単一 status、通常本文/#68 優先、key と選択時本文の一致 |
| acknowledgement | session＋candidate key＋表示世代、両確認後だけ保存、hidden/modal/close/reset/clear 後の遅延 callback 拒否 |
| ゴール | session 維持でも guide を破棄、未確認候補を既読にせず ClearScreen が完了を読み上げる |
| storage | null、例外、不正値、書き込み失敗、メモリ継続、キーに `save` を含まない |

**Fixture／helper**

`tests/e2e/fixtures.ts` の `firstPlayGuideSeen` は既定 true とし、guide started／coach／5 hint の既読だけを seed する。hints-disabled を既定 true にして接続不具合を隠さない。false は何も seed・削除しない。

`firstTurnNoticeSeen` と #68 キーは変更しない。`tests/unit/helpers/notices.ts` の `seedFirstPlayGuide` も既存 #68 helper と独立させる。

ゲーム seed の既定値 `000000000000000000000000000005ff` と既存 scenario を維持する。追加ケースは既存 seed で成立するか純粋モデルで確認し、不足時だけ決定的 seed を追加する。storage 失敗 fixture は読み取り失敗と書き込み失敗を分ける。

**Layout**

`@layout` の主要対象は `first-play-coach.spec.ts`、`first-play-hints.spec.ts`、`hud-layout.spec.ts`、`text-wrapping.spec.ts`。phone project は `@layout` のみを選択するため、寸法・pointer・操作到達性のテストには必ず tag を付ける。

320×568、390px幅、667×375 を確認し、HUD 252px、safe-area、no-scroll の既存上限は緩めない。カード退避・復帰後も全操作が利用できることを測定する。

**Execution and CI**

ローカルでは G と各ステップの対象 desktop-chromium／phone-chromium を実行する。全4プロジェクト E2E は CI で確認する。

既存 CI は working branch push では desktop-chromium のみ、develop/master 向け PR または manual dispatch で全4プロジェクトを実行する。lead は PR を早期に作成して各 head SHA の PR CI を確認するか、manual dispatch を使う。quick CI だけを full matrix 成功と扱わない。

既存テスト変更は次に限定する。

- 廃止機能専用ケースの削除と、そのケース単位の根拠記録。
- 自動 roll を手動 roll に置換し、通知・結果・focus・公開境界の検証意図を維持する変更。
- 新ラベル、2列 UI、tab 順に伴う期待値変更。
- 独立した guide seed による setup 変更。
- 明示した新仕様の追加 assertion。

## Risks and Mitigations

| risk | mitigation |
|---|---|
| 抽選結果が見えた時点で hint が先行する | 全候補を `resultPublished` で公開し、pickup 中は空とする |
| 現在路線や方向抽選について誤説明する | 抽選種類の variant、候補除外に耐える本文、方向1つ・距離同値の分岐 |
| 過去の抽選値を全 edition に固定する | 実 config の解決値を使い、重みや RNG を変更しない |
| 不利取得を即時発動と誤解させる | 予約・自動効果・打ち消しを区別し、既存 toast を維持 |
| 新規保存や #68 更新で初回判定が反転する | `newGame()` 前に一度固定し session に結合 |
| storage 書き込み失敗で何度も初回になる | 適格性固定後、永続書き込み前に起動中 started を保持 |
| storage 読み取り不能を新規と誤認する | 不明状態を区別し自動表示を抑制。手動再表示は可能 |
| coach 表示前に入力・通知が走る | 同じ render-time 状態で入力、ToastHost、#68 を抑制 |
| pending decision と coach が競合する | render と handler の両方で確認し、必須 decision を優先 |
| 表示済みカードが modal に残る | 既存カードも退避し、操作・hint status・ack を停止 |
| rules 終了時に消失 opener へ戻る | カード復元後に key で詳細操作を解決し、必須 modal を優先 |
| key と本文が別候補になる | 通知選択時の `{ key, text }` を一緒に保持 |
| 退避前の遅延 callback が既読を書き込む | session／candidate key／表示世代と現在状態を実行時に検証 |
| ゴール後に古い hint が復活する | `showClear` でキュー・読み上げを破棄し、ClearScreen に所有権を渡す |
| 演出省略で候補が欠落する | entry turn による履歴除外と省略演出を分離 |
| phone で既存操作を覆う | HUD 外配置、退避・復帰、内部スクロール、実寸 `@layout` |
| #68 を fixture で隠す | guide 専用 option/helper を分離し、#68 キーを変更しない |
| suite 削除で共通回帰検証が失われる | 削除前に各ケースの廃止・移植・同等検証先を確定 |
| ステップが大きくなる | 同一ステップ内を小さな検証単位で進め、全受入後に次へ進む。S1 は削除主体の例外 |
| browser 差を見逃す | 各 head SHA の full matrix CI を次ステップ開始条件にする |

## Out of Scope

- エンジン、RNG、抽選の重み、候補フィルタ、ゴール条件の変更。
- save schema/version、既存 save の移行・新しい修復処理。
- public data、edition registry データの変更。
- ToastHost、toast queue の順序・容量・寿命の変更。
- rules guide 全体の再設計。
- HUD skip の idle 時非表示、調整 dialog 内 skip の削除。
- 新しい live region、通常の hint 表示時の自動 focus 移動。
- 地図路線の精密投影、新規カメラ演出。
- 全 `endpoint` 種別へのヒント拡張。
- コーチ再表示による初回適格性・hint 既読・無効化のリセット。
- linter の新規導入、既存テストの閾値緩和。
