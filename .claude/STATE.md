# Agent State

## Main Agent

Claude Code

<!-- Default only: each session's main agent is decided by its entry point (`claude` or an interactive `codex`); see root AGENTS.md. -->

## Repository Identity

<!-- Managed by /init. Re-run /init to refresh. -->

Yamanote Line sugoroku: a browser-based original board game (React + TypeScript + MapLibre GL JS) where a solo player rolls dice to travel all 30 outer-loop segments of the JR Yamanote Line on a real map, backed by a Python pipeline that extracts station and segment data from MLIT N02 2025 railway data.

Macro requirements and design live in [docs/DESIGN.md](docs/DESIGN.md).

## Progress Tracker

Rolling progress summary (latest 5 checkpoints): [PROGRESS.md](../PROGRESS.md)

<!-- Working state below is maintained by workflow skills and manual notes. -->

---

## Current Feature: JR East Tokyo 23-ward expansion
<!-- orchestra:block-id: jr-east-tokyo-23-ward-expansion -->

### Context

- Goal: replace the Yamanote-only game with 5 JR East all-stop services inside the 23 wards (山手, 京浜東北, 中央・総武各停, 埼京, 京葉; 67 stations, 22 transfer stations) with forced uniform service lottery and direction lottery at the arrival station; goal unchanged (30 Yamanote outer segments + arrive 新橋).
- Key files: src/features/game/engine/* (new landing.ts, movement.ts), src/types/*, src/data/*, scripts/data_pipeline/*, data/overrides/**, public/data/*, src/features/map/*, src/features/game/components/*, tests/unit/*, tests/e2e/*
- Dependencies: none new
- Complexity: COMPLEX (6 steps)

### Architecture

- One station id per physical JR station via curated registry; per-service platform coordinates.
- Directed segments (Yamanote +1 only, others both ways) sharing one undirected geometry feature per pair; manifest.schemaVersion 2.
- RNG per turn: roll -> service draw (k>=2) -> direction draw (non-Yamanote, both movable); forced choices consume no draw; drawIndex rejection sampling.
- MoveRecord gains stopReason + landing; SAVE_VERSION 2; restore replays recorded choices and seeded history, comparing whole records.
- Area boundary = curated per-service in-area stop list; N03 only as one-off audit.

### Decisions

- Area 23 wards, all-stop only, terminus/boundary truncation, Yamanote-only mode replaced: user 2026-10-12.
- Service list (5) and exclusions (常磐各停, 横須賀・総武快速, 常磐快速; 10 unreachable stations accepted): user 2026-10-12.
- Monte Carlo (confirmed rules): median 52, p90 114, p99 189 turns; no length lever needed by default.
- All rule choices resolved: R1-a re-draw at every non-Yamanote landing; R5 title plus JR East Tokyo 23-ward subtitle; R6 no length levers.
- Design: .claude/docs/research/jr-east-tokyo-expansion-design.md

### Continuation (Codex, 2026-10-12)

- Integration branch: `feature/jr-east-tokyo-expansion`; preserved Claude engine and pipeline work, then completed steps 1–5 locally. Original pipeline worktree remains intact.
- Commits: `d3825c3` engine/save v2; `74cf868` pipeline preparation; `aafad9c` atomic schema v2; `0f38c7e` multi-service UI/fixture E2E; `6ffc82d` five-service data and real-data tests.
- Local evidence: 402 Vitest tests, 136 pytest tests (raw N02 present), 60 browser E2E checks; an additional 3-browser check proves every turn-0 platform fits outside the panel after the initial-camera fix. GeoJSON 41,176 bytes; max endpoint offset 24.507 m.
- Runtime rules/data contract and pinned fixture seeds are implemented; old saves are rejected, never silently migrated or deleted. Input checksums and byte-identical rebuild are verified.
- Step 6 documentation is verified; final local gates passed and the read-only review has no blocking findings. Integration/release PR preparation is in progress. `master` merge and production smoke remain behind explicit user approval. See `.claude/docs/plans/jr-east-tokyo-expansion-handoff.md` for final status.
- Integration PR: https://github.com/Yuulis/yamanote-line-sugoroku/pull/3. Pre-release regression coverage additionally resets the network overview on new/resumed turn-0 sessions after a previous zoom; a failing browser case was reproduced before the fix. Release is through develop → master after integration CI, with explicit user approval for production.
