# JR East capital-region game data pipeline

`public/data/*` is generated deterministically from MLIT N02 2025 and reviewed
`data/overrides` tables. The live S6/S5 edition contains 40 services and 472
shared stations across 東京都・千葉県・神奈川県・埼玉県, with 1,224 directed
gameplay segments, 568 owned geometry features and 1,230 geometry references.
The product stop order is pinned by `data/overrides/expected-catalog.json`
(SHA-256 `42bcd19b8407c6d80d45622f0589268b2b0dc7970fdd63fc6f3cc7352ba2a231`);
there is no live timetable lookup. Gameplay starts at 新橋 and uses the adopted
weighted lotteries (`jr-east-capital-1`). The five public files total 744,720 raw
bytes and 125,322 gzip bytes (level 9, mtime 0), within the `capital-region`
profile caps of 3,145,728 raw and 921,600 gzip bytes. GeoJSON is 398,311 raw / 83,972
gzip bytes; the maximum feature chain is 3 references.

## Source and licences

| Item | Value |
|---|---|
| Dataset | 国土数値情報（鉄道データ） N02, 2025年度版 (`N02-25`) |
| Base date | 2025-12-31 |
| Download | [MLIT N02 2025](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html), `N02-25_GML.zip` |
| Input CRS | JGD2011 geographic (EPSG:6668) |
| Metric routing CRS | JGD2011 / Japan Plane Rectangular CS IX (EPSG:6677) |
| Output CRS | WGS84 lon/lat (EPSG:4326) |
| Licence | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) |
| Attribution | 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 |

Raw GeoJSON is gitignored and never shipped. Metadata XML/XSD remains tracked.
Stop order and catalogue evidence comes from the reviewed JR East timetable
research in `.claude/docs/research/jr-east-tokyo-expansion.md`. Station numbers and
length references are secondary cross-checks, not a substitute for that stop order.
N03 ward boundaries were a one-time research audit; no N03 data is shipped or needed
by the build. Background-map attribution remains separate from railway attribution.

## Regenerate and verify

Place these UTF-8 files under `N02-25_GML/UTF-8/`:

- `N02-25_Station.geojson`
- `N02-25_RailroadSection.geojson`

The exact input checksums are pinned in `data/n02-2025.sha256`.

```bash
uv sync --locked
sha256sum --check data/n02-2025.sha256
uv run python -m scripts.data_pipeline.build
uv run python -m scripts.data_pipeline.validate
uv run pytest -q
```

Build options: `--raw-dir`, `--overrides-dir`, `--out-dir`, `--quiet`.

## Live edition (S6 data + S5 rules; 2026-10-15)

The shipped catalogue is the approved JR East capital-region product catalogue:
40 services and 472 stations in product order. All four prefectures are included;
`data/overrides/dataset.json` pins `expected-catalog.json` with SHA-256
`42bcd19b8407c6d80d45622f0589268b2b0dc7970fdd63fc6f3cc7352ba2a231`. The 67
previously shipped station IDs and five service IDs are retained. The game starts
at `shimbashi`, targets `jr-yamanote`, uses the `capital-region` budget profile,
and simplifies geometry by 1 m. S5 sets the ruleset to `jr-east-capital-1`:
Yamanote has a 1/2 share when it is a candidate, remaining services share the
other half uniformly, local and rapid bases have equal weight, and the direction
toward Yamanote is weighted 2:1 when both directions can move.

The output has 1,224 directed segments, 568 primitive features and 1,230 geometry
references; the maximum chain is 3 primitives. One reviewed platform transfer is
at 上野 for 常磐線快速 (maximum transfer 150 m; the maximum measured endpoint jump
is 130.956 m). Reviewed platform-offset exceptions are 東京 on 京葉線 (up to 500 m)
and 武蔵小杉 on 南武線 (up to 400 m; measured 393.4 m). Two 湘南新宿ライン freight-corridor
surrogate pairs have a reviewed detour ratio of 2.1. Full sizes, budget use and N02
routing evidence are recorded in `.claude/docs/research/jr-east-capital-region-s6.md`.

N02 has known generalized-line limits: it does not distinguish the separate
常磐線各停・快速 tracks between 綾瀬 and 金町, the separate 総武快速・緩行 tracks
on the 江戸川 bridge, or the passenger/freight track distinction on the 赤羽–浦和
bypass. Service patterns remain distinct in game data; the mapped N02 geometry is
not proof that the real tracks are shared. The 上野 transfer described above is
explicitly modeled rather than bridged with invented track geometry.

Rebuild into a temporary directory and compare before publishing:

```bash
uv run python -m scripts.data_pipeline.build \
  --raw-dir N02-25_GML/UTF-8 --quiet --out-dir /tmp/jrcr-s6
diff -r /tmp/jrcr-s6 public/data
uv run python -m scripts.data_pipeline.validate
```
Validation options: `--data-dir`, `--overrides-dir`. Artifact validation and synthetic
routing tests run in CI without raw N02. The existing raw-data build test module is
skipped only when the raw download is absent; locally it checks pinned inputs and
byte-for-byte equality with the committed output.

The regional staging inputs are under `data/staging/jr-east-capital-region/` and
use the `stage` validation profile with separate outputs. Tokyo, Chiba, Kanagawa
and Saitama stage catalogues were used to assemble the live catalogue. Stage
manifests use schema `3-stage`, are rejected by the browser, and must never be
written to `public/data/`; the live bundle uses the `gameplay` profile and schema 3.

### Prefecture stage validation

`validationProfile` in `dataset.json` defaults to `"gameplay"`; the live override uses that profile; regional stage overrides opt into `stage`.
For a stage without a circular gameplay target, opt in with:

```json
{
  "validationProfile": "stage",
  "stageStartStationId": "musashi-urawa"
}
```

These fields supplement the ordinary dataset metadata, area, catalogue, oracle
and budgets. Omit `startStationId` and `targetServiceId` in this profile (their
presence is rejected); `stageStartStationId` must name a served in-area registry
station, including an endpoint if desired. `stageStartStationId` is forbidden in
the gameplay profile. Unknown validation profiles are rejected.

Exactly these gameplay checks are omitted: target service membership, target
circularity, target first stop equal to gameplay start, gameplay start not being
an endpoint of any linear service (both override and artifact checks), and the
target-specific unreachable-segment check. There is no stage target. The reviewed
disconnected-service list check still runs. All registry/area/scope, numbering,
routing, composition, geometry, platform-transfer, length, budget and hash-pinned
expected-catalogue checks remain, as does reachability of **every station from
and back to the stage start**, in both build and artifact validation. Stop-pair
and end-to-end walk checks remain for every linear or circular service.

Stage manifests have `schemaVersion: "3-stage"`, `validationProfile: "stage"`
and `stageStartStationId`; the current browser rejects that schema. Artifact
validation requires those fields to match the overrides. Stage overrides are
rejected at the resolved live `data/overrides` path by both build and validation,
including symlink aliases. The writer also rejects stage output at the resolved
`public/data` path before writing any files. Always choose a separate output:

```bash
uv run python -m scripts.data_pipeline.build --raw-dir N02-25_GML/UTF-8 \
  --overrides-dir data/staging/jr-east-capital-region/saitama/overrides \
  --out-dir /tmp/jrcr-saitama --quiet
uv run python -m scripts.data_pipeline.validate \
  --overrides-dir data/staging/jr-east-capital-region/saitama/overrides \
  --data-dir /tmp/jrcr-saitama
```

The commands assume complete reviewed stage inputs; this profile does not fill
in missing recipes or metadata. For an integrated gameplay release, remove the
stage fields, restore `startStationId`/`targetServiceId` and pass all default
gameplay checks before publishing a fresh v3 build. Never relabel a stage manifest.

## Reviewed overrides

| Path | Purpose |
|---|---|
| `dataset.json` | Operator, update date, target/start, ordered service catalogue, reviewed disconnected services, area and bounding boxes |
| `stations.csv` | Stable shared id, display/N02 spelling, prefecture/municipality, representative service, optional registry N02 selector |
| `services.json` | Metadata, direction labels, endpoint kinds, stop counts, length references, station-number rules and scope evidence sources in lottery order |
| `services/<id>/stops.csv` | Reviewed in-area stop order, station number, optional N02 platform selector |
| `services/<id>/scope.csv` | Independent reviewed served-stop order, with first excluded neighbours at area boundaries |
| `services/<id>/line_mapping.csv` | Physical N02 line per contiguous run, optional via hints or explicit multi-line `route` |
| `services/<id>/sections.csv` | Optional reviewed track-section allow/deny constraints |
| `offset_exceptions.csv` | Reviewed large platform offsets, currently Tokyo on Keiyo |
| `detour_exceptions.csv` | Optional reviewed per-forward-pair detour limits with reasons (currently empty) |
| `platform_transfers.csv` | Optional reviewed stops where a service departs from another N02 platform feature (currently absent) |

The initial 2026-10-12 23-ward release listed Yamanote, Keihin-Tohoku
(Akabane–Kamata), Chuo-Sobu local (Nishi-Ogikubo–Koiwa), Saikyo
(Osaki–Ukima-Funado), and Keiyo (Tokyo–Kasai-Rinkai-Koen). That historical
catalogue excluded Joban local, Joban rapid, Yokosuka/Sobu rapid and other
rapid/through services. S6 supersedes its live scope with the approved 40-service
regional catalogue described above.

### Historical regional preparation (S3a; superseded by the live S6 dataset)

The registry header is
`id,name,n02_name,prefecture,municipality,representative_service_id[,n02_selector]`.
The 67 existing rows retain their ids, names and representative services; their
prefecture is `東京都` and municipality is the former ward value. Names are not
identity: homonymous rows require disjoint selectors. Registry selectors use the
same `line=...;group=...;code=...` grammar as stop selectors, with `|` for alternatives.
Both selectors must match. Ambiguous N02 groups are checked before coordinate
deduplication; a stop selector cannot override the registry's identity.

`dataset.json` can set `areaPrefectures`, `areaMunicipalities`, `outputBbox` and
`candidateSearchBbox`. Regional defaults are the four prefectures
`東京都,千葉県,神奈川県,埼玉県`, no municipality restriction, output bounds
`[138.6,34.8,141.0,36.8]` and candidate bounds `[138.5,34.65,141.2,37.0]`.
These boxes cover the regional railway extent; area membership comes from the
reviewed prefecture/municipality fields, rather than a rectangle or N03 input.
The candidate box must enclose the output box. The then-shipped 23-ward dataset explicitly
restricted membership to Tokyo's municipalities while using wider regional
search/output bounds. Artifact coordinates and route/via points use each dataset's
configured bounds. This historical description was superseded by the S6 live dataset.

Every service needs `scopeSource` in `services.json` and `scope.csv` with columns
`station_id,prefecture,municipality`. Record the independently reviewed served-stop
sequence for the selected extent, including at least the immediate excluded neighbour
at each `area-boundary`. The in-area rows must form one contiguous run and equal
`stops.csv` exactly. An out-of-area stop between in-area stops is rejected, as is
omitting a served in-area stop. An excluded neighbour is evidence only and does not
enter the station registry or public files. Build diagnostics record each endpoint's
last in-area station and first out-of-area station. Endpoint kinds must agree with
this evidence; `terminus` and `service-boundary` have no excluded area neighbour.

`stationNumberRules: {"sequence": ["JJ02","JJ04","JL20",""], "reason": "..."}`
pins the exact reviewed number at each stop. It permits explicitly reviewed skipped
numbers, multiple prefixes and unnumbered stretches while rejecting reversals or
undeclared prefix switches. The sequence length must equal `expectedStopCount`.
Without this optional configuration the existing single-prefix, consecutive ±1
rule remains (circular sequences wrap once); stop order is never inferred from numbers.

`line_mapping.csv` retains its required `from_id,to_id,n02_line,via` columns and
may add a `route` column containing a quoted JSON cell. A multi-line example is
`{"lines":["東北線","常磐線"],"joints":[[139.7712345678901,35.7312345678901]],"reason":"Reviewed junction"}`.
This coordinate is illustrative: use the actual intersection in metric CRS,
transformed back to source lon/lat at sufficient precision. A route requires at least
two ordered lines and exactly one joint per transition. Leave `n02_line` and `via`
empty on that row, and map exactly one adjacent stop pair. Other rows keep their
single-line range and optional ordered via hints. Section filters apply separately
to every route line, including interior lines.

The builder searches sections around matched platforms and declared joints, routes
each leg on its own constrained graph and enforces the first/last N02 platform line.
An interior T-junction works without a shared source vertex because the explicit
query point splits a track virtually. Joint projections must coincide within
`1e-6 m` (numerical noise only); a platform's 30 m snap allowance never bridges a
missing line. Zero-length route legs are rejected. The artifact validator checks
the committed joints in travel order, allowing only simplification/rounding error
for multi-line witnesses. Verifying physical N02 line ownership still requires the
raw build and reviewed section constraints.

`detour_exceptions.csv` has
`service_id,from_id,to_id,max_detour_ratio,reason`. Each row applies only to one
canonical forward adjacent pair, needs a finite limit greater than the default 1.8
and a review reason, and cannot duplicate or refer to a stale pair. The builder and
artifact validator use the same limit. An exception does not bypass skipped-stop,
platform, joint or area checks. N02's missing 国立支線 and 池袋–赤羽 freight link
require reviewed regional recipes later; S3a adds no substitute geometry or live exceptions.

Migration: replace `ward` by `prefecture,municipality`, add `scopeSource` and per-service
scope evidence, and optionally pin station numbers. The frozen Python fixture follows
the same input migration. The five public v3 files and their content hash stay byte-identical.
Composition DAGs, primitive anchors, shared owners and dataset budgets follow in S3b.

## Routing and schema v3

1. Match each curated station to JR East N02 platform features on its adjacent
   physical lines, inside the configured candidate box; selectors resolve ambiguities.
   Matching uses explicit registry identity and N02 spelling, including ケ/ヶ.
2. Build constrained track graphs from sections within 2 km of candidates.
   Platform/via snapping beyond 30 m is rejected before optimization. Graph cache
   keys include constraints; shortest-path ties are deterministic.
3. Choose a minimum-cost cycle for Yamanote or an open-chain path for linear services.
   A station's representative point comes from its reviewed representative service;
   each service retains its own chosen platform coordinates. N02 sometimes shares
   geometry between parallel services and does not distinguish every physical track.
4. Emit `stations.json`, `services.json`, `segments.json`, `segments.geojson`, then
   `manifest.json` (`schemaVersion: 3`). Coordinates are rounded to six decimals;
   paths are simplified by 1 m. `dataVersion` hashes the four game files in filename
   order. `updatedAt` records the refresh date without changing the content hash.

A directed segment id is `<service>:<from>:<to>`. Linear services have both directions;
Yamanote has outer only. Segments carry a non-empty `geometryFeatureIds` chain in travel order. Reverse
segments carry the reversed list. The historical 23-ward bundle used one-element chains; the current 1都3県 bundle
uses chains of up to 3 primitives. Features are service-owned primitives with
`{featureId, serviceId, lineId, from, to}`; future rapid/through consumers may compose
primitives from multiple owners without changing ownership or gameplay progress.
Animation orients each primitive by station identity, concatenates exact joints once,
and follows the complete chain rather than jumping between the consumer's stops.
`services.json` is the `{ lines, services }` envelope. Lines have `id/name/color`;
services require `kind` (`local | rapid`) and non-empty `lineIds`, plus
`directionLabels`, `platformCoordinates`, and (if linear) `endpoints.first/last`
(`terminus`, `area-boundary`, or `service-boundary`, displayed as 「系統の端」).
Legacy v2 bundles are rejected by the runtime guards. `segments.json` is compact,
with one object per line. The current live bundle uses the approved 40-service stop order and the S5 weighted gameplay rules.

The validator checks the strict five-file schema, registry/area/catalogue,
metadata/stop order, pair coverage and walks, platforms/representatives and reviewed
offsets, unique owned features and valid owner pairs, non-empty/known/ordered travel chains,
reversed reverse-hop chains, exact joints, no backtracking/orphans, endpoint orientation,
same-service skipped stops,
detours/via hints, service lengths, connectivity, start-not-endpoint, deterministic
bytes/content hash and the selected dataset budget profile limits (300,000 B GeoJSON
for `23ku`; 1,572,864 B raw for `capital-region`). Other services' stations
near a path are diagnostic only: Saikyo legitimately passes Yamanote-only stops.

At the historical 2026-10-12 23-ward refresh: v3 geometry 43,433 B; maximum endpoint offset 24.507 m
(Saikyo at Ikebukuro); Tokyo/Keiyo platform offset 386.0 m, within its reviewed
500 m exception. Service lengths: Yamanote 34.453 km, Keihin-Tohoku 27.495 km,
Chuo-Sobu local 30.697 km, Saikyo 21.979 km, Keiyo 10.532 km.

### Composition and dataset gates (S3b)

`line_mapping.csv` may add a `compose` column containing a quoted JSON cell;
`n02_line`, `via` and `route` must be empty for that row. A compose row covers
exactly one forward stop pair. For example (synthetic station/line names):

```json
{
  "legs": [
    {"source_service": "owner-a", "from": "a", "to": "b"},
    {"source_service": "owner-b", "from": "b", "to": "c"}
  ],
  "shared_track_evidence": [
    {"lines": ["L0"], "allow": [], "deny": [], "reason": "Reviewed common track"},
    {"lines": ["L1"], "allow": [], "deny": [], "reason": "Reviewed common track"}
  ]
}
```

Each evidence item corresponds to one leg. Its line set and section filter must
match the flattened owners' actual routing configuration. A leg spanning lines
with different filters can add `line_filters`, keyed by every line in `lines`,
with `{ "allow": [...], "deny": [...] }` values; these replace the common filter
for that leg. Review the raw N02 track and section evidence before authoring a
recipe. Matching station ids alone is insufficient evidence of shared track.

A source leg may span multiple adjacent source stops in either direction, or
consume an earlier composition. Circular sources follow their forward order.
Cycles, unknown sources, repeated stations, incorrect anchors and last stations
are rejected. Owners emit primitives only for their routed pairs; consumers
flatten dependencies into `geometryFeatureIds`, preserving travel order and
reversing the complete list for reverse hops. Primitive endpoints join exactly
in metric coordinates and again after simplification/rounding. Consumer platform
points inherit those endpoints. A mixed route/compose neighbour must also meet
its inherited anchor exactly; the usual 30 m routing snap cannot bridge it.
Build order follows the dependency DAG; station/service/feature/segment output
retains the reviewed catalogue order.

Every on-disk override dataset must name `expectedCatalogFile` (a file in the
same directory) and pin its bytes with `expectedCatalogSha256`. The oracle is a
reviewed JSON object with `services: [{ id, stationIds }]` in output order and
`stationIds` in first-appearance order. Both override services and their exact
stop lists must match it; built artifacts are checked against those overrides.
The shipped and core-fixture oracles are separate frozen inputs. Staging needs
its own reviewed oracle; S6 needs the complete approved product catalogue.
Do not regenerate the oracle as part of a build to hide a coverage difference.
Every station must be reachable from the start and back over actual directed
segments, regardless of `reviewedDisconnectedServiceIds`.

### Platform transfers and inherited anchor lines

`platform_transfers.csv` (optional, next to `offset_exceptions.csv`) has
`service_id,station_id,max_transfer_m,reason`. A row names an interior stop of
a linear service whose arriving and departing +1 pairs need different N02
platform features of the same station, for example two disconnected components
of one N02 line. Routing then chooses the arrival and the departure platform
independently, adds the straight transfer distance to the route cost and
rejects pairs farther apart than `max_transfer_m` (finite, at most 250 m). No
track is invented: each pair still starts and ends on its own platform. A row
whose chosen platforms coincide is stale and fails the build, as do rows for
unknown services, circular services, endpoints or duplicates.

`platformCoordinates` publish the arrival platform in +1 order. Only the
departing side of the canonical +1 pair out of that stop is relaxed: a routed
primitive may start up to 30 m + `max_transfer_m` from the published point and
a composed anchor up to `max_transfer_m` + 0.15 m (`COORDINATE_ROUNDING_M`,
the rounding of two published points). The arriving side keeps the usual 30 m
(routed) or exact (composed) rule, and the departing pair's detour is measured
from its own track point. A row whose +1 chains into and out of the stop join
exactly is reported as unused. Composition across a transfer stop of the owner is
still rejected, because the two owner primitives do not join exactly.

Composed anchors at a transfer stop are inherited per side: the arriving hop's
anchor binds the arrival, the departing hop's anchor the departure. If only one
side is composed, the other side may use any N02 platform of the stop. A
consumer that composes hops on both sides needs its own reviewed transfer row.

An inherited anchor is a point on the owner's primitive, so it carries the N02
line that primitive starts or ends on, not the line of the owner's chosen
platform. This lets a composed hop sit next to a multi-line `route` whose first
or last line is that primitive line (for example a 東北線→山手線 route into a
山手線 primitive whose owner chose its 赤羽線 platform). The routed neighbour must
still meet the anchor exactly; no tolerance is added.

`dataset.json` selects `budgetProfile` (`23ku` by default or `capital-region`)
and can override individual positive integer caps in `budgets`:

| Cap | 23ku | capital-region (provisional) |
|---|---:|---:|
| `geojsonRaw` | 300,000 B | 1,572,864 B (1.5 MiB) |
| `geojsonGzip` | 100,000 B | 460,800 B (450 KiB) |
| `totalRaw` | 1,048,576 B | 3,145,728 B (3 MiB) |
| `totalGzip` | 307,200 B | 921,600 B (900 KiB) |
| `references` | 1,000 | 20,000 |
| `maxChainLength` | 64 | 128 |

Totals include all five files, including the manifest. Gzip reports sum each
file compressed separately with level 9 and `mtime=0`; gzip artifacts are not
shipped. Build rejects overruns before writing files; validation reports raw,
gzip, total reference count and maximum chain length. The regional payload
limits come from the S3b handoff; reference/chain caps and additional 23ku caps
are conservative configuration defaults. S6 measured and accepted them for the live regional dataset.

`dataset.json` can set `simplifyToleranceM` (finite and positive, default 1 m).
Keep 1 m for the shipped edition. Compare alternatives without writing game data:

```bash
uv run python -m scripts.data_pipeline.simplification \
  --overrides-dir data/overrides --out-file /tmp/jrcr-simplification.json
```

The report compares 1/3/5 m against the routed geometry, including coordinate
count, Hausdorff deviation, all size/reference metrics and budget errors. The
current measured report is
`.claude/docs/research/jr-east-capital-region-s3b-simplification.json`.

## Multi-operator override fields (S1)

The override parser accepts optional operator and naming fields while preserving
the existing files when they are omitted. `services.json` may set `operator`
(the published display operator) and `n02Operator` (the exact N02 `N02_004`
source value). Each defaults to the corresponding dataset value. A service may
also set `areaPrefectures`, which must be a non-empty subset of the dataset's
allowed prefectures.

`stations.csv` may add an `aliases` cell containing a JSON string array and an
`n02_operator` cell. Aliases are retained as reviewed identity evidence; they
are not expanded into candidate searches and do not merge station IDs. The
station source operator defaults to its representative service's effective
N02 operator. For example, a curated display station can be named `後楽園・春日`
while its `aliases` cell contains `後楽園` and `春日`.

`services/<id>/stops.csv` may add `original_name`, `n02_name`, `n02_operator`,
and `source_reason`. Defaults are the registry N02 name and the service's
effective N02 operator. When a stop overrides the registry spelling or source,
it must state both the original and matching N02 names, and the original must
be the registry name or one of its aliases. A non-empty reason is required to
set a stop source override. An omitted stop source uses the service's effective
N02 operator; the registry source only determines whether the registry selector
applies. The registry selector is ANDed with the stop selector only when the
resolved `(operator, normalized n02_name)` equals the registry target. An
alternate explicit match uses the stop selector alone.

`line_mapping.csv` may add `n02_operator` and `source_reason`; the operator
defaults to the service source, and a row-level operator needs a non-empty
`source_reason`. A route row can include an `operators` JSON array parallel to
`lines`, allowing an explicitly reviewed source ownership transition. Rows with
a route cannot also set row-level `n02_operator`; `source_reason` without a
row-level operator is rejected.
`sections.csv` can qualify section filters by `(n02_operator, n02_line)`; its
existing `reason` column records the review reason. `shared_track_evidence` may
set `n02Operator`; otherwise it uses the immediate consumer service's effective
source, including for nested recipes. Every primitive in one compose leg must
resolve to that same source operator, so split a composed leg if its source
changes.

Operator selection is exact at every stop and track leg. It never falls back to
another operator when a source has no candidates. This supports boundary cases
such as JR/Metro 綾瀬 platforms and differently named operator platforms at
後楽園・春日 or 浜松町・大門 without proximity-only joins. Extended prefecture
scope still requires a complete, independently reviewed `scope.csv` and the
hash-pinned expected catalogue; allowing a prefecture does not automatically
add stations to the product.
