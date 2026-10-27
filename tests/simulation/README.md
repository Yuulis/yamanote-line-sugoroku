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

## Item ruleset: S7 production-engine measurement

The opt-in `item-engine/item-engine.test.ts` runner calls `createItemGame`,
`beginItemTurn`, `finishItemTurn` and `resolveItemDiscard`. Policy previews use
production movement and option queries; no spike movement, landing or drop code
is used to drive these games. Config is explicitly `ITEM_GAME_CONFIG`; classic
remains explicitly `CLASSIC_GAME_CONFIG` in the existing product runner.

```bash
# Default small run: 20 games per policy. Disabled unless this flag equals 1.
ITEM_ENGINE_SIM=1 npm run sim -- tests/simulation/item-engine
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=5000 npm run sim -- tests/simulation/item-engine

# Optional seed-range shard; offset is a nonnegative safe integer.
ITEM_ENGINE_SIM=1 ITEM_ENGINE_OFFSET=1250 ITEM_ENGINE_GAMES=1250 \
  ITEM_ENGINE_OUTPUT=.claude/logs/item-engine/shard-1250.json \
  npm run sim -- tests/simulation/item-engine

# Existing classic runner restricts output to its historical allowed directories.
SIM_BUNDLE=public/data S5_OFFSET=0 S5_GAMES=5000 \
  S5_OUTPUT=.claude/logs/s6/simulation/a6-classic/sim-0.json \
  npm run sim -- tests/simulation/suburban-product.test.ts
```

Both policies use seeds `s1m-20261012-${offset}..${offset+games-1}` and a
20,000-turn cap. Random policy choices, including discards, use only
`<seed>|policy`. Forced one-option choices consume no policy draw. Greedy
uses the frozen round-3 priority and landing score, including rapid only on or
toward Yamanote; discard ties remove the newest item. Random chooses uniformly
among distinct usable held kinds, then a valid service/direction/adjustment.

`ITEM_ENGINE_OUTPUT` defaults to `.claude/logs/item-engine/run-${offset}-${games}.json`
and must stay under `.claude/logs/item-engine/`. It records config, full seed
list/hash, all five bundle hashes, engine/policy/harness/reference source hashes,
raw turns and per-game counters/errors, nearest-rank quantiles, save samples,
reference traces at the first divergence, and deterministic repeat hashes.
Counters prefixed `consumed:` count active uses; `event:cancelled-by-certificate`
counts passive certificate uses. Beneficial drops are `event:pickup-retained`
plus `event:pickup-pending-discard`; harmful drops are `event:harmful-scheduled`
plus `event:cancelled-by-certificate`. `event:discarded` counts resolved discards.
`oedoOversleepTurns` counts six-hop sleeps on `toei-oedo-loop`.

The first 20 seeds per policy retain complete histories. A revealed roll after
turn 3, the first pending discard (when reached), and the completed game are
serialized and restored through strict v4 seeded replay, deeply compared, and
continued from the restored state. The first 10 seeds per policy are repeated;
all measurement fields other than timing must be identical. A unit test also
compares retained and trimmed histories. Remaining games trim observational
history after each committed turn to bound memory and copying costs.

`reference.ts` is an isolated diagnostic: it creates a git-ignored copy of the
frozen spike with observation hooks, leaving every policy/movement/drop decision
unchanged. It compares greedy turn traces and reproduces the frozen aggregate;
production policies never import that copy. The first divergent turn is saved
for each seed. Oedo oversleep intentionally differs (spike: 2 × station count;
production: six hops); corrected production pip metadata does not change a
movement destination. Any new divergence class requires investigation before
accepting distribution tolerance.

The full, unsharded 5,000-game run enforces the round-3 reference tolerances:
median ≤ max(5, 10%), p90 ≤ max(10, 10%), p99 ≤ max(20, 10%), p99 <400,
strict >500 ≤0.5%, no caps and complete games. Small runs and shards record
provisional verdicts but do not enforce population thresholds. Never average
shard quantiles: concatenate raw turns and recompute nearest-rank statistics.
See `.claude/docs/research/item-system-simulation.md`, Round 4, for the dated
measurement, classic evidence limitation, divergence diagnosis and commands.
