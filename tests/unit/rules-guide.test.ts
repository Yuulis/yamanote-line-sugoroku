import { describe, expect, it } from "vitest";
import {
  ANIMATION_SPEEDS,
  CLASSIC_GAME_CONFIG,
  ITEM_GAME_CONFIG,
} from "../../src/features/game/gameConfig";
import { PRESENTATION_LEVELS } from "../../src/features/game/gameSettings";
import { ITEM_DESCRIPTIONS, itemTiming } from "../../src/features/game/itemPresentation";
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
    expect(model.items).toEqual([]);
  });

  it("renders only configured item kinds", () => {
    const model = buildRulesGuide(
      itemPolicyWith({ beneficialKinds: ["double", "rapid"], harmfulKinds: ["detour"] }),
    );
    const noHarm = buildRulesGuide(itemPolicyWith({ beneficialKinds: ["double"], harmfulChancePercent: 0 }));

    expect(model.items.map((item) => item.kind)).toEqual(["double", "rapid", "detour"]);
    expect(model.items[0]).toEqual({
      kind: "double",
      name: ITEM_DESCRIPTIONS.double.name,
      effect: ITEM_DESCRIPTIONS.double.effect,
      timing: itemTiming("double"),
    });
    expect(noHarm.items.map((item) => item.kind)).toEqual(["double"]);
    expect(buildRulesGuide(ITEM_GAME_CONFIG).items).toHaveLength(
      BASE_ITEM_POLICY.beneficialKinds.length + BASE_ITEM_POLICY.harmfulKinds.length,
    );
  });

  it("uses automatic timing for harmful items", () => {
    const model = buildRulesGuide(ITEM_GAME_CONFIG);
    const byKind = new Map(model.items.map((item) => [item.kind, item]));

    for (const kind of BASE_ITEM_POLICY.harmfulKinds) {
      expect(byKind.get(kind)?.timing).toBe("拾うと自動で発動");
    }
    expect(byKind.get("roll-adjust")?.timing).toBe("出目を見てから使う");
    expect(byKind.get("delay-certificate")?.timing).toBe("持っているだけで効く");
    expect(byKind.get("route-ticket")?.timing).toBe("サイコロを振る前に使う");
  });

  it("includes target count only when supplied", () => {
    const withCount = text(buildRulesGuide(ITEM_GAME_CONFIG, { targetSegmentCount: 12 }), "goal");
    const without = text(buildRulesGuide(ITEM_GAME_CONFIG), "goal");

    expect(withCount).toContain("全12区間");
    expect(without).toContain("すべての区間");
    expect(without).not.toMatch(/\d+区間/);
  });

  it("uses supplied names and the goal arrival policy in the goal section", () => {
    const names = { targetServiceName: "テスト環状線", startStationName: "起点駅", targetDirectionLabel: "右回り" };
    const goal = (config: GameConfig): string => text(buildRulesGuide(config, names), "goal");
    const truncate = goal(ITEM_GAME_CONFIG);

    expect(truncate).toContain("起点駅からスタートします");
    expect(truncate).toContain("テスト環状線（右回り）の");
    expect(truncate).toContain("踏破を終えていれば、テスト環状線では起点駅に着いた時点で止まってクリア");
    expect(truncate).toContain("ほかの路線では、移動の最後にちょうど起点駅に止まる必要");
    expect(truncate).toContain("終点や収録範囲の端に着いたときは、そこで止まります。残りの出目は使いません");
    expect(goal(configWith({ goalArrivalPolicy: "exact-stop" }))).toContain("踏破を終えていれば、どの路線でも、移動の最後にちょうど起点駅に止まる");
    expect(goal(configWith({ goalArrivalPolicy: "pass-through" }))).toContain("踏破を終えていれば、どの路線でも、起点駅に着いた時点で止まってクリア");
    expect(text(buildRulesGuide(ITEM_GAME_CONFIG, names), "lottery")).toContain("テスト環状線では、いつも右回りに進みます");
  });

  it("never hard-codes proper names when none are supplied", () => {
    const model = buildRulesGuide(ITEM_GAME_CONFIG);
    const all = [...model.sections.flatMap((section) => section.paragraphs), ...model.shortcuts].join("\n");

    for (const name of ["新橋", "山手線", "外回り"]) expect(all).not.toContain(name);
    expect(text(model, "goal")).toContain("出発駅");
  });

  it("says the direction is redrawn at every arrival station whatever the weights", () => {
    const weighted = text(buildRulesGuide(ITEM_GAME_CONFIG), "lottery");
    const equal = text(buildRulesGuide(configWith({ directionLottery: { towardTargetWeight: 1 } })), "lottery");
    const redraw = "乗換駅でなくても、移動を終えた駅で進む向きを抽選し直します";

    expect(weighted).toContain(`目標路線以外の路線では、${redraw}`);
    expect(equal).toContain(`目標路線以外の路線では、${redraw}`);
    expect(equal).toContain("目標路線以外の路線では、進む向きはどちらも同じ確率です。");
  });

  it("omits duration sentences when harmful items cannot occur", () => {
    const noHarm = text(buildRulesGuide(itemPolicyWith({ harmfulChancePercent: 0 })), "items");
    const harmful = text(buildRulesGuide(ITEM_GAME_CONFIG), "items");

    expect(noHarm).not.toContain("ターン後に効き");
    expect(noHarm).not.toContain("の間続き");
    expect(harmful).toContain("ターン後に効き");
  });

  it("says that the current line can be drawn again", () => {
    expect(text(buildRulesGuide(ITEM_GAME_CONFIG), "lottery")).toContain("いま乗っている路線も候補に入ります");
  });

  it("uses settings labels from their existing tables", () => {
    const controls = text(buildRulesGuide(ITEM_GAME_CONFIG), "controls");

    expect(controls).toContain(ANIMATION_SPEEDS.map(({ label }) => label).join("→"));
    expect(controls).toContain(PRESENTATION_LEVELS.map(({ label }) => label).join("→"));
    expect(controls).toContain("「おまかせ」をONにすると");
    expect(controls).toContain("ほかのタブに切り替えたときは止まります");
    expect(controls).toContain("選び終えるまで待ちます");
    expect(controls).toContain("動きを減らしているときは、アニメーションは省略され、「速度」と「演出」は切り替えられません");
    expect(controls).toContain("「追尾」");
  });

  it("overrides delay and suspension durations from config", () => {
    const changed = buildRulesGuide(itemPolicyWith({ delayTurns: 2, suspensionTurns: 7 }));
    const effect = (model: RulesGuideModel, kind: string): string | undefined =>
      model.items.find((item) => item.kind === kind)?.effect;

    expect(effect(changed, "delay")).toBe("2ターン後の出目が1");
    expect(effect(changed, "suspension")).toBe("その路線が7ターン乗れない");
    expect(effect(buildRulesGuide(ITEM_GAME_CONFIG), "delay")).toBe(ITEM_DESCRIPTIONS.delay.effect);
    expect(effect(buildRulesGuide(ITEM_GAME_CONFIG), "suspension")).toBe(ITEM_DESCRIPTIONS.suspension.effect);
  });

  it("describes saving and lists the shortcuts", () => {
    const model = buildRulesGuide(ITEM_GAME_CONFIG);

    expect(text(model, "save")).toContain("自動で保存されます");
    expect(text(model, "save")).toContain("タイトル画面の「つづきから」で再開できます");
    expect(model.shortcuts).toEqual([
      "Space / Enter：サイコロを振る",
      "S / Escape：移動の演出をスキップ",
      "Escape：選んだアイテムの選択を解除",
      "Escape：出目調整の画面で「そのまま」を選ぶ",
    ]);
  });
});
