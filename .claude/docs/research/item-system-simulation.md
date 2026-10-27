# Station-item system: Monte Carlo spike (2026-10-27)

Question: can a random-drop station-item system keep game length acceptable
(target: median 40-80, p99 < 400 turns) **without** the current lottery weighting
(Yamanote 2/3 at its stations, 2:1 toward Yamanote on other services)?

Code: `tests/simulation/item-spike/` (throwaway; nothing under `src/`,
`public/data/`, existing tests, saves or rulesets was touched). Raw shards:
`.claude/logs/item-spike/shards/*.json` (git-ignored), merged table
`.claude/logs/item-spike/shards/table.md`.

**Round 2 (2026-10-27, four new items, mild vs mid)** is appended at the end
of this file: [Round 2](#round-2-2026-10-27-four-new-items-mild-vs-mid).
**Round 3 (2026-10-27, one item per turn + choose-what-to-discard)** follows it:
[Round 3](#round-3-2026-10-27).

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

See `tests/simulation/item-spike/README.md`. The grid is opt-in: without
`ITEM_SPIKE=1` it is skipped, so `npm run sim` does not run it. Round 3 is
the default grid; earlier rounds need `ITEM_SPIKE_ROUND=1` or `2`.

```bash
# Round-1 smoke (100 games per variant)
ITEM_SPIKE=1 ITEM_SPIKE_ROUND=1 \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike

# Round-1 full shards: one run per variant id, then merge
ITEM_SPIKE=1 ITEM_SPIKE_ROUND=1 ITEM_SPIKE_GAMES=5000 ITEM_SPIKE_FILTER='^<id>$' \
  ITEM_SPIKE_OUTPUT=.claude/logs/item-spike/shards/<id>.json \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
ITEM_SPIKE_MERGE=.claude/logs/item-spike/shards \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
```


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

## Round 2 (2026-10-27): four new items, mild vs mid

Question: with four more items, which of (b) mild (Yamanote 1/2, direction
3:2) and mid (Yamanote 1/2, direction 2:1) to use, at which drop rate and
harmful share; and does 回送列車 cut the long tail for a player who uses items
at random (target p99 < 400)?

### TL;DR

- **回送列車 (deadhead) cuts the random-use tail.** At p 0.30 / 30% harmful,
  the random user's p99 drops from 774 → 370 (mild) and 578 → 336 (mid).
  Leave-one-out ablation attributes this to deadhead: without it the new set
  gives 711 (mild) and 551 (mid).
- **Recommendation: (b) mild, drop p = 0.30, harmful 30%, round-2 item set.**
  Greedy 67 / 157 / 285 (median / p90 / p99), random user 112 / 231 / 370. Both
  policies are under p99 400, and mild is the softer of the two weightings.
  Mid at the same setting has more margin (greedy 65 / 143 / 241, random
  104 / 215 / 336; >500: 0.06% vs 0.22%). Choose mid if the random-use margin
  matters more than the lighter weighting.
- **Harmful 50% is too much for random use** (p99 448 mild / 406 mid at
  p 0.30). **p 0.20 is too little for mild** (random p99 446); mid at p 0.20 /
  30% is borderline (387).
- **Greedy players gain almost nothing** from the new set (mild 64 → 67,
  mid 60 → 65 median at p 0.30 / 30%). The new items mainly protect the
  careless player. A random user's median stays above the 40-80 band
  (104-137) in every setting.

### Key rows (5,000 games each; S7 seeds; turns)

| weighting | p | harm | items | policy | median | p90 | p99 | max | >500 |
|---|---|---|---|---|---|---|---|---|---|
| mild | .30 | 30% | old (v1) | greedy | 64 | 158 | 290 | 568 | 0.02% |
| mild | .30 | 30% | old (v1) | random | 195 | 457 | 774 | 1204 | 7.34% |
| **mild** | **.30** | **30%** | **new (v2)** | **greedy** | **67** | **157** | **285** | **478** | **0.00%** |
| **mild** | **.30** | **30%** | **new (v2)** | **random** | **112** | **231** | **370** | **642** | **0.22%** |
| mild | .30 | 30% | v2 − deadhead | random | 182 | 433 | 711 | 1156 | 5.88% |
| mid | .30 | 30% | old (v1) | random | 161 | 361 | 578 | 984 | 2.32% |
| mid | .30 | 30% | new (v2) | greedy | 65 | 143 | 241 | 634 | 0.02% |
| mid | .30 | 30% | new (v2) | random | 104 | 215 | 336 | 650 | 0.06% |
| mid | .30 | 30% | v2 − deadhead | random | 156 | 337 | 551 | 986 | 1.66% |
| mild / mid | .30 | 50% | new (v2) | random | 130 / 120 | 274 / 250 | 448 / 406 | 860 / 670 | 0.64 / 0.18% |
| mild / mid | .20 | 30% | new (v2) | random | 123 / 113 | 271 / 238 | 446 / 387 | 698 / 596 | 0.42 / 0.14% |

The old-item rows were **re-run, not copied**: the v1 code path selects the
same pools and draws, and all seven v1 / baseline shards (including the
(c) current no-item engine check, 55 / 146 / 261 / 446) are field-for-field
identical to round 1.

### Effect of each new item (leave-one-out, mid, p 0.30 / 30%)

| item set | greedy med / p99 | random med / p99 | uses per game (greedy / random) |
|---|---|---|---|
| full v2 | 65 / 241 | 104 / 336 | — |
| − 快速券 rapid | 62 / 228 | 100 / 333 | 1.86 / 3.39 |
| − 回送列車 deadhead | 78 / 290 | 156 / 551 | 1.41 / 3.42 |
| − 遅延証明書 certificate | 60 / 227 | 99 / 332 | 1.65 / 3.00 cancellations |
| − 寝過ごし oversleep | 65 / 234 | 108 / 360 | 1.28 / 1.88 oversleep moves |

The "uses" column comes from the full-v2 row. Removing an item puts its
probability mass back on the other items of the same pool.

- **回送列車 (deadhead)** is the only new item with a large effect: −13
  greedy and −52 random median turns, and −215 random p99.
- **快速券 (rapid)** is slightly *negative* (removing it shortens games by
  3-4 turns). The greedy rule uses it whenever the player is off Yamanote,
  including when heading away. A "use only when heading toward Yamanote" rule
  or UI hint would likely make it positive.
- **遅延証明書 (certificate)** is also slightly negative (−5 median when
  removed). It cancels ≈1.65 harmful events per game (greedy) but takes a
  pool slot from an active item and holds an inventory slot until consumed.
  Its value is protection and feel, not speed.
- **寝過ごし (oversleep)** is roughly neutral (greedy p99 234 vs 241; random
  360 vs 336, within noise). The player is carried to the line end, and that
  is sometimes toward Yamanote. It adds chaos at almost no length cost.
- With 7 beneficial kinds, each old item is drawn less often, so per-kind
  uses fall from ≈3 to ≈1.9 per game (greedy). Total uses per game are
  unchanged (≈12).

### Round-2 modelling simplifications (in addition to round 1)

11. **Pool sizes.** 7 beneficial kinds (route, direction, adjust, double,
    rapid, deadhead, certificate), drawn uniformly. The request said "becomes
    6" and also listed 7; 7 was used. 4 harmful kinds (delay, suspension,
    detour, oversleep), drawn uniformly.
12. **快速券 (rapid):** for this turn's move, pips are spent only on arriving
    at a transfer station (a station with ≥ 2 services); other stations are
    passed for free. The move becomes the engine's `advance` with the
    resulting hop count, so endpoint truncation, segment completion and the
    goal are unchanged. Truncation on Yamanote still clears mid-move. It
    combines with double (face × 2 transfer stations) and adjust. Greedy uses
    it whenever it is off Yamanote, without checking the heading (as
    specified); the random user uses it at once.
13. **回送列車 (deadhead):** used before the roll, it replaces the turn. There
    is no die draw, no landing lottery and no segment completion. The player
    is placed at the nearest Yamanote station (forward BFS over all directed
    segments; ties go to the lowest index in Yamanote's station order), on
    Yamanote outer. The turn counts, and the arrival still rolls for an item
    drop. Greedy: when the hop distance to Yamanote is ≥ 3 and Yamanote
    segments remain. Random user: immediately. It cannot be used on a delay
    or oversleep turn.
14. **遅延証明書 (certificate):** passive, held in the inventory (it counts
    toward the cap of 3). The next harmful pickup is still drawn and counted,
    then cancelled, and the certificate is consumed. It never counts as a
    decision turn.
15. **寝過ごし (oversleep):** the next move (the following turn) ignores the
    roll and carries the player to the end of the ridden service in the
    current direction. On Yamanote it moves 6 pips instead. The die is still
    drawn so the stream stays aligned. No items can be used that turn (the
    player is asleep), and it overrides a delay due on the same turn.
    Segments passed are completed normally; the landing lottery at the end
    runs normally. Pickups do not stack (one pending flag).
16. **Ablations** (`v2-no-<item>`) remove one item from its pool, so the
    remaining items of that pool become more frequent. They measure "this
    item vs. the others", not "this item vs. nothing".

### Round-2 full results

| variant | weighting | drop | harm% | policy | median | p90 | p99 | max | >500 | cap | pickups/g | used/g | discarded/g | decision turns/g | Yamanote turn share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mild-d0-h0-greedy | mild | 0.00 | 0 | greedy | 173 | 394 | 667 | 1145 | 4.26% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 12.3% |
| mild-d300-h30-greedy | mild | 0.30 | 30 | greedy | 64 | 158 | 290 | 568 | 0.02% | 0 | 23.2 | 12.7 | 2.7 | 48.6 | 21.6% |
| current-d0-h0-greedy | current | 0.00 | 0 | greedy | 55 | 146 | 261 | 446 | 0.00% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 26.9% |
| mild-d300-h30-random | mild | 0.30 | 30 | random | 195 | 457 | 774 | 1204 | 7.34% | 0 | 68.5 | 47.8 | 0.1 | 46.4 | 10.7% |
| mid-d0-h0-greedy | mid | 0.00 | 0 | greedy | 137 | 309 | 512 | 1091 | 1.22% | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 15.4% |
| mid-d300-h30-greedy | mid | 0.30 | 30 | greedy | 60 | 132 | 234 | 443 | 0.00% | 0 | 20.6 | 11.8 | 1.7 | 41.1 | 24.7% |
| mid-d300-h30-random | mid | 0.30 | 30 | random | 161 | 361 | 578 | 984 | 2.32% | 0 | 55.3 | 38.5 | 0.0 | 37.4 | 13.2% |
| mild-d200-h30-greedy-v2 | mild | 0.20 | 30 | greedy | 85 | 190 | 327 | 585 | 0.08% | 0 | 19.6 | 11.1 | 1.5 | 44.4 | 20.4% |
| mild-d200-h30-random-v2 | mild | 0.20 | 30 | random | 123 | 271 | 446 | 698 | 0.42% | 0 | 28.3 | 18.9 | 0.4 | 16.4 | 16.6% |
| mild-d200-h50-greedy-v2 | mild | 0.20 | 50 | greedy | 101 | 225 | 381 | 733 | 0.28% | 0 | 23.3 | 10.2 | 0.6 | 42.9 | 18.0% |
| mild-d200-h50-random-v2 | mild | 0.20 | 50 | random | 137 | 305 | 505 | 880 | 1.06% | 0 | 31.5 | 15.5 | 0.0 | 13.3 | 15.2% |
| mild-d300-h30-greedy-v2 | mild | 0.30 | 30 | greedy | 67 | 157 | 285 | 478 | 0.00% | 0 | 23.8 | 12.7 | 2.6 | 44.6 | 23.5% |
| mild-d300-h30-random-v2 | mild | 0.30 | 30 | random | 112 | 231 | 370 | 642 | 0.22% | 0 | 37.4 | 25.1 | 0.5 | 21.5 | 18.2% |
| mild-d300-h50-greedy-v2 | mild | 0.30 | 50 | greedy | 85 | 192 | 319 | 592 | 0.04% | 0 | 29.5 | 12.4 | 1.3 | 45.4 | 20.2% |
| mild-d300-h50-random-v2 | mild | 0.30 | 50 | random | 130 | 274 | 448 | 860 | 0.64% | 0 | 44.1 | 21.7 | 0.1 | 18.5 | 16.3% |
| mid-d200-h30-greedy-v2 | mid | 0.20 | 30 | greedy | 78 | 168 | 281 | 438 | 0.00% | 0 | 17.9 | 10.3 | 1.1 | 39.1 | 22.6% |
| mid-d200-h30-random-v2 | mid | 0.20 | 30 | random | 113 | 238 | 387 | 596 | 0.14% | 0 | 25.3 | 16.9 | 0.3 | 14.7 | 18.6% |
| mid-d200-h50-greedy-v2 | mid | 0.20 | 50 | greedy | 93 | 202 | 332 | 538 | 0.04% | 0 | 21.2 | 9.4 | 0.4 | 36.9 | 20.1% |
| mid-d200-h50-random-v2 | mid | 0.20 | 50 | random | 125 | 269 | 439 | 690 | 0.42% | 0 | 28.4 | 13.9 | 0.0 | 11.9 | 17.1% |
| mid-d300-h30-greedy-v2 | mid | 0.30 | 30 | greedy | 65 | 143 | 241 | 634 | 0.02% | 0 | 22.3 | 12.2 | 2.0 | 40.8 | 25.6% |
| mid-d300-h30-random-v2 | mid | 0.30 | 30 | random | 104 | 215 | 336 | 650 | 0.06% | 0 | 34.8 | 23.3 | 0.5 | 20.0 | 19.8% |
| mid-d300-h50-greedy-v2 | mid | 0.30 | 50 | greedy | 81 | 172 | 291 | 449 | 0.00% | 0 | 27.6 | 11.8 | 0.9 | 41.2 | 22.2% |
| mid-d300-h50-random-v2 | mid | 0.30 | 50 | random | 120 | 250 | 406 | 670 | 0.18% | 0 | 40.2 | 19.8 | 0.1 | 16.9 | 17.9% |
| mild-d300-h30-greedy-v2-no-deadhead | mild | 0.30 | 30 | greedy | 84 | 200 | 371 | 640 | 0.14% | 0 | 30.2 | 16.4 | 3.6 | 55.1 | 18.1% |
| mid-d300-h30-greedy-v2-no-rapid | mid | 0.30 | 30 | greedy | 62 | 131 | 228 | 424 | 0.00% | 0 | 20.8 | 10.7 | 2.4 | 39.7 | 26.8% |
| mid-d300-h30-greedy-v2-no-deadhead | mid | 0.30 | 30 | greedy | 78 | 176 | 290 | 506 | 0.02% | 0 | 27.0 | 15.3 | 2.6 | 46.3 | 20.8% |
| mid-d300-h30-greedy-v2-no-certificate | mid | 0.30 | 30 | greedy | 60 | 130 | 227 | 450 | 0.00% | 0 | 20.5 | 11.4 | 1.6 | 41.2 | 27.2% |
| mid-d300-h30-greedy-v2-no-oversleep | mid | 0.30 | 30 | greedy | 65 | 139 | 234 | 451 | 0.00% | 0 | 22.3 | 12.2 | 2.0 | 41.1 | 25.9% |
| mild-d300-h30-random-v2-no-deadhead | mild | 0.30 | 30 | random | 182 | 433 | 711 | 1156 | 5.88% | 0 | 64.3 | 42.7 | 1.6 | 35.3 | 11.2% |
| mid-d300-h30-random-v2-no-rapid | mid | 0.30 | 30 | random | 100 | 207 | 333 | 509 | 0.02% | 0 | 33.4 | 22.0 | 0.7 | 18.4 | 20.4% |
| mid-d300-h30-random-v2-no-deadhead | mid | 0.30 | 30 | random | 156 | 337 | 551 | 986 | 1.66% | 0 | 52.7 | 35.0 | 1.2 | 29.0 | 13.7% |
| mid-d300-h30-random-v2-no-certificate | mid | 0.30 | 30 | random | 99 | 204 | 332 | 538 | 0.02% | 0 | 33.3 | 23.1 | 0.0 | 22.7 | 20.4% |
| mid-d300-h30-random-v2-no-oversleep | mid | 0.30 | 30 | random | 108 | 218 | 360 | 602 | 0.12% | 0 | 35.7 | 23.9 | 0.5 | 20.6 | 19.9% |

| variant | route | direction | adjust | double | rapid | deadhead | certificate | harmful/g | cancelled/g | oversleep moves/g | forced-1/g |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mild-d0-h0-greedy | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| mild-d300-h30-greedy | 3.16 | 2.97 | 3.24 | 3.31 | 0.00 | 0.00 | 0.00 | 6.98 | 0.00 | 0.00 | 2.26 |
| current-d0-h0-greedy | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| mild-d300-h30-random | 11.93 | 11.85 | 11.95 | 12.02 | 0.00 | 0.00 | 0.00 | 20.57 | 0.00 | 0.00 | 6.74 |
| mid-d0-h0-greedy | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| mid-d300-h30-greedy | 2.93 | 2.70 | 3.04 | 3.10 | 0.00 | 0.00 | 0.00 | 6.20 | 0.00 | 0.00 | 2.00 |
| mid-d300-h30-random | 9.57 | 9.49 | 9.69 | 9.76 | 0.00 | 0.00 | 0.00 | 16.64 | 0.00 | 0.00 | 5.46 |
| mild-d200-h30-greedy-v2 | 1.67 | 1.62 | 1.71 | 1.71 | 1.64 | 1.32 | 1.44 | 5.94 | 1.44 | 1.11 | 1.10 |
| mild-d200-h30-random-v2 | 2.78 | 2.77 | 2.77 | 2.77 | 2.72 | 2.74 | 2.39 | 8.59 | 2.39 | 1.55 | 1.50 |
| mild-d200-h50-greedy-v2 | 1.50 | 1.48 | 1.55 | 1.51 | 1.51 | 1.22 | 1.43 | 11.71 | 1.43 | 2.57 | 2.45 |
| mild-d200-h50-random-v2 | 2.24 | 2.21 | 2.24 | 2.22 | 2.21 | 2.23 | 2.10 | 15.84 | 2.10 | 3.45 | 3.27 |
| mild-d300-h30-greedy-v2 | 1.93 | 1.78 | 1.92 | 1.93 | 1.93 | 1.49 | 1.72 | 7.20 | 1.72 | 1.39 | 1.29 |
| mild-d300-h30-random-v2 | 3.65 | 3.57 | 3.66 | 3.62 | 3.66 | 3.67 | 3.25 | 11.33 | 3.25 | 2.01 | 1.93 |
| mild-d300-h50-greedy-v2 | 1.87 | 1.74 | 1.85 | 1.82 | 1.83 | 1.47 | 1.79 | 14.80 | 1.79 | 3.27 | 3.02 |
| mild-d300-h50-random-v2 | 3.17 | 3.07 | 3.13 | 3.08 | 3.10 | 3.12 | 2.98 | 22.10 | 2.98 | 4.82 | 4.50 |
| mid-d200-h30-greedy-v2 | 1.57 | 1.47 | 1.57 | 1.60 | 1.54 | 1.20 | 1.30 | 5.40 | 1.30 | 1.02 | 0.99 |
| mid-d200-h30-random-v2 | 2.46 | 2.46 | 2.51 | 2.47 | 2.44 | 2.47 | 2.09 | 7.70 | 2.09 | 1.41 | 1.35 |
| mid-d200-h50-greedy-v2 | 1.39 | 1.32 | 1.43 | 1.41 | 1.41 | 1.10 | 1.32 | 10.68 | 1.32 | 2.33 | 2.23 |
| mid-d200-h50-random-v2 | 2.02 | 1.98 | 2.03 | 1.98 | 1.97 | 2.00 | 1.88 | 14.26 | 1.88 | 3.14 | 2.96 |
| mid-d300-h30-greedy-v2 | 1.86 | 1.69 | 1.87 | 1.88 | 1.86 | 1.41 | 1.65 | 6.75 | 1.65 | 1.28 | 1.21 |
| mid-d300-h30-random-v2 | 3.41 | 3.30 | 3.41 | 3.35 | 3.39 | 3.42 | 3.00 | 10.49 | 3.00 | 1.88 | 1.77 |
| mid-d300-h50-greedy-v2 | 1.76 | 1.62 | 1.76 | 1.75 | 1.76 | 1.39 | 1.70 | 13.87 | 1.70 | 3.06 | 2.84 |
| mid-d300-h50-random-v2 | 2.88 | 2.79 | 2.88 | 2.80 | 2.85 | 2.85 | 2.72 | 20.16 | 2.72 | 4.40 | 4.07 |
| mild-d300-h30-greedy-v2-no-deadhead | 2.80 | 2.66 | 2.80 | 2.82 | 2.79 | 0.00 | 2.57 | 9.14 | 2.57 | 1.65 | 1.56 |
| mid-d300-h30-greedy-v2-no-rapid | 1.92 | 1.73 | 1.91 | 1.99 | 0.00 | 1.42 | 1.71 | 6.29 | 1.71 | 1.17 | 1.08 |
| mid-d300-h30-greedy-v2-no-deadhead | 2.63 | 2.42 | 2.58 | 2.66 | 2.61 | 0.00 | 2.38 | 8.14 | 2.38 | 1.45 | 1.38 |
| mid-d300-h30-greedy-v2-no-certificate | 2.01 | 1.80 | 1.98 | 2.05 | 2.02 | 1.53 | 0.00 | 6.24 | 0.00 | 1.56 | 1.47 |
| mid-d300-h30-greedy-v2-no-oversleep | 1.87 | 1.69 | 1.87 | 1.87 | 1.85 | 1.40 | 1.63 | 6.73 | 1.63 | 0.00 | 1.63 |
| mild-d300-h30-random-v2-no-deadhead | 7.23 | 7.14 | 7.15 | 7.24 | 7.22 | 0.00 | 6.74 | 19.33 | 6.74 | 3.15 | 3.04 |
| mid-d300-h30-random-v2-no-rapid | 3.79 | 3.72 | 3.70 | 3.74 | 0.00 | 3.76 | 3.34 | 10.06 | 3.34 | 1.69 | 1.62 |
| mid-d300-h30-random-v2-no-deadhead | 5.94 | 5.85 | 5.86 | 5.92 | 5.95 | 0.00 | 5.46 | 15.87 | 5.46 | 2.62 | 2.50 |
| mid-d300-h30-random-v2-no-certificate | 3.88 | 3.81 | 3.83 | 3.86 | 3.82 | 3.95 | 0.00 | 10.07 | 0.00 | 2.51 | 2.43 |
| mid-d300-h30-random-v2-no-oversleep | 3.51 | 3.42 | 3.51 | 3.43 | 3.47 | 3.50 | 3.07 | 10.74 | 3.07 | 0.00 | 2.50 |

### Reproduce round 2

```bash
# Smoke (100 games per round-2 variant, plus engine-equivalence and movement checks)
ITEM_SPIKE=1 ITEM_SPIKE_ROUND=2 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike

# Full: one 5,000-game shard per variant id (33 ids), then merge
ITEM_SPIKE=1 ITEM_SPIKE_ROUND=2 ITEM_SPIKE_GAMES=5000 ITEM_SPIKE_FILTER='^<id>$' \
  ITEM_SPIKE_OUTPUT=.claude/logs/item-spike/round2/<id>.json \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
ITEM_SPIKE_MERGE=.claude/logs/item-spike/round2 \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
```

Runtime: 33 variants in 5 min 41 s wall on 11 parallel processes (≈57 CPU-min).
Shards: `.claude/logs/item-spike/round2/` (git-ignored).

## Round 3 (2026-10-27)

Question: does the chosen ruleset (mild: Yamanote 1/2, direction 3:2; drop
p 0.30; harmful 30%; round-2 item set; cap 3) still meet median 40-80
(greedy) and p99 < 400 (greedy and random use) under two new rules?

- **Rule 1:** at most one active item per turn. 出目調整券 (roll adjust)
  counts as that item; 回送列車 (deadhead) stays exclusive; 遅延証明書
  (certificate) stays passive.
- **Rule 2:** with a full inventory, a beneficial pickup makes the player
  discard one of the four items, instead of the new one being thrown away.

### TL;DR

- **Yes.** With both rules, greedy gives **65 / 143 / 241** (median / p90 /
  p99) and random use gives **113 / 232 / 370**. Over 500 turns: 0% and 0.12%.
- **Rule 1 costs almost nothing.** Without the rule, a player used more than
  one active item on only ≈0.37 turns per game (greedy) or ≈0.30 (random).
- **Rule 2 helps the greedy tail** (p99 291 → 248) because the bot keeps
  回送列車 and 路線指定券 instead of losing them to a full inventory.
- **The random p99 margin is small.** Random-use p99 has ≈±25 turns of
  sampling noise at 5,000 games. Evidence: round 2 and the round-3
  "neither rule" row differ only in which RNG stream drives the random
  choices, and their p99s are 370 and 395. If more margin is wanted, p 0.35
  (358) and p 0.40 (344) keep greedy in range (61 and 56) and add margin;
  mid at p 0.30 gives 343.
- **Drop rule confirmed in code:** a drop is decided only at the turn's final
  stop (after the landing lottery). There is no drop on the clearing move
  (the loop exits before the drop). The deadhead arrival station does roll
  for a drop.

### Key rows (5,000 games each; S7 seeds; turns)

| ruleset (all v2 items, harmful 30%) | greedy med / p90 / p99 / max | random med / p90 / p99 / max | >500 (g / r) |
|---|---|---|---|
| **mild p.30, both rules (chosen)** | **65 / 143 / 241 / 433** | **113 / 232 / 370 / 565** | **0% / 0.12%** |
| mild p.30, rule 1 only | 67 / 153 / 295 / 542 | 114 / 233 / 385 / 611 | 0.04% / 0.18% |
| mild p.30, rule 2 only | 64 / 144 / 248 / 553 | 111 / 233 / 377 / 581 | 0.02% / 0.14% |
| mild p.30, neither (round-3 policies) | 67 / 154 / 291 / 513 | 113 / 234 / 395 / 581 | 0.04% / 0.22% |
| mild p.30, round 2 (reference) | 67 / 157 / 285 / 478 | 112 / 231 / 370 / 642 | 0% / 0.22% |
| mild p.35, both rules | 61 / 134 / 248 / 707 | 106 / 225 / 358 / 656 | 0.02% / 0.08% |
| mild p.40, both rules | 56 / 127 / 243 / 482 | 103 / 217 / 344 / 605 | 0% / 0.06% |
| mid p.30, both rules (fallback) | 62 / 135 / 224 / 357 | 106 / 218 / 343 / 563 | 0% / 0.06% |

The round-2 rows were re-run with `ITEM_SPIKE_ROUND=2` and are field-for-field
identical to the round-2 shards, so the round-3 changes do not alter earlier
code paths.

### Greedy policy used in round 3

**Single-item choice (rule 1)**, checked in this order before the roll. The
first match is the turn's one item.

1. 回送列車 (deadhead): hop distance to Yamanote ≥ 3 and Yamanote segments
   remain (replaces the move).
2. 路線指定券 (route): Yamanote is an active candidate at this station and the
   player is not riding it; board Yamanote.
3. 方向指定券 (direction): on a non-Yamanote service whose other direction's
   next station is strictly closer to Yamanote; flip.
4. 倍速券 (double): riding Yamanote.
5. 快速券 (rapid): riding Yamanote, or the current heading's next station is
   strictly closer to Yamanote than the current station. This replaces the
   round-2 rule "whenever off Yamanote".
6. 路線指定券 (route), secondary: switch to the candidate service whose better
   direction is strictly closer to Yamanote than the current heading (the
   direction is then drawn by the lottery).
7. Nothing: 出目調整券 (adjust) stays available after the roll and is used only
   when the round-1 landing score improves (clear > new Yamanote segments,
   chance of a Yamanote landing, closeness to Yamanote).

**Discard choice (rule 2):** keep-priority 回送列車 7 > 路線指定券 6 >
方向指定券 5 > 倍速券 4 > 出目調整券 3 > 快速券 2 > 遅延証明書 1. The lowest
is discarded; on a tie, the newest pickup goes. The certificate is always
lowest; no "many harmful items pending" exception was modelled, as asked
("keep it simple").

**Random user:** each turn it picks one usable held kind uniformly at random
and uses it. A chosen deadhead replaces the move; a chosen adjust is applied
after the roll with a random valid ±1. On a full pickup it discards one of
the four uniformly at random.

### Round-3 modelling simplifications (in addition to rounds 1-2)

17. **Rule 1** applies to the pre-roll items and the adjust ticket. The
    certificate never counts. Delay and oversleep turns still allow no items.
    An invariant counter (`multiItemTurns`) is asserted to be 0 in every
    rule-1 row.
18. **Rule 2** applies to beneficial pickups only (harmful items never enter
    the inventory). The discarded item is gone, and a discard still counts in
    `discarded/g`.
19. **RNG streams.** Round-3 variants draw the random user's choices
    (including discards) from a third stream `<seed>|policy`. The item stream
    `<seed>|items` now carries only drops, kinds and the suspended service.
    Rounds 1-2 keep their original stream use, which is why they still
    reproduce.
20. The **rapid rule change (item 5)** applies to every round-3 greedy row,
    including the "neither rule" reference, so the rule rows differ from each
    other only by the rules.
21. The **p 0.35 / 0.40 rows** were run up front rather than conditionally;
    random p99 at p 0.30 is 370, so they are only margin options.

### Round-3 full results

| variant | weighting | drop | harm% | policy | median | p90 | p99 | max | >500 | cap | pickups/g | used/g | discarded/g | decision turns/g | Yamanote turn share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mild-d300-h30-greedy-v2-r3 | mild | 0.30 | 30 | greedy | 65 | 143 | 241 | 433 | 0.00% | 0 | 22.3 | 12.4 | 1.8 | 41.9 | 24.8% |
| mild-d300-h30-greedy-v2-r3-single | mild | 0.30 | 30 | greedy | 67 | 153 | 295 | 542 | 0.04% | 0 | 23.6 | 12.6 | 2.5 | 44.8 | 23.6% |
| mild-d300-h30-greedy-v2-r3-discard | mild | 0.30 | 30 | greedy | 64 | 144 | 248 | 553 | 0.02% | 0 | 22.3 | 12.3 | 1.9 | 41.5 | 24.7% |
| mild-d300-h30-greedy-v2-r3-none | mild | 0.30 | 30 | greedy | 67 | 154 | 291 | 513 | 0.04% | 0 | 23.7 | 12.6 | 2.6 | 44.6 | 23.5% |
| mid-d300-h30-greedy-v2-r3 | mid | 0.30 | 30 | greedy | 62 | 135 | 224 | 357 | 0.00% | 0 | 21.3 | 11.9 | 1.7 | 39.6 | 26.7% |
| mild-d350-h30-greedy-v2-r3 | mild | 0.35 | 30 | greedy | 61 | 134 | 248 | 707 | 0.02% | 0 | 25.0 | 13.3 | 2.7 | 43.8 | 25.8% |
| mild-d400-h30-greedy-v2-r3 | mild | 0.40 | 30 | greedy | 56 | 127 | 243 | 482 | 0.00% | 0 | 26.6 | 13.5 | 3.5 | 43.5 | 27.1% |
| mild-d300-h30-random-v2-r3 | mild | 0.30 | 30 | random | 113 | 232 | 370 | 565 | 0.12% | 0 | 37.5 | 25.4 | 0.3 | 22.3 | 18.3% |
| mild-d300-h30-random-v2-r3-single | mild | 0.30 | 30 | random | 114 | 233 | 385 | 611 | 0.18% | 0 | 38.0 | 25.5 | 0.5 | 22.2 | 18.2% |
| mild-d300-h30-random-v2-r3-discard | mild | 0.30 | 30 | random | 111 | 233 | 377 | 581 | 0.14% | 0 | 37.5 | 25.5 | 0.3 | 22.0 | 18.3% |
| mild-d300-h30-random-v2-r3-none | mild | 0.30 | 30 | random | 113 | 234 | 395 | 581 | 0.22% | 0 | 38.0 | 25.5 | 0.5 | 21.9 | 18.1% |
| mid-d300-h30-random-v2-r3 | mid | 0.30 | 30 | random | 106 | 218 | 343 | 563 | 0.06% | 0 | 35.2 | 23.9 | 0.2 | 20.9 | 19.7% |
| mild-d350-h30-random-v2-r3 | mild | 0.35 | 30 | random | 106 | 225 | 358 | 656 | 0.08% | 0 | 42.0 | 28.5 | 0.3 | 24.9 | 18.9% |
| mild-d400-h30-random-v2-r3 | mild | 0.40 | 30 | random | 103 | 217 | 344 | 605 | 0.06% | 0 | 46.1 | 31.3 | 0.4 | 27.3 | 19.6% |

| variant | route | direction | adjust | double | rapid | deadhead | certificate | harmful/g | cancelled/g | oversleep moves/g | forced-1/g |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mild-d300-h30-greedy-v2-r3 | 2.03 | 1.82 | 1.91 | 1.82 | 1.98 | 1.51 | 1.33 | 6.76 | 1.33 | 1.37 | 1.27 |
| mild-d300-h30-greedy-v2-r3-single | 1.92 | 1.76 | 1.90 | 1.91 | 1.98 | 1.46 | 1.70 | 7.18 | 1.70 | 1.39 | 1.28 |
| mild-d300-h30-greedy-v2-r3-discard | 2.02 | 1.81 | 1.89 | 1.82 | 1.97 | 1.51 | 1.32 | 6.76 | 1.32 | 1.38 | 1.27 |
| mild-d300-h30-greedy-v2-r3-none | 1.92 | 1.77 | 1.90 | 1.91 | 1.99 | 1.47 | 1.70 | 7.20 | 1.70 | 1.40 | 1.29 |
| mid-d300-h30-greedy-v2-r3 | 1.96 | 1.70 | 1.84 | 1.79 | 1.89 | 1.44 | 1.25 | 6.44 | 1.25 | 1.31 | 1.22 |
| mild-d350-h30-greedy-v2-r3 | 2.19 | 1.96 | 2.06 | 1.96 | 2.11 | 1.61 | 1.41 | 7.57 | 1.41 | 1.53 | 1.45 |
| mild-d400-h30-greedy-v2-r3 | 2.28 | 1.95 | 2.08 | 2.00 | 2.14 | 1.67 | 1.42 | 8.04 | 1.42 | 1.67 | 1.55 |
| mild-d300-h30-random-v2-r3 | 3.75 | 3.66 | 3.76 | 3.71 | 3.70 | 3.73 | 3.14 | 11.29 | 3.14 | 2.05 | 1.94 |
| mild-d300-h30-random-v2-r3-single | 3.75 | 3.66 | 3.72 | 3.69 | 3.69 | 3.71 | 3.29 | 11.46 | 3.29 | 2.05 | 1.95 |
| mild-d300-h30-random-v2-r3-discard | 3.74 | 3.66 | 3.76 | 3.72 | 3.70 | 3.74 | 3.16 | 11.32 | 3.16 | 2.05 | 1.94 |
| mild-d300-h30-random-v2-r3-none | 3.74 | 3.64 | 3.73 | 3.71 | 3.69 | 3.70 | 3.31 | 11.48 | 3.31 | 2.06 | 1.95 |
| mid-d300-h30-random-v2-r3 | 3.51 | 3.41 | 3.52 | 3.48 | 3.50 | 3.50 | 2.95 | 10.65 | 2.95 | 1.92 | 1.84 |
| mild-d350-h30-random-v2-r3 | 4.14 | 4.11 | 4.21 | 4.14 | 4.13 | 4.14 | 3.59 | 12.70 | 3.59 | 2.29 | 2.17 |
| mild-d400-h30-random-v2-r3 | 4.52 | 4.43 | 4.59 | 4.59 | 4.59 | 4.57 | 3.99 | 13.97 | 3.99 | 2.50 | 2.39 |

### Reproduce round 3

```bash
# Smoke (100 games per round-3 variant; round 3 is the default grid)
ITEM_SPIKE=1 npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike

# Full: one 5,000-game shard per variant id (14 ids), then merge
ITEM_SPIKE=1 ITEM_SPIKE_GAMES=5000 ITEM_SPIKE_FILTER='^<id>$' \
  ITEM_SPIKE_OUTPUT=.claude/logs/item-spike/round3/<id>.json \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike
ITEM_SPIKE_MERGE=.claude/logs/item-spike/round3 \
  npx vitest run --config vitest.simulation.config.ts tests/simulation/item-spike

# Round 2 is now selected with ITEM_SPIKE_ROUND=2 (round 1 with ITEM_SPIKE_ROUND=1)
```

Runtime: 14 variants in 2 min 31 s wall on 11 processes (≈21 CPU-min).
Shards: `.claude/logs/item-spike/round3/` (git-ignored).

## Round 4 (production engine, 2026-10-27)

### Verdict and measurement boundary

The production item engine passes the predeclared **round-3 both-rules
population thresholds** for both policies. Classic matches every published S7
turn statistic exactly. The existing independent effect-level tests pass.
Greedy per-seed identity is **not** achieved: the first divergent events are
178 Oedo-loop oversleeps and seven singleton-target route-ticket decisions.
The latter is a newly documented S5 eligibility difference, so the lead should
resolve whether that restriction is intended before treating this as an exact
reference-policy port or switching the product default in S11. No production
code, weights, seeds, tolerances, spike files or gameplay snapshots were changed.

| Policy / source | Games | Median | p90 | p99 | Mean | Max | Strict >500 | Cap hits | Completion |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Greedy, frozen round 3 | 5,000 | 65 | 143 | 241 | 75.4938 | 433 | 0 (0%) | 0 | 100% |
| Greedy, production | 5,000 | 65 | 143 | 241 | 75.6754 | 448 | 0 (0%) | 0 | 100% |
| Random, frozen round 3 | 5,000 | 113 | 232 | 370 | — | 565 | 6 (0.12%) | 0 | 100% |
| Random, production | 5,000 | 113 | 234 | 373 | 126.5844 | 565 | 5 (0.10%) | 0 | 100% |

Nearest-rank quantiles use sorted index `ceil(p * games) - 1`. The unchanged
thresholds are median absolute difference ≤max(5, 10% of reference), p90
≤max(10, 10%), p99 ≤max(20, 10%), p99 <400, strict >500 ≤0.5%, zero caps and
100% completion. Maximum is diagnostic. Greedy's quantile differences are
0/0/0; random's are 0/2/3. Both have zero engine/save errors and no turn using
more than one active item. Small-run verdicts are provisional; thresholds are
enforced only for the complete 5,000-seed population.

### Inputs, production path and evidence

All three measurements use the shipped `public/data` network and seeds
`s1m-20261012-0..4999` with a 20,000-turn cap. The seed-list SHA-256 is
`3472b901cf9c44db2a8792d2e565de89ea55ea639712bac20d4823a7cf9075f5`
(newline joined, trailing LF). The item config is `ITEM_GAME_CONFIG`:
`tokyo-suburban-items-1`, Yamanote share 1/2, toward/away weights 3:2, drop
300/1000, harmful 30%, capacity 3, one active item including adjust, and
player-selected discard. Classic explicitly uses `CLASSIC_GAME_CONFIG`.

`tests/simulation/item-engine/policy.ts` ports policy decisions only. The
runner drives the real `createItemGame` → `beginItemTurn` → `finishItemTurn`
→ optional `resolveItemDiscard` API. Its previews use production
`advanceWithMode`, `itemLandingOptions`, route/direction/rapid/deadhead queries
and graph distances. Random choices use the independent `<seed>|policy`
stream; singleton choices consume no policy draw. Greedy keeps the round-3
priority, scoring and newest-on-tie discard rule. Random selects distinct
usable held kinds, rather than weighting duplicate inventory slots.

Raw outputs remain git-ignored:

- `.claude/logs/item-engine/run-0-100.json` and `smoke.log`.
- `.claude/logs/item-engine/run-0-5000.json` and `full.log`: full config, seed
  list/hash, all five bundle byte hashes, engine/policy/harness/reference
  per-file and aggregate hashes, per-seed turns, counters/errors, reference
  first-divergence evidence, quantile convention and deterministic hashes.
- `.claude/logs/item-engine/classic/sim-0.json`, copied without modification
  from `.claude/logs/s6/simulation/a6-classic/sim-0.json` because the existing
  classic runner restricts its output directories.
- `.claude/logs/item-engine/classic/comparison.json`: explicit published-stat
  comparison plus independent recomputation from the new raw classic turns.
- `unit-all.log` and `default-sim.log` under `.claude/logs/item-engine/`.
- `.claude/logs/item-engine/validation.json`: independent raw-statistic, seed-list,
  final-source/bundle fingerprint and divergence-candidate verification; all pass.

There were 115,116 greedy pickups, 55,270 active uses, 6,642 passive certificate
cancellations and 9,407 discards. Random had 188,991 pickups, 111,902 active
uses, 15,758 certificate cancellations and 1,339 discards. JSON counters also
break these down by item kind, harmful effect and event type. Beneficial drops
are retained plus pending-discard pickups; harmful drops are scheduled plus
certificate-cancelled pickups. A passive cancellation consumes a certificate
but does not count as an active item. The runner rejects multiple active uses.

### Greedy first-divergence investigation

The diagnostic module generates an ignored, instrumented copy of the frozen
spike. It adds observations, never changes decisions or transition logic, and
is isolated from the production runner and policy adapter. The reference's
5,000-game aggregate is checked against frozen round 3, including mean
75.4938 and max 433. Thus instrumentation itself is checked for drift. The
frozen spike source and its movement helper are hashed and remain untouched.
Each production/reference turn compares policy action, raw/effective roll,
resolved ride and direction, physical hops, arrival/landing, both engine RNG
streams, inventory, target segments and normalized future effects. The trace
also records the departure service/station and eligible route candidates.

**178 seeds: Oedo oversleep hop limit.** The first example is seed
`s1m-20261012-45`, turn 45. Both sides take no active item, roll 5 and ride
`toei-oedo-loop`. The spike moves 3,172 physical hops (`2 * 1,586` network
stations), reaching Hamamatsucho; production moves six, reaching
`metro-azabu-juban`. Landing then consumes a different number of main-stream
draws. This is the intentional six-hop loop interpretation recorded at S3.
Across these 178 paired seeds, production uses a net 764 extra turns
(+4.2921 per affected seed; range −284..+175; 84 faster, 10 unchanged, 84
slower). Later effects and random draws can cascade, so this is a paired
whole-game difference, not an isolated causal estimate of one sleep.

Production greedy has **189 Oedo oversleep turns across 178 games** (3.56%
of games; 0.04995% of all 378,377 turns). Random has **256 across 240 games**
(4.80% of games; 0.04045% of all 632,922 turns). The reference/production
comparison measures the greedy effect; no random-policy ablation was run.

**Seven seeds: singleton-target route eligibility.** Seeds 3019, 3023, 3334,
3413, 3670, 4015 and 4954 (all prefixed `s1m-20261012-`) first diverge when
suspension leaves Yamanote as the only eligible route while the player is
still riding a non-target service. Spike greedy uses its route ticket to
board Yamanote. S5's `prepareItemTurn` explicitly rejects route tickets when
fewer than two eligible services remain; the adapter therefore keeps the
ticket and makes the legal ordinary move. Random already requires two
candidates, so its reference policy has no corresponding eligibility mismatch.
The seven greedy games have a net +144 turns (+20.5714/game, range −14..+35;
one faster, six slower). This restriction was not previously called out in
the S3–S5 handoff. It is a compatibility discrepancy, not evidence of RNG
corruption, and no engine fix was made in S7.

A natural reproduction is greedy seed `s1m-20261012-3019`, immediately before
turn 43: replay with the exported production policy and phased API, then query
`routeTicketOptions(state, { turn: 43, suspensions: state.effects.suspensions }, network)`.
It returns only `jr-yamanote`. Calling `beginItemTurn` with the held route
instance targeting `jr-yamanote` throws `INVALID_STATE` with
`Route ticket requires a choice of eligible services`. The new unit test
`exposes the singleton-target route discrepancy instead of issuing an illegal command`
constructs the same eligibility condition and checks both query and rejection.
This needs a lead decision before S11 if exact reference-policy behavior is
required; the measured population thresholds themselves pass.

No other first-divergence class was observed. **4,815 seeds have identical
full compared traces; 4,825 have identical final turn counts.** Ten of the
Oedo-divergent games converge to the same turn count. Production's route
choice draws a non-target direction on the main stream before the die, as
the round-3 spike already does; it introduces no observed divergence class.
Rapid/oversleep `pips`, `hopBudget`, `unusedPips` and stop metadata have the
production interpretation tested in S3/S5; metadata differences are not
mistaken for destination differences or used to retune this comparison.

### Classic exactness, effect tests and save/determinism checks

Classic's new 5,000-game statistics are median **55**, p90 **146**, p99 **261**,
mean **69.3858**, maximum **446**, **zero caps**, **zero >500**, and 346,929
total turns. These exactly equal the published S7 statistics in
`tests/simulation/README.md` and the earlier research evidence. Historical S7
observation outputs and S6 per-seed product shards are **not available in this
checkout**. Therefore this is an exact published-statistics comparison, not
a claim of newly demonstrated 5,000-seed identity against those missing files.
New per-seed classic turns and their source hashes are preserved. Existing
classic RNG/trajectory snapshots and `item-classic-regression.test.ts` pass
unchanged in `npm test`.

The existing small-network suites independently cover each active/harmful
item, suspension fallback and inclusive expiry, detour waiting/consumption,
delay/oversleep precedence, certificate draw order, rapid endpoint/goal and
pip accounting, nearest-target ties, and deadhead's no-die/no-landing/no-goal
semantics. `npm test` passes all 48 files (915 passed, one existing skip).
The two new policy/report suites pass 14 tests, including legal singleton
route handling and full-history versus trimmed-history equivalence.

The first 20 games per policy retain complete histories and continue from
strict save-v4 restored states. There are 40 unique completed-game checks,
40 pending-roll checks after turn 3 and nine pending-discard checks (greedy
six, random three), each deeply compared after seeded replay. There are no
save/replay errors. A repeated fixed subset, seed indices 0..9 for each
policy, reproduces every non-runtime measurement field exactly. Hashes of
those repeat outputs are:

- Greedy: `e4c8ebd19576492f51afdb2858e4c3e496ef586b74c98833912546424d5f5dcb`.
- Random: `fd4a05cfb491f04d3be7d2af60d5f8961bc059189df7c84bfaaeb063107c037f`.

### Reproduction and validation commands

Runs were unsharded. Commands (Vitest duration includes startup):

```bash
npm run typecheck
npx vitest run tests/unit/item-simulation-policy.test.ts tests/unit/item-simulation-report.test.ts
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=100 npm run sim -- tests/simulation/item-engine
ITEM_ENGINE_SIM=1 ITEM_ENGINE_GAMES=5000 npm run sim -- tests/simulation/item-engine
SIM_BUNDLE=public/data S5_OFFSET=0 S5_GAMES=5000 S5_OUTPUT=.claude/logs/s6/simulation/a6-classic/sim-0.json npm run sim -- tests/simulation/suburban-product.test.ts
npm test
npm run sim
git diff --check
git status --short
```

The classic run took 17.58 s (engine loop 16.9427 s), all-unit validation
5.56 s, and default `npm run sim` 1.86 s (new item runner skipped). Final item
smoke took 3.94 s; the full item run took 98.30 s (measurement 97.6280 s;
greedy plus reference tracing 58.4201 s, random 39.1976 s). Typecheck took
4.66 s; the 14 targeted tests took 0.532 s. `git diff --check` passed.
No branch switch, commit or push was performed. An existing untracked
`.claude/docs/plans/item-system-s7-prompt.md` belongs to the caller and was
left untouched.

### Round 4 follow-up (2026-10-27): single-eligible route ticket

User decision: a route ticket may board the only eligible service when it differs from the current ride (e.g. leaving a suspended line). The engine (`itemTurnPreparation.ts`) now allows it; the production greedy adapter boards Yamanote in that case like the reference, while the random adapter keeps the reference's "two or more eligible services" usability rule. Rerun at 5,000 games: greedy 65 / 143 / 241, random 113 / 234 / 373 (unchanged, all tolerances pass); the only remaining greedy per-seed divergence class is `oedo-oversleep-hop-limit` (178 games), the intended six-hop rule versus the spike's hop-cap bug.
