import { expect, test } from "./fixtures";
import { openTitle, panelStat, readMap, readSave, rollOnce, startNewGame } from "./support/app";

// A browser without WebGL2 cannot draw the map, but the game must still start
// and be playable behind a clear notice (it used to render a blank page).

const UNSUPPORTED_TEXT = /この端末・ブラウザでは地図を表示できません/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const blocked = new Set(["webgl2", "webgl", "experimental-webgl"]);
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (blocked.has(type)) return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
});

test.use({ dataset: "fixture" });

test("without WebGL2 the title shows a notice and the game stays playable", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await openTitle(page);
  await expect(page.getByRole("status").filter({ hasText: UNSUPPORTED_TEXT })).toBeVisible();
  expect(await readMap(page)).toBeNull();

  await startNewGame(page);
  await rollOnce(page);
  await rollOnce(page);
  await expect(panelStat(page, "ターン数")).toHaveText("2");
  expect((await readSave(page))?.turn).toBe(2);
  await expect(page.getByRole("status").filter({ hasText: UNSUPPORTED_TEXT })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
