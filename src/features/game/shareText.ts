import type { EditionDisplay } from "../editions/types";
import type { GameSummary } from "./gameSummary";

export const RESULT_SHARE_HASHTAG = "#山手線すごろく";
export const RESULT_SHARE_SITE_URL = "https://yamanote-line-sugoroku.vercel.app";

export function buildShareText(display: EditionDisplay, summary: GameSummary): string {
  return [
    `${display.title} ${display.subtitle}をクリア！`,
    `所要ターン数 ${summary.turns}・移動回数 ${summary.moves}・乗換回数 ${summary.transfers}`,
    RESULT_SHARE_HASHTAG,
    RESULT_SHARE_SITE_URL,
  ].join("\n");
}
