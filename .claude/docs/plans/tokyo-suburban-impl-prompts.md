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
