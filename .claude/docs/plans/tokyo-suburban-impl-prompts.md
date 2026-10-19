# Implementation prompts (Tokyo suburban edition, S0–S8)

Delegation contracts for the implementation steps in `tokyo-suburban-network-design.md` section 4, kept here so
any executor can (re)run them. Default lane: Codex Luna `high`; reviews: Codex Sol `low`, read-only.

```bash
# Extract one section below into .claude/logs/codex/prompt-<step>.md, then:
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file .claude/logs/codex/prompt-<step>.md --label <step> --sandbox danger-full-access \
  --caller main --timeout 3600 --model "${CODEX_MODEL_LUNA:-gpt-6-luna}"
```

User decisions D1–D4 are final (DESIGN.md Key Decisions, 2026-10-16). The lead verifies every run (acceptance
commands, `verify_delegation.py`, diff reading) and updates `tokyo-suburban-network-handoff.md` after each step.

## s0 — freeze the implementation baseline

Objective: freeze the approved research inputs and the user's D1–D4 decisions into one machine-checkable baseline,
so S1–S8 build against fixed hashes, counts and rule settings, and any drift fails loudly.

Read first: `.claude/docs/plans/tokyo-suburban-network-design.md` (proposal; sections 2 and 4),
`.claude/docs/research/tokyo-suburban-r2.md` (sections 1, 3, 6, 8), `.claude/docs/DESIGN.md` (Key Decisions dated
2026-10-15 and 2026-10-16), `.claude/docs/research/tokyo-suburban-r2-tools/check_catalog.py` (reuse its strict CSV
reader and checks instead of duplicating them), `.claude/rules/coding-principles.md`, `.claude/rules/language.md`.

Final decisions to freeze (2026-10-16):
- D1: R2 rule B (official interchanges inside a 600 m station-point group; shared structures; same-name priority;
  original names kept as aliases; no same-service collapse, no distinct-JR-id collapse). The tracked research catalog
  `.claude/docs/research/tokyo-suburban-research-catalog.csv` + `-services.csv` is this case.
- D2: Yamanote target share 2/3 at target stations, toward-target direction 2:1, goal unchanged (all 30
  `jr-yamanote` outer directed segments, then arrive `shimbashi`). Take the exact numeric lottery config from the
  matching case in `.claude/docs/research/tokyo-suburban-r2-results.json` (do not invent a parameterization), and
  record that case id and its games/median/p90/p99/max. Proposed ruleset id: `tokyo-suburban-1`.
- D3: research service boundaries unchanged (Joban Shinagawa–Namie, Chuo main Takao–Shiojiri, Utsunomiya
  Tokyo–Kuroiso single services; Shinonoi and Shinetsu separate; Mito line ends at Tomobe; Chiyoda Kita-Ayase in the
  same service; Seibu Yamaguchi included; shipped ids kept, including `jr-chuo-takao-fujino`). Oedo: the engine may
  keep the loop and radial as two services sharing Tocho-mae, but the UI must present them as ONE line named
  大江戸線 — record the two service ids and a `uiLineGroups` entry mapping both to one display line.
- D4: title `山手線すごろく`, subtitle `東京近郊版`; remove the two notice sentences in
  `src/features/game/components/TitleScreen.tsx` (the 「オリジナルゲーム」 and 「非公式のファンメイド作品」 lines).
  Record this only; do NOT edit the source in S0.

Deliverables:
1. `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (pretty-printed, sorted keys, UTF-8, trailing newline), with:
   `schemaVersion`; `inputs` (repo-relative path → sha256 for every tracked `tokyo-suburban-r1-*`, `-r2-*` and
   `-research-*` file under `.claude/docs/research/` that S1+ consume, excluding `__pycache__`); `counts` (services,
   station groups, service-stop rows, directed segments, per-operator services and stops, per-prefecture station
   groups); `shipped` (472 station ids and 40 service ids retained, with their contiguous order verified);
   `ruleset` (D2 above + source case id + measured stats); `representations` (D3 above incl. `uiLineGroups`);
   `presentation` (D4 above); `knownN02Concerns` (copy the list from design section 4 as short strings).
2. `.claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py`: recomputes every hash and count from the tracked
   files and compares with the freeze JSON; strict CSV parsing (reject extra/missing fields); station coverage
   reconciliation: every station group is referenced by at least one service, every service stop resolves to a
   group, every group is reachable from `shimbashi` over the directed segments, the shipped 472/40 identities and
   their original contiguous stop sequences are present; the Oedo `uiLineGroups` entry names exactly two existing
   services. `--write` regenerates the JSON; default mode only checks. Path overrides (`--catalog`, `--services`,
   `--freeze`) so a tampered copy can be tested. Exit 0 ok, 1 bad args, 2 mismatch. Type hints on every function,
   no magic numbers, early returns.

Scope: in — the two files above. Out — product code (`src/`, `scripts/`, `data/`, `public/`), research CSV/JSON
contents (read-only), `DESIGN.md`, handoff docs, git commits/pushes.

Acceptance (run all and paste the tails into your reply):
```bash
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_catalog.py
uv run python .claude/docs/research/tokyo-suburban-r2-tools/verify_results.py
uv run ruff check .claude/docs/research/tokyo-suburban-r2-tools/ && uv run ruff format --check .claude/docs/research/tokyo-suburban-r2-tools/
# negative: copy the catalog to the scratch dir, change one station name, expect exit 2
```

Output: sections `Summary`, `Frozen values` (counts, ruleset case id + stats, Oedo ids), `Acceptance` (command →
exit code + last lines), `Deviations / open issues`. Keep it under 60 lines; anything longer goes to
`.claude/logs/codex/` and you return the path.

## s1-plan — S1 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable implementation plan for S1 (multi-operator pipeline selection) that a
Codex Luna executor can implement in one or a few runs without making design decisions.

S1 per `.claude/docs/plans/tokyo-suburban-network-design.md` section 4: per-service N02 operator/source and
per-stop match-name/selector selection; curated display aliases; extended scope validation. Acceptance there:
both sides of different-name groups (後楽園/春日, 浜松町/大門) select real platforms; multi-operator homonym and
operator-boundary regressions; legacy single-operator regression; no relaxed wrong-track checks.

Read: the design doc (sections 3–4), `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (frozen decisions; D1
identity rule, D3 Oedo UI group), `data/README.md`, `scripts/data_pipeline/*.py` (notably `build.py`, `export.py`,
`n02.py`, `registry.py`, `catalogue.py`, `override_*.py`, `validate.py`, `config.py`), `data/overrides/**`,
`tests/data_pipeline/`, `src/types/` (only the generated-data contract), `.claude/rules/coding-principles.md`,
`.claude/rules/testing.md`.

Constraints:
- S1 changes the pipeline and override schema only. It does NOT stage any new operator or JR outlying data (that
  is S2/S3) and does NOT change runtime/UI code. The current 40-service build must regenerate `public/data/*`
  byte-identical (or, if a contract change is truly unavoidable, state exactly which bytes change and why).
- Raw N02 under `N02-25_GML/UTF-8/` is read-only. No relaxed wrong-track/offset checks; no proximity-only joins.
- Keep display/registry names separate from per-stop original names and N02 match names.
- Prefer the smallest schema extension that S2–S4 can build on; avoid speculative abstraction.

Output (markdown, ≤150 lines): `TL;DR`; `Current single-operator assumptions` (file:line list); `Schema changes`
(override tables/fields with an example row each, defaults that keep legacy data valid); `Code changes` (per file,
in implementation order, small enough for one Luna run each — mark run boundaries); `Tests` (named test cases
incl. fixtures for 後楽園/春日 and 浜松町/大門 across operators, a homonym such as 押上 or 新宿 across operators, an
operator-boundary station, and legacy byte-identity); `Acceptance commands` (exact); `Risks`; `Decisions needing
the user` (only genuine product choices; say "none" if none).

## s1-run — S1 implementation runs (Codex Luna `high`; replace `<RUNS>` with `1–2`, `3–4` or `5–6`)

Objective: implement plan runs <RUNS> of `.claude/docs/plans/tokyo-suburban-s1-plan.md` exactly, leaving the
live 40-service build byte-identical, so the next run (or S2) can build on it.

Read first: `.claude/docs/plans/tokyo-suburban-s1-plan.md` (the contract — follow its schema, file list, tests
and constraints; implement only runs <RUNS>), `.claude/docs/plans/tokyo-suburban-s0-freeze.json`,
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`, `.claude/rules/dev-environment.md`.
Earlier runs are already in the working tree (uncommitted); build on them, do not redo or revert them.

Scope: in — the files the plan assigns to runs <RUNS>, plus the tests the plan names for them. Out — `public/data`,
live `data/overrides/**` content (fixtures go under `tests/`), `src/**`, raw `N02-25_GML/**`, research files,
handoff/design docs, git commits/pushes. No relaxed tolerances (snap 30 m, joint 1e-6 m, offset, detour, wrong-track);
no proximity-only joins; no fallback to another operator when candidates are empty. Never weaken, skip or delete
existing tests. If the plan is wrong or ambiguous on a point, choose the most conservative option and report it.

Acceptance (run all, paste exit codes and tails):
```bash
uv run ruff check scripts/data_pipeline tests/data_pipeline && uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q
rm -rf .claude/logs/s1-build-a && uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 --overrides-dir data/overrides --out-dir .claude/logs/s1-build-a --quiet
diff -r public/data .claude/logs/s1-build-a
git diff --exit-code -- public/data data/overrides src N02-25_GML
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
```
Run 5–6 additionally: the full acceptance block in the plan (second build `-b`, `diff -r` a/b, `validate`,
`pytest tests/data_pipeline/test_multi_operator_raw.py -q -rs` with zero skips).

Output (≤60 lines): `Summary`, `Files changed` (one line each), `Tests added` (names), `Acceptance` (command →
exit code + tail), `Deviations from plan`, `Open issues`.

## s2-plan — S2 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable plan for S2 (JR outlying staging) that Codex Luna can implement in a few
bounded runs without making design or product decisions.

S2 per `.claude/docs/plans/tokyo-suburban-network-design.md` section 4: stage the JR services of the frozen Tokyo
suburban area beyond the shipped 1都3県 set (15 new JR services, 10 extended shipped services, ~274 new JR station
ids per R1), preserving the existing routed/composed capital-region segments. Route each new pair; resolve the
Oyama (Ryomo/Mito) and Mito/Suigun 25–41 m N02 junction gaps explicitly; no fabricated connectors.

Read: the design doc (sections 1, 3–5); `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (frozen JR services,
boundaries D3: Joban Shinagawa–Namie, Chuo main Takao–Shiojiri, Utsunomiya Tokyo–Kuroiso single services; Shinonoi /
Shinetsu separate; Mito line ends at Tomobe; keep `jr-chuo-takao-fujino`); `.claude/docs/research/tokyo-suburban-r1-jr.md`
and `-r1-jr-catalog.csv`; `.claude/docs/research/tokyo-suburban-research-catalog.csv` / `-services.csv` (the frozen
JR rows); `.claude/docs/plans/tokyo-suburban-s1-plan.md` and `.claude/docs/reviews/tokyo-suburban-s1-review-2.md`
(new S1 override fields; carry-overs a/b); `data/README.md`; `data/overrides/**`; the previous edition's staging
precedent `data/staging/jr-east-capital-region/**` and how it was merged (git log of `data/staging`,
`.claude/docs/plans/jr-east-capital-region-handoff.md`); `scripts/data_pipeline/*.py`; `tests/data_pipeline/`.

Constraints:
- S2 stages JR data only (no subway/private: S3; no cross-operator identity merge: S4). It must not change the
  shipped bundle: `public/data/*` and live `data/overrides/**` stay byte-identical, unless you show that staging
  cannot work without a live-override change and specify it exactly (then the live build must still be byte-identical).
- Preserve all 472 shipped station ids and 40 service ids and their geometry/compositions; extended services keep the
  shipped prefix order and add only the frozen outward stops.
- Raw N02 is read-only; no relaxed snap/joint/offset/detour/wrong-track tolerances; no proximity-only joins; no
  fabricated connector geometry. A junction gap is resolved only by a reviewed, evidenced rule (say exactly which).
- Station order must equal the frozen research catalog rows; every new stop needs an N02 match (name/operator/selector).
- Split into runs a Luna executor can finish in ≤ ~30 min each (e.g. per region: Tohoku/Joban side, Takasaki/
  Ryomo side, Chuo/Shinonoi/Shinetsu side, Tokaido/Ito side), each independently testable.

Output (markdown, ≤150 lines): `TL;DR`; `Staging layout` (directories, which files, how the staged build is invoked
and how S5 will consume it); `Service inventory` (new vs extended, per run, with stop counts from the freeze);
`Known geometry problems` (Oyama, Mito/Suigun, any other the R1/N02 data shows, with the proposed evidenced
resolution); `Runs` (per run: files, steps, tests, acceptance commands — exact); `S1 carry-overs` (where a and b are
done); `Risks`; `Decisions needing the user` (only genuine product choices; "none" if none).

## s2-run — S2 implementation runs (Codex Luna `high`; replace `<RUNS>` with the run ids, e.g. `R0 and R1`)

Objective: implement S2 plan run(s) <RUNS> of `.claude/docs/plans/tokyo-suburban-s2-plan.md` exactly, keeping the
shipped bundle byte-identical, so the next S2 run can build on it.

Read first: `.claude/docs/plans/tokyo-suburban-s2-plan.md` (the contract: layout, inventory, geometry rules, the
`s2gate` function, per-run files/tests/acceptance), `.claude/docs/plans/tokyo-suburban-s0-freeze.json`,
`data/README.md`, `.claude/rules/coding-principles.md`, `.claude/rules/testing.md`, `.claude/rules/dev-environment.md`.
Earlier S2 runs are already in the working tree or committed; build on them, never redo or revert them.

Scope: in — exactly the files the plan assigns to <RUNS> (staging directories, new tests, and — only for R0–R2 —
the named pipeline files). Out — `public/data`, live `data/overrides/**`, `src/**`, raw `N02-25_GML/**`, research
files, docs under `.claude/`, git commits/pushes. Region runs (R3–R6) must NOT modify `scripts/` or shared test
helpers: if one is needed, stop and report exactly what and why. Another region run may be working in parallel in
its own staging directory: never touch other regions' files.
No relaxed tolerances (snap 30 m, joint 1e-6 m, offset, detour, wrong-track), no proximity-only joins, no fabricated
connectors, no cross-operator fallback. Never weaken, skip or delete existing tests. Expected values come from the
frozen research catalog, never from the build output. Use Python `shutil.rmtree` to clear output dirs (`rm -rf`
is blocked). Write prose (README, comments) in English. If the plan is wrong on a point, take the most conservative
option and report it.

Acceptance: the plan's acceptance for <RUNS> (region runs: `s2gate <region>`), plus always:
```bash
uv run ruff check scripts/data_pipeline tests/data_pipeline && uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
git diff --exit-code -- public/data data/overrides src N02-25_GML
```
and for R0–R2 and R7 the live byte-identity build from the plan (`diff -r public/data .claude/logs/s2/live`).

Output (≤60 lines): `Summary`, `Files changed`, `Tests added`, `Acceptance` (command → exit code + tail),
`Deviations from plan`, `Open issues`.

## s3-plan — S3 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable plan for S3 (subway and private-railway staging) that Codex Luna can
implement in bounded, mostly parallel runs without making design or product decisions.

S3 per `.claude/docs/plans/tokyo-suburban-network-design.md` section 4: stage every non-JR service of the frozen
catalog in independent operator groups. Acceptance there: station count/order/endpoint/source checks; platform
membership and actual geometry paths verified. Cross-operator station identity (D1 groups) is S4, not S3.

Read: the design doc (sections 1–5); `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (frozen non-JR services, D3:
Oedo loop + radial sharing 都庁前 with UI group `toei-oedo`, Chiyoda 北綾瀬 in the same service, Seibu Yamaguchi included,
within-operator identities incl. Tokyu 三軒茶屋 retained); `.claude/docs/research/tokyo-suburban-r1-{sub,pe,pw,extra,exceptions}*.{md,csv}`
and the frozen `tokyo-suburban-research-catalog.csv` / `-services.csv` (non-JR rows); S1 contract
(`tokyo-suburban-s1-plan.md`, per-service `operator`/`n02Operator`, per-stop `original_name`/`n02_name`/`n02_operator`,
Toei display `東京都交通局` vs N02 `東京都`); S2 precedent and tooling (`tokyo-suburban-s2-plan.md`,
`tokyo-suburban-s2-section-filters.md`, `scripts/data_pipeline/stage_suburban_jr.py`, `data/staging/tokyo-suburban-jr/**`
README, `.claude/docs/reviews/tokyo-suburban-s2-review-1.md` incl. its non-blocking carry-overs); `data/README.md`;
`scripts/data_pipeline/*.py`; `tests/data_pipeline/`.

Constraints:
- Non-JR only. No change to `public/data/*`, live `data/overrides/**`, or the committed JR staging; the live build stays
  byte-identical. Raw N02 read-only.
- Reuse the S2 helper where it fits; prefer generalizing it (operator group parameter) over a copy. Any helper/pipeline
  change happens in an early dedicated run, never inside parallel region runs.
- No relaxed snap/joint/offset/detour/wrong-track tolerances; reviewed per-pair exceptions only with recorded evidence;
  no proximity-only joins; no fabricated connectors; no cross-operator fallback; selectors are explicit.
- Known N02 concerns to plan for explicitly: Tokyu Meguro Tamagawa–Hiyoshi borrows Toyoko coverage and Oimachi
  Futako-Tamagawa–Mizonokuchi borrows Den-en-toshi coverage (shared/parallel tracks are NOT shared infrastructure unless
  evidenced); Fukutoshin north of Kotake-mukaihara on the Yurakucho N02 line; Yokohama Blue across two N02 lines at Kannai;
  Keisei airport-side track ownership (Narita Sky Access / Hokuso / Shibayama out of scope) and shared-use boundaries;
  Oedo loop/radial; Seibu Yamaguchi AGT; lines missing or mislabeled in N02 per the R1 reports.
- lengthRef: each service needs an independent length reference with a cited primary source (operator page or official
  route data) and an N02 pair-sum cross-check within the tolerance; record source breakdowns (S2 carry-over).
- Run sizing: ≤ ~30 min per Luna run; group runs by operator group (e.g. Metro, Toei+Yokohama, Tobu, Seibu,
  Keisei+Hokuso+TX, Tokyu+Minatomirai, Keio+Odakyu, Keikyu+Sotetsu); at most two region runs in parallel.

Output (markdown, ≤160 lines): `TL;DR`; `Staging layout` (directories, dataset/operator settings per group, how S4/S5
consume them); `Service inventory` (per group: services, stops, pairs, N02 operator/line names); `Known geometry problems`
(each with the proposed evidenced resolution); `Pipeline/helper changes` (if any, in a first run); `Runs` (per run:
files, steps, tests, acceptance commands — exact; mark which can run in parallel); `Risks`; `Decisions needing the user`
(only genuine product choices; "none" if none).

## s3-run — S3 implementation runs (Codex Luna `high`; replace `<RUNS>`)

Objective: implement S3 plan run(s) <RUNS> of `.claude/docs/plans/tokyo-suburban-s3-plan.md` exactly (with the lead
adjustments in its header), keeping the shipped bundle and the committed JR staging byte-identical.

Read first: `.claude/docs/plans/tokyo-suburban-s3-plan.md` (the contract), `.claude/docs/plans/tokyo-suburban-s0-freeze.json`,
`data/README.md`, `data/staging/tokyo-suburban-jr/combined/README.md` (S2 precedent), `.claude/rules/coding-principles.md`,
`.claude/rules/testing.md`, `.claude/rules/dev-environment.md`. Earlier S3 runs are in the working tree or committed; build on them.

Scope: in — exactly the files the plan assigns to <RUNS>. Out — `public/data`, live `data/overrides/**`,
`data/staging/tokyo-suburban-jr/**`, `src/**`, raw `N02-25_GML/**`, research files, docs under `.claude/`, git commits/pushes.
Group runs must NOT modify `scripts/` or shared tests; a parallel run may own another group: never touch its files.
No relaxed tolerances (snap 30 m, joint 1e-6 m, offset, detour, wrong-track, lengthRef 1.5 km), no proximity-only joins, no
fabricated connectors, no cross-operator fallback. Never weaken, skip or delete tests. Expected values come from the frozen
catalog and cited primary sources, never from build output. lengthRef: primary-source 営業キロ with a recorded breakdown;
use your web search tool (official operator pages first; cite URLs; no curl). Clear output dirs with Python `shutil.rmtree`
(`rm -rf` is blocked). Prose in English. STOP and report with evidence (do not guess) when a pair needs a route recipe,
junction, detour/offset exception, or section evidence not already specified in the plan's "Known geometry problems".

Acceptance: the plan's acceptance for <RUNS> (group runs: `s3e GROUP` once, then `s3gate GROUP`), plus always:
```bash
uv run ruff check scripts/data_pipeline tests/data_pipeline && uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
git diff --exit-code -- public/data data/overrides data/staging/tokyo-suburban-jr src N02-25_GML
```
and for R0 and Rfinal the live byte-identity build (`diff -r public/data .claude/logs/s3/live`).

Output (≤60 lines): `Summary`, `Files changed`, `Tests added`, `Acceptance` (command → exit code + tail),
`Stops for lead review` (each with evidence), `Deviations from plan`, `Open issues`.

### s3 standing lead decisions (append to every later S3 group prompt)

- N02 match name = frozen `station_name_original` (seed does this); never the D1 group name `station_name_ja`.
- Explicit station-number evidence accepts `^[A-Za-z]{1,2}-?\d{2}$` (`G01`, `A01`, `TS-01`, `m05`); never rewrite frozen numbers.
- A within-operator station spanning municipalities: every `scope.csv` row uses the registry prefecture/municipality
  (representative service's frozen value); record the platform-level municipality + source as evidence. A prefecture
  difference is NOT covered — stop and report.
- Call the non-JR CLI as `uv run python -m scripts.data_pipeline.stage_suburban_nonjr {seed,measure-pairs,gate,audit} --operator-group G`.
- Platform offset over 250 m at a large interchange: approved only as a per-row `offset_exceptions.csv` entry with limit =
  measured rounded up to 10 m + 10 m, citing N02 codes, measured distance and an official station page; the global limit
  stays. Report the list to the lead.
- A boundary station whose two N02 codes share a group and exact midpoint: pin the service stop to ONE code (the line the
  service continues on); the other line's track reaches it via the S1 anchor rule.
- lengthRef evidence when the operator publishes only a line total: derive each service from per-station キロ程 — official
  first; otherwise a secondary table that cites 『鉄道要覧』 (e.g. the Wikipedia line article), marked `secondary` in
  `length-ref-components.csv` with the arithmetic and, where possible, a check that the parts sum to the official total.
  The N02 pair-sum must still agree within 1.5 km.
- Detour ratio over 1.80 on the real curved track: per-pair `detour_exceptions.csv` row only after a path analysis (the
  traversed sections, not the `route_legs_json` window) shows a single-operator path and the official キロ程 matches the path
  length; limit = measured ratio rounded up to the next 0.05 (S2 烏山 1.88→1.90, S3 佐野 2.05→2.10).

## s4-plan — S4 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable plan for S4 (cross-operator assembly and shared-track composition) that Codex
Luna can implement in bounded runs without making design or product decisions.

S4 per `.claude/docs/plans/tokyo-suburban-network-design.md` section 4: merge the committed JR staging (S2) and the
non-JR staging (S3) into one staged network. Acceptance there: one approved game identity per D1 group, per-service
platforms, no collapsed service stops, all stations reachable. The final shipped bundle, ruleset `tokyo-suburban-1` and
save incompatibility are S5; map/legend/UI (incl. the D3 single 大江戸線 UI line) are S6 — S4 only has to carry the data
those steps need (e.g. the frozen UI line group `toei-oedo`), and the plan must say where each such field lands.

Read: the design doc (sections 1–5); `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (frozen counts: 135 services,
1,586 station groups, 2,142 rows, 3,988 directed segments; identity map; D1 rule B 600 m official-interchange groups with
the same-service/JR-id and walking-link exclusions); the frozen research catalog/services/identity CSVs it hashes under
`.claude/docs/research/`; `.claude/docs/plans/tokyo-suburban-network-handoff.md` (S2 and S3 rows incl. carry-overs);
S2 output `data/staging/tokyo-suburban-jr/**` (combined README) and `scripts/data_pipeline/stage_suburban_jr.py`;
S3 output `data/staging/tokyo-suburban-nonjr/**` (README, `handoff-index.json`, per-group components) and
`scripts/data_pipeline/stage_suburban_{support,nonjr}.py`; plans/reviews `tokyo-suburban-s{1,2,3}-plan.md`,
`.claude/docs/reviews/tokyo-suburban-s{2,3}-review-1.md`; `data/README.md`; `scripts/data_pipeline/*.py` (incl.
`composition_build.py` and the compose/route evidence contract); `tests/data_pipeline/`.

Constraints:
- `public/data/*`, live `data/overrides/**` and raw `N02-25_GML/**` stay unchanged; the live build stays byte-identical
  (S5 replaces the bundle). S2/S3 staging may change only through their own tools, re-gated and audited, with every
  change listed; prefer consuming them read-only.
- Station identity comes from the frozen D1 groups only: no proximity-only merges, no new merges or splits, shipped
  472 station ids and 40 services' contiguous stop order retained, every service keeps its own platform coordinates.
- Shared track (cross-group as well as the known in-group cases: Tokyu Meguro/Oimachi borrowing, Fukutoshin on the
  Yurakucho line, Keisei/Hokuso, Namboku/Mita 白金高輪–目黒, and any the S3 evidence reveals) is composed only from
  reviewed source evidence (existing compose/route mechanisms), never by relaxing snap/joint/offset/detour/wrong-track
  tolerances or by fabricated connectors.
- Close the S3 carry-overs: re-check municipality/offset/pair/section/junction ids after the merge; define the `from/to`
  meaning in `length-ref-components.csv` (成田空港線 51.4−32.3 case); component-scoped evidence replaces shared evidence;
  and the S2 carry-overs (audit does not validate pair-evidence/length-refs content; re-measure if the live baseline changed).
- Staged text files must be LF (override hashes are byte hashes; see the S3 LF fix `8e46eb6`).
- Run sizing: ≤ ~30 min per Luna run; any helper/pipeline change in an early dedicated run; mark parallelizable runs.

Output (markdown, ≤160 lines): `TL;DR`; `Assembly layout` (directories, inputs consumed, merged outputs, how S5 consumes
them); `Identity merge` (how D1 groups map S2/S3 stations to game ids, collisions, expected counts); `Shared-track
composition` (each case with its evidence and mechanism); `Carry-over closure`; `Pipeline/helper changes`; `Runs` (per
run: files, steps, tests, exact acceptance commands; parallel marks); `Risks`; `Decisions needing the user` (only genuine
product choices; "none" if none).

## s4-run — S4 implementation runs (Codex Luna `high`; replace `<RUNS>`)

Objective: implement S4 plan run(s) <RUNS> of `.claude/docs/plans/tokyo-suburban-s4-plan.md` exactly (the "Lead
adjustments" header overrides the plan body), keeping the shipped bundle and the committed S2/S3 staging byte-identical.

Read first: `.claude/docs/plans/tokyo-suburban-s4-plan.md` (the contract), `.claude/docs/plans/tokyo-suburban-s0-freeze.json`,
`data/README.md`, `data/staging/tokyo-suburban-jr/combined/README.md`, `data/staging/tokyo-suburban-nonjr/README.md`,
`scripts/data_pipeline/stage_suburban_{jr,support,nonjr}.py`, `.claude/rules/coding-principles.md`,
`.claude/rules/testing.md`, `.claude/rules/dev-environment.md`. Earlier S4 runs are in the working tree or committed; build on them.

Scope: in — exactly the files the plan assigns to <RUNS> (new helper `scripts/data_pipeline/stage_suburban_assembly.py`,
its tests, `data/staging/tokyo-suburban-assembled/**`, `data/README.md` when assigned). Out — `public/data`, live
`data/overrides/**`, `data/staging/tokyo-suburban-jr/**`, `data/staging/tokyo-suburban-nonjr/**` (except a report/save split
in `stage_suburban_nonjr.py` that R0 is assigned, which must keep existing CLI behaviour and outputs), `src/**`, raw
`N02-25_GML/**`, research files, docs under `.claude/`, git commits/pushes. Evidence-batch runs write only their own
`A/evidence/<batch>/`. No relaxed tolerances, no proximity-only joins, no fabricated connectors, no cross-operator fallback.
Never weaken, skip or delete tests. Expected values come from the frozen catalog/freeze, never from build output. Write LF
only. Clear dirs with Python `shutil.rmtree` (`rm -rf` is blocked). Prose in English. STOP and report with evidence (do
not guess) on anything listed in lead adjustment 4. Report only what exists on disk — re-read files before claiming them.

Acceptance: the plan's acceptance for <RUNS>, plus always:
```bash
uv run ruff check scripts/data_pipeline tests/data_pipeline && uv run ruff format --check scripts/data_pipeline tests/data_pipeline
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
git diff --exit-code -- public/data data/overrides data/staging/tokyo-suburban-jr data/staging/tokyo-suburban-nonjr src N02-25_GML
```

Output (≤60 lines): `Summary`, `Files changed`, `Tests added`, `Acceptance` (command → exit code + tail),
`Stops for lead review` (each with evidence), `Deviations from plan`, `Open issues`.

## s5-plan — S5 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable plan for S5 (final bundle, rule configuration and incompatible-save behaviour) that
Codex Luna can implement in bounded runs without making design or product decisions.

S5 per `.claude/docs/plans/tokyo-suburban-network-design.md` section 4: acceptance "full deterministic rebuild/hash checks;
30 Yamanote target segments; seeded replay and old-save rejection". The new edition REPLACES the shipped 1都3県 edition (no
selector; old saves discarded through the existing incompatible-save path — no migration code, no automatic deletion). The
map/legend/UI, the D3 single 大江戸線 UI line and the D4 title/notice change are S6, not S5 — S5 only ships the data/config
they need and must not change UI copy.

Read: the design doc (sections 1–5, esp. section 3 on dataset/ruleset versioning); `.claude/docs/plans/tokyo-suburban-s0-freeze.json`
(`ruleset`: id `tokyo-suburban-1`, target `jr-yamanote` direction 1, service lottery target share 2/3 with kind weights 1/1,
direction lottery toward-target weight 2, goal = all 30 jr-yamanote outer directed segments then arrive `shimbashi`, start
`shimbashi`; `representations.uiLineGroups`; statistics median 55 / p90 146 / p99 261 from 5,000 games);
`.claude/docs/research/tokyo-suburban-r2.md` and `tokyo-suburban-r2-tools/` (run_matrix.py, measure.test.ts, verify_results.py —
how the chosen case was simulated); the S4 handoff `data/staging/tokyo-suburban-assembled/{README.md,REVIEW.md,verification.json}`
and the S4 row + carry-overs in `.claude/docs/plans/tokyo-suburban-network-handoff.md`; `data/README.md`; `scripts/data_pipeline/*.py`
(build, config, export, stage profile, `directed_segment_target_service_id`); live `data/overrides/**` and `public/data/*`;
`src/features/game/**` (engine config, networkFromData, save/persistence and its incompatibility check, `MVP_GAME_CONFIG`),
`src/data/**`, `src/types/**`; existing tests (`tests/data_pipeline/`, vitest specs, `npm run sim` and its config); `package.json`.

Constraints:
- Product overrides are derived reproducibly from the audited S4 overrides (no hand edits, no stage-manifest relabel); the
  product build is deterministic (A/B identical) and validated with the product profile; every S4 check stays green.
- Ruleset values come only from the freeze. Gameplay rules other than the freeze's ruleset do not change.
- Old saves: decide from the actual contract diff whether a schema/save-version bump is needed; dataset/ruleset
  incompatibility must be tested either way (old save rejected → existing discard path). No migration code.
- Close S4 carry-overs: thread the product `targetServiceId`; `stage_suburban_nonjr.py::_filter_recipe_hash` → `_stable_repr`
  (prove S3 outputs unchanged); verify consumed sidecars (shared-track review, UI groups, identity metadata, mileage
  components) against frozen inputs.
- Real-data simulation must reproduce the frozen chosen-case distribution within a stated tolerance (seeded, deterministic);
  state the tolerance and why. Bundle raw/gzip size must be measured against the design budget.
- No relaxed tests or tolerances; tests failing-first; LF only; run sizing ≤ ~30 min per Luna run; early dedicated run for
  any shared helper change; mark parallelizable runs.

Output (markdown, ≤160 lines): `TL;DR`; `Contract diff` (data files, types, config, save format — before/after);
`Product build` (inputs, command, outputs, determinism/hash checks); `Ruleset` (where it lives, values, tests);
`Save incompatibility` (mechanism, version decision with evidence, tests); `Simulation acceptance`; `Carry-over closure`;
`Runs` (per run: files, steps, tests, exact acceptance commands; parallel marks); `Risks`; `Decisions needing the user`
(only genuine product choices; "none" if none).

## s5-run — S5 implementation runs (Codex Luna `high`/`xhigh`, fast mode allowed; replace `<RUNS>`)

Objective: implement S5 plan run(s) <RUNS> of `.claude/docs/plans/tokyo-suburban-s5-plan.md` exactly (the "Lead
adjustments" header overrides the plan body).

Read first: `.claude/docs/plans/tokyo-suburban-s5-plan.md` (the contract), `.claude/docs/plans/tokyo-suburban-s0-freeze.json`,
`data/README.md`, `data/staging/tokyo-suburban-assembled/{README.md,REVIEW.md}`, `.claude/rules/coding-principles.md`,
`.claude/rules/testing.md`, `.claude/rules/dev-environment.md`. Earlier S5 runs are in the working tree or committed; build on them.

Scope: in — exactly the files the plan assigns to <RUNS>. Out — committed S2/S3/S4 staging data (`data/staging/**`; read
only — a run that would change it must STOP), raw `N02-25_GML/**`, research files, docs under `.claude/`, UI copy/components
(S6), git commits/pushes. Never weaken, skip or delete tests; failing-first tests; expected values from the freeze/frozen
CSVs/original evidence, never from new outputs. LF only. Clear dirs with Python `shutil.rmtree` (`rm -rf` is blocked).
Prose in English. STOP and report with evidence on any lead-adjustment-3 condition. Report only what exists on disk.

Acceptance: the plan's acceptance for <RUNS>, plus always:
```bash
uv run ruff check scripts tests && uv run ruff format --check scripts tests
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
git diff --exit-code -- data/staging N02-25_GML
```
plus `npm run typecheck && npm test` whenever `src/` or TS tests change.

Output (≤60 lines): `Summary`, `Files changed`, `Tests added`, `Acceptance` (command → exit code + tail),
`Stops for lead review` (each with evidence), `Deviations from plan`, `Open issues`.

## s6-plan — S6 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable plan for S6 (larger-network map, legend, alias labels, overview camera, title and
copy) that Codex Luna can implement in bounded runs without making product decisions.

S6 per `.claude/docs/plans/tokyo-suburban-network-design.md` sections 3–4: acceptance "mobile/desktop interaction and
label-density checks; final bundle/raw/gzip/reference budgets measured". User decisions (DESIGN.md Key Decisions, freeze
`presentation` / `representations`): D3 — `toei-oedo-loop` and `toei-oedo-radial` stay two engine services but appear as ONE
line 「大江戸線」 everywhere in the UI (`ui-line-groups.json`, freeze `uiLineGroups`); D4 — title 「山手線すごろく」, subtitle
「東京近郊版」, and remove BOTH notice sentences in `TitleScreen.tsx` (the 「オリジナルゲーム」 and 「非公式のファンメイド作品」 lines).

Read: the design doc; `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (`presentation`, `representations`); `.claude/docs/DESIGN.md`
Key Decisions; S5 row and S6 carry-overs in `.claude/docs/plans/tokyo-suburban-network-handoff.md`; `.claude/docs/reviews/tokyo-suburban-s5-review-1.md`;
`data/staging/tokyo-suburban-assembled/{REVIEW.md,station-groups.json,ui-line-groups.json,service-stop-metadata.csv}`;
`public/data/*` and `src/data/**`, `src/types/**` (bundle contract and guards); `src/features/**` (map/MapLibre layers,
legend, labels, camera, TitleScreen, game panel, presentation); `scripts/data_pipeline/export.py` and `product_suburban.py`
(how the bundle is produced — any new field must come from the reproducible product build, never hand edits);
`tests/e2e/**`, `tests/unit/**`, `playwright.config.*`, `package.json`.

Must cover:
- Bundle contract for UI-only data (line groups, station aliases/original names, operator/line legend metadata): which
  fields are added, where they are produced (pipeline/export from audited sidecars), guards/types, and the impact on
  `dataVersion`, budgets and save compatibility (S5 rule: no migration; decide from the diff whether anything changes).
- Map: bounded MapLibre layer count, primitive geometry reuse, grouped/filterable operator/line legend, zoom-gated labels
  and label density for 1,586 stations, an initial view useful for play plus a network overview; mobile and desktop.
- 大江戸線 as one UI line (legend, panel, lottery text, history) while the engine keeps two services.
- Title/subtitle/notice change; TitleScreen intro copy still says 40 JR services, the old area and 1/2 probability — update it
  from the freeze ruleset (state the exact new Japanese copy in the plan for the lead to check).
- The 22 private-railway names that display large ケ under the registry convention (e.g. 新百合ケ丘 vs official 新百合ヶ丘):
  propose options; this is a USER decision — list it under "Decisions needing the user" with a recommendation.
- Restore the six real-bundle panel checks dropped in S5 (`capital-region.spec.ts`: 「抽選: 移動中…」, 「進行方向」, 「踏破区間」
  during composed-hop scenarios) — user instruction.
- Production compression of `segments.geojson` (1.29 MB uncompressed from the dev server): how the deploy target serves it.
- Performance acceptance with the real bundle (load metrics already printed by `real-data.spec.ts`), label-density checks,
  and the design budgets.

Constraints: no gameplay/rule change; no edits to `data/staging/**`, `data/baselines/**`, raw N02; product data changes only
via the reproducible product build (re-run S5 verify); never weaken tests; LF only; Luna runs ≤ ~30 min; mark parallel runs.

Output (markdown, ≤170 lines, English): `TL;DR`; `Bundle/UI contract`; `Map & legend`; `Oedo single line`; `Copy changes`
(exact strings); `Runs` (files, steps, tests, exact acceptance commands; parallel marks); `Risks`; `Decisions needing the user`.

## s6-run — S6 implementation runs (Codex Luna `high`/`xhigh`, fast mode allowed; replace `<RUNS>`)

Objective: implement S6 plan run(s) <RUNS> of `.claude/docs/plans/tokyo-suburban-s6-plan.md` exactly (the "Lead adjustments"
header overrides the plan body).

Read first: the S6 plan, `.claude/docs/plans/tokyo-suburban-s0-freeze.json`, `data/README.md`,
`data/staging/tokyo-suburban-assembled/REVIEW.md`, `.claude/rules/{coding-principles,testing,dev-environment}.md`. Earlier S6
runs are in the working tree; build on them.

Scope: exactly the files the plan assigns to <RUNS>. Out — `data/staging/**`, `data/baselines/**`, raw `N02-25_GML/**`,
research files, docs under `.claude/`, git commits/pushes, any gameplay/rule change. Product data changes only through the
reproducible product build. Never weaken, skip or delete tests; failing-first tests; LF only; `shutil.rmtree` not `rm -rf`;
English prose. STOP with evidence on any S5 payload-hash change, budget overrun, or simulation difference. Report only what
exists on disk.

Acceptance: the plan's acceptance for <RUNS>, plus always:
```bash
uv run ruff check scripts tests && uv run ruff format --check scripts tests
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
git diff --exit-code -- data/staging data/baselines N02-25_GML
```
plus `npm run typecheck && npm test` whenever `src/` or TS tests change.

Output (≤60 lines): `Summary`, `Files changed`, `Tests added`, `Acceptance` (command → exit code + tail),
`Stops for lead review`, `Deviations from plan`, `Open issues`.

## s7-plan — S7 implementation plan (Codex Sol `low`, `--sandbox read-only`)

Objective: produce a directly executable plan for S7 (real-data simulations, fixture E2E, docs and integration review) that
Codex Luna can implement in bounded runs and that ends in an independent whole-branch review, without making product decisions.

S7 per `.claude/docs/plans/tokyo-suburban-network-design.md` section 4: acceptance "Unit/pipeline/E2E gates, chosen-rule
distribution, no placeholders/out-of-scope edits; independent review". S8 (PR/CI evidence, release) is out of scope.

Read: the design doc; `.claude/docs/plans/tokyo-suburban-s0-freeze.json` (ruleset, expected counts); `.claude/docs/DESIGN.md`
Key Decisions; S5 and S6 rows and carry-overs in `.claude/docs/plans/tokyo-suburban-network-handoff.md`;
`.claude/docs/reviews/tokyo-suburban-s{5,6}-review-1.md`; `.claude/logs/s6/s6-evidence.md`; `scripts/data_pipeline/product_suburban.py`
(`verify-simulation`) and the simulation tooling it calls; `src/features/game/**` (engine, `gameConfig.ts`);
`tests/e2e/**`, `tests/unit/**`, `playwright.config.*`, `package.json`, `.github/workflows/**`, `vercel.json` (if present);
`README.md`, `data/README.md`, `docs/manual/**`, `railway_sugoroku_mvp_spec.md`; `git diff --stat master...HEAD`.

Must cover:
- Real-data simulation: what the chosen-rule distribution acceptance measures (share 2/3, toward-target weight 2 under
  `tokyo-suburban-1`), sample size and seeds, the metrics and thresholds to report (completion rate, turns/hops
  distribution, lottery share realised vs configured, direction weight realised, unreachable/stuck states), where the
  report is written, and whether a committed summary belongs in docs. Compare against the legacy capital-region rules only
  as context, never as a gate.
- Fixture E2E: gaps left after S5/S6 (interchange at multi-operator stations, 大江戸線 single-line display through a real
  hop, alias station labels, old-save discard, clear flow) — list each new or strengthened check with file and assertion.
- Playwright 4-worker load failures under software WebGL (serial / 2 workers pass): decide root cause investigation vs. a
  pinned worker count in config/CI, with evidence the plan requires before choosing.
- `segments.geojson` production MIME/compression: what can be verified from repo config and a local production build
  (`npm run build` + preview) without a deploy, and what stays an S8 live check.
- Docs: every user-facing or contributor doc still describing the old 40-service capital-region edition, 1/2 probability or
  old area (README, data/README, docs/manual/**, spec); propose the edits (Japanese for `docs/manual/**`, English elsewhere)
  and a new `docs/manual/tokyo-suburban/` theme if warranted. DESIGN.md is updated by the lead only (`update_design.py`).
- Integration review: an independent whole-branch review (`master...HEAD`) as the last run — scope, reviewer lane,
  checklist (placeholders, weakened tests, out-of-scope edits, staging/baseline immutability, provenance hashes, LF,
  licence notices for Noto Sans JP glyph fixtures and colour citations), and output path under `.claude/docs/reviews/`.
- Known gaps that stay open (physical-device performance/touch-pan, 1.32 MB main chunk): record, do not fix unless trivial.

Constraints: no gameplay/rule change; no edits to `data/staging/**`, `data/baselines/**`, raw N02; product data unchanged
(four gameplay payload hashes = S5 `c76ad92`, `uiPresentation` = S6 `478e3ca`); never weaken tests; LF only; Luna runs ≤ ~30
min; mark parallel runs.

Output (markdown, ≤170 lines, English): `TL;DR`; `Simulation`; `Fixture E2E`; `Playwright workers`; `Compression`; `Docs`;
`Integration review`; `Runs` (files, steps, tests, exact acceptance commands; parallel marks); `Risks`; `Decisions needing the user`.

## s7-run — S7 implementation runs (Codex Luna `high`/`xhigh`, fast mode allowed; replace `<RUNS>`)

Objective: implement S7 plan run(s) <RUNS> of `.claude/docs/plans/tokyo-suburban-s7-plan.md` exactly (the "Lead adjustments"
header overrides the plan body).

Read first: the S7 plan, `.claude/docs/plans/tokyo-suburban-s0-freeze.json`, `data/README.md`,
`.claude/rules/{coding-principles,testing,dev-environment,manual-docs}.md`. Earlier S7 runs are in the working tree; build on them.

Scope: exactly the files the plan assigns to <RUNS>. Out — `data/staging/**`, `data/baselines/**`, raw `N02-25_GML/**`,
`public/data/**`, research files, `.claude/docs/DESIGN.md`, git commits/pushes, any gameplay/rule change. Never weaken, skip or
delete tests; failing-first tests; LF only; `shutil.rmtree` not `rm -rf`; English prose except `docs/manual/**` (Japanese).
STOP with evidence on any payload-hash change, budget overrun, or simulation difference. Report only what exists on disk.

Acceptance: the plan's acceptance for <RUNS>, plus always:
```bash
uv run ruff check scripts tests && uv run ruff format --check scripts tests
uv run ty check scripts/data_pipeline
uv run pytest tests/data_pipeline -q -rs
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_freeze.py
git diff --exit-code -- data/staging data/baselines N02-25_GML public/data
```
plus `npm run typecheck && npm test` whenever `src/` or TS tests change.

Output (≤60 lines): `Summary`, `Files changed`, `Tests added`, `Acceptance` (command → exit code + tail),
`Stops for lead review`, `Deviations from plan`, `Open issues`.
