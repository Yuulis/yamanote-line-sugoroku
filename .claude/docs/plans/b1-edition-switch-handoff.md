# B1 Edition Switching — Handoff

Resume point for any session (Claude or Codex). Update after every step.

## Goal

Make the app edition-aware (edition = dataset + `GameConfig` + display text)
with the current 東京近郊 edition as the only registered edition. No behaviour
change for current players.

## Decisions (user, 2026-10-20; DESIGN.md Key Decisions)

- Infrastructure only; 山手線のみ, 23区, 1都3県 revival deferred.
- Current data stays at `public/data/`.
- One save slot per edition; the existing key
  `yamanote-line-sugoroku:save:v1` stays the 東京近郊 slot (no migration).
- Edition chosen on the title screen only (no URL parameter, no remember-last).
- Lead assumption (from the plan): with one edition the picker is hidden.

## Documents

- Investigation: `.claude/docs/research/b1-edition-switch-investigation.md`
- Plan (6 commits): `.claude/docs/plans/b1-edition-switch-plan.md`
- Delegation prompts: `.claude/docs/plans/b1-edition-switch-prompts.md`

## Branch

`feature/b1-edition-switch` (from develop `ed52d6e`), PR target `develop`.

## Step Status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| Investigation + plan | done | — | Codex Sol plan adopted 2026-10-20 |
| 1 Registry + compatibility pins | pending | | |
| 2 Persistence slots | pending | | |
| 3 Runtime/presentation wiring | pending | | |
| 4 Picker component (+ `jsdom` devDependency) | pending | | |
| 5 Switching + async loading | pending | | |
| 6 Docs + full regression gates | pending | | |

## Notes

- C2 (CI) is done: a docs-only push here (run 39353441915) skipped the E2E
  legs and the required `E2E (Playwright)` check passed in 1.5 min.
- Next after B1: A1 (result text sharing).
