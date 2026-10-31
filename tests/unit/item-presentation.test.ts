import { describe, expect, it } from "vitest";
import {
  adjustedPips, directionGuidance, ITEM_DESCRIPTIONS, ITEM_REPLACEMENT_NOTE, ITEM_SHORT_NAMES,
  itemHint, itemTiming, itemTone, itemUnavailableLabel,
} from "../../src/features/game/itemPresentation";
import { BENEFICIAL_ITEM_KINDS, HARMFUL_ITEM_KINDS, type ItemKind } from "../../src/types/network";

const ITEM_KINDS: readonly ItemKind[] = [...BENEFICIAL_ITEM_KINDS, ...HARMFUL_ITEM_KINDS];

describe("item presentation", () => {
  it("uses the approved Japanese item names and one-line effects", () => {
    expect(ITEM_DESCRIPTIONS["route-ticket"]).toEqual({
      name: "路線指定券", effect: "今いる駅で乗る路線を選べる（向きは抽選）",
    });
    expect(ITEM_DESCRIPTIONS["direction-ticket"]).toEqual({
      name: "方向指定券", effect: "山手線以外の路線で進む向きを選べる",
    });
    expect(ITEM_DESCRIPTIONS["roll-adjust"]).toEqual({ name: "出目調整券", effect: "出目を見てから ±1 できる" });
    expect(ITEM_DESCRIPTIONS.double).toEqual({ name: "倍速券", effect: "この回の出目が2倍になる" });
    expect(ITEM_DESCRIPTIONS.rapid).toEqual({ name: "快速券", effect: "2路線以上が止まる駅だけを1駅と数えて進む" });
    expect(ITEM_DESCRIPTIONS.deadhead).toEqual({ name: "回送列車", effect: "いちばん近い山手線の駅へ移る（サイコロは振らない）" });
    expect(ITEM_DESCRIPTIONS["delay-certificate"]).toEqual({
      name: "遅延証明書", effect: "持っているだけで、次に拾う不利なアイテムを1回打ち消す（枠を1つ使う）",
    });
    expect(ITEM_DESCRIPTIONS.delay.effect).toBe("3ターン後の出目が1");
    expect(ITEM_DESCRIPTIONS.suspension.effect).toBe("その路線が5ターン乗れない");
    expect(ITEM_DESCRIPTIONS.detour.effect).toBe("次の乗換駅で別の路線へ");
    expect(ITEM_DESCRIPTIONS.oversleep.effect).toBe("次のターンは終点まで、環状線は6駅");
  });

  it("describes item timing and disabled reasons for players", () => {
    expect(itemTiming("delay-certificate")).toBe("持っているだけで効く");
    expect(itemTiming("roll-adjust")).toBe("出目を見てから使う");
    expect(itemTiming("double")).toBe("サイコロを振る前に使う");
    expect(itemUnavailableLabel("fixed-direction")).toBe("山手線は向きが固定");
    expect(itemUnavailableLabel("single-direction")).toBe("この駅では進める向きが1つです");
    expect(itemUnavailableLabel("suspended-route")).toBe("運休中で選べない");
    expect(itemUnavailableLabel("forced-turn")).toBe("遅延・寝過ごしのターンは使えない");
    expect(itemUnavailableLabel("item-already-selected")).toBe("ほかのアイテムを選択中");
  });

  it("reports hop guidance ties and calculates a single legal adjustment", () => {
    expect(directionGuidance(4, true, true)).toBe("次の駅から山手線まで4駅。山手線に近づく方向");
    expect(directionGuidance(4, false, true)).toBe("次の駅から山手線まで4駅。山手線から遠ざかる方向");
    expect(directionGuidance(4, false, false)).toBe("次の駅から山手線まで4駅。短い方向はありません");
    expect(adjustedPips(2, -1)).toBe(1);
    expect(adjustedPips(4, 1)).toBe(5);
  });

  it("provides the exact short names for every item kind", () => {
    expect(ITEM_SHORT_NAMES).toEqual({
      "route-ticket": "路線指定", "direction-ticket": "方向指定", "roll-adjust": "出目調整",
      double: "倍速", rapid: "快速", deadhead: "回送", "delay-certificate": "証明書",
      delay: "遅延", suspension: "運休", detour: "寄り道", oversleep: "寝過ごし",
    });
  });

  it("marks harmful item kinds as bad and all others as good", () => {
    for (const kind of ITEM_KINDS) expect(itemTone(kind), kind).toBe(HARMFUL_ITEM_KINDS.includes(kind as typeof HARMFUL_ITEM_KINDS[number]) ? "bad" : "good");
    expect(itemTone("delay")).toBe("bad");
    expect(itemTone("rapid")).toBe("good");
    expect(itemTone("delay-certificate")).toBe("good");
  });

  it("provides rapid and deadhead hints only for their matching conditions", () => {
    expect(itemHint("rapid", { rapidHeadsTowardYamanote: true, deadheadRecommended: true })).toEqual({
      text: "おすすめ：現在の向きは山手線に近づきます", caution: false,
    });
    expect(itemHint("rapid", { rapidHeadsTowardYamanote: false, deadheadRecommended: true })).toEqual({
      text: "注意：現在の向きは山手線から遠ざかります", caution: true,
    });
    expect(itemHint("deadhead", { rapidHeadsTowardYamanote: true, deadheadRecommended: false })).toEqual({
      text: "おすすめしない：山手線の駅にいるため、同じ駅にとどまり1ターン使います", caution: true,
    });
    expect(itemHint("deadhead", { rapidHeadsTowardYamanote: true, deadheadRecommended: true })).toBeNull();
    for (const kind of ITEM_KINDS.filter((candidate) => candidate !== "rapid" && candidate !== "deadhead")) {
      expect(itemHint(kind, { rapidHeadsTowardYamanote: true, deadheadRecommended: false }), kind).toBeNull();
    }
  });

  it("provides the draft replacement note", () => {
    expect(ITEM_REPLACEMENT_NOTE).toBe("ほかのアイテムを選択中です。使うと置き換わります。");
  });
});
