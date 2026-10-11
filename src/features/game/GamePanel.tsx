import type { CSSProperties } from "react";
import { type RailwayNetwork, targetSegmentIds } from "./engine";
import type { GameSession } from "./gameSession";

interface GamePanelProps {
  session: GameSession;
  network: RailwayNetwork;
  onRoll: () => void;
  onRestart: () => void;
}

const DIRECTION_LABELS = { 1: "外回り", [-1]: "内回り" } as const;

function stationName(network: RailwayNetwork, stationId: string): string {
  return network.stationsById.get(stationId)?.name ?? stationId;
}

function lastRollText(session: GameSession, network: RailwayNetwork): string {
  const { lastMove, game } = session;
  if (!lastMove) return "—";
  if (lastMove.unusedPips === 0) return String(lastMove.roll);
  const goalName = stationName(network, game.config.startStationId);
  return `${lastMove.roll}（${goalName}で停止、残り${lastMove.unusedPips}は使わず）`;
}

export function GamePanel({ session, network, onRoll, onRestart }: GamePanelProps) {
  const { game, phase } = session;
  const required = targetSegmentIds(game.config, network);
  const completed = new Set(game.completedSegmentIds);
  const completedCount = required.filter((id) => completed.has(id)).length;
  const isCompleted = game.status === "completed";
  const canRoll = game.status === "playing" && phase === "idle";
  const lineColor = network.servicesById.get(game.config.targetServiceId)?.color;
  const legendStyle = { "--completed-line-color": lineColor } as CSSProperties;

  return (
    <section className="game-panel" aria-label="ゲーム操作">
      <h1 className="game-panel__title">山手線すごろく</h1>
      {isCompleted && (
        <p className="game-panel__clear" role="status">
          クリア！ {game.turn}ターンで山手線を一周しました。
        </p>
      )}
      <dl className="game-panel__stats">
        <dt>現在駅</dt>
        <dd>{stationName(network, game.currentStationId)}</dd>
        <dt>進行方向</dt>
        <dd>{DIRECTION_LABELS[game.direction]}</dd>
        <dt>ターン数</dt>
        <dd>{game.turn}</dd>
        <dt>踏破区間</dt>
        <dd>
          {completedCount}/{required.length}
        </dd>
        <dt>直前の出目</dt>
        <dd aria-live="polite">{lastRollText(session, network)}</dd>
      </dl>
      <div className="game-panel__actions">
        <button type="button" className="game-panel__roll" onClick={onRoll} disabled={!canRoll}>
          サイコロを振る
        </button>
        <button type="button" onClick={onRestart}>
          新しく始める
        </button>
      </div>
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
