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

### Out of Scope

<!-- What is explicitly NOT covered, to prevent scope creep. -->

- 

- 山手線以外の路線、乗換抽選UI、方向抽選UI（データモデル・インターフェースのみ先に考慮）
- 内回りモード、指定駅訪問モード、CPU、ローカル対戦、オンライン対戦
- 駅イベント、スコアランキング、アカウント、サーバー保存
- 列車時刻・運賃・列車位置などのリアルタイム鉄道情報、路線・駅の動的更新
- 有料地図API、独自ドメイン、独自サーバー、DB

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
