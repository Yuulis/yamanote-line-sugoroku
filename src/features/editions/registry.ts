import { EXPECTED_STATION_COUNTS, MVP_GAME_CONFIG } from "../game/gameConfig";
import { SAVE_STORAGE_KEY } from "../game/store/persistence";
import type { Edition, EditionId, EditionRegistry } from "./types";

export const TOKYO_SUBURBAN_EDITION_ID = "tokyo-suburban";

export function saveKeyForEdition(id: EditionId): string {
  return id === TOKYO_SUBURBAN_EDITION_ID
    ? SAVE_STORAGE_KEY
    : `${SAVE_STORAGE_KEY}:${encodeURIComponent(id)}`;
}

export const EDITIONS: EditionRegistry = [
  {
    id: TOKYO_SUBURBAN_EDITION_ID,
    dataBaseUrl: `${import.meta.env.BASE_URL}data/`,
    config: MVP_GAME_CONFIG,
    expectedStationCounts: EXPECTED_STATION_COUNTS,
    display: {
      title: "山手線すごろく",
      subtitle: "東京近郊版",
      documentTitle: "山手線すごろく — 東京近郊版",
      ruleParagraphs: [
        ["新橋から出発し、東京近郊区間のJR線と対象の私鉄・地下鉄を乗り継ぐすごろくです。山手線外回り全30区間を踏破したあと、新橋に到着するとクリアです。サイコロの出目だけ駅を進み、到着駅で次に乗る路線を抽選します。山手線と他の路線がある駅では、3分の2の確率で山手線を選び、残りの確率を他の運行系統に均等に割り当てます。他の路線で方向を抽選するときは、山手線に近づく方向の抽選重みが反対方向の2倍になります。"],
        ["山手線は", { strong: "外回り" }, "に固定。他路線では毎回方向を抽選し、終点・エリア端で余った目は使いません。"],
        ["山手線の外回り全30区間を踏破して新橋に戻ればクリアです。山手線では新橋に着いた時点で停止し、他路線では新橋にちょうど止まる必要があります。"],
      ],
    },
    saveKey: saveKeyForEdition(TOKYO_SUBURBAN_EDITION_ID),
  },
];

export function getEdition(id: EditionId, editions: EditionRegistry = EDITIONS): Edition | undefined {
  return editions.find((edition) => edition.id === id);
}
