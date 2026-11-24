import type { CSSProperties } from "react";
import { isLongestLineName, isLongLineName, type LineBadgeModel } from "../lineBadge";
import { PhraseText } from "./PhraseText";

export interface LineBadgeProps {
  model: LineBadgeModel;
  showName?: boolean;
  size?: "sm" | "md" | "lg";
}

export function LineBadge({ model, showName = true, size = "md" }: LineBadgeProps): React.JSX.Element {
  const markStyle: CSSProperties = {
    backgroundColor: model.color ?? "var(--color-border)",
    color: model.textColor ?? "var(--color-text)",
  };
  const className: string = `line-badge line-badge--${size}`;

  const nameClassName: string = [
    "line-badge__name",
    isLongLineName(model.name) ? "line-badge__name--long" : null,
    isLongestLineName(model.name) ? "line-badge__name--longest" : null,
  ].filter((part) => part !== null).join(" ");

  return (
    <span className={className}>
      <span className="line-badge__mark" style={markStyle} aria-hidden="true">
        {model.code === null ? null : <span className="line-badge__code">{model.code}</span>}
      </span>
      {showName ? <span className={nameClassName}><PhraseText text={model.name} /></span> : null}
    </span>
  );
}
