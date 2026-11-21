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

## S2 — milestone candidate + commit-time consumption (Codex Luna xhigh)

Objective: make the screen-reader milestone sentence (10/20/25/29 and the
30/30 "新橋に着けばクリア" sentence) reach the status live region at most once
per `session:turn:threshold`, by recording consumption after the live region
commits, so the two S1 `it.fails` tests for repeats pass.

Read first: `.claude/docs/plans/milestone-announce-once-plan.md` (Design,
Step 2, Existing assertions affected, Risks),
`.claude/docs/reviews/hud65-step5-fable.md`, `AGENTS.md` Guardrails,
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

Scope:
- In: `src/features/game/turnMomentPresentation.ts`, `src/app/GameApp.tsx`,
  `src/features/game/components/GamePanel.tsx`, and a new small pure helper
  module under `src/features/game/` only if it keeps GameApp readable.
  Tests: `tests/unit/game-app-turn-moments.test.ts` (flip the two repeat
  tests from `it.fails` to `it` and drop their `// #96` comments),
  `tests/unit/progress-milestone-publication.test.ts` and
  `tests/unit/turn-moment-presentation.test.ts` (re-target assertions that
  read the composed `.announcement` to the separated base text + candidate,
  with the same strictness), plus new focused unit tests for any new helper.
  `tests/e2e/hud-progress-feedback.spec.ts`: only fix the comment near line
  300 that says #96 tolerates the repeat.
- Out: toast and progress-bar flash behaviour (must stay byte-for-byte the
  same in outcome; their existing tests must pass unchanged), the card-less
  fallback (Step 3: the test
  "announces a crossing at publication when no arrival, segment flash or
  lottery is rendered" stays `it.fails`), any other file.
- Never weaken, skip or delete an assertion. If an existing assertion truly
  encodes the repeat, stop and report it instead of changing it.

Design (from the plan; follow it unless you find a concrete defect, which you
must then report):
1. `deriveTurnMomentDisplay` returns the base announcement without the
   milestone sentence plus an optional `{ key, text }` candidate. Key =
   `${sessionId}:${publicationTurn}:${threshold}` (30 for the goal-guide
   sentence). Keep every existing eligibility condition (movement complete,
   publication boundary, `publicationTurn > (entryTurn ?? 0)`, 30/30 rule,
   clear-on-arrival rule, ARRIVAL_COPY_PHASES vs published rules). Classic
   turns without a RollAttempt must still resolve a key.
2. GameApp holds a per-session consumed `Set<string>` (a ref, not state, so
   recording does not re-render) and a `held` record
   `{ key, baseText, surface }` for the last commit that carried the
   sentence. Compose: if the candidate is unconsumed -> append. If consumed
   -> append only while the committed surface and base text are unchanged
   since the held commit (so arrival -> lottery-flip -> settle keeps the
   identical full text, avoiding the S16 extra update). Any other text,
   notice, dialog, or unmount between ends the hold.
3. GamePanel reports, after commit (effect, never during render), which
   live-region surface committed which text and whether it carried the
   candidate key. Reports are idempotent. A live region that is not mounted
   (rules guide open) does not consume. If the discard dialog's live region
   is the first surface, it consumes there once.
4. Reset the set and the hold when the session id changes or on return to
   title. Resume relies on `entryTurn` as today.

Acceptance checks (run all, report tails):
- `npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/progress-milestone-publication.test.ts tests/unit/turn-moment-presentation.test.ts`
- `npx vitest run` (expected: exactly 1 expected-fail left, the Step 3 test)
- `npm run typecheck`
- `npm run build`
- `npx playwright test tests/e2e/hud-progress-feedback.spec.ts --project=desktop-chromium`
- `git diff --stat` limited to the In files above

Output shape (English markdown): Summary; Design as implemented (state shape,
where keys are recorded, reset); Deviations from the plan and why; Existing
assertions re-targeted (file:line, before -> after); Check results;
Risks. Keep under ~100 lines, no file dumps. Do not commit.

## R2 — Step 2 review (Codex Sol low, read-only)

Objective: decide whether the uncommitted Step 2 diff (`git diff` against
HEAD; production files `src/app/GameApp.tsx`,
`src/features/game/components/GamePanel.tsx`,
`src/features/game/turnMomentPresentation.ts`, plus test re-targets) is safe
to commit for issue #96.

Context: plan `.claude/docs/plans/milestone-announce-once-plan.md`; history of
failed attempts `.claude/docs/reviews/hud65-step5-fable.md`; prompt S2 above.
Contract: the milestone sentence reaches a status live region at most once per
`session:turn:threshold`; consumption is recorded only after a live region
committed it; no extra live-region update when the shared arrival copy moves
through segment-flash/lottery-flip/settle; nothing announced on resume;
toasts and progress flash unchanged. Step 3 (card-less fallback) is out of
scope and its test stays `it.fails`.

Look specifically for:
- Paths where the sentence is consumed without being committed (rules open,
  confirmation, coach, item dialog, notice/hint covering the ordinary text,
  StrictMode double render/effects, memoised GamePanel skipping a render).
- Paths where it is announced twice (surface switch panel -> adjustment/discard,
  notice ending, rules close, re-mount by key, session change).
- Drift risk between the two surface computations (GameApp `milestoneSurface`
  vs GamePanel `announcementSurface`) and whether one should derive from the
  other.
- Render-phase ref mutation hazards.
- Re-targeted assertions: are any weaker than before?

Do not edit files. Output (English markdown): Verdict (commit / fix first);
Findings ranked P1/P2/P3 with file:line and a concrete failing scenario;
Suggested minimal fixes. Under ~60 lines.

## S2b — Step 2 re-delegation with R2 findings (Codex Luna xhigh)

Objective: fix the R2 findings in the uncommitted Step 2 diff so the
milestone sentence is consumed exactly when, and only when, the status live
region that actually renders it commits it. Same contract, scope, out-of-scope
and acceptance checks as S2 above (re-read S2). Work on top of the current
uncommitted diff; do not revert it wholesale.

R2 findings to fix (Codex Sol low review, verdict "fix first"):
- P1: GameApp composes the sentence with its own visibility predicate, while
  GamePanel reports with another. With rules (or confirmation, coach, item
  dialog) open on the first eligible render, the sentence reaches the panel
  status DOM but the report has surface null; closing the modal with the same
  copy then consumes it without a fresh live-region update.
- P2: child-only GamePanel renders (notice/hint selection, document
  visibility, item-dialog flag mirrored via passive effect) can clear the
  hold while the parent's composed `announcement` prop is stale, so the
  sentence can be restored or lost.
- P2: render-phase writes: replacing the consumed set when `sessionId`
  changes during render, and writing composed text into
  `classicAnnouncement.current` during render, can leak from an abandoned
  render.
- P3: re-targeted pure tests lost two composed-copy checks: `。` before the
  sentence (`/。10区間突破！$/`) and the 30/30 sentence appearing exactly once.

Required direction (from R2; deviate only with a concrete reason):
1. Single composition point: GameApp passes the base copy and
   `milestoneCandidate` plus a pure `isConsumed(key)`/hold snapshot (or the
   ledger object) to GamePanel; GamePanel composes against the same local
   surface + notice selection that drive the status JSX it renders, writes
   the suffix only when that surface is mounted and not covered, and reports
   the exact payload it rendered from a layout effect. Remove the duplicated
   surface predicate from GameApp. Extract the compose decision into a small
   pure, unit-tested function (e.g. in `turnMomentPresentation.ts` or a new
   `milestoneAnnouncement.ts`) so the rule is testable without React.
2. Ledger mutations happen only in commit-phase callbacks. Keys already
   contain the session id, so do not swap the set during render; clearing on
   return to title may happen in that event handler. The hold is only valid
   across consecutive commits on the same mounted surface with identical base
   text and key.
3. Classic carry-forward (`classicAnnouncement`) must keep the text that was
   actually committed, written from the commit report, not from render.
4. Restore the two composed-copy checks at the composition boundary (pure
   compose-function tests), and add GameApp status-level regressions:
   (a) rules guide open at the first eligible arrival render, then closed:
   the sentence is announced exactly once, after close; (b) a hint or notice
   covering the published milestone, then removed: the sentence is not
   announced again. Keep the S1 tests and the Step 3 `it.fails` as they are.

Acceptance checks: same list as S2, plus `npx vitest run` showing exactly one
expected fail (the Step 3 test).

Output shape: as S2, plus "R2 findings -> fix" mapping. Under ~100 lines.
Do not commit. Do not touch `.claude/docs/plans/*`.

## R2b — S2b review (Codex Sol low, read-only)

Objective: decide whether the uncommitted S2b diff (`git diff` + untracked
`src/features/game/milestoneAnnouncement.ts`,
`tests/unit/milestone-announcement.test.ts`) resolves R2 and is safe to
commit for #96. Contract and context: R2 above (same checklist), plus:

- Verify each R2 finding (P1, P2 x2, P3) is actually fixed, with evidence.
- Lead concern to rule on: after the sentence was committed and held on the
  panel, opening rules / confirmation / coach / item dialog (or hiding the
  document) makes `announcementSurface` null, the commit report clears
  `held`, and the panel status text drops the suffix while the modal is
  open; after close the key is consumed and unheld, so the text stays base.
  Does this cause a live-region text change (an extra announcement of the
  base copy) that did not happen at HEAD? Is the panel status inert/hidden
  while those modals are open? If it is a regression, propose the minimal
  fix (e.g. a blocked surface keeps an existing hold and keeps composing
  the held text; it only suppresses an unconsumed suffix).
- The `turnMomentBoundary.noticeAnnouncement` test-seam extension in
  `GameApp.tsx`: acceptable, or test-only leakage into production?
- `handleMilestoneAnnouncementCommit` depends on `session?.phase` etc.; does
  its changing identity cause repeated reports with side effects?

Do not edit files. Output: Verdict (commit / fix first); Findings P1/P2/P3
with file:line and failing scenario; Minimal fixes. Under ~60 lines.

## S2c — Step 2 by Codex Sol (default effort), after S2b failed R2b

Objective: finish Step 2 of #96 on top of the current uncommitted S2b diff so
that the milestone sentence reaches a status live region exactly once per
`session:turn:threshold`, without changing live-region text in any case where
HEAD kept it unchanged. Same contract, scope, out-of-scope and acceptance
checks as S2 (re-read S2, S2b, R2, R2b above). You may restructure the S2b
code; keep what R2b confirmed fixed (single composition point in GamePanel,
ledger writes only in commit/event handlers, pure
`composeMilestoneAnnouncement` with its tests, the `noticeAnnouncement` test
seam).

R2b findings to fix:
- P2: after a held panel commit, opening rules / confirmation / coach / item
  dialog, or hiding the document, makes the surface null, drops the suffix
  from the same mounted status node and clears the hold; after close the key
  is consumed and the text stays base. HEAD kept the full copy. Fix: separate
  "status node mounted and showing this base copy" from "allowed to publish a
  new suffix". A blocked-but-mounted surface keeps an existing matching hold
  and keeps rendering the held full text; it only withholds an unconsumed
  suffix. Release the hold when the status node unmounts, its surface or base
  copy changes, or a notice replaces the text.
- P2: when a notice covers a held panel milestone, the report clears `held`,
  the passive effect stores the suffixed string as `coveredOrdinary`, the next
  render composes base copy and the notice is dropped as "ordinary changed".
  Fix: notice bookkeeping (`coveredOrdinary`, `previousOrdinary`, ordinary
  change detection) must not flip because of the hold alone; use a stable
  comparison (e.g. base copy) or keep the hold while a notice covers it.
  Decide which, and make sure a covered-then-uncovered milestone is not
  announced a second time.
- P3: classic carry-forward must cache only ordinary panel text, never notice
  text; repeated reports caused by callback identity changes must not refresh
  it with the wrong text.

Add mounted GameApp regressions (status-level, `lotteryCommits`-style):
(a) arrival with milestone committed, open rules, close rules: no status text
change at open or close, sentence occurs once in the turn;
(b) a notice covering a still-held panel milestone (start the notice while
the suffix is held, not after discard): the notice is not cut short, and after
it leaves the sentence is not announced again;
(c) classic idle with a notice showing, then roll: movement carries the
ordinary summary, not the notice.
Keep the R2b-noted existing regressions and the Step 3 `it.fails`.

Acceptance checks: as S2, `npx vitest run` with exactly one expected fail.
If `/tmp` is not writable for Vitest in your sandbox, set `TMPDIR` to a
directory under the repo's `.claude/logs/` and say so.

Output shape: as S2, plus "R2b findings -> fix" mapping. Under ~100 lines.
Do not commit. Do not touch `.claude/docs/plans/*`.

## R2c — S2c review (Codex Sol low, read-only)

Objective: decide whether the uncommitted S2c diff (`git diff HEAD`, incl.
new `src/features/game/milestoneAnnouncement.ts` and
`tests/unit/milestone-announcement.test.ts`) is safe to commit as Step 2 of
#96. Checklist: R2 and R2b above. Verify each R2b finding is fixed with
evidence, and look for new regressions versus HEAD in live-region text
(extra changes, lost notices, lost or repeated milestone sentences), in the
classic carry-forward (`previousClassicAnnouncement` is now an
`OrdinaryAnnouncement`), and in adjustment/discard dialog remounts after the
rules guide closes. Toasts and progress flash must be unchanged. Re-targeted
assertions must not be weaker. If `/tmp` is unwritable, set `TMPDIR` under
`.claude/logs/` before running any Vitest.

Do not edit files. Output: Verdict (commit / fix first); Findings P1/P2/P3
with file:line and failing scenario; Minimal fixes. Under ~60 lines.
