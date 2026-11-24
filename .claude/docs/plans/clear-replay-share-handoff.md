# Clear screen replay and X image share (#69) — Handoff

Resume from here. Plan: `clear-replay-share-plan.md` (Revision 3, Codex validated PASS round 3; Revision 4 delta approved by the user 2026-11-23 replaces old S3–S6 with new S3–S7). Step prompts:
`clear-replay-share-prompts.md`. Brief and scans: `.claude/docs/research/feature-clear-screen-replay-and-share-{brief,codebase}.md`,
`.claude/docs/research/clear-screen-replay-and-share.md`. Decisions: DESIGN.md rows dated 2026-11-22.

- Branch: `feature/clear-replay-share` (from develop 5fdd2d6, v0.18.1)
- Leaderboard split out to issue #124 (not in this PR).
- Pacing: stop after every step for user review (user 2026-11-22).
- Lanes: from S2 Claude subagents (Sonnet implements, Opus reviews; user 2026-11-23); S1 used Codex Luna xhigh + Sol low. Lead verifies (typecheck, vitest, build, verify_delegation, phone
  @layout for affected specs), commits, pushes, checks branch CI; desktop E2E is left to the implementer + branch CI.
- Full CI (PR or workflow_dispatch) is required at S5 and S6 for the 3-browser export probe and WebKit download.

## Step status

| Step | Status | Commit | Notes |
|---|---|---|---|
| S1 result model + strict route | done | e218c98 | Luna xhigh + 1 fix round after Sol low review (zero-hop transfer leg break, Mercator latitude limit, 3 tests). Lead: typecheck, vitest 2466 passed / 1 skipped (pre-existing), build, diff check, verify_delegation 0 actionable. Branch CI 44998059885 green. User review pending before S2 |
| S2 clear screen, announcements, phone layout | done | (see git log) | Sonnet implements, Opus review APPROVE (14 retargeted assertions all have equal/stronger replacements). Lead: typecheck, vitest 2492/1 skipped, build, diff check, phone @layout 24 passed/1 skipped. Deviations: phone sheet max-height 60%→78%; desktop history now below share/actions/highlights (single DOM). Screenshots .claude/logs/screenshots/issue69-s2-*.png. User review pending |
| S3 clear card cleanup + history dialog + phone sheet 65% | done | (see git log) | Sonnet implements; Opus review: 1 blocking (full-game line check unanchored) fixed by lead (toHaveText). Lead: typecheck, vitest 2513/1 skipped, build, diff check, phone @layout 35 passed/4 skipped, full-game desktop 1 passed. 320x568 slack ~11px at 65%; save-warning 320 and landscape 667x375 need scrolling to 移動履歴を見る. Screenshots issue69-s3-*.png. User review pending |
| S4 full-route layer + camera | done | (see git log) | Sonnet implements; Opus review APPROVE. Lead: typecheck, vitest 2549/1 skipped, build, diff check, phone @layout 17 passed/3 skipped. Route 56 legs on the pinned save; at 320x568 the route is ~75x99px above the sheet. Screenshots issue69-s4-*.png. Visual question to user: route hard to see among network lines |
| S4b clear map colours only the route | done | (see git log) | User 2026-11-23: other lines as legend-unchecked (basemap grey), progress/current-service overlays hidden via layout visibility in clear, route 7/11 px; getSource-before-getStyle; removed-map refit guard. Sonnet implements; lead reviewed core module. Lead: typecheck, vitest 2568/1 skipped, build, diff check, phone @layout 9 passed. Screenshots issue69-s4b-*.png |
| S5 per-turn replay, caption, speed, pause | done | (see git log) | Codex Luna xhigh + 1 fix round (speed selected state, caption arrow spacing, StrictMode-restartable store, marker hidden while playing/paused, はやい E2E). Sol re-check left history E2E independence; with user approval the lead replaced production-formatter use in tests/e2e/support/clearHistory.ts by shape/kind checks + literal golden rows (clear-replay-share.spec.ts). Lead: typecheck, vitest 2595/1 skipped, build, phone @layout 38 passed/4 skipped, desktop E2E (clear-replay-share, full-game, items, capital-region) 54 passed/5 skipped |
| S5b phone card collapses during replay | done | (see git log) | Codex Luna xhigh + 1 fix round (paused by the user mid-run, resumed 2026-11-24): no collapse while the history dialog is open; focus/scroll handoff only on phone collapse/expand; clock-paused turn-0 E2E; camera padding asserted via e2e hook (MODE===e2e only, absent from prod bundle). Sol re-check left one stale-focus case; with user approval the lead added a focusout guard + unit test (fails without the fix). Lead: typecheck, vitest 2602/1 skipped, build, phone @layout 31 + 11 passed; Luna repeat-each phone x3 33 passed, desktop x2 52 passed. Band 110px; map 320x450 / 390x726 |
| S6 PNG exporter + 3-browser probe | done — full CI green (run 45315202126 on 2b6a7dc after a Firefox-leg rerun; the first dispatch 45313064813 failed one WebKit replay e2e timing test, fixed in 2b6a7dc) | (see git log) | Codex Luna xhigh + 1 fix round (container leak on setup failure, opt-in review PNG ISSUE69_S6_SCREENSHOTS=1, stronger pixel/bytes checks). Lead: typecheck, vitest 2617/1 skipped, build, no probe identifiers in dist, diff check. Local probe: chromium + firefox passed. Gate: workflow_dispatch full CI on this SHA incl. WebKit export + download before S7. S7 note: measure phone cost of the second WebGL context; call markRouteImageDownloadStarted from the download click |
| S7 share, save, analytics, privacy | committed; full CI pending | (see git log) | Sonnet implements; Opus review APPROVE. User 2026-11-24 approved: 320-390px two-column もう一度遊ぶ/タイトルへ, text-only 共有 hidden when file share works. Lead fixes: image-failure note no longer announced (protects the completion sentence), focus moves 共有 -> Xでシェア when the image becomes ready (test fails without fix). Lead: typecheck, vitest 2665/1 skipped, build, no probe/stub identifiers in dist, phone @layout 17 passed. Open: tests/e2e/clear-replay-share.spec.ts is ~1300 lines (split later); real-device checklist below |

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
- From the S3 review (for S5): HistoryRow is string-only; add structured fields (kind, rawRoll/effectiveRoll/adjusted, effect kinds,
  toStationName, recordIndex) so captions are not parsed from strings; add a suspension-note unit test; itemHistoryText
  (presentation.ts) is now unused in production (only game-presentation.test.ts) — remove or keep deliberately; history roll
  text shows lastRollText verbatim (e.g. 出目5（5マス、13駅移動、残り5は使わず）) instead of the mock's 出目4・快速 — user asked.
  Classic truncation note reads 「途中で停止 大森で停止…」 (double 停止).
- 2026-11-23 user decision (during S4): the history dialog roll column uses the SHORT form like the captions
  (「出目4」, 「出目3→4」 for roll adjustment, 「出目4・快速」 for effects, 「回送」 for deadhead). Do it in S5 together with
  the structured HistoryRow fields shared with captions. Keep the information that the long text carried elsewhere:
  station count in the move column (e.g. 「永田町 → 半蔵門（3駅）」) and unused pips / early stop as one consistent note
  for classic and item saves (fix the double 「停止」). Port the full-game / text-wrapping / items history assertions to
  the new fields exactly (toHaveText), no weaker.
- From the S4 review (for S5): partial drawing via applyClearRouteLayers setData from an imperative store subscription (never
  re-add layers per frame); check getSource before map.getStyle() (or use getLayersOrder) to avoid per-frame style
  serialisation; after style reload re-apply the latest store snapshot; add the route===null / replay-unavailable notice
  via ClearAnnouncements; keep the caption slot out of the fit area (or include it in padding); guard applyClearRouteFit
  against a removed map. Pre-existing: the map wrapper is inert on clear, so the phone compact credit cannot be expanded.
- 2026-11-24 after S7 (PR #125 to develop): full CI fixes — WebKit replay test polls featureCount and pauses the clock
  ahead of install (2b6a7dc); the Firefox leg runs in the Playwright container (623242d) with HOME=/root (9760ca4).
  Firefox history-pause flake came from 軌跡を再生 jumping ~57px when the PNG became ready (0c1d621 waits for the row).
  User decision: keep the row stable instead — while pending, Xでシェア / 画像を保存 render disabled with a reserved
  「画像を準備中…」 note, and text-only 共有 is decided from file-share support up front (2115758, Luna xhigh;
  E2E checks the 320x568 rectangles stay within 1px). Local phone @layout passed with 2 workers. Release: v0.19.0,
  PR #126 (chore/release-0.19.0) follows #125 into develop, then develop→master with `Closes #69`.
