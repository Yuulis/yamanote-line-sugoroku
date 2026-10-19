# R2 — Tokyo suburban research catalog and real-engine measurements

Date: 2026-10-15. Lead: Codex Sol. Official-source extraction: Codex Luna.
This document proposes research defaults for R3; it does not approve product-rule changes.
All 16 measurement cases and the final input/seed/statistics checks are complete. R3 product choices remain unapproved.

## 1. Deliverables and counts

- `tokyo-suburban-research-catalog.csv`: 2,142 service-stop rows, 135 services, 1,586 game station identities.
- `tokyo-suburban-research-services.csv`: metadata accepted by `tests/simulation/inputs.ts` without a harness or product-code change.
- `tokyo-suburban-research-audit.json`: every original station id, its representative, candidate pairs, distances, merge/rejection decisions, input hashes and unresolved out-of-scope/unmatched transfer rows.
- `tokyo-suburban-r2-transfer-evidence.json`: row-level official-source findings, including negative/unclear evidence. Existing R1 inputs are preserved.
- `tokyo-suburban-r2-results.json`: full configs, input hashes, seed-set hashes, counts, censoring and measurement provenance.
- `tokyo-suburban-r2-connectivity.json`, `tokyo-suburban-r2-size.json`: connectivity and planning-size evidence.
- `tokyo-suburban-r2-tools/`: tracked generator, acceptance checks, matrix runner and estimate scripts. Generated variants and per-game shard reports are under `.claude/logs/r2/` and can be regenerated.

| Input | Services | Rows | Operator-specific station ids |
|---|---:|---:|---:|
| JR | 55 | 976 | 746 |
| Subway | 17 | 335 | 283 |
| East private | 33 | 435 | 404 |
| West private, original CSV | 26 | 364 | 332 |
| MM / Hokuso | 2 | 21 | 21 |
| Exception addendum | 3 | 15 | 15 |

The exception rows replace the four existing `keikyu-kurihama` rows and add two services.
Thus 2,110 original rows + 21 extra + 15 exceptions - 4 replaced = **2,142**.
Original identities are 746 + 283 + 404 + 332 = **1,765**. Add 21 extra, five southern Keikyu stations,
Tobu Oshiage, Keisei Inba-Nihon-idai and Narita-Yukawa = **1,794** before cross-operator merging.
The recommended grouping reduces that by 208 to **1,586**. All 472 shipped JR station ids and all 40
shipped service ids remain, with every shipped service's original stops retained as a contiguous sequence.
The R1-PW note's 337 figure includes the five originally excluded Keikyu stations; it is not the original CSV's distinct-id count.

There are 15 included operators, 55 JR services and 80 non-JR services. The loader builds 3,988 directed segments.
No product files, runtime engine, default simulation harness, save schema, or deployment have changed.

## 2. Scope and exception interpretation

JR scope is the R1 inventory for the Tokyo suburban area frozen at 2026-03-14. This includes Nagano,
Yamanashi, Fukushima through Namie, and Shizuoka through Atami/Ito; it is not a seven-prefecture JR cut.
All non-JR stations satisfy the adopted seven-prefecture rule B and lie inside the convex hull of the in-scope
JR station representatives: **zero geographic cuts**. This is a cross-check, not a replacement of JR's legal definition.

The addendum includes full Keikyu Kurihama through Misakiguchi, Tobu Oshiage–Hikifune, and Keisei
Inba-Nihon-idai–Narita-Yukawa–Airport Terminal 2–Narita Airport. Hokuso covers Keisei-Takasago–Inba-Nihon-idai.
Operator boundaries remain separate services even when their station identities are merged.
The de-facto-local exception evaluates the eligible, no-surcharge stopping pattern. Reserved-seat Skyliner
is excluded; the no-surcharge Access Express supplies the airport segment's all-stop pattern.
This applies the user's stated intent to include Narita-Yukawa; it is not an addition of every private express service.
The official stop-table notice cited in R1b is dated 2016; current official station listings corroborate its stopping pattern.
Exact weekday timetable details should be rechecked during staging before product inclusion.

Official sources and caveats are retained in `tokyo-suburban-r1-extra.md` and `tokyo-suburban-r1-exceptions.md`.
The repaired R1b check rejects extra/missing CSV fields, verifies all added station/line memberships against
local N02, and preserves the existing Keisei airport station ids. Malformed-row regression cases exercise the previous failure.

## 3. Station identity proposals

### A — documented shared boarding structures only

Merge an explicit list of shared platforms, cross-platform structures and through-running boundary stations
documented in R1. Retain every other operator-specific id. This yields **1,772** identities; **66 are unreachable**
from Shimbashi (TX 20, Yokohama subway 40, Seibu Tamagawa 6). Its game-length results therefore describe a
smaller reachable graph and cannot justify shipping this model as the complete network.

### B — official interchanges within a bounded station group (recommended)

Merge documented shared boarding structures first, then candidates supported by an explicit official interchange
listing and a station-point separation at most **600 m**. Prioritize same normalized station names before
different-name walks; break remaining ties by distance and stable ids. Same-name coincidence alone is never evidence.
N02 representative-point distances are geographic estimates, not measured pedestrian routes or walking-time promises.

Every merge also rejects:

- two distinct stops of one service entering the same group;
- two distinct JR station ids entering one group;
- a group whose maximum member-to-member station-point distance exceeds 600 m.

There are **1,586** resulting identities, all reachable from Shimbashi. The group diameter check prevents an
arbitrarily long chain of free walks. The threshold is a research recommendation for user approval, not an existing rule.
A 500 m prototype separated JR/Metro/Odakyu Shinjuku from Keio/Toei Shinjuku because the full complex spans
about 514 m between N02 representatives. The 600 m proposal preserves the familiar main Shinjuku interchange.
Preliminary 500 m measurements were superseded and are not the formal matrix.

The audit records official walking candidates that still cannot be represented by station merging. In particular,
merging Shinjuku and Shinjuku-nishiguchi would collapse two stops on the Oedo loop; merging the Ochanomizu
groups can likewise collapse two Marunouchi stops. Such links are omitted explicitly, not silently converted into
train segments. Existing within-operator identities from R1, including Toei Shinjuku and Tokyu Sangen-jaya, remain the baseline.

| Example | B representation |
|---|---|
| Tokyo–Otemachi | Separate: exits/underground walking do not establish the required rail-interchange evidence |
| Korakuen–Kasuga | One non-JR group; original names retained in CSV alias fields |
| Hamamatsucho–Daimon | One group retaining shipped `hamamatsucho` |
| Oshiage | Metro, Toei, Keisei and Tobu in one group |
| Main Shinjuku | JR, Metro, Odakyu, Keio and Toei Shinjuku in one group |
| Seibu-Shinjuku–Shinjuku-nishiguchi | Separate group from main Shinjuku; Oedo adjacency is preserved |
| Shiodome–Shimbashi | Separate: the official Shiodome transfer list names Yurikamome, not these rail connections |

`station_name_original` and `station_id_original` preserve each service's original stop name/id. The simulator uses
one canonical display name to satisfy its identity guard; product station labels/popups should expose the merged aliases.
The canonical choice keeps a JR id whenever a group includes JR, otherwise the lexically first original id.

Sensitivity inputs are same-name-only B at 600 m (**1,636** identities) and official-interchange B at 300 m
(**1,613**), both fully reachable. These are reproducible generator flags, not additional shipping editions.

### C — separate stations plus zero-pip walking links

This could preserve every official pedestrian connection without collapsing a service's distinct stops.
The current engine boards only at the landed station id; it has no zero-pip walking-link transition/lottery contract.
C would require an engine, RNG/save replay and UI design. It is **not implemented or simulated**, and is deferred
unless the user explicitly chooses that extra scope. B supports the expansion with the existing engine.

## 4. Evidence resolution

The explicitly flagged subway/PW rows and PE different-name rows reconcile exactly: 107 subway + 3 PW + 26 PE = 136.
The follow-up covers all 103 PE input rows with exact original keys (84 supported, 15 out of scope, 4 unclear at
that stage). A targeted final check resolves/qualifies ten critical walking rows using station-specific pages.
The combined evidence file contains 212 distinct triples: 188 supported, 8 unclear, and 16 negative/out-of-scope.
The 136 original audit rows have 135 distinct triples because the Toei Jimbocho-to-Metro Hanzomon entry occurs twice.
The combined evidence file keeps final row-level statuses; counts should be read from that file, not added across
overlapping research calls. A positive result requires actual transfer evidence, not simply a station appearing on a map.
Unclear does not prove that a walk is impossible; it does not authorize merging under B.

Key corrections: no Tokyo/Otemachi merger, no Sengakuji/Takanawa-Gateway merger, no Shiodome/Shimbashi merger;
the original Shin-Tsudanuma key is preserved. An official listing in either direction can support a candidate.
All candidate decisions and remaining unresolved/out-of-scope targets are inspectable in the audit JSON.
Read-only consultation provenance envelopes can include concurrent lead edits because they observe the shared
tree; those entries are not evidence that the read-only researcher wrote those files. No product edits occurred.

## 5. Representation variants

Oedo is a 28-stop non-target loop plus an 11-stop radial service, sharing Tocho-mae (38 original distinct stops).
Only Yamanote is restricted to its target direction; Oedo may be ridden in both directions under the normal
non-target lottery. This is a gameplay representation of the lasso, not a claim that trains circulate indefinitely.

The default keeps the R1 service boundaries: Joban Shinagawa–Namie, Chuo main Takao–Shiojiri and Utsunomiya
Tokyo–Kuroiso remain whole. `jr-chuo-takao-fujino` retains its shipped id despite its extended display name.
Variants split Joban at Toride/Iwaki, Chuo at Kofu and Utsunomiya at Utsunomiya, individually and combined.
Further variants join Shinonoi with Shinetsu through Nagano and extend the Mito service from Tomobe to Mito.
All variants preserve the station set and undirected train-hop adjacency. They change service-lottery/endpoint
behavior, so simulations use the actual variant network rather than assuming equal results from equal connectivity.

## 6. Measurement method and results

Every game calls production `createGame` and `playTurn` via the existing `runGame` harness. Per-turn movement
history is discarded by the existing harness; engine transitions, completed-segment tracking, RNG and goal logic
are unchanged. Independent seeds are `s1m-20261012-i`, with indices 0 through N-1 for every case; turn cap 20,000.
Shards contain independent games only. Their raw turn counts are merged before computing nearest-rank quantiles;
they are not averages of shard medians. Input/config/code fingerprints and seed-set hashes must agree.
Nonzero shard process exits are always failures. Censored runs are saved as cap+1 with explicit indices, cause the
overall measurement command to fail, and are not reported as completed-game durations.

The baseline config is the shipped target share 1/2, toward-target direction weight 2:1, and the existing goal
(all 30 Yamanote outer segments plus Shimbashi). The all-equal preset removes both lottery biases.
After the 3/4 target-share lever produced a median below the old edition, an additional 5,000-game 2/3 share
case was added with the same first 5,000 seeds; it does not replace any predeclared comparison.
The loader's synthetic coordinates, geometry ids and operator display metadata are irrelevant to these rules;
these runs do not measure animation, save growth, geometry quality or device performance.

<!-- R2_MEASUREMENT_TABLES -->

| Policy / representation | Games | Median | p90 | p99 | >500 | Cap hits |
|---|---:|---:|---:|---:|---:|---:|
| Shipped lottery / unchanged goal | 20000 | 137 | 311 | 516 | 239 | 0 |
| All service and direction candidates equal | 20000 | 1607 | 3144 | 4942 | 18722 | 0 |
| Shared boarding structures only (66 unreachable) | 5000 | 69 | 280 | 950 | 239 | 0 |
| Same-name official interchanges only, 600 m | 5000 | 134 | 308 | 511 | 54 | 0 |
| Official interchanges, 300 m | 5000 | 143 | 321 | 545 | 73 | 0 |
| All three long JR services split | 5000 | 137 | 310 | 516 | 63 | 0 |
| Joban split at Toride/Iwaki | 5000 | 137 | 311 | 512 | 63 | 0 |
| Chuo main split at Kofu | 5000 | 137 | 309 | 512 | 61 | 0 |
| Utsunomiya split at Utsunomiya | 5000 | 137 | 307 | 521 | 63 | 0 |
| Shinonoi + Shinetsu through Nagano | 5000 | 137 | 309 | 512 | 61 | 0 |
| Mito through Tomobe to Mito | 5000 | 137 | 309 | 515 | 61 | 0 |
| Target share 3/4; direction 2:1 | 5000 | 33 | 100 | 198 | 0 | 0 |
| Target share 1/2; direction 3:1 | 5000 | 118 | 252 | 411 | 13 | 0 |
| Current lotteries; pass-through on every service | 5000 | 132 | 297 | 503 | 52 | 0 |
| Target share 3/4; direction 3:1 | 5000 | 31 | 84 | 159 | 0 | 0 |
| Target share 2/3; direction 2:1 (recommended) | 5000 | 55 | 146 | 261 | 0 | 0 |

All **16 cases / 110,000 games** completed; no cap hits.
The first 5,000 baseline seeds give 137 / 309 / 512 turns, mean 159.693 and 61 games above 500.
All 5,000-game sensitivity cases use that same seed prefix; apparent one-turn changes are not precision claims.
The shared-only result is not comparable as a complete-network shipping option because 66 stations are unreachable.

<!-- R2_MEASUREMENT_TABLES_END -->

## 7. Geometry and rendering estimate

N02 operator/line selection at the current 1 m metric simplification / six decimal coordinate precision gives:

| Planning selection | Raw geometry bytes | gzip bytes | Features | Coordinates |
|---|---:|---:|---:|---:|
| Station hull + 5 km, whole intersecting sections | 1,542,594 | 260,537 | 4,538 | 40,258 |
| All matching lines, including out-of-area extensions | 1,690,357 | 287,775 | 4,923 | 44,433 |
| Shipped 1都3県 geometry | 398,311 | 83,972 | — | — |

The current `capital-region` geometry budget is 1,572,864 raw / 460,800 gzip; total bundle budget is
3,145,728 raw / 921,600 gzip. The regional planning selection approaches the raw geometry cap; it is not proof of
passing it after export. These proxies have different properties/partitioning and are neither strict lower nor
upper bounds on the final routed bundle. Shared-track composition may reduce duplicates; wrong-track alternatives,
route joins and metadata may change sizes. Final five-file sizes, reference counts and maximum geometry chains
must be measured after reviewed staging. No final total-bundle estimate or browser timing is claimed here. Station-point distances are also provisional
until reviewed per-service platform selection; threshold-sensitive candidates must be rechecked during staging.

The station count grows 3.36 times (472 to 1,586), while services grow 3.375 times (40 to 135).
Existing ordinary markers start at zoom 10.5 and station labels at zoom 11; target/transfer markers remain visible
at low zoom. The larger territory makes a full-network initial fit obscure Tokyo, and dense interchange clusters
may crowd low-zoom markers. Implementation should preserve a useful Yamanote/current-location view, provide an
explicit network overview, keep ordinary labels zoom-gated, group/filter the legend, and benchmark mobile pan/zoom
and layer updates on the final bundle. GeoJSON layer counts should remain bounded rather than one layer per service.
The current station popup collection scans every service stop list per station (about 1,586 × 2,142 membership
comparisons in the worst case, versus 472 × 666 previously); pre-indexing the serving-service lookup is an
implementation option to measure, not a claimed present performance defect.

## 8. Reproduction and acceptance

Run from the repository root with Node 24 on PATH and the raw N02 files installed:

```bash
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_r1b.py
uv run python .claude/docs/research/tokyo-suburban-r2-tools/run_matrix.py --generate
uv run python .claude/docs/research/tokyo-suburban-r2-tools/check_catalog.py
uv run python .claude/docs/research/tokyo-suburban-r2-tools/estimate_size.py
SIM_CATALOG=.claude/docs/research/tokyo-suburban-research-catalog.csv \
SIM_SERVICES=.claude/docs/research/tokyo-suburban-research-services.csv \
SIM_TARGET=jr-yamanote SIM_GAMES=200 npm run sim
python3 .claude/docs/research/tokyo-suburban-r2-tools/run_matrix.py --measure --jobs 10
python3 .claude/docs/research/tokyo-suburban-r2-tools/measure_additional.py --jobs 4
uv run python .claude/docs/research/tokyo-suburban-r2-tools/verify_results.py
npx vitest run
```

Use `--rule shared|same-name|official`, `--threshold N`, `--variant ...` and `--out PREFIX` on `build_catalog.py`
for alternative catalogs. `jr-yamanote` is the preserved product service id for the requested Yamanote target.
Cached shards are reused only when their task and code/input fingerprints match. Rebuilding from the tracked
tools recreates ignored variant/shard inputs; official evidence is frozen in the tracked JSON.

Final validation:

- Strict R1b check: 21 extra rows / 15 exception rows; all raw N02 station/line memberships match; malformed extra/missing-column fixtures rejected.
- Research regression suite: four tests passed; all representation variants preserve coverage/order; per-row service kind matches its service metadata.
- Default catalog: 135 services / 1,586 identities / 2,142 rows, all reachable; shipped 472/40 identities and contiguous stop sequences retained.
- Regeneration is byte-identical for the measured CSV pairs: every saved loader hash still matches after rebuilding all ten inputs from tracked tools and frozen evidence. The audit records both raw N02 hashes and the evidence hash.
- Standard `npm run sim` smoke: 200 games; exact first-200-seed statistics agree with the sharded runner.
- Formal matrix: 16 cases / 110,000 games; no cap hits. `verify_results.py` reconciles every shard's seed coverage, source/code fingerprints, configs, raw-turn quantiles/means, maxima, censoring and played-turn totals.
- `npx vitest run`: 578 tests / 26 files passed. `bash scripts/check.sh`: 10 checks passed. Research-tool Ruff checks passed.
- Fresh-context Sol read-only reviews found no blocking source/statistical/design issue. Code fingerprints and process failure handling were strengthened; the proposal now explicitly requires per-service-stop N02 match names as well as display aliases.
- An initial Mito-through variant failed the real loader (`Conflicting service metadata: jr-mito`): copied Joban rapid rows retained their kind inside the local Mito service. The generator now sets Mito's local kind on all rows; the corrected 5,000-game case and final complete matrix pass. The original failed matrix process was not accepted; successful shards were reused only after fingerprint checks.
- A preliminary 500 m matrix was stopped because its Shinjuku grouping omitted familiar interchanges. Formal results use the reviewed 600 m input only.
- Product build, pipeline routing, browser E2E and device-performance gates were not run for a product change: this phase changes research/docs/tools only. They remain required during implementation; no final production geometry or renderer performance is certified.


## 9. R3 decision list

The concrete proposal is in `../plans/tokyo-suburban-network-design.md`.

| Decision | Recommendation | Evidence / tradeoff |
|---|---|---|
| D1 station identity | Official interchanges in a bounded 600 m group; explicit shared structures; aliases; no same-service/JR-id collapse | All 1,586 stations reachable; main Shinjuku restored; certain walking links remain explicitly unmodeled |
| D2 duration | Target share 2/3; keep direction 2:1 and the existing goal | 55 / 146 / 261 turns; no >500 in 5,000 games; 3/4 is a faster 33-turn option |
| D3 representations | Keep R1 JR boundaries; Oedo loop + radial; existing within-operator identities; no service-id renames | Six boundary variants have essentially the same 137-turn median as the 5,000-game control |
| D4 title | 山手線すごろく — 東京近郊版 | Retains the game name and reflects the non-JR expansion |

Scope, operators, single-edition replacement and old-save non-migration were already decided and are not reopened.
Implementation starts after D1–D4 are settled; no alternate measurement is silently applied to the shipped game.
