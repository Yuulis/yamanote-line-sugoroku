# S3 review 1 (Codex Sol low, read-only, 2026-10-17)

Source: `.claude/logs/codex/20261017T051544Z-s3-review.md`. Verdict: fix first (小泉線 secondary mileage source chain). Single fix pass: Luna `s3-fix`.

**Verdict — fix first**

経路実装にコミットを止める不具合は見つかりませんでした。ただし、小泉線2サービスの距離出典が standing lead decisions の条件を満たしていないため、現状での「S3-complete」は保留します。ビルド・テストは再実行していません。

**Blocking findings**

- `data/staging/tokyo-suburban-nonjr/tobu/length-ref-components.csv:8`、`:9` — 小泉線12.0 km／6.4 kmの出典は secondary と明記されていますが、採用条件である『鉄道要覧』への出典連鎖を確認できません。採録元の[小泉線表](https://railway.sidearrow.net/line/detail/7e11c9b2/?type=passengers)には数値がありますが、[参考情報](https://railway.sidearrow.net/references/)は国土数値情報を挙げています。18.4 kmへの合計一致だけでは分岐別距離の独立した裏付けになりません。一次資料または『鉄道要覧』を引用する二次資料に差し替え、出典連鎖を記録してください。別途、この資料を認める明示的なlead判断でも解消可能です。

**Non-blocking — carry into S4+**

- `scripts/data_pipeline/stage_suburban_nonjr.py:1693` — handoffはoverride・raw・pair evidence・出力の鮮度を検査しますが、`length-refs.csv`／`length-ref-components.csv`を検証済みスナップショットに結び付けません。距離資料だけを変更すると古いaudited状態のまま通り得ます。両CSVのhashをgate/auditに保存し、handoffで比較する回帰を追加するとよいです。
- `tests/data_pipeline/test_staging_nonjr_inventory.py:47`、`:103` — 検査対象の`handoff()`自身が索引とREADMEを書き直すため、後段のファイル比較は既存成果物の陳腐化を検出できません。検証と書込みを分け、古い索引・証拠変更の拒否を一時ディレクトリで確認してください。
- `scripts/data_pipeline/stage_suburban_nonjr.py:1199` — secondary採用サービスにも「Official primary-source」と書き込み、`:806`付近の`lengthRef.source`も同様です。資料区分を保持して表示してください。`data/README.md`の全件一次資料という説明も合わせる必要があります。
- 成分限定の`measure-pairs`は共有pair evidenceを置換し、対象外サービスの距離合計を消します。後続gateは欠落を拒否するため誤完了にはなりませんが、継続作業には全group再測定が必要です。
- S4ではJR combinedとのID統合後、自治体代表値・offset例外・pair/section/junctionのIDを再照合してください。S3の事業者別通過結果だけでは、統合後の接続性やS5 gameplay設定は保証されません。

**Evidence spot-checks**

- `STATION_NUMBER_EVIDENCE_PATTERN`は明示sequenceだけを拡張し、既存JR番号規則を維持。selector値中の`=`拒否も妥当です。
- anchor救済は両端に適用され、同事業者・同group・代表点の完全一致を要求。code-only pinは`build.stop_lines`を使用し、近接距離による代用はありません。
- 閉路の最終pairは先頭stopへwrap。成分順・サービス順・pair順とN02候補／section順は決定的で、gateは両端コード・距離・snapを通常ビルドと比較します。
- Metroの7 offset、蔵前310 m、佐野2.10、押上の実vertex junctionは個別例外として限定されています。佐野の理由は経路2.486 kmと公式区間2.5 kmを区別しています。
- 京王新宿→初台は新線側3 sectionに限定され、回帰は実N02から南側geometryの選択まで確認しています。
- 小竹向原は副都心線`003294`、関内は`004691`をpinし、隣接線側をexact anchorで扱っています。
- 成田空港線は51.4−32.3＝19.1 kmを明示。ただし内訳CSVの`from/to`は加減算対象区間の端点として不正確で、notesが実区間を補っています。S4までに列の意味を整理すると安全です。
- 都営新宿、飯田橋、溜池山王の自治体は代表registryをscopeに採用し、ホーム側の差をREADMEに保存しています。
- 80／1,166／1,087／2,174の索引、凍結ID対応、全8groupのaudited状態を確認しました。残る全件検証結果は、提示されたleadの実行結果を前提としています。
