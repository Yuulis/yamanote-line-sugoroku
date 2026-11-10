# Issues #60-#63 review against v0.13.1 (develop)

Date: 2026-11-10. Author: general-purpose-opus (read-only; no issue, source or git changes).
Baseline: local `feature/text-wrapping` at `f4bd993`, which matches `origin/develop` in `src/`
(develop adds only the v0.13.1 release-prep commit `7372a76`: version bump and release notes).
Drafts: `.claude/docs/research/issue-60-63-drafts/issue-{60,61,62,63}.md` (Japanese, #65-#73 format).

Method: read #60-#63 (bodies + comments) and #65-#73 via `gh issue view --json`; read the cited
source; diffed `v0.12.0..HEAD` for the files each issue touches; queried `public/data/services.json`.
Nothing was run in a browser, so every UI claim below is from code reading unless stated.

Key fact for all four: since v0.12.0 (`2d3d7c3`) the only commit touching the relevant files is
`4fd0e58` (very-fast speed, `gameConfig.ts`). v0.13.0 (#74, #75) and v0.13.1 (#79) did not address
any item in #60-#63. Status is therefore "not done" almost everywhere; the value of the edit is
re-verified evidence, current line numbers, and scoping.

Draft editing conventions used:
- The original ver.0.12.0 observations (body + the later "追加案" comment) are merged under
  `## ver.0.12.0 時点`, with stale file:line refs removed there (e.g. `GameMenu.tsx:320-343` no
  longer exists; the file is 140 lines) and current refs placed under `## ver.0.13.1 時点`.
- Every user idea is kept verbatim or near-verbatim; additions are marked as sub-bullets.
- No `## 対応済み` section was added because no item is fully done. Partly-done facts are stated
  in `## ver.0.13.1 時点`.
- One silent typo fix: #60 "前30区間" -> "全30区間".

---

## #60 ユーザーに見せるルールについて

Summary: the title screen shows ~353 characters of rules in 3 paragraphs; there is no detailed
rules screen and no way to read rules mid-game.

| Item | Status | Evidence |
|------|--------|----------|
| Shorten title text | Not done | `src/features/editions/registry.ts:25-29` unchanged since v0.12.0; rendered at `TitleScreen.tsx:213-219` |
| Detailed rules screen (clear conditions, lottery odds, items with images) | Not done | No component; `grep 遊び方` finds nothing in `src/`. Source text exists: `docs/manual/tokyo-suburban/rules.md`; icons exist: `ItemIcon.tsx`, copy: `itemPresentation.ts:51-66` |
| 「遊び方」 in game menu, opened as modal, deep links | Not done | `GameMenu.tsx:102-134`: 追尾 / 速度 / 演出 / 新規 / タイトル + legend |
| (new) v0.13.0 features unexplained: 演出 levels, おまかせ, とても速い, keyboard shortcuts | Not done | `gameSettings.ts:17-21`, `useGameShortcuts.ts:60-63`; added to the draft's 詳細画面 list |

Overlaps:
- #67 (first-play guide) explicitly positions itself as complementary ("#60 の詳細ルール画面と補い合う").
  Draft keeps static rules in #60 and points coach marks / first-time tips to #67; proposes #67
  tips deep-link into #60's sections.
- #68 (save explanation): draft adds a one-line "auto-save" section to the rules screen but leaves the
  toast/✓ UX to #68.
- #63: a weighted roulette would visualise the same odds the rules screen explains.

Recommended priority: medium-high (title shortening + rules screen), medium (menu entry).
Rationale: it is the landing target for #67's tips, so doing #60 first avoids writing hint copy twice.
Size: M (rules modal with ~5 sections and item table, title copy, menu entry, focus/Escape handling,
E2E). The menu entry alone is S once the modal exists.
Edit type: substantive (adds v0.13.1 evidence, the v0.13.0 settings/shortcuts to explain, the
existing `rules.md` source, cross-refs to #67/#68; merges the comment into the body).

## #61 アイテム関連の改善

Summary: items that do not occupy inventory (harmful items) and their effect chips cannot be
explained on tap; pickup rate 30%; wants more item kinds and wider roll adjustment.

Assumption: "持ち物を埋めない系のアイテム" = harmful items (delay / suspension / detour / oversleep),
which never enter the inventory (`rules.md` アイテム). The draft states the observation in the user's
words and explains it with this reading; confirm with the user.

| Item | Status | Evidence |
|------|--------|----------|
| Hover (PC) / tap (touch) description | Partly done | Inventory items: hover/focus tooltip + tap card since v0.11.0 (`InventoryPanel.tsx:262-305`, commit `ec91983`). Effect chips: `title` only, not interactive (`EffectChips.tsx:14`). Harmful items only reach toast + chip |
| Harmful-pickup toast says what happens | Not done | `toastQueue.ts:71-73` still 「{名前}を拾ってしまった！」; reusable copy at `presentation.ts:137-141`, `:150-153` |
| Pickup rate 30% -> ~50% | Not done | `gameConfig.ts:28-30` `dropChancePerMille: 300` |
| More kinds; roll adjust ±2-3 | Not done | `network.ts:92-95` (7 + 4 kinds); `itemSession.ts:203` `allowedDeltas: (-1 \| 1)[]` |

Important risk surfaced in the draft: any change to drop rate, kinds or deltas changes `GameConfig`,
and `sameConfig` (`engine/save.ts:340-372`) then rejects every in-progress save with
「ルールが異なるセーブデータのため読み込めません。」 (`persistence.ts:57`); `rules.md` states there is
no migration. Rule changes should therefore be batched into one `rulesetVersion` bump, preceded by
`npm run sim` (also an open #73 item: game-length figures predate items).

Overlaps: #67 (first harmful-item hint), #71 (discard confirmation), #66 (item chip on the
last-turn card), #68 (same "tap to explain" mechanism for the save ✓). #73 (re-run simulation).

Recommended priority: chip/toast explanations medium (S); rule changes low-medium (M-L incl.
simulation, balance, copy in title/#60/rules.md, save-break messaging).
Size: S for the UI part; M-L for the rules part. The draft recommends shipping them separately.
Edit type: substantive (splits UI vs rule change, adds the save-compatibility constraint and
simulation prerequisite; keeps all three original ideas).

## #62 MAP関連について

Summary: pending Yamanote segments are grey dashes; no guidance after 30/30; marker has no
heading; HUD direction "sometimes disagrees"; roll-adjust gives no destination preview.

| Item | Status | Evidence |
|------|--------|----------|
| Unvisited Yamanote segments emphasised | Not done | `mapConfig.ts:89-92` (`#8a8a8a`, width 3, dash 2/1.5), `railwayLayers.ts:133-143`; unchanged since M1 `85b8323`. v0.12.0 added only the arrival flash |
| "新橋へ" guidance after 30/30, Shimbashi highlight, bar -> text | Not done | No goal copy in `src/` outside `registry.ts:26`; `TargetProgressBar.tsx` only fills cells |
| Marker shows heading (beak) | Not done | Plain circle layer, `railwayLayers.ts:227-237` |
| 「進行方向」 points at the terminus / "食い違い" | **Not done; root cause found (data bug)** | `presentation.ts:28-31` prints `directionLabels` verbatim. 10 JR services in `public/data/services.json` carry labels that are not their termini (e.g. 京浜東北線 大宮-大船 labelled 「蒲田方面／赤羽方面」, 京葉線 「葛西臨海公園方面」 toward 蘇我, 埼京線 「浮間舟渡方面」 toward 川越; full list in draft). Looks like leftovers from the narrower 23-ward extent in `data/staging/tokyo-suburban-jr/combined/overrides/services.json:348` etc.; the generator itself derives terminus labels (`stage_suburban_jr.py:633-635`). Precedence of override vs generator is inferred, not traced |
| Roll-adjust destination on map | Not done | `RollAdjustment.tsx:61-78` shows pips only; modal dialog |

Overlaps (all already deferring to #62): #65 ("30区間踏破後の導線は #62"), #72 ("山手線の未踏破区間の
見せ方は #62"; also marker line-code badge, which should be designed together with the beak),
#71 ("出目調整のときにHUDが地図を隠す問題は #62"). The draft keeps those boundaries and adds
reciprocal pointers. Note: a "地図なしで確認" unvisited-segment list already exists in the log
drawer (`GamePanel.tsx:328-331`).

Recommended priority: direction-label fix high (bug, S: data override + a `validate.py` check that
labels match termini); 30/30 guidance high (S-M); pending-segment styling medium (S); marker heading
medium (M: bearing from current->next station, MapLibre symbol/icon rotation); roll-adjust preview
medium (M; an S fallback is to print the destination station name in each radio label).
Size overall: M, but splits naturally into an S "quick wins" PR (labels + goal guidance + pending colour).
Edit type: substantive (confirms and explains the user's "？" with data evidence, adds acceptance
idea for the data fix, adds an S fallback for the adjust preview).

## #63 乗り換えイベントについて

Summary: the v0.12.0 split-flap lottery flips service and direction simultaneously, so the
direction row leaks the service.

| Item | Status | Evidence |
|------|--------|----------|
| Service drawn before direction | Not done | Both rows share one `stage` (`LotteryReveal.tsx:58-61`) |
| Direction frames must not reveal the service | Not done; **two leak channels** | (1) direction frames use the resolved service's labels (`LotteryReveal.tsx:55,57`; candidates from resolved service, `landing.ts:222`). (2) when the resolved service has one direction (e.g. Yamanote 外回り), `directionDrawRequired` is false (`landing.ts:238`) so that row never flips and shows its result from the start (`styles.css:2649` hides only flipping rows) -- a static direction row means "Yamanote won" |
| Roulette with weighted slices | Not done | Flap frames cycle candidates evenly (`LotteryReveal.tsx:56`), so the 1/2 Yamanote weight is invisible |

Context from v0.13.0: lottery durations are now per speed (`turnMomentPolicy.ts:25-42`; normal
1.6 s + 0.4 s, very-fast 0.28 s + 0.1 s) and the lottery shows under 「重要なときだけ」 but not
「なし」 (`turnMoments.ts:141-149`). Sequential reveal must split the existing budget rather than add
to it, or it undoes #64's tempo work. DESIGN.md TODO "UI pop P2" already lists the board covering
the phone map and truncated names at 640x400; a roulette worsens the footprint.

Overlaps: #72 (highlight candidate lines on the map during the lottery), #66 (lottery result
readable after the moment), #71 (phone footprint), #60 (odds explanation). No duplication with the
shipped v0.12.0 board: #63 is a defect/refinement of it.

Recommended priority: flap reorder medium (S: render a neutral 「方向 ？」 row until the service
settles, then flip directions; split the flip time e.g. 60/40; update the existing turn-moment unit
and E2E tests). Roulette low (L).
Edit type: substantive (adds the second leak channel, the tempo-budget constraint, and the
neutral-placeholder requirement; both original options kept).

---

## Ranked next 3 across open #60-#73 (excluding #70)

1. **#66 前のターンカード (S, high).** One always-visible line under the dice ("出目3 → 半蔵門
   （+0区間）｜抽選：半蔵門線・渋谷方面") built from text that already exists (`arrivalLogText`,
   `lotteryDisplayText`). v0.13.0 made it more urgent: players on おまかせ, とても速い or 演出「なし」
   now routinely do not watch the moments, so the reason they are on a new line is only in the
   collapsed drawer. It also keeps the lottery result readable after the moment (#63 context) and
   uses the ~280 px of dead desktop panel space. Smallest cost-to-impact ratio on the board.

2. **#62 quick-win slice: direction labels + 30/30 guidance + pending colour (S-M, high).** The
   label mismatch is a correctness bug shown every turn on 10 of the busiest JR services (京浜東北線,
   中央・総武線, 埼京線, 京葉線, ...) and in the lottery itself; it is a data override fix plus a
   validator rule. The 30/30 "あとは新橋" guidance fixes confusion at the single most valuable moment
   of a 15-25 minute game. Both are small and independent of the larger marker/preview work, which
   can stay in #62 afterwards.

3. **#65 山手線までの近さ + 節目演出 (M, high).** The main mid-game drop-off lever left after #64:
   it turns detours to 横浜/大宮 into "getting closer" feedback, and the engine already computes the
   distance (`engine/proximity.ts:38,72`). Milestone toasts at 10/20/25/29 pair naturally with #62's
   30/30 guidance (same copy and toast channel), so doing it right after #62 keeps the wording
   consistent.

Runners-up: **#60 + #67 as a pair** (high value for first-time players, but M + M-L and best done
together, with #60 first); **#73 analytics** (medium; ship before or with #65/#67 if the user wants
their effect measured -- the `game_progress` event is small); **#63 flap reorder** (S, medium; a good
filler PR); **#61 chip/toast explanations** (S, medium).

## Open questions for the user

- #61: confirm "持ち物を埋めない系" means the harmful items.
- #61: is breaking in-progress saves acceptable for a drop-rate/kind change, or is a migration wanted?
- #62: confirm the expected direction label is the service terminus (draft assumes yes, including
  area/系統 ends).
