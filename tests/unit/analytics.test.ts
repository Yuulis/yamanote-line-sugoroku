// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ANALYTICS_OPT_OUT_KEY, createAnalytics } from "../../src/features/analytics/analytics";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function analytics(options: { measurementId?: string; production?: boolean; optedOut?: boolean } = {}) {
  const memory = new Map<string, string>();
  if (options.optedOut) memory.set(ANALYTICS_OPT_OUT_KEY, "true");
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };
  return {
    instance: createAnalytics({
      measurementId: options.measurementId,
      production: options.production ?? true,
      window,
      document,
      storage,
    }),
    memory,
  };
}

/** gtag.js commands as plain arrays; the queue itself must hold `arguments` objects. */
function queued(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

beforeEach(() => {
  document.head.replaceChildren();
  delete (window as Window & { dataLayer?: unknown[] }).dataLayer;
  delete (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
});

describe("analytics safeguards", () => {
  it("does not load or emit without a valid production measurement ID or when opted out", () => {
    for (const options of [
      { measurementId: undefined, production: true },
      { measurementId: "not-an-id", production: true },
      { measurementId: "G-ABCD1234", production: false },
      { measurementId: "G-ABCD1234", production: true, optedOut: true },
    ]) {
      const instance = analytics(options).instance;
      instance.initAnalytics();
      instance.trackEvent("game_start", { mode: "new" });
      expect(document.querySelectorAll("script[src*='googletagmanager']")).toHaveLength(0);
    }
  });

  it("injects one async script and configures privacy-safe page location", () => {
    const { instance } = analytics({ measurementId: "G-ABCD1234" });
    window.history.replaceState({}, "", "/play?secret=not-sent");
    instance.initAnalytics();
    instance.initAnalytics();
    expect(document.querySelectorAll("script[src='https://www.googletagmanager.com/gtag/js?id=G-ABCD1234']")).toHaveLength(1);
    expect(document.querySelector("script")?.async).toBe(true);
    // gtag.js ignores queued arrays; only `arguments` objects are processed.
    expect((window.dataLayer ?? []).every((entry) => Object.prototype.toString.call(entry) === "[object Arguments]")).toBe(true);
    expect(queued()).toContainEqual(["config", "G-ABCD1234", {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: `${window.location.origin}/play`,
    }]);
  });

  it("persists opt-out and only sends the allowed event keys and values", () => {
    const { instance, memory } = analytics({ measurementId: "G-ABCD1234" });
    instance.initAnalytics();
    instance.setAnalyticsOptOut(true);
    expect(instance.isAnalyticsOptedOut()).toBe(true);
    expect(memory.get(ANALYTICS_OPT_OUT_KEY)).toBe("true");
    instance.trackEvent("game_start", { mode: "new" });
    expect(queued()).not.toContainEqual(["event", "game_start", { mode: "new" }]);
    instance.setAnalyticsOptOut(false);
    expect(instance.isAnalyticsOptedOut()).toBe(false);
    instance.trackEvent("game_start", { mode: "resume", stationId: "secret" });
    expect(queued()).not.toContainEqual(expect.arrayContaining(["event", "game_start"]));
    instance.trackEvent("game_clear", { turns: 15, moves: 10, transfers: 2 });
    expect(queued()).toContainEqual(["event", "game_clear", { turns: 15, moves: 10, transfers: 2 }]);
  });
});
