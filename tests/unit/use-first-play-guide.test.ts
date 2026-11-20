// @vitest-environment jsdom
import { StrictMode, act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  guideHintStorageKey,
  GUIDE_HINTS_DISABLED_KEY,
} from "../../src/features/game/store/guide";
import type { StorageLike } from "../../src/features/game/store/persistence";
import type { GuideCandidate, GuideHintId } from "../../src/features/game/firstPlayGuide";
import { useFirstPlayGuide, type UseFirstPlayGuideOptions, type UseFirstPlayGuideResult } from "../../src/features/game/useFirstPlayGuide";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const SESSION_ID = 31;

interface MemoryStorage extends StorageLike {
  readonly values: Map<string, string>;
  readonly writes: string[];
}

function storage(failWrites = false): MemoryStorage {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      if (failWrites) throw new Error("quota");
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
}

function candidate(hintId: GuideHintId, turn = 1, key = `${turn}:${hintId}`, sessionId = SESSION_ID, text = `本文 ${key}`): GuideCandidate {
  const copyId = hintId === "lottery" ? "lottery-service" : hintId;
  return { key, sessionId, turn, copy: { copyId, hintId, sectionId: "goal", text } };
}

function options(overrides: Partial<UseFirstPlayGuideOptions> = {}): UseFirstPlayGuideOptions {
  return {
    sessionId: SESSION_ID,
    candidates: [],
    storage: storage(),
    obscured: false,
    showClear: false,
    documentVisible: true,
    ...overrides,
  };
}

let mounted: MountedReact | null = null;
let current: UseFirstPlayGuideResult;
let renderCount = 0;

function Harness(props: UseFirstPlayGuideOptions): null {
  renderCount += 1;
  current = useFirstPlayGuide(props);
  return null;
}

function render(props: UseFirstPlayGuideOptions, strict = true): void {
  const child = createElement(Harness, props);
  const node = strict ? createElement(StrictMode, null, child) : child;
  if (!mounted) {
    mounted = mountReact(node);
    return;
  }
  act(() => mounted?.root.render(node));
}

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  renderCount = 0;
});

describe("first-play guide session hook", () => {
  it("deduplicates repeated renders and StrictMode effects while keeping same-turn order", () => {
    const store = storage();
    const candidates = [candidate("item"), candidate("lottery"), candidate("off-target")];
    render(options({ candidates, storage: store }));
    const firstKey = current.card?.candidate.key;
    render(options({ candidates: [...candidates], storage: store }));

    expect(current.currentCandidate?.copy.hintId).toBe("lottery");
    expect(current.queuedCandidates.map((entry) => entry.copy.hintId)).toEqual(["off-target", "item"]);
    expect(current.card?.candidate.key).toBe(firstKey);
  });

  it("keeps an acknowledged card until closed without repeating its announcement or persistence", () => {
    const store = storage();
    const candidates = [candidate("lottery"), candidate("item")];
    render(options({ candidates, storage: store }));
    const card = current.card;
    if (!card) throw new Error("Expected the hint card to become visible");
    const announcement = current.announcement;
    if (!announcement) throw new Error("Expected the hint announcement");

    act(() => current.onCardShown(card.acknowledgement));
    expect(store.values.get(guideHintStorageKey("lottery"))).toBeUndefined();
    act(() => current.onStatusAcknowledged(card.acknowledgement));
    act(() => current.onStatusAcknowledged(card.acknowledgement));

    expect(store.values.get(guideHintStorageKey("lottery"))).toBe("1");
    expect(store.writes.filter((key) => key === guideHintStorageKey("lottery"))).toHaveLength(1);
    expect(current.seenIds).toEqual(["lottery"]);
    expect(current.currentCandidate?.copy.hintId).toBe("lottery");
    expect(current.queuedCandidates.map((entry) => entry.copy.hintId)).toEqual(["item"]);

    render(options({ candidates, storage: store, obscured: true }));
    expect(current.card).toBeNull();
    expect(current.announcement).toBeNull();
    render(options({ candidates, storage: store, obscured: false }));
    const restored = current.card;
    if (!restored) throw new Error("Expected the acknowledged card to return");
    expect(restored.candidate.copy.hintId).toBe("lottery");
    expect(restored.acknowledgement.displayGeneration).toBeGreaterThan(card.acknowledgement.displayGeneration);
    expect(current.announcement).toBeNull();

    act(() => current.onCardShown(restored.acknowledgement));
    act(() => current.onStatusAcknowledged(restored.acknowledgement));
    expect(store.writes.filter((key) => key === guideHintStorageKey("lottery"))).toHaveLength(1);

    act(() => current.closeCurrent());
    expect(current.currentCandidate?.copy.hintId).toBe("item");
    expect(current.announcement?.text).toBe("本文 1:item");
  });

  it("does not rerender or persist when either acknowledgement repeats after both are accepted", () => {
    const store = storage();
    render(options({ candidates: [candidate("lottery")], storage: store }));
    const card = current.card;
    if (!card) throw new Error("Expected the hint card to become visible");

    act(() => current.onCardShown(card.acknowledgement));
    act(() => current.onStatusAcknowledged(card.acknowledgement));
    const rendersAfterAcknowledgement = renderCount;
    const writesAfterAcknowledgement = store.writes.length;
    expect(store.values.get(guideHintStorageKey("lottery"))).toBe("1");
    expect(store.writes.filter((key) => key === guideHintStorageKey("lottery"))).toHaveLength(1);

    act(() => current.onCardShown(card.acknowledgement));
    expect(renderCount).toBe(rendersAfterAcknowledgement);
    expect(store.writes).toHaveLength(writesAfterAcknowledgement);

    act(() => current.onStatusAcknowledged(card.acknowledgement));
    expect(renderCount).toBe(rendersAfterAcknowledgement);
    expect(store.writes).toHaveLength(writesAfterAcknowledgement);
  });

  it("keeps hint IDs seen in memory across sessions when their storage write fails", () => {
    const store = storage(true);
    const first = candidate("lottery");
    render(options({ candidates: [first], storage: store }));
    const card = current.card;
    if (!card) throw new Error("Expected the hint card to become visible");
    act(() => current.onCardShown(card.acknowledgement));
    act(() => current.onStatusAcknowledged(card.acknowledgement));

    render(options({
      sessionId: SESSION_ID + 1,
      candidates: [candidate("lottery", 1, "lottery-next-session", SESSION_ID + 1)],
      storage: store,
    }));
    expect(current.seenIds).toEqual(["lottery"]);
    expect(current.currentCandidate).toBeNull();
    expect(current.card).toBeNull();
  });

  it("keeps the selected notice key and text together when the current candidate changes", () => {
    const candidates = [candidate("lottery", 1, "first", SESSION_ID, "抽選の本文"), candidate("item", 1, "second", SESSION_ID, "アイテムの本文")];
    render(options({ candidates }));
    const first = current.announcement;
    expect(first?.text).toBe("抽選の本文");

    act(() => current.closeCurrent());
    const second = current.announcement;
    expect(second?.text).toBe("アイテムの本文");
    expect(second?.key).not.toBe(first?.key);
    expect(second?.acknowledgement.candidateKey).toBe("second");
  });

  it.each([
    ["withdrawn by a modal", "withdraw"],
    ["closed", "close"],
    ["discarded at clear", "clear"],
    ["disabled", "disable"],
    ["moved to another session", "session"],
  ] as const)("rejects late callbacks after a hint is %s", (_label, transition) => {
    const store = storage();
    render(options({ candidates: [candidate("item")], storage: store }));
    const previous = current.card?.acknowledgement;
    if (!previous) throw new Error("Expected the hint card to become visible");

    if (transition === "withdraw") render(options({ candidates: [candidate("item")], storage: store, obscured: true }));
    if (transition === "close") act(() => current.closeCurrent());
    if (transition === "clear") render(options({ candidates: [candidate("item")], storage: store, showClear: true }));
    if (transition === "disable") act(() => current.disableHints());
    if (transition === "session") render(options({
      sessionId: SESSION_ID + 1,
      candidates: [candidate("item", 1, "next-session", SESSION_ID + 1)],
      storage: store,
    }));

    act(() => current.onCardShown(previous));
    act(() => current.onStatusAcknowledged(previous));
    expect(store.values.get(guideHintStorageKey("item"))).toBeUndefined();
  });

  it("rejects stale status after visible acknowledgement and requires both acknowledgements for the restored generation", () => {
    const store = storage();
    const candidates = [candidate("terminus")];
    render(options({ candidates, storage: store }));
    const first = current.card?.acknowledgement;
    if (!first) throw new Error("Expected the hint card to become visible");

    act(() => current.onCardShown(first));
    expect(store.values.get(guideHintStorageKey("terminus"))).toBeUndefined();
    render(options({ candidates, storage: store, obscured: true }));
    expect(current.card).toBeNull();
    act(() => current.onStatusAcknowledged(first));
    expect(store.values.get(guideHintStorageKey("terminus"))).toBeUndefined();

    render(options({ candidates, storage: store, obscured: false }));
    const resumed = current.card?.acknowledgement;
    if (!resumed) throw new Error("Expected the card to return after visibility resumes");
    expect(resumed.displayGeneration).toBeGreaterThan(first.displayGeneration);

    act(() => current.onStatusAcknowledged(resumed));
    expect(current.seenIds).toEqual([]);
    expect(store.values.get(guideHintStorageKey("terminus"))).toBeUndefined();
    act(() => current.onCardShown(resumed));
    expect(store.values.get(guideHintStorageKey("terminus"))).toBe("1");
    expect(store.writes.filter((key) => key === guideHintStorageKey("terminus"))).toHaveLength(1);
  });

  it("keeps hints disabled across sessions when persistence fails", () => {
    const store = storage(true);
    render(options({ candidates: [candidate("lottery"), candidate("item")], storage: store }));
    act(() => current.disableHints());
    expect(current.hintsDisabled).toBe(true);
    expect(current.currentCandidate).toBeNull();
    expect(current.queuedCandidates).toEqual([]);
    expect(current.announcement).toBeNull();
    expect(store.writes).toEqual([GUIDE_HINTS_DISABLED_KEY]);

    render(options({
      sessionId: SESSION_ID + 1,
      candidates: [candidate("terminus", 1, "next-session-terminus", SESSION_ID + 1)],
      storage: store,
    }));
    expect(current.hintsDisabled).toBe(true);
    expect(current.currentCandidate).toBeNull();
    expect(current.card).toBeNull();
  });

  it("withdraws and restores the same candidate with a fresh generation after an obscured state", () => {
    const store = storage();
    const candidates = [candidate("harmful-item")];
    render(options({ candidates, storage: store }));
    const previous = current.card?.acknowledgement;
    if (!previous) throw new Error("Expected the hint card to become visible");

    render(options({ candidates, storage: store, obscured: true }));
    expect(current.currentCandidate?.copy.hintId).toBe("harmful-item");
    expect(current.card).toBeNull();
    render(options({ candidates, storage: store, obscured: false }));
    expect(current.card?.candidate.copy.hintId).toBe("harmful-item");
    expect(current.card?.acknowledgement.displayGeneration).toBeGreaterThan(previous.displayGeneration);
  });
});
