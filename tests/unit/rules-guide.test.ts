import { describe, expect, it } from "vitest";
import {
  CLASSIC_GAME_CONFIG,
  ITEM_GAME_CONFIG,
} from "../../src/features/game/gameConfig";
import {
  buildRulesGuide,
  type RulesGuideModel,
  type RulesSectionId,
} from "../../src/features/game/rulesGuide";
import type { GameConfig, ItemPolicy } from "../../src/types/network";

const BASE_ITEM_POLICY = ITEM_GAME_CONFIG.itemPolicy as ItemPolicy;

function configWith(overrides: Partial<GameConfig>): GameConfig {
  return { ...ITEM_GAME_CONFIG, ...overrides };
}

function itemPolicyWith(overrides: Partial<ItemPolicy>): GameConfig {
  return configWith({ itemPolicy: { ...BASE_ITEM_POLICY, ...overrides } });
}

function text(model: RulesGuideModel, id: RulesSectionId): string {
  const section = model.sections.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Missing section ${id}`);
  return section.paragraphs.join("\n");
}

describe("rules guide model", () => {
  it("lists the five sections in a stable order", () => {
    const model = buildRulesGuide(ITEM_GAME_CONFIG);

    expect(model.sections.map((section) => section.id)).toEqual([
      "goal",
      "lottery",
      "items",
      "controls",
      "save",
    ]);
    expect(model.sections.every((section) => section.heading.length > 0)).toBe(true);
  });

  it("derives share lottery figures from config", () => {
    const changed = buildRulesGuide(
      configWith({ serviceLottery: { ...ITEM_GAME_CONFIG.serviceLottery, target: { kind: "share", numerator: 3, denominator: 5 } } }),
    );
    const other = buildRulesGuide(
      configWith({ serviceLottery: { ...ITEM_GAME_CONFIG.serviceLottery, target: { kind: "share", numerator: 4, denominator: 7 } } }),
    );

    expect(text(changed, "lottery")).toContain("5分の3");
    expect(text(other, "lottery")).toContain("7分の4");
    expect(text(changed, "lottery")).not.toContain("2分の1");
  });

  it("describes weighted lottery without a fixed probability", () => {
    const model = buildRulesGuide(
      configWith({ serviceLottery: { ...ITEM_GAME_CONFIG.serviceLottery, target: { kind: "weight", weight: 4 } } }),
    );
    const lottery = text(model, "lottery");

    const neutral = text(
      buildRulesGuide(
        configWith({ serviceLottery: { ...ITEM_GAME_CONFIG.serviceLottery, target: { kind: "weight", weight: 1 } } }),
      ),
      "lottery",
    );

    expect(lottery).toContain("ほかの路線の4倍の重み");
    expect(lottery).not.toContain("分の");
    expect(lottery).not.toContain("%");
    expect(neutral).toContain("ほかの路線と同じ重み");
    expect(neutral).not.toContain("倍");
  });

  it("handles unequal route weights and direction exceptions", () => {
    const unequal = text(
      buildRulesGuide(
        configWith({
          serviceLottery: { kindWeights: { local: 2, rapid: 1 }, target: { kind: "share", numerator: 3, denominator: 5 } },
          directionLottery: { towardTargetWeight: 4, awayFromTargetWeight: 3 },
        }),
      ),
      "lottery",
    );
    const equal = text(
      buildRulesGuide(
        configWith({
          serviceLottery: { kindWeights: { local: 4, rapid: 4 }, target: { kind: "share", numerator: 3, denominator: 5 } },
          directionLottery: { towardTargetWeight: 1 },
        }),
      ),
      "lottery",
    );
    const awayDefault = text(
      buildRulesGuide(configWith({ directionLottery: { towardTargetWeight: 6 } })),
      "lottery",
    );

    expect(unequal).toContain("目標路線以外の路線は、各駅停車と快速が2:1の重み");
    expect(unequal).toContain("目標路線以外の路線では、目標路線に近づく向きと遠ざかる向きが4:3の重み");
    expect(unequal).toContain("距離が同じ");
    expect(unequal).toContain("向きが1つ");
    expect(equal).toContain("目標路線以外の路線どうしは、同じ確率");
    expect(equal).not.toContain("各駅停車と快速");
    expect(equal).toContain("目標路線以外の路線では、進む向きはどちらも同じ確率です");
    expect(awayDefault).toContain("6:1");
  });

  it("derives pickup and conditional harmful probability", () => {
    const model = buildRulesGuide(itemPolicyWith({ dropChancePerMille: 125, harmfulChancePercent: 40 }));
    const noHarm = buildRulesGuide(itemPolicyWith({ harmfulChancePercent: 0 }));
    const noHarmKinds = buildRulesGuide(itemPolicyWith({ harmfulKinds: [] }));

    expect(text(model, "items")).toContain("12.5%");
    expect(text(model, "items")).toContain("拾ったアイテムのうち40%は不利なアイテムで、持ち物には入らず自動で発動します");
    expect(text(noHarm, "items")).not.toContain("拾ったアイテムのうち");
    expect(text(noHarmKinds, "items")).not.toContain("拾ったアイテムのうち");
  });

  it("derives capacity activation limit and durations", () => {
    const model = buildRulesGuide(
      itemPolicyWith({ inventoryCapacity: 4, maxActiveItemsPerTurn: 2, delayTurns: 2, suspensionTurns: 7 }),
    );
    const items = text(model, "items");

    expect(items).toContain("有利なアイテムは4個まで持てます");
    expect(items).toContain("1ターンに2個まで");
    expect(items).toContain("遅延は拾ってから2ターン後");
    expect(items).toContain("運休は7ターン");
  });

  it("uses the supplied target service name in lottery sentences", () => {
    const named = text(buildRulesGuide(ITEM_GAME_CONFIG, { targetServiceName: "テスト環状線" }), "lottery");
    const fallback = text(buildRulesGuide(ITEM_GAME_CONFIG), "lottery");

    expect(named).toContain("テスト環状線");
    expect(named).not.toContain("目標路線");
    expect(fallback).toContain("目標路線");
  });

  it("keeps an unavailable items section when the config has no item policy", () => {
    const model = buildRulesGuide(CLASSIC_GAME_CONFIG);

    expect(text(model, "items")).toBe("このルールではアイテムはありません");
  });
});
