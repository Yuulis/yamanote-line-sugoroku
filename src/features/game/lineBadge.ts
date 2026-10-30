import { contrastRatio, parseHexColor } from "./uiContrast";
import type { PresentationResolver } from "./presentationResolver";

export interface LineBadgeModel {
  groupId: string;
  code: string | null;
  color: string | null;
  name: string;
  textColor: "#000000" | "#ffffff" | null;
}

export const LINE_BADGE_CODES: Readonly<Record<string, string>> = {
  // 東日本旅客鉄道: https://www.jreast.co.jp/press/2016/20160402.pdf
  "jr-yamanote": "JY",
  "jr-keihin-tohoku": "JK",
  "jr-chuo-sobu-local": "JB",
  "jr-chuo-rapid": "JC",
  // jr-chuo-takao-fujino: Multi-code. The service actually runs Takao–Shiojiri (38 stations) despite the display name: Takao–Ōtsuki is JC (JC24–32), Hatsukari–Shiojiri is CO (CO33–61). Tokyo-side JC chosen; CO noted.
  "jr-chuo-takao-fujino": "JC",
  "jr-ome": "JC",
  "jr-itsukaichi": "JC",
  // jr-saikyo: Partial. Ōsaki–Ōmiya is JA (JA08–26); the service continues on the Kawagoe Line Nisshin–Kawagoe, which has no JA numbers.
  "jr-saikyo": "JA",
  // jr-sotetsu-direct: Multi-code. Service Shinjuku–Hazawa yokohama-kokudai: JA north of Ōsaki, JS Ōsaki–Musashi-Kosugi; Hazawa yokohama-kokudai carries only Sotetsu SO51. Tokyo-side JA chosen. The JA/JS split for through trains is stated by Wikipedia; the codes themselves are in the JR 2016 release.
  "jr-sotetsu-direct": "JA",
  // jr-keiyo: Partial. Tokyo–Chiba-minato is JE (JE01–17); the service terminus Soga is not JE-numbered.
  "jr-keiyo": "JE",
  "jr-musashino": "JM",
  // jr-musashino-takaya: Judgement (user-confirmed 2026-10-30: JM). Two-station Musashino through service on the Keiyō Takaya branch: Nishi-Funabashi is JM10, Ichikawa-shiohama is Keiyō JE09. No branch-specific code exists; JM chosen because the service is signed as the Musashino Line.
  "jr-musashino-takaya": "JM",
  // jr-musashino-futamata: Judgement (user-confirmed 2026-10-30: JM). Two-station Musashino through service on the Keiyō Futamata branch: Nishi-Funabashi is JM10, Minami-Funabashi is Keiyō JE11. JM chosen for the same reason as the Takaya branch.
  "jr-musashino-futamata": "JM",
  "jr-nambu": "JN",
  "jr-nambu-branch": "JN",
  "jr-tsurumi": "JI",
  "jr-tsurumi-umishibaura": "JI",
  "jr-tsurumi-okawa": "JI",
  "jr-yokohama": "JH",
  "jr-tokaido": "JT",
  "jr-yokosuka": "JO",
  "jr-sobu-rapid": "JO",
  // jr-utsunomiya: Partial. JU covers Tokyo–Ōmiya only (JU01–07); Toro–Kuroiso has no JU numbers.
  "jr-utsunomiya": "JU",
  // jr-takasaki: Partial. JU covers Tokyo–Ōmiya only; Miyahara–Takasaki has no JU numbers. No separate Takasaki code exists.
  "jr-takasaki": "JU",
  // jr-shonan-shinjuku-local: Partial. Zushi–Ōmiya is JS (JS06–24); the Toro–Utsunomiya part of the service has no JS numbers.
  "jr-shonan-shinjuku-local": "JS",
  // jr-shonan-shinjuku-rapid-takasaki: Partial / multi-code. Service Takasaki–Odawara: Ōfuna–Ōmiya is JS, Ōfuna–Odawara stations are JT, north of Ōmiya is unnumbered. Central-Tokyo JS chosen.
  "jr-shonan-shinjuku-rapid-takasaki": "JS",
  // jr-joban-rapid: Partial. Service Shinagawa–Namie: Ueno–Toride is JJ (JJ01–10); north of Toride is unnumbered; Shinagawa–Ueno stations carry JT/JU. JJ is the line's own code.
  "jr-joban-rapid": "JJ",
  "jr-joban-local": "JL",
  // jr-narita: Partial. Sakura–Narita is JO (JO33–35); Narita–Matsugishi is unnumbered.
  "jr-narita": "JO",
  "jr-narita-airport-branch": "JO",
  // jr-sobu-main: Partial. Chiba–Sakura is JO (JO28–33); Minami-Shisui–Chōshi is unnumbered.
  "jr-sobu-main": "JO",
  "jr-ito": "JT",
  "jr-shinonoi": "SN",
  "jr-shinetsu-nagano": "SE",
  // 東京地下鉄: https://www.tokyometro.jp/support/trademark/pdf/guideline.pdf
  "metro-ginza": "G",
  "metro-marunouchi": "M",
  "metro-marunouchi-honancho": "M",
  "metro-hibiya": "H",
  "metro-tozai": "T",
  "metro-chiyoda": "C",
  "metro-yurakucho": "Y",
  "metro-hanzomon": "Z",
  "metro-namboku": "N",
  "metro-fukutoshin": "F",
  // 東京都交通局: https://www.kotsu.metro.tokyo.jp/subway/stations/
  "toei-asakusa": "A",
  "toei-mita": "I",
  "toei-shinjuku": "S",
  "toei-oedo": "E",
  // 横浜市交通局: https://navi.hamabus.city.yokohama.lg.jp/koutuu/pc/map/Top
  "yokohama-blue": "B",
  "yokohama-green": "G",
  // 東武鉄道: https://www.railforum.jp/ftrain/public/dl/opencontents/imagedata/tobu_120209_1.pdf
  // tobu-isesaki: Multi-code. Asakusa/Oshiage–Tōbu-dōbutsu-kōen is TS (TS01–30), Wado–Isesaki is TI (TI01–25). Tokyo-side TS chosen.
  "tobu-isesaki": "TS",
  "tobu-nikko": "TN",
  "tobu-kinugawa": "TN",
  "tobu-utsunomiya": "TN",
  "tobu-sano": "TI",
  "tobu-kiryu": "TI",
  "tobu-koizumi": "TI",
  "tobu-koizumi-ota": "TI",
  "tobu-kameido": "TS",
  "tobu-daishi": "TS",
  "tobu-urban-park": "TD",
  "tobu-tojo": "TJ",
  "tobu-ogose": "TJ",
  "tobu-oshiage": "TS",
  // 西武鉄道: https://www.seiburailway.jp/railway/station/
  "seibu-ikebukuro": "SI",
  "seibu-chichibu": "SI",
  "seibu-yurakucho": "SI",
  "seibu-toshima": "SI",
  "seibu-sayama": "SI",
  "seibu-yamaguchi": "SY",
  "seibu-shinjuku": "SS",
  "seibu-haijima": "SS",
  "seibu-tamako": "ST",
  "seibu-kokubunji": "SK",
  "seibu-seibuen": "SK",
  "seibu-tamagawa": "SW",
  // 京成電鉄: https://www.keisei.co.jp/keisei/kouhou/news/22-034.pdf
  "keisei-main": "KS",
  "keisei-oshiage": "KS",
  "keisei-kanamachi": "KS",
  "keisei-chiba": "KS",
  "keisei-chihara": "KS",
  "keisei-higashi-narita": "KS",
  "keisei-matsudo": "KS",
  "keisei-narita-airport-access": "KS",
  // 首都圏新都市鉄道: https://www.mir.co.jp/route_map/akihabara/
  "tx": "TX",
  // 京浜急行電鉄: https://www.keikyu.co.jp/ride/kakueki/
  "keikyu-main": "KK",
  "keikyu-airport": "KK",
  "keikyu-daishi": "KK",
  "keikyu-zushi": "KK",
  "keikyu-kurihama": "KK",
  // 京王電鉄: https://www.keio.co.jp/global/howto/railwaymap/
  "keio-main": "KO",
  "keio-sagamihara": "KO",
  "keio-takao": "KO",
  "keio-keibajo": "KO",
  "keio-dobutsuen": "KO",
  "keio-inokashira": "IN",
  // 小田急電鉄: https://www.odakyu.jp/program/info/data.info/8052_1284200_.pdf
  "odakyu-odawara": "OH",
  "odakyu-enoshima": "OE",
  "odakyu-tama": "OT",
  // 東急電鉄: https://www.tokyu.co.jp/image/news/pdf/120126-1.pdf
  "tokyu-toyoko": "TY",
  "tokyu-meguro": "MG",
  "tokyu-shin-yokohama": "SH",
  "tokyu-den-en-toshi": "DT",
  "tokyu-oimachi": "OM",
  "tokyu-ikegami": "IK",
  "tokyu-tamagawa": "TM",
  "tokyu-setagaya": "SG",
  "tokyu-kodomonokuni": "KD",
  // 相模鉄道: https://www.sotetsu.co.jp/news_release/pdf/140225_01.pdf
  "sotetsu-main": "SO",
  "sotetsu-izumino": "SO",
  "sotetsu-shin-yokohama": "SO",
  // 横浜高速鉄道: https://www.mm21railway.co.jp/global/english/info/pdf/map.pdf?202403=
  "mm-minatomirai": "MM",
  // 北総鉄道: https://www.hokuso-railway.co.jp/railway/station/
  "hokuso-main": "HS",
};

export const NO_CODE_LINE_GROUP_IDS: ReadonlySet<string> = new Set([
  "jr-hachiko",
  "jr-kawagoe-west",
  "jr-sagami",
  "jr-narita-abiko",
  "jr-kashima",
  "jr-sotobo",
  "jr-uchibo",
  "jr-kururi",
  "jr-togane",
  "jr-chuo-tatsuno",
  "jr-koumi",
  "jr-oito",
  "jr-shinetsu-yokokawa",
  "jr-joetsu",
  "jr-agatsuma",
  "jr-ryomo",
  "jr-mito",
  "jr-nikko",
  "jr-karasuyama",
  "jr-suigun",
  "jr-suigun-ota",
]);

export function badgeTextColor(background: string): "#000000" | "#ffffff" {
  const blackContrast: number = contrastRatio("#000000", background);
  const whiteContrast: number = contrastRatio("#ffffff", background);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

function validColor(color: string | undefined): color is string {
  return color !== undefined && parseHexColor(color) !== null;
}

// Own-property lookup so inherited keys such as "constructor" never resolve to a code.
function codeForGroup(groupId: string): string | null {
  if (!Object.hasOwn(LINE_BADGE_CODES, groupId)) {
    return null;
  }
  return LINE_BADGE_CODES[groupId] ?? null;
}

export function lineBadgeFor(
  serviceId: string,
  presentation: PresentationResolver,
  fallbackColor?: string,
): LineBadgeModel {
  const groupId: string = presentation.lineGroupId(serviceId);
  const preferredColor: string | undefined = presentation.lineGroupColor(serviceId);
  const color: string | null = validColor(preferredColor)
    ? preferredColor
    : validColor(fallbackColor)
      ? fallbackColor
      : null;
  return {
    groupId,
    code: codeForGroup(groupId),
    color,
    name: presentation.serviceName(serviceId),
    textColor: color === null ? null : badgeTextColor(color),
  };
}
