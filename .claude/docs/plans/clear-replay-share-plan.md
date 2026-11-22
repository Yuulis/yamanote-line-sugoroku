# Clear screen replay and X image share (#69): implementation plan

## Summary

保存済みの移動履歴からクリア結果を導出し、実地図での経路リプレイ、５種類のハイライト、X 向けの画像共有を追加する。初回クリアとクリア済みセーブの再表示は、既存の `deriveTurnMomentDisplay().showClear` を公開境界として同じ経路を通る。

スマートフォンでは結果数値、共有、「もう一度遊ぶ」を優先し、移動履歴は初期状態で閉じる。PNG には実地図、全走行経路、タイトル・版名、既存の３数値、地図と鉄道データの出典を収録する。共有文面は `buildShareText` の既存出力を維持する。

変更範囲は表示、操作、画像出力、共有計測に限る。エンジン、RNG、ルール、セーブ形式、公開鉄道データは D5 の対象とし、ランタイム依存は追加しない。ランキング、端末内のベスト記録・結果履歴、シミュレーション順位は対象外。

## Revision 2 changes

- 保存レコードの判別、乗車系統と方向の検証、０区間の乗換、同駅回送、rapid・oversleep の区間数、出目調整の計数を定義した。最遠駅の候補を保存区間の両端、回送先、出発駅に確定した。
- `stepPath` の前後に厳密な描画検証を置く。欠落や不連続が１区間でもあれば `route = null` とし、トポロジーから求めたハイライトは表示する。
- リプレイの現在位置を区間インデックスと距離割合で表す。外部ストアを地図から購読し、style 再読み込み、タブ非表示、OS 設定変更、離脱を処理する。
- 結果のライフサイクル、クリア用カメラ、レイアウト、読み上げを名前付きモジュールに置く。`GameApp.tsx` と `RailwayMap.tsx` の変更は配線に限る。
- Safari 用の画像クリップボード呼び出しと、デスクトップの X 遷移順序を明記した。画像コピーと X 遷移は別々の結果として扱う。
- S5 で Chromium、Firefox、WebKit の実画像出力を full CI で検証する。WebKit の実ダウンロードも S5 で検証し、合格後に S6 の共有操作を接続する。

## Revision 3 changes (lead, after Codex validation round 2)

- S1：feature の順序は `findSegment` が返す方向付き区間の `geometryFeatureIds` をそのまま使い、反転しない。`stepPath` と `movePath.ts` は変更しない。2 feature 以上の順方向・逆方向の保存レコードをテストする。
- S5：PNG の鉄道データ出典は、出典名・ライセンス名・ライセンス URI を構造化して受け取り、URI を画像に描く。canvas に渡す文字列を完全一致で検査する。
- S6：X の intent は Feature Brief どおり `/intent/post` に統一する。
- S3 は全経路の GeoJSON builder と静的な全経路の入力までを出荷する。S4 は部分描画のカーソルとストアを追加し、export 用の全経路の経路を変えない。
- S5 の probe は `src/features/map/e2eHook.ts` の `exposeMapForE2E` を拡張して公開する。現在の hook は呼ぶたびに `window.__sugorokuE2E` 全体を置き換えるため、既存のキーを保ったまま probe を追加し、ライブ地図の公開・破棄をまたいで残るようにする。

## Assumptions for user confirmation

| 確認事項 | 採用案 |
|---|---|
| 初期カメラ | 初回クリアと再表示の両方で、結果カードに隠れない領域へ全経路を即時フィットする。リプレイ中も同じ構図を使い、地図やカードの実測寸法が変わった場合に再フィットする。 |
| 演出「なし」 | 明示操作によるリプレイを利用できる。ゲーム内演出の速度設定から独立させる。 |
| OS の視差効果を減らす設定 | 全経路を即時表示し、操作名は「全経路を表示」とする。再生中に設定が有効になった場合も即時完了する。 |
| 再生時間 | １区間 450 ms を基準に既存の距離補正を適用し、全区間を比例圧縮して最大 12 秒とする。再生中は同位置の「全経路を表示」で完了できる。 |
| 共有・離脱 | コピー、共有、保存、X リンクを受理した時点で再生を完了する。共有キャンセル後も全経路を表示する。タイトル、再スタート、版切替では再生を完了状態にしてから所有する処理を破棄する。タブが非表示になった時点でも完了する。 |
| 集計表示 | 最長の同値は時系列で先にその最終長へ達した乗車、最多の同値は候補路線グループの初回走行順、最遠の同値は初回訪問順。最長の駅数は出発駅を除く到着回数。アイテムは種類別件数を表示し、０件は「なし」とする。 |

## Architecture Design

### 公開と所有権

`usePublishedClearResult` を `GameApp` から呼び、公開された完了ゲーム、版 ID、セッション ID、履歴参照を受け取る。キャッシュの依存には network、geometry、presentation、display の参照も含める。履歴の長さだけで同一性を判断しない。結果画面の連続した公開期間に単調増加する `generation` を割り当て、`ClearScreen` をそのキーでマウントする。geometry の準備などによる同一公開期間内のデータ更新では、履歴ページを維持する。経路が差し替わる場合は経路単位の古い再生・画像処理を破棄する。

結果所有者は再生ストア、画像生成、共有アクションの実行ガード、通知を管理する。`ClearScreen` は履歴ページ、開閉、見出しフォーカスと内部スクロールを所有する。タイトルから同じセーブを開き直す場合も、新しい公開期間として初期化する。ブラウザー再読み込みでは既存のロード経路でモデルを再構築する。`game_clear` の既存発行条件と公開時期を保持する。

### 保存履歴とハイライト

1. `MoveRecord` なら `serviceId` と `direction`、`item-ride` なら `resolvedRide` を使う。`deadhead` は最初に分岐し、`resolvedRide` を参照する経路から外す。回送先を訪問候補に追加し、同駅回送でも乗車と描画の連続性を切る。
2. 乗車は保存された `traversedSegmentIds` を順に検証する。実乗車サービスが存在し、保存方向が利用可能であることを確認する。`fromStationId` から `nextStationId` と `findSegment` で方向付き隣接駅と期待区間を求め、保存 ID と照合する。全区間処理後の駅を `toStationId` と照合する。０区間なら両端が同駅であることを確認する。出発駅を起点にレコード間の駅の連鎖も照合する。回送は区間が空で、`relocation` の両端がレコードと一致し、到着駅が存在することを確認する。
3. 最長は同じ `lineGroupId` の連続到着回数。到着時の `landing` が別グループならその場で終了し、次ターンの `resolvedRide` が別グループの場合も終了する。０区間の乗車でもこの判定を行う。途中で別グループに移り、次の実走行までに元へ戻った場合は新しい乗車とする。同グループ内の運行系統変更、折り返し、ターン境界は継続できる。
4. 最多は実走行区間を再走行込みでグループ別に数える。`config.targetServiceId` の属するグループを除外し、候補が空なら行を省く。
5. 最遠は `config.startStationId` を初期候補にし、保存区間の出発・到着駅と回送先を時系列で追加する。rapid や oversleep のターンで通った、実乗車サービスの停車パターン上の駅を含む。１区間の線形を構成する内部 geometry 接合駅は候補外。駅の代表座標で大圏距離を計算し、丸め前に比較して小数１桁の km で表示する。最長は走行が空なら行を省く。最遠は有効な出発駅だけでも 0.0 km を表示できる。
6. アイテムは保存された `itemEvents` を読む。`consumed.item` と `cancelled-by-certificate.certificate` をインスタンス ID で重複排除して使用数へ加え、取消対象の `item` を取消イベントごとに回避数へ加える。回送の消費も含める。出目調整は保存イベントの `consumed` で１回数える。`adjustment`、出目、`pips`、予定 hop 数から走行や消費を補完しない。

### 地図と読み上げ

クリア経路は独立した source と輪郭・本線の２レイヤーを使う。実乗車サービスの表示色を使い、共有 geometry の所有サービスは色決定に使わない。通常鉄道レイヤーを復元した直後に結果レイヤーを復元し、最新のストア値を適用する。クリア中は既存の操作非表示と地図 `inert` を維持し、地図クレジットと失敗時の案内は結果画面から読めるようにする。

`ClearScreen` の常設 `ClearAnnouncements` を、完了、ページ移動、リプレイ、共有、クリア時の地図・画像状態の唯一の polite live region とする。公開時は空でマウントし、既存の `turnDisplay.clearAnnouncement` を既存と同じ公開タイミングで effect から１回流す。見出しフォーカスとカード先頭へのスクロールは現行の layout effect を保持する。`ItemEventNotice` の本文と目に見えるゴール文言を保持し、クリア時の live region を `ClearAnnouncements` に移す。ページ番号、共有結果、地図のエラー文は元の表示位置に置き、重複する live 属性を外す。ページ番号は従来どおりナビゲーション内で読める。セーブ失敗の警告文と alert は保持する。フレームや読み込み進捗の連続通知は行わず、操作と状態遷移を通知する。

## Module Structure

| パス | 責務 |
|---|---|
| `src/features/game/clearResult.ts` | 保存レコードの正規化、ハイライトと結果モデル。`summarizeGame`、`buildShareText`、`PresentationResolver` を再利用する。 |
| `src/features/game/clearRoute.ts` | `animation/movePath.ts` を使う厳密な描画パス構築、bounds、脚、距離カーソルによる GeoJSON の部分描画。 |
| `src/features/game/usePublishedClearResult.ts` | 公開期間と世代、再生・画像・共有の所有権。画面と地図に渡す入力を組み立てる。 |
| `src/features/game/clearReplayStore.ts` | 距離ペース、フレーム購読、再生 run の中断と完了。 |
| `src/features/game/components/ClearScreen.tsx`、`ClearAnnouncements.tsx`、`ItemEventNotice.tsx`、`clearScreen.css` | 結果 UI、単一の読み上げ、電話の履歴開閉、既存 UI の互換。`src/styles.css` からクリア専用スタイルを移し、既存 import 順と cascade を確認する。 |
| `src/features/map/clearRouteLayers.ts`、`useClearRouteMap.ts`、`clearRouteCamera.ts` | 共通レイヤー、style 復元、命令的ストア購読、実測フィットと padding の復元。 |
| `src/features/map/routeImage.ts`、`src/features/game/useClearRouteImage.ts` | export map factory、描画とエンコード、中断、生成済み PNG の準備と解放。 |
| `src/features/game/resultImageShareActions.ts`、`resultShareActions.ts` | 画像共有と X・保存のブラウザー境界。既存テキストアダプターの２引数 factory と戻り値を維持する。 |
| `src/app/GameApp.tsx`、`src/features/map/RailwayMap.tsx` | 既存の公開判定、ref、style 復元点、map 状態、結果 UI への配線。既存のファイル長に対する例外を差分レビューに記録する。新しい observer、集計、タイムライン、共有処理は各モジュールに置く。 |
| `src/features/analytics/analytics.ts`、`public/privacy.html` | `result_share` の許可値と利用者の操作による X 遷移・共有保存計測の説明。 |

## Interface Design

### 結果と経路

`GameState`、`ItemGameState`、`MoveRecord`、`ItemTurnRecord`、`LandingChoice`、`Position` などは既存型を import する。以下の形をモジュール間の契約とする。

```ts
interface ClearResultInput {
  readonly game: GameState | ItemGameState;
  readonly network: RailwayNetwork;
  readonly geometry: GeometryIndex;
  readonly presentation: PresentationResolver;
  readonly display: EditionDisplay;
}

type SavedMove = MoveRecord | ItemTurnRecord;

interface ClearHop {
  readonly recordIndex: number;
  readonly hopIndex: number;
  readonly event: SegmentTraversedEvent;
  readonly lineGroupId: string;
  readonly color: string;
}

type ClearRecordTraversal =
  | {
      readonly kind: "ride";
      readonly ride: LandingChoice;
      readonly landing: LandingChoice | null;
      readonly hops: readonly ClearHop[];
    }
  | { readonly kind: "deadhead"; readonly toStationId: string }
  | { readonly kind: "invalid" };

interface ClearRouteLeg {
  readonly firstStepIndex: number;
  readonly endStepIndexExclusive: number;
  readonly serviceId: string;
  readonly lineGroupId: string;
  readonly color: string;
}

interface ClearRoute {
  readonly steps: readonly StepPath[];
  readonly legs: readonly ClearRouteLeg[];
  readonly bounds: readonly [southWest: Position, northEast: Position];
}

interface ClearHighlights {
  readonly longestRide: {
    readonly groupId: string;
    readonly count: number;
    readonly fromStationId: string;
    readonly toStationId: string;
  } | null;
  readonly mostUsedLine: { readonly groupId: string; readonly count: number } | null;
  readonly farthestStation: { readonly stationId: string; readonly distanceKm: number } | null;
  readonly usedItems: ReadonlyMap<ItemKind, number>;
  readonly avoidedItems: ReadonlyMap<HarmfulItemKind, number>;
}

interface ClearResult {
  readonly summary: GameSummary;
  readonly shareText: string;
  readonly highlights: ClearHighlights;
  readonly route: ClearRoute | null;
}

function mapSavedRecord(
  record: SavedMove,
  recordIndex: number,
  expectedFromStationId: string,
  input: ClearResultInput,
): ClearRecordTraversal;

function deriveClearResult(input: ClearResultInput): ClearResult;
```

`ClearHop.event` は `stepPath` に渡せる `segment-traversed` イベントを組み立てる。`newlyCompleted` はこの機能で使用せず `false` とする。全走行をグローバルな `steps` の順へ平坦化し、脚の範囲は半開区間で全 step を１回ずつ覆う。乗車サービスの変更、別グループへの乗換、回送、接合座標の違いで描画脚を切る。各脚は走行方向に沿う。`bounds` は最遠駅候補やホーム座標から作らず、検証済みの全描画点から計算する。

描画前に、各保存区間に非空の `geometryFeatureIds` があることを確認する。（Revision 3）feature の順序は、保存 hop ごとに `findSegment` が返す**方向付き区間**の `geometryFeatureIds` をそのまま使う。方向付き区間の feature 列は逆方向の乗車でも `from` → `to` の走行順に並んでおり、各 feature の向きは既存の `orientPath` が駅 ID から解決する。feature 列を反転してはならず、`stepPath` のシグネチャも変更しない（`movePath.ts` は変更対象外）。出荷データ 3,988 本の方向付き区間すべてで、保存順の feature 列が記録された両端を接続することを Codex が確認済み。各 feature の存在、接続駅、厳密な端点接合、最終到着、各点の有限な経緯度と描画可能範囲、２点以上かつ正距離を検証してから `stepPath` を呼ぶ。返った点列と `cumulative` の長さ、有限・単調非減少の距離、正の `total` を確認する。重複点は許容する。描画できる走行が０区間の場合も `route = null`。有効なトポロジーは描画失敗から独立して集計する。トポロジー自体が無効なレコードでは、その乗車の区間を集計せず連続性を切り、次の検証可能なレコードへ進む。保存された数値、履歴表示、独立したアイテム集計は保持する。

### リプレイと地図

```ts
type ClearReplayCursor =
  | { readonly kind: "full" }
  | {
      readonly kind: "partial";
      readonly stepIndex: number;
      readonly distanceFraction: number;
    };

interface ClearReplayStore {
  getSnapshot(): ClearReplayCursor;
  subscribe(listener: () => void): () => void;
  start(): void;
  finish(): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

interface ClearReplayStoreInput {
  readonly route: ClearRoute;
  readonly scheduler: FrameScheduler;
  readonly onPlayingChange: (playing: boolean) => void;
  readonly visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  readonly reducedMotion: boolean;
}

function createClearReplayStore(input: ClearReplayStoreInput): ClearReplayStore;

type ClearRouteGeoJson = GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  { serviceId: string; lineGroupId: string; color: string }
>;

function buildClearRouteGeoJson(
  route: ClearRoute,
  cursor: ClearReplayCursor,
): ClearRouteGeoJson;
```

距離補正と補間は `timeline.ts` の `hopDurationMs` と `easeInOut` を再利用する。再生専用の開始時刻と累積区間時間を持つループを `FrameScheduler` で駆動する。`runner.ts` の座標から区間を逆引きする経路は設けず、既存ゲームの runner の契約を維持する。再生開始で `{stepIndex: 0, distanceFraction: 0}` を同期発行し、最初のフレームを時間原点とする。区間境界ちょうどでは次の step の割合０を示す。全区間終了時の snapshot は `full`。完了や開始に伴う状態変化だけを React 側に送る。`getSnapshot` は内容が更新されるまで同じ参照を返し、購読者は登録直後に現値を読む。

部分描画では `stepIndex` より前の step を全点採用し、現在 step の `total * distanceFraction` までを `cumulative` で切る。到達済み頂点を順に採用し、次の正距離の辺で補間点を追加する。頂点と同位置なら重複追加を避け、描画できる２点未満の脚は出力しない。回送や脚の境界は時間ゼロのジャンプとし、線を加えない。ループや自己交差でも区間・点の順序で一意に切れる。全経路の GeoJSON は経路参照ごとに再利用する。

`start` は再生中の連打を無視し、完了後は最初から開始する。hidden または reduced motion なら即時 `full`。`visibilitychange` を購読し、hidden になったときは最初の rAF 前でも `finish` する。`finish` は冪等で rAF を取り消し `full` を公開する。各 rAF は run ID を検査し、旧 run を無効にする。`dispose` は購読、visibility listener、rAF を解除し、旧世代へのコールバックを禁止する。

source ID は `clear-traveled-route`、レイヤー ID は `clear-traveled-route-outline` と `clear-traveled-route-line`。既存駅レイヤーのうち、`map.getStyle().layers` 順で最初に現れる円・ラベルを `beforeId` にする。駅レイヤーがない style では最初の symbol を使い、それもなければ末尾に追加する。輪郭、本線をこの順で挿入する。本線は GeoJSON の `color`、両線とも丸い端と接合を使う。route レイヤー処理は live と export で共有する。`useClearRouteMap` は style 不在時に source 書き込みを保留し、既存 `addRailwayLayers` 後の復元フックで再登録して最新 snapshot を反映する。クリア終了時は購読を止め、レイヤー、source の順で外す。既存のゲーム／タイトル側のカメラ処理とレイヤー更新に制御を返し、通常の位置・進捗・ゴール表示を確認する。

カメラは結果カードの実 DOM ref と map container を観測する。デスクトップは片側カード、電話は下部シートとし、交差幅または交差高に基本余白 24 CSS px を加える。四辺の padding として渡し、残り幅・高のいずれかが 64 CSS px 未満の間は既存カメラを保持する。１点の bounds は `jumpTo` で中心を合わせ、ズームは 13 以下。通常は `fitBounds` を `animate: false`、`maxZoom: 13` で行う。失敗 map、未計測、無効 bounds、同一寸法ではフィット処理を見送る。`ResizeObserver` と既存 viewport／orientation 通知を rAF にまとめる。入場前の padding を保存し、離脱または map 差替え時に同じ map へ復元する。カメラ cleanup と通常モードの最初のカメラ更新の順序をテストする。

### PNG 生成

```ts
interface RouteImageInput {
  readonly route: ClearRoute;
  readonly title: string;
  readonly editionName: string;
  readonly summary: GameSummary;
  readonly railwayCredit: {
    readonly source: string;
    readonly licenseName: string;
    readonly licenseUrl: string | null;
  };
}

interface ExportMapFactory {
  create(container: HTMLElement, options: Omit<MapOptions, "container">): ExportMap;
}

interface RouteImageDependencies {
  readonly mapFactory: ExportMapFactory;
  readonly createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

interface PreparedRouteImage {
  readonly blob: Blob;
  readonly file: File;
  readonly url: string;
  readonly filename: string;
}

type RouteImageState =
  | { readonly kind: "unavailable" | "pending" | "failed" }
  | { readonly kind: "ready"; readonly image: PreparedRouteImage };

function renderRouteImage(
  input: RouteImageInput,
  signal: AbortSignal,
  dependencies: RouteImageDependencies,
): Promise<Blob>;
```

`ExportMap` は実 MapLibre map の、イベント登録・解除、source／layer 操作、fit、`triggerRepaint`、`redraw`、canvas 取得、`remove` に必要なメソッドへ絞る。factory は listener を呼び出し側が同期登録できる、生成直後の map を返す。ユニット用の factory も同契約とする。

1. 開始前に abort を確認する。画面外に固定サイズの 1200×675 CSS px のコンテナを作り、`aria-hidden` を設定する。layout 寸法は維持する。abort と 15 秒タイマーを設定し、map を生成する。実 basemap style、`pixelRatio: 1`、`interactive: false`、`fadeDuration: 0`、`attributionControl: false`、`canvasContextAttributes: { preserveDrawingBuffer: true }` を指定する。
2. 生成直後、同じ同期処理内で `error` と context loss、続いて `style.load` を登録する。context loss は MapLibre イベントまたは canvas の `webglcontextlost` を監視する。style 準備後に `idle` を登録してから full GeoJSON の source とレイヤーを追加し、上下の情報帯を避けた padding で即時 fit する。設定完了フラグを立て、`triggerRepaint()` を呼ぶ。設定完了前の `idle` は無視し、待機を継続する。
3. 設定完了後の最初の正常な `idle` で多重処理を遮断し、`redraw()` と 2D canvas への `drawImage` を同じ呼び出し内で連続実行する。property と画像の寸法を 1200×675 と照合する。style・tile・glyph・sprite を含む resource error は fatal とし、エラー後の `idle` を成功にできない。コピー直後に map、map listener、コンテナを解放する。
4. 2D canvas の高コントラスト帯にタイトル、版名、`GameSummary` の３数値、`MAP_CREDITS`、`© OpenStreetMap contributors (openstreetmap.org/copyright)`、manifest 由来の鉄道データ出典とライセンスを描く。（Revision 3）鉄道データの行は、manifest の出典名、ライセンス名、ライセンス URI をプレーンテキストで含める。ライセンスが `CC_BY_LICENSE_NAME` のときの URI は `attribution.ts` の `CC_BY_URL` を使う（CC BY 4.0 §3(a)(1)(C)：画像がアプリの外に出ても URI が残るようにするため）。`RouteImageInput.railwayCredit` は不透明な文字列にせず、`{ source: string; licenseName: string; licenseUrl: string | null }` とする。合成の unit test では、canvas に渡す文字列の完全一致（URI を含む）を検査する。credits は既存 attribution モジュールの出典解決を共用し、DOM の HTML 文字列を転写せずテキストとして組み立てる。12 CSS px 以上を基準に長い出典は折り返す。ハイライトや再生状態は PNG 入力に含まれない。
5. `toBlob` を `image/png` で呼び、非空の PNG を受け取る。abort とタイムアウトは encode 完了まで有効。終了処理は一度だけ実行し、`null`、同期例外、abort、timeout、遅延 callback を区別する。2D canvas も処理後に解放する。
6. 画像 hook は Strict Mode の setup–cleanup–setup を考慮し、生成開始を取り消し可能なタスクに置く。結果世代・経路世代を照合した成功だけを採用し、元の `Blob`、固定の安全な `.png` ファイル名を持つ `File`、object URL を１回準備する。download 直後も URL を維持する。結果 disposal で通常の URL は revoke する。直近に download を開始した URL は、その操作から最低５秒まで寿命を延ばす。遅延解放の所有者は当該 URL のみを保持し、新しい結果の URL を触らない。

### 共有アダプター

```ts
type ShareOutcome = "success" | "failed" | "cancelled";

type ClipboardImageResult =
  | "copied"
  | "unavailable"
  | "sync-failed"
  | "rejected";

type XNavigationResult =
  | "started"
  | "blocked"
  | "open-threw"
  | "opener-failed"
  | "location-failed";

interface DesktopXAttempt {
  readonly clipboard: Promise<ClipboardImageResult>;
  readonly navigation: XNavigationResult;
}

interface ResultImageShareActions {
  canShareFile(file: File): boolean;
  shareFile(file: File, text: string): Promise<ShareOutcome>;
  copyImageAndOpenX(blob: Blob, text: string): DesktopXAttempt;
  saveImage(url: string, filename: string): "dispatched" | "failed";
}
```

注入する依存は、bind 済みの `navigator.canShare`、`navigator.share`、`clipboard.write`、`ClipboardItem` factory、`window.open`、download anchor dispatch。既存 `createResultShareActions(clipboard, shareApi)` の `copy`、`share`、`canShare` を保持し、画面の単体呼び出しも従来のテキスト操作で動作する。

- **電話幅または coarse pointer。** 準備済み `File` で `canShare({ files: [file] })` を評価する。API 不在、false、同期例外は利用不可。操作を受理したクリック中に `share({ files: [file], text })` を同期的に呼び出し、後で promise の結果を処理する。テキストには URL を含む既存文面をそのまま使う。`AbortError` は `cancelled` とし、自動の遷移や失敗警告を出さない。対応外・拒否時は画像保存とテキスト用 X リンクを案内する。
- **デスクトップ。** `finish()` と多重実行ガードを同期評価した後、以下を同じクリックスタックで実行する。`await`、次のタスク、effect を挟まない。

  ```ts
  const item = new ClipboardItem({ "image/png": Promise.resolve(blob) });
  const write = navigator.clipboard.write([item]);
  const popup = window.open("about:blank", "_blank");
  popup.opener = null;
  popup.location.href = intentUrl;
  ```

  実装では各境界を捕捉する。clipboard 不可なら `unavailable`、constructor または write 呼び出しの同期例外なら `sync-failed`、write promise の拒否なら `rejected`。write の結果ハンドラーを同期登録し、clipboard の失敗時も popup を試す。`open` が null なら `blocked`、例外なら `open-threw`。popup が得られたら `opener = null` を設定して確認し、失敗時は `opener-failed`。切断後に location を代入し、失敗なら `location-failed`。`opener` または location で失敗した未使用タブは、可能なら閉じる。遷移とコピーの両方が成功した場合に限り「X の投稿画面に画像を貼り付けてください」を表示する。
- **X リンクと保存。** X の intent は Feature Brief どおり `https://x.com/intent/post?text=${encodeURIComponent(text)}` に統一する（Revision 3。共通の URL builder、デスクトップの遷移、テキスト用リンク、browser-context の intercept、URL の assertion のすべてで `/intent/post` を使う）。文面は URL、改行、空白、ハッシュタグを含む全文を１回エンコードする。テキスト用リンクは `target="_blank" rel="noopener"` を持ち、準備中や画像失敗時も使える。画像が利用可能なら、すべての端末に「画像を保存」を提供する。保存は実 `<a download>` と object URL を使い、画像共有非対応端末には必要に応じて画像を開くリンクを示す。

### 計測

`result_share` は `method` と `outcome` だけを送る。`EVENT_VALUES.method` に `x` と `save` を追加する。テキスト共有の `shared` は発行箇所で `success` に正規化し、アダプターの返り値を変更しない。操作受理ごとに１イベント。操作ガードで拒否された連打、capability 判定、画像準備処理からは発行しない。

| 操作 | method | outcome |
|---|---|---|
| 結果文面のコピー | `copy` | write 解決で `success`、不可・失敗で `failed` |
| 既存のテキスト共有 | `share` | `shared` → `success`、`cancelled`／`failed` はそのまま |
| ファイル共有 | `x` | OS API 解決で `success`、`AbortError` で `cancelled`、他の失敗で `failed` |
| 画像コピー＋X | `x` | `copied` と `started` の両方で `success`、どちらかが失敗なら `failed` |
| テキスト用 X リンク | `x` | 受理したリンクの既定遷移を開始する時点で handoff attempt として `success` |
| 画像保存 | `save` | ブラウザーへの download 要求を dispatch できれば `success`、同期失敗は `failed` |

OS の共有先、X の読み込み・投稿完了、保存完了はブラウザー境界の先にある。受理済みアクションの結果イベントは離脱後に settle しても１回発行できる。UI 更新、フォーカス変更、案内表示は現世代だけに許可する。既存 opt-out は維持し、文面、画像、URL、駅、履歴、seed はイベントに含めない。

## Data Flow

1. 既存ゴール演出を経て `showClear` が公開される。結果モデルを導出して見出しへフォーカスし、単一の live region に完了通知を流す。
2. 結果画面に要約、セーブ警告、アイテム通知、３数値、両コレクションカウンター、テキスト共有、主要操作を配置する。電話の履歴とハイライトは主要操作の後ろに置く。履歴は１組の DOM／ページ状態を使い、電話幅で `<details>` により初期状態で閉じる。デスクトップは履歴を初期表示する。幅切替後もページ番号を保持し、ページ移動時に履歴リストの先頭へ戻す。
3. 地図が利用可能なら全経路へフィットする。リプレイ操作で外部ストアが部分カーソルを発行し、地図だけが GeoJSON を更新する。完了で全経路へ戻す。
4. PNG は全経路からバックグラウンドで準備する。既存テキスト操作とテキスト用 X は準備状況に依存しない。準備済み画像を使用する操作はクリック中に必要な API を始める。
5. タイトル、再スタート、版切替では結果の世代を終了し、画像処理を abort、再生を dispose、地図購読を解除する。旧共有の表示更新を無効にし、ページや通知は次回公開時の初期値に戻す。

## Error Handling Strategy

| 条件 | 対応 |
|---|---|
| 保存トポロジーの不整合、欠落 geometry、空・縮退パス | `route = null`。取得できた表示モデル、履歴、文面を維持する。利用不可の理由は短い表示で伝える。 |
| live map 不可、style 再構築 | live map 不可ではカメラ・リプレイ操作を利用不可にし、読み上げを結果画面に集約する。描画可能な `route` から export は独立して試行できる。style 再構築中のフレームは最新 snapshot だけを保持する。 |
| export error、context loss、timeout、encode 失敗 | 失敗状態に遷移し、listener、timer、map、DOM、canvas を解放する。共有はテキスト経路を維持する。離脱による abort では旧画面への失敗通知を出さない。 |
| clipboard 成功・popup 失敗、またはその逆 | コピーと遷移の結果を個別に表示する。両方の成功までは貼り付け案内を出さない。テキスト用 X と画像保存を利用できる。 |
| ネイティブ共有キャンセル・拒否 | キャンセルは静かに終了し、全経路表示を維持する。拒否は保存とテキスト用 X を案内する。 |
| 連打、離脱、遅延 callback | 同じ実行中の操作を重ねない。結果・経路世代と run ID を照合し、古い async 処理が新しい結果へ反映されることを防ぐ。 |

## Implementation Steps

各ステップはテストを先に追加・更新し、そのステップ単体で緑にする。Codex Luna xhigh が実装し、Sol low がレビューする。lead は差分と受入結果を独立確認し、commit、push、対象 SHA の CI 確認を行う。`visible: yes` は画面レビューとユーザー承認後に次へ進む。

### 共通受入 G

```bash
npm run typecheck
git diff --check
npm test
npm run build
```

Feature Brief の lint に相当する npm スクリプトは現行 `package.json` にない。G と既存 CI を実行する。以下の E2E コマンドは G に追加する。

### S1 — 保存結果モデルと厳密な経路

- **visible:** no
- **goal:** 結果数値、共有文面、ハイライト、描画可能な全経路を固定する。
- **files:** `clearResult.ts`、`clearRoute.ts`（`animation/movePath.ts` は変更しない）、`tests/unit/clear-result.test.ts`、`tests/unit/clear-route.test.ts`。
- **tests first:** classic と item の保存 fixture で３数値と共有全文をバイト単位で比較する。rapid の hop 数が `pips` を超えるケース、ゴールで止まる oversleep、出目調整の１回計数、同駅回送、０区間で別グループへ乗換、次ターンで元のグループへ戻るケース、ターン間継続、最長の同長が別ターンで成立するケースを含める。対象グループ全体の除外、最多同値、丸め前の最遠同値・丸めで同値に見える異距離、geometry 接合駅の除外を確認する。順方向・逆方向の複数 feature、共有線形、空リスト・欠落 feature・不正座標・接合ギャップを検証する。geometry だけ失敗した際はハイライトが同値であることを確かめる。
- **acceptance:** G。既存のゲーム内アニメーション unit と legacy save fixture を含む全 unit が緑。
- **estimated LOC:** 240–380。

### S2 — 結果公開、読み上げ、電話レイアウト

- **visible:** yes
- **goal:** 公開所有者、ハイライト UI、１つの履歴と読み上げを接続する。
- **files:** `usePublishedClearResult.ts`、`ClearScreen.tsx`、`ClearAnnouncements.tsx`、`ItemEventNotice.tsx`、`clearScreen.css`、`styles.css`、`GameApp.tsx` の配線、map fallback の表示／読み上げ配線、関連 unit・E2E。
- **tests first:** `game-app-turn-moments.test.ts`、`hud-progress-components.test.ts`、`result-share.test.ts` で公開境界、３つの演出レベル、ゴール通知１回、map unavailable 時の単一 polite status、見出し focus、保存警告、テキスト共有 fallback を確認する。順序依存の共有ボタン操作は accessible name で指定する。`text-wrapping`、`capital-region`、`items`、`tokyo-suburban`、`full-game` の履歴利用箇所を監査し、実 viewport で disclosure が閉じている場合は表示される「移動履歴」を操作する。20件、ページ移動、スクロールリセット、最終項目の折り返し、再ロード前後の履歴同値を保持する。
- **acceptance:** G と以下。320×568 では保存警告を含めて横スクロールを検査し、主要操作まで履歴をスクロールする必要がないことを確認する。

```bash
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/items.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/full-game.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/accessibility.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
```

- **estimated LOC:** 220–360。

### S3 — 全経路レイヤーとカメラ

- **visible:** yes
- **goal:** 実地図で全経路を表示し、クリアカードと地図の実測値に合わせる。
- **files:** `clearRouteLayers.ts`、`useClearRouteMap.ts`、`clearRouteCamera.ts`、`RailwayMap.tsx` と `GameApp.tsx` の配線、結果画面のカード ref・credits、`title-map-mode.test.ts`、`clear-route-map.test.ts`、`clear-replay-share.spec.ts`。
- **tests first:** source／layer 順、駅レイヤーなしの挿入点、style 復元、再ロードとタイトルからの再表示、同一 document 内のタイトル往復、再スタート、版変更、１点・余白不足・失敗 map、履歴を開いた状態の resize、padding 復元、ゲーム内レイヤーと操作の復帰を確認する。既存 map-double を必要な実 API に合わせて拡張する。
- **acceptance:** G と下記クリア E2E。電話ケースには `@layout` を付ける。

```bash
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --workers=2
npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts --project=phone-chromium --workers=2 --grep '@layout'
```

- **estimated LOC:** 200–320。

### S4 — 外部ストアと部分描画

- **visible:** yes
- **goal:** 地図へフレームを直接適用し、12 秒以内で実走行をたどれるようにする。
- **files:** `clearReplayStore.ts`、`clearRoute.ts`、`useClearRouteMap.ts`、`usePublishedClearResult.ts`、`ClearScreen.tsx`、`clear-replay.test.ts`、`clear-route-map.test.ts`、`clear-replay-share.spec.ts`。
- **tests first:** fake scheduler で曲線・自己交差・重複点、zero、正確な区間境界、脚間ジャンプ、12 秒上限、２回目、連打、最初の rAF 前の hidden、再生中の reduced motion、style 差し替え、離脱後に実行された旧 callback を検証する。React の結果画面が途中フレームで再描画されず、地図だけが更新されることを確認する。E2E の再生ケースは `reducedMotion: "no-preference"` を明示する。通常の reduced-motion ケースも残す。
- **acceptance:** G と S3 のクリア E2E。途中フレーム、即時完了、自然完了、２回目を状態待ちで確認する。
- **estimated LOC:** 180–290。

### S5 — PNG 基盤と３ブラウザーの出力実証

- **visible:** no
- **goal:** 製品ボタンを公開する前に、本物の MapLibre・canvas と download を既存 CI ランナーで実証する。
- **files:** `routeImage.ts`、`useClearRouteImage.ts`、`route-image.test.ts`、`clear-route-image-lifecycle.test.ts`、`tests/e2e/route-image-export.spec.ts`、既存 e2e-only map hook と専用 probe モジュール、`playwright.config.ts` の GA 環境分離。
- **tests first:** listener 登録と fit 順、初期 `idle` の扱い、`redraw` と同期コピー、３数値と４系統の出典、描画・encode 例外、`toBlob(null)`、fatal error 後の `idle`、context loss、15 秒境界、既に abort 済み、style／encode 中 abort、Strict Mode、前の版の遅延 callback、download URL の寿命を検証する。
- **browser probe:** e2e build 専用フックから固定経路を製品 exporter に渡す。map stub の固定背景と識別しやすい経路色を使い、PNG をデコードして 1200×675、非透明背景、経路色ピクセル、上下の情報帯を判定する。アンチエイリアスや字形の完全一致には依存しない。テスト用 DOM 操作で実 anchor をクリックし、`page.waitForEvent("download")` をクリック前に登録、`download.saveAs` した bytes を読み、同じデコーダーで寸法と内容を検査する。製品 build に probe を公開しない。
- **acceptance:** G と下記。PR または manual dispatch の full CI で対象 SHA の **desktop Chromium、Firefox、WebKit 全ての export probe** と **WebKit download** を確認する。WebKit のイベントが失敗した場合は実行環境・trace・再現条件を記録し、pinned runner で原因を修正する。環境固有の問題が残る場合は同じ pinned browser で保存された PNG の実 bytes まで確認する代替ゲートを lead が承認するまで S6 を進めない。

```bash
npm run test:e2e -- tests/e2e/route-image-export.spec.ts --project=desktop-chromium --workers=2
xvfb-run --auto-servernum npm run test:e2e -- tests/e2e/route-image-export.spec.ts --project=desktop-firefox --workers=2
E2E_WEBKIT=1 xvfb-run --auto-servernum npm run test:e2e -- tests/e2e/route-image-export.spec.ts --project=desktop-webkit --workers=2
```

- **estimated LOC:** 290–460。

### S6 — 画像共有、保存、計測を接続

- **visible:** yes
- **goal:** 事前生成した PNG を使って電話のファイル共有、PC の画像コピー＋X、画像保存を提供する。既存文面の操作とフォールバックを保持する。
- **files:** `resultImageShareActions.ts`、`resultShareActions.ts`、`usePublishedClearResult.ts`、`ClearScreen.tsx`、`clearScreen.css`、`analytics.ts`、`public/privacy.html`、`result-share.test.ts`、`analytics.test.ts`、`clear-replay-share.spec.ts`、E2E の共有 stub。
- **tests first:** Safari の Promise-valued item、write→open→opener→location の同期順、clipboard 同期例外と拒否、popup null／例外、opener／location 失敗と未使用タブ close、両方向の部分成功、適切な貼り付け案内を確認する。電話の実 `File` と全文、`canShare` 例外、共有キャンセル、能力なし時の明示的 fallback、離脱後の settle、二重イベント防止、`shared` 正規化、許可外属性拒否を検証する。E2E で製品「画像を保存」から開始した download の bytes をデコードする。小画面は警告と fallback がある状態も確認する。
- **acceptance:** G、S2 のレイアウト E2E、S3 のクリア E2E、S5 の出力 probe、下記の追加 E2E、実機表。対象 SHA の full CI 全４プロジェクトを lead が確認する。

```bash
xvfb-run --auto-servernum npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts --project=desktop-firefox --workers=2
E2E_WEBKIT=1 xvfb-run --auto-servernum npm run test:e2e -- tests/e2e/clear-replay-share.spec.ts --project=desktop-webkit --workers=2
```

- **estimated LOC:** 260–420。

## Test Plan

### Unit

- 保存 fixture を既存の読込経路で復元し、classic・item の３数値と共有文面全文を比較する。現行の版名と対応する結果数値で、URL を23、CJK を２とする既存文面の重みが X の280以内であることを検査する。新規ランタイム依存は使わない。
- モデルと GeoJSON は純粋テスト、再生は注入 scheduler、共有は call log 付きの注入アダプター、export は map／canvas double と fake timer で検証する。
- 通常のクリア、演出３段階、map unavailable、reload 後の再表示、タイトル往復、再スタート、edition 切替で所有期間の境界を確認する。focus、可視文言、目に見えるページ状態と読み上げをそれぞれ確認する。

### E2E

- `tokyo-suburban-before-clear-save.json` の最後の１ロールを使い、公開前後、見出し focus、既存結果値、同一結果の再表示を検証する。fixture セーブも使い、履歴と共有本文の互換を確認する。
- 320×568、390px 幅、667×375、1280×800 で、電話の初期履歴非表示、主要操作の順、44 px のタップ領域、ボタンの単行表示、横 overflow、ページ移動、地図との配置を検証する。既存のデスクトップ HUD no-scroll、電話 HUD 252 px、#66 pill の受入も維持する。
- `tests/e2e/fixtures.ts` の予期しないリクエスト検査と dead proxy を維持する。stub は `addInitScript` で同期の clipboard／file share／`window.open` を記録する。`about:blank` の偽 popup で opener・location を検査する。実 fallback リンクは popup の最初のリクエストを扱える browser-context scope で X intent に限定してローカル応答し、URL とデコード済み全文を検査する。両経路とも外部 X 送信はゼロ。
- E2E build／preview 子プロセスでは `VITE_GA_MEASUREMENT_ID` を渡さない。Vite の e2e mode の環境ファイルから値が入り得る場合は e2e コマンドに空値を明示して無効化する。外部 GA／GTM 送信ゼロを fixture で検査する。
- 出力は内容のある PNG を復号して判定する。製品 download は待ちを先に登録し、保存された bytes を検査する。固定 sleep は使わない。

### CI matrix

| Playwright project | 必須受入 |
|---|---|
| `desktop-chromium` | S5 実 export と download、S6 PC share・保存・fallback、クリア／レイアウト回帰 |
| `desktop-firefox` | S5 実 export と download、S6 PC share・保存・fallback。CI の xvfb と Mesa EGL セットアップを使う |
| `desktop-webkit` | S5 実 export と download、S6 PC share・保存・fallback。pinned Playwright Noble container の既存 shard を使う |
| `phone-chromium` | `@layout` のクリア優先配置、履歴、ファイル共有と拒否・キャンセル、画像保存、fallback |

Feature branch の quick push は desktop Chromium のみ。S5 と S6 は PR または `workflow_dispatch` で full scope を動かし、対象 SHA と全 shard を確認する。フォールバックの成功だけで export 成功の代わりにしない。

### Manual device checklist

| 環境 | リリース前に確認する内容 |
|---|---|
| 実機 iPhone Safari | 縦横切替、OS reduced motion、クリア再表示、X への file share、X が文面を落とした際の「結果をコピー」での復旧、Files への保存と添付、再生中に共有した後の全経路。 |
| 実機 Android Chrome、ファイル共有非対応のモバイルブラウザー | ネイティブ共有で PNG と文面が渡る場合の挙動、非対応時のテキストリンクとファイル添付、キャンセル。 |
| macOS Safari、Chrome または Edge、Firefox | 同じクリックで write を開始して X が開くこと、タブへフォーカスが移った後のコピー結果、実際の貼り付け、popup block、clipboard 拒否、ログイン経由の intent。 |
| 低メモリ端末と実 basemap | 短い周回と遠方を含む長距離で、全経路、版名、３数値、全出典の可読性、端末負荷、冷キャッシュ、resource 失敗、生成中のタイトル復帰と再クリア。 |

実機の X テストは composer と貼り付け・添付を確認する。端末、ブラウザー、OS、結果を lead が記録し、X 側での文面保持、Safari のフォーカス移動後の書き込み、低メモリ端末の結果をリリース受入で確認する。

## Risks and Mitigations

| リスク | 対策 |
|---|---|
| geometry の一部欠落や逆向き共有 feature による誤描画 | 保存方向を先に検証し、geometry の順序と座標を完全照合する。失敗時は経路を無効にし、トポロジー集計を維持する。 |
| 長い履歴で source 更新が重い | 累積距離と時間、全経路、脚を事前計算し、フレーム更新先を map source に限定する。長い fixture と 12 秒上限で確認する。 |
| export map の WebGL context、リソース障害、ランナー差 | 1200×675、DPR 1、１結果１生成、転写直後の解放、15 秒上限を適用する。S5 の３ブラウザー実出力と上記実機ゲートで確認する。 |
| popup・clipboard・OS 共有の差 | 画像を事前生成して同期順序を固定し、個々の失敗からテキスト用 X、文面コピー、画像保存を選べるようにする。 |
| カードが地図と操作を覆う、通知が重なる | 実測 padding、１組の履歴 DOM、主要操作を先に置く配置、単一の polite live region を使用する。警告と fallback を含む 320×568 の回帰テストを維持する。 |
| 計画時点の未検証事項 | この Revision 2 は読み取りと計画作成まで。ファイル変更、テスト実行、CI 確認、実機確認は実装ステップの受入事項とする。 |
