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
