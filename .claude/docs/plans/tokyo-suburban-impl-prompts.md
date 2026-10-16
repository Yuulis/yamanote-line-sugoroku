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
