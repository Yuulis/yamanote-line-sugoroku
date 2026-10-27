# Station-item system: Monte Carlo spike (2026-10-27)

Question: can a random-drop station-item system keep game length acceptable
(target: median 40-80, p99 < 400 turns) **without** the current lottery weighting
(Yamanote 2/3 at its stations, 2:1 toward Yamanote on other services)?

Code: `tests/simulation/item-spike/` (throwaway; nothing under `src/`,
`public/data/`, existing tests, saves or rulesets was touched). Raw shards:
`.claude/logs/item-spike/shards/*.json` (git-ignored), merged table
`.claude/logs/item-spike/shards/table.md`.

## TL;DR

- **Items cannot replace the weighting on this network.** With uniform
  lotteries the best item setting (p 0.30, no harm, greedy bot) is still
  median 245 / p99 1,695 turns, and 23% of games exceed 500. Uniform with no
  items is median 1,626 / p99 5,049. The 1,700-station suburban graph pulls the
  player away from Yamanote; items act only at the margin.
- **Items do shorten games substantially once mild weighting is present**, but
  only when they are used purposefully: under (b) mild the greedy bot goes from
  173 / 667 (no items) to 64 / 290 (p 0.30, 30% harmful), while a random user
  gets 195 / 774, i.e. slightly worse than no items.
- **Recommendation:** (b) mild weighting (Yamanote 1/2, toward-Yamanote 3:2),
  drop p = 0.30, harmful share 30% → greedy median 64 / p90 158 / p99 290 /
  max 568, 0.02% > 500. If the game must also stay within target for players
  who use items carelessly, use **mid** (Yamanote 1/2, direction 2:1) at the
  same p and harm: greedy 60 / 132 / 234, random user 161 / 361 / 578.
  Only (c) current at p 0.20 / 30% meets the target for both policies
  (greedy 36 / 89 / 163, random 66 / 176 / 320), at the cost of keeping the
  weighting the user wants to soften.

## Key rows (5,000 games each; turns)

| weighting | p | harm | policy | median | p90 | p99 | max | >500 | used/g | decision turns/g | Yamanote turns |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) uniform | — | — | — | 1626 | 3156 | 5049 | 7937 | 93.8% | 0 | 0 | 1.6% |
| (a) uniform | 0.30 | 30% | greedy | 337 | 972 | 1780 | 2975 | 32.9% | 31.3 | 391 | 3.6% |
| (b) mild | — | — | — | 173 | 394 | 667 | 1145 | 4.3% | 0 | 0 | 12.3% |
| (b) mild | 0.20 | 30% | greedy | 82 | 193 | 349 | 783 | 0.08% | 11.5 | 50.9 | 18.8% |
| **(b) mild** | **0.30** | **30%** | **greedy** | **64** | **158** | **290** | **568** | **0.02%** | **12.7** | **48.6** | **21.6%** |
| (b) mild | 0.30 | 30% | random | 195 | 457 | 774 | 1204 | 7.3% | 47.8 | 46.4 | 10.7% |
| mid (1/2, 2:1) | 0.30 | 30% | greedy | 60 | 132 | 234 | 443 | 0.00% | 11.8 | 41.1 | 24.7% |
| mid (1/2, 2:1) | 0.30 | 30% | random | 161 | 361 | 578 | 984 | 2.3% | 38.5 | 37.4 | 13.2% |
| (c) current | — | — | — | 55 | 146 | 261 | 446 | 0.00% | 0 | 0 | 26.9% |
| (c) current | 0.20 | 30% | greedy | 36 | 89 | 163 | 301 | 0.00% | 5.1 | 18.3 | 35.5% |
| (c) current | 0.20 | 30% | random | 66 | 176 | 320 | 492 | 0.00% | 11.4 | 11.2 | 23.2% |

The (c) no-item baseline equals S7 exactly (55 / 146 / 261 / max 446), which
confirms the re-implemented landing lottery matches the engine.

## Findings

1. **Weighting dominates; items modulate.** At p 0.30 / 30% harm (greedy):
   uniform 337, direction-only 208, share-only 78, mild 64, mid 60, current 31
   (medians). The Yamanote share at its stations is the stronger half of the
   weighting (share-only no-item median 275 vs direction-only 858), but each
   half alone leaves p99 above 600 even with items; both are needed.
2. **Drop rate.** Under mild, raising p from 0.10 to 0.30 (30% harm) moves the
   median 112 → 82 → 64 and p99 436 → 349 → 290. Returns diminish because the
   greedy bot uses about 12 items per game regardless; at p 0.30 the extra
   pickups mostly go to harmful events and full-inventory discards.
3. **Harmful share.** Under mild at p 0.30, harmful 0 / 30 / 50% gives
   median 46 / 64 / 85 and p99 231 / 290 / 339: each harmful step costs about
   20 median and 50 p99 turns. At 30% a mild game sees about 2.3 delays, 2.3 suspensions and
   2.3 detours (≈7 chaos events per game) next to ≈12.7 player item uses.
4. **Skill gap is the main risk.** Items help only when used toward Yamanote.
   The random user is *slower* than no items under mild (195 vs 173 median)
   and mid (161 vs 137): random route tickets and doubles spent off Yamanote
   cost more than they gain (its Yamanote turn share falls below the no-item
   baseline, 10.7% vs 12.3% under mild). A real player sits between the two policies;
   UI guidance (e.g. marking which ticket boards Yamanote, showing the hop
   distance to Yamanote per direction) narrows the gap.
5. **Agency.** Under mild/mid with p 0.20-0.30 the player holds a usable item
   on about 40-50 turns of a 60-80 turn game and actually uses 10-13 items.
   Under (c) current the game is so short that items are used only ≈5 times.
6. **Uniform is not rescued by more items.** The greedy bot's inventory sits
   full (up to 76 discards per game) because route/direction tickets rarely
   have a target worth choosing far from Yamanote; usage saturates at ≈31
   items per game.
7. **No cap hits** in any of the 56 variants (cap 20,000); the longest game
   was 8,387 turns (uniform, random user).

## Full results (5,000 games per variant, seeds s1m-20261012-0..4999)

`>500` is the share of games over 500 turns. Per-game columns are means.
`decision turns/g` = turns on which the player held at least one item usable
that turn. Policies: greedy bot; random = random user.

| variant | weighting | drop | harm% | policy | median | p90 | p99 | max | >500 | cap | pickups/g | used/g | discarded/g | decision turns/g | Yamanote turn share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| uniform-d0-h0-greedy | uniform | 0.00 | 0 | greedy | 1626 | 3156 | 5049 | 7937 | 93.82% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.6% |
| uniform-d100-h0-greedy | uniform | 0.10 | 0 | greedy | 505 | 1199 | 2119 | 3900 | 50.58% | 0 | 61.1 | 30.6 | 29.7 | 494.8 | 2.8% |
| uniform-d100-h30-greedy | uniform | 0.10 | 30 | greedy | 602 | 1317 | 2251 | 3341 | 60.66% | 0 | 70.5 | 29.5 | 19.2 | 523.0 | 2.5% |
| uniform-d100-h50-greedy | uniform | 0.10 | 50 | greedy | 700 | 1460 | 2397 | 3699 | 69.14% | 0 | 80.0 | 27.6 | 11.8 | 534.8 | 2.4% |
| uniform-d200-h0-greedy | uniform | 0.20 | 0 | greedy | 326 | 948 | 1800 | 3239 | 32.52% | 0 | 88.8 | 31.0 | 56.8 | 398.1 | 3.5% |
| uniform-d200-h30-greedy | uniform | 0.20 | 30 | greedy | 430 | 1099 | 1965 | 3780 | 42.58% | 0 | 107.7 | 31.7 | 42.8 | 452.8 | 3.1% |
| uniform-d200-h50-greedy | uniform | 0.20 | 50 | greedy | 511 | 1200 | 2117 | 3949 | 51.46% | 0 | 123.6 | 31.4 | 29.5 | 483.0 | 2.8% |
| uniform-d300-h0-greedy | uniform | 0.30 | 0 | greedy | 245 | 837 | 1695 | 4479 | 23.48% | 0 | 107.4 | 30.1 | 76.3 | 334.1 | 4.2% |
| uniform-d300-h30-greedy | uniform | 0.30 | 30 | greedy | 337 | 972 | 1780 | 2975 | 32.86% | 0 | 133.6 | 31.3 | 61.3 | 391.3 | 3.6% |
| uniform-d300-h50-greedy | uniform | 0.30 | 50 | greedy | 428 | 1096 | 1977 | 3515 | 42.36% | 0 | 160.7 | 32.2 | 47.1 | 443.6 | 3.1% |
| mild-d0-h0-greedy | mild | 0.00 | 0 | greedy | 173 | 394 | 667 | 1145 | 4.26% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 12.3% |
| mild-d100-h0-greedy | mild | 0.10 | 0 | greedy | 91 | 217 | 388 | 725 | 0.18% | 0 | 10.8 | 9.5 | 0.8 | 49.1 | 17.4% |
| mild-d100-h30-greedy | mild | 0.10 | 30 | greedy | 112 | 254 | 436 | 739 | 0.42% | 0 | 12.9 | 8.3 | 0.4 | 47.4 | 15.8% |
| mild-d100-h50-greedy | mild | 0.10 | 50 | greedy | 126 | 292 | 484 | 746 | 0.86% | 0 | 14.7 | 6.9 | 0.2 | 43.5 | 14.8% |
| mild-d200-h0-greedy | mild | 0.20 | 0 | greedy | 60 | 147 | 271 | 525 | 0.02% | 0 | 14.7 | 11.6 | 2.3 | 45.6 | 22.1% |
| mild-d200-h30-greedy | mild | 0.20 | 30 | greedy | 82 | 193 | 349 | 783 | 0.08% | 0 | 19.5 | 11.5 | 1.5 | 50.9 | 18.8% |
| mild-d200-h50-greedy | mild | 0.20 | 50 | greedy | 102 | 235 | 390 | 761 | 0.22% | 0 | 23.7 | 10.5 | 0.9 | 52.4 | 16.7% |
| mild-d300-h0-greedy | mild | 0.30 | 0 | greedy | 46 | 111 | 231 | 426 | 0.00% | 0 | 16.8 | 12.1 | 3.6 | 40.3 | 26.3% |
| mild-d300-h30-greedy | mild | 0.30 | 30 | greedy | 64 | 158 | 290 | 568 | 0.02% | 0 | 23.2 | 12.7 | 2.7 | 48.6 | 21.6% |
| mild-d300-h50-greedy | mild | 0.30 | 50 | greedy | 85 | 196 | 339 | 513 | 0.04% | 0 | 29.8 | 12.5 | 1.7 | 52.9 | 18.8% |
| current-d0-h0-greedy | current | 0.00 | 0 | greedy | 55 | 146 | 261 | 446 | 0.00% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 26.9% |
| current-d100-h0-greedy | current | 0.10 | 0 | greedy | 36 | 96 | 182 | 320 | 0.00% | 0 | 4.5 | 3.9 | 0.1 | 15.5 | 34.2% |
| current-d100-h30-greedy | current | 0.10 | 30 | greedy | 42 | 110 | 205 | 318 | 0.00% | 0 | 5.2 | 3.3 | 0.0 | 14.1 | 31.6% |
| current-d100-h50-greedy | current | 0.10 | 50 | greedy | 47 | 121 | 214 | 352 | 0.00% | 0 | 5.8 | 2.6 | 0.0 | 12.2 | 29.9% |
| current-d200-h0-greedy | current | 0.20 | 0 | greedy | 28 | 70 | 137 | 285 | 0.00% | 0 | 6.8 | 5.4 | 0.5 | 17.6 | 40.7% |
| current-d200-h30-greedy | current | 0.20 | 30 | greedy | 36 | 89 | 163 | 301 | 0.00% | 0 | 8.7 | 5.1 | 0.3 | 18.3 | 35.5% |
| current-d200-h50-greedy | current | 0.20 | 50 | greedy | 43 | 109 | 196 | 385 | 0.00% | 0 | 10.5 | 4.6 | 0.2 | 18.3 | 31.7% |
| current-d300-h0-greedy | current | 0.30 | 0 | greedy | 23 | 56 | 105 | 204 | 0.00% | 0 | 8.3 | 6.0 | 1.1 | 17.1 | 45.9% |
| current-d300-h30-greedy | current | 0.30 | 30 | greedy | 31 | 76 | 143 | 302 | 0.00% | 0 | 11.3 | 6.2 | 0.7 | 19.8 | 38.3% |
| current-d300-h50-greedy | current | 0.30 | 50 | greedy | 40 | 98 | 173 | 348 | 0.00% | 0 | 14.3 | 6.0 | 0.4 | 21.1 | 33.6% |
| uniform-d100-h30-random | uniform | 0.10 | 30 | random | 1584 | 3087 | 4716 | 8387 | 93.70% | 0 | 174.5 | 121.5 | 0.5 | 120.4 | 1.6% |
| uniform-d200-h30-random | uniform | 0.20 | 30 | random | 1549 | 3015 | 4636 | 6251 | 93.10% | 0 | 341.6 | 236.2 | 2.8 | 231.8 | 1.6% |
| uniform-d300-h30-random | uniform | 0.30 | 30 | random | 1502 | 2977 | 4654 | 8050 | 92.82% | 0 | 501.4 | 344.0 | 6.9 | 334.0 | 1.6% |
| uniform-d200-h0-random | uniform | 0.20 | 0 | random | 1482 | 2969 | 4633 | 7927 | 91.90% | 0 | 331.2 | 325.6 | 5.6 | 318.0 | 1.6% |
| mild-d100-h30-random | mild | 0.10 | 30 | random | 181 | 414 | 692 | 1880 | 5.54% | 0 | 21.2 | 14.7 | 0.0 | 14.6 | 11.7% |
| mild-d200-h30-random | mild | 0.20 | 30 | random | 189 | 435 | 713 | 1115 | 5.92% | 0 | 43.8 | 30.5 | 0.0 | 29.9 | 11.2% |
| mild-d300-h30-random | mild | 0.30 | 30 | random | 195 | 457 | 774 | 1204 | 7.34% | 0 | 68.5 | 47.8 | 0.1 | 46.4 | 10.7% |
| mild-d200-h0-random | mild | 0.20 | 0 | random | 179 | 424 | 730 | 1184 | 5.40% | 0 | 42.4 | 42.2 | 0.1 | 41.2 | 11.1% |
| current-d200-h0-random | current | 0.20 | 0 | random | 60 | 160 | 296 | 466 | 0.00% | 0 | 15.1 | 14.9 | 0.0 | 14.5 | 24.0% |
| current-d200-h30-random | current | 0.20 | 30 | random | 66 | 176 | 320 | 492 | 0.00% | 0 | 16.5 | 11.4 | 0.0 | 11.2 | 23.2% |
| direction-only-d0-h0-greedy | direction-only | 0.00 | 0 | greedy | 858 | 1577 | 2441 | 3895 | 82.18% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 3.0% |
| direction-only-d300-h30-greedy | direction-only | 0.30 | 30 | greedy | 208 | 478 | 817 | 1845 | 8.60% | 0 | 74.4 | 29.0 | 22.1 | 198.8 | 6.6% |
| direction-only-d200-h0-greedy | direction-only | 0.20 | 0 | greedy | 212 | 491 | 864 | 1343 | 9.44% | 0 | 50.3 | 28.5 | 20.9 | 205.6 | 6.5% |
| direction-only-d200-h30-greedy | direction-only | 0.20 | 30 | greedy | 271 | 586 | 968 | 1747 | 15.88% | 0 | 62.6 | 28.4 | 14.6 | 230.8 | 5.6% |
| direction-only-d200-h50-greedy | direction-only | 0.20 | 50 | greedy | 330 | 647 | 1009 | 1656 | 21.96% | 0 | 72.8 | 27.1 | 8.5 | 236.3 | 5.1% |
| share-only-d0-h0-greedy | share-only | 0.00 | 0 | greedy | 275 | 768 | 1461 | 3463 | 24.96% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 6.9% |
| share-only-d300-h30-greedy | share-only | 0.30 | 30 | greedy | 78 | 245 | 638 | 1763 | 2.08% | 0 | 34.2 | 14.6 | 8.4 | 82.2 | 14.4% |
| share-only-d200-h0-greedy | share-only | 0.20 | 0 | greedy | 73 | 235 | 604 | 1187 | 1.80% | 0 | 21.6 | 13.6 | 7.2 | 78.0 | 14.8% |
| share-only-d200-h30-greedy | share-only | 0.20 | 30 | greedy | 99 | 314 | 713 | 1702 | 3.08% | 0 | 28.4 | 13.4 | 5.9 | 93.3 | 12.2% |
| share-only-d200-h50-greedy | share-only | 0.20 | 50 | greedy | 129 | 363 | 762 | 1602 | 4.16% | 0 | 34.2 | 12.7 | 3.9 | 99.5 | 11.0% |
| mid-d0-h0-greedy | mid | 0.00 | 0 | greedy | 137 | 309 | 512 | 1091 | 1.22% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 15.4% |
| mid-d200-h30-greedy | mid | 0.20 | 30 | greedy | 75 | 162 | 264 | 554 | 0.02% | 0 | 16.9 | 10.3 | 0.8 | 41.4 | 21.9% |
| mid-d300-h30-greedy | mid | 0.30 | 30 | greedy | 60 | 132 | 234 | 443 | 0.00% | 0 | 20.6 | 11.8 | 1.7 | 41.1 | 24.7% |
| mid-d300-h50-greedy | mid | 0.30 | 50 | greedy | 78 | 164 | 288 | 519 | 0.02% | 0 | 26.2 | 11.4 | 1.0 | 43.9 | 21.7% |
| mid-d200-h30-random | mid | 0.20 | 30 | random | 152 | 340 | 580 | 1007 | 2.20% | 0 | 35.1 | 24.4 | 0.0 | 24.0 | 13.9% |
| mid-d300-h30-random | mid | 0.30 | 30 | random | 161 | 361 | 578 | 984 | 2.32% | 0 | 55.3 | 38.5 | 0.0 | 37.4 | 13.2% |

Per-kind detail (uses and harmful events per game) is in `merged.json`. Example,
(b) mild p 0.30 / 30% greedy: route 3.16, direction 2.97, adjust 3.24, double
3.31 uses; delay 2.32, suspension 2.35, detour 2.31 events; 2.26 forced-1 turns.

Runtime: 56 variants, ≈1.5 CPU-hours on 11 parallel processes (≈20 min wall);
the slowest variant (uniform, no items) took 758 s.

## Engine-change implications

- **Lottery config.** The mild direction weight 3:2 is not expressible today:
  `directionLottery.towardTargetWeight` is an integer against an implicit 1.
  Either extend the schema (e.g. `{ toward: 3, away: 2 }`, a new
  `rulesetVersion`) or choose mid (2:1), which the current schema already
  supports. The Yamanote share 1/2 is `{ kind: "share", numerator: 1,
  denominator: 2 }` today.
- **Candidate filtering.** `landingOptions` must accept per-turn exclusions
  (suspension, detour) without changing the classic ruleset's candidate order
  or draw sequence. The spike shows that with no exclusions the filtered draw
  is identical to the engine's.
- **RNG contract.** Keep the classic stream untouched: put every item draw
  (drop, harmful-or-not, kind, suspended service) on a second serialised sfc32
  state (spike: seeded from `<seed>|items`). Then the items mode keeps the
  classic per-turn order (roll, service draw, direction draw) on the main
  stream, and only the route ticket's direction redraw is an extra main-stream
  draw whose position (pre-roll, before the die) must be written into the
  contract. A delayed turn must state whether it still consumes a die draw
  (the spike consumes it and overrides the face to 1, so the sequence stays
  aligned).
- **Save format.** A new `saveVersion` and `rulesetVersion` (e.g.
  `tokyo-suburban-items-1`); the classic mode keeps `tokyo-suburban-1`. The
  state gains the item `rngState`, inventory (≤3), pending delay turns,
  suspensions (service → last turn), and the detour flag. `MoveRecord` must
  record pickups and every item use with its choice (service, direction,
  adjust delta, doubled flag, forced roll) so that both structural and seeded
  replay in `save.ts` can verify a game. Player choices are inputs, like the
  injected landing choice of `moveByRoll`.
- **Two-phase turn.** The adjust ticket needs roll → choice → move, which
  conflicts with the "turns are atomic" decision (DESIGN 2026-10-12). Because
  the die is a pure function of `rngState`, the engine can expose a
  deterministic `peekRoll(state)` for the UI and still commit atomically with
  `playTurn(state, network, actions)`. No pending state needs saving, and a
  reload shows the same roll (no reroll exploit). Pre-roll items (route,
  direction, double) are just part of `actions`.
- **Move length.** The double ticket produces 2-12 pips. `assertValidRoll`
  (1-6) and `MoveRecord.roll` need a separate "pips" field (roll × multiplier,
  ± adjust); animation and the move preview must handle up to 12 hops.
- **UI.** An inventory, suspension markers on the map, delay countdown and a
  roll-then-adjust step; showing distance-to-Yamanote hints is the cheapest way
  to narrow the skill gap measured above.

## Reproduce

See `tests/simulation/item-spike/README.md`. The smoke (100 games per variant)
is `npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike`;
full shards were produced with `ITEM_SPIKE_GAMES=5000 ITEM_SPIKE_FILTER='^<id>$'
ITEM_SPIKE_OUTPUT=.claude/logs/item-spike/shards/<id>.json` per variant and
merged with `ITEM_SPIKE_MERGE=.claude/logs/item-spike/shards`.

Note: `npm run sim` includes `tests/simulation/**`, so it now also runs this
smoke (about 100 s). Delete `tests/simulation/item-spike/` once the
decision is made, or gate it behind an env var if it is kept.


## Method

- **Network and rules.** Shipped bundle `public/data` loaded through
  `tests/simulation/inputs.ts` `loadShippedBundle`, `MVP_GAME_CONFIG`
  (`tokyo-suburban-1`) for target, start, goal rule
  (`truncate-on-target-service`) and segments. Seeds `s1m-20261012-0..4999`,
  the S7 seed set. 5,000 games per variant (56 variants), turn cap 20,000 (no variant hit it).
- **Engine reuse.** Movement and the goal check are the engine's own
  `advance()` (`src/features/game/engine/movement.ts`); dice are `rollDie`;
  lotteries use `drawWeightedIndex` / `drawIndex`; candidates come from
  `transferOptions` / `movableDirections`; distance-to-Yamanote from
  `targetHopDistances`. Only the landing lottery is re-implemented (≈30 lines)
  so items can remove candidates and weightings can change.
- **Exactness check.** With items off and weighting (c), the spike loop is
  draw-for-draw identical to `engine.playTurn`: every run asserts equal turn
  counts against `runGame` for the first 100 seeds, and the (c) baseline at
  5,000 games reproduces S7 exactly (see table).
- **RNG streams.** The dice and lotteries use the game's main stream (so the
  no-item baseline equals the engine); item drops, item kinds, the suspended
  service and random-user choices use a second stream seeded `<seed>|items`.
  Variants therefore share seeds but diverge as soon as an item changes a
  move (common random numbers only up to the first divergence).
- **Turn order.** pre-roll item use → roll → optional ±1 adjust → ×2 if the
  double ticket was used → `advance` → landing lottery at the arrival station
  → item drop at the arrival station (none on the clearing move).
- **Weightings.** (a) uniform: every candidate service and direction equal.
  (b) mild: Yamanote 1/2 at its stations (others share 1/2 equally), toward
  Yamanote 3:2 (the requested 1.5:1 in integers). (c) current: 2/3 and 2:1.
  Diagnostic extras: (d) direction-only (uniform services, direction 3:2),
  (e) share-only (Yamanote 1/2, uniform directions) and a follow-up "mid"
  (Yamanote 1/2, direction 2:1) added after (b) proved borderline. "Toward" uses the engine
  rule: the direction whose next station has the smaller hop distance to any
  Yamanote station; ties are 1:1.
- **Items.** Drop probability p ∈ {0.10, 0.20, 0.30} per arrival; harmful share
  h ∈ {0, 30, 50}%; beneficial kinds uniform over 4, harmful uniform over 3.
  Inventory cap 3; excess beneficial pickups are discarded. Harmful items apply
  at once and never occupy the inventory.
- **Policies.** *Greedy bot* (full grid): route ticket → board Yamanote when it
  is a candidate and the player is not on it; otherwise switch to the service
  whose better direction gets strictly closer to Yamanote than the current
  heading. Direction ticket → flip on a non-Yamanote service when the other
  direction is strictly closer to Yamanote. Double ticket → whenever riding
  Yamanote. Adjust ticket → after the roll, evaluate face−1/face/face+1 with the
  engine's `advance` and pick the best of: clear (dominant), +1 per newly
  completed Yamanote segment, +10 × probability that the next lottery yields
  Yamanote at the arrival station, −1 per hop of distance to Yamanote; use only
  when strictly better than not adjusting. *Random user* (subset): uses every
  held item at its first applicable turn with uniformly random choices
  (route: any active candidate incl. the current one; direction: either;
  adjust: a random valid ±1; double: immediately).
- **Metrics.** Nearest-rank quantiles (as S7), max, share >500, beneficial +
  harmful pickups per game, items used per game, discarded per game,
  *decision turns* per game (turns on which the player held at least one item
  usable that turn; the agency proxy), and the share of turns ridden on
  Yamanote.

## Modelling simplifications

1. **Route ticket = service only, pre-roll, at the current station.** It
   overrides the already-settled landing for this turn's move; the direction of
   a newly chosen non-Yamanote service is then drawn by the normal direction
   lottery (main stream) unless a direction ticket is also used.
2. **Adjust ticket** is applied to the die face before doubling, and only to a
   valid face (1-6): at 1 only +1, at 6 only −1. It needs a two-phase turn in
   the real engine (roll shown, then a choice, then the move).
3. **Double ticket** doubles the adjusted face (2-12 pips). `advance` accepts
   any pip count; the engine's `assertValidRoll` (1-6) is bypassed because the
   spike calls `advance` directly. Goal truncation on Yamanote still applies.
4. **Delay**: pickup on turn t forces the roll of turn t+3 to 1; no items can
   be used on that turn; two delays landing on the same turn collapse to one.
5. **Suspension**: a uniformly random service among the arrival station's
   candidates (Yamanote included) is excluded from landing lotteries and route
   tickets for the next 5 turns. A rider of the suspended service is forced off
   at the next landing that has another candidate; if every candidate at a
   station is suspended, the suspension is ignored there (the train runs).
   "Turn back" is not modelled.
6. **Detour**: the next landing that offers another active service excludes the
   service just ridden (forced change of service). At single-service stations
   it stays pending; it is also consumed when a suspension already forces a
   service change. Detours do not stack.
7. **Drop timing**: the drop is decided after the landing lottery, so a
   suspension or detour picked up at a station affects the *following*
   landings, never the one that just happened.
8. **Greedy bot is myopic** (one-hop distance heuristic, no look-ahead, uses an
   item as soon as it helps). It is a plausible engaged player, not an optimum;
   a skilled human could be somewhat faster.
9. **Decision turns** counts opportunities, not distinct UI choices; a bot that
   holds three tickets for many turns inflates it (visible under uniform).
10. Only Yamanote segments are kept in the simulated `completedSegmentIds`
    (other segments never affect the goal); results are unchanged by this
    (verified identical on a 50-game smoke before/after).
