# R1 research prompts (Tokyo suburban edition)

These are the four R1 research contracts, kept here so any executor can (re)run them. They were first launched
on 2026-10-15 as Claude `general-purpose-opus` subagents (web research). Fallback when Claude is limited: run each
section as its own Codex Luna call with live web search (enabled by `web_search = "live"` in `.codex/config.toml`;
verified 2026-10-15 — the stderr log shows `web search:` queries):

```bash
# Extract one section below into .claude/logs/codex/prompt-r1-<slug>.md, then:
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file .claude/logs/codex/prompt-r1-<slug>.md --label r1-<slug> --sandbox danger-full-access \
  --caller main --timeout 7200 --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=high
```

Before re-running, check whether the outputs already exist (`.claude/docs/research/tokyo-suburban-r1-<slug>*`):
a finished Claude run must not be overwritten. Add to each Codex prompt: "Use your web search tool for official
sources and cite URLs; do not use curl." Run at most two in parallel. Verify like any delegation (the acceptance
script, row counts against official station counts, spot-check citations).

Every section assumes the shared conventions in `tokyo-suburban-network-handoff.md` ("R1 shared conventions").

## r1-jr — JR 東京近郊区間

Objective: produce the JR part of the research inventory for the next edition of 山手線すごろく (repo `/home/yuulis/yamanote-line-sugoroku`), so the lead can merge all operators into one catalog and decide the area boundary.

Read first: `.claude/docs/plans/tokyo-suburban-network-handoff.md` (decisions + "R1 shared conventions" — follow the CSV schema exactly), `.claude/docs/research/jr-east-capital-region-product-catalog.csv` and `jr-east-capital-region-product-services.csv` (the shipped 40 JR services / 472 stations; reuse their station ids and service ids where the station/service already exists), `.claude/docs/research/jr-east-capital-region-expansion.md` (method of the previous research), `.claude/rules/language.md` (notes in English; Japanese names verbatim).

Scope (in):
1. The official definition of JR「東京近郊区間」(旅客営業規則 第156条 / 大都市近郊区間) as of the latest revision (cite JR East official pages; note recent changes). List every JR line segment inside it, including parts outside 1都3県 (茨城・栃木・群馬・山梨・静岡 etc.) and any JR Central segments inside it (e.g. 御殿場線?) — report them and whether JR East operates them.
2. For each JR line/segment newly inside the area (beyond the shipped 1都3県 set), build services with the same track-system rule as the shipped data (separate track systems = separate services; base stop pattern; weekday 各停/普通; no upper train types). Also list which shipped services must be EXTENDED (their area-boundary endpoints move outward) and give the full new stop list for those services.
3. Propose how the 近郊区間 boundary should cut non-JR lines (the user decided: subways and private railways are truncated "within the 東京近郊区間 range"). JR's definition is a set of JR line segments, not a polygon: propose 2–3 concrete operational rules with their consequences for 東武日光線/鬼怒川線, 東武伊勢崎線 beyond 館林, 小田急 to 小田原, 西武秩父線, 京成 to 成田空港, TX to つくば, and recommend one.

Scope (out): non-JR operators; no code or data changes; do not edit any existing file.

Outputs: `.claude/docs/research/tokyo-suburban-r1-jr.md` and `.claude/docs/research/tokyo-suburban-r1-jr-catalog.csv` (complete new JR catalog = shipped services updated/extended + new services). Use raw N02 at `N02-25_GML/UTF-8` (read-only) to record `n02_operator`/`n02_line` and flag missing geometry.

Acceptance: CSV parses; every service has contiguous `order` from 0; endpoint kinds only on linear first/last rows; station ids unique per physical station; counts reported (services, distinct stations, new vs shipped). Write a small Python check under `.claude/logs/r1-jr/` and run it.

Return (≤40 lines): counts, the boundary-rule recommendation, JR Central/edge cases, open questions for the user, file paths.

## r1-sub — subways

Objective: produce the subway part of the research inventory: 東京メトロ (9 lines), 都営地下鉄 (浅草線・三田線・新宿線・大江戸線; report 日暮里・舎人ライナー and 都電荒川線 as out-of-scope candidates without cataloguing them), 横浜市営地下鉄 (ブルーライン・グリーンライン).

Read first: the handoff conventions, `.claude/rules/language.md`.

Scope (in): for each line, one 各停 service in travel order with every station (weekday). Branches as separate services (e.g. 丸ノ内線 方南町支線). Loop/lasso lines (大江戸線): describe precisely and propose a representation (the engine supports circular and linear services); mark `is_loop`. Shared-track sections between operators (南北線・三田線 白金高輪–目黒, 副都心線/有楽町線 小竹向原–池袋): record facts and whether stations are shared. Through-running: split at the operator boundary. Station ids: one per physical station within the operator; prefixes `metro-`, `toei-`, `yokohama-`. Official transfers into `tokyo-suburban-r1-sub-transfers.csv` (`station_id,operator,other_operator,other_station_name,walking_note,source_url`).

Scope (out): other operators; no code/data changes; do not edit existing files.

Outputs: `.claude/docs/research/tokyo-suburban-r1-sub.md`, `...-r1-sub-catalog.csv`, `...-r1-sub-transfers.csv`; N02 names and gaps as above.

Acceptance: CSV parses; contiguous `order`; endpoint kinds only on linear first/last rows; station counts per line match official counts (cite); a Python check under `.claude/logs/r1-sub/` run successfully.

Return (≤40 lines): counts per operator/line, representation proposals, N02 gaps, open questions, file paths.

## r1-pe — 東武・西武・京成・つくばエクスプレス

Objective: produce the north/east private-railway inventory: 東武鉄道 (all lines), 西武鉄道 (all lines incl. 山口線), 京成電鉄 (all lines incl. 成田スカイアクセス線 — report its stop-pattern facts), つくばエクスプレス.

Read first: the handoff conventions, `.claude/rules/language.md`.

Scope (in): for each line, one 各停 service in travel order with every station (weekday 各停); branches as separate services. Where 各停 does not run the full line or some stations are served only by other types, record the facts; stations not served by any 各停 are listed separately as excluded candidates. Catalog the FULL lines (do not truncate) with every station's prefecture and municipality. Through-running: split at operator boundaries. Station ids per physical station within the operator; prefixes `tobu-`, `seibu-`, `keisei-`, `tx-`. Official transfers into `tokyo-suburban-r1-pe-transfers.csv` (same columns as r1-sub).

Scope (out): other operators; no code/data changes; do not edit existing files.

Outputs: `.claude/docs/research/tokyo-suburban-r1-pe.md`, `...-r1-pe-catalog.csv`, `...-r1-pe-transfers.csv`; N02 names and gaps.

Acceptance: as r1-sub, check script under `.claude/logs/r1-pe/`.

Return (≤40 lines): counts per operator/line, 各停 coverage gaps, N02 gaps, open questions, file paths.

## r1-pw — 東急・京王・小田急・京急・相鉄

Objective: produce the south/west private-railway inventory: 東急電鉄 (all railway lines incl. 世田谷線, こどもの国線, 東急新横浜線), 京王電鉄 (all lines), 小田急電鉄 (all lines), 京急電鉄 (all lines), 相模鉄道 (all lines incl. 相鉄新横浜線).

Read first: the handoff conventions, `.claude/rules/language.md`.

Scope (in): as r1-pe (各停 only, full lines with prefecture/municipality, excluded-candidate list, operator-boundary split). Prefixes `tokyu-`, `keio-`, `odakyu-`, `keikyu-`, `sotetsu-`. Transfers into `tokyo-suburban-r1-pw-transfers.csv`.

Scope (out): other operators; no code/data changes; do not edit existing files.

Outputs: `.claude/docs/research/tokyo-suburban-r1-pw.md`, `...-r1-pw-catalog.csv`, `...-r1-pw-transfers.csv`; N02 names and gaps.

Acceptance: as r1-sub, check script under `.claude/logs/r1-pw/`.

Return (≤40 lines): counts per operator/line, 各停 coverage gaps, N02 gaps, open questions, file paths.
