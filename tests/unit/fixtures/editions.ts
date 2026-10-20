import { EDITIONS, saveKeyForEdition } from "../../../src/features/editions/registry";
import type { Edition, EditionRegistry } from "../../../src/features/editions/types";
import { M_LOOP, M_START, multiConfig } from "./multiService";

const base = EDITIONS[0]!;

export const FIXTURE_EDITION_A: Edition = {
  ...base,
  id: "fixture-a",
  dataBaseUrl: "/fixture-a/",
  config: multiConfig(),
  expectedStationCounts: { [M_LOOP]: 6 },
  saveKey: saveKeyForEdition("fixture-a"),
  display: { ...base.display, title: "Fixture A", subtitle: "試験版A", documentTitle: "Fixture A" },
};

export const FIXTURE_EDITION_B: Edition = {
  ...FIXTURE_EDITION_A,
  id: "fixture-b",
  dataBaseUrl: "/fixture-b/",
  config: { ...multiConfig(), startStationId: "a", targetDirection: -1 },
  saveKey: saveKeyForEdition("fixture-b"),
  display: { ...base.display, title: "Fixture B", subtitle: "試験版B", documentTitle: "Fixture B" },
};

// Keep this value tied to the same test network while varying config and slots.
void M_START;
export const FIXTURE_EDITIONS: EditionRegistry = [FIXTURE_EDITION_A, FIXTURE_EDITION_B];
