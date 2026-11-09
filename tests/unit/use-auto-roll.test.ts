// @vitest-environment jsdom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_ROLL_GAP_MS } from "../../src/features/game/autoRoll";
import { CLASSIC_GAME_CONFIG, ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { createItemGame } from "../../src/features/game/engine";
import { loadRailwayData } from "../../src/data/loaders";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import { reduceAppState, reduceGameSession, resumeSession, INITIAL_APP_STATE, type GameSession } from "../../src/features/game/gameSession";
import { itemActionIdentity, itemSessionView } from "../../src/features/game/itemSession";
import { networkFromData } from "../../src/features/game/networkFromData";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay, type TurnMomentDisplay } from "../../src/features/game/turnMomentPresentation";
import { useAutoRoll, type AutoRollControls } from "../../src/features/game/useAutoRoll";
import type { GameConfig, ItemGameState } from "../../src/types/network";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const data = await loadRailwayData("", async (file) => JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const loadedNetwork = networkFromData(data);
if (!loadedNetwork.ok) throw new Error(loadedNetwork.reason);
const network = loadedNetwork.network;
const presentation = createPresentationResolver(network);
let mounted: MountedReact | undefined;
let controls: AutoRollControls;
let strictMode = false;
let visibilityDescriptor: PropertyDescriptor | undefined;

interface HarnessProps {
  readonly session: GameSession;
  readonly onRoll: () => void;
  readonly surfaceOpen?: boolean;
  readonly itemDialogOpen?: boolean;
  readonly confirmationOpen?: boolean;
}

function displayFor(session: GameSession): TurnMomentDisplay {
  const itemView = itemSessionView(session, network);
  return deriveTurnMomentDisplay({ session, network, presentation,
    progress: displayedProgress(sessionProgress(session), network, null), attempt: null, revealStage: "done",
    restoredOrOmitted: false, itemView });
}

function Harness({ session, onRoll, surfaceOpen = false, itemDialogOpen = false, confirmationOpen = false }: HarnessProps): null {
  const current = useAutoRoll({ session, turnDisplay: displayFor(session), surfaceOpen, itemDialogOpen, confirmationOpen, onRoll });
  useLayoutEffect(() => { controls = current; });
  return null;
}

function render(props: HarnessProps): void {
  const node = createElement(Harness, props);
  const tree = strictMode ? createElement(StrictMode, null, node) : node;
  if (mounted) act(() => mounted!.root.render(tree));
  else mounted = mountReact(tree);
}

function setVisibility(value: DocumentVisibilityState): void { Object.defineProperty(document, "visibilityState", { configurable: true, value }); }

function classicSession(): GameSession {
  const state = reduceAppState(INITIAL_APP_STATE, { type: "new-game", seed: "auto-roll-classic" }, CLASSIC_GAME_CONFIG, network);
  if (state.screen !== "game") throw new Error("Expected a started classic game");
  return state.session;
}

function rollClassic(session: GameSession): GameSession {
  return reduceGameSession(session, { type: "roll", sessionId: session.sessionId, rngSeed: session.game.rngSeed,
    turn: session.game.turn }, CLASSIC_GAME_CONFIG, network);
}

function finishClassicAnimation(session: GameSession): GameSession {
  if (!session.animation) throw new Error("Expected a classic move animation");
  return reduceGameSession(session, { type: "animation-finished", ...session.animation }, CLASSIC_GAME_CONFIG, network);
}

function selectedDraft(session: GameSession): GameSession {
  const choice = itemSessionView(session, network)?.usableItems.find((item) => item.usable && item.kind === "double");
  if (!choice) throw new Error("Expected a usable staged item");
  return reduceItem(session, { type: "item-draft", ...itemActionIdentity(session),
    command: { items: [{ kind: "double", instanceId: choice.instanceId }] } });
}

function reduceItem(session: GameSession, action: Parameters<typeof reduceGameSession>[1]): GameSession { return reduceGameSession(session, action, ITEM_GAME_CONFIG, network); }

function pendingDiscardSession(): GameSession {
  const config = itemConfig("double", 1_000);
  const game = { ...createItemGame(config, "auto-roll-discard", network), inventory: heldItems("double") };
  let session = resumeSession(game, network, 31);
  session = reduceItem(session, { type: "item-commit", ...itemActionIdentity(session) });
  session = reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
  if (session.phase === "awaiting-adjust") throw new Error("Discard fixture unexpectedly requires adjustment");
  if (session.phase === "resolving") session = reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
  if (session.phase === "animating" && session.animation) session = reduceItem(session, { type: "animation-finished", ...session.animation });
  if (session.phase !== "awaiting-discard") throw new Error("Expected the reducer to reach a pending discard");
  return session;
}

function itemConfig(kind: "double" | "roll-adjust", dropChancePerMille: number): GameConfig {
  return { ...ITEM_GAME_CONFIG, itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille,
    harmfulChancePercent: 0, beneficialKinds: [kind] } };
}

function heldItems(kind: "double" | "roll-adjust"): ItemGameState["inventory"] {
  return [{ id: "held-1", kind }, { id: "held-2", kind }, { id: "held-3", kind }];
}

function adjustSession(): GameSession {
  const config = itemConfig("roll-adjust", 0);
  for (let seed = 0; seed < 100; seed += 1) {
    const game = { ...createItemGame(config, `auto-roll-adjust-${seed}`, network), inventory: [{ id: "held-adjust", kind: "roll-adjust" as const }] };
    let session = resumeSession(game, network, 32);
    session = reduceItem(session, { type: "item-commit", ...itemActionIdentity(session) });
    session = reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
    if (session.phase === "awaiting-adjust") return session;
  }
  throw new Error("Expected a reducer-produced adjustment decision");
}

function resolveDiscard(session: GameSession, discardNew: boolean): GameSession {
  const decision = itemSessionView(session, network)?.decision;
  if (decision?.kind !== "discard") throw new Error("Expected a pending discard decision");
  const instanceId = discardNew ? decision.newItemInstanceId : decision.candidates[0]?.id;
  if (!instanceId) throw new Error("Expected an old item candidate");
  return reduceItem(session, { type: "item-discard", ...itemActionIdentity(session), instanceId });
}

function finishDiscardResolution(session: GameSession): GameSession { return reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) }); }

function beginAutoRoll(session: GameSession, onRoll: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>(), props: Partial<HarnessProps> = {}): ReturnType<typeof vi.fn<() => void>> {
  render({ session, onRoll, ...props });
  act(() => controls.toggle());
  return onRoll;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  setVisibility("visible");
});

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
  if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
  else Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each([false, true])("useAutoRoll (StrictMode: %s)", (strict) => {
  beforeEach(() => { strictMode = strict; });

  it("waits 1,199 ms, rolls once at 1,200 ms, and does not repeat for the same ready key", () => {
    const onRoll = beginAutoRoll(classicSession());
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 1));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRoll).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS * 2));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it.each(["manual→timer", "timer→manual", "two synchronous manual calls"] as const)("shares one guard for %s", (race) => {
    const onRoll = beginAutoRoll(classicSession());
    if (race === "manual→timer") act(() => controls.requestRoll());
    if (race === "timer→manual") act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    if (race === "two synchronous manual calls") act(() => { controls.requestRoll(); controls.requestRoll(); });
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    act(() => controls.requestRoll());
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("does not consume a key when requestRoll sees a non-ready session", () => {
    const ready = classicSession();
    const moving = rollClassic(ready);
    const onRoll = vi.fn();
    render({ session: moving, onRoll });
    act(() => controls.requestRoll());
    expect(onRoll).not.toHaveBeenCalled();
    render({ session: finishClassicAnimation(moving), onRoll });
    act(() => controls.requestRoll());
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("lets a manual roll spend a staged draft while the timer remains paused", () => {
    const session = selectedDraft(resumeSession(itemScenario("double", network), network, 42));
    const onRoll = beginAutoRoll(session);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => controls.requestRoll());
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it.each(["presentation", "surface", "item dialog", "confirmation", "draft"] as const)("cancels elapsed time and restarts the full gap after the %s pause", (pause) => {
    let session = pause === "draft" ? resumeSession(itemScenario("double", network), network, 43) : classicSession();
    const onRoll = vi.fn();
    render({ session, onRoll });
    act(() => controls.toggle());
    act(() => vi.advanceTimersByTime(500));
    let pausedProps: HarnessProps;
    if (pause === "presentation") {
      session = rollClassic(session);
      pausedProps = { session, onRoll };
    } else if (pause === "draft") {
      session = selectedDraft(session);
      pausedProps = { session, onRoll };
    } else {
      pausedProps = { session, onRoll,
        ...(pause === "surface" ? { surfaceOpen: true } : {}),
        ...(pause === "item dialog" ? { itemDialogOpen: true } : {}),
        ...(pause === "confirmation" ? { confirmationOpen: true } : {}) };
    }
    render(pausedProps);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    expect(onRoll).not.toHaveBeenCalled();
    const readySession = pause === "presentation" ? finishClassicAnimation(session)
      : pause === "draft" ? reduceItem(session, { type: "item-draft", ...itemActionIdentity(session), command: { items: [] } }) : session;
    render({ session: readySession, onRoll });
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 1));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("uses the latest onRoll identity without restarting an unrelated render's gap", () => {
    const session = classicSession();
    const oldOnRoll = vi.fn();
    const latestOnRoll = vi.fn();
    beginAutoRoll(session, oldOnRoll);
    const initialToggle = controls.toggle;
    const initialRequestRoll = controls.requestRoll;
    act(() => vi.advanceTimersByTime(700));
    render({ session, onRoll: latestOnRoll });
    expect(controls.toggle).toBe(initialToggle);
    expect(controls.requestRoll).toBe(initialRequestRoll);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 700));
    expect(oldOnRoll).not.toHaveBeenCalled();
    expect(latestOnRoll).toHaveBeenCalledTimes(1);
  });

  it("restarts after OFF→ON and turns OFF on hidden without resuming when visible", () => {
    const session = classicSession();
    const onRoll = vi.fn();
    render({ session, onRoll });
    act(() => controls.toggle());
    act(() => vi.advanceTimersByTime(700));
    act(() => controls.toggle());
    act(() => vi.advanceTimersByTime(700));
    act(() => controls.toggle());
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 1));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRoll).toHaveBeenCalledTimes(1);

    const hiddenRoll = vi.fn();
    render({ session, onRoll: hiddenRoll });
    act(() => controls.toggle());
    act(() => vi.advanceTimersByTime(500));
    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(controls.enabled).toBe(false);
    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS * 2));
    expect(hiddenRoll).not.toHaveBeenCalled();
  });

  it("refuses to enable while hidden and ignores a stale timer callback after OFF", () => {
    const session = classicSession();
    const onRoll = vi.fn();
    const timeout = vi.spyOn(globalThis, "setTimeout");
    render({ session, onRoll });
    setVisibility("hidden");
    act(() => controls.toggle());
    expect(controls.enabled).toBe(false);
    setVisibility("visible");
    act(() => controls.toggle());
    const staleCallback = timeout.mock.calls.at(-1)?.[0];
    act(() => controls.toggle());
    if (typeof staleCallback === "function") act(() => staleCallback());
    expect(onRoll).not.toHaveBeenCalled();
  });

  it("starts remounted sessions OFF and cancels a pending timer on unmount", () => {
    const onRoll = vi.fn();
    beginAutoRoll(classicSession(), onRoll);
    act(() => vi.advanceTimersByTime(500));
    mounted?.cleanup();
    mounted = undefined;
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS * 2));
    expect(onRoll).not.toHaveBeenCalled();
    render({ session: classicSession(), onRoll });
    expect(controls.enabled).toBe(false);
  });

  it("does not stop on a pickup that was already published when auto-roll is enabled", () => {
    const session = resumeSession(itemScenario("route", network), network, 51);
    const onRoll = beginAutoRoll(session);
    expect(controls.enabled).toBe(true);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("stops at pickup publication and can re-enable without re-stopping on that record", () => {
    const config = itemConfig("double", 1_000);
    let session = resumeSession(createItemGame(config, "auto-roll-published-pickup", network), network, 52);
    const onRoll = beginAutoRoll(session);
    session = reduceItem(session, { type: "item-commit", ...itemActionIdentity(session) });
    session = reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
    if (session.phase === "awaiting-adjust") throw new Error("Pickup fixture unexpectedly requires adjustment");
    if (session.phase === "resolving") session = reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
    render({ session, onRoll });
    expect(controls.enabled).toBe(true);
    if (session.phase === "animating" && session.animation) session = reduceItem(session, { type: "animation-finished", ...session.animation });
    render({ session, onRoll });
    expect(session.lastMove?.itemRecord?.itemEvents.some((event) => event.type === "pickup-retained")).toBe(true);
    expect(controls.enabled).toBe(false);
    expect(onRoll).not.toHaveBeenCalled();
    act(() => controls.toggle());
    expect(controls.enabled).toBe(true);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it("waits through a reducer-produced adjust decision and starts a fresh gap when ready", () => {
    let session = adjustSession();
    expect(displayFor(session).decision?.kind).toBe("adjust");
    const onRoll = beginAutoRoll(session);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS * 2));
    expect(onRoll).not.toHaveBeenCalled();
    const decision = itemSessionView(session, network)?.decision;
    if (decision?.kind !== "adjust") throw new Error("Expected the reducer's adjustment choice");
    session = reduceItem(session, { type: "item-adjust", ...itemActionIdentity(session), adjustment: {
      instanceId: decision.itemInstanceIds[0]!, delta: decision.allowedDeltas[0]!,
    } });
    session = reduceItem(session, { type: "item-save-attempted", ...itemActionIdentity(session) });
    if (session.phase === "animating" && session.animation) session = reduceItem(session, { type: "animation-finished", ...session.animation });
    render({ session, onRoll });
    expect(controls.enabled).toBe(true);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 1));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it.each([["discard dialog", false], ["discard dialog", true], ["resolving window", false], ["resolving window", true]] as const)("handles the %s with new item discarded: %s", (phase, discardNew) => {
    let session = pendingDiscardSession();
    if (phase === "resolving window") session = resolveDiscard(session, discardNew);
    const onRoll = vi.fn();
    beginAutoRoll(session, onRoll);
    if (phase === "discard dialog") session = resolveDiscard(session, discardNew);
    render({ session, onRoll });
    expect(controls.enabled).toBe(true);
    session = finishDiscardResolution(session);
    render({ session, onRoll });
    if (discardNew) {
      expect(controls.enabled).toBe(true);
      act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 1));
      expect(onRoll).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onRoll).toHaveBeenCalledTimes(1);
    } else {
      expect(controls.enabled).toBe(false);
      expect(onRoll).not.toHaveBeenCalled();
    }
  });

  it("rechecks a DOM-only dialog and restarts a full gap after it closes", async () => {
    const onRoll = beginAutoRoll(classicSession());
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => vi.runAllTimers());
    expect(onRoll).not.toHaveBeenCalled();
    await act(async () => { dialog.removeAttribute("open"); await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS - 1));
    expect(onRoll).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it.each(["OFF", "hidden", "unmount"] as const)("cancels a DOM-dialog recheck after %s", (cancelBy) => {
    const onRoll = beginAutoRoll(classicSession());
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    act(() => vi.advanceTimersByTime(AUTO_ROLL_GAP_MS));
    if (cancelBy === "OFF") act(() => controls.toggle());
    if (cancelBy === "hidden") {
      setVisibility("hidden");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    }
    if (cancelBy === "unmount") { mounted?.cleanup(); mounted = undefined; }
    act(() => vi.runOnlyPendingTimers());
    expect(onRoll).not.toHaveBeenCalled();
  });
});
