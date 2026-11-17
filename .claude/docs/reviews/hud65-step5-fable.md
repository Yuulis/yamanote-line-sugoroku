# Issue #65 Step 5 (milestone publication) -- Fable Review

Date: 2026-11-15. Branch `feature/hud-progress-feedback`, base `47a4552`. Fable implemented the resolution
(uncommitted; the lead verifies and commits).

## Context

Three lower-tier attempts failed: a consumed-key set (attempts 1-2, rejected by Sol with 3xP2) and a pure
derivation (attempt 3) that still failed `S16 combined publication boundaries` and carried two unapproved
deviations. The user decided to drop the consumed-key state and accept the "arrival -> Skip -> published"
repeat. Fable was asked to land a correct Step 5 and to rule on the deviations.

## Analysis

**Why S16 failed.** `turnMomentAnnouncement` words `arrival`, `lottery-flip` and `lottery-settle` with one
identical text. The sentence was attached only in `arrival` / `segment-flash`, so it dropped at the lottery, the
live text changed, and the arrival was announced a second time. The 30/30 rule at base had the same latent
drop (confirmed by mutation: base rule gives "…踏破 30/30。新橋に着けばクリア" at arrival and "…踏破 30/30" at
`lottery-flip`); no existing fixture completes 30/30 on a turn with a lottery, so it was never caught.

**The plan and the existing tests cannot both hold for toasts.** Measured, not assumed:

- Plan-faithful "all historical crossings, always" fails 11 existing assertions (`turn-moment-items`,
  `turn-moment-presentation`, `game-app-turn-moments`) that pin `toastInputs` to the current turn's events; the
  item fixtures carry earlier 10/20 crossings in their history.
- "Current crossing public from arrival on" (plan timing table) still fails 5 of them: the `discard` and
  `rapid-long` fixtures genuinely cross 20 on the played turn, and existing tests require an empty list at
  `pickup`, at a standalone `segment-flash`, and item events only at a presented `published`.

Attempt 3 dodged these with special cases. Deviation (a) (withhold during `segment-flash` when a discard is
pending) is a defect, not a trade-off: in 重要なときだけ that turn offers the toast at no other phase, so the
toast is lost. Deviation (b) (history only under `restoredOrOmitted`) makes the entry baseline conditional and
re-offers the whole history on every reduced-motion turn, leaning on the queue cursor to discard it.

## Recommendation (implemented)

One fresh crossing per turn, three outputs, no state:

- `currentCrossing` = the threshold below 30 crossed by `publicationTurn`, once movement is complete and the
  arrival is public, and only if `publicationTurn > (entryTurn ?? 0)`.
- **Sentence**: part of the turn's arrival copy. Attached in every phase worded with that copy
  (`ARRIVAL_COPY_PHASES` = arrival, segment-flash, lottery-flip, lottery-settle), or at `published` for a turn
  that never worded it (classic, reduced motion, Skip, 演出なし) -- the base 30/30 rule plus the two lottery
  phases. Suffix presence is constant across the shared copy, so it never adds an announcement.
- **Toast**: offered with the arrival card (`phase === "arrival"`), or at `published` when the turn shows no card
  (classic, reduced motion, Skip, `policy.showArrival === false`). Never in the card-less stages in between,
  which is what the existing assertions require; the queue cursor rejects the repeat offer after Skip.
- **Flash** (D13): fresh crossing with a presented attempt (not restored/omitted, not Skip, not 演出なし).
- **30/30**: toast expression untouched (base lines kept verbatim); sentence = base condition + lottery phases.
  D10 holds by construction: a turn reaching 30 has no lower crossing, so nothing can fall back.

Deviations resolved: (a) removed and replaced by the card-less rule above, with a regression test on the
engine-played `discard` fixture; (b) removed -- no historical crossing below 30 is ever returned. D14's goal
(no replay on resume) is met by `entryTurn` on the single `currentCrossing` instead of by the toast baseline,
which only covers keys offered in the entry render and so cannot protect a transient offer.
`entryTurn === undefined` behaves as 0 (Sol P2 #3). The pending-discard dedupe of attempt 3 was dropped:
`deriveProgressCrossings` is idempotent over a repeated turn, so `completionRecords` is back to base.

## Changes Landed

- `src/features/game/turnMomentPresentation.ts` (+37/-11 vs `47a4552`).
- `tests/unit/progress-milestone-publication.test.ts` (new, 137 lines, 11 tests; rewritten from attempt 3).
- No other file. `GameApp.tsx` and every existing test file are byte-identical to base.

## Validation

- `npx vitest run`: 91 files, 2195 passed, 1 skipped (pre-existing), 0 failed; S16 passes.
- `npm run typecheck`: pass. `npm run build`: pass (existing chunk-size warning).
- Mutation checks, each restored afterwards and each killed by the new suite: lottery phases removed (also
  fails S16), `showArrival` branch removed, `entryTurn` guard removed, `movementComplete` removed, toast kept
  public after arrival, 演出なし sentence branch removed, flash matrix reduced.
- `.claude/skills/_shared/verify.sh`: its pytest gate reports 4 failed / 5 errors, all in `tests/data_pipeline`
  (`StageError: handoff is incomplete`, frozen-catalog checks). No Python or data file is in this diff and no
  Python test references the changed files; whether they also fail at base was not checked.
- Not run: Playwright E2E (Step 14 owns the lifecycle spec), and no Codex review of this final diff.

## Risks & Mitigations

1. Accepted residual: arrival (or lottery) -> Skip -> published announces the sentence twice, as 30/30 does.
2. Same family, by reading the derivation (not exercised in GameApp): in a turn published without its arrival
   (reduced motion, 演出なし, Skip, classic) the sentence follows every change of the base text in that turn
   -- staging or unstaging an item, resolving a discard. Reduced-motion users are the likely audience. A
   stateless narrowing exists: attach at `published` only while `summaryTurn` is that turn. Left for the issue.
3. Card-less turn (重要なときだけ, or a speed without the card) with no renderable segment flash and no lottery:
   the toast still shows, the sentence is never announced. Pre-existing for 30/30.
4. In card-less levels the toast arrives with the results, after the sentence (segment flash) -- up to the
   lottery and pickup durations later. Forced by the existing `segment-flash` and `pickup` assertions.
5. Classic turns without a `RollAttempt` get no flash (no captured policy to consult). Toast and sentence remain.
6. Size: 174 added lines (37 + 137) against the ~150 aim; the excess is the item-mode fixture that pins (a).
7. `ARRIVAL_COPY_PHASES` mirrors a wording fact in `presentation.ts`; if lottery copy ever diverges from the
   arrival copy the sentence would be announced with both. The new `it.each` over the three stages fails then.

## Dissenting Considerations

- The plan (D14, Step 5) asked for historical crossings in `toastInputs` and baseline suppression. That is
  the plan's letter; the existing byte-identical tests rule it out, and the purpose is met more directly.
- Offering the toast at `segment-flash` is the more natural timing for 重要なときだけ. It needs an edit to one
  existing assertion (`card-less segment flash publication`, `toastInputs` empty), which this step forbids. If
  the user prefers that timing, change that assertion deliberately in a follow-up, not by a special case.
- Keeping the consumed-key set would give true once-only announcements. The user declined it after two
  failed designs; the follow-up issue is the place to revisit it with the narrowing in risk 2 as the cheaper option.
