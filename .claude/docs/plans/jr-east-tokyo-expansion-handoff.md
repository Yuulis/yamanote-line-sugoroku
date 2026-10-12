# Handoff: JR East Tokyo 23-ward expansion (for Codex continuation)

Purpose: if the Claude Code session runs out of rate limit, a Codex session started with `codex` in this
repository can continue the work from this file alone. Keep the **Progress** table current after every step.

Start Codex as the main agent (interactive `codex` in the repo root). It loads root `AGENTS.md` and
`.codex/AGENTS.md` automatically; read this file next, then the documents listed under "Read first".

## Progress

| Step | Branch | Status | PR | Notes |
|---|---|---|---|---|
| 1 Engine seam (landing lottery, terminus stop, save v2; Yamanote-only data) | `feature/jrx-1-engine` | in progress | — | |
| 2 Pipeline preparation (multi-service internals, v1 output byte-identical) | `feature/jrx-2-pipeline` | in progress | — | runs in a separate git worktree |
| 3 Atomic v2 data-contract cutover (still Yamanote-only data) | — | pending | — | needs 1 and 2 merged |
| 4 Multi-service UI + fixture-network E2E | — | pending | — | needs 3 |
| 5 Expanded data (4 more services) + real-data tests | — | pending | — | needs 3, 4 |
| 6 Docs, release PR develop → master, production smoke check | — | pending | — | release needs user approval |

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
