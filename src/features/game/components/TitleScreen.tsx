import type { Manifest } from "../../../types/data";
import type { GameState } from "../../../types/network";
import { safeExternalUrl } from "../../map/attribution";
import { MAP_CREDITS } from "../../map/mapConfig";
import type { RailwayNetwork } from "../engine";
import { type SaveLookup, saveProblemMessage } from "../store/persistence";
import { stationName } from "./GamePanel";

interface TitleScreenProps {
  manifest: Manifest | null;
  /** Null when the game cannot start (see `unavailableReason`). */
  network: RailwayNetwork | null;
  saveLookup: SaveLookup | null;
  /** Why the game cannot start (data failed to load); blocks starting. */
  unavailableReason: string | null;
  /** One-off message, e.g. a failed deletion. */
  notice: string | null;
  onNewGame: () => void;
  onResume: (game: GameState) => void;
  onDeleteSave: () => void;
}

function resumeLabel(game: GameState, network: RailwayNetwork): string {
  if (game.status === "completed") return `クリア結果を見る（${game.turn}ターンでクリア）`;
  return `つづきから（${game.turn}ターン目・${stationName(network, game.currentStationId)}）`;
}

function SaveSection({
  saveLookup,
  network,
  onResume,
  onDeleteSave,
}: Pick<TitleScreenProps, "saveLookup" | "onResume" | "onDeleteSave"> & {
  network: RailwayNetwork;
}) {
  if (!saveLookup || saveLookup.kind === "none") return null;
  if (saveLookup.kind === "unavailable") {
    return (
      <p className="title-screen__notice" role="status">
        この環境ではセーブを利用できません。プレイはできますが、ページを閉じると進行は失われます。
      </p>
    );
  }
  if (saveLookup.kind === "invalid") {
    return (
      <div className="title-screen__notice title-screen__notice--error" role="alert">
        <p>{saveProblemMessage(saveLookup.problem)}</p>
        <button type="button" onClick={onDeleteSave}>
          セーブデータを破棄
        </button>
      </div>
    );
  }
  const { game } = saveLookup;
  return (
    <>
      <button type="button" className="button-primary" onClick={() => onResume(game)}>
        {resumeLabel(game, network)}
      </button>
      <button type="button" className="title-screen__delete" onClick={onDeleteSave}>
        セーブを削除
      </button>
    </>
  );
}

function Credits({ manifest }: { manifest: Manifest | null }) {
  const dataUrl = manifest ? safeExternalUrl(manifest.source.url) : null;
  return (
    <section className="title-screen__credits" aria-labelledby="credits-title">
      <h2 id="credits-title">出典・ライセンス</h2>
      <ul>
        {manifest && (
          <li>
            鉄道データ:{" "}
            {dataUrl ? (
              <a href={dataUrl} target="_blank" rel="noopener noreferrer">
                {manifest.source.attribution}
              </a>
            ) : (
              manifest.source.attribution
            )}
            （{manifest.source.license}、基準日 {manifest.source.baseDate}）
          </li>
        )}
        <li>
          背景地図:{" "}
          {MAP_CREDITS.map((credit, index) => (
            <span key={credit.url}>
              {index > 0 && " / "}
              <a href={credit.url} target="_blank" rel="noopener noreferrer">
                {credit.label}
              </a>
            </span>
          ))}
        </li>
      </ul>
      <p>本作品は既存作品から着想を得た独立したオリジナルゲームです。</p>
    </section>
  );
}

/** Start screen (spec 6.1): title, rules, start / resume, credits. */
export function TitleScreen(props: TitleScreenProps) {
  const { network, saveLookup, unavailableReason, notice } = props;
  return (
    <main className="title-screen" aria-labelledby="game-title">
      <div className="title-screen__card">
        <h1 id="game-title" className="title-screen__title">
          山手線すごろく
        </h1>
        <p>
          新橋駅から山手線を<strong>外回り</strong>に進むすごろくです。サイコロを振り、出た目の数だけ駅を進みます。
        </p>
        <p>
          通った駅間は踏破済みになります。全30区間を踏破して新橋に戻ればクリアです（新橋に着いた時点で余った目は使いません）。
        </p>
        {unavailableReason && (
          <p className="title-screen__notice title-screen__notice--error" role="alert">
            ゲームを開始できません: {unavailableReason}
          </p>
        )}
        {notice && (
          <p className="title-screen__notice" role="status">
            {notice}
          </p>
        )}
        <div className="title-screen__actions">
          {network && (
            <SaveSection
              saveLookup={saveLookup}
              network={network}
              onResume={props.onResume}
              onDeleteSave={props.onDeleteSave}
            />
          )}
          <button
            type="button"
            className={saveLookup?.kind === "valid" ? undefined : "button-primary"}
            onClick={props.onNewGame}
            disabled={!network}
          >
            はじめから
          </button>
        </div>
        <Credits manifest={props.manifest} />
      </div>
    </main>
  );
}
