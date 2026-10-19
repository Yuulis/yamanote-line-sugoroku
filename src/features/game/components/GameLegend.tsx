import { type CSSProperties, useState } from "react";
import { defaultLegendExpanded } from "./legendCollapse";

export interface LegendLine {
  id: string;
  name: string;
  color: string;
  operatorId: string;
  serviceIds: readonly string[];
}

interface GameLegendProps {
  lines: readonly LegendLine[];
  /** Colour of the completed target-line segments. */
  targetColor: string | undefined;
  selectedGroupIds?: ReadonlySet<string> | null;
  onToggleGroup?: (groupId: string, checked: boolean) => void;
  onSetOperator?: (operatorId: string, checked: boolean) => void;
  onShowAll?: () => void;
}

const LEGEND_LIST_ID = "game-legend";
const GROUP_LIST_ID = "game-legend-groups";
const ALWAYS_VISIBLE_NOTE = "現在地・乗車中の路線・山手線の進捗は常に表示します。";

/** Grouped UI legend; progress and current-position entries stay visible while groups collapse. */
export function GameLegend({
  lines,
  targetColor,
  selectedGroupIds = null,
  onToggleGroup = () => {},
  onSetOperator = () => {},
  onShowAll = () => {},
}: GameLegendProps) {
  const [expanded, setExpanded] = useState(() => defaultLegendExpanded(lines.length));
  const style = { "--completed-line-color": targetColor } as CSSProperties;
  const groupsByOperator = new Map<string, LegendLine[]>();
  for (const line of lines) {
    const groups = groupsByOperator.get(line.operatorId) ?? [];
    groups.push(line);
    groupsByOperator.set(line.operatorId, groups);
  }

  return (
    <section className="game-panel__legend-section" aria-label="路線の表示設定">
      <ul id={LEGEND_LIST_ID} className="game-panel__legend" style={style} aria-label="凡例">
        <li>
          <span className="legend-swatch legend-swatch--completed" aria-hidden="true" />
          山手線 踏破済み（実線）
        </li>
        <li>
          <span className="legend-swatch legend-swatch--pending" aria-hidden="true" />
          山手線 未踏破（点線）
        </li>
        <li>
          <span className="legend-swatch legend-swatch--current" aria-hidden="true" />
          現在地
        </li>
        <li className="game-panel__legend-note">{ALWAYS_VISIBLE_NOTE}</li>
      </ul>
      {lines.length > 0 && (
        <>
          <button
            type="button"
            className="game-panel__legend-toggle"
            aria-expanded={expanded}
            aria-controls={GROUP_LIST_ID}
            onClick={() => setExpanded((value) => !value)}
          >
            <span aria-hidden="true">{expanded ? "▼" : "▶"} </span>路線の凡例（{lines.length}路線）
          </button>
          <button type="button" className="game-panel__legend-reset" onClick={onShowAll}>
            すべて表示
          </button>
          <div id={GROUP_LIST_ID} className="game-panel__legend-groups" hidden={!expanded}>
            {[...groupsByOperator].map(([operatorId, operatorLines]) => {
              const selectedCount = operatorLines.filter((line) =>
                selectedGroupIds === null || selectedGroupIds.has(line.id),
              ).length;
              const allSelected = selectedCount === operatorLines.length;
              const mixed = selectedCount > 0 && !allSelected;
              return (
                <details className="game-panel__legend-operator" key={operatorId}>
                  <summary>{operatorId}（{operatorLines.length}路線）</summary>
                  <label className="game-panel__legend-select-all">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-checked={mixed ? "mixed" : allSelected}
                      aria-label={`${operatorId}の路線をすべて表示`}
                      ref={(input) => {
                        if (input) input.indeterminate = mixed;
                      }}
                      onChange={(event) => onSetOperator(operatorId, event.currentTarget.checked)}
                    />
                    すべて選択
                  </label>
                  <ul>
                    {operatorLines.map((line) => (
                      <li key={line.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selectedGroupIds === null || selectedGroupIds.has(line.id)}
                            aria-label={`${line.name}を表示`}
                            onChange={(event) => onToggleGroup(line.id, event.currentTarget.checked)}
                          />
                          <span className="legend-swatch legend-swatch--service" style={{ borderTopColor: line.color }} aria-hidden="true" />
                          {line.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
