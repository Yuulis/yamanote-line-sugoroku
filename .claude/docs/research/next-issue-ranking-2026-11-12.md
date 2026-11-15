# Next-issue ranking (2026-11-12)

Source: Opus subagent read of open issues #60, #61, #63, #65–#69, #71–#73
(`gh issue view --json`), `.claude/docs/research/ux-improvement-analysis.md`,
DESIGN.md TODO and recent Key Decisions, STATE.md, targeted greps of `src/`.
User decision (2026-11-12): next is **#66**, to be worked on in a separate session.

## Ranking

| # | Issue | Theme | Impact | Size | Blockers / user decisions | Overlap |
|---|---|---|---|---|---|---|
| 1 | #66 | Turn result + log | High, every turn (UX-02 P0) | S–M | Phone placement inside the 45% panel cap (#70: 252px at 320x568); content; timing | Same panel slot as #65; item chip from #61; turn wording from #68 |
| 2 | #65 | Progress feedback | High, long games (UX-05 P0) | M (+M counters) | Milestones; stations vs hops; counters may need visited-station state (save change?) | #66 space; #69 shows counters; 30/30 toast already exists (`toastQueue.ts:130`); proximity in `proximity.ts:38,72` |
| 3 | #60 | Rules screen | Med-high, first-timers/phones | S–M | Title copy; how much of `docs/manual/tokyo-suburban/rules.md`; deep links | Prerequisite for #67; title shared with #68; shortcut hint already in `GameMenu.tsx:136` |
| 4 | #67 | First-run guide + labels | High, first 2 min (UX-01 P0) | M | Coach-mark steps; tips; 「演出をスキップ」 vs icon (`GameHud.tsx:105`, `RollAdjustment.tsx:91`; Escape hint on phones `RollAdjustment.tsx:86`) | Needs #60; first-bad-item tip overlaps #61 |
| 5 | #73 | Analytics, loading, small bugs | Low direct; enables measurement | S–M | Which events + `privacy.html`; only 3 events (`analytics.ts:6`); stale `README.md:3`; failure-overlay-after-load not re-checked (`RailwayMap.tsx:787` retry clears it) | Before/with #65/#66 (UX-17); its `npm run sim` re-run needed for #61 rules and #69 percentile |
| 6 | #61 | Items | Display S / rules M (save-breaking) | S + M | Drop rate, harmful share, ±2/±3 split; run the sim first | #66 chip; #67 tip; #71 discard; #60 numbers |
| 7 | #68 | Title + save | Medium | S | 「95ターン終了」 vs 「96ターン目から」 (`TitleScreen.tsx:49`) | Bundle with #60 |
| 8 | #71 | Phone layout + map controls | Medium (phones) | M | Two-state sheet vs collapsing empty inventory row; discard-confirm style | Panel height budget with #66 and #63 |
| 9 | #63 | Transfer lottery | Medium | S (flip-board reorder) / L (roulette) | Roulette vs reorder; odds unchanged | #72 highlight; #60 odds; #71 size |
| 10 | #69 | Clear screen + share | Medium | M (X share alone S) | History size; percentile (needs #73 sim) | #65 counters |
| 11 | #72 | Map focus style | Medium | M | Default opacity; default on? | #63 highlight; perf risk (symbol layer slowed CI WebKit 1.54x, #62 Step 4b) |

## Ordering

- #60 before #67; #68 can ride in the #60 PR.
- Design #66 and #65 together for panel space (desktop ~280px free, phone 45% cap); ship #66 first.
- A small #73 slice (progress events, README) just before or with #66/#65.
- Split #61: display part any time; all rule changes in one save-breaking release (no migration, user 2026-11-10).
- #63 reorder can bundle with #72's lottery highlight.

## Product questions for #66 (ask before planning)

1. Phone placement inside the 252px / 45% budget: replace/shrink something, or a collapsible line? Desktop: shrink the panel or keep space for #65?
2. Content: roll, landing station, +N segments, transfer line/direction, picked item, triggered effect? One line or two?
3. Timing: reveal-gated `turnDisplay` (as in #62); behaviour under 演出: なし and auto-roll?
4. 10-turn history with 「もっと見る」 now or later (issue rates it low)?
5. Turn wording aligned with #68?
6. Pacing and implementer lane.
