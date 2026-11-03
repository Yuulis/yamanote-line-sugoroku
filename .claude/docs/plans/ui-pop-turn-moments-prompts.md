# UI Pop P2 (Turn Moments) — Executor Prompts

Self-contained executor prompts, one per step of `.claude/docs/plans/ui-pop-turn-moments-plan.md`.
A step's prompt file = **§0 Common Contract + the step section**. Build it mechanically (never retype):

```bash
STEP=S1   # S1 … S17, or S10b
mkdir -p .claude/logs/codex
awk -v s="## ${STEP}:" '/^## /{p = ($0 ~ /^## 0\. Common Contract/) || index($0, s) == 1} p' \
  .claude/docs/plans/ui-pop-turn-moments-prompts.md > ".claude/logs/codex/prompt-p2-${STEP}.md"

# Implementer, Luna high (default lane)
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file ".claude/logs/codex/prompt-p2-${STEP}.md" --label "p2-${STEP,,}" \
  --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --timeout 2400 --caller lead
```

Claude Sonnet fallback: pass the same built file as the subagent prompt. Reviewer (Sol low, read-only),
after the implementer finishes and before the lead commits:

```bash
awk '/^## R:/{p=1;next} /^## /{p=0} p' .claude/docs/plans/ui-pop-turn-moments-prompts.md \
  | sed "s/{STEP}/${STEP}/g" > ".claude/logs/codex/prompt-p2-${STEP}-review.md"
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file ".claude/logs/codex/prompt-p2-${STEP}-review.md" --label "p2-${STEP,,}-review" \
  --config model_reasoning_effort=low --sandbox read-only --caller lead
```

The lead commits after verification; executors never commit. Step sections hold only what the plan does not:
the plan's `### {STEP}` section is binding and is read by the executor directly.

---

## 0. Common Contract

You are implementing one step of the "UI pop P2 — turn moments" feature in
`/home/yuulis/yamanote-line-sugoroku` (React 19 + TypeScript 6 + Vite 8 + MapLibre; Vitest; Playwright),
branch `feature/ui-pop-turn-moments`. Implement **only** the step below, completely, as one reviewable change.

Read first:
- `.claude/docs/plans/ui-pop-turn-moments-plan.md` — Summary (hard scope boundaries, incremental activation,
  execution contract) and the step's `### {STEP}` section. That section is binding: its file list, tests and
  acceptance commands define the step.
- `.claude/docs/plans/ui-pop-turn-moments-architecture.md` — interfaces, data flow, Skip and publication rules.
- `.claude/docs/plans/ui-pop-turn-moments-handoff.md` — previous steps' notes and open findings.
- `.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

Fixed decisions (user, 2026-11-03; do not reopen): all four moments (dice tumble + modifier stamps, arrival
banner + completed-segment flash, split-flap lottery board at the visible map centre settling into the HUD,
item pickup before DiscardChoice); durations = base × stepMs / 450, captured at the roll; pseudo-3D CSS cube;
dice disabled (focusable, `aria-disabled`) during post-move reveal; overlay tap and スキップ end the reveal; one
Skip ends tumble + movement + reveal; goal turn = arrival banner then ClearScreen; no moments under
reduced motion or for resumed results; no probabilities shown; no sound.

Hard constraints:
- Do not modify: `src/features/game/engine/**`, `src/features/game/store/**`, `src/features/game/gameSession.ts`,
  `src/features/game/itemSession.ts`, `src/features/game/useGameApp.ts`, `src/types/network.ts`,
  `public/data/**`, `data/**`, `package.json`, `package-lock.json`, `.claude/docs/DESIGN.md`, `.claude/STATE.md`.
  Touch only the files listed for the step plus the handoff doc.
- No new dependencies. No `Math.random`; presentation never imports engine RNG or turn functions and never
  becomes save input.
- Conventions: function components, named exports, `XxxProps` in the same file, BEM-ish classes in the single
  global `src/styles.css`, colours through CSS tokens, constants `UPPER_SNAKE_CASE`, type annotations
  everywhere, early returns, English code/comments, Japanese UI copy. Pure logic in `.ts` modules with
  table-driven Vitest tests.
- Unit tests: `tests/unit/<name>.test.ts` (no `.tsx`), `// @vitest-environment jsdom` when rendering, React via
  `createElement` + `tests/unit/helpers/reactDom.ts`. Lifecycle assertions keep component identity stable
  (`act(() => mount.root.render(createElement(Harness, props)))` with a named `Harness`). Use
  `vi.useFakeTimers()` and record commits with `useLayoutEffect` as `tests/unit/reveal-sequence.test.ts` does.
- E2E: never delete, skip, or loosen an assertion; re-point it to an explicit checkpoint with the same expected
  value. Local runs: `env -u WAYLAND_DISPLAY npx playwright test --workers=2 --project=desktop-chromium …`
  (add `phone-chromium` when the step says so); WebKit and the full matrix are CI-only.
- Accessibility: exactly one gameplay `role=status` live region (panel, active decision dialog, or ClearScreen);
  visual moment layers `aria-hidden="true"` with no focusable descendants; the overlay never takes focus;
  `panelStat` `<dt>`/`<dd>` + `data-stat` contracts kept; the dice name stays within `/サイコロを振る|移動中…/`.
- Forbidden-path audit must print nothing:
  `git diff --exit-code 70decd6 -- src/features/game/engine src/features/game/store src/features/game/gameSession.ts src/features/game/itemSession.ts src/features/game/useGameApp.ts src/types/network.ts public/data`

When done, update the step's row in `.claude/docs/plans/ui-pop-turn-moments-handoff.md` (status
`implemented — pending lead verification`, commands you ran with pass/fail counts, open findings). Do not commit.

Output format (markdown, exactly these sections):
## Summary
## Files Changed (path — new/modify — one line)
## Tests Added or Changed (exact test names; for E2E re-pointing list old → new checkpoint and confirm the expected value is unchanged)
## Commands Run (command → result with counts)
## Deviations and Assumptions
## Open Issues

---

## S1: First-commit omission and future-key Skip support

Implement plan `### S1` exactly. Files: `src/features/game/animation/useRevealSequence.ts`,
`tests/unit/reveal-sequence.test.ts` (plus the handoff row).

- Add optional `skipRequested?: boolean` to the hook options and an omission flag to the pure `observe` action.
  `omit = reducedMotion || skipRequested` is folded into both the new-key and the same-key observation branches
  (`done = alreadySeen || stageCount === 0 || omit` / `done = state.done || stageCount === 0 || omit`).
- Remove the effect that completes reduced motion after commit; return values derive from the observed state on
  the same render: omitted key → `stage: "done"`, `busy: false`, `ready: movementComplete`.
- Completion is sticky per key: turning reduced motion off, or `skipRequested` returning to false, never replays.
- Keep every existing test passing unchanged; production callers keep passing empty stages (no behaviour change).
- Tests: the six bullets of plan `### S1` → Tests, each as a named test in the existing harness style.

Acceptance (run all; report counts):

```bash
npm run typecheck
npx vitest run tests/unit/reveal-sequence.test.ts
npx vitest run
npm run build
```

No E2E in this step.

---

## R: Reviewer prompt body (Codex Sol low, read-only)

Objective: Review the uncommitted change for step {STEP} of `.claude/docs/plans/ui-pop-turn-moments-plan.md`
in `/home/yuulis/yamanote-line-sugoroku` (read-only). Read the plan Summary and its `### {STEP}` section, the
`## {STEP}:` section of `.claude/docs/plans/ui-pop-turn-moments-prompts.md`, the architecture
`.claude/docs/plans/ui-pop-turn-moments-architecture.md` where relevant, and `git diff HEAD` plus untracked files.
Check: the step's requirements are fully met (no stubs/TODO); only owned files changed; no forbidden path; no
weakened, skipped or deleted assertion and expected values unchanged; production never runs an invisible timed
stage before its activation step; no result published before its boundary; reduced-motion and resume omission;
Skip semantics; timers cancelled on key/stage change, skip and unmount; exactly one gameplay status region;
overlay aria-hidden and never focused; dice text contract; conventions (named exports, `XxxProps`, global BEM
CSS, `.test.ts`, stable harness for lifecycle tests); no new dependencies.
Output format: `## Verdict (ACCEPT / CHANGES_REQUIRED)`, `## Blocking Findings` (file:line, why, fix),
`## Non-blocking`, `## Checks Not Verifiable From the Diff`.
