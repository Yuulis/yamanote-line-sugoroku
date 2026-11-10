## Feature Brief: Issue #70 text wrapping and HUD readability

### Current State
- Architecture: presentation-only React components under `src/features/game/components/` styled by the single global stylesheet `src/styles.css`. Display strings come from data (`serviceName()` in `presentationResolver.ts`, `directionLabels` in public data) and are reused verbatim for visible text, `title`, aria-labels, live regions and share text.
- Relevant files: `src/styles.css` (HUD grid `:628-654`, phone HUD `repeat(4, 24px)` at `:1895`, half-width direction column `:1906-1907`, arrival banner `:432-440`, options buttons `:958-962`), `GameHud.tsx` (`title` mirror `:74-84`), `ItemUseDialog.tsx`, `RollAdjustment.tsx`, `GamePanel.tsx`, `LineBadge.tsx`; E2E `tests/e2e/hud-layout.spec.ts`, `ui-pop.spec.ts`, `game-settings.spec.ts`; unit `tests/unit/game-hud.test.ts`.
- Patterns: no `word-break` / `line-break` / `text-wrap` / `<wbr>` anywhere in `src/`; about 12 long-text selectors use only `overflow-wrap: anywhere`. Unit tests use Vitest + jsdom with `mountReact`; some unit tests assert on `styles.css` by regex. A one-line layout check (Range `getClientRects` tops + `scrollWidth <= clientWidth`) is repeated inline in three E2E specs. Playwright projects: desktop chromium/firefox/webkit (webkit CI-only) and phone (Chromium Pixel 7, 412x839); default `reducedMotion: "reduce"`.
- Full scan: `.claude/docs/research/feature-text-wrapping-readability-codebase.md`.

### Feature Goal
Japanese text in dialogs, buttons and long service names breaks at natural points (supported phrase detection or explicit hints) at 390px and 1280px — a single unbreakable token wider than its container may still break inside to preserve containment — and the phone HUD shows the ride name and direction in up to two lines at a larger, readable size, so that exciting moments never look broken.

### Scope
- Include:
  - Short labels (buttons, chips, dice/roll-adjust labels) stay on one line; their containers wrap per cell, not mid-label, with no horizontal overflow at 320px.
  - Long Japanese text (item-use dialog, roll-adjust dialog, route options, long service names, direction text) wraps at natural points: `word-break: auto-phrase` where supported, fallback `keep-all` + `overflow-wrap: anywhere`, plus render-time `<wbr>` break hints (spaces, brackets, 「・」, before 「方面」) through a small display-only component; data strings stay unchanged.
  - `text-wrap: balance` only for headings and short multi-line messages.
  - Phone HUD: 乗車中 and 進行方向 values wrap to at most 2 lines at natural breaks, then ellipsis, with a constant reserved 2-line height; phone HUD values 15–16px, labels 13px.
  - Layout E2E for the longest display service name, longest direction, item dialog and roll-adjust dialog at 390px and 1280px (plus 320x568 boundary), including Firefox/WebKit at phone width for the fallback path; shared layout helper.
  - Speed-button wrap: regression check only (already fixed in v0.13.0 `ab9213d`, guarded by `tests/e2e/game-settings.spec.ts:52-76`).
- Exclude:
  - Engine, RNG, save format, `src/types/network.ts`, public data and data pipeline (no operator/line split field).
  - Tap-to-expand HUD (user chose 2-line wrap, 2026-11-10).
  - Enlarging the title-screen version text or the subtitle hidden on phones.
  - MapLibre map labels and station popups.
  - New dependencies.

### Complexity Classification (from Codex)
- Classification: COMPLEX
- Estimated files: 8 core, 10–14 including related displays
- Estimated LOC: 400–750 (wrapping component + call sites 80–160, CSS/phone HUD 70–130, unit 50–100, E2E 200–360)
- Implementation route: team-execute (COMPLEX); in practice step-by-step Codex implementation with lead verification per step, as in prior features, lane chosen by the user at plan approval

### Integration Points
- String/render boundary: `serviceName()` / `directionLabel()` return plain strings; only visual call sites wrap them in the break-hint component so `title`, accessible names and live regions keep the exact original text.
- Phone HUD fixed grid: `repeat(4, 24px)` rows and fixed `dd` heights must be reworked so the ride/direction rows always reserve two lines, keeping the dice button position stable and the phone panel at or below 45% of the viewport.
- Dialog button groups: adding `nowrap` must be paired with group wrapping/stacking so 320px does not overflow.
- E2E state: `longestRideGame()` stops at names of 5+ characters and does not reach the true longest name; a deterministic long-name state (real dataset or purpose-built fixture) is needed.

### Risks
- Small phone height (320x568, panel cap about 256px): two reserved 2-line rows add about 28–32px → measure early; keep the 45% and no-clipping checks.
- Existing test contracts (dice position ±1px, panel ≤45%, desktop no-scroll, `title` === shown text): design keeps them; only the `hud-layout.spec.ts:~148` "full text shown" comment/expectation changes to the new 2-line-then-ellipsis spec, with new assertions added, none removed.
- Fallback path still breaks a single unbreakable over-long word: explicit break hints first, safe containment last.
- Phone E2E is Chromium-only: run the new spec in Firefox/WebKit at phone width.
- Clamped text and Range measurement: verify visible lines via box height and clamp, not glyph rect counts; avoid font-dependent character-position assertions.

### Success Criteria
- At 390px and 1280px, buttons/chips in the item dialog, roll-adjust dialog and menu stay one line with no horizontal overflow; at 320px nothing overflows horizontally.
- At 390px and 1280px, supported phrase detection or explicit hints provide natural breaks for the longest display service name and direction. In every browser, a single unbreakable token wider than its available width may break within the token to preserve containment; dictionary-level Japanese segmentation is not guaranteed.
- Phone HUD ride/direction show up to 2 lines then ellipsis; values 15–16px, labels 13px; dice button position and 45% panel height tests still pass.
- `title`, accessible names and live-region text are byte-identical to before.
- typecheck, vitest, build, targeted E2E locally and the full 4-project CI matrix pass.
