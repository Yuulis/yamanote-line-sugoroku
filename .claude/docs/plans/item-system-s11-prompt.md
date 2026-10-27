# Item system S11 — ship the item ruleset as the only playable ruleset

## Objective
Switch the single registered edition to `ITEM_GAME_CONFIG`, update the title rules, manuals and product E2E/fixtures to the item ruleset, and keep classic only as an explicit internal config for engine/simulation tests — on branch `feature/item-system` only (no PR, no release).

## Context
- Plan: `.claude/docs/plans/item-system-plan.md` — "S11", section 5 "Configuration and edition wiring", "Title and result sharing", "Risks" (fixtures regenerated with provenance; historical payloads kept for rejection tests). Handoff: `.claude/docs/plans/item-system-handoff.md` (S1–S10 done; S10 added an E2E-only `?e2e-items=1` override in `src/features/game/e2eRuleset.ts`).
- User decisions (DESIGN.md Key Decisions, 2026-10-27): players only play the item ruleset; classic stays internal. **Result sharing: the edition label stays 「東京近郊版」 (unchanged), and the three metrics stay turns / moves / transfers (no item counts). Deadhead counts 0 moves and 1 turn; a route-ticket or deadhead change of service group counts as a transfer, excluding same-group 大江戸線 changes** (plan "Open questions" answer 9 — implement and test this accounting in `gameSummary.ts` if it does not already hold).
- Ruleset facts for the copy: on every final stop 30% chance to get an item, 30% of those are harmful; hold up to 3; at most one item per turn, used before rolling (出目調整券 is used after seeing the roll instead); when full, choose one of four to discard; at a Yamanote station 山手線 wins 1/2, other services split the rest; on other services the direction toward 山手線 is weighted 3:2; goal unchanged (山手線外回り全30区間 then 新橋). Item names/effects: see `.claude/docs/plans/item-system-s9-prompt.md`.
- Branch `feature/item-system`. Do not commit, push or switch branches.

## Scope
In:
1. `src/features/game/gameConfig.ts`: `MVP_GAME_CONFIG` (or a new explicit `DEFAULT_GAME_CONFIG` used by product code — prefer the explicit name) becomes `ITEM_GAME_CONFIG`; `CLASSIC_GAME_CONFIG` stays exported for internal use. Update `tests/unit/item-classic-regression.test.ts` ONLY in its alias assertion (the one documented as "S11 flips this"): replace it with an assertion that the shipped config is the item config and classic is still the frozen literal; leave every other assertion in that file untouched.
2. Edition: `src/features/editions/registry.ts` uses the item config; same edition id, data URL, station counts and save key; rewrite `ruleParagraphs` in natural, concise Japanese covering the ruleset facts above (keep the existing paragraph structure/`strong` usage style). No rules picker.
3. The E2E override: with item mode now the default, remove `?e2e-items=1` if nothing needs it, or keep it only if a spec still needs to force a ruleset — do not add a classic override for product specs.
4. Product E2E and fixtures: update existing specs that assume classic (`tokyo-suburban.spec.ts`, `resume.spec.ts`, `full-game.spec.ts`, `real-data.spec.ts`, `lottery.spec.ts`, `dice.spec.ts`, `save-errors.spec.ts`, others as needed) to item-mode expectations intentionally (not by weakening). Regenerate current-scenario seeds/saves through the real engine with provenance (extend `tests/e2e/fixtures/regenerate-saves.ts` / README); keep historical payloads byte-identical as rejection fixtures. Unit tests that pin product seeds (`e2e-fixture-seeds`, `real-data-e2e-scenarios`, edition tests) follow the new default; tests whose purpose is classic trajectories import `CLASSIC_GAME_CONFIG` explicitly.
5. Sharing: `shareText.ts` keeps 「東京近郊版」 and the existing hashtag/URL; `gameSummary.ts` / `ClearScreen.tsx` count moves/transfers correctly for item records as described above.
6. Docs in Japanese: `docs/manual/tokyo-suburban/rules.md` (current rules incl. all 11 items, probabilities, timing, discard, one-item limit, hints), `docs/manual/tokyo-suburban/implementation-status.md` (item system implemented on `feature/item-system`, not yet released), and any README/spec lines that describe the current ruleset. Follow `.claude/rules/manual-docs.md` and the Response Style in `.claude/rules/language.md` (natural Japanese, no translationese).
Out / must not touch: engine rule behaviour, save format, simulation reference reports, `CHANGELOG`/release notes, version numbers, deployment config.

## Rules to load
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`, `.claude/rules/manual-docs.md`, `.claude/rules/language.md`.

## Acceptance checks
```bash
npm run typecheck
npx vitest run tests/unit/edition-registry.test.ts tests/unit/result-share.test.ts tests/unit/real-data-e2e-scenarios.test.ts tests/unit/e2e-fixture-seeds.test.ts tests/unit/item-classic-regression.test.ts
npm test
npm run build
npx playwright test --project=desktop-chromium --project=phone-chromium --workers=2 --retries=0
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
git status --short
```
(Adapt test file names to those that exist; run the whole Chromium E2E suite. Firefox/WebKit run in CI.)

## Output (English, under 45 lines)
Files changed; the new rule paragraphs (quote them); how product vs classic configs are now named/used; E2E specs changed and why each expectation changed; fixtures regenerated vs kept historical; summary accounting changes; acceptance results with pass counts; anything left for S12.
