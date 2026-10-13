import type { LineMetadata } from "../../../types/network";
import type { CSSProperties } from "react";
import type { RailwayNetwork } from "../engine";
import type { GameSession } from "../gameSession";
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

export interface GamePanelProps {
  session: GameSession;
  network: RailwayNetwork;
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

export { stationName } from "../presentation";

export function GamePanel(props: GamePanelProps) {
  const { session, network, saveStatus, follow, reducedMotion } = props;
  const { game, phase } = session;
  const animating = phase === "animating";
  const canRoll = game.status === "playing" && phase === "idle";
  const ride = displayedRide(session);
  const currentService = network.servicesById.get(ride.serviceId);
  const lineColor = network.servicesById.get(game.config.targetServiceId)?.color;
  const legendStyle = { "--completed-line-color": lineColor } as CSSProperties;
  const candidates = session.lastMove?.landing?.serviceCandidates ?? [];
  const legendGroups = props.lines.map((line) => ({
    ...line,
    services: [...network.servicesById.values()].filter((service) => service.id !== game.config.targetServiceId && service.lineIds.includes(line.id)),
  })).filter((line) => line.services.length > 0);
  const saveFailed = saveStatus === "failed" || saveStatus === "unavailable";

  return (
    <section className="game-panel" aria-label="ゲーム操作">
      <h1 className="game-panel__title">山手線すごろく</h1>
      <p className="game-panel__subtitle">JR東日本 東京23区版</p>
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd>{stationName(network, props.displayedStationId)}</dd>
        <dt>乗車中</dt>
        <dd>
          <span className="service-swatch" style={{ backgroundColor: currentService?.color }} aria-hidden="true" />
          {serviceName(network, ride.serviceId)}
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
        <dd aria-live="polite">{lastRollText(session.lastMove, network)}</dd>
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
        <span>抽選: </span>{animating ? "移動中…" : landingText(session.lastMove, network)}
      </p>
      {!animating && candidates.length > LOTTERY_INLINE_LIMIT && (
        <details className="game-panel__candidates" key={game.turn}>
          <summary>抽選候補をすべて表示（{candidates.length}系統）</summary>
          <ul>{candidates.map((id) => <li key={id}>{serviceName(network, id)}</li>)}</ul>
        </details>
      )}
      <p
        className={`game-panel__save${saveFailed ? " game-panel__save--warning" : ""}`}
        role="status"
      >
        セーブ: {saveStatusMessage(saveStatus)}
      </p>
      <ul className="game-panel__legend" style={legendStyle} aria-label="凡例">
        <li>
          <span className="legend-swatch legend-swatch--completed" aria-hidden="true" />
          山手線 踏破済み（実線）
        </li>
        <li>
          <span className="legend-swatch legend-swatch--pending" aria-hidden="true" />
          山手線 未踏破（点線）
        </li>
        {legendGroups.map((line) => line.services.length === 1 ? (
          <li key={line.id}>
            <span className="legend-swatch legend-swatch--service" style={{ borderTopColor: line.services[0]!.color }} aria-hidden="true" />
            {line.services[0]!.name}
          </li>
        ) : (
          <li key={line.id} className="game-panel__legend-group">
            <details>
              <summary><span className="legend-swatch legend-swatch--service" style={{ borderTopColor: line.color }} aria-hidden="true" />{line.name}（{line.services.length}系統）</summary>
              <ul>{line.services.map((service) => <li key={service.id}>{service.name}</li>)}</ul>
            </details>
          </li>
        ))}
        <li>
          <span className="legend-swatch legend-swatch--current" aria-hidden="true" />
          現在地
        </li>
      </ul>
    </section>
  );
}
