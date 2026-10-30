import type { CSSProperties } from "react";
import type { LineBadgeModel } from "../lineBadge";

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

  return (
    <span className={className}>
      <span className="line-badge__mark" style={markStyle} aria-hidden="true">
        {model.code === null ? null : <span className="line-badge__code">{model.code}</span>}
      </span>
      {showName ? <span className="line-badge__name">{model.name}</span> : null}
    </span>
  );
}
