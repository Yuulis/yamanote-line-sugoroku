# Launch: Credits Screen, Analytics, Privacy, Version — Codex Prompts

## P1: Implement (Luna high)

### Objective

Before public promotion, add (1) a credits screen reachable from the title
screen that carries the unofficial-work notice and all credits, (2) Google
Analytics 4 with privacy safeguards and a player opt-out, (3) a short
Japanese privacy policy page, and (4) a visible app/data version.

### User decisions (2026-10-21, fixed; `.claude/docs/DESIGN.md` Key Decisions D3–D5)

- D4: the title screen's 「出典・ライセンス」 section moves to a new credits
  screen; the title keeps only a 「クレジット」 button. Map attribution on the
  map itself stays as is. Contact = GitHub Issues
  (`https://github.com/Yuulis/yamanote-line-sugoroku/issues`).
- D3: Google Analytics 4. Simple privacy policy.
- D5: show the version. Semver starting at 0.x: set `package.json` version to
  `0.9.0`.

### 1. Credits screen

- Opened from a 「クレジット」 button on every title-screen variant (ready,
  loading-with-picker, data-error), so data attribution stays reachable even
  when the game cannot start. Implement as a view inside the title flow (local
  state in `TitleScreen` or a small `CreditsScreen` component), not a route.
  「タイトルへ戻る」 returns to the title card. Focus: move to the credits
  heading on open, back to the 「クレジット」 button on close; Escape closes.
  Keep it keyboard- and screen-reader-friendly like the existing screens
  (`aria-labelledby`, real headings, links with `rel="noopener noreferrer"`).
- Sections, in this order (Japanese copy; keep it short):
  1. 「このゲームについて」: exactly
     「本作は非公式の個人制作ゲームで、各鉄道事業者・国土交通省とは関係ありません。」
     plus one line that it is free and runs entirely in the browser.
  2. 「出典・ライセンス」: the existing `Credits` content from
     `src/features/game/components/TitleScreen.tsx` (railway data + licence +
     base date, background map credits), moved — not rewritten — into the new
     component; plus the logo font: 「ロゴ書体: Zen Maru Gothic（SIL Open Font
     License 1.1）」 linking to the OFL text (`brand/OFL.txt` is in the repo —
     link to its GitHub URL on the default branch).
  3. 「ソースコード・お問い合わせ」: GitHub repository link and the Issues link.
  4. 「プライバシー」: link to `/privacy.html` and the analytics opt-out
     control (see §2).
  5. 「バージョン」: see §4.
- Update `tests/e2e/layout.spec.ts` [8.3-8] so it opens the credits screen
  from the title and checks the SAME attribution assertions there (do not drop
  any assertion; play-screen part unchanged). Add a unit/component test
  (jsdom, like `tests/unit/edition-picker.test.ts`) for open/close/focus and
  that the notice text and Issues link are present.

### 2. Google Analytics 4

- New module (e.g. `src/features/analytics/analytics.ts`) exposing
  `initAnalytics()`, `trackEvent(name, params)`, `trackException(description,
  fatal)`, `isAnalyticsOptedOut()` / `setAnalyticsOptOut(boolean)`.
- Measurement ID from `import.meta.env.VITE_GA_MEASUREMENT_ID`. Load gtag
  ONLY when: the ID matches `^G-[A-Z0-9]{4,}$`, `import.meta.env.PROD` is
  true, and the player has not opted out. Otherwise every function is a
  no-op. CI/E2E/unit tests have no ID, so nothing loads there — add
  `.env.example` documenting the variable (no real ID committed). Inject the
  script tag at runtime (`https://www.googletagmanager.com/gtag/js?id=…`),
  `async`; failures to load must never break the game.
- gtag config: `allow_google_signals: false`,
  `allow_ad_personalization_signals: false`; do not send the URL query string
  (set `page_location` to origin + pathname).
- Opt-out: persisted in localStorage (key e.g.
  `yamanote-line-sugoroku:analytics-opt-out`), sets
  `window["ga-disable-<ID>"] = true` before/after load. Toggle on the credits
  screen: a labelled checkbox 「アクセス解析を許可する」 (checked by default,
  unchecking opts out immediately). Storage failures fall back to "allowed for
  this session" silently.
- Events (params are small enums/integers only — never saves, seeds, station
  IDs, move history, or free text from storage):
  - `game_start` `{ mode: "new" | "resume" }`
  - `game_clear` `{ turns, moves, transfers }`
  - `result_share` `{ method: "copy" | "share", outcome: "success" | "failed" | "cancelled" }`
  - exceptions via `trackException`: data load failure (reason category),
    WebGL2 unavailable, map style/tile failure, and global
    `error`/`unhandledrejection` (error name only, truncated to 100 chars;
    `fatal: false` unless the game cannot start).
- Wire calls at the existing points (`useGameApp`/`GameApp`, `ClearScreen`
  share handlers, `EditionApp` load failure, `RailwayMap` failure states).
  Keep wiring thin; no engine changes.
- Unit tests: no-op without ID / in non-PROD / when opted out; script
  injected once with the right URL when enabled (mock `import.meta.env` via
  injectable config, not real network); opt-out persistence; event params
  contain only the allowed keys.

### 3. Privacy policy page

- `public/privacy.html`: static Japanese page, same title prefix, minimal
  inline CSS matching the app's colours, a link back to `/`. Content (concise):
  運営者（個人・非公式）、取得する情報と目的（Google Analytics 4：閲覧ページ、
  参照元、端末・ブラウザの種類、おおよその地域、ゲームの開始・クリア・共有・
  エラーの件数。Cookie 等を使用。広告・Googleシグナルは無効）、無効化の方法
  （クレジット画面のチェック、Google アナリティクス オプトアウト アドオン
  https://tools.google.com/dlpage/gaoptout）、Google のポリシーへのリンク
  （https://policies.google.com/technologies/partner-sites）、端末内保存
  （localStorage：セーブ・設定。サーバーへは送らない）、外部への通信
  （地図タイル: OpenFreeMap、ホスティング: Vercel、計測: Google）、
  第三者提供はしないこと、改定、問い合わせ先（GitHub Issues）、制定日 2026-10-21。
  Do not claim legal compliance; keep it factual.
- Extend `tests/unit/launch-metadata.test.ts` (or a new test) to assert
  `public/privacy.html` exists, is `lang="ja"`, and links to the Issues page
  and the opt-out add-on.

### 4. Version

- `package.json` version → `0.9.0`.
- In `vite.config.ts` `define`: `__APP_VERSION__` from package.json and
  `__APP_COMMIT__` = first 7 chars of `process.env.VERCEL_GIT_COMMIT_SHA`, else
  `git rev-parse --short HEAD` (catch failure → `"dev"`). Declare both in a
  `.d.ts`. Make them available to vitest too (same config).
- Credits screen 「バージョン」: `アプリ v0.9.0（abc1234）` and
  `路線データ {manifest.dataVersion}` (omit the data line when the manifest is
  unavailable). Also a small, low-contrast `v0.9.0` line at the bottom of the
  title card.
- Test the formatting function.

### Constraints

- Follow `.claude/rules/coding-principles.md`, `.claude/rules/security.md`
  (no secrets committed; the GA ID is public but still env-configured),
  `.claude/rules/testing.md`; match surrounding style; immutability; no magic
  strings inline (constants for URLs/keys).
- No new npm dependencies (gtag is loaded at runtime, not installed).
- Do not weaken, skip or delete tests; the [8.3-8] E2E change must keep every
  assertion. Title text, `documentTitle`, save format and rules unchanged.
- Add a short Japanese note `docs/manual/public-launch/analytics-and-credits.md`
  (what is measured, where the opt-out is, how to set
  `VITE_GA_MEASUREMENT_ID` in Vercel → Project → Settings → Environment
  Variables for Production, version display).
- Commit in 2–4 logical commits (conventional style), each ending with a
  blank line and `Co-Authored-By: Codex (gpt-6-luna) <noreply@openai.com>`.
  Stage explicit paths. Do not push. Do not edit `.claude/` files.

### Acceptance (all must pass; report counts)

- `npm run typecheck`
- `npm test`
- `npm run build` (and confirm `dist/` has no gtag script tag when built
  without the env var: `grep -c googletagmanager dist/index.html` → 0)
- `env -u WAYLAND_DISPLAY npm run test:e2e -- --project=desktop-chromium`
- `env -u WAYLAND_DISPLAY npm run test:e2e -- --project=phone-chromium`
- Firefox/WebKit: CI only.

### Output

Commits (SHA + subject), files added, acceptance results with counts, any
deviation and why, anything unverified (GA receipt can only be checked after
deploy with a real ID).
