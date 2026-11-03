# UI Pop HUD and Inventory — S25 Validation

Date: 2026-11-03. Branch: `feature/ui-pop-hud-inventory`.
S25 base: `6fd56590542210f0a554cf05505f4c57b0097a04`.
Feature base (`UI_POP_BASE`): `81454df`.
Implementation commit: `94a4a6009b739caf9f9dc4db3c7971db81d98245`.

## Scope and decisions

S25 finishes the P0/P1 regression record and revisits the short-landscape item
explanation sheet. The user requested exactly one full local E2E invocation,
and explicitly selected Luna xhigh / Sol low subagents. Full E2E runs belong
to the lead; implementation agents must not run the suite.

The chosen card composition puts Use and Close together in one footer row,
outside the body scrollport. The passive delay certificate has Close only.
Controls retain 44px minimum targets and DOM order follows visual order.
Discard cards retain their existing composition. Gameplay, RNG, save format,
railway data and share text remain outside the change.

## Execution evidence

Evidence is saved under `.claude/logs/uipop-s25/`. Final frontend gates:

| Command | Result | Wall time | Evidence |
| --- | --- | --- | --- |
| `npm run typecheck` (first lead attempt) | Failed: new E2E callback omitted its `testInfo` parameter; test code only, corrected before E2E | 9.460 s | `typecheck.log`, `typecheck.json` |
| `npm run typecheck` (final) | Passed | 10.220 s | `typecheck-final.log`, `typecheck-final.json` |
| `npm test` | 62 files passed; 1,233 passed, 1 existing skipped | 11.235 s (Vitest: 10.65 s) | `vitest.log`, `vitest.json` |
| `npm run build` | Passed; existing >500 kB chunk warning | 10.639 s | `build.log`, `build.json` |
| Full local Playwright command below | 330 passed, 9 existing skipped, 0 failed, 0 flaky; each project 110 passed / 3 skipped | 1,055.804 s (17 min 36 s) | `e2e-full.log`, `e2e-full.json`, `e2e-full-report.json`, `e2e-summary.json` |

The full local E2E invocation completed: 339 cases across desktop Chromium,
phone Chromium and desktop Firefox, two workers, zero retries in every project.
Exactly one full invocation was run; there were no targeted E2E test runs or
reruns. The nine skips are the existing project-specific touch/pointer cases.
Started 05:05:11 UTC and completed 05:22:46 UTC on 2026-11-03. Its command,
timestamps and result are persisted in `e2e-full.json`, complete output in
`e2e-full.log`, and the structured report in `e2e-full-report.json`.

```bash
env -u WAYLAND_DISPLAY \
  PLAYWRIGHT_JSON_OUTPUT_FILE=.claude/logs/uipop-s25/e2e-full-report.json \
  npx playwright test --workers=2 --project=desktop-chromium \
  --project=phone-chromium --project=desktop-firefox --reporter=list,json
```

The card implementer ran `npm run typecheck` (pass) and
`npx vitest run tests/unit/item-card.test.ts` (40 passed). Two added tests verify
Use-before-Close order, disabled-reason association and the passive-only footer.
The lead inspected the component/CSS/unit-test diff and the screenshots.

Direct browser probes (no Playwright test-runner invocation):

- `node .claude/logs/uipop-s25/card-probe.mjs`: native Chromium popover using the
  production card components at 667×375, 640×400, 320×640 and 1280×800. At the
  short-landscape sizes the selected rapid card and passive certificate show
  their full effect sentence at initial `scrollTop=0`; footer buttons are 44px
  high. Geometry: `card-probe.json`; screenshots: `card-*.png`.
- `node .claude/logs/uipop-s25/full-app-card-probe.mjs`: actual GameApp with a
  real-data, engine-built turn-23 save (three items, two active effects), resumed
  and staged through UI controls. At 667×375, the scrollport is y28–108 and the
  effect sentence y66–85; at 640×400, the scrollport is y28–114 and the same
  sentence y66–85. Both start at scrollTop 0; Use and Close are side by side and
  44px high. Geometry: `full-app-card-probe.json`; screenshots:
  `full-app-card-667x375.png`, `full-app-card-640x400.png`.

Both probe development servers on port 4325 were stopped after use.

## Independent review and diff inspection

Sol low's final independent review passed with no unresolved blockers
(`.claude/logs/uipop-s25/review.md`). Before E2E, review caught a test that
attempted to click the always-visible but disabled Skip button; it now waits
for and clicks only an enabled Skip. The lead inspected the complete source,
CSS and test diff; no forbidden edits, new skips, stubs, swallowed errors or
hard-coded implementation substitutes were found.

`verify_delegation.py --base 6fd5659` collected all eight expected files with
zero placeholders, out-of-scope files or missing files, and seven deletion
groups. It exited 2 because its heuristic flags two removed assertion lines
(`verify-delegation.json`). Independent review adjudicated both:

- The previous one-line action-visibility assertion is expanded with the same
  three expected values plus footer placement, hit tests and 44px dimensions.
- The old requirement that every wide, short card must overflow described the
  two-row footer. The new one-row footer can fit all content. Initial effect
  visibility is now mandatory; overflow requires positive scrollTop, and fully
  fitting content requires scrollTop 0. Both paths recheck visible actions.

These are justified assertion updates for the requested presentation change,
not weakened acceptance checks. The remaining coverage limit is that a case
with actual overflow is not independently required in every browser. In this
full local run, the structured annotations confirm four positive-scroll
overflow checks in each of the three projects, with visible footer controls.

The initial headless implementation attempt was interrupted before it produced
edits or a result. Work resumed with separate native subagents for the card and
regression tests. No E2E invocation was made by that attempt.

## S25 regression coverage

- `menu, log, and item card transitions preserve a selected draft`: the same
  staged double ticket survives menu → log → card → menu, with only the active
  surface visible.
- `ordinary item toast expires while failed-save status remains visible`:
  a real double-ticket use creates the normal toast and a failed save creates
  the sticky warning. After 4,200ms the normal toast is gone and both the warning
  toast and full HUD save-failure text remain.
- Existing populated-phone coverage now taps the staged item, reads the card,
  closes it and verifies the selection remains. Existing short-landscape
  coverage verifies initial effect text against the actual body clip, same-row
  actions, hit tests and 44px minimum targets before and after a scroll attempt.
- The passive certificate has no Use action; its initial effect and lone Close
  are checked at both 667×375 and 640×400.
- `expires an ordinary toast in production GameApp without rendering HUD or
  legend again`: a real GameApp mounts the actual HUD and legend through render
  counters (only map behavior is stubbed). Engine-built save → resume → roll →
  skip produces one normal toast. It remains at 3,999ms, disappears at 4,000ms,
  and neither settled render counter increases. Positive counters establish
  that both real components rendered before the expiry check.

## CI evidence

Before S25, commit `6fd5659` passed all four CI E2E projects in
[run 41576338269](https://github.com/Yuulis/yamanote-line-sugoroku/actions/runs/41576338269):
desktop Chromium 108 passed / 3 skipped (4.6 min), phone Chromium 108 / 3 (6.3 min),
desktop Firefox 108 / 3 (3.3 min), desktop WebKit 108 / 3 (4.4 min).
These results establish the starting state and do not verify the S25 changes.

S25 implementation `94a4a60` passed the complete CI workflow in
[run 41583743291](https://github.com/Yuulis/yamanote-line-sugoroku/actions/runs/41583743291):

| E2E project | Result | Reported test-run duration |
| --- | --- | --- |
| Desktop Chromium | 110 passed, 3 existing skipped | 4.6 min |
| Phone Chromium | 110 passed, 3 existing skipped | 5.1 min |
| Desktop Firefox | 110 passed, 3 existing skipped | 4.2 min |
| Desktop WebKit | 110 passed, 3 existing skipped | 5.7 min |

All 440 browser cases passed without failed or flaky cases; 12 existing cases
were skipped. The aggregate E2E gate also passed. Frontend typecheck, build and
62 Vitest files (1,233 passed, 1 existing skipped; 15.96 s) passed. The data
pipeline's ruff, formatting, type checking and committed-bundle validation
passed; pytest reported 647 passed / 68 skipped in 66.50 s. Full metadata and
output are in `ci-source.json` and `ci-source.log` under the evidence directory.
WebKit is verified for the S25 implementation, not pending.

## Forbidden-path audit

```bash
git diff --exit-code 81454df -- src/features/game/engine/ \
  src/features/game/gameSession.ts src/features/game/itemSession.ts \
  src/features/game/store/ src/types/network.ts public/data/ data/ \
  src/features/game/shareText.ts
```

Initial and integrated-tree audit: exit 0, empty output. `git diff --check`
also passed. The repeated audit after committing the implementation also
exited 0 with empty output in 0.008 s (`forbidden-audit.json`,
`forbidden-audit.log`). Package manifests, DESIGN.md and STATE.md are unchanged.

## Limits

WebKit runs in CI only. The local Python pipeline suite is outside this
presentation-only step; the handoff records an earlier local N02 staging hash
failure. It will not run concurrently with the full browser suite.
