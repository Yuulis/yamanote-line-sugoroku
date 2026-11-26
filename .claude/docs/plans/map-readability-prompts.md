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
