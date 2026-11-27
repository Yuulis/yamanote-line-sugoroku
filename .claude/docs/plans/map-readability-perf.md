# Step 3.5 measurement gate

Date: 2026-11-27. PR3 base: `967760b`. Head commit: `e003ba6` plus the local Step 3.5 harness and E2E-hook changes.

## Method

The base was measured in a detached `git worktree` at `967760b`. I copied the extended
`scripts/perf/measure-map.mjs` into that checkout and symlinked its `node_modules` to the main
checkout so it could build and run without changing dependencies. The base E2E hook has no
corridor derivation fields, so the extended harness records those values as `n/a`. Its raw log
directory was copied into this checkout before the worktree was removed. The head run used the
working tree at `e003ba6` with the Step 3.5 changes.

Both runs used:

```bash
npm run perf:map -- --runs 5 --tiles stub --profiles desktop,mobile --browser chromium
```

The harness dismisses the first-play coach before the three seeded dice moves because that
intentional modal blocks their input. Mobile uses the existing 4x CPU throttle. The derivation
timer wraps the synchronous memo builder and is present only in the E2E build.

## Results

| Gate | Profile | Base | Head | Threshold | Result |
|---|---|---:|---:|---:|---|
| Derived features | Both | n/a | 2,518 / 1,938 canonical (1.30x) | ≤ 3,876 and ≤ 2x canonical | **PASS** |
| Cold derivation median | Desktop | n/a | 53.1 ms | ≤ 50 ms | **FAIL** |
| Cold derivation max | Desktop | n/a | 58.1 ms | ≤ 100 ms | **PASS** |
| Cold derivation median | Mobile (4x CPU) | n/a | 129 ms | ≤ 50 ms | **FAIL** |
| Cold derivation max | Mobile (4x CPU) | n/a | 216 ms | ≤ 100 ms | **FAIL** |
| Move-frame P50 median, 5 runs | Desktop | 16.7 ms | 16.7 ms (+0.0 ms) | ≤ 18.7 ms | **PASS** |
| Move-frame P50 median, 5 runs | Mobile (4x CPU) | 16.7 ms | 16.7 ms (+0.0 ms) | ≤ 18.7 ms | **PASS** |

The feature-count gate passes, and the measured move-frame P50 does not regress. The cold
derivation gate fails on the desktop median and on both mobile checks.

## CPU profile and proposed fix

I ran `npm run perf:map -- --runs 1 --tiles stub --profiles desktop,mobile --browser chromium --cpu-profile`.
The load-phase profile attributed 36.6 ms of desktop self time and 170.7 ms of mobile self time
to `corridorOffsets.ts`. Mapped samples identify these main contributors:

| Function | Desktop | Mobile |
|---|---:|---:|
| `createVertexIndex().idFor` | 9.0 ms | 38.0 ms |
| `indexEdges` | 9.0 ms | 27.1 ms |
| `assignSharedEdges` | 1.9 ms | 25.2 ms |
| `copyFragmentCoordinates` | 4.9 ms | 12.6 ms |

Proposed fix: reduce repeated vertex-map lookups and per-edge object/array allocation in
`idFor`/`indexEdges`, then reduce the shared-edge traversal's temporary sorting and slot-map
allocations. Preserve deterministic orientation, slot assignment, and fragment boundaries, and
rerun the unit coverage and this same gate. No fix is included here.

## Raw summaries

- Base: `.claude/logs/perf/2026-11-27T14-36-21-chromium-stub-gzip/summary.json` and `summary.md`.
- Head: `.claude/logs/perf/2026-11-27T14-41-12-chromium-stub-gzip/summary.json` and `summary.md`.
- CPU profile: `.claude/logs/perf/2026-11-27T14-42-35-chromium-stub-gzip/summary.json`, `summary.md`, and the `desktop-load.cpuprofile` / `mobile-load.cpuprofile` files.

## Risks

The absolute timings are specific to this host and Chromium's SwiftShader renderer. Stub tiles
isolate app cost but do not measure network or realistic basemap rendering. The mobile results
include the configured 4x CPU throttle. The derivation gate remains a merge blocker until the
builder is optimized and remeasured.
