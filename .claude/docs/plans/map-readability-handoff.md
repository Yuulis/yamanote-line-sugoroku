# Issue #72 handoff: map readability

Resume point for Claude or Codex sessions. Update this file after every step.

- Plan: `.claude/docs/plans/map-readability-plan.md`. It has 23 steps over 3 PRs. Codex
  validated it PASS in round 3, and it was then revised for the user's default changes on
  2026-11-26.
- Prompts: `.claude/docs/plans/map-readability-prompts.md`
- Research: `.claude/docs/research/feature-map-readability-brief.md` and
  `.claude/docs/research/feature-map-readability-codebase.md`
- Pacing (user 2026-11-26): stop after every step. Since Step 1.8 (user 2026-11-27): continuous until told otherwise (still verify, commit, push, CI per step). Codex Luna xhigh implements, and Codex Sol
  low reviews. For each step the lead runs verify, commit, push and branch CI, updates this
  file, reports, and then waits.
- Lead re-verification: typecheck, touched vitest, full vitest, build, the diff check, and phone
  `@layout`. Desktop E2E is left to branch CI.

## Branches

| PR | Branch | Base | Status |
|---|---|---|---|
| PR1 | `feature/map-focus-goal` | develop `c7af52a` | in progress |
| PR2 | `feature/replay-camera-strip` | develop after PR1 | not started |
| PR3 | `feature/shared-track-offsets` | develop after PR2 | not started |

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1.1 | done | a5487da (CI green) | Luna xhigh; lead: 76 removed lines verbatim in railwayMapCamera.ts, typecheck, vitest 2746 pass / 1 pre-existing skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 1,022 -> 945 lines |
| 1.2 | done | 2f43e99 (CI green) | Luna xhigh (1st run stopped correctly on shared deps ZERO_MAP_PADDING/positionsBounds; prompt relaxed, 2nd run moved them too); lead: removed lines verbatim except 3 import specifiers, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 945 -> 787 lines |
| 1.3 | done | ffbeeb5 (CI green) | Luna xhigh; lead: removed lines verbatim except the now-unused positionsBounds import specifier, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 787 -> 705, railwayMapCamera.ts 340 lines |
| 1.4 | done | 6078690 (CI green) | Luna xhigh; lead: 61 removed lines verbatim in useSegmentFlash.ts, test import path + comment only, typecheck, vitest 2746 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. RailwayMap.tsx 705 -> 643 lines |
| 1.5 | done | 6091e3d (CI green) | Luna xhigh run 1 passed unit tests but Sol low REJECTED (High): one persistent RailwayMap starts in title mode, so the creation-time flag never reached gameplay (before/after screenshots were byte-identical). Re-delegation 1/1: modeRef + setBackgroundFocus in a layout effect on mode/layersRevision; new tests railway-layers-background-focus.test.ts and title-map-mode transition test. Runtime paint via __sugorokuE2E (e2e build): title 3/0.75, game 2/0.3, resumed 2/0.3. Lead: typecheck, vitest 2750 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. Screenshots .claude/logs/screenshots/issue72-s15-*.png |
| 1.6 | done | 6eec43f (CI green) | Luna xhigh run 1: Sol low REJECT (suppression tests used revealStage waiting, passed with guards removed). Re-delegation 1/1: redundant restoredOrOmitted guard removed, each flag tested alone in flip+settle, precedence case added; mutation check by Luna (all three guards) and lead (skipRequested: 2 failures). Lead: typecheck, vitest 2759 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; Sol low ACCEPT. Plan file path was src/features/game/turnMomentPresentation.ts (not animation/). Plan A2 row now requires Step 1.7 to compare candidate feature-id sets by content |
| 1.7 | done | b42d8bb (CI green) | Luna xhigh: lotteryCandidates layer (4 px / 0.85, between services and currentService; 14 layers), updateLotteryCandidates, useLotteryCandidateOverlay (content-compared featureId set, layersRevision), GameApp passes ids in game mode only, hidden in clear mode; E2E ui-pop-turn-moments asserts 32 fixture featureIds in flip+settle and empty after. User tweak 2026-11-27: FOCUS_OTHER_SERVICE_LINE_OPACITY 0.30 -> 0.40 (intentional test updates). Lead: typecheck, vitest 2763 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip; real-data paint read 2 / 0.4; Sol low ACCEPT. Screenshots issue72-s17-*.png (lottery shots are fixture network) |
| 1.8 | done | 52fae43 (CI green) | User decision 2026-11-27: gameplay/clear only, title keeps style values. Luna xhigh: basemapLabels.ts (buildBasemapLabelPatches with originals, applyBasemapLabelFocus), baseline captured in style.load before addRailwayLayers, layout effect on mode/layersRevision. Runtime: waterway_line_label text-opacity undefined (title) / 0.75 (game); title screenshot hash unchanged. Lead: typecheck, vitest 2769 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip. Sol low REJECT (Medium): coalesce-wrapped zoom curves are skipped as unsafe; lead accepted as a known limitation because live Liberty has 25 symbol layers, all omitting text/icon opacity (50 patches, 0 skipped) and the plan sanctioned skipping unsafe values. Revisit if the basemap style changes |
| 1.9 | done | (this commit) | Luna xhigh: ring #d4a017 / 5 px; goalCallout.ts controller (pulse DOM halo + 「ここに着けばゴール」 bubble via exported createMapCallout), game mode only, reduced motion animation none. Sol low REJECT (Medium: goal and roll-adjust bubbles overlap at 新橋 after 30/30; Low: duplicated gold literal). Re-delegation 1/1: bubble yields while adjustment candidates exist, pulse stays, CSS var from GOAL_STATION_RING_COLOR; Sol low ACCEPT. Lead: typecheck, vitest 2772 pass / 1 skip, build, diff --check, phone @layout 127 pass / 6 skip. Screenshots issue72-s19-goal-*.png (fixture) |
| 1.10 | next | — | — |

## Next action

Step 1.10: Luna writes docs/manual/map-readability/colour-vision.md (Japanese, report only, local analysis script not committed); lead records DESIGN.md rows R1 and R2 via update_design.py; then open the PR1 PR to develop.
Open question for PR2: what 次 does from the done view (lead default: disabled); ask the user before Step 2.1.
