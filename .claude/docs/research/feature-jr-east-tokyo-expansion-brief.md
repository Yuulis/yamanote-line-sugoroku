## Project Brief: JR East Tokyo 23-ward expansion with forced transfers

### Current State
- Architecture: static React 19 + TypeScript + Vite 8 app with MapLibre GL 6 (OpenFreeMap tiles), deployed on Vercel. Pure TypeScript game engine (`src/features/game/engine/`) separated from UI; seeded sfc32 PRNG; localStorage save with history replay and seeded-RNG verification. Python (uv) pipeline extracts game data from MLIT N02 2025 into `public/data/` (stations, services, segments, segments.geojson, manifest) using override tables in `data/overrides/`.
- Relevant code: `scripts/data_pipeline/*`, `data/overrides/*`, `public/data/*`, `src/types/network.ts`, `src/data/*`, `src/features/game/engine/*`, `src/features/game/**`, `src/features/map/*`, `tests/unit/*`, `tests/e2e/*`, `.github/workflows/ci.yml`. Detailed scan: `.claude/docs/research/feature-jr-east-tokyo-expansion-codebase.md`.
- Patterns: data model already separates `Station` (position, optional `groupId`), `ServicePattern` (ordered stationIds, `circular`, colour), directed `Segment` + GeoJSON geometry (spec §5). Engine events per step; `goalArrivalPolicy` with `truncate-on-target-service` default; spec §8.1 reserves `resolveLandingEvent` for transfer lotteries. CI gates: typecheck, Vitest, build, ruff/ty/pytest/validate, Playwright on Chromium/Firefox/WebKit. Branch flow: feature → PR → develop → PR → master (rulesets).

### Goal
Replace the Yamanote-only game with a JR East Tokyo-area version: the player still starts at 新橋 and must traverse all 30 Yamanote outer-loop segments and arrive at 新橋, but after every move that ends at a station served by several all-stop JR East services, the next service is drawn uniformly (current service included) and, for non-Yamanote services, the direction is drawn separately (spec §2, §4.1).

### Scope
- Include:
  - Area: JR East stations inside Tokyo's 23 special wards (東京23区). A move that would leave the area stops at the last in-area station; remaining pips are discarded (spec §2 エリア端点).
  - Services: all-stop (各駅停車相当) JR East services operating within the 23 wards only — e.g. 山手線, 京浜東北・根岸線, 中央・総武線各駅停車, 埼京線, 常磐線各駅停車?, 南武線?, 武蔵野線?, 京葉線?, 赤羽線 etc. The exact list, stopping patterns, and treatment of lines whose in-area part is short must be researched and proposed (no rapid/medium-distance services such as 中央線快速, 湘南新宿ライン, 上野東京ライン, 常磐線快速).
  - Station groups (`groupId`) for same-name/officially connected JR East stations across services; transfer candidates = services serving the arrival station's group (spec §2 乗換可否: same station or officially announced transfer).
  - Uniform service lottery at the arrival station only (not at passed stations); Yamanote always runs outer loop; other services get a separate uniform direction lottery, re-drawn even if the service is unchanged (spec §4.1 step 5); termini/area boundary: when only one direction is valid, the lottery is skipped (spec §4.2 proposal — confirm in design).
  - Terminus / area-boundary arrival mid-move: stop there and discard the remaining pips (user decision 2026-10-12).
  - Goal: unchanged — all 30 Yamanote outer segments completed + arrive at 新橋; on Yamanote, arrival at 新橋 with all 30 done truncates the move; on other services, exact stop at 新橋 required (confirmed rule, spec §3.3).
  - UI: show current service + direction, lottery results (as text, optionally a dice-like presentation per spec §4.2), all in-area services drawn on the map with Yamanote progress still highlighted; animation along any service's segments.
  - Data pipeline: extend to many services (non-circular, possibly branching), station groups, area clipping to the 23 wards (boundary source must be decided, e.g. N03 administrative boundaries or a curated in-area station list), validation per service.
  - Save format: new saveVersion; RNG replay must account for multiple draws per turn (dice + service lottery + direction lottery).
- Exclude:
  - The Yamanote-only mode (replaced, user decision); migrating old saves (old saves show the existing "unsupported version" message and can be discarded).
  - Rapid / medium-distance services, Shinkansen, private railways, subways, monorails (later roadmap stages).
  - Inner-loop mode, CPU/multiplayer, station events.
  - Through-service (直通) modelling beyond what an all-stop service pattern inside the area naturally covers.

### Constraints
- Station order and stopping patterns must be verified against official JR East information, never inferred from GIS geometry alone (spec §0.2, §5.2). N02 line names are physical lines, not services (see M0 findings in `.claude/docs/research/m0-data-spike.md`).
- Data stays static, deterministic (byte-identical rebuilds), and small enough to serve on Vercel Hobby; raw N02 stays out of git.
- Engine stays pure (no React/DOM/random/Date/storage imports); every lottery uses the seeded PRNG so a game is reproducible from seed + operations; restore must verify RNG consistency.
- Existing quality gates and CI must stay green; E2E remains hermetic (no external network).
- Attribution/licensing as established (N02 CC BY 4.0, OpenFreeMap/OSM); any new data source must be license-compatible and credited.
- Code, identifiers, and technical docs in English; UI text in Japanese.

### Success Criteria
- `public/data/` contains every in-scope all-stop service inside the 23 wards with verified station order, station groups, and track-following geometry; the validator enforces per-service integrity (ids, adjacency, closure for loops, in-area membership, group consistency).
- Engine unit tests cover: arrival-only transfers, uniform service lottery including the current service, Yamanote fixed outer direction, separate direction re-draw for non-Yamanote services, single-direction skip at termini/boundary, truncation at terminus/boundary, goal rule on Yamanote vs other services, determinism and save/restore with multiple RNG draws per turn.
- A player can play a full game in the browser to the clear screen; lottery results and current service/direction are visible; E2E covers a transfer, a direction draw, a terminus truncation, and resume after reload.
- All CI jobs pass; production deploy verified after release approval.
