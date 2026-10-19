# toei-yokohama non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`.

## Evidence and verification

- Primary-source operating mileage and arithmetic are recorded in `length-refs.csv` and `length-ref-components.csv`. The Oedo loop is `40.7 km total − 12.1 km radial = 28.6 km loop`; its measured N02 pair sum is 28.560 km.
- Pair measurement covers 143/143 pairs. Gate A/B builds and audit pass; outputs are under `.claude/logs/s3/toei-yokohama/`.
- The loop closing pair 新宿→都庁前 is included. The separate radial service starts 都庁前→西新宿五丁目.
- Yokohama Blue Line 関内 uses code `004691` for the stop on the continuing 1号線 side. The adjacent pair mappings use 1号線 into 関内 and 3号線 out; the 3号線 route uses same-group code `004692` as its anchor. Raw N02 records show both codes in group `004691` at the same coordinate.
- 蔵前 uses 大江戸線 code `003571`; the Asakusa Line platform is code `003583`. Their representative-point offset measures 291.286 m. The reviewed per-row limit is 310 m, calculated as the 291.286 m offset rounded up to 10 m plus 10 m, with the official station page as context: https://www.kotsu.metro.tokyo.jp/subway/stations/kuramae.html

## Shared station municipality evidence

The Toei station ID `toei-shinjuku` has one registry municipality, 新宿区, taken from its representative service `toei-shinjuku` in the frozen catalog. The `toei-oedo-loop` frozen catalog row for the same ID records the platform-level municipality as 渋谷区 (station name 新宿, service `toei-oedo-loop`, order 27). Its `scope.csv` row uses the registry municipality, as required for a shared within-operator station. 東京都交通局's official 新宿 station page identifies the Oedo Line address as 渋谷区 代々木2-1-1 and the Shinjuku Line address separately as 新宿区 西新宿1-18先: https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html
