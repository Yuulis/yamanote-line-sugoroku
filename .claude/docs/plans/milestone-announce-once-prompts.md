# Issue #96 — milestone sentence announced once — prompts

## P0 — planning consult (Codex Sol, low, read-only)

Objective: produce an implementation plan for GitHub issue #96 so that the
screen-reader milestone sentence (10/20/25/29 crossings and the 30/30
"新橋に着けばクリア" sentence) is announced exactly once per turn per milestone,
and never on resume.

Issue #96 (Japanese, summary):
- Repro 1: effects "すべて", a turn that crosses a milestone; Skip while the
  arrival card or the lottery is showing -> the sentence is read at arrival
  and again at the published result.
- Repro 2: no effects / OS reduced motion / after Skip in the same turn:
  staging or unstaging an item, or choosing an item to discard, changes the
  live text and the milestone sentence is read again with each change.
- Related: a turn with neither a segment flash nor a lottery never reads the
  sentence (the toast still shows).
- Cause: whether to append the sentence is decided statelessly (#65 Step 5
  decision); 30/30 has behaved like this since #62.
- Proposed fix: GameApp records which `session:turn:threshold` was announced
  and appends the sentence only once.
- Acceptance: one announcement per turn per milestone; none on resume.

Background you must read first: `.claude/docs/reviews/hud65-step5-fable.md`
(three earlier attempts failed; a consumed-key set was rejected then, the
user now explicitly proposes one; risks 1-3 there are this issue).

Relevant files (start here, explore further as needed):
- `src/features/game/turnMomentPresentation.ts` (currentCrossing, ARRIVAL_COPY_PHASES, sentence/toast/flash)
- `src/features/game/progressMilestones.ts`, `src/features/game/toastQueue.ts`
- `src/app/GameApp.tsx` (live-region text, session/turn identity, resume)
- `src/features/game/presentation.ts` (arrival/lottery copy)
- tests: `tests/unit/progress-milestone-publication.test.ts`, `tests/unit/*turn-moment*`,
  `tests/unit/game-app-turn-moments*`, `tests/e2e/hud-progress-feedback.spec.ts`, `tests/e2e/accessibility.spec.ts`

Constraints:
- Do not edit files. Read-only analysis.
- Keep the toast and progress-bar flash behaviour unchanged (they already fire once).
- Do not weaken or delete existing assertions; if an existing assertion encodes the
  repeated announcement, name it and say exactly how it should change and why.
- Prefer the smallest correct design. Explain how the consumed-key state avoids the
  failure modes recorded in the review (S16 boundaries, live text changing between
  shared-copy phases, Skip, reduced motion, 演出なし, classic turns without RollAttempt,
  resume, new game in the same tab, undo/restore if any).
- State whether the "Related" gap (sentence never read on a card-less turn without
  flash or lottery) can be fixed by the same change, and whether it should be in
  scope; flag it as a user decision if it changes visible/audible timing.
- Tests: unit (Vitest) first; at most one E2E addition if a unit test cannot cover it.
  Lean scope: the user prefers small plans over exhaustive test matrices.

Acceptance checks the plan must list (commands):
- `npm run typecheck`, `npx vitest run`, `npm run build`
- the targeted Playwright spec(s), chromium only locally

Output format (markdown):
## TL;DR
## Current behaviour (with file:line evidence)
## Design (state shape, where it lives, when keys are recorded, reset rules)
## Steps (each: files, change, tests, est. LOC; mark which steps change anything visible/audible)
## Existing assertions affected
## User decisions needed
## Risks
