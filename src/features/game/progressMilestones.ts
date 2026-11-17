export const PROGRESS_THRESHOLDS = [10, 20, 25, 29, 30] as const;

export type ProgressThreshold = typeof PROGRESS_THRESHOLDS[number];

export interface ProgressCrossing {
  readonly turn: number;
  readonly threshold: ProgressThreshold;
}

export interface MilestoneFlash {
  readonly key: string;
  readonly threshold: Exclude<ProgressThreshold, 30>;
}

export function deriveProgressCrossings(
  records: readonly Readonly<{ turn: number; traversedSegmentIds: readonly string[] }>[],
  requiredSegmentIds: readonly string[],
): readonly ProgressCrossing[] {
  const required = new Set(requiredSegmentIds);
  const completed = new Set<string>();
  const crossings = new Map<number, ProgressThreshold>();
  let thresholdIndex = 0;

  for (const record of records) {
    let highestCrossed: ProgressThreshold | null = null;
    for (const segmentId of record.traversedSegmentIds) {
      if (!required.has(segmentId) || completed.has(segmentId)) continue;
      completed.add(segmentId);
      while (thresholdIndex < PROGRESS_THRESHOLDS.length
        && completed.size >= PROGRESS_THRESHOLDS[thresholdIndex]!) {
        highestCrossed = PROGRESS_THRESHOLDS[thresholdIndex]!;
        thresholdIndex += 1;
      }
    }
    if (highestCrossed === null) continue;
    const previous = crossings.get(record.turn);
    if (previous === undefined || highestCrossed > previous) crossings.set(record.turn, highestCrossed);
  }

  return [...crossings].map(([turn, threshold]) => ({ turn, threshold }));
}
