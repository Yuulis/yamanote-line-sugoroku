import type { CSSProperties } from "react";
import type { RailwayNetwork } from "../engine";
import type { GameSession, LastMove } from "../gameSession";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";

export interface GamePanelProps {
  session: GameSession;
  network: RailwayNetwork;
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

const DIRECTION_LABELS = { 1: "外回り", [-1]: "内回り" } as const;

export function stationName(network: RailwayNetwork, stationId: string): string {
  return network.stationsById.get(stationId)?.name ?? stationId;
}

function lastRollText(lastMove: LastMove | null, goalName: string): string {
  if (!lastMove) return "—";
  if (lastMove.unusedPips === 0) return String(lastMove.roll);
  return `${lastMove.roll}（${goalName}で停止、残り${lastMove.unusedPips}は使わず）`;
}

export function GamePanel(props: GamePanelProps) {
  const { session, network, saveStatus, follow, reducedMotion } = props;
  const { game, phase } = session;
  const animating = phase === "animating";
  const canRoll = game.status === "playing" && phase === "idle";
  const lineColor = network.servicesById.get(game.config.targetServiceId)?.color;
  const legendStyle = { "--completed-line-color": lineColor } as CSSProperties;
  const goalName = stationName(network, game.config.startStationId);
  const saveFailed = saveStatus === "failed" || saveStatus === "unavailable";

  return (
    <section className="game-panel" aria-label="ゲーム操作">
      <h1 className="game-panel__title">山手線すごろく</h1>
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd>{stationName(network, props.displayedStationId)}</dd>
        <dt>進行方向</dt>
        <dd>{DIRECTION_LABELS[game.direction]}</dd>
        <dt>ターン数</dt>
        <dd>{game.turn}</dd>
        <dt>踏破区間</dt>
        <dd>
          {props.displayedCompletedCount}/{props.requiredCount}
        </dd>
        <dt>出目</dt>
        <dd aria-live="polite">{lastRollText(session.lastMove, goalName)}</dd>
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
      <p
        className={`game-panel__save${saveFailed ? " game-panel__save--warning" : ""}`}
        role="status"
      >
        セーブ: {saveStatusMessage(saveStatus)}
      </p>
      <ul className="game-panel__legend" style={legendStyle} aria-label="凡例">
        <li>
          <span className="legend-swatch legend-swatch--completed" aria-hidden="true" />
          踏破済み（実線）
        </li>
        <li>
          <span className="legend-swatch legend-swatch--pending" aria-hidden="true" />
          未踏破（点線）
        </li>
        <li>
          <span className="legend-swatch legend-swatch--current" aria-hidden="true" />
          現在地
        </li>
      </ul>
    </section>
  );
}
