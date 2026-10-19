# Non-JR suburban staging handoff

This index records the completed S3 non-JR staging inventory. Group overrides remain isolated for S4 assembly.

Inventory: 80 services, 1166 stop rows, 1087 forward pairs, and 2174 directed segments.

The machine-readable inventory, group assignments, audit status, and reviewed geometry exceptions are in `handoff-index.json`.

Rfinal command: `uv run python -m scripts.data_pipeline.stage_suburban_nonjr handoff`.

All group verification records report audited status; their gate report and pair evidence hashes were checked against the files on disk when this index was generated.

## Groups

| Group | Services | Stops | Forward pairs | Audit |
|---|---:|---:|---:|---|
| metro | 10 | 186 | 176 | audited |
| toei-yokohama | 7 | 149 | 143 | audited |
| tobu | 14 | 219 | 205 | audited |
| seibu | 12 | 105 | 93 | audited |
| keisei-hokuso-tx | 10 | 132 | 122 | audited |
| tokyu-mm | 10 | 123 | 113 | audited |
| keio-odakyu | 9 | 146 | 137 | audited |
| keikyu-sotetsu | 8 | 106 | 98 | audited |
