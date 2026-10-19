# Tokyo suburban edition — R3 proposal and implementation handoff

Date: 2026-10-15. Status: proposal; product implementation waits for the decisions in section 2.
Research: [R2 report](../research/tokyo-suburban-r2.md), its tracked CSV pair, audit, results, connectivity and size JSON.
Previously confirmed requirements remain in `DESIGN.md` Key Decisions; this proposal does not supersede them without user approval.

## 1. Confirmed scope and research baseline

- Replace the shipped 1都3県 edition with one Tokyo suburban edition; no edition selector or old-save migration.
- JR Tokyo suburban section frozen to the 2026-03-14 definition, including the outlying Nagano/Yamanashi/Fukushima/Shizuoka portions.
- The confirmed private/subway operators plus MM/Hokuso; no extra through-running partners. Non-JR rule B cuts no included station.
- One local-equivalent service per private line; de-facto-local exception for the confirmed Keikyu, Tobu and airport segments.
- JR track-system/basic-pattern model retained; no new upper train-type services.
- Research baseline: 135 services, 1,586 merged identities, 2,142 service-stop rows, 3,988 directed segments, all stations reachable.
- Preserve the shipped 472 station ids and 40 service ids. The research target is `jr-yamanote`, start `shimbashi`.
- Share-to-X, logo/favicon/OGP and analytics follow the network work. They are not included in the data/engine changes below.

## 2. Decisions requested from the user

### D1 — station identity and walking transfers

Recommend R2 B: documented shared boarding structures plus official interchanges inside a 600 m station-point group.
Prioritize same-name stations, retain original names as aliases, and reject same-service stop collapse, distinct JR-id collapse,
and excessive group diameter. Station-point distance is not pedestrian walking distance.

This keeps JR/Metro/Odakyu/Keio/Toei main Shinjuku together while leaving the Seibu-Shinjuku / Shinjuku-nishiguchi group
separate. It merges Korakuen/Kasuga, Hamamatsucho/Daimon and Oshiage. Tokyo/Otemachi, Shiodome/Shimbashi and
Sengakuji/Takanawa-Gateway stay separate under the chosen evidence standard.

Different-name walking links that would collapse two stops of a service are explicitly omitted. Modeling all of them as
zero-pip walks is a separate engine/RNG/save/UI feature, with no valid current-engine Monte Carlo results for that alternative.
The shared-structure-only alternative leaves 66 stations unreachable; the same-name-only alternative loses useful official walks.

### D2 — game length and goal

Recommend **Yamanote target share 2/3** at target stations, keeping toward-target direction weight **2:1** and
keeping the current goal. In 5,000 real-engine games this gives median **55**, p90 **146**, p99 **261**,
maximum **446**, no cap hits and no games above 500 turns. It is close to the old edition's duration
(reference median 61), while retaining official interchanges and the expanded reachable network.

| Policy | Games | Median | p90 | p99 | Above 500 |
|---|---:|---:|---:|---:|---:|
| Current share 1/2, direction 2:1 | 20,000 | 137 | 311 | 516 | 239 |
| Proposed share 2/3, direction 2:1 | 5,000 | 55 | 146 | 261 | 0 |
| Fast option share 3/4, direction 2:1 | 5,000 | 33 | 100 | 198 | 0 |
| Share 1/2, direction 3:1 | 5,000 | 118 | 252 | 411 | 13 |
| Current weights, pass-through on all services | 5,000 | 132 | 297 | 503 | 52 |

The 3/4 share + 3:1 direction combination is still shorter (31 / 84 / 159). It is an optional fast policy,
not the recommended default for the larger network. Small differences between 5,000-game variants should
not be ranked without further uncertainty analysis; the large target-share effect is the useful design signal.

Any adopted lottery change receives a new ruleset version. No measured alternative is silently installed in the shipped game.
The historical user decision to keep the current goal remains the default unless explicitly changed.

### D3 — service boundaries and exceptional representations

Recommend keeping the research boundaries for initial implementation:

- Whole Joban Shinagawa–Namie, Chuo main Takao–Shiojiri and Utsunomiya Tokyo–Kuroiso services.
- Separate Shinonoi / Shinetsu Shinonoi–Nagano; Mito line ends at Tomobe. Joining them is reproducibly measured as an alternative.
- Oedo as loop + radial sharing Tocho-mae; non-target loop can be ridden both ways. This models the lasso without repeating a station in one service.
- Chiyoda Kita-Ayase remains in its current single service; Seibu Yamaguchi remains a normal included railway service.
- Keep the shipped `jr-chuo-takao-fujino` id; update the human-readable range name rather than introducing an unnecessary identity rename.
- Retain R1's within-operator station identities, including Tokyu Sangen-jaya, for this release. Inter-operator research does not silently resplit them.

Measured 5,000-game medians for splitting all three long services, each individual split, joining Shinonoi,
and extending Mito are all **137**. The corresponding p90 values are 307–311 and p99 values 512–521.
These runs give no game-length reason to introduce additional service boundaries or joins. The Mito
variant's copied rapid/local metadata conflict was corrected and its real-engine run passed before using the result.

### D4 — title

Recommend retaining `山手線すごろく` with subtitle `東京近郊版`. Remove the existing JR-only subtitle because the expanded
edition includes private and municipal operators. This is a proposed display title; branding work still follows later.

## 3. Architecture

Keep the pure movement engine and station-based arrival lottery. The approved station registry defines gameplay transfers;
N02 representative-point proximity only proposes candidates. Each service keeps its own platform coordinates and original station labels.
Generated train segments retain shared-geometry references and composition; no walking connection becomes a fictitious rail geometry.

The current pipeline selects one dataset-wide N02 operator (`build.py`) and exports one global operator for all services
(`export.py`). Extend this to reviewed per-service operator selection, with explicit cross-owner platform/section overrides at boundaries.
Cache raw sources by operator, keep N02 selection constraints per station/range, and reject accidental cross-operator matches.
Each service stop must retain its original station name, N02 match name and selectors separately from the shared
registry/display name. Apply these to both candidate discovery and filtering: operator selection alone cannot match
Hamamatsucho/Daimon or Korakuen/Kasuga on both sides of a different-name group.
Allow the frozen JR outlying station set instead of the current four-prefecture registry restriction; non-JR scope remains its own rule B.

Shared station groups need curated canonical labels plus aliases such as `後楽園・春日`. Preserve original service stop names for
popups/directions. Do not display only a representative's name when that hides a familiar interchange identity.
Do not infer shared tracks from geometric overlap: parallel Tokyu tracks are not shared infrastructure.

Version the generated dataset and adopted rules so old saves follow the existing incompatible-save/discard path.
Do not add migration code or delete saves automatically. Whether serialization needs a schema/save-version increment is decided
from the actual contract diff; dataset/ruleset incompatibility must be tested regardless.

The larger territory requires an explicit network overview while preserving a useful Tokyo/current-location view.
Use grouped/filterable operator/line legends and existing zoom-gated labels. Keep MapLibre layer count bounded and reuse
primitive geometry. Runtime performance acceptance uses final routed data and representative mobile/desktop devices.

## 4. Incremental implementation plan after approval

| Step | Change | Acceptance |
|---|---|---|
| S0 | Freeze approved catalog, identity map, ruleset settings and expected counts | Research hashes and chosen matrix case recorded; complete station coverage reconciled |
| S1 | Pipeline: per-service N02 operator/source and per-stop match-name/selector selection; curated display aliases; extended scope validation | Both sides of different-name groups select real platforms; multi-operator homonym/boundary and legacy single-operator regressions; no relaxed wrong-track checks |
| S2 | JR outlying staging, preserving existing routed/composed capital-region segments | Route each new pair; resolve Oyama/Mito 25–41 m junction gaps explicitly; no fabricated connectors |
| S3 | Subway and private staging in independent operator groups | Station count/order/endpoint/source checks; platform membership and actual geometry paths verified |
| S4 | Cross-operator assembly and shared-track composition | One approved game identity per group, per-service platforms, no collapsed service stops, all stations reachable |
| S5 | Final bundle, rule configuration and incompatible-save behavior | Full deterministic rebuild/hash checks; 30 Yamanote target segments; seeded replay and old-save rejection |
| S6 | Larger-network map, legend, alias labels and useful initial/overview camera | Mobile/desktop interaction and label-density checks; final bundle/raw/gzip/reference budgets measured |
| S7 | Real-data simulations, fixture E2E, docs and integration review | Unit/pipeline/E2E gates, chosen-rule distribution, no placeholders/out-of-scope edits; independent review |
| S8 | Integration/release preparation | Reviewable diff/PR and CI evidence; production merge/deploy only after explicit release authorization |

Per-operator staging is an authoring boundary, not multiple shipping editions. Merge work incrementally so a geometry failure
does not force rewriting unrelated operators. Reuse unchanged shipped geometry where supported by source evidence.

Known N02 concerns to carry into staging:

- JR Oyama junction gaps (Ryomo/Mito) and Mito/Suigun gap; current station representatives do not prove route connectivity.
- Tokyu Meguro Tamagawa–Hiyoshi borrows N02 Toyoko coverage; Oimachi Futako-Tamagawa–Mizonokuchi borrows Den-en-toshi coverage.
- Fukutoshin north of Kotake-mukaihara uses the Yurakucho N02 line; Yokohama Blue spans two legal N02 lines at Kannai.
- Existing Joban/Ueno and Shonan-Shinjuku substitution decisions remain explicit; the expansion must not silently erase their caveats.
- Airport-side track ownership and shared-use boundary stations need reviewed source selectors, not proximity joins.

## 5. Validation and risks

R2 acceptance includes strict CSV parsing, all 472/40 shipped identities/order retained, station reachability, loop/radial and
long-service coverage checks, real-engine smoke and matrix, seed/hash aggregation checks, and all current unit tests.
Product-stage tests additionally cover multi-operator platform selection, geometry composition, alias presentation,
save/replay compatibility, fixture-driven interchanges and full-data map performance.

The raw geometry proxy is close to the existing 1.5 MiB cap and does not guarantee the final bundle size. Measure after composition
before setting any new budget. Neither the research CSV loader's dummy geometry nor its operator display metadata proves UI performance.
Official transfer data contains unresolved walks; their exclusion is visible in the evidence/audit rather than hidden in a distance heuristic.
The main unresolved product choice is game length: the current rule's measured median is 137 turns, so preserving it is a deliberate tradeoff.

No production change or release authorization is implied by approving this research plan.
