# Clear screen replay and X image share (#69) — Handoff

Resume from here. Plan: `clear-replay-share-plan.md` (Revision 3, Codex validated PASS round 3). Step prompts:
`clear-replay-share-prompts.md`. Brief and scans: `.claude/docs/research/feature-clear-screen-replay-and-share-{brief,codebase}.md`,
`.claude/docs/research/clear-screen-replay-and-share.md`. Decisions: DESIGN.md rows dated 2026-11-22.

- Branch: `feature/clear-replay-share` (from develop 5fdd2d6, v0.18.1)
- Leaderboard split out to issue #124 (not in this PR).
- Pacing: stop after every step for user review (user 2026-11-22).
- Lanes: Codex Luna xhigh implements, Sol low reviews, lead verifies (typecheck, vitest, build, verify_delegation, phone
  @layout for affected specs), commits, pushes, checks branch CI; desktop E2E is left to the implementer + branch CI.
- Full CI (PR or workflow_dispatch) is required at S5 and S6 for the 3-browser export probe and WebKit download.

## Step status

| Step | Status | Commit | Notes |
|---|---|---|---|
| S1 result model + strict route | done | e218c98 | Luna xhigh + 1 fix round after Sol low review (zero-hop transfer leg break, Mercator latitude limit, 3 tests). Lead: typecheck, vitest 2466 passed / 1 skipped (pre-existing), build, diff check, verify_delegation 0 actionable. Branch CI 44998059885 green. User review pending before S2 |
| S2 clear screen, announcements, phone layout | done | (see git log) | Sonnet implements, Opus review APPROVE (14 retargeted assertions all have equal/stronger replacements). Lead: typecheck, vitest 2492/1 skipped, build, diff check, phone @layout 24 passed/1 skipped. Deviations: phone sheet max-height 60%→78%; desktop history now below share/actions/highlights (single DOM). Screenshots .claude/logs/screenshots/issue69-s2-*.png. User review pending |
| S3 full-route layer + camera | pending | — | visible |
| S4 replay store + partial drawing | pending | — | visible |
| S5 PNG exporter + 3-browser probe | pending | — | full CI gate |
| S6 share, save, analytics, privacy | pending | — | visible, full CI, device checklist |

## Release checklist additions (physical devices)

- iPhone Safari / Android Chrome: file share to X keeps the text? If not, 結果をコピー recovers it.
- macOS Safari / Chrome / Edge / Firefox: clipboard write then X intent opens; paste works; popup block; login redirect.
- Low-memory phone: export succeeds with the real basemap; failure leaves text share usable.

## User requests carried to later steps

- 2026-11-23 (during S2): on the clear screen, do not show the clear turn's own log line
  (「xxターン目: 出目x（…）…」). Deferred to the next step by the user; identify the exact element from the S2
  screenshots (turn-log line / ItemEventNotice / turn result card shown over the clear screen) and remove it there,
  keeping the move history list and the completion announcement.
- S3 notes from the S2 review: fit the camera to the measured card rectangle (only ~115px map at 320x568 with the 78% sheet);
  after removing the clear-turn line, consider lowering the phone sheet cap toward 60-65% and re-run
  clear-replay-share.spec.ts (actions on first screen); new map/credit messages go through ClearAnnouncements; key route
  ownership by the same generation.
