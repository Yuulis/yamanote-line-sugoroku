import { describe, expect, it } from "vitest";
import {
  beginItemTurn,
  createGame,
  createItemGame,
  playItemTurn,
  targetSegmentIds,
} from "../../src/features/game/engine";
import { ITEM_GAME_CONFIG } from "../../src/features/game/gameConfig";
import {
  buildResumePresentation,
  overwriteProgressText,
  resumeTurn,
} from "../../src/features/game/resumePresentation";
import { loadBundle } from "../e2e/fixtures/bundle";
import { itemScenario } from "../e2e/fixtures/itemScenarios";
import { LEGACY_CAPITAL_REGION_CONFIG } from "./fixtures/legacyConfig";

const { network } = await loadBundle("fixture");

describe("resume presentation", () => {
  it("plays the turn after the last completed turn", () => {
    const game = { ...createGame(LEGACY_CAPITAL_REGION_CONFIG, "resume-next", network), turn: 4 };
    const requiredIds = new Set(targetSegmentIds(game.config, network));

    expect(resumeTurn(game)).toBe(5);
    expect(buildResumePresentation(game, network, requiredIds)).toEqual({
      label: "つづきから　踏破 0/30・5ターン目から・新橋",
      nextTurn: 5,
      stationText: "新橋",
      completedCount: 0,
      requiredCount: 30,
    });
  });

  it("uses pending roll turn", () => {
    const game = createItemGame(ITEM_GAME_CONFIG, "resume-pending-roll", network);
    const pending = beginItemTurn(game, { items: [] }, network).state;
    const requiredIds = new Set(targetSegmentIds(pending.config, network));

    expect(pending.pending?.kind).toBe("roll");
    expect(resumeTurn(pending)).toBe(pending.pending?.turn);
    expect(buildResumePresentation(pending, network, requiredIds)).toMatchObject({
      label: "つづきから　踏破 0/30・1ターン目から・新橋",
      nextTurn: pending.pending?.turn,
    });
  });

  it("uses pending discard turn and arrival position", () => {
    const pendingGame = playItemTurn(itemScenario("discard", network), {}, network).state;
    if (pendingGame.pending?.kind !== "discard") throw new Error("Expected the engine-built discard decision");
    const requiredIds = new Set(targetSegmentIds(pendingGame.config, network));
    const { position } = pendingGame.pending;
    const expectedStation = network.stationsById.get(position.currentStationId)?.name ?? position.currentStationId;
    const completedCount = new Set(position.completedSegmentIds.filter((id) => requiredIds.has(id))).size;

    expect(position.currentStationId).not.toBe(pendingGame.currentStationId);
    expect(resumeTurn(pendingGame)).toBe(pendingGame.pending.turn);
    expect(buildResumePresentation(pendingGame, network, requiredIds)).toMatchObject({
      nextTurn: pendingGame.pending.turn,
      stationText: expectedStation,
      completedCount,
      label: `つづきから　踏破 ${completedCount}/${requiredIds.size}・${pendingGame.pending.turn}ターン目から・${expectedStation}`,
    });
  });

  it("counts unique completed target segments only", () => {
    const initial = createGame(LEGACY_CAPITAL_REGION_CONFIG, "resume-progress", network);
    const required = targetSegmentIds(initial.config, network);
    const game = {
      ...initial,
      completedSegmentIds: [required[0]!, required[0]!, required[1]!, "outside-target"],
    };
    const presentation = buildResumePresentation(game, network, new Set(required));

    expect(presentation.completedCount).toBe(2);
    expect(presentation.requiredCount).toBe(required.length);
    expect(presentation.label).toContain(`踏破 2/${required.length}`);
  });

  it("preserves the completed resume label", () => {
    const game = {
      ...createGame(LEGACY_CAPITAL_REGION_CONFIG, "resume-completed", network),
      status: "completed" as const,
      turn: 96,
    };
    const requiredIds = new Set(targetSegmentIds(game.config, network));

    expect(resumeTurn(game)).toBeNull();
    expect(buildResumePresentation(game, network, requiredIds).label).toBe("クリア結果を見る（96ターンでクリア）");
    expect(overwriteProgressText(game)).toBe("96ターンでクリア");
  });

  it("shares next-turn wording with overwrite confirmation", () => {
    const game = { ...createGame(LEGACY_CAPITAL_REGION_CONFIG, "resume-overwrite", network), turn: 4 };
    const requiredIds = new Set(targetSegmentIds(game.config, network));
    const presentation = buildResumePresentation(game, network, requiredIds);

    expect(presentation.label).toContain("5ターン目から");
    expect(overwriteProgressText(game)).toBe("5ターン目から再開");
  });
});
