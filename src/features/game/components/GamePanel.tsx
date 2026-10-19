import type { LineMetadata } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
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

export function GamePanel(props: GamePanelProps) {
  const { session, network, saveStatus, follow, reducedMotion } = props;
  const presentation = props.presentation ?? createPresentationResolver(network);
  const { game, phase } = session;
  const animating = phase === "animating";
  const canRoll = game.status === "playing" && phase === "idle";
  const ride = displayedRide(session);
  const currentService = network.servicesById.get(ride.serviceId);
  const presentationGroups = presentation.lineGroups();
  const selectedGroupIds = useVisibleLineGroupIds();
  const targetColor = presentation.lineGroupColor(game.config.targetServiceId)
    ?? network.servicesById.get(game.config.targetServiceId)?.color;
  const candidates = session.lastMove?.landing?.serviceCandidates ?? [];
  const legendGroups = buildMapPresentationGroups(
    [...network.servicesById.values()],
    props.lines,
    presentationGroups,
  ).map((group) => ({
    id: group.id,
    name: group.name,
    operatorId: group.operatorId,
    color: presentation.lineGroupColor(group.serviceIds[0] ?? "") ?? group.color,
    serviceIds: group.serviceIds,
  }));
  const allGroupIds = legendGroups.map((group) => group.id);
  const saveFailed = saveStatus === "failed" || saveStatus === "unavailable";

  return (
    <section className="game-panel" aria-label="ゲーム操作">
      <h1 className="game-panel__title">山手線すごろく</h1>
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
        <dd aria-live="polite">{lastRollText(session.lastMove, network, presentation)}</dd>
      </dl>
      <div className="game-panel__actions">
        <button type="button" className="game-panel__roll" onClick={props.onRoll} disabled={!canRoll}>
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
      <p className="game-panel__lottery" aria-live="polite" aria-atomic="true">
        <span>抽選: </span>{animating ? "移動中…" : landingText(session.lastMove, network, presentation)}
      </p>
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
        onToggleGroup={(groupId, checked) => {
          setVisibleLineGroupIds(updateLineGroupSelection(selectedGroupIds, allGroupIds, [groupId], checked));
        }}
        onSetOperator={(operatorId, checked) => {
          const groupIds = legendGroups.filter((group) => group.operatorId === operatorId).map((group) => group.id);
          setVisibleLineGroupIds(updateLineGroupSelection(selectedGroupIds, allGroupIds, groupIds, checked));
        }}
        onShowAll={() => setVisibleLineGroupIds(null)}
      />
    </section>
  );
}
