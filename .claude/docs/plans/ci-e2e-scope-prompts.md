# Issue #83: CI E2E scope — implementation prompts

Branch: `feature/ci-e2e-scope` (from `origin/develop` d5234c0, v0.14.0).
Implementer: Codex Luna xhigh; reviewer: Codex Sol low; lead verifies.
Pacing: continuous (user 2026-11-12). Handoff: `ci-e2e-scope-handoff.md`.

User decisions (2026-11-12):

- Add a `pull_request` trigger for PRs into `develop` / `master` (supersedes
  decision B of 2026-10-20, "push only, no pull_request trigger").
- Feature-branch pushes run E2E on `desktop-chromium` only, and their aggregate
  job must NOT be named `E2E (Playwright)`, so it can never satisfy the
  required check of rulesets `protect-develop` / `protect-master`
  (integration_id 15368 = GitHub Actions).
- `phone-chromium` runs only tests tagged `@layout`; when in doubt, tag.

---

## S1 — CI workflow (`.github/workflows/ci.yml` only)

Objective: make feature-branch pushes run only the desktop-chromium E2E leg,
while PRs into develop/master, pushes to develop/master and manual dispatches
run all four legs and produce the required check `E2E (Playwright)`.

Scope: edit only `.github/workflows/ci.yml`. Do not touch `playwright.config.ts`,
specs, docs, or any other file. Do not commit.

Required behaviour:

1. Triggers: keep `push: branches: ["**"]` and `workflow_dispatch`; add
   `pull_request: branches: [develop, master]` (default activity types).
2. Scope per event, computed once in the `changes` job and exposed as outputs:
   - `full` (4 legs: desktop-chromium, phone-chromium, desktop-firefox,
     desktop-webkit — same browser mapping as today): `pull_request`,
     `workflow_dispatch`, and `push` to `refs/heads/develop` or `refs/heads/master`.
   - `quick` (desktop-chromium leg only): every other `push`.
   - The matrix becomes `${{ fromJSON(needs.changes.outputs.matrix) }}` (an
     object with an `include` list). Leg job names stay `E2E leg (<project>)`.
     Always emit a valid matrix output, even when E2E is skipped.
3. Aggregate job (`e2e`) name: `E2E (Playwright)` for full scope, and
   `E2E quick (desktop-chromium)` for quick scope. Derive the name from the
   `github` context only (event_name / ref) so it never depends on a job
   output and a failed detection still yields a deterministic name. The
   condition must be exactly equivalent to the `changes` job's scope rule;
   add a comment on both saying they must stay in sync. Pass/fail logic stays
   as today (every leg success, or a verified docs-only skip).
4. Docs-only skip:
   - `push` to a working branch: unchanged (baseline `origin/develop`).
   - `pull_request`: now also eligible. Diff `merge-base(base_sha, head_sha)`
     ..`head_sha` using `github.event.pull_request.base.sha` and
     `github.event.pull_request.head.sha` (the checkout is the merge commit;
     with `fetch-depth: 0` both SHAs are present). The fork-point
     verification is unchanged: every GitHub Actions `E2E (Playwright)` check
     run on the merge-base must be success, and at least one must exist.
   - `workflow_dispatch` and pushes to develop/master: always run (no skip).
   - Every doubt still runs the suite, as today.
5. Concurrency: keep the group including `github.event_name`, so push and
   pull_request runs of the same branch never cancel each other. Keep
   post-merge develop/master runs uncancelled.
6. Frontend and pipeline jobs run in every event (no per-event skipping: a
   skipped same-named check run counts as passing). Accept the duplicate run
   on PRs.
7. Rewrite the header comment (decision B) and the `changes` / `e2e-matrix` /
   `e2e` comments to describe the new model, dated 2026-11-12 ("decision D").
   Keep comments factual and concise; keep the existing Firefox/WebKit comments.
8. Security: use `pull_request`, never `pull_request_target`; keep
   `permissions: contents: read` at top level and `checks: read` only on
   `changes`; pass event data through `env`, never interpolate
   `${{ github.event... }}` directly into `run:` scripts.

Acceptance checks (run them):

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"
# If available: actionlint .github/workflows/ci.yml  (do not install anything)
bash -n <(python3 - <<'PY'
import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml'))
for j in d['jobs'].values():
    for s in j.get('steps', []):
        if 'run' in s and '${{' not in s['run']: print(s['run'])
PY
)
git diff --stat -- .github/   # only ci.yml is yours; S2 edits playwright.config.ts and tests/e2e in parallel — never stash or revert other files
```

Also write a short truth table (event × ref → scope, aggregate name, docs-only
eligible) to `.claude/logs/ci-e2e-scope/s1-truth-table.md`.

Output: TL;DR, changed files, truth table path, acceptance results, risks.

---

## S2 — `@layout` tags and phone filter

Objective: phone-chromium runs only layout-dependent E2E tests, tagged
`@layout`, while the three desktop projects keep running every test.

Scope: `playwright.config.ts` and `tests/e2e/*.spec.ts` (tags only). Do not
change test bodies, assertions, timeouts, skips or helpers. Do not touch
`.github/`, docs, or `src/`. Do not commit.

Required behaviour:

1. Use Playwright 1.63 test tags: `test("title", { tag: "@layout" }, ...)` or
   `test.describe("title", { tag: "@layout" }, ...)` when a whole group
   qualifies. Do not put the tag in the title string.
2. `playwright.config.ts`: on the `phone-chromium` project add
   `grep: /@layout/` with a comment pointing to issue #83 and explaining that
   the tag is matched against titles and tags. Desktop projects get no grep.
3. Decide spec by spec, test by test. Tag a test when its outcome depends on
   viewport size, touch, or layout: HUD placement, text wrapping/overflow,
   map vs panel overlap or camera fit, dialog/popover/toast placement,
   scrolling, phone-specific UI, `isMobile` / `hasTouch` / viewport /
   `testInfo.project.name` branches, screenshots or bounding-box checks.
   **When in doubt, tag** (do not under-cover the phone).
   Mandatory: any test that only runs (or only asserts something) on the
   phone project — e.g. `test.skip(project !== "phone-chromium")` or a
   phone-only branch — must be tagged, otherwise it would never run.
   Do not tag pure logic flows (save/load, rules, auto-roll decisions, item
   logic) unless they also check layout.
4. Write the decision record to `.claude/logs/ci-e2e-scope/s2-layout-tags.md`:
   per spec file, tagged tests (title + one-line reason) and the count of
   untagged tests, plus the totals below.

Acceptance checks (run them; do NOT run the E2E suite itself):

```bash
npm run typecheck
npx playwright test --list --project=desktop-chromium | tail -1
npx playwright test --list --project=phone-chromium | tail -1
npx playwright test --list --project=desktop-chromium --grep @layout | tail -1
git diff --stat -- playwright.config.ts tests/   # only these paths are yours
```

Never use `git stash`, `git checkout -- <path>` or any command that touches
other files: S1 edits `.github/workflows/ci.yml` in the same tree at the same
time. Baseline before S2 (measured by the lead): every project lists
`Total: 218 tests in 22 files`. After S2 the desktop-chromium count must still
be 218; the phone count must equal the desktop `--grep @layout` count and be
lower than 218.

Output: TL;DR, changed files, counts (before/after per project), record path,
borderline calls you made, risks.
