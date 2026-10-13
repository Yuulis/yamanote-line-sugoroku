# Handoff: JR East capital-region (1都3県) edition

## Current status (2026-10-13, end of session) — resume here

**S0, S1, S1M and S2 are merged** into the integration branch `feature/jr-east-capital-region`
(head `8a92c8b`, based on `develop`). Nothing is uncommitted. The integration branch is NOT merged
into `develop`; that happens via an integration PR after S7, and production needs explicit user approval.

| Step | Status | PR | Lead verification |
|------|--------|----|-------------------|
| S0 CI trigger + id map | merged | #6 | verify scripts, `verify.sh` |
| S1 engine rule seams, save v3 | merged | #7 | typecheck, Vitest 504, build; Codex review NEEDS_REVISION → fixed |
| S1M real-engine Monte Carlo | merged | #8 | Vitest 513, `npm run sim` smoke; decided 61/148/258 matches replica |
| S2 v3 data contract (23-ward data) | merged | #9 | `verify.sh` (pytest 156), validate, raw-N02 rebuild byte-identical, Vitest 536, build, E2E 60/60 (pre-fix), CI green; Codex review NEEDS_REVISION → fixed |
| S0b product-id catalog | implemented; pending lead verification | — | three catalog/id verifiers pass; required 2k decided 62/151/262, zero caps; additional 20k matches all S1M statistics |

**Next:** S3a (pipeline) — S4 (UI/animation) may run in parallel; S0b (product catalog) awaits lead verification.
Briefs: section "Next step briefs" at the end of this file; scope/tests per design §9.

How to work each step (user instruction: update this handoff after every step):
1. `git switch feature/jr-east-capital-region && git pull`, then `git switch -c feature/jrcr-<step>`.
2. Implement via Codex (`codex_consult.py --sandbox danger-full-access`, PATH prefix
   `$HOME/.nvm/versions/node/v24.21.0/bin`); stop-and-report on any test conflict, never weaken tests.
3. Lead gates: `verify.sh`, pipeline validate, raw-N02 rebuild `diff -r` with `public/data`,
   `npm run typecheck`, `npx vitest run`, `npm run build`, `npm run test:e2e` (local host `::1`),
   `verify_delegation.py`; then a read-only Codex review for High steps.
4. Commit, PR into the integration branch, merge after green CI, then update this file.

The gitignored `sim/` research directory is force-added; keep using `git add -f` for it.
Older per-step history follows.


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

## S1: engine rule seams — DONE (merged via PR #7)

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

## S2: atomic v3 data-contract cutover on 23-ward data — DONE (merged via PR #9, `8a92c8b`)

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
user approval. S1M confirms the approved research input; S0b lead verification, N02 recipe/routing evidence,
payload/device/zoom budgets and full-catalog UI/seed checks remain. N02 lacks the Ikebukuro–Akabane freight
link and has a Joban junction gap; regional data preparation must address those. Release flow remains
feature → develop → master; production deployment requires explicit approval.


## S2 completion handoff (2026-10-13)

Status: **merged via PR #9** after lead verification (history of the uncommitted phase below).
No commit, push or branch change. `.claude/docs/DESIGN.md` and `.claude/STATE.md` untouched.
The earlier executor stopped on the weighted synthetic fixture conflict. The lead authorized a
rewrite under the recorded two-kind product contract; that conflict is resolved below.
Do not begin dependent delivery until the lead has independently verified this uncommitted tree.

Implemented by area:

- Pipeline: `scripts/data_pipeline/{build,overrides,export,rules,validate}.py`,
  `data/overrides/services.json`, regenerated `public/data/{services,segments,manifest}.json`
  and `segments.geojson`. Contract v3: `{lines, services}`, required `local | rapid` kind and
  non-empty `lineIds`, non-empty travel-order `geometryFeatureIds`, owned geometry `lineId`,
  schemaVersion 3 and compact segments. Live data retains 5 services / 67 stations /
  146 directed segments / 88 owned features, all chains length 1.
- Runtime: types/guards/loaders, engine config/network/landing and `gameConfig`,
  `networkFromData`, animation `movePath`, `GameApp` and `RailwayMap` readers.
  The engine copies line/chain arrays; owned pair validation is separate from consumer chains.
  Reject missing/empty/unknown/misordered chains, invalid owners, wrong reverse lists,
  wrong final stations, backtracking, non-exact joints and orphan primitives.
  Old manifests/services arrays fail with explicit v2/v3 contract errors.
  MVP policies remain all-equal and `jr-east-23ku-1` remains unchanged.
- Minimal presentation: `gameSummary` / `presentation` display `service-boundary` as
  「系統の端」 for early-stop/history/reversal text, with the same stop/discard semantics.
- Fixtures/tests: Python export/override/validation fixtures and a new
  `test_geometry_chains.py` multi-owner bidirectional rapid fixture; TS unit fixtures;
  `data-contract-v2.test.ts` renamed/expanded to `data-contract-v3.test.ts` (all old assertions
  retained under the new shape); animation, policy, save, presentation and loader tests.
  E2E bundle/support `readMap` documents feature IDs; `targetFeatureIds` resolves and flattens
  actual network chains, and affected specs pass the bundle instead of deriving IDs from strings.
  Research/bundle simulation inputs and README now follow the envelope and service-boundary metadata.
  `data/README.md` documents v3 and two isolated rebuilds versus the reviewed public candidate.

Authorized fixture rewrite (no production policy or uniform trajectory change):

- Old target base 7 (`medium-distance`) and non-target bases 3/2/5 across three services became
  local=2 / rapid=3, with a fifth service `extra-local`. At b the candidate order is
  target(local), line(rapid), spur(local), special(rapid), extra-local(local). Thus each kind
  occurs twice among non-target candidates; bases still multiply **per service**, not per kind.
- Share p=2/q=5: target = 2*(3+2+3+2)=20; others = (5-2)*[3,2,3,2].
  Start `[20,9,6,15]` -> `[20,9,6,9,6]`; middle `[9,6,20,15]` -> `[9,6,20,9,6]`;
  end `[9,6,15,20]` -> `[9,6,9,6,20]`.
- Weight=4: target = 4*local(2)=8; others keep their bases.
  Start `[28,3,2,5]` -> `[8,3,2,3,2]`; middle `[3,2,28,5]` -> `[3,2,8,3,2]`;
  end `[3,2,5,28]` -> `[3,2,3,2,8]`. Middle/end exhaustive cumulative interval assertions remain.
- Half share with all bases=1: target = 1*(1+1+1+1)=4; others=(2-1)*1,
  `[3,1,1,1]` -> `[4,1,1,1,1]`. Absent target: `[3,5]` -> `[3,3,2]` (unscaled service bases).
  Singleton target: `[7]` -> `[2]` (base retained without any target share/multiplier).
  Short formula comments sit next to every rewritten vector; no expectation was copied from output.
- Weight save seed `weighted-save-438` -> `weighted-save-v3-32`. Deterministic search:
  first `weighted-save-v3-N`, N ascending from 0, that completes within 500 turns and has
  >0 non-equal service draws AND >0 non-equal direction draws. This seed completes in 11 turns,
  with 6 non-equal service draws / 1 non-equal direction draw. Both existing
  `toBeGreaterThan(0)` assertions remain unchanged. Share seed `weighted-save-30` and the
  first-roll-clear seed remain. All uniform seeded trajectories, snapshots and other behavior
  assertions remain; only required schema shapes and the authorized weighted fixtures changed.

Review resolution (2026-10-13):

- Review `20261013T021130Z-jrcr-s2-review.md` returned **NEEDS_REVISION**; all findings
  are now **fixed**, subject to independent lead verification. The review artifact is unchanged.
- `check_geometry_chains()` checks the owner's string type before set membership, records
  malformed properties/non-string owners and continues validation of the remaining segments.
  An audit of chain ids, segment endpoints and visited-station lookups found their string
  guards already precede dictionary/set access. Valid-data processing is unchanged.
  Integration regressions pass `[]` and `{}` owners through `validate_dataset()` and assert
  returned errors instead of exceptions.
- The forced-direction lottery expectation uses `options.services.length` instead of `4`.
- Animation tests cover mixed primitive orientations in both travel directions, preserving
  point order, a single joint, distance and interpolated start/middle/end positions.
- TS and Python now reject individually contiguous forward/reverse routes that use different
  primitive ids. Each route also passes with its own matching reversal; only the strict
  reversal equality rejects the mixed pair. No assertion was removed or weakened.
- The Python multi-owner rapid success fixture now passes the whole `validate_dataset()`
  path with canonical payloads/manifest and real registry, overrides, platform and owned-feature
  checks. Its synthetic lead-in supplies an interior start without changing the composed hop.
- Review-fix gates below were rerun: Python **156 passed** (+4), Vitest **23 files / 536 passed**
  (+3), lint/format/type checks, pipeline validation, raw checksums and one isolated raw rebuild.
  Build/E2E/simulation rows retain the earlier S2 evidence and were not rerun for this fix.

Acceptance evidence (final review-fix counts; earlier extended gates identified above):

| Command/check | Result |
|---|---|
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 30 files already formatted |
| `uv run ty check scripts/` | All checks passed |
| `uv run pytest` | 156 passed, zero skips/failures (before review fix 152; baseline 136) |
| `uv run python -m scripts.data_pipeline.validate` | OK; 146 references, max chain 1, geometry 43,433 bytes <=300,000; unchanged service lengths/platform metrics |
| `sha256sum --check data/n02-2025.sha256` | Both raw input files OK |
| Raw rebuilds | Earlier two builds matched each other and `public/data`. Review fix: `uv run python -m scripts.data_pipeline.build --quiet --out-dir /tmp/jrcr-s2-review-fix.qHIxKl`; `diff -r /tmp/jrcr-s2-review-fix.qHIxKl public/data`: no differences, exit 0 |
| Review-fix public-data preservation | SHA-256 hashes of all 5 `public/data` files match the pre-fix snapshot byte-for-byte |
| Independent HEAD-data comparison | Stations, pre-existing service fields/order, segment fields/order and all geometry coordinates/IDs unchanged; only v3 metadata/serialization added |
| `npm run typecheck` | Passed |
| `npx vitest run` | 23 files / 536 passed, zero failures (before review fix 23 / 533; baseline 23 / 513) |
| `npm run build` | Passed, 66 modules; existing >500 kB chunk advisory remains |
| `npm run test:e2e` | 60 passed / 0 failed in 2.5m; desktop-chromium 20, phone-chromium 20, desktop-firefox 20 |
| `SIM_GAMES=200 npm run sim` | Research CSV, decided: 200 completed / 0 caps; median/p90/p99 58/130/252 |
| `SIM_BUNDLE=public/data SIM_PRESET=all-equal SIM_GAMES=200 npm run sim` | v3 shipped bundle: 200 completed / 0 caps; median/p90/p99 53/115/253 |
| `git diff --check` | Passed |
| `git diff --stat` | 54 tracked paths changed; serialization and test rename account for large deletions; two new files are untracked |
| `git status --short` | 53 modified / 1 deleted (v2 test renamed to new v3 test) / 2 untracked; no changes to DESIGN.md/STATE.md |

Local E2E used the configured IPv6 loopback `::1` and WSLg display, with all three default
projects enabled and no server reuse. WebKit is opt-in/CI-only and was not configured in this
local run. Full browser log: `/tmp/jrcr-s2-e2e.log` (local, ephemeral).
An intermediate ty check exposed three type-narrowing errors in the new chain rule; explicit
string checks/index construction fixed them, and the final gate passes. New chain tests initially
caught a fixture using the start station as an endpoint and a shared-coordinate mutation that
moved both sides of a joint; the synthetic fixture was corrected, preserving the negative assertions.
No additional conflicting pre-existing test was encountered; no test was skipped, removed or weakened.

Deviations: no functional deviation from the lead-approved S2 scope. The older design D3/sketch
shows four kinds, but the recorded later product decision and this task require `local | rapid`.
Raw rebuilds use isolated output directories to compare against the reviewed candidate without
replacing it. Large-catalog routing/composition generation, budgets and UI scaling remain S3/S4;
S2 only cuts over existing data and validates/animates synthetic chains.

Remaining risks: independent lead diff/acceptance verification of the review fixes remains; the existing
large frontend chunk advisory remains. New dataVersion and the two-key policy schema invalidate
older saves through the existing discard path. This is the intentional atomic contract cutover,
not an ID, route or all-equal trajectory migration. Regional data has not been shipped.

## Next step briefs

S2 is merged; next = **S3a**; **S4** can run in parallel; **S0b** awaits lead verification:

- **S3a (pipeline owner):** registry prefecture/municipality, homonym selectors, configured bboxes,
  multi-line route recipes, number/prefix rules, boundary truncation and reviewed detour evidence.
  Keep 23-ward v3 output byte-identical; reject wrong homonyms, bridged out-of-area gaps,
  skipped served stops, reversed/prefix-switched numbers and multi-line mis-routes. S3b follows
  with compose DAG/anchors, per-dataset catalog, two-way reachability and raw/gzip/reference budgets.
- **S4 (UI/animation owner):** dedicated bidirectional multi-owner composed-rapid + branch fixture;
  ridden/landing highlight timing, one step per composed hop, grouped legend, cameras/labels,
  lottery expansion and clear-history paging. Verify skip/reduced motion/reload, desktop/phone
  overview versus panel, all three browsers, full catalog candidate display and proven seeds.
- **S0b (catalog owner):** implemented on `feature/jrcr-s0b`, pending lead verification; see the
  S0b section below. Approved v2 is mapped through frozen S0 IDs with service/stop order and endpoints
  preserved. Product hashes and real-engine confirmation are recorded; product kinds are `local | rapid`.
  No live data expansion before the regional staging/final gates.

## S0b: product-id catalog — lead-verified, PR #10 (2026-10-13)

Branch: `feature/jrcr-s0b`; PR https://github.com/Yuulis/yamanote-line-sugoroku/pull/10 (merge after green CI). Lead re-ran the three verifiers (exit 0) and matched both product hashes. Approved research v2 and the frozen S0
crosswalk are unchanged. Outputs under `.claude/docs/research/`:

- `jr-east-capital-region-product-catalog.csv`: **666 stop rows / 472 stations / 40 services**.
- `jr-east-capital-region-product-services.csv`: **40 services**, **36 local / 4 rapid**.
- `jr-east-capital-region-s0b-results.json`: input/product hashes, commands, full real-engine summaries,
  exact S1M comparison and all three verifier outputs.

| Artifact | SHA-256 (UTF-8 / LF bytes) |
|---|---|
| Product catalog | `3deb465895e55d381abd8b75adaddbc08ce7f242bb46b40ff88ea8c9c757a438` |
| Product services | `76d86cc98a312769151ca7cf9537b24822af21afe1a9113e827a2495d4fc3256` |
| Frozen S0 crosswalk (unchanged) | `ca6a7c7c957ab153f787d78a040dc5d57fa044d59da758064a632789ab96885f` |

CSV schemas are documented in design §8.6. Catalog `endpoint_kind` is empty for interior/circular
stops and populated at each linear end. Research `through-split` maps to product `service-boundary`;
`terminus` / `area-boundary` stay unchanged. Service metadata contains both endpoint kinds,
research ID, circular flag and stop count. Rapid IDs: `chuo_rapid`, `sobu_rapid`, `joban_rapid`,
`shonan_shinjuku_rapid_takasaki`. All service/stop ordering and all 5 shipped service / 67 station
IDs are preserved. Directed gameplay reachability from/to `shimbashi` covers all **472 stations**,
with **1,224 directed segments** (Yamanote +1 only). Endpoints: 36 terminus, 10 area boundaries,
32 service boundaries. All CSV bytes use LF.

Scripts under `.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/`:
`build_product_catalog.py` (deterministic generator), `verify_product_catalog.py` (independent oracle).
Existing `verify_id_map.py` received only the S2 `services` envelope extraction fix; all original
identity, ordered-corridor and N02 checks remain. This directory is gitignored: the lead must
force-add new scripts and desired raw run summaries when committing.

Checks (all exit 0):

```bash
python3 .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/build_product_catalog.py
python3 .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/verify_product_catalog.py
python3 .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/verify_id_map.py
python3 .claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/verify_catalog_v2.py
SIM_PRESET=decided SIM_GAMES=2000 SIM_SEED=20261012 SIM_CAP=20000 \
  SIM_OUTPUT=.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/s0b-decided-2000.json npm run sim
SIM_PRESET=decided SIM_GAMES=20000 SIM_SEED=20261012 SIM_CAP=20000 \
  SIM_OUTPUT=.claude/logs/agent-teams/feature-jr-east-capital-region-expansion/sim/s0b-decided-20000.json npm run sim
```

`node_modules` was absent; `npm ci` succeeded (73 packages, zero vulnerabilities). The required
2,000 games use unchanged research input and the independent S1M seed prefix `0..1999`:
**median 62 / p90 151 / p99 262**, mean **75.93450**, max **481**, >500 **0**, caps **0**,
played turns **151,869**, runtime **4.60 s**. Both sim runs pass (one file / one test each).

Historical S1M has aggregate 20,000-game statistics, without per-game or prefix results; a direct
historical 2,000-game prefix comparison is unavailable. The additional **20,000-game** rerun verifies
the same full seed-set hash and **exact equality of every historical decided statistic**:
**61 / 148 / 258**, mean **73.85715**, max **481**, >500 **0**, caps **0**, played turns
**1,477,143**, runtime **45.40 s**. S2 now narrows weights to `local | rapid` and maps through-split
to `service-boundary`; these metadata changes leave the measured gameplay unchanged. The harness
was not edited. Smaller-prefix quantiles need not match full-sample quantiles.

Negative verifier checks reject changed station ID/order/endpoint/kind/name and CRLF bytes.
Lead verification is pending. S5 still requires real-engine measurement on final product data/config;
geometry, device performance and save/restore are outside this confirmation.
