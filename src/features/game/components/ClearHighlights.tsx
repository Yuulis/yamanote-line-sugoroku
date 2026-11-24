import type { RailwayNetwork } from "../engine";
import type { ClearHighlights as ClearHighlightsModel } from "../clearResult";
import { buildClearHighlightRows } from "../clearHighlightsPresentation";
import type { PresentationResolver } from "../presentationResolver";
import { PhraseText } from "./PhraseText";

interface ClearHighlightsProps {
  highlights: ClearHighlightsModel;
  network: RailwayNetwork;
  presentation: PresentationResolver;
  startStationId: string;
  targetServiceId: string;
}

/** On-screen highlights of the run (never part of the share text). Rows are a description list, not list items. */
export function ClearHighlights({ highlights, network, presentation, startStationId, targetServiceId }: ClearHighlightsProps) {
  const rows = buildClearHighlightRows(highlights, { network, presentation, startStationId, targetServiceId });
  return (
    <section className="clear-screen__highlights" aria-labelledby="clear-highlights-title">
      <h2 id="clear-highlights-title" className="clear-screen__subtitle">ハイライト</h2>
      <dl className="clear-screen__highlight-list">
        {rows.map((row) => (
          <div key={row.key} className="clear-screen__highlight-row" data-highlight={row.key}>
            <dt>{row.label}</dt>
            <dd><PhraseText text={row.value} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
