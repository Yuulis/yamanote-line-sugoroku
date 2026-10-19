# Map performance (C1) and accessibility (C3) — delegation prompts

Branch: `feature/map-performance-a11y` (from `develop`). Order: C1 first, then C3
(both touch `RailwayMap.tsx`, `GamePanel.tsx`, `GameApp.tsx`). Status lives in
`map-performance-a11y-handoff.md`.

Shared environment quirks (both steps):

- Local Playwright: `env -u WAYLAND_DISPLAY npx playwright test …`.
- Preview/dev servers bind to `::1` (127.0.0.1 closed-port connects stall ~135 s on WSL2).
- Never `pkill -f`; stop servers by port: `lsof -t -iTCP:<port> -sTCP:LISTEN | xargs -r kill`.
- Do not commit or push; the lead verifies and commits.

## C1 — map load/render speed-ups (route: Claude `general-purpose-opus`)

Objective: implement the five low-risk map speed-ups chosen by the user from
`.claude/docs/research/c1-map-performance-baseline.md` and prove each with the
baseline script, without changing game behaviour or visuals.

Scope IN (items numbered as in the report's ranking):

1. Add the railway sources/layers on `style.load` instead of `load`
   (`src/features/map/RailwayMap.tsx` ~L207). Keep the style-failure / retry
   path and the E2E map-ready hook (`src/features/map/e2eHook.ts`) semantics
   correct: "ready" must still mean the railway layers exist and the map can be
   driven. Handle `style.load` firing again after a style reload/retry without
   adding duplicate sources/layers.
2. (report item 2a) Split station labels into key-station (from z11) and
   ordinary-station (from z13) layers instead of rendering ordinary labels at
   `text-size: 0` (`src/features/map/railwayLayers.ts` ~L179-207), so their
   glyphs are not built at the opening view. Visible label behaviour at each
   zoom must stay the same.
3. (report item 3a) In `index.html`: `<link rel="preload">` (as=fetch,
   crossorigin matching how the app fetches) for the published data files the
   app loads at startup, and `<link rel="preconnect">` to the tile host. Only
   files actually fetched at startup; URLs must match exactly or the preload is
   wasted (verify no "preloaded but not used" console warning).
4. (report item 5) Restrict the `railway-base` layer to the features that need
   it, instead of drawing all ~1,938 features under `railway-services`. Confirm
   first what `railway-base` is for; the rendered map must look the same.
5. (report item 7) Stop React re-rendering GameApp/GamePanel/GameLegend on every
   animation frame (memoization / narrower state subscriptions). No behaviour
   change.

Scope OUT: basemap style changes (user decided: keep Liberty as is), self-hosted
glyphs, lazy-loading MapLibre, worker dedupe, data-pipeline or `public/data`
changes, accessibility fixes (that is C3, next step). Do not weaken, skip, or
delete tests; do not add fixed-time waits to E2E.

Inputs: the report above, `scripts/perf/measure-map.mjs` (`npm run perf:map`),
`src/features/map/*`, `src/App.tsx`, `src/features/game/components/*`,
`index.html`, `tests/e2e/*`, rules `.claude/rules/coding-principles.md` and
`.claude/rules/testing.md`.

Acceptance checks:

- `npm run typecheck`, `npm test`, `npm run build` pass.
- `env -u WAYLAND_DISPLAY npm run test:e2e` passes (Chromium and Firefox).
- `npm run perf:map` (stub, desktop+mobile, 5 runs) and
  `npm run perf:map -- --tiles live` re-run after the changes; report before/after
  medians for map load, map idle, TBT, and pan/move fps against the baseline in
  the report.
- Unit tests added/updated where logic changed (e.g. layer definitions, filters).

Output shape (≤50 lines): changed files with one line each; before/after table;
test results with counts; anything not done and why; risks.

Context discipline: write the before/after detail into a new section at the end
of `.claude/docs/research/c1-map-performance-baseline.md`; raw runs stay in
`.claude/logs/perf/`. Return only the summary and paths.

## C3 — accessibility and mobile fixes (route: Codex Luna xhigh, fast mode)

Command:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file .claude/logs/codex/prompt-c3-a11y.md --label c3-a11y --caller claude-main \
  --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh \
  --config service_tier=fast --timeout 3600
```

Prompt (copied to `.claude/logs/codex/prompt-c3-a11y.md` at launch):

Objective: fix the eight Medium findings (A1–A6, M1, M2) in
`.claude/docs/research/c3-accessibility-audit.md` so keyboard, screen-reader and
phone users can follow position, lottery, progress and clear without the map.

Scope IN: exactly A1, A2, A3, A4, A5, A6, M1, M2 as described in the report
(file:line and proposed fixes there). Low findings are out of scope unless a Med
fix naturally covers one (say which). Japanese UI text, matching existing tone.

Scope OUT: map performance code paths changed in C1 except where M2/A4 require
it; game engine, data, save format, ruleset; no new npm dependencies; do not
weaken, skip, or delete tests; no fixed-time waits in E2E.

Inputs: the audit report, its evidence under `.claude/logs/a11y/out/` and specs
`.claude/logs/a11y/a11y.spec.ts`, `a11y2.spec.ts` (reuse to re-verify),
`src/features/game/components/*`, `src/features/map/*`, `src/GameApp.tsx` or
wherever `GameApp` lives, `src/styles.css`, `tests/e2e/*`, rules
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

Acceptance checks:

- `npm run typecheck`, `npm test`, `npm run build` pass.
- `env -u WAYLAND_DISPLAY npm run test:e2e` passes (Chromium and Firefox).
- New/updated unit or E2E tests cover: focus kept/restored after an animated
  roll (A1) and on screen changes (A3, A6); one turn-summary live region text
  including turn number, roll, arrival station and progress, also for a repeated
  identical roll (A2); text view of remaining sections / upcoming stations (A5);
  compact layout at 667x375 keeps lottery and options visible (M1); recentre
  respects phone panel padding (M2).
- Re-run the audit specs and state which findings are resolved.

Output shape: per finding — fixed/partial/not done, files, test that proves it;
check results with counts; risks.
