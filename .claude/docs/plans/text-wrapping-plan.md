# Text Wrapping and HUD Readability (issue #70) — Implementation Plan

Status: **approved 2026-11-10 as Revision 3 (lean)**. Revision 2 incorporated the NEEDS_REVISION validation; re-validation left only a brief wording fix, now applied. Branch: `feature/text-wrapping` from `develop` a375384. Pacing: stop after every step. Implementer: Codex Luna xhigh; lead verifies.

## Revision 3 — lean test scope (user 2026-11-10, overrides §3 where they differ)

The user chose a lean test scope (target 700–1,000 LOC, 8 steps, one pause per step). Architecture, CSS dimensions, PhraseText rules, display-treatment table and forbidden areas are unchanged. Cuts per step:

| Step | Keep | Drop / shrink |
|---|---|---|
| 1 | One unit: `measureTextLayout` + `expectSingleLine`; `layout measurement` covers one line, wrap, 2-line clamp, `normal` error, one ancestor-clip case | Exhaustive Unicode offset cases |
| 2 | 2a CSS as written; one `phone HUD budget` test at 320×568 and 412×839 (idle vs. long-text state, full inventory); one `HUD breakpoint isolation` test at 600/601 and 667×375 | Save success/failure, effects and staged sweeps; 390×844 sweep |
| 3 | As written (unit only) | — |
| 4 | 4a only | 4b `long-name lottery motion` E2E; instead Step 7 saves one no-preference lottery screenshot of a long name for lead visual review (no assertions) |
| 5 | 5a + 5c; `dialog wrapping` at 320 and 1280 (route dialog, roll-adjust): one-line buttons, no overflow, plus exact `toHaveAccessibleName` for one radio and the dialog heading; one `clear-screen wrapping` test at 320 (one-line actions, no overflow, paging) | 5b exhaustive accessible-text suite; 5d share/clipboard branches |
| 6 | 6a; one `panel wrapping` containment test | 6b `lottery announcement contracts`; 6c `unchanged text surfaces` (existing tests cover them) |
| 7 | 7a longest ride and direction states with restore + one valid turn; `longest text` at 320×568, 412×839, 1280×800; one `fallback wrapping` containment check run on Firefox/WebKit at 390px | Chromium forced keep-all case; overlong-fixture ellipsis proof beyond one screenshot |
| 8 | Release note, per-title `--list` audit of the kept titles, targeted regression, final-SHA CI | — |

Kept new test titles: `layout measurement`, `phone HUD budget`, `HUD breakpoint isolation`, `dialog wrapping`, `clear-screen wrapping`, `panel wrapping`, `longest text`, `fallback wrapping`. Acceptance commands in §3 apply with the dropped titles removed from `--grep`.

Inputs:

- Brief: `.claude/docs/research/feature-text-wrapping-readability-brief.md`
- Scan: `.claude/docs/research/feature-text-wrapping-readability-codebase.md`
- Architecture: `.claude/logs/codex/20261110T013133Z-ttw-arch.md`
- Original plan: `.claude/logs/codex/20261110T013414Z-ttw-plan.md`
- Validation: `.claude/logs/codex/20261110T013652Z-ttw-validate.md`

## 1. Scope and acceptance criteria

Improve Japanese wrapping through render-time `<wbr>` hints and CSS. Phone HUD ride and direction values use 15px text, 17px line-height, and a constant 34px two-line reservation; labels use 13px. Keep the direction column at half width alongside the roll value. Desktop and short-landscape HUD remain one-line ellipsis.

At 390px and 1280px, supported phrase detection or explicit hints provide natural breaks. At 320px, containment remains mandatory. **A single unbreakable token longer than its available width may break within the token: containment wins.** This qualifies the brief's “never mid-word” success criterion; no dictionary-level Japanese segmentation guarantee is made. Dedicated fitting-fragment cases verify hinted breaks, separately from overlong-token containment.

Short action labels stay one line, with containers wrapping or stacking whole controls. The existing draft dice label may retain its intentional multi-line layout; it is not reclassified as a short action label. HUD panel height remains at most 45% of phone viewport height, initial inventory slots remain fully visible without scrolling, and dice coordinates remain stable within ±1px across states. Preserve 56px slots, 44px minimum interactive targets, desktop non-scroll, full DOM text and existing string contracts.

Forbidden throughout: engine, RNG, save schema/version or persistence logic, `src/types/network.ts`, public data/pipeline, presentation/resolver return strings, dependencies/lockfile, MapLibre labels/popups, animation policy/timing, and Playwright project configuration. No version bump, tag, release, or deploy. No tap-to-expand HUD, version-text enlargement, or phone subtitle change.

### Display treatment

| Surface | Treatment in this change |
|---|---|
| HUD ride/direction | Improve now: phrase hints and phone-only two-line reservation/clamp |
| LineBadge names | Improve now: render hints; preserve mark/code, showName=false and reveal-specific one-line ellipsis |
| Item dialogs and roll-adjust | Improve now: long visible copy wraps; short controls stay one line |
| GamePanel staged summary, lottery text, route overview/candidates | Improve now: visual hints and containment; raw announcement composition unchanged |
| Clear-screen controls | Improve now: actions, share and paging fit whole one-line controls |
| Arrival banner station | Unchanged; 28px, one-line ellipsis. Regression check placement and containment |
| Toasts | Unchanged; regression check viewport containment |
| Title-screen resume button | Unchanged; regression check long saved-station label at 320px |
| Clear-screen summary sentences and history entries | **Improve now (user 2026-11-10, added to Step 6)**: PhraseText + phrase CSS; text, pagination and share strings unchanged. Reason: the goal-turn sentence broke mid-word (「1駅移/動」「到/着」) at 320px |

## 2. Architecture and execution contract

`PhraseText({text})` returns a Fragment of original string slices and `<wbr>` nodes, with no wrapper, normalization, zero-width text, HTML parsing, dictionary or data changes. Existing outer spans retain refs, attributes, title and explicit aria-labels. Plain strings continue into live regions, saves, share text and presentation functions.

Use `word-break: keep-all; overflow-wrap: anywhere` with `auto-phrase` inside `@supports`. Apply normal wrapping only to intended long-copy selectors; preserve higher-specificity desktop/landscape and lottery reveal ellipsis. Use `text-wrap: balance` only on `.dialog__title` and `.item-dialog__hint--target`.

Eight dependency-ordered stages follow. Lettered substeps are separate, reviewable implementation units, each estimated at no more than 150 changed LOC including tests. If a unit grows beyond this, split before execution without dropping acceptance coverage. Suggested lanes are advisory: Sol owns judgment, layout and browser behavior; Luna is eligible only for fixed, mechanically checkable edits after the lead specifies the exact patch. The executor does not delegate.

Every implementation handoff includes its base SHA, exact allowed paths, forbidden areas, commands and acceptance criteria. Lead inspects the full diff and independently runs acceptance checks before advancing. Run `npm run typecheck` and the named targeted checks for each unit; full tests/build at integration boundaries and Step 8. Red and Green belong to the same unit. All local browser commands below specify exact title patterns, projects and `--workers=2`; new titles are an implementation contract, not existing tests.

## 3. Implementation steps

### Step 1 — Establish trustworthy browser measurement

**Lane:** Sol. **Files:** new `tests/e2e/support/layout.ts`, new `tests/e2e/text-wrapping.spec.ts`. **Forbidden:** all production files and existing test expectations.

- **1a, 90–130 LOC:** implement `measureTextLayout(locator)` returning original text, width fit, raw and visible line counts, line-height, font size, height, clamp count, content excess and UTF-16 break/hint offsets. Await `document.fonts.ready`; fail on missing targets. Walk text nodes, ignore empty/whitespace-only and wbr rectangles, group tops within 1px, and never split surrogate pairs when measuring offsets.
- Line-height contract: this detailed API accepts only computed, finite positive pixel line-heights; `normal` throws an actionable error. Controlled fixtures use explicit numeric line-height. Production HUD targets receive explicit line-height in Step 2. For existing buttons with `normal`, use a separate `expectSingleLine` path based on Range tops and width/containment only; it must not call the numeric API or infer a line-height from font size. Do not change production line-height just for measurement.
- **1b, 80–120 LOC:** controlled-DOM tests titled `layout measurement` cover one line, ordinary wrapping, two-line clamp, Unicode/wbr, explicit failure on normal, and clipping by a nested scrolled ancestor. Intersect visible glyph rectangles with the viewport, target clipping box and every relevant ancestor overflow scrollport, per axis, using client-area boundaries. Keep partially visible and fully contained results distinct. Separately compare inventory slot rectangles with the panel's inner scrollport; glyph visibility cannot prove a whole slot is visible.
- One-line assertions require raw line count 1, width fit and complete visibility. Clamp assertions require height 34px, line-height 17px, clamp 2 and at most two visible lines; do not require raw Range line count ≤2. Overlong fixtures must demonstrate content excess without expanding the box. Keep screenshot evidence for the painted ellipsis rather than claiming DOM geometry proves its glyph.

Acceptance:

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --workers=2 --grep 'layout measurement'
```

### Step 2 — Prove the phone HUD budget before adding hints

**Lane:** Sol. **Files:** `src/features/game/components/GameHud.tsx`, `src/styles.css`, `tests/e2e/text-wrapping.spec.ts`. **Forbidden:** PhraseText integration, desktop/short-landscape rule changes, relaxed dimensions or assertions.

- **2a, 60–90 LOC:** add explicit ride/direction row and two-line value modifiers. In the phone rules only, set grid rows `18px 34px 34px 18px` (104px), normal dt/dd height/min/max-height 18px, and ride/direction dd height/min/max-height 34px. Their labels remain 18px and align to the first line/top, rather than vertically centering. Other values retain one-line 15px/18px; two-line values use 15px/17px, height/min/max-height 34px and two-line clamp. Labels use 13px. Override inherited `--hud-row-height: 24px` dimensions explicitly; changing grid rows alone is insufficient. Keep the direction half-column and roll co-location.
- Choose **252px target**: reduce phone `.game-panel__actions` bottom margin **4→2px** and phone `.item-inventory` bottom margin **4→0px**. Budget: padding 16 + stats 104 + actions 56 + action margin 2 + inventory heading (16+2) 18 + slots 56 = 252px. Stats margin/gap are zero; panel has no border; slot border is included in 56px border-box. Without action-margin reduction the corrected budget is 254px, not 252px.
- **2b, 100–140 LOC:** `phone HUD budget` test sweeps 320×568, 390×844 and 412×839 across idle, changed text, empty/full/staged inventory, effects and save success/failure. At scrollTop 0, inventory heading and every initial 56px slot fit completely within panel scrollport; panel ≤255.6px at 320×568, horizontal fit, ≥44px targets, fixed 34px reservations and dice relative/viewport coordinates stable ±1px across states. Lower auxiliary content may remain scroll-reachable.
- **2c, 50–90 LOC:** `HUD breakpoint isolation` tests 600×844 versus 601×844, desktop 1280×800, and short landscape 667×375 (also existing 640×400 coverage). Assert phone-only styles at 600, existing non-phone styles at 601, and existing short-landscape one-line/18px-row behavior at 667×375. Do not edit those existing rule blocks to make the phone design fit.
- Hard gate: measure padding/margins/gaps/borders/shrink if the budget fails; fix unintended dimensions first. If structural redesign is required, return measurements and a concrete proposal to the lead before continuing. Never reduce font/slot/target sizes or loosen 45%/visibility assertions.

Acceptance:

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=phone-chromium --workers=2 --grep 'phone HUD budget|HUD breakpoint isolation'
npm run test:e2e -- tests/e2e/hud-layout.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'keeps the dice button|fits all three action labels|populated HUD|phone populated layout|short landscape keeps staged slots'
```

### Step 3 — Implement PhraseText with exact string preservation

**Lane:** Sol. **Files:** new `src/features/game/components/PhraseText.tsx`, new `tests/unit/phrase-text.test.ts`. **Forbidden:** CSS, call sites, data/string generators, dependencies.

**3a, 100–145 LOC:** tests first, then implementation. Hint after runs of ASCII/full-width spaces; before opening `(` `（` `[` `［` `「` `『`; after corresponding closers; after `・`, `–`, `—`, `、`, `。`, `：`; before `方面`. Suppress endpoints, duplicate offsets, immediately after openers and immediately before closers/punctuation. Preserve original code units and whitespace. Cover empty, delimiter-free, consecutive spaces, consecutive delimiters, bracket adjacency, HTML-like strings (including `<script>` as inert text), surrogate pairs, combining marks and ZWJ sequences. Verify exact textContent for every case, expected hint positions, no wrapper/HTML nodes and no inserted text characters. Keep combining/ZWJ sequences intact; no candidate may split a grapheme sequence. Use an existing platform facility if needed, not a new dependency.

Acceptance (no E2E needed for this isolated component):

```bash
npm run typecheck
npm test -- tests/unit/phrase-text.test.ts
```

### Step 4 — Connect HUD and LineBadge, including animated consumers

**Lane:** Sol. **Files:** `src/features/game/components/GameHud.tsx`, `src/features/game/components/LineBadge.tsx`, `src/styles.css`, `tests/unit/game-hud.test.ts`, new `tests/unit/line-badge.test.ts`, `tests/e2e/text-wrapping.spec.ts`. **Read-only impact review:** `src/features/game/components/LotteryReveal.tsx` and its `LotteryRow`. **Forbidden:** animation implementation/timings, ref ownership, presentation strings and desktop/landscape layout.

- **4a, 65–100 LOC:** connect visual ride/direction and badge-name text; add targeted phrase CSS. Preserve outer span identity/ref, title and attributes; showName=false renders no name. Check CSS specificity so phone clamp wins only on phones and reveal name remains its existing one-line ellipsis. Unit tests assert exact original text, title, modifiers, hidden-name and ref contracts.
- **4b, 100–145 LOC:** new `long-name lottery motion` browser test with explicit `reducedMotion: 'no-preference'` and long names. LotteryReveal uses LineBadge for intermediate and final frames; LotteryRow measures source and HUD target getBoundingClientRect, so changed dimensions affect flip/settle flight. Observe flip→settle, final source-to-two-line-HUD landing, final value and cleanup; exercise Skip and an off-scrollport/unavailable target leading to existing fade fallback. Use real browser geometry and stable stage observation, not arbitrary sleep or new production test hooks. Keep existing motion unit tests as regression evidence. Do not rewrite animation behavior as part of this feature.

Acceptance:

```bash
npm run typecheck
npm test -- tests/unit/phrase-text.test.ts tests/unit/game-hud.test.ts tests/unit/line-badge.test.ts tests/unit/turn-moment-components.test.ts
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'long-name lottery motion|phone HUD budget|HUD breakpoint isolation'
```

### Step 5 — Dialogs, exact accessible strings and clear-screen controls

**Lane:** Sol. **Files:** `src/features/game/components/ItemUseDialog.tsx`, `src/features/game/components/RollAdjustment.tsx`, `src/styles.css`, `tests/e2e/text-wrapping.spec.ts`. **Read-only consumers:** `src/features/game/components/ClearScreen.tsx`. **Forbidden:** announcement generation, focus semantics, clear/history/share logic and existing CSS contract block restructuring.

- **5a, 75–115 LOC:** connect visible item group/option/guidance/direction and adjust-choice copy. Long flex children get min-width:0. Dialog action groups flex-wrap; button text nowrap and no shrinking of labels; resolve adjustment width:100% by wrapping whole buttons when needed. Limit balance to the two agreed selectors. `dialog wrapping` checks 320/390/1280px, long route/direction options, suspended lists, empty choices, disabled confirmation, roll-adjust, keyboard/cancel and focus return.
- **5b, 90–140 LOC:** `accessible text contracts` runs in a real browser. Assert `toHaveAccessibleName(expected)` exact equality, never substring/regex approximations, for route/direction radios, dialog headings and explicitly labelled controls; assert original title and aria-label attributes exactly. Capture RollAdjustment and turn-end live-region strings and compare directly with the pre-change expected raw strings, including punctuation/spacing. Use deterministic independent expectations, not textContent as the accessible-name oracle. Include multi-fragment wbr names; DOM equality alone is insufficient. No forced aria-label additions to disguise a regression.
- **5c, 45–75 LOC:** target nowrap declarations to card actions, staged-summary actions, legend controls, clear actions/share/paging. Existing clear actions use grid `2fr 1fr`: use `minmax(0, 2fr) minmax(0, 1fr)` for shrinkable tracks and stack to one column at ≤390px so the narrower second cell cannot overflow a whole label. Keep buttons min-width:0 where appropriate, but never clip the label. Add flex-wrap to paging, retain share wrapping, and constrain fallback textarea to its container with border-box/max-width:100%. Preserve existing control semantics and target sizes.
- **5d, 95–145 LOC:** `clear-screen wrapping` opens the actual clear screen at 320×568 and 390×844 with multi-page history. Navigate forward/back and verify history text/page membership; test native share available and unavailable, clipboard rejection → visible fallback textarea, exact share text and textarea containment. Check each primary/share/paging action has one line, no action/control/body horizontal overflow, and all controls remain reachable by intended scrolling.

CSS guardrail: retain the **single-selector rule blocks in place** required by `tests/unit/game-hud.test.ts:540–548`, `tests/unit/item-card.test.ts:238–242,581–594`, and `tests/unit/item-controls.test.ts:371–382`. Add declarations; do not merge/move blocks or relocate their 44px/56px/border-box declarations. Preserve popover rule order, no display on its base block, close dimensions and all item-card/slot/inventory motion prohibitions.

Acceptance:

```bash
npm run typecheck
npm test -- tests/unit/game-hud.test.ts tests/unit/item-card.test.ts tests/unit/item-controls.test.ts
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'dialog wrapping|accessible text contracts|clear-screen wrapping'
npm run test:e2e -- tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'item controls and the decision sheet fit|ticket card opens|Escape closes a native adjust dialog'
```

### Step 6 — Related GamePanel displays and unchanged-surface regressions

**Lane:** Sol for contracts/tests; Luna eligible only for lead-specified visual substitutions. **Files:** `src/features/game/components/GamePanel.tsx`, `src/styles.css`, `tests/e2e/text-wrapping.spec.ts`. **Forbidden:** invisible/raw announcement composition, history/title/toast/arrival implementations, resolver/share/save strings and map behavior.

- **6a, 45–75 LOC:** PhraseText at staged summary, visible lottery text, route overview and candidates, with targeted containment CSS. Preserve every original string expression and separate announcement path.
- **6b, 85–130 LOC:** `panel wrapping` covers long panel displays, staged action and map-free route operation. `lottery announcement contracts` directly observes visible lottery text and separately generated live-region text at publication. Compare each against its own exact pre-change expected string and verify their existing relationship, including any prefixes/suffixes; do not assume full equality if their existing compositions differ. Confirm no early/duplicate/hidden announcements and retain turn-end equality checks from 5b.
- **6c, 65–110 LOC:** `unchanged text surfaces` verifies title resume label with a longest-station save at 320px, multi-page clear history text, arrival station computed 28px/nowrap/ellipsis and placement, and toast viewport containment. No new PhraseText or typography changes on these surfaces. Use no-preference explicitly for arrival animation checks; default reduce cannot exercise the banner.

Acceptance:

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'panel wrapping|lottery announcement contracts|unchanged text surfaces'
npm run test:e2e -- tests/e2e/accessibility.spec.ts tests/e2e/ui-pop.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'text route view lists|menu, log, and item card transitions'
```

### Step 7 — True longest real-data states and browser fallback

**Lane:** Sol. **Files:** new `tests/e2e/support/textWrappingState.ts`, `tests/e2e/hud-layout.spec.ts`, `tests/e2e/text-wrapping.spec.ts`. **Forbidden:** production/public data, schema shortcuts, shorter-state fallback, skips and weakened existing assertions.

- **7a, 90–140 LOC:** select maximum displayed serviceName via existing presentation resolver, and maximum valid directionLabel separately, stable ID tie-break. Build coherent real-data states at a station with a next stop in the selected direction; reconcile related state fields and restore through serializeGame/writeSaveText/reload/resume. Replace hud-layout's first ≥5-character/raw-name search. Assert selected name/direction survives restoration exactly. For **each** longest state, perform one full turn, resolve any mandatory decision, assert advancement and valid in-network position/service/direction, and serialize/reload successfully with no invalid-save/error fallback. Merely displaying a forged state is not sufficient.
- **7b, 95–145 LOC:** `longest text` at 320×568, 390×844, 412×839 and 1280×800 verifies dimensions, exact title/text, containment, dice stability and valid turn behavior. Extend `HUD breakpoint isolation` with restored longest states at 600/601px and 667×375. Preserve existing width-fit assertions and update only misleading full-visibility commentary: full DOM/title remains, phone paint may ellipsize after two lines. Shared one-line helper migration must retain both line count and width assertions.
- **7c, 90–140 LOC:** `fallback wrapping` tests controlled fitting fragments where actual break offsets are hints/space boundaries, Chromium forced keep-all via test-only CSS, actual Firefox/WebKit at phone widths, and separate unbreakable-token containment. Record CSS.supports and computed styles; do not assume support from browser name. Separate overlong fixture proves excess content with a fixed 34px box and screenshot ellipsis. No substitute for actual dataset maxima.

Acceptance (desktop Firefox/WebKit tests explicitly resize to phone widths; no new projects):

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts tests/e2e/hud-layout.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'longest text|fallback wrapping|phone HUD budget|HUD breakpoint isolation|keeps the dice button'
xvfb-run -a npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-firefox --workers=2 --grep 'longest text|fallback wrapping|phone HUD budget|HUD breakpoint isolation'
E2E_WEBKIT=1 npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-webkit --workers=2 --grep 'longest text|fallback wrapping|phone HUD budget|HUD breakpoint isolation'
```

### Step 8 — Collection audit, final validation and working release note

**Lane:** Sol owns final review/failures; Luna eligible for mechanical collection audit and approved documentation text. **Files:** new `docs/manual/public-launch/release-notes-unreleased.md` only; fixes return to their owning substep/allowed files. **Forbidden:** package version, tags/releases/deploy, workflow weakening, unrequested cleanup.

**8a, 25–45 LOC:** add Japanese release note as a **new working filename**, not a claimed existing convention. Record visible behavior, two-line ellipsis/overlong-token exception and verified status. When the release version is decided later, rename to `docs/manual/public-launch/release-notes-<version>.md`; do not decide or bump a version here.

**8b, 0 production LOC:** collect every new title individually before targeted execution. An OR grep passing does not prove every branch exists. Required title fragments: `layout measurement`, `phone HUD budget`, `HUD breakpoint isolation`, `long-name lottery motion`, `dialog wrapping`, `accessible text contracts`, `clear-screen wrapping`, `panel wrapping`, `lottery announcement contracts`, `unchanged text surfaces`, `longest text`, `fallback wrapping`. Each must collect its intended parameterized cases; audit viewport/scenario counts against Steps 1–7, not merely nonzero output.

```bash
for title in 'layout measurement' 'phone HUD budget' 'HUD breakpoint isolation' 'long-name lottery motion' 'dialog wrapping' 'accessible text contracts' 'clear-screen wrapping' 'panel wrapping' 'lottery announcement contracts' 'unchanged text surfaces' 'longest text' 'fallback wrapping'; do
  npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --workers=2 --list --grep "$title" || exit 1
done
npm run typecheck
npm test
npm run build
npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'layout measurement|phone HUD budget|HUD breakpoint isolation|long-name lottery motion|dialog wrapping|accessible text contracts|clear-screen wrapping|panel wrapping|lottery announcement contracts|unchanged text surfaces|longest text|fallback wrapping'
npm run test:e2e -- tests/e2e/hud-layout.spec.ts tests/e2e/ui-pop.spec.ts tests/e2e/game-settings.spec.ts tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-chromium --project=phone-chromium --workers=2 --grep 'keeps the dice button|fits all three action labels|populated HUD|phone populated layout|short landscape keeps staged slots|presentation cycles.*one-line menu labels|item controls and the decision sheet fit|landscape 667 by 375|ticket card opens|Escape closes a native adjust dialog|text route view lists|menu, log, and item card transitions'
xvfb-run -a npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-firefox --workers=2 --grep 'phone HUD budget|HUD breakpoint isolation|dialog wrapping|accessible text contracts|clear-screen wrapping|longest text|fallback wrapping'
E2E_WEBKIT=1 npm run test:e2e -- tests/e2e/text-wrapping.spec.ts --project=desktop-webkit --workers=2 --grep 'phone HUD budget|HUD breakpoint isolation|dialog wrapping|accessible text contracts|clear-screen wrapping|longest text|fallback wrapping'
git diff --check develop...HEAD
git diff --stat develop...HEAD
```

Inspect complete committed/uncommitted/untracked implementation diff for unauthorized deletion, placeholders, hardcoded substitutes, swallowed errors, weakened tests and unrelated edits. Lead uses the repository delegation verifier with the actual base SHA and expected paths, then reads its diff; exit 0 is not acceptance. Inspect existing CSS regex blocks explicitly.

Confirm existing `.github/workflows/ci.yml` Frontend and full E2E matrix for **desktop-chromium, phone-chromium, desktop-firefox, desktop-webkit on the final SHA**. Local full four-project suites are not requested. Missing local browser libraries/X display must be reported as unrun with cause and CI evidence required; never replace a browser failure with skip. Any final fix invalidates prior final-SHA evidence and reruns affected local gates plus CI on the new SHA. Report CI pending if it has not completed, never claim completion from an earlier SHA.

## 4. Test plan — compatibility contracts

| Contract | Preservation/evidence |
|---|---|
| Dice ±1px, phone ≤45%, full initial slots, 56px/44px | Steps 2 and 7; existing assertions retained |
| Desktop no scroll; short landscape one line | Steps 2/7, 600/601 and 667×375 isolation |
| Original text/title/aria names/live regions | Steps 3–6; exact raw strings and real-browser accessible names |
| LineBadge animated consumers | Step 4 no-preference flip/settle/skip/fade |
| Clear actions/share/paging and history | Step 5 actual screen at 320/390; Step 6 unchanged history regression |
| CSS regex blocks and no item motion | Step 5 targeted unit suites, no merging/moving rules |
| Existing speed/presentation one-line labels | Step 8 regression; no feature rewrite |
| Hint fallback and overlong exception | Step 7 forced and actual-engine checks, separate geometry and screenshot evidence |

## 5. Dependencies and estimated effort

Execute `1a → 1b → 2a → 2b → 2c → 3a → 4a → 4b → 5a → 5b → 5c → 5d → 6a → 6b → 6c → 7a → 7b → 7c → 8a → 8b`. Each boundary is independently reviewable; no known failing layout carries forward. Step 2 is the blocking feasibility gate. Step 7's real-data helper can reuse scenario setup established in prior tests without replacing their deterministic focused cases.

| Stage | Changed LOC, including tests | Effort incl. verification/review |
|---|---:|---:|
| 1 (two units) | 170–250 | 2–3 hours |
| 2 (three units) | 210–320 | 2.5–4 hours |
| 3 | 100–145 | 1–2 hours |
| 4 (two units) | 165–245 | 2–3 hours |
| 5 (four units) | 305–475 | 3–5 hours |
| 6 (three units) | 195–315 | 2–3 hours |
| 7 (three units) | 275–425 | 3–5 hours |
| 8 | 25–45 | 1–2 hours plus CI |
| Total | 1,445–2,220 | 16.5–27 hours plus CI |

The larger estimate replaces the original 555–805 LOC budget: explicit browser accessibility, active lottery, ancestor clipping, clear-screen branches and state-validity coverage are substantive additions, not free assertions. No individual executable unit exceeds the ~150 LOC target; estimates are planning bounds, not permission for redundant tests.

## 6. Risks and open questions

- Font and engine differences: assert geometry/containment and coarse hint boundaries, not fixed character capacity or identical glyph positions.
- Line-clamp Range output differs by engine: separate raw versus visible lines and excess-content evidence; screenshot verifies ellipsis paint.
- Tight 320px height: validate actual margins and ancestor clipping before integrating other surfaces. Preserve dimensions and escalate a structural redesign with measurements if needed.
- Accessible-name whitespace may differ with wbr: real-browser exact comparisons are gates, not assumptions from textContent.
- Changed badge dimensions can invalidate motion geometry: explicit animated long-name/fade regression protects the existing behavior.
- Clear native share/clipboard availability is environment-dependent: deterministic browser mocks control those branches without changing production APIs.

**Open product questions: none.** The plan selects 4→2px action margin and narrow clear-action stacking as concrete implementation choices within the brief. Approval of implementation is still pending; no release version is selected.

## 7. Codex validation disposition

Revision 1 received NEEDS_REVISION. This revision addresses all required findings: numeric-line-height/normal contract and ancestor scrollports (1); corrected margin budget and explicit dt/dd/label dimensions plus responsive isolation (2); input preservation edge cases (3); LotteryReveal/LotteryRow active-motion impact (4); exact browser names/announcements, clear-screen container and dedicated branches, CSS block preservation (5); direct lottery visible/announcement comparison and display-treatment table (6); valid turn after true-longest restore plus breakpoint/fallback checks (7); per-title collection, new working release-note convention and final-SHA four-project CI (8). The brief's unbreakable-token exception is explicit in acceptance criteria.

This is a plan-only revision. No implementation or executable test results are claimed. The revised plan has not received a separate re-validation verdict.
