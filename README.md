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
