import { describe, expect, it } from "vitest";
import { composeMilestoneAnnouncement } from "../../src/features/game/milestoneAnnouncement";

describe("milestone live-region composition", () => {
  it("keeps the Japanese sentence separator before a lower milestone suffix", () => {
    const composed = composeMilestoneAnnouncement({
      baseText: "10ターン目：到着。踏破 10/30。",
      candidate: { key: "7:10:10", text: "10区間突破！" },
      surface: "panel",
      canPublish: true,
      consumed: false,
      held: null,
    });

    expect(composed.text).toMatch(/。10区間突破！$/);
    expect(composed.candidateKey).toBe("7:10:10");
  });

  it("composes the 30/30 goal sentence exactly once", () => {
    const sentence = "新橋に着けばクリア";
    const composed = composeMilestoneAnnouncement({
      baseText: "30/30。",
      candidate: { key: "7:30:30", text: sentence },
      surface: "panel",
      canPublish: true,
      consumed: false,
      held: null,
    });

    expect(composed.text.split(sentence)).toHaveLength(2);
    expect(composed.text).toBe(`30/30。${sentence}`);
  });

  it("holds a consumed suffix only across the same key, base text and mounted surface", () => {
    const baseText = "到着しました。";
    const candidate = { key: "7:20:20", text: "20区間突破！" };
    const held = { key: candidate.key, baseText, surface: "panel" as const };
    const input = { baseText, candidate, surface: "panel" as const, canPublish: true, consumed: true, held };
    const sameSurface = composeMilestoneAnnouncement(input);
    const changedSurface = composeMilestoneAnnouncement({ ...input, surface: "discard" });
    const changedBase = composeMilestoneAnnouncement({ ...input, baseText: "別の文。" });
    const changedKey = composeMilestoneAnnouncement({ ...input, candidate: { ...candidate, key: "8:20:20" } });

    expect(sameSurface).toEqual({ text: "到着しました。20区間突破！", candidateKey: candidate.key });
    expect(changedSurface).toEqual({ text: baseText, candidateKey: null });
    expect(changedBase).toEqual({ text: "別の文。", candidateKey: null });
    expect(changedKey).toEqual({ text: baseText, candidateKey: null });
  });

  it("keeps an existing hold on a blocked surface and withholds a fresh candidate", () => {
    const baseText = "到着しました。";
    const candidate = { key: "7:20:20", text: "20区間突破！" };
    const surface = "panel";
    const input = { baseText, candidate, surface, canPublish: false } as const;
    const held = { key: candidate.key, baseText, surface } as const;

    expect(composeMilestoneAnnouncement({ ...input, consumed: true, held }))
      .toEqual({ text: "到着しました。20区間突破！", candidateKey: candidate.key });
    expect(composeMilestoneAnnouncement({ ...input, consumed: false, held: null }))
      .toEqual({ text: baseText, candidateKey: null });
  });

  it("does not compose while a live-region surface is unavailable", () => {
    const composed = composeMilestoneAnnouncement({
      baseText: "到着しました。",
      candidate: { key: "7:20:20", text: "20区間突破！" },
      surface: null,
      canPublish: true,
      consumed: false,
      held: null,
    });

    expect(composed).toEqual({ text: "到着しました。", candidateKey: null });
  });
});
