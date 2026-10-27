# Item system S10 — events, animation and accessibility

## Objective
Make item turns present correctly end to end — harmful-event and pickup notices, deadhead relocation and long rapid/oversleep moves in the animation, correct history after resume, coordinated screen-reader announcements and focus — and cover the flows with an item-mode E2E spec, while the shipped classic product stays unchanged.

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — "UI plan" subsections "Harmful events and historical presentation" and "Accessibility and mobile", and "S10". Overrides from the Addendum / DESIGN.md (2026-10-27): one active item per turn incl. adjust; player-chosen discard (notice should say which item was discarded by the player's choice, not "discarded because full").
- Built so far (committed on `feature/item-system`): engine S2–S5 (records `ItemRideRecord` / `ItemDeadheadRecord` with `rawRoll`, `effectiveFace`, `movementMode`, `pips`, `hopBudget`, `physicalHops`, `unusedPips`, `stopReason` incl. `relocation`, `landing` possibly null on non-clearing turns, `itemEvents`), save v4 S6, session S8 (`itemSession.ts`, `useGameApp.ts`, item view model with `events`), UI controls S9 (`InventoryPanel`, `ItemUseDialog`, `RollAdjustment`, `DiscardChoice`, `itemPresentation.ts`). Presentation/animation today: `src/features/game/presentation.ts`, `presentationResolver.ts`, `src/features/game/animation/*`, `GamePanel.tsx`, `GameApp.tsx`, map in `src/features/map/`.
- Notice copy (Japanese, concise, natural): 遅延 → 発動ターンと残りターン; 運休 → 路線名と残りターン, and when every candidate was suspended explain it was ignored at that station; 寄り道 → 次に別の路線へ乗り換えられる駅で発動; 寝過ごし → 次のターンは終点まで（環状線は6駅）; 遅延証明書 → 拾った不利なアイテム名と「遅延証明書で打ち消しました」; 拾った → アイテム名と一言効果; 捨てた → 選んで捨てたアイテム名. Use the S9 display names.
- E2E enablement before S11 (product still classic): add an E2E-only ruleset override following the existing `import.meta.env.MODE === "e2e"` pattern in `src/features/map/e2eHook.ts` (e.g. a query parameter or init-script flag that selects `ITEM_GAME_CONFIG` for the edition), compiled out of production builds (prove with a check that the production bundle does not contain the override string, or the same mechanism the existing hook uses). Do not add any user-visible ruleset picker.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In: `presentation.ts`, `presentationResolver.ts`, `gameSession.ts` / `itemSession.ts` (presentation-related only), new `ItemEventNotice.tsx`, affected `animation/*` modules, `GamePanel.tsx` / `GameApp.tsx` wiring, `src/styles.css`, the E2E-only override, tests: `tests/unit/animation.test.ts`, `tests/unit/game-presentation.test.ts`, `tests/unit/item-controls.test.ts`, `tests/unit/game-session-items.test.ts` (extend), new `tests/e2e/items.spec.ts`.
1. Remove assumptions that `landing: null` means the goal and that hops equal pips/roll; animate physical hops; deadhead repositions the marker directly with relocation text (no invented route); long rapid/oversleep moves respect skip and reduced motion and have a bounded duration.
2. Notices for arrival + item outcomes, derived from verified records/events (on resume, rebuild from history, never by applying today's effects to past turns).
3. One coordinated polite live region for roll availability, revealed die, adjust decision, harmful events and effect activation (no competing announcements); focus to the adjust heading when it opens and back to the roll control after; reduced motion skips presentation only.
4. `tests/e2e/items.spec.ts` (with the E2E override and the existing fixture network/seed approach): stage and use an item; pending-roll reload resumes the same die; adjust ±1; full-inventory discard; certificate cancellation notice; harmful countdown; repeated clicks don't double-advance; skip and reduced motion; map failure still lets every item decision work via text. Pick seeds deterministically (search in a unit helper if needed, and pin them like existing E2E seeds).
Out / must not touch: shipped default/editions display text/title rules/share text/manual (S11), engine rules (report bugs instead of fixing unless trivial and covered by a test), gameplay snapshots, `tests/unit/item-classic-regression.test.ts`.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`. Memory notes for this repo's E2E: Firefox WebGL2 needs xvfb in CI; WebKit is CI-only; on WSL2 avoid `pkill -f`. Locally run Chromium projects only.

## Acceptance checks
```bash
npm run typecheck
npx vitest run tests/unit/animation.test.ts tests/unit/game-presentation.test.ts tests/unit/item-controls.test.ts tests/unit/game-session-items.test.ts tests/unit/item-classic-regression.test.ts
npm test
npm run build
npx playwright test tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts tests/e2e/map-failure.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --retries=0
git status --short
```
(Adapt the playwright file list to the specs that actually exist; say which ones you ran.)

## Output (English, under 45 lines)
Files changed; how the E2E override works and how it is excluded from production; notice/announcement design; animation changes; E2E scenarios and pinned seeds; acceptance results with pass counts; anything left for S11/S12.
