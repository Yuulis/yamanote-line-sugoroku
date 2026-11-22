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
| S1 result model + strict route | done | (this commit) | Luna xhigh + 1 fix round after Sol low review (zero-hop transfer leg break, Mercator latitude limit, 3 tests). Lead: typecheck, vitest 2466 passed / 1 skipped (pre-existing), build, diff check, verify_delegation 0 actionable |
| S2 next | — | — | prompt to be added to clear-replay-share-prompts.md |
| S2 clear screen, announcements, phone layout | pending | — | visible |
| S3 full-route layer + camera | pending | — | visible |
| S4 replay store + partial drawing | pending | — | visible |
| S5 PNG exporter + 3-browser probe | pending | — | full CI gate |
| S6 share, save, analytics, privacy | pending | — | visible, full CI, device checklist |

## Release checklist additions (physical devices)

- iPhone Safari / Android Chrome: file share to X keeps the text? If not, 結果をコピー recovers it.
- macOS Safari / Chrome / Edge / Firefox: clipboard write then X intent opens; paste works; popup block; login redirect.
- Low-memory phone: export succeeds with the real basemap; failure leaves text share usable.
