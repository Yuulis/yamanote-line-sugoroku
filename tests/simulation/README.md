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

## Shipped product rules and S7 observations

The generic `SIM_PRESET=decided` harness preset is a legacy comparison preset; it
is not the shipped game configuration. Product gameplay configuration comes
from `MVP_GAME_CONFIG` in `src/features/game/gameConfig.ts`; the manifest carries
bundle identity and presentation metadata. Product configuration can be selected
with `SIM_BUNDLE=public/data SIM_CONFIG=product`. For example, run
a 200-game product smoke with `SIM_BUNDLE=public/data SIM_CONFIG=product
SIM_GAMES=200 npm run sim`. Do not infer the Tokyo suburban 2/3 Yamanote share from the
legacy preset. Product games use ruleset `tokyo-suburban-1` and bundle
`dataVersion` `n02-2025-8a0970069659`.

S7 observed 5,000 seeded product games (`s1m-20261012-0..4999`) with no cap hits:
turns median 55 / p90 146 / p99 261 / mean 69.3858 / max 446; hops median 180 /
p90 475 / p99 848 / mean 226.0216 / max 1,375 (3.2575 hops per turn). Target
service draws with a target candidate were 78,731/117,785 (0.6684; expected
0.6667). Non-target direction draws with unequal target distance chose the
closer direction 112,531/168,691 times (0.6671; expected 0.6667); equal-distance
draws split 24,452/48,904 (0.5000; expected 0.5000). Forced choices and
non-eligible arrivals are excluded from those denominators. There were no
engine errors, invariant violations, unreachable station identities, invalid
transitions, zero-hop playing turns or cap hits. Per-seed turn counts matched
the frozen S6 product shards, and the offset-0 repeat was identical.

The real-bundle observation run uses the `S7_OBSERVE=1` gated runner and four
1,250-game shards plus an offset-0 repeat. Example shard command:

```bash
S7_OBSERVE=1 S7_OFFSET=0 S7_GAMES=1250 \
  S7_OUTPUT=.claude/logs/s7/simulation/observe-0.json \
  npm run sim -- tests/simulation/suburban-observations.test.ts
```

Repeat with offsets `1250`, `2500`, and `3750`, plus offset `0` to
`observe-repeat.json`. Aggregate with:

```bash
uv run python scripts/s7_simulation_report.py \
  --input-dir .claude/logs/s7/simulation \
  --output .claude/logs/s7/simulation/summary.json
```

The observer denominators include only actual service draws with at least two
candidates including Yamanote, and non-target two-direction draws whose next
station distances differ. Equal-distance direction draws are reported separately;
forced choices, target-only arrivals, non-target stations, pass-throughs and
clearing turns are excluded. The runner is `tests/simulation/suburban-observations.ts`; its shard outputs and
the aggregate are written under `.claude/logs/s7/simulation/` (git-ignored). It
compares per-seed turns with the S6 product shards in
`.claude/logs/s6/simulation/s6-fix/`, so those must be present locally. These are descriptive observations over evolving game states; Wilson intervals
and the plan's diagnostic threshold characterize the draws but are not a claim
of independent real-world play. To inspect the saved aggregate, see
`.claude/logs/s7/simulation/summary.json`.
