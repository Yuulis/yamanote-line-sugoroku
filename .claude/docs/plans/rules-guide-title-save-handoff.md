# Rules guide (#60) + title / save UX (#68) — Handoff

Resume from here. Plan: `.claude/docs/plans/rules-guide-title-save-plan.md` (Codex validation: round 1 NEEDS_REVISION →
Revision 1 → round 2 NEEDS_REVISION → Revision 2 → **round 3 PASS**, 2026-11-17). **Approved by the user 2026-11-17.** Brief: `.claude/docs/research/feature-rules-guide-and-title-save-ux-brief.md`. Scan:
`.claude/docs/research/feature-rules-guide-and-title-save-ux-codebase.md`. Step prompts:
`.claude/docs/plans/rules-guide-title-save-prompts.md`.
Codex consults:
- scope `.claude/logs/codex/20261117T012737Z-rgts-scope.md` (COMPLEX)
- architecture `.claude/logs/codex/20261117T013256Z-rgts-arch.md`
- plan `.claude/logs/codex/20261117T013724Z-rgts-plan.md`
- validation `.claude/logs/codex/20261117T014327Z-rgts-validate.md` (NEEDS_REVISION)
- re-validation `.claude/logs/codex/20261117T015133Z-rgts-revalidate.md` (NEEDS_REVISION)
- final validation `.claude/logs/codex/20261117T015613Z-rgts-revalidate2.md` (**PASS**)

Process:
- Branch: `feature/rules-guide-title-save` (from develop a8fc2b7, v0.16.0); no upstream yet. Flow: feature → PR →
  develop → PR → master.
- Pacing: **stop after every step** from 6B (user 2026-11-17 on resuming: 「ステップごとに止めて」). Earlier: user asked to stop after Step 6A (after its review, commit, push and CI). Before that: continuous from Step 2A until the user says otherwise (user 2026-11-17 after 1B: 「こちらから指示を出すまで作業は止めなくて良い」); still verify, review, commit, push and check CI per step. Earlier pacing (user 2026-11-17): stop for user review only after steps with a visible change. The no-visual steps 1A, 2A, 2B, 3, 5, 7A, 8A, 8B, 9 and 10A continue to the next step after verification, commit, push and CI.
- Roles (2026-11-17, from Step 2A): **Claude subagents** — `general-purpose-sonnet` implements, `general-purpose-opus` reviews, the lead verifies (user: 「Claudeサブエージェントを使うこと」). Steps 1A–1B used: Codex Luna implements (`--model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh
  --timeout 2400`), Sol low reviews, and the lead verifies, commits, pushes and checks CI after every push.
- Local E2E: targeted specs only, `--workers=2`, tag-aware grep `'TITLE(?: @layout)?$'`. The full 4-project matrix
  runs in CI (a working-branch push runs desktop-chromium only; the PR runs the full matrix; phone runs `@layout`
  only).
- Hard constraints: presentation only (no engine / RNG / persistence serialization / settings format /
  `src/types/network.ts` / public / data / deps). Existing tests change only per the plan's
  deliberate-edit table. Phone HUD 252px at 320x568 and desktop no-scroll unchanged.

## Step status

| Step | Status | Commit | Evidence |
|---|---|---|---|
| 1A resume presentation model | done | (this commit) | Luna xhigh; 2 new files 129 LOC; typecheck/build pass; vitest 2219 passed / 1 skipped; verify_delegation 0 actionable; Sol low APPROVE (`.claude/logs/codex/20261117T022128Z-rgts-1a-review.md`) |
| 1B resume label + overwrite confirm + delete link | done | (this commit) | Interrupted once by the user, then finished by Luna xhigh from the partial tree. ~190 LOC; typecheck/build pass; vitest 2219 passed / 1 skipped; desktop-chromium E2E 77 passed (title-save-ux + six edited specs); phone @layout 1 passed; verify_delegation 0 actionable. Sol low REQUEST_CHANGES (P2: wrap test counted rects, not lines) fixed by the lead (distinct line tops + no overflow) and re-run green. Screenshots `.claude/logs/screenshots/rgts-1b-*.png`. |
| 2A rules model: interfaces + config figures | done | (this commit) | Sonnet implements; 234 non-blank LOC (over the ~200 cap only by tests, accepted). Opus review REQUEST_CHANGES (direction qualifier for non-target lines, ambiguous 「ほかの路線」, harmful 0% gate, copy polish, dead branch) fixed by Sonnet. Lead added optional `targetServiceName` (fallback 「目標路線」) so 2B passes 山手線 instead of hard-coding it. typecheck/build pass; vitest 2227 passed / 1 skipped; verify_delegation 0 actionable. |
| 2B rules model: full sections, items, prose | done | (this commit) | Sonnet implements (+ `startStationName`, `targetDirectionLabel` options). Opus review REQUEST_CHANGES (direction re-draw at every landing unmentioned, goal ambiguity before 30/30, おまかせ label/stop conditions, copy polish, duration gate, reduced-motion note) fixed by Sonnet; lead made the re-draw sentence unconditional. typecheck/build pass; vitest 2238 passed / 1 skipped; no 2A assertion removed. Plan amended (Interface Design, Step 4, Step 13) for name injection. |
| 3 shared RulesGuide body + phone reduction | done | (this commit) | Sonnet implements; ~306 non-blank LOC (113 CSS) over the ~200 cap, accepted (component+CSS+tests belong together). Opus review REQUEST_CHANGES (no keep-all for PhraseText; phone hid beneficial timing that appears nowhere else; nav button overrode pressed state) fixed; exported `focusRulesSection(root, idPrefix, sectionId)` for Step 5 deep links; `--rules-guide-scroll-margin` for sticky host headers. typecheck/build pass; vitest 2244 passed / 1 skipped. Note for Step 4: `.title-screen__credits-screen section` would override `.rules-guide__section` borders if reused; the title host must provide a scroll container. |
| 4 title 遊び方 sub-screen + short title copy | done | (this commit) | Sonnet implements; ~112 src/CSS + ~194 test LOC (over cap by required tests, accepted). Title copy: 「新橋から出発し、山手線**外回り**の全30区間を1周するのが目標です。」「乗換駅で止まると、次に乗る路線を抽選で決めます。」(lead: 止まると, since passing does not draw)「アイテムを使って、より少ないターンでの1周を目指しましょう。」 Opus review REQUEST_CHANGES (title copy lacked PhraseText/keep-all; 遊び方 above はじめから competed with the main choices) fixed: 遊び方 now below the play actions, above クレジット; stale-view guard; focusable rules scroller. typecheck/build pass; vitest 2248 passed / 1 skipped; desktop E2E 6 passed; phone @layout 2 passed (incl. はじめから above the fold with a save). Screenshots `rgts-4-*.png`. |
| 5 RulesDialog lifecycle | done | (this commit) | Sonnet implements; ~398 non-blank LOC (109 component, 65 CSS, 224 tests) over cap, accepted (one cohesive unrouted unit). Opus review (real-browser Playwright probe) REQUEST_CHANGES: drag-select ending on the backdrop closed the dialog in Chromium; body not keyboard-scrollable; focus restored before sibling DOM mutations. Fixed: press-origin backdrop guard, `tabIndex=0` body, restore in a microtask that yields to another `dialog[open]`, exported `isFocusRestorable` (fallback may be aria-disabled, never native :disabled). Step 6A contracts recorded in the plan. typecheck/build pass; vitest 2268 passed / 1 skipped. |
| 6A menu + lottery entry points, rulesOpen suspension | done | (this commit) | **Opus** implements (cross-cutting suspension). ~125 src/CSS + ~310 test LOC over cap, accepted (plan-listed tests). Deviations accepted by review: lottery 詳しく is a sibling in `.game-panel__lottery-row` (keeps 7 exact-text assertions); `OpenRules(sectionId, opener)` child API + `PanelOpenRules(sectionId, opener, getFallbackFocus)` GamePanel→GameApp prop; menu stays open while rules are open. Opus review APPROVE + P2 BEM rename (`.rules-opener`), P3s (single `openRules` callback, discriminating auto-roll test — mutation check fails without the wiring, short-landscape margin, dialog bottom gutter) applied. 320x568 dialog verified bounded in real Chromium. typecheck/build pass; vitest 2274 passed / 1 skipped; rules-guide E2E 6, auto-roll-lifecycle 9, accessibility/ui-pop/text-wrapping targeted cases passed. Screenshots `rgts-6a-*.png`. |
| 6B item-card 詳しく handoff + pointer visibility | done | (this commit) | Opus implements; ~185 LOC (within cap). Card footer 使う｜詳しく｜閉じる; opener = durable slot trigger focused before the card closes. Opus review (real Chromium/Firefox/phone-touch traces): behaviour correct, but REQUEST_CHANGES because nothing locked the pre-close focus — fixed with a showModal-time activeElement unit assertion and a no-tooltip E2E assertion (mutation check: both fail without the pre-focus). 詳しく font matched to 14px; dead footer-less branch removed. typecheck/build pass; vitest 2278 passed / 1 skipped; rules-guide+items desktop E2E 32 passed / 1 pre-existing skip; phone @layout pointer case passed. Risk: headless Firefox/WebKit pointer media in CI (test fails loudly if misreported). |
| 7A save-status model + standalone popover | pending | — | — |
| 7B HUD integration + hit area + geometry | pending | — | — |
| 8A save-attempt identity | pending | — | — |
| 8B notice store, eligibility, announcement arbitration | pending | — | — |
| 9 toast queue notice entry + host announceability | pending | — | — |
| 10A notice hook + fixture seeding | pending | — | — |
| 10B visible notice delivery + live region | pending | — | — |
| 11 map modes + title camera | pending | — | — |
| 12A paint readiness + SVG placeholder + retry | pending | — | — |
| 12B navigation visibility + layout readiness waits | pending | — | — |
| 13 EditionApp loading / failure title paths | pending | — | — |
| 14 final integration + boundary audit | pending | — | — |

## Next

1A and 1B done; user reviewed 1B and asked to drop 「から」 from the resume label (follow-up commit 「1B-2」). 1B follow-up 33d746e CI green. 2A–6A done. 6A CI green (2539e24). 6B done; paused for user review (per-step pacing). Next Step 7A (InventoryPanel takes the same `openRules`; see the plan's 6A Amendment item 6). Callers must pass targetServiceName / startStationName / targetDirectionLabel (plan Step 4 amendment). The DESIGN.md decision rows (dated 2026-11-17) and the STATE.md block are recorded. Approved extras: the in-game shortcut hint is hidden on touch devices, and single-edition loading shows the title with 遊び方.

## How to resume

1. `git switch feature/rules-guide-title-save && git log --oneline -3`. The last done step's commit is the next
   `<BASE_SHA>`.
2. Read the next pending step in the plan. Fill the common body plus that step's block from the prompts file, then
   run Luna.
3. Verify: the step's acceptance commands, `verify_delegation.py`, the forbidden-path diff, and that existing test
   edits match the plan's table. Feature test files created in an earlier step of this feature may be extended
   later. Only baseline test files (present at a8fc2b7) are restricted to the deliberate-edit table.
4. Sol-low review. On REQUEST_CHANGES, fix or re-delegate once.
5. Commit, push, check CI. Update this table (status, commit, evidence), then stop for user review.

## Follow-ups (out of scope)

- `tests/unit/credits-screen.test.ts`: its Escape case clicks the first button (the disabled はじめから) and never
  proves Credits opened. This false positive predates the feature; fix it with a precise selector and a positive
  heading assertion.

- #67 first-run hints reuse `OpenRules(sectionId)` / `RulesSectionId`.
- #71 phone sheet: re-check the save-mark hit box and the rules dialog on the sheet layout.
