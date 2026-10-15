# 山手線すごろく

Current edition: **JR東日本 1都3県版** — 40 services and 472 stations across 東京都・千葉県・神奈川県・埼玉県. 山手線の抽選確率は候補に含まれる場合1/2、他サービスの方向抽選は山手線へ近づく方向を2:1で優先します。新橋から山手線外回り30区間を踏破して新橋へ戻るとクリアです。

[遊び方・40サービス一覧（日本語）](docs/manual/jr-east-capital-region/rules.md) · [実装状況](docs/manual/jr-east-capital-region/implementation-status.md) · [データ生成と検証](data/README.md)

セーブ形式はv3です。互換性のない旧セーブは移行せず、未対応形式の案内から破棄できます。現行データを使う単体テストとE2Eに加え、固定シードによる実データの完走・復元確認があります。

## 開発環境のセットアップ（フロントエンド）

Node.js 24 LTS と npm を使います（`.nvmrc` 参照）。

```bash
nvm use
npm ci
npm run dev        # 開発サーバー
npm run typecheck  # 型チェック
npm test           # Vitest 単体テスト
npm run build      # 本番ビルド
```

地図に重ねる鉄道データは `public/data/` から読み込みます。
背景地図の提供元は `src/features/map/mapConfig.ts` で差し替えられます。

### E2E テスト（Playwright）

仕様書 8.3 の結合／E2E テストです。本番ビルドを `vite preview` で配信し、
PC 幅の Chromium・スマートフォン幅の Chromium（タッチ）・PC 幅の Firefox で実行します。

```bash
npm run test:e2e:install  # 初回のみ: Chromium と Firefox を取得
npm run test:e2e          # ビルド → プレビュー起動 → 全テスト
npx playwright test --project=desktop-chromium  # 1 プロジェクトだけ
```

- 背景地図（スタイル・タイル・フォント）はテスト内でスタブ化しており、インターネット接続は不要です。
  スタブを通らない外部通信は失敗させ、テストも失敗します。
- テスト用ビルドは `vite build --mode e2e` で `node_modules/.cache/sugoroku-e2e-dist/` に出力します。
  地図の状態を読むフック（`src/features/map/e2eHook.ts`）はこのモードでのみ有効で、
  `npm run build` の成果物（`dist/`）には含まれません。
- プレビューサーバーは既定で IPv6 ループバック `[::1]:4319` で起動します
  （WSL2 の mirrored ネットワークでは 127.0.0.1 の空きポート確認が約 2 分止まるため）。
  IPv6 が使えない環境では `E2E_HOST=127.0.0.1 npm run test:e2e` で切り替えます。
- WebKit はシステムライブラリの追加（`sudo npx playwright install-deps`）が必要なため、ローカルでは既定で対象外です。
  GitHub Actions では自動で有効になります。手元で試すときは `E2E_WEBKIT=1` を付けます。
- Vercel へのデプロイ確認（8.3 の該当項目）は手動で行います。

## CI（GitHub Actions）

`.github/workflows/ci.yml` が、`master` / `develop` / `feature/**` への push、
`master` / `develop` 向けの Pull Request、手動実行（workflow_dispatch）で動きます。
同じ ref の古い実行は新しい push で自動的にキャンセルされます。デプロイは Vercel の Git 連携が担当し、CI は品質チェックだけを行います。

| ジョブ | 内容 |
| --- | --- |
| `frontend` | `npm ci` → 型チェック → Vitest → 本番ビルド → 本番バンドルに E2E 用フック（`__sugorokuE2E`）が無いことの確認 |
| `pipeline` | `uv sync --locked` → ruff（lint・format）→ ty → pytest → `validate`（`public/data/` の検証） |
| `e2e` | Playwright（Chromium・Firefox・WebKit）。`frontend` と並列で実行 |

- N02 の生データは git 管理外のため、CI では `tests/data_pipeline/test_build.py` がスキップされます（想定どおり）。
- 失敗したジョブは Actions の実行画面で、赤くなったステップのログを確認します。
  `e2e` が失敗した場合は、実行画面下部の Artifacts から `playwright-artifacts`（HTML レポートとトレース）を 7 日以内にダウンロードし、
  `npx playwright show-report playwright-report` で開きます。
- E2E は CI でのみ 1 回リトライします。リトライで通ったテストはレポート上で flaky と表示されるので、見逃さず原因を調べてください。

## ライセンス

- ソースコード: MIT License（[`LICENSE`](LICENSE) を参照）。
- 鉄道データ（`public/data/`）: 国土交通省「国土数値情報（鉄道データ）」を加工して作成した派生データです。
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) で提供され、
  出典表記は「国土数値情報（鉄道データ）」（国土交通省）を加工して作成、です。生成手順は `data/README.md` を参照してください。
- 背景地図: OpenFreeMap / OpenMapTiles / OpenStreetMap contributors（ODbL）のタイルを使用し、アプリ内に出典を表示しています。
- 使用ライブラリのライセンス: `npm run build` が `dist/third-party-licenses.txt` を出力し、タイトル画面から参照できます。
- 本作は東日本旅客鉄道株式会社および国土交通省とは関係のない、非公式のファンメイド作品です。
