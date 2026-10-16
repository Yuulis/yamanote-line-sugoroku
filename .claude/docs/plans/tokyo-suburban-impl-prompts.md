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
