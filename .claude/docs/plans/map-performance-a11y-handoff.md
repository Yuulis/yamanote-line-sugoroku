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
| C1 implementation | done — `5b4dcdb` `5709bcc` `4f3408d` `0552a21`; CI green | `c1-map-performance-baseline.md` § C1 implementation result |
| C3 implementation | done — `cb05a2e` (A1–A6, M1, M2) and review fixes (next commit) | `tests/e2e/accessibility.spec.ts`; local E2E 160 passed / 2 skipped |
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

C3 done on 2026-10-19: Codex Luna xhigh implemented A1–A6, M1, M2 (local E2E
145 passed); a Codex Sol-low review found four Medium issues (stale announcement
after 新規, retry button inside `inert`, phone follow padding lingering on
desktop, no re-centre on resize while stopped), fixed in one re-delegation with
regression tests (local E2E 160 passed, 2 skipped; unit 655 passed).

Known Low leftovers: RailwayMap observes `.game-panel` by class and does not
re-attach when GamePanel remounts on 新規 (viewport resize still re-centres);
audit Low items (K1 focus-visible, S1 MapLibre locale, M3–M5, S2–S4, C1, R1)
not in scope; real screen readers and devices not tested.

Then: PR feature/map-performance-a11y → develop after CI is green; release to
master only with explicit user approval.
