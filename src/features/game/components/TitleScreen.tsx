import type { Manifest } from "../../../types/data";
import type { GameState } from "../../../types/network";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CC_BY_LICENSE_NAME, CC_BY_URL, safeExternalUrl } from "../../map/attribution";
import { MAP_CREDITS } from "../../map/mapConfig";
import type { RailwayNetwork } from "../engine";
import { type SaveLookup, saveProblemMessage } from "../store/persistence";
import { stationName } from "../presentation";
import type { PresentationResolver } from "../presentationResolver";
import { EDITIONS } from "../../editions/registry";
import type { EditionDisplay } from "../../editions/types";
import type { EditionId, EditionRegistry } from "../../editions/types";
import { EditionPicker } from "./EditionPicker";
import { isAnalyticsOptedOut, setAnalyticsOptOut } from "../../analytics/analytics";

interface TitleScreenProps {
  manifest: Manifest | null;
  /** Null when the game cannot start (see `unavailableReason`). */
  network: RailwayNetwork | null;
  presentation?: PresentationResolver;
  display?: EditionDisplay;
  editions?: EditionRegistry;
  editionId?: EditionId;
  onEditionChange?: (id: EditionId) => void;
  focusPicker?: boolean;
  onPickerFocusRestored?: () => void;
  loading?: boolean;
  saveLookup: SaveLookup | null;
  /** Why the game cannot start (data failed to load); blocks starting. */
  unavailableReason: string | null;
  /** One-off message, e.g. a failed deletion. */
  notice: string | null;
  /** Focus the heading when returning from a game. */
  focusOnMount?: boolean;
  onNewGame: () => void;
  onResume: (game: GameState) => void;
  onDeleteSave: () => void;
}

/** Emitted by `build.license` in vite.config.ts; keep the file names in sync. */
const THIRD_PARTY_LICENSES_URL = `${import.meta.env.BASE_URL}third-party-licenses.txt`;
const PRIVACY_POLICY_URL = `${import.meta.env.BASE_URL}privacy.html`;
const REPOSITORY_URL = "https://github.com/Yuulis/yamanote-line-sugoroku";
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const FONT_LICENSE_URL = "https://github.com/Yuulis/yamanote-line-sugoroku/blob/main/brand/OFL.txt";

function resumeLabel(game: GameState, network: RailwayNetwork, presentation?: PresentationResolver): string {
  if (game.status === "completed") return `クリア結果を見る（${game.turn}ターンでクリア）`;
  return `つづきから（${game.turn}ターン目・${stationName(network, game.currentStationId, presentation)}）`;
}

function SaveSection({
  saveLookup,
  network,
  presentation,
  onResume,
  onDeleteSave,
}: Pick<TitleScreenProps, "saveLookup" | "onResume" | "onDeleteSave" | "presentation"> & {
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
        {resumeLabel(game, network, presentation)}
      </button>
      <button type="button" onClick={onDeleteSave}>
        セーブを削除
      </button>
    </>
  );
}

export function formatAppVersion(version: string, commit: string, dataVersion?: string): string[] {
  return [`アプリ v${version}（${commit}）`, ...(dataVersion ? [`路線データ ${dataVersion}`] : [])];
}

function Credits({ manifest, onBack }: { manifest: Manifest | null; onBack: () => void }) {
  const dataUrl = manifest ? safeExternalUrl(manifest.source.url) : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(!isAnalyticsOptedOut());
  useLayoutEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <section className="title-screen__credits title-screen__credits-screen" aria-labelledby="credits-title">
      <h1 ref={headingRef} id="credits-title" tabIndex={-1}>クレジット</h1>
      <section aria-labelledby="credits-about"><h2 id="credits-about">このゲームについて</h2>
        <p>本作は非公式の個人制作ゲームで、各鉄道事業者・国土交通省とは関係ありません。</p>
        <p>無料で遊べ、すべての処理はお使いのブラウザー内で行われます。</p>
      </section>
      <section aria-labelledby="credits-sources"><h2 id="credits-sources">出典・ライセンス</h2>
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
            （
            {manifest.source.license === CC_BY_LICENSE_NAME ? (
              <a href={CC_BY_URL} target="_blank" rel="noopener noreferrer">
                {manifest.source.license}
              </a>
            ) : (
              manifest.source.license
            )}
            、基準日 {manifest.source.baseDate}）
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
        <li>
          <a href={THIRD_PARTY_LICENSES_URL} target="_blank" rel="noopener noreferrer">
            使用ライブラリのライセンス
          </a>
        </li>
        <li><a href={FONT_LICENSE_URL} target="_blank" rel="noopener noreferrer">ロゴ書体: Zen Maru Gothic（SIL Open Font License 1.1）</a></li>
      </ul>
      </section>
      <section aria-labelledby="credits-contact"><h2 id="credits-contact">ソースコード・お問い合わせ</h2>
        <p><a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">ソースコード（GitHub）</a> / <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">お問い合わせ（GitHub Issues）</a></p>
      </section>
      <section aria-labelledby="credits-privacy"><h2 id="credits-privacy">プライバシー</h2>
        <p><a href={PRIVACY_POLICY_URL}>プライバシーポリシー</a></p>
        <label><input type="checkbox" checked={analyticsAllowed} onChange={(event) => {
          const allowed = event.currentTarget.checked;
          setAnalyticsAllowed(allowed);
          setAnalyticsOptOut(!allowed);
        }} /> アクセス解析を許可する</label>
      </section>
      <section aria-labelledby="credits-version"><h2 id="credits-version">バージョン</h2>
        <p>{formatAppVersion(__APP_VERSION__, __APP_COMMIT__, manifest?.dataVersion).map((line) => <span key={line}>{line}<br /></span>)}</p>
      </section>
      <button type="button" onClick={onBack}>タイトルへ戻る</button>
    </section>
  );
}

/** Start screen (spec 6.1): title, rules, start / resume, credits. */
export function TitleScreen(props: TitleScreenProps) {
  const { network, presentation, saveLookup, unavailableReason, notice } = props;
  const display = props.display ?? EDITIONS[0]!.display;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showCredits, setShowCredits] = useState(false);
  const creditsButtonRef = useRef<HTMLButtonElement>(null);
  const creditsWasOpen = useRef(false);
  useEffect(() => {
    if (!showCredits) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCredits(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCredits]);
  useLayoutEffect(() => {
    if (creditsWasOpen.current && !showCredits) creditsButtonRef.current?.focus({ preventScroll: true });
    creditsWasOpen.current = showCredits;
  }, [showCredits]);
  useLayoutEffect(() => {
    if (props.focusOnMount) headingRef.current?.focus({ preventScroll: true });
  }, [props.focusOnMount]);
  return (
    <main className="title-screen" aria-labelledby={showCredits ? "credits-title" : "game-title"}>
      <div className="title-screen__card">
        {showCredits ? <Credits manifest={props.manifest} onBack={() => setShowCredits(false)} /> : <>
        <h1 ref={headingRef} id="game-title" className="title-screen__title" tabIndex={-1}>
          {display.logoUrl
            ? <img className="title-screen__logo" src={display.logoUrl} alt={display.title} width={1200} height={300} />
            : display.title}
        </h1>
        {/* A logo already shows the subtitle, so its text is kept for screen readers only. */}
        <p className={display.logoUrl ? "visually-hidden" : "title-screen__subtitle"}>{display.subtitle}</p>
        {props.editions && props.editionId && props.onEditionChange && (
          <EditionPicker
            editions={props.editions}
            value={props.editionId}
            onChange={props.onEditionChange}
            focusOnMount={!props.loading && props.focusPicker}
            onFocusRestored={props.onPickerFocusRestored}
          />
        )}
        {props.loading && <p className="title-screen__loading" role="status">読み込み中…</p>}
        {!props.loading && display.ruleParagraphs.map((paragraph, paragraphIndex) => (
          <p key={paragraphIndex}>
            {paragraph.map((part, partIndex) => typeof part === "string"
              ? <Fragment key={partIndex}>{part}</Fragment>
              : <strong key={partIndex}>{part.strong}</strong>)}
          </p>
        ))}
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
        {!props.loading && <div className="title-screen__actions">
          {network && (
            <SaveSection
              saveLookup={saveLookup}
              network={network}
              presentation={presentation}
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
        </div>}
        <button ref={creditsButtonRef} type="button" className="title-screen__credits-button" onClick={() => setShowCredits(true)}>クレジット</button>
        <p className="title-screen__version">v{__APP_VERSION__}</p>
        </>}
      </div>
    </main>
  );
}
