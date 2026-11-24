/**
 * Browser boundary of the image share actions (Issue #69, S7). Every platform call is injected so the exact call
 * order can be asserted. The text-only adapter in resultShareActions.ts is unchanged.
 */

const X_INTENT_URL = "https://x.com/intent/post";
const PNG_MIME_TYPE = "image/png";
const COARSE_POINTER_QUERY = "(pointer: coarse)";
const PHONE_WIDTH_QUERY = "(max-width: 600px)";

export type ShareOutcome = "success" | "failed" | "cancelled";

export type ClipboardImageResult = "copied" | "unavailable" | "sync-failed" | "rejected";

export type XNavigationResult =
  | "started"
  | "blocked"
  | "open-threw"
  | "opener-failed"
  | "location-failed";

export interface DesktopXAttempt {
  /** Settles with the clipboard write result; it never rejects. */
  readonly clipboard: Promise<ClipboardImageResult>;
  /** Known synchronously: the popup was opened and pointed at the intent, or why it was not. */
  readonly navigation: XNavigationResult;
}

export interface ResultImageShareActions {
  /** True when this device should share the PNG through the native sheet (touch or phone width) and can. */
  canShareFile(file: File): boolean;
  /** Starts the native share synchronously; also copies the text as a backup when that can start synchronously. */
  shareFile(file: File, text: string): Promise<ShareOutcome>;
  /** Starts the image copy first and opens the X composer second, in the caller's click, without awaiting. */
  copyImageAndOpenX(blob: Blob, text: string): DesktopXAttempt;
  saveImage(url: string, filename: string): "dispatched" | "failed";
}

export interface ResultImageShareDependencies {
  readonly canShare?: (data: { files: File[] }) => boolean;
  readonly share?: (data: { files: File[]; text: string }) => Promise<void>;
  readonly writeText?: (text: string) => Promise<void>;
  readonly writeClipboard?: (items: ClipboardItem[]) => Promise<void>;
  /** Builds a ClipboardItem whose image entry is a promise, the form Safari requires. */
  readonly createClipboardItem?: (data: Record<string, Promise<Blob>>) => ClipboardItem;
  readonly openWindow?: (url: string, target: string) => WindowProxy | null;
  readonly matchesMedia?: (query: string) => boolean;
  readonly document?: Document;
}

/** The one X composer URL; the whole text (URL, newlines, hashtag) is encoded once. */
export function buildXIntentUrl(text: string): string {
  return `${X_INTENT_URL}?text=${encodeURIComponent(text)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function closeQuietly(popup: WindowProxy): void {
  try {
    popup.close();
  } catch {
    // A tab that cannot be closed stays blank; the caller already reports the navigation failure.
  }
}

function startClipboardWrite(
  blob: Blob,
  writeClipboard: ResultImageShareDependencies["writeClipboard"],
  createClipboardItem: ResultImageShareDependencies["createClipboardItem"],
): Promise<ClipboardImageResult> {
  if (!writeClipboard || !createClipboardItem) return Promise.resolve("unavailable");
  let write: Promise<void>;
  try {
    const item = createClipboardItem({ [PNG_MIME_TYPE]: Promise.resolve(blob) });
    write = Promise.resolve(writeClipboard([item]));
  } catch {
    return Promise.resolve("sync-failed");
  }
  return write.then(() => "copied", () => "rejected");
}

function openIntent(
  url: string,
  openWindow: ResultImageShareDependencies["openWindow"],
): XNavigationResult {
  if (!openWindow) return "blocked";
  let popup: WindowProxy | null;
  try {
    popup = openWindow("about:blank", "_blank");
  } catch {
    return "open-threw";
  }
  if (!popup) return "blocked";
  try {
    popup.opener = null;
    if (popup.opener !== null) throw new Error("opener is still set");
  } catch {
    closeQuietly(popup);
    return "opener-failed";
  }
  try {
    popup.location.href = url;
  } catch {
    closeQuietly(popup);
    return "location-failed";
  }
  return "started";
}

export function createResultImageShareActions(dependencies: ResultImageShareDependencies): ResultImageShareActions {
  const { canShare, share, writeText, writeClipboard, createClipboardItem, openWindow, matchesMedia } = dependencies;
  const documentRef = dependencies.document;
  const prefersFileShare = (): boolean => {
    if (!matchesMedia) return false;
    try {
      return matchesMedia(COARSE_POINTER_QUERY) || matchesMedia(PHONE_WIDTH_QUERY);
    } catch {
      return false;
    }
  };
  return {
    canShareFile(file) {
      if (!share || !canShare || !prefersFileShare()) return false;
      try {
        return canShare({ files: [file] }) === true;
      } catch {
        return false;
      }
    },
    shareFile(file, text) {
      if (!share) return Promise.resolve("failed");
      if (writeText) {
        try {
          // A backup for targets that drop the text next to a file; its result is deliberately not awaited.
          void Promise.resolve(writeText(text)).catch(() => undefined);
        } catch {
          // The share itself still proceeds without the backup.
        }
      }
      let pending: Promise<void>;
      try {
        pending = Promise.resolve(share({ files: [file], text }));
      } catch (error) {
        return Promise.resolve(isAbortError(error) ? "cancelled" : "failed");
      }
      return pending.then(
        () => "success" as const,
        (error: unknown) => (isAbortError(error) ? "cancelled" as const : "failed" as const),
      );
    },
    copyImageAndOpenX(blob, text) {
      const clipboard = startClipboardWrite(blob, writeClipboard, createClipboardItem);
      return { clipboard, navigation: openIntent(buildXIntentUrl(text), openWindow) };
    },
    saveImage(url, filename) {
      if (!documentRef) return "failed";
      try {
        const anchor = documentRef.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = "noopener";
        anchor.hidden = true;
        documentRef.body.append(anchor);
        anchor.click();
        anchor.remove();
        return "dispatched";
      } catch {
        return "failed";
      }
    },
  };
}

/** Binds the real navigator and window lazily, so a missing API is a missing capability and never a crash. */
export function browserResultImageShareActions(): ResultImageShareActions {
  if (typeof navigator === "undefined" || typeof window === "undefined") return createResultImageShareActions({});
  const nav = navigator;
  const clipboard = nav.clipboard;
  return createResultImageShareActions({
    canShare: typeof nav.canShare === "function" ? (data) => nav.canShare(data) : undefined,
    share: typeof nav.share === "function" ? (data) => nav.share(data) : undefined,
    writeText: clipboard && typeof clipboard.writeText === "function" ? (text) => clipboard.writeText(text) : undefined,
    writeClipboard: clipboard && typeof clipboard.write === "function" ? (items) => clipboard.write(items) : undefined,
    createClipboardItem: typeof ClipboardItem === "function" ? (data) => new ClipboardItem(data) : undefined,
    openWindow: (url, target) => window.open(url, target),
    matchesMedia: typeof window.matchMedia === "function" ? (query) => window.matchMedia(query).matches : undefined,
    document,
  });
}
