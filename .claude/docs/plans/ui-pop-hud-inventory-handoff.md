# UI Pop Overhaul P0+P1 (HUD + Inventory) — Handoff

Resume point for any session (Claude or Codex). **Update after every step** (status, commit, commands and
results, open findings, constraints for the next step) before reporting the step done.

## Goal

Turn the in-game sidebar into a brand-coloured HUD (riding line badge + direction, station, turn, straight
30-segment progress bar, dice CTA, icon inventory, effect chips), move per-turn text into a "ログ" disclosure and
settings + legend into a "メニュー" disclosure, and build the P0 foundations (tokens, line badges, item icons,
reveal hook, toast host) for P2. Presentation only: no engine/RNG/save/public-data change.

## Decisions (user, 2026-10-28; DESIGN.md Key Decisions)

- Brand palette vermilion `#d9502f` / ink `#263238` / cream `#faf7ef` replaces the green UI primary.
- HUD + log + menu as above; sound deferred (default off if ever added).
- Original line badges with official letter codes (案C); 21 uncoded JR lines colour-only with the name; never
  invent codes; no monetisation planned.
- P2 lottery display will be split-flap (パタパタ), ~2 s, skippable, omitted on reduced motion/resume — out of
  scope here; the reveal hook is its foundation.
- Pending user answers (plan §10; defaults apply until answered): multi-code groups → one representative code;
  partial JU/JO lines → show code; toast reading time 4,000 ms; all canonical item outcomes toast (max 3).

## Documents

- Brief: `.claude/docs/research/feature-ui-pop-hud-inventory-brief.md`
- Codebase scan: `.claude/docs/research/feature-ui-pop-hud-inventory-codebase.md`
- Plan (25 steps, architecture contracts, risks): `.claude/docs/plans/ui-pop-hud-inventory-plan.md`
- Executor prompts (§0 common contract + per step, reviewer §R, build snippet at the top):
  `.claude/docs/plans/ui-pop-hud-inventory-prompts.md`
- Audit: `.claude/docs/research/ui-pop-overhaul-audit.md`; badge research:
  `.claude/docs/research/official-line-symbols-usage.md`
- Codex record: `.claude/logs/codex/*uipop-*.md` (scope, arch, plan, validate, validate2)

## Branch

`feature/ui-pop-hud-inventory` from develop `4368673` (v0.10.0); PR target `develop`.
`UI_POP_BASE` (commit before S1): _record here when S1 starts._
Pre-existing uncommitted work on the branch (leave alone unless the lead commits it separately):
`.claude/docs/DESIGN.md` (2026-10-28 decisions), `.claude/docs/research/official-line-symbols-usage.md`,
`.claude/docs/research/ui-pop-overhaul-audit.md`.

## How to resume

1. `git status --short` and `git log --oneline -5`; find the first step below that is not `done`.
2. Read plan §2–§4 and the step's prompt section; build the prompt with the snippet at the top of the prompts
   doc; run the lane given in plan §4 (Luna high default; S2A Sol high read-only; Sonnet fallback).
3. Lead verification: the step's acceptance commands (`ui_gate`, `ui_e2e …`), `verify_delegation.py` (plan §3),
   read the diff, run the Sol-low reviewer (§R), then commit (one commit per step) and update this file.
4. Push per the branch flow; check GitHub CI after every push.

## Step Status

| Step | Title | Lane (impl / review) | Status | Commit | Evidence |
|---|---|---|---|---|---|
| Plan | Phases 1E/2E, Codex-validated | Sol | done (awaiting user approval) | — | validate_doc exit 0; workspace --verify exit 0; Codex validation round 1 NEEDS_REVISION → revised; round 2 PASS (`.claude/logs/codex/20261028T044343Z-uipop-validate2.md`) |
| S1 | Tokens + accessible brand buttons | Luna high / Sol low | not started | — | — |
| S2 | Line-badge catalogue (S2A mapping research, S2B code) | Sol high + Luna high / Sol low | not started | — | — |
| S3 | `LineBadge` + 11 item icons | Luna high / Sol low | not started | — | — |
| S4 | HUD pure models, progress bar, effect chips | Luna high / Sol low | not started | — | — |
| S5 | Reveal reducer + hook | Luna high / Sol low | not started | — | — |
| S6 | Toast conversion + queue | Luna high / Sol low | not started | — | — |
| S7 | `ToastHost` | Luna high / Sol low | not started | — | — |
| S8 | GameApp integration (reveal, skip, toasts, obscured) | Luna high / Sol low | not started | — | — |
| S9 | Stat markers + shared E2E helpers | Luna high / Sol low | not started | — | — |
| S10 | `GameHud` extraction | Luna high / Sol low | not started | — | — |
| S11 | Map observes the real panel | Luna high / Sol low | not started | — | — |
| S12 | Menu disclosure (expanded) | Luna high / Sol low | not started | — | — |
| S13 | Migrate menu consumers | Luna high / Sol low | not started | — | — |
| S14 | Menu closed by default | Luna high / Sol low | not started | — | — |
| S15 | Turn log disclosure (expanded) | Luna high / Sol low | not started | — | — |
| S16 | Migrate log consumers | Luna high / Sol low | not started | — | — |
| S17 | Log closed; compact roll | Luna high / Sol low | not started | — | — |
| S18 | Shared `ItemCard` + metadata | Luna high / Sol low | not started | — | — |
| S19 | `ItemCardPopover` lifecycle | Luna high / Sol low | not started | — | — |
| S20 | Inventory visuals + tooltips | Luna high / Sol low | not started | — | — |
| S21 | Inspect-then-use interaction | Luna high / Sol low | not started | — | — |
| S22 | Discard dialog cards | Luna high / Sol low | not started | — | — |
| S23 | Populated phone/landscape layouts | Luna high / Sol low | not started | — | — |
| S24 | Phone attribution collapsed | Luna high / Sol low | not started | — | — |
| S25 | Regression + validation record | Luna high / Sol low + lead | not started | — | — |

## Notes

- Local E2E: `env -u WAYLAND_DISPLAY npx playwright test …` (WSL WAYLAND quirk), 2 workers; WebKit CI-only.
  Never `pkill -f`; stop servers by port.
- Luna implementation runs need `--timeout 2400`; watch long runs every ~5 minutes.
- Full local E2E gates at S1, S8, S9, S10, S14, S17, S21, S23, S25 — record the first full-run duration here.
