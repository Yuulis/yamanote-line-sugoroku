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
uv run python -m scripts.data_pipeline.build --quiet
sha256sum public/data/* > /tmp/jrx-first.sha256
uv run python -m scripts.data_pipeline.build --quiet
sha256sum public/data/* > /tmp/jrx-second.sha256
diff /tmp/jrx-first.sha256 /tmp/jrx-second.sha256
```

## Reviewed overrides

| Path | Purpose |
|---|---|
| `dataset.json` | Operator, update date, target/start, ordered service catalogue, reviewed disconnected services |
| `stations.csv` | Stable shared id, display/N02 spelling, ward, representative service |
| `services.json` | Metadata, direction labels, endpoint kinds, stop counts, length references in lottery order |
| `services/<id>/stops.csv` | Reviewed in-area stop order, station number, optional N02 platform selector |
| `services/<id>/line_mapping.csv` | Physical N02 line per contiguous run, optional ordered via hints |
| `services/<id>/sections.csv` | Optional reviewed track-section allow/deny constraints |
| `offset_exceptions.csv` | Reviewed large platform offsets, currently Tokyo on Keiyo |

The five services are Yamanote, Keihin-Tohoku (Akabane–Kamata), Chuo-Sobu local
(Nishi-Ogikubo–Koiwa), Saikyo (Osaki–Ukima-Funado), and Keiyo
(Tokyo–Kasai-Rinkai-Koen). Every non-loop stop list ends at the last in-scope stop;
real termini are distinguished from area boundaries. The reviewed catalogue
excludes Joban local, Joban rapid, Yokosuka/Sobu rapid, and other rapid/through services.

## Routing and schema v2

1. Match each curated station to JR East N02 platform features on its adjacent
   physical lines, inside the Tokyo bounding box; selectors resolve ambiguities.
   Matching uses explicit registry identity and N02 spelling, including ケ/ヶ.
2. Build constrained track graphs from sections within 2 km of candidates.
   Platform/via snapping beyond 30 m is rejected before optimization. Graph cache
   keys include constraints; shortest-path ties are deterministic.
3. Choose a minimum-cost cycle for Yamanote or an open-chain path for linear services.
   A station's representative point comes from its reviewed representative service;
   each service retains its own chosen platform coordinates. N02 sometimes shares
   geometry between parallel services and does not distinguish every physical track.
4. Emit `stations.json`, `services.json`, `segments.json`, `segments.geojson`, then
   `manifest.json` (`schemaVersion: 2`). Coordinates are rounded to six decimals;
   paths are simplified by 1 m. `dataVersion` hashes the four game files in filename
   order. `updatedAt` records the refresh date without changing the content hash.

A directed segment id is `<service>:<from>:<to>`. Linear services have both directions;
Yamanote has outer only. Both directions reference one canonical geometry id
`<service>:<forward-from>~<forward-to>` with `{featureId, serviceId, from, to}`.
Animation orients by those station identities rather than by coordinate distance.
Services include `directionLabels`, `platformCoordinates`, and (if linear)
`endpoints.first/last` (`terminus` or `area-boundary`).

The validator checks the strict five-file schema, registry/wards/catalogue,
metadata/stop order, pair coverage and walks, platforms/representatives and reviewed
offsets, unique shared features, endpoint orientation, same-service skipped stops,
detours/via hints, service lengths, connectivity, start-not-endpoint, deterministic
bytes/content hash and the 300,000-byte GeoJSON limit. Other services' stations
near a path are diagnostic only: Saikyo legitimately passes Yamanote-only stops.

At the 2026-10-12 refresh: geometry 41,176 B; maximum endpoint offset 24.507 m
(Saikyo at Ikebukuro); Tokyo/Keiyo platform offset 386.0 m, within its reviewed
500 m exception. Service lengths: Yamanote 34.453 km, Keihin-Tohoku 27.495 km,
Chuo-Sobu local 30.697 km, Saikyo 21.979 km, Keiyo 10.532 km.
