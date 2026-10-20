# A1 Result Text Sharing — Codex Prompts

## P1: Implement A1 (Luna high)

### Objective

Add result text sharing to the clear screen: a 「結果をコピー」 button, plus a
「共有」 button on devices with the Web Share API, so a player can pass on
which edition they cleared and in how many turns, moves and transfers.

### User decisions (2026-10-20, fixed; recorded in `.claude/docs/DESIGN.md`)

- Share text contains: edition name (title + subtitle from the edition
  registry), 所要ターン数, 移動回数（駅間）, 乗換回数 (from the existing
  `summarizeGame` in `src/features/game/gameSummary.ts`, the same numbers the
  clear screen shows), the hashtag `#山手線すごろく`, and the site URL
  `https://yamanote-line-sugoroku.vercel.app`. No date, no seed/replay link.
- 「結果をコピー」 is always shown. 「共有」 is shown only when
  `navigator.share` exists and `navigator.canShare?.({ text })` is not false.
- If copying or sharing fails, the result must not be lost: show the share
  text in a read-only, selectable field (e.g. a `<textarea readonly>` with a
  label) with a message telling the player to select and copy it.
- No change to save format, rules, engine, data or pipeline.

### Proposed text (adjust wording only if it reads unnaturally)

```
山手線すごろく 東京近郊版をクリア！
所要ターン数 61・移動回数 240・乗換回数 35
#山手線すごろく
https://yamanote-line-sugoroku.vercel.app
```

### Implementation guidance

1. Read first: `src/features/game/components/ClearScreen.tsx`,
   `src/features/game/gameSummary.ts`, `src/app/GameApp.tsx` (how ClearScreen
   is rendered and what it receives), `src/features/editions/registry.ts` and
   `types.ts` (`EditionDisplay`), `src/styles.css` (clear-screen styles),
   existing jsdom tests `tests/unit/edition-picker.test.ts`,
   `tests/unit/helpers/reactDom.ts`, and `tests/e2e/full-game.spec.ts`.
2. Pure text builder (new small module, e.g.
   `src/features/game/shareText.ts`): `buildShareText(display, summary)`
   returning the exact string; the site URL and hashtag as named constants
   (no magic strings inline). Unit-test it with exact expected output.
3. Share actions as a small module or hook with injectable
   `clipboard`/`share` dependencies so tests do not touch real browser APIs:
   - copy: `navigator.clipboard.writeText`; missing API or rejection →
     failure state.
   - share: `navigator.share({ text })`; an `AbortError` (user cancelled)
     is NOT a failure and shows nothing; other errors → failure state.
4. UI in ClearScreen (pass the edition display down from GameApp):
   - buttons in the clear screen's action area, matching existing button
     styles; keyboard reachable; visible focus.
   - one `role="status"` (polite) message: 「結果をコピーしました」 on copy
     success; on failure 「コピーできませんでした。下の文面を選択してコピーしてください。」
     (or the share equivalent), and then render the labelled read-only
     textarea containing the share text.
   - keep the existing clear-screen focus behaviour (heading focus on
     mount) and the history list unchanged.
5. Tests (follow `.claude/rules/testing.md`; jsdom per-file with
   `// @vitest-environment jsdom` like the existing picker tests):
   - text builder: exact output for the current edition display and a
     fixture display; numbers from `summarizeGame`.
   - copy success → status message, no textarea; copy failure (rejection
     and missing API) → status message + textarea with the exact text.
   - share button hidden without `navigator.share`; shown with it; abort →
     no message; other error → fallback textarea.
   - E2E: extend `tests/e2e/full-game.spec.ts` minimally — assert the
     「結果をコピー」 button is visible on the clear screen. Do not add new
     slow real-data playthroughs and do not depend on real clipboard
     permissions (they differ across Chromium/Firefox/WebKit).
6. Docs: add `docs/manual/result-share/implementation-status.md` (Japanese,
   `.claude/rules/manual-docs.md`) describing the feature, the exact text
   format, and failure behaviour.

### Constraints

- Follow `.claude/rules/coding-principles.md` (immutability, types, no
  magic numbers/strings, small files) and match surrounding code style.
- Do not weaken, skip or delete existing tests. No new dependencies.
- Commit in 1–3 logical commits (conventional style), each message ending
  with a blank line and
  `Co-Authored-By: Codex (gpt-6-luna) <noreply@openai.com>`. Do not push.
- Do not edit files under `.claude/` except the step table in
  `.claude/docs/plans/a1-result-share-handoff.md` (fill commit SHAs — copy
  them from `git log`, do not type them — and evidence, in a separate
  `docs:` commit).

### Acceptance (all must pass; report counts)

- `npm run typecheck`
- `npm test`
- `npm run build`
- `env -u WAYLAND_DISPLAY npm run test:e2e -- --project=desktop-chromium`
- `env -u WAYLAND_DISPLAY npm run test:e2e -- --project=phone-chromium`
- Firefox and WebKit: CI only; report as "CI only".

### Output

Reply with: commits (SHA + subject), the exact share text produced for a
sample summary, acceptance results with counts, any deviation and why,
anything left unrun.
