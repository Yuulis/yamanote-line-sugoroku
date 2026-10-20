import type { GameConfig, ServiceId } from "../../types/network";

export type EditionId = string;

export type DeepReadonly<T> = {
  readonly [Key in keyof T]: DeepReadonly<T[Key]>;
};

export type EditionTextPart = string | Readonly<{ strong: string }>;

export interface EditionDisplay {
  readonly title: string;
  readonly subtitle: string;
  readonly documentTitle: string;
  readonly ruleParagraphs: readonly (readonly EditionTextPart[])[];
}

export interface Edition {
  readonly id: EditionId;
  /** Includes Vite BASE_URL and ends in "/". */
  readonly dataBaseUrl: string;
  readonly config: DeepReadonly<GameConfig>;
  readonly expectedStationCounts: Readonly<Partial<Record<ServiceId, number>>>;
  readonly display: EditionDisplay;
  readonly saveKey: string;
}

/** The first entry is the initial selection on each page load. */
export type EditionRegistry = readonly [Edition, ...Edition[]];
