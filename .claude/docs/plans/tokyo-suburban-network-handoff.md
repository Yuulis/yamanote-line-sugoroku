# Handoff: 東京近郊版 (Tokyo suburban network edition)

## Current status (2026-10-15) — resume here

Integration branch `feature/tokyo-suburban-network` (off `develop` at `adc0812`). Production = JR東日本 1都3県版
(released 2026-10-15, PR #26). User decisions are recorded in `.claude/docs/DESIGN.md` Key Decisions (2026-10-15):

- Area: JR 旅客営業規則「東京近郊区間」 (大都市近郊区間) in full. Subways (東京メトロ, 都営地下鉄, 横浜市営地下鉄)
  and private railways (東急, 東武, 西武, 京成, 京王, 小田急, 京急, 相鉄, つくばエクスプレス) are added and every line
  is truncated at the same area boundary.
- Private/subway lines: one 各停 (all-stop) service per line; no 急行線/種別 services. JR keeps the 1都3県 track-system rule.
- The new edition replaces the 1都3県版 (no selector); old saves are discarded through the existing path.
- After the network: X (Twitter) result sharing; before wide publication: logo, favicon, analytics.

Process (user instructions carried over): update this handoff after every step; Codex lanes = Luna `high` for
specified work, Sol `low` for reviews (Luna `xhigh` allowed); Claude subagents when Codex is limited.
**When Claude is limited (user, 2026-10-15): Codex takes over, including web research — use Luna** with live web
search (`web_search = "live"` in `.codex/config.toml`, verified 2026-10-15). The R1 contracts and the exact command
are in `.claude/docs/plans/tokyo-suburban-r1-prompts.md`; check which R1 outputs already exist before re-running. Production
release needs explicit user approval. Lessons from the 1都3県 project: `.claude/docs/plans/jr-east-capital-region-handoff.md`
(geometric N02 agreement is not shared-track evidence; every composition needs a physical-track review).

## Phase plan

| Phase | Content | Status |
|---|---|---|
| R1 | Research inventories in parallel: R1-JR (近郊区間 boundary, JR lines incl. non-1都3県 parts), R1-SUB (3 subway operators), R1-PE (東武・西武・京成・TX), R1-PW (東急・京王・小田急・京急・相鉄) | R1-SUB done (17 services, 283 unique ids, 227 transfer rows — Toei/Yokohama transfers UNVERIFIED); R1-PW done (26 services, 337 unique ids, 120 transfers; open: 京急 YRP野比–三崎口 has no 普通, みなとみらい線 out of every scope, cross-operator identities); R1-PE done (33 services, 404 unique ids, 103 transfers, full lines uncut; open: 京成成田空港線 has no 普通, 東武押上 no 普通, 北総/芝山 out of scope, 西武山口線 AGT); JR running |
| R2 | Merge into one research catalog; inter-operator transfer/station-identity model; through-running split; real-engine Monte Carlo (`npm run sim` with the research catalog loader); size/perf estimates | pending |
| R3 | Design doc + user decision list (goal/lottery levers if games get long, transfer rule, boundary rule for non-JR lines) | pending |
| Impl | Step plan like the 1都3県 project (pipeline gaps for multi-operator N02 selection → staging per operator → final data → rules → docs → release) | pending |
| Share | X share (Web Intent), then branding (logo, favicon, OGP) and analytics | pending |

## R1 shared conventions (all research agents)

- Output per agent: `.claude/docs/research/tokyo-suburban-r1-<slug>.md` (notes, sources, open questions) and
  `.claude/docs/research/tokyo-suburban-r1-<slug>-catalog.csv` with the columns
  `service_id,order,station_name_ja,station_name_en_romaji,prefecture,municipality,operator,line_official,service_name_ja,service_kind,is_loop,endpoint_kind,station_id_proposed,station_code,n02_operator,n02_line,source_url,notes`.
  - One row per stop in travel order (`order` from 0). `service_kind` = `local` (JR rapid track systems: `rapid`).
  - `endpoint_kind` only on first/last stop of linear services: `terminus`, `area-boundary`, `service-boundary`.
  - `station_id_proposed`: lowercase romaji slug; the SAME physical station shared by lines of the same operator gets
    one id. Different operators keep separate ids at this phase (R2 decides cross-operator identity) — prefix
    non-JR ids with an operator slug (`tokyu-shibuya`, `metro-ginza-…` not needed: use `metro-shibuya`).
  - `n02_operator` / `n02_line`: the N02 `運営会社` / `路線名` values (raw N02 2025 at `N02-25_GML/UTF-8`, read-only;
    use it to confirm names and coverage, list lines missing from N02).
- Through-running: split at operator boundaries (each operator's line is its own service, endpoints
  `service-boundary`), unless the operator itself runs one named line across its own segments.
- Stop pattern: weekday 各停; stations served only by non-各停 trains are reported but not included.
- Sources: official operator route maps/timetables first; cite URLs. Mark anything unverified.
