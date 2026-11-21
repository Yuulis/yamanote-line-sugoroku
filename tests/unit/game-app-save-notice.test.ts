// @vitest-environment jsdom
import { StrictMode, act, createElement, useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GamePanel, type GamePanelProps } from "../../src/features/game/components/GamePanel";
import {
  beginItemTurn, buildRailwayNetwork, createGame, createItemGame, platformPosition, targetSegmentIds,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { startSession } from "../../src/features/game/gameSession";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay } from "../../src/features/game/turnMomentPresentation";
import {
  FIRST_TURN_NOTICE_TEXT,
  type SaveAttempt,
  type SelectedNoticeAnnouncement,
} from "../../src/features/game/saveNotice";
import type { GuideAcknowledgement, GuideAnnouncement } from "../../src/features/game/firstPlayGuide";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { mountReact, type MountedReact } from "./helpers/reactDom";
import { seedFirstTurnNotice } from "./helpers/notices";
import { FIRST_TURN_NOTICE_KEY } from "../../src/features/game/store/notices";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { useFirstTurnNotice, type UseFirstTurnNoticeOptions, type UseFirstTurnNoticeResult } from "../../src/features/game/useFirstTurnNotice";

const network = buildRailwayNetwork(multiServiceInput());
const config = multiConfig();
const SESSION_ID = 13;
const NOTICE_ATTEMPT_ID = 99;
const NOTICE_KEY = `${SESSION_ID}:auto-resume:${NOTICE_ATTEMPT_ID}`;
const ANNOUNCEMENT_TURN = 1;
const NO_COMPLETED_STEPS = 0;

function storage(throwOnWrite = false): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (throwOnWrite) throw new Error("quota");
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
}

function attempt(gameTurn: number, entryTurn = 0, id = 1, sessionId = SESSION_ID): SaveAttempt {
  const game = { ...createGame(config, `notice-${id}`, network), turn: gameTurn };
  return { id, sessionId, game, result: "saved", entryTurn };
}

function itemAttempt(gameTurn: number, id = 1, sessionId = SESSION_ID): SaveAttempt {
  const itemConfig = { ...config, itemPolicy: ITEM_GAME_CONFIG.itemPolicy };
  const game = { ...createItemGame(itemConfig, `item-notice-${id}`, network), turn: gameTurn };
  return { id, sessionId, game, result: "saved", entryTurn: 0 };
}

function options(overrides: Partial<UseFirstTurnNoticeOptions> = {}): UseFirstTurnNoticeOptions {
  return {
    saveAttempt: attempt(1), currentSessionId: SESSION_ID, storage: storage(),
    publicationReady: true, decisionOpen: false, confirmOpen: false, rulesOpen: false,
    ...overrides,
  };
}

let mounted: MountedReact | null = null;
let current: UseFirstTurnNoticeResult;
let restoreVisibilityState: (() => void) | null = null;

function mockVisibilityState(initial: DocumentVisibilityState): {
  setWithoutNotification: (state: DocumentVisibilityState) => void;
  dispatchChange: () => void;
  restore: () => void;
} {
  let state = initial;
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return {
    setWithoutNotification: (next) => { state = next; },
    dispatchChange: () => act(() => { document.dispatchEvent(new Event("visibilitychange")); }),
    restore: () => {
      if (original) Object.defineProperty(document, "visibilityState", original);
      else Reflect.deleteProperty(document, "visibilityState");
    },
  };
}

function Harness(props: UseFirstTurnNoticeOptions): null {
  current = useFirstTurnNotice(props);
  return null;
}

function render(props: UseFirstTurnNoticeOptions): void {
  if (!mounted) {
    mounted = mountReact(createElement(Harness, props));
    return;
  }
  act(() => mounted?.root.render(createElement(Harness, props)));
}

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  restoreVisibilityState?.();
  restoreVisibilityState = null;
});

describe("first-turn notice hook", () => {
  it("notices the next successful completed classic or item turn", () => {
    const store = storage();
    render(options({ saveAttempt: attempt(1), storage: store }));
    expect(current.notice).not.toBeNull();

    render(options({ saveAttempt: itemAttempt(1, 2), storage: store }));
    expect(current.notice?.text).toBe(FIRST_TURN_NOTICE_TEXT);
  });

  it("rejects failed, unavailable and stale attempts", () => {
    const store = storage();
    const saved = attempt(1);
    render(options({ saveAttempt: { ...saved, result: "failed" }, storage: store }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt: { ...saved, result: "unavailable", id: 2 }, storage: store }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt: { ...saved, sessionId: SESSION_ID + 1, id: 3 }, storage: store }));
    expect(current.notice).toBeNull();
  });

  it("waits through resumed pending progress and a failed write, then notices recovery once", () => {
    const store = storage();
    const itemConfig = { ...config, itemPolicy: ITEM_GAME_CONFIG.itemPolicy };
    const baseline = createItemGame(itemConfig, "pending-notice", network);
    const pending = beginItemTurn(baseline, { items: [] }, network).state;
    render(options({ saveAttempt: { id: 1, sessionId: SESSION_ID, game: pending, result: "saved", entryTurn: 0 }, storage: store }));
    expect(current.notice).toBeNull();

    const failed = { ...itemAttempt(1, 2), result: "failed" as const };
    render(options({ saveAttempt: failed, storage: store }));
    expect(current.notice).toBeNull();

    const recovered = itemAttempt(1, 3);
    render(options({ saveAttempt: recovered, storage: store }));
    expect(current.notice?.key).toBe(`${SESSION_ID}:auto-resume:3`);
    const key = current.notice?.key;
    if (!key) throw new Error("Expected a recovered notice");
    act(() => current.onNoticeShown(key));
    current.onNoticeAnnounced(key);
    render(options({ saveAttempt: itemAttempt(2, 4), storage: store }));
    expect(current.notice).toBeNull();
  });

  it("never notices turn zero or a resumed baseline", () => {
    const store = storage();
    render(options({ saveAttempt: attempt(0, 0), storage: store }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt: attempt(8, 8, 2, SESSION_ID + 1), currentSessionId: SESSION_ID + 1, storage: store }));
    expect(current.notice).toBeNull();
  });
  it("waits for publication and dialog closure", () => {
    const store = storage();
    const saveAttempt = attempt(1);
    render(options({ saveAttempt, storage: store, publicationReady: false }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt, storage: store, decisionOpen: true }));
    expect(current.notice).toBeNull();
    render(options({ saveAttempt, storage: store, confirmOpen: true }));
    expect(current.notice).toBeNull();
    render(options({ saveAttempt, storage: store, rulesOpen: true }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt, storage: store }));
    expect(current.notice?.text).toBe("自動で保存しています。いつでも閉じて、続きから遊べます");
  });

  it("holds the first-turn notice until the first-play coach closes", () => {
    const store = storage();
    const saveAttempt = attempt(1);
    render(options({ saveAttempt, storage: store, coachOpen: true }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt, storage: store, coachOpen: false }));
    expect(current.notice?.text).toBe(FIRST_TURN_NOTICE_TEXT);
  });

  it("cancels a waiting notice after a later same-session save failure", () => {
    const store = storage();
    render(options({ storage: store }));
    expect(current.notice).not.toBeNull();

    const failedAttempt: SaveAttempt = { ...attempt(2, 0, 2), result: "failed" };
    render(options({ saveAttempt: failedAttempt, storage: store }));
    expect(current.notice).toBeNull();

    render(options({ saveAttempt: attempt(2, 0, 3), storage: store }));
    expect(current.notice).not.toBeNull();
  });

  it("writes the browser flag only after shown and announced", () => {
    const store = storage();
    render(options({ storage: store }));
    const key = current.notice?.key;
    if (!key) throw new Error("Expected a pending notice");

    act(() => current.onNoticeShown(key));
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
    current.onNoticeAnnounced(key);
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBe("1");

    mounted?.cleanup();
    mounted = null;
    const shownWithoutAnnouncement = storage();
    render(options({ storage: shownWithoutAnnouncement }));
    const pendingKey = current.notice?.key;
    if (!pendingKey) throw new Error("Expected a pending notice without announcement");
    act(() => current.onNoticeShown(pendingKey));
    expect(shownWithoutAnnouncement.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
  });

  it("keeps mounted dedupe when flag writing fails", () => {
    const store = storage(true);
    render(options({ storage: store }));
    const key = current.notice?.key;
    if (!key) throw new Error("Expected a pending notice");

    act(() => current.onNoticeShown(key));
    current.onNoticeAnnounced(key);
    render(options({ saveAttempt: attempt(2, 0, 2), storage: store }));

    expect(current.notice).toBeNull();
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
  });

  it("leaves the flag unset when returning to title before delivery", () => {
    const store = storage();
    render(options({ publicationReady: false, storage: store }));
    render(options({ saveAttempt: attempt(1), currentSessionId: null, storage: store }));

    expect(current.notice).toBeNull();
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
  });

  it("honors a notice flag seeded through the storage helper", () => {
    const store = storage();
    seedFirstTurnNotice(store);
    render(options({ storage: store }));

    expect(current.notice).toBeNull();
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBe("1");
  });
});

interface NoticePanelProps extends GamePanelProps {
  readonly firstTurnNoticeAnnouncement: { readonly key: string; readonly text: string } | null;
  readonly onNoticeAnnounced: NonNullable<GamePanelProps["onNoticeAnnounced"]>;
  readonly hintAnnouncement: GuideAnnouncement | null;
  readonly onHintStatusAcknowledged: NonNullable<GamePanelProps["onHintStatusAcknowledged"]>;
}

const NoticePanel = GamePanel as React.ComponentType<NoticePanelProps>;

function noticePanelValue(overrides: Partial<NoticePanelProps> = {}): NoticePanelProps {
  const session = startSession(config, "notice-panel", network, SESSION_ID);
  const progress = {
    stationId: session.game.currentStationId,
    position: platformPosition(network, session.game.currentServiceId, session.game.currentStationId),
    completedSegmentIds: session.game.completedSegmentIds,
    stepsCompleted: NO_COMPLETED_STEPS,
  };
  const turnDisplay = deriveTurnMomentDisplay({
    session,
    network,
    presentation: createPresentationResolver(network),
    progress,
    attempt: null,
    revealStage: "done",
    restoredOrOmitted: true,
  });
  return {
    session,
    network,
    lines: [],
    turnDisplay: { ...turnDisplay, announcement: `${ANNOUNCEMENT_TURN}ターン目：駅に到着`, summaryTurn: ANNOUNCEMENT_TURN },
    requiredCount: targetSegmentIds(config, network).length,
    saveStatus: "saved",
    follow: true,
    speedLabel: "ふつう",
    presentationLevel: "all",
    reducedMotion: true,
    onRoll: () => undefined,
    onSkip: () => undefined,
    onToggleFollow: () => undefined,
    onCycleSpeed: () => undefined,
    onCyclePresentation: () => undefined,
    onNewGame: () => undefined,
    onShowTitle: () => undefined,
    firstTurnNoticeAnnouncement: { key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT },
    hintAnnouncement: null,
    onNoticeAnnounced: () => undefined,
    onHintStatusAcknowledged: () => undefined,
    ...overrides,
  };
}

describe("first-turn notice announcement region", () => {
  it("announces once through the existing status region after the ordinary summary", () => {
    const onNoticeAnnounced = vi.fn();
    const value = noticePanelValue({ onNoticeAnnounced });
    const mount = mountReact(createElement(StrictMode, null, createElement(NoticePanel, value)));
    try {
      const status = mount.container.querySelector(".game-panel [role=status]");
      expect(mount.container.querySelectorAll(".game-panel [role=status]")).toHaveLength(1);
      expect(status?.textContent).toBe(FIRST_TURN_NOTICE_TEXT);
      expect(onNoticeAnnounced).toHaveBeenCalledExactlyOnceWith({
        key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn",
      });

      const acknowledged = { ...value, firstTurnNoticeAnnouncement: null };
      act(() => mount.root.render(createElement(StrictMode, null, createElement(NoticePanel, acknowledged))));
      expect(onNoticeAnnounced).toHaveBeenCalledExactlyOnceWith({
        key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn",
      });
    } finally {
      mount.cleanup();
    }
  });

  it.each([
    ["rules", "rulesOpen"],
    ["confirmation dialog", "confirmationOpen"],
  ] as const)("retires an announced notice when the %s opens", (_label, modalProp) => {
    const onNoticeAnnounced = vi.fn();
    const value = noticePanelValue({ onNoticeAnnounced });
    const mount = mountReact(createElement(NoticePanel, value));
    try {
      const statusText = () => mount.container.querySelector(".game-panel [role=status]")?.textContent;
      expect(statusText()).toBe(FIRST_TURN_NOTICE_TEXT);
      expect(onNoticeAnnounced).toHaveBeenCalledExactlyOnceWith({
        key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn",
      });

      const acknowledged = { ...value, firstTurnNoticeAnnouncement: null };
      act(() => mount.root.render(createElement(NoticePanel, acknowledged)));
      const opened = { ...acknowledged, [modalProp]: true };
      act(() => mount.root.render(createElement(NoticePanel, opened)));
      const textWhileOpen = statusText();
      const closed = { ...acknowledged, [modalProp]: false };
      act(() => mount.root.render(createElement(NoticePanel, closed)));

      expect([FIRST_TURN_NOTICE_TEXT, textWhileOpen, statusText()]).toEqual([
        FIRST_TURN_NOTICE_TEXT,
        "1ターン目：駅に到着",
        "1ターン目：駅に到着",
      ]);
      expect(onNoticeAnnounced).toHaveBeenCalledExactlyOnceWith({
        key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn",
      });
    } finally {
      mount.cleanup();
    }
  });

  it("defers announcement while rules are open and retires it after ordinary text changes", () => {
    const onNoticeAnnounced = vi.fn();
    const value = noticePanelValue({ rulesOpen: true, onNoticeAnnounced });
    const mount = mountReact(createElement(NoticePanel, value));
    try {
      expect(mount.container.querySelector(".game-panel [role=status]")?.textContent).toBe("1ターン目：駅に到着");
      expect(onNoticeAnnounced).not.toHaveBeenCalled();

      const opened = { ...value, rulesOpen: false };
      act(() => mount.root.render(createElement(NoticePanel, opened)));
      expect(onNoticeAnnounced).toHaveBeenCalledExactlyOnceWith({
        key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn",
      });
      const acknowledged = { ...opened, firstTurnNoticeAnnouncement: null };

      const changed = { ...acknowledged, turnDisplay: { ...opened.turnDisplay, announcement: "2ターン目：別の駅に到着" } };
      act(() => mount.root.render(createElement(NoticePanel, changed)));
      const returned = { ...acknowledged, turnDisplay: { ...opened.turnDisplay, announcement: "1ターン目：駅に到着" } };
      act(() => mount.root.render(createElement(NoticePanel, returned)));
      expect(mount.container.querySelector(".game-panel [role=status]")?.textContent).toBe("1ターン目：駅に到着");
      expect(onNoticeAnnounced).toHaveBeenCalledExactlyOnceWith({
        key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn",
      });
    } finally {
      mount.cleanup();
    }
  });

  it("hands the existing status region from #68 to the current hint once", () => {
    const acknowledgement = { sessionId: SESSION_ID, candidateKey: `${SESSION_ID}:1:lottery`, displayGeneration: 2 };
    const hintAnnouncement: GuideAnnouncement = {
      key: `guide-hint:${SESSION_ID}:${SESSION_ID}:1:lottery:2`,
      text: "抽選のヒント本文です。",
      acknowledgement,
    };
    const deliveries: Array<{
      readonly source: "first-turn" | "hint";
      readonly statusText: string | null;
      readonly target: SelectedNoticeAnnouncement | GuideAcknowledgement;
    }> = [];
    const statusText = (): string | null => document.querySelector(".game-panel [role=status]")?.textContent ?? null;
    const value = noticePanelValue({ firstTurnNoticeAnnouncement: { key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT },
      hintAnnouncement,
      onNoticeAnnounced: (target) => deliveries.push({ source: "first-turn", statusText: statusText(), target }),
      onHintStatusAcknowledged: (target) => deliveries.push({ source: "hint", statusText: statusText(), target }),
    });
    const mount = mountReact(createElement(StrictMode, null, createElement(NoticePanel, value)));
    try {
      expect(mount.container.querySelectorAll(".game-panel [role=status]")).toHaveLength(1);
      expect(mount.container.querySelector(".game-panel [role=status]")?.textContent).toBe(hintAnnouncement.text);
      expect(deliveries).toEqual([
        {
          source: "first-turn",
          statusText: FIRST_TURN_NOTICE_TEXT,
          target: { key: NOTICE_KEY, text: FIRST_TURN_NOTICE_TEXT, source: "first-turn" },
        },
        { source: "hint", statusText: hintAnnouncement.text, target: acknowledgement },
      ]);
    } finally {
      mount.cleanup();
    }
  });

  it("keeps ordinary status and does not deliver a hint while the document is hidden", () => {
    const visibility = mockVisibilityState("hidden");
    restoreVisibilityState = visibility.restore;
    const acknowledgement = { sessionId: SESSION_ID, candidateKey: `${SESSION_ID}:1:lottery`, displayGeneration: 1 };
    const hintAnnouncement: GuideAnnouncement = {
      key: `guide-hint:${SESSION_ID}:${SESSION_ID}:1:lottery:1`,
      text: "抽選のヒント本文です。",
      acknowledgement,
    };
    const onHintStatusAcknowledged = vi.fn();
    const value = noticePanelValue({ firstTurnNoticeAnnouncement: null, hintAnnouncement, onHintStatusAcknowledged });
    const mount = mountReact(createElement(NoticePanel, value));
    try {
      const status = mount.container.querySelector(".game-panel [role=status]");
      expect(status?.textContent).toBe("1ターン目：駅に到着");
      expect(onHintStatusAcknowledged).not.toHaveBeenCalled();

      visibility.setWithoutNotification("visible");
      visibility.dispatchChange();

      expect(status?.textContent).toBe(hintAnnouncement.text);
      expect(onHintStatusAcknowledged).toHaveBeenCalledExactlyOnceWith(acknowledgement);
    } finally {
      mount.cleanup();
    }
  });

  it("rechecks visibility immediately before acknowledging a selected hint", () => {
    const visibility = mockVisibilityState("visible");
    restoreVisibilityState = visibility.restore;
    const acknowledgement = { sessionId: SESSION_ID, candidateKey: `${SESSION_ID}:1:lottery`, displayGeneration: 1 };
    const hintAnnouncement: GuideAnnouncement = {
      key: `guide-hint:${SESSION_ID}:${SESSION_ID}:1:lottery:1`,
      text: "抽選のヒント本文です。",
      acknowledgement,
    };
    const onHintStatusAcknowledged = vi.fn();
    function HideBeforePassiveEffects({ children }: { readonly children: ReactNode }): React.ReactNode {
      useLayoutEffect(() => { visibility.setWithoutNotification("hidden"); }, []);
      return children;
    }
    const mount = mountReact(createElement(HideBeforePassiveEffects, null,
      createElement(NoticePanel, noticePanelValue({ firstTurnNoticeAnnouncement: null, hintAnnouncement,
        onHintStatusAcknowledged }))));
    try {
      expect(onHintStatusAcknowledged).not.toHaveBeenCalled();

      visibility.dispatchChange();
      expect(mount.container.querySelector(".game-panel [role=status]")?.textContent).toBe("1ターン目：駅に到着");
      visibility.setWithoutNotification("visible");
      visibility.dispatchChange();

      expect(mount.container.querySelector(".game-panel [role=status]")?.textContent).toBe(hintAnnouncement.text);
      expect(onHintStatusAcknowledged).toHaveBeenCalledExactlyOnceWith(acknowledgement);
    } finally {
      mount.cleanup();
    }
  });

  it("does not select or acknowledge a hint while the coach owns the panel", () => {
    const onHintStatusAcknowledged = vi.fn();
    const acknowledgement = { sessionId: SESSION_ID, candidateKey: `${SESSION_ID}:1:lottery`, displayGeneration: 1 };
    const hintAnnouncement: GuideAnnouncement = {
      key: `guide-hint:${SESSION_ID}:${SESSION_ID}:1:lottery:1`,
      text: "抽選のヒント本文です。",
      acknowledgement,
    };
    const value = noticePanelValue({ coachOpen: true, hintAnnouncement, onHintStatusAcknowledged });
    const mount = mountReact(createElement(NoticePanel, value));
    try {
      expect(mount.container.querySelector(".game-panel [role=status]")?.textContent).toBe("1ターン目：駅に到着");
      expect(onHintStatusAcknowledged).not.toHaveBeenCalled();
    } finally {
      mount.cleanup();
    }
  });
});
