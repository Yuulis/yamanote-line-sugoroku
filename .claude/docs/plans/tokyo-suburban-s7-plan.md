# S7 plan — real-data simulations, fixture E2E, docs and integration review

Source: Codex Sol `low` read-only (`.claude/logs/codex/20261019T013617Z-s7-plan.md`), saved by the lead 2026-10-19.

## Lead adjustments (override the plan body)

1. **Product-rule shards are reused, not regenerated.** `verify-simulation --shard-dir .claude/logs/s6/simulation/s6-fix`
   re-run by the lead at HEAD `3e35b6f` returned `verified`, 5,000 games, per-seed mismatch 0
   (`.claude/logs/s7/s6-fix-reverify.json`). S7 does not touch the engine, so R2a–d are dropped; the lead re-runs the same
   verify in R7. `tests/simulation/suburban-product.test.ts` stays byte-identical (it is in the code fingerprint).
2. **Observer output path.** The observer writes below `.claude/logs/s7/simulation/` (its own allow-list; it must not edit
   `suburban-product.test.ts`). The observer must reproduce the S6 per-seed turns exactly: the aggregator reads the
   `sim-*.json` shards from `.claude/logs/s6/simulation/s6-fix` as the golden and fails on any per-seed difference.
3. **Who runs what.** R1, R3 and R5 are Luna edit runs (serial). Observation shards (R2e–h), worker evidence (R4), local
   delivery (R6) and gates (R7) are named commands the lead runs. The `playwright.config.ts` worker pin (if chosen) is a
   lead edit after R4 evidence.
4. **R1 test path.** Observer tests go in `tests/unit/s7-simulation-observations.test.ts` (pure counter / eligibility /
   aggregation logic on small synthetic inputs, run by `npm test`); `tests/simulation/suburban-observations.test.ts` is the
   `S7_OBSERVE=1`-gated real-bundle runner (skipped when unset, run via `npm run sim`). The Python aggregator lives in
   `scripts/s7_simulation_report.py` with tests in `tests/data_pipeline/test_s7_simulation_report.py`.
5. **Docs language.** Match each file's existing language: `README.md` is Japanese and stays Japanese;
   `docs/manual/**` Japanese; `data/README.md`, `tests/simulation/README.md` and `railway_sugoroku_mvp_spec.md` follow their
   current language. Counts must be measured from `public/data/*` in the run (verified by the lead: 1,586 stations,
   135 services, 3,988 directed segments, 15 operators, 134 UI line groups, 46 alias stations); do not copy unverified counts.
   The README worker note is written after R4.
6. **Integration review (R8)** reviews `master...HEAD` plus the uncommitted S7 working tree (no commit before review; the
   user approves commits). Sol `low`, `--sandbox read-only`; the lead saves the response to
   `.claude/docs/reviews/tokyo-suburban-s7-review-1.md`.

---

## TL;DR

- S7 adds observational simulation evidence, deterministic browser coverage, current-edition documentation, and an independent whole-branch review.
- Preserve gameplay, product data, staging, baselines, and raw N02. S8 owns PR/CI evidence, live delivery verification, and release.
- Execute bounded Luna runs serially for edits; finish with a fresh-context Sol read-only review.

## Simulation

- Use the shipped bundle and `MVP_GAME_CONFIG`, never the generic harness’s default `decided` preset: that preset still means target share **1/2**.
- Chosen-rule acceptance has two parts: exact reproduction of frozen game lengths, and observation that eligible lotteries implement **2/3 target share** and **toward-target weight 2** under `tokyo-suburban-1`.
- Reproduce 5,000 games: seeds `s1m-20261012-0` through `s1m-20261012-4999`, cap 20,000 turns; four 1,250-game shards and an offset-0 repeat.
- Keep existing shard schema/fingerprint semantics intact. Use `.claude/logs/s6/simulation/s7/` because `suburban-product.test.ts` currently permits only S5/S6 output roots; document this compatibility path.
- Require `verify-simulation` status `verified`, zero per-seed/distribution mismatches, identical repeat except runtime, 100% completion, zero cap hits and zero games above 500 turns.
- Frozen turns: median **55**, p90 **146**, p99 **261**, mean **69.3858**, maximum **446**; nearest-rank quantiles.
- Add `tests/simulation/suburban-observations.ts` and `suburban-observations.test.ts`, gated by `S7_OBSERVE=1`; use real `createGame`/`playTurn` and emitted events. Do not modify engine/RNG or existing fingerprinted simulation files.
- Observer interface: `S7_OFFSET`, `S7_GAMES` (default 1,250), `S7_OUTPUT`; fixed seed scheme/cap above. Write each result before asserting failures.
- Record seed IDs/hash, full config, five bundle hashes, observer/engine source hashes, raw per-game turns/hops, completion, errors, zero-hop playing turns, invalid choices, and cap seeds.
- Count hops as traversed directed gameplay segments, including repeats; report per-game turns and hops min/median/p90/p99/mean/max, plus hops per turn.
- Target-share denominator: actual service draws with target among at least two candidates. Exclude forced target-only arrivals, non-target stations, pass-throughs, and clearing turns.
- Direction denominator: actual non-target two-direction draws whose next-station distances to the target differ. Report shorter-distance selections against expected 2/3; equal-distance draws separately against 1/2; forced/target directions separately.
- Independently derive expected weights from frozen config, candidate kinds, adjacency and reverse-BFS distances; compare with `landingOptions`. Do not use the same engine weight output as the sole oracle.
- Require zero weight/choice invariant violations and zero unreachable station identities, invalid transitions, zero-hop playing turns, or caught engine failures. Repeated visits alone are not stuck states.
- Report numerator, denominator, realized proportion, expected proportion, deviation, and descriptive 95% Wilson interval for each lottery class.
- Statistical diagnostic threshold: `abs(observed - expected) <= max(0.01, 5*sqrt(p*(1-p)/N))`, with at least 1,000 eligible weighted draws per primary class; zero/insufficient counts fail evidence completeness.
- Treat a threshold failure as an investigation trigger; never tune rules, seeds, or tolerance to pass. Game-length equality and structural invariants remain hard gates.
- Add a small aggregator/checker, `scripts/s7_simulation_report.py`, with `--input-dir` and `--output`; reject missing/overlapping seeds, stale hashes/config, malformed counters, and nonmatching repeat metrics.
- Store raw observations and aggregate JSON under `.claude/logs/s7/simulation/`; commit a concise methodology/results summary in `docs/manual/tokyo-suburban/implementation-status.md`, not raw logs.
- Legacy capital-region median 61/p90 148/p99 258 is dated context only; do not rerun it or require closeness.

## Fixture E2E

- Keep existing synthetic fixture trajectories and legacy goldens. Add product scenarios through the existing fixture loader’s `dataset: "real"` with stubbed map resources and pinned engine-generated saves.
- `tests/e2e/fixtures/seeds.ts` + `tests/unit/real-data-e2e-scenarios.test.ts`: pin seed/turns for each added scenario under `MVP_GAME_CONFIG`; prove the required transfer, ridden segment IDs, landing and next ride.
- `tests/e2e/tokyo-suburban.spec.ts`: add a real multi-operator arrival/transfer, preferably 後楽園・春日; assert actual cross-operator landing, browser lottery candidates, service-specific platform marker, panel service, and next real hop.
- Assert browser candidate names individually; S6’s `capital-region.spec.ts` array-membership check alone does not prove rendered behavior.
- Strengthen `tests/e2e/real-data.spec.ts` Oedo test: resume **before** turn 16, click dice into 都庁前, assert one `大江戸線（抽選枠2）` candidate row and exact engine save, then execute a hop on the selected Oedo service.
- Assert `乗車中` and applicable history/lottery text display `大江戸線`, retain the actual loop/radial service ID and geometry in saved/map state, and never expose internal loop/radial names as separate UI lines.
- `tokyo-suburban.spec.ts`: verify joined alias label in current-station panel and actual popup; verify service-specific original label in direction/history where applicable. Include an approved small-ヶ example such as 新百合ヶ丘.
- Expected Japanese text must be explicit; engine proofs establish trajectory, while display assertions independently check approved presentation.
- `tests/e2e/save-errors.spec.ts`: retain captured old-save cancellation/reload/byte-preservation checks; add absence of resume/results actions, confirmed discard followed by reload, and successful new product game.
- `tests/e2e/full-game.spec.ts`: retain all current fixture completion/history/restart assertions.
- `tokyo-suburban.spec.ts`: resume a proven product pre-clear state and click through the actual clearing turn; assert 新橋, all 30 target segments, exact saved completion/history and summary totals, reload/results, and restart at turn 0.
- Keep the existing invalid-network fallback regression from S6 and all six restored in-motion panel assertions.

## Playwright workers

- Current evidence: default local **4** workers failed eight tests; serial passed; S6 lead recorded **2** workers passing 115 tests with two existing project-specific skips. CI already selects two workers.
- Choose a bounded evidence pass before editing config: run identical map-heavy specs at 1, 2 and 4 workers, retries disabled, twice each, without concurrent simulations/builds.
- Record Node/browser/OS versions, available RAM, peak process memory/CPU if available, failed test names, timings, console/page errors, traces and browser exit ordering.
- If 1/2 remain reliable and 4 fails only under concurrency with readiness/render pressure, pin local and CI defaults to **2** in `playwright.config.ts`; describe resource pressure as supported, not proven.
- Confirm the full suite twice at two workers without retries. Keep `--workers=4` as an explicit diagnostic command; no blanket timeout increases or added skips.
- If failures recur at two workers or traces show an application race/invariant error, stop the mechanical run and return evidence to the lead for investigation. Do not conceal it by reducing coverage.
- `.github/workflows/ci.yml` needs no worker change while its existing config path remains two; document that fact. Local WebKit absence remains a coverage limitation, with CI evidence deferred to S8.

## Compression

- Inspect tracked hosting/Vite configuration; S6 found no `vercel.json`/`vercel.ts`. Do not introduce speculative hosting headers or precompressed files.
- Run normal production build and preview separately from the hook-enabled E2E build.
- For all five assets, record local `Content-Type`, `Content-Encoding`, `Vary`, compressed transfer bytes, decoded bytes and SHA-256 under identity/gzip/br requests.
- Verify decoded files equal `public/data/*`; report actual local MIME/encoding behavior, including uncompressed GeoJSON. Offline gzip budget sizes are not negotiated delivery evidence.
- Require successful parse/load and matching decoded hashes locally; do not require preview to emulate Vercel compression.
- S8 live check: authorized preview URL, actual CDN MIME (`application/geo+json` or documented JSON-compatible type), negotiated gzip/Brotli, cache/header behavior and decoded hashes. No deploy in S7.

## Docs

- Create Japanese `docs/manual/tokyo-suburban/rules.md` and `implementation-status.md`; this edition warrants its own theme beside historical editions.
- Describe approved scope, 135 services/134 UI lines/15 operators, 1,586 station groups, 2,142 stops, 3,988 directed segments, 30 target segments, unchanged goal, 2/3 share and conditional direction weighting.
- Explain official interchange identities/aliases, Oedo grouping/two lottery slots, small-ヶ spelling, endpoint behavior, filters/camera, save-v3 rejection/discard, measured limits and unreleased branch status.
- `README.md`: replace old current-edition title/counts/area/probability and manual links; document reliable E2E workers and current verification limits. Write edited prose in English.
- `data/README.md`: fix stale `jr-east-capital-1`, old source-catalog references and current-versus-historical wording; retain valid `capital-region` budget-profile identifiers and historical build instructions.
- `railway_sugoroku_mvp_spec.md`: prepend an English Tokyo suburban current-edition addendum; relabel capital-region addendum historical, preserve historical contracts and section numbering. Do not translate the historical MVP body.
- `docs/manual/jr-east-capital-region/{rules,implementation-status}.md`: add Japanese historical banners/current links; retain dated old counts, probabilities and release evidence as history.
- `docs/manual/jr-east-tokyo/{rules,implementation-status}.md`: update current-edition pointers while retaining historical content.
- `docs/manual/development-roadmap/proposal.md`: mark the dated proposal’s baseline explicitly; add current-edition/status links without adopting its proposed features or rewriting past decisions.
- `tests/simulation/README.md`: distinguish generic legacy presets from `SIM_CONFIG=product` and document S7 observation commands/denominators.
- Preserve licence/attribution notices and colour citations; title-screen notice removal does not authorize unrelated licence deletions.
- Lead alone updates stale current-edition summary/status in `DESIGN.md` through `update_design.py`; Luna returns suggested factual replacements.

## Integration review

- Last run: fresh-context **Sol read-only**, independent of implementation, reviewing complete `master...HEAD` plus final uncommitted S7 changes if any.
- Prefer a clean committed review snapshot prepared by the lead; record base/head SHAs. Current branch scale is 3,236 files, 404,915 insertions and 1,761 deletions, so use inventories and focused generated-data checks.
- Output `.claude/docs/reviews/tokyo-suburban-s7-review-1.md`: verdict, prioritized findings with paths/lines, checks actually run, evidence inspected and explicit unverified items.
- Check all S0–S7 requirements, product rules/save/replay, simulations, browser assertions, docs, fallback handling, unchanged test strength, placeholders, swallowed errors, hardcoded substitutes and unrelated edits.
- Check staging/baseline evolution against authorized S0–S6 history; require **no S7 changes** there. Do not demand whole-branch immutability for intentionally added historical/staging artifacts.
- Verify frozen inputs/provenance hashes, four payloads against `c76ad92`, `uiPresentation` against `478e3ca`, dataVersion, raw-source checksums and generated-data reproducibility evidence.
- Check LF in changed text, Noto Sans JP fixture origin/hash/OFL notices and generated glyph documentation, MLIT attribution, and all line-colour source citations/checksum.
- Review worker failures/skips and delivery/device gaps honestly. No release approval, CI-success claim, or speculative performance fix.
- Any required fix invalidates the “last review” position: implement and verify, then obtain a final independent review of the resulting snapshot.

## Runs

1. **R0 — lead preflight:** save this plan; capture `git status --short`, `git rev-parse HEAD`, `git diff --stat master...HEAD`; preserve the existing edit to `.claude/docs/plans/tokyo-suburban-impl-prompts.md`.
2. **R1 — Luna, ≤30 min:** implement observer, aggregator and meaningful unit tests for counters/eligibility/aggregation, including invalid seeds/hashes; no engine edits.
   Acceptance: `npm run typecheck`; `npx vitest run tests/unit/s7-simulation-observations.test.ts`; `uv run pytest -q tests/data_pipeline/test_s7_simulation_report.py`.
3. **R2a–d — measurement runs, each ≤30 min [parallel eligible, separate output files; no browser runs]:** run one offset per invocation:
   `SIM_BUNDLE=public/data S5_OFFSET=0 S5_GAMES=1250 S5_OUTPUT=.claude/logs/s6/simulation/s7/sim-0.json npm run sim -- tests/simulation/suburban-product.test.ts`
   Repeat for offsets **1250/2500/3750**, matching filenames; repeat offset 0 to `sim-repeat.json`. Use at most two concurrent shards after measuring resource use.
4. **R2e–h — observations, each ≤30 min [parallel eligible as above]:**
   `S7_OBSERVE=1 S7_OFFSET=0 S7_GAMES=1250 S7_OUTPUT=.claude/logs/s7/simulation/observe-0.json npm run sim -- tests/simulation/suburban-observations.test.ts`
   Repeat remaining offsets and offset-0 repeat as `observe-repeat.json`; create output directories first.
5. **R2i — lead aggregation:**
   `uv run python -m scripts.data_pipeline.product_suburban verify-simulation --shard-dir .claude/logs/s6/simulation/s7`
   `uv run python scripts/s7_simulation_report.py --input-dir .claude/logs/s7/simulation --output .claude/logs/s7/simulation/summary.json`
   Require all Simulation criteria and exact observer-versus-golden per-seed turns.
6. **R3 — Luna, ≤30 min:** add seed proofs and fixture/product E2E checks listed above; split proof and browser edits into two bounded runs if necessary.
   Acceptance: `npx vitest run tests/unit/e2e-fixture-seeds.test.ts tests/unit/real-data-e2e-scenarios.test.ts`
   `npx playwright test tests/e2e/tokyo-suburban.spec.ts tests/e2e/real-data.spec.ts tests/e2e/save-errors.spec.ts tests/e2e/full-game.spec.ts --workers=2 --retries=0`
7. **R4 — worker evidence, ≤30 min per batch:** for each N=1,2,4 run twice:
   `npx playwright test tests/e2e/map-visual.spec.ts tests/e2e/real-data.spec.ts --workers=N --retries=0 --trace=on`
   Substitute literal N; archive results after each command under `.claude/logs/s7/workers/`. Apply the decision above, then run `npx playwright test --workers=2 --retries=0` twice in separate batches.
8. **R5 — Luna docs, ≤30 min per batch:** update current docs/new manual, then historical banners/spec; use validated metrics. Acceptance:
   `rg -n '40|472|1/2|1都3県|jr-east-capital-1|23区' README.md data/README.md docs/manual railway_sugoroku_mvp_spec.md`
   Classify every hit as current error, historical fact or technical identifier; check all edited relative links.
9. **R6 — lead local delivery:** `npm run build`; `npm run preview -- --host 127.0.0.1 --port 4320`; in another shell:
   `curl --compressed -sS -D .claude/logs/s7/geojson-headers.txt -o .claude/logs/s7/segments.decoded.geojson http://127.0.0.1:4320/data/segments.geojson`
   `cmp public/data/segments.geojson .claude/logs/s7/segments.decoded.geojson`
   Repeat five assets/identity/gzip/br; capture headers with explicit `Accept-Encoding`; stop preview afterward.
10. **R7 — lead gates, split ≤30 min batches [frontend/pipeline parallel eligible]:**
    `npm run typecheck`; `npm test`; `npm run build`
    `uv run ruff check .`; `uv run ruff format --check .`; `uv run ty check scripts/`; `uv run pytest -q`
    `uv run python -m scripts.data_pipeline.validate`
    `uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py`
    `uv run python -m scripts.data_pipeline.product_suburban verify`
    `uv run python -m scripts.data_pipeline.product_suburban verify-inputs`
    `uv run python -m scripts.data_pipeline.product_suburban verify-history`
    `git diff --exit-code c76ad92 -- public/data/stations.json public/data/services.json public/data/segments.json public/data/segments.geojson`
    `git diff --exit-code 478e3ca -- public/data/manifest.json data/staging data/baselines N02-25_GML`
    `git diff --check`; `git diff --check master...HEAD`
11. **Every edit run:** lead runs `verify_delegation.py` with its captured base and explicit expected/allowed files, inspects full diff, rejects weakened tests/out-of-scope changes, and checks changed-text LF. Serialize workspace-write runs.
12. **R8 — final independent Sol review [last; no parallel edits]:** use Integration review scope/output above; lead verifies findings and records acceptance. S8 remains pending.

## Risks

- Observational draws are conditioned on evolving game states; report intervals as descriptive and rely on structural/exact replay gates for rule fidelity.
- CPU-heavy parallel measurements can contaminate worker diagnostics; keep those phases separate and preserve failed-run evidence.
- Physical-device performance, actual touch-pan and the pre-existing 1.32 MB main chunk remain explicitly open; no code-splitting work in S7.
- A local preview cannot establish deployed MIME/compression. CI/WebKit and release evidence remain S8 work.

## Decisions needing the user

- None for this scope. Approved product decisions remain frozen.
- If evidence exposes a gameplay change requirement or a reproducible application race beyond bounded verification work, return findings to the lead; do not make a product decision.
