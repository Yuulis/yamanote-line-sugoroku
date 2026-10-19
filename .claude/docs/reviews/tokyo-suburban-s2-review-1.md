# S2 review 1 (Codex Sol low, read-only, 2026-10-16)

Source: `.claude/logs/codex/20261016T071943Z-s2-review.md`. Verdict: fix first (test gaps for S1 carry-overs a/b).

## Verdict
**fix first**。実装にwrong-track・他事業者・近接接続を新たに通す明確な欠陥は見つかりませんでした。ただし、S1持ち越しa/bの明示的な完了条件にテスト不足があり、現状での「S2-complete」は保留します。変更・ビルド再実行はしていません。

## Blocking findings
- **S1-a：境界の独立照合が不足** — `tests/data_pipeline/test_staging_suburban_chuo.py:74`。野辺山・白馬の停車終端は確認しますが、scopeの直近false隣駅を検証していません。特に白馬では遠方の南小谷の不在だけを確認しており、直近の信濃森上を飛ばしてもこの検査は通ります。東北側も高久・桃内の独立したscope回帰がありません。**修正**：R1境界証拠に基づく固定期待値で、対象サービスの終端・直近false隣駅・自治体・endpoint kindを照合し、隣駅を誤った駅に置換すると失敗する検査を追加してください。helperの定数を期待値として再利用しないでください。
- **S1-b：要求された合成成功回帰が未追加** — `tests/data_pipeline/test_staging_suburban_takasaki.py:91`。新前橋の実N02成功は有用ですが、計画で要求した「合成成功例と実N02例」のうち合成成功例が見当たりません。既存compositionテストは他事業者・別線拒否を中心に確認しています。**修正**：`check_inherited_route_sources`へ、同operator・別line・同group・完全同一midpointの候補を渡す成功例を追加し、group違い／座標微差／operator違いは拒否することも隣接して固定してください。

## Non-blocking
- `scripts/data_pipeline/stage_suburban_jr.py:140`：15件を「official」と呼びますが、水郡55.6 km・上越59.1 kmはWikipedia参照、両毛91.7 kmは公式84.4 km＋他資料7.3 kmの合成です。数値の誤りは確認していません。S3以降は一次資料または差分計算の内訳を記録してください。
- `scripts/data_pipeline/stage_suburban_jr.py:1517`：baseline hashは地域間一致を検査しますが、現在のbaselineとの照合はありません。auditは現在のlive/publicと比較するため、S5前にbaselineが変わる場合は再測定・再検証の扱いを明示すると安全です。
- `scripts/data_pipeline/stage_suburban_jr.py:1801`：assembleが実行結果を確認せずREADMEへgate「passed」を出力します。今回はleadの実行報告がありますが、今後は検証ログへの参照か、実行を要求する文面にしてください。
- auditはpair-evidence／length-refsの内容を検証しません。S5で変更したoverrideに古い証拠CSVを添付してもaudit単独では検出できないため、変更地域の測定・build・validateも必須にしてください。
- S3/S5を妨げる形式上の問題は見つかりません。S5のgameplay設定復元と新規product buildの手順は明記されています。

## Evidence spot-checks
- **範囲filter**：正方向の半開区間、global＋scopedの集合合成、重複・衝突拒否を確認。composeはultimate ownerの各canonical pairと完全一致し、逆向きでも部分集合比較へ緩和していません。
- **Jヴィレッジ**：指定2section・元座標 `(141.0073806,37.24077448)`・内部頂点／peer端点の完全一致を確認。filter後に分割し、線分追加や近接nodingはありません。未知key・微差・非端点拒否の回帰があります。
- **295追加pair**：証拠CSVは295行すべてpass。小山水戸 `002410/002407`、小山両毛 `002411/002407`、水戸水郡 `002317/002319`をselector・距離と照合しました。
- **ホーム固定**：中央旧3駅のコード固定、熱海のJR東日本・東海道線／伊東線別selectorを確認。registry代表ホームの変更で代用していません。
- **線名境界**：倉賀野–高崎は高崎線owner、高崎–新前橋は上越線owner。pair証拠とcompose回帰が対応しています。
- **滝→烏山**：2.850787 km、例外1.90、理由の比率約1.88、全線20.242 km対営業20.4 kmは整合します。
- **営業キロ**：15件の参照行とN02合計は全件±1.5 km内。[JR公式営業キロ表](https://www.jreast.co.jp/youran/pdf/2017-2018/jre_youran_shogen_p86.pdf)、[野辺山23.4 km](https://www.jreast.co.jp/fr/nagano/trip/nobeyama/index.html)、[白馬59.7 km](https://www.jreast.co.jp/th/nagano/trip/hakuba/)も直接確認しました。一次資料未確認分は上記の留保です。
- **保全・統合**：旧registry全record、旧primitive参照・geometry・platform座標・recipe・直接routeの有効filter比較を確認。例外CSVの既存行改変／削除と地域間競合を拒否するmergeも確認しました。
