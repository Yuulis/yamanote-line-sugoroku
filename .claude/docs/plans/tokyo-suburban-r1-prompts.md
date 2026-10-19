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

## r1b — みなとみらい線・北総線 + 実質各停の例外 (Codex Luna, web search)

Objective: complete the R1 inventory with the two operators the user added on 2026-10-15 and apply the
"実質各停" exception rule, so R2 can merge one complete set.

Read first: `tokyo-suburban-network-handoff.md` (decisions, R1 conventions, R1 results), the R1 notes
`.claude/docs/research/tokyo-suburban-r1-{pe,pw}.md` (excluded-candidate sections), `.claude/rules/language.md`.

Tasks:
1. New inventory `tokyo-suburban-r1-extra-catalog.csv` / `-transfers.csv` / `.md` in the R1 schema for
   みなとみらい線 (横浜高速鉄道, prefix `mm-`) and 北総線 (北総鉄道, prefix `hokuso-`), weekday 各停, travel order,
   prefecture + municipality, N02 names, official transfers. Cite official pages via web search.
2. Apply the user's rule "a section without 普通 where every regular train stops at every station counts as 各停"
   (2026-10-15) as an ADDENDUM file `tokyo-suburban-r1-exceptions-catalog.csv` (R1 schema) — do not edit the R1
   CSVs: 京急久里浜線 extended to 三崎口 (replace service `keikyu-kurihama` rows in the addendum with the full
   堀ノ内–三崎口 list), 東武 押上–曳舟 (service or extension; justify), 京成成田空港線: only the part where every
   regular train stops at every station qualifies (with 北総線 now in scope, 京成高砂–印旛日本医大 is covered by
   北総's 各停; check 印旛日本医大–成田湯川–空港第2ビル–成田空港 and the 京成 track sharing) — state facts with
   sources and the resulting service(s).
3. Re-run the R1 checks on the new files (write `.claude/logs/r1b/check.py`).

Return: counts, decisions taken with sources, open questions, file paths.

## r2 — merged research catalog, station identity, Monte Carlo (Codex Sol or Luna xhigh)

Objective: one research catalog for the whole 東京近郊版 network that the real-engine simulation harness can load,
plus game-length numbers and the decision list for the user (R3).

Inputs: all R1/R1b outputs (`.claude/docs/research/tokyo-suburban-r1-*`), DESIGN.md Key Decisions (2026-10-15),
`tests/simulation/{inputs,harness}.ts` and `tests/simulation/README.md` (loader schema: catalog + services CSV,
`service_type`, `stop_ids`, `first_end_kind`/`last_end_kind`, `line_name`; the 1都3県 research files
`.claude/docs/research/jr-east-capital-region-catalog-v2.csv` / `-services-v2.csv` are working examples).

Tasks:
1. Area: apply the full 東京近郊区間 (2026-03-14 definition) for JR; for non-JR apply rule B from
   `tokyo-suburban-r1-jr.md` (stations inside 1都6県, cross-checked with the in-area JR hull) and report any cut.
2. Merge JR + subway + PE + PW + extra + exceptions into `tokyo-suburban-research-catalog.csv` and
   `tokyo-suburban-research-services.csv` (loader schema). Keep shipped ids for the 472 shipped stations / 40 services.
3. Cross-operator station identity (the key design question): build the candidate list of station pairs/groups
   across operators (same name, official transfer lists from R1, distance between N02 station points). Propose
   2–3 rules (e.g. A: merge only same-structure stations such as 目黒/白金高輪 shared platforms, other transfers
   become no move; B: merge every officially listed transfer within N m into one game station; C: B plus walking
   transfers as zero-pip links — only if the engine supports it, otherwise say so) with counts and examples
   (大手町–東京, 春日–後楽園, 浜松町–大門, 押上 group, 新宿/西武新宿). Verify the R1 transfer rows flagged
   UNVERIFIED (都営, 横浜市営, two PW rows) against official pages with web search. Produce the catalog under the
   recommended rule and keep the others reproducible (script flag).
4. Representation checks: 大江戸線 loop + radial sharing 都庁前; long JR services (常磐 品川–浪江 59 stops, 中央本線
   to 塩尻, 宇都宮線 to 黒磯) kept whole vs split variants; 篠ノ井線 + 信越 篠ノ井–長野 merge; 水戸線 to 水戸.
5. Monte Carlo with the REAL engine (`npm run sim`, research-catalog input — add an env var for the catalog paths if
   the harness lacks one; harness-only change, unit-tested): presets `decided` (shipped rules) and `all-equal`,
   20,000 games, seed 20261012, cap 20,000, target `yamanote`, start `shimbashi`; also each identity rule and the
   split variants (5,000 games each is fine). If the decided median is far above the 1都3県 61 turns, propose levers
   (target share, direction weight, goal change) with measured numbers.
6. Size/performance estimate: N02 geometry for all lines (raw/gzip after the current simplification), compare with
   the `capital-region` budget, and flag MapLibre rendering concerns (station count, label density).

Outputs: the two CSVs, `tokyo-suburban-r2.md` (rules, counts, MC tables, size estimate, decision list for the
user with a recommendation each), `tokyo-suburban-r2-results.json`, scripts under `.claude/logs/r2/` (tracked
copies of the generator in `.claude/docs/research/tokyo-suburban-r2-tools/` so either vendor can rerun).
Constraints: no product code/data changes; harness changes only if needed and tested; never weaken tests.
Acceptance: loader parses the catalog (`npm run sim` smoke), `npx vitest run` passes, counts reconcile with R1.
