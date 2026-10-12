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
- Pending user: R1 direction re-draw at single-service stations, R5 title/subtitle, R6 length levers.
- Design: .claude/docs/research/jr-east-tokyo-expansion-design.md
