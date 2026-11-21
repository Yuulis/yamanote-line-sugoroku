import { describe, expect, it } from "vitest";
import {
  createGuideQueueState,
  guideQueueReducer,
  type GuideCandidate,
  type GuideHintId,
} from "../../src/features/game/firstPlayGuide";

const SESSION_ID = 17;

function candidate(hintId: GuideHintId, turn = 1, key = `${turn}:${hintId}`, sessionId = SESSION_ID, text = key): GuideCandidate {
  return {
    key,
    sessionId,
    turn,
    copy: { copyId: hintId === "lottery" ? "lottery-service" : hintId, hintId, sectionId: "goal", text },
  };
}

function enqueue(state: ReturnType<typeof createGuideQueueState>, candidates: readonly GuideCandidate[]) {
  return guideQueueReducer(state, { type: "enqueue", sessionId: SESSION_ID, candidates });
}

function acknowledgeCurrent(state: ReturnType<typeof createGuideQueueState>) {
  const withDisplay = guideQueueReducer(state, { type: "beginDisplay" });
  const acknowledgement = withDisplay.display?.acknowledgement;
  if (!acknowledgement) throw new Error("Expected an active display generation");
  const visible = guideQueueReducer(withDisplay, { type: "acknowledgeVisible", acknowledgement });
  return guideQueueReducer(visible, { type: "acknowledgeStatus", acknowledgement });
}

describe("first-play guide queue reducer", () => {
  it("orders same-turn candidates by the fixed hint priority and ignores repeated enqueue actions", () => {
    const candidates = [
      candidate("terminus"),
      candidate("harmful-item"),
      candidate("item"),
      candidate("off-target"),
      candidate("lottery"),
    ];
    const state = enqueue(createGuideQueueState(SESSION_ID), candidates);

    expect([state.current?.copy.hintId, ...state.queued.map((entry) => entry.copy.hintId)]).toEqual([
      "lottery", "off-target", "item", "harmful-item", "terminus",
    ]);
    expect(enqueue(state, candidates)).toBe(state);
  });

  it("deduplicates against current, queued, seen and closed-this-session IDs", () => {
    let state = enqueue(createGuideQueueState(SESSION_ID, ["item"]), [
      candidate("lottery"), candidate("harmful-item"), candidate("item", 2, "later-item"),
    ]);
    state = guideQueueReducer(state, { type: "closeCurrent" });
    const afterRequeue = enqueue(state, [
      candidate("lottery", 2, "lottery-again"),
      candidate("harmful-item", 2, "harmful-again"),
      candidate("item", 3, "item-again"),
    ]);

    expect(afterRequeue.current?.copy.hintId).toBe("harmful-item");
    expect(afterRequeue.queued).toEqual([]);
    expect(afterRequeue.closedIds).toEqual(["lottery"]);
    expect(afterRequeue.seenIds).toEqual(["item"]);
  });

  it("retains candidates from earlier turns while later turns are enqueued", () => {
    let state = enqueue(createGuideQueueState(SESSION_ID), [candidate("item", 1)]);
    state = enqueue(state, [candidate("terminus", 2), candidate("lottery", 3)]);
    state = acknowledgeCurrent(state);
    expect(state.current?.copy.hintId).toBe("item");
    expect(state.queued.map((entry) => [entry.copy.hintId, entry.turn])).toEqual([
      ["terminus", 2], ["lottery", 3],
    ]);
    state = guideQueueReducer(state, { type: "closeCurrent" });

    expect(state.current?.copy.hintId).toBe("terminus");
    expect(state.current?.turn).toBe(2);
    expect(state.queued.map((entry) => [entry.copy.hintId, entry.turn])).toEqual([["lottery", 3]]);
  });

  it("marks an ID seen only after both display and status acknowledgement", () => {
    const state = enqueue(createGuideQueueState(SESSION_ID), [candidate("lottery"), candidate("item")]);
    const displayed = guideQueueReducer(state, { type: "beginDisplay" });
    const acknowledgement = displayed.display?.acknowledgement;
    if (!acknowledgement) throw new Error("Expected an active display generation");

    const visibleOnly = guideQueueReducer(displayed, { type: "acknowledgeVisible", acknowledgement });
    expect(visibleOnly.seenIds).toEqual([]);
    expect(visibleOnly.display?.visibleAcknowledged).toBe(true);
    expect(visibleOnly.display?.statusAcknowledged).toBe(false);

    const acknowledged = guideQueueReducer(visibleOnly, { type: "acknowledgeStatus", acknowledgement });
    expect(acknowledged.seenIds).toEqual(["lottery"]);
    expect(acknowledged.current?.copy.hintId).toBe("lottery");
    expect(acknowledged.queued.map((entry) => entry.copy.hintId)).toEqual(["item"]);

    const closed = guideQueueReducer(acknowledged, { type: "closeCurrent" });
    expect(closed.current?.copy.hintId).toBe("item");
    expect(closed.queued).toEqual([]);
  });

  it.each(["acknowledgeVisible", "acknowledgeStatus"] as const)(
    "returns the identical state when %s repeats after both acknowledgements",
    (type) => {
      let state = enqueue(createGuideQueueState(SESSION_ID), [candidate("lottery")]);
      state = guideQueueReducer(state, { type: "beginDisplay" });
      const acknowledgement = state.display?.acknowledgement;
      if (!acknowledgement) throw new Error("Expected an active display generation");
      state = guideQueueReducer(state, { type: "acknowledgeVisible", acknowledgement });
      state = guideQueueReducer(state, { type: "acknowledgeStatus", acknowledgement });

      expect(state.seenIds).toEqual(["lottery"]);
      expect(guideQueueReducer(state, { type, acknowledgement })).toBe(state);
    },
  );

  it("rejects acknowledgements from withdrawn displays and older display generations", () => {
    const initial = enqueue(createGuideQueueState(SESSION_ID), [candidate("lottery")]);
    const firstDisplay = guideQueueReducer(initial, { type: "beginDisplay" });
    const stale = firstDisplay.display?.acknowledgement;
    if (!stale) throw new Error("Expected an active display generation");
    const withdrawn = guideQueueReducer(firstDisplay, { type: "withdrawDisplay" });
    expect(guideQueueReducer(withdrawn, { type: "acknowledgeStatus", acknowledgement: stale })).toBe(withdrawn);

    const restored = guideQueueReducer(withdrawn, { type: "beginDisplay" });
    const current = restored.display?.acknowledgement;
    if (!current) throw new Error("Expected a restored display generation");
    expect(current.displayGeneration).toBeGreaterThan(stale.displayGeneration);
    expect(guideQueueReducer(restored, { type: "acknowledgeVisible", acknowledgement: stale })).toBe(restored);
  });

  it("disabling hints clears current, queued and acknowledgement state and rejects later candidates", () => {
    let state = enqueue(createGuideQueueState(SESSION_ID), [candidate("lottery"), candidate("item")]);
    state = guideQueueReducer(state, { type: "beginDisplay" });
    state = guideQueueReducer(state, { type: "disableHints" });
    const later = enqueue(state, [candidate("terminus", 2)]);

    expect(later).toMatchObject({
      current: null,
      queued: [],
      display: null,
      hintsDisabled: true,
    });
    expect(later).toBe(state);
  });

  it("discards the queue at clear even when the session ID is unchanged", () => {
    let state = enqueue(createGuideQueueState(SESSION_ID), [candidate("lottery"), candidate("item")]);
    state = guideQueueReducer(state, { type: "beginDisplay" });
    const discarded = guideQueueReducer(state, { type: "discard" });
    const staleAck = state.display?.acknowledgement;
    const afterStaleAck = staleAck
      ? guideQueueReducer(discarded, { type: "acknowledgeStatus", acknowledgement: staleAck })
      : discarded;

    expect(afterStaleAck).toMatchObject({ current: null, queued: [], display: null, ended: true, seenIds: [] });
    expect(enqueue(afterStaleAck, [candidate("terminus", 2)])).toBe(afterStaleAck);
  });

  it("resets closed IDs and rejects the previous session's acknowledgements", () => {
    let state = enqueue(createGuideQueueState(SESSION_ID), [candidate("lottery")]);
    state = guideQueueReducer(state, { type: "beginDisplay" });
    const staleAck = state.display?.acknowledgement;
    state = guideQueueReducer(state, { type: "closeCurrent" });
    const reset = guideQueueReducer(state, { type: "resetSession", sessionId: SESSION_ID + 1, seenIds: [], hintsDisabled: false });
    const afterOldAck = staleAck
      ? guideQueueReducer(reset, { type: "acknowledgeVisible", acknowledgement: staleAck })
      : reset;

    expect(afterOldAck).toMatchObject({ sessionId: SESSION_ID + 1, current: null, closedIds: [], seenIds: [] });
    expect(afterOldAck).toBe(reset);
  });
});
