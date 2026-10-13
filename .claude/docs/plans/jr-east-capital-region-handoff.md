# Handoff: JR East capital-region (1都3県) edition

Status (2026-10-13): **S0 DONE** on `feature/jrcr-s0`, cut from integration branch
`feature/jr-east-capital-region` (based on `develop`). The revised research catalog v2 was
user-approved on 2026-10-13: **666 rows / 40 services / 472 physical stations**.
**S1 merged via PR #7** (integration commit `c0a9866`). **S1M DONE** on
`feature/jrcr-s1m`: real-engine measurements and local acceptance checks passed; lead verified
(typecheck, default Vitest 23 files / 513 passed, `npm run sim` 300-game smoke, `verify_delegation.py`
clean). PR https://github.com/Yuulis/yamanote-line-sugoroku/pull/8 (→ integration branch, merge after
green CI). Next step: **S2** — branch `feature/jrcr-s2` off the integration branch after PR #8 merges.
S1 changes engine code only; live data remains unchanged. Historical S0 commits:
`a4cf781` (plan docs, = integration branch base on origin),
`dd3af3a` (S0). S0 PR: https://github.com/Yuulis/yamanote-line-sugoroku/pull/6 (→ integration branch;
merge after CI is green). The gitignored `sim/` directory is force-added; keep using `git add -f` for it.
Branch flow per step: `feature/jrcr-s<N>` off the integration branch → PR into it → integration PR → develop.
Lead verification for S0: both verify scripts exit 0, `verify.sh` pass (pytest 136), `verify_delegation.py`
no actionable findings.

## Read first

- Architecture and acceptance gates: `.claude/docs/research/jr-east-capital-region-expansion-design.md`,
  especially §3 D7, §4, §8.4 and §9 (including the S0 completion/data freeze).
- Approved input: `.claude/docs/research/jr-east-capital-region-{catalog,services}-v2.csv`.
- Frozen crosswalk: `.claude/docs/research/jr-east-capital-region-id-map.csv`.
- Research evidence: `.claude/docs/research/jr-east-capital-region-expansion.md`.
- Simulation artifacts: `.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/`.

## S0 outputs and verification

- CI `pull_request.branches` now includes `feature/**`; no other CI behavior changed.
  YAML parses to `{'branches': ['master', 'develop', 'feature/**']}`. Hosted frontend/pipeline/E2E
  execution remains to be observed on the step PR; no PR was opened by this executor.
- CSV crosswalk: 40 service IDs → `jr-*`, 472 station IDs → frozen ASCII kebab-case product IDs.
  All **5 shipped services / 67 shipped stations** retain their IDs. Registry N02 aliases, prefecture,
  representative-service membership, shipped stop order and N02 corridor selectors verify identity.
  Tokyo/Keiyo, Musashi-Kosugi and Hama-Kawasaki each use one station identity.
- Station spelling provenance: **67 shipped / 405 jr-official / 0 hepburn-review-needed**.
  Official English spelling and station-code URLs are retained per row. New service rows leave
  station-only `id_source` empty: their IDs are D7 namespace labels, not official railway IDs.
- Timetable basis: **2610**, JR Timetable October 2026 issue (「JR時刻表」2026年10月号).
  Geometry basis: **N02 2025**, base date **2025-12-31**.
- Four research catalog/service CSVs normalized to LF without changing the selected stops/order/evidence.
  **SHA-256 hashes use LF-normalized UTF-8 bytes**. Catalog v2 hash:
  `ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4`.
  All four hashes and updated script hashes are in `sim/run-v2-manifest.json`.
  The generator writes LF explicitly; the catalog verifier rejects CR bytes and hash drift.
- `python3 sim/verify_id_map.py` (use full sim path from repository root) exits 0:
  40/472 coverage, unique IDs, valid format, shipped 5/67 preserved, all ordered N02 corridors verified.
- `python3 sim/verify_catalog_v2.py` exits 0: 666/40/472, independent 60-ID classification (40 keep / 20 drop),
  121 transfer stations, max k=10, two-way reachability 472/472, no service-selection orphans.
- Temporary `catalog_to_network.py` regeneration with tag `v2` matches **all three existing network files
  byte-for-byte**. No network or replica output changed, so no Monte Carlo rerun was needed.
  Existing four 50,000-game runs remain valid; adopted Q1(c) median/p90/p99 = **61/148/258**, no cap hits.

Simulation scripts/manifest live under gitignored `.claude/logs/`; their edits do not appear in ordinary
`git diff --stat`/`git status`. Preserve these artifacts deliberately when preparing the S0 commit.
The crosswalk, CI and document edits are visible normally. Catalog line-ending-only changes match
Git's existing LF-normalized blobs, so they also produce no content diff.

## S1: engine rule seams — implemented, review findings addressed

Implement design §4 on the **shipped 23-ward data**. Keep `MVP_GAME_CONFIG` all-equal until S5.
Scope: weighted RNG draw, service/direction lottery policies and validation, target-distance reverse BFS,
landing options, nested-config copying/comparison, save format v3 and unsupported-v2 discard behavior.
Owned files: `src/types/network.ts`, `src/features/game/engine/{rng,landing,config,network,game,save,types,index}.ts`,
new `engine/proximity.ts`, `src/features/game/gameConfig.ts`, relevant unit fixtures/tests. Confirm actual
paths before editing. Do not expand live data or change the schema/geometry pipeline in S1 (S2 owns cutover).

Acceptance: all-equal weights of any value call `drawIndex` and preserve existing rolls, choices and RNG
states; forced choices consume no draw; weighted cumulative boundaries/rejections and integer limits
are covered. Check target-share formulas with kind bases, direction-distance ties/branches/rapid hops,
policy key validation, deep-copy behavior, save-v3 round trips, v2 rejection and nested-config mutation.
Keep existing snapshots intact. Run relevant unit/type/build gates and obtain the required S1 review.
After S1, S1M measures the policies with the real engine against the approved **research-ID** catalog.
S0b later generates the product-ID catalog using the frozen S0 crosswalk and requires S1M confirmation.
At S0b classification finalization and the S2 schema cutover, narrow the product `ServiceKind` to
`local | rapid`, no later than S2. Research-side classification may retain wider kinds for comparisons.

Implementation (2026-10-13; uncommitted):

- `src/types/network.ts`: lottery-policy/config types, service kinds, optional kind seam for shipped v2 services.
- `src/features/game/engine/{rng,landing,config,network,game,save,index}.ts` and new `proximity.ts`:
  integer weighted draw (total <= 2^32; equal weights delegate to `drawIndex(k)`), policy validation
  (1..1000, exact nested keys), share/weight formulas, lazy cached reverse-edge BFS, landing weights,
  nested config copying between states, save v3 parsing/comparison and existing two-pass replay.
- `src/features/game/gameConfig.ts`: explicit all-equal policies; `jr-east-23ku-1` unchanged.
- `tests/unit/fixtures/{multiService,yamanote}.ts`: required all-equal config fields only.
  New `tests/unit/fixtures/lottery.ts`: service-kind, branch and rapid fixtures.
- New `tests/unit/engine-{weighted-rng,lottery-policy,policy-config,save-v3}.test.ts`: **97 new tests**.
  The initial 94-test suite was written before implementation and observed failing, then passing;
  three follow-up boundary/compatibility checks also pass.
- This handoff: implementation status, local evidence, scope exceptions and S1M brief.

Verification history (2026-10-13):

- Initial implementer result: baseline `npm test` **18 files / 402 passed**; after S1,
  **22 files / 499 tests: 496 passed, 3 failed**; new tests **4 files / 97 passed**.
  `npm run typecheck` and `npm run build` passed; build retained the large-chunk advisory.
  At this point the implementer had left existing tests and inline snapshots unchanged; the three
  failures were pinned save-version expectations conflicting with the required v3 format.
- Lead revision: updated three pre-existing tests' pinned save version **2 -> 3**, and the unknown
  future-version rejection fixture **3 -> 4**: `engine-game.test.ts`, `engine-save-v2.test.ts`,
  and `engine-save.test.ts`. No assertion was removed, skipped or weakened. Lead verification
  then reported **22 files / 499 passed**.
- Review `20261013T010709Z-jrcr-s1-review.md`: **NEEDS_REVISION** because the v3 round-trip seed
  cleared on the first roll and exercised no service or direction lotteries. No engine bug was found.
- Review fixes here: share uses `weighted-save-30`, weight x3 uses `weighted-save-438`;
  each round-trip test derives non-equal service/direction draw counts from actual landing history
  and asserts both are positive. The original first-roll-clear seed remains in the no-landing test.
  Four middle/end candidate-order cases and one case with both draws non-equal were added;
  the existing draw-order test was renamed to reflect its equal direction weights. Built-network
  immutability and the identity-cache rebuild requirement are documented in `src/types/network.ts`
  and at the proximity cache; the lead added the same contract comment on the `RailwayNetwork`
  interface in `engine/network.ts` (comment only).
- Final lead verification: `npm run typecheck` passed; `npx vitest run` **22 files / 504 passed**
  (new S1 suites **4 files / 102 passed**); `npm run build` passed; `verify_delegation.py` no
  out-of-scope files or placeholders in code (its `weakened_tests` hit on `engine-save-v2.test.ts`
  is the 2 -> 3 version-pin replacement, not a removed assertion). Commit `1eb32fe` on `feature/jrcr-s1`;
  PR https://github.com/Yuulis/yamanote-line-sugoroku/pull/7 (→ integration branch, merge after green CI).

No data/pipeline/schema/geometry/map/UI edits were made in S1.

Scope notes: missing service kinds in shipped data are treated as `local`; explicitly provided
unknown kinds are rejected by the engine network builder. `geometryFeatureIds` array copying in
design §4 remains for the atomic S2 data-contract cutover: S1 still has scalar `geometryFeatureId`.
S0b must finalize product classification as `local | rapid`; S2 must narrow the product `ServiceKind`
and aligned validation/config/schema/tests to those two kinds. Do not defer this to S5; broader
research classifications remain separate.

## S1M: real-engine Monte Carlo harness — DONE (2026-10-13)

`tests/simulation/{csv,inputs,harness,measurement.test}.ts` builds an engine network directly from
the approved **research-ID catalog v2**, preserving service order and stop order. Both CSVs are
cross-checked; catalog SHA-256 remains
`ef440ac45ffad0308e9121b8c0d202fa1d1895ef94cc1881fe94d0b1ed937fc4` (LF-normalized UTF-8 bytes).
Every game calls `createGame`, every turn calls `playTurn`; no rules or RNG are replicated.
Synthetic coordinates/platforms/geometry ids are sufficient. Research `through-split` endpoints
use synthetic `terminus` metadata: identical stop/discard-pips behavior; no engine change.

`vitest.simulation.config.ts` and `npm run sim` keep measurements out of `npm test` / `npx vitest run`.
The new config is included in `tsconfig.node.json` type checking. The new unit file
`tests/unit/simulation-harness.test.ts` adds 9 fast checks: determinism, a real `playTurn` spy,
full-history/discarded-history agreement for all three presets, caps, quantiles, CSV parsing,
approved catalog hash/order/identity, and shipped-bundle loading. No existing tests, shipped data,
engine, pipeline or UI files changed; no dependencies added.

Run from repository root (full options: `tests/simulation/README.md`):

```bash
npm run sim # decided, 200 games, approved research v2
SIM_PRESET=decided SIM_GAMES=20000 SIM_SEED=20261012 SIM_CAP=20000 \
  SIM_OUTPUT=/tmp/jrcr-s1m-decided.json npm run sim
SIM_PRESET=all-equal SIM_GAMES=20000 SIM_SEED=20261012 SIM_CAP=20000 \
  SIM_OUTPUT=/tmp/jrcr-s1m-all-equal.json npm run sim
SIM_BUNDLE=public/data SIM_PRESET=all-equal SIM_GAMES=200 npm run sim
```

CSV paths: `SIM_CATALOG` / `SIM_SERVICES`; optional ids: `SIM_TARGET` / `SIM_START`.
`SIM_BUNDLE` uses product guards without geometry; S2 must adapt its services-envelope extraction.
Optional `decided-pass-through` uses existing engine config; unit-tested, not measured at large scale.
The adopted goal stays `truncate-on-target-service`.

Results: `.claude/docs/research/jr-east-capital-region-s1m-results.json`, design §8.5.
Both required presets ran **20,000 games**, base seed **20261012**, cap **20,000**.
Same independent engine seeds: `s1m-20261012-0` through `s1m-20261012-19999`;
seed-set SHA-256 `0b085fc995e2ed7f062a72a1482f03f578bca2e78dc151517b8d8bd31aa5715e`.
Quantiles use nearest rank; caps count as cap+1 and fail the command after saving the summary.
Runtime covers game creation/transitions/statistics, excluding input loading/Vitest startup.

| Preset | Median / p90 / p99 | Mean | Max | >500 / games | Cap hits | Runtime | Replica median / p90 / p99 |
|---|---|---:|---:|---|---:|---:|---|
| decided | **61 / 148 / 258** | 73.85715 | 481 | 0 / 20,000 | 0 | 44.15 s | 61 / 148 / 258 |
| all-equal | **396 / 967 / 1,643** | 476.74730 | 3,179 | 7,707 / 20,000 (38.535%) | 0 | 319.00 s | 394 / 962 / 1,647 |

No material discrepancy: decided median/p99 changes 0%; all-equal median +0.51%, p99 −0.24%,
below >10% / >15% investigation thresholds. Replica samples are 50,000 per preset, with different
RNG seeding/sampling: distributional confirmation, not seed-exact agreement. Decided's 0/20,000
>500 vs replica 4/50,000 is a rare-tail observation, not a bound. Both runtimes were below 15 minutes;
no sample reduction. `npm run typecheck` passed; `npx vitest run` **23 files / 513 passed**, excluding
measurements; both 200-game smokes and both large runs passed (one simulation file/test, zero caps).
History is discarded in measurements; save/restore, history growth and device/map performance remain
separate gates. S5 alone flips shipped policies and reruns on final product data.

## Next step — S2: atomic v3 data-contract cutover on 23-ward data

Apply design §3/§9 atomically to the existing **5-service / 67-station** dataset: non-empty
`geometryFeatureIds` in travel order (one-element chains initially; reverse lists for reverse
segments), service-owned geometry, `{ lines, services }` with `lineIds` and required `kind`,
`service-boundary` endpoints, manifest schemaVersion 3. **Narrow product `ServiceKind` and aligned
policy validation/config/schema/tests to `local | rapid` in S2**; historical research classifications
stay separate. Preserve ids, station/service order, routes and all-equal seeded trajectories.
Keep shipped policies all-equal until S5; do not expand live data in S2.

Update pipeline overrides/export/validation/rules, overrides/public data, TS types/guards/loaders,
`networkFromData`, engine network chain copying, animation/map readers and minimal display consumers,
all TS/E2E/Python fixtures (`tests/e2e/support/app.ts` and `readMap` included), and simulation inputs.
Gates: owner-vs-chain checks; reject empty/missing/misordered references; unit/type/build, pipeline and
E2E; unchanged uniform trajectories; local raw-N02 rebuild byte equality. S0b product-catalog generation
remains required before regional staging; S1M confirms the approved research input.

## Decisions and remaining gates

Q1–Q11 are resolved. Services represent track systems/base routes, excluding upper train types.
Keep both whole Shonan-Shinjuku base routes (including Takasaki/Tokaido rapid); truncate Kururi at Kururi.
Adopt Q1(c) only at S5: Yamanote share 1/2, other services uniform, direction toward Yamanote weighted 2:1.
Goal unchanged; weekday patterns; through junctions shown as service boundaries; subtitle 「JR東日本 1都3県版」.

Prior v1 review APPROVE is historical; the former v2 NEEDS_REVISION selection issue was corrected before
user approval. S1M confirms the approved research input; S0b product-catalog generation, N02 recipe/routing evidence,
payload/device/zoom budgets and full-catalog UI/seed checks remain. N02 lacks the Ikebukuro–Akabane freight
link and has a Joban junction gap; regional data preparation must address those. Release flow remains
feature → develop → master; production deployment requires explicit approval.
