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

## S1 — regression tests first (Codex Luna xhigh)

Objective: add Vitest regression tests that pin the #96 contract at the
GameApp level, before any production change, so Step 2 has a failing target.

Read first: `.claude/docs/plans/milestone-announce-once-plan.md` (Design and
Steps 1-3), `.claude/docs/reviews/hud65-step5-fable.md`, `AGENTS.md`
Guardrails, `.claude/rules/testing.md`, `.claude/rules/coding-principles.md`.

Scope:
- In: `tests/unit/game-app-turn-moments.test.ts` only (add tests, and small
  local helpers inside that file if needed). Reuse the file's existing
  fixtures, boundaries and live-region commit recording; do not invent a new
  harness if one exists.
- Out: every file under `src/`, every other test file, E2E specs, docs.
- Do not modify or delete any existing test or assertion.

Tests to add (each asserts on what the real status live region commits, i.e.
the sequence of distinct live texts, not on a pure-function return value):
1. Effects "すべて", a turn crossing a milestone below 30, Skip while the
   arrival card is showing: the milestone sentence appears in the arrival
   text exactly once across the whole turn; the published result text after
   Skip does not contain it. (Same shape for Skip during the lottery if the
   fixture offers a lottery on a crossing turn; otherwise one case is enough.)
2. Reduced motion (or 演出なし) from the start, a crossing turn: the first
   published result contains the sentence once; after staging then unstaging
   an item (or choosing a discard item) in the same turn, later live texts do
   not contain it.
3. Card-less turn with no renderable segment flash and no lottery (plan Step
   3): the published result contains the sentence exactly once.
4. Resume of a saved game whose last turn crossed a milestone: the sentence is
   not announced (keep/extend the existing resume test rather than duplicating
   it, if one already covers this; then add nothing).
Include one 30/30 case among 1-2 if a fixture reaching 30/30 on a turn with
an arrival is available cheaply; otherwise state that it is not covered.

Because production code is unchanged in this step, the new tests that encode
the fixed behaviour will fail now. Mark exactly those with `it.fails(...)`
(Vitest) and a comment `// #96: flip to it() in Step 2`, so the suite stays
green and Step 2 has a mechanical flip. A test that already passes at HEAD
stays a plain `it(...)`; report which ones those are. Never use skip/todo.
Before marking a test `it.fails`, confirm it fails for the #96 reason (repeat
or missing sentence), not for a setup error: report the actual failure
message for each.

Acceptance checks (run them all, report output tails):
- `npx vitest run tests/unit/game-app-turn-moments.test.ts`
- `npx vitest run`
- `npm run typecheck`
- `git diff --stat` shows only `tests/unit/game-app-turn-moments.test.ts`

Output shape (English markdown): Summary; Tests added (name -> it/it.fails,
failure message at HEAD); Fixtures used; Not covered and why; Check results.
Context discipline: no full file dumps; keep the reply under ~80 lines.
Do not commit.
