# ブランド素材（仮）とメタ情報

公開告知の最初のPR（`feat: add launch metadata and brand icons`）で追加した素材の一覧です。
ブランドは D2 の仮決定に基づきます。名称・商標の確認結果によっては作り直します。

## 追加した素材

すべて `public/` に置き、ビルド時に `dist/` へそのままコピーされます。

| ファイル | 内容 |
|---|---|
| `favicon.svg` | マークのみ（一周する輪の上に傾けたサイコロ）。ダークモードでは輪を明るい色に切り替える |
| `favicon.ico` | 16・32・48 px を同梱した互換用アイコン |
| `apple-touch-icon.png` | 180×180、不透明。iPhone のホーム画面用 |
| `icon-192.png`・`icon-512.png` | manifest 用の通常アイコン（クリーム色の背景） |
| `icon-maskable-512.png` | manifest 用のマスク対応アイコン。マークは中央の安全円内 |
| `logo.svg`・`logo.png` | マークと横組みロゴ（1200×300、透過）。明るい背景向け |
| `ogp.png` | 1200×630 の共有用画像。ロゴ、誘い文、サイトのホスト名 |
| `site.webmanifest` | 名前・色・アイコン。`display` は `browser` とし、PWA はうたわない |

`index.html` には description、canonical、アイコン、manifest、`theme-color`、OGP、X（Twitter）カードを静的に記載しました。
URL はすべて正式URL `https://yamanote-line-sugoroku.vercel.app/` の絶対URLです（D1）。
`<title>` は変えていません。タグとファイルの対応は `tests/unit/launch-metadata.test.ts` で検査します。

## デザイン上の注意

マークは墨色の輪と朱色のサイコロで構成し、主色は朱色（`#d9502f`、`theme-color` と同じ）です。
JRのロゴや字形、JYの駅ナンバリング表示、路線色の輪に文字を入れた形、山手線の緑を主にした配色、30個の部品で作る輪、「まるっと山手線」という表現は使っていません。

## フォントとライセンス

ロゴの文字は Zen Maru Gothic（SIL Open Font License 1.1）を輪郭化したものです。実行時にWebフォントは読み込みません。
ライセンス文は `brand/OFL.txt` に保存しています。取得元のコミットと SHA-256 は `brand/README.md` に記録しています。

## 作り直す方法

素材は `brand/build_brand.py` で一括生成します。手順とコマンドは `brand/README.md` の「Regenerate」にあります。
マークの形と色はスクリプト内の `MARK_BODY` と色定数で変えられます。

## 未確認のこと

- X・LINE で実際に画像と説明文が表示されるかは、デプロイ後に確認が必要です。
- 「山手線」を含む名称やマークの商標は未確認です（D2 の確認事項）。
