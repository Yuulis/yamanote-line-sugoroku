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
| 1 Registry + compatibility pins | done | `757d3b3` (+ lead fix `ee08a65`: `documentTitle` = `index.html` title, pinned by test) | `npm run typecheck`; `npx vitest run tests/unit/edition-registry.test.ts tests/unit/product-data.test.ts` (13 passed; compatibility digests matched the pre-change values) |
| 2 Persistence slots | done | `e6adddcf18d8d8759b1b1e49619ae53072c647d2` | `npm run typecheck`; `npx vitest run tests/unit/persistence.test.ts tests/unit/engine-save-v3.test.ts tests/unit/product-data.test.ts` (71 passed) |
| 3 Runtime/presentation wiring | done | `43b353f50d1875d78f415afc8c568f8ebc229af5` | `npm run typecheck`; `npm test` (663 passed, 1 existing skipped); `npm run build`; desktop Chromium E2E (54 passed, 1 existing skipped) |
| 4 Picker component (+ `jsdom` devDependency) | done | `5b58717` | `npm run typecheck`; picker + registry tests (6 passed); `npm run build`; exact `jsdom` (30.1.3 added; lead re-pinned to 30.1.2 in `c368350` because 30.1.3 was < 2 weeks old) |
| 5 Switching + async loading | done | `3bb8b78` | `npm run typecheck`; targeted app/loading/runtime/persistence tests (43 passed); `npm test` (673 passed, 1 existing skipped); `npm run build`; desktop Chromium (54 passed, 1 existing skipped) |
| 6 Docs + full regression gates | done | `4b7026aea99df56dfda8c19c39ed3dce611e0c67` | `npm run typecheck`; `npm test` (673 passed, 1 existing skipped); `npm run build`; desktop Chromium (54 passed, 1 existing skipped); phone Chromium (55 passed). Firefox and WebKit: CI only. |

## Notes

- B1 merged to develop via PR #36 (`36c4e1a`, 2026-10-20); develop CI
  39366748744 green. The intermittent Firefox `accessibility.spec.ts:66`
  failure predates B1 and is fixed on `fix/firefox-webgl-flake`
  (see `c2-ci-speedup-handoff.md`).
- C2 (CI) is done: a docs-only push here (run 39353441915) skipped the E2E
  legs and the required `E2E (Playwright)` check passed in 1.5 min.
- Next after B1: A1 (result text sharing).
