// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRailwayData } from "../../src/data/loaders";
import { createItemGame, playItemTurn } from "../../src/features/game/engine";
import { displayedProgress, sessionProgress } from "../../src/features/game/animation/displayedProgress";
import { AUTO_ROLL_ANNOUNCEMENTS, selectAutoRollAnnouncement } from "../../src/features/game/autoRoll";
import {
  reduceGameSession, resumeSession, startSession, type GameSession,
} from "../../src/features/game/gameSession";
import { itemActionIdentity, itemSessionView } from "../../src/features/game/itemSession";
import { networkFromData } from "../../src/features/game/networkFromData";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { deriveTurnMomentDisplay, type TurnMomentDisplay } from "../../src/features/game/turnMomentPresentation";
import { useAutoRoll, type AutoRollControls } from "../../src/features/game/useAutoRoll";
import { CLASSIC_GAME_CONFIG, ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import type { GameConfig } from "../../src/types/network";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { mountReact, type MountedReact } from "./helpers/reactDom";

const data = await loadRailwayData("", async (file) => JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const loadedNetwork = networkFromData(data);
if (!loadedNetwork.ok) throw new Error(loadedNetwork.reason);
const network = loadedNetwork.network;
const presentation = createPresentationResolver(network);
let mounted: MountedReact | undefined;
let controls: AutoRollControls;
let visibilityDescriptor: PropertyDescriptor | undefined;

interface HarnessProps {
  readonly session: GameSession;
  readonly announcement: string;
  readonly phase?: TurnMomentDisplay["phase"];
  readonly summaryTurn?: number | null;
}

function displayFor({ session, announcement, phase, summaryTurn }: HarnessProps): TurnMomentDisplay {
  const itemView = itemSessionView(session, network);
  const display = deriveTurnMomentDisplay({ session, network, presentation,
    progress: displayedProgress(sessionProgress(session), network, null), attempt: null, revealStage: "done",
    restoredOrOmitted: false, itemView });
  return { ...display, announcement, ...(phase ? { phase } : {}), ...(summaryTurn !== undefined ? { summaryTurn } : {}) };
}

function Harness(props: HarnessProps): null {
  const current = useAutoRoll({ session: props.session, turnDisplay: displayFor(props), surfaceOpen: false,
    itemDialogOpen: false, confirmationOpen: false, onRoll: vi.fn() });
  useLayoutEffect(() => { controls = current; });
  return null;
}

function render(props: HarnessProps): void {
  const node = createElement(Harness, props);
  if (mounted) act(() => mounted!.root.render(node));
  else mounted = mountReact(node);
}

function classicSession(): GameSession {
  return startSession(CLASSIC_GAME_CONFIG, "auto-roll-announcement-classic", network, 71);
}

function rollClassic(session: GameSession): GameSession {
  return reduceGameSession(session, { type: "roll", sessionId: session.sessionId, rngSeed: session.game.rngSeed,
    turn: session.game.turn }, CLASSIC_GAME_CONFIG, network);
}

function finishClassic(session: GameSession): GameSession {
  if (!session.animation) throw new Error("Expected a classic move animation");
  return reduceGameSession(session, { type: "animation-finished", ...session.animation }, CLASSIC_GAME_CONFIG, network);
}

function itemConfig(): GameConfig {
  return { ...ITEM_GAME_CONFIG, itemPolicy: { ...ITEM_GAME_CONFIG.itemPolicy!, dropChancePerMille: 1_000,
    harmfulChancePercent: 0, beneficialKinds: ["double"] } };
}

function pickupSession(): GameSession {
  const config = itemConfig();
  for (let seed = 0; seed < 100; seed += 1) {
    const game = createItemGame(config, `auto-roll-announcement-pickup-${seed}`, network);
    const result = playItemTurn(game, {}, network);
    if (!result.record?.itemEvents.some((event) => event.type === "pickup-retained")) continue;
    return resumeSession(result.state, network, 72);
  }
  throw new Error("Expected a retained pickup fixture");
}

function pendingDiscardSession(): GameSession {
  const config = itemConfig();
  const game = { ...createItemGame(config, "auto-roll-announcement-discard", network), inventory: [
    { id: "held-1", kind: "double" as const }, { id: "held-2", kind: "double" as const }, { id: "held-3", kind: "double" as const },
  ] };
  let session = resumeSession(game, network, 73);
  session = reduceGameSession(session, { type: "item-commit", ...itemActionIdentity(session) }, config, network);
  session = reduceGameSession(session, { type: "item-save-attempted", ...itemActionIdentity(session) }, config, network);
  if (session.phase === "awaiting-adjust") throw new Error("Discard fixture unexpectedly requires adjustment");
  if (session.phase === "resolving") session = reduceGameSession(session,
    { type: "item-save-attempted", ...itemActionIdentity(session) }, config, network);
  if (session.phase === "animating" && session.animation) session = reduceGameSession(session,
    { type: "animation-finished", ...session.animation }, config, network);
  if (session.phase !== "awaiting-discard") throw new Error("Expected a pending discard decision");
  return session;
}

function resolveNewDiscard(session: GameSession): GameSession {
  const decision = itemSessionView(session, network)?.decision;
  if (decision?.kind !== "discard") throw new Error("Expected the pending discard choice");
  session = reduceGameSession(session, { type: "item-discard", ...itemActionIdentity(session),
    instanceId: decision.newItemInstanceId }, itemConfig(), network);
  return reduceGameSession(session, { type: "item-save-attempted", ...itemActionIdentity(session) }, itemConfig(), network);
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  setVisibility("visible");
});

afterEach(() => {
  mounted?.cleanup();
  mounted = undefined;
  if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
  else Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("auto-roll announcements", () => {
  it("selects summaries and pickup stops from structural publication data", () => {
    const startState = { kind: "start" as const, text: AUTO_ROLL_ANNOUNCEMENTS.started,
      publicationKey: "session:0:resolved", stopReason: null };
    const common = { state: startState, enabled: true,
      disposition: { kind: "ready" as const }, publicationKey: "session:1:resolved" };
    expect(selectAutoRollAnnouncement({ ...common, displayAnnouncement: "1ターン目：ただの文言", summaryTurn: null }))
      .toBe(AUTO_ROLL_ANNOUNCEMENTS.started);
    expect(selectAutoRollAnnouncement({ ...common, displayAnnouncement: "公開済みの要約", summaryTurn: 1 }))
      .toBe("公開済みの要約");

    const pendingPickupState = { kind: "pickup-stop-pending" as const, text: AUTO_ROLL_ANNOUNCEMENTS.started,
      publicationKey: "session:1:resolved", stopReason: "pickup" as const };
    expect(selectAutoRollAnnouncement({ state: pendingPickupState, enabled: false, disposition: { kind: "off" },
      displayAnnouncement: "拾得を含む要約", summaryTurn: 1, publicationKey: "session:1:resolved" }))
      .toBe(`${AUTO_ROLL_ANNOUNCEMENTS.pickup} 拾得を含む要約`);
    expect(selectAutoRollAnnouncement({ state: { ...startState, kind: "off" }, enabled: false,
      disposition: { kind: "off" }, displayAnnouncement: "既存の案内", summaryTurn: null, publicationKey: null }))
      .toBe("既存の案内");
  });

  it("preserves OFF-mode announcements byte-for-byte until auto-roll is enabled", () => {
    const session = classicSession();
    render({ session, announcement: "既存の案内 A" });
    expect(controls.announcement).toBe("既存の案内 A");
    render({ session, announcement: "既存の案内 B" });
    expect(controls.announcement).toBe("既存の案内 B");
  });

  it("shows the start copy through intermediate stages and one summary per new publication", () => {
    let session = classicSession();
    render({ session, announcement: "初期案内" });
    act(() => controls.toggle());
    expect(controls.announcement).toBe("おまかせで進みます。");
    render({ session, phase: "moving", announcement: "未公開の移動案内", summaryTurn: null });
    expect(controls.announcement).toBe("おまかせで進みます。");

    session = finishClassic(rollClassic(session));
    render({ session, announcement: "1ターン目：公開要約" });
    expect(controls.announcement).toBe("1ターン目：公開要約");
    render({ session, phase: "moving", announcement: "次の移動中案内", summaryTurn: null });
    expect(controls.announcement).toBe("1ターン目：公開要約");
    render({ session, announcement: "同じ公開の別文言", summaryTurn: 1 });
    expect(controls.announcement).toBe("1ターン目：公開要約");

    session = finishClassic(rollClassic(session));
    render({ session, announcement: "2ターン目：公開要約" });
    expect(controls.announcement).toBe("2ターン目：公開要約");
  });

  it("announces a resolved discard publication after an unresolved pending publication", () => {
    const pending = pendingDiscardSession();
    render({ session: pending, announcement: "未解決の破棄案内" });
    act(() => controls.toggle());
    expect(controls.announcement).toBe("おまかせで進みます。");

    const resolved = resolveNewDiscard(pending);
    render({ session: resolved, announcement: "1ターン目：解決済みの破棄要約" });
    expect(controls.enabled).toBe(true);
    expect(controls.announcement).toBe("1ターン目：解決済みの破棄要約");
  });

  it("selects the pickup stop copy together with its published summary", () => {
    const initial = resumeSession(createItemGame(itemConfig(), "auto-roll-announcement-origin", network), network, 72);
    render({ session: initial, announcement: "開始前の案内" });
    act(() => controls.toggle());
    const pickedUp = pickupSession();
    render({ session: pickedUp, announcement: "1ターン目：見かけ上の文言", summaryTurn: null });
    expect(controls.enabled).toBe(false);
    expect(controls.announcement).toBe("おまかせで進みます。");

    render({ session: pickedUp, announcement: "1ターン目：拾得を含む公開済みの要約", summaryTurn: 1 });
    expect(controls.announcement).toBe("アイテムを拾ったため、おまかせを止めました。 1ターン目：拾得を含む公開済みの要約");
  });

  it("retains manual and hidden stop copy without exposing an unpublished announcement", () => {
    const session = classicSession();
    render({ session, announcement: "初期案内" });
    act(() => controls.toggle());
    act(() => controls.toggle());
    expect(controls.announcement).toBe("おまかせを止めました。");
    const moving = rollClassic(session);
    render({ session: moving, phase: "moving", announcement: "後から変わった未公開文", summaryTurn: null });
    expect(controls.announcement).toBe("おまかせを止めました。");

    act(() => controls.toggle());
    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(controls.announcement).toBe("タブが非表示になったため、おまかせを止めました。");
    setVisibility("visible");
    const arrived = finishClassic(moving);
    render({ session: arrived, announcement: "1ターン目：非表示後の公開要約" });
    expect(controls.announcement).toBe("タブが非表示になったため、おまかせを止めました。");
    act(() => controls.requestRoll());
    expect(controls.announcement).toBe("1ターン目：非表示後の公開要約");
  });

  it("keeps a manual stop through passive presentation changes and releases it on a manual roll", () => {
    const origin = classicSession();
    render({ session: origin, announcement: "前の公開要約" });
    act(() => controls.toggle());
    act(() => controls.toggle());
    let moved = rollClassic(origin);
    render({ session: moved, phase: "moving", announcement: "移動中", summaryTurn: null });
    expect(controls.announcement).toBe("おまかせを止めました。");
    moved = finishClassic(moved);
    render({ session: moved, announcement: "次の公開要約" });
    expect(controls.announcement).toBe("おまかせを止めました。");
    act(() => controls.requestRoll());
    expect(controls.announcement).toBe("次の公開要約");
  });

  it("shows a stable draft-pause copy and clears it after deselection", () => {
    const config = ITEM_GAME_CONFIG;
    const session = resumeSession(itemScenario("double", network), network, 74);
    const usable = itemSessionView(session, network)?.usableItems.find((item) => item.usable && item.kind === "double");
    if (!usable) throw new Error("Expected a usable double item");
    let drafted = reduceGameSession(session, { type: "item-draft", ...itemActionIdentity(session),
      command: { items: [{ kind: "double", instanceId: usable.instanceId }] } }, config, network);
    render({ session, announcement: "前の公開要約" });
    act(() => controls.toggle());
    render({ session: drafted, announcement: "草稿変更案内 A" });
    expect(controls.announcement).toBe("アイテムを選択中です。手動で振るか、選択を解除してください。");
    drafted = reduceGameSession(drafted, { type: "item-draft", ...itemActionIdentity(drafted),
      command: { items: [{ kind: "double", instanceId: usable.instanceId }] } }, config, network);
    render({ session: drafted, announcement: "草稿変更案内 B" });
    expect(controls.announcement).toBe("アイテムを選択中です。手動で振るか、選択を解除してください。");
    const cleared = reduceGameSession(drafted, { type: "item-draft", ...itemActionIdentity(drafted), command: { items: [] } }, config, network);
    render({ session: cleared, announcement: "草稿解除後の案内" });
    expect(controls.announcement).toBe("");
  });

  it("releases a retained stop copy when a draft edit is made", () => {
    const session = resumeSession(itemScenario("double", network), network, 75);
    const usable = itemSessionView(session, network)?.usableItems.find((item) => item.usable && item.kind === "double");
    if (!usable) throw new Error("Expected a usable double item");
    render({ session, announcement: "前の公開要約" });
    act(() => controls.toggle());
    act(() => controls.toggle());
    expect(controls.announcement).toBe("おまかせを止めました。");
    const drafted = reduceGameSession(session, { type: "item-draft", ...itemActionIdentity(session),
      command: { items: [{ kind: "double", instanceId: usable.instanceId }] } }, ITEM_GAME_CONFIG, network);
    render({ session: drafted, announcement: "2ターン目：草稿編集後の通常案内" });
    expect(controls.announcement).toBe("2ターン目：草稿編集後の通常案内");
  });
});
