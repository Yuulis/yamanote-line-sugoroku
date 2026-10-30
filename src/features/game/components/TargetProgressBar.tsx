import { progressSegments } from "../hudPresentation";

export interface TargetProgressBarProps {
  completed: number;
  required: number;
  label?: string;
}

/** ARIA values use the same clamped counts as the drawn segments, so the two never disagree. */
export function TargetProgressBar({ completed, required, label = "山手線の踏破区間" }: TargetProgressBarProps): React.JSX.Element {
  const segments = progressSegments(completed, required);
  const safeRequired: number = segments.length;
  const safeCompleted: number = segments.filter((segment) => segment.completed).length;
  return (
    <div
      className="target-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeRequired}
      aria-valuenow={safeCompleted}
      aria-valuetext={`${safeCompleted}/${safeRequired}`}
    >
      <div className="target-progress__segments" aria-hidden="true">
        {segments.map((segment) => (
          <span
            className={`target-progress__segment${segment.completed ? " target-progress__segment--completed" : ""}`}
            key={segment.index}
          />
        ))}
      </div>
    </div>
  );
}
