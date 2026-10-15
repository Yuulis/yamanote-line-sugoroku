## Project Brief: JR East capital-region (1都3県) expansion

### Current State
- Architecture: static React + TypeScript + Vite app on MapLibre GL JS. Three separated layers: generated railway data (`public/data/*`, manifest `schemaVersion` 2), a pure TypeScript game engine (`src/features/game/engine/*`, including `landing.ts` and `movement.ts`), and presentation/animation around atomically committed turns. Python pipeline (`scripts/data_pipeline/*`) builds the bundle deterministically from MLIT N02 2025 plus curated overrides (`data/overrides/**`, station registry `data/overrides/stations.csv`).
- Current edition: "山手線すごろく — JR東日本 東京23区版". 5 all-stop services (Yamanote cycle 30, Keihin-Tohoku Akabane–Kamata 22, Chuo-Sobu local Nishi-Ogikubo–Koiwa 24, Saikyo Osaki–Ukima-Funado 10, Keiyo Tokyo–Kasai-Rinkai-Koen 6), 67 shared station ids, 22 transfer stations, 146 directed gameplay segments, 88 shared LineString geometry features. GeoJSON 41,176 bytes.
- Relevant code: `src/features/game/engine/*`, `src/types/*`, `src/data/*`, `scripts/data_pipeline/*`, `data/overrides/**`, `public/data/*`, `src/features/map/*`, `src/features/game/components/*`, `tests/unit/*`, `tests/e2e/*`, pytest suite under the pipeline.
- Patterns:
  - One station id per physical JR station via curated registry; per-service platform coordinates (`ServicePattern.platformCoordinates`).
  - Directed gameplay segments (Yamanote +1 only, others both directions) referencing one canonical undirected geometry feature per adjacent service pair.
  - Per-turn RNG contract: rollDie -> move -> service lottery (k >= 2 candidates, order = services.json order) -> direction lottery (non-Yamanote, both directions movable, order [1, -1]). Forced choices consume no draw. drawIndex uses rejection sampling.
  - Atomic turn commit; `MoveRecord` carries `stopReason` and `landing`; save v2 replays structurally and with the seed; old saves rejected, never migrated.
  - Area = curated per-service in-area stop list (registry ward column), N03 used only as a one-off audit; terminus / area-boundary truncation; leftover pips discarded at endpoints.
  - Goal: traverse all 30 Yamanote outer directed segments, then arrive at Shimbashi (pass-through on Yamanote, exact-stop elsewhere).
  - Pipeline routes each service by open-chain or cycle dynamic programming with selector/filter/via constraints; a 17-rule validator; byte-identical rebuild and input checksums.
  - E2E uses a hermetic fixture network and pinned seed via route interception; real data is covered by Vitest playthrough and an E2E smoke test.
- Prior design and research: `.claude/docs/research/jr-east-tokyo-expansion-design.md`, `jr-east-tokyo-expansion.md`, `jr-east-tokyo-service-graph.md`; handoff `.claude/docs/plans/jr-east-tokyo-expansion-handoff.md`.

### Goal
Replace the 23-ward edition with a 1都3県 edition: every JR East conventional line inside Tokyo (excluding islands), Chiba, Saitama and Kanagawa becomes playable, with both the 普通 (local) stop pattern of each line and the rapid / medium-distance services modelled as separate services, while keeping the game finishable and fun.

### Scope
- Include (user decisions, 2026-10-12):
  - All JR East conventional lines in the four prefectures, including branch lines (e.g. 鶴見線 and its branches, 南武支線, 成田線 branches, 久留里線, 東金線, 八高線, 五日市線, 相模線, 川越線, 青梅線, 鹿島線 in-area part). Branches become separate services.
  - The 普通 stop pattern of every line, AND rapid / medium-distance services (快速・中距離, e.g. 中央線快速, 総武快速・横須賀線, 常磐線快速, 東海道線, 宇都宮線, 高崎線, 京葉線快速 …) as separate services. Exactly which rapid service types are modelled is a research output to be confirmed by the user.
  - Truncation at the 1都3県 boundary (lines leaving the area end at the last in-area station).
  - Replace the 23-ward edition entirely (no edition selector). Old saves are rejected with a discard action, as before.
- Exclude:
  - Shinkansen, JR Central lines (御殿場線), private railways, subways, Tokyo Monorail, Rinkai Line, Tokyo islands.
  - Limited express / reserved-seat-only services (特急), unless research shows a case that changes reachability (to be reported, not assumed).
  - Timetables, fares, train positions; servers, accounts, remote saves; multiplayer.
- Undecided (decided after research and Monte Carlo, by the user):
  - Goal rule and game-length levers (the current Yamanote-30-segment goal may become very long on a network roughly an order of magnitude larger).
  - Lottery weighting between local and rapid services, and how through-running services (上野東京ライン, 湘南新宿ライン, 直通運転) are split into services.
  - Title / subtitle wording.

### Constraints
- Railway geometry from MLIT N02 2025 (CC BY 4.0) only; raw N02 never shipped. Station order and stop patterns verified against official JR East sources, never inferred from GIS alone.
- Static site, no server or DB; Vercel Hobby. Bundle size and MapLibre rendering must stay acceptable on phones.
- Engine stays a pure function; adding services must not require rewriting the engine (extend rule modules). Seeded reproducibility and atomic save contract preserved (save version bump expected).
- Rapid services stop at a subset of stations on shared track: their gameplay segments connect non-adjacent stations, so geometry must be composed from existing per-pair features rather than duplicated.
- Branching lines must be expressible as open chains or cycles (split into services) unless the design explicitly extends the engine.
- uv + ruff + ty for Python, Vitest + Playwright for TS; no new runtime dependencies without justification.
- Branch flow: feature branch from develop → PR → develop → PR → master; production release requires explicit user approval. Release PR #4 (23-ward edition) is still open and unmerged.

### Success Criteria
- A reviewed service catalog (line, service type, stop list, in-area truncation, source) covering every JR East conventional line in the four prefectures, with every listed station reachable.
- A design document with data-model changes, rendering budget, pipeline changes, and Monte Carlo game-length results for candidate goal rules, presented to the user with explicit open questions.
- After implementation: all existing quality gates pass (ruff, ty, pytest, Vitest, Playwright), validator extended for the new network, deterministic rebuild verified, real-data playthrough test finishes.
