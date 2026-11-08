import { DEFAULT_ANIMATION_SPEED, type AnimationSpeedId } from "./gameConfig";

export type PresentationLevel = "all" | "important" | "none";

export interface GameSettings {
  readonly speedId: AnimationSpeedId;
  readonly follow: boolean;
  readonly presentationLevel: PresentationLevel;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  speedId: DEFAULT_ANIMATION_SPEED,
  follow: true,
  presentationLevel: "all",
};

export const PRESENTATION_LEVELS = [
  { id: "all", label: "すべて" },
  { id: "important", label: "重要なときだけ" },
  { id: "none", label: "なし" },
] as const satisfies readonly { id: PresentationLevel; label: string }[];

export function nextPresentationLevel(level: PresentationLevel): PresentationLevel {
  switch (level) {
    case "all":
      return "important";
    case "important":
      return "none";
    case "none":
      return "all";
  }
}
