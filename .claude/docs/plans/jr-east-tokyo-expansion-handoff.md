# Handoff: JR East Tokyo 23-ward expansion (for Codex continuation)

Purpose: if the Claude Code session runs out of rate limit, a Codex session started with `codex` in this
repository can continue the work from this file alone. Keep the **Progress** table current after every step.

Start Codex as the main agent (interactive `codex` in the repo root). It loads root `AGENTS.md` and
`.codex/AGENTS.md` automatically; read this file next, then the documents listed under "Read first".

## Progress

| Step | Branch | Status | PR | Notes |
|---|---|---|---|---|
| 1 Engine seam (landing lottery, terminus stop, save v2; Yamanote-only data) | `feature/jr-east-tokyo-expansion` | verified locally | — | `d3825c3`; 364 Vitest tests, 51 E2E checks passed |
| 2 Pipeline preparation (multi-service internals, v1 output byte-identical) | `feature/jr-east-tokyo-expansion` | verified locally | — | Integrated the preserved `feature/jrx-2-pipeline` worktree; 122 pytest tests passed; v1 rebuild byte-identical |
| 3 Atomic v2 data-contract cutover (still Yamanote-only data) | `feature/jr-east-tokyo-expansion` | verified locally | — | 379 Vitest / 135 pytest / 51 E2E checks passed; generated v2 data validates |
| 4 Multi-service UI + fixture-network E2E | `feature/jr-east-tokyo-expansion` | verified locally | — | 392 Vitest / 135 pytest / 57 E2E checks passed; pinned 15-turn fixture covers transfers, direction draw, both endpoints |
| 5 Expanded data (4 more services) + real-data tests | `feature/jr-east-tokyo-expansion` | verified locally | — | 402 Vitest / 136 pytest / 60 E2E checks passed; 67 stations, 146 directed segments, 88 features; initial-overview fix independently passes all 3 browsers; raw checksums pinned |
| 6 Docs, release PR develop → master, production smoke check | `feature/jr-east-tokyo-expansion` | docs verified; PR preparation | — | All local app gates pass; read-only review has no blockers. Production merge and smoke still require user approval |

Plan details per step: `.claude/docs/research/jr-east-tokyo-expansion-design.md` §8 (scope, dependencies,
file-level change list, risks).

## Read first (in this order)

1. `AGENTS.md`, `.codex/AGENTS.md` — contract, routing, guardrails, language protocol (UI text Japanese; code, docs English).
2. `railway_sugoroku_mvp_spec.md` — product spec (§2 rules table, §3.3 goal, §4 transfer rules, §5 data model, §8 engine contract).
3. `.claude/docs/DESIGN.md` — Key Decisions table holds every user decision with dates (goal rule, branch flow, licences, JR expansion R1/R5/R6).
4. `.claude/docs/research/feature-jr-east-tokyo-expansion-brief.md` — goal, scope, constraints, success criteria.
5. `.claude/docs/research/jr-east-tokyo-expansion-design.md` — the approved architecture and plan (rules §1, data contract v2 §2, game length §3, engine §4, pipeline §5, UI §6, tests §7, plan §8, decisions §9).
6. `.claude/docs/research/jr-east-tokyo-expansion.md` and `jr-east-tokyo-service-graph.md` — verified service/station lists, station groups, cut points, official sources, N02 pitfalls (ヶ/ケ spelling, 大久保 homonym, 東京 京葉線 platform group code, parallel tracks).
7. `.claude/docs/research/feature-jr-east-tokyo-expansion-codebase.md` — every current single-service assumption with file:line.
8. Background as needed: `m0-data-spike.md` (N02 line naming, routing), `m1-engine.md` (engine/PRNG), `m2-experience.md` (screens, persistence, animation), `m3-e2e.md` (hermetic E2E, test hook), `m3-license-terms.md` (attribution), `ci-firefox-failure.md` (xvfb).

## Confirmed decisions (do not re-open)

- Area: JR East stations inside the 23 wards; leaving the area stops at the last in-area station, remaining pips discarded.
- Services (5, normal stopping patterns): 山手線 (loop, 30), 京浜東北線 赤羽–蒲田 (22), 中央・総武線各駅停車 西荻窪–小岩 (24), 埼京線 大崎–浮間舟渡 (10), 京葉線 東京–葛西臨海公園 (6). 67 stations, 22 transfer stations. Excluded: 常磐線各駅停車, 横須賀・総武快速線, 常磐線快速; 武蔵野線 not separate. 10 unreachable in-area stations accepted.
- Terminus mid-move: stop, discard remaining pips. Yamanote-only mode replaced; old saves not migrated (show unsupported-version message + discard).
- Goal unchanged: all 30 Yamanote outer segments + arrive 新橋; on Yamanote truncate at 新橋, on other services exact stop.
- Landing: service lottery uniform over services at the arrival station incl. current (only when ≥ 2); Yamanote always outer; other services: direction lottery re-drawn at every landing (R1-a), skipped when only one direction is movable. Draw order roll → service → direction; forced choices consume no draw.
- Title 「山手線すごろく」 + subtitle 「JR東日本 東京23区版」 (R5). No game-length levers (R6).

## Workflow rules

- Branches: `feature/<name>` from `develop` → PR → `develop` → PR → `master` (production, Vercel). Rulesets on `master`/`develop` block direct pushes; merges need passing checks "Frontend (typecheck, unit tests, build)", "Data pipeline (ruff, ty, pytest, validate)", "E2E (Playwright)". Use `gh pr create` / `gh pr merge --merge`. **Merging to `master` requires explicit user approval.**
- Commit message trailer used so far: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (a Codex session should use its own attribution, not this one).
- Never weaken/skip/delete tests to pass; verify delegated work per `AGENTS.md` Guardrails (`python3 .claude/skills/_shared/verify_delegation.py`).

## Gates (run before every PR)

```bash
source ~/.nvm/nvm.sh && nvm use >/dev/null   # Node 24 (.nvmrc)
npm ci && npm run typecheck && npm test && npm run build
! grep -q __sugorokuE2E dist/assets/*.js      # E2E hook must not ship
npm run test:e2e                             # Chromium desktop/phone + Firefox locally
uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run ty check scripts/ && uv run pytest -q
uv run python -m scripts.data_pipeline.validate
uv run python -m scripts.data_pipeline.build   # needs raw N02 in N02-25_GML/UTF-8 (gitignored); must be byte-identical on rerun
```

## Environment quirks (WSL2)

- Use Node 24 via nvm; Codex CLI lives at `~/.nvm/versions/node/v24.21.0/bin/codex` (a broken Windows `codex` may shadow it).
- Local E2E preview server binds `::1` because connecting to a closed port on 127.0.0.1 stalls ~135 s; CI sets `E2E_HOST=127.0.0.1` and wraps E2E in `xvfb-run` (Firefox needs an X display for WebGL2).
- Stop dev servers by port (`kill $(lsof -t -iTCP:<port> -sTCP:LISTEN)`), never `pkill -f` (kills the invoking shell).
- WebKit E2E runs only on CI (`GITHUB_ACTIONS`), not locally.
- Raw N02 data is gitignored; a fresh worktree needs `N02-25_GML/UTF-8` linked from the main checkout.

## Codex continuation verification (2026-10-12)

- Combined feature branch preserves both original Claude implementations and lands the six steps incrementally. The original pipeline worktree remains intact and is excluded locally from accidental git staging.
- Final local gates: Node 24 locked install/typecheck, 402 Vitest tests, production build without the E2E hook, 60 Playwright checks (desktop/phone Chromium + Firefox), uv locked sync, ruff lint/format, ty, 136 pytest tests with raw N02, v2 artifact validator, pinned input SHA-256 and two byte-identical rebuilds.
- Read-only fresh-context review: `.claude/logs/codex/20261012T041121Z-jrx-final-review.md`; no blocking findings and no file edits. The main agent separately ran the acceptance gates and reviewed the diff. Collection flags for assertion changes were reviewed as the required v2 contract/feature updates; no placeholders or out-of-scope files remain.
- Actual artifacts: 5 services, 67 stations, 22 transfer stations, 146 directed segments, 88 geometry features. GeoJSON 41,176 B; maximum endpoint offset 24.507 m; Tokyo/Keiyo representative offset 386.0 m within its reviewed 500 m exception.
- Visual evidence (local): `.claude/logs/jrx-visuals/`. The real-data E2E proves all turn-0 platforms fit outside the panel on all three local browser profiles. Initial following begins after the first move.
- Additional repository-contract gate `scripts/check.sh`: 9 passed / 1 existing false positive. It scans `.claude/worktrees/` recursively and interprets `${CODEX_MODEL:-...}` in the nested check-script comments as a model. Actual model settings agree; no orchestration-template code was changed. This gate is not one of the app's three required CI jobs.
- Current rules: `docs/manual/jr-east-tokyo/rules.md`; implementation status: `docs/manual/jr-east-tokyo/implementation-status.md`; schema/generation: `data/README.md`; spec v0.3.0 addendum: `railway_sugoroku_mvp_spec.md`.
