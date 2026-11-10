# Map Guidance and Direction (issue #62) — Handoff

Resume from here. Plan: `.claude/docs/plans/map-guidance-plan.md` (Codex validated PASS after one Step 5 revision; approved by the user 2026-11-10). Brief: `.claude/docs/research/feature-map-guidance-and-direction-brief.md`. Scan: `.claude/docs/research/feature-map-guidance-and-direction-codebase.md`. Step prompts: `.claude/docs/plans/map-guidance-prompts.md`. DESIGN.md rows dated 2026-11-10 (#62).

- Branch: `feature/map-guidance` (from origin/develop 33ff82c); no upstream yet.
- Pacing: stop after every step for user review (user 2026-11-10).
- Implementer: Codex Luna xhigh (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --timeout 2400`); reviews Sol low; lead verifies, commits, pushes, checks CI.
- Local E2E: targeted specs only, `--workers=2`; full 4-project matrix in CI.
- Accepted consequences: old in-progress saves are rejected (dataVersion change); `product_suburban verify` S4 pins are superseded, not edited.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1 labels + validator | done | 01b7d51 | Luna xhigh 818 s; 10 services / 11 labels fixed (matches issue list); dataVersion n02-2025-8a0970069659 → n02-2025-7974da15af8e. Lead: rebuild byte-identical, validate OK, ruff/format/ty ok, test_validate 52/52 (frozen baseline still passes). Expected red until step 2: 4 pinned-save unit tests (product-data classic now DATA_VERSION_MISMATCH; regenerated save + real-data-e2e-scenarios pins). Local-only pytest 4 failed/5 errors from absent git-ignored `.claude/logs/s3/`. Sol-low review APPROVE. CI run 42794944265: Data pipeline green; Frontend red on exactly the 4 expected pinned-save tests; E2E red on 5 pinned-save cases on all 4 projects (accessibility resume/clear, real-data Oedo 都庁前, save-errors classic v4, tokyo-suburban clearing turn + Korakuen transfer) plus desktop-chromium-only auto-roll Enter/Space keyboard roll (fixture dataset, unrelated; 6/6 local passes with --repeat-each 3) |
| 2 saves + classic fixture | done | (this commit) | Luna xhigh 304 s; regenerated 3 product saves (only dataVersion changed), provenance + edition-save-compatibility hashes; classic fixture bytes/SHA unchanged — live network now asserts DATA_VERSION_MISMATCH, a test-only network with the fixture's dataVersion keeps CONFIG_MISMATCH + turn-41 restore; browser case asserts the data-update message, reload preservation and explicit discard. Codex: full vitest 1,995 passed / 1 skipped, desktop-chromium 5/5. Lead: unit 18/18, typecheck ok, phone-chromium 5/5. Sol-low review APPROVE |
| 3 guidance model | pending | | |
| 4 pending emphasis + heading | pending | | |
| 5 HUD guidance + goal ring | pending | | |
| 6 30/30 milestone toast | pending | | |
| 7 adjustment landing model | pending | | |
| 8 modal strip + named choices | pending | | |
| 9 speech bubbles | pending | | |
| 10 preview camera | pending | | |
| 11 browser integration | pending | | |
| 12 docs + final acceptance | pending | | |

## Follow-ups (out of scope)

- CI flake: `auto-roll-decisions.spec.ts` 'Enter/Space from a non-interactive focus makes one manual roll while auto-roll is ON' failed on desktop-chromium in CI run 42794944265 (save turn 0, expected 1, after `clock.runFor(1)`); passes locally. Watch later runs.

## Next

Step 3 (shared heading and completion presentation model).
