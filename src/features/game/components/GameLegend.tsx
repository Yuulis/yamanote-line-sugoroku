import { type CSSProperties, useState } from "react";
import type { LineMetadata, ServicePattern } from "../../../types/network";
import { isPhoneWidth } from "../../map/mapConfig";
import { defaultLegendExpanded } from "./legendCollapse";

export interface LegendLine extends LineMetadata {
  services: readonly ServicePattern[];
}

interface GameLegendProps {
  lines: readonly LegendLine[];
  /** Colour of the completed target-line segments. */
  targetColor: string | undefined;
}

const LEGEND_LIST_ID = "game-legend";

/**
 * Map legend. The target-line progress entries and the current position are
 * always shown; the per-line service rows can be collapsed (they stay in the
 * DOM, hidden, so the collapsed state only changes what is displayed).
 */
export function GameLegend({ lines, targetColor }: GameLegendProps) {
  const [expanded, setExpanded] = useState(() => defaultLegendExpanded(lines.length, isPhoneWidth()));
  const style = { "--completed-line-color": targetColor } as CSSProperties;
  const collapsed = !expanded;

  return (
    <>
      {lines.length > 0 && (
        <button
          type="button"
          className="game-panel__legend-toggle"
          aria-expanded={expanded}
          aria-controls={LEGEND_LIST_ID}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? "▼" : "▶"} </span>路線の凡例（{lines.length}路線）
        </button>
      )}
      <ul id={LEGEND_LIST_ID} className="game-panel__legend" style={style} aria-label="凡例">
        <li>
          <span className="legend-swatch legend-swatch--completed" aria-hidden="true" />
          山手線 踏破済み（実線）
        </li>
        <li>
          <span className="legend-swatch legend-swatch--pending" aria-hidden="true" />
          山手線 未踏破（点線）
        </li>
        {lines.map((line) => line.services.length === 1 ? (
          <li key={line.id} hidden={collapsed}>
            <span className="legend-swatch legend-swatch--service" style={{ borderTopColor: line.services[0]!.color }} aria-hidden="true" />
            {line.services[0]!.name}
          </li>
        ) : (
          <li key={line.id} className="game-panel__legend-group" hidden={collapsed}>
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
    </>
  );
}
