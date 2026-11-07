import { describe, expect, it } from "vitest";
import { beginItemTurn, createItemGame, finishItemTurn, playItemTurn, resolveItemDiscard } from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import { sessionProgress, displayedProgress } from "../../src/features/game/animation/displayedProgress";
import type { RollAttempt, PreMoveStage } from "../../src/features/game/animation/turnMoments";
import { reduceGameSession, resumeSession, type GameAction, type GameSession } from "../../src/features/game/gameSession";
import { itemActionIdentity, itemSessionView } from "../../src/features/game/itemSession";
import { turnMomentAnnouncement } from "../../src/features/game/presentation";
import { deriveTurnMomentDisplay, type TurnMomentDisplay, type TurnRevealState } from "../../src/features/game/turnMomentPresentation";
import { createPresentationResolver } from "../../src/features/game/presentationResolver";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";

const { network } = await loadBundle("fixture");
const presentation = createPresentationResolver(network);
const TIMING = { stepMs: 450, tumbleMs: 600, stampsMs: 240, arrivalMs: 800,
  lotteryFlipMs: 1600, lotterySettleMs: 400, pickupMs: 500 } as const;

function releasedAttempt(
  session: ReturnType<typeof resumeSession>, snapshot: NonNullable<ReturnType<typeof itemSessionView>>,
  stage: PreMoveStage = "released",
): RollAttempt {
  return { key: `${session.sessionId}:roll:${snapshot.identity.turn + 1}:0`, sessionId: session.sessionId,
    recordTurn: snapshot.identity.turn + 1, source: "click", origin: { stationId: snapshot.position.currentStationId,
      ride: { serviceId: snapshot.position.currentServiceId, direction: snapshot.position.direction },
      completedSegmentIds: session.game.completedSegmentIds, turn: snapshot.identity.turn, itemView: snapshot,
      previousLastMove: session.lastMove }, timing: TIMING, stage, rawRoll: 4, tumbleCompleted: true,
    skipRequested: false, motionOmitted: false, adjustObserved: false, recordAccepted: true, stampsRequired: true,
    newlyCompletedTargetSegmentIds: [] };
}

function display(
  session: ReturnType<typeof resumeSession>, view: NonNullable<ReturnType<typeof itemSessionView>>,
  attempt: RollAttempt, revealStage: TurnRevealState,
  restoredOrOmitted = false,
): TurnMomentDisplay {
  return deriveTurnMomentDisplay({ session, itemView: view, network, presentation,
    progress: displayedProgress(sessionProgress(session), network, null), attempt, revealStage, restoredOrOmitted });
}

function transition(session: GameSession, action: GameAction): GameSession {
  return reduceGameSession(session, action, session.game.config, network);
}

describe("turn moment item publication", () => {
  it("keeps consumed inventory during stamps and removes it only after release", () => {
    const base = itemScenario("adjust", network);
    const started = beginItemTurn(base, { items: [] }, network).state;
    const consumed = finishItemTurn(started, { instanceId: "item-7", delta: 1 }, network).state;
    const origin = resumeSession(base, network, 61);
    const originView = itemSessionView(origin, network)!;
    const committed = resumeSession(consumed, network, 61);
    expect(committed.lastMove?.itemRecord?.itemEvents.map((event) => event.type)).toEqual(["consumed", "harmful-scheduled"]);
    const liveView = itemSessionView(committed, network)!;
    const during = display(committed, liveView, releasedAttempt(origin, originView, "stamps"), "arrival");
    expect(during.itemView?.inventory.map((item) => item.id)).toEqual(["item-1", "item-7"]);
    expect(during.itemView?.usableItems.map((item) => item.instanceId)).toEqual(["item-1", "item-7"]);
    const after = display(committed, liveView, releasedAttempt(origin, originView, "released"), "arrival");
    expect(after.itemView?.inventory.map((item) => item.id)).toEqual(["item-1"]);
    expect(after.itemView?.usableItems.map((item) => item.instanceId)).toEqual(["item-1"]);
  });

  it("keeps a certificate during arrival and publishes its cancellation at the result boundary", () => {
    const base = itemScenario("certificate", network);
    const origin = resumeSession(base, network, 62);
    const originView = itemSessionView(origin, network)!;
    const resultState = playItemTurn(base, {}, network).state;
    const resultSession = resumeSession(resultState, network, 62);
    const liveView = itemSessionView(resultSession, network)!;
    const attempt = releasedAttempt(origin, originView);
    const before = display(resultSession, liveView, attempt, "arrival");
    expect(before.itemView?.inventory.map((item) => item.id)).toEqual(["item-3", "item-4", "item-5"]);
    expect(before.toastInputs).toEqual([]);
    const after = display(resultSession, liveView, attempt, "done");
    expect(after.itemView?.inventory.map((item) => item.id)).toEqual(["item-4", "item-5"]);
    expect(after.toastInputs[0]?.text).toBe("遅延証明書で寝過ごしを打ち消した");
    expect(after.toastInputs[0]?.itemKind).toBe("delay-certificate");
  });

  it("masks arrival effects until completion, including a stale prior reveal completion", () => {
    const base = itemScenario("delay", network);
    const origin = resumeSession(base, network, 63);
    const originView = itemSessionView(origin, network)!;
    const resultSession = resumeSession(playItemTurn(base, {}, network).state, network, 63);
    const liveView = itemSessionView(resultSession, network)!;
    const attempt = releasedAttempt(origin, originView);
    const before = display(resultSession, liveView, attempt, "arrival");
    expect(before.itemView?.effects.delayDueTurns).toEqual([]);
    expect(before.itemView?.hints.suspensionIgnored).toBe(false);
    expect(before.itemView?.usableItems[0]?.reason).toBe("no-route-choice");
    expect(before.decision).toBeNull();
    expect(before.effectModels).toEqual([]);
    const staleDone = display(resultSession, liveView, releasedAttempt(origin, originView, "tumble"), "done");
    expect(staleDone.itemView?.effects.delayDueTurns).toEqual([]);
    expect(staleDone.toastInputs).toEqual([]);
    expect(staleDone.showItemNotice).toBe(false);
    const after = display(resultSession, liveView, attempt, "done");
    expect(after.itemView?.effects.delayDueTurns).toEqual([8]);
    expect(after.itemView?.hints.suspensionIgnored).toBe(false);
    expect(after.itemView?.usableItems[0]?.reason).toBe("no-route-choice");
    expect(after.effectModels.map((effect) => effect.label)).toEqual(["遅延 あと3"]);
  });

  it("holds changing route hints and availability until pickup completes", () => {
    const base = itemScenario("route", network);
    const origin = resumeSession(base, network, 73);
    const snapshot = itemSessionView(origin, network)!;
    const session = resumeSession(playItemTurn(base, {}, network).state, network, 73);
    const live = itemSessionView(session, network)!;
    const attempt = releasedAttempt(origin, snapshot);
    const arrival = display(session, live, attempt, "arrival");
    expect(arrival.ride).toEqual({ serviceId: "fixture-south", direction: 1 });
    const pickup = display(session, live, attempt, "pickup");
    expect(pickup.ride).toEqual({ serviceId: "fixture-south", direction: -1 });
    expect(pickup.lotteryText).toBe("テスト南線のみ ／ エリア端のため折り返し（品川方面）");
    expect(pickup.candidateRows).toEqual([]);
    expect(pickup.progress.position).toEqual([139.728, 35.5885]);
    expect(live.hints.routes.map((route) => route.serviceId)).toEqual(["fixture-south"]);
    expect(live.usableItems[0]).toMatchObject({ instanceId: "item-1", usable: false, reason: "no-route-choice" });
    for (const stage of ["arrival", "pickup"] as const) {
      const masked = display(session, live, attempt, stage);
      expect(masked.itemView?.hints.routes.map((route) => route.serviceId)).toEqual(["jr-yamanote", "fixture-south"]);
      expect(masked.itemView?.hints.direction).toEqual({ directions: [
        { direction: 1, nextStationId: "fixture-oimachi", targetHops: 1 },
      ], closerDirection: 1 });
      expect(masked.itemView?.hints.rapidHeadsTowardYamanote).toBe(false);
      expect(masked.itemView?.hints.deadheadRecommended).toBe(false);
      expect(masked.itemView?.usableItems).toEqual([
        { instanceId: "item-1", kind: "route-ticket", usable: true, reason: null, selected: false, recommended: true },
      ]);
    }
    const published = display(session, live, attempt, "done");
    expect(published.itemView?.hints.routes.map((route) => route.serviceId)).toEqual(["fixture-south"]);
    expect(published.itemView?.hints.direction).toEqual({ directions: [
      { direction: -1, nextStationId: "fixture-oimachi", targetHops: 1 },
    ], closerDirection: -1 });
    expect(published.itemView?.hints.rapidHeadsTowardYamanote).toBe(true);
    expect(published.itemView?.hints.deadheadRecommended).toBe(true);
    expect(published.itemView?.usableItems).toEqual([
      { instanceId: "item-1", kind: "route-ticket", usable: false, reason: "no-route-choice", selected: false, recommended: true },
      { instanceId: "item-3", kind: "rapid", usable: true, reason: null, selected: false, recommended: true },
    ]);
  });

  it("publishes a transfer ride, lottery, candidates, and platform together while keeping pickup masked", () => {
    let base = createItemGame(ITEM_GAME_CONFIG, "00000000000000000000000000000006", network);
    while (base.turn < 4) base = playItemTurn(base, {}, network).state;
    const origin = resumeSession(base, network, 74);
    const session = resumeSession(playItemTurn(base, {}, network).state, network, 74);
    expect(session.lastMove?.itemRecord?.itemEvents).toEqual([
      { type: "pickup-retained", item: { id: "item-5", kind: "roll-adjust" } },
    ]);
    const live = itemSessionView(session, network)!;
    const attempt = releasedAttempt(origin, itemSessionView(origin, network)!);
    const settling = display(session, live, attempt, "lottery-settle");
    expect(settling.ride).toEqual({ serviceId: "fixture-west", direction: -1 });
    expect(settling.progress.stationId).toBe("shinjuku");
    expect(settling.progress.position).toEqual([139.70314, 35.690465]);
    expect(settling.candidateRows).toEqual([]);
    expect(settling.lotteryText).toBe("テスト西線のみ ／ エリア端のため折り返し（新宿方面）");
    expect(settling.announcement).toBe("5ターン目：新宿に到着。踏破 12/30。抽選結果を表示しています");
    for (const stage of ["pickup", "done"] as const) {
      const result = display(session, live, attempt, stage);
      expect(result.ride).toEqual({ serviceId: "jr-yamanote", direction: 1 });
      expect(result.progress.stationId).toBe("shinjuku");
      expect(result.progress.position).toEqual([139.70014, 35.690465]);
      expect(result.lotteryText).toBe("新宿：山手線・テスト西線から抽選 → 山手線 ／ 外回りに固定");
      expect(result.candidateRows.map((row) => row.label)).toEqual(["山手線", "テスト西線"]);
    }
    const pickup = display(session, live, attempt, "pickup");
    expect(pickup.itemView?.inventory).toEqual([]);
    expect(pickup.toastInputs).toEqual([]);
    expect(pickup.announcement).toBe("新宿：山手線・テスト西線から抽選 → 山手線 ／ 外回りに固定");
    const done = display(session, live, attempt, "done");
    expect(done.itemView?.inventory).toEqual([{ id: "item-5", kind: "roll-adjust" }]);
  });

  it("publishes a plain turn's full completion announcement without a pickup stage", () => {
    const base = itemScenario("double", network);
    const origin = resumeSession(base, network, 75);
    const session = resumeSession(playItemTurn(base, {}, network).state, network, 75);
    const attempt = releasedAttempt(origin, itemSessionView(origin, network)!);
    const done = display(session, itemSessionView(session, network)!, attempt, "done");
    expect(done.announcement).toBe("6ターン目：出目1（1マス、1駅移動）、駒込に到着。山手線のみ ／ 外回りに固定。踏破 19/30。サイコロを振れます");
    expect(done.toastInputs).toEqual([]);
    expect(done.showItemNotice).toBe(false);
  });

  it("publishes a retained pickup, notice, toast, and exact ready announcement when pickup completes", () => {
    const base = itemScenario("rapid-long", network);
    const origin = resumeSession(base, network, 64);
    const originView = itemSessionView(origin, network)!;
    const resultSession = resumeSession(playItemTurn(base, {}, network).state, network, 64);
    const liveView = itemSessionView(resultSession, network)!;
    const attempt = releasedAttempt(origin, originView);
    const during = display(resultSession, liveView, attempt, "pickup");
    expect(during.itemView?.inventory.map((item) => item.id)).toEqual(["item-2", "item-7"]);
    expect(during.toastInputs).toEqual([]);
    expect(during.showItemNotice).toBe(false);
    expect(during.announcement).toBe("山手線のみ ／ 外回りに固定");
    const after = display(resultSession, liveView, attempt, "done");
    expect(after.itemView?.inventory.map((item) => item.id)).toEqual(["item-2", "item-7", "item-8"]);
    expect(after.toastInputs.map((toast) => toast.text)).toEqual(["遅延証明書を手に入れた！"]);
    expect(after.showItemNotice).toBe(true);
    expect(after.announcement).toBe("8ターン目：出目5（5マス、5駅移動）、日暮里に到着。山手線のみ ／ 外回りに固定。踏破 22/30。遅延証明書を拾いました。持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）。サイコロを振れます");
    expect(after.canRoll).toBe(true);
    expect(after.canSkip).toBe(false);
    expect(after.itemUseLocked).toBe(false);
  });

  it("publishes full-inventory discard choice only after pickup completes", () => {
    const base = itemScenario("discard", network);
    const origin = resumeSession(base, network, 65);
    const originView = itemSessionView(origin, network)!;
    const resultSession = resumeSession(playItemTurn(base, {}, network).state, network, 65);
    const liveView = itemSessionView(resultSession, network)!;
    const attempt = releasedAttempt(origin, originView);
    const during = display(resultSession, liveView, attempt, "pickup");
    expect(during.decision).toBeNull();
    expect(during.toastInputs).toEqual([]);
    expect(during.announcement).toBe("山手線のみ ／ 外回りに固定");
    const after = display(resultSession, liveView, attempt, "done");
    expect(after.decision?.kind).toBe("discard");
    if (after.decision?.kind !== "discard") throw new Error("Expected engine discard decision");
    expect(after.decision.candidates.map((item) => item.id)).toEqual(["item-3", "item-4", "item-5", "item-7"]);
    expect(after.announcement).toBe("7ターン目：出目2（2マス、2駅移動）、西日暮里に到着。山手線のみ ／ 外回りに固定。踏破 21/30。遅延証明書を拾いました。持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）。捨てるアイテムを1つ選んでください");
    expect(after.canRoll).toBe(false);
    expect(after.canSkip).toBe(false);
  });

  it("adds discard notices on the same turn without changing the publication stage", () => {
    const base = itemScenario("discard", network);
    const origin = resumeSession(base, network, 72);
    const originView = itemSessionView(origin, network)!;
    const pending = playItemTurn(base, {}, network).state;
    if (pending.pending?.kind !== "discard") throw new Error("Expected engine pending discard");
    const resolved = resolveItemDiscard(pending, pending.pending.candidates[0]!.id).state;
    const beforeSession = resumeSession(pending, network, 72);
    const afterSession = resumeSession(resolved, network, 72);
    const attempt = releasedAttempt(origin, originView);
    const before = display(beforeSession, itemSessionView(beforeSession, network)!, attempt, "done");
    const after = display(afterSession, itemSessionView(afterSession, network)!, attempt, "done");
    expect(before.phase).toBe("published");
    expect(after.phase).toBe("published");
    expect(before.turn).toBe(7);
    expect(after.turn).toBe(7);
    expect(before.toastInputs.map((toast) => toast.text)).toEqual(["遅延証明書を手に入れた！"]);
    expect(after.toastInputs.map((toast) => toast.text)).toEqual(["遅延証明書を手に入れた！", "遅延証明書を捨てた"]);
    expect(after.decision).toBeNull();
    expect(after.showItemNotice).toBe(true);
    expect(after.announcement).toBe("7ターン目：出目2（2マス、2駅移動）、西日暮里に到着。山手線のみ ／ 外回りに固定。踏破 21/30。遅延証明書を拾いました。持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）。遅延証明書を選んで捨てました。サイコロを振れます");
  });

  it("publishes harmful drops and certificate cancellation without a pickup stage", () => {
    const delayBase = itemScenario("delay", network);
    const delayOrigin = resumeSession(delayBase, network, 66);
    const delayView = itemSessionView(delayOrigin, network)!;
    const delaySession = resumeSession(playItemTurn(delayBase, {}, network).state, network, 66);
    const delayAttempt = releasedAttempt(delayOrigin, delayView);
    const delayDuring = display(delaySession, itemSessionView(delaySession, network)!, delayAttempt, "lottery-settle");
    expect(delayDuring.announcement).toBe("5ターン目：巣鴨に到着。踏破 18/30");
    const harmful = display(delaySession, itemSessionView(delaySession, network)!, delayAttempt, "done");
    expect(harmful.itemView?.effects.delayDueTurns).toEqual([8]);
    expect(harmful.toastInputs.map((toast) => toast.text)).toEqual(["遅延を拾ってしまった！"]);
    expect(harmful.announcement).toBe("5ターン目：出目3（3マス、3駅移動）、巣鴨に到着。山手線のみ ／ 外回りに固定。踏破 18/30。遅延：8ターン目に発動（あと3ターン）。出目が1になります。サイコロを振れます");

    const certificateBase = itemScenario("certificate", network);
    const certificateOrigin = resumeSession(certificateBase, network, 67);
    const certificateView = itemSessionView(certificateOrigin, network)!;
    const certificateSession = resumeSession(playItemTurn(certificateBase, {}, network).state, network, 67);
    const certificateDuring = display(certificateSession, itemSessionView(certificateSession, network)!,
      releasedAttempt(certificateOrigin, certificateView), "arrival");
    expect(certificateDuring.announcement).toBe("8ターン目：鶯谷に到着。踏破 23/30");
    const cancelled = display(certificateSession, itemSessionView(certificateSession, network)!,
      releasedAttempt(certificateOrigin, certificateView), "done");
    expect(cancelled.itemView?.inventory.map((item) => item.id)).toEqual(["item-4", "item-5"]);
    expect(cancelled.toastInputs.map((toast) => toast.text)).toEqual(["遅延証明書で寝過ごしを打ち消した"]);
    expect(cancelled.announcement).toBe("8ターン目：出目2（2マス、2駅移動）、鶯谷に到着。山手線のみ ／ 外回りに固定。踏破 23/30。拾った寝過ごしを遅延証明書で打ち消しました。サイコロを振れます");
  });

  it.each([
    ["waiting-roll", "waiting-roll", "waiting", "committing", false, true, true],
    ["tumble", "tumble", "waiting", "adjusting", false, true, true],
    ["awaiting-adjust", "awaiting-adjust", "waiting", "adjusting", false, true, true],
    ["waiting-record", "waiting-record", "waiting", "resolving", false, true, true],
    ["stamps", "stamps", "waiting", "moving", false, true, true],
    ["movement", "released", "waiting", "moving", false, true, true],
    ["arrival", "released", "arrival", "arrived", false, true, true],
    ["lottery-flip", "released", "lottery-flip", "arrived", false, true, true],
    ["lottery-settle", "released", "lottery-settle", "arrived", false, true, true],
    ["pickup", "released", "pickup", "pickup", false, true, true],
    ["done", "released", "done", "arrived", true, false, false],
  ] as const)("sets literal permissions at %s", (_name, stage, reveal, sessionKey, canRoll, canSkip, itemUseLocked) => {
    const origin = resumeSession(itemScenario("adjust", network), network, 68);
    const committing = transition(origin, { type: "item-commit", ...itemActionIdentity(origin) });
    const adjusting = transition(committing, { type: "item-save-attempted", ...itemActionIdentity(committing) });
    const resolving = transition(adjusting, { type: "item-adjust", ...itemActionIdentity(adjusting), adjustment: null });
    const moving = transition(resolving, { type: "item-save-attempted", ...itemActionIdentity(resolving) });
    const arrived = transition(moving, { type: "animation-finished", ...itemActionIdentity(moving) });
    const pickupOrigin = resumeSession(itemScenario("rapid-long", network), network, 68);
    const pickup = resumeSession(playItemTurn(itemScenario("rapid-long", network), {}, network).state, network, 68);
    const session = { committing, adjusting, resolving, moving, arrived, pickup }[sessionKey];
    const attemptOrigin = sessionKey === "pickup" ? pickupOrigin : origin;
    const result = display(session, itemSessionView(session, network)!,
      releasedAttempt(attemptOrigin, itemSessionView(attemptOrigin, network)!, stage), reveal);
    expect(result.canRoll).toBe(canRoll);
    expect(result.canSkip).toBe(canSkip);
    expect(result.itemUseLocked).toBe(itemUseLocked);
  });

  it.each(["done", "arrival"] as const)("does not lock restored or omitted results with stale %s stages", (stage) => {
    const origin = resumeSession(itemScenario("double", network), network, 68);
    const moved = resumeSession(playItemTurn(itemScenario("double", network), {}, network).state, network, 68);
    const result = display(moved, itemSessionView(moved, network)!,
      releasedAttempt(origin, itemSessionView(origin, network)!, "tumble"), stage, true);
    expect(result.canRoll).toBe(true);
    expect(result.canSkip).toBe(false);
    expect(result.itemUseLocked).toBe(false);
    expect(result.announcement).toBe("6ターン目：出目1（1マス、1駅移動）、駒込に到着。山手線のみ ／ 外回りに固定。踏破 19/30。サイコロを振れます");
  });

  it("uses live action identity across engine commit, adjustment, save, and movement transitions", () => {
    const origin = resumeSession(itemScenario("adjust", network), network, 69);
    const snapshot = itemSessionView(origin, network)!;
    expect(snapshot.identity).toEqual({ sessionId: 69, turn: 8, decisionRevision: 0 });
    const committing = transition(origin, { type: "item-commit", ...itemActionIdentity(origin) });
    const adjusting = transition(committing, { type: "item-save-attempted", ...itemActionIdentity(committing) });
    expect(adjusting.phase).toBe("awaiting-adjust");
    expect(itemActionIdentity(adjusting)).toEqual({ sessionId: 69, turn: 8, decisionRevision: 2 });
    const resolving = transition(adjusting, { type: "item-adjust", ...itemActionIdentity(adjusting),
      adjustment: { instanceId: "item-7", delta: 1 } });
    const moving = transition(resolving, { type: "item-save-attempted", ...itemActionIdentity(resolving) });
    expect(moving.phase).toBe("animating");
    const stamps = display(moving, itemSessionView(moving, network)!, releasedAttempt(origin, snapshot, "stamps"), "waiting");
    expect(stamps.itemView?.identity).toEqual({ sessionId: 69, turn: 9, decisionRevision: 4 });
    expect(stamps.itemView?.inventory.map((item) => item.id)).toEqual(["item-1", "item-7"]);
    const arrived = transition(moving, { type: "animation-finished", ...itemActionIdentity(moving) });
    const arrival = display(arrived, itemSessionView(arrived, network)!, releasedAttempt(origin, snapshot), "arrival");
    expect(arrival.itemView?.identity).toEqual({ sessionId: 69, turn: 9, decisionRevision: 5 });
    expect(arrival.itemView?.inventory.map((item) => item.id)).toEqual(["item-1"]);
    expect(arrival.itemView?.effects.delayDueTurns).toEqual([]);
  });

  it("keeps adjustment hidden until awaiting-adjust and announces only published values", () => {
    const base = itemScenario("adjust", network);
    const pending = beginItemTurn(base, { items: [] }, network).state;
    const session = resumeSession(pending, network, 70);
    const view = itemSessionView(session, network);
    const common = { session, view, decision: view?.decision ?? null, completedCount: 0, requiredCount: 30, network, presentation, canRoll: false };
    expect(turnMomentAnnouncement({ ...common, stage: "waiting-roll" })).toBe("");
    expect(turnMomentAnnouncement({ ...common, stage: "tumble" })).toBe("サイコロを振っています。移動の準備中です。");
    expect(turnMomentAnnouncement({ ...common, stage: "waiting-record" })).toBe("");
    expect(turnMomentAnnouncement({ ...common, stage: "stamps" })).toBe("移動の準備中です。");
    expect(turnMomentAnnouncement({ ...common, stage: "movement" })).toBe("出目は1マス 遅延です。移動中です。スキップできます。");
    expect(turnMomentAnnouncement({ ...common, stage: "arrival" })).toBe("8ターン目：秋葉原に到着。踏破 0/30");
    expect(turnMomentAnnouncement({ ...common, stage: "lottery-flip" })).toBe("8ターン目：秋葉原に到着。踏破 0/30");
    expect(turnMomentAnnouncement({ ...common, stage: "lottery-settle" })).toBe("8ターン目：秋葉原に到着。踏破 0/30");
    expect(turnMomentAnnouncement({ ...common, stage: "ready", canRoll: false })).toBe("");
    expect(turnMomentAnnouncement({ ...common, stage: "ready", canRoll: true })).toBe("");
    expect(turnMomentAnnouncement({ ...common, decision: null, stage: "awaiting-adjust" })).toBe("");
    expect(turnMomentAnnouncement({ ...common, stage: "awaiting-adjust" })).toBe("出目は2です。出目調整券で調整するか、そのまま続けるか選んでください。");
    const snapshot = view!;
    const beforeDecision = display(session, snapshot, releasedAttempt(session, snapshot, "tumble"), "waiting");
    expect(beforeDecision.decision).toBeNull();
    expect(beforeDecision.announcement).toBe("サイコロを振っています。移動の準備中です。");
    const presentedDecision = display(session, snapshot, releasedAttempt(session, snapshot, "awaiting-adjust"), "waiting");
    expect(presentedDecision.decision?.kind).toBe("adjust");
    expect(presentedDecision.announcement).toBe("出目は2です。出目調整券で調整するか、そのまま続けるか選んでください。");
  });

  it("presents restored adjustment immediately without a presentation lock", () => {
    const pending = beginItemTurn(itemScenario("adjust", network), { items: [] }, network).state;
    const session = resumeSession(pending, network, 76);
    const view = itemSessionView(session, network)!;
    const result = display(session, view, releasedAttempt(session, view, "tumble"), "waiting", true);
    expect(result.decision?.kind).toBe("adjust");
    expect(result.announcement).toBe("出目は2です。出目調整券で調整するか、そのまま続けるか選んでください。");
    expect(result.canRoll).toBe(false);
    expect(result.canSkip).toBe(false);
    expect(result.itemUseLocked).toBe(false);
  });

  it("keeps goal permissions locked during arrival and passes announcement ownership to ClearScreen", () => {
    let game = createItemGame(ITEM_GAME_CONFIG, "00000000000000000000000000000004", network);
    let previous = game;
    while (game.status === "playing" && game.turn < 500) {
      previous = game;
      game = playItemTurn(game, {}, network).state;
      if (game.pending?.kind === "discard") game = resolveItemDiscard(game, game.pending.item.id).state;
    }
    expect(game.status).toBe("completed");
    const origin = resumeSession(previous, network, 71);
    const session = resumeSession(game, network, 71);
    const attempt = releasedAttempt(origin, itemSessionView(origin, network)!);
    const during = display(session, itemSessionView(session, network)!, attempt, "arrival");
    expect(during.showClear).toBe(false);
    expect(during.canRoll).toBe(false);
    expect(during.canSkip).toBe(true);
    expect(during.itemUseLocked).toBe(true);
    const result = display(session, itemSessionView(session, network)!, attempt, "done");
    expect(result.showClear).toBe(true);
    expect(result.announcement).toBe("");
    expect(result.canRoll).toBe(false);
    expect(result.canSkip).toBe(false);
    expect(result.itemUseLocked).toBe(false);
  });
});
