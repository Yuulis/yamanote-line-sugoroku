# Game data pipeline (JR Yamanote Line)

`public/data/*` is generated from MLIT National Land Numerical Information
railway data (N02) plus the hand-maintained tables in `data/overrides/`.
The build is deterministic: the same inputs give byte-identical outputs.

## Source

| Item | Value |
|------|-------|
| Dataset | 国土数値情報（鉄道データ） N02, 2025年度版 (`N02-25`) |
| Base date | 2025-12-31 |
| Download page | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html |
| File | `N02-25_GML.zip` (全国, 世界測地系, ~14 MB) |
| CRS | JGD2011 geographic (EPSG:6668); outputs are WGS84 lon/lat (EPSG:4326) |
| License | CC BY 4.0 |
| Attribution | 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成 |

The raw data is gitignored. Only the metadata (`N02-25_GML/KS-META-N02-25.xml`,
`N02-25_GML/KsjAppSchema-N02-v3_1.xsd`) is tracked as provenance.

## Placing the raw data

1. Download `N02-25_GML.zip` from the page above (全国).
2. Extract it so that these files exist (the zip also contains Shift-JIS and
   shapefile variants; only the UTF-8 GeoJSON files are read):

   ```
   N02-25_GML/UTF-8/N02-25_Station.geojson
   N02-25_GML/UTF-8/N02-25_RailroadSection.geojson
   ```

## Regenerate and validate

```bash
uv sync                                          # Python >= 3.11, deps pinned in uv.lock
uv run python -m scripts.data_pipeline.build     # writes public/data/*
uv run python -m scripts.data_pipeline.validate  # spec §5.2 checks, exit 1 on failure
uv run pytest -q                                 # unit + validation tests
```

`build` options: `--raw-dir`, `--overrides-dir`, `--out-dir`, `--quiet`.
`validate` options: `--data-dir`, `--overrides-dir`. `validate` and most tests
need only the committed JSON, not the raw download; `tests/data_pipeline/test_build.py`
(byte-for-byte rebuild check) is skipped when the raw data is absent.

Reproducibility check:

```bash
uv run python -m scripts.data_pipeline.build --quiet && sha256sum public/data/* > /tmp/a
uv run python -m scripts.data_pipeline.build --quiet && sha256sum public/data/* > /tmp/b
diff /tmp/a /tmp/b   # no output
```

## Overrides (`data/overrides/`)

| File | Purpose |
|------|---------|
| `yamanote_stations.csv` | The fixed outer-loop (外回り) order `S[0..29]` starting at 新橋, the stable app id (kebab-case romaji) and the JR East station number (`JY29` ... `JY30`). The loader rejects the table unless the JY numbers descend cyclically, which is the official outer-loop direction. |
| `yamanote_line_mapping.csv` | Which N02 line (`N02_003`) carries each run of segments. N02 names the *physical* line, not the service: 山手線 only covers 品川–新宿–田端. |
| `service.json` | Service metadata (`jr-yamanote`, name, operator, color), the N02 operator name to filter on, and `updatedAt` (`YYYY-MM-DD`, copied to `manifest.updatedAt`). Bump `updatedAt` whenever you regenerate the data; it is not part of the `dataVersion` hash, so the build stays byte-reproducible. |

Station order is never inferred from geometry; geometry is only used to choose
the platform feature and to trace the track between two adjacent stations.

## Method (summary)

1. Platforms: N02 stations are platform LineStrings. Candidates for a station are
   JR East features with the same name on the N02 line(s) of its two adjacent
   segments. A candidate's point is the midpoint along the platform
   (`interpolate(0.5, normalized=True)` in EPSG:6677 metres).
2. Track network: JR East sections of each mapped N02 line within 2 km of the
   candidates form an undirected graph (nodes = section endpoints rounded to 1 cm).
3. Routing: one candidate per station is chosen so that the closed loop of shortest
   track paths is shortest (dynamic programming over the cycle). This keeps every
   station on the through track the Yamanote Line uses.
4. Output: each path is simplified (Douglas-Peucker, 1 m), converted to WGS84,
   rounded to 6 decimals and oriented `from -> to`. `manifest.dataVersion` is a
   hash of the other files, so no timestamp is needed.

Details and measured results: `.claude/docs/research/m0-data-spike.md`.
