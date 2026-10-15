# Handoff: JR East capital-region (1都3県) edition

## Current status (2026-10-13) — resume here

**S0–S3b, pipeline G1/G2, the stage validation profile, all four S6P stages and S6 (combined live 1都3県 dataset) are merged** into the integration branch
`feature/jr-east-capital-region` (head after this update; last merge PR #21; based on `develop`). Nothing is uncommitted.
The integration branch is NOT merged into `develop`; that happens via an integration PR after S7,
and production needs explicit user approval. The integration branch now ships the 1都3県 dataset
(40 services / 472 stations, title 「JR東日本 1都3県版」) with rules still all-equal; production is still the 23-ward edition.

| Step | Status | PR | Lead verification |
|------|--------|----|-------------------|
| S0 CI trigger + id map | merged | #6 | verify scripts, `verify.sh` |
| S1 engine rule seams, save v3 | merged | #7 | typecheck, Vitest 504, build; Codex review NEEDS_REVISION → fixed |
| S1M real-engine Monte Carlo | merged | #8 | Vitest 513, `npm run sim` smoke; decided 61/148/258 matches replica |
| S2 v3 data contract (23-ward data) | merged | #9 | `verify.sh` (pytest 156), validate, raw-N02 rebuild byte-identical, Vitest 536, build, E2E 60/60, CI green; Codex review NEEDS_REVISION → fixed |
| S0b product-id catalog | merged | #10 | three verifiers exit 0, product hashes match; 20k decided run = S1M exactly |
| S4 map/UI scaling (fixture-driven) | merged | #11 | Vitest 551, build, E2E 78/78 (75/75 twice before polish); Codex review APPROVE, polish applied |
| S3a registry/area/routing prep | merged | #12 | `verify.sh` (pytest 198), validate, rebuild byte-identical; Codex review NEEDS_REVISION → fixed, 41/41 guard-removal checks; CI green after merging S4 |
| S3b composition/validation/budgets | merged | #13 | `verify.sh` (pytest 259), validate, raw-N02 rebuild byte-identical, Vitest 551; Codex review NEEDS_REVISION (routed-chain bypass, generator reachability) → fixed, 33/33 guard removals; CI green |
| S6P stage 1: Tokyo (Claude-led) | merged (partial: 21/23 services, 137/142 stations) | #14 | lead: staged build + validate OK, oracle hash + oracle-vs-product-catalog check, live rebuild byte-identical, pytest 262; CI green |
| Pipeline G1/G2 (platform transfers, inherited anchor lines) | merged | #15 | `verify.sh` (pytest 306), live + Tokyo staging byte-identical before/after, raw-N02 proof; Codex review 4+1 findings fixed; 27/27 guard removals; CI green |
| S6P Tokyo follow-up: full 常磐線快速 (G2), composed 池袋–新宿 (G1) | merged | #16 | staged build + validate OK, oracle `25bc9e50…` re-checked vs product catalog, live identical, pytest 306; CI green |
| Pipeline stage validation profile | merged | #17 | `verify.sh` (pytest 342), live + Tokyo staging byte-identical; guard removals caught; CI green |
| S6P Chiba (Luna xhigh) | merged | #18 | 17/17 services, 152/152 stations; build+validate, oracle vs product catalog, live identical; CI green |
| S6P Kanagawa (Luna xhigh) | merged | #19 | 13/14 services, 97/103 stations; Sol review: 2 of 19 compositions wrong (湘南新宿 rapid 横浜–戸塚, 戸塚–大船) → fixed; CI green |
| S6P Saitama (Luna xhigh) | merged | #20 | 9/9 services, 75/75 stations; Sol review: 1 of 24 compositions wrong (湘南新宿 local 大宮–浦和 on 東北貨物線) → lead fix; CI green |
| S6 combined live dataset (Luna xhigh; fixes by Sol) | merged | #21 | `verify.sh` (pytest 373), raw-N02 rebuild identical, validate OK, Vitest 552, build, E2E 78/78, catalogue order/stop lists = product catalog; Sol review NEEDS_REVISION (東海道/京浜東北 多摩川, 常磐 快速/緩行 江戸川, 赤羽–浦和) → fixed; CI green |

**Next: S6V** (visual fixes found in the S6 browser review, Claude-led), then **S5** (rules flip Q1(c), seed proofs,
real-engine MC on final data) → **S7** (docs, release PR; production needs explicit approval).
**Executor switch (user, 2026-10-15): Codex limits are nearly exhausted — from S6V on, use Claude subagents only**
(`general-purpose-sonnet` for UI/mechanical work, `general-purpose-opus` for judgment and the independent reviews
that Codex Sol did before). Same contracts and lead gates.
Codex was near its rate limit at the end of this session: if Codex is unavailable, Claude subagents
(`general-purpose-opus` for pipeline/routing judgment, `general-purpose-sonnet` for mechanical tables)
can take a step with the same contract, gates and review (use a read-only Codex or Opus review).
Briefs: section "Next step briefs"; scope/tests per design §9.
Parallel steps use git worktrees under `.claude/worktrees/` (ignored); run Playwright in only one tree at a time
(ports). Expect handoff merge conflicts when parallel steps each append a section — keep both sections.

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

## S3a — registry, area and routing preparation — lead-verified (pytest 198, rebuild identical), review fixed, PR #12 (2026-10-13)

Status: **implemented; S3a review NEEDS_REVISION findings fixed, pending lead
verification/re-review** on `feature/jrcr-s3a`. The review is
`.claude/logs/codex/20261013T130053Z-jrcr-s3a-review.md`; both blocking findings,
both diagnostic findings and all requested missing test cases are addressed.
No commit, push or branch change was performed. The shipped 5 services / 67 stations
and all five `public/data` files remain byte-identical. S0b/S4 sections are unchanged.

Files by area:

- Registry/config: `scripts/data_pipeline/{config,registry,overrides,n02}.py`,
  `data/overrides/{dataset.json,stations.csv,services.json}`. Registry uses
  `prefecture,municipality[,n02_selector]`; homonyms need disjoint selectors and
  both registry/stop selectors must match. Regional bbox defaults are now dataset
  options; the shipped dataset retains its 23-ward membership via configured
  prefecture/municipality restrictions while using regional search/output bounds.
- Evidence/routing: `scripts/data_pipeline/{constraints,build,routing,network,rules,validate}.py`,
  per-service `scope.csv` and optional `detour_exceptions.csv` (empty live allow-list).
  `scopeSource` cites the reviewed served-stop evidence; the in-area rows must be
  contiguous and exactly equal `stops.csv`. Six existing area boundaries record
  last in-area / first out-of-area neighbours in evidence and build diagnostics.
  `stationNumberRules: {sequence, reason}` explicitly pins numbered, skip-number,
  prefix-transition and unnumbered stops. The legacy ±1 check remains available
  when no explicit sequence is configured.
- Multi-line recipes: optional `line_mapping.csv` JSON `route` cell with
  `{lines, joints, reason}`; one adjacent pair only, exclusive with `n02_line/via`.
  Ordered constrained graphs enforce endpoint platform lines and an actual shared
  joint, including an interior T-junction without a source vertex. Only `1e-6 m`
  projection noise is normalized; nearby disconnected tracks are rejected.
  Artifact validation checks route witnesses in order after simplification.
- Tests/docs: `tests/data_pipeline/{test_regional_preparation,test_regional_routing}.py`, schema-only edits
  to `test_overrides.py`/`test_geometry_chains.py`, migrated frozen core fixture,
  and `data/README.md` schema/migration documentation. All existing assertions remain.

Guard sensitivity was verified by **41 isolated in-memory mutations**, covering
every negative fixture in `test_regional_preparation.py` (including each parameter
and both negative assertions in mixed tests). Every mutated test failed during its
call; setup/collection failures do not count. Source guards were restored after each
run and no weakened/skipped tests were introduced. Full per-test failures and the
reproducible audit runner are under `.claude/logs/codex/jrcr-s3a-guard-removal.{json,py}`.
Strict messages prevent downstream guards from masking a regression: removing the
NaN numeric guard exposes a different bounds error; removing the joint-offset guard
exposes the separate disconnected-joint guard. Both make their tests fail.

The scope negatives now preserve correct loaded municipalities and the Maihama
boundary neighbour, injecting only an outside gap or an extra served registry stop.
Their unmodified evidence is a positive control. Missing recipe joints and the
`n02_line/via` exclusivity have separate negatives and positive controls. Added
coverage includes three-line builder recipes with an intermediate section filter
and ordered joints, consecutive recipes with one shared platform choice, incompatible
end/start lines, registry/stop selector conflict, and duplicate/unknown/non-finite/
non-increased detour exceptions. The two regional test files have **42 tests**.

Multi-line candidate exhaustion now reports the declared line order, 1-based joint
indices/transitions and up to three representative rejection reasons, including
endpoint-line mismatch, joint mismatch, disconnected leg index and snap offsets.
The zero-length guard is named `unused or zero-length line leg` to match its check.
Valid routing and emitted bytes retain the original behavior.

| Gate | Result |
|---|---|
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 32 files already formatted |
| `uv run ty check scripts/` | All checks passed |
| `uv run pytest` | 198 passed, zero skips/failures; baseline 156 + 42 regional tests |
| `uv run python -m scripts.data_pipeline.validate` | OK; 146 references, max chain 1, geometry 43,433 B, max detour 1.599; existing length/platform metrics unchanged |
| `sha256sum --check data/n02-2025.sha256` | Both raw inputs OK |
| Raw rebuild | `uv run python -m scripts.data_pipeline.build --out-dir /tmp/jrcr-s3a-review-fix-rebuild.u8VQdY > /tmp/jrcr-s3a-review-fix-build.log`; exit 0 |
| Rebuild comparison | `diff -r /tmp/jrcr-s3a-review-fix-rebuild.u8VQdY public/data`: no output, exit 0; all five public files unchanged |
| `npm run typecheck` | Passed in original S3a run; not rerun for Python-only review fixes |
| `npx vitest run` | Original S3a run: 23 files / 536 passed, zero failures; not rerun for Python-only review fixes |
| `git diff --check` | Passed |
| `git diff --stat` / `git status --short` | 20 tracked paths modified / 14 new files; public data, TS/UI, dependencies, DESIGN.md and STATE.md unchanged |
| Playwright E2E | Not run, as instructed; lead owns the browser/port gate |

Deviations: no functional scope deviation. An exact reviewed station-number
sequence is the explicit rule configuration, rather than a permissive arithmetic
step/prefix allow-list. The optional municipality restriction preserves the old
dataset's boundary semantics while regional membership defaults to prefecture only.
Existing input tables and the frozen fixture were migrated together; outside
neighbours are evidence, not new playable stations. Parsing helpers moved into
`constraints.py` while retaining the existing override API. Compose, DAG, primitive
anchors, budgets and catalogue expansion remain S3b/S6 work.

Remaining risks: lead acceptance/diff verification and independent re-review are
pending. `scripts/data_pipeline/overrides.py` is **799 lines** (800-line ceiling);
its parsing/loading/consistency responsibilities must be split before S3b adds code.
Regional selectors, track ownership and N02 gap workarounds still need
per-recipe evidence and raw/visual review in staging. Artifact validation cannot
prove N02 physical-line ownership without raw geometry. No missing 国立支線 or
池袋–赤羽 freight link is invented; a detour exception only raises its reviewed
pair's ratio limit and cannot bypass area/skipped-stop/joint checks.

## Next step briefs

S0b, S3a, S4 and S3b are merged (sections above/below). Next = **S6P**; the S3b bullet is kept for reference:

- **S3b (pipeline owner, after S3a):** first split the 799-line
  `scripts/data_pipeline/overrides.py` into focused parsing/loading/consistency modules
  while retaining the current public override API and 23-ward bytes; do this before
  adding S3b code. Then implement `compose` DAG validation/build order,
  multi-owner legs in both travel directions, exact primitive anchors, flattening and
  chain-length checks. Keep catalogue output order independent of DAG build order.
  Add per-dataset expected catalogues (the 23-ward dataset gets its own oracle),
  two-way reachability, raw/gzip/reference reports, per-dataset budget checks and a
  simplification knob with 1/3/5 m comparisons. Measure the proposed regional limits
  (GeoJSON 1.5 MiB raw / 450 KiB gzip; all five files 3 MiB raw / 900 KiB gzip),
  keeping the 23-ward dataset's own limits. Reject cycles, forward/reverse multi-owner errors, wrong-track
  sharing, platform-gap joints, backtracking, wrong last station, disconnection and
  catalogue mismatch. Preserve the 23-ward bytes. Estimate work from the remaining
  route/compose inventory, including through-service shared legs and multi-N02 routes;
  recipe/unique-owner counts remain unmeasured. Regional data stays in staging until S6.
- **S6P (regional staging; S3b accepted and merged):**
  inputs are the frozen `jr-east-capital-region-product-{catalog,services}.csv`, S0 id map,
  pinned raw N02, S3a registry/scope/selectors, S3b recipe schema and stage-specific oracle.
  Use `data/staging/jr-east-capital-region/<stage>/overrides/` for reviewed inputs and
  `/tmp/jrcr-s6p-<stage>/` for generated outputs, never live `data/overrides` or `public/data`.
  A cross-prefecture service has one owner/recipe set; prefecture work packages must not clone it.
  To stage Tokyo first, curate the selected services' in-area stops from the product catalog,
  including excluded immediate neighbours in `scope.csv`; include all composition owners
  in the stage's dependency closure. Set `areaPrefectures`, stage service output order,
  `budgetProfile: "capital-region"`, and `simplifyToleranceM: 1`. Author/review a separate
  `expected-catalog.json` (`services` + exact stop lists + first-appearance `stationIds`) and
  pin its file SHA-256 with `expectedCatalogFile` / `expectedCatalogSha256`. Do not derive
  this oracle from newly built output. Preserve the start/target circle and an interior start.
  Build and validate one completed Tokyo stage with:

  ```bash
  uv run python -m scripts.data_pipeline.build \
    --overrides-dir data/staging/jr-east-capital-region/tokyo/overrides \
    --out-dir /tmp/jrcr-s6p-tokyo
  uv run python -m scripts.data_pipeline.validate \
    --overrides-dir data/staging/jr-east-capital-region/tokyo/overrides \
    --data-dir /tmp/jrcr-s6p-tokyo
  uv run python -m scripts.data_pipeline.simplification \
    --overrides-dir data/staging/jr-east-capital-region/tokyo/overrides \
    --out-file /tmp/jrcr-s6p-tokyo-simplification.json
  ```

  Measure end-to-end wall-clock **build time** with `/usr/bin/time -p` around the build command
  (record raw-input size, machine and warm/cold cache state), and measure the maximum compose
  **dependency depth** for each stage. Use both measurements to decide whether a shared per-build
  flattening cache is needed; the S3b cache is currently scoped to a flattening invocation.
  Record route-only / multi-N02 / compose pair counts, flattened unique primitive owners,
  total references/max chain, per-file and five-file raw/gzip totals,
  1/3/5 m coordinates/Hausdorff errors, build duration, two-way reachability and oracle hash.
  Save per-segment visual evidence, shared-track line/section-filter reasons and exact-anchor
  checks; review hub/branch/through-service chains early. Measure desktop/phone parse/build/render,
  map overview/zoom and eventual save/restore separately: payload caps do not prove device performance.
  Current inventory: 627 canonical product pairs, 88 retained shipped pairs, **539 remaining**
  (461 local / 78 rapid); actual route/compose split and unique-owner counts remain unmeasured.
  Inventory: `../research/jr-east-capital-region-s3b-recipe-inventory.json`.
  N02 gaps to handle: 池袋–赤羽 freight link, 日暮里 常磐線 junction, 品鶴線 under N02 東海道線.
- **Later:** S6 final data in one commit (rules still all-equal) → S5 rules flip (Q1(c), subtitle,
  seed proofs, real-engine MC on final data) → S7 docs and release PR (production needs approval).

## S3b: composition, validation and budgets — DONE, lead-verified, merged via PR #13 (`cc87509`, 2026-10-13)

Uncommitted on `feature/jrcr-s3b`. No commit/push/branch change; live 23-ward public bytes,
TS/UI, dependencies, DESIGN.md and STATE.md are unchanged. No Playwright run.

Review `20261013T135744Z-jrcr-s3b-review.md` returned **NEEDS_REVISION**. Both blocking
findings and the requested non-blocking coverage/performance fixes are implemented:

- P1: compare every directed recipe chain before the non-compose early return and require
  the exact routed primitive ID set. Full-validator fixtures switch both rapid directions
  from their own bowed L2 route to an L1 owner and remove the owned primitive; both fail.
- P2: materialize required stations once; generator and tuple station inputs now produce
  identical forward/return reachability errors, including the previously missed no-return case.
- Comparison reports use topology-checked `generate_build()` before publication budget checks;
  normal `build()` still enforces budgets. A wavy-track fixture exceeds the cap at 1 m,
  while reporting all three tolerances and passing the cap at 3 m and 5 m.
- Flattening checks the DAG, indexes service/pair/range lookups and caches nested expansions
  within each invocation. `config.MAX_COMPOSE_PRIMITIVES` defaults to 4,096 (the explicit
  `max_primitives` argument can override it). Each append is bounded before allocation and
  backtracking checks; this is separate from the dataset's publication chain cap.
- Added distinct L0/L1 section filters in one genuinely multi-line source leg, in both
  directions, and a compose hop adjacent to an explicit L1 → L2 route with inherited
  endpoints. A 40-service / 627-pair synthetic DAG with depth 39 flattened in **2.004446 s**
  during concurrent checks (test bound 30 s); timing is recorded in the local JUnit artifact.

The first full revision run exposed one pre-S3b fixture declaring a shared rapid hop as
routed (`test_multi_owner_rapid_chain_passes_whole_dataset_validation`). Only its recipe
metadata was upgraded to an explicit two-owner composition with evidence; its geometry,
chain and success assertion are preserved. No test was deleted, skipped or weakened.

The first logical change split the 799-line `overrides.py`, preserving its imported public API.
Before S3b additions, all **198 existing Python tests passed unchanged**, `ty` passed, and a
raw-N02 rebuild into `/tmp/jrcr-s3b-split` matched `public/data` (`diff -r`, exit 0).
Module map (final line counts):

| Module | Responsibility | Lines |
|---|---|---:|
| `overrides.py` | compatibility re-exports (including existing constants/types/helpers) | 182 |
| `override_models.py` | immutable override records; lazy range expansion avoids a cycle | 174 |
| `override_parsing.py` | JSON/CSV cells, service/dataset fields, selectors and recipe parsing | 354 |
| `override_loading.py` | file IO, service loading, oracle validation | 140 |
| `override_checks.py` | stop/number/range and cross-table consistency | 228 |

Composition uses the existing S3a `route` column plus optional `compose` JSON column in
`line_mapping.csv`, rather than renaming the S3a columns. Compose is exclusive with `route`,
`n02_line` and `via`, and covers one forward adjacent stop pair. Schema:

```json
{
  "legs": [
    {"source_service": "owner-a", "from": "a", "to": "b"},
    {"source_service": "owner-b", "from": "b", "to": "c"}
  ],
  "shared_track_evidence": [
    {"lines": ["L0"], "allow": [], "deny": [], "reason": "Reviewed common track"},
    {"lines": ["L1"], "allow": [], "deny": [], "reason": "Reviewed common track"}
  ]
}
```

Evidence is per source leg and checked against every flattened owner's actual N02 lines/section
filters. Optional `line_filters: { "L0": { "allow": [], "deny": [] } }` must cover all declared
lines when distinct line constraints are needed. Source spans may traverse several source stops
in either direction, or nested compositions; circular source spans follow forward stop order.
`composition.py` validates the DAG and anchor identities, rejects cycles/backtracking/wrong last
stations and flattens all chains. `composition_build.py` inherits primitive endpoints, checks exact
metric joints and prevents mixed routed neighbours snapping away from an inherited anchor.
`composition_validate.py` compares every directed routed/composed chain to recipes, requires the
exact routed primitive ID set, and verifies composed output joints,
platform anchors, skipped stops and detours. Export keeps only routed owned primitives; reverse
segments reverse the entire flat list. DAG roots were deliberately reordered in a synthetic mixed,
nested, forward/reverse multi-owner build; all five serialized outputs remained identical.

Each on-disk dataset must name/hash an independent `expected-catalog.json` oracle. The shipped
23ku dataset and frozen core fixture each have their own oracle; exact service order/stop lists/
station union must match before building. Artifact service/station validation uses those checked
overrides. Actual directed segments must reach every station from the start **and back**, regardless
of the historical disconnected list. Both build and artifact validator enforce this condition.

`budgets.py` reports UTF-8 raw bytes, level-9 gzip (`mtime=0`) for each of all five files, summed
raw/gzip totals, flattened directed reference count and maximum chain length; build rejects overruns
before writing. `budgetProfile` plus optional positive integer `budgets` overrides selects:

| Cap | 23ku | capital-region (provisional; S6P must measure) |
|---|---:|---:|
| GeoJSON raw / gzip | 300,000 / 100,000 B | 1,572,864 / 460,800 B |
| Five-file raw / gzip | 1,048,576 / 307,200 B | 3,145,728 / 921,600 B |
| References / max chain | 1,000 / 64 | 20,000 / 128 |

The regional byte caps implement the brief's 1.5 MiB / 450 KiB GeoJSON and 3 MiB / 900 KiB total.
The original 23ku 300,000-byte GeoJSON cap remains; other 23ku and reference/chain caps are conservative
configurable defaults, pending measurement/review. `simplifyToleranceM` is finite/positive, default 1 m.
`python -m scripts.data_pipeline.simplification --out-file PATH` compares 1/3/5 m without writing
public data, including when the default output exceeds a publication budget. Measured current data:

| Tolerance | GeoJSON raw / gzip | Five-file raw / gzip | Coordinates | Max Hausdorff deviation |
|---|---:|---:|---:|---:|
| 1 m | 43,433 / 7,126 B | 87,647 / 13,710 B | 973 | 0.995212 m |
| 3 m | 36,850 / 5,582 B | 81,064 / 12,167 B | 657 | 2.984168 m |
| 5 m | 34,327 / 4,992 B | 78,541 / 11,576 B | 536 | 4.973172 m |

All have 146 references / max chain 1 and pass 23ku budgets. Only 1 m equals the shipped output.
Report: `../research/jr-east-capital-region-s3b-simplification.json`. Recipe inventory is recorded
alongside it; no regional playable rows have been added.

Executor acceptance evidence:

| Gate | Result |
|---|---|
| `uv run ruff check .` | Passed |
| `uv run ruff format --check .` | 46 files already formatted |
| `uv run ty check scripts/` | Passed |
| `uv run pytest` | **259 passed** (198 existing + 61 new); no skipped tests or weakened assertions; one existing fixture recipe upgraded as described above |
| `uv run python -m scripts.data_pipeline.validate` | OK; 87,647 raw / 13,710 gzip B, 146 references, max chain 1 |
| Raw rebuild | `uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --quiet --out-dir /tmp/jrcr-s3b-revision-XafT0u`, exit 0 |
| Byte equality | `diff -r public/data /tmp/jrcr-s3b-revision-XafT0u`, exit 0, no output |
| `npx vitest run` | **24 files / 551 passed** (Node 24.21.0 PATH prefix); no TS edits |
| Guard-removal audit | **33/33 isolated in-memory removals detected**; acceptance fixtures become accepted or lose their specific validation error, not an unrelated rejection |
| `wc -l scripts/data_pipeline/*.py` | 5,345 total; max 677 (`validate.py`), all below 800 |
| `git diff --check` | Passed |

Guard fixtures cover forward/reverse multi-owner recipe and artifact errors, cycles, wrong N02 line
and section sharing, metric/output/mixed-hop platform gaps, backtracking, wrong final station,
forward/return disconnection, independent catalogue and hash mismatch, all six budget caps and
validator enforcement, routed chain/primitive-set enforcement, generator no-return inputs,
bounded expansion, distinct per-line filters and normal-build budget enforcement while comparing.
The generator mutation restores double consumption directly; the other mutations isolate their
corresponding guards. Reproducible audit runner and detailed results:
`.claude/logs/codex/jrcr-s3b-guard-removal.{py,json,log}` (ignored local artifacts; preserved for lead).
These are executor results, not lead acceptance. Lead still must inspect all tracked/untracked diffs,
run acceptance/delegation gates and obtain an independent High-step re-review before landing S3b.
Final revision gate logs are `.claude/logs/codex/jrcr-s3b-revision-{pytest,validate,rebuild,vitest}.log`;
regional DAG timing/properties are in `.claude/logs/codex/jrcr-s3b-flattening.xml`.

## S4: map/UI scaling — lead-verified (Vitest 551, E2E 78/78), review APPROVE, PR #11 (2026-10-13)

Worktree `jrcr-s4`, branch `feature/jrcr-s4`; uncommitted. **All acceptance gates pass.** The lead-authorized regression fixes
resolve the single-service legend conflict and phone animation timeout. No existing assertion,
snapshot or test was deleted, skipped or weakened. Lead verification remains
required. S3a/S0b sections were not edited.

Review `.claude/logs/codex/20261013T130114Z-jrcr-s4-review.md` returned **APPROVE** with
no blocking issues. All three non-blocking polish/coverage items are applied:

- Clear history resets its internal `scrollTop` to zero on page changes before paint.
  Browser coverage scrolls page 1 to the bottom, verifies its first record is clipped,
  then checks page 2 starts at zero with turn 21 fully in view.
- The paced composed-hop browser case uses the full overview and asserts
  `highlightedRenderedIds` includes both owner-A and owner-B primitives while rapid is highlighted.
- A separate paced case restores the deterministic c4 turn-2 save and naturally completes
  turn 3 without skip. At 650 ms the displayed ride/filter/colour remain rapid; after
  completion they switch to owner A and `#0055AA`, preserving the committed save.
  A real-engine unit proof pins the restored input, roll 6, reverse segment, different
  landing service and 1,200 ms duration (650 ms unfinished / 1,300 ms finished).

Implementation/files:

- `src/features/map/{railwayLayers,serviceGeometry,lineColor,progressStyle,mapConfig}.ts`:
  static primitive source, line-metadata-coloured base and non-target layers, no constant offset;
  service-to-feature index deduplicates forward/reverse composed references. Separate highlight
  paints shared primitives in the ridden service colour during animation and landing service
  colour after accepted finish/skip. Target filters use the configured service, not an ID literal.
- `src/features/map/{RailwayMap.tsx,camera.ts}`: configurable `minZoom` (default 6), initial
  target view for regional extents; `全体` and `目標路線` camera controls disable follow and fit
  platforms outside reserved desktop/phone panel space. Compact bundles (maximum coordinate
  span <= 0.5 degrees) retain the existing full-network initial overview for compatibility.
  Labels start at zoom 11, retaining MapLibre collision handling.
- `src/features/game/animation/{movePath,timeline}.ts`: one step per composed hop in either
  direction, distance calibration in km, square-root distance pacing with clamped scale.
  Normal speed is 450 ms at 1 km, bounded 300–1,200 ms; fast 200–800 ms, slow 400–1,600 ms.
  Reduced motion remains immediate. Existing displayed-progress/runner semantics are reused.
- `src/{app/GameApp.tsx,features/game/presentation.ts,features/game/components/GamePanel.tsx,
  features/game/components/ClearScreen.tsx,styles.css}`: pass displayed ride to the highlight;
  flat service-name legend entries for single-service lines, collapsible groups only for two or
  more services, data colours and a bounded legend scroll area; candidate counts above
  four with a separate expandable complete list outside aria-live; 20-turn history pages.
  Short lottery text and histories <=20 records retain existing presentation behavior.
- `tests/e2e/{fixtures.ts,fixtures/bundle.ts,support/app.ts}`: new intercepted dataset and
  highlight observation. Existing `tests/e2e/fixtures/data` is unchanged.
- New `tests/e2e/fixtures/capital-region/{stations.json,services.json,segments.json,
  segments.geojson,manifest.json,seeds.ts}`, `tests/e2e/capital-region.spec.ts`, and
  `tests/unit/capital-region-scaling.test.ts`: **8 services / 5 lines / 37 stations /
  46 directed segments / 37 primitives**, seven candidates at Shinagawa. Rapid references
  owner A then owner B, reversed in reverse travel; branch crosses its hub and has a
  service-boundary endpoint. Six browser cases, 15 unit proofs. Two new server-rendered panel
  tests and the regional browser case cover both flat singleton items and collapsed/expanded groups.

Pinned seeds (shared by browser specs and real-engine unit proofs):

- `000000000000000000000000000000c4`: t1 roll 4, Shinagawa -> rapid; t2 roll 2,
  one forward composed hop to the south endpoint and reverse rapid choice; t3 roll 6,
  one reverse composed hop to Shinagawa and owner-A choice; **clears at t29**.
- `00000000000000000000000000000009`: t3 chooses branch; t4 reaches its service boundary;
  t5 traverses branch-end -> Shinagawa -> west-end. Separate from the old fixture trajectory.
- Every save in the c4 trajectory restores and continues identically; seed/candidate order,
  two-owner chains, one-hop presentation, clamp boundaries and stale finishes are unit-tested.

Acceptance evidence:

| Command | Result |
|---|---|
| `npm ci` | Required because node_modules was absent; 73 packages installed, 0 vulnerabilities |
| `npm run typecheck` | Passed, exit 0 |
| `npx vitest run` (final polish) | **24 files / 551 passed**, 0 failed; original 536 preserved + 15 new |
| `npm run build` | Passed, 67 modules; existing >500 kB chunk advisory remains |
| `npm run test:e2e` run 1 | **75 passed / 0 failed**, 2.8m; desktop-chromium **25/0**, phone-chromium **25/0**, desktop-firefox **25/0** (pass/fail) |
| `npm run test:e2e` run 2 | **75 passed / 0 failed**, 2.4m; desktop-chromium **25/0**, phone-chromium **25/0**, desktop-firefox **25/0** (pass/fail) |
| Phone paced case | **5.8 s / 5.7 s** in the two full runs, no retries or timeout increase |
| New regional E2E cases | **15/15 passed in each run**; target/full fit, flat/grouped legends, expansion, reduced motion, animation/skip, reload, paging and branch pass on all projects |
| Existing E2E cases | **60/60 passed in each run**, including the unmodified legend assertion, shipped-data smoke and old-fixture full game |
| Regional E2E cases (polish targeted run) | **18/18 passed**, 43.4 s; **6/0** per desktop-chromium, phone-chromium and desktop-firefox |
| `npm run test:e2e` (final polish) | **78 passed / 0 failed**, 2.5m; desktop-chromium **26/0**, phone-chromium **26/0**, desktop-firefox **26/0**; regional **18/18**, existing **60/60**, no retries |
| `git diff --check` | Passed |

Final polish logs: `.claude/logs/jrcr-s4/jrcr-s4-polish-{typecheck,vitest,build,e2e}.log`
and `jrcr-s4-polish-targeted-e2e.log` (gitignored). All four final acceptance commands exit 0.
Pre-polish regression-fix logs: `.claude/logs/jrcr-s4/jrcr-s4-fix-{typecheck,vitest,build}.log` and
`jrcr-s4-fix-e2e-run{1,2}.log` (gitignored). The original failing output remains in
`jrcr-s4-e2e.log`; original/fixed browser evidence is preserved independently of `test-results/`.
`git diff --stat` and `git status --short` are captured in the executor return/log after this update.
Local browser run used `::1`, WSLg Firefox WebGL2 and all three default projects; WebKit is not
configured locally. No commits/pushes/branch switches, new dependencies, live-data/pipeline edits,
or DESIGN.md/STATE.md edits.

Resolved regressions and deviations:

- **Existing UI conflict:** `tests/e2e/dice.spec.ts:80`:
  `await expect(legend.getByRole("listitem")).toHaveText(["山手線 踏破済み（実線）",
  "山手線 未踏破（点線）", "テスト南線", "テスト西線", "現在地"]);`
  The lead resolved this by requiring flat service-name items for singleton lines, retaining the
  service colour and omitting a group header/count. Only multi-service lines use `details`.
  The exact assertion remains unmodified and passes in all projects. The regional fixture's
  `広域支線` stays flat; `テスト広域線（3系統）` collapses/expands all three services.
- **Phone timeout root cause:** the new paced forward/reverse spec called `clock.runFor(650)`
  three times, synchronously replaying approximately 40 WebGL map/marker/follow frames per slice.
  The original trace measures **9,350.627 / 6,841.314 / 7,179.333 ms** wall time (**23.371 s**
  total) for those virtual 1.950 s. Setup/actions exhausted the unchanged 30 s test budget.
  Context: Pixel 7 **412 x 839**, DPR **2.625**, `no-preference` motion; Chromium repeatedly
  warns `GPU stall due to ReadPixels`. Roll/skip clicks finish in **114-230 ms** with visible,
  enabled, stable elements. The screenshot shows the skip button inside the phone panel;
  overlap/visibility and reduced motion are not the cause. The settled failure snapshot is
  from the test completing its assertions after the timeout deadline had already fired.
- **Phone fix:** prime each independent runner with `runFor(16)`, then `fastForward(634)`
  to the same 650 ms midpoint and `fastForward(650)` to completion. This samples elapsed time
  without replaying every intermediate software-WebGL frame; production animation is unchanged.
  Preserve all original midpoint/progress/ride/arrival/highlight/skip/save assertions and add
  midpoint-not-start coverage. No timeout, device settings or assertion was loosened. The
  targeted phone run passes **5/5 in 18.4 s**; the paced case takes **6.2 s** and all five
  clock calls together take **566 ms**. Original and fixed traces, screenshot and exact timings
  are preserved under `.claude/logs/jrcr-s4/phone-timeout-{original,fixed}/` and
  `phone-timeout-evidence.{md,json}`.
- Distance pacing was required by this task although design §6 calls it optional. Compact
  initial overview preserves shipped behavior; regional initial view follows the target design.
  Zoom 6 is a conservative configurable floor; final-catalog/device zoom measurement is still S6.

Remaining risks/TODOs: lead acceptance/diff verification; refresh synthetic candidate
proofs against the frozen full catalog during S5/S6; measure 472-station payload/initialization,
frame timing and long-history save/restore on final data. Synthetic-clock sampling is not a
real-device frame-rate measurement; that remains an S6 gate.

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

## S6P stage 1 — Tokyo (merged via PR #14, `76ae638`, 2026-10-14)

Prefecture validation follow-up: datasets without a circle can opt into
`validationProfile: "stage"` with a served `stageStartStationId`, omitting gameplay
`startStationId`/`targetServiceId`. Only target membership/circularity/first-stop,
start endpoint and target-only reachability checks are omitted; every-station
two-way reachability, pinned oracle and all other data checks remain. Stage output
uses the non-playable `3-stage` manifest schema and is forbidden at live overrides
and `public/data` paths. Tokyo keeps the default gameplay profile and identical
output. See `data/README.md` for syntax, commands and release migration.

Done Claude-led (`general-purpose-opus`; Codex read-only review NEEDS_REVISION → both items relabelled).
Staging: `data/staging/jr-east-capital-region/tokyo/overrides/**`; evidence and per-segment metrics:
`.claude/docs/research/jr-east-capital-region-s6p-tokyo.md`; test `tests/data_pipeline/test_staging_tokyo.py`;
generators/logs (local, ignored): `.claude/logs/jrcr-s6p-tokyo/`.

Result: 21 of 23 Tokyo-touching services, 137 of 142 Tokyo stations build from raw N02 and validate
(two-way reachability 137/137, oracle SHA-256 `747a78c9b238329306eaf259c610a8d89d8231eb7bb1bca6abd1b30cbe7f2363`).
Measurements: 198 +1 pairs = 177 single-line route / 4 route+via / 2 multi-N02 / 15 compose; 183 primitives;
366 references, max chain 1; max compose depth 2; five files 215,611 B raw / 33,853 B gzip (~7 %/4 % of caps);
1/3/5 m GeoJSON 105,451 / 84,829 / 77,100 B; warm build ~2.8 s (i5-1335U, WSL2). No shared flattening cache needed.
Not staged: 中央本線 高尾–藤野 (only 高尾 in Tokyo), 常磐線各停 綾瀬–金町 (connects via 松戸), 横浜線 成瀬/町田 enclave.

Decisions (user 2026-10-14: **all recommendations accepted** — D1(a), D2(a), D3–D6 as recommended; recorded in DESIGN.md Key Decisions):
- **D1 常磐線快速 品川–上野**: N02 東北線 track to 東京 and the 上野 常磐線 tracks are 17 m apart with no shared
  vertex. (a) pipeline feature: reviewed per-pair section filter / platform choice at one stop (fixes G2) —
  recommended; (b) synthetic 17 m connector (invents geometry, policy change); (c) drop the service (drops
  三河島/南千住/北千住). Staging keeps an INCOMPLETE 上野–北千住 fragment meanwhile.
- **D2 湘南新宿 赤羽–池袋**: N02 lacks the 駒込–田端信号場 freight curve. (a) accept the marked surrogate
  (東北線→山手線 via a vertex near 田端, 10.47 km vs real 11.3 km, detour exception 2.1) — recommended;
  (b) 赤羽線 route (5.5 km, wrong physical track); (c) leave open.
- **D3** Enclaves 成瀬/町田, 綾瀬–金町, 高尾–藤野: defer to the Kanagawa/Chiba stages — recommended.
- **D4** Duplicate 山手貨物線 geometry 池袋–新宿 (~4.8 km) because of gap G1: accept for staging, fix G1 before S6.
- **D5** Line metadata: one line per service in staging; legend grouping lines decided at S6.
- **D6** Staging-only endpoints: joban-rapid 上野 `service-boundary` (fragment), yokohama 相原 `area-boundary`
  (橋本 excluded neighbour).

Pipeline gaps (not patched in S6P; fix in a small pipeline step before S6):
- **G1** `composition_build.py:composed_pairs` keeps the owner's platform line; `routing.py:_pair_paths` then
  rejects an adjacent multi-line route's endpoint line; anchors also differ by 0.48 m.
- **G2** `build.py:route_service` allows one section filter per (service, N02 line) and `routing.route_path`
  picks one platform per stop, so a stop whose two neighbouring pairs need different disconnected parts of the
  same N02 line (上野) cannot be expressed.

Not done for Tokyo: browser visual review of segments, device performance, map zoom, save/restore (S6 gates).

### Tokyo follow-up (2026-10-14): G1/G2 and D1/D2/D4 resolved

- PR #15 (pipeline): `platform_transfers.csv` (`service_id,station_id,max_transfer_m,reason`) lets a reviewed stop
  arrive and depart on disconnected parts of one N02 line (limit (0, 250] m); published platform = arrival side
  in +1 order; validator bounds only the departing side and flags unused rows. Composed anchors inherit the
  owner primitive's N02 line (G1). Evidence: `.claude/docs/research/jr-east-capital-region-pipeline-g1g2.md`.
- PR #16 (staging): 常磐線快速 is the full 品川–北千住 run (上野 transfer 131 m); 湘南新宿 池袋→新宿 composes
  from 埼京線 (duplicate primitive removed); D2 surrogate unchanged. Stage now: 21 services, 137/142 stations,
  201 +1 pairs (16 compose), 185 primitives, five files 218,480 B raw / 34,078 B gzip, build ~2.4 s,
  oracle `25bc9e50ef0bb67494b0c24c7b81610acdcb62d1374707cfcc50f81565d8d224`.
- Lead decision: recipe 3 (compose 品川–上野) not adopted — it would add a second 64.3 m jump at 東京.
- Known limitation: the runner jumps the transfer distance at a transfer stop (131 m at 上野); browser review at S6.

## S6P complete — inputs for S6 (2026-10-15)

All four prefecture stages build from raw N02 and validate (stage profile for Chiba/Kanagawa/Saitama, gameplay
profile for Tokyo). Stage dirs: `data/staging/jr-east-capital-region/{tokyo,chiba,kanagawa,saitama}/overrides/`;
evidence: `.claude/docs/research/jr-east-capital-region-s6p-{tokyo,chiba,kanagawa,saitama}.md`.

| Stage | Services | Stations | +1 pairs (compose) | Five files raw / gzip | Oracle SHA-256 (prefix) |
|---|---|---|---|---|---|
| Tokyo | 21/23 | 137/142 | 201 (16) | 218,480 / 34,078 | `25bc9e50` |
| Chiba | 17/17 | 152/152 | 166 (2) | 228,003 / 41,395 | `c752d29a` |
| Kanagawa | 13/14 | 97/103 | 123 (18) | 149,326 / 25,240 | `dea41cf1` |
| Saitama | 9/9 | 75/75 | 104 (23) | 118,990 / 20,335 | `09651aec` |

Sum of stage outputs ≈ 715 KB raw / 121 KB gzip, well inside the capital-region caps (3 MiB / 900 KiB); builds take ~2 s each.

S6 work list (combined dataset, `areaPrefectures` = all four, gameplay profile, target 山手線, start 新橋):
1. Merge the four stages into one override set with ONE owner per service (a cross-prefecture service's
   stage fragments become one stop list/recipe set following the product catalog order).
2. Route the cross-border pairs listed in each stage's `cross-border-pairs.csv` (e.g. 蒲田–川崎, 金町–松戸).
3. Add the deferred stations/runs: Tokyo enclaves 成瀬・町田 (横浜線), 高尾–相模湖–藤野 (中央本線), 綾瀬・亀有・金町
   (常磐線各停); Kanagawa split run 横浜線 古淵–淵野辺–矢部–相模原–橋本.
4. Author the full expected catalogue from the product catalog (40 services / 472 stations), regenerate
   `public/data`, update real-data tests, and run the S6 gates (two-way reachability from 新橋, budgets,
   byte-identical rebuild, desktop/phone zoom/overview, browser visual review incl. the 131 m 上野 transfer jump,
   save/restore timing).

Review lesson from S6P: every composition (shared-track claim) must get an independent physical-track review —
geometric N02 agreement is not evidence (3 of 59 Luna/Sol compositions were wrong and caught only by review).
Model routing used: Luna xhigh for staging execution, Sol read-only for composition reviews (user approved).

## S6 — combined live dataset (merged via PR #21, 2026-10-15)

Evidence: `.claude/docs/research/jr-east-capital-region-s6.md`, per-pair N02 evidence
`.claude/docs/research/jr-east-capital-region-s6-n02-pair-evidence.csv` (traversed / endpoint-touch / candidate);
screenshots (local, ignored): `.claude/logs/jrcr-s6/screenshots/`.
Dataset: 40 services / 472 stations, 1,224 directed segments, 568 primitives, max chain 3, 59 compositions, 1 platform
transfer (上野), offset exceptions 2, detour exceptions 2; five files 744,720 B raw / 125,322 B gzip; build ~5 s;
expected catalogue SHA-256 prefix `42bcd19b`. Real-data playthroughs (all-equal rules): seed `real-alpha` 867 turns;
1,000-turn save ~362 KB, restore ~75 ms. N02 representation limits recorded: 常磐 綾瀬–金町 (one generalized line),
総武 江戸川 bridge (one line), 赤羽–浦和 列車線/東北貨物線 (one line west of the 京浜東北 track).

### S6V — visual issues to fix next (from the lead's screenshot review)

1. **Station markers hide the lines at overview zoom** (472 white circles). Scale marker radius with zoom and/or hide
   non-transfer stations below a zoom threshold; keep the current station, transfer stations and the target line visible.
2. **Desktop initial view is off-centre** (network pushed to the lower right, partly off-screen) — the initial
   target-line camera should centre 山手線 in the free area beside the panel; the 「全体」 fit must not be clipped.
3. **Legend too long on phone** (39 flat rows fill the panel): make the legend collapsible (collapsed by default on
   phone) or group by line family; keep the 山手線 progress entries always visible.
Gates: unit tests for the zoom/marker rules, E2E overview/target camera assertions on desktop and phone, updated
screenshots reviewed by the lead.

