# UI Pop Overhaul P0+P1 — Executor Prompts

Self-contained executor prompts, one per step of `.claude/docs/plans/ui-pop-hud-inventory-plan.md`.
A step's prompt file = **§0 Common Contract + the step section**. Build it mechanically (never retype):

```bash
STEP=S5   # S1 … S25, or S2A / S2B
mkdir -p .claude/logs/codex
awk -v s="## ${STEP}:" '/^## /{p = ($0 ~ /^## 0\. Common Contract/) || index($0, s) == 1} p' \
  .claude/docs/plans/ui-pop-hud-inventory-prompts.md > ".claude/logs/codex/prompt-uipop-${STEP}.md"

# Implementer, Luna high (default lane)
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file ".claude/logs/codex/prompt-uipop-${STEP}.md" --label "uipop-${STEP}" \
  --model "${CODEX_MODEL_LUNA:-gpt-6-luna}" --timeout 2400 --caller general-purpose-opus
```

Claude Sonnet fallback: pass the same built file as the subagent prompt. Reviewer (Sol low, read-only),
after the implementer finishes and before the lead commits:

```bash
awk '/^## R:/{p=1;next} /^## /{p=0} p' .claude/docs/plans/ui-pop-hud-inventory-prompts.md \
  | sed "s/{STEP}/${STEP}/g" > ".claude/logs/codex/prompt-uipop-${STEP}-review.md"
PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" python3 .claude/skills/_shared/codex_consult.py \
  --prompt-file ".claude/logs/codex/prompt-uipop-${STEP}-review.md" --label "uipop-${STEP}-review" \
  --config model_reasoning_effort=low --sandbox read-only --caller general-purpose-opus
```

S2A is a read-only Sol-high research consult (no `--model`, `--sandbox read-only --timeout 2400`); its response
is saved by the lead to `.claude/docs/research/line-badge-codes.md` and spot-checked before S2B. The lead
commits after verification; executors never commit.

---

## 0. Common Contract

You are implementing one step of the "UI pop overhaul P0+P1" feature in
`/home/yuulis/yamanote-line-sugoroku` (React 19 + TypeScript 6 + Vite 8 + MapLibre; Vitest 5; Playwright 1.63),
branch `feature/ui-pop-hud-inventory`. Implement **only** the step below, completely, as one reviewable change.

Read first: `.claude/docs/plans/ui-pop-hud-inventory-plan.md` §2 (architecture contracts) and §3 (common step
contract), the step's row in §4, `.claude/docs/plans/ui-pop-hud-inventory-handoff.md` (previous steps' notes),
`.claude/rules/coding-principles.md`, `.claude/rules/testing.md`.

Fixed decisions (user, 2026-10-28; do not reopen): brand palette vermilion `#d9502f`, ink `#263238`, cream
`#faf7ef` replaces the green UI primary; original line badges with official letter codes (no rounded square
framing letters, no ring around a letter, no station numbers, no operator typeface/logos; 21 uncoded JR lines
are colour-only with the name beside; never invent codes); HUD with log and menu disclosures; straight progress
bar, never a ring; no sound; no P2 animation; no dark mode.

Hard constraints:
- Do not modify: `src/features/game/engine/**`, `src/features/game/gameSession.ts`,
  `src/features/game/itemSession.ts`, `src/features/game/store/**`, `src/types/network.ts`, `public/data/**`,
  `data/**`, `src/features/game/shareText.ts`, `package.json`, `package-lock.json`, `.claude/docs/DESIGN.md`,
  `.claude/STATE.md`. Touch only the files listed for the step plus the handoff doc.
- No new dependencies (no icon library, no Testing Library, no webfont). No `Math.random`; components never
  import engine RNG or turn functions.
- Conventions: function components, named exports, `XxxProps` in the same file, BEM-ish classes in the single
  global `src/styles.css`, colours only through CSS tokens (data-driven line colours via inline style are fine),
  constants `UPPER_SNAKE_CASE`, type annotations everywhere, early returns, English code/comments, Japanese UI copy.
- Unit tests: `tests/unit/<name>.test.ts` (no `.tsx`), `// @vitest-environment jsdom` when rendering, React via
  `createElement` + `tests/unit/helpers/reactDom.ts` or `renderToStaticMarkup`. For update/lifecycle assertions
  keep component identity stable: `act(() => mount.root.render(createElement(Harness, props)))` with a named
  `Harness`; do not use `mountReact().render()` for those (it remounts). Stub `HTMLDialogElement.prototype.showModal/close`
  and Popover methods in jsdom as `tests/unit/item-controls.test.ts` does for dialogs.
- E2E: never delete, skip, or loosen an assertion; re-point it to the real visible destination with the same
  expected value. No hidden compatibility markup kept only for tests. `rollOnce()` must not open disclosures.
  Local runs: `env -u WAYLAND_DISPLAY npx playwright test …` (2 workers); WebKit is CI-only.
- Accessibility: exactly one gameplay `role=status` live region inside `.game-panel` (decision dialogs keep their
  own copy); keep `.game-panel` on the panel root and `<main aria-label="ゲーム操作">`; 44×44px minimum targets;
  visible `:focus-visible`; everything collapses to instant under `prefers-reduced-motion`; no information only
  in a tooltip or only on hover.
- The dice button's accessible name and text stay exactly `サイコロを振る` / `この内容でサイコロを振る` / `移動中…`
  (decorative SVG only: `aria-hidden="true"`, no `<title>`/`<text>`).

Gates (define in your shell):

```bash
ui_gate() { npm run typecheck && npm test && npm run build; }
ui_e2e() { env -u WAYLAND_DISPLAY npx playwright test --workers=2 \
  --project=desktop-chromium --project=phone-chromium --project=desktop-firefox "$@"; }
```

When done, update the step's row in `.claude/docs/plans/ui-pop-hud-inventory-handoff.md` (status
`implemented — pending lead verification`, commands you ran with pass/fail counts, open findings). Do not commit.

Output format (markdown, exactly these sections):
## Summary
## Files Changed (path — new/modify — one line)
## Tests Added or Changed (exact test names; for E2E migrations list old → new locator and confirm the expected value is unchanged)
## Commands Run (command → result with counts)
## Deviations and Assumptions
## Open Issues

---

## S1: Design tokens and accessible brand buttons

Objective: introduce light-theme design tokens and brand-coloured buttons, replacing the green UI primary,
without moving any information.

Files: `src/styles.css` (modify); `src/features/game/uiContrast.ts` (new); `tests/unit/ui-contrast.test.ts` (new).

Requirements:
- `:root` tokens: `--color-brand: #d9502f`, `--color-brand-strong: #b83f24`, `--color-ink: #263238`,
  `--color-cream: #faf7ef`, plus surface, surface-raised, text, text-muted, border, good, bad, warning, focus ring,
  radius (sm/md/lg/pill), shadow (sm/md), motion (fast/normal/slow). `@media (prefers-reduced-motion: reduce)`
  sets every motion token to `0ms`.
- `button` base: rounded, token border/background, pressed (`:active`) state, `:focus-visible` ring using the
  focus token, keep `min-height: 44px`. `.button-primary`: `--color-brand-strong` fill with white text (normal
  size). Add `.button-cta` for the dice button later (brand fill, white text ≥ 18.7px bold) — define it here, apply
  in S10.
- Replace every green UI primary (`#2e7d32`, `#1b5e20`) including selected item slot, staged summary, accent
  colours and `.game-panel__options button[aria-pressed]`, with tokens. Do not change railway line colours,
  `--completed-line-color`, map paint, or legend swatches that mirror map colours.
- `uiContrast.ts`: `parseHexColor(hex: string): [number, number, number] | null`, `relativeLuminance`,
  `contrastRatio(first: string, second: string): number` (WCAG 2.x). No DOM access.

Tests (`ui-contrast.test.ts`): black/white = 21; same colour = 1; white on `#d9502f` ≈ 4.09 (< 4.5); white on
`#b83f24` ≥ 4.5; invalid hex → `parseHexColor` null; read `src/styles.css` with `node:fs` and assert the brand
tokens exist, no `#2e7d32`/`#1b5e20` remain, and a reduced-motion block zeroes the motion tokens.

Acceptance: `ui_gate && ui_e2e` (full suite; shared button styles affect every screen).

## S2A: Line-code mapping research (Codex Sol high, read-only, live web)

Objective: produce a source-verified mapping from every UI line-group id to its official letter code (or none),
for review before any code is written. Output the table as your response; do not edit files.

Run with: `--sandbox read-only --timeout 2400` (Sol default model). The lead saves the response to
`.claude/docs/research/line-badge-codes.md`.

Inputs: `public/data/manifest.json` `uiPresentation.lineGroups` (134 groups: `id`, `name`, `operatorId`,
`serviceIds`), `public/data/services.json` (`lines`, 135), `.claude/docs/research/official-line-symbols-usage.md`
§2 (operator symbol sets and the 21 uncoded JR ids), operator pages and
https://ja.wikipedia.org/wiki/駅ナンバリング and per-line Wikipedia articles.

Rules: one code per group; only codes the operator actually uses; for groups spanning several codes pick the
code of the Tokyo-side section and list the others in the note (expected examples: `tobu-isesaki` TS with TI,
`jr-sotetsu-direct` JA with JS); partial-coverage JR lines (JU, JO) keep their code with a note; verify the
musashino branches (`jr-musashino-takaya`, `jr-musashino-futamata`), `metro-marunouchi-honancho` (M),
`yokohama-green` (G, distinct from `metro-ginza` G), Tobu/Seibu/Tokyu/Keisei branch lines, and `toei-oedo` (both
services, E). The 21 uncoded ids from the research doc must be `none`. Never invent a code; if sources conflict,
say so in the note and pick the documented operator usage.

Output format: a markdown table with columns `group id | name | operator | code or none | source URL | note`
(all 134 rows, manifest order), then `## Conflicts` and `## Counts` (coded/uncoded totals).

## S2B: Line-badge catalogue in code

Objective: transcribe the reviewed mapping `.claude/docs/research/line-badge-codes.md` into a typed frontend
catalogue and resolver with independent tests.

Files: `src/features/game/lineBadge.ts` (new); `tests/unit/line-badge.test.ts` (new);
`.claude/docs/research/line-badge-codes.md` (add only if the lead has not committed it yet).

Requirements:
- `LINE_BADGE_CODES: Readonly<Record<string, string>>` (113 entries, grouped by operator with one source URL
  comment per operator block and an English note for multi-code/partial choices) and
  `NO_CODE_LINE_GROUP_IDS: ReadonlySet<string>` (exactly the 21 JR ids in plan §2).
- `interface LineBadgeModel { groupId: string; code: string | null; color: string | null; name: string; textColor: "#000000" | "#ffffff" | null }`.
- `badgeTextColor(background: string): "#000000" | "#ffffff"` using `contrastRatio` from `uiContrast.ts`
  (higher ratio wins).
- `lineBadgeFor(serviceId: string, presentation: PresentationResolver, fallbackColor?: string): LineBadgeModel`:
  `presentation.lineGroupId()` → table; colour from `presentation.lineGroupColor()` then `fallbackColor`; invalid
  or missing colour → `color: null`, `textColor: null`; name from `presentation.serviceName()`; unknown ids → no
  code. Never derive codes from ids, names or operators.

Tests (`line-badge.test.ts`, reading `public/data/manifest.json` via `node:fs`): coded ∪ uncoded equals the 134
manifest ids exactly; disjoint; 113/21; exact 21 list; both `toei-oedo` services resolve to the same model;
operator-symbol membership: for each operator id prefix the codes used are a subset of the research §2 symbol
set (encode the sets in the test: JR `JY JK JB JC JA JE JM JN JI JH JT JO JU JS JJ JL SN SE`, Tobu `TS TI TN TD TJ`,
Seibu `SI SS SK ST SW SY`, Metro `G M H T C Y Z N F`, Tokyu `TY MG SH DT OM IK TM SG KD`, Keisei `KS`, Keio `KO IN`,
Toei `A I S E`, Keikyu `KK`, Odakyu `OH OE OT`, Sotetsu `SO`, Yokohama `B G`, TX `TX`, MM `MM`, Hokuso `HS`);
independent spot expectations (write them literally, not from the table): jr-yamanote JY, jr-keihin-tohoku JK,
jr-chuo-sobu-local JB, jr-chuo-rapid JC, jr-saikyo JA, jr-keiyo JE, jr-yokohama JH, jr-joban-local JL,
metro-ginza G, metro-marunouchi M, metro-namboku N, toei-asakusa A, toei-mita I, toei-oedo E, tokyu-toyoko TY,
keio-main KO, odakyu-odawara OH, sotetsu-main SO, tx TX, mm-minatomirai MM, hokuso-main HS, keikyu-main KK,
keisei-main KS, tobu-tojo TJ, seibu-ikebukuro SI, yokohama-blue B; unknown id with no colour → `{code:null,
color:null}`; for every manifest colour `contrastRatio(color, badgeTextColor(color)) >= 4.5`.

Acceptance: `ui_gate`.

## S3: LineBadge and ItemIcon renderers

Objective: render original decorative line badges and 11 self-made inline SVG item icons.

Files: `src/features/game/components/LineBadge.tsx` (new), `src/features/game/components/ItemIcon.tsx` (new),
`src/styles.css` (modify), `tests/unit/item-icon.test.ts` (new), `tests/unit/line-badge.test.ts` (modify).

Requirements:
- `LineBadge({ model, showName = true, size = "md" }: LineBadgeProps)`: an `aria-hidden` horizontal pennant /
  parallelogram colour block (CSS `clip-path` or skew on a wrapper; the code text itself unskewed) containing the
  code in the system font, followed by the line name as plain text (the name is not `aria-hidden`; callers may
  pass `showName={false}` when the name is already adjacent). Uncoded/unknown: the same block shape without
  text; colour null → neutral token. Forbidden: rounded square around letters, circle/ring around a letter,
  station numbers, operator artwork. Class names `line-badge`, `line-badge__mark`, `line-badge__code`,
  `line-badge__name`.
- `ItemIcon({ kind, size = 24 }: ItemIconProps)`: exhaustive `Readonly<Record<ItemKind, …>>` of path data drawn by
  you (route ticket with branching track, direction ticket with arrow, die with ±, ×2 bolt, express chevrons,
  deadhead train with plate, certificate/shield; harmful: clock (遅延), barrier ✕ (運休), zigzag path (寄り道),
  zzz (寝過ごし)); `currentColor` plus one accent via CSS custom property; `aria-hidden="true"`,
  `focusable="false"`, no `<title>`, no `<text>`, no `id` attributes, no external `href`.

Tests: every `ItemKind` (import the kind lists from `src/types/network.ts`) renders exactly one `<svg>` with
`aria-hidden="true"`, no text content, no `id`, no `<use>`/`<image>`; badge markup: coded shows code + name,
uncoded/unknown shows no code text and the name; no class or style containing `border-radius: 50%`/`ring`.

Acceptance: `ui_gate && ui_e2e tests/e2e/layout.spec.ts`.

## S4: HUD pure models, progress bar, effect chips

Objective: implement typed HUD models and the two presentational components, not yet mounted in the panel.

Files: `src/features/game/hudPresentation.ts` (new), `src/features/game/components/TargetProgressBar.tsx` (new),
`src/features/game/components/EffectChips.tsx` (new), `src/styles.css` (modify),
`tests/unit/hud-presentation.test.ts` (new).

Requirements:
- `compactRollFor(lastMove: LastMove | null): CompactRollModel` (`{ face: number | null; label: string; modifier: string | null }`)
  from typed record fields only: none → `—`; normal → face + `Nマス`; double → face + doubled budget; adjustment →
  effective face + adjustment cue; rapid → budget; oversleep → `寝過ごし`; deadhead → `回送（サイコロなし）`, face null.
  Read `presentation.ts` `lastRollText` and `LastMove`/`ItemTurnRecord` types to find the fields; do not parse text.
- `progressSegments(completedCount: number, requiredCount: number): readonly ProgressSegment[]` (clamped).
- `effectChipModels(effects, turn, network, presentation): readonly EffectChipModel[]` whose `text` comes from
  `activeItemEffectTexts` (same order); `kind`, `remainingTurns` (null for pending detour/oversleep),
  `serviceId`, stable `key`.
- `TargetProgressBar({ completed, required, label = "山手線の踏破区間" })`: one element with
  `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=required`, `aria-valuenow=completed`,
  `aria-valuetext="N/M"`; a straight flex row of `required` `aria-hidden` segments; never circular.
- `EffectChips({ models })`: container `aria-label="続いている効果"` (no role/live), one chip per model with an
  `ItemIcon` (harmful kind) and the full text; empty → render nothing.

Tests: all compact roll cases above using records built with the existing engine/test fixtures (see
`tests/unit/game-presentation.test.ts` for patterns); 30 and 4 segments at 0/partial/full/over; one progressbar
with values; chip text array equals `activeItemEffectTexts(...)` for combinations (single/multiple delays,
suspensions, detour, oversleep, expiry boundary); keys unique and stable.

Acceptance: `ui_gate`.

## S5: Reveal sequence reducer and hook

Objective: add the presentation-only reveal sequencing foundation with no added delay in P0/P1.

Files: `src/features/game/animation/useRevealSequence.ts` (new), `tests/unit/reveal-sequence.test.ts` (new).

Requirements (plan §2 "Reveal hook"): export `revealReducer(state, action)` (pure; actions: observe, reset,
movementComplete, advance{key, stageIndex}, skip) and `useRevealSequence({ observation, stages, reducedMotion })`
returning `{ key, stage, busy, ready, skip }`. Key `${sessionId}:${recordTurn}`; baseline at session entry =
max(committed game turn, existing record turn, pending decision turn) and every key ≤ baseline starts done; empty
stages ⇒ no timers, `stage: "done"`, `busy: false`, `ready` once movement completes; non-empty stages start after
movement completes, advance by `setTimeout(durationMs)`; skip during movement marks the armed key done; reduced
motion completes immediately; unmount/session change clears timers; stale advances ignored; stage-array identity
changes and duplicate observations never replay a completed key. No React state updates per animation frame.

Tests: reducer table tests first, then a stable-identity hook harness with `vi.useFakeTimers()`: every case in plan
§4 S5.

Acceptance: `ui_gate`.

## S6: Toast conversion and bounded queue

Objective: pure toast inputs from canonical item events plus a bounded queue reducer.

Files: `src/features/game/toastQueue.ts` (new), `tests/unit/toast.test.ts` (new).

Requirements: `ToastInput { key; turn: number | null; text; tone: "neutral" | "good" | "bad"; itemKind?; sticky }`;
`turnToasts(sessionId, lastMove, network, presentation)` reusing `itemEventTexts` wording (no new copy), key
`${sessionId}:${recordTurn}:${eventIndex}`, pickup-retained/pending dedupe consistent with `itemEventTexts`;
`toastQueueReducer(state, action)` with actions enqueue(inputs, scope), expire(key), saveFailed, saveSucceeded,
resetScope(sessionId); capacity 3 with one slot reserved for the sticky save failure; per-scope seen cursor so
an expired current-turn toast never returns; prior-turn and stale inputs rejected; discard appends only new
events. Constants `MAX_VISIBLE_TOASTS = 3`, `TOAST_READING_MS = 4000`.

Tests: every case in plan §4 S6.

Acceptance: `ui_gate`.

## S7: ToastHost component

Objective: render the toast queue as a visual-only layer with local timers.

Files: `src/features/game/components/ToastHost.tsx` (new), `src/styles.css` (modify), `tests/unit/toast.test.ts` (modify).

Requirements: `ToastHostProps { sessionId: number | null; inputs: readonly ToastInput[]; saveFailed: boolean; obscured: boolean; reducedMotion: boolean }`;
root `aria-hidden="true"`, class `toast-host`, fixed top-centre above the map and below native dialogs, no
`role`, no `aria-live`, no interactive descendants; icon via `ItemIcon` when `itemKind` set; reading timer starts
only when visible and not obscured; remaining time pauses while obscured; reduced motion removes enter/exit
transitions but keeps reading time; failure toast sticky until `saveFailed` becomes false or the session changes;
timers cleared on unmount/session change. Not mounted in `GameApp` yet.

Tests (stable harness, fake timers): plan §4 S7 list.

Acceptance: `ui_gate`.

## S8: GameApp integration (reveal readiness, coordinated skip, toasts, obscured wiring)

Objective: wire the reveal hook and ToastHost into `GameApp` without changing turn timing or save order.

Files: `src/app/GameApp.tsx`, `src/features/game/components/GamePanel.tsx` (only a new optional stable prop
`onItemDialogOpenChange?: (open: boolean) => void`, called when its `ItemUseDialog` opens/closes),
`tests/unit/game-app-item-progress.test.ts`, `tests/e2e/resume.spec.ts`, `tests/e2e/save-errors.spec.ts`.

Requirements: observation from `session.lastMove.itemRecord.turn` after the existing save boundary; production
`stages` = a module-level empty constant; `skip` calls `reveal.skip()` and `finishAnimation(currentAnimation)`
(both idempotent, callback identity stable); toasts from `turnToasts` only when `reveal.ready`; `obscured =
confirm !== null || app.itemView?.decision != null || itemDialogOpen`; `saveFailed` from `app.saveStatus`
(`failed`/`unavailable`); ToastHost mounted outside `GamePanel`; `GamePanel` memo props stay stable.

Tests: keep `keeps the origin visible until the %s movement save attempt` expectations; add unit cases for toast
after settle, deferral while each modal kind is open (production wiring), no replay on resume; E2E
(`reducedMotion: "no-preference"` describe): no toast replay after reload/resume; save-errors: failure toast
stays past 4 s and clears after a later successful save, `.game-panel__save` still shows the failure.
Also: a toast paused part-way through its reading time by switching modal causes consumes only the remaining
time; replacing the session while `ItemUseDialog` is open leaves no inherited obscuration or stale toasts.

Acceptance: `ui_gate && ui_e2e` (full).

**Lead addendum (user decisions 2026-10-30, binding):** (1) Toast text must be SHORT and simple: item name + outcome only, never the effect sentence from `itemEventTexts` (e.g. `快速券を手に入れた！`, `倍速券を使った`, `回送列車を捨てた`, `遅延証明書で遅延を打ち消した`, `遅延が発動！`, `山手線の運休が終わった`; save failure `保存に失敗しました`). Derive it from the typed item events in `toastQueue.ts` (add a short-text function; keep `itemEventTexts` unchanged for the log/live region) and update `tests/unit/toast.test.ts` to assert the short texts for every outcome kind. List the final wordings in your report for user review. (2) `unavailable` saves raise NO toast — status icon only; only `failed` raises the sticky toast. (3) Ordinary toasts keep 2 slots.

## S9: Stat value markers and shared E2E helpers

Objective: give every HUD value a stable marker and migrate the shared E2E helpers once, with no visible change.

Files: `src/features/game/components/GamePanel.tsx`, `tests/e2e/support/app.ts`,
`tests/unit/game-app-item-progress.test.ts`.

Requirements: wrap each `<dd>` value in `<span class="hud-stat__value" data-stat="station|ride|direction|turn|progress|roll">`
(the swatch stays outside the span); `panelStat(page, label)` stays synchronous and maps
現在駅→station, 乗車中→ride, 進行方向→direction, ターン数→turn, 踏破区間→progress, 出目→roll, returning
`gamePanel(page).locator('[data-stat="…"]')`; add `openGameLog`, `closeGameLog`, `openGameMenu`,
`closeGameMenu` (idempotent via the trigger's `aria-expanded`; after opening `await expect(region).toBeVisible()`,
after closing `await expect(region).toBeHidden()`;
triggers are buttons named `ログ` and `メニュー`, regions labelled `ターンのログ` and `メニュー` — these names are
the contract for S12/S15), `inventoryItem(page, name)`, `useInventoryItem(page, name)` (open slot → card →
使う; first used in S21). Unit `stat()` helper reads the value span.

Tests: all 66 `panelStat` calls keep their expected values; no spec calls the new disclosure helpers yet.

Acceptance: `ui_gate && ui_e2e` (full).

## S10: GameHud extraction

Objective: show the new compact HUD (badge, progress bar, chips, brand dice CTA, save indicator) while the full
roll and all other content stay where they are.

Files: `src/features/game/components/GameHud.tsx` (new), `src/features/game/components/GamePanel.tsx`,
`src/features/game/components/ItemEventNotice.tsx` (`showEffects?: boolean`, default `true`), `src/styles.css`,
`tests/unit/game-hud.test.ts` (new), `tests/unit/item-controls.test.ts`, `tests/e2e/items.spec.ts`.

Requirements: `GameHud` receives display-ready values and refs (no session subscriptions); six `<dt>` labels;
`LineBadge` beside (outside) the ride value; `TargetProgressBar` beside (outside) the progress value; dice button
with `.button-cta`, exact text contract, existing `ref`, `aria-disabled` and click suppression; スキップ; save
indicator `.game-panel__save`: success = check icon + visually hidden `セーブ: 自動保存済み`-style full text
(`saveStatusMessage`), failure = visible warning icon + visible full text, persistent; `EffectChips` in the panel;
`GamePanel` passes `showEffects={false}` to its `ItemEventNotice`; ClearScreen usage unchanged. Keep the edition
title (focus target) and the subtitle `東京近郊版` in the panel (visible desktop, hidden phone, as today). Legacy
save paragraph drops `role="status"` so exactly one status region exists.

Tests: plan §4 S10 list; in `items.spec.ts` change only the scope of the `続いている効果` countdown checks from
`notices(page)` to `gamePanel(page)` (same texts).

Acceptance: `ui_gate && ui_e2e` (full).

**Lead addendum (user decision 2026-10-30, binding):** effect chips in the HUD show a SHORT label (e.g. `遅延 あと1`, `運休 山手線 あと3`, `寄り道`, `寝過ごし`); the current full sentence from `effectChipModels` moves to a tooltip / accessible description (e.g. `title` plus visually hidden text or `aria-describedby`), never the visible chip text. Add the short label to the chip model with unit tests; keep chip keys stable.

## S10b: HUD polish after user review (stable dice position, inline save mark, badge chips)

Added by the lead after the user reviewed S10 (2026-10-30). Binding user decisions:

1. **The dice button (`サイコロを振る`) must not move up or down with the amount of information.** Its vertical offset from the top of `.game-panel` must be identical across states: no/one/several effect chips, short vs long ride line name, one- vs two-line roll text, coded vs uncoded badge, saved/unsaved/failed save status, empty vs full inventory — on desktop (1280x800) and phone (Pixel 7 project). Acceptable approaches: (a) everything above the action row has a fixed height (single-line rows, overflow ellipsis with the full text kept in `title` and accessible text, no wrapping), or (b) move the action row (dice + スキップ) above all variable-height content. Pick the one that keeps the HUD readable, keep the six `<dt>` labels / `data-stat` spans so `panelStat()` still reads the same values, and record the choice in the handoff. Add a Playwright test that measures the dice button's bounding-box y in at least 4 differing states (e.g. turn 0, after rolls with chips from an item fixture, a long line name, a failed save) on desktop and phone and asserts equality within 1 px. Keep the exact dice-button text.
2. **Save mark inline:** the saved ✓ must not occupy its own row; place it small inside an existing HUD row (e.g. the top-right of the HUD/title row). Failed/unavailable states stay visible as text (as in S10).
3. **Effect chips use a small line badge instead of the line name** for suspensions, e.g. `運休 [A] あと2` (S3 `LineBadge` size sm, `showName={false}`; colour-only badge for uncoded lines). The line name stays in the chip's `title` and accessible text. `遅延 あと{n}`, `寄り道`, `寝過ごし` are unchanged. Keep chip keys stable; update unit tests.

Acceptance: typecheck, `npx vitest run`, build, the new dice-position E2E on desktop-chromium, phone-chromium and desktop-firefox, plus `tests/e2e/items.spec.ts`, `layout.spec.ts`, `accessibility.spec.ts` on those projects. Screenshots before/after to `.claude/logs/screenshots/s10b-*.png`.

## S11: Map observes the real panel across sessions

Objective: keep camera padding correct after the panel restructure and across session replacement.

Files: `src/features/map/RailwayMap.tsx`, `src/app/GameApp.tsx`, `tests/unit/game-app-item-progress.test.ts`
(or new `tests/unit/map-panel-observer.test.ts`), `tests/e2e/accessibility.spec.ts`.

Requirements: optional `panelKey?: number` prop (session id while `GamePanel` is mounted, else undefined),
included only in the layout-observer effect dependencies; observe the map container and `.game-panel` root;
remove the `.game-panel__route-summary` observation; never re-create the map.

Tests: plan §4 S11 list.

Acceptance: `ui_gate && ui_e2e tests/e2e/accessibility.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/layout.spec.ts tests/e2e/resume.spec.ts`.

## S12: Menu disclosure (initially expanded)

Objective: move 追尾/速度/新規/タイトル and the legend into a real menu disclosure that starts expanded.

Files: `src/features/game/components/GameMenu.tsx` (new), `src/features/game/components/GamePanel.tsx`,
`src/styles.css`, `tests/unit/capital-region-scaling.test.ts`, `tests/unit/game-hud.test.ts`.

Requirements: trigger `<button aria-expanded aria-controls>` named `メニュー` outside `.game-panel__options`;
region `<section id=… aria-label="メニュー">` containing `.game-panel__options` (exactly the four existing
buttons, same labels/behaviour) and the memoised `GameLegend` with unchanged props; no `role="menu"`; `[hidden]`
wins over display rules; closing restores focus to the trigger; 新規 focuses the trigger before hiding the menu
and opening `ConfirmDialog`; Escape closes the menu before the draft handler (`preventDefault`); legend toggles
and checkbox labels ≥ 44×44 (remove the 32px overrides). Initial state: expanded.

Tests: plan §4 S12 list.

Acceptance: `ui_gate && ui_e2e tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts tests/e2e/dice.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/real-data.spec.ts`.

## S13: Migrate every menu consumer

Objective: make all E2E consumers of the menu content open it explicitly, before it closes by default.

Files: `tests/e2e/{accessibility,layout,dice,map-visual,capital-region,real-data}.spec.ts`.

Requirements: call `openGameMenu(page)` before every 追尾/速度/新規/タイトル/legend interaction and
`closeGameMenu(page)` before subsequent camera/dice geometry; keep `toHaveCount(4)`, the exact four legend
strings including the note (dice `[8.3-3]`), solid/dashed and rendered-layer checks, all checkbox/mixed-state
checks; in map-visual keep the menu open while collapsing the service list and assert the 山手線 踏破済み /
未踏破 / 現在地 rows stay visible; landscape test checks options geometry with the menu open and lottery geometry
with the log open (log helper lands in S15 — until then keep the lottery check where the element currently is).

Acceptance: same commands as S12.

## S14: Menu closed by default

Objective: default the menu closed and prove keyboard/focus behaviour.

Files: `src/features/game/components/GamePanel.tsx`, `tests/unit/game-hud.test.ts`, `tests/e2e/accessibility.spec.ts`.

Tests: plan §4 S14 list (initial closed, keyboard open, Escape restore, hidden descendants not tabbable, legend
state survives, visible focus origin for confirmation).

Acceptance: `ui_gate && ui_e2e` (full).

## S15: Turn log disclosure (initially expanded)

Objective: move per-turn text and the text route view into a real log disclosure that starts expanded.

Files: `src/features/game/components/TurnLogDrawer.tsx` (new), `src/features/game/components/GamePanel.tsx`,
`src/styles.css`, `tests/unit/game-hud.test.ts`, `tests/unit/item-controls.test.ts`,
`tests/e2e/accessibility.spec.ts`, `tests/e2e/real-data.spec.ts`.

Requirements: trigger `ログ`, region `<section aria-label="ターンのログ">` containing, in order: arrival
(`.item-arrival`), `.game-panel__lottery` (same copy incl. `抽選: 移動中…`), `ItemEventNotice showEffects={false}`
(region `アイテムのお知らせ` unchanged) and the suspension-ignored note, `地図なしで確認` `<details>`
(`.game-panel__route-summary`, regions 山手線の未踏破区間 / 乗車中の次の駅), `.game-panel__candidates`. No live
region. Menu/log mutually exclusive; focus restore on close. Full roll stays in the HUD until S17.

Tests: plan §4 S15 list; migrate the log reads in accessibility.spec and real-data.spec flows that also open the
menu.

Acceptance: `ui_gate && ui_e2e tests/e2e/accessibility.spec.ts tests/e2e/real-data.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/tokyo-suburban.spec.ts tests/e2e/dice.spec.ts`.

**Lead addendum (user decision 2026-10-30, binding):** the log must keep the explanation sentences of `寄り道` and `寝過ごし` (and the other effect sentences) visible as text, because chips show them only as tooltips and touch users cannot hover. Assert this in a test.

## S16: Migrate remaining log consumers

Objective: make every remaining E2E read of log content open the log explicitly.

Files: `tests/e2e/{dice,lottery,items,capital-region,tokyo-suburban}.spec.ts`.

Requirements: before each read of `.game-panel__lottery` (all 12 incl. `抽選: 移動中…` and
`not.toHaveAttribute("aria-live")`), `.item-arrival`, `.game-panel__candidates`, the route view, `panelStat("出目")`
and gameplay `notices(page)` (including after reload/resume — a new panel session starts closed), call
`openGameLog(page)`; close it before unrelated geometry/map checks. Leave the ClearScreen `notices()` read
(items.spec "retains the clearing item notice") unchanged. Expected values unchanged.

Acceptance: `ui_gate && ui_e2e tests/e2e/dice.spec.ts tests/e2e/lottery.spec.ts tests/e2e/items.spec.ts tests/e2e/capital-region.spec.ts tests/e2e/tokyo-suburban.spec.ts`.

## S17: Log closed by default; compact roll in the HUD

Objective: finish the relocation: log closed by default, compact roll in the HUD, full roll only in the log.

Files: `src/features/game/components/GamePanel.tsx`, `src/features/game/components/GameHud.tsx`,
`src/features/game/components/TurnLogDrawer.tsx`, `src/styles.css`, `tests/unit/game-hud.test.ts`,
`tests/e2e/accessibility.spec.ts`.

Requirements: HUD 出目 value uses `compactRollFor` with `data-stat="roll-compact"`; the log gets a "このターン"
`<dl>` with `出目` and the unchanged `lastRollText` in `data-stat="roll"` (the only one); log and menu default
closed.

Tests: plan §4 S17 list (desktop camera test proves panel geometry changes before asserting the camera stays).

Acceptance: `ui_gate && ui_e2e` (full).

## S18: Shared ItemCard and item metadata

Objective: a presentational item card reused by the inventory and the discard dialog.

Files: `src/features/game/components/ItemCard.tsx` (new), `src/features/game/itemPresentation.ts`,
`src/styles.css`, `tests/unit/item-presentation.test.ts`, `tests/unit/item-card.test.ts` (new).

Requirements: `itemPresentation.ts` gains `ITEM_SHORT_NAMES` (e.g. 路線指定 / 方向指定 / 出目調整 / 倍速 / 快速 /
回送 / 証明書 / 遅延 / 運休 / 寄り道 / 寝過ごし) and `itemTone(kind): "good" | "bad"`; existing strings unchanged.
`ItemCard(props: ItemCardProps)` per plan §2 (`kind`, `selected?`, `isNew?`, `unavailableReason?`, `hint?`,
`replacesSelection?`, `action?: { label; disabled; onActivate }`): `ItemIcon`, name heading, effect, timing
(`itemTiming`), hint, reason, markers; at most one button (the action); no engine/store imports.

Tests: plan §4 S18 list.

Acceptance: `ui_gate`.

## S19: ItemCardPopover lifecycle

Objective: controlled popover wrapper for the card with focus, dismissal, placement and fallback.

Files: `src/features/game/components/ItemCard.tsx`, `src/styles.css`, `tests/unit/item-card.test.ts`.

Requirements: `ItemCardPopover({ open, anchor, onClose, children, labelledBy })`: element with
`popover="auto"`, `role="dialog"`, `aria-labelledby`, no `aria-modal`, inside the panel DOM; `showPopover()` /
`hidePopover()` only when connected and state differs; sync React state on the native `toggle` event; focus the
card heading on open; Escape/Close → `onClose` and focus back to the anchor (or the dice button if the anchor is
gone); Tab out closes without pulling focus back; placement via a pure `placeItemCard(anchorRect, cardSize,
viewport)` (desktop above, flip below, clamp; ≤ 600px wide or ≤ 500px tall → bottom sheet with internal scroll);
listeners only while open, cleaned up; inline fallback when `HTMLElement.prototype.showPopover` is missing; no
transitions under reduced motion.

Tests: plan §4 S19 list (stable harness; stub `showPopover`/`hidePopover`/`togglePopover` and dispatch `toggle`).

Acceptance: `ui_gate`.

## S20: Icon inventory visuals and tooltips

Objective: three icon slots with hover/focus tooltips and persistent descriptions, keeping today's one-click
selection for this commit.

Files: `src/features/game/components/InventoryPanel.tsx`, `src/styles.css`, `tests/unit/item-controls.test.ts`,
`tests/e2e/items.spec.ts`.

Requirements: visually hidden heading `アイテム（3枠）` kept (and visible label 持ち物); each slot `.item-slot`
(`--selected`, `--empty`) with `ItemIcon`, short name, visually hidden `<h3>` full name, one button; persistent
visually hidden description (`aria-describedby`) holding effect, timing, hint, reason and replacement note;
tooltip `role="tooltip"` visual duplicate on hover/focus, stays while hovered, Escape dismisses with
`preventDefault` (draft untouched); empty slots `空き枠` accessible text; ≥ 44×44; no transitions under reduced motion.

Tests: plan §4 S20 list.

Acceptance: `ui_gate && ui_e2e tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/layout.spec.ts`.

## S21: Inspect-then-use inventory interaction

Objective: occupied slots open the item card; 使う in the card stages or opens the use dialog.

Files: `src/features/game/components/InventoryPanel.tsx`, `src/features/game/components/GamePanel.tsx`,
`src/styles.css`, `tests/unit/item-card.test.ts`, `tests/unit/item-controls.test.ts`, `tests/e2e/items.spec.ts`,
`tests/e2e/ui-pop.spec.ts` (new).

Requirements: slot button = details opener (`aria-expanded`, `aria-controls`, `aria-describedby`; no
`aria-pressed`, never disabled); card action label `使う` / `選択中・変更する`, disabled with reason when not usable,
absent for the passive certificate; activation re-reads current `usableItems` and phase then calls existing
`selectItem`; route/direction tickets: close card, focus slot, open `ItemUseDialog` (closing restores the slot);
automatic adjust/discard decisions close card/menu/log and suppress restoration before `showModal()`; Escape
order per plan §2; `GamePanel` active-surface state (`log | menu | card | none`).

Tests: plan §4 S21 list; items.spec: replace one-click uses with `useInventoryItem`, replace
`toHaveAttribute("aria-pressed","true")` with the selected marker + staged summary + announcement checks (same
values). Add: a card kept open while its item becomes unusable rejects activation without changing the draft or save.

Acceptance: `ui_gate && ui_e2e` (full).

## S22: Discard dialog reuses item cards

Files: `src/features/game/components/DiscardChoice.tsx`, `src/styles.css`, `tests/unit/item-controls.test.ts`,
`tests/e2e/items.spec.ts`.

Requirements: four `ItemCard`s, each with exactly one action `このアイテムを捨てる`, NEW marker (`新しく拾った`) on
the pickup; dialog name, hint texts, non-cancellable Escape, announcement copy and focus behaviour unchanged.

Tests: plan §4 S22 list.

Acceptance: `ui_gate && ui_e2e tests/e2e/items.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/full-game.spec.ts`.

## S23: Populated phone and short-landscape layouts

Files: `src/styles.css`, `tests/e2e/layout.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/ui-pop.spec.ts`.

Requirements: desktop HUD fits 1280×800 without scrolling (populated); phone ≤ 600px: full-width bottom panel,
closed HUD target 180–240px and ≤ 45% of viewport height, chips row horizontally scrollable, disclosures scroll
inside the capped panel; short landscape ≤ 500px tall: two-column HUD, ≤ 75% height; safe-area padding; zoom
clearance; 44×44 targets in both dimensions. Build the populated fixture state from a save (3 occupied slots,
selected draft, ≥ 2 long effect chips, save failure via the existing save-errors technique, long names).

Tests: plan §4 S23 list.

Acceptance: `ui_gate && ui_e2e` (full).

## S24: Phone attribution starts collapsed

Files: `src/features/map/RailwayMap.tsx`, `src/features/map/attribution.ts`, `tests/e2e/layout.spec.ts`,
`tests/unit/map-ui.test.ts` (new).

Requirements: pure helper `collapseAttributionOnce(container: HTMLElement): boolean` in `attribution.ts` that
activates MapLibre's existing toggle button only when the compact attribution is expanded; called after attaching
the control on phone, after reattachment on rotation, and once when attribution content first populates; never
after the user opened it; no private `_` methods, no CSS hiding of credits.

Tests: plan §4 S24 list; layout.spec opens the attribution based on its actual expanded state and keeps every
link/href assertion.

Acceptance: `ui_gate && ui_e2e tests/e2e/layout.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/map-visual.spec.ts tests/e2e/real-data.spec.ts`.

## S25: Cross-feature regression and validation record

Files: `tests/e2e/ui-pop.spec.ts`, `tests/unit/game-hud.test.ts`, `.claude/docs/reviews/ui-pop-hud-inventory-validation.md` (new).

Requirements: plan §4 S25 list; the validation record lists every command with counts and durations, CI WebKit
result (or "pending CI" explicitly), and the forbidden-path audit output:

```bash
git diff --exit-code "$UI_POP_BASE" -- src/features/game/engine/ src/features/game/gameSession.ts \
  src/features/game/itemSession.ts src/features/game/store/ src/types/network.ts public/data/ data/ \
  src/features/game/shareText.ts
```

(`UI_POP_BASE` = the commit before S1, recorded in the handoff doc.)

Acceptance: `ui_gate && ui_e2e` (full); CI all projects green.

---

## R: Reviewer prompt body (Codex Sol low, read-only)

Objective: Review the uncommitted change for step {STEP} of `.claude/docs/plans/ui-pop-hud-inventory-plan.md`
in `/home/yuulis/yamanote-line-sugoroku` (read-only). Read the plan §2–§4, the step's section in
`.claude/docs/plans/ui-pop-hud-inventory-prompts.md`, and `git diff HEAD` plus untracked files.
Check: the step's requirements are fully met (no stubs/TODO); only owned files changed; no forbidden path; no
weakened, skipped or deleted assertion and expected values unchanged; no hidden compatibility markup; exactly one
gameplay status region; dice text contract; badge guardrails (no rounded square around letters, no ring around a
letter, no station numbers, no invented codes); straight progress bar; reduced-motion handling; 44px targets;
focus/Escape order; conventions (named exports, `XxxProps`, global BEM CSS, `.test.ts`, stable harness for
lifecycle tests); no new dependencies.
Output format: `## Verdict (ACCEPT / CHANGES_REQUIRED)`, `## Blocking Findings` (file:line, why, fix),
`## Non-blocking`, `## Checks Not Verifiable From the Diff`.
