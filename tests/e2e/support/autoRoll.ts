import type { Locator, Page } from "@playwright/test";
import { gamePanel } from "./app";

export const AUTO_ROLL_GAP_MS = 1_200;

export function autoRollToggle(page: Page): Locator {
  return gamePanel(page).getByRole("button", { name: "おまかせで進む" });
}

/** Override visibility for lifecycle-handler coverage and notify the document listener. */
export async function setVisibilityState(page: Page, state: DocumentVisibilityState): Promise<void> {
  await page.evaluate((nextState) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: nextState });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}
