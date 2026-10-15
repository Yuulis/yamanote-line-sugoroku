# Handoff: 東京近郊版 (Tokyo suburban network edition)

## Current status (2026-10-15) — resume here (Codex takes over)

**The user handed all remaining work to Codex (2026-10-15).** A Codex main session (Sol) owns routing and
verification; delegate specified work to Luna (`high`, web search available) and reviews to Sol `low` read-only.
Contracts for the next steps are in `.claude/docs/plans/tokyo-suburban-r1-prompts.md` (sections `r1b`, `r2`).
Integration branch `feature/tokyo-suburban-network` (off `develop` at `adc0812`, pushed). Production = JR東日本
1都3県版 (released 2026-10-15, PR #26).

User decisions (DESIGN.md Key Decisions, 2026-10-15):

- Area: the full JR「東京近郊区間」 as defined on 2026-03-14 (includes 長野: 松本・長野・白馬, 山梨, 福島 to 浪江,
  静岡: 熱海・伊東). Non-JR lines: apply rule B from `tokyo-suburban-r1-jr.md` (stations inside 1都6県, hull check);
  per R1 this cuts no in-scope private/subway station.
- Operators: JR; 東京メトロ, 都営地下鉄, 横浜市営地下鉄; 東急, 東武, 西武, 京成, 京王, 小田急, 京急, 相鉄, TX;
  plus みなとみらい線 and 北総線 (added 2026-10-15). 芝山鉄道 and other through-running partners stay out.
- Private/subway: one 各停 service per line; sections without 普通 where every regular train stops at every
  station count as 各停 (京急 YRP野比–三崎口, 京成成田空港線 qualifying part, 東武 押上–曳舟). JR keeps the
  1都3県 track-system rule.
- The new edition replaces the 1都3県版 (no selector); old saves discarded.
- After the network: X (Twitter) result sharing; before wide publication: logo, favicon, analytics.

R1 results (all committed under `.claude/docs/research/tokyo-suburban-r1-*`):

| Inventory | Services | Unique ids | Transfers | Notes |
|---|---:|---:|---:|---|
| JR (`r1-jr`) | 55 (40 shipped: 30 unchanged + 10 extended; 15 new) | 746 (472 shipped + 274 new) | 148 transfer stations | area text from the 2026-05-12 archive snapshot; 3 short N02 junction gaps (小山 ×2, 水戸) |
| Subway (`r1-sub`) | 17 | 283 | 227 rows | 大江戸線 = loop + radial sharing 都庁前; 都営/横浜 transfer rows UNVERIFIED |
| East private (`r1-pe`) | 33 | 404 | 103 rows | full lines, uncut; transfers from Wikipedia + 京成 map |
| West private (`r1-pw`) | 26 | 337 | 120 rows | N02 geometry gaps 目黒線 多摩川–日吉, 大井町線 二子玉川–溝の口 (borrow covering line) |

Per-prefecture station counts before cross-operator merging: 東京 667, 神奈川 301, 千葉 255, 埼玉 184, 栃木 90,
群馬 78, 茨城 76, 長野 61, 山梨 28, 福島 19, 静岡 6 — total 1,765.

Open questions collected for R3 (with the R2 numbers): cross-operator station identity rule; splitting long JR
services (常磐 品川–浪江, 中央本線 to 塩尻, 宇都宮線 to 黒磯); 篠ノ井線 + 信越 merge; 水戸線 to 水戸; id renames
(`jr-chuo-takao-fujino` → `jr-chuo-main`); 西武山口線 (AGT) kept as a normal line (default yes); 東急 98 vs 99
stations (世田谷線 三軒茶屋); risk: JR plans to merge Suica areas in spring 2027 — the area stays frozen on 2026-03-14.

Next: **R1b** (みなとみらい線・北総線 + 実質各停 addendum, Luna high with web search) → **R2** (merged catalog,
identity rules, real-engine Monte Carlo, size estimate) → **R3** (design + user decisions) → implementation.

## Phase plan

| Phase | Content | Status |
|---|---|---|
| R1 | Research inventories in parallel: R1-JR, R1-SUB, R1-PE, R1-PW | DONE (Claude Opus, 2026-10-15) — see "R1 results" above |
| R1b | みなとみらい線・北総線 inventory + 実質各停 addendum (prompt `r1b`) | next |
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
