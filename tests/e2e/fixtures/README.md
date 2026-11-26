# Save fixture provenance

Product scenarios use `DEFAULT_GAME_CONFIG` (`ITEM_GAME_CONFIG`,
`tokyo-suburban-items-2`) and the real engine. `productGame.ts` never stages a
beneficial ticket, declines roll adjustment, and discards the incoming ticket
on overflow. Harmful effects and passive certificates remain fully active.
Browser `rollOnce` follows the same explicit choices; item-specific specs test
other choices separately. Saves contain real item records and both RNG streams.

`seeds.ts` pins ascending 128-bit hexadecimal searches, verified in
`tests/unit/e2e-fixture-seeds.test.ts` and `real-data-e2e-scenarios.test.ts`:

- Small bundle: first seed with roll 4 transferring to fixture-south; rolls 3
  hitting the area boundary and terminus on turns 2/3; a direction-only reverse
  draw at fixture-oimachi on turn 5; completion within 100 turns: `5ff`, turn 14.
- Real bundle: hub `09`; both directions of the composed rapid hop with an
  arrival transfer within 250 turns `00` (turns 32/80); cross-operator
  Korakuen transfer `0f` (turn 112); Ueno on Joban Rapid `0f` (within 5,000 turns).
- Completed history uses `00`, turn 83. The Oedo grouped-candidate arrival uses
  `07`, turn 366 (first matching seed scanning up to 5,000 turns per seed).

The three current `tokyo-suburban-*-save.json` files were regenerated on
2026-11-26 at turns 82, 111, 365. `item-saves.provenance.json` records seed,
turn, ruleset/data versions, the SHA-256 of every bundle file and saved file.
The script also regenerates `tests/unit/fixtures/edition-save-compatibility.json`
from the before-clear save and its next production turn, plus
`tests/unit/fixtures/current-product-records.json` from the pinned Korakuen and
composed-hop scenarios.

Regenerate from the repository root:

```bash
node --input-type=module <<'JS'
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true } });
try { await server.ssrLoadModule('/tests/e2e/fixtures/regenerate-saves.ts'); }
finally { await server.close(); }
JS
```

`old-capital-region-save.json` and its provenance are immutable historical v3
fixtures: they fail with `UNSUPPORTED_SAVE_VERSION`, even on their source data.
`historical-classic-before-clear-save.json` preserves the exact pre-S11 v4
classic fixture bytes: it fails with `DATA_VERSION_MISMATCH` against the live
product bundle. With a test-only network view using the fixture's historical
data version, it yields `RULES_VERSION_MISMATCH`; v4 rejection happens before
the saved history or its seeded turn-41 trajectory is replayed.
Neither historical fixture is a regeneration target. Rejection must preserve
storage bytes across reloads until the player explicitly discards them.
