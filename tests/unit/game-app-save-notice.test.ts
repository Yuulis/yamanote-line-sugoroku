// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buildRailwayNetwork, createGame } from "../../src/features/game/engine";
import type { SaveAttempt } from "../../src/features/game/saveNotice";
import { multiConfig, multiServiceInput } from "./fixtures/multiService";
import { mountReact, type MountedReact } from "./helpers/reactDom";
import { seedFirstTurnNotice } from "./helpers/notices";
import { FIRST_TURN_NOTICE_KEY } from "../../src/features/game/store/notices";
import type { StorageLike } from "../../src/features/game/store/persistence";
import { useFirstTurnNotice, type UseFirstTurnNoticeOptions, type UseFirstTurnNoticeResult } from "../../src/features/game/useFirstTurnNotice";

const network = buildRailwayNetwork(multiServiceInput());
const config = multiConfig();
const SESSION_ID = 13;

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

function options(overrides: Partial<UseFirstTurnNoticeOptions> = {}): UseFirstTurnNoticeOptions {
  return {
    saveAttempt: attempt(1), currentSessionId: SESSION_ID, storage: storage(),
    publicationReady: true, decisionOpen: false, confirmOpen: false, rulesOpen: false,
    ...overrides,
  };
}

let mounted: MountedReact | null = null;
let current: UseFirstTurnNoticeResult;

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
});

describe("first-turn notice hook", () => {
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
  });

  it("does not write the browser flag when shown without announcement", () => {
    const store = storage();
    render(options({ storage: store }));
    const key = current.notice?.key;
    if (!key) throw new Error("Expected a pending notice");

    act(() => current.onNoticeShown(key));
    expect(store.getItem(FIRST_TURN_NOTICE_KEY)).toBeNull();
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
