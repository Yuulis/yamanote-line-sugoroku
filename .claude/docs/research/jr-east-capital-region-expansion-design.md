# JR East 1都3県 (capital-region) edition — Architecture design and implementation plan

Date: 2026-10-12 · Updated: 2026-10-13 (S0 complete; catalog v2 approved; LF hashes and product IDs frozen) · Architect (Agent Teams `feature-jr-east-capital-region-expansion`) · Design only, no product code
changed. Extends (does not rewrite) the shipped 23-ward design `jr-east-tokyo-expansion-design.md`.

Inputs: brief `feature-jr-east-capital-region-expansion-brief.md`, codebase scan
`feature-jr-east-capital-region-expansion-codebase.md`, revised research **catalog v2** (user-approved 2026-10-13)
`jr-east-capital-region-catalog-v2.csv` (666 rows, 40 services, 472 stations) +
`jr-east-capital-region-services-v2.csv` + `jr-east-capital-region-expansion.md`, `.claude/docs/DESIGN.md` Key Decisions
(user decisions recorded on 2026-10-13; decision-table dates are 2026-10-12).
Catalog v1 FINAL (965 rows, 60 services, 475 stations; sha256 prefix `244bd49d40a957fa`) and its Monte Carlo
results in §8.1–§8.3 remain historical evidence. Codex consultations: `.claude/logs/codex/*-jrcr-*.md` (§13).

Status legend: **DECIDED** (architecture) · **RESOLVED** (user decision on 2026-10-13, §12) ·
**FIXED** (earlier user decision in the brief). No Q1–Q11 user choice remains pending.

---

## 1. Summary

- **Revised network (catalog v2; user-approved 2026-10-13):** 472 JR East stations in 東京/千葉/神奈川/埼玉, 40 services =
  36 local patterns + 3 rapid-track bases + the 高崎線・東海道線 route of 湘南新宿ライン (快速 is its base type). Upper train types are excluded. 久留里線
  ends at 久留里. All stations are reachable from 新橋 and can return; no dropped service was a station's only
  service. There are 666 service-stop rows, 121 transfer stations, at most 10 candidates (東京), 627 undirected
  service segments and 527 distinct station pairs. Hub k: 東京10 / 新宿7 / 大宮6 / 横浜5 / 千葉5. Through-running uses catalog-default splits, retaining JR-named
  through services whole. 23-ward edition: 67 stations, 5 services, 146 directed segments.
- **Approved lottery rules (Q1(c)):** 山手線 has probability 1/2 at its own stations, remaining candidates share
  the rest uniformly; the direction toward 山手線 weighs 2:1. Catalog v2 gives **61 / 148 / 258** turns
  (median / p90 / p99; 50,000 games, seed 20261012); **4 games over 500**, no cap hits. With unchanged rules:
  **394 / 962 / 1,647**, 19,248 games over 500. The adopted rule's median stays within the 60–70-turn target and
  agrees closely with v1 local39 (62 / 153 / 269 at 20,000 games). Goal remains unchanged (Q2(a)).
- **Architecture:** data contract v3 (multi-feature segments composed from service-owned primitives, line metadata,
  `service-boundary` endpoints); engine movement untouched; lottery-policy seams in `GameConfig` (per-kind base
  weights, target weight or target share, toward-target direction weight by hop distance) with one weighted draw that
  reduces to today's `drawIndex(k)` when all weights are equal; `SAVE_VERSION` 3. Pipeline gains per-pair recipes
  (`route` over one or more N02 lines, `compose` over owner services), prefecture registry, homonym-safe matching,
  two-way reachability, per-dataset coverage oracles and raw+gzip budgets. Map: one GeoJSON source, line-coloured
  base, current-service highlight, separate initial/overview cameras.
- **Plan:** S0 integration base and id mapping → S1 engine seams → S1M real-engine MC harness → S2 atomic v3 cutover on
  23-ward data → S3a/S3b pipeline → S4 map/UI → S0b approved catalog → S6P regional staging → S6 final data (one
  commit) → S5 rules flip → S7 docs and release. High complexity: S1, S2, S3a, S3b, S6P, S6 (S4 Medium-High).
- **User decisions (§12):** Q1(c) lottery levers; Q2(a) unchanged goal; Q3 track-system service definition;
  Q4(a) catalog-default through-running splits; Q5(a) equal base weight per service; Q6(b) 久留里 truncation;
  Q7 catalog-default operational splits; Q8(a) weekday patterns; Q9(a) one station identity; Q10(a) subtitle
  「JR東日本 1都3県版」; Q11 PR #4 already in production, new work branches from `develop`.

---

## 2. Rules as decided (user decisions 2026-10-13)

**FIXED scope:** replace the 23-ward edition entirely (no edition selector); include JR East conventional lines
and branches in the four prefectures, truncated at the last in-area station. Exclude Shinkansen, JR Central,
private railways, subways, monorail, りんかい線, islands and 特急. Reject old saves with the existing discard UI.

**RESOLVED service definition (Q3/Q5/Q8):** a service represents a track system with its base stop pattern.
Use every v1 `local` line/branch pattern, including `shonan_shinjuku_local`, `keihin_tohoku_negishi`,
`chuo_sobu_local`, `saikyo_kawagoe` and `sotetsu_direct`. Separate 快速線 tracks retain `chuo_rapid`
(中央快速線), `sobu_rapid` (総武快速線 東京–千葉) and `joban_rapid` (常磐快速線). Also retain
`shonan_shinjuku_rapid_takasaki` (神保原–小田原): 快速 is the base type of the 高崎線・東海道線
湘南新宿 route because that route has no 普通. Both JR-named 湘南新宿 routes stay whole as operated;
`shonan_shinjuku_local` covers the 宇都宮線・横須賀線 route (栗橋–逗子). Drop
`shonan_shinjuku_rapid_utsunomiya` as an upper type of that local route and `shonan_shinjuku_special_rapid`
as an upper type of the retained 高崎線・東海道線 rapid route. Every other v1 rapid is excluded as an upper
type of its represented base route. Use weekday stops and equal base lottery weights, including separate
緩行線 and 快速線 services. Catalog v2 has 40 services; v1
`service_type` values remain unchanged for traceability. The v1 `core`/`optional` recommendation is historical
metadata, not the v2 selection rule.

**RESOLVED endpoints and identities (Q4/Q6/Q7/Q9):** split through-running at the catalog's line junctions;
JR-named through services stay whole at their retained catalog extent. Map CSV `through-split` to product
`service-boundary`, displayed as 「系統の端」. Preserve catalog-default 八高/青梅/成田/内房 and 高尾–藤野 splits;
久留里線 is 木更津–久留里 (11 stops), with 久留里 a playable terminus. 平山, 上総松丘 and 上総亀山 are outside
the approved playable catalog. 東京 (京葉 platforms), 武蔵小杉 and 浜川崎 each retain one station id and permit
transfers; distinct nearby station names never connect (船橋/南船橋, 稲毛/稲毛海岸 …).

**Carried over unchanged (Q2(a)):** station-by-station movement along the ridden service; an endpoint
(terminus, area boundary or service boundary) mid-move stops and discards remaining pips; landing only at the
arrival station; service draw iff k ≥ 2, then direction draw iff the chosen non-target service has two movable
directions; forced choices consume no draw; candidate order = `services.json` order; 山手線 always outer;
R1-a (direction re-drawn at every landing). Goal = 30 山手線 outer segments + arrive at 新橋: truncate on 山手線,
exact stop on any other service. The pass-through variant in §8.4 is a comparison only and is not adopted.

Invariants (**DECIDED**, Codex architecture review):
- One pip = one **stop of the ridden service**. Stations the service passes are never landings, transfers, goal
  arrivals or progress (passing 新橋 without stopping does not clear the game).
- Geometry sharing never shares progress: another service riding 山手線-owned track never completes 山手線 segments.

Lottery policies (**RESOLVED Q1(c)/Q5(a)**; configurable seams remain in §4). All weights are positive safe integers:
- **Service draw:** set every `kindWeights` entry to 1 and `target: {kind: "share", numerator: 1, denominator: 2}`.
  When 山手線 is a candidate among k ≥ 2 services, its weight is k−1 and every other candidate weighs 1: exactly
  probability 1/2 for 山手線, with the remaining share uniform. Stations without 山手線 remain uniform.
  For the general share seam, 山手線 weighs `p·Σbᵢ(others)` and each other candidate `(q−p)·bᵢ`; the weight seam
  instead uses `w·b` for 山手線. One draw: all equal weights → `drawIndex(k)`; otherwise `drawIndex(total)`
  mapped to cumulative intervals in candidate order. These alternate configs support historical comparisons,
  not unresolved product choices.
- **Direction draw:** `towardTargetWeight: 2` on non-target services with two movable directions. The direction
  whose next stop has smaller hop distance to 山手線 weighs 2 and the other 1; equal distances remain uniform.
  Distance = multi-source BFS over **reversed** directed gameplay segments from every 山手線 stop (one segment
  = one hop, rapid-track hops count once, transfers free), computed once per network and target.
- The rule change uses a new `rulesetVersion`, `jr-east-capital-1`; the subtitle is 「JR東日本 1都3県版」 (Q10(a)).

---

## 3. Data model changes (contract v3)

| # | Decision (**DECIDED**) | Rejected alternative (why) |
|---|---|---|
| D1 | `Segment.geometryFeatureIds: NonEmptyArray<string>` in the directed segment's **travel order**; the reverse segment carries the reversed list. Each primitive feature is oriented by exact station identity (`from/to`); the chain must start at `segment.from`, be contiguous and end at `segment.to`. | Same +1 list for both directions (consumers would need the stop order to orient); `reversed` flags or pass-through station arrays (redundant with identity chaining). |
| D2 | Features stay **service-owned primitives** `<owner>:<a>~<b>` (existing per-service DP routing); properties `{featureId, serviceId (owner), lineId, from, to}`. Rapid / through hops reference the owners' primitives (composition); a hop with no owner track is routed by its own service and becomes an owner. | Corridor-first model (new identity/ownership design, per-corridor platforms, larger rewrite; identical station pairs on physically different tracks must never be merged). |
| D3 | `services.json` becomes `{ lines: LineMetadata[], services: ServicePattern[] }`; `LineMetadata {id, name, color}`; `ServicePattern` gains `kind: "local" \| "rapid" \| "special-rapid" \| "medium-distance"` and `lineIds: NonEmptyArray<LineId>` (legend grouping, base colour, lottery base weights). | Per-service colour only (JR colours repeat across 中央快速/東海道/宇都宮/高崎; legend of 50 rows). |
| D4 | `EndpointKind = "terminus" \| "area-boundary" \| "service-boundary"`; `service-boundary` = a catalog split where trains continue on another catalog service (UI: 「系統の端」 not 「終点」). Behaviour identical to the other kinds (stop, discard pips). | Engine through-running continuation (T3: `MoveRecord` legs, replay and animation changes; rejected for this edition). |
| D5 | `manifest.schemaVersion: 3`; `dataVersion` = content hash (unchanged mechanism); same five public files. Compact JSON for `segments.json` (one object per line, like the GeoJSON writer). | A sixth file for lines; dropping `segments.json` (derivable, but every consumer and guard reads it). |
| D6 | Registry `data/overrides/stations.csv`: `id,name,n02_name,prefecture,municipality,representative_service_id[,n02_selector]`; area = prefecture ∈ {東京都, 千葉県, 神奈川県, 埼玉県}; ids unique, names not identity (homonyms resolved by id + N02 group/line selector, not rejected outright). | Name-based identity; N03 polygons as a pipeline input (stays a one-off audit). |
| D7 | **Product ids keep the shipped convention**: the 67 existing station ids and the service ids `jr-yamanote`, `jr-keihin-tohoku` … are preserved; research ids (`yamanote`, `keihin_tohoku_negishi`, machine-Hepburn station ids) are mapped once in S0 to reviewed `jr-*` service ids and frozen station ids. `MVP_GAME_CONFIG.targetServiceId` stays `jr-yamanote`. | Adopting research ids verbatim (would change `gameConfig.ts`, fixtures and the expected-count map mid-plan). |

TypeScript sketch (`src/types/network.ts`, `src/types/data.ts`): as in the Codex consult
`.claude/logs/codex/20261012T141414Z-jrcr-architecture.md` § "Recommended contract v3 sketch", with the lottery
config of §4 instead of its `weightsByServiceId` maps. Guards validate: non-empty id arrays of strings, `lineIds`
known, `kind` enum, `endpoints` iff linear, platform-key set = `stationIds`.

---

## 4. Engine changes

Movement (`movement.ts`), goal (`goal.ts`) and the atomic turn API are unchanged: a rapid service is already
structurally valid (`network.ts:118-132` checks adjacency inside the service's own `stationIds`).

```ts
type ServiceKind = "local" | "rapid" | "special-rapid" | "medium-distance";
interface ServiceLotteryPolicy {
  kindWeights: Readonly<Record<ServiceKind, number>>;          // base weights b_i; all 1 = uniform
  target: { kind: "weight"; weight: number }                   // 1 = uniform
        | { kind: "share"; numerator: number; denominator: number }; // 0 < p < q
}
interface DirectionLotteryPolicy { towardTargetWeight: number } // 1 = uniform
interface GameConfig { /* existing 5 fields */ serviceLottery: ServiceLotteryPolicy; directionLottery: DirectionLotteryPolicy }
```

| File | Change |
|---|---|
| `rng.ts` | `drawWeightedIndex(rngState, weights)`: positive safe integers, total ≤ 2^32, **all weights equal (any value) → exactly `drawIndex(k)`**, otherwise `drawIndex(total)` mapped to cumulative intervals in candidate order; no GCD normalisation (contract fixed now). Rejected draws advance the state; k = 1 never reaches it. |
| `proximity.ts` (new, pure) | `targetHopDistances(network, targetServiceId): ReadonlyMap<StationId, number>` (reverse-edge multi-source BFS, §2); computed only when `towardTargetWeight ≠ 1`, cached per (network, target) without mutating either. |
| `landing.ts` | `LandingOptions` gains `serviceWeights` and `directionWeightsByService`, resolved from the policies; `drawLanding` uses the weighted draw in the existing order (service, then direction); `resolveLandingEvent` validates injected choices without weights. Ruleset comment updated. |
| `config.ts` | Validate policies: known kinds, integers 1 ≤ b, w ≤ 1,000, 0 < p < q ≤ 1,000 (so every derived total stays far below 2^32 for k ≤ 64), unknown keys rejected. Existing checks unchanged. |
| `types.ts`, `network.ts` (types) | new config types; deep copy of nested config and of `geometryFeatureIds` arrays. |
| `save.ts`, `game.ts` | `SAVE_VERSION = 3` (config gains required fields); `parseConfig`/`sameConfig` compare policies by meaning (not key order); v2 → `UNSUPPORTED_SAVE_VERSION` → existing discard UI. Two-pass restore kept. |
| `gameConfig.ts` | `MVP_GAME_CONFIG` keeps all-equal weights until S5; then adopted Q1(c)/Q5(a) with `rulesetVersion: "jr-east-capital-1"`. |

Performance (provisional): a scratch harness played ≈ 40 µs per turn on the historical v1 475-station network with the history
array cleared every turn (2,000 games × ≈ 650 turns in 54 s). That excludes history growth, save and restore, so it
is not an acceptance number; S6 measures 300/1,000-turn save and restore on a phone (target ≤ 500 ms restore) and
optimises only if it fails.

---

## 5. Pipeline changes

- **Recipes per +1 pair** (`services/<id>/line_mapping.csv` grows a `recipe` column; rows keep `from_id,to_id`):
  - `route`: one **or more** N02 lines (`|`-joined, constrained graph over the union; needed for hops such as
    湘南新宿 大崎→西大井 or 池袋→赤羽) + ordered via points;
  - `compose`: ordered legs `(source_service, from, to)` over owner services (multi-owner allowed), plus
    `shared_track_evidence` (same N02 line + section filter). Expanded at build time into a flat feature-id list; the
    dependency DAG is resolved in its own order, **never** reused for output or lottery order.
- **Anchors:** composed chains join only at shared primitive endpoints (exact coordinates after simplification); no
  straight-line joins (`network.py:60` `concat_lines` must not bridge different platforms); the 30 m platform
  tolerance is not a joint tolerance. A rapid's platform point at a shared stop is inherited from the owner chain.
- **Registry and area:** prefecture/municipality columns; area rule by prefecture; the 23-ward scope expressed as
  data, not code; `CANDIDATE_SEARCH_BBOX`/`OUTPUT_BBOX` become dataset config shared by build and validate; homonym
  selectors; `N02_004 == 東日本旅客鉄道` filter kept.
- **Curation checks relaxed by kind:** station numbers strictly monotonic with gaps for rapid, per-prefix runs for
  through services; detour exceptions in a reviewed table with reasons (no global loosening); offset exceptions as
  today (東京 京葉, 武蔵小杉 ~400 m).
- **Coverage oracle per dataset:** `dataset.json` names an expected-catalog file (service ids in output order + stop
  lists + hash). The 23-ward dataset keeps its own 5-service catalog until S6; S6P staging bundles name their stage
  catalog; the final dataset names the **approved catalog** (S0b). Overrides must equal the named catalog, so
  dropping a service from both overrides and output cannot pass silently.
- **Validator v3 (changes to the 17 rules):** 1 schema v3 + configured bbox; 2–3 registry/prefecture + catalogue =
  the dataset's expected catalog; 9–11 owned pair set and used chain set validated separately (non-empty, ids exist,
  contiguous, oriented, correct last station, no back-and-forth, owner exists); 12 joints exact; 13 skipped-stop check
  stays per service (a rapid's own stops only; still catches a route that jumps over a stop it serves); 14 length per
  service = sum of chain lengths per +1 hop; 15 **every station reachable from 新橋 and back** (no disconnected
  whitelist); 17 budgets on raw and gzip bytes of all five files + total reference count + max chain length.
- **Determinism:** byte-identical rebuild (local, raw N02 pinned) and canonical-bytes check in CI, unchanged;
  extrapolated build time ≈ 1 min (3.3 s today for 92 pairs); Dijkstra early exit only if needed.
- N02 facts to encode (researcher §6): no 国立支線 (むさしの号 excluded by resolved Q3); 湘南新宿 池袋–赤羽 needs
  explicit 赤羽線/田端 handling; 常磐線 meets 東北線 at 日暮里 mid-segment (split or T-junction); 鶴見線, 八高線,
  南武線, 相模線 joins are 25–62 m gaps (fine while each service stays on its own lines).

---

## 6. Map and UI

- **Layers** (one railway GeoJSON source, static, never re-set per frame): (1) `railway-base` every primitive in its
  line colour, thin; (2) `railway-current-service` primitives of the highlighted service in **that service's colour**
  (filter `in featureId` from an index built once per network); (3)–(4) 山手線 pending/completed unchanged; stations,
  labels (minzoom raised, collision on), marker. The uniform `line-offset: 4` is dropped (it cannot separate dozens of
  services).
- **Highlight timing** follows the existing presentation contract: ridden service while animating, landing result
  after the accepted `animation-finished`.
- **Camera:** initial view = 山手線 bounds (start at 新橋 readable); an 「全体」 overview fits all 472 approved stations;
  `MAP_MIN_ZOOM` set from measurement (≈ 7 on a 390 px phone); real-data E2E asserts the initial view contains all
  山手線 platforms and the overview contains every station.
- **Legend:** grouped by line (~30 lines), collapsible, with the current service named separately (e.g. ■ 中央線快速).
- **Lottery text** at hubs: result first (「東京：10系統から抽選 → 京葉線」), full candidate list expandable;
  `aria-live` announces the result only.
- **Clear screen:** paged / collapsible history (games of several hundred turns).
- **Animation:** composed hops render as one `StepPath` (no extra steps at passed stations). Hop duration by path
  length is optional (clamped) and not in the S4 baseline.
- **Budget (proposed, to be measured on the built data):** `segments.geojson` ≤ 1.5 MiB raw / ≤ 450 KiB gzip; five
  files ≤ 3 MiB raw / ≤ 900 KiB gzip. Estimate: ≈ 1,630 km N02 track at today's 330 B/km ≈ 0.55 MB plus owner
  duplicates. Compare `SIMPLIFY_TOLERANCE_M` 1 / 3 / 5 m at 6 decimals before considering 5 decimals. Phone
  acceptance: data parse + network build + layer init ≤ 1 s, p95 frame ≤ 33 ms while animating/panning. Vector tiles
  only if these fail.

---

## 7. Saves and migration

- `schemaVersion` 3 (data shape), `dataVersion` (content), `rulesetVersion` `jr-east-capital-1` (semantics),
  `SAVE_VERSION` 3 (saved config gains required lottery fields). Storage key unchanged.
- Any 23-ward save is rejected (`UNSUPPORTED_SAVE_VERSION`, and `DATA_VERSION_MISMATCH` anyway) with the existing
  「対応していない形式」 + 「セーブデータを破棄」 UI; no migration (FIXED).
- Size: a 1,000-turn save ≈ 300–400 KB (completed ids + traversed ids); fine for localStorage. Measure synchronous
  save cost per committed turn in S6.

---

## 8. Monte Carlo results

**Historical v1 method (§8.1–§8.3).** A graph-level **distributional replica** of the engine rules
(`.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/montecarlo.mjs`; float-interval sampling from
an sfc32-style PRNG, seed **20261012**, cap 20,000 turns, capped games would count as cap+1 — none occurred) on the
**researcher catalog v1 FINAL** (965 rows, 60 services; sha256 prefix `244bd49d40a957fa`; converted by
`catalog_to_network.py`; option B by `option_b.py`). It compares outcome distributions; it does **not** reproduce
the engine's RNG consumption or seed sequences (integer modulo with rejection sampling). Lever rules use one weighted
service draw with exactly the §2 weights. An earlier DRAFT of the same catalog (965 rows, same topology; 9 stations
later re-id'd) gave the same baseline numbers.

**Validation.** The replica reproduces the published 23-ward results (52 / 114 / 183 vs 52 / 114 / 189; R1-b 55 / 119
/ 194 vs 55 / 119 / 191). The **real engine** (`createGame`/`playTurn` via the scratch Vitest harness
`engine-crosscheck.test.ts`, uniform rules only, a distribution comparison without statistical assertions) gives
51 / 114 / 186 on 23-ward (5,000 games) and **578 / 1,250 / 1,938** on the final core network (2,000 games) vs
replica 572 / 1,250 / 2,016 (50,000 games). Lever rules exist only in the replica until S1/S1M re-measure them with
the real engine.

Columns: "> 500" with the game count in brackets where small; "Endgame" = turns from the first moment the row's
collection target is met (30 segments, 30 stations, 4 prefectures or 15 segments) to clearing (median/p90); "Lottery
events" = service + direction draw events per game; "On 山手線" = share of turns ridden on 山手線. Time ≈ 2.5 s per
turn (≈ 3.3 hops × 450 ms + click).

### 8.1 Historical v1 FINAL, core 51 services, 50,000 games, seed 20261012

| Rule (sim name) | Median | p90 | p99 | Mean | > 200 | > 500 | > 1000 | Max | Endgame | Lottery events | On 山手線 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A. Current rules unchanged** (`baseline`) | **572** | **1,250** | **2,016** | 657 | 87.8 % | 57.2 % | 19.2 % | 4,087 | 11 / 245 | 995 | 3.9 % |
| B. Pass-through goal (`pass`) | 527 | 1,174 | 1,939 | 613 | 85.9 % | 52.9 % | 16.2 % | 4,312 | 4 / 107 | 928 | 3.9 % |
| C. R1-b: keep direction at k = 1 (`keepDir`) | 571 | 1,196 | 1,915 | 643 | 88.2 % | 57.3 % | 17.8 % | 3,772 | 14 / 240 | 819 | 4.0 % |
| D. Local 2 : rapid 1 (`rapidHalf`) | 451 | 1,076 | 1,820 | 539 | 80.0 % | 44.8 % | 12.5 % | 4,045 | 7 / 209 | 783 | 4.6 % |
| E. 山手線 weight ×2 (`yw2`) | 243 | 634 | 1,116 | 303 | 58.2 % | 18.0 % | 1.8 % | 2,558 | 3 / 138 | 450 | 7.5 % |
| F. 山手線 weight ×3 (`yw3`) | 139 | 420 | 801 | 189 | 35.5 % | 6.3 % | 0.3 % | 2,049 | 2 / 85 | 274 | 11.0 % |
| G. 山手線 share 1/3 (`ythird`) | 258 | 653 | 1,151 | 319 | 61.1 % | 19.2 % | 2.1 % | 2,553 | 5 / 119 | 472 | 8.6 % |
| H. 山手線 share 1/2 (`yhalf`) | 96 | 303 | 634 | 136 | 21.6 % | 2.5 % | 0.08 % | 1,720 | 1 / 50 | 192 | 16.3 % |
| I. H + pass-through (`yhalfPass`) | 91 | 291 | 616 | 130 | 20.0 % | 2.2 % | 0.08 % | 1,405 | 1 / 29 | 184 | 16.5 % |
| J. Toward 山手線 2:1 (`inbound2`) | 291 | 590 | 922 | 324 | 70.3 % | 17.0 % | 0.6 % | 1,859 | 9 / 113 | 520 | 7.8 % |
| K. Toward 山手線 3:1 (`inbound3`) | 240 | 474 | 737 | 265 | 61.2 % | 8.1 % | 0.09 % | 1,627 | 8 / 90 | 426 | 9.6 % |
| L. J + pass-through (`passInbound2`) | 270 | 556 | 895 | 303 | 66.6 % | 14.0 % | 0.5 % | 1,819 | 4 / 53 | 486 | 7.9 % |
| M. G + toward 2:1 (`ythirdInbound2`) | 146 | 319 | 527 | 168 | 31.3 % | 1.3 % | 0 % | 1,044 | 5 / 57 | 257 | 16.3 % |
| **N. H + toward 2:1 (`yhalfInbound2`) — later adopted** | **63** | **154** | **271** | 77 | 4.2 % | 0.008 % (4) | 0 % | 602 | 1 / 28 | 108 | 28.7 % |
| O. N + pass-through (`yhalfInbound2Pass`) | 61 | 149 | 265 | 75 | 3.6 % | 0 % (0) | 0 % | 488 | 1 / 18 | 104 | 28.8 % |
| P. H + toward 3:1 (`yhalfInbound3`) | 57 | 130 | 223 | 67 | 1.7 % | 0 % (0) | 0 % | 435 | 1 / 24 | 92 | 33.3 % |
| N5. N + local 2 : rapid 1 (`yhalfInbound2Rapid`) | 64 | 162 | 288 | 80 | 5.1 % | 0.024 % (12) | 0 % | 718 | 1 / 28 | 111 | 27.6 % |
| Q. Alt goal: visit all 30 山手線 stations (as stops of any service) then 新橋, pass-through (`yStationsPass`) | 343 | 886 | 1,572 | 426 | 70.9 % | 32.6 % | 6.9 % | 3,404 | 8 / 127 | 645 | 4.0 % |
| R. Alt goal: stop in all 4 prefectures then 新橋, pass-through (`pref4Pass`) | 211 | 504 | 865 | 258 | 52.7 % | 10.2 % | 0.4 % | 1,859 | 50 / 234 | 390 | 4.3 % |
| S. Alt goal: any 15 of the 30 segments + 新橋 (`y15`) | 184 | 551 | 1,028 | 248 | 46.7 % | 12.5 % | 1.1 % | 2,605 | 43 / 294 | 375 | 4.2 % |

Reference: 23-ward edition (shipped) 52 / 114 / 189, 0 % over 500. In Q and R the start station and every stop of
every hop count as visited (passed-through stations of a rapid do not).

### 8.2 Historical v1 catalog variants (20,000 games, seed 20261012)

Cells: median / p90 / p99, games over 500 in brackets.

| Network | Services / k max | A. unchanged | H. 1/2 | N. 1/2 + toward 2:1 | O. N + pass |
|---|---|---:|---:|---:|---:|
| Core 51, catalog default splits † | 51 / 13 | 572 / 1,250 / 2,016 | 96 / 303 / 634 | 63 / 154 / 271 (4 of 50k) | 61 / 149 / 265 (0) |
| Core 50 without 京浜東北線快速 | 50 / 12 | 519 / 1,186 / 1,982 | 99 / 316 / 655 | 64 / 157 / 279 (2) | 60 / 154 / 264 (1) |
| All 60 (incl. the 9 optional) | 60 / 18 | 665 / 1,409 / 2,281 | 92 / 273 / 560 | 66 / 157 / 276 (3) | 62 / 150 / 266 (0) |
| All 59 (optional without むさしの号, whose N02 route is missing) | 59 / 18 | 653 / 1,365 / 2,259 | 91 / 274 / 572 | 65 / 153 / 265 (2) | 62 / 148 / 267 (2) |
| Core, option B (`option_b.py`: 上野東京ライン 湯河原–栗橋/神保原, 横須賀⇔総武快速 久里浜–千葉, 武蔵野⇔京葉 府中本町–東京 + 西船橋–海浜幕張 merged as operated) | 48 / 12 | 570 / 1,211 / 1,979 | 99 / 306 / 609 | 66 / 158 / 273 (2) | 62 / 150 / 271 (4) |
| Minimal: 36 locals + `chuo_rapid`, `sobu_rapid`, `joban_rapid` (researcher's suggestion; covers all 475 stations) | 39 / 10 | 357 / 910 / 1,602 | 100 / 352 / 735 | 62 / 153 / 269 (1) | 58 / 148 / 259 (1) |
| Local services only (not a valid edition: 13 stations unserved, 高尾・相模湖・藤野 unreachable from 山手線) | 36 / 7 | 282 / 912 / 1,802 | 92 / 406 / 1,014 | 60 / 152 / 282 (5) | 56 / 143 / 263 (5) |

† 50,000-game values from §8.1.

### 8.3 Historical v1 interpretation

- Under uniform lotteries the player spends only 3.9 % of turns on 山手線: leaving costs (k−1)/k at hubs with
  k = 5–13, returning needs a random walk over 475 stations. Changing the goal rule alone (B, Q, R, S) keeps games
  far longer than the 23-ward edition; the levers that work restore the **return probability**.
- H alone fixes the median but leaves a long tail (p99 634); the direction lever J alone fixes the tail but not the
  median; together (N) they land at 1.21× (median), 1.35× (p90) and 1.43× (p99) of the 23-ward edition.
- Among the compared graph variants (core 51/50, minimal 39, all 59/60, option B; all 60 is not implementable as is, Q3), the
  choice is **length-neutral under N** (median
  62–66, p99 265–279); without levers the optional rapids add ≈ 80–90 turns to the median and 京浜東北線快速 adds ≈ 50.
- Local 2 : rapid 1 (D, N5) shortens the uniform game but slightly lengthens the tail under N (p99 288 vs 271).
- No game hit the 20,000-turn cap; the tail is not a bound (no history cap; real-data tests use fixed seeds with a
  safety cap reported as failure).

### 8.4 Revised catalog v2 confirmation (user-approved 2026-10-13)

The read-only v2 validation `.claude/logs/codex/20261013T002322Z-jrcr-v2-validation.md` returned
**NEEDS_REVISION** for the former 39-service / 630-row selection: it wrongly removed the base
高崎線・東海道線 湘南新宿 route. The lead's correction restores `shonan_shinjuku_rapid_takasaki`
(36 v1 evidence rows, 神保原–小田原). No other selection changes; the two upper 湘南新宿 types remain
excluded. Both named 湘南新宿 base routes now stay whole. The revised research catalog was **user-approved on 2026-10-13**. The earlier v1 round-2
APPROVE is historical evidence, not a new independent v2 review.

The catalog is derived solely from v1 evidence, with v1 service/stop order preserved and no timetable
re-scrape. Relative to `net-final1-local39.json`, it adds the restored route in v1 order and removes the
last three `kururi` stops. `catalog_to_network.py` needs no change: use `net-v2-all.json` (core differs
only in its label). The local-only output (36 services, 459 stations) remains a diagnostic subset.

| Catalog version | Service-stop rows | Services | Stations | Catalog SHA-256 | Samples per rule | Seed | Turn cap |
|---|---:|---:|---:|---|---:|---:|---:|
| v2 revised | 666 | 40 (36 local + 3 rapid-track bases + 1 rapid through-route base) | 472 | `ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4` | 50,000 (200,000 total) | 20261012 | 20,000 |

Same graph-level distributional replica and quantile convention as v1; each rule starts its own PRNG at
the listed seed. This is not an engine seed-exact run. Cap hits are zero under all four rules. The adopted
goal stays Q2(a); the pass-through run only measures an alternative.

| Rule (sim name) | Median | p90 | p99 | Mean | > 500 count / samples | > 500 share | Max | Cap hits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Current rules unchanged (comparison) (`baseline`) | 394 | 962 | 1,647 | 475.14 | 19,248 / 50,000 | 38.496 % | 3,277 | 0 |
| 山手線 1/2 only (comparison) (`yhalf`) | 98 | 337 | 700 | 146.03 | 1,842 / 50,000 | 3.684 % | 1,626 | 0 |
| **Q1(c): 山手線 1/2 + toward-山手線 2:1 (ADOPTED)** (`yhalfInbound2`) | 61 | 148 | 258 | 73.93 | 4 / 50,000 | 0.008 % | 599 | 0 |
| Q1(c) + pass-through goal (comparison; Q2 unchanged) (`yhalfInbound2Pass`) | 58 | 142 | 252 | 71.02 | 3 / 50,000 | 0.006 % | 550 | 0 |

Comparison cells = median / p90 / p99; >500 counts retain their sample denominator so the 20k and 50k
runs are not treated as equally sized samples.

| Rule | v1 core51, 50k | v1 local39, 20k | v2 revised40, 50k |
|---|---|---|---|
| `baseline` | 572 / 1,250 / 2,016; >500: 28,606/50,000 | 357 / 910 / 1,602; >500: 6,892/20,000 | 394 / 962 / 1,647; >500: 19,248/50,000 |
| `yhalf` | 96 / 303 / 634; >500: 1,238/50,000 | 100 / 352 / 735; >500: 832/20,000 | 98 / 337 / 700; >500: 1,842/50,000 |
| `yhalfInbound2` | 63 / 154 / 271; >500: 4/50,000 | 62 / 153 / 269; >500: 1/20,000 | 61 / 148 / 258; >500: 4/50,000 |
| `yhalfInbound2Pass` | 61 / 149 / 265; >500: 0/50,000 | 58 / 148 / 259; >500: 1/20,000 | 58 / 142 / 252; >500: 3/50,000 |

**Interpretation:** Q1(c) stays within the intended 60–70-turn median (61), with p90/p99 148/258.
The former, unapproved 39-service v2 gave 62/153/267 (>500: 3/50,000); restoring the base through route
changes that to 61/148/258 (>500: 4/50,000). Relative to v1 core51 the adopted rule changes 63/154/271 to
61/148/258, and relative to v1 local39 it changes 62/153/269 to 61/148/258. These are distribution
comparisons; differing sample sizes and the added service prevent attributing the change solely to 久留里
truncation. The 23-ward reference is 52/114/189, so revised v2 is approximately 1.17×/1.30×/1.37×.
All-equal lotteries still yield long games (394 median, 38.496 % over 500). 山手線 1/2 alone gives
98/337/700; the adopted direction lever materially reduces the tail. Pass-through gives 58/142/252,
but Q2(a) explicitly retains the existing goal.

**Catalog verification:** `verify_catalog_v2.py` exits 0 against an explicit independent classification
table for all 60 v1 ids (40 keep / 20 drop, each with its base-route or upper-type reason). It does not
reuse the generator's `service_type` selection formula. All 472 stations have a service, are reachable
from 新橋 and can return on the undirected graph; service-selection orphans are zero. 久留里 is the final
playable terminus; 鶴見線 transfers at 浜川崎 and 鶴見. Schemas, ids, service/stop order, sources and train
evidence remain from v1; endpoint metadata changes only for Q6. There are 627 undirected service
segments, 527 distinct station pairs and 121 transfer stations; maximum k remains 10.

| Hub | Candidate count k |
|---|---:|
| 東京 | 10 |
| 新宿 | 7 |
| 大宮 | 6 |
| 横浜 | 5 |
| 千葉 | 5 |

The verifier reports these hubs' complete candidate lists in catalog order. S4/S5 must check the full
candidate lists of the final catalog at every transfer station, including restored through-route
candidates; maximum k alone is insufficient. No new Q1–Q11 decision item arose; research-input approval was granted on 2026-10-13.

**Reproduction from repository root:**

```bash
python3 .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/build_catalog_v2.py
python3 .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/verify_catalog_v2.py
sha256sum .claude/docs/research/jr-east-capital-region-catalog-v2.csv
cd .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim
python3 catalog_to_network.py ../../../../docs/research/jr-east-capital-region-catalog-v2.csv v2
node montecarlo.mjs net-v2-all.json --games 50000 --seed 20261012 --cap 20000 --rules baseline > run-v2-baseline-50k.jsonl
node montecarlo.mjs net-v2-all.json --games 50000 --seed 20261012 --cap 20000 --rules yhalf > run-v2-yhalf-50k.jsonl
node montecarlo.mjs net-v2-all.json --games 50000 --seed 20261012 --cap 20000 --rules yhalfInbound2 > run-v2-yhalfInbound2-50k.jsonl
node montecarlo.mjs net-v2-all.json --games 50000 --seed 20261012 --cap 20000 --rules yhalfInbound2Pass > run-v2-yhalfInbound2Pass-50k.jsonl
```

Saved outputs: `sim/run-v2-{baseline,yhalf,yhalfInbound2,yhalfInbound2Pass}-50k.jsonl` overwrite the former
39-service outputs. `sim/run-v2-manifest.json` records updated hashes, exact commands, sample settings,
results and catalog verification. The generator, verifier and rebuilt networks remain in the sim directory.
These replica results alone do not confirm the engine. S1M now completes that gate in §8.5;
S0b product-catalog output is implemented in §8.6 (pending lead verification).

### 8.5 S1M real-engine confirmation (2026-10-13)

**S1M is complete** on `feature/jrcr-s1m` after S1 merged (engine revision `c0a9866`).
The §8.4 replica-only limitation above is now resolved for approved research catalog v2;
S0b implementation is recorded in §8.6 (pending lead verification); S5's final-data remeasurement remains required.
Full summaries, configs, input hashes, seed-set hashes, comparisons and smoke results:
`jr-east-capital-region-s1m-results.json`. Runner: `tests/simulation/README.md`.

The harness builds a `RailwayNetwork` directly from the approved catalog/services CSVs
(666 rows / 40 services / 472 stations / 1,224 directed gameplay segments), preserving
service/stop order and the +1 outer loop from 新橋 to 浜松町. Synthetic geometry references and
coordinates are unused by gameplay; research `through-split` endpoints get synthetic `terminus`
metadata with identical stop/discard-pips behavior. No engine or shipped-data behavior changed.
Catalog SHA-256 (LF-normalized UTF-8 bytes):
`ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4`;
services CSV: `45ee942862f0def53625e76dbafbc4ab306cc181123d71bd37cf225d70746d8b`.

Each required preset ran **20,000 games**, base seed **20261012**, cap **20,000** on Node
`v24.21.0`. Per-game seed = `s1m-${baseSeed}-${zeroBasedGameIndex}`; both presets use the same
set (`0..19999`), SHA-256 over LF-joined seeds with final LF:
`0b085fc995e2ed7f062a72a1482f03f578bca2e78dc151517b8d8bd31aa5715e`.
Every transition calls real `createGame` / `playTurn`; history is discarded after each turn.
Small fixed-seed unit tests prove determinism, actual `playTurn` invocation and agreement of every
final state field with full-history direct runs for all presets. Measurements are excluded from
default Vitest; local acceptance: typecheck pass, **23 files / 513 unit tests passed**, both 200-game
smokes and both large runs passed. No dependencies or existing-test modifications.

| Preset | Games | Median | p90 | p99 | Mean | Max | >500 count / share | Cap hits | Runtime |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| **decided (Q1(c), Q2(a), Q5(a))** | 20,000 | **61** | **148** | **258** | 73.85715 | 481 | 0 / 0% | 0 | 44.15 s |
| all-equal (current-rule comparison) | 20,000 | 396 | 967 | 1,643 | 476.74730 | 3,179 | 7,707 / 38.535% | 0 | 319.00 s |

Nearest-rank quantiles match §8.4. Censored games would count as cap+1 and fail the command;
none occurred. Runtime measures game creation/transitions/statistics, excluding CSV loading and
Vitest startup. Neither preset exceeded 15 minutes, so no reduction to 10,000 games was needed.

Against the **50,000-game** replica: decided **61/148/258** is unchanged; all-equal
**394/962/1,647 → 396/967/1,643**, relative changes **+0.51% / +0.52% / −0.24%**.
Neither has a median deviation >10% or p99 deviation >15%; there is no material discrepancy to
investigate. Independent string seeds, integer modulo/rejection draws and the smaller sample make
this distributional confirmation, not seed-exact replica agreement. Reverse-BFS proximity agrees
with the replica's undirected distances on this catalog: all non-target edges are bidirectional,
and all target-loop stops are distance zero. Decided's 0/20,000 >500 versus replica 4/50,000 is
a rare-tail observation; maxima are sampled values, not game-length bounds.

The adopted rules retain their intended 60–70-turn median and much shorter tail; current equal
lotteries still yield long games. Product policies stay all-equal until **S5**, which reruns this
harness on the final regional data. `SIM_BUNDLE` supports shipped data through product guards;
S2 must update the adapter for the services envelope. Optional `decided-pass-through` uses the
existing engine seam and is unit-tested only; it does not change the decided goal. No geometry,
growing-history, save/restore or device-performance acceptance is claimed by these measurements.

---

### 8.6 S0b product-id catalog (2026-10-13; implemented, pending lead verification)

The approved research v2 is mapped through the frozen S0 crosswalk without changing service order,
stop order, station identity or endpoint semantics. Product kinds are **36 local / 4 rapid**;
the rapid services are `chuo_rapid`, `sobu_rapid`, `joban_rapid` and
`shonan_shinjuku_rapid_takasaki`. Research `through-split` maps to the S2 enum
`service-boundary`; `terminus` and `area-boundary` retain their names. Every endpoint stops
and discards remaining pips. All 5 shipped service IDs and 67 shipped station IDs are preserved.

| Product artifact | Rows | SHA-256 (UTF-8 / LF bytes) |
|---|---:|---|
| `jr-east-capital-region-product-catalog.csv` | 666 stops / 472 distinct stations | `3deb465895e55d381abd8b75adaddbc08ce7f242bb46b40ff88ea8c9c757a438` |
| `jr-east-capital-region-product-services.csv` | 40 services | `76d86cc98a312769151ca7cf9537b24822af21afe1a9113e827a2495d4fc3256` |

Catalog fields: `service_id,order,station_id,name_ja,prefecture,endpoint_kind,kind`.
`endpoint_kind` is populated only on the first/last stops of linear services; interior and
circular-service rows are empty. Service fields:
`service_id,research_id,name_ja,kind,circular,first_end_kind,last_end_kind,stop_count`.
The crosswalk hash remains `ca6a7c7c957ab153f787d78a040dc5d57fa044d59da758064a632789ab96885f`;
both research hashes in §8.5 are unchanged.

Generator/verifier: `.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/`
`build_product_catalog.py` / `verify_product_catalog.py`. The independent verifier checks every
mapped field, the bijection, ordering, endpoint placement, LF bytes and shipped identities.
The directed gameplay graph (Yamanote +1 only, other services bidirectional) has **1,224 segments**;
all **472 stations** are reachable from 新橋 and can reach 新橋. Endpoint occurrences:
36 `terminus`, 10 `area-boundary`, 32 `service-boundary`. Existing `verify_id_map.py` now reads
the S2 `services` envelope, keeping all identity/order/N02 checks intact; all three verifiers pass.

Real-engine rerun uses unchanged research v2, `decided`, seed **20261012**, cap **20,000**:

| Run | Games | Median / p90 / p99 | Mean | Max | >500 | Caps | Played turns | Runtime |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| Required S0b prefix | 2,000 | 62 / 151 / 262 | 75.93450 | 481 | 0 | 0 | 151,869 | 4.60 s |
| Additional full S1M comparison | 20,000 | 61 / 148 / 258 | 73.85715 | 481 | 0 | 0 | 1,477,143 | 45.40 s |

The 2,000-game seeds are `s1m-20261012-0` through `s1m-20261012-1999`, seed-set SHA-256
`c0c3da0876bf955573019e97263fa31f536a6776cde9350939c6a97474e46652`.
These are the independent-seed prefix of S1M, so smaller-sample quantiles need not equal the
20,000-game summary. The historical file has no per-game/prefix statistics for a direct prefix
comparison. To check S2 consistency, the additional 20,000-game rerun uses the same seed-set
hash as §8.5 and matches **every historical decided statistic exactly**, including total turns.
S2's two-kind weights and `service-boundary` metadata replace the historical unused kind weights
and synthetic `terminus` metadata without changing these gameplay results. The harness is unchanged.
Full runs, hashes and acceptance outputs: `jr-east-capital-region-s0b-results.json`.
Final product data/config remeasurement remains an S5 gate; no geometry/device acceptance is claimed.

---

## 9. Implementation plan

Integration branch `feature/jr-east-capital-region` off `develop`; step PRs into it; `.github/workflows/ci.yml`
must also run on PRs targeting `feature/**` (today only `master`/`develop`), so every step PR is checked as merged.
PR #4 (23-ward release) is already in production (Q11 resolved); the new branch starts from `develop`.
Every step keeps all three CI jobs green (frontend, pipeline, Playwright); data-changing steps attach a local byte-identical rebuild from raw N02.

| Step | Scope | Depends on | Files (owner) | Tests / done when | Complexity → route |
|---|---|---|---|---|---|
| **S0 — DONE (2026-10-13)** Integration base + id mapping | branch; CI trigger for `feature/**` PRs; research→product id map (D7: `jr-*` service ids, frozen station ids, 67 shipped ids kept); data-date record (timetable 2610, N02 2025-12-31) | — | `.github/workflows/ci.yml`, id-map file under `.claude/docs/research/` (lead) | three jobs run on a PR into the branch; id map covers approved revised v2: 40 services / 472 stations, unique; preserve the 67 shipped station ids | Low → lead |
| **S1** Engine rule seams (23-ward data, MVP stays all-equal) | §4: weighted draw, policies, proximity, save v3, config validation | S0 | `src/types/network.ts`, `engine/{rng,landing,config,network,game,save,types,index}.ts`, new `engine/proximity.ts`, `gameConfig.ts`, unit fixtures/tests (engine owner) | all-equal weights: identical rolls/choices/RNG states (existing snapshots untouched); forced = no draw; equal weights of any value delegate to `drawIndex`; weighted boundaries and rejection; share and weight formulas incl. kind bases; integer limits; distance ties, branch and rapid cases; save v3 round trips, v2 rejected, nested-config mutation | **High** → Opus + Codex review |
| **S1M — DONE (2026-10-13)** Real-engine MC harness | approved research v2; real `createGame`/`playTurn`; same entry point accepts shipped data | S1, research catalog (not S0b output) | `tests/simulation/**`, `vitest.simulation.config.ts`, npm `sim`, unit agreement test | §8.5: 20k games per preset, decided 61/148/258, all-equal 396/967/1643; zero caps; below discrepancy thresholds; 513 unit tests pass | Medium-High → Opus |
| **S2** Atomic v3 cutover on 23-ward data | §3 shape with one-element chains; minimal display follow-up | S1 | `scripts/data_pipeline/{overrides,export,validate,rules}.py`, `data/overrides/**`, `public/data/*`, `src/types/{network,data}.ts`, `src/data/{guards,loaders}.ts`, `networkFromData.ts`, `engine/network.ts` (copy), `animation/movePath.ts`, `GameApp.tsx`, map contract readers, all TS/E2E/Python fixtures, `tests/e2e/support/app.ts` (single owner) | owner vs chain checks; empty/missing/misordered references rejected; service/station order, routes and uniform trajectories unchanged; fixture v3 + `readMap`; local rebuild identical | **High** → Opus + Codex review |
| **S3a** Registry, area, routing preparation | prefecture/municipality, homonym selectors, configured bboxes, multi-line `route`, station-number rules, boundary truncation evidence, detour exceptions; v3 output byte-identical | S2 | `scripts/data_pipeline/{config,registry,overrides,build,n02,routing,network,constraints,rules,validate}.py`, overrides, `tests/data_pipeline/**` (pipeline owner) | failing fixtures: homonym mis-match, out-of-area gap bridged, skipped served stop, reversed/prefix-switched numbers, multi-line mis-route | **High** → Opus + Codex review |
| **S3b** Composition, validation, budgets | `compose` DAG, multi-owner legs, anchors, flattening, chain lengths, two-way reachability, **per-dataset expected catalog** (23-ward dataset gets its own), raw/gzip/reference reports, simplification knob; estimate effort from remaining route/compose recipes, including through-service shared legs and multi-N02 routing | S3a | pipeline recipe/build/export/validate (+ optional `composition.py`), `data/overrides/dataset.json` + 23-ward expected catalog, synthetic fixtures (same owner) | reject: forward/reverse multi-owner errors, cycles, wrong-track sharing, platform gap joints, back-and-forth, wrong last station, disconnection, catalog mismatch; build order ≠ output order asserted; 23-ward output unchanged | **High** → Opus + Codex review |
| **S4** Map/UI scaling (fixture-driven) | §6 layers, highlight timing, legend, cameras, labels, lottery text, clear-screen paging; dedicated fixture bundle with a multi-owner composed rapid (both directions) and a branch | S2 (S3b if the fixture is generated) | `src/features/map/**`, `animation/{movePath,timeline,displayedProgress}.ts`, `presentation.ts`, `GamePanel.tsx`, `ClearScreen.tsx`, `GameApp.tsx`, CSS, `tests/e2e/{fixtures,specs,support}` | highlight = ridden then landing; composed hop = one step; skip/reduced motion/reload; desktop/phone overview vs panel; all three browsers; candidate display/expansion uses full final-catalog lists at every transfer station (refresh fixtures after catalog freeze); fixture seeds proven | **Medium-High** → Sonnet (UI) + Opus (animation/fixtures), Codex review |
| **S0b — IMPLEMENTED (2026-10-13), pending lead verification** Catalog approval + product-id mapping | approved research **v2** via frozen S0 map; 666 rows / 40 services / 472 stations; order/stops/endpoints preserved; product kinds 36 local / 4 rapid; v1 stays historical | S0, resolved Q3–Q9; S1M (real-engine MC re-run) | `.claude/docs/research/jr-east-capital-region-product-{catalog,services}.csv`, `jr-east-capital-region-s0b-results.json`; sim generator/verifier | §8.6 hashes; all three verifiers pass; 5 shipped services / 67 station IDs kept; two-way reachability 472; required 2k decided 62/151/262, zero caps; extra 20k matches S1M exactly; lead verification pending | Low-Medium → lead / researcher |
| **S6P** Regional staging | Tokyo/Kanagawa/Saitama/Chiba overrides prepared and routed in staging (a cross-prefecture service has one owner); per-segment visual review; early hub/branch/chain, §6 raw/gzip budget and map zoom/overview measurements; estimate work from the remaining recipe inventory | S3a (compose rows: S3b), S0b | staging inputs with stage catalogs only — **never live overrides or `public/data`** | validator green per staging bundle against its stage catalog; evidence for every stop, boundary and shared track | **High** → Sonnet tables, Opus routing review |
| **S6** Final data (one commit) | approved-catalog overrides + regenerated `public/data`; rules still all-equal; `dataset.json` names the approved catalog | S3b, S4, S6P | `data/overrides/**`, `public/data/*`, `tests/data_pipeline/{test_overrides,test_validate,test_build}.py`, `tests/unit/real-data.test.ts`, `tests/e2e/real-data.spec.ts`; `gameConfig.ts` only if D7's `jr-yamanote`/count map changes (not expected) | coverage = approved catalog; two-way reachability; byte-identical rebuild; exact counts/order; fixed-seed playthrough + restore (cap reported as failure); phone parse/build/render; 300/1,000-turn save/restore timing; §6 raw/gzip budgets and desktop/phone zoom/overview gates on the full dataset | **High** → Opus integration, Sonnet mechanical |
| **S5** Rules flip and texts | re-run S1M on final data; apply resolved Q1(c)/Q2(a)/Q5(a) to `MVP_GAME_CONFIG` (`jr-east-capital-1`), title/subtitle, rules texts, fixture seed proofs | S1M, S6, Q1, Q2, Q5, Q10 | `gameConfig.ts`, `TitleScreen.tsx`, `GamePanel.tsx`, `ClearScreen.tsx`, `index.html`, seeds/proofs/specs, real-data tests | final-config seed proofs use complete final-catalog candidate lists at every transfer station, not only max k; real-data completion + restore; config-mismatch discard; final real-engine MC numbers recorded | **Medium** (decided config flip; goal unchanged) → Sonnet |
| **S7** Docs and release | `docs/manual/<theme>/` (Japanese), `data/README.md`, README, spec addendum, DESIGN.md, attribution; release PR; production smoke after explicit approval | all, Q11 | docs (lead) | final gates, rebuild/coverage/budget/MC evidence, preview smoke | Low (docs) / Medium (release) → lead |

### S0 completion and data freeze (2026-10-13)

S0 is complete on `feature/jrcr-s0`, based on `feature/jr-east-capital-region`.
The PR trigger now includes `feature/**`; the frontend, pipeline and E2E job definitions are unchanged.
Hosted execution of those jobs is verified when the step PR is opened, not by the local YAML check.
The data basis is timetable edition **2610** (JR Timetable, October 2026 issue / 「JR時刻表」2026年10月号)
and **N02 2025**, base date **2025-12-31**. The user approved research catalog v2 on 2026-10-13.
Its 666 service-stop rows, 40 services and 472 physical stations remain unchanged.

`jr-east-capital-region-id-map.csv` is the frozen D7 crosswalk (40 service rows + 472 station rows).
CSV keeps the crosswalk reviewable alongside the catalog, with explicit entity type and identity evidence.
All 5 shipped service IDs and 67 shipped station IDs are preserved. New service IDs apply `jr-` and
underscore-to-hyphen to the research labels; `keihin_tohoku_negishi` → `jr-keihin-tohoku` and
`saikyo_kawagoe` → `jr-saikyo` preserve the shipped exceptions. These service IDs are namespace labels,
not official railway identifiers: their `id_source` is empty (5 shipped service rows use `shipped`).
Station `id_source` counts are **67 shipped / 405 jr-official / 0 hepburn-review-needed**.
Each new station spelling was fetched from the JR East English station timetable on 2026-10-13;
the CSV retains its official English spelling and station-code source URL. Lowercase ASCII IDs preserve
JR's word boundaries and remove macrons; for example `hamakawasaki` → `hama-kawasaki`,
`airport-terminal-2` → `narita-airport-terminal-2-3`. Future steps consume this map rather than regenerate IDs.
Registry matching uses N02 aliases, prefecture and representative service, verified against shipped stop
order and N02 corridor selectors, rather than names alone. Tokyo (including Keiyo), Musashi-Kosugi and
Hama-Kawasaki each retain one physical station identity across all services.

All four research catalog/service CSVs use LF; **SHA-256 is over LF-normalized UTF-8 bytes**, including
newlines inside quoted CSV fields. No cell values or stop order changed. §8.4 and the run manifest record
the canonical v2 hash `ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4`;
the manifest records all four hashes. `build_catalog_v2.py` now writes LF explicitly and
`verify_catalog_v2.py` rejects CR bytes or hash drift. Re-running `catalog_to_network.py` in a temporary
directory produced byte-identical `net-v2-{all,core,local}.json` (hashes unchanged), so the existing four
50,000-game replica runs are retained without rerunning Monte Carlo. Their output hashes are unchanged.
`verify_id_map.py` passes coverage, uniqueness, ID format, all shipped IDs/order/corridors and the three
shared identities. S0 does not produce the S0b product catalog or complete S1M.

Sequence: S1 → S1M → S2; S1M is complete and S2 is next (shared `types/network.ts`, `engine/network.ts`).
After S2, S3a/S3b (one pipeline owner) and S4 can run in parallel. S1M consumed the research catalog independently of S0b. S0b
product-id mapping and real-engine confirmation are implemented (§8.6), pending lead verification before S6P starts
after S3a and S0b. Q1–Q11 are resolved and the research catalog is approved; S0b lead verification and remaining implementation gates remain.

S3b/S6P effort must be estimated from an inventory of the remaining recipes: classify the 627 service
pairs into direct routes, multi-N02 routes and shared-leg compositions, with owner/shared-track evidence.
Removing upper types reduces repeated skip-stop composition on the same tracks. 緩行線 and 快速線 remain
separate physical tracks: never reuse local-track geometry for rapid tracks merely because the station
pair is identical. Through-service shared legs and multi-N02 routing remain; retain composition and
wrong-track-sharing rejection. Recipe/unique-owner counts are unmeasured until that inventory. Keep §6
GeoJSON budgets and map zoom gates: S6P measures them early, S6 verifies them on the full dataset.

Test strategy additions over the 23-ward plan: two fixture families (all-equal engine/save regression fixtures keep
their old trajectories; browser fixture + seed proofs use the final `MVP_GAME_CONFIG`); weighted-draw and proximity
units; v3 guard/validator failing fixtures; composed-path animation units; real-data playthrough on fixed seeds.

---

## 10. Complexity classification

| Step | Class | Why |
|---|---|---|
| S0 | Low | CI trigger, branch, id map |
| S1 | **High** | RNG/ruleset contract, save format, seeded replay compatibility |
| S1M | Medium-High | must mirror engine semantics exactly; becomes the tuning tool |
| S2 | **High** | atomic cross-subsystem contract change (pipeline, TS, fixtures, E2E) |
| S3a | **High** | homonyms, multi-line routing on parallel tracks, boundary truncation |
| S3b | **High** | composition invariants, anchors, DAG, two-way reachability, per-dataset oracle |
| S4 | Medium-High | presentation timing contract, composed animation, phone layout |
| S0b | Low-Medium | revised v2 input approved; product-catalog output, recorded hash and real-engine confirmation |
| S6P | **High** | remaining route/compose inventory (627 service pairs, unique owners unmeasured), through shared legs and multi-N02 routing |
| S6 | **High** | one-commit integration of 472 stations / 40 services with budgets and device checks |
| S5 | Medium | decided config flip + seed proofs + texts; goal unchanged |
| S7 | Low/Medium | docs; release needs approval |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Shipping all-equal lotteries (v2 median 394 turns, 38.496 % > 500) | adopted Q1(c) is a release condition; S5 after final data; real-engine MC re-run |
| Replica vs engine drift for the levers | S1M re-measures every candidate with the real engine before S5 |
| Composition joins different tracks/platforms (artificial straight lines) | exact anchors, shared-track evidence per recipe, joint checks after simplification, visual review |
| Identical station pairs on physically different tracks merged | ownership by service; never merge by station pair alone |
| Partial catalog passes the completeness oracle | per-dataset expected catalog; final = approved catalog with recorded hash |
| Build/compose order leaks into `services.json` order (changes every seeded game) | explicit output order = catalog order, asserted |
| Payload or phone performance | raw+gzip budgets, simplification comparison, device acceptance in S6; vector tiles only on evidence |
| Seed re-search hides regressions | all-equal regression seeds kept; final MVP seeds change only with rule/catalog changes |
| MC tail read as a bound | no history cap; fixed-seed tests report cap hits as failures |
| Raw N02 rebuild not in CI | local byte-identical rebuild evidence attached to every data PR |
| Edition rollout from develop | PR #4 already in production; integration branch from develop, feature → develop → master; explicit production approval |
| 久留里線 abolition (2027-04-01) and timetable edition drift | Q6; record the timetable edition (2610) and N02 base date in docs/manifest |
| A new goal type later (stations, prefectures) needs saved state | only existing `goalArrivalPolicy` values are in S5's Medium scope; anything else is a separately designed step |

---

## 12. Resolved user decisions and remaining decision items

All Q1–Q11 are **RESOLVED** under the user decisions of 2026-10-13. The former v1 alternatives remain
measured in §8.1–§8.3; they are not the approved rules. Revised catalog v2 measurements and research-input approval are in §8.4.

| Question | Decided option | Implementation consequence |
|---|---|---|
| Q1 — lottery tuning | **(c)** 山手線 probability 1/2 + toward-山手線 direction 2:1 | Equal base weights; `target: {kind: "share", numerator: 1, denominator: 2}`, `towardTargetWeight = 2`; new `rulesetVersion`. revised v2: 61 / 148 / 258, 4/50,000 over 500. |
| Q2 — goal | **(a)** unchanged: 30 山手線 outer segments + 新橋 | Truncate while on 山手線; exact arrival otherwise. Pass-through is a comparison only. |
| Q3 — service set | **Redefined track-system rule**, superseding the former core-51 recommendation | 36 v1 locals + `chuo_rapid`, `sobu_rapid`, `joban_rapid` + `shonan_shinjuku_rapid_takasaki` (快速 is the base of its 高崎線・東海道線 route, which has no 普通). Both 湘南新宿 base routes stay whole; 宇都宮線快速 and 特別快速 remain excluded as upper types. 40 services; revised catalog user-approved 2026-10-13. |
| Q4 — through-running | **(a)** catalog-default line-junction splits | JR-named through services stay whole; split endpoints use `service-boundary`, shown as 「系統の端」. |
| Q5 — service base weights | **(a)** equal per service | 緩行線 and 快速線 services have equal bases; Q1 target share is applied afterwards. |
| Q6 — 久留里線 | **(b)** truncate at 久留里 | 11 stops; 久留里 playable terminus; exclude 平山, 上総松丘, 上総亀山; 472 stations. |
| Q7 — operational splits | **Catalog defaults** | 八高 and 青梅 each one service; 成田 佐倉–松岸 plus branches; 内房/外房 from 千葉; 高尾–藤野 separate. |
| Q8 — timetable basis | **(a)** weekday | Retain v1 weekday stop order, including 高円寺, 阿佐ケ谷 and 西荻窪 on 中央快速線; evidence edition 2610. |
| Q9 — station identity | **(a)** one station each | 東京 (京葉), 武蔵小杉 and 浜川崎 permit transfers under one id each. 鶴見線 remains connected via 浜川崎/鶴見. |
| Q10 — title/subtitle | **(a)** 「山手線すごろく」 + 「JR東日本 1都3県版」 | Update UI, page metadata and manual in S5/S7. |
| Q11 — PR #4 / branch sequence | **Already released to production; no PR #4 action** | Branch from `develop`; feature → develop → master. Production deployment still requires explicit approval. |

**Research-input approval:** revised catalog v2 was user-approved on 2026-10-13. S1M real-engine confirmation
is complete (§8.5); S0b product-id-mapped output is implemented (§8.6), pending lead verification. Production approval stays separate.
**New Q1–Q11 choices:** none from the corrected v1 → v2 service classification. The rule is unambiguous for all 60
v1 services, no excluded service uniquely served any station, and the only removed stations are the three
explicitly excluded by Q6. Technical acceptance items (N02 routing, payload/device measurements and S1M
real-engine confirmation) remain implementation work, not unresolved Q1–Q11 choices.

---

## 13. Codex consultations

- `jrcr-architecture` (`.claude/logs/codex/20261012T141414Z-jrcr-architecture.md`, read-only; the first attempt timed
  out at 600 s without output and was rerun with a narrowed read budget): adopted — service-owned primitives +
  multi-owner composition recipes, travel-order id lists with reversal for the reverse segment, owner vs chain
  validation split, exact anchors (no 30 m joint tolerance), `service-boundary`, T3 rejected, homonym-aware registry,
  two-way reachability, weights in config with "equal weights → `drawIndex(k)`", target share as its own policy,
  `{lines, services}`, raw+gzip budgets with device acceptance, SAVE v3 because config gains fields. Changed —
  per-service `weightsByServiceId` maps replaced by per-kind base weights + target weight/share (covers every user
  option without listing 51 ids; validation consult item 4). Budget numbers kept as proposals pending measurement.
- `jrcr-plan` (`.claude/logs/codex/20261012T143337Z-jrcr-plan.md`, read-only): APPROVE WITH CHANGES; adopted — S0 (CI
  on `feature/**` PRs), S1M harness moved forward, S3 split into S3a/S3b, S6P staging (no partial live data), final
  data in one commit, S5 rules flip **after** S6, two fixture families, target-share integer formula, toward-target
  distance by reverse-edge multi-source BFS in the engine (not official 上り/下り), S4 raised to Medium-High.
- `jrcr-validation` round 1 (`.claude/logs/codex/20261012T144551Z-jrcr-validation.md`, read-only): NEEDS_REVISION with 8 blocking
  items, all applied — simulator target share made a single weighted draw and the tables re-run; replica labelled
  distributional (not seed-exact) and "draws" renamed lottery events; over-500 counts, ratios, pair counts and the
  local-only reachability corrected; R1-b fixed to k = 1 and re-run (now 55 / 119 / 194 on 23-ward, matching the
  published 55 / 119 / 191); lottery config generalised so Q1(e)/Q5(b) are expressible and S5 depends on Q5; むさしの号
  N02 gap made explicit (all 59 measured); S0 id mapping, S0b approved catalog and per-dataset coverage oracle added;
  unmeasured impacts in Q6–Q9 stated as unmeasured; Q2(b)/Q4 wording narrowed to what was compared. Non-blocking items
  adopted: cross-check strength stated, the 40 µs figure marked provisional, endgame definition generalised,
  京浜東北線快速 exclusion measured.
- `jrcr-validation-r2` (`.claude/logs/codex/20261012T150323Z-jrcr-validation-r2.md`, read-only): **APPROVE (v1 only)** — all 8 round-1 items resolved, every §8.1 cell and every §8.2 N cell
  re-checked against the jsonl outputs, no new blocking issue. Its non-blocking notes (S0b → S1M dependency, §8.3
  wording on all 60, a stale `draws` label in `fmt.py`) were applied at that time. §9 now clarifies that S1M
  consumes the existing research catalog and S0b produces the approved product-id-mapped catalog.

- `jrcr-v2-validation` (`.claude/logs/codex/20261013T002322Z-jrcr-v2-validation.md`, read-only):
  **NEEDS_REVISION** for the former 39-service v2, independent of the v1 round-2 APPROVE above. Blocking
  finding fixed by restoring the base 高崎線・東海道線 湘南新宿 rapid route (36 rows); all other selections
  remain. The verifier now uses a 60-id independent classification table. Networks and four 50k MC runs
  rebuilt: 40 services / 666 rows / 472 stations; adopted 61/148/258 (>500: 4). Plan wording incorporates
  research-catalog input vs product-id-mapped output, recipe-based effort, retained budget/zoom gates, and
  full final-catalog candidate lists. At that revision, artifacts awaited caller verification and approval; this fix
  does not rewrite the read-only validation's verdict as APPROVE.
