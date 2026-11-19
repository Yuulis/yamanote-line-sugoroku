# Issues #60 + #68 per-step implementer prompts (Codex Luna)

One self-contained prompt per step. For step `<STEP>` (1A, 1B, 2A … 14), the lead:
1. records `<BASE_SHA>` = `git rev-parse HEAD`;
2. writes the **common body** below with the step's **step block** appended to
   `.claude/logs/codex/prompt-rgts-<step>.md` (lower-case step id, e.g. `rgts-1a`);
3. runs Luna, then verification, then the Sol-low review, then commits, pushes and checks CI, then pauses for the
   user.

```bash
mkdir -p .claude/logs/codex
# Implement (Luna xhigh, as used for #66; drop to high if the user prefers)
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-rgts-<step>.md --label rgts-<step>-implement --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --config model_reasoning_effort=xhigh --sandbox danger-full-access --timeout 2400 --caller claude-main
# Review (Sol low, read-only)
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-rgts-<step>-review.md --label rgts-<step>-review --sandbox read-only --config model_reasoning_effort=low --timeout 1200 --caller claude-main
```

Lead verification after each step:
```bash
python3 .claude/skills/_shared/verify_delegation.py --base <BASE_SHA> --forbid-outside src --forbid-outside tests --label rgts-<step>
git diff --stat <BASE_SHA> -- src/features/game/engine src/types/network.ts src/features/game/store/persistence.ts src/features/game/store/settings.ts public data package.json package-lock.json   # must be empty
git diff --name-status <BASE_SHA> -- tests   # existing files (M) must be exactly the step's "Deliberate existing-test edits"
npm run typecheck && npx vitest run && npm run build
# + the step's acceptance commands from the plan (run them yourself, do not trust the report)
```

---

## Common body

```markdown
# Objective
Implement Step <STEP> of issues #60 + #68 (rules guide 「遊び方」, title/save UX) exactly as specified in
`.claude/docs/plans/rules-guide-title-save-plan.md` → "Implementation Plan" → "Step <STEP>". Follow that plan's
"Decisions", "Architecture" (Interface Design, Data Flow, Error Handling Strategy) and "Shared rules for every
step". The plan overrides older documents where they conflict. Earlier steps are committed on branch
`feature/rules-guide-title-save` at `<BASE_SHA>` (status: `.claude/docs/plans/rules-guide-title-save-handoff.md`).
Background only: brief `.claude/docs/research/feature-rules-guide-and-title-save-ux-brief.md` (user decisions are
binding), scan `.claude/docs/research/feature-rules-guide-and-title-save-ux-codebase.md`, architecture
`.claude/logs/codex/20261117T013256Z-rgts-arch.md`.

# Constraints
- Scope is Step <STEP> only. Touch only the files the step lists and do not start the next step. Hard cap ~200
  handwritten changed lines incl. CSS, unit tests, E2E and fixture edits. If the step cannot fit, stop before
  implementing and report the split you propose. Never compress code or drop tests to fit.
- TDD: write the listed tests first and confirm they fail for the right reason. Then implement the smallest
  complete change.
- Presentation only. Forbidden:
  - `src/features/game/engine/**`, RNG;
  - `src/features/game/store/persistence.ts` serialization, save format or version;
  - `src/features/game/store/settings.ts` format;
  - `src/types/network.ts`, `public/**`, `data/**`;
  - `package.json`, lockfiles, version numbers;
  - `PhoneGameMenu.tsx`, `LotteryReveal.tsx`, `TurnMomentHost.tsx`, `useGameShortcuts.ts`, `autoRoll.ts`.
- Existing test files change only as listed under the step's "Deliberate existing-test edits". Never delete, skip,
  loosen or broaden an assertion or selector. If another existing test fails, stop and report it with the failure
  output; do not edit it. New tests go in the new files the plan names.
- Conventions:
  - TypeScript strict, named exports, `XxxProps`, `React.JSX.Element`, type annotations, early returns,
    immutable updates, no `any`, no TODO or placeholders.
  - No swallowed errors: storage helpers may catch storage errors only.
  - Named constants instead of magic numbers (TS constants or CSS custom properties).
  - New BEM classes only (`.rules-guide*`, `.rules-dialog*`, `.save-status*`, `.title-screen__resume*`,
    `.title-map-placeholder*`).
  - Visible Japanese prose through `PhraseText`; aria, title and live-region strings plain.
  - Storage only through injected `StorageLike`.
- Copy: use the exact Japanese strings the plan gives (subtitle, save explanations, notice text, accessible names
  抽選のルールを詳しく見る / アイテムのルールを詳しく見る, labels). Keep 「つづきから」 as the leading text and
  `クリア結果を見る（Cターンでクリア）` unchanged.
- E2E:
  - Targeted specs only, `--workers=2`, never the full suite.
  - For `@layout` cases use `--grep 'TITLE(?: @layout)?$'`. Run each command with `--list` first and confirm the
    intended case and project are selected. Never use `--pass-with-no-tests`.
  - Tag phone cases `{ tag: "@layout" }`. Default host (no E2E_HOST). Never use `pkill -f` / `pgrep -f`.
  - Firefox locally needs `xvfb-run -a`; WebKit only with `E2E_WEBKIT=1` and only if the step asks for it.
- Screenshots for the user's pause review go to `.claude/logs/screenshots/rgts-<step>-<name>.png`.
- Do not commit, create branches or change git state. Preserve the untracked docs under `.claude/docs/`.

# Acceptance checks (run them and report results)
- `npm run typecheck`, `npx vitest run` (full), `npm run build`.
- Every acceptance command in the plan's Step <STEP> section, exactly as written.
- `git status --porcelain` shows only the files the step names (plus the pre-existing untracked docs).

# Output format
## Changes Made (file, change, handwritten LOC)
## Tests Written (new files/cases) and the exact existing-test edits (file:line, before → after, why)
## Validation Results (command + pass/fail counts; mark unrun checks as NOT RUN with the reason)
## Screenshots / Measurements (paths; px values where the step asks)
## Deviations from the plan (if any, with reason)
## Remaining Risks
```

---

## Step blocks (append the matching block to the common body)

Each block repeats the step-specific essentials so the prompt stands alone even if the plan section is skimmed.
The plan section remains authoritative.

### 1A
```markdown
# Step 1A specifics
New `src/features/game/resumePresentation.ts` and `tests/unit/resume-presentation.test.ts` only; no UI wiring.
Next turn: no pending → `game.turn + 1`; pending roll / discard → `pending.turn`; completed → null.
Position: `pending.position` for pending discard, otherwise the top-level position. 踏破 = unique
`completedSegmentIds` ∩ `requiredIds`; the denominator is `requiredIds.size`.
Label `つづきから　踏破 N/M・Kターン目から・駅`; completed label unchanged. `overwriteProgressText` →
`Kターン目から再開` / `Cターンでクリア`.
Acceptance: `npx vitest run tests/unit/resume-presentation.test.ts` + common.
```

### 1B
```markdown
# Step 1B specifics
Wire `buildResumePresentation` into `TitleScreen` (pass `requiredIds` from `GameApp`) and `overwriteProgressText`
into the GameApp new-game confirm. Group the resume button and the 「セーブを削除」 button in `.title-screen__resume`.
The delete button is directly below, a low-emphasis text link (transparent, underlined, smaller text) with a 44px
min height; handler and confirm names unchanged. New `tests/e2e/title-save-ux.spec.ts` (3 cases, one
`@layout`). Update only the playing-save resume labels in the six listed specs.
```

### 2A
```markdown
# Step 2A specifics
New `src/features/game/rulesGuide.ts` (types `RulesSectionId`, `OpenRules`, `RulesGuideItem`, `RulesGuideSection`,
`RulesGuideModel`, `RulesGuideOptions`; `buildRulesGuide(config, options?)`) with lottery, direction and
item-policy figures derived from `GameConfig`, plus `tests/unit/rules-guide.test.ts` using changed-config
fixtures. No literal production numbers (1/2, 3:2, 30%, 3, 5) in the module.
```

### 2B
```markdown
# Step 2B specifics
Complete all five sections' prose (goal with optional target count, lottery can redraw the current line, items
with config-derived delay and suspension durations and harmful "拾うと自動で発動", controls 速度 / 演出 /
おまかせで進む / 追尾 from `ANIMATION_SPEEDS` / `PRESENTATION_LEVELS`, save, shortcuts). Source prose:
`docs/manual/tokyo-suburban/rules.md`, shortened for players. Print the full model copy in the report.
`ITEM_DESCRIPTIONS` unchanged.
```

### 3
```markdown
# Step 3 specifics
New `src/features/game/components/RulesGuide.tsx` (`RulesGuideProps { model; idPrefix }`; sections with prefixed
ids and `tabIndex=-1` headings, section nav, item rows with `ItemIcon`, shortcuts block `.rules-guide__shortcuts`)
plus `.rules-guide*` CSS. Phone `(max-width: 600px)`: nav and duplicate timing detail hidden, stacked rows.
Shortcuts are hidden by default and shown under `(hover: hover) and (pointer: fine)`. New
`tests/unit/rules-guide-components.test.ts`. Not routed anywhere yet.
```

### 4
```markdown
# Step 4 specifics
TitleScreen view `"title" | "credits" | "rules"` and an optional `rulesModel` prop. No 「遊び方」 button when
`rulesModel` is absent (keeps `credits-screen.test.ts` valid unchanged). GameApp supplies
`buildRulesGuide(edition.config, { targetSegmentCount: requiredIds.size })`; the existing EditionApp title paths
supply a count-free model. Shorten `registry.ts` `ruleParagraphs` (≤ 3 short sentences: 新橋 start, all 30
segments of 山手線外回り, line lottery at transfer stations where the current line can be drawn again, items to
finish in fewer turns). Edit only `edition-registry.test.ts` and `layout.spec.ts` ~L148-151 among existing tests.
```

### 5
```markdown
# Step 5 specifics
New `src/features/game/components/RulesDialog.tsx` (`RulesDialogProps`), with native `showModal()` in
`useLayoutEffect`. The `cancel` handler does `preventDefault` and calls `onClose` (React unmounts; never
`dialog.close()` in keydown). Subtitle 「ゲームの進行はそのままです。閉じると続きから遊べます。」. Section focus and
scroll without animation. Opener validation (connected, visible, enabled, not inside hidden or inert), with a
fallback. Include a StrictMode lifecycle test and an Escape-ordering test with a shortcut listener. LOC preflight
first.
```

### 6A
```markdown
# Step 6A specifics
GameApp: `RulesRequest` state and `openRules(sectionId?)`; render `RulesDialog`; `rulesOpen` passed to GamePanel
and added to ToastHost `obscured`.
GamePanel:
- add the lottery 「詳しく」 button (name 抽選のルールを詳しく見る) inside the persistent `.game-panel__lottery`;
- add a stable fallback focus resolver (menu trigger → dice → heading);
- merge `rulesOpen` into the existing confirmation-style auto-roll and shortcut suspension;
- defer rendering `RollAdjustment` / `DiscardChoice` while `rulesOpen` (state retained), so they appear after close.
  Only modal rendering is gated: auto-roll still receives the original `turnDisplay.decision`. On close with a
  retained decision, the decision modal gets the final focus; opener restoration must not pull focus behind it.
- Do not pre-implement the InventoryPanel rules prop (that is 6B).

GameMenu: a 遊び方 button right after `.game-panel__options`, before the legend.
CSS: hide `.game-panel__shortcut-hint` by default and show it under `(hover: hover) and (pointer: fine)` (text
unchanged).
Existing `accessibility.spec.ts` and `game-hud.test.ts` shortcut and option-count assertions must pass unchanged.
LOC preflight first.
```

### 6B
```markdown
# Step 6B specifics
GamePanel forwards the existing `openRules` to InventoryPanel. ItemCard: a 「詳しく」 action (name
アイテムのルールを詳しく見る) with callback plumbing through its wrappers. InventoryPanel (typed rules callback prop)
focuses the inventory slot trigger, calls `openRules("items")`, then closes the card. Card cleanup (native and fallback) must not steal focus from the
dialog. Add the pointer-capability E2E (`@layout`) checking computed visibility of `.rules-guide__shortcuts` and
`.game-panel__shortcut-hint`.
```

### 7A
```markdown
# Step 7A specifics
New `saveStatusPresentation.ts` (four statuses, exact copy from the plan) and `SaveStatusPopover.tsx`: trigger
button, `popover="auto"` explanation rendered as a sibling outside a caller-given wrapper, inline `hidden`
fallback, close button, viewport clamp, Escape, focus restore; closes without restoring focus when a modal dialog
opens. `.save-status*` CSS. New `tests/unit/save-status-popover.test.ts`. Not wired into the HUD yet. LOC preflight first.
```

### 7B
```markdown
# Step 7B specifics
GameHud: keep `<p class="game-panel__save …">` (no role, same `title`, visually-hidden text, exact textContent).
Put the trigger button inside it and the explanation as a sibling outside it. Failed / unavailable / null: the
status text becomes the trigger. CSS: 16px visual, a 44x44 absolutely positioned hit box, scoped inward padding,
no row-height change. Phone panel must stay 252px at 320x568. Only add assertions in `game-hud.test.ts`
~L322-350 and `item-controls.test.ts` ~L1021-1047.
```

### 8A
```markdown
# Step 8A specifics
`useGameApp.ts`: one internal write helper shared by both save effects, publishing `saveAttempt: SaveAttempt |
null` (`id`, `sessionId`, `game`, `result`, `entryTurn`). Dedupe by game object, storage, key and session; the
same write reuses its id. Existing item acknowledgement dispatches and phase conditions are byte-for-byte the same
behaviour. `SaveAttempt` type in new `saveNotice.ts`. New `tests/unit/game-app-save-attempt.test.ts`. No consumer
yet.
```

### 8B
```markdown
# Step 8B specifics
`saveNotice.ts`: `isFirstTurnNoticeEligible`, `FIRST_TURN_NOTICE_TEXT`, pure `selectAnnouncement` with named
`NoticeAnnouncementState` / `NoticeAnnouncementInput` (ordinary announcements first; the notice waits; decision
ownership defers it). New `store/notices.ts`: key `yamanote-line-sugoroku:notice:auto-resume:v1`, value `"1"`,
read and write catch storage errors only and return false. New `tests/unit/save-notice.test.ts` (incl. a key
without "save", and failure → success eligible once).
```

### 9
```markdown
# Step 9 specifics
`toastQueue.ts`: optional `kind`, `NoticeToastInput`, `enqueueNotice` (bypasses and never advances the cursor,
per-scope dedupe, kept by old-turn pruning, shares FIFO and two ordinary slots, slot 3 reserved for failure).
`ToastHost.tsx`: `notice`, `announceable`, `onNoticeShown` (once; only when visible, not obscured, document
visible and announceable; the reading clock is paused otherwise). New `tests/unit/toast-notice.test.ts`;
`tests/unit/toast.test.ts` byte-identical. LOC preflight first.
```

### 10A
```markdown
# Step 10A specifics
New `useFirstTurnNotice.ts` (pending → shown → persisted; in-memory guard; leaves the flag unset if the player
leaves before delivery). New `tests/unit/helpers/notices.ts` `seedFirstTurnNotice(storage)`.
`tests/e2e/fixtures.ts`: option `firstTurnNoticeSeen` (default true) with one `addInitScript` seed; `false`
installs nothing and never erases. Add setup-only seed calls to existing GameApp unit suites where needed (list
them). Hook-level tests in new `tests/unit/game-app-save-notice.test.ts`. Nothing visible yet.
```

### 10B
```markdown
# Step 10B specifics
Connect the hook in GameApp to ToastHost (`notice`, `announceable`, `onNoticeShown`). GamePanel announces through
its existing status region using `selectAnnouncement`, with an explicit request / acknowledgement handshake (no
new live region; ToastHost stays aria-hidden). New `tests/e2e/first-turn-notice.spec.ts` with
`test.use({ firstTurnNoticeSeen: false })`: once across reload, restored baseline waits, hidden tab delays. All
existing toast assertions must pass untouched.
```

### 11
```markdown
# Step 11 specifics
`RailwayMap` `mode` prop (`RailwayMapMode`, default "game"). Title fit of the target service with
`titleFitPadding` (named constants 24 phone / 48 other, clamped) and no panel padding. Re-fit on layers ready,
title entry and resize. Follow, overview and preview effects run only in game mode, with `mode` in their deps
where entry must re-run. Preview cleanup never resets padding after a title fit; clear mode does not touch the
camera; mode is not a dependency of map construction. GameApp passes the mode. New
`tests/unit/title-map-mode.test.ts`, `tests/e2e/title-map.spec.ts`. LOC preflight first.
```

### 12A
```markdown
# Step 12A specifics
New `src/features/map/components/TitleMapPlaceholder.tsx` (inline SVG loop, `aria-hidden`, not focusable,
pointer-transparent). RailwayMap paint latch: layers ready + first `load` + a later `render` + next RAF (never
`idle`), reset on retry, stale-callback guard, cleanup. The placeholder shows in title mode until painted, and
stays on style failure or WebGL unsupported. LOC preflight first.
```

### 12B
```markdown
# Step 12B specifics
Hide (or unmount) the NavigationControl container and `.map-overview` unless mode is "game" with layers ready and
no fatal failure; attribution kept. Add `navigation is hidden outside ready playable game mode` to
`tests/unit/title-map-mode.test.ts`. Only `layout.spec.ts` gets readiness waits (~L47-87, ~L126-136); its counts and
limits are unchanged.
```

### 13
```markdown
# Step 13 specifics
Production files: `EditionApp.tsx`, `GameApp.tsx`, `TitleScreen.tsx`.
- EditionApp single-edition loading renders `TitleScreen` (loading: play actions absent, 「遊び方」 with a
  count-free model) over `TitleMapPlaceholder`; the failure path passes `mode="title"`.
- TitleScreen gains `onRulesViewChange?: (open: boolean) => void`. EditionApp keeps the loading title mounted
  while its rules view is open, even after the data loads.
- After the player returns from the rules, EditionApp switches to GameApp with `initialTitleFocus="rules-trigger"`,
  forwarded to TitleScreen, which focuses 「遊び方」 after mounting. The request is issued only when a rules visit
  deferred the switch; otherwise the existing picker-focus behaviour applies.
- Exactly one placeholder at a time. New `tests/unit/edition-title-states.test.ts`.
```

### 14
```markdown
# Step 14 specifics
Add only the four combined cases to the new feature test files; product fixes only if they fail (report each).
Run the plan's full Step 14 acceptance list including the boundary `git diff` commands.
```

---

## Review prompt body (Sol low) — `.claude/logs/codex/prompt-rgts-<step>-review.md`

```markdown
Objective: Review the uncommitted diff of Step <STEP> of issues #60 + #68 against
`.claude/docs/plans/rules-guide-title-save-plan.md` (Step <STEP>, Decisions, Interface Design, Shared rules) and
return APPROVE or REQUEST_CHANGES. Base: `<BASE_SHA>` (`git diff <BASE_SHA>` plus untracked files).
Check:
- forbidden paths untouched (engine, RNG, persistence serialization, settings format, network types, public,
  data, deps);
- existing test edits limited to the step's list, with no weakened, skipped or broadened assertions;
- the turn / position semantics table; config-derived numbers (no literals);
- exact copy and accessible names; PhraseText for visible prose; one live region; ToastHost aria-hidden;
- native dialog lifecycle (no sync close in keydown, opener validation, `rulesOpen` suspension, decision modals
  deferred);
- toast cursor untouched for ordinary toasts; notice flag key and "persist after display";
- phone 252px budget and 44px targets; map mode not in construction deps; placeholder a11y;
- naming and BEM, named constants, swallowed errors, placeholders, hard-coded results, scope creep beyond the
  step, LOC cap.
Output: ## Verdict (APPROVE / REQUEST_CHANGES) ## Findings (P1/P2/P3, file:line, why, fix) ## Verified ## Not verified
```
