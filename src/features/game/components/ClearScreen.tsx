import type { GameState } from "../../../types/network";
import type { RailwayNetwork } from "../engine";
import { earlyStopNote, summarizeGame } from "../gameSummary";
import { type SaveWriteResult, saveStatusMessage } from "../store/persistence";
import { stationName } from "./GamePanel";

interface ClearScreenProps {
  game: GameState;
  network: RailwayNetwork;
  /** Result of saving the clearing turn; a failure must stay visible here. */
  saveStatus: SaveWriteResult | null;
  onPlayAgain: () => void;
  onShowTitle: () => void;
}

/** Shown once the clearing move has finished animating (spec 6.1). */
export function ClearScreen({ game, network, saveStatus, onPlayAgain, onShowTitle }: ClearScreenProps) {
  const { turns, moves } = summarizeGame(game);
  const goalName = stationName(network, game.config.startStationId);
  return (
    <section className="clear-screen" aria-labelledby="clear-title">
      <h1 id="clear-title" className="clear-screen__title">
        クリア！
      </h1>
      <p>山手線を外回りで一周し、{goalName}に戻りました。</p>
      {saveStatus !== "saved" && (
        <p className="clear-screen__save-warning" role="alert">
          セーブ: {saveStatusMessage(saveStatus)}。再読み込みするとこのクリアは残りません。
        </p>
      )}
      <dl className="clear-screen__stats">
        <dt>所要ターン数</dt>
        <dd>{turns}ターン</dd>
        <dt>移動回数（駅間）</dt>
        <dd>{moves}回</dd>
      </dl>
      <h2 className="clear-screen__subtitle">移動履歴</h2>
      <ol className="clear-screen__history">
        {game.movementHistory.map((record) => {
          const note = earlyStopNote(record, (id) => stationName(network, id));
          return (
            <li key={record.turn}>
              <span className="clear-screen__turn">{record.turn}ターン目</span> 出目{record.roll}：
              {stationName(network, record.fromStationId)} → {stationName(network, record.toStationId)}
              {note !== null && `（${note}）`}
            </li>
          );
        })}
      </ol>
      <div className="clear-screen__actions">
        <button type="button" className="button-primary" onClick={onPlayAgain} autoFocus>
          もう一度遊ぶ
        </button>
        <button type="button" onClick={onShowTitle}>
          タイトルへ
        </button>
      </div>
    </section>
  );
}
