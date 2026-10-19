# C3 desktop-webkit failure: Korakuen transfer E2E (CI run 39257690925)

## Symptom

`tests/e2e/tokyo-suburban.spec.ts:36` failed on desktop-webkit only (Chromium,
Pixel Chromium and Firefox passed). At line 75 the second
`jumpToRenderedStation(odakyu-shin-yurigaoka)` polled
`queryRenderedFeatures` for the station circle for 7 s without success. The
test passed on 0552a21, before the C3 commits cb05a2e / 740f1a0.

## Trace evidence (attempt 1; retry1 shows the same pattern)

Monotonic trace times (ms):

| t | Event |
|---|-------|
| 634202 | second dice click (follow ON, speed "省略") — the panel's lottery text shrinks from 4 lines (Korakuen candidates) to 2 (Ikebukuro) |
| 634770 | roll finished, dice visible |
| 634792 → 634801 | test `map.jumpTo({ center: Shin-Yurigaoka, zoom: 15 })` |
| 634829, 634979 | poll → false |
| 634922 | frame: empty map (Shin-Yurigaoka area, zoom 15) |
| 635312 – 635782 | frames: camera centred on the **Ikebukuro marker at zoom 15** (marker at the frame centre) |
| … 640920 | polls keep returning false; no further frames (map idle) |

So after the programmatic jumpTo, the follow camera re-centred on the marker
while keeping zoom 15. The station never rendered because the camera was no
longer there.

## Root cause

740f1a0 added a `ResizeObserver` (map container, `.game-panel`,
`.game-panel__route-summary`) plus a window `resize` listener in
`src/features/map/RailwayMap.tsx`. Every observation bumped
`cameraLayoutRevision` on the next animation frame. The follow-camera effect
listed that revision as a dependency and called
`recentre(..., force = layoutChanged)`.

After the second roll the desktop panel shrank. On the slow CI WebKit
(software GL, frames hundreds of ms apart) the rAF → setState → passive-effect
chain landed after the test's jumpTo. A programmatic jumpTo carries no
`originalEvent`, so `userMovedRef` stayed false and the effect pulled the
camera back to the marker. Even without `force`, any re-run of that effect
recentres, because the camera is now far from the marker (`needsRecentre`).

On desktop the follow padding is always zero, so a panel size change never
changes the camera layout: the revision bump was spurious. Chromium and
Firefox finish the chain before the test's next round trip, so they only
passed by timing.

## Fix (`src/features/map/RailwayMap.tsx`)

- `cameraLayoutKey(map)`: container `clientWidth`×`clientHeight` plus the
  applied bottom padding (`usesBottomPanelCameraPadding() ?
  phonePanelBottomPadding(map) : 0`). The padding value is exact, not rounded,
  so it matches what `recentre` applies.
- `appliedCameraLayoutRef`: the key of the last layout a follow move applied.
  It is reset to `null` whenever the observer is set up (map or follow
  change), so the initial observation still applies the layout once, as
  before.
- `recentre` returns whether it moved the camera. The position/follow effect
  no longer depends on `cameraLayoutRevision`; when it moves the camera, it
  records the applied key.
- The rAF callback bumps the revision only when the key differs from the
  applied one.
- A separate layout effect handles only new revisions. It re-checks the key
  when it runs, because a revision queued before a follow move applied the
  same layout is stale by then. It force-recentres only on a real change.

Phone and compact-landscape behaviour is unchanged. Rotation changes the
container size, phone→desktop changes both size and padding, and opening the
route summary on phone changes the padding, so each still produces a new key
and a forced recentre.

## Regression test

The new test in `tests/e2e/accessibility.spec.ts` is "a desktop panel resize
leaves a camera moved off the marker where it is". At 1280×800 it settles the
follow camera, jumps 0.05° away programmatically, opens the route-summary
`<details>`, waits 10 animation frames (frame-based, not time-based) and
asserts the centre is unchanged.

- Against HEAD's RailwayMap.tsx it failed 6/6 (desktop-chromium,
  phone-chromium, desktop-firefox × 2): the centre snapped back by exactly
  0.05°. This reproduces the CI mechanism deterministically, without WebKit
  timing.
- With the fix it passed 9/9.

## Residual risk

- WebKit could not run locally because system libraries are missing. The fix
  removes the trigger, a desktop panel resize, rather than tuning timing, so
  it does not depend on WebKit's frame rate. CI still has to confirm it.
- Genuine layout changes while following (rotation, a phone panel resize)
  still recentre after a programmatic jumpTo. That is intended, but a future
  test that jumps the camera on phone and then changes the panel would hit the
  same behaviour.
- `cameraLayoutKey` is computed after each follow move during an animation
  (`clientWidth`/`clientHeight` plus, on phone, two `getBoundingClientRect`
  calls that `recentre` already triggers). This is a negligible extra layout
  read, because layout is already flushed at that point.
