// Pure text and presentation rules. The already-committed lottery is revealed
// only after the accepted animation finish; these helpers never draw randomness.
import type { DeepReadonly, Direction, ItemEffectsState, ItemEvent, ItemTurnRecord, MoveRecord } from "../../types/network";
import type { RailwayNetwork } from "./engine";
import { endpointKindLabel } from "./gameSummary";
import { itemLastMove, type ItemSessionView } from "./itemSession";
import type { GameSession, LastMove } from "./gameSession";
import { ITEM_DESCRIPTIONS } from "./itemPresentation";
import type { PresentationResolver } from "./presentationResolver";

export function stationName(
  network: RailwayNetwork,
  stationId: string,
  presentation?: PresentationResolver,
): string {
  return presentation?.stationName(stationId) ?? network.stationsById.get(stationId)?.name ?? stationId;
}

export function serviceName(
  network: RailwayNetwork,
  serviceId: string,
  presentation?: PresentationResolver,
): string {
  return presentation?.serviceName(serviceId) ?? network.servicesById.get(serviceId)?.name ?? serviceId;
}

export function directionLabel(network: RailwayNetwork, serviceId: string, direction: Direction): string {
  const labels = network.servicesById.get(serviceId)?.directionLabels;
  return (direction === 1 ? labels?.forward : labels?.backward) ?? String(direction);
}

/** Describe an actual service change, while keeping same-group Oedo hops as direction changes. */
export function landingTransitionText(
  record: Pick<MoveRecord, "serviceId" | "direction" | "landing">,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string | null {
  const landing = record.landing;
  if (!landing || landing.serviceId === record.serviceId) return null;
  const nextService = serviceName(network, landing.serviceId, presentation);
  const nextDirection = directionLabel(network, landing.serviceId, landing.direction);
  if (presentation?.sameLineGroup(record.serviceId, landing.serviceId)) {
    return landing.direction === record.direction ? null : `${nextService}（方向変更: ${nextDirection}）`;
  }
  return `乗換: ${nextService}（${nextDirection}）`;
}

export function displayedRide(session: GameSession): { serviceId: string; direction: Direction } {
  const { game, phase, lastMove } = session;
  if (phase === "animating" && lastMove) return { serviceId: lastMove.serviceId, direction: lastMove.direction };
  // A discard is still pending in the engine, but arrival has already been
  // presented. Show the recorded next ride rather than the previous turn's ride.
  const position = "pending" in game && game.pending?.kind === "discard" && phase === "awaiting-discard"
    ? game.pending.position : game;
  return { serviceId: position.currentServiceId, direction: position.direction };
}

export function lastRollText(
  lastMove: LastMove | null,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string {
  if (!lastMove) return "—";
  if (lastMove.stopReason === "relocation") return "回送（サイコロなし）";
  const record = lastMove.itemRecord;
  if (record?.kind === "item-ride") {
    const adjustment = record.adjustment ? ` → 調整後${record.effectiveFace}` : record.effectiveFace !== record.rawRoll ? ` → 適用${record.effectiveFace}` : "";
    const movement = record.movementMode === "oversleep" ? "寝過ごし" : `${record.pips}マス`;
    const unused = record.unusedPips > 0 ? `、残り${record.unusedPips}は使わず` : "";
    return `${record.rawRoll}${adjustment}（${movement}、${record.physicalHops}駅移動${unused}）`;
  }
  if (lastMove.stopReason === "roll" || lastMove.unusedPips === 0) return String(lastMove.roll);
  const kind = lastMove.stopReason === "endpoint"
    ? `〔${endpointKindLabel(lastMove.endpointKind)}〕`
    : "";
  const stopName = presentation?.serviceStationName(lastMove.serviceId, lastMove.stopStationId)
    ?? stationName(network, lastMove.stopStationId);
  return `${lastMove.roll}（${stopName}で停止${kind}、残り${lastMove.unusedPips}は使わず）`;
}

export const LOTTERY_INLINE_LIMIT = 4;

export function landingText(
  lastMove: LastMove | null,
  network: RailwayNetwork,
  presentation?: PresentationResolver,
): string {
  const event = lastMove?.landing;
  if (lastMove?.stopReason === "relocation") {
    return `回送列車で${stationName(network, lastMove.stopStationId, presentation)}へ移りました（走行区間なし）`;
  }
  if (!event || !lastMove) return "—";
  const service = serviceName(network, event.serviceId, presentation);
  const station = presentation?.serviceStationName(lastMove.serviceId, event.stationId)
    ?? stationName(network, event.stationId);
  const candidateRows = presentation?.candidateRows(event.serviceCandidates);
  const hasGroupedSlots = candidateRows?.some((row) => row.serviceIds.length > 1) ?? false;
  const candidates = event.serviceCandidates.length > LOTTERY_INLINE_LIMIT && !hasGroupedSlots
    ? `${event.serviceCandidates.length}系統`
    : (candidateRows?.map((row) => row.label)
      ?? event.serviceCandidates.map((id) => serviceName(network, id))).join("・");
  const heading = event.serviceDrawRequired
    ? `${station}：${candidates}から抽選 → ${service}`
    : `${service}のみ`;
  const direction = directionLabel(network, event.serviceId, event.direction);
  if (event.directionDrawRequired) return `${heading} ／ 方向抽選 → ${direction}`;
  const chosen = network.servicesById.get(event.serviceId);
  if (chosen?.circular && event.directionCandidates.length === 1) return `${heading} ／ ${direction}に固定`;
  if (!event.changedService && lastMove.endpointKind && event.direction !== lastMove.direction) {
    const kind = endpointKindLabel(lastMove.endpointKind);
    return `${heading} ／ ${kind}のため折り返し（${direction}）`;
  }
  return `${heading} ／ 乗車方向は${direction}のみ`;
}

/** One outcome per verified event; never resolve historical effects again. */
export function itemEventTexts(
  events: DeepReadonly<readonly ItemEvent[]>, turn: number,
  network: RailwayNetwork, presentation?: PresentationResolver,
): string[] {
  const picked = new Set<string>();
  return events.flatMap((event): string[] => {
    switch (event.type) {
      case "pickup-retained":
      case "pickup-pending-discard": {
        if (picked.has(event.item.id)) return [];
        picked.add(event.item.id);
        const item = ITEM_DESCRIPTIONS[event.item.kind];
        return [`${item.name}を拾いました。${item.effect}`];
      }
      case "discarded": return [`${ITEM_DESCRIPTIONS[event.item.kind].name}を選んで捨てました`];
      case "cancelled-by-certificate": return [`拾った${ITEM_DESCRIPTIONS[event.item].name}を遅延証明書で打ち消しました`];
      case "consumed": return [`${ITEM_DESCRIPTIONS[event.item.kind].name}を使いました`];
      case "effect-activated": return [`${ITEM_DESCRIPTIONS[event.effect].name}が発動しました`];
      case "effect-expired": return [`${serviceName(network, event.serviceId, presentation)}の運休が終わりました`];
      case "harmful-scheduled":
        if (event.effect === "delay") return [`遅延：${event.dueTurn}ターン目に発動（あと${event.dueTurn - turn}ターン）。出目が1になります`];
        if (event.effect === "suspension") return [`運休：${serviceName(network, event.serviceId, presentation)}、あと${Math.max(0, event.expiresTurn - turn)}ターン`];
        if (event.effect === "detour") return ["寄り道：次に別の路線へ乗り換えられる駅で発動します"];
        return ["寝過ごし：次のターンは終点まで（環状線は6駅）進みます"];
    }
  });
}

export function activeItemEffectTexts(
  effects: DeepReadonly<ItemEffectsState>, turn: number,
  network: RailwayNetwork, presentation?: PresentationResolver,
): string[] {
  return [
    ...effects.delayDueTurns.map((due) => `遅延：${due}ターン目に発動（あと${Math.max(0, due - turn)}ターン）`),
    ...effects.suspensions.filter((entry) => entry.expiresTurn > turn).map((entry) =>
      `運休：${serviceName(network, entry.serviceId, presentation)}、あと${entry.expiresTurn - turn}ターン`),
    ...(effects.detourPending ? ["寄り道：次に別の路線へ乗り換えられる駅で発動します"] : []),
    ...(effects.oversleepPending ? ["寝過ごし：次のターンは終点まで（環状線は6駅）進みます"] : []),
  ];
}

export function arrivalLogText(
  turn: number, lastMove: LastMove, completedCount: number, requiredCount: number,
  network: RailwayNetwork, presentation?: PresentationResolver,
): string {
  const arrival: string = stationName(network, lastMove.stopStationId, presentation);
  const goal: string = lastMove.stopReason === "goal" ? "。ゴールに到着しました" : "";
  return `${turn}ターン目：${arrival}に到着${goal}。踏破 ${completedCount}/${requiredCount}`;
}

export function arrivalSummary(
  turn: number, lastMove: LastMove, completedCount: number, requiredCount: number,
  network: RailwayNetwork, presentation?: PresentationResolver,
): string {
  const arrival = stationName(network, lastMove.stopStationId, presentation);
  const movement = lastMove.stopReason === "relocation" ? `回送列車で${arrival}へ移りました（走行区間なし）`
    : `出目${lastRollText(lastMove, network, presentation)}、${arrival}に到着`;
  const landing = lastMove.stopReason === "relocation" ? "" : lastMove.stopReason === "goal"
    ? "。ゴールに到着しました" : lastMove.landing ? `。${landingText(lastMove, network, presentation)}` : "";
  return `${turn}ターン目：${movement}${landing}。踏破 ${completedCount}/${requiredCount}`;
}

/** The only gameplay live message, shared by the panel and its modal decision. */
export function itemTurnAnnouncement(
  session: GameSession, view: ItemSessionView, completedCount: number, requiredCount: number,
  network: RailwayNetwork, presentation?: PresentationResolver,
): string {
  const { phase, lastMove, game } = session;
  if (phase === "committing" || phase === "resolving") return "";
  if (view.decision?.kind === "adjust") {
    return `出目は${view.decision.rawRoll}です。出目調整券で調整するか、そのまま続けるか選んでください。`;
  }
  const record = lastMove?.itemRecord;
  if (phase === "animating") {
    if (!record || !lastMove) return "移動中です。スキップできます。";
    const activations = record.itemEvents.filter((event) => event.type === "consumed" || event.type === "effect-activated");
    return [record.kind === "deadhead" ? "回送列車で移動します" : `出目は${lastRollText(lastMove, network, presentation)}です`,
      ...itemEventTexts(activations, record.turn, network, presentation), "移動中です。スキップできます。"].join("。");
  }
  const draft = view.draft.items[0];
  if (draft) return `${ITEM_DESCRIPTIONS[draft.kind].name}を選択中。この内容で${draft.kind === "deadhead" ? "回送列車で移動できます" : "サイコロを振れます"}。`;
  const outcomes = itemEventTexts(record?.itemEvents ?? [], record?.turn ?? game.turn, network, presentation);
  const effects = activeItemEffectTexts(view.effects, record?.turn ?? game.turn, network, presentation)
    .filter((effect) => !outcomes.some((outcome) => outcome.startsWith(effect)));
  const arrival = lastMove ? arrivalSummary(record?.turn ?? game.turn, lastMove, completedCount, requiredCount, network, presentation) : "";
  const fallback = record?.landingSnapshot?.suspensionIgnored ? "この駅では候補がすべて運休のため、運休を無視して抽選しました" : "";
  const available = view.decision?.kind === "discard" ? "捨てるアイテムを1つ選んでください"
    : game.status === "playing" && phase === "idle" ? "サイコロを振れます" : "";
  return [arrival, ...outcomes, ...effects, fallback, available].filter(Boolean).join("。");
}

/** Result history uses item pips and snapshots, never classic roll-minus-hops. */
export function itemHistoryText(
  record: DeepReadonly<ItemTurnRecord>, network: RailwayNetwork, presentation?: PresentationResolver,
): string {
  const move = itemLastMove(record, network)!;
  const from = presentation?.serviceStationName(move.serviceId, record.fromStationId) ?? stationName(network, record.fromStationId);
  const to = presentation?.serviceStationName(move.serviceId, record.toStationId) ?? stationName(network, record.toStationId);
  const movement = record.kind === "deadhead" ? landingText(move, network, presentation)
    : `出目${lastRollText(move, network, presentation)}：${from} → ${to}（${serviceName(network, move.serviceId, presentation)}・${directionLabel(network, move.serviceId, move.direction)}）`;
  const landing = record.landing ? landingText(move, network, presentation)
    : record.stopReason === "goal" ? "ゴールに到着しました" : "";
  return [`${record.turn}ターン目 ${movement}`, landing, ...itemEventTexts(record.itemEvents, record.turn, network, presentation),
    record.landingSnapshot?.suspensionIgnored ? "この駅では候補がすべて運休のため、運休を無視して抽選しました" : ""].filter(Boolean).join("。");
}
