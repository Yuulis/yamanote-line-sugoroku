import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  openTitle,
  readSaveText,
  rollOnce,
  startNewGame,
  titleScreen,
  writeSaveText,
} from "./support/app";

// Spec 8.3 item covered here (with spec 11, invalid saves):
//   [8.3-4] Reload recovery: a save that cannot be trusted is reported in
//           Japanese and can be discarded (spec 3.4 / 11), never crashing
//           the title screen or being resumed.

interface InvalidSaveCase {
  name: string;
  message: string;
  tamper: (valid: string) => string;
}

function withField(valid: string, field: string, value: unknown): string {
  return JSON.stringify({ ...JSON.parse(valid), [field]: value });
}

function tamperOldRuleset(valid: string): string {
  const save = JSON.parse(valid);
  save.config = {
    ...save.config,
    rulesetVersion: "jr-east-23ku-1",
    serviceLottery: {
      ...save.config.serviceLottery,
      target: { kind: "weight", weight: 1 },
    },
    directionLottery: { ...save.config.directionLottery, towardTargetWeight: 1 },
  };
  return JSON.stringify(save);
}

/** Flip the last hex digit of the seed: same shape, different dice. */
function tamperSeed(valid: string): string {
  const seed = String(JSON.parse(valid).rngSeed);
  const last = seed.at(-1) === "0" ? "1" : "0";
  return withField(valid, "rngSeed", `${seed.slice(0, -1)}${last}`);
}

const CASES: InvalidSaveCase[] = [
  {
    name: "corrupted JSON",
    message: "セーブデータが壊れているため読み込めません。",
    tamper: (valid) => valid.slice(0, Math.floor(valid.length / 2)),
  },
  {
    name: "unknown saveVersion",
    message: "このバージョンでは読み込めない形式のセーブデータです。",
    tamper: (valid) => withField(valid, "saveVersion", 999),
  },
  {
    name: "previous ruleset",
    message: "ルールが異なるセーブデータのため読み込めません。",
    tamper: tamperOldRuleset,
  },
  {
    name: "tampered rngSeed",
    message: "サイコロの記録が一致しないため、このセーブデータは使えません。",
    tamper: tamperSeed,
  },
];

async function storeTamperedSave(
  page: Page,
  tamper: (valid: string) => string,
): Promise<string> {
  await openTitle(page);
  await startNewGame(page);
  await rollOnce(page);
  await rollOnce(page);
  const valid = await readSaveText(page);
  if (!valid) throw new Error("no valid save to tamper with");
  const tampered = tamper(valid);
  await writeSaveText(page, tampered);
  await page.reload();
  await expect(titleScreen(page)).toBeVisible();
  return tampered;
}

for (const { name, message, tamper } of CASES) {
  test(`[8.3-4] ${name} shows the Japanese message and can be discarded`, async ({ page }) => {
    await storeTamperedSave(page, tamper);

    const alert = titleScreen(page).getByRole("alert");
    await expect(alert).toHaveText(new RegExp(message));
    await expect(page.getByRole("button", { name: /^つづきから/ })).toHaveCount(0);

    await alert.getByRole("button", { name: "セーブデータを破棄" }).click();
    const dialog = page.getByRole("alertdialog", { name: "セーブデータの削除" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "削除する" }).click();
    await expect(dialog).toBeHidden();

    await expect(titleScreen(page).getByRole("status")).toHaveText("セーブデータを削除しました。");
    await expect(alert).toBeHidden();
    expect(await readSaveText(page)).toBeNull();
    await startNewGame(page);
  });
}

test.use({ dataset: "fixture" });

test("[8.3-4] cancelling the discard keeps the invalid save untouched", async ({ page }) => {
  const tampered = await storeTamperedSave(page, (valid) => withField(valid, "saveVersion", 999));

  await page.getByRole("button", { name: "セーブデータを破棄" }).click();
  const dialog = page.getByRole("alertdialog", { name: "セーブデータの削除" });
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toBeHidden();

  await expect(titleScreen(page).getByRole("alert")).toBeVisible();
  expect(await readSaveText(page)).toBe(tampered);
});
