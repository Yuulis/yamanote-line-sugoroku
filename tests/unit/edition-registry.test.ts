import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MVP_GAME_CONFIG, EXPECTED_STATION_COUNTS } from "../../src/features/game/gameConfig";
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
    expect(edition.config).toEqual(MVP_GAME_CONFIG);
    expect(edition.expectedStationCounts).toEqual(EXPECTED_STATION_COUNTS);
    const indexHtml = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
    expect(indexHtml).toContain(`<title>${edition.display.documentTitle}</title>`);
    expect(edition.display).toEqual({
      title: "山手線すごろく",
      subtitle: "東京近郊版",
      documentTitle: "山手線すごろく — 東京近郊版",
      ruleParagraphs: [
        ["新橋から出発し、東京近郊区間のJR線と対象の私鉄・地下鉄を乗り継ぐすごろくです。山手線外回り全30区間を踏破したあと、新橋に到着するとクリアです。サイコロの出目だけ駅を進み、到着駅で次に乗る路線を抽選します。山手線と他の路線がある駅では、3分の2の確率で山手線を選び、残りの確率を他の運行系統に均等に割り当てます。他の路線で方向を抽選するときは、山手線に近づく方向の抽選重みが反対方向の2倍になります。"],
        ["山手線は", { strong: "外回り" }, "に固定。他路線では毎回方向を抽選し、終点・エリア端で余った目は使いません。"],
        ["山手線の外回り全30区間を踏破して新橋に戻ればクリアです。山手線では新橋に着いた時点で停止し、他路線では新橋にちょうど止まる必要があります。"],
      ],
    });
  });
});
