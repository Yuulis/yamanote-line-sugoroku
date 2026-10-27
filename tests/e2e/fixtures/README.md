# Save fixture provenance

The three `tokyo-suburban-*-save.json` files represent current classic saves
inside the v4 envelope. On 2026-10-27 they were regenerated with the production
engine, `CLASSIC_GAME_CONFIG`, the current real bundle, and their original seeds
and turn counts (41, 12 and 15). Every gameplay field and RNG byte is checked
against the previous fixture before writing; only `saveVersion` changes.
The same script regenerates `tests/unit/fixtures/edition-save-compatibility.json`
from the v4 before-clear save and its next production turn.

Regenerate from the repository root:

```bash
node --input-type=module <<'JS'
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true } });
try { await server.ssrLoadModule('/tests/e2e/fixtures/regenerate-saves.ts'); }
finally { await server.close(); }
JS
```

`old-capital-region-save.json` and `old-capital-region-save.provenance.json`
are immutable historical v3 fixtures. They must fail with
`UNSUPPORTED_SAVE_VERSION` even on their original data. The storage bytes remain
intact until an explicit discard. Fixture seeds and gameplay snapshots are
unchanged; `tests/unit/real-data-e2e-scenarios.test.ts` proves current trajectories.
