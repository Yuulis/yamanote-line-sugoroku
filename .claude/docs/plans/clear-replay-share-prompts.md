# Clear screen replay and X image share (#69) — Step prompts

Shared preamble for every implementation step (prepend to each step prompt):

```
You are implementing one step of an approved plan in /home/yuulis/yamanote-line-sugoroku (branch feature/clear-replay-share).
Read first: .claude/docs/plans/clear-replay-share-plan.md (the "Revision 3 changes" and "Revision 2 changes" sections,
"Assumptions for user confirmation" (all approved by the user 2026-11-22), the Architecture / Interface / Data Flow /
Error Handling sections, and your step section), .claude/docs/research/feature-clear-screen-replay-and-share-brief.md,
.claude/docs/research/feature-clear-screen-replay-and-share-codebase.md, and .claude/rules/{coding-principles,testing}.md.
Rules:
- Implement ONLY the named step. Do not start later steps. Do not commit, push or touch git history.
- Presentation only: do not change src/features/game/engine/, RNG, save format, src/types/network.ts, public/data/, data/,
  package.json / lockfile. Do not modify src/features/game/animation/movePath.ts (Revision 3).
- Do not delete, skip or weaken tests. When an existing assertion must change because of a planned UI change, keep the
  same behaviour checked (e.g. open the history <details> through the UI, then assert exactly what was asserted before).
- No placeholders, TODOs, swallowed errors or hard-coded shortcuts.
- Keep new files within ~200-400 lines; edits to GameApp.tsx and RailwayMap.tsx are wiring only.
- Memory is limited: Vitest `--maxWorkers=2`, Playwright `--workers=2` at most, only the listed specs; never the full E2E suite.
- Run the step's acceptance commands yourself and report the exact results (counts).
Output format:
## Changes Made (file: summary)
## Tests (added / updated, with names)
## Validation Results (each command + result)
## Deviations from the plan (with reason)
## Remaining Risks
```

## S1 — saved result model and strict route

```
Implement plan "S1 — 保存結果モデルと厳密な経路" exactly (visible: no; nothing is wired into the UI in this step).
Create src/features/game/clearResult.ts and src/features/game/clearRoute.ts with the interfaces in the plan's
"Interface Design / 結果と経路" section, and tests/unit/clear-result.test.ts and tests/unit/clear-route.test.ts written first.
Key contracts:
- Records: MoveRecord uses serviceId/direction; item-ride uses resolvedRide; deadhead is narrowed FIRST and never reads
  resolvedRide. Validate every saved hop with nextStationId/findSegment against traversedSegmentIds and the arrival station.
- Geometry: use the directed segment's geometryFeatureIds in stored order (never reverse), orient features with the existing
  rules, call stepPath with its existing signature. Any missing feature, gap, non-finite coordinate or zero-length path makes
  route = null while topology-based highlights stay identical.
- Highlights exactly as the plan's "保存履歴とハイライト" §3-§6 (longest ride across turns by lineGroupId; most-used excludes
  the target service's line group and is null when empty; farthest = great-circle from config.startStationId over saved
  segment endpoints, deadhead destinations and the start, compared unrounded, no geometry joints; items used = consumed +
  certificates deduplicated by instance id; avoided = certificate cancellations per event; roll adjustment counted once
  via its consumed event).
- summary and shareText come from the existing summarizeGame / buildShareText; assert the full share text byte-for-byte
  for a classic and an item save.
Include every test case listed under S1 "tests first", plus forward and reverse directed records with at least two
features each (Revision 3).
Acceptance: npm run typecheck; git diff --check; npx vitest run --maxWorkers=2; npm run build.
```
