export interface ResultShareApi {
  share?: (data: { text: string }) => Promise<void>;
  canShare?: (data: { text: string }) => boolean;
}

export interface ResultClipboardApi {
  writeText: (text: string) => Promise<void>;
}

export interface ResultShareActions {
  copy: (text: string) => Promise<boolean>;
  share: (text: string) => Promise<"shared" | "cancelled" | "failed">;
  canShare: (text: string) => boolean;
}

export function createResultShareActions(
  clipboard: ResultClipboardApi | undefined,
  shareApi: ResultShareApi | undefined,
): ResultShareActions {
  return {
    async copy(text) {
      if (!clipboard) return false;
      try {
        await clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    async share(text) {
      if (!shareApi?.share) return "failed";
      try {
        await shareApi.share({ text });
        return "shared";
      } catch (error) {
        return error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed";
      }
    },
    canShare(text) {
      if (!shareApi?.share) return false;
      return shareApi.canShare?.({ text }) !== false;
    },
  };
}

export function browserResultShareActions(): ResultShareActions {
  const browserClipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const browserShare = typeof navigator !== "undefined" ? navigator.share?.bind(navigator) : undefined;
  const browserCanShare = typeof navigator !== "undefined" ? navigator.canShare?.bind(navigator) : undefined;
  const clipboard = browserClipboard
    ? { writeText: (text: string) => browserClipboard.writeText(text) }
    : undefined;
  const shareApi = browserShare
    ? {
        share: (data: { text: string }) => browserShare(data),
        canShare: browserCanShare ? (data: { text: string }) => browserCanShare(data) : undefined,
      }
    : undefined;
  return createResultShareActions(clipboard, shareApi);
}
