# B1 Edition Switching — Codex Prompts

## P1: Design and implementation plan (Sol, read-only)

### Objective

Produce a concrete design and step-by-step implementation plan for B1
"edition switching infrastructure" in this repository, ready to hand to an
implementer, with the user decisions below treated as fixed.

### User decisions (2026-10-20, fixed; recorded in `.claude/docs/DESIGN.md` Key Decisions)

1. Build the infrastructure only. An edition = dataset + ruleset (`GameConfig`)
   + display text (title/subtitle/rules copy). The current 東京近郊 edition is
   the only registered edition; no second edition ships now (山手線のみ, 23区,
   1都3県 revival are deferred, but the design must make adding one an S-sized
   change: registry entry + data directory + copy).
2. The current edition's data stays at `public/data/` (do not move it; about 40
   test/pipeline references depend on that path). Future editions get their own
   directory.
3. One save slot per edition. The existing save storage key stays as the
   東京近郊 edition's slot, so existing players' saves keep working with no
   migration. No silent conversion of saves, ever.
4. The edition is chosen on the title screen (no URL parameter, no
   remember-last for now).

### Inputs (read these; do not edit anything)

- `.claude/docs/research/b1-edition-switch-investigation.md` — fact base: the
  ~17 single-edition assumption points with paths and line numbers, save and
  caching analysis, the silent-overwrite issue in `GameApp.tsx:174-185`.
- `src/data/loaders.ts`, `src/**/useGameApp.ts`, `src/**/GameApp.tsx`,
  `src/**/TitleScreen.tsx`, `src/**/gameConfig.ts`, save/persistence code,
  `tests/unit/**`, `tests/e2e/**`, `.claude/docs/DESIGN.md`.
- Rules: `.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

### Constraints

- No behaviour change for current players: same data URLs, same save key, same
  title/subtitle text, same rules; existing saves restore exactly as today.
- The title-screen picker must exist and be tested, but with one registered
  edition there is nothing to choose. Recommend how it should render in that
  case (e.g. hidden, or a read-only label of the current edition) and keep the
  multi-edition path covered by unit/component tests that inject a 2-entry
  registry (test-only fixture editions; no fake edition in production).
- Keep the engine free of edition-specific branches: editions differ only by
  data and `GameConfig`.
- Do not weaken or delete existing tests. E2E (Playwright, 4 projects) must
  stay green; avoid adding slow real-data E2E cases — prefer unit/component
  tests for the multi-edition path.
- Immutability, type hints, no magic numbers, small files (coding-principles).
- Pipeline changes are out of scope unless a default output path must become
  edition-aware; justify any pipeline change.

### Required output (markdown sections)

1. **TL;DR** (≤ 5 lines).
2. **Edition model**: TypeScript types for the edition registry (id, data base
   URL, `GameConfig`, display text, save key), where it lives, how the active
   edition flows through the app (context/props), and how save keys are derived
   so the 東京近郊 key is unchanged.
3. **Change list**: every file to change or add, with what changes, mapped to
   the investigation's assumption points; say explicitly which points are left
   single-edition on purpose and why.
4. **Title-screen picker**: behaviour with 1 and with 2+ editions, a11y notes
   (labels, keyboard), and what happens to an in-progress save when switching
   editions.
5. **Steps**: ordered implementation steps, each small enough for one commit,
   each with its own acceptance commands. Use the repo's real commands
   (`npm run typecheck`, `npm test` / vitest, `npm run build`,
   `npm run test:e2e -- --project=desktop-chromium`, `uv run pytest` if the
   pipeline is touched) — check `package.json` for exact script names.
6. **Tests to add**: names following `test_{target}_{condition}_{expected}`
   intent, covering: registry lookup, save-key derivation (東京近郊 key
   unchanged), per-edition save isolation, picker with 1 and 2 editions,
   restore of an existing save byte-for-byte as today.
7. **Risks** and how each step's acceptance checks catch them.

## P2: Implement commits 1–3 (Luna high)

### Objective

Implement commits 1, 2 and 3 of `.claude/docs/plans/b1-edition-switch-plan.md`
exactly as specified there, one git commit per step, with no behaviour change
for current players.

### Constraints

- The plan is the spec. Where it is ambiguous, choose the option that keeps
  current behaviour byte-identical and note the choice in your reply; do not
  expand scope (no picker, no `EditionApp`, no `jsdom` yet — those are
  commits 4–5).
- Pin the pre-B1 save digests from plan §6 "Existing-save byte compatibility"
  in commit 1 BEFORE touching runtime code, and verify them against the
  unmodified code first. Never regenerate them from changed code.
- Do not weaken, skip or delete existing tests. No engine, RNG, save payload,
  save version, data or pipeline changes.
- Follow `.claude/rules/coding-principles.md` and `.claude/rules/testing.md`;
  match surrounding code style.
- Commit messages: conventional style (`feat:`, `test:`, `refactor:`), each
  ending with a blank line and
  `Co-Authored-By: Codex (gpt-6-luna) <noreply@openai.com>`.
  Do not push.
- Do not edit files under `.claude/` except the step table in
  `.claude/docs/plans/b1-edition-switch-handoff.md` (fill commit SHA and
  evidence for steps 1–3 in the final commit of this run or a separate
  `docs:` commit).

### Acceptance (run after each commit; all must pass)

- Commit 1: `npm run typecheck`;
  `npx vitest run tests/unit/edition-registry.test.ts tests/unit/product-data.test.ts`
- Commit 2: `npm run typecheck`;
  `npx vitest run tests/unit/persistence.test.ts tests/unit/engine-save-v3.test.ts tests/unit/product-data.test.ts`
- Commit 3: `npm run typecheck`; `npm test`; `npm run build`;
  `npm run test:e2e -- --project=desktop-chromium`
  (if the E2E server stalls on 127.0.0.1 under WSL2, report it rather than
  changing configs).

### Output

Reply with: commits (SHA + subject), acceptance command results (pass/fail
counts), any deviation from the plan and why, anything left unrun.

## P3: Implement commits 4–6 (Luna high)

### Objective

Implement commits 4, 5 and 6 of `.claude/docs/plans/b1-edition-switch-plan.md`
exactly as specified there, one git commit per step, on top of the finished
commits 1–3 (see the step table in `.claude/docs/plans/b1-edition-switch-handoff.md`).

### Constraints

- The plan is the spec. Where it is ambiguous, keep current single-edition
  behaviour byte-identical and note the choice in your reply.
- `display.documentTitle` is now `山手線すごろく — 東京近郊版` (matches
  `index.html`; pinned by `tests/unit/edition-registry.test.ts`). When `App`
  sets `document.title` in commit 5, the single-edition tab title must stay
  exactly that.
- `jsdom` is approved as a devDependency for DOM tests only: pin an exact
  version (no `^`/`~`), install with `npm install --save-dev --save-exact`,
  and keep existing tests in the Node environment (per-file
  `// @vitest-environment jsdom`).
- No fake or fixture edition in production code; two-edition behaviour is
  tested only with fixtures under `tests/unit/fixtures/`.
- Do not weaken, skip or delete existing tests. No engine, RNG, save payload,
  save version, data or pipeline changes.
- Follow `.claude/rules/coding-principles.md` and `.claude/rules/testing.md`;
  match surrounding code style. `docs/manual/**` content is Japanese
  (`.claude/rules/manual-docs.md`).
- Commit messages: conventional style, each ending with a blank line and
  `Co-Authored-By: Codex (gpt-6-luna) <noreply@openai.com>`. Do not push.
- Do not edit files under `.claude/` except the step table in
  `.claude/docs/plans/b1-edition-switch-handoff.md` (fill SHA and evidence for
  steps 4–6, in a separate `docs:` commit).

### Acceptance

- Commit 4: `npm run typecheck`;
  `npx vitest run tests/unit/edition-picker.test.ts tests/unit/edition-registry.test.ts`;
  `npm run build`
- Commit 5: `npm run typecheck`;
  `npx vitest run tests/unit/edition-app.test.ts tests/unit/edition-loading.test.ts tests/unit/edition-runtime.test.ts tests/unit/persistence.test.ts`;
  `npm test`; `npm run build`;
  `npm run test:e2e -- --project=desktop-chromium`
- Commit 6: `npm run typecheck`; `npm test`; `npm run build`;
  `npm run test:e2e -- --project=desktop-chromium`;
  `npm run test:e2e -- --project=phone-chromium`.
  Firefox and WebKit run on CI only (WebKit cannot run on this WSL2 host);
  report them as "CI only", do not try to install system packages.

### Output

Reply with: commits (SHA + subject), acceptance results (pass/fail counts),
the exact `jsdom` version added, any deviation from the plan and why,
anything left unrun.
