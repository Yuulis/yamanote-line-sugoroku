# Handoff: JR East capital-region (1都3県) edition

Status (2026-10-13): **S0 DONE** on `feature/jrcr-s0`, cut from integration branch
`feature/jr-east-capital-region` (based on `develop`). The revised research catalog v2 was
user-approved on 2026-10-13: **666 rows / 40 services / 472 physical stations**.
**S1 implemented on `feature/jrcr-s1`; review findings addressed, pending final lead verification**;
next step: **S1M**.
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
  is the 2 -> 3 version-pin replacement, not a removed assertion). Committed on `feature/jrcr-s1`.

No data/pipeline/schema/geometry/map/UI edits were made in S1.

Scope notes: missing service kinds in shipped data are treated as `local`; explicitly provided
unknown kinds are rejected by the engine network builder. `geometryFeatureIds` array copying in
design §4 remains for the atomic S2 data-contract cutover: S1 still has scalar `geometryFeatureId`.
S0b must finalize product classification as `local | rapid`; S2 must narrow the product `ServiceKind`
and aligned validation/config/schema/tests to those two kinds. Do not defer this to S5; broader
research classifications remain separate.

## Next step — S1M: real-engine Monte Carlo harness

After final S1 lead verification of the review fixes, use the approved
**research-ID catalog v2** (`jr-east-capital-region-{catalog,services}-v2.csv`, 666 rows / 40 services /
472 stations), independently of S0b product-ID output. Build a simulation network and exercise
candidate policies through the real engine. Own `tests/simulation/**`, a new
`vitest.simulation.config.ts` and an npm script; large runs must remain excluded from `npm test`.
Add one small fixed-seed agreement test to the unit suite. Record catalog hash, seed set, complete
config, cap count and median/p90/p99 for each large run; keep the same entry point usable later
with shipped regional data. S5 alone flips the product's all-equal policies.

## Decisions and remaining gates

Q1–Q11 are resolved. Services represent track systems/base routes, excluding upper train types.
Keep both whole Shonan-Shinjuku base routes (including Takasaki/Tokaido rapid); truncate Kururi at Kururi.
Adopt Q1(c) only at S5: Yamanote share 1/2, other services uniform, direction toward Yamanote weighted 2:1.
Goal unchanged; weekday patterns; through junctions shown as service boundaries; subtitle 「JR東日本 1都3県版」.

Prior v1 review APPROVE is historical; the former v2 NEEDS_REVISION selection issue was corrected before
user approval. S1M real-engine confirmation, S0b product-catalog generation, N02 recipe/routing evidence,
payload/device/zoom budgets and full-catalog UI/seed checks remain. N02 lacks the Ikebukuro–Akabane freight
link and has a Joban junction gap; regional data preparation must address those. Release flow remains
feature → develop → master; production deployment requires explicit approval.
