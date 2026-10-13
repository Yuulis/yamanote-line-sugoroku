# JR East Tokyo 23-ward game data pipeline

`public/data/*` is generated deterministically from MLIT N02 2025 and reviewed
`data/overrides` tables. The current five-service catalogue has 67 shared stations,
22 transfer stations, 146 directed gameplay segments and 88 geometry features.
The source dataset and service scope are fixed; there is no live timetable lookup.

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
Validation options: `--data-dir`, `--overrides-dir`. Artifact validation and synthetic
routing tests run in CI without raw N02. The existing raw-data build test module is
skipped only when the raw download is absent; locally it checks pinned inputs and
byte-for-byte equality with the committed output.

```bash
# Keep the reviewed public/data candidate unchanged while checking both rebuilds.
uv run python -m scripts.data_pipeline.build --quiet --out-dir /tmp/jrcr-s2-first
uv run python -m scripts.data_pipeline.build --quiet --out-dir /tmp/jrcr-s2-second
diff -r public/data /tmp/jrcr-s2-first
diff -r public/data /tmp/jrcr-s2-second
diff -r /tmp/jrcr-s2-first /tmp/jrcr-s2-second
```

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

The five services are Yamanote, Keihin-Tohoku (Akabane–Kamata), Chuo-Sobu local
(Nishi-Ogikubo–Koiwa), Saikyo (Osaki–Ukima-Funado), and Keiyo
(Tokyo–Kasai-Rinkai-Koen). Every non-loop stop list ends at the last in-scope stop;
real termini are distinguished from area boundaries. The reviewed catalogue
excludes Joban local, Joban rapid, Yokosuka/Sobu rapid, and other rapid/through services.

### Regional preparation (S3a; shipped catalogue remains 5 services / 67 stations)

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
The candidate box must enclose the output box. The shipped dataset explicitly
restricts membership to Tokyo's 23 municipalities while using the wider regional
search/output bounds. Artifact coordinates and route/via points use their dataset's
configured bounds. No regional playable rows have been added.

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
segments carry the reversed list. The current five services use one-element chains:
`<service>:<forward-from>~<forward-to>`. Features are service-owned primitives with
`{featureId, serviceId, lineId, from, to}`; future rapid/through consumers may compose
primitives from multiple owners without changing ownership or gameplay progress.
Animation orients each primitive by station identity, concatenates exact joints once,
and follows the complete chain rather than jumping between the consumer's stops.
`services.json` is the `{ lines, services }` envelope. Lines have `id/name/color`;
services require `kind` (`local | rapid`) and non-empty `lineIds`, plus
`directionLabels`, `platformCoordinates`, and (if linear) `endpoints.first/last`
(`terminus`, `area-boundary`, or `service-boundary`, displayed as 「系統の端」).
Legacy v2 bundles are rejected by the runtime guards. `segments.json` is compact,
with one object per line. IDs, stop order and all-equal gameplay remain unchanged.

The validator checks the strict five-file schema, registry/area/catalogue,
metadata/stop order, pair coverage and walks, platforms/representatives and reviewed
offsets, unique owned features and valid owner pairs, non-empty/known/ordered travel chains,
reversed reverse-hop chains, exact joints, no backtracking/orphans, endpoint orientation,
same-service skipped stops,
detours/via hints, service lengths, connectivity, start-not-endpoint, deterministic
bytes/content hash and the 300,000-byte GeoJSON limit. Other services' stations
near a path are diagnostic only: Saikyo legitimately passes Yamanote-only stops.

At the 2026-10-12 refresh: v3 geometry 43,433 B; maximum endpoint offset 24.507 m
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
are conservative configuration defaults. S6P must measure and review them.

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
