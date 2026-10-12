# 鉄道すごろく — MVP仕様書

- Document version: 0.3.0 (2026-10-12: JR East Tokyo 23-ward expansion addendum; original MVP retained)
- 作成日: 2026-10-10
- 状態: MVP開発開始用（未確定事項は「暫定」「要確認」を付記）
- 対象: Webブラウザで動作する、実際の鉄道地図を利用したオリジナルすごろく

## Current edition addendum — JR East Tokyo 23 wards (2026-10-12, v0.3.0)

This dated contract supersedes the Yamanote-only scope and pending transfer/endpoint
choices in the original MVP sections 1–4 and 11 below. Those sections remain as
historical baseline requirements; the goal in section 3.3 is unchanged.
The title is “山手線すごろく” with subtitle “JR東日本 東京23区版”.

### Scope and rules (updates to sections 2 and 4)

- Reviewed all-stop service catalogue: Yamanote (30 stops), Keihin-Tohoku
  Akabane–Kamata (22), Chuo-Sobu local Nishi-Ogikubo–Koiwa (24), Saikyo
  Osaki–Ukima-Funado (10), Keiyo Tokyo–Kasai-Rinkai-Koen (6).
  Shared identity gives 67 stations and 22 transfer stations. Joban local,
  Joban rapid, Yokosuka/Sobu rapid, separate Musashino service patterns and
  out-of-area/non-JR through-running are excluded.
- Start at Shimbashi on Yamanote outer; turn 0 has no lottery. Each turn rolls
  1–6, follows the current service/direction, and completes each traversed
  directed segment. Only Yamanote outer segments count toward the 30/30 goal.
- If pips remain at a terminus or last in-area station, stop and discard them.
  Exact landing on an endpoint with no remaining pips is an ordinary roll stop.
- Unless the move clears, select uniformly from distinct services at the
  arrival station, including the ridden service. Passed stations never draw.
  Candidate order is `services.json` order.
- Yamanote direction is always outer. Every other service re-draws from movable
  directions `[1, -1]`, including when the service is unchanged or is the only
  service at the station. One available outcome is forced and consumes no RNG.
- Draw order: die, service (if at least two candidates), direction (if two
  movable directions on the chosen non-target service). Uniform-k draws use
  uint32 rejection sampling. No weighting or game-length rule adjustment is added.
- With all 30 target segments completed, Yamanote arrival at Shimbashi truncates
  and clears; other-service arrival clears only on the final rolled step.
  Endpoint truncation does not turn an incomplete roll into an exact stop.
- Moves commit atomically before animation and saving. While animating, show
  the ridden service/direction; reveal the next ride and lottery on accepted
  completion, skip or reduced-motion completion. Reload resumes the committed
  result without another draw. Lottery presentation is accessible text.

### Data and persistence (updates to sections 5, 8 and 11)

- Five public files remain: stations, services, directed segments, shared
  LineString geometry, manifest (`schemaVersion: 2`). One stable station id per
  curated JR facility; `ServicePattern.platformCoordinates` retains platform
  positions. Linear patterns have explicit terminus/area-boundary endpoints and
  all patterns have forward/backward direction labels.
- Directed ids `<service>:<from>:<to>` reference canonical undirected features
  `<service>:<forward-from>~<forward-to>`. Linear services emit both directions;
  Yamanote emits outer only. Geometry properties use `featureId`, and animation
  determines orientation by station identity rather than coordinate distance.
- `MoveRecord` adds `stopReason` (`roll`, `goal`, `endpoint`) and `landing`
  (`{serviceId, direction}` or `null` only on clearing moves). `saveVersion: 2`,
  ruleset `jr-east-23ku-1`; old saves are not migrated. Structural replay and
  seeded replay compare whole records and final state/RNG, including lotteries.
- Area membership is a reviewed registry ward and contiguous in-area stop list;
  N03 is a one-time audit only. N02 2025 remains the shipped railway source with
  unchanged CC BY 4.0 attribution. Raw inputs have pinned SHA-256 checksums.
- Hermetic E2E uses a fixed 128-bit seed on a 30-stop Yamanote plus two short
  linear services, proved to cover transfers, direction draws, both endpoint
  kinds and completion in 15 turns. Actual data has separate browser smoke and
  eight seeded Vitest playthrough/restore checks.

Current user-facing rules: [docs/manual/jr-east-tokyo/rules.md](docs/manual/jr-east-tokyo/rules.md).
Generation/validation contract: [data/README.md](data/README.md).

---

## 0. 開発前に用意するもの

### 0.1 必須環境

- [ ] Git、Node.jsの現行LTS、npm、エディタ（推奨: VS Code）をインストールする。
- [ ] GitHubアカウントを用意してリポジトリを作成する（公開・非公開は任意）。
- [ ] Vercelアカウントを用意してGitHubと連携する。公開前までは不要。非商用の個人利用でHobbyプランを想定する。
- [ ] 最新の主要ブラウザ（Chrome / Edge / Firefoxのいずれか）で開発者ツールを使えるようにする。
- [ ] Python 3とGIS加工環境（GeoPandas、Shapely、pyproj等）を用意する。初期30駅を手作業で検証する場合も、正式データの生成を再現可能にする。
- [ ] 地理データのダウンロード元・基準日・ライセンスを記録する。

### 0.2 必須データ

- [ ] 国土数値情報「鉄道データ」2025年度版（N02）を取得する。基準日2025-12-31。https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html
- [ ] 山手線の**30駅**について駅名、固有ID、位置、外回りの並びを検証した `stations.json` を用意する。
- [ ] 隣接30区間のIDと、路線沿いの地理形状を持つ `segments.geojson` を用意する。
- [ ] 公式の路線図・駅情報と突合する。GISデータの線形だけから駅順序を無検証で推測しない。
- [ ] 元データをそのままゲームへ配信せず、対象範囲に切り出し、適切に軽量化する。
- [ ] 画面内の適切な場所に地図・鉄道データの出典とライセンスを表示する。

### 0.3 開発前の最小検証（スパイク）

1. MapLibre GL JSで東京中心の背景地図を表示できること。
2. 山手線の30駅と30区間を重ね合わせ、駅順・緯度経度と線形が対応していること。
3. 駅1つから外回りに進んで1周すると元の駅へ戻ること。
4. Vercelのプレビューデプロイ上で、地図タイル・JSONが読み込まれること。
5. ライセンス表示とタイル提供条件（アクセス負荷、キャッシュ方針、利用規約）を確認すること。

> **準備に不要なもの:** 有料地図API、独自ドメイン、独自サーバー、DB、ユーザー登録機構、オンライン対戦基盤、原作の画像・テキスト・キャラクター素材。

---

## 1. 製品概要と目的

### 1.1 概要

現実の鉄道駅をマスとして、サイコロの出目だけ駅を進むブラウザゲーム。実地図上で現在地と移動履歴を視覚化する。将来は乗換駅で乗車路線を均等抽選し、路線に応じて方向抽選を行う。

本作品は既存作品から着想を得た**独立したオリジナルゲーム**とし、原作の題名、キャラクター、イラスト、セリフ、指令カード等を使用しない。

### 1.2 MVPのゴール

**山手線だけを対象に、ソロプレイヤーが新橋から外回りで全30駅間区間を踏破し、新橋に到着してクリアする体験**を、実地図上で完結させる。

MVPは将来の複数路線・強制乗換システムに備えた基礎実装である。山手線以外の路線を未収録のため、MVPでは実質的な乗換は起こらない。方向は外回り固定。

### 1.3 MVPに含める機能

- 30駅・30区間を実地図上に表示し、外回り順に接続する。
- 1人用の新規ゲーム開始、1〜6のサイコロ、駅単位の移動アニメーション。
- プレイヤーの現在駅、次に進む方向、出目、ターン数を表示。
- 外回りで通過済みの山手線区間を保存し、地図上で強調する。
- ゴール判定、クリア画面、リスタート。
- ローカルセーブ、再開、セーブ削除。
- 地図の拡大縮小、移動、自動追尾のON/OFF、アニメーションのスキップ。
- 乱数シードとイベント履歴による再現可能なゲームロジック（本番のサイコロはシード付き疑似乱数で生成）。
- PC・スマートフォンの基本レイアウト対応。

### 1.4 MVPの対象外

- 山手線以外の路線、乗換抽選UI、方向抽選UI（**拡張仕様としてデータモデル・インターフェースのみ先に考慮**）。
- 内回りモード、指定駅訪問モード、CPU、ローカル対戦、オンライン対戦。
- 駅イベント、スコアランキング、アカウント、サーバー保存。
- 列車時刻・運賃・列車位置などリアルタイム鉄道情報。
- 鉄道路線・駅の動的更新。

---

## 2. 確定済みのゲーム方針（将来拡張を含む）

| 項目 | 仕様 | MVPでの扱い |
|---|---|---|
| 初期地点 | 新橋駅 | 実装 |
| 基本目標 | 山手線外回り全区間を実際に踏破し、新橋へ到着 | 実装 |
| 一周判定 | 駅名の訪問ではなく**山手線外回りの駅間区間**の通過履歴 | 実装 |
| 1マス | 対象の運行系統で停車する駅 | 実装 |
| 移動距離 | 1〜6駅、通過駅は履歴へ記録 | 実装 |
| 乗換トリガー | サイコロ移動終了時の到着駅に限る | 拡張時 |
| 乗換先 | 現在路線も含め、乗換可能な運行系統から均等抽選 | 拡張時 |
| 方向決定 | 路線とは別の抽選 | 拡張時 |
| 山手線 | 選択された場合は常にモードで定める外回り（将来の内回りモードでは内回り） | 外回り固定 |
| 山手線→山手線 | 方向維持 | 同一系統しかないため暗黙に継続 |
| 他路線→同一路線 | 方向再抽選 | 拡張時 |
| 対象駅 | 各駅停車相当の停車駅、列車種別は区別しない | 全30駅 |
| 乗換可否 | 同一駅構内または公式に案内される乗換 | 拡張時 |
| 路線単位 | 物理線路ではなくゲームで乗車する運行系統 | 山手線1系統 |
| 対象エリア | 山手線→JR東京近郊→首都圏近郊→私鉄等を含む首都圏 | 山手線のみ |
| エリア端点 | 範囲外に出る直前で出目を打ち切る | 環状線なので発生せず |
| 新幹線等 | 将来的に新幹線・路面電車・モノレール・新交通システムを含める | 対象外 |

---

## 3. MVPの厳密なゲームルール

### 3.1 駅と区間

- 外回りに並ぶ30駅を `S[0] ... S[29]` とする。`S[0]` は新橋。
- 区間 `E[i]` は `S[i] -> S[(i+1) mod 30]` に対応する**外回り有向区間**とする。
- `S[0]` からのゲーム開始直後は、踏破済み区間が0件である。
- 地理上で同じ地点を通る他路線でも、山手線の区間踏破としては認めない。

### 3.2 1ターンの進行

1. `playing` 状態でサイコロを1回振る。出目は整数1〜6を均等確率とする。
2. 現在駅から外回り方向に、出目と同じ駅数だけ進む。
3. 各区間 `E[i]` を通過するたびに踏破集合へ追加し、移動ログへ記録する。通過駅に止まっていなくても区間は踏破済みになる。
4. 出目分の移動が終了したら現在駅とターン数を更新する。
5. ゴール条件を満たしたら `completed` 状態へ。それ以外は次のサイコロを受け付ける。
6. 移動アニメーション中の連打を防ぎ、同一ターンの二重適用を禁止する。

### 3.3 ゴール条件（確定部分）

次の双方を満たす必要がある。

1. `completedSegments` が山手線外回りの30区間をすべて含む。
2. 現在駅が新橋 `S[0]` である。

**確定ルール（2026-10-11）:**

- **山手線に乗車中:** 移動途中で新橋に到着した時点で条件1を満たしていれば、**残りの出目を打ち切って新橋で停止し、クリア**とする。条件1を満たしていなければ打ち切らず、出目どおり移動を続ける。
- **山手線以外に乗車中（拡張時）:** 出目を使い切って新橋に**ちょうど停止した場合のみ**クリアとする（exact-stop）。
- 実装時は設定値 `goalArrivalPolicy = "truncate-on-target-service"` として隔離し、`exact-stop` / `pass-through` にも切替可能にする。

**具体例:** 29区間踏破後に山手線で最後の未踏破区間を通過しても、その移動中に新橋へ到着しなければ続行。後のターンで山手線に乗ったまま新橋を通過する出目が出たら、新橋で打ち切ってクリア。

**MVPでの帰結:** MVPは新橋から外回り固定のため、最初に新橋へ戻った時点で必ず全30区間を踏破済みであり、その移動でクリアとなる。

### 3.4 ゲームの終了・再開

- `completed` では移動用サイコロを無効化する。
- 新規ゲームを開始すると、現在駅=新橋、踏破済み=空、ターン=0、履歴=空となる。
- 再開時はセーブされた駅・状態・踏破済み区間・履歴・乱数状態を復元する。
- ゲーム開始時にシードを生成してゲームセッションに紐付ける。クリア前後を問わず同じシードと操作順序から同じ結果を再生できること。

### 3.5 明示的に避ける曖昧さ

- **駅を訪問しただけでは区間踏破しない。** 例: 新橋から別経路で東京へ戻っても山手線区間は進まない（拡張時）。
- **通過駅で乗換イベントは発生しない。**（拡張時）
- **開始地点にいるだけではゴールではない。** 初期踏破集合は空。
- 進行方向の抽選は山手線では実行しない。

---

## 4. 将来の強制乗換ルール（設計予約・MVPでは未実装）

### 4.1 基本アルゴリズム

1. 出目による移動が完了し、ゴールでなければ到着駅の乗換候補系統を取得する。
2. 候補に現在系統を含めた重複なし集合を作る（同一路線を複数回数えない）。
3. 候補が1系統のみなら現在系統を継続する。複数なら均等確率で1系統を抽選する。
4. 選択系統が山手線なら、現在のモードの方向（MVP相当では外回り）へ固定する。
5. 選択系統が山手線以外なら、移動可能な方向から別途均等抽選する。現在系統と同じ結果でも方向を引き直す。
6. 到着駅と次ターンの系統・方向を確定する。

### 4.2 将来調整する項目

- 非環状線端点で有効な進行方向が1方向の場合は抽選を省略する案。
- 分岐がある運行系統の取り扱い、複数の分岐候補を系統に分けるか。
- 乗換と歩行連絡の正確な定義（公式の駅情報で検証）。
- 直通運転、途中の対象範囲境界、終着駅での折返し。
- 新幹線の各駅停車相当の停車パターン。
- 現在系統も含む均等抽選は維持し、6面サイコロ演出は抽選結果の視覚表現として扱う。

---

## 5. データモデル

MVPのゲームロジックから、地図表示データと鉄道ネットワークを切り離す。IDは表示名・データ提供元IDに依存しない安定したアプリ独自IDとする。

```typescript
export type StationId = string;
export type ServiceId = string;
export type SegmentId = string;
export type Direction = 1 | -1;

export interface Station {
  id: StationId;
  name: string;
  coordinates: [longitude: number, latitude: number];
  groupId?: string;
}

export interface ServicePattern {
  id: ServiceId;
  name: string;
  operator: string;
  stationIds: StationId[]; // 進行方向 +1 の順序
  circular: boolean;
  color: string;
}

export interface Segment {
  id: SegmentId;
  serviceId: ServiceId;
  from: StationId;
  to: StationId;
  // 地図の線形は別GeoJSONのfeature.idで参照する
  geometryFeatureId: string;
}

export interface MoveRecord {
  turn: number;
  roll: number;
  serviceId: ServiceId;
  direction: Direction;
  fromStationId: StationId;
  toStationId: StationId;
  traversedSegmentIds: SegmentId[];
}

export interface GameConfig {
  rulesetVersion: string;
  targetServiceId: ServiceId;
  startStationId: StationId;
  targetDirection: Direction;
  goalArrivalPolicy: 'truncate-on-target-service' | 'exact-stop' | 'pass-through';
}

export interface GameState {
  saveVersion: number;
  dataVersion: string;
  status: 'ready' | 'playing' | 'moving' | 'completed';
  config: GameConfig;
  currentStationId: StationId;
  currentServiceId: ServiceId;
  direction: Direction;
  turn: number;
  completedSegmentIds: SegmentId[]; // セーブ時に配列化
  movementHistory: MoveRecord[];
  rngSeed: string;
  rngState: string;
}
```

設計上の注意:

- `direction` は**系統の駅順に対する符号**であり、地理上の方位角ではない。
- `completedSegmentIds` は順番に依存しない集合。UI用は `Set` に変換してよい。
- 長い路線や将来の複数系統に備え、位置情報は`Station`、運行順序は`ServicePattern`、描画形状はGeoJSONで管理する。
- 一周に必要な区間は、有向 `Segment` として識別する。方向を逆転した移動を同じ達成とみなさない。
- `rngState` はPRNG実装に応じた復元可能な状態。セーブ/ロードで出目列が変わらないことをテストする。
- `stationIds` は重複するスタート駅を末尾に再掲しない。環状線の末尾→先頭は `circular` フラグで処理する。

### 5.1 データファイル

- `public/data/stations.json`: 駅ID、名称、代表点座標。
- `public/data/services.json`: 系統と外回り駅順。
- `public/data/segments.json`: 有向駅間区間と形状featureへの参照。
- `public/data/segments.geojson`: 各区間のLineString/MultiLineString（WGS84経緯度）。
- `public/data/manifest.json`: データ版、基準日、出典、利用許諾、更新日。
- `data/overrides/`: 手動補正表（加工時のみ使用）。

### 5.2 データ品質条件

- 駅は30、外回り区間も30である。
- 全駅IDと区間IDは一意。
- 隣接区間の `to` と次区間の `from` は一致し、最後から新橋へ閉じる。
- 駅の位置と区間の端点は地理的に整合する（代表点とプラットホーム形状のズレは許容し、閾値は検証後に確定）。
- 欠損・重複・未参照駅・線形欠落がない。
- 山手線の駅順・駅名・駅数は公式案内と突合した上で固定する。

---

## 6. 画面と操作

### 6.1 画面要素

**開始画面:** タイトル「山手線すごろく」、ゲーム説明、開始・再開、出典へのリンク。

**プレイ画面:**

- 背景地図（MapLibre GL JS + OpenFreeMap等）。
- 山手線ルートの描画、30駅のクリック／タップ可能なマーカー。
- 現在地マーカーと移動方向、未踏破・踏破済み区間の区別。
- 現在駅、ターン数、踏破区間数（例: 12/30）、サイコロ結果。
- サイコロボタン、移動スキップ、マップ追尾ON/OFF、新規開始、セーブ状態。
- 駅タップによる駅名・路線情報の簡易ポップアップ（ゲーム状態の変更はしない）。

**クリア画面:** 所要ターン数、移動回数、移動履歴を表示して再挑戦可能。

### 6.2 地図描画

- 地図自体は実地図。鉄道路線は別レイヤーのGeoJSONとして重ねる。
- 他の背景地図の鉄道描画は必要なら薄くし、ゲーム対象路線を強調する。
- 経路のアニメーションは**隣接駅間のGeoJSON形状に沿って**進め、端点間の直線ジャンプを避ける。
- 過度な地図ズームや手動操作と自動追尾の競合を防ぐ。
- スマホ画面ではボタンと状態表示が地図を覆いすぎないレイアウトにする。
- 地図や鉄道データの著作権表示・帰属表示は常に確認可能にする。

### 6.3 操作・アクセシビリティ

- サイコロボタンは移動中に無効化、結果はテキストでも表示する。
- 色だけで踏破状況を伝えず、線種・凡例・テキストを併用する。
- アニメーションの短縮・スキップを用意する。`prefers-reduced-motion` を考慮する。
- タップ領域は小さすぎないようにする。
- 地図の読み込み失敗時は再試行できるメッセージを表示する。

---

## 7. 技術構成・ディレクトリ案

- Frontend: React + TypeScript + Vite
- 地図: MapLibre GL JS
- タイル: OpenFreeMap（利用条件・提供状況を公開前に確認。代替可能な設定にしておく）
- 状態: Zustand（または初期段階ではReact組込み）
- ゲームエンジン: TypeScriptの**純粋関数**としてUIから分離
- テスト: Vitest（ゲーム・データ検証）+ Playwright（E2E）
- データ加工: Python + GeoPandas / Shapely / pyproj
- セーブ: localStorage（スキーマバージョン付き）
- ホスティング: Vercel Hobby（非商用個人用途）

```text
railway-sugoroku/
├── public/
│   └── data/
│       ├── stations.json
│       ├── services.json
│       ├── segments.json
│       ├── segments.geojson
│       └── manifest.json
├── src/
│   ├── app/
│   ├── components/
│   ├── features/game/
│   │   ├── engine/         # 純粋なゲームルール関数
│   │   ├── store/          # UI状態・永続化
│   │   └── components/
│   ├── features/map/
│   ├── data/               # 読込・型検証
│   └── types/
├── scripts/
│   └── data_pipeline/
├── data/
│   ├── overrides/
│   └── README.md
├── tests/
│   ├── unit/
│   └── e2e/
├── docs/
│   └── specification.md
├── package.json
└── README.md
```

データの原本は容量・再配布条件に応じてGit管理の対象から外してもよい。ダウンロード手順と検証方法は必ずリポジトリに残す。

---

## 8. ゲームエンジンの契約とテスト

### 8.1 コア関数（例）

```typescript
function createGame(config: GameConfig, seed: string): GameState;
function moveByRoll(state: GameState, roll: number, network: RailwayNetwork): GameState;
function checkGoal(state: GameState): boolean;
function serializeGame(state: GameState): string;
function restoreGame(json: string): GameState;
```

- `moveByRoll` の `roll` は1〜6を検証し、不正値を拒否する。
- 実際の乱数生成はロジックから分離する。テストは任意の出目列を指定可能にする。
- `moveByRoll` の最終状態だけでなく、駅間移動のイベント列を作り、UIがその列をアニメーションに利用できる構造が望ましい。
- 将来の乗換抽選は `resolveLandingEvent` のような別関数として追加できるようにする。

### 8.2 単体テスト

- [ ] 新規開始で新橋・0ターン・0/30区間。
- [ ] 1の出目で次の駅へ、6の出目で正しく6区間進む。
- [ ] 末尾駅から先頭駅へ環状に移動できる。
- [ ] 各移動で通過した**全区間**が踏破済みとなる。
- [ ] 同区間を再通過しても踏破数が増えない。
- [ ] 山手線乗車中、全区間踏破済みで新橋を通過する出目なら新橋で打ち切ってクリアし、余りの出目は使わない。
- [ ] 全区間未踏破で新橋を通過した場合は打ち切らず、出目どおり進む。
- [ ] `exact-stop` 設定時は、新橋を通過して別駅に止まってもクリアしない。
- [ ] 全30区間踏破済みかつ新橋に停止したときのみクリア。
- [ ] ゴール後にサイコロを振れない。
- [ ] 同じシード・操作列で同じ出目／状態になる。
- [ ] 保存・復元前後で次のサイコロ結果とゲーム状態が一致する。

### 8.3 結合／E2Eテスト

- [ ] PCおよびスマートフォンの幅で地図と操作UIが表示される。
- [ ] サイコロ操作で地図上の現在地が更新される。
- [ ] 通過済みの区間が色・線種などで識別できる。
- [ ] ページ再読込後に正しく復帰できる。
- [ ] 移動中の連打でターンが二重に進行しない。
- [ ] 地図タイルが取得できなくてもゲーム状態が失われない。
- [ ] GitHubへのpush（`develop`・機能ブランチ）でVercelプレビュー、`develop` から `master` へのマージで本番にデプロイできる。
- [ ] 出典・ライセンス表記が確認できる。

---

## 9. 実装マイルストーン

### M0 — データ・環境の検証
- React + Vite、MapLibre GL JSの最小アプリを立ち上げる。
- 山手線30駅・30区間のデータを整備する。
- 路線の位相・線形・出典の検証をパスする。
- Vercelへ仮デプロイする。

### M1 — マップと基礎ロジック
- 30駅・区間の地図描画。
- 初期状態、新橋からの外回り移動、サイコロ。
- 通過区間管理とゴール判定の単体テスト。

### M2 — ゲーム体験
- 現在地追尾、区間移動アニメーション、操作パネル。
- 踏破進捗、クリア画面、再スタート。
- セーブ／ロード、エラー表示、スマホ対応。

### M3 — 品質確認と公開
- 全ユニット／E2Eテスト。
- 別ブラウザやスマホで動作確認。
- 著作権表示、ライセンス、Vercelと地図サービスの無料枠を確認。
- MVPとして公開。

**MVP完成条件:** ユーザーが新橋から開始し、サイコロ操作とアニメーションを繰り返して全30区間を外回りで踏破し、規定どおり新橋に停止するとクリアでき、途中で再読込しても継続できる。地図と操作がPC・スマホで成立し、テストが通る。

---

## 10. 受け入れ後の拡張ロードマップ

1. JR東日本・東京近郊: 駅グループ・乗換判定・均等な路線抽選・方向抽選・端点処理を追加。
2. JR首都圏近郊区間: 分岐・直通・路線境界などのデータ補正を拡充。
3. 私鉄・地下鉄を含む首都圏: 事業者をまたぐ正式な乗換と運行系統を統合。
4. 新幹線・路面電車・モノレール・新交通システム: 系統・停車駅の特殊ルールを追加。
5. 内回り／指定駅訪問、ローカル・CPU対戦、駅イベントを追加。

**設計原則:** 路線追加でゲームエンジンを書き直すことを避ける。まず単一環状系統を正確に実装し、抽選・分岐・境界を独立したルールモジュールで追加する。

---

## 11. 開発開始前の未決定事項（暫定値付き）

| 項目 | 暫定値 | 影響 |
|---|---|---|
| 新橋のゴール判定 | **確定:** 山手線乗車中は新橋到着で打ち切りクリア、他路線はちょうど停止（§3.3） | ゲーム難易度、ゴール処理 |
| 移動アニメーション速度 | 1駅0.3〜0.6秒程度（設定可能） | 操作感 |
| セーブタイミング | 各ターン確定直後とクリア直後 | 復元の整合性 |
| 駅アイコンの最小表示ズーム | 地図上で確認して調整 | 視認性 |
| 鉄道データの更新頻度 | 開発時点の基準データで固定 | 再現性 |
| MVPのサイコロ方式 | 1〜6均等のアプリ内疑似乱数 | ゲーム性 |
| 対象境界に到達した場合 | 端点で余りの目を破棄（拡張時） | 端点処理 |

ゴール判定は2026-10-11に確定済み。それ以外は、MVPの実装中の調整でも大きな再設計にはなりにくい。

---

## 12. 参考資料・出典

- 国土交通省 国土数値情報 鉄道データ（N02・2025年度）: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html （2025-12-31時点、CC BY 4.0）
- MapLibre GL JS公式: https://maplibre.org/maplibre-gl-js/docs/
- OpenFreeMap公式・利用規約: https://openfreemap.org/ / https://openfreemap.org/tos/
- Vercel Hobby: https://vercel.com/docs/plans/hobby
- Vercel Fair Use: https://vercel.com/docs/limits/fair-use-guidelines
- OpenStreetMap Copyright: https://www.openstreetmap.org/copyright

正式公開時には、実際に配信に使う地図スタイル・タイルのクレジットと鉄道データの帰属表示を、仕様書の一般説明ではなく**アプリの画面に**実装すること。
