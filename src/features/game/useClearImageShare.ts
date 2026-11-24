import { useCallback, useEffect, useRef } from "react";
import { trackEvent } from "../analytics/analytics";
import type { RouteImageState } from "../map/routeImage";
import type { ClipboardImageResult, ResultImageShareActions, ShareOutcome, XNavigationResult } from "./resultImageShareActions";

export const X_PASTE_HINT = "Xの投稿画面に画像を貼り付けてください";
const MESSAGE_COPIED_NOT_OPENED =
  "画像をコピーしましたが、Xを開けませんでした。「文面だけXに投稿」から開いて貼り付けるか、「画像を保存」を使ってください。";
const MESSAGE_OPENED_NOT_COPIED =
  "Xを開きましたが、画像をコピーできませんでした。「画像を保存」して投稿に添付してください。";
const MESSAGE_NEITHER =
  "Xを開けず、画像もコピーできませんでした。「画像を保存」と「文面だけXに投稿」を使ってください。";
const MESSAGE_FILE_SHARE_FAILED =
  "共有できませんでした。「画像を保存」してXの投稿に添付するか、「文面だけXに投稿」を使ってください。";
const MESSAGE_SAVE_STARTED = "画像の保存を始めました";
const MESSAGE_SAVE_FAILED = "画像を保存できませんでした。「文面だけXに投稿」か「結果をコピー」を使ってください。";

/** Both the copy and the navigation must succeed before the paste hint is honest. */
export function desktopXMessage(clipboard: ClipboardImageResult, navigation: XNavigationResult): string {
  const copied = clipboard === "copied";
  const opened = navigation === "started";
  if (copied && opened) return X_PASTE_HINT;
  if (copied) return MESSAGE_COPIED_NOT_OPENED;
  if (opened) return MESSAGE_OPENED_NOT_COPIED;
  return MESSAGE_NEITHER;
}

export interface ClearImageShareOptions {
  readonly image: RouteImageState;
  readonly shareText: string;
  readonly actions: ResultImageShareActions;
  /** Completes a running replay before the action starts; a no-op when none runs. */
  readonly finishReplay: () => void;
  /** Visible and announced status; only called while the screen is still mounted. */
  readonly onMessage: (text: string | null) => void;
  /** Keeps the object URL alive for the browser download that this click starts. */
  readonly onDownloadStarted: () => void;
}

export interface ClearImageShareHandlers {
  readonly shareToX: () => void;
  readonly saveImage: () => void;
  readonly handOffTextToX: () => void;
}

/**
 * Click handlers of the image actions. Platform calls start synchronously inside the click; results are settled
 * afterwards, and each accepted action emits exactly one analytics event even when the screen is already gone.
 */
export function useClearImageShare(options: ClearImageShareOptions): ClearImageShareHandlers {
  const { image, shareText, actions, finishReplay, onMessage, onDownloadStarted } = options;
  const mountedRef = useRef(false);
  const shareInFlightRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const say = useCallback((text: string | null): void => {
    if (mountedRef.current) onMessage(text);
  }, [onMessage]);

  const shareToX = useCallback((): void => {
    if (image.kind !== "ready" || shareInFlightRef.current) return;
    const { file, blob } = image.image;
    finishReplay();
    shareInFlightRef.current = true;
    if (actions.canShareFile(file)) {
      const settle = (outcome: ShareOutcome): void => {
        shareInFlightRef.current = false;
        trackEvent("result_share", { method: "x", outcome });
        if (outcome === "failed") say(MESSAGE_FILE_SHARE_FAILED);
      };
      actions.shareFile(file, shareText).then(settle, () => settle("failed"));
      return;
    }
    const attempt = actions.copyImageAndOpenX(blob, shareText);
    const settle = (clipboard: ClipboardImageResult): void => {
      shareInFlightRef.current = false;
      const succeeded = clipboard === "copied" && attempt.navigation === "started";
      trackEvent("result_share", { method: "x", outcome: succeeded ? "success" : "failed" });
      say(desktopXMessage(clipboard, attempt.navigation));
    };
    attempt.clipboard.then(settle, () => settle("rejected"));
  }, [actions, finishReplay, image, say, shareText]);

  const saveImage = useCallback((): void => {
    if (image.kind !== "ready") return;
    finishReplay();
    onDownloadStarted();
    const result = actions.saveImage(image.image.url, image.image.filename);
    trackEvent("result_share", { method: "save", outcome: result === "dispatched" ? "success" : "failed" });
    say(result === "dispatched" ? MESSAGE_SAVE_STARTED : MESSAGE_SAVE_FAILED);
  }, [actions, finishReplay, image, onDownloadStarted, say]);

  const handOffTextToX = useCallback((): void => {
    finishReplay();
    trackEvent("result_share", { method: "x", outcome: "success" });
  }, [finishReplay]);

  return { shareToX, saveImage, handOffTextToX };
}
