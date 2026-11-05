// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GameApp } from "../../src/app/GameApp";
import { loadRailwayData } from "../../src/data/loaders";
import { EDITIONS } from "../../src/features/editions/registry";
import { createItemGame, playItemTurn, resolveItemDiscard, serializeGame } from "../../src/features/game/engine";
import { itemSessionView, itemLastMove } from "../../src/features/game/itemSession";
import { networkFromData } from "../../src/features/game/networkFromData";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { serviceName, stationName } from "../../src/features/game/presentation";
import { dispatchReactEvent, mountReact, type MountedReact } from "./helpers/reactDom";
import { itemScenario } from "../e2e/fixtures/itemScenarios";

import { resumeSession, startSession, reduceGameSession, type GameSession } from "../../src/features/game/gameSession";
import type { RollAttempt } from "../../src/features/game/animation/turnMoments";
import type { useGameApp } from "../../src/features/game/useGameApp";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";
import { LEGACY_FIXTURE_GAME_SEED } from "../e2e/fixtures/seeds";

const { railwayMapProps, injection, commits } = vi.hoisted(() => ({
  railwayMapProps: vi.fn(), injection: { app: null as ReturnType<typeof useGameApp> | null }, commits: [] as string[],
}));
vi.mock("../../src/features/game/useGameApp", async (original) => {
  const actual = await original<typeof import("../../src/features/game/useGameApp")>();
  return { useGameApp: (...args: Parameters<typeof useGameApp>) => {
    const app = actual.useGameApp(...args);
    return injection.app ?? app;
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
  commits.length = 0;
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
    expect(status()).toBe("5ターン目：巣鴨に到着。踏破 18/30。抽選結果を表示しています");
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
      "5ターン目：巣鴨に到着。踏破 18/30。抽選結果を表示しています",
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
    expect(status()).toBe("10ターン目：新橋に到着。ゴールに到着しました。踏破 30/30。抽選結果を表示しています");
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
