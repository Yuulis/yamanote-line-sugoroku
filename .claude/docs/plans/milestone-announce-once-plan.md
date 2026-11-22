# Issue #96 — milestone sentence announced once — plan

Source: Codex gpt-6.2-sol (low, read-only), 2026-11-22. Prompt: `milestone-announce-once-prompts.md` P0. Status: plan approved by the user 2026-11-22; implementation not started.

## Decisions (user, 2026-11-22)

- Scope: include Step 3 (card-less turn with no flash and no lottery reads the sentence once at the result).
- Implementer: Codex Luna xhigh; reviews: Codex Sol low.
- Pacing: stop after every step (verify, commit, push, CI, handoff update, report).
- Branch: `fix/issue-96-milestone-announce-once` from `develop`.

## TL;DR

`GameApp` に `session:turn:threshold` の消費済みキーを持たせ、節目文を含むテキストが実際の読み上げ領域にコミットされた時点で記録します。同じ領域で到着文が続く間は全文を維持し、Skip やアイテム操作で次の文面に切り替わったら節目文を再付与しません。トーストと進捗バーのフラッシュには変更を加えません。

到着カード・区間フラッシュ・抽選のいずれもないターンも、同じ仕組みで結果公開時に読み上げられます。新しく音声が出るケースなので、#96 の必須修正とは別の確認事項にします。今回は読み取り専用で、ファイル変更とテスト実行は行っていません。

## Current behaviour (with file:line evidence)

- 節目のターンは `attempt.recordTurn → current.itemRecord.turn → game.turn` の順で決まります。下位の節目は移動完了後かつ `publicationTurn > entryTurn` のときに選ばれ、30/30 は初回踏破ターンのゴール案内から文を取ります。同じターンに複数の閾値を越えた場合は、既存仕様どおり最高の閾値が対象です。 [turnMomentPresentation.ts:355](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:355) · [turnMomentPresentation.ts:417](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:417) · [progressMilestones.ts:22](/home/yuulis/yamanote-line-sugoroku/src/features/game/progressMilestones.ts:22)
- 到着、区間フラッシュ、抽選の flip・settle は到着文を共有します。現行はそこで節目文を付け、Skip・演出省略・演出なしなどの結果公開時にも付けます。公開後にドラフトや捨てる選択で基本文が変わっても、そのターンが適格な間は再付与されます。Step 5 のレビューでは、逆に抽選の入口で接尾文を外すだけでも全文が変わり、S16 で到着文が再度読み上げ対象になることが確認されています。 [presentation.ts:240](/home/yuulis/yamanote-line-sugoroku/src/features/game/presentation.ts:240) · [turnMomentPresentation.ts:429](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:429) · [Step 5 レビュー](/home/yuulis/yamanote-line-sugoroku/.claude/docs/reviews/hud65-step5-fable.md)
- `GameApp` はセッション開始時のゲームターンと結果レコードのターンの最大値を `entryTurn` とします。実際の読み上げ文は `GamePanel` で通知と調停され、調整・捨てる選択が開くとダイアログ側の live region に渡ります。ルール表示中はそのダイアログ自体がマウントされません。したがって、`GameApp` で候補を導出しただけでは配信済みと判断できません。 [GameApp.tsx:286](/home/yuulis/yamanote-line-sugoroku/src/app/GameApp.tsx:286) · [GamePanel.tsx:425](/home/yuulis/yamanote-line-sugoroku/src/features/game/components/GamePanel.tsx:425) · [GamePanel.tsx:757](/home/yuulis/yamanote-line-sugoroku/src/features/game/components/GamePanel.tsx:757)
- 到着カードがなく、表示可能な新区間のフラッシュも抽選もない場合、共有到着文の段階を通りません。通常の演出付き結果公開は現在の結果側の条件にも当たらず、トーストだけが表示されます。 [turnMoments.ts:132](/home/yuulis/yamanote-line-sugoroku/src/features/game/animation/turnMoments.ts:132) · [turnMomentPresentation.ts:423](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:423) · [turnMomentPresentation.ts:449](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:449)

## Design (state shape, where it lives, when keys are recorded, reset rules)

- `deriveTurnMomentDisplay` は節目なしの基本文と、適格な場合の `{ key, text }` を返します。キーは実際の公開ターンと閾値から作り、30/30 には閾値 `30` を使います。移動完了、公開境界、`entryTurn`、30/30 到達と同時にクリアした場合の既存条件を維持します。classic は従来どおり `RollAttempt` なしでキーを解決できます。
- `GameApp` にセッション単位の `Set<string>` と、直前のコミットで節目文を載せていた場合だけ保持する `{ key, baseText, surface }` を置きます。未消費なら節目文を付けます。消費済みなら、直前のコミットから同じ live region と基本文が連続している間だけ全文を維持します。途中で別の文、通知、ダイアログ、領域のアンマウントを挟んだら保持を終了します。これにより、到着 → flip → settle で接尾文を外す更新も、同じ文面に戻ったときの再付与も防げます。
- `GamePanel` は通知調停と表示先の決定を経て、節目文を含む live region がコミットされたときだけ `GameApp` に報告します。`GameApp` はコミット後にキーを記録し、その記録だけでは再描画を起こしません。状態変更はレンダー中に行わず、同じコミットの再通知は冪等に扱います。捨てる選択が最初の公開先なら、そこで一度だけ付けます。ルール表示で領域が未マウントなら、その時点では消費しません。
- 到着後の Skip や途中からの OS モーション軽減は、同じキーの結果文に節目文を再付与しません。到着前の Skip、最初からのモーション軽減、演出なし、classic では、結果側の最初の適格なコミットで付けます。classic が次の移動中に前回の要約を保持する間も、同じ領域に既出の全文を据え置きます。前回の要約を節目候補として再登録する必要はありません。
- タイトルに戻るかセッション ID が変われば、集合と直前の表示情報を破棄します。同じタブの新規ゲームでは、同じターン・閾値を再び読み上げられます。再開は集合が空でも `entryTurn` で履歴を除外し、保存済みの捨てる選択の確定も新規扱いしません。現行のセッション遷移にプレイヤー向け Undo は見当たりません。保存データの復元は新しいセッション ID を割り当てる再開経路を通ります。 [gameSession.ts:195](/home/yuulis/yamanote-line-sugoroku/src/features/game/gameSession.ts:195)

## Steps (each: files, change, tests, est. LOC; mark which steps change anything visible/audible)

1. **Vitest の回帰テストを先に追加。約 35〜55 行。画面・音声の変更なし。** `game-app-turn-moments.test.ts` の既存の境界・コミット記録を使い、節目付きの到着文が抽選まで同一で、到着カードまたは抽選から Skip した後の結果文には節目がないことを確認します。もう一つの経路で、最初から演出を省略したターンの初回結果には節目があり、同ターンのアイテム操作後にはないことを確認します。既存の 30/30 と再開テストも維持します。
2. **公開候補とコミット時の消費を実装。製品コード約 45〜70 行、既存ユニットテストの参照先変更約 10〜20 行。音声のみ変更。** `turnMomentPresentation.ts` で候補を分離し、`GameApp.tsx` と `GamePanel.tsx` で既存の live region への付与と消費を実装します。候補を検証する既存ユニットテストを更新し、S16 の実際の文面遷移と status 領域数のアサーションは維持します。
3. **関連の欠落を同時に直す場合のみ。製品コード約 5〜10 行、Vitest 約 10〜15 行。音声のみ変更。** 未消費の候補に結果公開時のフォールバックを許可し、カード・フラッシュ・抽選を通らないケースで初回の結果に一度だけ付くことを確認します。トーストの表示タイミングは従来どおりです。
4. **検証。追加 E2E は 0 本。画面・音声の変更なし。** ユニットでコミット列を検証できるため、ブラウザでは既存の節目ライフサイクルとアクセシビリティ仕様を実行します。

   ```sh
   npm run typecheck
   npx vitest run
   npm run build
   npx playwright test tests/e2e/hud-progress-feedback.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --project=phone-chromium
   ```

## Existing assertions affected

- 再読み上げを期待する既存のアサーションは、確認した範囲にはありません。`hud-progress-feedback.spec.ts:300` の「#96 は繰り返しを許容する」というコメントは削除または訂正します。同テストの到着・モーション軽減での正のアサーションと、再開時の負のアサーションは維持します。 [hud-progress-feedback.spec.ts:274](/home/yuulis/yamanote-line-sugoroku/tests/e2e/hud-progress-feedback.spec.ts:274)
- `progress-milestone-publication.test.ts:63,67,73–76,84,120,126,134` と `turn-moment-presentation.test.ts:410,413,417` は、純粋な導出関数で合成済みの `.announcement` を参照しています。節目の有無と文言は候補の有無と完全一致で検証し、共有フェーズでは基本文と候補の両方の一致を検証します。初回に実際の status へ一度だけ付くことは `GameApp` のコミット列で直接検証します。 [progress-milestone-publication.test.ts:59](/home/yuulis/yamanote-line-sugoroku/tests/unit/progress-milestone-publication.test.ts:59) · [turn-moment-presentation.test.ts:406](/home/yuulis/yamanote-line-sugoroku/tests/unit/turn-moment-presentation.test.ts:406)
- `progress-milestone-publication.test.ts:126` は、区間フラッシュで一度公開した後の結果に節目文がないという期待です。関連の欠落も直す場合は、同じ経路で結果側の候補を許可するため、この負のチェックを「フラッシュ → 結果」の `GameApp` テストに移し、結果の status に節目文がないことを引き続き検証します。 [progress-milestone-publication.test.ts:117](/home/yuulis/yamanote-line-sugoroku/tests/unit/progress-milestone-publication.test.ts:117)

## User decisions needed

カード・フラッシュ・抽選がないターンでも、結果公開時に節目文を新しく読み上げるか。実装は同じ消費機構で対応できます。#96 の必須範囲は重複と再開時の抑止とし、この音声追加は明示的に含める場合に実施する想定です。

## Risks

- 消費を候補の導出時に行うと、通知の調停やルール表示で読み上げ領域に届く前に節目を失います。逆に、消費直後の再描画で接尾文を外すと、S16 と同じ余分な live-region 更新が起きます。コミット後の記録と、同じ文面を表示し続ける間の保持をセットで実装します。
- `summaryTurn` だけを条件にすると、到着・抽選で既に公開した事実を表せません。モーション軽減で表示上は `published` でも実際の移動中である境界もあるため、節目候補には既存の移動完了条件を適用します。 [turnMomentPresentation.ts:408](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:408) · [turnMomentPresentation.ts:456](/home/yuulis/yamanote-line-sugoroku/src/features/game/turnMomentPresentation.ts:456)
- 自動テストで確認できるのは DOM に公開された読み上げ文とその更新回数です。実際の発話順や、短い間隔で更新された文を読み切るかは、ブラウザとスクリーンリーダーの組み合わせに依存します。
