import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LineMetadata } from "../../../types/network";
import { nextStationId, targetSegmentIds, type RailwayNetwork } from "../engine";
import { MVP_GAME_CONFIG } from "../gameConfig";
import type { GameSession } from "../gameSession";
import { createPresentationResolver, type PresentationResolver } from "../presentationResolver";
import {
  directionLabel,
  displayedRide,
  landingText,
  LOTTERY_INLINE_LIMIT,
  lastRollText,
  serviceName,
  stationName,
} from "../presentation";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";
import { buildMapPresentationGroups } from "../../map/mapPresentation";
import {
  setVisibleLineGroupIds,
  updateLineGroupSelection,
  useVisibleLineGroupIds,
} from "../../map/lineVisibilityStore";
import { GameLegend } from "./GameLegend";

function arrivalSummary(
  turn: number,
  lastMove: NonNullable<GameSession["lastMove"]>,
  completedCount: number,
  requiredCount: number,
  network: RailwayNetwork,
  presentation: PresentationResolver,
): string {
  const arrival = stationName(network, lastMove.stopStationId, presentation);
  const landing = lastMove.landing ? `。${landingText(lastMove, network, presentation)}` : "。ゴールに到着しました";
  return `${turn}ターン目：出目${lastMove.roll}、${arrival}に到着${landing}。踏破 ${completedCount}/${requiredCount}`;
}

export interface GamePanelProps {
  session: GameSession;
  network: RailwayNetwork;
  presentation?: PresentationResolver;
  lines: readonly LineMetadata[];
  /** Station the marker has reached (follows the animation). */
  displayedStationId: string;
  displayedCompletedCount: number;
  requiredCount: number;
  saveStatus: SaveWriteResult | null;
  follow: boolean;
  speedLabel: string;
  reducedMotion: boolean;
  onRoll: () => void;
  onSkip: () => void;
  onToggleFollow: () => void;
  onCycleSpeed: () => void;
  onNewGame: () => void;
  onShowTitle: () => void;
}

function showAllLineGroups(): void {
  setVisibleLineGroupIds(null);
}

/** Memoised: re-renders when a hop finishes or a control changes, not on animation frames. */
export const GamePanel = memo(function GamePanel(props: GamePanelProps) {
  const { session, network, saveStatus, follow, reducedMotion, lines } = props;
  const presentation = useMemo(
    () => props.presentation ?? createPresentationResolver(network),
    [props.presentation, network],
  );
  const { game, phase } = session;
  const animating = phase === "animating";
  const canRoll = game.status === "playing" && phase === "idle";
  const ride = displayedRide(session);
  const currentService = network.servicesById.get(ride.serviceId);
  const selectedGroupIds = useVisibleLineGroupIds();
  const targetColor = presentation.lineGroupColor(game.config.targetServiceId)
    ?? network.servicesById.get(game.config.targetServiceId)?.color;
  const candidates = session.lastMove?.landing?.serviceCandidates ?? [];
  const legendGroups = useMemo(
    () => buildMapPresentationGroups(
      [...network.servicesById.values()],
      lines,
      presentation.lineGroups(),
    ).map((group) => ({
      id: group.id,
      name: group.name,
      operatorId: group.operatorId,
      color: presentation.lineGroupColor(group.serviceIds[0] ?? "") ?? group.color,
      serviceIds: group.serviceIds,
    })),
    [network, lines, presentation],
  );
  const allGroupIds = useMemo(() => legendGroups.map((group) => group.id), [legendGroups]);
  const requiredTargetIds = useMemo(() => targetSegmentIds(MVP_GAME_CONFIG, network), [network]);
  const remainingSections = useMemo(() => {
    const completed = new Set(game.completedSegmentIds);
    return requiredTargetIds.flatMap((id) => {
      if (completed.has(id)) return [];
      const segment = network.segmentsById.get(id);
      if (!segment) return [];
      return [{
        id,
        from: presentation.serviceStationName(MVP_GAME_CONFIG.targetServiceId, segment.from),
        to: presentation.serviceStationName(MVP_GAME_CONFIG.targetServiceId, segment.to),
      }];
    });
  }, [game.completedSegmentIds, network, presentation, requiredTargetIds]);
  const upcomingStations = useMemo(() => {
    const ids: string[] = [];
    let current = props.displayedStationId;
    for (let index = 0; index < 5; index += 1) {
      const next = nextStationId(network, ride.serviceId, current, ride.direction);
      if (!next) break;
      ids.push(next);
      current = next;
    }
    return ids;
  }, [network, props.displayedStationId, ride.direction, ride.serviceId]);
  const knownTurn = useRef(game.turn);
  const [turnSummary, setTurnSummary] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toggleGroup = useCallback((groupId: string, checked: boolean) => {
    setVisibleLineGroupIds(updateLineGroupSelection(selectedGroupIds, allGroupIds, [groupId], checked));
  }, [selectedGroupIds, allGroupIds]);
  const setOperator = useCallback((operatorId: string, checked: boolean) => {
    const groupIds = legendGroups.filter((group) => group.operatorId === operatorId).map((group) => group.id);
    setVisibleLineGroupIds(updateLineGroupSelection(selectedGroupIds, allGroupIds, groupIds, checked));
  }, [legendGroups, selectedGroupIds, allGroupIds]);
  const saveFailed = saveStatus === "failed" || saveStatus === "unavailable";

  useEffect(() => {
    if (phase !== "idle" || !session.lastMove || game.turn <= knownTurn.current) return;
    knownTurn.current = game.turn;
    setTurnSummary(arrivalSummary(
      game.turn,
      session.lastMove,
      props.displayedCompletedCount,
      props.requiredCount,
      network,
      presentation,
    ));
  }, [game.turn, network, phase, presentation, props.displayedCompletedCount, props.requiredCount, session.lastMove]);

  useLayoutEffect(() => {
    if (!panelRef.current || !headingRef.current) return;
    panelRef.current.scrollTop = 0;
    headingRef.current.focus({ preventScroll: true });
  }, []);

  return (
    <main ref={panelRef} className="game-panel" aria-label="ゲーム操作">
      <h1 ref={headingRef} className="game-panel__title" tabIndex={-1}>山手線すごろく</h1>
      <p className="game-panel__subtitle">東京近郊版</p>
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd>{stationName(network, props.displayedStationId, presentation)}</dd>
        <dt>乗車中</dt>
        <dd>
          <span className="service-swatch" style={{ backgroundColor: presentation.lineGroupColor(ride.serviceId) ?? currentService?.color }} aria-hidden="true" />
          {serviceName(network, ride.serviceId, presentation)}
        </dd>
        <dt>進行方向</dt>
        <dd>{directionLabel(network, ride.serviceId, ride.direction)}</dd>
        <dt>ターン数</dt>
        <dd>{game.turn}</dd>
        <dt>踏破区間</dt>
        <dd>
          {props.displayedCompletedCount}/{props.requiredCount}
        </dd>
        <dt>出目</dt>
        <dd>{lastRollText(session.lastMove, network, presentation)}</dd>
      </dl>
      <div className="game-panel__actions">
        <button
          type="button"
          className="game-panel__roll"
          onClick={() => { if (canRoll) props.onRoll(); }}
          aria-disabled={!canRoll}
        >
          {animating ? "移動中…" : "サイコロを振る"}
        </button>
        <button type="button" onClick={props.onSkip} disabled={!animating}>
          スキップ
        </button>
      </div>
      <div className="game-panel__options">
        <button type="button" aria-pressed={follow} onClick={props.onToggleFollow}>
          追尾: {follow ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={props.onCycleSpeed}
          disabled={reducedMotion}
          aria-label={`アニメーション速度: ${props.speedLabel}（押すと切り替え）`}
          title={reducedMotion ? "視差効果を減らす設定のためアニメーションは省略されます" : undefined}
        >
          速度: {reducedMotion ? "省略" : props.speedLabel}
        </button>
        <button type="button" onClick={props.onNewGame}>
          新規
        </button>
        <button type="button" onClick={props.onShowTitle}>
          タイトル
        </button>
      </div>
      <p className="game-panel__lottery">
        <span>抽選: </span>{animating ? "移動中…" : landingText(session.lastMove, network, presentation)}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{turnSummary}</p>
      <details className="game-panel__route-summary">
        <summary>地図なしで確認</summary>
        <section aria-label="山手線の未踏破区間">
          <h2>山手線の未踏破区間（{remainingSections.length}）</h2>
          {remainingSections.length > 0 ? (
            <ol>{remainingSections.map((section) => <li key={section.id}>{section.from} → {section.to}</li>)}</ol>
          ) : <p>未踏破区間はありません。</p>}
        </section>
        <section aria-label="乗車中の次の駅">
          <h2>乗車中の次の駅</h2>
          <p>{serviceName(network, ride.serviceId, presentation)}・{directionLabel(network, ride.serviceId, ride.direction)}</p>
          {upcomingStations.length > 0 ? (
            <ol>{upcomingStations.map((stationId) => <li key={stationId}>{stationName(network, stationId, presentation)}</li>)}</ol>
          ) : <p>この路線に次の駅はありません。</p>}
        </section>
      </details>
      {!animating && candidates.length > LOTTERY_INLINE_LIMIT && (
        <details className="game-panel__candidates" key={game.turn}>
          <summary>抽選候補をすべて表示（{candidates.length}抽選枠）</summary>
          <ul>{presentation.candidateRows(candidates).map((row) => <li key={row.groupId}>{row.label}</li>)}</ul>
        </details>
      )}
      <p
        className={`game-panel__save${saveFailed ? " game-panel__save--warning" : ""}`}
        role="status"
      >
        セーブ: {saveStatusMessage(saveStatus)}
      </p>
      <GameLegend
        lines={legendGroups}
        targetColor={targetColor}
        selectedGroupIds={selectedGroupIds}
        onToggleGroup={toggleGroup}
        onSetOperator={setOperator}
        onShowAll={showAllLineGroups}
      />
    </main>
  );
});
