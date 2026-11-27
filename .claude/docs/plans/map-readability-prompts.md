# Issue #72 delegation prompts

Prompts for Codex runs: Luna xhigh implements, Sol low reviews. Re-run with:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file <extracted prompt> --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" \
  --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 \
  --label issue72-s<step> --caller claude-main
```

Reviews use Sol low:

```bash
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file <review prompt> --config model_reasoning_effort=low --sandbox read-only \
  --timeout 1800 --label issue72-s<step>-review --caller claude-main
```

## Step 1.1 — implement

Objective: implement Step 1.1 of `.claude/docs/plans/map-readability-plan.md`, a pure move of
the camera layout observation out of `src/features/map/RailwayMap.tsx`, as one uncommitted step.

Scope:
- IN: exactly the "Step 1.1" section of the plan.
  - Create `src/features/map/railwayMapCamera.ts` and move `cameraLayoutTargets` and
    `useCameraLayoutObserver` into it unchanged, together with any private helpers and types
    only they use.
  - Update `RailwayMap.tsx` to import them.
  - Update test import paths in `tests/unit/map-panel-observer.test.ts`,
    `tests/unit/map-helpers.test.ts` and `tests/unit/turn-result-placement.test.ts`, only if
    they import the moved symbols.
- OUT: every other step of the plan, including the preview, title, overview and follow
  helpers, which Steps 1.2 and 1.3 move later. Also out: DESIGN.md, STATE.md and the plan file.
  Add no new dependencies, and do not commit or push.
- Hard constraints:
  - This is a pure move. Function bodies, effect order, effect inputs and exported behaviour
    stay byte-identical apart from `import`/`export` lines.
  - Do not rename anything. Do not "improve" the code.
  - Do not weaken, skip or delete any test assertion.
  - If a moved symbol is re-exported from `RailwayMap.tsx` for other importers, keep that
    working, or update the importers.

Context: `RailwayMap.tsx` is 1,022 lines against an 800-line maximum. Steps 1.1–1.4 bring it
down with pure moves before any behaviour change. Read plan sections 1–3, and use
`.claude/docs/research/feature-map-readability-codebase.md` as the map of the code.
Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; do NOT run the E2E suite):

```bash
npm run typecheck
npx vitest run tests/unit/map-panel-observer.test.ts tests/unit/map-helpers.test.ts tests/unit/turn-result-placement.test.ts
npx vitest run
npm run build
wc -l src/features/map/RailwayMap.tsx src/features/map/railwayMapCamera.ts
git diff --check
```

Output (markdown):
- the changed files, one line each;
- the moved symbols, with their old and new line ranges;
- confirmation that the moved bodies are identical (state how you checked);
- the acceptance results with pass/fail counts;
- the line counts;
- risks.

## Step 1.2 — implement

Objective: implement Step 1.2 of `.claude/docs/plans/map-readability-plan.md`, a pure move of
the adjustment-preview camera helpers out of `src/features/map/RailwayMap.tsx` into
`src/features/map/railwayMapCamera.ts`, as one uncommitted step.

Scope:
- IN: exactly the "Step 1.2" section of the plan.
  - Move into the existing `railwayMapCamera.ts` the following, together with any private
    constants and types only they use:
    - the preview layout selectors and obstruction measurement (`previewObstructions`);
    - the preview bounds;
    - the origin-marker clearance;
    - preview fitting.
  - `RailwayMap.tsx` keeps mode selection and call order, and imports the moved helpers.
  - Update the import in `tests/unit/turn-result-placement.test.ts` (`previewObstructions`),
    plus any other test that imports a moved symbol.
- OUT: the title, overview and follow helpers (Step 1.3), the segment flash (Step 1.4), every
  later step, DESIGN.md, STATE.md and the plan file. Add no new dependencies, and do not commit
  or push.
- Hard constraints:
  - This is a pure move. Function bodies, constants, effect order and effect inputs stay
    byte-identical apart from `import`/`export` lines.
  - Do not rename anything, and do not refactor.
  - Do not weaken, skip or delete any test assertion.
  - Add no import from `railwayMapCamera.ts` back to `RailwayMap.tsx` (no cycle).
  - Some helpers depend on code that other code in `RailwayMap.tsx` also uses. Known cases are
    `ZERO_MAP_PADDING` and `positionsBounds`, which the title and overview fits use too. Move
    each such dependency into `railwayMapCamera.ts` as well. Export it there, and import it
    back into `RailwayMap.tsx`. The direction stays RailwayMap → railwayMapCamera, so there is
    still no cycle. This counts as part of the pure move.
  - Stop and report only if a dependency cannot move without changing behaviour, for example
    one that reads component state or props.

Context:
- Step 1.1 landed as commit a5487da. It moved `cameraLayoutTargets`,
  `useCameraLayoutObserver`, `PREVIEW_LAYOUT_SELECTORS` (the observer's copy) and
  `isVisibleLayoutTarget` into `railwayMapCamera.ts`.
- `RailwayMap.tsx` is now 945 lines.
- Read plan sections 1–3, and use `.claude/docs/research/feature-map-readability-codebase.md` as
  the map of the code.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; do NOT run the E2E suite):

```bash
npm run typecheck
npx vitest run tests/unit/turn-result-placement.test.ts tests/unit/map-panel-observer.test.ts tests/unit/roll-adjustment-preview.test.ts
npx vitest run
npm run build
wc -l src/features/map/RailwayMap.tsx src/features/map/railwayMapCamera.ts
git diff --check
```

Note: a first run (2026-11-26) stopped without edits because of the shared dependencies above.
That was correct under the earlier wording.

Output (markdown):
- the changed files, one line each;
- every moved symbol, with its old and new line ranges, marking the shared dependencies;
- how you confirmed the bodies are identical;
- the acceptance results with pass/fail counts;
- the line counts;
- risks.

## Step 1.3 — implement

Objective: implement Step 1.3 of `.claude/docs/plans/map-readability-plan.md`, a pure move of
the title, overview and follow camera helpers out of `src/features/map/RailwayMap.tsx` into
`src/features/map/railwayMapCamera.ts`, as one uncommitted step.

Scope:
- IN: exactly the "Step 1.3" section of the plan. Move these module-level functions from
  `RailwayMap.tsx` (current line numbers at HEAD 2f43e99) into `railwayMapCamera.ts`, and import
  them back into `RailwayMap.tsx`:
  - `fitNetworkOverview` (~215)
  - `fitTitleService` (~238)
  - `phonePanelBottomPadding` (~250)
  - `usesBottomPanelCameraPadding` (~259)
  - `cameraLayoutKey` (~272)
  - `recentre` (~279)
- Shared dependencies: a constant or helper the moved functions need may also be used by code
  that stays, for example `IMMEDIATE_CAMERA_DURATION_MS` or `COMPACT_VIEWPORT_QUERY`. Move it
  into `railwayMapCamera.ts` as well, export it, and import it back. This still counts as the
  pure move.
- Stop and report only if a dependency reads component state, props or refs.
- `RailwayMap.tsx` keeps:
  - the camera mode, lifecycle and effects;
  - `attributionPosition`, `usesCompactAttribution`, `attachStationPopup`, `createMap`,
    `navigationControlsContainFocus` and `useSegmentFlash`, unless one is purely a dependency
    of the moved functions. Step 1.4 moves `useSegmentFlash`.
- Tests: `tests/unit/title-map-mode.test.ts`, `map-camera.test.ts` and `map-helpers.test.ts`
  run as written. Update an import path only if a test imports a moved symbol.
- OUT: Step 1.4 and later, DESIGN.md, STATE.md and the plan file. Add no new dependencies, and
  do not commit or push.
- Hard constraints:
  - Bodies and constants stay byte-identical, apart from `import`/`export` lines.
  - Do not rename anything, and do not refactor.
  - Do not weaken, skip or delete any test assertion.
  - Add no import from `railwayMapCamera.ts` back to `RailwayMap.tsx`.

Context:
- Steps 1.1 (a5487da) and 1.2 (2f43e99) already moved the layout observer, the preview
  helpers, `ZERO_MAP_PADDING` and `positionsBounds` into `railwayMapCamera.ts`. That file is
  248 lines, and `RailwayMap.tsx` is 787 lines.
- Plan sections 1–3; `.claude/docs/research/feature-map-readability-codebase.md`.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; do NOT run the E2E suite):

```bash
npm run typecheck
npx vitest run tests/unit/title-map-mode.test.ts tests/unit/map-camera.test.ts tests/unit/map-helpers.test.ts
npx vitest run
npm run build
wc -l src/features/map/RailwayMap.tsx src/features/map/railwayMapCamera.ts
git diff --check
```

Output (markdown):
- the changed files, one line each;
- a table of the moved symbols with their old and new line ranges, marking the shared
  dependencies;
- how you confirmed the bodies are identical;
- the acceptance results with pass/fail counts;
- the line counts;
- risks.

## Step 1.4 — implement

Objective: implement Step 1.4 of `.claude/docs/plans/map-readability-plan.md`, a pure move of
the segment flash hook out of `src/features/map/RailwayMap.tsx` into the new file
`src/features/map/useSegmentFlash.ts`, as one uncommitted step.

Scope:
- IN: exactly the "Step 1.4" section of the plan.
  - Move `useSegmentFlash` (around line 146 at HEAD ffbeeb5), its `SegmentFlashClock`
    interface and doc comments (around lines 133–145), and any helpers or constants only it
    uses. They move intact.
  - `RailwayMap.tsx` imports the hook. The call site and its position in the component stay
    unchanged.
  - Imports that only the hook needs (for example `clearSegmentFlash`,
    `setSegmentFlashFeatures`, `setSegmentFlashOpacity`, `segmentFlashOpacity`) move with it.
    Keep a type such as `SegmentFlashRequest` in `RailwayMap.tsx` if the props still use it.
  - Shared dependencies: move them, export them, and import them back. Stop only if one reads
    component state, props or refs.
  - Tests: in `tests/unit/map-flash.test.ts`, change only import paths and `vi.mock` paths. If
    a mock targets the module the hook now imports from, update the mock path so it still
    intercepts the same functions. Keep every frame, halo and cleanup assertion.
- OUT: Step 1.5 and later, DESIGN.md, STATE.md and the plan file. No new dependencies; do not
  commit or push.
- Hard constraints:
  - Bodies stay byte-identical, apart from `import`/`export` lines.
  - Do not rename anything and do not refactor.
  - Do not weaken, skip or delete any test assertion.
  - `useSegmentFlash.ts` must not import `RailwayMap.tsx`.
  - If other files import `useSegmentFlash` from `RailwayMap`, update them.

Context:
- Steps 1.1–1.3 (a5487da, 2f43e99, ffbeeb5) moved the camera helpers into
  `railwayMapCamera.ts`. `RailwayMap.tsx` is now 705 lines.
- Plan sections 1–3; `.claude/docs/research/feature-map-readability-codebase.md`.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; do NOT run the E2E suite):

```bash
npm run typecheck
npx vitest run tests/unit/map-flash.test.ts
npx vitest run
npm run build
wc -l src/features/map/RailwayMap.tsx src/features/map/useSegmentFlash.ts
git diff --check
```

Output (markdown):
- changed files, one line each;
- a table of the moved symbols with their old and new line ranges;
- how you confirmed the bodies are identical;
- the test edits (before → after);
- the acceptance results with pass/fail counts;
- the line counts;
- risks.

## Step 1.5 — implement

Objective: implement Step 1.5 of `.claude/docs/plans/map-readability-plan.md` (A1 focus paint,
gameplay map only) as one uncommitted step, and capture screenshots for the user.

Scope:
- IN: exactly the "Step 1.5" section of the plan.
  - `src/features/map/mapConfig.ts`: add named focus constants beside
    `OTHER_SERVICE_LINE_WIDTH` (3) and `OTHER_SERVICE_LINE_OPACITY` (0.75), with values
    width 2 and opacity 0.30. Each gets a short doc comment that cites issue #72.
  - `src/features/map/railwayLayers.ts`: add the optional field `focusBackground?: boolean` to
    `RailwayLayerInput`.
    - The `railway-services` layer uses the focus constants when the flag is true.
    - When the flag is omitted or false, it keeps today's width 3 and opacity 0.75.
    - Nothing else changes: not the current-service layer (7 / 1), not the Yamanote layers, not
      the legend filters, and not `clearNetworkVisibility.ts`.
  - `src/features/map/RailwayMap.tsx`: pass `focusBackground: mode !== "title"` in the existing
    `addRailwayLayers(map, {...})` call (around line 335). That way the gameplay and clear maps
    get focus paint, and the title map keeps today's paint.
- Tests: `tests/unit/capital-region-scaling.test.ts`. Add positive assertions that pin:
  - without the flag (the title map): background width 3 and opacity 0.75;
  - with `focusBackground: true` (the gameplay map): background width 2 and opacity 0.30;
  - the current-service layer at width 7 and opacity 1 in both cases.
  - Follow the file's existing helpers and style.
  - The `line-offset` absence assertion around line 169 stays unchanged.
- Screenshots (user-facing; the user cannot open /tmp):
  - After the change, capture PNGs into `.claude/logs/screenshots/`:
    - `issue72-s15-game-desktop.png`: gameplay map right after starting a new game, desktop
      1280x800;
    - `issue72-s15-game-phone.png`: the same, phone 390x844;
    - `issue72-s15-title-desktop.png`: the title screen map, desktop 1280x800.
  - Also capture `issue72-s15-game-desktop-before.png` from the code before your change. Use
    `git stash` or a temporary worktree, and restore the tree afterwards.
  - Use a throwaway Playwright script in the scratchpad or `/tmp`, run against
    `npm run dev` or `vite preview`. Do not add it to the repo.
  - Prefer the real basemap if it loads. If it does not, use the E2E stub style and say which
    one you used.
  - Stop the server by PID. Never use `pkill -f`.
- OUT: Steps 1.6 and later, DESIGN.md, STATE.md and the plan file. Add no new dependencies,
  and do not commit or push.
- Hard constraints:
  - Do not weaken, skip or delete any test assertion.
  - Keep the `0.75` dash entry and width 8 in `map-flash.test.ts` and `map-visual.spec.ts`.
    Those belong to the pending casing and must not change.

Context:
- Steps 1.1–1.4 (a5487da, 2f43e99, ffbeeb5, 6078690) moved camera helpers and the segment
  flash out of `RailwayMap.tsx`. That file is 643 lines.
- Plan sections 1–3; `.claude/docs/research/feature-map-readability-codebase.md` (section A).
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; keep Playwright LOCAL_WORKERS at 2; never `pkill -f`):

```bash
npm run typecheck
npx vitest run tests/unit/capital-region-scaling.test.ts tests/unit/map-station-markers.test.ts tests/unit/map-flash.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep 'service legend|pending guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --grep @layout
git diff --check
```

Output (markdown):
- the changed files, one line each;
- the new constants and the flag;
- the assertions added;
- the acceptance results with pass/fail counts;
- the screenshot paths and whether they used the real or the stub basemap;
- visual observations (what reads first now);
- risks.

## Step 1.5 — fix (re-delegation 1/1 after review REJECT)

Objective: fix the uncommitted Step 1.5 change so that the focus paint really reaches the gameplay
map at runtime, prove it from the running app, and capture correct before/after screenshots.

Failure context (Codex Sol low review REJECT, 2026-11-27):
- The plan assumed that the title and gameplay maps are separate `RailwayMap` instances. That
  is wrong.
- `GameApp` renders one persistent `RailwayMap` and switches its `mode` prop between
  title, game and clear (`src/app/GameApp.tsx` ~556 and ~818).
- The `style.load` handler in `src/features/map/RailwayMap.tsx` (~341, effect ~374) captures
  the initial mode, which is title. So `focusBackground` is false when the layers are created,
  and starting or resuming a game leaves the background at 3 px / 0.75.
- The before and after screenshots were byte-identical (sha256 1ef4d700…) for this reason.
- `EditionApp`'s data-error title map is a separate instance and must keep 3 / 0.75.

Scope:
- IN:
  - Keep the existing Step 1.5 diff: the constants, the `focusBackground` flag on
    `addRailwayLayers`, and the unit assertions.
  - Make the background paint follow the current `mode` at runtime. Recommended approach:
    - Export a small function from `railwayLayers.ts`, for example
      `setBackgroundFocus(map: MapLibreMap, focused: boolean): void`. It calls
      `setPaintProperty` on `LAYER_IDS.services` for `line-width` and `line-opacity` with
      the same constants, and it is a no-op if the layer does not exist.
    - Call it from `RailwayMap.tsx` in an effect keyed on `mode !== "title"` and
      `layersRevision`. That way a style reload and a title → game → clear transition always
      end at the right paint.
    - Keep the creation-time flag consistent. The `style.load` handler should read the
      current mode through a ref, not the captured initial value. Alternatively, rely on the
      effect, but then explain why there is no visible flash.
    - Do not add a per-frame write.
  - Tests:
    - Add a unit test for `setBackgroundFocus`, covering true, false, and a missing layer.
    - Add a test that pins the title → game transition: a `RailwayMap`-level test with the
      existing map mock helpers in `tests/unit/` (see `title-map-mode.test.ts` and
      `map-camera.test.ts` for how they mount `RailwayMap` with a mocked MapLibre). It must
      prove that the paint becomes 2 / 0.30 after `mode` changes from "title" to "game" and
      returns to 3 / 0.75 when it goes back to "title". If mounting is impractical, test the
      effect's hook in isolation and say so.
  - Runtime proof:
    - Serve the AFTER build with `npm run build` and then
      `npx vite preview --port 4302 --strictPort` (stop it by PID afterwards).
    - Read the paint with Playwright through the existing test hook:
      `window.__sugorokuE2E.map.getPaintProperty("railway-services", "line-width" | "line-opacity")`.
    - Read it on the title screen, after clicking 「はじめから」, and once more after a reload
      that resumes the saved game.
    - Expected: title 3 / 0.75; game 2 / 0.3.
    - A ready-made probe and capture script exist in the scratchpad:
      `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad/probe.mjs` and `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad/capture.mjs` (check and fix their ports and paths). The
      pre-change build is already in `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad/dist-before`. Serve it with
      `npx vite preview --outDir /tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad/dist-before --port 4301 --strictPort` for the "before"
      shots.
  - Screenshots: overwrite the files in `.claude/logs/screenshots/`:
    - `issue72-s15-game-desktop-before.png` (from dist-before)
    - `issue72-s15-game-desktop.png`
    - `issue72-s15-game-phone-before.png` (from dist-before)
    - `issue72-s15-game-phone.png`
    - `issue72-s15-title-desktop.png`
    - Before and after must differ: report the sha256 of each.
- OUT: Step 1.6 and later; DESIGN.md, STATE.md and the plan file; `git stash`, worktrees, and
  any change outside `src/features/map/` and `tests/unit/`. Do not commit or push. Never
  `pkill -f`.
- Hard constraints:
  - Do not weaken, skip or delete any assertion.
  - The title map keeps 3 / 0.75.
  - The legend filters and `clearNetworkVisibility.ts` behaviour stay unchanged.

Acceptance (run all; keep Playwright LOCAL_WORKERS at 2):

```bash
npm run typecheck
npx vitest run tests/unit/capital-region-scaling.test.ts tests/unit/map-station-markers.test.ts tests/unit/map-flash.test.ts tests/unit/title-map-mode.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep 'service legend|pending guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --grep @layout
git diff --check
```

Output (markdown):
- the root cause in your own words;
- the changed files, one line each;
- the new function and effect;
- the tests added;
- the runtime paint values read (title, game, resumed game), as a table;
- the screenshot paths with their sha256;
- the acceptance results with pass/fail counts;
- risks.
