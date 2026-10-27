import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_CONFIG, EXPECTED_STATION_COUNTS } from "../../src/features/game/gameConfig";
import { SAVE_STORAGE_KEY } from "../../src/features/game/store/persistence";
import {
  EDITIONS,
  getEdition,
  saveKeyForEdition,
  TOKYO_SUBURBAN_EDITION_ID,
} from "../../src/features/editions/registry";
import type { EditionRegistry } from "../../src/features/editions/types";

describe("edition registry", () => {
  it("has one valid production edition with stable identifiers and keys", () => {
    expect(EDITIONS).toHaveLength(1);
    expect(EDITIONS[0]?.id).toBe(TOKYO_SUBURBAN_EDITION_ID);
    expect(EDITIONS.every((edition) => edition.id.length > 0)).toBe(true);
    expect(new Set(EDITIONS.map((edition) => edition.id)).size).toBe(EDITIONS.length);
    expect(new Set(EDITIONS.map((edition) => edition.saveKey)).size).toBe(EDITIONS.length);
    for (const edition of EDITIONS) {
      expect(edition.dataBaseUrl.endsWith("/")).toBe(true);
      expect(edition.saveKey).toBe(saveKeyForEdition(edition.id));
    }
  });

  it("looks up known IDs and leaves unknown IDs unresolved", () => {
    expect(getEdition(TOKYO_SUBURBAN_EDITION_ID)).toBe(EDITIONS[0]);
    expect(getEdition("unknown-edition")).toBeUndefined();
  });

  it("keeps the legacy slot tied to the permanent Tokyo suburban ID", () => {
    expect(saveKeyForEdition(TOKYO_SUBURBAN_EDITION_ID)).toBe(SAVE_STORAGE_KEY);
    expect(saveKeyForEdition("edition one")).toBe(`${SAVE_STORAGE_KEY}:edition%20one`);
    expect(saveKeyForEdition("edition-two")).not.toBe(saveKeyForEdition("edition-three"));

    const reordered = [...EDITIONS].reverse() as unknown as EditionRegistry;
    expect(getEdition(TOKYO_SUBURBAN_EDITION_ID, reordered)?.saveKey).toBe(SAVE_STORAGE_KEY);
  });

  it("preserves the current config, data path, and title-screen copy", () => {
    const edition = EDITIONS[0]!;
    expect(edition.dataBaseUrl).toBe(`${import.meta.env.BASE_URL}data/`);
    expect(edition.config).toBe(DEFAULT_GAME_CONFIG);
    expect(edition.config.rulesetVersion).toBe("tokyo-suburban-items-1");
    expect(edition.expectedStationCounts).toEqual(EXPECTED_STATION_COUNTS);
    const indexHtml = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
    expect(indexHtml).toContain(`<title>${edition.display.documentTitle}</title>`);
    expect(edition.display).toEqual({
      title: "山手線すごろく",
      subtitle: "東京近郊版",
      documentTitle: "山手線すごろく — 東京近郊版",
      logoUrl: `${import.meta.env.BASE_URL}logo.svg`,
      ruleParagraphs: [
        ["新橋から出発し、東京近郊の路線を乗り継ぎます。山手線は", { strong: "外回り" }, "に固定。全30区間を踏破して新橋に着くとクリアです。山手線では新橋で止まり、他路線ではちょうど止まる必要があります。終点・エリア端・系統の端で余った目は使いません。"],
        ["到着駅で次の路線を抽選します。山手線が他路線と候補に並ぶときは", { strong: "山手線が1/2" }, "、残りを他の運行系統で等分します。他路線の方向抽選は、山手線に近づく方向と反対方向が3：2です。同距離なら均等です。"],
        ["ターンの最後に止まった駅で", { strong: "30%の確率でアイテム" }, "を拾い、その30%は不利な効果です（クリア時を除く）。アイテムは3つまで持てます。満杯のときは、新しく拾ったものと合わせた4つから1つを捨てます。使えるのは1ターンに1つで、サイコロを振る前に選びます。出目調整券だけは出目を見てから使います。"],
      ],
    });
  });
});
