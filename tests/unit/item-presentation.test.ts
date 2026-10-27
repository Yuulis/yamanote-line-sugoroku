import { describe, expect, it } from "vitest";
import {
  adjustedPips, directionGuidance, ITEM_DESCRIPTIONS, itemTiming, itemUnavailableLabel,
} from "../../src/features/game/itemPresentation";

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
});
