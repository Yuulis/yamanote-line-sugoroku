# Real-engine Monte Carlo harness (S1M)

The runner builds an engine `RailwayNetwork` from the research CSVs, then calls
`createGame` and `playTurn` for every game/turn. It contains no movement, goal,
lottery or RNG implementation. The default unit suite includes only
`tests/unit/**/*.test.ts`; measurements run only through `npm run sim`.
No additional dependencies are needed.

```bash
# Default smoke: approved research catalog v2, decided policy, 200 games.
npm run sim

# Required large measurements, using the same independent string seed set.
SIM_PRESET=decided SIM_GAMES=20000 SIM_SEED=20261012 SIM_CAP=20000 \
  SIM_OUTPUT=/tmp/jrcr-s1m-decided.json npm run sim
SIM_PRESET=all-equal SIM_GAMES=20000 SIM_SEED=20261012 SIM_CAP=20000 \
  SIM_OUTPUT=/tmp/jrcr-s1m-all-equal.json npm run sim

# Alternative CSV pair (same columns as research v2).
SIM_CATALOG=path/to/catalog.csv SIM_SERVICES=path/to/services.csv npm run sim

# Shipped bundle: uses product guards, manifest dataVersion and product ids.
SIM_BUNDLE=public/data SIM_PRESET=all-equal SIM_GAMES=200 npm run sim
```

| Environment variable | Default / meaning |
|---|---|
| `SIM_PRESET` | `decided`; also `all-equal`, `decided-pass-through` |
| `SIM_GAMES` | `200`; positive safe integer |
| `SIM_SEED` | `20261012`; nonnegative safe integer |
| `SIM_CAP` | `20000`; positive safe integer with room for cap+1 |
| `SIM_CATALOG` | `.claude/docs/research/jr-east-capital-region-catalog-v2.csv` |
| `SIM_SERVICES` | `.claude/docs/research/jr-east-capital-region-services-v2.csv` |
| `SIM_BUNDLE` | Optional directory containing manifest/stations/services/segments JSON; overrides CSV input |
| `SIM_TARGET` | `yamanote` for CSV; `jr-yamanote` for shipped data |
| `SIM_START` | `shimbashi` |
| `SIM_OUTPUT` | Optional JSON output file; parent directory must exist; existing file is replaced |

The verbose reporter prints one JSON summary. `SIM_OUTPUT` saves that same
summary without Vitest's surrounding text. Every summary records both input
hashes (SHA-256 of LF-normalized UTF-8 bytes), full config, sizes, cap counts and
indices, quantiles, mean, max, strict >500 count, played turns and measurement
runtime in seconds. Runtime covers game creation/transitions/statistics, excluding
input loading and the Vitest process startup.

Seed index `i` is `s1m-${baseSeed}-${i}`, starting at zero. All presets use the
same set; the summary includes first/last seeds and SHA-256 over the newline-joined
set with a trailing LF. The engine seeds each game independently. The historical
replica uses a continuous PRNG and float intervals, so comparisons are distributional,
not seed-exact. Quantiles use nearest rank: `ceil(p * games) - 1` on sorted turns.
An unfinished game counts as cap+1 in descriptive statistics, is explicitly
reported as censored, and makes the measurement command fail after saving its summary.

The approved catalog is already in outer-loop order from Shimbashi. The CSV loader
preserves service order, sorts stops by their contiguous zero-based order and
cross-checks them against the services CSV. It synthesizes coordinates/platforms
and geometry ids, adds only +1 segments for the target loop and both directions
for other services. Research `through-split` endpoints map to v3 `service-boundary`
metadata; both stop/discard-pips
semantics are identical. These synthetic fields never enter shipped data.

History is discarded after each real `playTurn` to avoid quadratic history-array
copying. `tests/unit/simulation-harness.test.ts` compares all final state fields
against full-history direct engine runs on the same seeds for every preset and
spies on the actual engine function. This measurement does not cover save/restore,
history growth, map geometry or device performance. The shipped loader follows
product guards; S2's services-envelope cutover must also update its guarded input
extraction. `runSimulation` itself accepts any built `RailwayNetwork` unchanged.
