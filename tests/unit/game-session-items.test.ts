// @vitest-environment jsdom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeneficialItemKind, GameConfig, ItemGameState, ItemTurnCommand } from "../../src/types/network";
import {
  beginItemTurn, buildRailwayNetwork, createItemGame, finishItemTurn, isItemSave,
  playItemTurn, playTurn, serializeGame,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  hasGameProgress, INITIAL_APP_STATE, reduceAppState, reduceGameSession, resumeSession, startSession,
  type GameAction, type GameSession,
} from "../../src/features/game/gameSession";
import { adjustmentOptions, itemActionIdentity, itemSessionView } from "../../src/features/game/itemSession";
import { readSave, type StorageLike } from "../../src/features/game/store/persistence";
import { useGameApp, type GameAppControls } from "../../src/features/game/useGameApp";
import { M_LINE, M_LOOP, M_SPUR, multiConfig, multiServiceInput } from "./fixtures/multiService";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const network = buildRailwayNetwork(multiServiceInput());
const config = { ...multiConfig(), rulesetVersion: "session-items-1",
  itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille: 0 } };
const empty: ItemTurnCommand = { items: [] };
const mounted: MountedReact[] = [];
afterEach(() => { mounted.splice(0).forEach((mount) => mount.cleanup()); });

function itemGame(session: GameSession): ItemGameState {
  if (!isItemSave(session.game)) throw new Error("Expected item mode");
  return session.game;
}
function fresh(...kinds: BeneficialItemKind[]): GameSession {
  const game = createItemGame(config, "session-items", network);
  return resumeSession({ ...game, inventory: kinds.map((kind, i) => ({ id: `held-${i}`, kind })) }, network, 7);
}
function reduce(session: GameSession, action: GameAction): GameSession {
  return reduceGameSession(session, action, config, network);
}
function commit(session: GameSession): GameSession {
  return reduce(session, { type: "item-commit", ...itemActionIdentity(session) });
}
function saved(session: GameSession): GameSession {
  return reduce(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
}
function finishAnimation(session: GameSession): GameSession {
  if (!session.animation) throw new Error("Expected animation");
  return reduce(session, { type: "animation-finished", ...session.animation });
}
function draft(session: GameSession, command: ItemTurnCommand): GameSession {
  return reduce(session, { type: "item-draft", ...itemActionIdentity(session), command });
}
function storageOf(game?: ItemGameState): StorageLike {
  const data = new Map<string, string>(game ? [["test-save", serializeGame(game)]] : []);
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); } };
}
function persistedFixture(kind: "adjust" | "discard"): ItemGameState {
  const policy = { ...config.itemPolicy, dropChancePerMille: 1000, harmfulChancePercent: 0,
    beneficialKinds: [kind === "adjust" ? "roll-adjust" : "double"] as BeneficialItemKind[] };
  for (let seed = 0; seed < 100; seed++) {
    let game = createItemGame({ ...config, itemPolicy: policy }, `persist-${seed}`, network);
    for (let turn = 0; turn < 30 && game.status === "playing"; turn++) {
      game = playItemTurn(game, {}, network).state;
      if (kind === "discard" && game.pending?.kind === "discard") return game;
      if (kind === "adjust" && game.inventory.length > 0 && !game.pending) return game;
    }
  }
  throw new Error(`No ${kind} fixture found`);
}
function mountApp(storage: StorageLike, mode: GameConfig = config, log?: string[]): () => GameAppControls {
  let controls: GameAppControls;
  function Harness(): null {
    const app = useGameApp(network, storage, mode, "test-save");
    useLayoutEffect(() => {
      controls = app;
      if (app.itemView?.decision?.kind === "adjust") log?.push("revealed");
      if (app.state.screen === "game" && app.state.session.phase === "animating") log?.push("animation");
    });
    return null;
  }
  mounted.push(mountReact(createElement(StrictMode, null, createElement(Harness))));
  return () => controls!;
}
function current(app: GameAppControls): GameSession {
  if (app.state.screen !== "game") throw new Error("Expected game screen");
  return app.state.session;
}

describe("item session phases and identity", () => {
  it("chooses mode by itemPolicy and leaves editable drafts outside the engine", () => {
    const start = startSession(config, "a", network);
    expect(start).toMatchObject({ phase: "idle", item: { decisionRevision: 0, draft: empty } });
    const session = fresh("double");
    const command: ItemTurnCommand = { items: [{ kind: "double", instanceId: "held-0" }] };
    const edited = draft(session, command);
    expect(edited.game).toBe(session.game);
    expect(edited.item?.draft).toEqual(command);
    expect(edited.item?.draft).not.toBe(command);
    const committing = commit(edited);
    expect(committing.phase).toBe("committing");
    expect(itemGame(committing).pending).toMatchObject({ kind: "roll", command });
    expect(Object.isFrozen(itemGame(committing).pending)).toBe(true);
    expect(itemSessionView(committing, network)?.decision).toBeNull();
    expect(draft(committing, empty)).toBe(committing);
  });

  it("saves the pending roll, adjusts, saves movement, animates and returns idle", () => {
    const committing = commit(fresh("roll-adjust"));
    const adjusting = saved(committing);
    expect(adjusting.phase).toBe("awaiting-adjust");
    const game = itemGame(adjusting);
    const delta = adjustmentOptions(game)[0]!;
    const pending = game.pending;
    if (pending?.kind !== "roll") throw new Error("Expected roll");
    const resolving = reduce(adjusting, { type: "item-adjust", ...itemActionIdentity(adjusting),
      adjustment: { instanceId: "held-0", delta } });
    expect(resolving).toMatchObject({ phase: "resolving", animation: null, game: { turn: 1, pending: null } });
    expect(itemGame(resolving)).toEqual(finishItemTurn(game, { instanceId: "held-0", delta }, network).state);
    const animating = saved(resolving);
    expect(animating.phase).toBe("animating");
    expect(animating.lastMove?.roll).toBe(pending.rawRoll + delta);
    expect(finishAnimation(animating)).toMatchObject({ phase: "idle", animation: null });
  });

  it.each(["no-item", "pre-roll", "delay", "oversleep"] as const)("takes the deterministic no-adjust path for %s", (mode) => {
    let session = fresh(...(mode === "no-item" ? [] : mode === "pre-roll" ? ["double", "roll-adjust"] as const : ["roll-adjust"] as const));
    if (mode === "pre-roll") session = draft(session, { items: [{ kind: "double", instanceId: "held-0" }] });
    if (mode === "delay" || mode === "oversleep") {
      const game = itemGame(session);
      session = { ...session, game: { ...game, effects: { ...game.effects,
        delayDueTurns: mode === "delay" ? [1] : [], oversleepPending: mode === "oversleep" } } };
    }
    const committing = commit(session);
    const resolving = saved(committing);
    expect(resolving.phase).toBe("resolving");
    expect(itemSessionView(resolving, network)?.decision).toBeNull();
    expect(itemGame(resolving)).toEqual(finishItemTurn(itemGame(committing), null, network).state);
    expect(saved(resolving).phase).toBe("animating");
  });

  it("resolves deadhead without a die and persists before animation", () => {
    const session = draft(fresh("deadhead"), { items: [{ kind: "deadhead", instanceId: "held-0" }] });
    const resolved = commit(session);
    expect(resolved.phase).toBe("resolving");
    expect(itemGame(resolved)).toMatchObject({ rngState: session.game.rngState, turn: 1, pending: null });
    expect(itemGame(resolved).movementHistory[0]?.kind).toBe("deadhead");
    expect(saved(resolved).lastMove).toBeNull();
    expect(finishAnimation(saved(resolved)).phase).toBe("idle");
  });

  it("continues without adjustment without cancelling or rerolling", () => {
    const adjusting = saved(commit(fresh("roll-adjust")));
    const expected = finishItemTurn(itemGame(adjusting), null, network).state;
    const resolved = reduce(adjusting, { type: "item-adjust", ...itemActionIdentity(adjusting), adjustment: null });
    expect(resolved.game).toEqual(expected);
    expect(itemGame(resolved).inventory).toEqual(itemGame(adjusting).inventory);
  });

  it("rejects stale drafts, commit/adjust/save callbacks and late animation callbacks", () => {
    const start = fresh("roll-adjust");
    const old = { type: "item-commit", ...itemActionIdentity(start) } as const;
    const edited = draft(start, empty);
    expect(reduce(edited, old)).toBe(edited);
    const committing = commit(edited);
    expect(commit(committing)).toBe(committing);
    const ack = { type: "item-save-attempted", ...itemActionIdentity(committing) } as const;
    const adjusting = reduce(committing, ack);
    expect(reduce(adjusting, ack)).toBe(adjusting);
    const adjust = { type: "item-adjust", ...itemActionIdentity(adjusting), adjustment: null } as const;
    const resolved = reduce(adjusting, adjust);
    expect(reduce(resolved, adjust)).toBe(resolved);
    expect(reduce(resolved, { ...adjust, sessionId: 99 })).toBe(resolved);
    expect(reduce(resolved, { ...adjust, turn: 99 })).toBe(resolved);
    const animating = saved(resolved);
    expect(reduce(animating, { type: "animation-finished", sessionId: animating.sessionId,
      turn: animating.animation!.turn, decisionRevision: 0 })).toBe(animating);
    const finished = finishAnimation(animating);
    expect(reduce(finished, { type: "animation-finished", ...animating.animation! })).toBe(finished);
    const resumed = resumeSession(adjusting.game, network, adjusting.sessionId + 1);
    expect(reduce(resumed, adjust)).toBe(resumed);
  });
});

describe("saveable pending decisions", () => {
  it("persists discard before animation, then saves the chosen discard without another animation", () => {
    const pending = persistedFixture("discard");
    // Replay the last pending turn from its completed base to exercise the live flow.
    const base = { ...pending, pending: null };
    let session = commit(resumeSession(base, network));
    session = saved(session);
    expect(session.phase).toBe("resolving");
    expect(itemGame(session).pending?.kind).toBe("discard");
    expect(itemSessionView(session, network)?.decision).toBeNull();
    session = finishAnimation(saved(session));
    expect(session.phase).toBe("awaiting-discard");
    const view = itemSessionView(session, network)!;
    if (view.decision?.kind !== "discard") throw new Error("Expected discard");
    expect(view.decision.candidates).toHaveLength(4);
    const choice = view.decision.candidates[0]!.id;
    const action = { type: "item-discard", ...itemActionIdentity(session), instanceId: choice } as const;
    const resolved = reduce(session, action);
    expect(resolved.phase).toBe("resolving");
    expect(reduce(resolved, action)).toBe(resolved);
    expect(itemGame(resolved).movementHistory.at(-1)?.discardedInstanceId).toBe(choice);
    expect(saved(resolved)).toMatchObject({ phase: "idle", animation: null, game: { pending: null } });
  });

  it.each(["roll", "discard"] as const)("reloads pending %s from a replay-validated save without reroll or animation", (kind) => {
    const acquired = persistedFixture(kind === "roll" ? "adjust" : "discard");
    const game = kind === "roll" ? beginItemTurn(acquired, empty, network).state : acquired;
    const storage = storageOf(game);
    const lookup = readSave(storage, network, game.config, "test-save");
    if (lookup.kind !== "valid") throw new Error("Expected valid save");
    expect(lookup.game).toEqual(game);
    const resumed = resumeSession(lookup.game, network, 20);
    expect(resumed.phase).toBe(kind === "roll" ? "awaiting-adjust" : "awaiting-discard");
    expect(resumed.animation).toBeNull();
    expect(resumed.game).toEqual(game);
    expect(itemSessionView(resumed, network)?.decision?.kind).toBe(kind === "roll" ? "adjust" : "discard");
    if (kind === "roll") expect(itemGame(resumed).pending).toEqual(game.pending);
  });

  it("resumes completed turns idle and a no-adjust pending roll by deterministic resolution", () => {
    const complete = finishAnimation(saved(saved(commit(fresh()))));
    expect(resumeSession(complete.game, network)).toMatchObject({ phase: "idle", animation: null });
    const pending = commit(fresh());
    const resumed = resumeSession(pending.game, network);
    expect(resumed).toMatchObject({ phase: "resolving", animation: null });
    expect(resumed.game).toEqual(finishItemTurn(itemGame(pending), null, network).state);
  });

  it("counts pending turn zero as progress and preserves it across title/resume", () => {
    const session = saved(commit(fresh("roll-adjust")));
    expect(session.game.turn).toBe(0);
    expect(hasGameProgress(session.game)).toBe(true);
    expect(hasGameProgress(fresh().game)).toBe(false);
    const title = reduceAppState({ screen: "game", session }, { type: "show-title" }, config, network);
    expect(title.screen).toBe("title");
    const resumed = reduceAppState(title, { type: "resume", game: session.game }, config, network);
    expect(resumed.screen === "game" && resumed.session.phase).toBe("awaiting-adjust");
  });
});

describe("persistence boundary in the React hook", () => {
  it("attempts the pending write before exposing the roll, including StrictMode", () => {
    const log: string[] = [];
    const storage = storageOf();
    const acquired = persistedFixture("adjust");
    const app = mountApp(storage, acquired.config, log);
    const pendingSnapshots: unknown[] = [];
    const set = storage.setItem;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      const game = JSON.parse(value) as ItemGameState;
      if (game.pending?.kind === "roll") {
        log.push("saved-roll");
        pendingSnapshots.push(app().itemView?.decision);
      } else if (game.turn > 0 || game.pending?.kind === "discard") log.push("saved-movement");
      set(key, value);
    });
    act(() => app().resume(acquired));
    log.length = 0;
    const staleRoll = app().roll;
    act(() => { staleRoll(); staleRoll(); });
    expect(pendingSnapshots).toEqual([null]);
    expect(log.indexOf("saved-roll")).toBeLessThan(log.indexOf("revealed"));
    expect(current(app()).phase).toBe("awaiting-adjust");
    expect(readSave(storage, network, acquired.config, "test-save")).toEqual({ kind: "valid", game: current(app()).game });
    act(() => app().adjustItemRoll(null));
    expect(log.indexOf("saved-movement")).toBeLessThan(log.indexOf("animation"));
    const game = current(app()).game;
    act(() => staleRoll());
    expect(current(app()).game).toBe(game);
  });

  it("writes pending and completed states in order on the no-adjust fast path", () => {
    const log: string[] = [];
    const storage = storageOf();
    const set = storage.setItem;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      const game = JSON.parse(value) as ItemGameState;
      log.push(game.pending?.kind === "roll" ? "pending" : game.turn === 0 ? "initial" : "completed");
      set(key, value);
    });
    const app = mountApp(storage, config, log);
    act(() => app().newGame());
    act(() => app().roll());
    expect(log).toEqual(["initial", "pending", "completed", "animation"]);
    expect(current(app()).phase).toBe("animating");
    expect(app().itemView?.decision).toBeNull();
  });

  it.each(["failed", "unavailable"] as const)("reports %s pending persistence and continues in memory", (result) => {
    const storage = storageOf();
    if (result === "failed") vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    // mountApp needs storage for the other cases; the unavailable hook is mounted directly here.
    let unavailable: GameAppControls;
    function Unavailable(): null {
      const app = useGameApp(network, null, config, "test-save");
      useLayoutEffect(() => { unavailable = app; });
      return null;
    }
    const app = result === "failed" ? mountApp(storage) : (() => {
      mounted.push(mountReact(createElement(StrictMode, null, createElement(Unavailable))));
      return () => unavailable!;
    })();
    act(() => app().resume(itemGame(fresh("roll-adjust"))));
    act(() => app().roll());
    expect(app().saveStatus).toBe(result);
    expect(current(app()).phase).toBe("awaiting-adjust");
    act(() => app().adjustItemRoll(null));
    expect(current(app()).phase).toBe("animating");
    act(() => app().finishAnimation(current(app()).animation!));
    expect(current(app()).phase).toBe("idle");
  });

  it("saves an in-flight commit before leaving to title even when both actions are batched", () => {
    const acquired = persistedFixture("adjust");
    const storage = storageOf(acquired);
    const app = mountApp(storage, acquired.config);
    act(() => app().resume(acquired));
    act(() => { app().roll(); app().showTitle(); });
    expect(app().state.screen).toBe("title");
    const lookup = app().saveLookup;
    if (lookup?.kind !== "valid" || !isItemSave(lookup.game)) throw new Error("Expected item save");
    expect(lookup.game.pending?.kind).toBe("roll");
    act(() => app().resume(lookup.game));
    expect(current(app()).phase).toBe("awaiting-adjust");
  });

  it("keeps an unsaved pending decision in memory across title and forgets it on deletion", () => {
    const storage = storageOf();
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const app = mountApp(storage);
    act(() => app().resume(itemGame(fresh("roll-adjust"))));
    act(() => app().roll());
    const pending = current(app()).game;
    act(() => app().showTitle());
    expect(app().saveLookup).toEqual({ kind: "valid", game: pending });
    act(() => app().resume(pending));
    expect(current(app()).phase).toBe("awaiting-adjust");
    expect(current(app()).game).toBe(pending);
    expect(write).toHaveBeenCalledTimes(3); // new session retries the failed write
    act(() => app().showTitle());
    act(() => { expect(app().removeSave()).toBe(true); });
    expect(app().saveLookup).toEqual({ kind: "none" });
  });

  it("resumes a persisted discard, saves the choice and never animates it", () => {
    const pending = persistedFixture("discard");
    const app = mountApp(storageOf(pending), pending.config);
    act(() => app().resume(pending));
    expect(current(app()).phase).toBe("awaiting-discard");
    const decision = app().itemView?.decision;
    if (decision?.kind !== "discard") throw new Error("Expected discard");
    act(() => app().discardItem(decision.candidates.at(-1)!.id));
    expect(current(app())).toMatchObject({ phase: "idle", animation: null, game: { pending: null } });
    act(() => app().showTitle());
    expect(app().saveLookup?.kind).toBe("valid");
  });

  it("keeps classic atomic turns, saves and animation callbacks unchanged", () => {
    const storage = storageOf();
    const writes = vi.spyOn(storage, "setItem");
    const app = mountApp(storage, multiConfig());
    act(() => app().newGame());
    const session = current(app());
    if (isItemSave(session.game)) throw new Error("Expected classic");
    expect(session).not.toHaveProperty("item");
    expect(app().itemView).toBeNull();
    expect(writes).toHaveBeenCalledTimes(1);
    const expected = playTurn(session.game, network).state;
    act(() => app().roll());
    expect(current(app()).game).toEqual(expected);
    expect(writes).toHaveBeenCalledTimes(2);
    act(() => app().finishAnimation(current(app()).animation!));
    expect(current(app()).phase).toBe("idle");
    expect(writes).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writes.mock.calls[1]![1])).not.toHaveProperty("pending");
  });
});

describe("read-only S9 view model", () => {
  it("reports route candidates, fixed Yamanote direction and graph-hop guidance", () => {
    const session = fresh("route-ticket", "direction-ticket", "rapid");
    const game = { ...itemGame(session), currentStationId: "b", currentServiceId: M_LINE, direction: -1 as const };
    const view = itemSessionView({ ...session, game }, network)!;
    expect(view.hints.routes.map(({ serviceId, isYamanote }) => ({ serviceId, isYamanote }))).toEqual([
      { serviceId: M_LOOP, isYamanote: true }, { serviceId: M_LINE, isYamanote: false }, { serviceId: M_SPUR, isYamanote: false },
    ]);
    expect(view.hints.routes[0]?.direction.directions.map((entry) => entry.direction)).toEqual([1]);
    expect(view.hints.direction.closerDirection).toBeNull();
    expect(view.hints.rapidHeadsTowardYamanote).toBe(false);
    expect(view.hints.deadheadDestination).toMatchObject({ toStationId: "b", distance: 0 });
    expect(view.hints.deadheadRecommended).toBe(false);
    expect(view.usableItems.every((item) => item.usable)).toBe(true);
    const away = itemSessionView({ ...session, game: { ...game, currentStationId: "x", direction: 1 } }, network)!;
    expect(away.hints.direction.closerDirection).toBe(1);
    expect(away.hints.rapidHeadsTowardYamanote).toBe(true);
    expect(away.hints.deadheadRecommended).toBe(true);
    expect(away.hints.deadheadDestination).toMatchObject({ toStationId: "b", distance: 1 });
  });

  it("exposes active effects, passive/forced reasons, and replaceable staged choices", () => {
    let session = fresh("direction-ticket", "deadhead", "delay-certificate");
    let view = itemSessionView(session, network)!;
    expect(view.usableItems[0]?.reason).toBe("fixed-direction");
    expect(view.usableItems[1]).toMatchObject({ usable: true, recommended: false });
    expect(view.usableItems[2]?.reason).toBe("passive");
    session = fresh("double", "deadhead", "delay-certificate");
    view = itemSessionView(session, network)!;
    session = draft(session, { items: [{ kind: "deadhead", instanceId: "held-1" }] });
    view = itemSessionView(session, network)!;
    expect(view.usableItems[0]).toMatchObject({ usable: true, reason: null, selected: false });
    expect(view.usableItems[1]).toMatchObject({ usable: true, reason: null, selected: true });
    const game = itemGame(session);
    const effects = { delayDueTurns: [1, 4], suspensions: [{ serviceId: M_LINE, expiresTurn: 5 }],
      detourPending: true, oversleepPending: true };
    view = itemSessionView({ ...session, game: { ...game, effects } }, network)!;
    expect(view.effects).toEqual(effects);
    expect(view.usableItems[1]?.reason).toBe("forced-turn");
    const atB = itemSessionView({ ...session, game: { ...game, currentStationId: "b", effects } }, network)!;
    expect(atB.hints.routes.map((route) => route.serviceId)).not.toContain(M_LINE);
  });

  it("offers only legal adjustment deltas at both die boundaries and keeps queries RNG-free", () => {
    for (const face of [1, 6]) {
      let adjusting: GameSession | undefined;
      for (let seed = 0; seed < 100; seed++) {
        const base = itemGame(fresh("roll-adjust"));
        const seeded = { ...createItemGame(config, `boundary-${seed}`, network), inventory: base.inventory };
        const session = saved(commit(resumeSession(seeded, network)));
        const game = itemGame(session);
        if (game.pending?.kind === "roll" && game.pending.rawRoll === face) { adjusting = session; break; }
      }
      if (!adjusting) throw new Error("No boundary fixture");
      const before = serializeGame(adjusting.game);
      const view = itemSessionView(adjusting, network)!;
      expect(view.decision).toMatchObject({ kind: "adjust", rawRoll: face, allowedDeltas: face === 1 ? [1] : [-1] });
      itemSessionView(adjusting, network);
      expect(serializeGame(adjusting.game)).toBe(before);
    }
    expect(reduceAppState(INITIAL_APP_STATE, { type: "item-commit", sessionId: 0, turn: 0, decisionRevision: 0 }, config, network)).toBe(INITIAL_APP_STATE);
  });
});
