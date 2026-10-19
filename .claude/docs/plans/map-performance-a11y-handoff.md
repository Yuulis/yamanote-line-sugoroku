# Map performance (C1) and accessibility (C3) — handoff

Roadmap items C1 and C3 from `docs/manual/development-roadmap/proposal.md`.
Branch `feature/map-performance-a11y` from `develop` (9bbda41). Prompts:
`map-performance-a11y-prompts.md`.

## User decisions (2026-10-19)

- C1 scope: the five small items (style.load, label split, preload/preconnect,
  railway-base restriction, React re-render reduction). Not now: self-hosted
  glyphs, MapLibre lazy-load / worker dedupe.
- Basemap: keep OpenFreeMap Liberty unchanged for now; revisit after re-measuring.
- C3 scope: all eight Medium findings (A1–A6, M1, M2), implemented by Codex
  (Luna xhigh with `service_tier=fast`; fast mode requires Luna xhigh or above).
- Order: C1, then C3 (overlapping files).

## Status

| Step | State | Evidence |
|------|-------|----------|
| Investigation | done — `cba1367` | `.claude/docs/research/c1-map-performance-baseline.md`, `c3-accessibility-audit.md`; `npm run perf:map` |
| C1 implementation | code complete, paused before final verification (see below) | WIP commit on this branch |
| C3 implementation | not started | — |
| PR to develop, CI | not started (branch pushed for CI only) | — |

## C1 paused state (2026-10-19 19:10)

The user asked to pause. The implementing subagent was stopped while it ran an
extra A/B perf loop; it never wrote its own status section, so this is the
lead's record.

- Implemented in the diff (all five items): railway layers on `style.load` with a
  re-add guard for style reloads (`RailwayMap.tsx`, new E2E in
  `map-failure.spec.ts`); key/ordinary station-label layers at z11/z13
  (`railwayLayers.ts`); preload/preconnect in `index.html`; `railway-base`
  limited to the target service (`lineVisibility.ts`, `railwayLayers.ts`);
  per-frame React re-render reduction via `animation/livePosition.ts`,
  `useMoveAnimation.ts`, memoized `GamePanel`/`GameLegend`/`GameApp`.
- Verified by the lead on the paused tree: `npm run typecheck` pass;
  `npm test` 653 passed / 1 skipped; `npm run build` pass (chunk warning
  unchanged). Test diffs reviewed: removed assertions were replaced by
  equivalent ones for the split label layers and target-scoped base filter.
- E2E: the subagent's last local Playwright run (18:36, map-visual-real and
  real-data specs, 3 projects) passed. The full `npm run test:e2e` was NOT run
  locally on the final tree; rely on branch CI, then run it locally on resume.
- Perf A/B (interleaved HEAD vs change, stub tiles, 2 runs × 2–3 rounds, host
  was loaded so absolute numbers are higher than the baseline table):
  desktop map idle ~3.6 s → ~2.6 s, load ~1.1 s → ~0.8 s, TBT ~1.9 s → ~1.3 s;
  mobile idle ~8.6 s → ~7.7 s, TBT ~5.8 s → ~5.0 s. Live-tile A/B (where the
  `style.load` gain shows) did not finish. Raw: `.claude/logs/perf/` runs from
  2026-10-19T09-5x/10-0x and `c1-after-*.log`.

## Next step

1. Check branch CI; run `env -u WAYLAND_DISPLAY npm run test:e2e` locally.
2. Finish the live-tile A/B (`npm run perf:map -- --tiles live`, compare with
   the baseline) and record before/after in
   `.claude/docs/research/c1-map-performance-baseline.md`.
3. Codex review of the C1 diff (Sol low, read-only), then launch C3 with the
   command in the prompts file.

## Baseline (Chromium, software GL, gzip-served, median of 5)

| Metric | desktop stub | mobile stub | desktop live | mobile live |
|--------|--------------|-------------|--------------|-------------|
| map load (railway layers added) | 519 ms | 2674 ms | 2279 ms | 5400 ms |
| map idle | 1913 ms | 5027 ms | 4749 ms | 8486 ms |
| TBT to idle | 669 ms | 2441 ms | 2604 ms | 4717 ms |

