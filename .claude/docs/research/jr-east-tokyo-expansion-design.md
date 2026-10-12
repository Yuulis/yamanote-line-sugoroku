# JR East Tokyo 23-ward expansion — Architecture design and implementation plan

Date: 2026-10-12 · Architect (Agent Teams `feature-jr-east-tokyo-expansion`) · Design only, no code changed.
Inputs: brief `feature-jr-east-tokyo-expansion-brief.md`, codebase scan
`feature-jr-east-tokyo-expansion-codebase.md`, researcher findings `jr-east-tokyo-expansion.md` and
`jr-east-tokyo-service-graph.md`, prior notes `m0-data-spike.md`, `m1-engine.md`, `m2-experience.md`, spec
`railway_sugoroku_mvp_spec.md` §2–§5, §8, §10. Codex consultations: `.claude/logs/codex/*-jrx-*.md` (§10).

Status legend: **DECIDED** (architecture, independent of pending user choices) · **PENDING-USER** (needs the user;
a recommended default is given so implementation can start) · **CONFIRM-USER** (baseline follows the confirmed
rules; the user may opt into a proposed change) · **ASSUMPTION** (stated in place of an answer). All user items: §9.

---

## 0. Summary

- Network (**scope confirmed by the user 2026-10-12**; researcher, verified against JR East timetables ed. 2610):
  exactly 5 all-stop services, 67 stations,
  22 transfer stations, 88 undirected / 146 directed segments: 山手線 (loop 30, outer only), 京浜東北線 赤羽–蒲田
  (22), 中央・総武線各駅停車 西荻窪–小岩 (24), 埼京線 大崎–浮間舟渡 (10), 京葉線 東京–葛西臨海公園 (6).
  No branches, no split in-area runs, no transfers between differently named JR stations.
- Game length under the confirmed rules (Monte Carlo, 50,000 games, §3): **median 52 turns, p90 114, p99 189,
  0 % over 500 turns** (max 415 in 200,000 games). Not pathological; rule changes are optional (§3.4).
- Engine: atomic turn API (no persisted pending state); `moveByRoll(state, roll, network, landing?)` for injected
  outcomes, `playTurn` for seeded ones; new `landing.ts` rule module; `drawIndex` with rejection sampling; forced
  choices consume no draws; `MoveRecord` gains `stopReason` and `landing`; save v2 with whole-record replay.
- Data contract v2: one shared station id per curated JR station (registry), per-service platform coordinates,
  explicit endpoint kinds and direction labels, directed gameplay segments sharing one undirected geometry
  feature per service pair, `manifest.schemaVersion: 2`. Same five public files.
- Pipeline: per-service override tables + station registry, open-chain DP `route_path`, constrained routing for
  parallel tracks, per-service validation (17 rules, §5.4). Area clipping = curated in-area stop lists (N03 is a
  one-off audit, not an input).
- Plan: 6 steps, engine seam first, CI green at every step (§8). High complexity: engine seam (step 1),
  pipeline preparation (step 2), atomic v2 cutover (step 3).

---

## 1. Rules as designed

Confirmed by the user (2026-10-12): area = JR East stations in the 23 wards; moves leaving the area stop at the last
in-area station and discard the remaining pips; all-stop services only; reaching a terminus mid-move stops there
(pips discarded); Yamanote-only mode replaced, no migration of old saves; goal unchanged (30 Yamanote outer
segments + arrive at 新橋; truncate when riding Yamanote, exact stop otherwise); service lottery uniform over the
services at the arrival station including the current one; Yamanote always outer; other services get a separate
uniform direction lottery, re-drawn even if the service is unchanged.

Turn algorithm (**DECIDED** except where marked):

1. `status === "playing"`; roll 1–6 (seeded).
2. Advance station by station along the current service and direction. Each hop completes its directed segment.
   Only Yamanote outer segments count toward the goal (spec §3.1, §3.5).
3. Stop early when (a) the goal is reached and the arrival policy allows truncation (riding Yamanote, all 30 done,
   at 新橋), or (b) there is no next station (terminus or area boundary): remaining pips are discarded.
4. If the move cleared the game: `completed`, no landing resolution, no further RNG use.
5. Otherwise resolve the landing at the arrival station only (stations passed through never trigger anything):
   - candidates = distinct services stopping at the station, in network (services.json) order, current included;
   - k ≥ 2 → uniform service draw; k = 1 → the current service, no draw;
   - chosen service = Yamanote → direction = outer (`targetDirection`), no draw;
   - chosen service ≠ Yamanote → movable directions in `[1, -1]` order (a direction is movable iff the service has a
     next station that way); two movable → uniform direction draw; one movable → forced, no draw.
6. Turn 0 (new game at 新橋) has no landing resolution.

**R1 — direction at single-service stations (k = 1) on a non-Yamanote service. Baseline = R1-a; R1-b is a
proposed rule change the user may opt into (CONFIRM-USER).**
- R1-a (baseline, spec-literal, implemented by step 1): re-draw the direction at every landing (spec §4.1 step 3
  keeps the *service*, step 5 still draws the direction; §2 row 他路線→同一路線 = 方向再抽選; the confirmed rule
  "re-drawn even if unchanged"). Codex reads the spec the same way.
- R1-b (proposed change): keep the direction; flip only when it is not movable (terminus/boundary), no draw.
- Effect on length is small (median 52 vs 55, p99 189 vs 191). R1-b feels more like riding a train. The choice
  changes seeded replay semantics, so it must be frozen before the mixed-turn seeded snapshots are locked;
  switching is a one-branch change in `landing.ts`.

Edge rules (**DECIDED**):
- Landing exactly on a terminus with no pips left: `stopReason = "roll"`, `unusedPips = 0`, normal landing.
- Stop reason precedence: `goal` > `endpoint` > `roll`; `endpoint` only when pips were discarded.
- Endpoint truncation at the goal station with pips left does **not** count as an exact stop (spec §3.3): the goal
  predicate keeps the meaning "final rolled step" (`step === roll`), never "the move ended here". The data
  validator also forbids the start station from being an endpoint of any linear service, so it cannot occur in data.
- A playing state riding the target service in a direction other than `targetDirection` is invalid.
- Uniform over services, then directions: a service with two directions does not get twice the probability.

---

## 2. Data model and contract v2 (task 1)

### 2.1 Decisions

| # | Decision | Rejected alternative (why) |
|---|---|---|
| C1 | **One `Station` per curated JR station facility, shared by all services** (67 stations). Identity comes from an explicit registry (`data/overrides/stations.csv`), never from name equality. `groupId` stays optional in the type and is not emitted. | Per-platform stations + `groupId` (92 stations in 67 groups): spreads group comparisons into movement, goal, saves, UI; platform geometry would define gameplay identity. |
| C2 | **Per-service platform coordinates** in `ServicePattern.platformCoordinates` (keys = its `stationIds`). `Station.coordinates` = the platform point of the station's registry-selected *representative service* (山手線 wherever it stops). Geometry endpoints are checked against the service's platform point (30 m); platform → representative offset is a separate, reviewed check (東京 京葉線 ≈ 450 m). | One shared point with a 500 m endpoint tolerance (would accept routing to a wrong platform); platform centroid (may lie off every track). |
| C3 | **Directed gameplay segments, shared undirected geometry.** Segment id `<service>:<from>:<to>`; Yamanote emits +1 only (30); every linear service emits both directions (2·(n−1)). One GeoJSON feature per service-scoped adjacent pair, id `<service>:<a>~<b>` in +1 order; both directed segments reference it. Feature properties `{featureId, serviceId, from, to}` (+1 orientation). Animation orients by exact feature `from/to` identity, not by distance. | One feature per directed segment: duplicate coordinates, overlapping pending/completed features. |
| C4 | `ServicePattern` gains `directionLabels {forward, backward}` (Japanese, from overrides: 外回り/内回り; 「蒲田方面」/「赤羽方面」 named after the in-area end) and, for linear services, `endpoints {first, last}: "terminus" \| "area-boundary"` so the UI can say 終点 vs エリア端. | Deriving labels in the UI (cannot produce 外回り; couples UI to data shape). A `supportedDirections` field (derivable from segments; omitted for simplicity). |
| C5 | Same five public files; `manifest.schemaVersion: 2`; `dataVersion` = existing content hash over the four game files; `updatedAt` from a dataset override file. No transfers file (all transfers are same-station). | A sixth `transfers.json` (no data needs it yet). |
| C6 | Engine transfer seam: `transferOptions(network, stationId) → { serviceId, boardingStationId }[]`, one entry per service; in v2 `boardingStationId === stationId`. It localises roadmap stage 3 (cross-operator groups) but does not make it a one-function change: landing options/finalisation (station switch, record field) and the UI would also change. Goal identity is never widened to groups automatically. This shared-id choice is how the brief's "station groups" requirement is met for JR-internal transfers (東京 京葉線 platforms are the same station `tokyo`; covered by a dedicated identity test). | Implementing group-based station switching now (no data needs it). |
| C7 | Deterministic order: services in override order; stations by first appearance across services; pairs in service order; segments per pair forward then reverse; features in pair order. Lottery candidate order = services.json order, so reordering services changes `dataVersion` (and invalidates saves). | Locale or id sort for candidates (silently couples lottery outcomes to naming). |

### 2.2 TypeScript contract v2 (`src/types/network.ts`, `src/types/data.ts`)

```ts
export type EndpointKind = "terminus" | "area-boundary";

export interface Station { id: StationId; name: string; coordinates: Position; groupId?: string }

interface ServicePatternBase {
  id: ServiceId; name: string; operator: string; color: string;
  stationIds: StationId[];                       // +1 order, no repeated closing station
  directionLabels: { forward: string; backward: string };
  platformCoordinates: Record<StationId, Position>;  // keys === stationIds
}
export type ServicePattern =
  | (ServicePatternBase & { circular: true; endpoints?: never })
  | (ServicePatternBase & { circular: false; endpoints: { first: EndpointKind; last: EndpointKind } });

export interface Segment { id: SegmentId; serviceId: ServiceId; from: StationId; to: StationId; geometryFeatureId: string }

export interface SegmentFeatureProperties { featureId: string; serviceId: ServiceId; from: StationId; to: StationId }
// SegmentFeature.geometry: LineString only in v2 (MultiLineString rejected by validator and guard)
export interface Manifest { schemaVersion: 2; dataVersion: string; updatedAt: string; source: DataSource }
```

Guards (`src/data/guards.ts`) validate the new fields (key set of `platformCoordinates` equals `stationIds`,
`endpoints` present iff linear). Loaders keep five files.

### 2.3 Size budget

Core set ≈ 128 track-km → ≈ 48 KB `segments.geojson` at the M0 density (one feature per undirected pair); stations
/ services / segments JSON add an estimated 40–60 KB pretty-printed (to be measured, not assumed). Keep
`MAX_GEOJSON_BYTES = 300_000`; the validator reports all five file sizes.

---

## 3. Game-length analysis (task 3)

### 3.1 Method

Throwaway Python Monte Carlo (session scratchpad, not in the repo) of the rules in §1 on the researcher's verified
graph (`jr-east-tokyo-service-graph.md` CSV, `status = core` rows = the user-confirmed 5-service scope; identical
stop lists to the architect's earlier public-knowledge approximation, which gave median 55 / p90 119 under R1-b).
Re-run on the confirmed network with an independent seed: R1-a 52 / 114 / 186, R1-b 55 / 119 / 193 (50,000 games
each) — the table below is unchanged within sampling noise. Python
`random.Random` (distributional study; the game's sfc32 is not needed). 50,000 games per row, cap 20,000 turns.
Sanity check: Yamanote-only network gives median 9 turns (≈ 30 / 3.5), as expected. "Endgame" = turns between
completing the 30th Yamanote segment and clearing.

### 3.2 Results — confirmed rules

| Network / rule | Median | Mean | p90 | p99 | > 200 | > 500 | Endgame med/p90 | Lotteries/game |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Core 5, R1-a (re-draw at k = 1) | **52** | 60.5 | **114** | **189** | 0.7 % | **0 %** | 1 / 28 | 30.2 |
| Core 5, R1-b (keep at k = 1) | 55 | 63.1 | 119 | 191 | 0.7 % | 0 % | 1 / 29 | 31.0 |
| *Excluded by the user — for reference only:* Core + 常磐線各駅停車 (island) | 52 | 60.5 | 114 | 189 | 0.7 % | 0 % | 1 / 28 | 30.2 |
| *Excluded — reference:* Core + 横須賀・総武快速 | 60 | 67.3 | 125 | 199 | 1.0 % | 0 % | 1 / 28 | 35.1 |
| *Excluded — reference:* Core + 常磐線快速 | 56 | 64.2 | 120 | 197 | 0.9 % | 0 % | 1 / 29 | 31.9 |
| *Excluded — reference:* Core + both optional | 63 | 70.7 | 131 | 207 | 1.2 % | 0 % | 1 / 29 | 36.7 |

Tail (core, R1-a, 200,000 games): max 415 turns; P(> 300) = 0.018 %; P(> 400) = 0.0005 %.

Play time: ≈ 3.2 hops per turn at 450 ms per hop plus a click → roughly 2.5–3 s per turn, so a median game is
≈ 2–3 minutes and a p99 game ≈ 9 minutes. The UI must not assume a bounded history (saves of ~400 turns ≈ 150 KB
are fine for localStorage).

### 3.3 Interpretation

- Games are 5–6× longer than the Yamanote-only game (median 9) but not pathological: the 22 transfer stations are
  mostly on the Yamanote loop, so the player returns to Yamanote often (≈ 50 % per lottery at 2-service stations).
- The goal rule matters little under the confirmed truncate-on-Yamanote policy (endgame median 1 turn). For
  reference, `exact-stop` everywhere would give median 77, p99 289, 5.6 % over 200 turns.
- 常磐線各駅停車 has no effect (never boarded).

### 3.4 Optional rule levers for the USER (not decided; baseline needs none)

| Option | Median | p90 | p99 | Notes |
|---|---:|---:|---:|---|
| Baseline (core, R1-a) | 52 | 114 | 189 | confirmed rules |
| O1 `pass-through` goal (clear on any service when passing 新橋 with 30/30) | 49 | 107 | 179 | changes confirmed §3.3 rule; small gain (endgame p90 28 → 17) |
| O2 Yamanote weight ×2 in the service lottery | 27 | 62 | 107 | breaks "uniform" (§2 spec row 乗換先); needs `serviceLotteryWeights` in config |
| O3 Yamanote weight ×3 | 20 | 45 | 81 | as O2 |
| O1 + O2 | 27 | 60 | 102 | |

Recommendation: keep the baseline (no change). Offer O2 only if playtesting finds games too long.

---

## 4. Engine design (task 2)

Pure TypeScript under `src/features/game/engine/`; no React/DOM/`Math.random`/`Date`/storage. All errors are
`GameEngineError`; no new error codes.

### 4.1 Modules

| File | Responsibility | Change |
|---|---|---|
| `rng.ts` | sfc32, seeding, `rollDie`, **`drawIndex`** | add `drawIndex`, `indexFromDraw` (pure, testable like `faceFromDraw`) |
| `network.ts` | topology, indexes | add `servicesByStation` (ordered), `transferOptions`, `movableDirections`; structural validation only; `expectedStationCounts` per service |
| `movement.ts` (new, private) | station-by-station advance, endpoint truncation, goal truncation, events | extracted from `game.ts` |
| `landing.ts` (new) | candidates, direction eligibility, choice validation, landing event, draw orchestration | `landingOptions`, `resolveLandingEvent`, `drawLanding` |
| `goal.ts` | target segments, arrival policy | `stopsAtGoal(config, ridingServiceId, isFinalRolledStep)` unchanged in meaning |
| `config.ts` | playable coverage | target circular with all `targetDirection` segments; every non-target service has both directions; start station not a linear endpoint |
| `game.ts` | atomic turn orchestration, record | `moveByRoll(…, landing?)`, `playTurn`, `SAVE_VERSION = 2` |
| `save.ts` | parse, replay, RNG verification | v2 records, whole-record comparison, linear replay accumulator |
| `types.ts` | events, `MoveResult` | new events and `stopReason` |

### 4.2 RNG draw contract

```ts
export function drawIndex(rngState: string, k: number): { index: number; nextRngState: string };
```
- Integer `2 ≤ k ≤ 2^32`, else `INVALID_STATE`; malformed state → `INVALID_RNG_STATE`.
- Rejection sampling: `limit = 2^32 − (2^32 mod k)` in ordinary number arithmetic (bitwise would turn 2^32 into 0);
  accept `draw < limit`, `index = draw mod k`; every rejected draw advances the state.
- `rollDie` unchanged (its output equals `drawIndex(s, 6) + 1`, but it is not rewritten, to keep the snapshot test
  meaningful); `RNG_STATE_PREFIX` stays `sfc32-v1`.
- Per-turn order (part of the ruleset): `rollDie` → advance → if not completed: service draw iff k ≥ 2 → direction
  draw iff chosen service ≠ target and two movable directions. Forced choices never call `drawIndex`, so a game that
  never meets a real choice consumes exactly the old dice sequence.

### 4.3 API

```ts
type StopReason = "roll" | "goal" | "endpoint";
interface LandingChoice { serviceId: ServiceId; direction: Direction }
interface LandingOptions {
  stationId: StationId;
  services: readonly ServiceId[];              // canonical order, deduplicated, current included
  serviceDrawRequired: boolean;                // services.length >= 2
  directionsByService: ReadonlyMap<ServiceId, readonly Direction[]>;  // target → [targetDirection]
}
function landingOptions(arrival: Pick<GameState, "config" | "currentStationId" | "currentServiceId" | "direction">,
                        network: RailwayNetwork): LandingOptions;
function resolveLandingEvent(options: LandingOptions, ridingServiceId: ServiceId,
                             choice?: LandingChoice): { choice: LandingChoice; event: LandingResolvedEvent };
function drawLanding(options: LandingOptions, rngState: string): { choice: LandingChoice; nextRngState: string };
function moveByRoll(state: GameState, roll: number, network: RailwayNetwork,
                    landing?: LandingChoice | null): MoveResult;
function playTurn(state: GameState, network: RailwayNetwork): MoveResult;
```

- **Atomic turns**: every exported `GameState` is settled (next service and direction decided); there is no pending
  landing state, which keeps the reducer's single commit and save-before-animation behaviour.
- `moveByRoll` never touches `rngState`. If the move clears: `landing` must be omitted or `null`. Otherwise an
  omitted choice is allowed only when the whole outcome is forced; explicit `null`, an unknown service or an
  ineligible direction → `INVALID_STATE`.
- `playTurn` = `rollDie` → shared internal `advance` → `drawLanding` → shared `finalize` (no dry run + second
  move). `moveByRoll` uses the same `advance`/`finalize` with the supplied or forced choice.
- `resolveLandingEvent` (spec §8.1 name) validates and builds the event; it never appends history or bumps the turn.

### 4.4 Events, records, state

```ts
type MoveEvent = SegmentTraversedEvent | GoalReachedEvent
  | { type: "endpoint-reached"; step: number; stationId: StationId; discardedPips: number }
  | { type: "landing-resolved"; stationId: StationId; serviceCandidates: readonly ServiceId[]; serviceId: ServiceId;
      serviceDrawRequired: boolean; directionCandidates: readonly Direction[]; direction: Direction;
      directionDrawRequired: boolean; changedService: boolean };
interface MoveResult { state; events; roll: DieFace; stopReason: StopReason; unusedPips: number }
interface MoveRecord { /* existing 7 fields: the ridden service/direction */
  stopReason: StopReason; landing: LandingChoice | null /* null iff this move cleared */ }
```
- Flags are named `…DrawRequired` (not `…Drawn`) because injected `moveByRoll` choices consume no RNG.
- `GameConfig` and `GameState` keep their shapes. `rulesetVersion` becomes `"jr-east-23ku-1"` (documents semantics;
  production restore keeps the `CONFIG_MISMATCH` check). `currentServiceId/direction` = what the next move rides.
- `completedSegmentIds` keeps every directed segment ever traversed (all services, first-completion order) for the
  map; progress = intersection with `targetSegmentIds`. `checkGoal` unchanged (shared station ids make it correct).

### 4.5 Network and config validation

- `buildRailwayNetwork` (structural): unique ids; no repeated stop in a service; known references; segments are
  adjacent pairs of their service; unique `(service, from, to)`; every station served; loop ≥ 3, linear ≥ 2 stops;
  `expectedStationCounts?: Partial<Record<ServiceId, number>>` (app passes `{ "jr-yamanote": 30 }` from
  `src/features/game/networkFromData.ts`). The network deep-copies nested service metadata (stop arrays, platform
  coordinate tuples, labels, endpoints) so later input mutation cannot change positions; the input-mutation test is
  extended accordingly.
- `validateConfig` (playable coverage): target exists, circular, all `targetDirection` segments; every non-target
  service has both directions for every pair (missing track data must never look like an endpoint); start on
  target; start station is not an endpoint of a linear service. The old "missing wrap segment" test moves here.
- Reachability of services is not an engine concern (pipeline validator, §5.4 rule 15).

### 4.6 Save v2

- `SAVE_VERSION = 2`; v1 → `UNSUPPORTED_SAVE_VERSION` (the UI already shows 「対応していない形式」 and offers
  discard). Storage key unchanged (`…:save:v1` is a layout version).
- `parseMoveRecord` requires `stopReason` and `landing` (no defaults).
- Restore order unchanged: JSON → version → shape → `dataVersion` → config → **structural replay**
  (`moveByRoll(record.roll, record.landing)`, whole-record comparison incl. `stopReason`/`landing`, full final state)
  → **seeded replay** when `requireSeededRolls` (`playTurn`, whole-record comparison, final `rngState`). Errors:
  illegal or inconsistent history → `INVALID_SAVE`; legal but not seed-produced (e.g. a different direction with the
  same roll) → `RNG_MISMATCH`.
- Replay uses a private accumulator that compares records incrementally instead of rebuilding the growing history
  array each turn (games can reach hundreds of turns). No history-length cap.

---

## 5. Pipeline generalisation (task 4)

### 5.1 Override layout (`data/overrides/`)

```
dataset.json                 operator, n02 operator, updatedAt, area name, start station id, expected service ids,
                             reviewed disconnected service ids (empty: 常磐線各駅停車 excluded by the user)
stations.csv                 id, name, n02_name, ward, representative_service_id   (registry; area = ward ∈ 23 wards)
services.json                [{id, name, color, circular, directionLabels, endpoints, lengthRef: {km, toleranceKm, source}}]
services/<id>/stops.csv      order, station_id, station_number (JK47…), platform_selector (optional N02 hint)
services/<id>/line_mapping.csv  from_id, to_id, n02_line, via (optional ordered lon/lat hints)
offset_exceptions.csv        service_id, station_id, max_platform_offset_m, reason   (e.g. jr-keiyo, tokyo, 500)
```
The current `yamanote_stations.csv`, `yamanote_line_mapping.csv`, `service.json` migrate into this layout in step 2
(Yamanote JY-number cyclic check becomes a Yamanote-specific evidence check, not a generic rule).

### 5.2 Build

- Per service: expand line mapping (cyclic for loops, open for chains) → candidates per (service, station) from the
  N02 JR East platforms on the mapped lines, matched by `n02_name` (handles 阿佐ヶ谷/阿佐ケ谷) **and** line/bbox
  (rejects the Akita 大久保) → constrained track graph per (service, mapped line, constraints) → platform choice by
  `route_loop` (existing) or new `route_path` (open chain DP: all first candidates, `n−1` pairs, cheapest end).
- Parallel tracks on one N02 line (中央線 快速/緩行, 総武線 快速/緩行 錦糸町–小岩, 東北線 京浜東北/宇都宮 and the 尾久
  route, 山手線 N02 line used by 埼京線): constrain before optimising — platform selectors, section allow/deny lists
  keyed by stable attributes, ordered via points; reject excessive snapping before DP. Graph caches are keyed by the
  constraints, not just the line.
- Station representative point = platform point of `representative_service_id`. Geometry is not clipped at ward
  boundaries (only stops are clipped; a path between two in-area stops may cross a boundary river).
- Export per §2.1 C3/C7; coordinates 6 decimals, no `-0`, LF, fixed indentation, final newline; manifest last.

### 5.3 Reproducibility

Two gates: (1) **generation** (local, raw N02 pinned by checksum): byte-identical rebuild test (existing
`test_build.py` pattern, skipped without raw data); (2) **artifact validation** (CI): all rules in §5.4 over the
committed files + overrides, plus synthetic routing tests (ambiguous parallel tracks, equal-cost ties) that need no
raw data. N03 polygons stay a documented one-off audit (researcher §3.3), optionally a local-only test.

### 5.4 Validator rules v2 (`scripts/data_pipeline/validate.py`)

1. Strict schema of the five files (`schemaVersion: 2`, finite coordinates, LineString only, no `crs`).
2. Station registry: unique ids; one consistent name/ward/representative per id; names are not identity.
3. Area and catalogue: every station's ward ∈ fixed 23-ward list; service ids equal the reviewed catalogue;
   explicitly excluded services absent.
4. Service metadata equals overrides (name, operator, colour, circularity, labels, endpoint kinds, stop order).
5. Stop lists: ≥ 2 (linear) / ≥ 3 (loop) stops, no repeats, all references resolve; count/order = override.
6. Contiguity: each pattern is one reviewed in-area run; no segment bridges an omitted run.
7. Platform coordinates: key set = `stationIds`; station coordinates = representative service's platform point.
8. Offsets: geometry end → service platform ≤ 30 m; platform → representative within default or reviewed
   exception; unused/duplicate exceptions fail.
9. Directed segments: ids match fields; exact pair set per supported direction (Yamanote +1; linear both); no extras.
10. Counts and walks: loop `n` (+1 only), chain `2(n−1)`; walk each direction end to end, no outward segment at ends.
11. Features: exactly one per service pair; ids/properties agree; reverse references describe the same pair; no
    orphan features.
12. Geometry continuity and endpoint orientation against `from/to` platform points.
13. Routing sanity: detour ratio (per-service platform points); **same-service** skipped-stop proximity (100 m,
    diagnostics for other services' stations only); committed via-point hints honoured.
14. Service length: canonical features summed once per service vs `lengthRef` ± 1.5 km (per-service totals, not
    per segment). References (researcher; 営業キロ cross-checked on Wikipedia, not an official JR source, all agree
    with N02 chords): 山手線 34.5, 赤羽–蒲田 27.6, 西荻窪–小岩 30.3, 大崎–浮間舟渡 22.0, 東京–葛西臨海公園 10.6 km.
    `lengthRef.source` records this provenance.
15. Connectivity: all 30 target segments reachable from 新橋; expected main services connected; disconnected
    service ids exactly equal the reviewed list in `dataset.json`.
16. Start station is not an endpoint of a linear service.
17. Deterministic bytes, recomputed content hash, manifest metadata; byte budget (geojson ≤ 300,000 B; report all).

---

## 6. UI and map (task 5)

### 6.1 Play panel (`GamePanel.tsx`)

| Row | Content | Notes |
|---|---|---|
| 現在駅 | station name (follows the marker) | unchanged |
| 乗車中 | colour swatch + service name, e.g. ■ 京浜東北線 | new; during the animation shows the ridden service, after it the landing result |
| 進行方向 | `directionLabels` of the current service (外回り, 蒲田方面 …) | replaces the fixed 外回り/内回り map |
| 山手線 踏破 | `X/30`, counting only target segments | fixes the over-count (`GameApp.tsx:147-149`) |
| 出目 | `4`, `4（新橋で停止、残り2は使わず）`, `5（蒲田で停止〔エリア端〕、残り3は使わず）`, `…〔終点〕…` | uses `stopReason` + the **ridden** service's endpoint kind (landing at 京葉線's 東京 terminus and then choosing 山手線 is still a 京葉線 終点 stop) |
| 抽選 | service lottery: `新宿：山手線・中央・総武線各駅停車・埼京線から抽選 → 埼京線`; direction: `方向抽選 → 大崎方面`; direction-only (R1-a, one service): `京浜東北線のみ → 方向抽選 → 赤羽方面`; forced: `終点のため折り返し` only when the ridden service continues and reverses, `乗車方向は蒲田方面のみ` when boarding another service at its end | new, `aria-live="polite"`; hidden (or 「移動中…」) while animating |

Presentation contract (**DECIDED**; no extra session phase):
- While `phase === "animating"`: 乗車中/進行方向 come from the latest record's **ridden** `serviceId`/`direction`;
  the new lottery result is not shown.
- When the move's `animation-finished` is accepted (natural end, skip, or reduced motion): show
  `game.currentServiceId`/`game.direction` and reveal the already-committed lottery result.
- On resume: idle immediately, result shown; a reload never re-draws.
- `lastMoveOf(game, network)` reconstructs the landing event from the last record's `toStationId`,
  `serviceId`/`direction` (ridden) and `landing` via `landingOptions` (pure); `LastMove` gains `stopReason`,
  ridden endpoint kind and the landing event.
- Lottery presentation: **text first (DECIDED)**. A dice-like visual (spec §4.2) is an optional later step that only
  animates the already-decided result; it never draws.
- Phone layout: test a populated multi-service panel (long lottery text, larger legend) at ≤ 600 px so controls stay
  visible.

### 6.2 Map (`railwayLayers.ts`, `progressStyle.ts`, `RailwayMap.tsx`)

Layer order (bottom → top):
1. `railway-services`: every non-target feature, service colour, 3 px, opacity ≈ 0.6, `line-offset` ≈ 4 px so
   services on the same N02 polyline as Yamanote (京浜東北 田端–品川, 埼京 大崎–池袋) stay visible.
2. `railway-current-service` (optional polish): the current service's features, wider.
3. `railway-segments-pending`: Yamanote features not completed — grey dashed (unchanged look).
4. `railway-segments-completed`: Yamanote features completed — 山手線 green solid (unchanged look).
5. stations, labels, current-position marker.

- Filters use `featureId`, and **both** progress layers are restricted to `serviceId == target`; completed
  target-direction segment ids are mapped to feature ids through `network.segmentsById` before reaching the
  renderer. Helpers and tests keep gameplay segment ids and render feature ids as distinct types.
- `GeometryIndex` keeps feature `from/to` with the coordinates; orientation = exact identity, anything else is
  invalid data.
- Platform-aware positions everywhere: idle marker, the position before the first animation frame
  (`displayedProgress.ts`) and the straight-line fallback in `movePath.ts` use the ridden service's platform point,
  not the representative station point.
- A transfer between distant platforms (東京 京葉線) repositions the marker when `animation-finished` is accepted
  (resume goes there directly); it is never drawn as a traversed segment.
- `line-offset` is a reviewed rendering choice (offsets follow the canonical feature orientation, and one uniform
  offset does not separate two non-target services); verify on the real data in step 5.
- Initial view: fit the 23-ward network bounds per viewport, with a desktop and phone visual acceptance check
  (a fixed zoom is not assumed to fit); follow mode unchanged.

### 6.3 Other screens and text

- Legend: 山手線 踏破済み（実線）/ 未踏破（点線）, one swatch per other service, 現在地.
- Clear screen: per move `出目4：品川 → 大井町（京浜東北線・蒲田方面）` and `→ 乗換: 山手線（外回り）` when the
  landing changed service; summary adds 乗換回数.
- Title rules text, `index.html` title, clear text: rewritten for the new rules. **PENDING-USER R5** title/branding
  (default: keep 「山手線すごろく」 with subtitle 「JR東日本 東京23区版」).
- Station popups: `lineNames` already list all serving services.

---

## 7. Test strategy (task 6)

### 7.1 Unit (Vitest)

- Fixtures: keep `tests/unit/fixtures/yamanote.ts`; add `multiService.ts` — small loop target (≈ 6 stations, used
  without `expectedStationCounts`) + linear service crossing it at two stations with one terminus and one
  area-boundary end + a third service sharing one transfer station; bidirectional segments; deep-frozen.
- Engine: arrival-only landing (passed transfer stations ignored); candidates ordered and deduplicated incl.
  current; Yamanote fixed outer incl. Yamanote→Yamanote; non-target re-draw even when unchanged; R1 rule at k = 1;
  forced single direction at termini; omitted/`null`/illegal choices → `INVALID_STATE`; supplied choice leaves RNG
  unchanged; endpoint truncation with discarded pips and event order; exact terminus landing = `roll`; missing
  segment ≠ endpoint (throws); goal truncation on target vs exact stop on others; clearing turn → `landing: null`,
  no landing event, only dice draws; other services never count toward progress; determinism and immutability.
- RNG: existing `"yamanote"` dice snapshot unchanged; `indexFromDraw` boundaries (k = 2, 3, 6, large, 2^32;
  `0xffffffff` rejected for k = 3, accepted for k = 2 and 2^32); invalid k; rejected draws advance state; mixed-turn
  snapshot with 0, 1 and 2 lotteries.
- Save v2: round trips (fresh, transferred, direction-only, endpoint-truncated, completed); restored seeded save
  reproduces the next `MoveResult`; missing/malformed `stopReason`/`landing`; `landing` null/non-null consistency;
  illegal direction → `INVALID_SAVE`; legal but non-seeded choice → `RNG_MISMATCH`; v1 → unsupported; long history
  (> 300 turns) restores.
- Real-data integration (new): read the five `public/data` files from disk (paths relative to the test module),
  parse them through the runtime guards and the app's own `networkFromData` + production config, play a fixed set of
  seeds to completion with a 5,000-turn safety cap; assert completion and 30/30; `restoreGame(…, { expectedConfig,
  requireSeededRolls: true })` on mid-game and completed saves and compare the next `MoveResult`. Seed count is set
  after measuring runtime (target < 2 s). Precise draw-order snapshots stay on synthetic fixtures so data refreshes
  do not churn them. Identity test: 山手線, 京浜東北線 and 京葉線 share station `tokyo` with distinct platform points.
- UI pure units: target-only progress count, stop-reason texts (ridden endpoint kind), landing/direction-only text
  builder, target-scoped featureId filters, movePath orientation by feature identity, platform-aware positions,
  `lastMoveOf` reconstruction; transfer-focused presentation cases (natural end, skip, reduced motion, reload
  mid-animation) in the reducer/animation tests.

### 7.2 Pipeline (pytest)

Override parsing per service and registry; open-chain `expand_line_ranges`; `route_path` DP incl. ties; export of
bidirectional segments + shared features; every validator rule with a failing fixture; synthetic parallel-track
routing; local-only byte-identical rebuild (raw N02 present) and optional N03 audit.

### 7.3 E2E (Playwright, hermetic)

- **Fixture network via route interception**: a page route installed before navigation, matching the preview
  origin's data paths, serves all five files of `tests/e2e/fixtures/data/` — the real 30-station Yamanote plus two
  short linear services: one with a real terminus at a Yamanote station other than 新橋, one with an area-boundary
  end. Page routes take precedence over the context-level map stub. Each spec selects its dataset explicitly, and
  expectations are read from the **same** bundle (the current `loadStations(request)`/`loadManifestSource(request)`
  helpers use `APIRequestContext`, which bypasses page routes; they read the fixture files from disk in fixture
  specs and keep HTTP only for the real-data smoke).
- **Pinned game seeds**: a Playwright-free module exports the 128-bit game-seed hex strings; a self-contained
  crypto-stub init script receives the seed bytes as its argument (imported helpers do not survive `addInitScript`
  serialisation). Vitest plays the same seeds on the fixture with `createGame` and proves, per seed, the scenario
  predicates the spec relies on: service changed, genuine direction draw, **terminus** truncation, **area-boundary**
  truncation, clear within N turns. Specs assert the saved `rngSeed` equals the pinned value. Separate seeds may be
  used per scenario.
- Specs: full game to the clear screen (fixture); transfer + direction-draw text; terminus and boundary truncation
  texts; reload mid-game (and mid-animation) restores service and direction; layout/map-failure/save-error specs
  adapted; `readMap` reads the new target-scoped `featureId` filter shape; full-game assertions no longer assume
  ≤ 30 turns, exactly 30 completed segments overall, or 30 hops (`踏破区間` counts target segments only).
- **Real-data smoke** (one spec, no interception): start, roll a few times, panel shows 乗車中/進行方向, no console
  errors, no external requests.

---

## 8. Implementation plan (task 7)

Every committed step must pass all three CI jobs (frontend, pipeline, Playwright), not only the checks of its main
subsystem. Order (Codex plan review): engine seam → pipeline preparation → atomic v2 Yamanote-only cutover →
multi-service UI + fixture E2E → expanded data + real-data integration → docs and release verification. Building
and reviewing the expanded data (step 5 preparation) can run in parallel from step 3 on; only its commit waits.

| Step | Scope | Depends on | Complexity / route |
|---|---|---|---|
| 1 Engine seam | §4 complete with unit tests on the **v1 data contract** (no platform coordinates, labels or endpoint kinds needed); app still plays Yamanote-only data (every landing forced, identical play); `MoveRecord`/save parsing v2, `SAVE_VERSION` 2, `rulesetVersion` bump; `networkFromData.ts` migrates to `expectedStationCounts`; `inputWithShuttle()` fixture gains reverse segments and injected landing choices; existing save/app-state assertions updated; `gameSummary`/`GamePanel` read `stopReason` (fixed 外回り label stays correct) | R1 frozen (baseline R1-a) | **High** — general-purpose-opus + Codex review |
| 2 Pipeline preparation | refactor behind the **unchanged v1 output**: override layout + station registry, per-service build, `route_path`, constrained routing, validator internals; v1 artifacts byte-identical | 1 not required | **High** — general-purpose-opus |
| 3 Atomic v2 cutover (Yamanote-only data) | one change set: v2 export + validator rules, regenerated v2 artifacts, TS types/guards/loaders, `GeometryIndex` with `from/to`, platform-aware positions, target-scoped `featureId` filters, unit fixtures, **E2E helpers** (`readMap` filter shape, `segmentId` → `featureId`) | 1, 2 | **High** — general-purpose-opus |
| 4 Multi-service UI + fixture E2E | §6 (panel rows, presentation contract, lottery texts, map layers, legend, clear history, texts, viewport fit) and §7.3 fixture bundle, pinned seeds with Vitest proofs, adapted specs | 3; R5 for texts | **Medium** — general-purpose-sonnet (Opus review of the presentation contract) |
| 5 Expanded data + real-data integration | registry + 4 services' stops/mappings/constraints from the researcher tables; local build, per-segment routing review, validator green, size report, visual check on desktop/phone; real-data Vitest playthrough and real-data E2E smoke land in the same commit | 3, 4, R2–R4 | **Medium-High** — Sonnet for tables, Opus for routing review |
| 6 Docs and release verification | `docs/manual/` rules/status, spec §2/§4/§11 rule updates, DESIGN.md, attribution review (N03 used only as an unshipped audit; no new shipped source), PR feature → develop → master, **post-approval production smoke check** | 1–5 | Low |

File-level change list:
- Engine (step 1): `src/types/network.ts` (`MoveRecord`), `src/features/game/engine/{rng,network,config,goal,game,save,types,index}.ts`,
  new `engine/{landing,movement}.ts`; `src/features/game/{gameConfig,gameSession,gameSummary,networkFromData}.ts`;
  `tests/unit/{engine-*,game-app-state,game-session,persistence}.test.ts`, `tests/unit/fixtures/{yamanote,multiService}.ts`.
- Pipeline (steps 2–3, 5): `scripts/data_pipeline/{config,overrides,build,routing,export,validate}.py`,
  `data/overrides/**`, `public/data/*`, `tests/data_pipeline/*`.
- Contract consumers (step 3): `src/types/{network,data}.ts`, `src/data/{guards,loaders}.ts`,
  `src/features/game/animation/{movePath,displayedProgress}.ts`,
  `src/features/map/{progressStyle,railwayLayers,lineColor,stationCollection,mapConfig}.ts`, `RailwayMap.tsx`,
  `tests/e2e/support/app.ts`.
- UI (step 4): `src/features/game/components/{GamePanel,ClearScreen,TitleScreen}.tsx`, `src/app/GameApp.tsx`,
  `index.html`, CSS; `tests/e2e/{fixtures.ts,fixtures/data/*,support/*,*.spec.ts}`, new seed module + Vitest proof.
- Real data (step 5): new `tests/unit/real-data.test.ts`, real-data smoke spec.

Risks and mitigations:

| Risk | Mitigation |
|---|---|
| N02 parallel tracks route a service along the wrong track pair (correct endpoints, plausible length) | constrained routing (selectors, allow lists, via points), same-service skipped-stop check, per-segment visual review in step 5 |
| Seeded semantics drift (draw order, candidate order, R1) silently changes saved games | ruleset contract documented in `rng.ts`/`landing.ts`; mixed-turn snapshots on synthetic fixtures; `rulesetVersion` + `dataVersion` invalidate old saves |
| User rule decisions land after step 1 | baselines chosen so changes are local (one branch in `landing.ts`, override rows); freeze R1 before locking snapshots |
| Committed service/direction or platform jump leaks before the marker arrives | presentation contract §6.1; platform-aware positions §6.2; transfer presentation tests |
| Pending filter covers every non-target feature in grey | both progress layers target-scoped; unit test on the filter expressions |
| Map clutter in shared corridors; overflowing phone panel | reviewed `line-offset`/opacity; populated-panel layout check at ≤ 600 px |
| E2E reads a different dataset than the browser plays | one selected bundle per spec; fixture expectations from disk |
| Seed installer loses imported helpers in `addInitScript` | self-contained installer that receives seed bytes as its argument |
| Monte Carlo tail mistaken for a bound | no history cap; browser tests use proven fixed trajectories; real-data test has a safety cap with a clear failure |
| Restore cost for long histories (quadratic copying) | linear replay accumulator; > 300-turn save tests; measure runtime |
| Shared nested platform metadata mutated after network build | deep copy in `buildRailwayNetwork`; extended mutation test |
| Old saves | `UNSUPPORTED_SAVE_VERSION` + existing discard UI (accepted by the user) |

---

## 9. User decisions (open: R1, R5, R6)

| Id | Question | Recommended default |
|---|---|---|
| R1 | Direction at single-service stations on a non-Yamanote service: re-draw (R1-a, baseline = literal confirmed rule) or keep/flip (R1-b, proposed change) | R1-a; length difference small (median 52 vs 55) |
| R2 | Service catalogue | **Decided by the user 2026-10-12**: exactly 山手, 京浜東北 (赤羽–蒲田), 中央・総武各停 (西荻窪–小岩), 埼京 (大崎–浮間舟渡), 京葉 (東京–葛西臨海公園); 普通 patterns; 武蔵野線 not separate; same-name groups incl. 東京 京葉線; curated boundary CSV, N03 one-off check. This list is the validator's completeness oracle |
| R3 | 常磐線各駅停車 | **Decided: excluded** (validator rule 15 reviewed-disconnected list stays empty) |
| R4 | 横須賀・総武快速線 / 常磐線快速 | **Decided: excluded** |
| R5 | Title / branding | keep 「山手線すごろく」 + subtitle 「JR東日本 東京23区版」 |
| R6 | Game-length levers (§3.4) | none |
| R7 | 10 of 77 in-area JR stations not in the game | **Decided: accepted** |

---

## 10. Codex consultations

- `jrx-data-model` (`.claude/logs/codex/20261012T022034Z-jrx-data-model.md`, read-only): adopted — curated station
  registry (not name identity), per-service platform coordinates with separate offset checks, shared features with
  identity-based orientation, `featureId` filters, `schemaVersion`, endpoint kinds, constrained routing before
  optimisation, same-service skipped-stop check, two-gate reproducibility, 17-rule validator, transfer seam with
  boarding station. Not adopted — `supportedDirections` field (derivable from segments); keeping the unreachable
  常磐線各駅停車 by default (left to the user, R3).
- `jrx-engine` (`.claude/logs/codex/20261012T022037Z-jrx-engine.md`, read-only): adopted — atomic optional-choice
  seam with shared internal helpers, skip-when-forced draws, `[1, -1]` direction order, `…DrawRequired` flags,
  `landing.ts` module, two-pass restore with whole-record comparison, linear replay accumulator, endpoint-at-goal
  not an exact stop. Changed the architect's draft on R1 (draft: keep direction at k = 1): Codex reads the spec as
  re-draw; adopted as the baseline, R1-b offered to the user.
- `jrx-plan-review` (`.claude/logs/codex/20261012T024222Z-jrx-plan-review.md`, read-only): adopted — re-sequenced
  plan keeping CI green per step (pipeline preparation behind v1 output, atomic v2 cutover incl. E2E helpers, data
  commit after UI + fixture E2E); presentation contract (ridden vs committed service/direction, reveal on accepted
  finish, network-aware `lastMoveOf`); target-scoped filters; platform-aware initial/fallback positions; viewport
  fit; single-dataset E2E with disk-read expectations; self-contained seed installer with pinned game seeds and
  separate terminus/boundary proofs; guarded real-data test with seeded restore; R1 status made consistent; goal
  predicate kept as "final rolled step"; C6 wording; deep copy of nested metadata; production smoke check.
  Not adopted — nothing material rejected.
