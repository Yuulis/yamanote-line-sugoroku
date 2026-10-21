import { defineConfig, devices } from "@playwright/test";

// E2E suite for spec section 8.3 (tests/e2e). Runs against `vite preview` of
// a production build, so the bundled MapLibre worker path is exercised. All
// background-map traffic is stubbed in tests/e2e/fixtures.ts (no internet).

const PORT = 4319;
/**
 * IPv6 loopback by default: under WSL2 mirrored networking, 127.0.0.1 is
 * shared with Windows, which silently drops connections to closed ports, so
 * Playwright's "is the port free?" probe stalls ~2 minutes before the server
 * starts. ::1 stays local and refuses at once. Without IPv6: E2E_HOST=127.0.0.1
 */
const HOST = process.env.E2E_HOST ?? "::1";
const URL_HOST = HOST.includes(":") ? `[${HOST}]` : HOST;
const BASE_URL = `http://${URL_HOST}:${PORT}/`;
const isCI = Boolean(process.env.CI);
/**
 * WebKit needs system libraries that only `playwright install --with-deps`
 * (sudo) provides, so it is on for GitHub Actions or an explicit E2E_WEBKIT=1,
 * and off for a plain local run (including `CI=1` on a dev machine).
 */
const withWebkit = Boolean(process.env.GITHUB_ACTIONS || process.env.E2E_WEBKIT);
/**
 * `--mode e2e` keeps NODE_ENV=production (minified, bundled worker) but turns
 * on the map observation hook (src/features/map/e2eHook.ts). It is written
 * outside dist/ so `npm run build` output is never the hook-enabled bundle.
 */
const E2E_OUT_DIR = "node_modules/.cache/sugoroku-e2e-dist";
/**
 * Each test renders WebGL in software; more workers mostly add memory pressure.
 * With the Tokyo suburban bundle, 4 workers timed out or lost browsers on a
 * 7 GB WSL2 host while 1 and 2 passed (S7 R4, .claude/logs/s7/workers/).
 * Pass --workers=N explicitly to diagnose higher counts.
 */
const LOCAL_WORKERS = 2;

/** Port 9 (discard) has no listener: a request sent through it just fails. */
const DEAD_PROXY = "http://[::1]:9";
/** Chromium matches "[::1]", Firefox (Juggler) the bare "::1". */
const LOOPBACK_HOSTS = "127.0.0.1,localhost,[::1],::1";

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : LOCAL_WORKERS,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    // Moves finish instantly (spec 6.3); tests that need the animation opt out.
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    // Defence in depth for hermeticity: requests are stubbed or aborted by
    // the routes in tests/e2e/support/mapStub.ts, and anything that slipped
    // past them would hit this unreachable proxy instead of the internet.
    proxy: { server: DEAD_PROXY, bypass: LOOPBACK_HOSTS },
  },
  // WebKit is opt-in (see withWebkit): it needs system libraries (libgtk-4,
  // gstreamer, libavif...) installed with `sudo npx playwright install-deps`,
  // which the CI runner gets from `playwright install --with-deps`. See README.
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
    },
    {
      // Phone-sized Chromium with touch (Pixel 7: 412x839 CSS px).
      name: "phone-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      // Needs an X display for WebGL2 even when headless (no DISPLAY ->
      // "AllowWebgl2:false"); CI wraps the run in xvfb-run.
      name: "desktop-firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: DESKTOP_VIEWPORT,
        launchOptions: {
          firefoxUserPrefs: {
            // Belt and braces: never let Firefox retry a failed proxy directly.
            "network.proxy.failover_direct": false,
            // At launch Firefox probes the GL driver in a child process
            // (gfxtest) and, if the probe misses its fixed 4 s deadline (a cold
            // CI runner), blocklists WebGL2 for the whole browser: every map
            // then fails with "AllowWebgl2:false restricts context creation"
            // and the app shows its no-WebGL2 notice. Skipping that blocklist
            // gate makes context creation depend only on the real driver
            // (llvmpipe under xvfb), which is what the suite means to test.
            "webgl.force-enabled": true,
          },
        },
      },
    },
    ...(withWebkit
      ? [
          {
            name: "desktop-webkit",
            use: { ...devices["Desktop Safari"], viewport: DESKTOP_VIEWPORT },
          },
        ]
      : []),
  ],
  webServer: {
    command:
      `npx vite build --mode e2e --outDir ${E2E_OUT_DIR} --emptyOutDir && ` +
      `npx vite preview --mode e2e --outDir ${E2E_OUT_DIR} --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Always build fresh: a reused server could be serving a stale bundle.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
