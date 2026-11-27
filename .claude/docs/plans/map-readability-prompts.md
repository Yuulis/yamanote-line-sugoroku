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

## Step 1.6 — implement

Objective: implement Step 1.6 of `.claude/docs/plans/map-readability-plan.md` (A2 lottery
candidate publication in the turn-moment display, TDD) as one uncommitted step.

Scope:
- IN: exactly the "Step 1.6" section of the plan, plus the plan's A2 row (section 2) and the
  `TurnMomentDisplay` interface note (section 2, Interfaces).
  - `src/features/game/animation/turnMomentPresentation.ts`: add the field
    `readonly lotteryCandidateServiceIds: readonly string[]` to the display that
    `deriveTurnMomentDisplay` returns.
    - During the `lottery-flip` and `lottery-settle` stages, it holds the public landing
      candidates. Use the same source the split-flap board already uses, the
      `serviceCandidates` of the landing (see `GameApp.tsx` ~511–517 and
      `.claude/docs/research/feature-map-readability-codebase.md` section A).
    - It is identical in both stages, does not depend on the committed or winning result, and
      is deduplicated and order-stable.
    - In every other phase it is a STABLE empty list: one shared frozen empty-array constant,
      so React consumers do not re-render. This covers ordinary turns with no lottery,
      effects off, reduced motion, and Skip — any case where the lottery stage is never shown.
  - Do not wire it into `GameApp`/`RailwayMap` and do not add a map layer. That is Step 1.7.
- Tests first: `tests/unit/turn-moment-presentation.test.ts`. Use the file's existing fixtures
  and helpers.
  - The same set appears in flip and settle.
  - The set is independent of the committed result (two attempts with different winners give
    the same list).
  - The list is empty, and the same reference, for ordinary turns, effects off, reduced
    motion and Skip.
  - The `tests/unit/game-app-turn-moments.test.ts` suite must stay green. Add to it only if
    the plan requires; do not modify existing assertions.
- OUT: Step 1.7 and later, DESIGN.md, STATE.md and the plan file. Add no new dependencies, and
  do not commit or push.
- Hard constraints:
  - Do not weaken, skip or delete any test assertion.
  - No reveal leak: the field must never expose anything before the lottery stage is public,
    and it must not reveal the winner.

Context:
- Steps 1.1–1.5 landed (a5487da, 2f43e99, ffbeeb5, 6078690, 6091e3d). Step 1.5 found that the
  plan assumed something wrong about map instances. If you find any plan assumption here that
  contradicts the code, follow the code, stop short of guessing, and report it.
- Plan sections 1–3; `.claude/docs/research/feature-map-readability-codebase.md`.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; do NOT run the E2E suite):

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts
npx vitest run
npm run build
git diff --check
```

Output (markdown):
- the changed files, one line each;
- where the candidates come from, with file:line;
- the tests added, written first, with their names;
- the acceptance results with pass/fail counts;
- any plan assumption that did not match the code;
- risks.

## Step 1.6 — fix (re-delegation 1/1 after review REJECT)

Objective: fix the uncommitted Step 1.6 change so its suppression tests prove the guards, and
remove a redundant guard, as one uncommitted step.

Failure context (Codex Sol low review REJECT, 2026-11-27):
- `tests/unit/turn-moment-presentation.test.ts` (~209), blocking: in the "frozen empty list"
  test, the effects-off, reduced-motion and Skip cases all use `revealStage: "waiting"`.
  Phase gating alone makes them pass, so the test still passes if every new suppression check
  is removed.
- `publicationPhase()` CAN return `lottery-flip` or `lottery-settle` when given a lottery
  `revealStage` while `skipRequested`, `motionOmitted` or
  `policy.showImportantMoments === false` holds.
- The Skip fixture sets `skipRequested` and `motionOmitted` together, so either check could be
  removed unnoticed.
- With `restoredOrOmitted: true` the resolver already returns `published`, so the
  `input.restoredOrOmitted` check inside `visibleLotteryCandidateServiceIds` is redundant.

Scope:
- IN: `src/features/game/turnMomentPresentation.ts` and
  `tests/unit/turn-moment-presentation.test.ts` only.
  - Remove the redundant `input.restoredOrOmitted` check from
    `visibleLotteryCandidateServiceIds`. Keep the other three checks.
  - Rewrite the suppression test, or add tests, so that for EACH of `lottery-flip` and
    `lottery-settle`, each flag on its own yields the shared frozen empty list (`toBe` the
    same reference): `skipRequested: true` only, `motionOmitted: true` only, and
    `policy.showImportantMoments === false` only (via `captureTurnPresentationPolicy` with
    `presentationLevel: "none"`, or the file's own helper).
  - Keep the ordinary-turn case (`waiting`) as the reference empty list.
  - Add a case pinning the resolver precedence: `restoredOrOmitted: true` with a lottery
    `revealStage` gives an empty list.
  - Before finalising, run the suppression tests once against a temporary copy that has each
    guard removed, to prove they fail, then restore it. Report which test failed for which
    removed guard.
  - Keep the existing "publishes deduplicated landing candidates…" test unchanged.
- OUT: every other file, Step 1.7 and later, DESIGN.md, STATE.md and the plan. Do not commit
  or push.
- Hard constraints: do not weaken, skip or delete any existing assertion.

Acceptance:

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts
npx vitest run
npm run build
git diff --check
```

Output (markdown):
- the changed files;
- the final guard list;
- each new or rewritten test, with what it proves;
- the mutation check results (guard removed → which test failed);
- the acceptance results with pass/fail counts;
- risks.

## Step 1.7 — implement

Objective: implement Step 1.7 of `.claude/docs/plans/map-readability-plan.md` as one
uncommitted step. Step 1.7 adds the A2 lottery-candidate overlay on the map, plus a user tweak
that makes faded background lines a little darker. Capture screenshots of a lottery stage for
the user.

Scope:
- IN: exactly the "Step 1.7" section of the plan and the plan's A2 row (section 2). Read both
  in full.
  - Register `LAYER_IDS.lotteryCandidates` in `mapConfig.ts`. The layer is created in
    `railwayLayers.ts`, between `services` and `currentService` and below Yamanote progress.
    That takes the map from 13 to 14 layers.
    - Its initial paint is 4 px at about 0.85 opacity, coloured by line like the other service
      layers. Use named constants.
    - It starts with an empty filter.
  - Export `updateLotteryCandidates(map, featureIds)` from `railwayLayers.ts`. It is guarded:
    it does nothing when the layer is missing.
  - `GameApp.tsx` passes the display's `lotteryCandidateServiceIds` (added in Step 1.6) to
    `RailwayMap` as an optional prop. The title map passes nothing.
  - `RailwayMap.tsx` resolves the service ids to deduplicated primitive `featureId`s. Use the
    existing geometry index (see `indexServiceGeometry`, and how the current-service highlight
    resolves features).
    - It writes the filter only when the featureId set changes by content (Step 1.6 returns a
      fresh frozen array whenever the set is non-empty), and on `layersRevision`.
    - It clears the filter after settle, when the set is empty.
  - Add the layer to `CLEAR_HIDDEN_OVERLAY_LAYER_IDS` in `clearNetworkVisibility.ts`.
  - Keep new logic out of `RailwayMap.tsx` where you reasonably can. That file is 650 lines; a
    small hook or helper module is fine. It must stay at or under 800 lines.
  - The current-service highlight keeps its existing settle publication boundary. Nothing may
    leak the winner before settle.
- User tweak (2026-11-27): in `mapConfig.ts`, change `FOCUS_OTHER_SERVICE_LINE_OPACITY` from
  0.30 to 0.40. The width stays 2. Update the two assertions that pin 0.30:
  - `tests/unit/capital-region-scaling.test.ts` (~197);
  - `tests/unit/railway-layers-background-focus.test.ts` (~16).

  This is an intentional value change, not a weakening. Keep the assertions exact.
- Tests:
  - Intentional update of `tests/unit/map-station-markers.test.ts` (~137): pin the exact
    14-layer order, with `lotteryCandidates` right after `services`, and the empty initial
    filter.
  - Add unit tests for `updateLotteryCandidates` (sets the filter; empty clears it; no-op
    without the layer) and for the content-based change detection.
  - Extend the existing fake-clock E2E `tests/e2e/ui-pop-turn-moments.spec.ts` (~624), "lottery
    flip and settle keep HUD, highlight, platform, log, upcoming stations and item results
    behind one publication". Inside its stage loop, assert that the candidate layer filter
    equals the deduplicated fixture candidate featureIds in both flip and settle, and that it
    is empty after settle. Read the filter through the existing E2E hook
    (`window.__sugorokuE2E.map`, or the spec's helpers).
  - `tests/e2e/lottery.spec.ts` keeps its assertions unchanged.
- Screenshots (user-facing; the user cannot open /tmp). Save them to
  `.claude/logs/screenshots/`:
  - `issue72-s17-lottery-flip-desktop.png`: a lottery stage with the candidates emphasised,
    desktop 1280x800.
  - `issue72-s17-lottery-flip-phone.png`: the same, phone 390x844.
  - `issue72-s17-game-desktop.png`: an ordinary game map after the 0.40 tweak, desktop
    1280x800.

  To reach a lottery stage with effects on, reuse the fake-clock approach and helpers from
  `tests/e2e/support/turnMoments.ts` and the spec above. A temporary spec file
  `tests/e2e/tmp-issue72-shots.spec.ts` is allowed, run with `--project=desktop-chromium` /
  `--project=phone-chromium`, but it MUST be deleted before you finish. Also confirm in the
  page that the candidate filter was non-empty at capture time, and report the featureId count.
- OUT: Step 1.8 and later, DESIGN.md, STATE.md and the plan file. No new dependencies; do not
  commit or push. Never `pkill -f`; keep Playwright LOCAL_WORKERS at 2.
- Hard constraints:
  - Do not weaken, skip or delete any assertion. The 0.30 → 0.40 edits and the 13 → 14 layer
    order are the only intentional changes.
  - Make no per-frame map writes.

Context:
- Steps 1.1–1.6 landed (a5487da, 2f43e99, ffbeeb5, 6078690, 6091e3d, 6eec43f).
- Lessons from 1.5 and 1.6:
  - `GameApp` keeps ONE persistent `RailwayMap` and switches `mode` (title/game/clear), so
    wire everything to current props, not to the initial `style.load` closure.
  - Verify visible behaviour from the running app.
  - If a plan assumption contradicts the code, follow the code and report it.
- Plan sections 1–3; `.claude/docs/research/feature-map-readability-codebase.md` (section A).
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all):

```bash
npm run typecheck
npx vitest run tests/unit/map-station-markers.test.ts tests/unit/capital-region-scaling.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/railway-layers-background-focus.test.ts tests/unit/title-map-mode.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/lottery.spec.ts --project=desktop-chromium
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --grep 'lottery flip and settle keep HUD'
npx playwright test tests/e2e/lottery.spec.ts --project=phone-chromium --grep @layout
wc -l src/features/map/RailwayMap.tsx
git status --short   # tmp spec must be gone
git diff --check
```

Output (markdown):
- changed files, one line each;
- the layer, constants and function signatures;
- how feature ids are resolved and how change detection works;
- the tests added or updated, with intentional updates marked before → after;
- acceptance results with pass/fail counts;
- screenshot paths with sha256 and the candidate featureId count at capture;
- any plan assumption that did not match the code;
- risks.

## Step 1.8 — implement

Objective: implement Step 1.8 of `.claude/docs/plans/map-readability-plan.md` (A3: fade the
basemap symbol labels and icons) as one uncommitted step, adjusted for a user decision. Capture
real-basemap screenshots for the user.

User decision (2026-11-27): the fading applies on the GAMEPLAY map only, like A1. The title map
keeps the basemap's own label and icon opacity. The clear screen counts as gameplay (it is not
title).

Design (adjusted from the plan's A3 row):
- `GameApp` keeps ONE persistent `RailwayMap` and switches `mode` (title/game/clear). The
  original plan applies patches once in `style.load`; that would also fade the title map, so it
  is no longer enough.
- New pure module `src/features/map/basemapLabels.ts`:
  - `buildBasemapLabelPatches(layers, factors)` is as in the plan's Interfaces section:
    - select `symbol` layers by type, never by id;
    - scale `text-opacity` (×0.75) and `icon-opacity` (×0.65) from each freshly loaded
      style's own values;
    - an omitted value means the default 1;
    - handle constants and data expressions;
    - scale the outputs of top-level `step`/`interpolate` zoom expressions, including inside
      `let`;
    - skip unsafe values.
  - Each patch also records the layer's ORIGINAL value. "Absent" means the property was
    omitted, so restoring it means setting `undefined` back, which returns to the default.
  - Name the factors as constants.
- Capture the baseline from the FRESH style in the `style.load` handler, BEFORE
  `addRailwayLayers`. That way app layers (station labels) are never included, and a reload
  never compounds.
  - Store the patches in a ref, and bump the existing `layersRevision` (or reuse it) so effects
    re-apply.
  - Apply with a guarded function, for example
    `applyBasemapLabelFocus(map, patches, focused: boolean)`. When focused it writes the scaled
    values; otherwise it writes the originals. Every write is guarded by `getLayer`.
  - Call it from a layout effect keyed on `mode !== "title"` and the revision, mirroring
    Step 1.5's `setBackgroundFocus` effect in `RailwayMap.tsx`.
- Keep logic out of `RailwayMap.tsx` where reasonable (currently about 661 lines, max 800).

Scope:
- IN:
  - the new `src/features/map/basemapLabels.ts`;
  - the wiring in `src/features/map/RailwayMap.tsx` (a small hook file is fine);
  - tests.
- Tests first: `tests/unit/basemap-labels.test.ts`, with synthetic layers.
  - Cover: an omitted value (default), a constant, a data expression, a top-level zoom
    expression including `let`, a skipped (unsafe) value, a replacement style that uses its own
    baseline, and non-symbol layers left untouched.
  - Validate expression outputs with MapLibre's style validation, if it is available in
    `maplibre-gl` / `@maplibre/maplibre-gl-style-spec`, as the plan says. If it is not
    available without a new dependency, say so and skip only that part.
  - Also test focus toggling:
    - focused writes the scaled values;
    - unfocused restores the originals, including `undefined` for omitted values;
    - there are no writes for missing layers.
  - Add a persistent-map transition test: title → game → title on one mounted `RailwayMap`
    (see the Step 1.5 test in `tests/unit/title-map-mode.test.ts`).
- Screenshots (user-facing; the user cannot open /tmp). Save to `.claude/logs/screenshots/`:
  - `issue72-s18-game-desktop.png` and `issue72-s18-game-phone.png`: the gameplay map right
    after 「はじめから」, real basemap, desktop 1280x800 and phone 390x844;
  - `issue72-s18-title-desktop.png`: the title map (labels must look unchanged).
  - Build an e2e bundle into the scratchpad:
    `npx vite build --mode e2e --outDir <scratchpad>/dist-s18 --emptyOutDir`.
  - Serve it with
    `node node_modules/vite/bin/vite.js preview --outDir <scratchpad>/dist-s18 --host ::1 --port 4304 --strictPort`.
    Use the node binary directly: killing an `npx` wrapper leaves the server alive. Stop it by
    PID and confirm the port is free.
  - Reuse
    `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad/capture-s17.mjs`
    as a template, and do not modify that file.
  - In the page, read `text-opacity` from one Liberty symbol layer through
    `window.__sugorokuE2E.map.getPaintProperty` on the title screen and on the game screen,
    and report both values.
  - The scratchpad is
    `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad`.
- OUT: Step 1.9 and later, DESIGN.md, STATE.md and the plan file. No new dependencies; do not
  commit or push. Never `pkill -f`.
- Hard constraints:
  - Do not weaken, skip or delete any assertion.
  - App layers (all `railway-*` and `game-*` ids) are never patched.
  - Make no per-frame writes.

Context:
- Steps 1.1–1.7 landed (latest 1.7: the lottery overlay, plus FOCUS opacity 0.40).
- Lessons:
  - Wire behaviour to the current `mode`, not to the initial `style.load` closure.
  - Verify visible behaviour from the running app.
  - If a plan assumption contradicts the code, follow the code and report it.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all; keep Playwright LOCAL_WORKERS at 2):

```bash
npm run typecheck
npx vitest run tests/unit/basemap-labels.test.ts tests/unit/map-helpers.test.ts tests/unit/title-map-mode.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep 'real Japanese labels'
wc -l src/features/map/RailwayMap.tsx
git diff --check
```

Output (markdown):
- changed files, one line each;
- function signatures;
- how the baseline is captured, and why a reload cannot compound;
- tests added (written first);
- acceptance results with pass/fail counts;
- runtime `text-opacity` values (title vs game) and the layer id used;
- screenshot paths with sha256;
- any plan assumption that did not match the code;
- risks.

## Step 1.9 — implement

Objective: implement Step 1.9 of `.claude/docs/plans/map-readability-plan.md` as one uncommitted
step, and capture screenshots for the user. The step is item C, the goal emphasis after 30/30:
a gold ring, a CSS pulse, and a 「ここに着けばゴール」 bubble.

Scope:
- IN: exactly the "Step 1.9" section of the plan and the plan's C row in section 2. Read both
  in full.
  - The ring:
    - `railway-goal-station` stays the permanent, zoom-aware ring.
    - Restyle it gold at width 5 px, using named constants in `mapConfig.ts` and the existing
      radius stops.
    - Pick a gold that is clearly distinct from the red current-position marker (`#e53935`)
      and the magenta pending dashes (`#c040cf`), and readable on the Liberty basemap.
      Something like `#e0a800` / `#d4a017` is a starting point. State your choice.
  - The bubble:
    - Export the bubble shell `createMapCallout` from `rollAdjustmentPreview.ts` without
      changing its existing behaviour.
    - The new module `src/features/map/goalCallout.ts` mounts a DOM bubble with the exact text
      「ここに着けばゴール」, plus a second DOM marker whose inner element pulses
      (opacity/scale, about 3 s) through CSS keyframes in `src/styles.css`.
    - Both markers are `aria-hidden` and non-interactive, carrying `data-map-goal-callout` and
      `data-map-goal-pulse`.
    - Under `@media (prefers-reduced-motion: reduce)` the animation is `none`. The ring and the
      bubble stay.
  - Mounting in `RailwayMap.tsx`, preferably in a small hook:
    - The markers are keyed to the reveal-gated goal coordinate (resolve the existing
      `goalStationId` prop to station coordinates).
    - They appear on the gameplay map only. The clear map keeps only the static ring, and the
      title map shows nothing.
    - Remember that `GameApp` keeps ONE persistent `RailwayMap` and switches `mode`, so the
      markers must be torn down on game → clear and game → title, and on map replacement.
    - Make no per-frame MapLibre writes (see the #62 Step 4b performance finding in the plan).
  - Keep `RailwayMap.tsx` at or under 800 lines. It is about 679 lines now.
- Tests:
  - Extend `tests/e2e/map-visual.spec.ts` "30 of 30 return guidance". Keep its filter, rendered
    marker, HUD and toast assertions. Add:
    - a positive gold/5 px paint check on `railway-goal-station`;
    - no bubble before publication;
    - the exact 「ここに着けばゴール」 after publication;
    - computed `animation-name` (or `animation`) `none` under reduced motion. The config uses
      `reducedMotion: "reduce"`, so also assert the keyframes exist / the animation is set when
      motion is allowed, if that is practical with `page.emulateMedia`.
  - `tests/e2e/clear-replay-share.spec.ts` (~734) keeps its goal-ring assertion.
  - Add unit tests for `goalCallout.ts`: mount, text, the data attributes, aria-hidden,
    teardown, and no mount without a coordinate.
  - `tests/unit/roll-adjustment-preview.test.ts` keeps covering the shell.
- Screenshots (user-facing; the user cannot open /tmp). Save to `.claude/logs/screenshots/`:
  - `issue72-s19-goal-desktop.png` and `issue72-s19-goal-phone.png`: after 30/30, with the goal
    ring and bubble visible.
  - You may reuse the "30 of 30 return guidance" setup through a temporary spec
    `tests/e2e/tmp-issue72-s19-shots.spec.ts`, which MUST be deleted before you finish. A
    fixture network is fine.
- OUT: Step 1.10 and later, DESIGN.md, STATE.md and the plan file. Add no new dependencies, and
  do not commit or push. Never `pkill -f`; keep Playwright LOCAL_WORKERS at 2.
- Hard constraints:
  - Do not weaken, skip or delete any assertion.
  - The roll-adjust bubbles behave exactly as before.
  - The goal bubble must not reveal anything before the existing 30/30 publication.

Context:
- Steps 1.1–1.8 have landed. 1.8 is commit 52fae43: the basemap labels fade in gameplay only.
- Lessons:
  - Wire behaviour to the current `mode` and props, not to the initial `style.load` closure.
  - Verify visible behaviour from the running app.
  - If a plan assumption contradicts the code, follow the code and report it.
- `.claude/docs/research/feature-map-readability-codebase.md`, section C.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all):

```bash
npm run typecheck
npx vitest run tests/unit/roll-adjustment-preview.test.ts tests/unit/map-station-markers.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep '30 of 30 return guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --grep @layout
npx playwright test tests/e2e/clear-replay-share.spec.ts --project=desktop-chromium --grep 'keeps the goal ring'
wc -l src/features/map/RailwayMap.tsx
git status --short   # tmp spec must be gone
git diff --check
```

Output (markdown):
- changed files, one line each;
- the colour and constants chosen;
- the module API;
- how mount/teardown follows mode and the goal publication;
- the tests added or extended;
- acceptance results with pass/fail counts;
- screenshot paths with sha256;
- any plan assumption that did not match the code;
- risks.

## Step 1.9 — fix (re-delegation 1/1 after review REJECT)

Objective: fix the uncommitted Step 1.9 change so the goal bubble never overlaps the roll-adjust
bubbles. Also remove the duplicated gold literal. Deliver it as one uncommitted step.

Failure context (Codex Sol low review REJECT, 2026-11-27):
- Medium: after 30/30, a roll-adjust preview can include a landing at 新橋. 新橋 is the goal,
  and the Yamanote platform has identical coordinates.
- The goal bubble (`goalCallout.ts` ~15) and the adjustment bubble (`rollAdjustmentPreview.ts`
  ~117) then sit at the same anchor with the same 6 px offset, so one hides the other.
- Lane assignment only considers adjustment bubbles.
- Low: `src/styles.css` (~715) repeats `#d4a017`, which duplicates `GOAL_STATION_RING_COLOR` in
  `mapConfig.ts`.

Scope:
- IN: `src/features/map/goalCallout.ts`, `src/features/map/RailwayMap.tsx` (or a small hook),
  `src/styles.css`, and tests.
  - Adjustment bubbles take priority. While roll-adjust callouts are shown (the
    `adjustmentCandidates` prop is non-empty), do not mount the goal BUBBLE.
    - The pulse halo stays: it is a ring around the station, not text.
    - Remount the bubble when the adjustment preview closes.
    - Keep the effect keyed so that no per-frame work happens.
  - Colour:
    - Pass the colour from `GOAL_STATION_RING_COLOR` to the pulse element as a CSS custom
      property, for example `--map-goal-ring-color`, set in `goalCallout.ts`.
    - Have the CSS use `var(--map-goal-ring-color)`.
    - Keep one source of truth.
- Tests:
  - Unit (`tests/unit/goal-callout.test.ts`, or a hook test):
    - the bubble is not mounted while adjustment candidates exist;
    - the bubble remounts after they clear;
    - the pulse stays throughout;
    - the custom property equals `GOAL_STATION_RING_COLOR`.
  - E2E: if the existing roll-adjust E2E can reach a 30/30 state with an adjustment preview
    cheaply, add the assertion there. Otherwise rely on the unit and hook tests and say why.
  - Keep every assertion added in Step 1.9. Weaken nothing.
- OUT: every other step, DESIGN.md, STATE.md and the plan. Do not commit or push. Never
  `pkill -f`.

Acceptance:

```bash
npm run typecheck
npx vitest run tests/unit/goal-callout.test.ts tests/unit/roll-adjustment-preview.test.ts tests/unit/map-station-markers.test.ts
npx vitest run
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --grep '30 of 30 return guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --grep @layout
git diff --check
```

Output (markdown):
- changed files;
- how the priority works (dependencies, mount/unmount);
- the tests added;
- acceptance results with pass/fail counts;
- risks.

## Step 1.10 — colour-vision report

Objective: write the B2 colour-vision report for Issue #72 as
`docs/manual/map-readability/colour-vision.md` (Japanese). This is a report only: no source
or colour changes. Leave it uncommitted.

Scope:
- IN: the new file `docs/manual/map-readability/colour-vision.md`, plus a throwaway local
  analysis script in the scratchpad
  `/tmp/claude-1002/-home-yuulis-yamanote-line-sugoroku/d27f70d3-3cb9-4fb9-a07d-b89ec67a21cd/scratchpad/`.
  Do NOT commit the script and do not add it to the repo.
- The report follows the plan's B2 row (`.claude/docs/plans/map-readability-plan.md`
  section 2). It records:
  - Exact palette reuse: how many line groups share an identical colour. The codebase scan
    found 81 distinct colours for 134 groups; recompute it. Keep this separate from
    similarity under simulated colour-vision deficiency.
  - Similarity under protanopia, deuteranopia and tritanopia.
    - Use a standard simulation such as Machado et al. 2009 or Brettel/Viénot, implemented in
      the local script without new dependencies. Name the method.
    - Use a perceptual distance such as CIEDE2000 or OKLab ΔE, with a stated threshold.
    - List the closest pairs, prioritising pairs that actually meet: lines that share
      stations or run in parallel. Keep the list readable with a top-N table, not all pairs.
  - The key UI colours, compared against each other:
    - the dimmed background (opacity 0.40);
    - the lottery candidate overlay (4 px, 0.85);
    - the gold goal ring `#d4a017`;
    - the red current-position marker `#e53935`;
    - the magenta pending dashes `#c040cf`;
    - the Yamanote green.
  - The non-colour cues that already exist:
    - HUD and lottery-board badges with line codes (`LINE_BADGE_CODES`; 21 groups have no
      code, and codes such as KS and JO are shared);
    - dashed vs solid lines for Yamanote progress;
    - the ring vs filled circle for goal vs current position;
    - the bubble text.
  - Conclusion: official colours are unchanged (user decision 2026-11-26). Also list what a
    future change could address, as notes rather than commitments.
- Source the colours from the actual data and code:
  - `public/data/*` line metadata and colour;
  - `src/features/game/components/lineBadge.ts` (or wherever `LINE_BADGE_CODES` lives);
  - `src/features/map/mapConfig.ts`.
  - Check the codebase scan `.claude/docs/research/feature-map-readability-codebase.md`
    section B for where these live.
- Language and style:
  - Natural Japanese prose. Follow `.claude/rules/manual-docs.md` and
    `.claude/rules/language.md` "Response Style".
  - Code identifiers, paths and colour codes stay as they are.
  - Short sections, tables where they reduce reading effort, and a one-paragraph summary at
    the top.
- OUT: every source and test file, DESIGN.md, STATE.md and the plan. Do not commit or push.

Acceptance:

```bash
test -s docs/manual/map-readability/colour-vision.md
git diff --check
git status --short   # only the new doc (plus the lead's plan/prompts edits)
```

Output (markdown):
- the file path and its sections;
- the method and threshold;
- the key numbers: distinct colours, the number of close pairs per deficiency type, and the
  worst UI-colour pair;
- where the script lives (scratchpad);
- risks or limits of the analysis.

## Step 2.1 — implement (PR2, branch feature/replay-camera-strip)

Objective: implement Step 2.1 of `.claude/docs/plans/map-readability-plan.md` as one uncommitted
step. The step adds atomic replay seek and one-turn step to the clear-replay store, driven by
tests written first (TDD).

Scope:
- IN: exactly the "Step 2.1" section of the plan, plus the plan's D1/D2 rows in section 2 and
  the `clearReplayStore.ts` interface block in section 3. Read all of them in full.
  - `src/features/game/clearReplayStore.ts`:
    - The turn-level UI snapshot gains `turnCount` and `seekRevision`. `seekRevision` bumps on
      every explicit seek/step only, including a seek to the current turn. Natural playback,
      pause/resume, speed and finish never bump it.
    - Add `seek(recordIndex)`. Non-finite input is ignored (no state change, no revision bump).
      Finite input is clamped to the real-turn range and truncated to an integer.
    - Add `step(delta: -1 | 1)`, which moves one turn and clamps at the bounds. At a bound it
      is a no-op without a revision bump.
    - Add `resolveReplaySeekIndex(turnCount, recordIndex)`, a pure exported helper that returns
      `null` for an empty timeline or non-finite input.
    - Seek resets the clock anchor, so elapsed time is `recordIndex × turnDuration` at the
      current speed. It invalidates pending/queued frame callbacks, so a stale queued frame
      cannot overwrite the new position. Route prefix, marker and caption are published from
      one transition.
    - Play state is kept:
      - playing continues from the new turn;
      - paused stays paused;
      - `done` goes to paused at the chosen turn.
    - User decision (2026-11-27): from `done` (the completed full-route view), BOTH `step(-1)`
      and `step(+1)` select the first real turn. `seek(n)` from `done` lands paused at `n`.
    - Reduced motion stays instant. The full route is shown at once, and seek/step do not start
      animation.
    - An empty route/timeline gives `turnCount` 0. seek/step are no-ops there.
  - Tests first, in `tests/unit/clear-replay.test.ts`. Cover every case the plan lists:
    - empty timeline/spans;
    - out-of-range and non-finite input;
    - a same-turn seek bumps the revision;
    - seek while playing keeps playing from the new turn;
    - seek while paused stays paused;
    - seek/step from done lands paused at the chosen turn;
    - both 前 and 次 from done select the first real turn;
    - a stale queued frame is dropped;
    - speed/resume continuity after a seek;
    - step at the bounds.
  - Keep `tests/unit/clear-replay-marker.test.ts` passing unchanged.
- OUT: `cardExpanded`/`showResults` (Step 2.2), turn bounds (2.3), camera (2.4), UI (2.5/2.6),
  DESIGN.md, STATE.md and the plan files.
  - Add no new dependencies, and do not commit or push.
  - Never `pkill -f`.
- Hard constraints:
  - Do not weaken, skip or delete any existing assertion.
  - Existing playback, pause, speed, finish and restart behaviour is unchanged.
  - Keep files at or under 800 lines. `clearReplayStore.ts` is about 338 lines now.
  - If a plan assumption contradicts the code, follow the code and report it.

Context:
- PR1 (Steps 1.1–1.10) is merged into develop (db8550e).
- `.claude/docs/research/feature-map-readability-codebase.md`, section D.
- Rules: AGENTS.md, .claude/rules/coding-principles.md, .claude/rules/testing.md.

Acceptance (run all):

```bash
npm run typecheck
npx vitest run tests/unit/clear-replay.test.ts tests/unit/clear-replay-marker.test.ts
npx vitest run
npm run build
git diff --check
```

Output: TL;DR; changed files with a one-line purpose each; the test list (what each new test
proves); the acceptance results; any deviation from the plan with its reason; risks.
