import type { Page } from "@playwright/test";

/** Independent persisted-settings fixture; never overwrite changes made through the UI on reload. */
export async function seedGameSettings(page: Page, settings: {
  readonly speedId: "slow" | "normal" | "fast";
  readonly follow: boolean;
  readonly presentationLevel: "all" | "important" | "none";
}): Promise<void> {
  await page.addInitScript((preferences) => {
    const key = "yamanote-line-sugoroku:settings:v1";
    try {
      if (localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, JSON.stringify({ version: 1, ...preferences }));
    } catch (error) {
      console.warn("Unable to seed game settings", error);
    }
  }, settings);
}
