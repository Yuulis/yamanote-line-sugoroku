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
builder is optimized and remeasured; the Step 3.5b results below record that follow-up.

## After worker — Step 3.5b pre-review measurement

The main-thread timings in this subsection cover the synchronous calls only. The full
request-to-render gate is recorded in the review follow-up below.

Date: 2026-11-28 (JST). The optimized builder runs in a module Web Worker. The derived source is
created with canonical geometry first, then receives a JSON Blob URL through `setData` after the
worker reply. The E2E harness waits until that source update completes before collecting the load
metrics.

Command:

```bash
npm run perf:map -- --runs 5 --tiles stub --profiles desktop,mobile --browser chromium
```

Raw output: `.claude/logs/perf/2026-11-27T15-57-29-chromium-stub-gzip/summary.json` and
`summary.md` (the runner timestamp is UTC; the run completed on 2026-11-28 JST).

| Gate | Profile | After worker median | After worker max | Threshold | Result |
|---|---|---:|---:|---:|---|
| Offset main-thread work at load (`postMessage` + reply/`setData`) | Desktop | 7.3 ms | 7.6 ms | median ≤ 50 ms; max ≤ 100 ms | **PASS** |
| Offset main-thread work at load (`postMessage` + reply/`setData`) | Mobile (4× CPU) | 30.7 ms | 32.8 ms | median ≤ 50 ms; max ≤ 100 ms | **PASS** |
| Derived features | Both | 2,518 / 1,938 canonical (1.30×) | 2,518 | ≤ 3,876 | **PASS** |
| Move-frame P50, 5 runs | Desktop | 16.7 ms (base 16.7; Δ 0.0) | 16.7 ms | ≤ base + 2 ms = 18.7 ms | **PASS** |
| Move-frame P50, 5 runs | Mobile (4× CPU) | 16.7 ms (base 16.7; Δ 0.0) | 16.7 ms | ≤ base + 2 ms = 18.7 ms | **PASS** |

Worker time and the full time from the E2E map-load mark until MapLibre finishes applying the
derived source are informational; there is no threshold for either:

| Profile | Worker derivation median / max | Map load to derived source applied median / max |
|---|---:|---:|
| Desktop | 100.4 / 124.0 ms | 1,087.9 / 1,181.7 ms |
| Mobile (4× CPU) | 97.5 / 114.2 ms | 2,086.6 / 2,447.8 ms |

The main-thread metric times the synchronous geometry `postMessage` call (including its input
clone) and the worker reply handler through `GeoJSONSource.setData(blobUrl)`. Returning the
1.45 MB derived collection as an object would clone it back into the main thread. The worker now
serializes it to a JSON Blob, which is cheaply cloned, and MapLibre's own worker loads and parses
the Blob URL. This is the smallest change that keeps measured main-thread work below the gate;
reply handling including the `setData` call takes 2.5–5.2 ms on the mobile profile. The
load-to-applied figure waits for MapLibre's
`setData` promise, so it includes the separate source-worker processing time.

The geometry builder was also measured directly in Node against the pre-change function loaded
from `HEAD`, alternating 12 runs after three warm-up calls and comparing the real `jr-yamanote`
input. Median time moved from 32.0 ms to 27.4 ms (14.3% faster); max moved from 42.4 ms to
40.4 ms. `JSON.stringify` output was byte-identical, with 2,518 derived features. The initial
flat string coordinate key was slower and was discarded. The final vertex index avoids allocating
a nested latitude `Map` for 25,167 longitudes that have only one latitude; dense arrays replace
the outer edge and shared-adjacency maps; duplicate edge traversals use packed numeric lists;
slot assignment avoids per-edge `Set` allocation; coordinate fragments reuse immutable point
tuples while keeping their own fragment arrays.

The source update completes substantially later than the earlier estimate of a few hundred
milliseconds, especially under mobile throttling. The canonical source is available at map load,
and offset values are zero below z11, so this does not block initial map display. A user who reaches
z11 before the source update completes can briefly see canonical spacing; this remains the main
latency risk even though both main-thread gates and both move-frame gates pass.


## Step 3.5b review follow-up

A successful update requires a GeoJSON `content` event from the current derived source,
followed by a render with that source's tiles loaded. The canonical source first finishes
its own indexing before the first derived `setData`, so its `content` event cannot confirm
the derived update. Cache hits register the cached payload immediately and use the same
content-and-render check. A matching error or abort evicts a failed payload, restores
canonical geometry, and preserves the original error in the one warning.

Chromium CDP traces cover the renderer main thread from the offset request through the
confirmed derived frame. The harness clips top-level renderer tasks to that window and
compares each enabled run with a fresh offsets-disabled run over the same elapsed span.
This captures worker message dispatch, main-thread deserialization and MapLibre's response
processing, source and tile updates, and rendering. The gate uses the paired busy-time delta
or the measured synchronous calls as a floor. It reports signed deltas, actual thread CPU
time from CDP where available, and elapsed request-to-frame time separately. Paired subtraction
estimates incremental work, so differences in browser scheduling or software rendering can
affect the estimate.

The early-zoom scenario is a separate run. It moves the map to z13 during the first render
cycle, then timestamps the first frame containing a rendered nonzero corridor slot. The
scenario captures the canvas from render callbacks before and after the swap when both
frames are observable.

### Transfer comparison

Five fresh runs per profile and transfer, with an offsets-disabled control paired with each.
The original Blob URL run also recorded game moves. The object comparison used
`--offset-transfer object --no-interaction --no-build` on the same E2E build.

| Transfer | Profile | Paired main-thread gate, median / max | Request-to-render wall, median / max | Early z13 render |
|---|---|---:|---:|---:|
| Blob URL | Desktop | 213.8 / 638.7 ms (**FAIL**) | 1,533.5 / 1,882.5 ms | 1,556.7 ms |
| Blob URL | Mobile (4×) | 223.1 / 1,275.5 ms (**FAIL**) | 3,335.8 / 4,114.4 ms | 2,808.7 ms |
| Object | Desktop | 46.0 / 179.7 ms (**FAIL**, max) | 1,205.7 / 1,316.5 ms | 1,011.9 ms |
| Object | Mobile (4×) | 29.0 / 32.6 ms (**PASS**) | 1,753.8 / 1,932.7 ms | 967.0 ms |

Raw summaries are in `.claude/logs/perf/2026-11-28T04-37-53-chromium-stub-gzip/`
(Blob URL) and `.claude/logs/perf/2026-11-28T04-39-18-chromium-stub-gzip/` (object).
Chromium did not provide complete per-task thread CPU durations in those runs,
so their gate compares busy task durations. The mobile object run's signed
busy-time delta was −24.3 ms median, and the gate uses the synchronous floor
in that case. The negative delta exposes the variation between runs.

The production worker now returns the object. That avoids the Blob fetch,
JSON parse, and full GeoJSON return from MapLibre's own worker. The Blob
path is available in the E2E build for comparison.

### Production-default object run

The exact acceptance command above was rerun with object transfer as the default.
The final raw report is `.claude/logs/perf/2026-11-28T04-45-07-chromium-stub-gzip/summary.md`.
The original baseline move-frame P50 was 16.7 ms on each profile.

| Metric | Desktop | Mobile (4× CPU) |
|---|---:|---:|
| Attributable busy time, median / max | **57.8 / 128.1 ms (FAIL)** | **33.1 / 2,262.5 ms (FAIL, max)** |
| Signed renderer thread-CPU delta, median / max | 113.7 / 181.9 ms (4 valid pairs) | 12.2 / 545.1 ms (5 valid pairs) |
| Request-to-render wall time, median / max | 1,027.4 / 1,195.3 ms | 1,890.1 / 5,078.5 ms |
| Map publish to derived render, median / max | 1,019.8 / 1,186.8 ms | 1,855.0 / 5,006.9 ms |
| Worker derivation, median / max | 83.9 / 93.9 ms | 95.7 / 167.5 ms |
| First map render to first nonzero slot at z13 | 852.3 ms | 1,305.0 ms |
| Derived feature count | 2,518 (**PASS**) | 2,518 (**PASS**) |
| Median move-frame P50 | 16.7 ms (**PASS**) | 16.7 ms (**PASS**) |

The renderer CPU column uses paired thread-clock readings, interpolating at the timing
boundaries when a trace omits individual task durations. The gate uses occupied task
durations, including stalls. Mobile run 2 had a 5,078.5 ms request-to-render interval and
a 2,262.5 ms busy-time delta. Its signed thread-CPU delta was −193.9 ms, so this peak is
sensitive to scheduling and the choice of paired control. It remains in the gate maximum.

Selected desktop images are `.claude/logs/screenshots/issue72-s35b-early-z13.png` and
`issue72-s35b-early-z13-after.png`. On the selected mobile run, the first frame with
visible tracks at the target zoom already contained offsets, so the capture produced
`issue72-s35b-early-z13-mobile-after.png`. The earlier Blob comparison captured both
states. Its images are preserved with the `-blob` suffix, including
`issue72-s35b-early-z13-mobile-blob.png` and `issue72-s35b-early-z13-mobile-blob-after.png`.

## Decision (user, 2026-11-28)

The user accepted the current implementation even though the complete main-thread measurement
fails the original derivation gate. The additional main-thread work after load is a median of
57.8 ms on desktop (max 128.1 ms) and a median of 33.1 ms on mobile. The mobile max of 2.26 s is
one noisy paired run, in which the thread-CPU difference was negative.

The cost happens once after load. Most of it is MapLibre processing the second (derived) GeoJSON
source. The interactive move-frame P50 is unchanged (16.7 ms on desktop and mobile), the derived
count passes, and the derived lines render 0.85 s (desktop) and 1.3 s (mobile) after the first
map paint at z13.

For this feature the gate is therefore read as:
- no regression in interactive frame time;
- a bounded, one-off load cost.

The alternative of restricting the derived source to shared fragments only, which would reduce
the MapLibre cost but add layers, was declined for now.
