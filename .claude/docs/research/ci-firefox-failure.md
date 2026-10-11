# CI: desktop-firefox E2E failures (run 38142729057)

## Symptom

All 16 `desktop-firefox` tests failed on GitHub Actions (`ubuntu-latest`);
Chromium desktop/phone and WebKit passed. First attempt: `openTitle()` ->
`getByRole('main', { name: '山手線すごろく' })` "element(s) not found" after 7 s
(`tests/e2e/support/app.ts:93`). Retries often hit the 30 s test timeout.

## Root cause

Headless Firefox on Linux gets a GL backend only through an X display. GitHub
runners have no `DISPLAY`, so Firefox's gfx probe leaves `AllowWebgl2=false`,
`canvas.getContext("webgl2")` fails, and MapLibre's constructor throws
`GPUInitializationError`. `new MapLibreMap(...)` runs inside a `useEffect`
(`src/features/map/RailwayMap.tsx:108`) with no try/catch and no React error
boundary. The uncaught effect error unmounts the whole React root, so the
title `<main>` never exists.

Locally it passes because WSLg exports `DISPLAY=:0` / `WAYLAND_DISPLAY`, and
Firefox picks up llvmpipe through them.

## Evidence

CI trace (`layout ... 8.3-1 ... desktop-firefox/trace.zip`):

- Network: every request 200 on `http://127.0.0.1:4319` (`/`, `assets/*.js|css`,
  `/data/stations.json`, `services.json`, `segments.geojson`, `segments.json`,
  `manifest.json`). The dead-proxy leak guard and the host choice are not involved.
- Console: `Failed to create WebGL context: WebGL creation failed:
  * AllowWebgl2:false restricts context creation on this system.`
- pageError: `GPUInitializationError: WebGL2 is required to display this map...
  at _setupPainter ...` (React commit stack).

Local probe (Playwright 1.63.0, firefox-1543, headless,
`canvas.getContext("webgl2")`):

| Environment | Result |
|---|---|
| default (WSLg DISPLAY + WAYLAND_DISPLAY) | ok, llvmpipe |
| `env -u DISPLAY -u WAYLAND_DISPLAY` | FAIL, exact CI message `AllowWebgl2:false` |
| no display + `webgl.force-enabled=true` | FAIL, `Exhausted GL driver options (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS)` |
| no display + `gfx.blocklist.all=-1` | FAIL, `AllowWebgl2:false` |
| no display + `LIBGL_ALWAYS_SOFTWARE=1` / `EGL_PLATFORM=surfaceless` / `MOZ_X11_EGL=1` | FAIL |
| `DISPLAY=:0` only (X11, Wayland unset) | ok, llvmpipe |

Running the suite with no display
(`env -u DISPLAY -u WAYLAND_DISPLAY npx playwright test --project=desktop-firefox tests/e2e/layout.spec.ts:18`)
reproduces the CI failure exactly: "element(s) not found" on the title.

No Firefox pref restores WebGL2 without a display. The fix therefore has to
provide one.

## Fix

`.github/workflows/ci.yml`, "Run E2E tests" step:
`run: xvfb-run --auto-servernum npm run test:e2e`.

- `xvfb` is in Playwright 1.63.0's ubuntu24.04 `--with-deps` tool list.
- On Ubuntu Noble, `xvfb-run` defaults to `-screen 0 1280x1024x24`. Firefox's
  X11/EGL probe rejects depths other than 24, so the default is suitable.
- A DISPLAY does not make Playwright run headed; Chromium and WebKit stay headless.
- `playwright.config.ts` gets a comment on the Firefox project only.

Codex (gpt-6.1-sol, read-only) independently confirmed the causal chain and the fix.

## Residual risk

- Not verified under real Xvfb (no Xvfb/sudo/Docker on the dev machine); verified
  only via the WSLg X server. The next CI run is the proof.
- Mesa software GL (`libgl1-mesa-dri` / llvmpipe) is not in Playwright's
  explicit dep list (installs use `--no-install-recommends`). WebKit renders the
  WebGL map on the same runner, which implies a working Mesa stack. If Firefox
  still fails under Xvfb, add
  `sudo apt-get install -y --no-install-recommends libgl1-mesa-dri` and check
  Firefox gfx startup logs before trying prefs.

## Follow-ups (not done, out of scope)

- App robustness: a missing WebGL2 blanks the entire app instead of showing
  the title and a map error. Guard the `MapLibreMap` constructor (try/catch to
  the existing map-error UI) or add a scoped error boundary. Users without
  WebGL2 currently get a blank page.
- Diagnosability: an optional preflight in `openTitle()` asserting
  `getContext("webgl2")` is non-null, with the message "WebGL2 unavailable;
  check X display / Mesa". It would turn this failure mode into a self-explaining one.
