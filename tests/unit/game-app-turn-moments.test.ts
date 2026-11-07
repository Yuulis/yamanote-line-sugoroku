// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { beginItemTurn, createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { itemActionIdentity, itemSessionView, itemLastMove } from "../../src/features/game/itemSession";
import { networkFromData } from "../../src/features/game/networkFromData";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { directionLabel, serviceName, stationName } from "../../src/features/game/presentation";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";
import { itemScenario } from "../e2e/fixtures/itemScenarios";

import { resumeSession, startSession, reduceGameSession, type GameSession } from "../../src/features/game/gameSession";
import {
  INITIAL_TURN_MOMENTS_STATE, observeTurnFacts, turnMomentsReducer, turnMomentTiming, type RollAttempt, type TurnMomentObservation,
} from "../../src/features/game/animation/turnMoments";
import { diceStampLabels } from "../../src/features/game/components/DiceTumble";
import { mapControlInsets, turnMomentDiceModel } from "../../src/features/game/components/TurnMomentHost";
import type { ItemGameState, ItemTurnRecord } from "../../src/types/network";
import type { useGameApp } from "../../src/features/game/useGameApp";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";
import { FIXTURE_GAME_SEED, LEGACY_FIXTURE_GAME_SEED } from "../e2e/fixtures/seeds";

const { railwayMapProps, injection, commits, lotteryCommits, trackEvent } = vi.hoisted(() => ({
  railwayMapProps: vi.fn(), injection: { app: null as ReturnType<typeof useGameApp> | null }, commits: [] as string[],
  trackEvent: vi.fn(), lotteryCommits: [] as string[],
}));
vi.mock("../../src/features/analytics/analytics", async (original) => ({
  ...await original<typeof import("../../src/features/analytics/analytics")>(), trackEvent,
}));
vi.mock("../../src/features/game/useGameApp", async (original) => {
  const actual = await original<typeof import("../../src/features/game/useGameApp")>();
  return { useGameApp: (...args: Parameters<typeof useGameApp>) => {
    const app = actual.useGameApp(...args);
    return injection.app ?? app;
  } };
});
vi.mock("../../src/features/game/components/GameHud", async (original) => {
  const actual = await original<typeof import("../../src/features/game/components/GameHud")>();
  return { GameHud: function RecordedHud(props: React.ComponentProps<typeof actual.GameHud>): React.JSX.Element {
    useLayoutEffect(() => { lotteryCommits.push(document.querySelector('[role="status"]')?.textContent ?? ""); });
    return createElement(actual.GameHud, props);
  } };
});
vi.mock("../../src/features/map/RailwayMap", () => ({ RailwayMap: (props: { panelKey?: number }) => {
  railwayMapProps(props);
  return createElement("div");
} }));
const railwayData = await loadRailwayData("", async (file) =>
  JSON.parse(readFileSync(`tests/e2e/fixtures/data/${file}`, "utf8")));
const networkResult = networkFromData(railwayData);
if (!networkResult.ok) throw new Error(networkResult.reason);
const network = networkResult.network;
const edition = EDITIONS[0];
let mounted: MountedReact | undefined;

function Harness(value: React.ComponentProps<typeof GameApp>): React.JSX.Element {
  useLayoutEffect(() => { commits.push(document.querySelector('[role="status"]')?.textContent ?? ""); });
  return createElement(GameApp, value);
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true,
    value(this: HTMLDialogElement): void { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true,
    value(this: HTMLDialogElement): void { this.removeAttribute("open"); } });
});
afterEach(() => {
  injection.app = null;
  trackEvent.mockClear();
  commits.length = 0; lotteryCommits.length = 0;
  railwayMapProps.mockClear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  mounted?.cleanup();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("GameApp shared turn moment display", () => {
  it("mounts all visible consumers from one injected publication boundary", () => {
    const game = itemScenario("route", network);
    const record = game.movementHistory.at(-1);
    if (record?.kind !== "item-ride") throw new Error("Expected a recorded item ride");
    const lastMove = itemLastMove(record, network);
    if (!lastMove?.landing || !lastMove.landing.serviceDrawRequired) throw new Error("Expected a service draw result");
    localStorage.setItem(edition.saveKey, serializeGame(game));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const presentation = createPresentationResolver(network);
    mounted = mountReact(createElement(Harness, {
      data: railwayData,
      network,
      edition,
      picker: { editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(), focusPicker: false, onPickerFocusRestored: vi.fn() },
      turnMomentBoundary: { attempt: null, revealStage: "lottery-flip", restoredOrOmitted: false },
    }));
    const resume = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent?.includes("つづきから"));
    if (!resume) throw new Error("Missing resume button");
    dispatchReactEvent(resume, new MouseEvent("click", { bubbles: true }));

    expect(mounted.container.querySelector('[data-stat="ride"]')?.textContent).toBe(
      serviceName(network, lastMove.serviceId, presentation),
    );
    expect(mounted.container.querySelector('[data-stat="station"]')?.textContent).toBe(
      stationName(network, lastMove.stopStationId, presentation),
    );
    expect(mounted.container.querySelector(".game-panel__candidates")).toBeNull();
    expect(mounted.container.querySelector(".game-panel__lottery")?.textContent).not.toContain(lastMove.landing.serviceId);
    expect(mounted.container.querySelectorAll(".game-panel [role=status]")).toHaveLength(1);
    expect(mounted.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);
    expect(mounted.container.querySelector(".game-panel__save")?.textContent).toContain("自動保存済み");
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress).toEqual({
      currentPosition: [139.738535, 35.628135], highlightedServiceId: "jr-yamanote",
      completedFeatureIds: ["jr-yamanote:shimbashi~hamamatsucho", "jr-yamanote:hamamatsucho~tamachi",
        "jr-yamanote:tamachi~takanawa-gateway", "jr-yamanote:takanawa-gateway~shinagawa"],
    });
    expect(status()).toBe("2ターン目：品川に到着。踏破 4/30。抽選結果を表示しています");
    act(() => mounted!.root.render(createElement(Harness, propsFor({ attempt: null, revealStage: "done", restoredOrOmitted: false }))));
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress).toEqual({
      currentPosition: [139.741535, 35.628135], highlightedServiceId: "fixture-south",
      completedFeatureIds: ["jr-yamanote:shimbashi~hamamatsucho", "jr-yamanote:hamamatsucho~tamachi",
        "jr-yamanote:tamachi~takanawa-gateway", "jr-yamanote:takanawa-gateway~shinagawa"],
    });
    expect(mounted!.container.querySelector('[data-stat="ride"]')?.textContent).toBe("テスト南線");
    expect(mounted!.container.querySelector('[data-stat="direction"]')?.textContent).toBe("大森方面");
    expect(mounted!.container.querySelector('[data-stat="roll"]')?.textContent).toBe("2（2マス、2駅移動）");
    expect(mounted!.container.querySelector(".game-panel__lottery")?.textContent).toBe("抽選: 品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ");
    expect(mounted!.container.querySelector(".game-panel__candidates")).toBeNull();
    expect(status()).toBe("2ターン目：出目2（2マス、2駅移動）、品川に到着。品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ。踏破 4/30。サイコロを振れます");
    expect(mounted!.container.querySelectorAll(".toast-host__toast")).toHaveLength(0);


  });
});


type HarnessProps = React.ComponentProps<typeof GameApp>;
function propsFor(boundary?: HarnessProps["turnMomentBoundary"]): HarnessProps {
  return { data: railwayData, network, edition,
    picker: { editions: EDITIONS, editionId: edition.id, onEditionChange: vi.fn(), focusPicker: false, onPickerFocusRestored: vi.fn() },
    turnMomentBoundary: boundary };
}
function inject(session: GameSession, failed = false): void {
  injection.app = { state: { screen: "game", session }, itemView: itemSessionView(session, network),
    saveStatus: failed ? "failed" : "saved", saveLookup: null,
    roll: vi.fn(), editItemDraft: vi.fn(), adjustItemRoll: vi.fn(), discardItem: vi.fn(),
    finishAnimation: vi.fn(), newGame: vi.fn(), resume: vi.fn(), removeSave: vi.fn(), showTitle: vi.fn(),
  } as ReturnType<typeof useGameApp>;
}
function render(props: HarnessProps): void {
  if (!mounted) { mounted = mountReact(createElement(Harness, props)); return; }
  act(() => mounted!.root.render(createElement(Harness, props)));
}
function click(label: string): void {
  const button = [...mounted!.container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  dispatchReactEvent(button, new MouseEvent("click", { bubbles: true }));
}
function status(): string {
  expect(mounted!.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  return mounted!.container.querySelector('[role="status"]')!.textContent!;
}
function attemptFor(origin: GameSession): RollAttempt {
  return { key: "31:roll:1:0", sessionId: 31, recordTurn: origin.game.turn + 1, source: "click",
    origin: { stationId: origin.game.currentStationId,
      ride: { serviceId: origin.game.currentServiceId, direction: origin.game.direction },
      completedSegmentIds: origin.game.completedSegmentIds, turn: origin.game.turn,
      itemView: itemSessionView(origin, network)!, previousLastMove: origin.lastMove },
    timing: { stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800, lotteryFlipMs: 1600, lotterySettleMs: 400, pickupMs: 500 },
    stage: "released", rawRoll: 1, tumbleCompleted: true, skipRequested: false, motionOmitted: false,
    adjustObserved: false, recordAccepted: true, stampsRequired: false, newlyCompletedTargetSegmentIds: [] };
}

describe("GameApp publication lifecycle", () => {
  it.each([false, true])("keeps classic first movement silent and the previous summary during the next movement (reduced motion %s)", (reduced) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const origin = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 31);
    inject(origin); render(propsFor());
    expect(status()).toBe("");
    const moving = reduceGameSession(origin, { type: "roll", sessionId: 31, rngSeed: origin.game.rngSeed, turn: 0 }, origin.game.config, network);
    inject(moving); render(propsFor());
    expect(status()).toBe("");
    expect(mounted!.container.querySelector(".game-panel__roll")?.getAttribute("aria-disabled")).toBe("true");
    expect([...mounted!.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "スキップ")?.disabled).toBe(false);
    const arrived = { ...moving, phase: "idle" as const, animation: null };
    inject(arrived); render(propsFor());
    const summary = "1ターン目：出目4、品川に到着。品川：山手線・テスト南線から抽選 → テスト南線 ／ 乗車方向は大森方面のみ。踏破 4/30";
    expect(status()).toBe(summary);
    expect(mounted!.container.querySelector<HTMLButtonElement>(".game-panel__roll")?.getAttribute("aria-disabled")).toBe("false");
    expect([...mounted!.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "スキップ")?.disabled).toBe(true);
    const next = reduceGameSession(arrived, { type: "roll", sessionId: 31, rngSeed: arrived.game.rngSeed, turn: 1 }, origin.game.config, network);
    inject(next); render(propsFor());
    expect(status()).toBe(summary);
  });
  it("does not announce restored classic history", () => {
    const origin = startSession(LEGACY_CAPITAL_REGION_CONFIG, LEGACY_FIXTURE_GAME_SEED, network, 32);
    const moved = reduceGameSession(origin, { type: "roll", sessionId: 32, rngSeed: origin.game.rngSeed, turn: 0 }, origin.game.config, network);
    inject(resumeSession(moved.game, network, 33)); render(propsFor());
    expect(status()).toBe("");
  });
  it("publishes map, HUD, inventory, effects, log and interaction together after arrival", () => {
    vi.useFakeTimers();
    const base = itemScenario("delay", network);
    const origin = resumeSession(base, network, 31);
    inject(origin); render(propsFor());
    const result = resumeSession(playItemTurn(base, {}, network).state, network, 31);
    const attempt = attemptFor(origin);
    inject(result, true); render(propsFor({ attempt: { ...attempt, stage: "tumble" }, revealStage: "waiting", restoredOrOmitted: false }));
    click("ログ");
    expect(mounted!.container.querySelector('[data-stat="station"]')?.textContent).toBe("目白");
    expect(mounted!.container.textContent).toContain("山手線の未踏破区間（15）");
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress.completedFeatureIds).toHaveLength(15);
    render(propsFor({ attempt, revealStage: "arrival", restoredOrOmitted: false }));
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress).toMatchObject({
      currentPosition: [139.74035, 35.73372], highlightedServiceId: "jr-yamanote",
    });
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress.completedFeatureIds).toHaveLength(18);
    expect(mounted!.container.querySelector('[data-stat="station"]')?.textContent).toBe("巣鴨");
    expect(mounted!.container.querySelector('[data-stat="ride"]')?.textContent).toBe("山手線");
    expect(mounted!.container.textContent).toContain("山手線の未踏破区間（12）");
    expect(mounted!.container.querySelectorAll(".item-slot h3")[0]?.textContent).toBe("路線指定券");
    expect(mounted!.container.querySelector(".item-event-notice")).toBeNull();
    expect(mounted!.container.textContent).not.toContain("遅延 あと3");
    expect(status()).toBe("5ターン目：巣鴨に到着。踏破 18/30");
    expect(mounted!.container.querySelector(".game-panel__roll")?.getAttribute("aria-disabled")).toBe("true");
    expect(mounted!.container.querySelector(".game-panel__save")?.textContent).toContain("保存に失敗しました（この進行は未保存です）");
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toContain("保存に失敗しました");
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(status()).toBe("5ターン目：出目3（3マス、3駅移動）、巣鴨に到着。山手線のみ ／ 外回りに固定。踏破 18/30。遅延：8ターン目に発動（あと3ターン）。出目が1になります。サイコロを振れます");
    expect(mounted!.container.textContent).toContain("遅延 あと3");
    expect(mounted!.container.querySelector(".item-event-notice")?.textContent).toBe("5ターン目のアイテム遅延：8ターン目に発動（あと3ターン）。出目が1になります");
    expect(mounted!.container.querySelector(".game-panel__roll")?.getAttribute("aria-disabled")).toBe("false");
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toContain("遅延を拾ってしまった！");
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toContain("保存に失敗しました");
    click("サイコロを振る");
    expect(injection.app!.roll).toHaveBeenCalledTimes(1);
    expect(commits.slice(-2)).toEqual([
      "5ターン目：巣鴨に到着。踏破 18/30",
      "5ターン目：出目3（3マス、3駅移動）、巣鴨に到着。山手線のみ ／ 外回りに固定。踏破 18/30。遅延：8ターン目に発動（あと3ターン）。出目が1になります。サイコロを振れます",
    ]);
  });
});


describe("GameApp decision and empty-event publication", () => {
  it("mounts translated candidate disclosure only when the lottery is published", () => {
    const origin = resumeSession(itemScenario("route", network), network, 31);
    const template = network.servicesById.get("fixture-south")!;
    const extendedNetwork = { ...network, servicesById: new Map([...network.servicesById,
      ["extra-east", { ...template, id: "extra-east", name: "テスト東線" }] as const,
      ["extra-north", { ...template, id: "extra-north", name: "テスト北線" }] as const,
    ]) };
    const move = origin.lastMove!;
    if (!move.landing) throw new Error("Expected landing");
    const result = { ...origin, lastMove: { ...move, landing: { ...move.landing,
      serviceCandidates: ["jr-yamanote", "fixture-south", "fixture-west", "extra-east", "extra-north"] } } };
    const attempt = attemptFor(origin);
    inject(origin); render({ ...propsFor(), network: extendedNetwork });
    inject(result); render({ ...propsFor({ attempt, revealStage: "lottery-flip", restoredOrOmitted: false }), network: extendedNetwork });
    expect(mounted!.container.querySelector(".game-panel__candidates")).toBeNull();
    render({ ...propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }), network: extendedNetwork });
    expect(mounted!.container.querySelector(".game-panel__candidates summary")?.textContent).toBe("抽選候補をすべて表示（5抽選枠）");
    expect([...mounted!.container.querySelectorAll(".game-panel__candidates li")].map((entry) => entry.textContent)).toEqual([
      "山手線", "テスト南線", "テスト西線", "テスト東線", "テスト北線",
    ]);
  });
  it("publishes draw-slot counts independently of grouped candidate rows", () => {
    const base = resumeSession(itemScenario("route", network), network, 31);
    const template = network.servicesById.get("fixture-south")!;
    const extraIds = ["extra-east", "extra-north", "extra-south"];
    const extendedNetwork = { ...network, servicesById: new Map([...network.servicesById,
      ...extraIds.map((id) => [id, { ...template, id, name: "テスト追加線" }] as const),
    ]) };
    if (!railwayData.manifest.ok) throw new Error("Expected manifest");
    const data = { ...railwayData, manifest: { ...railwayData.manifest, value: {
      ...railwayData.manifest.value,
      uiPresentation: { version: 1 as const, operators: [], stations: [], serviceStopNames: [],
        lineGroups: [{ id: "extra", name: "テスト追加線", operatorId: template.operator,
          color: template.color, serviceIds: extraIds }] },
    } } };
    const move = base.lastMove!;
    if (!move.landing) throw new Error("Expected landing");
    const candidates = ["jr-yamanote", "fixture-south", "fixture-west", ...extraIds];
    const origin: GameSession = { ...base, lastMove: { ...move, landing: { ...move.landing,
      serviceDrawRequired: true, serviceCandidates: candidates } } };
    const result: GameSession = { ...origin, lastMove: { ...move, landing: { ...move.landing,
      serviceDrawRequired: true, serviceCandidates: candidates.slice(0, 5) } } };
    inject(origin); render({ ...propsFor(), data, network: extendedNetwork });
    const attempt = attemptFor(origin);
    inject(result);
    render({ ...propsFor({ attempt, revealStage: "lottery-flip", restoredOrOmitted: false }), data, network: extendedNetwork });
    expect(mounted!.container.querySelector(".game-panel__candidates summary")?.textContent).toBe("抽選候補をすべて表示（6抽選枠）");
    expect(mounted!.container.querySelectorAll(".game-panel__candidates li")).toHaveLength(4);
    render({ ...propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }), data, network: extendedNetwork });
    expect(mounted!.container.querySelector(".game-panel__candidates summary")?.textContent).toBe("抽選候補をすべて表示（5抽選枠）");
    expect([...mounted!.container.querySelectorAll(".game-panel__candidates li")].map((entry) => entry.textContent)).toEqual([
      "山手線", "テスト南線", "テスト西線", "テスト追加線（抽選枠2）",
    ]);
  });
  it("keeps the certificate in the HUD until its cancellation is published", () => {
    const base = itemScenario("certificate", network);
    const origin = resumeSession(base, network, 31);
    inject(origin); render(propsFor());
    const result = resumeSession(playItemTurn(base, {}, network).state, network, 31);
    const attempt = attemptFor(origin);
    inject(result); render(propsFor({ attempt, revealStage: "arrival", restoredOrOmitted: false }));
    expect([...mounted!.container.querySelectorAll(".item-slot h3")].map((entry) => entry.textContent)).toEqual(["遅延証明書", "出目調整券", "倍速券"]);
    expect(mounted!.container.querySelector(".item-event-notice")).toBeNull();
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect([...mounted!.container.querySelectorAll(".item-slot h3")].map((entry) => entry.textContent)).toEqual(["出目調整券", "倍速券"]);
    expect(mounted!.container.querySelector(".item-event-notice")?.textContent).toBe("8ターン目のアイテム拾った寝過ごしを遅延証明書で打ち消しました");
    expect(mounted!.container.querySelector(".game-panel__roll")?.getAttribute("aria-disabled")).toBe("false");
  });
  it("holds a discard dialog and new inventory until pickup is published", () => {
    const base = itemScenario("discard", network);
    const origin = resumeSession(base, network, 31);
    inject(origin); render(propsFor());
    const result = resumeSession(playItemTurn(base, {}, network).state, network, 31);
    const attempt = attemptFor(origin);
    inject(result); render(propsFor({ attempt, revealStage: "pickup", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".item-discard")).toBeNull();
    expect(status()).toBe("山手線のみ ／ 外回りに固定");
    expect([...mounted!.container.querySelectorAll(".item-slot h3")].map((entry) => entry.textContent)).toEqual(["遅延証明書", "出目調整券", "倍速券"]);
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".item-discard")).not.toBeNull();
    expect(status()).toBe("7ターン目：出目2（2マス、2駅移動）、西日暮里に到着。山手線のみ ／ 外回りに固定。踏破 21/30。遅延証明書を拾いました。持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）。捨てるアイテムを1つ選んでください");
  });
  it("renders the suspension fallback without item events only after publication", () => {
    const origin = resumeSession(itemScenario("route", network), network, 31);
    inject(origin); render(propsFor());
    const move = origin.lastMove!;
    if (move.itemRecord?.kind !== "item-ride" || !move.itemRecord.landingSnapshot) throw new Error("Expected landing snapshot");
    const result: GameSession = { ...origin, lastMove: { ...move, itemRecord: { ...move.itemRecord,
      itemEvents: [], landingSnapshot: { ...move.itemRecord.landingSnapshot, suspensionIgnored: true } } } };
    const attempt = attemptFor(origin);
    inject(result); render(propsFor({ attempt, revealStage: "lottery-flip", restoredOrOmitted: false }));
    click("ログ");
    expect(mounted!.container.textContent).not.toContain("この駅では候補がすべて運休");
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".item-event-notice")?.textContent).toBe("この駅では候補がすべて運休のため、運休を無視して抽選しました。");
  });
  it("shows the goal completion notice and ongoing effects with no item events after arrival", () => {
    let game = createItemGame(ITEM_GAME_CONFIG, "00000000000000000000000000000004", network);
    let previous = game;
    while (game.status === "playing" && game.turn < 500) {
      previous = game;
      game = playItemTurn(game, {}, network).state;
      if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
    }
    expect(game.status).toBe("completed");
    const origin = resumeSession(previous, network, 31);
    inject(origin); render(propsFor());
    const result = resumeSession(game, network, 31);
    expect(result.lastMove?.itemRecord?.itemEvents).toEqual([]);
    const attempt = attemptFor(origin);
    inject(result); render(propsFor({ attempt, revealStage: "arrival", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".clear-screen")).toBeNull();
    // S12 (prompt: "Goal announcement is owned by ClearScreen only, no duplicate before replacement"): the goal banner
    // announces the arrival without the goal sentence that ClearScreen announces next, and a goal turn draws no lottery.
    // Was: "10ターン目：新橋に到着。ゴールに到着しました。踏破 30/30。抽選結果を表示しています".
    expect(status()).toBe("10ターン目：新橋に到着。踏破 30/30");
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".clear-screen")).not.toBeNull();
    expect(mounted!.container.querySelector(".item-event-notice [role=status]")?.textContent).toBe("10ターン目：出目1（1マス、1駅移動）、新橋に到着。ゴールに到着しました。踏破 30/30");
    expect(mounted!.container.querySelectorAll(".item-event-notice [role=status]")).toHaveLength(1);
    // The existing share feedback region is separate from the gameplay announcement.
    expect(mounted!.container.querySelector(".game-panel")).toBeNull();
    injection.app = { ...injection.app!, itemView: { ...injection.app!.itemView!,
      effects: { ...injection.app!.itemView!.effects, delayDueTurns: [12] } } };
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector('[aria-label="続いている効果"]')?.textContent).toBe("続いている効果遅延：12ターン目に発動（あと2ターン）");
    expect(mounted!.container.querySelector(".item-event-notice")).not.toBeNull();
  });
});

function reactOnClick(element: Element): () => void {
  const key = Object.keys(element).find((name) => name.startsWith("__reactProps"))!;
  return (element as unknown as Record<string, { onClick: () => void }>)[key]!.onClick;
}

describe("GameApp presented-decision handoffs and action guards", () => {
  it("ignores a roll callback captured before the lock when the display forbids rolling", () => {
    const origin = resumeSession(itemScenario("delay", network), network, 31);
    inject(origin); render(propsFor());
    const dice = mounted!.container.querySelector<HTMLButtonElement>(".game-panel__roll")!;
    expect(dice.getAttribute("aria-disabled")).toBe("false");
    const staleRoll = reactOnClick(dice);
    render(propsFor({ attempt: { ...attemptFor(origin), stage: "tumble" }, revealStage: "waiting", restoredOrOmitted: false }));
    expect(origin.phase).toBe("idle");
    expect(dice.getAttribute("aria-disabled")).toBe("true");
    act(() => staleRoll());
    expect(injection.app!.roll).not.toHaveBeenCalled();
    render(propsFor());
    expect(dice.getAttribute("aria-disabled")).toBe("false");
    act(() => staleRoll());
    expect(injection.app!.roll).toHaveBeenCalledTimes(1);
  });
  it("ignores a stale discard callback unless the discard decision is presented", () => {
    const base = itemScenario("discard", network);
    const origin = resumeSession(base, network, 31);
    inject(origin); render(propsFor());
    const result = resumeSession(playItemTurn(base, {}, network).state, network, 31);
    const attempt = attemptFor(origin);
    inject(result); render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    const choose = mounted!.container.querySelector<HTMLButtonElement>(".item-discard .item-card__action")!;
    const staleDiscard = reactOnClick(choose);
    render(propsFor({ attempt, revealStage: "pickup", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".item-discard")).toBeNull();
    act(() => staleDiscard());
    expect(injection.app!.discardItem).not.toHaveBeenCalled();
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    act(() => staleDiscard());
    expect(injection.app!.discardItem).toHaveBeenCalledTimes(1);
  });
  it("hands the single live region and toast obscuration to the discard dialog in one render", () => {
    vi.useFakeTimers();
    const base = itemScenario("discard", network);
    const origin = resumeSession(base, network, 31);
    inject(origin); render(propsFor());
    const resultGame = playItemTurn(base, {}, network).state;
    const result = resumeSession(resultGame, network, 31);
    const attempt = attemptFor(origin);
    inject(result); render(propsFor({ attempt, revealStage: "pickup", restoredOrOmitted: false }));
    expect(mounted!.container.querySelectorAll(".game-panel > [role=status]")).toHaveLength(1);
    expect(status()).toBe("山手線のみ ／ 外回りに固定");
    const opener = mounted!.container.querySelector<HTMLButtonElement>(".item-slot button")!;
    act(() => opener.click());
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toBe("");
    render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(mounted!.container.querySelector(".item-discard")).not.toBeNull();
    expect(mounted!.container.querySelectorAll(".game-panel > [role=status]")).toHaveLength(0);
    expect(mounted!.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(mounted!.container.querySelectorAll(".item-discard [role=status]")).toHaveLength(1);
    const toastText = mounted!.container.querySelector(".toast-host")?.textContent;
    expect(toastText).toContain("遅延証明書");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toBe(toastText);
    const pending = resultGame.pending;
    if (pending?.kind !== "discard") throw new Error("Expected a pending discard");
    const resolved = resumeSession(resolveItemDiscard(resultGame, pending.item.id).state, network, 31);
    inject(resolved); render(propsFor({ attempt, revealStage: "done", restoredOrOmitted: false }));
    expect(mounted!.container.querySelector(".item-discard")).toBeNull();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// S10b fixtures for the S11 activation. Production passes `attempt: null`, so
// the GameApp rows assert today's behaviour; the attempt fixtures below drive
// the real turn-moment reducer, and `restoredAdjustAttempt` is the boundary S11
// feeds GameApp once it builds attempts itself.
// ---------------------------------------------------------------------------

/** Plain turn-1 game: no adjustment, no discard, so every save boundary is observable. */
const PLAIN_SEED = "review-order";

function plainOrigin(): GameSession {
  return resumeSession(createItemGame(ITEM_GAME_CONFIG, PLAIN_SEED, network), network, 31);
}

/**
 * The save boundaries of one plain turn, built with the real session reducers:
 * `committing` (pending roll being saved), `resolving` (resolved turn being
 * saved) and `accepted` (the resolved save acknowledged, movement staged).
 */
function saveBoundarySessions(): Record<"committing" | "resolving" | "accepted" | "save-attempted", GameSession> {
  const step = (session: GameSession, type: "item-commit" | "item-save-attempted"): GameSession =>
    reduceGameSession(session, { type, ...itemActionIdentity(session) }, ITEM_GAME_CONFIG, network);
  const committing = step(plainOrigin(), "item-commit");
  const resolving = step(committing, "item-save-attempted");
  const accepted = step(resolving, "item-save-attempted");
  // A failed write is still a save attempt: the session state is the same as an accepted save.
  return { committing, resolving, accepted, "save-attempted": accepted };
}

interface BoundaryReading { station: string | null; dice: string | null; diceDisabled: string | null; frames: number }

function boundaryReading(): BoundaryReading {
  const dice = mounted!.container.querySelector(".game-panel__roll");
  return {
    station: mounted!.container.querySelector('[data-stat="station"]')?.textContent ?? null,
    dice: dice?.textContent ?? null, diceDisabled: dice?.getAttribute("aria-disabled") ?? null,
    frames: vi.mocked(window.requestAnimationFrame).mock.calls.length,
  };
}

function saveText(): string | null {
  return mounted!.container.querySelector(".game-panel__save")?.textContent ?? null;
}

/** A restored pending adjustment as an attempt: motion omitted, record not yet accepted. */
function restoredAdjustAttempt(origin: GameSession): RollAttempt {
  return { ...attemptFor(origin), source: "restored-roll", stage: "waiting-record", tumbleCompleted: true,
    motionOmitted: true, adjustObserved: true, recordAccepted: false, recordTurn: origin.game.turn + 1 };
}

describe("S10b accepted-save boundary in GameApp", () => {
  // Injected sessions with no accepted dice click: no roll attempt exists, so a staged move is not gated (the
  // attempt-less path, as for a restored roll resolved without a decision). The click-driven S11 gate follows below.
  it.each([
    { phase: "committing", failed: false, dice: "サイコロを振る", frames: 0 },
    { phase: "resolving", failed: false, dice: "サイコロを振る", frames: 0 },
    { phase: "accepted", failed: false, dice: "移動中…", frames: 1 },
    { phase: "save-attempted", failed: true, dice: "移動中…", frames: 1 },
  ] as const)("shows the origin and locked dice for $phase (failed save: $failed), moving only once accepted", ({ phase, failed, dice, frames }) => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    inject(saveBoundarySessions()[phase], failed);
    render(propsFor());

    expect(boundaryReading()).toEqual({ station: "新橋", dice, diceDisabled: "true", frames });
    expect(saveText()).toBe(failed ? "セーブ: 保存に失敗しました（この進行は未保存です）" : "セーブ: 自動保存済み");
    expect(mounted!.container.querySelector(".toast-host")?.textContent).toBe(failed ? "保存に失敗しました" : "");
    status(); // exactly one live region at every boundary
    // Rendering the same failed session again neither starts a second movement nor unlocks the dice.
    render(propsFor());
    expect(boundaryReading().frames).toBe(frames);
    expect(boundaryReading().diceDisabled).toBe("true");
    click(dice);
    expect(injection.app!.roll).not.toHaveBeenCalled();
  });
});

describe("S10b pending-adjust resume", () => {
  function pendingAdjustSession(): GameSession {
    const pending = beginItemTurn(itemScenario("adjust", network), { items: [] }, network).state;
    if (pending.pending?.kind !== "roll") throw new Error("Expected an engine-built pending adjustment");
    return resumeSession(pending, network, 31);
  }

  it.each([
    { name: "today (no attempt)", boundary: () => propsFor({ attempt: null, revealStage: "waiting", restoredOrOmitted: true }) },
    { name: "S11 restored attempt", boundary: (session: GameSession) => propsFor({
      attempt: restoredAdjustAttempt(session), revealStage: "waiting", restoredOrOmitted: true }) },
    // S11 switch: production builds the restored attempt itself from the resumed pending adjustment.
    { name: "S11 production restored attempt", boundary: () => propsFor() },
  ])("presents the adjustment dialog with no tumble layer: $name", ({ boundary }) => {
    const session = pendingAdjustSession();
    inject(session);
    render(boundary(session));

    expect(session.phase).toBe("awaiting-adjust");
    expect(mounted!.container.querySelector(".item-adjustment")).not.toBeNull();
    expect(mounted!.container.querySelector(".dice-tumble, .turn-moment-host")).toBeNull();
    expect(mounted!.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    click("そのまま続ける");
    expect(injection.app!.adjustItemRoll).toHaveBeenCalledExactlyOnceWith(null);
    expect(mounted!.container.querySelector(".dice-tumble, .turn-moment-host")).toBeNull();
  });
});

describe("S10b attempt acceptance and speed capture (reducer fixtures)", () => {
  const base = attemptFor(plainOrigin()).origin;
  type State = typeof INITIAL_TURN_MOMENTS_STATE;
  const begin = (state: State = INITIAL_TURN_MOMENTS_STATE, stepMs = 450, turn = 0, source?: "restored-roll") =>
    turnMomentsReducer(state, { type: "begin", sessionId: 31, turn, decisionRevision: 0, origin: base,
      timing: turnMomentTiming(stepMs), source });
  const acceptedRecord = (): TurnMomentObservation => {
    const record = playItemTurn(createItemGame(ITEM_GAME_CONFIG, PLAIN_SEED, network), {}, network).record;
    if (record?.kind !== "item-ride") throw new Error("Expected a plain ride record");
    return { decision: null, record, movementEvents: [], movementSessionId: 31, movementTurn: 1, targetServiceId: "jr-yamanote" };
  };
  const observe = (state: State, facts: TurnMomentObservation) => turnMomentsReducer(state, { type: "observe", sessionId: 31, facts });
  const advance = (state: State, expectedStage: "tumble" | "stamps") =>
    turnMomentsReducer(state, { type: "advance", key: "31:roll:1:0", expectedStage });

  it("releases only an accepted record, and exactly once however often it is observed", () => {
    const started = begin();
    expect(started.attempt).toMatchObject({ key: "31:roll:1:0", stage: "waiting-roll", recordAccepted: false });
    // A failed save yields no accepted record: nothing is observed, nothing starts or advances.
    expect(observe(started, { decision: null, record: null, movementEvents: [], targetServiceId: "jr-yamanote" })).toBe(started);
    expect(advance(started, "tumble")).toBe(started);
    expect(begin(started)).toBe(started);

    const tumbling = observe(started, acceptedRecord());
    expect(tumbling.attempt).toMatchObject({ stage: "tumble", recordAccepted: true, rawRoll: 1, stampsRequired: false });
    expect(observe(tumbling, acceptedRecord())).toBe(tumbling);
    const released = advance(tumbling, "tumble");
    expect(released.attempt).toMatchObject({ stage: "released", tumbleCompleted: true });
    expect(advance(released, "tumble")).toBe(released);
    expect(observe(released, acceptedRecord())).toBe(released);
  });

  it("resumes a restored pending roll without ever entering the tumble stage", () => {
    const restored = begin(INITIAL_TURN_MOMENTS_STATE, 450, 0, "restored-roll");
    expect(restored.attempt).toMatchObject({ source: "restored-roll", stage: "waiting-record",
      tumbleCompleted: true, motionOmitted: true, recordAccepted: false });
    expect(advance(restored, "tumble")).toBe(restored);
    const released = observe(restored, acceptedRecord());
    expect(released.attempt).toMatchObject({ stage: "released", recordAccepted: true, motionOmitted: true });
  });

  it("captures the speed per attempt key; a later speed applies to the next turn only", () => {
    const normal = begin();
    expect(normal.attempt?.timing).toEqual({ stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800,
      lotteryFlipMs: 1600, lotterySettleMs: 400, pickupMs: 500 });
    // The speed menu changed to はやい while this attempt is active: the same key keeps its captured timing.
    expect(begin(normal, 300)).toBe(normal);
    const next = begin(normal, 300, 1);
    expect(next.attempt).toMatchObject({ key: "31:roll:2:0" });
    expect(next.attempt?.timing).toEqual({ stepMs: 300, tumbleMs: 400, stampsMs: 160, arrivalMs: 533,
      lotteryFlipMs: 1067, lotterySettleMs: 267, pickupMs: 333 });
    expect(normal.attempt?.timing.tumbleMs).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// S11 activation: tumble, adjustment after the tumble, stamps, and one Skip.
// Real GameApp + useGameApp + storage unless a test injects the app.
// ---------------------------------------------------------------------------

/** Stage durations at normal speed (450 ms/hop), written down from the specification. */
const TUMBLE_MS = 600;
const STAMPS_MS = 240;

/** Controllable `prefers-reduced-motion`; returns a setter that notifies the app like a media-query change. */
function motionPreference(initial: boolean): (reduce: boolean) => void {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches(): boolean { return matches; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })));
  return (reduce: boolean) => act(() => { matches = reduce; listeners.forEach((listener) => listener()); });
}

/** Resume `game` through the title screen with a fake stage clock and counted (never run) animation frames. */
function openSaved(game: ItemGameState): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.setItem(edition.saveKey, serializeGame(game));
  render(propsFor());
  click("つづきから");
}

function advance(milliseconds: number): void {
  act(() => { vi.advanceTimersByTime(milliseconds); });
}

function frames(): number {
  return vi.mocked(window.requestAnimationFrame).mock.calls.length;
}

function storedGame(): ItemGameState {
  return JSON.parse(localStorage.getItem(edition.saveKey)!) as ItemGameState;
}

function dice(): HTMLElement {
  return mounted!.container.querySelector<HTMLElement>(".game-panel__roll")!;
}

function tumble(): { stage: string | null; raw: string | null; stamps: string[] } | null {
  const root = mounted!.container.querySelector(".dice-tumble");
  if (!root) return null;
  return { stage: root.getAttribute("data-stage"), raw: root.getAttribute("data-raw-roll"),
    stamps: [...root.querySelectorAll(".dice-tumble__stamp")].map((stamp) => stamp.textContent ?? "") };
}

function adjustmentDialog(): HTMLElement | null {
  return mounted!.container.querySelector<HTMLElement>(".item-adjustment");
}

function dialogSkip(): HTMLButtonElement {
  return [...adjustmentDialog()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "スキップ")!;
}

function panelSkip(): HTMLButtonElement {
  return [...mounted!.container.querySelectorAll<HTMLButtonElement>(".game-panel button")]
    .find((button) => button.textContent === "スキップ" && !button.closest("dialog"))!;
}

function press(element: Element): void {
  dispatchReactEvent(element, new MouseEvent("click", { bubbles: true }));
}

/** Choose the +1 (or else −1) radio of the presented adjustment and return the chosen delta. */
function chooseAdjustment(): 1 | -1 {
  const radios = [...adjustmentDialog()!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const plus = radios.find((radio) => radio.value === "1");
  const chosen = plus ?? radios.find((radio) => radio.value === "-1")!;
  press(chosen);
  return chosen.value === "1" ? 1 : -1;
}

function continueButton(): HTMLButtonElement {
  return adjustmentDialog()!.querySelector<HTMLButtonElement>(".button-primary")!;
}

describe("S11 tumble, adjustment and stamps in GameApp", () => {
  it("lands one tumble on the saved raw roll, presents the adjustment only after it, then stamps before any movement frame", () => {
    openSaved(itemScenario("adjust", network));
    click("サイコロを振る");

    const pending = storedGame().pending;
    if (pending?.kind !== "roll") throw new Error("Expected the saved pending adjustment");
    expect(tumble()).toEqual({ stage: "tumble", raw: String(pending.rawRoll), stamps: [] });
    expect(adjustmentDialog()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    expect(status()).toBe("サイコロを振っています。移動の準備中です。");
    expect(document.activeElement?.closest(".turn-moment-host")).toBeNull();
    advance(TUMBLE_MS - 1);
    expect(adjustmentDialog()).toBeNull();
    expect(tumble()?.stage).toBe("tumble");

    advance(1);
    expect(tumble()).toBeNull();
    expect(adjustmentDialog()).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("出目を調整しますか？");
    expect(mounted!.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    const delta = chooseAdjustment();
    press(continueButton());

    // The resulting record attaches to the same attempt: stamps on the raw face, never a second tumble.
    expect(storedGame().pending).toBeNull();
    expect(tumble()).toEqual({ stage: "stamps", raw: String(pending.rawRoll), stamps: [delta > 0 ? "調整+1" : "調整-1"] });
    expect(frames()).toBe(0);
    advance(STAMPS_MS - 1);
    expect(frames()).toBe(0);
    advance(1);
    expect(tumble()).toBeNull();
    expect(mounted!.container.querySelector(".turn-moment-host")).toBeNull();
    expect(frames()).toBe(1);
    expect(dice().textContent).toBe("移動中…");
  });

  it.each([
    { point: "the tumble with the move staged", scenario: "route", before: () => {} },
    { point: "the movement", scenario: "route", before: () => advance(TUMBLE_MS) },
  ] as const)("ends tumble and movement with one Skip during $point", ({ scenario, before }) => {
    openSaved(itemScenario(scenario, network));
    click("サイコロを振る");
    before();
    const framesBefore = frames();
    press(panelSkip());

    expect(tumble()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    expect(dice().textContent).toBe("サイコロを振る");
    expect(frames()).toBe(framesBefore);
    expect(storedGame()).toMatchObject({ turn: itemScenario(scenario, network).turn + 1, pending: null });
  });

  it("keeps a Skip pressed during the tumble through the adjustment, which stays mandatory", () => {
    openSaved(itemScenario("adjust", network));
    click("サイコロを振る");
    press(panelSkip());

    // The tumble ends at once and the decision is presented; the rest of the turn is already skipped.
    expect(tumble()).toBeNull();
    expect(adjustmentDialog()).not.toBeNull();
    expect(dialogSkip().getAttribute("aria-disabled")).toBe("true");
    press(continueButton());
    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it("offers the same Skip inside the adjustment: the chosen radio and Continue stay, then nothing more plays", () => {
    openSaved(itemScenario("adjust", network));
    click("サイコロを振る");
    advance(TUMBLE_MS);
    const delta = chooseAdjustment();
    const label = continueButton().textContent;
    const skipButton = dialogSkip();
    expect(skipButton.getAttribute("aria-disabled")).toBe("false");
    skipButton.focus();
    press(skipButton);

    expect(adjustmentDialog()).not.toBeNull();
    expect(adjustmentDialog()!.querySelector<HTMLInputElement>(`input[value="${delta}"]`)!.checked).toBe(true);
    expect(continueButton().textContent).toBe(label);
    // Focusable but inert once the presentation is skipped; focus stays inside the dialog.
    expect(skipButton.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(skipButton);
    expect(storedGame().pending?.kind).toBe("roll");
    press(continueButton());

    expect(storedGame().pending).toBeNull();
    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it("ends the stamps and the staged movement with one Skip", () => {
    openSaved(itemScenario("adjust", network));
    click("サイコロを振る");
    advance(TUMBLE_MS);
    chooseAdjustment();
    press(continueButton());
    expect(tumble()?.stage).toBe("stamps");
    press(panelSkip());

    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it("ends the turn when the dice card is tapped, without moving focus", () => {
    openSaved(itemScenario("route", network));
    dice().focus();
    click("サイコロを振る");
    const card = mounted!.container.querySelector(".turn-moment-host__card")!;
    expect(card.closest("[aria-hidden='true']")).not.toBeNull();
    expect(card.querySelector("button, [tabindex], a, input")).toBeNull();
    press(card);

    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(document.activeElement).toBe(dice());
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it("keeps a Skip pressed before the save attempt until the accepted animation exists", () => {
    const sessions = saveBoundarySessions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const origin = plainOrigin();
    inject(origin); render(propsFor());
    click("サイコロを振る");
    expect(injection.app!.roll).toHaveBeenCalledTimes(1);
    inject(sessions.committing); render(propsFor());
    press(panelSkip());
    inject(sessions.resolving); render(propsFor());
    expect(injection.app!.finishAnimation).not.toHaveBeenCalled();
    inject(sessions.accepted); render(propsFor());

    expect(injection.app!.finishAnimation).toHaveBeenCalledExactlyOnceWith(sessions.accepted.animation);
    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    render(propsFor());
    expect(injection.app!.finishAnimation).toHaveBeenCalledTimes(1);
  });

  it("starts the accepted movement exactly once after the tumble when the save attempt failed", () => {
    const sessions = saveBoundarySessions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    inject(plainOrigin()); render(propsFor());
    click("サイコロを振る");
    inject(sessions.committing, true); render(propsFor());
    inject(sessions.resolving, true); render(propsFor());
    inject(sessions["save-attempted"], true); render(propsFor());

    expect(tumble()?.stage).toBe("tumble");
    expect(saveText()).toBe("セーブ: 保存に失敗しました（この進行は未保存です）");
    render(propsFor());
    advance(TUMBLE_MS - 1);
    expect(frames()).toBe(0);
    advance(1);
    expect(frames()).toBe(1);
    render(propsFor());
    expect(frames()).toBe(1);
    expect(tumble()).toBeNull();
  });
});

describe("S11 omission: reduced motion and restored rolls", () => {
  it("never tumbles under reduced motion: the adjustment is presented at once", () => {
    motionPreference(true);
    openSaved(itemScenario("adjust", network));
    click("サイコロを振る");
    expect(tumble()).toBeNull();
    expect(mounted!.container.querySelector(".turn-moment-host")).toBeNull();
    expect(adjustmentDialog()).not.toBeNull();
  });

  it("does not replay the tumble when reduced motion turns on while the save is pending and off again", () => {
    const setReduced = motionPreference(false);
    const sessions = saveBoundarySessions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    inject(plainOrigin()); render(propsFor());
    click("サイコロを振る");
    inject(sessions.committing); render(propsFor());
    setReduced(true);
    inject(sessions.resolving); render(propsFor());
    inject(sessions.accepted); render(propsFor());
    expect(tumble()).toBeNull();
    // Reduced motion finishes the accepted move at once, without a frame.
    expect(injection.app!.finishAnimation).toHaveBeenCalledWith(sessions.accepted.animation);
    expect(frames()).toBe(0);
    inject({ ...sessions.accepted, phase: "idle", animation: null }); render(propsFor());
    setReduced(false);
    advance(TUMBLE_MS + STAMPS_MS);
    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it.each([
    { point: "the tumble", setup: () => {} },
    { point: "the movement", setup: () => advance(TUMBLE_MS) },
  ] as const)("ends the turn when reduced motion turns on during $point and never replays it", ({ setup }) => {
    const setReduced = motionPreference(false);
    openSaved(itemScenario("route", network));
    click("サイコロを振る");
    setup();
    const framesBefore = frames();
    setReduced(true);
    expect(tumble()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    setReduced(false);
    advance(TUMBLE_MS + STAMPS_MS);
    expect(tumble()).toBeNull();
    expect(frames()).toBe(framesBefore);
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });
});

describe("S11 review round 2: reduced-motion latches and discard turns", () => {
  it("keeps the next tumble masked after reduced motion was toggled on and off while idle", () => {
    const setReduced = motionPreference(false);
    openSaved(itemScenario("adjust", network));
    setReduced(true);
    setReduced(false);
    click("サイコロを振る");

    expect(tumble()?.stage).toBe("tumble");
    expect(adjustmentDialog()).toBeNull();
    expect(status()).toBe("サイコロを振っています。移動の準備中です。");
    advance(TUMBLE_MS - 1);
    expect(adjustmentDialog()).toBeNull();
    expect(status()).toBe("サイコロを振っています。移動の準備中です。");
    advance(1);
    expect(adjustmentDialog()).not.toBeNull();
  });

  it("finishes the movement at once when reduced motion was toggled on and off with the adjustment open", () => {
    const setReduced = motionPreference(false);
    openSaved(itemScenario("adjust", network));
    click("サイコロを振る");
    advance(TUMBLE_MS);
    expect(adjustmentDialog()).not.toBeNull();
    setReduced(true);
    setReduced(false);
    press(continueButton());

    // No animated movement under published values: the move completed instantly, with one live region.
    expect(frames()).toBe(0);
    expect(tumble()).toBeNull();
    expect(dice().textContent).toBe("サイコロを振る");
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    expect(mounted!.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    advance(TUMBLE_MS + STAMPS_MS);
    expect(frames()).toBe(0);
  });

  it("finishes the accepted movement at once when reduced motion was toggled on and off before the save attempt", () => {
    const setReduced = motionPreference(false);
    const sessions = saveBoundarySessions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    inject(plainOrigin()); render(propsFor());
    click("サイコロを振る");
    inject(sessions.committing); render(propsFor());
    setReduced(true);
    setReduced(false);
    inject(sessions.resolving); render(propsFor());
    inject(sessions.accepted); render(propsFor());

    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(injection.app!.finishAnimation).toHaveBeenCalledExactlyOnceWith(sessions.accepted.animation);
    advance(TUMBLE_MS + STAMPS_MS);
    expect(frames()).toBe(0);
  });

  it("holds a discard turn's movement behind the tumble and finishes it with the latched Skip", () => {
    // The engine-built discard turn first asks for an adjustment (its full inventory holds a ticket).
    openSaved(itemScenario("discard", network));
    click("サイコロを振る");
    expect(storedGame().pending?.kind).toBe("roll");
    expect(tumble()?.stage).toBe("tumble");
    expect(frames()).toBe(0);
    press(panelSkip());
    expect(adjustmentDialog()).not.toBeNull();
    press(continueButton());

    // The pending discard animates under the prior engine turn; it still belongs to this attempt, so the latched
    // Skip finishes it without a frame and the discard decision is presented.
    const saved = storedGame();
    expect(saved.pending?.kind).toBe("discard");
    expect(tumble()).toBeNull();
    expect(frames()).toBe(0);
    expect(mounted!.container.querySelector(".item-discard")).not.toBeNull();
    expect(mounted!.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    advance(TUMBLE_MS + STAMPS_MS);
    expect(frames()).toBe(0);
    expect(storedGame()).toEqual(saved);
  });

  it("gates a discard turn's movement until its pre-move moment ends", () => {
    openSaved(itemScenario("discard", network));
    click("サイコロを振る");
    advance(TUMBLE_MS - 1);
    expect(frames()).toBe(0);
    advance(1);
    press(continueButton());
    expect(storedGame().pending?.kind).toBe("discard");
    // Declined adjustment, no modifier: no stamps, so the end of the tumble released the move (one frame) and the
    // discard decision waits for the movement.
    expect(tumble()).toBeNull();
    expect(frames()).toBe(1);
    expect(dice().textContent).toBe("移動中…");
    expect(mounted!.container.querySelector(".item-discard")).toBeNull();
    press(panelSkip());
    expect(mounted!.container.querySelector(".item-discard")).not.toBeNull();
  });
});

describe("S11 carry-over guards", () => {
  /** Props of the memoised GamePanel, read from its fiber: the exact callbacks GameApp hands down. */
  function panelProps(): { onEditItemDraft: (command: { items: never[] }) => void } {
    const element = mounted!.container.querySelector(".game-panel")!;
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"))!;
    let fiber = (element as unknown as Record<string, { return: unknown; memoizedProps: Record<string, unknown> } | null>)[key];
    while (fiber && typeof fiber.memoizedProps?.onEditItemDraft !== "function") {
      fiber = fiber.return as typeof fiber;
    }
    if (!fiber) throw new Error("GamePanel props not found");
    return fiber.memoizedProps as unknown as ReturnType<typeof panelProps>;
  }

  it("ignores a stale adjustment Continue once the presented decision is withdrawn", () => {
    const pending = beginItemTurn(itemScenario("adjust", network), { items: [] }, network).state;
    const session = reduceGameSession(resumeSession(pending, network, 31), { type: "item-save-attempted",
      ...itemActionIdentity(resumeSession(pending, network, 31)) }, ITEM_GAME_CONFIG, network);
    const attempt: RollAttempt = { ...attemptFor(resumeSession(itemScenario("adjust", network), network, 31)),
      stage: "awaiting-adjust", recordAccepted: false, adjustObserved: true, rawRoll: pending.pending?.kind === "roll" ? pending.pending.rawRoll : null };
    inject(session);
    render(propsFor({ attempt, revealStage: "waiting", restoredOrOmitted: false }));
    const staleContinue = reactOnClick(continueButton());
    render(propsFor({ attempt: { ...attempt, stage: "tumble" }, revealStage: "waiting", restoredOrOmitted: false }));
    expect(adjustmentDialog()).toBeNull();
    act(() => staleContinue());
    expect(injection.app!.adjustItemRoll).not.toHaveBeenCalled();
    render(propsFor({ attempt, revealStage: "waiting", restoredOrOmitted: false }));
    act(() => staleContinue());
    expect(injection.app!.adjustItemRoll).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("ignores a stale draft edit while the presentation locks item use", () => {
    const origin = resumeSession(itemScenario("double", network), network, 31);
    inject(origin); render(propsFor());
    const staleEdit = panelProps().onEditItemDraft;
    render(propsFor({ attempt: { ...attemptFor(origin), stage: "tumble" }, revealStage: "waiting", restoredOrOmitted: false }));
    act(() => staleEdit({ items: [] }));
    expect(injection.app!.editItemDraft).not.toHaveBeenCalled();
    render(propsFor());
    act(() => staleEdit({ items: [] }));
    expect(injection.app!.editItemDraft).toHaveBeenCalledExactlyOnceWith({ items: [] });
  });

  it("shows unique stamp labels exactly when the attempt requires stamps", () => {
    const records: ItemTurnRecord[] = [];
    for (const name of ["route", "rapid", "double", "discard", "certificate", "delay", "adjust", "oversleep", "deadhead", "direction"] as const) {
      const game = itemScenario(name, network);
      const ticket = (kind: string) => game.inventory.find((item) => item.kind === kind);
      const commands = [{}, ...(["double", "rapid", "deadhead"] as const).flatMap((kind) => ticket(kind)
        ? [{ command: { items: [{ kind, instanceId: ticket(kind)!.id }] } }] : [])];
      for (const options of commands) {
        const record = playItemTurn(game, options, network).record;
        if (record) records.push(record);
      }
      const adjusted = beginItemTurn(game, { items: [] }, network).state;
      const adjustTicket = adjusted.inventory.find((item) => item.kind === "roll-adjust");
      if (adjusted.pending?.kind === "roll" && adjustTicket) {
        for (const delta of [-1, 1] as const) {
          const raw = adjusted.pending.rawRoll + delta;
          if (raw < 1 || raw > 6) continue;
          const record = playItemTurn(game, { adjustment: { instanceId: adjustTicket.id, delta } }, network).record;
          if (record) records.push(record);
        }
      }
    }
    const rides = records.filter((record) => record.kind === "item-ride");
    const forcedDelayOnOne = rides.map((record) => ({ ...record, rawRoll: 1, effectiveFace: 1, itemEvents: [
      ...record.itemEvents, { type: "effect-activated" as const, effect: "delay" as const } as never] }));
    const all = [...records, ...forcedDelayOnOne];
    // The table spans plain rides, every modifier kind, deadhead and the delay-on-raw-1 case.
    expect(new Set(all.map((record) => record.kind === "item-ride" ? diceStampLabels(record).join("+") || "none" : "deadhead")))
      .toEqual(new Set(["none", "deadhead", "×2", "快速", "寝過ごし", "遅延", "調整+1", "調整-1", ...all
        .filter((record) => record.kind === "item-ride" && diceStampLabels(record).length > 1)
        .map((record) => diceStampLabels(record).join("+"))]));
    for (const record of all) {
      const labels = diceStampLabels(record);
      const facts = observeTurnFacts({ decision: null, record, movementEvents: [], targetServiceId: "jr-yamanote" });
      expect({ turn: record.turn, kind: record.kind, stamps: labels.length > 0 })
        .toEqual({ turn: record.turn, kind: record.kind, stamps: facts.stampsRequired });
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("S11 host helpers", () => {
  const VIEWPORT = { left: 0, top: 0, width: 1280, height: 800 };
  it.each([
    { name: "desktop strip right of the panel", rect: { left: 460, top: 0, width: 820, height: 800 },
      insets: { top: 56, right: 84, bottom: 56, left: 0 } },
    { name: "phone strip above the panel", rect: { left: 0, top: 0, width: 1280, height: 400 },
      insets: { top: 56, right: 84, bottom: 0, left: 56 } },
    { name: "inner rectangle touching no edge", rect: { left: 100, top: 100, width: 300, height: 300 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 } },
    // 152 wide on the right edge: only 40 px are spare above the 112 px minimum, so the 84 px inset shrinks to 40.
    { name: "narrow right strip shrinks to keep the minimum", rect: { left: 1128, top: 0, width: 152, height: 800 },
      insets: { top: 56, right: 40, bottom: 56, left: 0 } },
    { name: "strip at the minimum keeps no inset", rect: { left: 1168, top: 0, width: 112, height: 112 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 } },
  ])("pads the card region away from touched viewport edges: $name", ({ rect, insets }) => {
    expect(mapControlInsets(rect, VIEWPORT)).toEqual(insets);
  });

  it("selects the dice card only for live tumble/stamps stages, always on the saved raw roll", () => {
    const origin = resumeSession(itemScenario("route", network), network, 31);
    const base: RollAttempt = { ...attemptFor(origin), rawRoll: 4, recordTurn: 3 };
    const record = { ...origin.lastMove!.itemRecord!, turn: 3, rawRoll: 4 } as ItemTurnRecord;
    expect(turnMomentDiceModel({ ...base, stage: "tumble" }, null, false)).toEqual({
      stage: "tumble", rawRoll: 4, stampLabels: [], stageMs: 600, reducedMotion: false });
    expect(turnMomentDiceModel({ ...base, stage: "stamps" }, record, true)).toMatchObject({
      stage: "stamps", rawRoll: 4, stageMs: 240, reducedMotion: true });
    // A record from another turn never lends its stamps.
    expect(turnMomentDiceModel({ ...base, stage: "stamps" }, { ...record, turn: 2 }, false)?.stampLabels).toEqual([]);
    for (const stage of ["waiting-roll", "awaiting-adjust", "waiting-record", "released"] as const) {
      expect(turnMomentDiceModel({ ...base, stage }, record, false)).toBeNull();
    }
    expect(turnMomentDiceModel({ ...base, stage: "tumble", motionOmitted: true }, record, false)).toBeNull();
    expect(turnMomentDiceModel({ ...base, stage: "tumble", skipRequested: true }, record, false)).toBeNull();
    expect(turnMomentDiceModel({ ...base, stage: "tumble", rawRoll: null }, record, false)).toBeNull();
    expect(turnMomentDiceModel(null, record, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S12 activation: the arrival banner after the movement and the delayed goal.
// Real GameApp + useGameApp + storage; animation frames are queued and run by hand.
// ---------------------------------------------------------------------------

/** Arrival stage at normal speed, written down from the specification. */
const ARRIVAL_MS = 800;
const queuedFrames: FrameRequestCallback[] = [];

/** `openSaved`, with animation frames queued so a test can finish the movement naturally. */
function openWithFrames(game: ItemGameState): void {
  openSaved(game);
  queuedFrames.length = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => queuedFrames.push(callback)));
}

/** Run the queued movement frames: the first one starts the clock, the next one is far past the 6,000 ms cap. */
function finishMovement(): void {
  let now = 1_000;
  for (let guard = 0; queuedFrames.length > 0; guard += 1) {
    if (guard > 10) throw new Error("The movement did not finish");
    const callback = queuedFrames.shift()!;
    act(() => callback(now));
    now += 100_000;
  }
}

function banner(): string | null {
  const element = mounted!.container.querySelector(".arrival-banner");
  if (!element) return null;
  expect(element.closest(".turn-moment-host[aria-hidden='true']")).not.toBeNull();
  expect(element.closest(".turn-moment-host")!.querySelector("button, [tabindex], a, input")).toBeNull();
  return element.querySelector(".arrival-banner__station")?.textContent ?? null;
}

function rideStat(): string | null {
  return mounted!.container.querySelector('[data-stat="ride"]')?.textContent ?? null;
}

function gameClearEvents(): unknown[][] {
  return trackEvent.mock.calls.filter(([name]) => name === "game_clear");
}

/** Click the dice, run the tumble (declining an adjustment if one is offered) and finish the movement. */
function playToArrival(): void {
  click("サイコロを振る");
  advance(TUMBLE_MS);
  if (adjustmentDialog()) press(continueButton());
  finishMovement();
}

describe("S12 arrival banner in GameApp", () => {
  it("shows the arrival after the movement, holds the next ride, then publishes when the arrival ends", () => {
    openWithFrames(itemScenario("route", network));
    const origin = storedGame();
    click("サイコロを振る");
    expect(status()).toBe("サイコロを振っています。移動の準備中です。");
    advance(TUMBLE_MS);
    const record = storedGame().movementHistory.at(-1)!;
    // The engine-built turn: raw 4, two stations to the area end (two pips unused), a forced reversal, a pickup.
    expect(record).toMatchObject({ turn: 3, kind: "item-ride", rawRoll: 4, physicalHops: 2, unusedPips: 2,
      toStationId: "fixture-omori", resolvedRide: { serviceId: "fixture-south", direction: 1 },
      landing: { serviceId: "fixture-south", direction: -1 }, itemEvents: [{ type: "pickup-retained", item: { kind: "rapid" } }] });
    // Movement copy: the raw face only (no stamps on this turn), never the hops, unused pips or the landing.
    expect(status()).toBe("出目は4です。移動中です。スキップできます。");
    expect(banner()).toBeNull();
    finishMovement();

    expect(banner()).toBe("大森");
    expect(mounted!.container.querySelector('[data-stat="station"]')?.textContent).toBe("大森");
    // The ridden service and direction stay on the HUD and the map until the arrival publishes the next ride.
    expect(rideStat()).toBe("テスト南線");
    expect(mounted!.container.querySelector('[data-stat="direction"]')?.textContent).toBe(directionLabel(network, "fixture-south", 1));
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress.highlightedServiceId).toBe("fixture-south");
    expect(railwayMapProps.mock.calls.at(-1)?.[0].progress.currentPosition)
      .toEqual(network.servicesById.get("fixture-south")!.platformCoordinates["fixture-omori"]);
    expect([...mounted!.container.querySelectorAll(".item-slot h3")].map((slot) => slot.textContent)).not.toContain("快速券");
    expect(dice().textContent).toBe("サイコロを振る");
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    expect(panelSkip().disabled).toBe(false);
    expect(status()).toBe("3ターン目：大森に到着。踏破 4/30");
    advance(ARRIVAL_MS - 1);
    expect(banner()).toBe("大森");
    expect(status()).toBe("3ターン目：大森に到着。踏破 4/30");

    advance(1);
    expect(banner()).toBeNull();
    expect(mounted!.container.querySelector(".turn-moment-host")).toBeNull();
    expect(mounted!.container.querySelector('[data-stat="direction"]')?.textContent).toBe(directionLabel(network, "fixture-south", -1));
    expect([...mounted!.container.querySelectorAll(".item-slot h3")].map((slot) => slot.textContent)).toContain("快速券");
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    expect(status()).toBe("3ターン目：出目4（4マス、2駅移動、残り2は使わず）、大森に到着。テスト南線のみ ／ エリア端のため折り返し（品川方面）。"
      + "踏破 4/30。快速券を拾いました。2路線以上が止まる駅だけを1駅と数えて進む。サイコロを振れます");
    expect(storedGame().movementHistory).toHaveLength(origin.movementHistory.length + 1);
  });

  it.each([
    { via: "the panel Skip", end: () => press(panelSkip()) },
    { via: "a tap on the banner card", end: () => press(mounted!.container.querySelector(".turn-moment-host__card")!) },
  ])("completes the arrival at once with $via, keeping focus on the dice, and never replays it", ({ end }) => {
    openWithFrames(itemScenario("route", network));
    dice().focus();
    playToArrival();
    expect(banner()).not.toBeNull();
    end();

    expect(banner()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    expect(document.activeElement).toBe(dice());
    expect(rideStat()).toBe(serviceName(network, storedGame().currentServiceId));
    advance(ARRIVAL_MS);
    expect(banner()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it("mounts no banner under reduced motion", () => {
    motionPreference(true);
    openWithFrames(itemScenario("route", network));
    click("サイコロを振る");
    if (adjustmentDialog()) press(continueButton());
    expect(banner()).toBeNull();
    expect(mounted!.container.querySelector(".turn-moment-host")).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    advance(TUMBLE_MS + ARRIVAL_MS);
    expect(banner()).toBeNull();
    expect(queuedFrames).toHaveLength(0);
  });

  it("mounts no banner for a restored record, and a reload during the arrival does not replay it", () => {
    openWithFrames(itemScenario("route", network));
    advance(ARRIVAL_MS);
    expect(banner()).toBeNull();
    playToArrival();
    expect(banner()).not.toBeNull();
    const saved = storedGame();

    // Reload: a fresh mount resumes the saved arrival.
    mounted!.cleanup();
    mounted = undefined;
    render(propsFor());
    click("つづきから");
    expect(banner()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    advance(ARRIVAL_MS);
    expect(banner()).toBeNull();
    expect(storedGame()).toEqual(saved);
  });
});

describe("S12 arrival omission: reduced motion before, during and across turns", () => {
  it.each([
    { point: "the tumble", toggle: (setReduced: (reduce: boolean) => void) => { setReduced(true); setReduced(false); },
      afterToggle: () => { advance(TUMBLE_MS); finishMovement(); } },
    { point: "the movement", toggle: (setReduced: (reduce: boolean) => void) => { setReduced(true); setReduced(false); },
      before: () => advance(TUMBLE_MS), afterToggle: () => finishMovement() },
  ])("omits the arrival when reduced motion was toggled on and off during $point", ({ toggle, before, afterToggle }) => {
    const setReduced = motionPreference(false);
    openWithFrames(itemScenario("route", network));
    click("サイコロを振る");
    before?.();
    toggle(setReduced);
    afterToggle();
    expect(banner()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    advance(ARRIVAL_MS);
    expect(banner()).toBeNull();
  });

  it("ends the arrival when reduced motion turns on during it, does not replay it when turned off, and plays the next turn's arrival in full", () => {
    const setReduced = motionPreference(false);
    openWithFrames(itemScenario("route", network));
    playToArrival();
    expect(banner()).not.toBeNull();
    setReduced(true);
    expect(banner()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    const published = status();
    expect(published).toMatch(/。サイコロを振れます$/);
    setReduced(false);
    expect(banner()).toBeNull();
    advance(ARRIVAL_MS);
    expect(banner()).toBeNull();
    expect(status()).toBe(published);

    // Next turn: no latch leaks from the omitted arrival.
    const turnBefore = storedGame().turn;
    playToArrival();
    expect(storedGame().turn).toBe(turnBefore + 1);
    const next = storedGame().movementHistory.at(-1)!;
    expect(banner()).toBe(stationName(network, next.toStationId));
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    advance(ARRIVAL_MS - 1);
    expect(banner()).not.toBeNull();
    advance(1);
    expect(banner()).toBeNull();
    finishLotteryIfPresented();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });

  it("plays the next turn's arrival in full after a Skip ended the previous one", () => {
    openWithFrames(itemScenario("route", network));
    playToArrival();
    press(panelSkip());
    expect(banner()).toBeNull();
    playToArrival();
    expect(banner()).not.toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    advance(ARRIVAL_MS - 1);
    expect(banner()).not.toBeNull();
    advance(1);
    expect(banner()).toBeNull();
    finishLotteryIfPresented();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
  });
});

describe("S12 delayed goal presentation", () => {
  /** The item game one turn before its goal (the same seed as the empty-event goal test above). */
  function beforeGoal(): ItemGameState {
    let game = createItemGame(ITEM_GAME_CONFIG, "00000000000000000000000000000004", network);
    let previous = game;
    while (game.status === "playing" && game.turn < 500) {
      previous = game;
      game = playItemTurn(game, {}, network).state;
      if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
    }
    expect(game.status).toBe("completed");
    return previous;
  }

  function clearHeading(): HTMLElement | null {
    return mounted!.container.querySelector<HTMLElement>("#clear-title");
  }

  function mapInert(): boolean | undefined {
    return (railwayMapProps.mock.calls.at(-1)?.[0] as { inert?: boolean }).inert;
  }

  it("shows the goal banner on the panel first; ClearScreen, its focus, map inertness and game_clear follow together", () => {
    openWithFrames(beforeGoal());
    dice().focus();
    playToArrival();
    expect(storedGame().status).toBe("completed");

    // Goal banner: the engine is complete, but the panel stays with locked dice and an available Skip.
    expect(banner()).toBe("新橋");
    expect(clearHeading()).toBeNull();
    expect(mounted!.container.querySelector(".clear-screen")).toBeNull();
    expect(mounted!.container.querySelector(".game-panel")).not.toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    expect(panelSkip().disabled).toBe(false);
    expect(document.activeElement).toBe(dice());
    expect(mapInert()).toBe(false);
    expect(gameClearEvents()).toEqual([]);
    // One live region, with the arrival only: the goal sentence belongs to ClearScreen.
    expect(status()).toBe("10ターン目：新橋に到着。踏破 30/30");
    advance(ARRIVAL_MS - 1);
    expect(clearHeading()).toBeNull();
    expect(gameClearEvents()).toEqual([]);
    expect(mapInert()).toBe(false);

    advance(1);
    expect(banner()).toBeNull();
    expect(mounted!.container.querySelector(".game-panel")).toBeNull();
    expect(clearHeading()).not.toBeNull();
    expect(document.activeElement).toBe(clearHeading());
    expect(mapInert()).toBe(true);
    expect(gameClearEvents()).toHaveLength(1);
    const notices = mounted!.container.querySelectorAll(".item-event-notice [role=status]");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.textContent).toContain("ゴールに到着しました");
    advance(ARRIVAL_MS);
    expect(gameClearEvents()).toHaveLength(1);
  });

  it("lets Skip end the goal banner before ClearScreen takes focus", () => {
    openWithFrames(beforeGoal());
    playToArrival();
    expect(banner()).toBe("新橋");
    expect(clearHeading()).toBeNull();
    press(panelSkip());

    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(clearHeading());
    expect(mapInert()).toBe(true);
    expect(gameClearEvents()).toHaveLength(1);
  });

  it("shows ClearScreen at once under reduced motion, with no goal banner", () => {
    motionPreference(true);
    openWithFrames(beforeGoal());
    click("サイコロを振る");
    if (adjustmentDialog()) press(continueButton());
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(clearHeading());
    expect(gameClearEvents()).toHaveLength(1);
  });
});

function finishLotteryIfPresented(): void {
  if (mounted!.container.querySelector('.lottery-reveal[data-stage="lottery-flip"]')) advance(1_600);
  if (mounted!.container.querySelector('.lottery-reveal[data-stage="lottery-settle"]')) advance(400);
}

function lotteryStage(): string | null {
  return mounted!.container.querySelector(".lottery-reveal")?.getAttribute("data-stage") ?? null;
}

describe("S14 lottery publication lifecycle", () => {
  it("holds all consumers through flip and settle, then publishes once at the captured deadline", () => {
    openWithFrames(createItemGame(edition.config, FIXTURE_GAME_SEED, network));
    playToArrival();
    const record = storedGame().movementHistory.at(-1)!;
    expect(record.landingSnapshot!.services.length).toBeGreaterThan(1);
    const oldRide = rideStat();
    const oldPosition = railwayMapProps.mock.calls.at(-1)![0].progress.currentPosition;
    const oldHighlight = railwayMapProps.mock.calls.at(-1)![0].progress.highlightedServiceId;
    const arrivalCopy = status();
    advance(800);
    expect(lotteryStage()).toBe("lottery-flip");
    const start = lotteryCommits.length;
    click("メニュー");
    click("速度: ふつう");
    advance(1_599);
    expect(lotteryStage()).toBe("lottery-flip");
    advance(1);
    expect(lotteryStage()).toBe("lottery-settle");
    advance(399);
    expect(rideStat()).toBe(oldRide);
    expect(railwayMapProps.mock.calls.at(-1)![0].progress.currentPosition).toEqual(oldPosition);
    expect(railwayMapProps.mock.calls.at(-1)![0].progress.highlightedServiceId).toBe(oldHighlight);
    expect(mounted!.container.querySelector(".item-event-notice")).toBeNull();
    expect(status()).toBe(arrivalCopy);
    expect(dice().getAttribute("aria-disabled")).toBe("true");
    advance(1);
    expect(lotteryStage()).toBeNull();
    expect(rideStat()).toBe(serviceName(network, record.landing!.serviceId));
    expect(railwayMapProps.mock.calls.at(-1)![0].progress.currentPosition)
      .toEqual(network.servicesById.get(record.landing!.serviceId)!.platformCoordinates[record.toStationId]);
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    expect(status()).toMatch(/。サイコロを振れます$/);
    expect(lotteryCommits.slice(start).filter((copy, index, values) => index === 0 || copy !== values[index - 1]))
      .toEqual([arrivalCopy, status()]);
  });

  it.each(["lottery-flip", "lottery-settle"] as const)("omits %s on reduced motion without replay", (stage) => {
    const setReduced = motionPreference(false);
    openWithFrames(createItemGame(edition.config, FIXTURE_GAME_SEED, network));
    playToArrival(); advance(800);
    if (stage === "lottery-settle") advance(1_600);
    expect(lotteryStage()).toBe(stage);
    setReduced(true);
    expect(lotteryStage()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    const copy = status();
    setReduced(false); advance(3_000);
    expect(lotteryStage()).toBeNull();
    expect(status()).toBe(copy);
  });

  it.each(["lottery-flip", "lottery-settle"] as const)("one Skip completes %s with no replay", (stage) => {
    openWithFrames(createItemGame(edition.config, FIXTURE_GAME_SEED, network));
    playToArrival(); advance(800);
    if (stage === "lottery-settle") advance(1_600);
    expect(lotteryStage()).toBe(stage);
    const saved = storedGame();
    press(panelSkip());
    expect(lotteryStage()).toBeNull();
    expect(dice().getAttribute("aria-disabled")).toBe("false");
    advance(3_000);
    expect(lotteryStage()).toBeNull();
    expect(storedGame()).toEqual(saved);
  });
});

it("S14 resolving a restored adjustment plays its newly created lottery normally", () => {
  // This legitimate save holds an adjustment ticket before its next direction draw.
  const pending = beginItemTurn(itemScenario("deadhead", network), { items: [] }, network).state;
  expect(pending.pending?.kind).toBe("roll");
  openWithFrames(pending);
  expect(adjustmentDialog()).not.toBeNull();
  expect(tumble()).toBeNull();
  press(continueButton());
  expect(tumble()).toBeNull();
  finishMovement();
  expect(banner()).toBe(stationName(network, storedGame().currentStationId));
  advance(800);
  expect(lotteryStage()).toBe("lottery-flip");
  advance(1_600);
  expect(lotteryStage()).toBe("lottery-settle");
  advance(400);
  expect(lotteryStage()).toBeNull();
  expect(dice().getAttribute("aria-disabled")).toBe("false");
});
