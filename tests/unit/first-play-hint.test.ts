// @vitest-environment jsdom
import { StrictMode, act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstPlayHint } from "../../src/features/game/components/FirstPlayHint";
import type { GuideAcknowledgement, GuideCandidate, GuideHintId } from "../../src/features/game/firstPlayGuide";
import { TURN_RESULT_PILL_LAYOUT_EVENT, TURN_RESULT_PILL_SELECTOR } from "../../src/features/game/turnResultPillLayout";
import { useFirstPlayGuide, type UseFirstPlayGuideOptions, type UseFirstPlayGuideResult } from "../../src/features/game/useFirstPlayGuide";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const SESSION_ID = 72;

function candidate(hintId: GuideHintId = "lottery"): GuideCandidate {
  return {
    key: `${SESSION_ID}:1:${hintId}`,
    sessionId: SESSION_ID,
    turn: 1,
    copy: { copyId: hintId === "lottery" ? "lottery-service" : hintId, hintId, sectionId: "lottery", text: "抽選の候補から、次に進む路線を決めます。" },
  };
}

function acknowledgement(value: GuideCandidate, displayGeneration = 1): GuideAcknowledgement {
  return { sessionId: SESSION_ID, candidateKey: value.key, displayGeneration };
}

interface MemoryStorage extends StorageLike {
  readonly values: Map<string, string>;
}

function storage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function hintProps(overrides: Partial<React.ComponentProps<typeof FirstPlayHint>> = {}): React.ComponentProps<typeof FirstPlayHint> {
  const item = candidate();
  return {
    candidate: item,
    acknowledgement: acknowledgement(item),
    onShown: () => undefined,
    onClose: () => undefined,
    onDisable: () => undefined,
    onDetails: () => undefined,
    onRestoreFocus: () => undefined,
    ...overrides,
  };
}

let mounted: MountedReact | null = null;
let outsideFocusTarget: HTMLButtonElement | null = null;

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  outsideFocusTarget?.remove();
  outsideFocusTarget = null;
});

describe("FirstPlayHint card", () => {
  it("shows the copy and three actions without taking focus or adding a live region", () => {
    outsideFocusTarget = document.createElement("button");
    document.body.append(outsideFocusTarget);
    outsideFocusTarget.focus();
    const onShown = vi.fn();
    const item = candidate();
    mounted = mountReact(createElement(StrictMode, null, createElement(FirstPlayHint, hintProps({
      candidate: item,
      acknowledgement: acknowledgement(item),
      onShown,
    }))));

    expect(mounted.container.querySelector(".first-play-hint")?.textContent).toContain(item.copy.text);
    expect([...mounted.container.querySelectorAll(".first-play-hint button")].map((button) => button.textContent?.trim()))
      .toEqual(["閉じる", "もう表示しない", "詳しく"]);
    expect(mounted.container.querySelector("[role=status], [aria-live], dialog")).toBeNull();
    expect(mounted.container.querySelector(".first-play-hint")?.closest("[aria-hidden=true]")).toBeNull();
    expect(document.activeElement).toBe(outsideFocusTarget);
    expect(onShown).toHaveBeenCalledExactlyOnceWith(acknowledgement(item));
  });

  it("moves the allowed hint region away from a repositioned pill and stops measuring on unmount", () => {
    const pill = document.createElement("button");
    pill.className = TURN_RESULT_PILL_SELECTOR.slice(1);
    let pillRect = new DOMRect(12, 320, 200, 44);
    vi.spyOn(pill, "getClientRects").mockImplementation(() => [pillRect] as unknown as DOMRectList);
    const measurePill = vi.spyOn(pill, "getBoundingClientRect").mockImplementation(() => pillRect);
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 568);
    document.body.append(pill);
    try {
      mounted = mountReact(createElement(FirstPlayHint, hintProps()));
      const card = mounted.container.querySelector<HTMLElement>(".first-play-hint")!;
      const initialTop = Number.parseFloat(card.style.top);
      expect(initialTop + Number.parseFloat(card.style.maxHeight)).toBeLessThanOrEqual(pillRect.top);

      // Move the pill into the old region without changing its size or mutating the DOM.
      pillRect = new DOMRect(pillRect.left, initialTop, pillRect.width, pillRect.height);
      act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));
      const movedTop = Number.parseFloat(card.style.top);

      mounted.cleanup();
      mounted = null;
      measurePill.mockClear();
      act(() => window.dispatchEvent(new Event(TURN_RESULT_PILL_LAYOUT_EVENT)));

      expect(movedTop).toBeGreaterThanOrEqual(pillRect.bottom);
      expect(measurePill).not.toHaveBeenCalled();
    } finally {
      pill.remove();
      vi.unstubAllGlobals();
    }
  });

  it("prevents S and Escape from reaching game shortcuts while keeping native button keys available", () => {
    const onSkip = vi.fn();
    const onClose = vi.fn();
    mounted = mountReact(createElement(FirstPlayHint, hintProps({ onClose })));
    const closeButton = mounted.container.querySelector<HTMLButtonElement>("button")!;
    closeButton.focus();
    const gameShortcuts = (event: KeyboardEvent): void => {
      if (event.key === "s" || event.key === "S" || event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", gameShortcuts);
    try {
      for (const key of ["s", "Escape"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        act(() => closeButton.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
      }
      expect(onSkip).not.toHaveBeenCalled();

      for (const key of [" ", "Enter"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        act(() => closeButton.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
        // jsdom does not synthesize native keyboard activation; issue the button's default click explicitly.
        if (key === " ") {
          const keyup = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true });
          act(() => closeButton.dispatchEvent(keyup));
        }
        act(() => closeButton.click());
      }
      expect(closeButton.type).toBe("button");
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("keydown", gameShortcuts);
    }
  });

  it("restores focus after closing only when focus was inside the card", () => {
    const onClose = vi.fn();
    const onDisable = vi.fn();
    const onRestoreFocus = vi.fn();
    mounted = mountReact(createElement(FirstPlayHint, hintProps({ onClose, onDisable, onRestoreFocus })));
    const [closeButton, disableButton] = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")];
    closeButton!.focus();
    act(() => closeButton!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRestoreFocus).toHaveBeenCalledOnce();

    outsideFocusTarget = document.createElement("button");
    document.body.append(outsideFocusTarget);
    outsideFocusTarget.focus();
    act(() => disableButton!.click());
    expect(onDisable).toHaveBeenCalledOnce();
    expect(onRestoreFocus).toHaveBeenCalledOnce();
  });

  it("opens the matching rules section from 詳しく", () => {
    const onDetails = vi.fn();
    mounted = mountReact(createElement(FirstPlayHint, hintProps({ onDetails })));
    const detailsButton = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "詳しく")!;
    act(() => detailsButton.click());
    expect(onDetails).toHaveBeenCalledExactlyOnceWith("lottery", detailsButton);
  });

  it("rejects stale visible and status acknowledgements after a display generation changes", () => {
    const item = candidate("terminus");
    const store = storage();
    let current: UseFirstPlayGuideResult | null = null;
    function Harness(props: UseFirstPlayGuideOptions): null {
      current = useFirstPlayGuide(props);
      return null;
    }
    const options: UseFirstPlayGuideOptions = {
      sessionId: SESSION_ID,
      candidates: [item],
      storage: store,
      obscured: false,
      showClear: false,
      documentVisible: true,
    };
    mounted = mountReact(createElement(Harness, options));
    const guide = (): UseFirstPlayGuideResult => {
      if (!current) throw new Error("Expected the guide hook to mount");
      return current;
    };
    const stale = guide().card?.acknowledgement;
    if (!stale) throw new Error("Expected a current hint display");

    act(() => mounted?.root.render(createElement(Harness, { ...options, obscured: true })));
    act(() => guide().onCardShown(stale));
    act(() => guide().onStatusAcknowledged(stale));
    expect(store.values.size).toBe(0);

    act(() => mounted?.root.render(createElement(Harness, options)));
    const currentAck = guide().card?.acknowledgement;
    if (!currentAck) throw new Error("Expected a fresh hint display after visibility resumes");
    expect(currentAck.displayGeneration).toBeGreaterThan(stale.displayGeneration);
    act(() => guide().onStatusAcknowledged(stale));
    expect(store.values.size).toBe(0);
    act(() => guide().onCardShown(currentAck));
    act(() => guide().onStatusAcknowledged(currentAck));
    expect([...store.values.values()]).toEqual(["1"]);
  });
});
