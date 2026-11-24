// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  buildXIntentUrl,
  createResultImageShareActions,
  type ResultImageShareDependencies,
} from "../../src/features/game/resultImageShareActions";

const TEXT = "山手線すごろく 東京近郊版をクリア！\n所要ターン数 1・移動回数 1・乗換回数 0\n#山手線すごろく\nhttps://yamanote-line-sugoroku.vercel.app";
const INTENT = `https://x.com/intent/post?text=${encodeURIComponent(TEXT)}`;
const blob = new Blob(["png"], { type: "image/png" });
const file = new File([blob], "yamanote-sugoroku-route.png", { type: "image/png" });

interface FakePopup {
  opener: unknown;
  location: { href: string };
  close: ReturnType<typeof vi.fn>;
}

function popupFor(log: string[], overrides: Partial<{ opener: unknown; failOpener: boolean; failLocation: boolean }> = {}): FakePopup {
  let opener: unknown = overrides.opener ?? {};
  const popup = {
    get opener(): unknown { return opener; },
    set opener(value: unknown) {
      if (overrides.failOpener) throw new Error("opener is read-only");
      log.push(`opener=${String(value)}`);
      // A value that stays set after the assignment models a browser that ignores it.
      if (overrides.opener === undefined) opener = value;
    },
    location: {
      get href(): string { return ""; },
      set href(value: string) {
        if (overrides.failLocation) throw new Error("navigation denied");
        log.push(`location=${value}`);
      },
    },
    close: vi.fn(() => { log.push("close"); }),
  };
  return popup as unknown as FakePopup;
}

/** Dependencies that append every platform call to `log`, in the order they happen. */
function loggedDependencies(log: string[], overrides: Partial<ResultImageShareDependencies> = {}): ResultImageShareDependencies {
  return {
    createClipboardItem: (data) => {
      log.push(`item:${Object.keys(data).join(",")}:${data["image/png"] instanceof Promise ? "promise" : "value"}`);
      return { data } as unknown as ClipboardItem;
    },
    writeClipboard: () => { log.push("clipboard.write"); return Promise.resolve(); },
    openWindow: (url, target) => { log.push(`open:${url}:${target}`); return popupFor(log) as unknown as WindowProxy; },
    ...overrides,
  };
}

describe("X intent URL", () => {
  it("encodes the whole text, URL and newlines included, once", () => {
    expect(buildXIntentUrl(TEXT)).toBe(INTENT);
    expect(buildXIntentUrl(TEXT)).toContain("%0A%23%E5%B1%B1%E6%89%8B%E7%B7%9A");
    expect(buildXIntentUrl("a b")).toBe("https://x.com/intent/post?text=a%20b");
  });
});

describe("desktop image copy and X navigation", () => {
  it("starts the clipboard write with a Promise-valued image item before opening the popup, with no await between", () => {
    const log: string[] = [];
    const actions = createResultImageShareActions(loggedDependencies(log));
    const attempt = actions.copyImageAndOpenX(blob, TEXT);
    // Everything below happened synchronously inside the call, before any promise could settle.
    expect(log).toEqual([
      "item:image/png:promise",
      "clipboard.write",
      "open:about:blank:_blank",
      "opener=null",
      `location=${INTENT}`,
    ]);
    expect(attempt.navigation).toBe("started");
  });

  it("hands the original blob to the clipboard item and resolves copied", async () => {
    const received: Array<Record<string, Promise<Blob>>> = [];
    const actions = createResultImageShareActions(loggedDependencies([], {
      createClipboardItem: (data) => { received.push(data); return {} as ClipboardItem; },
    }));
    const attempt = actions.copyImageAndOpenX(blob, TEXT);
    expect(await received[0]!["image/png"]).toBe(blob);
    await expect(attempt.clipboard).resolves.toBe("copied");
  });

  it.each([
    ["no clipboard write API", { writeClipboard: undefined }],
    ["no ClipboardItem", { createClipboardItem: undefined }],
  ])("reports unavailable (%s) and still opens X", async (_name, override) => {
    const log: string[] = [];
    const actions = createResultImageShareActions(loggedDependencies(log, override));
    const attempt = actions.copyImageAndOpenX(blob, TEXT);
    await expect(attempt.clipboard).resolves.toBe("unavailable");
    expect(attempt.navigation).toBe("started");
    expect(log).toContain(`location=${INTENT}`);
  });

  it.each([
    ["the ClipboardItem constructor throws", { createClipboardItem: () => { throw new TypeError("unsupported type"); } }],
    ["clipboard.write throws synchronously", { writeClipboard: () => { throw new Error("not allowed"); } }],
  ])("reports sync-failed when %s, and still opens X", async (_name, override) => {
    const log: string[] = [];
    const actions = createResultImageShareActions(loggedDependencies(log, override));
    const attempt = actions.copyImageAndOpenX(blob, TEXT);
    await expect(attempt.clipboard).resolves.toBe("sync-failed");
    expect(attempt.navigation).toBe("started");
    expect(log.some((entry) => entry.startsWith("open:"))).toBe(true);
  });

  it("reports rejected when the write promise rejects, and still opens X", async () => {
    const actions = createResultImageShareActions(loggedDependencies([], {
      writeClipboard: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    }));
    const attempt = actions.copyImageAndOpenX(blob, TEXT);
    await expect(attempt.clipboard).resolves.toBe("rejected");
    expect(attempt.navigation).toBe("started");
  });

  it("reports blocked when the popup is null, open-threw when open throws, and blocked without window.open", () => {
    const blocked = createResultImageShareActions(loggedDependencies([], { openWindow: () => null }));
    expect(blocked.copyImageAndOpenX(blob, TEXT).navigation).toBe("blocked");
    const threw = createResultImageShareActions(loggedDependencies([], {
      openWindow: () => { throw new Error("popup policy"); },
    }));
    expect(threw.copyImageAndOpenX(blob, TEXT).navigation).toBe("open-threw");
    const missing = createResultImageShareActions(loggedDependencies([], { openWindow: undefined }));
    expect(missing.copyImageAndOpenX(blob, TEXT).navigation).toBe("blocked");
  });

  it("closes the unused blank tab when the opener cannot be cleared", () => {
    for (const options of [{ failOpener: true }, { opener: { still: "set" } }]) {
      const log: string[] = [];
      const popup = popupFor(log, options);
      const actions = createResultImageShareActions(loggedDependencies(log, { openWindow: () => popup as unknown as WindowProxy }));
      expect(actions.copyImageAndOpenX(blob, TEXT).navigation).toBe("opener-failed");
      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(log.some((entry) => entry.startsWith("location="))).toBe(false);
    }
  });

  it("closes the unused blank tab when the location assignment fails", () => {
    const log: string[] = [];
    const popup = popupFor(log, { failLocation: true });
    const actions = createResultImageShareActions(loggedDependencies(log, { openWindow: () => popup as unknown as WindowProxy }));
    expect(actions.copyImageAndOpenX(blob, TEXT).navigation).toBe("location-failed");
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("does not throw when closing the unused tab throws", () => {
    const popup = popupFor([], { failLocation: true });
    popup.close.mockImplementation(() => { throw new Error("cannot close"); });
    const actions = createResultImageShareActions(loggedDependencies([], { openWindow: () => popup as unknown as WindowProxy }));
    expect(actions.copyImageAndOpenX(blob, TEXT).navigation).toBe("location-failed");
  });
});

describe("phone file share", () => {
  const phone = (query: string): boolean => query === "(pointer: coarse)";

  it("offers file sharing on touch or phone width only, when canShare accepts the real File", () => {
    const canShare = vi.fn(() => true);
    const share = vi.fn().mockResolvedValue(undefined);
    expect(createResultImageShareActions({ canShare, share, matchesMedia: phone }).canShareFile(file)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    expect(createResultImageShareActions({ canShare, share, matchesMedia: (query) => query === "(max-width: 600px)" }).canShareFile(file)).toBe(true);
    expect(createResultImageShareActions({ canShare, share, matchesMedia: () => false }).canShareFile(file)).toBe(false);
    expect(createResultImageShareActions({ canShare, share }).canShareFile(file)).toBe(false);
  });

  it.each([
    ["canShare is false", { canShare: () => false }],
    ["canShare throws", { canShare: () => { throw new TypeError("bad data"); } }],
    ["canShare is missing", { canShare: undefined }],
    ["share is missing", { share: undefined }],
  ])("falls back to the desktop path when %s", (_name, override) => {
    const actions = createResultImageShareActions({
      canShare: () => true, share: vi.fn().mockResolvedValue(undefined), matchesMedia: phone, ...override,
    });
    expect(actions.canShareFile(file)).toBe(false);
  });

  it("starts the share synchronously with exactly the file and the full text, after the text backup copy", async () => {
    const log: string[] = [];
    const share = vi.fn((data: { files: File[]; text: string }) => { log.push("share"); return Promise.resolve(void data); });
    const writeText = vi.fn((text: string) => { log.push("writeText"); return Promise.resolve(void text); });
    const actions = createResultImageShareActions({ share, writeText });
    const pending = actions.shareFile(file, TEXT);
    expect(log).toEqual(["writeText", "share"]);
    const data = share.mock.calls[0]![0];
    expect(Object.keys(data).sort()).toEqual(["files", "text"]);
    expect(data.files).toEqual([file]);
    expect(data.files[0]).toBe(file);
    expect(data.text).toBe(TEXT);
    expect(writeText).toHaveBeenCalledWith(TEXT);
    await expect(pending).resolves.toBe("success");
  });

  it("treats a rejected or throwing text backup as harmless", async () => {
    for (const writeText of [() => Promise.reject(new Error("denied")), () => { throw new Error("sync"); }]) {
      const share = vi.fn().mockResolvedValue(undefined);
      const actions = createResultImageShareActions({ share, writeText });
      await expect(actions.shareFile(file, TEXT)).resolves.toBe("success");
      expect(share).toHaveBeenCalledTimes(1);
    }
  });

  it("maps AbortError to cancelled and every other error, sync or async, to failed", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const cases: Array<[() => Promise<void>, string]> = [
      [() => Promise.reject(abort), "cancelled"],
      [() => Promise.reject(new DOMException("blocked", "NotAllowedError")), "failed"],
      [() => Promise.reject(new TypeError("files")), "failed"],
      [() => { throw abort; }, "cancelled"],
      [() => { throw new Error("sync"); }, "failed"],
    ];
    for (const [share, expected] of cases) {
      const actions = createResultImageShareActions({ share });
      await expect(actions.shareFile(file, TEXT)).resolves.toBe(expected);
    }
    await expect(createResultImageShareActions({}).shareFile(file, TEXT)).resolves.toBe("failed");
  });
});

describe("image save", () => {
  it("clicks a real anchor that downloads the object URL under the fixed file name, then removes it", () => {
    const clicks: Array<{ href: string; download: string; connected: boolean }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, connected: this.isConnected });
    });
    const actions = createResultImageShareActions({ document });
    expect(actions.saveImage("blob:http://localhost/abc", "yamanote-sugoroku-route.png")).toBe("dispatched");
    expect(clicks).toEqual([{ href: "blob:http://localhost/abc", download: "yamanote-sugoroku-route.png", connected: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
  });

  it("reports failed when the click throws or no document exists", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked"); });
    expect(createResultImageShareActions({ document }).saveImage("blob:x", "a.png")).toBe("failed");
    click.mockRestore();
    expect(createResultImageShareActions({}).saveImage("blob:x", "a.png")).toBe("failed");
  });
});
