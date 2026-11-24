import type { Page } from "@playwright/test";

/**
 * Platform stubs for the clear screen's share actions (Issue #69, S7). They record every call, in order, on
 * window.__shareLog so a test can assert the synchronous sequence of a click, and nothing ever reaches x.com.
 */
export interface ShareStubOptions {
  /** navigator.canShare({ files }) answer; "absent" removes both navigator.share and navigator.canShare. */
  readonly canShare: boolean | "absent";
  /** How navigator.share settles. */
  readonly share: "resolve" | "abort" | "reject";
  /** How navigator.clipboard.write settles; "absent" removes ClipboardItem and clipboard.write. */
  readonly clipboard: "resolve" | "reject" | "absent";
  /** "popup" returns a recording about:blank popup, "null" simulates a blocked popup. */
  readonly open: "popup" | "null";
}

export const DEFAULT_SHARE_STUBS: ShareStubOptions = { canShare: false, share: "resolve", clipboard: "resolve", open: "popup" };

export interface ShareLogEntry {
  readonly call: string;
  readonly [key: string]: unknown;
}

/** Self-contained: Playwright serialises this function into each document. */
function installShareStubs(options: ShareStubOptions): void {
  const log: ShareLogEntry[] = [];
  (window as unknown as { __shareLog: ShareLogEntry[] }).__shareLog = log;
  const define = (target: object, name: string, value: unknown): void => {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  };
  const fileNames = (data: { files?: File[] }): string[] => (data.files ?? []).map((file) => `${file.name}:${file.type}:${file.size > 0}`);

  if (options.canShare === "absent") {
    define(navigator, "share", undefined);
    define(navigator, "canShare", undefined);
  } else {
    define(navigator, "canShare", (data: { files?: File[] }) => {
      log.push({ call: "canShare", files: fileNames(data) });
      return options.canShare;
    });
    define(navigator, "share", (data: { files?: File[]; text?: string }) => {
      log.push({ call: "share", keys: Object.keys(data).sort(), files: fileNames(data), text: data.text });
      if (options.share === "abort") return Promise.reject(new DOMException("cancelled", "AbortError"));
      if (options.share === "reject") return Promise.reject(new DOMException("denied", "NotAllowedError"));
      return Promise.resolve();
    });
  }

  if (options.clipboard === "absent") {
    define(window, "ClipboardItem", undefined);
    define(navigator, "clipboard", { writeText: (text: string) => { log.push({ call: "clipboard.writeText", text }); return Promise.resolve(); } });
  } else {
    define(window, "ClipboardItem", class {
      readonly data: Record<string, unknown>;
      constructor(data: Record<string, unknown>) {
        this.data = data;
        log.push({ call: "ClipboardItem", types: Object.keys(data), promiseValued: data["image/png"] instanceof Promise });
      }
    });
    define(navigator, "clipboard", {
      writeText: (text: string) => { log.push({ call: "clipboard.writeText", text }); return Promise.resolve(); },
      write: (items: Array<{ data: Record<string, Promise<Blob>> }>) => {
        log.push({ call: "clipboard.write", items: items.length });
        void Promise.resolve(items[0]?.data["image/png"]).then((blob) => {
          log.push({ call: "clipboard.blob", type: blob?.type, nonEmpty: (blob?.size ?? 0) > 0 });
        });
        return options.clipboard === "reject" ? Promise.reject(new DOMException("denied", "NotAllowedError")) : Promise.resolve();
      },
    });
  }

  define(window, "open", (url?: string | URL, target?: string) => {
    log.push({ call: "open", url: String(url), target });
    if (options.open === "null") return null;
    let opener: unknown = {};
    return {
      get opener(): unknown { return opener; },
      set opener(value: unknown) { opener = value; log.push({ call: "popup.opener", value: String(value) }); },
      location: { set href(value: string) { log.push({ call: "popup.location", href: value }); } },
      close: () => { log.push({ call: "popup.close" }); },
    };
  });
}

export async function stubShareApis(page: Page, options: Partial<ShareStubOptions> = {}): Promise<void> {
  await page.addInitScript(installShareStubs, { ...DEFAULT_SHARE_STUBS, ...options });
}

export async function readShareLog(page: Page): Promise<ShareLogEntry[]> {
  return page.evaluate(() => (window as unknown as { __shareLog?: ShareLogEntry[] }).__shareLog?.slice() ?? []);
}
