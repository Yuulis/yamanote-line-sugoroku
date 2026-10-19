# Combined JR suburban staging dataset

This stage combines the four region-owned service edits over the shipped JR East overrides. Each assigned service is sourced from exactly one region; shared station records and the frozen catalogue are checked during assembly.

## Regional evidence

- `tohoku`: 10 assigned services, 131 pair-evidence rows, 10 length references; run `s2gate tohoku 2>&1 | tee .claude/logs/s2/tohoku-verification.log` to verify (tests, deterministic A/B, validate, preservation audit); verification log: `.claude/logs/s2/tohoku-verification.log`.
- `takasaki`: 7 assigned services, 68 pair-evidence rows, 7 length references; run `s2gate takasaki 2>&1 | tee .claude/logs/s2/takasaki-verification.log` to verify (tests, deterministic A/B, validate, preservation audit); verification log: `.claude/logs/s2/takasaki-verification.log`.
- `chuo`: 6 assigned services, 90 pair-evidence rows, 6 length references; run `s2gate chuo 2>&1 | tee .claude/logs/s2/chuo-verification.log` to verify (tests, deterministic A/B, validate, preservation audit); verification log: `.claude/logs/s2/chuo-verification.log`.
- `tokaido`: 2 assigned services, 6 pair-evidence rows, 2 length references; run `s2gate tokaido 2>&1 | tee .claude/logs/s2/tokaido-verification.log` to verify (tests, deterministic A/B, validate, preservation audit); verification log: `.claude/logs/s2/tokaido-verification.log`.

`pair-evidence.csv` retains reviewed raw N02 pair measurements and `length-refs.csv` retains source mileage references.

## Dataset-level exception additions

- `detour_exceptions.csv`: 1 added row(s) — `jr-karasuyama/taki/karasuyama`
- `offset_exceptions.csv`: 0 added row(s).
- `platform_transfers.csv`: 0 added row(s).

Assembly keeps every live row byte-for-value, rejects a deleted or modified live row, and unions new rows by each file's natural key. Identical additions from multiple regions are retained once; conflicting values for one key stop assembly.

## S5 merge procedure

Start from the current live overrides, merge the reviewed combined `overrides/` contents with the S3/S4 decisions, and restore the approved gameplay settings. Run the full build and validation from those merged overrides to create a fresh product bundle. Do not publish this stage build or relabel its manifest.
