# Pipeline gaps G1/G2 — platform transfers and inherited anchor lines (2026-10-14)

Branch `feature/jrcr-pipeline-g1g2`, uncommitted. These changes fix the two pipeline gaps found by the S6P
Tokyo stage (`jr-east-capital-region-s6p-tokyo.md` §9). User decision D1(a) applies: a pipeline feature, no
synthetic connector. No staging data, `data/overrides`, `public/data` or `src` was changed.

## 1. Problems and causes

- **G1.** `composition_build.composed_pairs` returned the owner's chosen `PlatformCandidate` with only the midpoint
  replaced, so it kept the owner's platform `n02_line`. saikyo chooses its 赤羽線 feature at 池袋.
  `routing._pair_paths` then rejected the adjacent multi-line route 東北線→山手線, because its last line
  (山手線) differed from the inherited "赤羽線". The anchor itself lies on saikyo's 山手線 primitive.
  The 0.48 m difference reported by the earlier Codex review was between two *independently* routed primitives.
  With inheritance, the routed leg ends on the anchor exactly; the raw N02 run confirms this. No tolerance was needed.
- **G2.** `routing.route_path` picked exactly one platform per stop, and a platform snaps only to its nearest
  edge. At 上野, N02 東北線 has two components 17 m apart:
  - the 上野東京ライン features (-5200.6,-31815.4) and (-5170.8,-31796.5) reach 東京;
  - the features (-5159.4,-31867.1) and (-5050.9,-31743.9) reach 常磐線 at 日暮里.

  No single feature reaches both components.

## 2. Design

### G2 — reviewed platform transfer (`platform_transfers.csv`)

Optional dataset table next to `offset_exceptions.csv`:

```csv
service_id,station_id,max_transfer_m,reason
jr-joban-rapid,ueno,150,"N02 東北線 at 上野: 上野東京ライン component and the component joining 常磐線 are disconnected (17 m); arrive on the former, depart from the latter"
```

- **Load-time rules** (`constraints.parse_platform_transfer_rows`, `override_checks.check_platform_transfer_references`):
  - the limit is finite and in (0, 250] m (`config.MAX_PLATFORM_TRANSFER_M`), and a reason is required;
  - the service is known and linear (loops are rejected as unsupported), the stop is interior, and each (service, station) appears once.
- **Routing** (`routing.route_path`, `_transfer`). After the DP reaches a transfer stop, states are re-keyed from the
  arrival candidate to any departure candidate of the same stop within the limit. The cost adds the straight transfer
  distance (in integer mm), and ties use the lexicographic (arrival, departure) index tuple. Without transfers the
  order and cost are identical to before, so the live bytes are unchanged. A row whose chosen arrival and departure
  coordinates are equal is stale and fails the build.
  `RoutedService` gained `departures`, `arrival(i)` and `departure(i)`.
  `chosen` is the arrival platform in +1 order and is the **published** `platformCoordinates` point.
- **Composition** (`composition_build.inherited_candidates` / `check_inherited_route_anchors`,
  `build.distinct_anchors`, open stops):
  - at a transfer stop, anchors are inherited per side (the arriving hop binds the arrival, the departing hop binds the departure);
  - a side that is not composed may use any N02 platform of the stop;
  - outside transfer stops the old "one exact point" rule is unchanged;
  - a hop composed across an owner's transfer still fails ("joint is not exact");
  - a consumer that composes hops on both sides needs its own transfer row.
- **Validation:**
  - only the departing side of the canonical +1 pair at a transfer stop gets an allowance: routed endpoint ≤ 30 m + limit,
    composed anchor ≤ limit + `config.COORDINATE_ROUNDING_M` (0.15 m; two points rounded to 6 decimals);
  - the arrival side keeps 30 m (routed) or exact equality (composed);
  - detours on the departing side are measured from the pair's own track point, in both the build and the validator;
  - `composition_validate.check_platform_transfers` rejects a row whose +1 chains into and out of the stop join exactly (unused).

### G1 — inherited anchor carries the primitive's end line

`composed_pairs` now sets the inherited candidate's `n02_line` from the owner pair's `route_lines`: first line at the
start, last line at the end, swapped when the primitive is used reversed. Anchors stay exact.
`check_inherited_route_anchors` still requires a routed neighbour to meet the anchor bit-for-bit.

## 3. Recipe syntax for step 2 (Tokyo stage)

1. **上野 transfer (G2).** Use `jr-joban-rapid` stops 品川, 新橋, 東京, 上野, 日暮里, 三河島, 南千住, 北千住 (8 stops; oracle = product
   catalog run, hash `25bc9e50…d224` when only this change is applied).
   - `line_mapping.csv`:
     ```
     shinagawa,tokyo,東海道線,
     tokyo,nippori,東北線,
     nippori,kita-senju,常磐線,
     ```
   - `platform_transfers.csv`: the row shown in §2.
   - Endpoints: first `service-boundary` (品川), last `area-boundary` (北千住, then 松戸).
   - Verified on raw N02: 17.545 km. 上野 arrives on (-5170.8,-31796.5) and departs from (-5050.9,-31743.9), a 131.0 m transfer.
2. **池袋→新宿 composition (G1).** In `jr-shonan-shinjuku-local/line_mapping.csv` replace `ikebukuro,shinjuku,山手線` with
   `ikebukuro,shinjuku,,,,"{""legs"":[{""source_service"":""jr-saikyo"",""from"":""ikebukuro"",""to"":""shinjuku""}],""shared_track_evidence"":[{""lines"":[""山手線""],""allow"":[],""deny"":[],""reason"":""山手貨物線 shared with 埼京線""}]}"`.
   Keep the 赤羽→池袋 surrogate route and the 新宿→大崎 compose rows.
   Built chain: `jr-shonan-shinjuku-local:ikebukuro:shinjuku` = `["jr-saikyo:shinjuku~ikebukuro"]`.
3. **Optional: compose 品川–上野 from the owners.** Variant `scratch-ov2`:
   - shinagawa→shimbashi→tokyo ← jr-tokaido; tokyo→ueno ← jr-utsunomiya; routed from 上野;
   - transfers at **東京** (64.3 m between tokaido's surface anchor and utsunomiya's 縦貫線 anchor) and 上野.

   It builds and validates (182 primitives, 19 compose pairs). Whether a 64 m 東京 "transfer" between two owners
   represents the real through-platforms is a lead decision. Without it, 品川–上野 is joban-owned duplicate geometry.

Ready-made scratch override sets (gitignored): `.claude/logs/jrcr-pipeline-g1g2/scratch-ov` (recipes 1+2) and
`scratch-ov2` (1+2+3). Both build from raw N02 and validate OK: 137/137 two-way reachability, oracle = built output.
Generator: `.claude/logs/jrcr-pipeline-g1g2/make_g1g2_scratch.py`.

| Variant | Pairs | Compose | Primitives | References / max chain | GeoJSON B | Max endpoint m |
|---|---:|---:|---:|---:|---:|---:|
| current Tokyo stage | 198 | 15 | 183 | 366 / 1 | 105,451 | 24.5 |
| scratch-ov (1+2) | 201 | 16 | 185 | 372 / 1 | 107,159 | 131.0 (上野 transfer) |
| scratch-ov2 (1+2+3) | 201 | 19 | 182 | 372 / 1 | 104,708 | 131.0 |

## 4. Tests and guard-removal audit

New tests (no existing test changed):
- `tests/data_pipeline/test_platform_transfers.py`, 39 cases:
  - DP split, limit, stale (index and coordinate), endpoints, no-transfer equivalence, equal-cost determinism;
  - row parsing and table references;
  - synthetic build and validate with an owner and composed / mixed / route-first consumers;
  - an unreviewed gap rejected; a hop crossing an owner transfer rejected;
  - detour consistency, published-arrival enforcement (routed and composed), unused-row artifact check, rounding boundary;
  - malformed chains on either side of a transfer are reported, not raised.
- `tests/data_pipeline/transfer_support.py`: fixture with two disconnected components of line LS at one station.
- `tests/data_pipeline/test_inherited_anchor_lines.py`, 4 cases:
  - end-side and start-side anchors next to multi-line routes;
  - zero-distance two-label transfer is stale;
  - a reversed multi-line owner primitive swaps its end lines.
- `tests/data_pipeline/test_staging_g1g2_raw.py`: raw-N02 proof on a scratch copy of the Tokyo stage. It skips when raw N02 is absent (CI).

Implementation preceded the tests, so sensitivity is proven by guard removal rather than by a red-first run.
Runner: `.claude/logs/jrcr-pipeline-g1g2/guard_removal.py`, results in `.json` (throw-away copy of `scripts/` + `tests/`).
Baseline passes, and **27/27** mutations make at least one new test fail. Every mutation is caught by a synthetic
(CI-run) test; the raw test is supplementary. The mutated guards are:
- G1: start-side and end-side line inheritance;
- G2 routing: transfer step, limit, stale check, interior check;
- parsing: limit bounds, reason;
- table references: duplicate, unknown service, circular service, interior stop; table loading;
- build wiring: transfers passed to routing, open transfer side, per-side inherited anchors, per-side routed-anchor check;
- validator: endpoint allowance, composed-anchor allowance;
- review fixes: stale by coordinates, both detour fixes, both departure-only allowances, unused-row check, rounding allowance;
- re-review fix: malformed-chain guard.

Not separately mutation-proven: the build-side detour start at a transfer. With a 0 m snap it equals the platform midpoint,
and no constructible fixture distinguishes the two; it keeps build and validator aligned.

## 5. Acceptance results

| Check | Result |
|---|---|
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 51 files already formatted |
| `uv run ty check scripts/` | All checks passed |
| `uv run pytest` | 306 passed (262 before + 44 new, raw proof included locally) |
| Live rebuild `build --raw-dir N02-25_GML/UTF-8 --quiet --out-dir <tmp>` + `diff -r <tmp> public/data` | identical; `validate` OK |
| Tokyo staging build vs a build of the same staging at HEAD (git worktree) | `diff -r` identical; staging `validate` OK |
| `git diff --quiet HEAD -- public data/overrides data/staging src` | exit 0 |
| Raw-N02 G1/G2 proof (`test_staging_g1g2_raw.py`, plus CLI build+validate of `scratch-ov`/`scratch-ov2`) | pass / OK |

Codex reviews (read-only):
- `.claude/logs/codex/20261014T014831Z-pipeline-g1g2-review.md`: NEEDS_REVISION with four findings, all fixed in §2 with regression tests:
  - detour build/validator mismatch;
  - published-arrival contract and unused rows not checked by the validator;
  - stale check used indexes instead of coordinates;
  - limit rounding.
- `.claude/logs/codex/20261014T020627Z-pipeline-g1g2-rereview.md`: P1–P4 confirmed fixed.
  It found one new issue, now fixed: `check_platform_transfers` raised on empty or non-string chains instead of leaving
  them to the chain checks. The fix includes a guard, four regression cases and a 27th audit mutation. No third review was run.

File sizes: `build.py` 436, `routing.py` 378, `constraints.py` 385, `validate.py` 699, all ≤ 800.
`build.py` and `validate.py` exceed the preferred 400 lines; a split is a follow-up candidate.

## 6. Risks

- **Animation jump at a transfer stop.** Consecutive primitives do not join; at 上野 the gap is 131 m. Nothing is drawn
  between them, but the runner jumps that distance. The same pattern already exists at line changes (a few metres).
- **Published platform.** At a transfer stop the published platform is the +1 arrival feature. The reverse direction
  arrives on the departure feature, so it ends up to the limit away from the published point.
- **Artifact-level validation is bounded, not exact.** The validator cannot see the unpublished departure platform. It
  bounds that side by the reviewed limit and detects unused rows only when the two chains join exactly. An unused row
  whose two sides snap to different N02 lines is caught by the build, not the validator.
- **Loops cannot carry transfers.** This is rejected explicitly; not needed for Yamanote.
- **Optional recipe 3 is a lead decision.** It would make 東京 a transfer stop with a 64 m anchor gap between two owners.
