# Issue #62 map guidance and direction — plan

Status: Codex validated PASS after one revision (Step 5 adds `tests/unit/map-station-markers.test.ts`, validation `.claude/logs/codex/20261110T093337Z-map-guidance-validate.md`); awaiting user approval. Branch: `feature/map-guidance` from `origin/develop` 33ff82c. Brief: `.claude/docs/research/feature-map-guidance-and-direction-brief.md`. Pacing: stop after every step. Implementer: Codex Luna xhigh; Sol low review; lead verifies.

## Scope Assessment

**COMPLEX is correct. The 700–1,100 LOC target remains feasible; the 20–25-file estimate is too low when generated saves, documentation, and existing map test doubles are included.** Plan for approximately **40–47 touched paths**, including about seven regenerated data/fixture files. Many changes are small plumbing, assertions, or documentation updates.

A lean implementation is approximately **785–1,100 handwritten changed LOC, including tests**, divided into the 12 independently reviewable units below. Generated data and saves are excluded from that total. No unit may exceed 150 handwritten changed LOC; split an oversized unit before executing it.

Source verification confirmed the major integration points and identified these corrections or qualifications:

- The current product contains **135 services: 133 non-circular and two circular**. The scan’s “125 non-circular” count is incorrect. Independently checking service-specific endpoint names finds exactly the stated **10 label mismatches**.
- `tests/data_pipeline/conftest.py` deliberately resolves `published_dataset` and `committed_overrides` to the frozen capital-region archive. New label tests must use `installed_product_dataset` and `installed_product_overrides`.
- `turnDisplay.progress` follows completed hops during movement. A newly reached 30/30 therefore needs an explicit arrival-publication condition.
- Before lottery publication, the displayed incoming ride can point out of an endpoint. Heading derivation must handle `nextStationId()` returning `undefined`.
- `GameApp` currently blocks toast acceptance until `reveal.ready`. An arrival-time milestone requires removing that second publication gate while retaining the publication rules inside `deriveTurnMomentDisplay()`.
- Several unit test doubles call `addRailwayLayers()` with only `addSource`/`addLayer`. Runtime images require small updates to those doubles.

Binding scope remains:

- One PR; pause after every implementation unit.
- Correct live overrides and rebuild generated data.
- Add the validator rule without changing the frozen baseline.
- Accept old-save rejection through the existing data-version path; regenerate current pinned saves.
- Leave `product_suburban verify` and frozen staging inputs unchanged; document their supersession.
- No engine changes, RNG changes, save migration, save allow-list, schema/SAVE_VERSION changes, `src/types/network.ts` changes, dependencies, or version bump.
- No #71 general HUD redesign or #72 line-code badge.

This was a read-only assessment. No files were edited and no builds or test suites were executed. Command definitions, project names, referenced test paths, pipeline entry points, fixture regeneration instructions, and local input availability were checked.

## Decisions

| Topic | Decision | Rationale | Rejected alternatives |
|---|---|---|---|
| Phone roll-adjust layout | At ≤600px, use a bottom strip with three segmented choice controls, followed by the existing Continue/Skip actions. Place it over the bottom HUD area, rather than above the HUD. Keep the three choices as native radios styled as compact controls. | Preserves deliberate selection followed by confirmation, the existing Skip contract, and most existing E2E helpers. Overlapping the already occupied HUD area preserves more map space. | Three immediate-submit buttons: these change selection/Skip behavior and require unnecessary test churn. A centered dialog obscures candidates. |
| Desktop layout | Use a compact bottom-right sheet, clear of the left HUD. Fit candidates into the remaining map rectangle. | Keeps the same interaction model across devices and leaves the central map visible. | Centered modal; a second permanent sidebar. |
| Modality | Retain `showModal()`. Override **only this dialog’s** backdrop to transparent. Map callouts are visual, non-interactive annotations. | The adjustment is a mandatory decision. Native modality preserves focus containment, background-control isolation, and current cancellation behavior. Viewing the map does not require interacting with it. | Non-modal dialog requires additional background-action guards and focus handling. Tapping callouts is optional and is excluded from this implementation. |
| Accessibility | Focus the existing dialog heading on entry; retain native radio keyboard behavior, Continue, Skip, Escape → unchanged roll, and focus return to the dice. Each radio’s accessible name includes delta, resulting pips, and the full landing-station name. | The map must remain supplemental, including when WebGL fails. | Making inert map callouts the only place containing landing names; adding another live region. |
| “Next segment” | Emphasize **all pending target segments**. Do not select a single next segment. | Off-target routing and non-contiguous completion make “next” ambiguous. All-pending emphasis satisfies the brief without inventing route advice. | Forward-first pending segment; BFS entry followed by forward-first pending segment. |
| Pending colour | Use **magenta `#c040cf`**, width 4, with a white dashed casing of width 8. Preserve the existing dash/gap pattern on the core. | It differs strongly from completed Yamanote green. Measured contrast is about 4.02:1 against cream `#faf7ef`, 3.79:1 against the stub’s pale background, and 3.06:1 against dark ink `#263238`. The casing and dashed shape distinguish it from similarly coloured services. | Grey; colour alone; a new theme system. A single hue cannot be guaranteed distinct from every service colour. |
| Marker | Keep the existing current-position circle and source. Add a runtime SDF beak in a separate symbol layer, rotated by a bearing property. | Preserves existing marker hit-testing and avoids sprite/glyph downloads. The circle remains a stable attachment point for a future #72 badge. | Replacing the circle; glyph arrows; a DOM player marker; per-frame heading derived from coordinate deltas. |
| Heading semantics | Use current station → next station on the reveal-gated displayed ride. At an incoming endpoint before publication, use previous station → current station. Return no heading for unavailable/degenerate coordinates. | HUD direction and heading share the same ride and publication boundary, including transfers and reversals. | Reading the committed next ride early; falsely displaying north when no bearing exists. |
| Classic fixture | Preserve historical fixture bytes and SHA. Against the live network, assert `DATA_VERSION_MISMATCH`. In a clearly identified **test-only historical-version network view**, retain the original `CONFIG_MISMATCH`, seeded classic restore to turn 41, and storage-preservation assertions. | The correction changes labels only. A test-only copy of the network with the fixture’s historical dataVersion preserves the earlier compatibility checks without changing production restore behavior or fixture bytes. | Rewriting the immutable save; replacing its rules assertions with only a data-version assertion; production compatibility exceptions. |
| 30/30 guidance | Replace the bar cells in their existing slot with `新橋に着けばクリア`, using the configured goal’s resolved name. Preserve the numeric 30/30 value and row dimensions. Highlight the goal station after completion becomes public. | Fits the existing progress row and retains #70’s fixed HUD budget. | Adding another HUD row; increasing panel height; deriving clear status from station equality. |
| Toast identity | Use `${sessionId}:milestone:target-segments:30`, with the **first completion turn** as its queue turn and `eventIndex: -1`. Emit it at arrival publication, before that turn’s later item-event toasts. | Existing item indexes start at zero, so the milestone cannot suppress later pickup/discard events. A stable first-completion turn prevents repeated emission on later turns. | A large positive event index at arrival, which would make later item events look old; current-turn keys; persisted milestone flags. |
| Step order | Data and fixtures first; shared presentation model next; map/HUD/toasts next; roll preview model → dialog → callouts → camera; integration and documentation last. | Separates data incompatibility from presentation work and gives each visible feature a stable model before browser integration. | One large UI patch; camera changes before candidate and dialog geometry exist. |

For #65, reserve negative event-index slots for milestone notifications before ordinary item events; 30 uses `-1`. This PR implements only the 30 threshold.

## Architecture

### Publication and data flow

```text
live overrides → pipeline build → public data/dataVersion → existing restore rejection

displayedProgress + displayed ride + publication phase
                    ↓
         deriveTurnMomentDisplay()
                    ↓
       guidance / heading / milestone
           ↙                    ↘
       GameHud              GameApp → MapProgress
                                  → RailwayMap layers

visible adjust decision + settled origin + raw roll
                    ↓
       assertSettledPosition() + advance()
                    ↓
       turnDisplay.adjustmentLandings
           ↙                    ↘
    RollAdjustment          map speech bubbles
                                  ↓
                        measured camera fitting
```

Raw game state is available only inside the presentation derivation where needed to construct the pure preview position or inspect accepted history. Consumers render the resulting `turnDisplay` fields.

**Completion publication:** retain guidance once it has become public, including during subsequent moves. Suppress only a *new* crossing to 30/30 during pre-move/moving phases. Do not temporarily remove already-public guidance every time another move starts.

HUD guidance, goal highlighting, and the milestone become eligible at arrival. Item-event toasts retain their later existing publication boundary. For a turn that clears immediately, the clear presentation takes precedence over a “return remains” notification.

### Presentation helpers and types

Add a small `src/features/game/mapGuidance.ts` module. Suggested interfaces:

```ts
type DisplayRide = Readonly<{
  serviceId: string;
  direction: Direction;
}>;

interface GoalGuidance {
  stationId: string;
  stationName: string;
  text: string;
}

interface AdjustmentLanding {
  delta: -1 | 0 | 1;
  pips: number;
  stationId: string;
  stationName: string;
  position: Position;
  travelledSteps: number;
  stopReason: "roll" | "endpoint" | "goal";
}

function displayedHeading(
  progress: Pick<DisplayedProgress, "stationId">,
  ride: DisplayRide,
  network: RailwayNetwork,
): number | null;

function firstTargetCompletionTurn(
  records: readonly Readonly<{
    turn: number;
    traversedSegmentIds: readonly string[];
  }>[],
  requiredIds: readonly string[],
): number | null;

function adjustmentLandings(
  position: GamePosition,
  rawRoll: number,
  allowedDeltas: readonly (-1 | 1)[],
  network: RailwayNetwork,
  presentation: PresentationResolver,
): readonly AdjustmentLanding[];
```

Implementation details:

- Import `advance`, `assertSettledPosition`, and `GamePosition` from the existing movement module; **do not edit or re-export engine code**.
- Preview choices are `[-1, 0, +1]` intersected with legal adjustments, always including zero.
- Build the preview position using the visible decision’s `resolvedRide`.
- Call `assertSettledPosition()` once, then `advance(position, pips, network)` per choice.
- Use the service platform at the resulting station.
- Show resulting pips and the landing station. If movement truncates, include the actual travelled steps in explanatory text, rather than claiming all rolled pips were travelled.
- Do not draw landing lotteries or consume either RNG stream.
- For first completion, include the accepted pending-discard record when it is not yet in completed history. Count directed target segment IDs, not geometry feature IDs.

Extend `TurnMomentDisplay` with:

```ts
markerBearing: number | null;
goalGuidance: GoalGuidance | null;
adjustmentLandings: readonly AdjustmentLanding[];
```

Derive candidates only when `visibleDecision()` returns an adjustment. This also supports restored pending rolls without changing `ItemSessionView` or its numerous existing decision fixtures.

### HUD and toast integration

- `GamePanel` passes `goalGuidance` to `GameHud` and candidate landings to `RollAdjustment`.
- `GameHud` conditionally replaces `TargetProgressBar` with a text element using the same `.target-progress` slot.
- Preserve desktop’s 24px row and phone’s 18px progress row, the phone `18/34/34/18px` grid, and the 252px panel target.
- Guidance has full accessible text/title; use `PhraseText` for visible text.
- Do not create a new `role=status`. Add the one-time guidance sentence to the existing announcement path when it first becomes public.
- Add a small milestone-toast factory to `toastQueue.ts`; keep the existing queue reducer and item-toast keys.
- `deriveTurnMomentDisplay()` supplies the milestone before item toasts.
- Remove `GameApp`’s blanket `reveal.ready/reveal.key` toast gate. Trust the already gated `turnDisplay.toastInputs`.
- Retain session-entry baseline suppression. Ensure an already-completed restored history contributes its milestone key to that baseline, including restored pending decisions.
- The original completion turn and index `-1` let the existing queue cursor reject duplicate delivery, including after expiration.

### Map layers and lifecycle

Keep the existing sources. Add these IDs:

| ID | Type | Purpose |
|---|---|---|
| `railway-segments-pending-casing` | line | White dashed casing beneath pending core |
| `railway-goal-station` | circle | Static goal ring filtered by station `id` |
| `game-current-position-heading` | symbol | Rotated SDF beak |
| `game-current-position-heading-sdf` | runtime image | North-facing beak distance field |

The resulting stack has **14 layers**:

```text
base → services → current-service
→ pending-casing → pending → completed → flash
→ ordinary station circles → key station circles → goal ring
→ ordinary labels → key labels
→ current-position circle → heading symbol
```

Changes to existing functions:

```ts
currentPositionCollection(
  position: Position | null,
  bearing?: number | null,
): CurrentPositionCollection;

updateCurrentPosition(
  map: MapLibreMap,
  position: Position | null,
  bearing?: number | null,
): void;

updateGoalStation(
  map: MapLibreMap,
  stationId: string | null,
): void;
```

- Omit the bearing property when unavailable; filter the symbol accordingly.
- Use `icon-rotate: ["get", "bearing"]`, map rotation alignment, overlap allowed, and a halo.
- Generate an actual signed-distance image as `{ width, height, data }`; avoid DOM canvas/ImageData requirements in Node tests.
- Register the image inside `addRailwayLayers()`, guarded by `hasImage()`.
- A full `style.load` recreates the image and layers. Existing `layersRevision` effects reapply bearing, completion filters, and goal filter.
- Apply the casing’s pending filter whenever the existing pending filter changes.
- Dash lengths are expressed in line widths: scale the casing dash array by `coreWidth / casingWidth` so its gaps align with the core. Use butt caps to retain visible gaps.
- Leave the completed and flash filter shapes unchanged.
- Keep per-frame writes limited to current-position source data. No per-frame history scans, filter updates, or camera fitting.

Extend E2E `readMap()` with `markerBearing` and `headingRendered`. Keep its existing circle-based `markerRendered` check. Verify both actual symbol rendering and source bearing; neither substitutes for the other.

### Callouts and camera

Use a small `src/features/map/rollAdjustmentPreview.ts` module with MapLibre DOM markers. These are annotation markers, separate from the player marker.

```ts
function mountAdjustmentCallouts(
  map: MapLibreMap,
  candidates: readonly AdjustmentLanding[],
): () => void;
```

- Construct text with DOM APIs/textContent, never interpolated HTML.
- Use speech-bubble styling, `pointer-events: none`, and `aria-hidden="true"`.
- Group choices that land at the same station into one anchored bubble containing separate delta/pip rows.
- Handle nearby distinct stations with deterministic vertical lanes and short leaders when measured bubbles overlap. There are at most three candidates; no general collision engine is needed.
- Remove markers/listeners on decision changes, resolution, session replacement, map replacement, and unmount. DOM markers survive a style replacement; do not duplicate them.

Add camera geometry helpers in `camera.ts`, with browser orchestration in `RailwayMap.tsx`.

- Fit current position plus all candidate landing positions.
- Measure map bounds, HUD, adjustment sheet, controls, and bubble extents.
- Phone: fit above the higher obstruction formed by HUD/sheet.
- Desktop: fit right of the HUD and above the bottom-right sheet.
- Include bubble extents and leader lanes in padding, not just anchor points.
- Observe the map, panel, and adjustment sheet; refit on relevant resize/orientation changes.
- During preview, suspend ordinary follow-camera effects so they cannot overwrite the fitted bounds.
- Fit with zero duration. This avoids a mandatory decision moving beneath the player and naturally respects reduced motion.
- Clear retained MapLibre padding after fitting. Resume normal following only when enabled; do not change the saved follow preference.
- A failed map leaves the fully named textual choices usable.

## Implementation Plan

All steps use **Codex Luna xhigh**, followed by **Sol low review and independent lead verification**. Stop after each numbered step. Do not automatically continue to the next step.

Each handoff specifies its base SHA, exact allowed paths, forbidden areas, commands, and expected behavior. New E2E titles below are implementation contracts, not claims that those tests already exist.

| Step | Unit | Depends on | Estimated LOC |
|---|---|---|---:|
| 1 | Live direction labels and validator | — | 90–120 |
| 2 | Regenerate saves and preserve historical compatibility tests | 1 | 40–55 |
| 3 | Shared heading and completion presentation model | 2 | 65–90 |
| 4 | Pending styling and heading rendering | 3 | 100–135 |
| 5 | Fixed-height HUD guidance and goal highlight | 3–4 | 75–100 |
| 6 | Arrival milestone and replay suppression | 5 | 85–115 |
| 7 | Deterministic adjustment landing model | 3 | 50–75 |
| 8 | Compact modal strip and named choices | 7 | 65–90 |
| 9 | Map speech-bubble annotations | 7–8 | 65–100 |
| 10 | Preview camera fitting and lifecycle | 8–9 | 85–115 |
| 11 | Focused browser integration | 4–10 | 40–60 |
| 12 | Documentation and final acceptance | All | 25–45 |
| **Total** | Excluding generated data/fixtures | | **785–1,100** |

Global forbidden areas apply to every unit: engine source edits, RNG, save/persistence behavior, `src/types/network.ts`, dependencies/lockfiles, version numbers, frozen data/staging, and `product_suburban verify`. Exceptions below allow only the specified data/validator changes.

### Step 1 — Correct labels and enforce the live-product rule

**Files:** `data/overrides/services.json`, `scripts/data_pipeline/validate.py`, `tests/data_pipeline/test_validate.py`; generated `public/data/services.json` and `public/data/manifest.json`.

**Forbidden:** Staging and archived overrides; `override_parsing.py`; shared engine/network validation; provenance/hash allowances.

**Change:**

- Correct the 10 services listed in the scan.
- Add the endpoint-name rule inside `check_services()`, after station IDs are structurally validated.
- Scope it to the current composed gameplay product: `validation_profile == "gameplay"` and loaded `ui_presentation` is present. This uses existing trusted override metadata and excludes frozen pre-product datasets.
- Use service-specific stop names from loaded override UI metadata, falling back to registry names. Do not trust manifest-provided names for the comparison.
- Exempt circular services.
- Report service ID, direction, actual label, and expected label.
- Rebuild; inspect that only the two expected public files changed. Read the resulting dataVersion rather than hard-coding the scan’s predicted value.

**Tests:** Extend the existing Python file with a compact parameterized test covering both endpoint directions, a service-specific name, and circular exemption. Confirm archived baseline validation still passes. Use installed-product fixtures for the new tests.

**Acceptance commands:**

```bash
uv run python -m scripts.data_pipeline.build
uv run python -m scripts.data_pipeline.validate
uv run ruff check . && uv run ruff format --check . && uv run ty check scripts/ && uv run pytest tests/data_pipeline -q
npm run typecheck
npx vitest run tests/unit/real-data.test.ts tests/unit/data-contract-v3.test.ts
npm run build
```

**Est. LOC:** 90–120. Current pinned-save tests remain intentionally pending Step 2; report that boundary explicitly.

### Step 2 — Regenerate saves and preserve classic-fixture coverage

**Files:** Regeneration outputs: the three `tokyo-suburban-*-save.json` files, `item-saves.provenance.json`, `tests/unit/fixtures/edition-save-compatibility.json`; hand edits in `tests/unit/product-data.test.ts`, `tests/e2e/save-errors.spec.ts`, and `tests/e2e/fixtures/README.md`.

**Forbidden:** Historical fixture bytes/provenance; regeneration-script changes; production restore behavior.

**Change:**

- Run the existing regeneration script exactly through Vite’s SSR loader.
- Keep the immutable classic SHA assertion.
- Assert live-network data-version rejection and retained storage bytes.
- Use a new test-only network object with the historical fixture’s dataVersion to retain exact rules rejection and seeded turn-41 restoration.
- Update the browser’s historical-save expectation to the exact data-update message; retain reload/no-resume/byte-preservation assertions and verify explicit discard.

**Tests:** Existing product-data and real-data fixture/provenance tests; the historical classic browser case.

**Acceptance commands:**

```bash
node --input-type=module <<'JS'
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true } });
try { await server.ssrLoadModule('/tests/e2e/fixtures/regenerate-saves.ts'); }
finally { await server.close(); }
JS
npm run typecheck
npx vitest run tests/unit/product-data.test.ts tests/unit/real-data-e2e-scenarios.test.ts
npm run build
uv run python -m scripts.data_pipeline.validate
npx playwright test tests/e2e/save-errors.spec.ts --project=desktop-chromium --workers=2 --grep 'rejects the historical classic v4 save'
```

**Est. LOC:** 40–55, excluding regenerated outputs.

### Step 3 — Establish the shared guidance model

**Files:** New `src/features/game/mapGuidance.ts`, `src/features/game/turnMomentPresentation.ts`, `tests/unit/turn-moment-presentation.test.ts`.

**Forbidden:** Map rendering, CSS, toast delivery, engine edits.

**Change:** Implement bearing, first-completion-turn derivation, and the new heading/goal fields. Reuse the existing required-target calculation. Preserve already-public completion guidance during later moves.

**Tests:** Extend the existing suite for target/non-target heading, endpoint fallback, pre-move/moving suppression of a new 30/30 crossing, arrival publication, and retained guidance during a later move. Include lottery-settle versus published heading.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts
npm run build
```

**Est. LOC:** 65–90.

### Step 4 — Render pending emphasis and the heading

**Files:** `src/features/map/{mapConfig,progressStyle,railwayLayers,RailwayMap}.ts` / `.tsx`, `src/app/GameApp.tsx`, `tests/e2e/support/app.ts`, `tests/e2e/map-visual.spec.ts`; existing unit files `map-helpers.test.ts`, `map-flash.test.ts`, `map-station-markers.test.ts`, `capital-region-scaling.test.ts`.

**Forbidden:** Replacing the circle/source contract; station-label or glyph changes; animation-frame types; line-code badges.

**Change:** Add aligned dashed casing, runtime SDF image, rotated heading layer, source bearing, and map plumbing. Update only necessary map-double methods. Extend `readMap()` without weakening circle assertions.

**Tests:** One new browser case, `pending guidance and heading`, checks contrasting dashed pending versus solid completed styling, circle plus heading rendering, and both pale/dark background paints at one viewport. Extend an existing publication test later in Step 11. Existing style-replacement regression remains mandatory.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/map-helpers.test.ts tests/unit/map-flash.test.ts tests/unit/map-station-markers.test.ts tests/unit/capital-region-scaling.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --workers=2 --grep 'pending guidance and heading'
npx playwright test tests/e2e/map-failure.spec.ts --project=desktop-chromium --workers=2 --grep 'a replaced background style'
```

**Est. LOC:** 100–135.

### Step 5 — Show fixed-height goal guidance and highlight 新橋

**Files:** `src/features/game/components/{GameHud,GamePanel}.tsx`, `src/styles.css`, `src/app/GameApp.tsx`, `src/features/map/{railwayLayers,RailwayMap}.ts` / `.tsx`, `tests/unit/game-app-turn-moments.test.ts`, `tests/unit/map-station-markers.test.ts`, `tests/e2e/map-visual.spec.ts`.

**Forbidden:** Additional HUD rows; changing #70 dimensions; a second progress widget or live region.

**Change:** Replace cells in the existing progress slot; keep 30/30 text; add the station-filtered goal ring and empty-state clearing.

**Tests:** One browser case, `30 of 30 return guidance`, compares pre/post row and dice geometry, text, bar-cell removal, and goal rendering. Use 320×568 on the phone project and the default desktop viewport. Reuse engine-generated fixture history; do not forge an invalid save.
Update the existing layer-count and exact-order assertions in `tests/unit/map-station-markers.test.ts` to include the goal ring (validation 2026-11-10). No new test case is needed.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/game-app-turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts tests/unit/map-station-markers.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=phone-chromium --workers=2 --grep '30 of 30 return guidance'
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --workers=2 --grep '30 of 30 return guidance'
```

**Est. LOC:** 75–100.

### Step 6 — Deliver the one-time arrival milestone

**Files:** `src/features/game/{toastQueue,turnMomentPresentation}.ts`, `src/app/GameApp.tsx`, `tests/unit/toast.test.ts`, `tests/unit/game-app-turn-moments.test.ts`; extend the Step 5 browser case.

**Forbidden:** Save flags, queue schema persistence, item-event key changes, #65 thresholds.

**Change:** Add the stable milestone input, prepend it before item inputs, remove the redundant app-level readiness gate, and preserve restore baselining. Add the guidance sentence to the existing announcement path once.

**Tests:** Milestone at arrival; later item events still accepted; duplicate input ignored after expiration; no repeated milestone on another turn; restored 30/30 and restored pending-decision histories do not toast again. Extend the browser case with restore/reload suppression.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/toast.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/turn-moment-presentation.test.ts
npm run build
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --workers=2 --grep '30 of 30 return guidance'
```

**Est. LOC:** 85–115.

### Step 7 — Compute exact adjustment landings

**Files:** `src/features/game/mapGuidance.ts`, `src/features/game/turnMomentPresentation.ts`, `tests/unit/turn-moment-presentation.test.ts`.

**Forbidden:** `ItemSessionView`/engine/save changes; random draws; map effects.

**Change:** Implement legal-choice landings using `assertSettledPosition()` and `advance()`. Publish candidates only with the visible adjustment decision.

**Tests:** Compact cases for roll boundaries, endpoint truncation/duplicate landings, goal truncation, and one resumed pending roll. Compare the preview with the corresponding real resolution. Assert input serialization and both RNG states are unchanged by preview calculation.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/game-session-items.test.ts tests/unit/engine-item-turn.test.ts
npm run build
```

**Est. LOC:** 50–75.

### Step 8 — Reposition the modal and name its choices

**Files:** `src/features/game/components/{RollAdjustment,GamePanel}.tsx`, `src/styles.css`, `tests/unit/item-controls.test.ts`.

**Forbidden:** Immediate-submit controls; changing Escape/Skip semantics; global dialog styling changes.

**Change:** Pass candidate names into radios; introduce the scoped compact bottom layout and transparent backdrop. Keep legal options, confirmation, modal focus, Skip, and existing continuation button names.

**Tests:** Extend existing component tests for full landing accessible names and unchanged callbacks. Preserve, rather than replace, existing Escape and Skip tests.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/item-controls.test.ts
npm run build
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --workers=2 --grep 'pending reload retains the same die|item controls and the decision sheet fit'
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2 --grep 'Skip inside the adjustment'
npx playwright test tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --workers=2 --grep '^dialog wrapping$'
```

**Est. LOC:** 65–90.

### Step 9 — Add map speech bubbles

**Files:** New `src/features/map/rollAdjustmentPreview.ts`, `src/features/map/RailwayMap.tsx`, `src/app/GameApp.tsx`, `src/styles.css`, `tests/unit/map-helpers.test.ts`.

**Forbidden:** Interactive callouts; new map sources/glyphs; HTML string interpolation.

**Change:** Render anchored bubbles, group duplicate destinations, and implement deterministic overlap handling. Add cleanup on preview/map/session replacement. At this stage, camera integration remains Step 10.

**Tests:** A small DOM test verifies duplicate grouping, delta/pip text, safe station text, and teardown. Do not build a separate test suite or general layout-testing framework.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/map-helpers.test.ts
npm run build
```

**Est. LOC:** 65–100.

### Step 10 — Fit the camera around the preview

**Files:** `src/features/map/{camera,rollAdjustmentPreview,RailwayMap}.ts` / `.tsx`, `tests/unit/map-helpers.test.ts`, `tests/e2e/items.spec.ts`.

**Forbidden:** Saved follow-setting changes; continuous camera fitting; modifications to unrelated overview behavior.

**Change:** Measure obstructions and bubbles, fit origin plus candidates, observe relevant resizing, suspend competing follow updates, and clear retained padding.

**Tests:** Add one browser title, `roll adjustment landing map preview`. Verify actual bubble boxes and the origin marker remain visible outside the HUD/sheet/control rectangles, full accessible landing names match independently calculated landings, and annotations disappear after Continue. Include one resize while the decision remains open.

Run the same focused case at desktop and at the smallest phone viewport; this is two representative layouts, not a viewport sweep.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/map-helpers.test.ts tests/unit/map-panel-observer.test.ts
npm run build
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --workers=2 --grep 'roll adjustment landing map preview'
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --workers=2 --grep 'roll adjustment landing map preview'
```

**Est. LOC:** 85–115.

### Step 11 — Close focused integration gaps

**Files:** Existing `tests/e2e/{items,map-visual,ui-pop-turn-moments}.spec.ts`; necessary assertions in their existing support code only.

**Forbidden:** New suites, seed-search infrastructure, broad viewport/browser matrices, relaxed assertions.

**Change and tests:**

- Extend the existing lottery publication test to assert old/new heading alongside HUD direction.
- Extend the preview case with style replacement and no-duplicate-callout assertions.
- Preserve the existing map-failure adjustment test; verify landing names remain available there.
- Use unit coverage for exhaustive delta/truncation cases. Do not duplicate that matrix in E2E.

**Acceptance commands:**

```bash
npm run typecheck
npx vitest run tests/unit/turn-moment-presentation.test.ts tests/unit/game-app-turn-moments.test.ts tests/unit/toast.test.ts tests/unit/item-controls.test.ts tests/unit/map-helpers.test.ts
npm run build
npx playwright test tests/e2e/ui-pop-turn-moments.spec.ts --project=desktop-chromium --workers=2 --grep 'lottery flip and settle keep HUD'
npx playwright test tests/e2e/items.spec.ts --project=desktop-chromium --workers=2 --grep 'roll adjustment landing map preview|map failure keeps the adjust decision'
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --workers=2 --grep 'pending guidance and heading|30 of 30 return guidance'
```

**Est. LOC:** 40–60.

### Step 12 — Record supersession and finish acceptance

**Files:** `.claude/docs/DESIGN.md`, `.claude/docs/plans/tokyo-suburban-network-handoff.md`, `data/README.md`, `tests/simulation/README.md`, `docs/manual/tokyo-suburban/implementation-status.md`, new `docs/manual/public-launch/release-notes-map-guidance-working.md`.

**Forbidden:** Editing S4/S5 verification commands or evidence, claiming a release version, changing historical measurement results.

**Change:**

- Record the decisions, 14-layer stack, modal layout, and milestone ordering.
- Record that #62 supersedes S4 direction-label output and therefore the frozen product verification pins.
- Update current-version references. Preserve historical simulation/evidence version references and annotate their historical status.
- Write Japanese user-facing notes explaining the visible features and accepted old-save rejection. No version bump.

**Tests:** Audit each new E2E title separately with `--list`; an OR expression collecting some tests is insufficient evidence that every title exists. Run the final unit suite and data gates. The full browser matrix remains CI work.

**Acceptance commands:**

```bash
npm run typecheck
npm test
npm run build
uv run ruff check . && uv run ruff format --check . && uv run ty check scripts/ && uv run pytest tests/data_pipeline -q
uv run python -m scripts.data_pipeline.validate
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --list --grep 'pending guidance and heading'
npx playwright test tests/e2e/map-visual.spec.ts --project=desktop-chromium --list --grep '30 of 30 return guidance'
npx playwright test tests/e2e/items.spec.ts --project=phone-chromium --list --grep 'roll adjustment landing map preview'
npx playwright test tests/e2e/hud-layout.spec.ts --project=phone-chromium --workers=2 --grep 'keeps the dice button'
npx playwright test tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --workers=2 --grep '^dialog wrapping$'
git diff --check
```

**Est. LOC:** 25–45. Require CI success on the final reviewed SHA.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| All existing in-progress product saves become incompatible | Accepted product decision. Use the existing rejection message, preserve bytes until explicit discard, document the change, and regenerate only current fixtures. |
| Historical validation unexpectedly starts applying the new rule | Scope the rule using loaded current-product metadata; test both installed-product enforcement and unchanged archived validation. Do not modify archived data to satisfy it. |
| Classic tests lose their original purpose | Keep immutable SHA, live data-version rejection, matching-version rules rejection, seeded classic restoration, and storage-preservation assertions as distinct checks. |
| Guidance or heading leaks committed results | Derive once inside `turnDisplay`; explicitly test new completion during movement and the endpoint/lottery boundary. |
| Milestone blocks later item toasts | Use arrival index `-1`, original completion turn, milestone-before-item ordering, and a test that accepts later pickup/discard inputs. |
| Restore or replay repeats the toast | Stable key, historical completion turn, session-entry baseline, and queue cursor tests after expiration and restoration. |
| SDF tests falsely pass while the heading is absent | Keep the circle assertion and separately query the rendered symbol/image. Update map doubles explicitly; do not skip rendering checks when an API is missing. |
| Phone callouts overlap or are clipped | Group duplicate destinations, measure bubble extents, use bounded vertical lanes, and verify actual rectangles at 320×568. Fit anchors alone is insufficient. |
| Native modality dims or hides the visual preview | Transparent backdrop scoped to roll adjustment; visually verify the map and bubbles beneath it. Native modality remains intentional. |
| Follow effects undo the preview fit | Give preview framing priority while the decision is open; test with follow enabled and disabled. Clear retained padding afterward. |
| Python gates require missing local evidence | Record exact failing tests and missing evidence. The scan’s scratch-copy failures are not proof of current failures. Do not weaken evidence checks or treat them as passing. |
| LOC growth through duplicate testing | Reuse existing scenarios/specs, one browser case per visible feature where practical, unit coverage for combinatorial cases, and enforce the per-unit cap before proceeding. |
| `product_suburban verify` fails after correction | Expected frozen-evidence supersession, documented explicitly. It is not repaired by modifying pins, staging trees, or the verification command. |

## Open Questions for the user

None. The binding product decisions are sufficient, and the remaining layout, modality, rendering, fixture, and toast choices are resolved above.
