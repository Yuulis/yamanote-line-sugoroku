# 山手線すごろく

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
- WebKit はシステムライブラリの追加（`sudo npx playwright install-deps`）が必要なため、対象外です。
- Vercel へのデプロイ確認（8.3 の該当項目）は手動で行います。

## ライセンス

- ソースコード: MIT License（[`LICENSE`](LICENSE) を参照）。
- 鉄道データ（`public/data/`）: 国土交通省「国土数値情報（鉄道データ）」を加工して作成した派生データです。
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) で提供され、
  出典表記は「国土数値情報（鉄道データ）」（国土交通省）を加工して作成、です。生成手順は `data/README.md` を参照してください。
- 背景地図: OpenFreeMap / OpenMapTiles / OpenStreetMap contributors（ODbL）のタイルを使用し、アプリ内に出典を表示しています。
- 使用ライブラリのライセンス: `npm run build` が `dist/third-party-licenses.txt` を出力し、タイトル画面から参照できます。
- 本作は東日本旅客鉄道株式会社および国土交通省とは関係のない、非公式のファンメイド作品です。
