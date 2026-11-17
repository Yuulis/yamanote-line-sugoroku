import { describe, expect, it } from "vitest";
import { deriveProgressCrossings } from "../../src/features/game/progressMilestones";
import {
  createToastQueue, progressMilestoneToast, toastQueueReducer, visibleToasts,
  type ToastInput,
} from "../../src/features/game/toastQueue";

const requiredIds = Array.from({ length: 30 }, (_value, index) => `segment-${index}`);

describe("target progress milestones", () => {
  it("records exact threshold hits in chronological order", () => {
    const records = requiredIds.map((segmentId, index) => ({ turn: index + 1, traversedSegmentIds: [segmentId] }));
    expect(deriveProgressCrossings(records, requiredIds)).toEqual([10, 20, 25, 29, 30].map((threshold) => ({
      turn: threshold, threshold,
    })));
  });

  it("keeps only the highest threshold crossed during one turn", () => {
    expect(deriveProgressCrossings([{ turn: 7, traversedSegmentIds: requiredIds.slice(0, 25) }], requiredIds))
      .toEqual([{ turn: 7, threshold: 25 }]);
  });

  it("counts required segments once and ignores unknown or repeated IDs", () => {
    const records = [
      { turn: 1, traversedSegmentIds: [requiredIds[0]!, requiredIds[0]!, "unknown"] },
      { turn: 2, traversedSegmentIds: [requiredIds[0]!, ...requiredIds.slice(1, 9)] },
      { turn: 3, traversedSegmentIds: [requiredIds[8]!, requiredIds[9]!] },
    ];
    expect(deriveProgressCrossings(records, [...requiredIds, requiredIds[0]!]))
      .toEqual([{ turn: 3, threshold: 10 }]);
  });

  it("reports only 30 when one turn completes every required segment", () => {
    expect(deriveProgressCrossings([{ turn: 12, traversedSegmentIds: requiredIds }], requiredIds))
      .toEqual([{ turn: 12, threshold: 30 }]);
  });

  it.each([
    [10, -5, "10区間突破！"], [20, -4, "20区間突破！あと10区間"],
    [25, -3, "あと5区間！"], [29, -2, "あと1区間！"],
  ] as const)("builds the %i-segment milestone toast", (threshold, eventIndex, text) => {
    expect(progressMilestoneToast(7, { turn: 9, threshold })).toEqual({
      key: `7:milestone:target-segments:${threshold}`, sessionId: 7, turn: 9, eventIndex,
      text, tone: "good", sticky: false,
    });
  });

  it("queues a milestone before same-turn items while reserving the sticky slot", () => {
    const milestone = progressMilestoneToast(7, { turn: 9, threshold: 10 });
    const item = (eventIndex: number): ToastInput => ({
      key: `7:9:${eventIndex}`, sessionId: 7, turn: 9, eventIndex, text: "item", tone: "neutral", sticky: false,
    });
    let state = toastQueueReducer(createToastQueue(7), {
      type: "enqueue", scope: 7, inputs: [milestone, item(0), item(1)],
    });
    state = toastQueueReducer(state, { type: "saveFailed" });
    expect(visibleToasts(state).map(({ key }) => key)).toEqual([
      milestone.key, "7:9:0", "7:save-failed",
    ]);
  });
});
