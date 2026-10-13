# Design Document — 要件定義書 (Requirements & Macro Design)

> **Role:** Macro-level requirements and design — *what* this project builds and *why*.
> Written at `/init`, kept current by `/design-tracker` (also invoked from `/checkpointing`).
>
> **Document map:** Shared rules → [rules/](../rules/) ·
> Root contract → [AGENTS.md](../../AGENTS.md) · State → [STATE.md](../STATE.md) ·
> Micro work progress (latest 5 checkpoints) → [PROGRESS.md](../../PROGRESS.md)

## 背景・目的 (Background & Purpose)

<!-- Why does this project exist? What problem does it solve, for whom?
     State the business/technical context and the goal in a few sentences. -->

現実の鉄道駅をマスとし、サイコロの出目だけ駅を進むブラウザ向けオリジナルすごろくゲーム。実地図（MapLibre GL JS）上で現在地と移動履歴を可視化する。既存作品から着想を得た独立作品であり、原作の題名・キャラクター・イラスト・セリフ・指令カード等は使用しない。

MVPのゴール: 山手線のみを対象に、ソロプレイヤーが新橋から外回りで全30駅間区間を踏破し、新橋に到着してクリアする体験を実地図上で完結させる。MVPは将来の複数路線・強制乗換システムに備えた基礎実装と位置付ける。

一次資料: `railway_sugoroku_mvp_spec.md`（v0.1.0, 2026-10-10）。

An original browser railway board game on a real MapLibre map. The current edition is “山手線すごろく — JR東日本 東京23区版”: five reviewed JR East all-stop service patterns inside Tokyo's 23 wards, 67 shared station identities and 22 transfer stations. A solo player starts at Shimbashi on Yamanote outer and must traverse all 30 Yamanote outer directed segments, then arrive at Shimbashi. Arrival lotteries may change the next service and direction. The original Yamanote-only MVP remains the historical baseline in `railway_sugoroku_mvp_spec.md`; its dated JR expansion addendum and the Key Decisions below define the current edition. No original-work characters, art or text are used.

## スコープ (Scope)

### In Scope

<!-- What this project explicitly delivers. -->

- 

- 山手線30駅・30区間（外回り有向区間）の実地図表示
- 1人用の新規開始、1〜6のサイコロ（シード付き疑似乱数）、駅単位の移動アニメーション
- 現在駅・方向・出目・ターン数・踏破区間数の表示、踏破区間の地図上強調
- ゴール判定、クリア画面、リスタート
- localStorage によるセーブ／再開／削除
- 地図の拡大縮小・移動、自動追尾ON/OFF、アニメーションスキップ
- 乱数シードとイベント履歴による再現可能なゲームロジック
- PC・スマートフォンの基本レイアウト対応
- 国土数値情報 N02（2025年度）から山手線データを切り出すPythonデータ加工パイプライン
- 地図・鉄道データの出典とライセンスの画面表示

Current edition (2026-10-12): the following statements supersede the historical MVP / pending items above.

- Five services: Yamanote (30), Keihin-Tohoku Akabane–Kamata (22), Chuo-Sobu local Nishi-Ogikubo–Koiwa (24), Saikyo Osaki–Ukima-Funado (10), Keiyo Tokyo–Kasai-Rinkai-Koen (6).
- 67 shared stations, 146 directed gameplay segments and 88 shared LineString geometry features, generated deterministically from N02 2025 and curated overrides.
- Uniform arrival-only service and direction lotteries with a seeded PRNG; forced outcomes consume no draws; non-Yamanote direction is re-drawn at every landing.
- Terminus and area-boundary truncation; unchanged Yamanote outer-segment goal, with exact-stop arrival on other services.
- Atomic save v2 with whole-record structural and seeded replay; unsupported old saves can be discarded.
- Platform-aware movement, service/direction/lottery text, target-only map progress and multi-service legend, responsive title/play/clear screens.
- Runtime guards, 17-rule pipeline validator, hermetic fixture E2E and real-data playthrough/smoke tests.
- Existing source attribution and licences remain visible; raw N02 is never shipped.

### Out of Scope

<!-- What is explicitly NOT covered, to prevent scope creep. -->

- 

- 山手線以外の路線、乗換抽選UI、方向抽選UI（データモデル・インターフェースのみ先に考慮）
- 内回りモード、指定駅訪問モード、CPU、ローカル対戦、オンライン対戦
- 駅イベント、スコアランキング、アカウント、サーバー保存
- 列車時刻・運賃・列車位置などのリアルタイム鉄道情報、路線・駅の動的更新
- 有料地図API、独自ドメイン、独自サーバー、DB

Current edition (2026-10-12): the following statements supersede the historical MVP / pending items above.

- Rapid/medium-distance services, Joban local (disconnected in-area island), Shinkansen, private railways, subways and through-running outside the reviewed service list.
- Migrating old saves, a separate Yamanote-only mode, inner-loop mode, multiplayer, CPU, station events and rankings.
- Dynamic timetables, fares or train positions; accounts, servers, databases and remote saves.
- Lottery animation beyond accessible text, game-length weighting and pass-through goals on all services.
- Publishing to production before explicit user approval.

## 機能要件 (Functional Requirements)

<!-- What the system must do. Each requirement gets a stable ID (FR-1, FR-2, ...). -->

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| FR-1 | 山手線30駅・外回り30有向区間を実地図上に表示し、外回り順に接続する | Must | S[0]=新橋, E[i]=S[i]->S[(i+1) mod 30] |
| FR-2 | 1〜6均等のサイコロを振り、外回りに出目の駅数だけ進む | Must | 移動中は二重入力を禁止 |
| FR-3 | 移動で通過した全区間を踏破集合に追加し、地図上で強調する | Must | 駅訪問ではなく有向区間の通過で判定 |
| FR-4 | 全30区間踏破かつ新橋到着でクリアし、クリア画面とリスタートを提供する | Must | 山手線乗車中は新橋到着で残りの出目を打ち切ってクリア、他路線（将来）は exact-stop。goalArrivalPolicy として設定値に隔離 |
| FR-5 | localStorage へのセーブ・再開・削除（スキーマバージョン付き） | Must | 乱数状態も復元し、ロード前後で出目列が変わらない |
| FR-6 | シード付き疑似乱数と操作列から同一結果を再現できる | Must | ゲームエンジンは純粋関数、乱数生成は分離 |
| FR-7 | 現在駅・方向・出目・ターン数・踏破区間数（例 12/30）を表示する | Must |  |
| FR-8 | 地図の拡大縮小・移動、自動追尾ON/OFF、アニメーションスキップ | Must | 経路アニメはGeoJSON形状に沿う |
| FR-9 | 駅タップで駅名・路線情報の簡易ポップアップを表示する | Should | ゲーム状態は変更しない |
| FR-10 | 地図・鉄道データの出典とライセンスを常に確認可能にする | Must | N02 は CC BY 4.0 |
| FR-11 | Play the reviewed five-service JR East 23-ward network with shared station identity and arrival lotteries | Must | Supersedes the Yamanote-only scope of the historical MVP FR-1/FR-2; goal remains 30 Yamanote outer segments plus Shimbashi arrival. |
| FR-12 | Persist atomic save v2 records and validate structural and seeded replay of all lotteries | Must | Old saves are rejected with an unsupported-version message and discard action. |
| FR-13 | Render service-specific platform positions, directions and endpoint reasons; reveal the next ride only after animation finishes | Must | Target-only directed progress; canonical shared geometry; responsive network overview. |

## 非機能要件 (Non-Functional Requirements)

<!-- Quality attributes: performance, availability, security, maintainability, etc.
     Prefer measurable targets in the Metric column. -->

| Category | Requirement | Metric / Target |
|----------|-------------|-----------------|
| Performance | | |
| Availability | | |
| Security | | |
| Maintainability | 路線追加でゲームエンジンを書き直さない。抽選・分岐・境界は独立ルールモジュールで追加 | 地図表示データ／鉄道ネットワーク／ゲームロジックを分離 |
| Usability | PC・スマートフォンの基本レイアウト対応、操作UIが地図を覆いすぎない | E2E で PC 幅・スマホ幅の表示を確認 |
| Accessibility | 色だけに頼らず線種・凡例・テキストで踏破状況を示す。prefers-reduced-motion を考慮 | 結果のテキスト表示、アニメ短縮・スキップあり |
| Reliability | 地図タイル取得失敗時もゲーム状態を失わず、再試行メッセージを表示 | E2E テストで確認 |
| Data Quality | 駅30・区間30、ID一意、区間が新橋で閉じる、欠損・重複・未参照なし | データ検証スクリプトがパス |
| Testability | ゲームエンジンの単体テストと E2E テストを整備 | 仕様書 §8.2 / §8.3 のチェック項目がすべてパス |

## アーキテクチャ (Architecture)

<!-- High-level architecture: components, data flow, boundaries.
     Add a diagram or description here. -->

### Agent Roles

| Agent | Role | Responsibilities |
|-------|------|------------------|
| | | |

### Current runtime architecture (2026-10-12)

Static React/TypeScript application with three independent layers: generated railway data (`public/data`, schema v2), a pure game engine (`engine`), and presentation/animation around atomic committed turns. Curated shared station ids define transfers; per-service platform coordinates define marker positions. Directed gameplay segments reference one canonical +1 geometry feature per adjacent service pair. Both map progress layers are limited to Yamanote and receive feature ids, while goal progress uses directed segment ids.

`playTurn` draws a die, advances, and resolves the landing in one transaction. The app saves that committed result before animation; presentation reveals the next ride and lottery only after the accepted finish. Save v2 replays complete records structurally and with the seed. Python routes each service using open-chain or cycle dynamic programming with selector/filter/via constraints, then validates the published artifacts without raw N02. E2E reads a selected bundle and pinned 128-bit seed; actual data has separate smoke and playthrough checks.

## 技術選定 (Tech Stack & Rationale)

<!-- Chosen technologies and why. Record alternatives considered. -->

| Area | Technology | Rationale | Alternatives Considered |
|------|------------|-----------|-------------------------|
| Frontend | React + TypeScript + Vite | 仕様書 §7 で指定 |  |
| Map | MapLibre GL JS | 無料で実地図と GeoJSON レイヤーを重ねられる | 有料地図API（不採用） |
| Tiles | OpenFreeMap | 無料タイル。利用条件を公開前に確認し、差し替え可能な設定にする |  |
| State | Zustand（初期は React 組込みも可） | UI状態と永続化を軽量に管理 | React 組込み state |
| Game Engine | TypeScript 純粋関数 | UIから分離し、再現性とテスト容易性を確保 |  |
| Testing | Vitest + Playwright | ゲーム・データ検証は Vitest、E2E は Playwright |  |
| Data Pipeline | Python + GeoPandas / Shapely / pyproj | N02 GIS データの切り出し・軽量化を再現可能にする |  |
| Persistence | localStorage（スキーマバージョン付き） | サーバー・DB不要 | サーバー保存（対象外） |
| Hosting | Vercel Hobby | 非商用個人用途、GitHub 連携でプレビュー／本番デプロイ |  |
| Railway Data | 国土数値情報 N02 2025年度版 | 公的データ、CC BY 4.0、基準日 2025-12-31 |  |
| Runtime | Node.js 24 LTS（.nvmrc で固定） | 開発開始時点の Active LTS | Node.js 22（Maintenance LTS） |
| Area Boundary | キュレーションした区内駅リスト（駅レジストリの ward 列）＋国土数値情報 N03 行政区域による一度きりの監査 | 決定的で CI で検証可能。N03 は配信データに含めない | N03 ポリゴンをパイプライン入力にする |

## 制約 (Constraints)

<!-- Technical, organizational, regulatory, or resource constraints. -->

- 

- 非商用の個人利用（Vercel Hobby プランの利用条件内）。
- サーバー・DBを持たない静的サイト構成。状態はブラウザの localStorage のみ。
- 鉄道データは国土数値情報 N02 2025年度版（基準日 2025-12-31, CC BY 4.0）に固定し、出典を画面に表示する。
- 背景タイル（OpenFreeMap 等）の利用規約・アクセス負荷・帰属表示に従い、代替可能な設定にする。
- 駅順はGIS線形から無検証で推測せず、公式の路線図・駅情報と突合して固定する。
- 元データ（`N02-25_GML/`, 約112MB）はそのまま配信せず、対象範囲に切り出して軽量化する。原本はGit管理外でもよいが、取得手順と検証方法はリポジトリに残す。
- 原作の題名・キャラクター・画像・テキスト素材は使用しない。

## Key Decisions

<!-- Durable architectural/design decisions. Append-only log. -->

| Decision | Rationale | Alternatives Considered | Date |
|----------|-----------|------------------------|------|
| MVP は山手線外回り固定、新橋スタート・新橋ゴール | 将来の多路線・強制乗換に備え、まず単一環状系統を正確に実装する | 内回り・指定駅訪問モード（将来拡張） | 2026-10-11 |
| 一周判定は駅訪問ではなく有向区間の通過履歴で行う | 別経路での到達や逆方向移動を同じ達成とみなさないため | 駅名の訪問判定 | 2026-10-11 |
| ゲームエンジンを純粋関数とし、乱数生成と UI から分離する | シードと操作列による再現性、単体テスト容易性 |  | 2026-10-11 |
| 駅位置(Station)・運行順序(ServicePattern)・描画形状(GeoJSON)を分離したデータモデル | 将来の複数系統追加でエンジンを書き換えないため |  | 2026-10-11 |
| ゴール判定: 山手線乗車中は、全30区間踏破済みで新橋に到着した時点で残りの出目を打ち切ってクリア。山手線以外に乗車中（将来拡張）は新橋にちょうど停止した場合のみクリア | ユーザー決定（2026-10-11）。山手線上で新橋を通過してしまう出目による引き延ばしを避ける。全30区間未踏破の状態で新橋を通過した場合は打ち切らず続行する（前提） | 全路線で exact-stop（仕様書の暫定値）、全路線で pass-through | 2026-10-11 |
| ゲームタイトルは「山手線すごろく」 | ユーザー決定。原作の題名を使わない独自名称 |  | 2026-10-11 |
| ブランチ戦略: master=本番（Vercel Production）、develop=開発統合、機能ブランチは develop から派生して develop へマージ。本番デプロイ時に develop を master へマージ | ユーザー決定。仕様書 §8.3 の「mainへのマージで本番」は master に読み替える | main 単一ブランチ運用 | 2026-10-11 |
| ソースコードは MIT License。public/data/ の鉄道データは N02 由来で CC BY 4.0 とし、ライセンスを分けて明記する | ユーザー決定（2026-10-11）。公開リポジトリでコード再利用を許可しつつ、データの出典条件を維持する | ライセンスなし（全権利留保） | 2026-10-11 |
| 開始画面に「JR東日本・国土交通省とは関係のない非公式作品」である旨を表示する | ユーザー決定（2026-10-11）。公式との誤認を避ける | 表示しない | 2026-10-11 |
| JR東日本・東京23区版: 駅は路線間で共有する1つのID（キュレーションした駅レジストリ data/overrides/stations.csv で同一性を定義、駅名一致では決めない）。路線別ホーム座標を ServicePattern.platformCoordinates に持ち、groupId は出力しない | 移動・ゴール・セーブ・UIにグループ比較を持ち込まずに済む。東京の京葉線ホーム（約450m離れる）も同一駅として扱い、形状端点は路線別ホーム座標で30m検証できる。乗換は全て同一駅構内（研究結果） | 路線ごとの駅 + groupId（92駅/67グループ）、代表点1つ＋端点許容500m | 2026-10-12 |
| ゲーム判定は有向区間（山手線は外回り+1のみ、他路線は両方向）、地図形状は路線内の隣接駅ペアごとに1つの無向featureを共有し、向きは feature の from/to で判定。地図フィルタは featureId を使い、山手線の進捗レイヤーは対象路線に限定する | 形状の重複を避け、内回りモード追加時も形状を再利用できる。距離による向き推定は離れたホームで不正確 | 有向区間ごとに1 feature（座標重複、完了/未完了の重なり） | 2026-10-12 |
| 乗換抽選の乱数契約: 1ターンは rollDie → 移動 → （クリアしなければ）候補2路線以上なら路線抽選 → 山手線以外で可動方向が2つなら方向抽選。強制選択は乱数を消費しない。drawIndex は棄却サンプリング（2^32 − 2^32 mod k 未満のみ採用）。候補順は services.json の順、方向は [1, -1] | 均等性と再現性を保ち、乗換が起きないゲームでは既存のサイコロ列（スナップショット）がそのまま有効 | 強制選択でも乱数を消費する、駅名・ID順で候補を並べる | 2026-10-12 |
| ターンは原子的に確定する（未決の乗換状態を GameState に持たない）。moveByRoll(state, roll, network, landing?) は注入した選択で、playTurn はシード乱数で同じ内部処理（advance/finalize）を使う。乗換規則は engine/landing.ts に分離 | 1回のコミット→セーブ→アニメーションという既存のUIフローを維持し、テストでは任意の出目と選択を注入できる | 保存可能な pending 状態を持つ2段階API、playTurn での事前ドライラン | 2026-10-12 |
| MoveRecord に stopReason（roll/goal/endpoint）と landing（次ターンの路線・方向、クリア時は null）を追加し saveVersion 2 とする。復元は構造リプレイ（記録した選択で moveByRoll）とシード付きリプレイ（playTurn）の両方で記録全体と最終状態を比較。旧セーブは移行しない | 1ターン内の複数抽選を再現・検証でき、不正な選択は INVALID_SAVE、シード由来でない選択は RNG_MISMATCH と区別できる | 出目のみ比較する従来方式、シード付きリプレイ1本化 | 2026-10-12 |
| 対象エリアはキュレーションした駅リスト（駅レジストリの ward 列、各路線の停車駅リストは最後の区内駅で終わる）で定義し、N03行政区域は一度きりの監査に使う（パイプライン入力にしない）。端点で余りの出目を破棄した停止は exact-stop とみなさず、新橋はどの非環状路線の端点にもしない（バリデータで保証） | 区内駅は全て区界から293m以上内側で境界判定の曖昧さがない。CI では生データなしで検証できる | N03ポリゴンをパイプライン入力にする | 2026-10-12 |
| 山手線の踏破数は completedSegmentIds と山手線外回り区間の積集合で数える（completedSegmentIds は全路線の通過区間を保持）。抽選結果の表示はテキストを先に実装し、移動アニメーション終了時に表示する（サイコロ風演出は将来の任意） | 他路線の区間で踏破数が水増しされるのを防ぐ。演出は既に確定した結果を見せるだけで抽選には関与しない | completedSegmentIds を山手線のみに限定、抽選専用のUIフェーズ | 2026-10-12 |
| E2E は route interception で小さなフィクスチャ路線網（実際の山手線30駅＋短い非環状2路線）と固定ゲームシードを使い、終点・エリア端・乗換・方向抽選を Vitest で事前に証明する。実データは Vitest の通しプレイ＋E2E スモークで検証する | 実データのゲームは中央値52ターンと長く、データ更新で E2E が壊れないようにする。CI を高速かつ外部ネットワーク非依存に保つ | 実データで短く終わるシードを探して固定する | 2026-10-12 |
| JR東日本・東京23区版の対象は各駅停車相当の5系統のみ: 山手線（環状30駅）、京浜東北線（赤羽〜蒲田22駅）、中央・総武線各駅停車（西荻窪〜小岩24駅）、埼京線（大崎〜浮間舟渡10駅）、京葉線（東京〜葛西臨海公園6駅）。計67駅・乗換駅22。常磐線各駅停車・横須賀・総武快速線・常磐線快速は除外、快速の停車パターンは無視、武蔵野線は別系統にしない、埼京線の南端は大崎、除外路線のみが停まる区内10駅は対象外 | ユーザー決定（2026-10-12）。研究者が JR東日本公式時刻表（2610版）で停車駅を照合。常磐線各駅停車は区内で他路線と接続しない孤立区間。このリストをデータ検証の完全性基準にする | 常磐線各駅停車を地図表示のみで残す、横須賀・総武快速線／常磐線快速を含める | 2026-10-12 |
| JR東日本23区版: 山手線以外では、乗換先のない駅でも着駅ごとに方向を抽選し直す（R1-a） | ユーザー決定（2026-10-12）。仕様書§4.1/§2の文言どおり。中央値52ターン | 方向を維持し終点で折り返す（R1-b、中央値55ターン） | 2026-10-12 |
| タイトルは「山手線すごろく」のまま、副題「JR東日本 東京23区版」を付ける（R5） | ユーザー決定（2026-10-12）。既存の名称を保ちつつ対象範囲を示す | 副題なし | 2026-10-12 |
| ゲーム長の調整（山手線の重み付け、通過クリア）は入れない（R6） | ユーザー決定（2026-10-12）。確定ルールで中央値52・p99 189ターン、500ターン超なし | 山手線重み×2（中央値27）、全系統で新橋通過クリア（中央値49） | 2026-10-12 |
| JR東日本・東京23区版を1都3県版で置き換える（エディション選択は設けない）。旧セーブは移行せず、既存の「対応していない形式」表示と破棄操作で扱う | ユーザー決定（2026-10-12、brief feature-jr-east-capital-region-expansion-brief.md）。単一エディションに保ち、データ・ルール・セーブの組合せを増やさない | エディション選択で23区版と並存、旧セーブの移行 | 2026-10-12 |
| 1都3県版の対象: 東京都（島しょ部を除く）・千葉県・埼玉県・神奈川県のJR東日本在来線全線。支線は別系統とする。新幹線、JR東海（御殿場線）、私鉄、地下鉄、東京モノレール、りんかい線、島しょ部、特急（到達性に影響する場合を除く）は対象外。エリア外へ出る路線は最後のエリア内駅で打ち切る | ユーザー決定（2026-10-12）。研究の結果、特急を除いても到達不能駅は0（全475駅が普通・快速の停車駅） | 23区版の5系統のまま、特急を含める | 2026-10-12 |
| 各路線の普通（各駅停車）の停車パターンと、快速・中距離列車の停車パターンを別々の系統としてモデル化する。快速は停車駅間を1区間とし、地図形状は既存の区間形状を合成して座標を重複させない。どの快速種別を含めるかは研究結果をもとにユーザーが確認する | ユーザー決定（2026-10-12）。具体的な快速種別の範囲は未決（TODO / Open Questions の Q3） | 普通のみ、快速の停車パターンを無視 | 2026-10-12 |
| 1都3県版の「快速系統」は、緩行線と快速線（別線路）が分かれた線路系統を別の系統として持つ意味とする（例: 常磐緩行線と常磐快速線、中央・総武緩行線と中央快速線、京浜東北線と東海道線・宇都宮/高崎線、総武快速・横須賀線）。各系統の停車パターンはその線路を走る基本種別（普通、または快速線の基本種別）とし、路線内の上位種別（特快、通勤快速、ラビット、アーバン、京浜東北線快速、埼京線快速、京葉線快速、南武線快速、しもうさ号、むさしの号、ホリデー快速など）は系統にしない | ユーザー決定（2026-10-13）。前の行の「快速・中距離列車の停車パターンを別々の系統とする」を置き換える。研究カタログ（60系統）は線路系統単位で作り直す | 上位種別も系統にする（研究カタログ v1 の rapid 24系統。core 51 / 全59） | 2026-10-12 |
| 乗換抽選の調整: 山手線の駅では山手線を確率1/2、残りを他系統で均等。山手線以外の方向抽選は山手線に近づく向きを2:1。23区版の「全候補均等」ルールを変更する（新しい rulesetVersion） | ユーザー決定（2026-10-13）。研究カタログ v1 core 51系統で中央値63・p90 154・p99 271ターン（調整なしは572 / 1,250 / 2,016）。線路系統単位のカタログで再計測する | 調整なし、山手線1/2のみ（96 / 303 / 634）、方向3:1（57 / 130 / 223） | 2026-10-12 |
| 1都3県版の既定値: ゴール条件は現行のまま（山手線外回り30区間＋新橋）。直通運転は路線の境目で分割し（JRが1つの名前で運行する湘南新宿ライン・京浜東北・根岸線・中央・総武各停・埼京・川越線・相鉄直通は一体）、境目は「系統の端」と表示。系統ごとに均等の抽選重み（緩行線系統と快速線系統も均等）。久留里線は久留里で打ち切り。八高・青梅・成田・内房・高尾〜藤野は研究カタログの区切り。停車パターンは平日。東京（京葉線）・武蔵小杉・浜川崎は各1駅。副題「JR東日本 1都3県版」 | ユーザー決定（2026-10-13）。設計 jr-east-capital-region-expansion-design.md §12 の Q2・Q4〜Q10 の推奨を採用（Q5 は線路系統の意味で確認済み） | 設計 §12 の各代案 | 2026-10-12 |
| 1都3県版の系統一覧は catalog v2（40系統・472駅、`.claude/docs/research/jr-east-capital-region-catalog-v2.csv`）を採用する。各路線の普通36系統、快速線の基本パターン3系統（中央快速・総武快速・常磐快速）、湘南新宿ラインの高崎線⇔東海道線系統の快速（この経路には普通がないため基本種別）。湘南新宿ラインの宇都宮線系統の快速・特別快速は上位種別として除外 | 2026-10-13 のユーザー決定「線路系統ごとに基本種別、上位種別は系統にしない」と「JR命名の直通系統は一体」の適用。Codex 検証で湘南新宿の基本系統の誤除外を検出して修正。Q1(c) で中央値61・p90 148・p99 258ターン（50,000回、seed 20261012） | 39系統（湘南新宿は宇都宮⇔横須賀の普通のみ）、v1 core 51系統 | 2026-10-13 |

## TODO / Open Questions

<!-- Open design questions and deferred decisions for this project. -->

- 

- 移動アニメーション速度: 暫定 1駅 0.3〜0.6 秒（設定可能）。
- セーブタイミング: 暫定 各ターン確定直後とクリア直後。
- 駅アイコンの最小表示ズーム: 地図上で確認して調整。
- 駅代表点と区間端点のズレ許容閾値: データ検証後に確定。
- 状態管理: Zustand か React 組込みかを初期段階で決定。
- OpenFreeMap の利用条件・提供状況を公開前に確認。
- 将来拡張（強制乗換）: 非環状線端点の方向抽選省略、分岐系統の扱い、乗換・歩行連絡の定義、直通運転・範囲境界・終着折返し。

- JR東日本・東京23区版（2026-10-12、設計: `.claude/docs/research/jr-east-tokyo-expansion-design.md` §9）ユーザー確認待ち:
  - R1: 山手線以外で1路線のみの駅に着いたときの方向。基準は毎回再抽選（確定ルールの文言どおり）、代案は方向維持・端点のみ折返し。ゲーム長の差は小さい（中央値52 vs 55ターン）。
  - R2: 対象路線 = 山手線・京浜東北線・中央・総武線各駅停車・埼京線・京葉線（普通の停車パターン、埼京線は大崎まで、武蔵野線は別系統にしない）。
  - R3: 常磐線各駅停車（綾瀬〜金町、他路線と接続しない孤立区間）を除外するか、地図だけに表示するか。
  - R4: 横須賀・総武快速線／常磐線快速を含めるか（推奨: 除外）。
  - R5: タイトル（推奨: 「山手線すごろく」＋副題「JR東日本 東京23区版」）。
  - R6: ゲーム長の調整（モンテカルロ: 中央値52・p90 114・p99 189ターン、500超0%）。推奨は調整なし。候補: 山手線の抽選重み×2（中央値27）、全路線 pass-through（中央値49）。
  - R7: 除外路線のみが停まる区内10駅は到達不能のまま受け入れるか。

- 上記 R2・R3・R4・R7 はユーザー決定（2026-10-12）で解決済み（Key Decisions 参照）。残る確認事項は R1（単一路線駅での方向）、R5（タイトル）、R6（ゲーム長の調整、推奨なし）。確定5系統での再シミュレーション: R1 基準（毎回再抽選）で中央値52・p90 114・p99 186ターン、500超0%。

Current edition (2026-10-12): the following statements supersede the historical MVP / pending items above.

- No JR expansion rule choices remain open: R1-a, R2–R4/R7, R5 and R6 are all confirmed in Key Decisions.
- Review the integration PR, then prepare the develop → master release PR. Production merge and smoke verification require explicit user approval.
- Optional later work: lottery visual effects, other operators, branching/through services and a new inner-loop ruleset. None changes the current seeded ruleset implicitly.

- JR東日本・1都3県版（2026-10-12、設計: `.claude/docs/research/jr-east-capital-region-expansion-design.md` §12、モンテカルロ §8）ユーザー確認待ち。現行ルールのままだと中央値572・p90 1,250・p99 2,016ターン（500ターン超57%）:
  - Q1: 乗換抽選の調整。推奨は「山手線の駅では山手線を1/2、残りを他路線で均等」＋「山手線に近づく方向を2:1」（中央値63・p90 154・p99 271）。
  - Q2: ゴール条件（推奨: 現行のまま）。
  - Q3: 快速系統の範囲（推奨: core 51系統、optional 9系統を除外。むさしの号は N02 に国立支線がなく形状を作れない。京浜東北線快速の扱い）。
  - Q4: 直通運転の分け方（推奨: 研究カタログの既定。路線の境目で分割し「系統の端」と表示、湘南新宿ライン等のJR命名系統は一体）。
  - Q5: 普通と快速の抽選の重み（推奨: 系統ごとに均等）。
  - Q6: 久留里線 久留里〜上総亀山（運休中・2027-04-01廃止届）を含めるか。
  - Q7: 八高線・青梅線・成田線・内房線・中央本線 高尾〜藤野の系統の区切り。
  - Q8: 停車パターンの基準日（推奨: 平日）。
  - Q9: 東京（京葉線）・武蔵小杉・浜川崎をそれぞれ1駅とするか（推奨: 1駅）。
  - Q10: タイトル・副題（推奨: 「山手線すごろく」＋「JR東日本 1都3県版」）。
  - Q11: 23区版リリース PR #4 を先に扱うか（1都3県版は決定まで統合ブランチで進める）。

- 1都3県版（2026-10-13）: 上記 Q1〜Q11 はユーザー決定で解決済み（Key Decisions 参照）。Q3 は「上位種別は系統にしない、緩行線と快速線を別系統」と再定義。23区版は本番リリース済み（PR #4 は判断不要）。次の作業: 研究カタログを線路系統単位で作り直し、モンテカルロを再計測してから実装に入る（`.claude/docs/plans/jr-east-capital-region-handoff.md`）。

- 1都3県版（2026-10-13 更新）: 上の「ユーザー確認待ち」Q1〜Q11 一覧は履歴。catalog v2（40系統）とモンテカルロ再計測は完了。次は実装計画の承認と実装（`.claude/docs/plans/jr-east-capital-region-handoff.md`）。
