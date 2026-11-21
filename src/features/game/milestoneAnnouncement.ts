import type {
  MilestoneAnnouncementCandidate,
  MilestoneAnnouncementSurface,
} from "./turnMomentPresentation";

export interface HeldMilestoneAnnouncement {
  readonly key: string;
  readonly baseText: string;
  readonly surface: MilestoneAnnouncementSurface;
}

export interface MilestoneAnnouncementLedger {
  sessionId: number | null;
  readonly consumed: Set<string>;
  held: HeldMilestoneAnnouncement | null;
}

export interface ComposeMilestoneAnnouncementInput {
  readonly baseText: string;
  readonly candidate: MilestoneAnnouncementCandidate | null;
  readonly surface: MilestoneAnnouncementSurface | null;
  readonly canPublish: boolean;
  readonly consumed: boolean;
  readonly held: HeldMilestoneAnnouncement | null;
}

export interface ComposedMilestoneAnnouncement {
  readonly text: string;
  readonly candidateKey: string | null;
}

/** Compose the candidate only when its status region can speak it, or keep a matching committed copy stable. */
export function composeMilestoneAnnouncement(
  input: ComposeMilestoneAnnouncementInput,
): ComposedMilestoneAnnouncement {
  const { baseText, candidate, surface, canPublish, consumed, held } = input;
  if (candidate === null || surface === null || baseText === "") {
    return { text: baseText, candidateKey: null };
  }

  const heldAcrossCommit = held !== null
    && held.key === candidate.key
    && held.baseText === baseText
    && held.surface === surface;
  if (!heldAcrossCommit && (consumed || !canPublish)) {
    return { text: baseText, candidateKey: null };
  }

  return {
    text: `${baseText.replace(/。$/, "")}。${candidate.text}`,
    candidateKey: candidate.key,
  };
}
