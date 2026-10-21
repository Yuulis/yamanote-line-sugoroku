export const ANALYTICS_OPT_OUT_KEY = "yamanote-line-sugoroku:analytics-opt-out";
const GA_SCRIPT_BASE_URL = "https://www.googletagmanager.com/gtag/js?id=";
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,}$/;
const MAX_ERROR_NAME_LENGTH = 100;

type EventName = "game_start" | "game_clear" | "result_share";
type EventParams = Record<string, string | number>;
type Gtag = (...args: unknown[]) => void;

interface AnalyticsConfig {
  measurementId?: string;
  production: boolean;
  window: Window;
  document: Document;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

interface Analytics {
  initAnalytics: () => void;
  trackEvent: (name: EventName, params: EventParams) => void;
  trackException: (description: string, fatal: boolean) => void;
  isAnalyticsOptedOut: () => boolean;
  setAnalyticsOptOut: (optedOut: boolean) => void;
}

const EVENT_KEYS: Record<EventName, readonly string[]> = {
  game_start: ["mode"],
  game_clear: ["turns", "moves", "transfers"],
  result_share: ["method", "outcome"],
};
const EVENT_VALUES: Record<string, readonly string[]> = {
  mode: ["new", "resume"],
  method: ["copy", "share"],
  outcome: ["success", "failed", "cancelled"],
};

function safeParams(name: EventName, params: EventParams): EventParams | null {
  const allowed = EVENT_KEYS[name];
  const keys = Object.keys(params);
  if (keys.some((key) => !allowed.includes(key))) return null;
  for (const [key, value] of Object.entries(params)) {
    if (EVENT_VALUES[key] && (typeof value !== "string" || !EVENT_VALUES[key]!.includes(value))) return null;
    if ((key === "turns" || key === "moves" || key === "transfers") &&
      (typeof value !== "number" || !Number.isInteger(value) || value < 0)) return null;
  }
  return { ...params };
}

export function createAnalytics(config: AnalyticsConfig): Analytics {
  const { measurementId, production, window: browserWindow, document: browserDocument } = config;
  const storage = config.storage;
  const enabled = Boolean(production && measurementId && MEASUREMENT_ID_PATTERN.test(measurementId));
  let optedOut = false;
  let initialized = false;
  let gtag: Gtag | null = null;

  const readOptOut = (): boolean => {
    if (optedOut) return true;
    try {
      optedOut = storage?.getItem(ANALYTICS_OPT_OUT_KEY) === "true";
    } catch {
      // Storage failure allows analytics for this session unless opted out in memory.
    }
    return optedOut;
  };
  const setDisabledFlag = (disabled: boolean): void => {
    if (!measurementId) return;
    (browserWindow as Window & Record<string, unknown>)[`ga-disable-${measurementId}`] = disabled;
  };
  const invoke = (...args: unknown[]): void => {
    if (!enabled || readOptOut()) return;
    gtag?.(...args);
  };

  const initAnalytics = (): void => {
    if (!enabled || initialized) return;
    setDisabledFlag(readOptOut());
    if (readOptOut()) return;
    initialized = true;
    const existing = (browserWindow as Window & { dataLayer?: unknown[]; gtag?: Gtag }).gtag;
    gtag = existing ?? ((...args: unknown[]) => {
      const target = browserWindow as Window & { dataLayer?: unknown[] };
      target.dataLayer = target.dataLayer ?? [];
      target.dataLayer.push(args);
    });
    (browserWindow as Window & { gtag?: Gtag }).gtag = gtag;
    gtag("js", new Date());
    gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: `${browserWindow.location.origin}${browserWindow.location.pathname}`,
    });
    const scriptUrl = `${GA_SCRIPT_BASE_URL}${measurementId}`;
    if (!browserDocument.querySelector(`script[src="${scriptUrl}"]`)) {
      const script = browserDocument.createElement("script");
      script.async = true;
      script.src = scriptUrl;
      script.onerror = () => undefined;
      browserDocument.head.append(script);
    }
    browserWindow.addEventListener("error", (event) => {
      const errorName = event.error instanceof Error ? event.error.name : "Error";
      trackException(errorName, false);
    });
    browserWindow.addEventListener("unhandledrejection", (event) => {
      const errorName = event.reason instanceof Error ? event.reason.name : "Error";
      trackException(errorName, false);
    });
  };

  const trackEvent = (name: EventName, params: EventParams): void => {
    const clean = safeParams(name, params);
    if (!clean) return;
    invoke("event", name, clean);
  };
  const trackException = (description: string, fatal: boolean): void => {
    if (!enabled || readOptOut()) return;
    const errorName = description.slice(0, MAX_ERROR_NAME_LENGTH) || "Error";
    invoke("event", "exception", { description: errorName, fatal });
  };
  const setAnalyticsOptOut = (next: boolean): void => {
    optedOut = next;
    setDisabledFlag(next);
    try {
      if (next) storage?.setItem(ANALYTICS_OPT_OUT_KEY, "true");
      else storage?.removeItem(ANALYTICS_OPT_OUT_KEY);
    } catch {
      // Keep this preference in memory for the current session.
    }
    if (!next) initAnalytics();
  };
  return { initAnalytics, trackEvent, trackException, isAnalyticsOptedOut: readOptOut, setAnalyticsOptOut };
}

function createBrowserAnalytics(): Analytics | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return createAnalytics({
    measurementId: import.meta.env.VITE_GA_MEASUREMENT_ID,
    production: import.meta.env.PROD,
    window,
    document,
    storage,
  });
}

let browserAnalytics: Analytics | null | undefined;
function analytics(): Analytics | null {
  browserAnalytics ??= createBrowserAnalytics();
  return browserAnalytics;
}

export const initAnalytics = (): void => analytics()?.initAnalytics();
export const trackEvent = (name: EventName, params: EventParams): void => analytics()?.trackEvent(name, params);
export const trackException = (description: string, fatal: boolean): void => analytics()?.trackException(description, fatal);
export const isAnalyticsOptedOut = (): boolean => analytics()?.isAnalyticsOptedOut() ?? false;
export const setAnalyticsOptOut = (optedOut: boolean): void => analytics()?.setAnalyticsOptOut(optedOut);
