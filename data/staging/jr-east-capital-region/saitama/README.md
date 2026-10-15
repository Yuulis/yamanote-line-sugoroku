# S6P Saitama stage

This is a buildable **stage-validation** bundle for the nine services touching
Saitama in the frozen product catalog: 75 distinct stations, 113 service-stop
rows and 104 forward stop pairs. It builds from raw N02 2025 and passes the
stage profile's geometry, scope, catalog, budget and two-way reachability
checks.

The stage starts at `musashi-urawa`, an interior station of both the Saikyo and
Musashino services. `overrides/dataset.json` uses
`validationProfile: "stage"` and `stageStartStationId`; it has no gameplay
`startStationId` or `targetServiceId`. The frozen expected-catalog oracle remains
derived only from the product catalog and is pinned at SHA-256
`09651aec08c4855a81b344fa9ee02059e20cb489df0f14be77e8a259e859dd30`.

Service extents follow the contiguous Saitama runs in the product catalog.
Cross-prefecture neighbors remain in `cross-border-pairs.csv` for the combined
S6 review; they are not added to this stage's stop lists. No area exceptions,
platform transfers, offset exceptions or detour exceptions are configured.
The Tokyo enclaves and runs split by other prefectures are deferred to the
combined S6 dataset.

For measurements, the kept/deferred boundary inventory, routing evidence,
checksums and acceptance output, see the [Saitama stage evidence](../../../../.claude/docs/research/jr-east-capital-region-s6p-saitama.md).
