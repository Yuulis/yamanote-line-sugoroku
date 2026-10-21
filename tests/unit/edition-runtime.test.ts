import { describe, expect, it } from "vitest";
import { networkFromData } from "../../src/features/game/networkFromData";
import { FIXTURE_EDITION_A, FIXTURE_EDITION_B, fixtureRailwayData } from "./fixtures/editions";

describe("edition runtime config", () => {
  it("builds a network with the selected config and station expectations", () => {
    expect(networkFromData(
      fixtureRailwayData("fixture-data-a"),
      FIXTURE_EDITION_A.config,
      FIXTURE_EDITION_A.expectedStationCounts,
    ).ok).toBe(true);
  });

  it("rejects data when the selected edition station expectations do not match", () => {
    const result = networkFromData(
      fixtureRailwayData("fixture-data-a"),
      FIXTURE_EDITION_A.config,
      { [FIXTURE_EDITION_A.config.targetServiceId]: 99 },
    );
    expect(result.ok).toBe(false);
  });

  it("accepts the second edition's distinct valid config", () => {
    expect(networkFromData(
      fixtureRailwayData("fixture-data-b"),
      FIXTURE_EDITION_B.config,
      FIXTURE_EDITION_B.expectedStationCounts,
    )).toMatchObject({ ok: true });
  });
});
