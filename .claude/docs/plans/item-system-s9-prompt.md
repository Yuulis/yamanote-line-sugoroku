# Item system S9 — inventory, decisions and hints UI

## Objective
Render the item-mode controls on top of the S8 session view model — three inventory slots, staging one pre-roll item with its choices, the post-roll adjust decision, the full-inventory discard choice and first-time-player hints — usable by keyboard and screen readers and at 320–390 px widths, while the shipped classic UI stays unchanged.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — "UI plan" subsections "Inventory and pre-roll use", "Guidance for first-time players", "Accessibility and mobile", and "S9". **Overrides from the Addendum / DESIGN.md (2026-10-27):** only ONE active item per turn in total (staging a second item replaces the first; adjust is unavailable if a pre-roll item was used); full inventory → the player picks one of four to discard; the plan's "route+direction+double" bundle UI and "raw 4 → adjusted 5 → doubled 10" example do not apply (no combinations).
- Session/view model from S8: `src/features/game/itemSession.ts`, `useGameApp.ts` (read-only item view model: inventory, draft, availability reasons, route/direction/rapid/deadhead hints, adjustment/discard options, effects, item events; controls for draft editing, rolling, adjustment, discard). Existing UI: `src/features/game/components/GamePanel.tsx`, `src/app/GameApp.tsx`, `src/styles.css`, presentation helpers `presentation.ts` / `presentationResolver.ts`, `ConfirmDialog.tsx` (native modal pattern).
- Product still ships classic (`MVP_GAME_CONFIG`) until S11; item UI renders only when the session is in item mode.
- Display names and one-line effects (Japanese UI text; keep exactly these names):
  - 路線指定券 — 今いる駅で乗る路線を選べる（向きは抽選）
  - 方向指定券 — 山手線以外の路線で進む向きを選べる
  - 出目調整券 — 出目を見てから ±1 できる
  - 倍速券 — この回の出目が2倍になる
  - 快速券 — 2路線以上が止まる駅だけを1駅と数えて進む
  - 回送列車 — いちばん近い山手線の駅へ移る（サイコロは振らない）
  - 遅延証明書 — 持っているだけで、次に拾う不利なアイテムを1回打ち消す（使うボタンなし、枠を1つ使う）
  - Harmful (shown in effects/notices, not held): 遅延（3ターン後の出目が1）, 運休（その路線が5ターン乗れない）, 寄り道（次の乗換駅で別の路線へ）, 寝過ごし（次のターンは終点まで、環状線は6駅）
- Hints (from the engine queries via the view model, never from future draws): at an eligible interchange "路線指定券で山手線に乗れます"; per candidate service show its direction labels and whether the next stop is closer to 山手線 (equal → say there is no shorter direction; note hop distance is guidance, not travel time); recommend 快速券 only when heading toward 山手線 and warn otherwise; mark 回送列車 on 山手線 as おすすめしない (it stays on the same station and spends a turn) but keep it selectable; disabled items show the reason (山手線は向きが固定, 運休中で選べない, 遅延・寝過ごしのターンは使えない, ほかのアイテムを選択中). Keep grouped display names (e.g. 大江戸線) while selecting concrete services.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In: new components (e.g. `InventoryPanel.tsx`, `ItemUseDialog.tsx`, `RollAdjustment.tsx`, `DiscardChoice.tsx`) under `src/features/game/components/`, pure `src/features/game/itemPresentation.ts`, wiring in `GamePanel.tsx` / `GameApp.tsx`, styles in `src/styles.css`; tests `tests/unit/item-presentation.test.ts`, `tests/unit/item-controls.test.ts` (follow whatever component-test approach the repo already uses; if none exists, test pure presentation/view logic and keep components thin), and `tests/unit/game-presentation.test.ts` updates only if needed.
1. Inventory: three slots (empty slots visible), name, one-line effect, availability/disabled reason; certificate shows 「持っているだけで効く」 with no use button.
2. Pre-roll staging: choose at most one item; route ticket → pick a concrete service (Yamanote highlighted when eligible); direction ticket → pick a direction; others need no extra input; selected item shown next to the roll button; revisable until the roll is committed; Escape cancels an uncommitted selection only.
3. Roll adjust: after the die is revealed (only when the session offers it), show the raw die, legal −1/+1/そのまま choices with the resulting pips, and a continue action; closing never cancels the roll.
4. Discard choice: when pending, list the four candidates (3 held + new, the new one marked 新しく拾った) and require choosing one to discard.
5. Accessibility/mobile per the plan: native modal focus behaviour, keyboard operable, selected state and reasons exposed to assistive tech, focus moves to the adjust heading when it opens and back to the roll control after; works without the map (text only); readable at 320 px with no horizontal page scroll.
Out / must not touch: harmful-event notices, animation changes, live-region coordination beyond what the controls themselves need (S10); product default, title/rules text, share text (S11); engine and session behaviour (report bugs instead of fixing unless trivial and covered by a test); gameplay snapshots; `tests/unit/item-classic-regression.test.ts`.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Match the existing component, CSS naming and Japanese copy style.

## Acceptance checks
```bash
npm run typecheck
npx vitest run tests/unit/item-presentation.test.ts tests/unit/item-controls.test.ts tests/unit/game-presentation.test.ts tests/unit/item-classic-regression.test.ts
npm test
npm run build
git status --short
```

## Output (English, under 40 lines)
Files changed; component structure; how one-item staging, adjust and discard flow work in the UI; how hints are derived; accessibility measures; how you verified narrow layout (and what could not be verified without a browser); acceptance results with pass counts; anything left for S10/S11.
